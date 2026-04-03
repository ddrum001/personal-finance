from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from ..database import get_db
from ..models import BudgetCategory, CategoryKeyword, Transaction
from ..schemas import BudgetCategoryOut, CategoryCreate, KeywordOut, KeywordCreate, ApplyKeywordsResponse

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("/", response_model=list[BudgetCategoryOut])
def list_categories(db: Session = Depends(get_db)):
    return db.query(BudgetCategory).order_by(
        BudgetCategory.macro_category,
        BudgetCategory.category,
        BudgetCategory.sub_category,
    ).all()


@router.get("/hierarchy")
def get_hierarchy(db: Session = Depends(get_db)):
    """Returns categories + their keywords grouped as macro -> category -> [sub_categories]."""
    rows = db.query(BudgetCategory).order_by(
        BudgetCategory.macro_category,
        BudgetCategory.category,
        BudgetCategory.sub_category,
    ).all()
    keywords = db.query(CategoryKeyword).all()
    kw_map: dict[int, list[dict]] = {}
    for kw in keywords:
        kw_map.setdefault(kw.budget_category_id, []).append({"id": kw.id, "keyword": kw.keyword})

    result = {}
    for row in rows:
        macro = row.macro_category
        cat = row.category
        result.setdefault(macro, {}).setdefault(cat, []).append({
            "id": row.id,
            "sub_category": row.sub_category,
            "is_discretionary": row.is_discretionary,
            "is_recurring": row.is_recurring,
            "hide_from_reports": row.hide_from_reports,
            "keywords": kw_map.get(row.id, []),
        })
    return result


# ---------------------------------------------------------------------------
# Keywords
# ---------------------------------------------------------------------------

@router.get("/{category_id}/keywords", response_model=list[KeywordOut])
def list_keywords(category_id: int, db: Session = Depends(get_db)):
    if not db.get(BudgetCategory, category_id):
        raise HTTPException(404, "Category not found")
    return db.query(CategoryKeyword).filter(CategoryKeyword.budget_category_id == category_id).all()


@router.post("/{category_id}/keywords", response_model=KeywordOut, status_code=201)
def add_keyword(category_id: int, body: KeywordCreate, db: Session = Depends(get_db)):
    if not db.get(BudgetCategory, category_id):
        raise HTTPException(404, "Category not found")
    keyword = body.keyword.strip().lower()
    if not keyword:
        raise HTTPException(400, "Keyword cannot be empty")
    existing = db.query(CategoryKeyword).filter(
        CategoryKeyword.budget_category_id == category_id,
        CategoryKeyword.keyword == keyword,
    ).first()
    if existing:
        raise HTTPException(409, "Keyword already exists for this category")
    kw = CategoryKeyword(budget_category_id=category_id, keyword=keyword)
    db.add(kw)
    db.commit()
    db.refresh(kw)
    return kw


@router.delete("/keywords/{keyword_id}", status_code=204)
def delete_keyword(keyword_id: int, db: Session = Depends(get_db)):
    kw = db.get(CategoryKeyword, keyword_id)
    if not kw:
        raise HTTPException(404, "Keyword not found")
    db.delete(kw)
    db.commit()


# ---------------------------------------------------------------------------
# Apply keywords to unlabeled transactions
# ---------------------------------------------------------------------------

def apply_keywords_to_transactions(db: Session, transaction_ids: Optional[list] = None) -> dict:
    """
    Apply keyword rules to unlabeled transactions.

    If transaction_ids is given, only those transactions are considered.
    Otherwise all transactions without a budget_sub_category are scanned.
    Never overwrites an existing budget_sub_category.
    """
    keywords = db.query(CategoryKeyword).all()
    cat_map = {c.id: c for c in db.query(BudgetCategory).all()}

    rules = sorted(
        [(kw.keyword, cat_map[kw.budget_category_id].sub_category) for kw in keywords if kw.budget_category_id in cat_map],
        key=lambda r: len(r[0]),
        reverse=True,
    )

    q = db.query(Transaction).filter(Transaction.budget_sub_category == None)
    if transaction_ids is not None:
        q = q.filter(Transaction.transaction_id.in_(transaction_ids))
    unlabeled = q.all()

    labeled = 0
    skipped = 0
    for txn in unlabeled:
        search_text = " ".join(filter(None, [txn.name, txn.merchant_name])).lower()
        match = next((sub_cat for kw, sub_cat in rules if kw in search_text), None)
        if match:
            txn.budget_sub_category = match
            labeled += 1
        else:
            skipped += 1

    db.commit()
    return {"labeled": labeled, "skipped": skipped}


@router.post("/apply-keywords", response_model=ApplyKeywordsResponse)
def apply_keywords(db: Session = Depends(get_db)):
    """
    Scans all transactions without a budget_sub_category and applies the first
    matching keyword. Returns counts of labeled vs skipped.
    """
    result = apply_keywords_to_transactions(db)
    return ApplyKeywordsResponse(labeled=result["labeled"], skipped=result["skipped"])


@router.post("/", response_model=BudgetCategoryOut, status_code=201)
def create_category(body: CategoryCreate, db: Session = Depends(get_db)):
    sub = body.sub_category.strip()
    cat = body.category.strip()
    macro = body.macro_category.strip()
    if not sub or not cat or not macro:
        raise HTTPException(400, "sub_category, category, and macro_category are all required")

    if db.query(BudgetCategory).filter(BudgetCategory.sub_category == sub).first():
        raise HTTPException(409, f"Sub-category '{sub}' already exists")

    new_cat = BudgetCategory(
        sub_category=sub,
        category=cat,
        macro_category=macro,
        is_discretionary=body.is_discretionary,
        is_recurring=body.is_recurring,
    )
    db.add(new_cat)
    db.flush()  # populate new_cat.id before adding keywords

    seen = set()
    for kw in body.keywords:
        kw_clean = kw.strip().lower()
        if kw_clean and kw_clean not in seen:
            db.add(CategoryKeyword(budget_category_id=new_cat.id, keyword=kw_clean))
            seen.add(kw_clean)

    db.commit()
    db.refresh(new_cat)
    return new_cat


class FlagsBody(BaseModel):
    is_discretionary: bool
    is_recurring: bool


@router.patch("/{category_id}/flags", response_model=BudgetCategoryOut)
def update_flags(category_id: int, body: FlagsBody, db: Session = Depends(get_db)):
    cat = db.get(BudgetCategory, category_id)
    if not cat:
        raise HTTPException(404, "Category not found")
    cat.is_discretionary = body.is_discretionary
    cat.is_recurring = body.is_recurring
    db.commit()
    db.refresh(cat)
    return cat


class HideFromReportsBody(BaseModel):
    hide: bool


@router.patch("/{category_id}/hide-from-reports", response_model=BudgetCategoryOut)
def set_hide_from_reports(category_id: int, body: HideFromReportsBody, db: Session = Depends(get_db)):
    cat = db.get(BudgetCategory, category_id)
    if not cat:
        raise HTTPException(404, "Category not found")
    cat.hide_from_reports = body.hide
    db.commit()
    db.refresh(cat)
    return cat


class MacroHideBody(BaseModel):
    macro_category: str
    hide: bool


@router.patch("/macro-hide", response_model=dict)
def set_macro_hide_from_reports(body: MacroHideBody, db: Session = Depends(get_db)):
    rows = db.query(BudgetCategory).filter(BudgetCategory.macro_category == body.macro_category).all()
    if not rows:
        raise HTTPException(404, f"No categories found for macro: {body.macro_category}")
    for row in rows:
        row.hide_from_reports = body.hide
    db.commit()
    return {"updated": len(rows), "macro_category": body.macro_category, "hide": body.hide}
