"""
Migrate amazon_orders from Railway Postgres to Neon.
Fetches valid transaction_ids from Neon first, then only migrates matching orders.
Run once from the project root:
    python3 backend/migrate_amazon_local.py
"""
import psycopg2
import psycopg2.extras

SOURCE_URL = "postgresql://postgres:hKgcOPWSLQFJePPwtsCAjzOrkPHqieUn@junction.proxy.rlwy.net:19700/railway"
NEON_URL   = "postgresql://neondb_owner:npg_7lPKyeLa2XtN@ep-purple-leaf-akwiejh3.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require"

BATCH_SIZE = 500

print("Connecting to source (Railway)…")
src_conn = psycopg2.connect(SOURCE_URL)
src_cur = src_conn.cursor()

print("Connecting to destination (Neon)…")
dst_conn = psycopg2.connect(NEON_URL)
dst_cur = dst_conn.cursor()

# Fetch valid transaction_ids from NEON
print("Fetching valid transaction IDs from Neon…")
dst_cur.execute("SELECT transaction_id FROM transactions")
neon_txn_ids = set(row[0] for row in dst_cur.fetchall())
print(f"  {len(neon_txn_ids)} transactions in Neon")

# Fetch all amazon_orders from Railway
src_cur.execute("SELECT * FROM amazon_orders")
cols = [desc[0] for desc in src_cur.description]
col_list = ", ".join(f'"{c}"' for c in cols)
placeholders = ", ".join(["%s"] * len(cols))
all_rows = src_cur.fetchall()

txn_id_idx = cols.index("transaction_id")
eligible = [r for r in all_rows if r[txn_id_idx] in neon_txn_ids]
skipped = len(all_rows) - len(eligible)

print(f"\namazon_orders: {len(all_rows)} in source")
print(f"  {skipped} skipped (transaction_id not in Neon)")
print(f"  {len(eligible)} eligible to insert")

dst_cur.execute("SELECT COUNT(*) FROM amazon_orders")
dst_before = dst_cur.fetchone()[0]

for i in range(0, len(eligible), BATCH_SIZE):
    batch = eligible[i:i + BATCH_SIZE]
    try:
        psycopg2.extras.execute_batch(
            dst_cur,
            f'INSERT INTO amazon_orders ({col_list}) VALUES ({placeholders}) ON CONFLICT DO NOTHING',
            batch,
            page_size=BATCH_SIZE,
        )
        dst_conn.commit()
        print(f"  batch {i // BATCH_SIZE + 1} done")
    except Exception as exc:
        dst_conn.rollback()
        print(f"  batch error: {exc}")

dst_cur.execute("SELECT COUNT(*) FROM amazon_orders")
dst_after = dst_cur.fetchone()[0]
print(f"  inserted: {dst_after - dst_before} | already present: {dst_before}")

# Reset sequence
print("\nResetting sequences…")
dst_cur.execute("SELECT MAX(id) FROM amazon_orders")
max_val = dst_cur.fetchone()[0]
if max_val:
    dst_cur.execute("SELECT setval('amazon_orders_id_seq', %s)", (max_val,))
    dst_conn.commit()
    print(f"  amazon_orders.id: reset to {max_val}")

src_conn.close()
dst_conn.close()
print("\nDone.")
