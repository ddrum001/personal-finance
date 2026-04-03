import os
import calendar
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import plaid
from fastapi import APIRouter, Depends, HTTPException, Query
from plaid.api import plaid_api
from plaid.model.accounts_balance_get_request import AccountsBalanceGetRequest
from dotenv import load_dotenv
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Account, CashflowEntry, PlaidItem
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

@router.get("/projection")
def get_projection(
    months: int = Query(6, ge=1, le=24),
    db: Session = Depends(get_db),
):
    today = date.today()
    end_date = _add_months(today, months)

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
