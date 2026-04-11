import os
import calendar
from datetime import date, datetime, timedelta, timezone
from statistics import median, stdev as _stdev
from typing import Optional

import plaid
from fastapi import APIRouter, Depends, HTTPException, Query
from plaid.api import plaid_api
from plaid.model.accounts_balance_get_request import AccountsBalanceGetRequest
from dotenv import load_dotenv
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Account, CashflowEntry, PlaidItem, Transaction
from ..schemas import CashflowEntryCreate, CashflowEntryOut

load_dotenv()

router = APIRouter(prefix="/cashflow", tags=["cashflow"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _add_months(d: date, months: int) -> date:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return d.replace(year=year, month=month, day=day)


def _next_occurrence(entry: CashflowEntry, after: date) -> Optional[date]:
    """Advance entry.date by recurrence intervals until >= after."""
    current = entry.date
    while current < after:
        if entry.recurrence == "monthly":
            current = _add_months(current, 1)
        elif entry.recurrence == "biweekly":
            current += timedelta(weeks=2)
        elif entry.recurrence == "weekly":
            current += timedelta(weeks=1)
        elif entry.recurrence == "quarterly":
            current = _add_months(current, 3)
        elif entry.recurrence == "yearly":
            current = _add_months(current, 12)
        else:
            return None
    return current


def _expand_entry(entry: CashflowEntry, start_date: date, end_date: date) -> list[date]:
    """Return all dates this entry falls on within [start_date, end_date]."""
    if not entry.is_recurring or not entry.recurrence:
        if start_date <= entry.date <= end_date:
            return [entry.date]
        return []

    current = _next_occurrence(entry, start_date)
    if current is None:
        return []

    instances = []
    while current <= end_date:
        eff_end = entry.recurrence_end_date or end_date
        if current > eff_end:
            break
        instances.append(current)

        if entry.recurrence == "monthly":
            current = _add_months(current, 1)
        elif entry.recurrence == "biweekly":
            current += timedelta(weeks=2)
        elif entry.recurrence == "weekly":
            current += timedelta(weeks=1)
        elif entry.recurrence == "quarterly":
            current = _add_months(current, 3)
        elif entry.recurrence == "yearly":
            current = _add_months(current, 12)
        else:
            break

    return instances


def _plaid_client() -> plaid_api.PlaidApi:
    env_name = os.getenv("PLAID_ENV", "sandbox").lower()
    env_map = {
        "sandbox": plaid.Environment.Sandbox,
        "production": plaid.Environment.Production,
    }
    configuration = plaid.Configuration(
        host=env_map.get(env_name, plaid.Environment.Sandbox),
        api_key={
            "clientId": os.getenv("PLAID_CLIENT_ID"),
            "secret": os.getenv("PLAID_SECRET"),
        },
    )
    return plaid_api.PlaidApi(plaid.ApiClient(configuration))


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

@router.get("/entries", response_model=list[CashflowEntryOut])
def list_entries(db: Session = Depends(get_db)):
    return db.query(CashflowEntry).order_by(CashflowEntry.date, CashflowEntry.id).all()


@router.post("/entries", response_model=CashflowEntryOut, status_code=201)
def create_entry(body: CashflowEntryCreate, db: Session = Depends(get_db)):
    entry = CashflowEntry(**body.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.put("/entries/{entry_id}", response_model=CashflowEntryOut)
def update_entry(entry_id: int, body: CashflowEntryCreate, db: Session = Depends(get_db)):
    entry = db.get(CashflowEntry, entry_id)
    if not entry:
        raise HTTPException(404, "Entry not found")
    for k, v in body.model_dump().items():
        setattr(entry, k, v)
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/entries/{entry_id}", status_code=204)
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.get(CashflowEntry, entry_id)
    if not entry:
        raise HTTPException(404, "Entry not found")
    db.delete(entry)
    db.commit()


# ---------------------------------------------------------------------------
# Projection
# ---------------------------------------------------------------------------

@router.get("/suggestions")
def get_recurring_suggestions(
    months: int = Query(6, ge=3, le=12),
    db: Session = Depends(get_db),
):
    """
    Scan checking account transaction history to detect recurring patterns
    (paychecks, mortgage, utility ACH, etc.) and return them as suggested
    cashflow entries. Only looks at non-excluded checking accounts.
    """
    today = date.today()
    lookback_date = _add_months(today, -months)

    # Non-excluded checking accounts (same pool used for starting balance)
    checking_ids = [
        a.account_id for a in db.query(Account).all()
        if a.subtype == "checking" and not a.is_excluded
    ]
    if not checking_ids:
        return []

    transactions = (
        db.query(Transaction)
        .filter(
            Transaction.date >= lookback_date,
            Transaction.pending == False,
            Transaction.account_id.in_(checking_ids),
        )
        .all()
    )

    # Group by merchant_name → name
    groups: dict[str, list] = {}
    for txn in transactions:
        key = txn.merchant_name or txn.name
        if not key:
            continue
        groups.setdefault(key, []).append(txn)

    existing_names = {e.name.lower() for e in db.query(CashflowEntry).all()}

    suggestions = []
    for name, txns in groups.items():
        if len(txns) < 2:
            continue

        txns_sorted = sorted(txns, key=lambda t: t.date)
        dates = [t.date for t in txns_sorted]
        amounts = [t.amount for t in txns_sorted]

        intervals = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        med_interval = median(intervals)

        # Classify cadence
        if 6 <= med_interval <= 8:
            recurrence = "weekly"
        elif 12 <= med_interval <= 16:
            recurrence = "biweekly"
        elif 27 <= med_interval <= 33:
            recurrence = "monthly"
        elif 83 <= med_interval <= 97:
            recurrence = "quarterly"
        else:
            continue

        # Require consistent intervals (cv ≤ 35%)
        if len(intervals) >= 2:
            if med_interval > 0 and _stdev(intervals) / med_interval > 0.35:
                continue

        # Require consistent amounts (cv ≤ 15%)
        med_amount = median(amounts)
        if med_amount == 0:
            continue
        if len(amounts) >= 2:
            if abs(med_amount) > 0 and _stdev(amounts) / abs(med_amount) > 0.15:
                continue

        # Skip if name already exists as a cashflow entry
        if name.lower() in existing_names:
            continue

        # Project next future occurrence
        next_date = dates[-1]
        while next_date <= today:
            if recurrence == "monthly":
                next_date = _add_months(next_date, 1)
            elif recurrence == "biweekly":
                next_date += timedelta(weeks=2)
            elif recurrence == "weekly":
                next_date += timedelta(weeks=1)
            elif recurrence == "quarterly":
                next_date = _add_months(next_date, 3)
            else:
                break

        # Plaid: positive = debit/expense, negative = credit/income
        # Cashflow: positive = income, negative = expense
        cashflow_amount = -round(med_amount, 2)

        suggestions.append({
            "name": name,
            "amount": cashflow_amount,
            "recurrence": recurrence,
            "next_date": next_date,
            "occurrences": len(txns),
            "last_date": dates[-1],
        })

    suggestions.sort(key=lambda s: -abs(s["amount"]))
    return suggestions


@router.get("/projection")
def get_projection(
    days: int = Query(14, ge=7, le=365),
    db: Session = Depends(get_db),
):
    today = date.today()
    end_date = today + timedelta(days=days)

    # Starting balance = sum of all checking accounts with a stored balance
    accounts = db.query(Account).all()
    balance_accounts = []
    starting_balance = 0.0
    for acct in accounts:
        if acct.subtype in ("checking", "savings") and acct.balance is not None:
            balance_accounts.append({
                "account_id": acct.account_id,
                "name": acct.name,
                "mask": acct.mask,
                "subtype": acct.subtype,
                "balance": acct.balance,
                "balance_updated_at": acct.balance_updated_at,
            })
            if acct.subtype == "checking":
                starting_balance += acct.balance

    # Expand all entries into dated rows
    entries = db.query(CashflowEntry).all()
    rows = []
    for e in entries:
        for d in _expand_entry(e, today, end_date):
            rows.append({
                "id": e.id,
                "name": e.name,
                "date": d,
                "amount": e.amount,
                "notes": e.notes,
                "is_recurring": e.is_recurring,
                "recurrence": e.recurrence,
            })

    rows.sort(key=lambda x: (x["date"], x["id"]))

    running = starting_balance
    for row in rows:
        running += row["amount"]
        row["running_balance"] = round(running, 2)

    return {
        "starting_balance": round(starting_balance, 2),
        "balance_accounts": balance_accounts,
        "entries": rows,
    }


# ---------------------------------------------------------------------------
# Balance refresh (calls Plaid /accounts/balance/get)
# ---------------------------------------------------------------------------

@router.post("/balance/refresh")
def refresh_balances(db: Session = Depends(get_db)):
    items = db.query(PlaidItem).all()
    if not items:
        raise HTTPException(404, "No linked accounts.")

    client = _plaid_client()
    now = datetime.now(timezone.utc)
    updated = 0

    for item in items:
        try:
            resp = client.accounts_balance_get(
                AccountsBalanceGetRequest(access_token=item.access_token)
            )
            for acct_data in resp["accounts"]:
                acct = db.get(Account, acct_data["account_id"])
                if acct:
                    balances = acct_data.get("balances", {})
                    acct.balance = balances.get("current") if balances.get("current") is not None else balances.get("available")
                    acct.balance_updated_at = now
                    updated += 1
        except plaid.ApiException:
            continue

    db.commit()
    return {"updated": updated}
