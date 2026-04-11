import os
from datetime import date, datetime, timezone, timedelta
from typing import Optional
import calendar

import plaid
from fastapi import APIRouter, Depends, HTTPException, Query
from plaid.api import plaid_api
from plaid.model.liabilities_get_request import LiabilitiesGetRequest
from plaid.model.accounts_balance_get_request import AccountsBalanceGetRequest
from dotenv import load_dotenv
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..models import Account, CashflowEntry, PlaidItem, PromoBalance
from ..schemas import PromoBalanceCreate, PromoBalanceOut, CashflowEntryOut

load_dotenv()

router = APIRouter(prefix="/credit-cards", tags=["credit-cards"])


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


def _add_months(d: date, months: int) -> date:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return d.replace(year=year, month=month, day=day)


# ---------------------------------------------------------------------------
# List credit cards
# ---------------------------------------------------------------------------

@router.get("")
def list_credit_cards(db: Session = Depends(get_db)):
    accounts = (
        db.query(Account)
        .filter(Account.type == "credit", Account.is_excluded == False)
        .all()
    )
    result = []
    for acct in accounts:
        promos = (
            db.query(PromoBalance)
            .filter(PromoBalance.account_id == acct.account_id)
            .order_by(PromoBalance.promo_end_date)
            .all()
        )
        today = date.today()
        due = acct.statement_due_date
        has_balance = acct.statement_balance is not None
        paid_off = acct.statement_balance is not None and acct.statement_balance == 0
        if paid_off:
            status = "paid"
        elif due is None and not has_balance:
            status = "unknown"
        elif due is None:
            status = "no_due_date"  # has balance but Plaid didn't return a due date
        elif due < today:
            status = "overdue"
        elif (due - today).days <= 7:
            status = "due_soon"
        else:
            status = "upcoming"

        result.append({
            "account_id": acct.account_id,
            "name": acct.nickname or acct.name,
            "mask": acct.mask,
            "balance": acct.balance,
            "credit_limit": acct.credit_limit,
            "statement_balance": acct.statement_balance,
            "statement_due_date": acct.statement_due_date,
            "minimum_payment": acct.minimum_payment,
            "last_statement_date": acct.last_statement_date,
            "liabilities_updated_at": acct.liabilities_updated_at,
            "status": status,
            "promos": [
                {
                    "id": p.id,
                    "description": p.description,
                    "current_amount": p.current_amount,
                    "promo_end_date": p.promo_end_date,
                    "notes": p.notes,
                    "days_remaining": (p.promo_end_date - today).days,
                }
                for p in promos
            ],
        })
    return result


# ---------------------------------------------------------------------------
# Refresh liabilities from Plaid
# ---------------------------------------------------------------------------

def _refresh_item_liabilities(item: PlaidItem, client, db: Session, now) -> tuple[int, list]:
    """Refresh liabilities + balances for a single Plaid item. Returns (updated, errors)."""
    updated = 0
    errors = []

    try:
        resp = client.liabilities_get(
            LiabilitiesGetRequest(access_token=item.access_token)
        )
        credit_list = resp["liabilities"]["credit"] or []
        for cc in credit_list:
            acct = db.get(Account, cc["account_id"])
            if not acct:
                continue
            acct.statement_balance = cc["last_statement_balance"]
            acct.statement_due_date = cc["next_payment_due_date"]
            acct.minimum_payment = cc["minimum_payment_amount"]
            acct.last_statement_date = cc["last_statement_issue_date"]
            acct.liabilities_updated_at = now
            updated += 1
    except plaid.ApiException as e:
        errors.append(f"Liabilities: {e.body}")
    except Exception as e:
        errors.append(f"Liabilities: {str(e)}")

    try:
        resp = client.accounts_balance_get(
            AccountsBalanceGetRequest(access_token=item.access_token)
        )
        for acct_data in resp["accounts"]:
            if str(acct_data["type"]) == "credit":
                acct = db.get(Account, acct_data["account_id"])
                if acct:
                    balances = acct_data["balances"]
                    acct.balance = balances["current"]
                    acct.credit_limit = balances["limit"]
    except plaid.ApiException as e:
        errors.append(f"Balances: {e.body}")
    except Exception as e:
        errors.append(f"Balances: {str(e)}")

    return updated, errors


@router.post("/{account_id}/liabilities/refresh")
def refresh_card_liabilities(account_id: str, db: Session = Depends(get_db)):
    """Refresh liabilities for a single card's Plaid item."""
    acct = db.get(Account, account_id)
    if not acct:
        raise HTTPException(404, "Account not found")
    item = db.get(PlaidItem, acct.item_id)
    if not item:
        raise HTTPException(404, "Plaid item not found")
    client = _plaid_client()
    now = datetime.now(timezone.utc)
    updated, errors = _refresh_item_liabilities(item, client, db, now)
    db.commit()
    return {"updated": updated, "errors": errors}


@router.post("/liabilities/refresh")
def refresh_liabilities(db: Session = Depends(get_db)):
    items = db.query(PlaidItem).all()
    if not items:
        raise HTTPException(404, "No linked accounts.")
    client = _plaid_client()
    now = datetime.now(timezone.utc)
    updated = 0
    errors = []
    for item in items:
        u, e = _refresh_item_liabilities(item, client, db, now)
        updated += u
        errors += [f"({item.item_id[:8]}…) {err}" for err in e]
    db.commit()
    return {"updated": updated, "errors": errors}


# ---------------------------------------------------------------------------
# Schedule a statement payment into cashflow
# ---------------------------------------------------------------------------

class SchedulePaymentRequest(BaseModel):
    action: str = "check"   # "check" | "add" | "replace"
    replace_id: Optional[int] = None


@router.post("/{account_id}/schedule-payment")
def schedule_payment(
    account_id: str,
    body: SchedulePaymentRequest,
    db: Session = Depends(get_db),
):
    acct = db.get(Account, account_id)
    if not acct:
        raise HTTPException(404, "Account not found")
    if not acct.statement_balance or not acct.statement_due_date:
        raise HTTPException(400, "No statement balance or due date on file — refresh liabilities first")

    name = f"{acct.nickname or acct.name} payment"
    amount = -abs(acct.statement_balance)   # always negative (expense)
    due_date = acct.statement_due_date

    # Look for an existing cashflow entry linked to this card
    existing = (
        db.query(CashflowEntry)
        .filter(
            CashflowEntry.account_id == account_id,
            CashflowEntry.is_recurring == False,
        )
        .order_by(CashflowEntry.date.desc())
        .first()
    )

    if body.action == "check":
        return {
            "proposed": {"name": name, "amount": amount, "date": due_date},
            "existing": {
                "id": existing.id,
                "name": existing.name,
                "amount": existing.amount,
                "date": existing.date,
            } if existing else None,
        }

    if body.action == "replace":
        if body.replace_id:
            old = db.get(CashflowEntry, body.replace_id)
            if old:
                db.delete(old)

    entry = CashflowEntry(
        name=name,
        date=due_date,
        amount=amount,
        notes=None,
        is_recurring=False,
        recurrence=None,
        recurrence_end_date=None,
        account_id=account_id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"created": CashflowEntryOut.model_validate(entry)}


# ---------------------------------------------------------------------------
# Promo balance CRUD
# ---------------------------------------------------------------------------

@router.get("/promos", response_model=list[PromoBalanceOut])
def list_promos(db: Session = Depends(get_db)):
    return (
        db.query(PromoBalance)
        .order_by(PromoBalance.promo_end_date)
        .all()
    )


@router.post("/promos", response_model=PromoBalanceOut, status_code=201)
def create_promo(body: PromoBalanceCreate, db: Session = Depends(get_db)):
    promo = PromoBalance(**body.model_dump())
    db.add(promo)
    db.commit()
    db.refresh(promo)
    return promo


@router.put("/promos/{promo_id}", response_model=PromoBalanceOut)
def update_promo(promo_id: int, body: PromoBalanceCreate, db: Session = Depends(get_db)):
    promo = db.get(PromoBalance, promo_id)
    if not promo:
        raise HTTPException(404, "Promo balance not found")
    for k, v in body.model_dump().items():
        setattr(promo, k, v)
    db.commit()
    db.refresh(promo)
    return promo


@router.delete("/promos/{promo_id}", status_code=204)
def delete_promo(promo_id: int, db: Session = Depends(get_db)):
    promo = db.get(PromoBalance, promo_id)
    if not promo:
        raise HTTPException(404, "Promo balance not found")
    db.delete(promo)
    db.commit()


# ---------------------------------------------------------------------------
# Plan monthly payments for a promo balance
# ---------------------------------------------------------------------------

class PlanPaymentsRequest(BaseModel):
    num_payments: int
    start_date: date


@router.post("/promos/{promo_id}/plan-payments")
def plan_promo_payments(
    promo_id: int,
    body: PlanPaymentsRequest,
    db: Session = Depends(get_db),
):
    promo = db.get(PromoBalance, promo_id)
    if not promo:
        raise HTTPException(404, "Promo balance not found")
    if body.num_payments < 1:
        raise HTTPException(400, "num_payments must be at least 1")

    acct = db.get(Account, promo.account_id)
    card_name = (acct.nickname or acct.name) if acct else "Card"
    entry_name = f"{card_name} — {promo.description}"

    payment = round(promo.current_amount / body.num_payments, 2)
    remainder = round(promo.current_amount - payment * (body.num_payments - 1), 2)

    created = []
    for i in range(body.num_payments):
        amt = remainder if i == body.num_payments - 1 else payment
        entry_date = _add_months(body.start_date, i)
        entry = CashflowEntry(
            name=entry_name,
            date=entry_date,
            amount=-abs(amt),
            notes=f"Promo payoff — due {promo.promo_end_date}",
            is_recurring=False,
            account_id=promo.account_id,
        )
        db.add(entry)
        created.append({"date": entry_date, "amount": -abs(amt)})

    db.commit()
    return {"created": len(created), "payments": created}
