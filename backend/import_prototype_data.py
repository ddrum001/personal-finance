"""
One-shot script to import prototype transaction CSV into the finance DB.

Usage:
    python import_prototype_data.py [path/to/transactions.csv]

Defaults to ~/Downloads/transactions.csv if no argument given.
"""

import csv
import hashlib
import sys
from datetime import date as date_type, datetime
from pathlib import Path

# ── locate the app package so we can reuse its models / DB ──────────────────
sys.path.insert(0, str(Path(__file__).parent))

from app.database import SessionLocal, engine
from app.models import Base, PlaidItem, Account, Transaction, BudgetCategory

Base.metadata.create_all(bind=engine)

# ── sub-category typo corrections (prototype had typos; seeded DB is correct) ─
TYPO_FIX = {
    "Administative Fees":   "Administrative Fees",
    "Extracurriculur Classes": "Extracurricular Classes",
}

# ── source → (institution_name, account_name, account_type, account_subtype) ─
SOURCE_MAP = {
    "Chase":                            ("Chase",            "Chase",                  "credit",     "credit card"),
    "Chase Freedom Visa":               ("Chase",            "Freedom Visa",           "credit",     "credit card"),
    "Disney Visa":                      ("Chase",            "Disney Visa",            "credit",     "credit card"),
    "Prime Visa":                       ("Chase",            "Prime Visa",             "credit",     "credit card"),
    "Southwest Visa":                   ("Chase",            "Southwest Visa",         "credit",     "credit card"),
    "BofA Checking":                    ("Bank of America",  "Checking",               "depository", "checking"),
    "BofA Credit Cards":                ("Bank of America",  "Credit Card",            "credit",     "credit card"),
    "David's Bofa Credit Card":         ("Bank of America",  "David's Credit Card",    "credit",     "credit card"),
    "Tarren's BofA Mastercard Credit Card": ("Bank of America", "Tarren's Mastercard", "credit",     "credit card"),
    "Tarren's BofA Visa Credit Card":   ("Bank of America",  "Tarren's Visa",          "credit",     "credit card"),
    "Ally Savings":                     ("Ally",             "Savings",                "depository", "savings"),
}


def make_item_id(institution: str) -> str:
    return "import_" + institution.lower().replace(" ", "_").replace("'", "")


def make_account_id(item_id: str, account_name: str) -> str:
    key = f"{item_id}|{account_name.lower()}"
    return "import_acct_" + hashlib.sha1(key.encode()).hexdigest()[:12]


def make_txn_id(surrogate_key: str) -> str:
    return "import_" + hashlib.sha1(surrogate_key.encode()).hexdigest()[:20]


def main(csv_path: str):
    db = SessionLocal()

    # ── load seeded budget categories ────────────────────────────────────────
    cat_map = {c.sub_category: c for c in db.query(BudgetCategory).all()}

    # ── ensure PlaidItem + Account rows exist for each source ───────────────
    items: dict[str, PlaidItem] = {}
    accounts: dict[str, Account] = {}

    for source, (inst, acct_name, acct_type, acct_subtype) in SOURCE_MAP.items():
        item_id = make_item_id(inst)
        if item_id not in items:
            item = db.get(PlaidItem, item_id)
            if not item:
                item = PlaidItem(item_id=item_id, access_token="manual", institution_name=inst)
                db.add(item)
            items[item_id] = item

        account_id = make_account_id(item_id, acct_name)
        if account_id not in accounts:
            acct = db.get(Account, account_id)
            if not acct:
                acct = Account(
                    account_id=account_id,
                    item_id=item_id,
                    name=acct_name,
                    type=acct_type,
                    subtype=acct_subtype,
                )
                db.add(acct)
            accounts[account_id] = acct

        # store by source for fast lookup below
        accounts[source] = accounts[account_id]
        items[source] = items[item_id]

    db.commit()

    # ── import transactions ──────────────────────────────────────────────────
    added = skipped = errors = 0
    seen_ids: set[str] = set()  # deduplicate within this run

    with open(csv_path, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            surrogate = row.get("Surrogate Key", "").strip()
            if surrogate:
                txn_id = make_txn_id(surrogate)
            else:
                # Newer rows missing a surrogate key — derive ID from content
                fallback = f"{row.get('Date','').strip()}|{row.get('Amount','').strip()}|{row.get('Transaction','').strip()}|{row.get('Source','').strip()}"
                if not fallback.replace("|", "").strip():
                    errors += 1
                    continue
                txn_id = "import_fb_" + hashlib.sha1(fallback.encode()).hexdigest()[:18]
            if txn_id in seen_ids or db.get(Transaction, txn_id):
                skipped += 1
                continue
            seen_ids.add(txn_id)

            # Amount: CSV negative = expense → our DB positive = expense
            try:
                amount = -float(row["Amount"].replace(",", "").strip())
            except (ValueError, KeyError):
                errors += 1
                continue

            raw_date = row.get("Date", "").strip()
            if not raw_date:
                errors += 1
                continue
            try:
                txn_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
            except ValueError:
                errors += 1
                continue

            source = row.get("Source", "").strip()
            if source not in SOURCE_MAP:
                # Unknown source — create a generic entry
                errors += 1
                continue

            acct = accounts[source]
            item = items[source]

            name = row.get("Transaction", "").strip() or "Unknown"

            # sub-category: apply typo corrections, validate against DB
            raw_sub = row.get("Assigned Sub-Category", "").strip()
            raw_sub = TYPO_FIX.get(raw_sub, raw_sub)
            budget_sub = raw_sub if (raw_sub and raw_sub != "#REF!" and raw_sub in cat_map) else None

            db.add(Transaction(
                transaction_id=txn_id,
                account_id=acct.account_id,
                item_id=item.item_id,
                name=name,
                merchant_name=name,
                amount=amount,
                date=txn_date,
                category=row.get("Imported Category", "").strip() or None,
                pending=False,
                budget_sub_category=budget_sub,
            ))
            added += 1

            # batch commits every 500 rows
            if (added + skipped) % 500 == 0:
                db.commit()

    db.commit()
    db.close()

    print(f"\n{'─'*45}")
    print(f"  Import complete")
    print(f"  Added:             {added:,}")
    print(f"  Skipped (dupes):   {skipped:,}")
    print(f"  Errors/skipped:    {errors:,}")
    print(f"{'─'*45}\n")


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else str(Path.home() / "Downloads" / "transactions.csv")
    if not Path(path).exists():
        print(f"File not found: {path}")
        sys.exit(1)
    print(f"Importing: {path}")
    main(path)
