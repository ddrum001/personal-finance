"""
Merchant split templates — reusable percentage-based split patterns.

Each template belongs to a merchant_pattern (case-insensitive substring match
against transaction.merchant_name) and stores a JSON list of split rows:
  [{"note": "Household", "budget_sub_category": "Household Supplies", "percent": 60}, ...]

Percents must sum to 100.
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from ..database import get_db
from ..models import MerchantSplitTemplate

router = APIRouter(prefix="/templates", tags=["templates"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class TemplateSplitRow(BaseModel):
    note: Optional[str] = None
    budget_sub_category: str
    percent: float  # 0–100, all rows must sum to 100


class TemplateCreate(BaseModel):
    merchant_pattern: str
    name: str
    splits: list[TemplateSplitRow]


class TemplateOut(BaseModel):
    id: int
    merchant_pattern: str
    name: str
    splits: list[TemplateSplitRow]

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _validate_splits(splits: list[TemplateSplitRow]):
    if not splits:
        raise HTTPException(400, "Template must have at least one split row")
    total = round(sum(s.percent for s in splits), 2)
    if abs(total - 100) > 0.01:
        raise HTTPException(400, f"Split percents must sum to 100 (got {total})")


def _serialize(template: MerchantSplitTemplate) -> dict:
    return {
        "id": template.id,
        "merchant_pattern": template.merchant_pattern,
        "name": template.name,
        "splits": json.loads(template.splits),
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/")
def list_templates(db: Session = Depends(get_db)):
    return [_serialize(t) for t in db.query(MerchantSplitTemplate).order_by(MerchantSplitTemplate.merchant_pattern, MerchantSplitTemplate.name).all()]


@router.post("/", status_code=201)
def create_template(body: TemplateCreate, db: Session = Depends(get_db)):
    _validate_splits(body.splits)
    tmpl = MerchantSplitTemplate(
        merchant_pattern=body.merchant_pattern.strip().lower(),
        name=body.name.strip(),
        splits=json.dumps([s.model_dump() for s in body.splits]),
    )
    db.add(tmpl)
    db.commit()
    db.refresh(tmpl)
    return _serialize(tmpl)


@router.put("/{template_id}")
def update_template(template_id: int, body: TemplateCreate, db: Session = Depends(get_db)):
    tmpl = db.get(MerchantSplitTemplate, template_id)
    if not tmpl:
        raise HTTPException(404, "Template not found")
    _validate_splits(body.splits)
    tmpl.merchant_pattern = body.merchant_pattern.strip().lower()
    tmpl.name = body.name.strip()
    tmpl.splits = json.dumps([s.model_dump() for s in body.splits])
    db.commit()
    return _serialize(tmpl)


@router.delete("/{template_id}", status_code=204)
def delete_template(template_id: int, db: Session = Depends(get_db)):
    tmpl = db.get(MerchantSplitTemplate, template_id)
    if not tmpl:
        raise HTTPException(404, "Template not found")
    db.delete(tmpl)
    db.commit()
