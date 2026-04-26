"""
CSV import router.

Supports auto-detection of common bank export formats:
  - Chase credit card / checking
  - Bank of America credit card / checking
  - Generic fallback (requires date, amount, and description columns)

Creates a synthetic PlaidItem + Account for manually-imported data so
all existing filtering, categorisation, and reporting works unchanged.
"""

import csv
import hashlib
import io
import logging
import traceback
from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from ..database import get_db
from ..models import Account, BudgetCategory, PlaidItem, Transaction
from .categories import apply_keywords_to_transactions

router = APIRouter(prefix="/import", tags=["import"])


# ---------------------------------------------------------------------------
# Format definitions
# ---------------------------------------------------------------------------

FORMATS = {
    "chase": {
        "date_col": "Transaction Date",
        "desc_col": "Description",
        "amount_col": "Amount",
        "category_col": "Category",
        # Chase amounts: negative = expense, positive = payment/credit
        "amount_sign": "native",
    },
    "bofa_credit": {
        "date_col": "Posted Date",
        "desc_col": "Payee",
        "amount_col": "Amount",
        "category_col": None,
        # BofA credit: negative = expense, positive = credit
        "amount_sign": "native",
    },
    "bofa_checking": {
        "date_col": "Date",
        "desc_col": "Description",
        "amount_col": "Amount",
        "category_col": None,
        # BofA checking: negative = debit, positive = deposit
        "amount_sign": "native",
        "running_bal_col": "Running Bal.",
    },
    "google_sheet": {
        "date_col": "Date",
        "desc_col": "Transaction",
        "amount_col": "Amount",
        "category_col": "Assigned Sub-Category",
        # Negative = expense, positive = income — same convention as BofA
        "amount_sign": "native",
    },
}


def strip_preamble(text: str) -> str:
    """Skip leading summary rows and return text starting from the real header line.

    BofA exports include a human-readable summary block before the actual CSV data.
    We find the first line that contains the known transaction column names.
    """
    lines = text.splitlines()
    for i, line in enumerate(lines):
        cols = {c.strip().strip('"') for c in line.split(',')}
        if 'Date' in cols and 'Description' in cols and 'Amount' in cols:
            return '\n'.join(lines[i:])
    return text  # no preamble detected


def detect_format(headers: list[str]) -> Optional[str]:
    """Infer bank format from CSV column headers."""
    h = {col.strip().lower() for col in headers}
    if "transaction date" in h:
        return "chase"
    if "posted date" in h and "payee" in h:
        return "bofa_credit"
    if "assigned sub-category" in h:
        return "google_sheet"
    if "date" in h and "description" in h and "amount" in h:
        return "bofa_checking"
    return None


def parse_amount(raw: str) -> Optional[float]:
    """Parse a dollar amount string, stripping $, commas, and quotes."""
    cleaned = raw.strip().strip('"').replace("$", "").replace(",", "")
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_date(raw: str) -> Optional[date_type]:
    """Try common date formats: MM/DD/YYYY and YYYY-MM-DD."""
    raw = raw.strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y", "%m/%d/%y"):
        try:
            from datetime import datetime
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def make_txn_id(txn_date: date_type, amount: float, description: str) -> str:
    """Deterministic ID so re-importing the same file is idempotent."""
    key = f"{txn_date}|{amount:.2f}|{description.lower().strip()}"
    digest = hashlib.sha1(key.encode()).hexdigest()[:20]
    return f"manual_{digest}"


# ---------------------------------------------------------------------------
# Helpers: ensure a synthetic item/account exists
# ---------------------------------------------------------------------------

def get_or_create_item(institution_name: str, db: Session) -> PlaidItem:
    # Find any existing manually-imported item for this institution first,
    # regardless of the prefix used when it was created (import_ vs manual_)
    existing = db.query(PlaidItem).filter(
        PlaidItem.institution_name == institution_name,
        PlaidItem.access_token == "manual",
    ).first()
    if existing:
        return existing

    item_id = f"manual_{institution_name.lower().replace(' ', '_')}"
    item = PlaidItem(
        item_id=item_id,
        access_token="manual",
        institution_name=institution_name,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def get_or_create_account(
    item_id: str,
    account_name: str,
    mask: Optional[str],
    acct_type: str,
    acct_subtype: str,
    db: Session,
) -> Account:
    # Find existing account under this item by name + subtype first,
    # so re-imports don't splinter into new accounts when the hash prefix differs
    existing = db.query(Account).filter(
        Account.item_id == item_id,
        Account.name == account_name,
        Account.subtype == acct_subtype,
    ).first()
    if existing:
        if mask and not existing.mask:
            existing.mask = mask
            db.commit()
        return existing

    key = f"{item_id}_{account_name.lower().replace(' ', '_')}_{mask or ''}"
    account_id = "manual_acct_" + hashlib.sha1(key.encode()).hexdigest()[:12]
    acct = Account(
        account_id=account_id,
        item_id=item_id,
        name=account_name,
        mask=mask or None,
        type=acct_type,
        subtype=acct_subtype,
    )
    db.add(acct)
    db.commit()
    db.refresh(acct)
    return acct


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.post("/csv")
async def import_csv(
    file: UploadFile = File(...),
    institution_name: str = Form(...),
    account_name: str = Form(...),
    account_mask: str = Form(""),
    account_type: str = Form("credit"),       # credit | depository
    account_subtype: str = Form("credit card"),  # credit card | checking | savings
    account_id: Optional[str] = Form(None),   # real Plaid account_id, bypasses synthetic creation
    db: Session = Depends(get_db),
):
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # handle BOM from Excel exports
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    text = strip_preamble(text)
    reader = csv.DictReader(io.StringIO(text))
    headers = reader.fieldnames or []

    fmt_key = detect_format(headers)
    if fmt_key is None:
        # Return detected headers so the client can show a helpful error
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Could not detect bank format. Unrecognised column headers.",
                "detected_headers": headers,
                "supported_formats": {
                    "Chase": "Transaction Date, Post Date, Description, Category, Type, Amount",
                    "Bank of America credit": "Posted Date, Reference #, Payee, Address, Amount",
                    "Bank of America checking": "Date, Description, Amount, Running Bal.",
                    "Google Sheet": "Date, Amount, Transaction, Source, Assigned Sub-Category",
                },
            },
        )

    fmt = FORMATS[fmt_key]
    try:
        if account_id:
            real_acct = db.get(Account, account_id)
            if not real_acct:
                raise HTTPException(status_code=422, detail={"message": f"Account {account_id!r} not found"})
            real_item = db.get(PlaidItem, real_acct.item_id)
            if not real_item:
                raise HTTPException(status_code=422, detail={"message": "Account's Plaid item not found"})
            account = real_acct
            item = real_item
            effective_institution = real_item.institution_name or institution_name
            display_account = f"{real_acct.nickname or real_acct.official_name or real_acct.name}{' ••••' + real_acct.mask if real_acct.mask else ''}"
        else:
            item = get_or_create_item(institution_name, db)
            account = get_or_create_account(
                item.item_id,
                account_name,
                account_mask.strip() or None,
                account_type,
                account_subtype,
                db,
            )
            effective_institution = institution_name
            display_account = f"{account_name}{' ••••' + account_mask if account_mask else ''}"
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        logger.error("import_csv: account setup failed: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(status_code=422, detail={"message": f"Account setup failed: {exc}"})

    # Build case-insensitive lookup for existing budget sub-categories
    sub_cat_lookup = {r[0].lower(): r[0] for r in db.query(BudgetCategory.sub_category).all()}

    added = skipped = errors = 0
    matched_ids: list[str] = []   # CSV category matched a budget sub-category
    unmatched_ids: list[str] = [] # no category or no match — go through keyword/review flow
    latest_bal_date: Optional[date_type] = None
    latest_bal: Optional[float] = None

    for row in reader:
        # --- parse date ---
        raw_date = row.get(fmt["date_col"], "").strip()
        txn_date = parse_date(raw_date)
        if txn_date is None:
            errors += 1
            continue

        # --- parse amount ---
        raw_amount = row.get(fmt["amount_col"], "").strip()
        if not raw_amount:
            # Balance-only rows (e.g. BofA "Beginning balance") — capture
            # running balance but don't count as a transaction
            if fmt.get("running_bal_col") and txn_date is not None:
                raw_bal = row.get(fmt["running_bal_col"], "").strip()
                bal = parse_amount(raw_bal)
                if bal is not None:
                    if latest_bal_date is None or txn_date >= latest_bal_date:
                        latest_bal_date = txn_date
                        latest_bal = bal
            continue
        amount = parse_amount(raw_amount)
        if amount is None:
            errors += 1
            continue

        # Bank exports use negative for expenses; our model stores positive = expense
        # (Plaid convention: positive amount = money out of account)
        amount = -amount  # flip sign: CSV negative → positive in our DB

        # --- description ---
        description = row.get(fmt["desc_col"], "").strip()
        if not description:
            errors += 1
            continue

        # --- running balance (BofA checking only) ---
        if fmt.get("running_bal_col"):
            raw_bal = row.get(fmt["running_bal_col"], "").strip()
            bal = parse_amount(raw_bal)
            if bal is not None and txn_date is not None:
                if latest_bal_date is None or txn_date >= latest_bal_date:
                    latest_bal_date = txn_date
                    latest_bal = bal

        # --- category (Chase only) ---
        raw_category = None
        if fmt["category_col"]:
            raw_category = row.get(fmt["category_col"], "").strip() or None

        # Case-insensitive match against known budget sub-categories
        matched_cat = sub_cat_lookup.get(raw_category.lower()) if raw_category else None

        # --- dedup ---
        # 1) Exact ID match (re-importing the same file)
        txn_id = make_txn_id(txn_date, amount, description)
        if db.get(Transaction, txn_id):
            skipped += 1
            continue
        # 2) Content match — catches overlap with prototype data that used a
        #    different ID scheme (surrogate keys) for the same transactions
        duplicate = db.query(Transaction).filter(
            Transaction.date == txn_date,
            Transaction.amount == amount,
            Transaction.name == description,
        ).first()
        if duplicate:
            skipped += 1
            continue

        db.add(Transaction(
            transaction_id=txn_id,
            account_id=account.account_id,
            item_id=item.item_id,
            institution_name=effective_institution,
            name=description,
            merchant_name=description,
            amount=amount,
            date=txn_date,
            category=raw_category,
            pending=False,
            budget_sub_category=matched_cat,
            needs_review=matched_cat is None,
        ))
        if matched_cat:
            matched_ids.append(txn_id)
        else:
            unmatched_ids.append(txn_id)
        added += 1

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("import_csv: commit failed: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(status_code=422, detail={"message": f"Database error saving transactions: {exc}"})

    # Persist running balance from BofA checking if it's newer than what's stored
    if latest_bal is not None and latest_bal_date is not None:
        from datetime import datetime, timezone
        bal_dt = datetime.combine(latest_bal_date, datetime.min.time()).replace(tzinfo=timezone.utc)
        if account.balance_updated_at is None or bal_dt >= account.balance_updated_at:
            account.balance = latest_bal
            account.balance_updated_at = bal_dt
            db.commit()

    # Apply keyword rules only to transactions where CSV category didn't match
    kw_result = apply_keywords_to_transactions(db, transaction_ids=unmatched_ids) if unmatched_ids else {"labeled": 0, "skipped": 0}

    return {
        "format_detected": fmt_key,
        "institution": effective_institution,
        "account": display_account,
        "added": added,
        "skipped_duplicates": skipped,
        "errors": errors,
        "category_matched": len(matched_ids),
        "category_unmatched": len(unmatched_ids),
        "keywords_applied": kw_result["labeled"],
        "keywords_unmatched": kw_result["skipped"],
    }


@router.get("/formats")
def list_formats():
    """Return the supported CSV formats and their expected column headers."""
    return {
        "chase": {
            "label": "Chase (credit card or checking)",
            "required_columns": ["Transaction Date", "Description", "Amount"],
            "optional_columns": ["Post Date", "Category", "Type", "Memo"],
            "amount_convention": "Negative = expense, Positive = payment/credit",
            "how_to_export": "Chase online → Accounts → Download account activity → CSV",
        },
        "bofa_credit": {
            "label": "Bank of America (credit card)",
            "required_columns": ["Posted Date", "Payee", "Amount"],
            "optional_columns": ["Reference #", "Address"],
            "amount_convention": "Negative = expense, Positive = credit",
            "how_to_export": "BofA online → Card activity → Download → CSV",
        },
        "bofa_checking": {
            "label": "Bank of America (checking / savings)",
            "required_columns": ["Date", "Description", "Amount"],
            "optional_columns": ["Running Bal."],
            "amount_convention": "Negative = debit, Positive = deposit",
            "how_to_export": "BofA online → Account activity → Download → CSV",
        },
    }
