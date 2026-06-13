"""
Merge the duplicate 'Adv Plus Banking' account in Neon.
Identifies the Plaid account (keep) and the manual CSV-imported account (delete),
reassigns all transactions to the Plaid account, then cleans up.

Run from the project root:
    python3 backend/merge_duplicate_account.py
"""
import psycopg2

NEON_URL = "postgresql://neondb_owner:npg_7lPKyeLa2XtN@ep-purple-leaf-akwiejh3.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require"
ACCOUNT_NAME = "adv plus banking"

conn = psycopg2.connect(NEON_URL)
conn.autocommit = False
cur = conn.cursor()

# ── Step 1: Find the two accounts ────────────────────────────────────────────
cur.execute("""
    SELECT account_id, item_id, name, type, subtype, mask
    FROM accounts
    WHERE lower(name) = %s
    ORDER BY account_id
""", (ACCOUNT_NAME,))
accounts = cur.fetchall()

if len(accounts) == 0:
    print(f"No accounts found matching '{ACCOUNT_NAME}'. Nothing to do.")
    conn.close()
    exit(0)

if len(accounts) == 1:
    print(f"Only one account found for '{ACCOUNT_NAME}' — no duplicate to merge.")
    print(f"  {accounts[0]}")
    conn.close()
    exit(0)

print(f"Found {len(accounts)} accounts named '{ACCOUNT_NAME}':\n")
for a in accounts:
    cur.execute("SELECT COUNT(*) FROM transactions WHERE account_id = %s", (a[0],))
    txn_count = cur.fetchone()[0]
    print(f"  account_id : {a[0]}")
    print(f"  item_id    : {a[1]}")
    print(f"  type       : {a[2]} / {a[3]}")
    print(f"  mask       : {a[4]}")
    print(f"  txns       : {txn_count}")
    print()

# ── Step 2: Identify Plaid vs manual ─────────────────────────────────────────
plaid_accounts  = [a for a in accounts if not a[0].startswith("manual_acct_")]
manual_accounts = [a for a in accounts if a[0].startswith("manual_acct_")]

if not plaid_accounts:
    print("ERROR: Could not identify a Plaid account — all accounts are manual. Aborting.")
    conn.close()
    exit(1)

if not manual_accounts:
    print("ERROR: Could not identify a manual account to remove. Aborting.")
    conn.close()
    exit(1)

plaid_acct   = plaid_accounts[0]
manual_acct  = manual_accounts[0]

plaid_account_id  = plaid_acct[0]
plaid_item_id     = plaid_acct[1]
manual_account_id = manual_acct[0]
manual_item_id    = manual_acct[1]

print(f"Keeping  : {plaid_account_id} (Plaid, item {plaid_item_id})")
print(f"Removing : {manual_account_id} (manual import, item {manual_item_id})")
print()

# ── Step 3: Reassign transactions ────────────────────────────────────────────
cur.execute("""
    UPDATE transactions
    SET account_id = %s,
        item_id    = %s
    WHERE account_id = %s
""", (plaid_account_id, plaid_item_id, manual_account_id))
moved = cur.rowcount
print(f"Reassigned {moved} transaction(s) to Plaid account.")

# ── Step 4: Delete duplicate account ─────────────────────────────────────────
cur.execute("DELETE FROM accounts WHERE account_id = %s", (manual_account_id,))
print(f"Deleted duplicate account: {manual_account_id}")

# ── Step 5: Clean up orphaned manual PlaidItem ───────────────────────────────
cur.execute("""
    DELETE FROM plaid_items
    WHERE item_id = %s
      AND access_token = 'manual'
      AND item_id NOT IN (SELECT item_id FROM accounts)
""", (manual_item_id,))
if cur.rowcount:
    print(f"Cleaned up orphaned PlaidItem: {manual_item_id}")

conn.commit()

# ── Step 6: Verify ────────────────────────────────────────────────────────────
cur.execute("""
    SELECT a.account_id, a.item_id, a.name, COUNT(t.transaction_id) AS txns
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.account_id
    WHERE lower(a.name) = %s
    GROUP BY a.account_id, a.item_id, a.name
""", (ACCOUNT_NAME,))
result = cur.fetchall()
print(f"\nFinal state ({len(result)} account):")
for r in result:
    print(f"  {r[0]} | {r[1]} | {r[2]} | {r[3]} txns")

conn.close()
print("\nDone.")
