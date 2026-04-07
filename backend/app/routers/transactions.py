from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import extract, func
from sqlalchemy.orm import Session, selectinload
from typing import Optional
from datetime import date

from pydantic import BaseModel
from ..database import get_db
from ..models import Transaction, TransactionSplit, BudgetCategory, Account, PlaidItem, MerchantSplitTemplate
from ..schemas import TransactionOut, CategoryUpdate, SplitRequest, SplitOut

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("/")
def list_transactions(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    category: Optional[str] = Query(None),
    budget_sub_category: Optional[str] = Query(None),
    account_id: Optional[str] = Query(None),
    needs_review: Optional[bool] = Query(None),
    needs_splits: Optional[bool] = Query(None),
    limit: int = Query(500, le=2000),
    offset: int = Query(0),
    db: Session = Depends(get_db),
):
    q = db.query(Transaction).options(selectinload(Transaction.splits))
    if start_date:
        q = q.filter(Transaction.date >= start_date)
    if end_date:
        q = q.filter(Transaction.date <= end_date)
    if category:
        q = q.filter(
            (Transaction.custom_category == category)
            | (Transaction.category == category)
        )
    if budget_sub_category:
        q = q.filter(Transaction.budget_sub_category == budget_sub_category)
    if account_id:
        q = q.filter(Transaction.account_id == account_id)
    excluded_ids = {a.account_id for a in db.query(Account).filter(Account.is_excluded == True).all()}
    if excluded_ids:
        q = q.filter(Transaction.account_id.notin_(excluded_ids))
    if needs_review is not None:
        q = q.filter(Transaction.needs_review == needs_review)
        if needs_review:
            q = q.filter(Transaction.pending == False)
    if needs_splits:
        # Return unsplit transactions whose merchant matches any template pattern
        patterns = [t.merchant_pattern for t in db.query(MerchantSplitTemplate).all()]
        if patterns:
            from sqlalchemy import func, or_
            already_split = {
                r[0] for r in db.query(TransactionSplit.transaction_id).distinct().all()
            }
            merchant_filter = or_(
                *[func.lower(Transaction.merchant_name).contains(p) for p in patterns]
            )
            q = q.filter(merchant_filter, Transaction.pending == False)
            if already_split:
                q = q.filter(Transaction.transaction_id.notin_(already_split))
        else:
            q = q.filter(False)  # no templates → empty result
    txns = q.order_by(Transaction.date.desc()).offset(offset).limit(limit).all()

    # bulk load supporting maps
    cat_map = {c.sub_category: c for c in db.query(BudgetCategory).all()}
    acct_map = {a.account_id: a for a in db.query(Account).all()}
    item_map = {i.item_id: i for i in db.query(PlaidItem).all()}

    result = []
    for t in txns:
        bc = cat_map.get(t.budget_sub_category)
        acct = acct_map.get(t.account_id)
        item = item_map.get(t.item_id)
        splits = []
        for s in t.splits:
            sbc = cat_map.get(s.budget_sub_category or s.category)
            splits.append({
                "id": s.id,
                "transaction_id": s.transaction_id,
                "amount": s.amount,
                "category": s.category,
                "note": s.note,
                "budget_sub_category": s.budget_sub_category or s.category,
                "budget_category": sbc.category if sbc else None,
                "budget_macro_category": sbc.macro_category if sbc else None,
            })
        result.append({
            "transaction_id": t.transaction_id,
            "account_id": t.account_id,
            "item_id": t.item_id,
            "name": t.name,
            "amount": t.amount,
            "date": t.date,
            "category": t.category,
            "custom_category": t.custom_category,
            "merchant_name": t.merchant_name,
            "pending": t.pending,
            "splits": splits,
            "budget_sub_category": t.budget_sub_category,
            "budget_category": bc.category if bc else None,
            "budget_macro_category": bc.macro_category if bc else None,
            "is_discretionary": bc.is_discretionary if bc else None,
            "is_recurring": bc.is_recurring if bc else None,
            "account_name": (acct.nickname or acct.official_name or acct.name) if acct else None,
            "account_mask": acct.mask if acct else None,
            "account_type": acct.type if acct else None,
            "account_subtype": acct.subtype if acct else None,
            "institution_name": t.institution_name or (item.institution_name if item else None),
            "needs_review": t.needs_review or False,
        })
    return result


@router.patch("/{transaction_id}/reviewed")
def mark_reviewed(transaction_id: str, db: Session = Depends(get_db)):
    t = db.get(Transaction, transaction_id)
    if not t:
        raise HTTPException(404, "Transaction not found")
    t.needs_review = False
    db.commit()
    return {"ok": True}


@router.patch("/{transaction_id}/reject-suggestion")
def reject_suggestion(transaction_id: str, db: Session = Depends(get_db)):
    """Clear a keyword suggestion (budget_sub_category) while keeping needs_review=True."""
    t = db.get(Transaction, transaction_id)
    if not t:
        raise HTTPException(404, "Transaction not found")
    t.budget_sub_category = None
    db.commit()
    return {"ok": True}


@router.patch("/{transaction_id}/flag-review")
def flag_for_review(transaction_id: str, db: Session = Depends(get_db)):
    t = db.get(Transaction, transaction_id)
    if not t:
        raise HTTPException(404, "Transaction not found")
    t.needs_review = True
    db.commit()
    return {"ok": True}


@router.post("/mark-reviewed-bulk")
def mark_reviewed_bulk(body: dict, db: Session = Depends(get_db)):
    ids = body.get("transaction_ids", [])
    db.query(Transaction).filter(Transaction.transaction_id.in_(ids)).update(
        {"needs_review": False}, synchronize_session=False
    )
    db.commit()
    return {"updated": len(ids)}


@router.post("/accept-suggestions")
def accept_suggestions(db: Session = Depends(get_db)):
    """Mark all keyword-suggested transactions (needs_review + has budget_sub_category) as reviewed."""
    result = db.query(Transaction).filter(
        Transaction.needs_review == True,
        Transaction.budget_sub_category.isnot(None),
    ).update({"needs_review": False}, synchronize_session=False)
    db.commit()
    return {"accepted": result}


@router.patch("/{transaction_id}/category", response_model=TransactionOut)
def update_category(
    transaction_id: str,
    body: CategoryUpdate,
    db: Session = Depends(get_db),
):
    txn = db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, "Transaction not found")
    txn.custom_category = body.custom_category
    db.commit()
    db.refresh(txn)
    return txn


class BudgetCategoryUpdate(BaseModel):
    budget_sub_category: str


@router.patch("/{transaction_id}/budget-category")
def update_budget_category(
    transaction_id: str,
    body: BudgetCategoryUpdate,
    db: Session = Depends(get_db),
):
    txn = db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, "Transaction not found")
    # validate the sub_category exists
    bc = db.query(BudgetCategory).filter(BudgetCategory.sub_category == body.budget_sub_category).first()
    if not bc:
        raise HTTPException(400, f"Unknown sub-category: {body.budget_sub_category}")
    txn.budget_sub_category = body.budget_sub_category
    txn.custom_category = None  # clear legacy field
    txn.needs_review = False
    db.commit()
    db.refresh(txn)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Splits
# ---------------------------------------------------------------------------

@router.get("/{transaction_id}/splits", response_model=list[SplitOut])
def get_splits(transaction_id: str, db: Session = Depends(get_db)):
    if not db.get(Transaction, transaction_id):
        raise HTTPException(404, "Transaction not found")
    return db.query(TransactionSplit).filter(TransactionSplit.transaction_id == transaction_id).all()


@router.put("/{transaction_id}/splits", response_model=list[SplitOut])
def save_splits(
    transaction_id: str,
    body: SplitRequest,
    db: Session = Depends(get_db),
):
    txn = db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, "Transaction not found")

    if not body.splits:
        raise HTTPException(400, "Provide at least one split")

    total = round(sum(s.amount for s in body.splits), 2)
    if abs(total - round(abs(txn.amount), 2)) > 0.01:
        raise HTTPException(
            400,
            f"Split amounts ({total}) must sum to the transaction amount ({abs(txn.amount):.2f})",
        )

    # Replace existing splits
    db.query(TransactionSplit).filter(TransactionSplit.transaction_id == transaction_id).delete()
    new_splits = [
        TransactionSplit(
            transaction_id=transaction_id,
            amount=s.amount,
            category=s.category,
            note=s.note,
            budget_sub_category=s.budget_sub_category or s.category,
        )
        for s in body.splits
    ]
    db.add_all(new_splits)
    db.commit()
    return db.query(TransactionSplit).filter(TransactionSplit.transaction_id == transaction_id).all()


@router.delete("/{transaction_id}/splits", status_code=204)
def delete_splits(transaction_id: str, db: Session = Depends(get_db)):
    db.query(TransactionSplit).filter(TransactionSplit.transaction_id == transaction_id).delete()
    db.commit()


# ---------------------------------------------------------------------------
# Summaries — splits take precedence over the parent transaction's category
# ---------------------------------------------------------------------------

@router.get("/summary/by-category")
def summary_by_category(
    start_date: date = Query(...),
    end_date: date = Query(...),
    group_by: str = Query("category", regex="^(sub_category|category|macro_category)$"),
    filter_macro: Optional[str] = Query(None),
    filter_category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Total spending grouped by category for a date range.
    Splits take precedence over the parent transaction's category.
    Supports group_by: sub_category | category | macro_category
    Optional drill-down filters: filter_macro, filter_category
    """
    cat_map = {c.sub_category: c for c in db.query(BudgetCategory).all()}

    def get_group_key(budget_sub_cat, fallback_cat):
        bc = cat_map.get(budget_sub_cat) if budget_sub_cat else None
        if bc:
            if bc.hide_from_reports:
                return None
            if filter_macro and bc.macro_category != filter_macro:
                return None
            if filter_category and bc.category != filter_category:
                return None
            if group_by == "sub_category":
                return bc.sub_category
            elif group_by == "macro_category":
                return bc.macro_category
            else:
                return bc.category
        else:
            if filter_macro or filter_category:
                return None
        return "Uncategorized"

    excluded_ids = {a.account_id for a in db.query(Account).filter(Account.is_excluded == True).all()}
    date_filter = [
        Transaction.date >= start_date,
        Transaction.date <= end_date,
        Transaction.pending == False,
        Transaction.amount > 0,
        Transaction.account_id.notin_(excluded_ids) if excluded_ids else True,
    ]

    split_txn_ids = {
        row[0]
        for row in db.query(TransactionSplit.transaction_id)
        .join(Transaction, Transaction.transaction_id == TransactionSplit.transaction_id)
        .filter(*date_filter)
        .all()
    }

    unsplit_query = (
        db.query(
            Transaction.budget_sub_category,
            func.coalesce(Transaction.custom_category, Transaction.category).label("fallback_cat"),
            Transaction.amount,
        )
        .filter(
            *date_filter,
            Transaction.transaction_id.notin_(split_txn_ids) if split_txn_ids else True,
        )
        .all()
    )

    split_query = (
        db.query(
            TransactionSplit.budget_sub_category,
            TransactionSplit.category.label("fallback_cat"),
            TransactionSplit.amount,
        )
        .join(Transaction, Transaction.transaction_id == TransactionSplit.transaction_id)
        .filter(*date_filter)
        .all()
    ) if split_txn_ids else []

    totals: dict[str, dict] = {}
    for r in list(unsplit_query) + list(split_query):
        key = get_group_key(r.budget_sub_category, r.fallback_cat)
        if key is None:
            continue
        if key in totals:
            totals[key]["total"] += r.amount
            totals[key]["count"] += 1
        else:
            totals[key] = {"category": key, "total": r.amount, "count": 1}

    return sorted(
        [{"category": k, "total": round(v["total"], 2), "count": v["count"]} for k, v in totals.items()],
        key=lambda x: x["total"],
        reverse=True,
    )


@router.get("/summary/monthly-trend")
def monthly_trend(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    months: int = Query(6, ge=1, le=24),
    db: Session = Depends(get_db),
):
    """Total spending per month. When start_date/end_date are given they take priority over `months`."""
    excluded_ids = {a.account_id for a in db.query(Account).filter(Account.is_excluded == True).all()}
    q = (
        db.query(
            extract("year", Transaction.date).label("year"),
            extract("month", Transaction.date).label("month"),
            func.sum(Transaction.amount).label("total"),
        )
        .filter(Transaction.pending == False, Transaction.amount > 0)
    )
    if excluded_ids:
        q = q.filter(Transaction.account_id.notin_(excluded_ids))
    if start_date and end_date:
        q = q.filter(Transaction.date >= start_date, Transaction.date <= end_date)
    q = q.group_by("year", "month").order_by("year", "month")
    if not (start_date and end_date):
        q = q.limit(months)
    rows = q.all()
    return [
        {"year": int(r.year), "month": int(r.month), "total": round(r.total, 2)}
        for r in rows
    ]
