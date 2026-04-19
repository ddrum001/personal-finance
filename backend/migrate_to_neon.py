"""
Migrate data from a source PostgreSQL database to Neon.

Environment variables:
    SOURCE_DB_URL  — source Postgres connection string
    NEON_URL       — Neon destination connection string

If either variable is absent the script exits 0 (skipped, not an error),
so it is safe to leave in a Railway start command permanently.
"""

import os
import sys

# ---------------------------------------------------------------------------
# Validate environment
# ---------------------------------------------------------------------------

SOURCE_URL = os.getenv("SOURCE_DB_URL")
DEST_URL = os.getenv("NEON_URL")

if not SOURCE_URL:
    print("migrate_to_neon: SOURCE_DB_URL is not set — skipping migration.")
    sys.exit(0)

if not DEST_URL:
    print("migrate_to_neon: NEON_URL is not set — skipping migration.")
    sys.exit(0)

# SQLAlchemy 2.x requires postgresql://, not postgres://
def _fix_url(url: str) -> str:
    return url.replace("postgres://", "postgresql://", 1) if url.startswith("postgres://") else url

SOURCE_URL = _fix_url(SOURCE_URL)
DEST_URL   = _fix_url(DEST_URL)

# ---------------------------------------------------------------------------
# Engines
# ---------------------------------------------------------------------------

from sqlalchemy import create_engine, text  # noqa: E402

src_engine = create_engine(SOURCE_URL, pool_pre_ping=True)
dst_engine = create_engine(DEST_URL,   pool_pre_ping=True)

# ---------------------------------------------------------------------------
# Bootstrap destination schema via SQLAlchemy models
# (create_all is idempotent — skips tables that already exist)
# ---------------------------------------------------------------------------

# Ensure the app package is importable regardless of cwd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.models import Base  # noqa: E402

print("=" * 60)
print("Step 1 — Creating schema on Neon (skips existing tables)")
print("=" * 60)
Base.metadata.create_all(bind=dst_engine)
print("  Schema ready.\n")

# ---------------------------------------------------------------------------
# Table copy order — leaf tables first, dependents after
#
# FK graph:
#   plaid_items  ←  accounts  ←  transactions  ←  transaction_splits
#                            ←  cashflow_entries
#                            ←  promo_balances
#   budget_categories  ←  category_keywords
#   transactions  ←  amazon_orders
# ---------------------------------------------------------------------------

TABLES = [
    # ── no dependencies ──────────────────────────────────────────────────
    "plaid_items",
    "budget_categories",
    "merchant_split_templates",
    "gmail_credentials",
    "dismissed_duplicate_groups",
    # ── depends on plaid_items ────────────────────────────────────────────
    "accounts",
    # ── depends on accounts + plaid_items ────────────────────────────────
    "transactions",
    # ── depends on budget_categories ─────────────────────────────────────
    "category_keywords",
    # ── depend on accounts (nullable FK — safe after accounts) ───────────
    "cashflow_entries",
    "promo_balances",
    # ── depend on transactions ────────────────────────────────────────────
    "amazon_orders",
    "transaction_splits",
]

# Tables whose integer PKs are backed by a SERIAL sequence.
# After migration we must advance each sequence past the max copied ID
# so future inserts don't collide.
# Rows committed per round-trip to the destination.
# Smaller = more round-trips but less work lost if the process is killed.
# 250 keeps each batch well under 1 MB and under ~2 s at 200 ms RTT.
BATCH_SIZE = 250

# Tables whose integer PKs are backed by a SERIAL sequence.
# After migration we must advance each sequence past the max copied ID
# so future inserts don't collide.
SERIAL_PK_TABLES = {
    "budget_categories",
    "category_keywords",
    "merchant_split_templates",
    "cashflow_entries",
    "amazon_orders",
    "transaction_splits",
    "promo_balances",
    "dismissed_duplicate_groups",
}

# ---------------------------------------------------------------------------
# Copy
# ---------------------------------------------------------------------------

print("=" * 60)
print("Step 2 — Copying data")
print("=" * 60)

total_inserted = 0

with src_engine.connect() as src, dst_engine.connect() as dst:
    for table in TABLES:
        # Row count on source
        try:
            src_count = src.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
        except Exception as exc:
            print(f"  {table}: SKIPPED — not found in source ({exc})")
            continue

        if src_count == 0:
            print(f"  {table}: 0 rows in source, skipping")
            continue

        # Fetch all rows
        rows = src.execute(text(f"SELECT * FROM {table}")).mappings().all()
        if not rows:
            print(f"  {table}: 0 rows fetched, skipping")
            continue

        cols         = list(rows[0].keys())
        col_list     = ", ".join(cols)
        placeholders = ", ".join(f":{c}" for c in cols)

        insert_sql = text(
            f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
            f"ON CONFLICT DO NOTHING"
        )

        dst_before = dst.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()

        # Insert in small batches so each chunk is durable immediately.
        # If the process is killed mid-table, the committed chunks are kept
        # and a re-run skips them via ON CONFLICT DO NOTHING.
        row_dicts  = [dict(r) for r in rows]
        n_batches  = (len(row_dicts) + BATCH_SIZE - 1) // BATCH_SIZE
        batch_errs = 0
        for i in range(0, len(row_dicts), BATCH_SIZE):
            chunk = row_dicts[i : i + BATCH_SIZE]
            batch_num = i // BATCH_SIZE + 1
            if n_batches > 1:
                print(f"  {table}: batch {batch_num}/{n_batches} ({len(chunk)} rows)…", flush=True)
            try:
                dst.execute(insert_sql, chunk)
                dst.commit()
            except Exception as exc:
                dst.rollback()
                print(f"  {table}: ERROR in batch {batch_num} — {exc}")
                batch_errs += 1

        if batch_errs:
            print(f"  {table}: {batch_errs} batch(es) failed — partial data may be present")
            continue

        dst_after = dst.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
        inserted  = dst_after - dst_before
        skipped   = src_count - inserted

        note = f", {skipped} skipped (already present)" if skipped else ""
        print(f"  {table}: {src_count} source rows → {inserted} inserted{note}")
        total_inserted += inserted

# ---------------------------------------------------------------------------
# Reset SERIAL sequences so new inserts after migration don't collide
# ---------------------------------------------------------------------------

print()
print("=" * 60)
print("Step 3 — Resetting sequences on Neon")
print("=" * 60)

with dst_engine.connect() as dst:
    for table in SERIAL_PK_TABLES:
        try:
            max_id = dst.execute(text(f"SELECT MAX(id) FROM {table}")).scalar()
            if max_id is None:
                print(f"  {table}: empty, sequence unchanged")
                continue
            # pg_get_serial_sequence resolves the sequence name for the 'id' column
            dst.execute(text(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), {max_id})"
            ))
            dst.commit()
            print(f"  {table}: sequence reset to {max_id}")
        except Exception as exc:
            print(f"  {table}: WARNING — could not reset sequence ({exc})")

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print()
print("=" * 60)
print(f"Migration complete — {total_inserted} rows copied to Neon.")
print("=" * 60)
print()
print("Next steps:")
print("  1. Verify row counts in the Neon dashboard query tab")
print("  2. Update DATABASE_URL in Railway to the Neon connection string")
print("  3. Redeploy the backend service")
