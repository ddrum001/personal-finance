from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import extract, func
from sqlalchemy.orm import Session, selectinload
from typing import Optional, List
from datetime import date

from pydantic import BaseModel
import json

from ..database import get_db
from ..models import AmazonOrder, Transaction, TransactionSplit, BudgetCategory, Account, PlaidItem, MerchantSplitTemplate, DismissedDuplicateGroup
from ..schemas import TransactionOut, CategoryUpdate, SplitRequest, SplitOut

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("/")
def list_transactions(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    category: Optional[str] = Query(None),
    budget_sub_category: Optional[str] = Query(None),
    budget_sub_categories: List[str] = Query(default=[]),
    budget_category: Optional[str] = Query(None),
    budget_macro_category: Optional[str] = Query(None),
    account_id: Optional[str] = Query(None),
    needs_review: Optional[bool] = Query(None),
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
    if budget_sub_categories:
        q = q.filter(Transaction.budget_sub_category.in_(budget_sub_categories))
    elif budget_sub_category:
        q = q.filter(Transaction.budget_sub_category == budget_sub_category)
    if budget_category or budget_macro_category:
        cat_ids = db.query(BudgetCategory.sub_category)
        if budget_category:
            cat_ids = cat_ids.filter(BudgetCategory.category == budget_category)
        if budget_macro_category:
            cat_ids = cat_ids.filter(BudgetCategory.macro_category == budget_macro_category)
        sub_cats = [r[0] for r in cat_ids.all()]
        q = q.filter(Transaction.budget_sub_category.in_(sub_cats))
    if account_id:
        q = q.filter(Transaction.account_id == account_id)
    excluded_ids = {a.account_id for a in db.query(Account).filter(Account.is_excluded == True).all()}
    if excluded_ids:
        q = q.filter(Transaction.account_id.notin_(excluded_ids))
    if needs_review is not None:
        q = q.filter(Transaction.needs_review == needs_review)
        if needs_review:
            q = q.filter(Transaction.pending == False)
    txns = q.order_by(Transaction.date.desc()).offset(offset).limit(limit).all()

    # bulk load supporting maps
    cat_map = {c.sub_category: c for c in db.query(BudgetCategory).all()}
    acct_map = {a.account_id: a for a in db.query(Account).all()}
    item_map = {i.item_id: i for i in db.query(PlaidItem).all()}
    txn_ids = [t.transaction_id for t in txns]
    amazon_map = {
        o.transaction_id: o
        for o in db.query(AmazonOrder).filter(AmazonOrder.transaction_id.in_(txn_ids)).all()
    } if txn_ids else {}

    result = []
    for t in txns:
        bc = cat_map.get(t.budget_sub_category)
        acct = acct_map.get(t.account_id)
        item = item_map.get(t.item_id)
        ao = amazon_map.get(t.transaction_id)
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
            "amazon_order": {
                "id": ao.id,
                "order_id": ao.order_id,
                "order_date": ao.order_date.isoformat() if ao.order_date else None,
                "order_total": ao.order_total,
                "subtotals": json.loads(ao.subtotals) if ao.subtotals else {},
                "items": json.loads(ao.items) if ao.items else [],
                "gmail_message_id": ao.gmail_message_id,
            } if ao else None,
        })
    return result


@router.get("/duplicates")
def find_duplicates(db: Session = Depends(get_db), days: int = 3):
    """Return groups of transactions that share the same amount and name within a date window."""
    from datetime import timedelta
    from itertools import groupby

    all_txns = (
        db.query(Transaction)
        .order_by(Transaction.amount, Transaction.name, Transaction.date)
        .all()
    )
    if not all_txns:
        return []

    cat_map = {c.sub_category: c for c in db.query(BudgetCategory).all()}
    acct_map = {a.account_id: a for a in db.query(Account).all()}

    def make_row(t):
        acct = acct_map.get(t.account_id)
        bc = cat_map.get(t.budget_sub_category)
        return {
            "transaction_id": t.transaction_id,
            "date": t.date.isoformat() if t.date else None,
            "account_id": t.account_id,
            "account_name": (acct.nickname or acct.name) if acct else None,
            "account_mask": acct.mask if acct else None,
            "institution_name": t.institution_name,
            "budget_sub_category": t.budget_sub_category,
            "budget_category": bc.category if bc else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "pending": t.pending,
        }

    dismissed = {
        frozenset(json.loads(g.transaction_ids))
        for g in db.query(DismissedDuplicateGroup).all()
    }

    groups = []
    seen = set()

    for (amt, name), txns_iter in groupby(all_txns, key=lambda t: (t.amount, t.name)):
        txns = list(txns_iter)  # already sorted by date within this amount+name bucket
        for i, anchor in enumerate(txns):
            if anchor.transaction_id in seen:
                continue
            cluster = [anchor]
            cutoff = anchor.date + timedelta(days=days)
            for j in range(i + 1, len(txns)):
                candidate = txns[j]
                if candidate.date > cutoff:
                    break
                if candidate.transaction_id not in seen:
                    cluster.append(candidate)
            if len(cluster) > 1:
                cluster_key = frozenset(t.transaction_id for t in cluster)
                if cluster_key in dismissed:
                    for t in cluster:
                        seen.add(t.transaction_id)
                    continue
                for t in cluster:
                    seen.add(t.transaction_id)
                groups.append({
                    "date": anchor.date,
                    "amount": amt,
                    "name": name,
                    "copies": len(cluster),
                    "transactions": [make_row(t) for t in cluster],
                })

    groups.sort(key=lambda g: g["date"], reverse=True)
    return groups


class DismissDuplicatesRequest(BaseModel):
    transaction_ids: list[str]


@router.post("/duplicates/dismiss")
def dismiss_duplicate_group(body: DismissDuplicatesRequest, db: Session = Depends(get_db)):
    """Mark a group of transactions as not-duplicates so they're hidden from future checks."""
    group = DismissedDuplicateGroup(transaction_ids=json.dumps(sorted(body.transaction_ids)))
    db.add(group)
    db.commit()
    return {"ok": True}


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


@router.delete("/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: str, db: Session = Depends(get_db)):
    t = db.get(Transaction, transaction_id)
    if not t:
        raise HTTPException(404, "Transaction not found")
    db.delete(t)
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
