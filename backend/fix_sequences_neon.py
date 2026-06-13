"""
Fix all SERIAL sequences in Neon after a data migration.
Run once from the project root:
    python3 backend/fix_sequences_neon.py
"""
import psycopg2

NEON_URL = "postgresql://neondb_owner:npg_7lPKyeLa2XtN@ep-purple-leaf-akwiejh3.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require"

conn = psycopg2.connect(NEON_URL)
conn.autocommit = True
cur = conn.cursor()

# Find all sequences and their owning columns
cur.execute("""
    SELECT
        seq.relname AS sequence_name,
        tbl.relname AS table_name,
        col.attname AS column_name
    FROM pg_class seq
    JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype = 'a'
    JOIN pg_class tbl ON tbl.oid = dep.refobjid
    JOIN pg_attribute col ON col.attrelid = tbl.oid AND col.attnum = dep.refobjsubid
    WHERE seq.relkind = 'S'
    ORDER BY tbl.relname
""")
sequences = cur.fetchall()

print(f"Found {len(sequences)} sequences to check.\n")

for seq_name, table_name, col_name in sequences:
    cur.execute(f'SELECT MAX("{col_name}") FROM "{table_name}"')
    max_val = cur.fetchone()[0]
    if max_val is None:
        print(f"  {table_name}.{col_name}: empty table, skipping")
        continue
    cur.execute(f"SELECT setval('{seq_name}', %s)", (max_val,))
    result = cur.fetchone()[0]
    print(f"  {table_name}.{col_name}: sequence reset to {result}")

print("\nDone.")
cur.close()
conn.close()
