"""
Migrate data from local SQLite to a Postgres database.

Usage:
    POSTGRES_URL="postgresql://user:pass@host:port/db" python migrate_to_postgres.py
"""
import os
import sys
from sqlalchemy import create_engine, text

SQLITE_URL = os.getenv("SQLITE_URL", "sqlite:///./finance.db")
POSTGRES_URL = os.getenv("POSTGRES_URL")

if not POSTGRES_URL:
    print("Error: set POSTGRES_URL environment variable")
    sys.exit(1)

if POSTGRES_URL.startswith("postgres://"):
    POSTGRES_URL = POSTGRES_URL.replace("postgres://", "postgresql://", 1)

sqlite = create_engine(SQLITE_URL, connect_args={"check_same_thread": False})
pg = create_engine(POSTGRES_URL)

TABLES = [
    "plaid_items",
    "accounts",
    "budget_categories",
    "category_keywords",
    "transactions",
    "transaction_splits",
    "merchant_split_templates",
    "cashflow_entries",
]

# SQLite stores booleans as integers; cast them for Postgres
BOOL_COLUMNS = {
    "budget_categories": {"is_discretionary", "is_recurring", "hide_from_reports"},
    "transactions": {"pending", "needs_review"},
    "cashflow_entries": {"is_recurring"},
}

def cast_row(table, row):
    bool_cols = BOOL_COLUMNS.get(table, set())
    return {k: bool(v) if k in bool_cols and v is not None else v for k, v in row.items()}

with sqlite.connect() as src, pg.connect() as dst:
    for table in TABLES:
        try:
            rows = src.execute(text(f"SELECT * FROM {table}")).mappings().all()
        except Exception as e:
            print(f"  Skipping {table}: {e}")
            continue

        if not rows:
            print(f"  {table}: empty, skipping")
            continue

        cols = list(rows[0].keys())
        placeholders = ", ".join(f":{c}" for c in cols)
        col_list = ", ".join(cols)
        insert = text(
            f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
        )
        dst.execute(insert, [cast_row(table, dict(r)) for r in rows])
        dst.commit()
        print(f"  {table}: {len(rows)} rows migrated")

print("\nDone.")
