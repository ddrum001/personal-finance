from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional


class LinkTokenResponse(BaseModel):
    link_token: str
    expiration: str


class ExchangeTokenRequest(BaseModel):
    public_token: str
    institution_name: Optional[str] = None


class ExchangeTokenResponse(BaseModel):
    item_id: str
    institution_name: Optional[str]


class AccountOut(BaseModel):
    account_id: str
    item_id: str
    name: str
    official_name: Optional[str]
    mask: Optional[str]
    type: Optional[str]
    subtype: Optional[str]

    model_config = {"from_attributes": True}


class BudgetCategoryOut(BaseModel):
    id: int
    sub_category: str
    category: str
    macro_category: str
    is_discretionary: bool
    is_recurring: bool
    hide_from_reports: bool = False

    model_config = {"from_attributes": True}


class SplitOut(BaseModel):
    id: int
    transaction_id: str
    amount: float
    category: str
    note: Optional[str]
    budget_sub_category: Optional[str] = None
    budget_category: Optional[str] = None
    budget_macro_category: Optional[str] = None

    model_config = {"from_attributes": True}


class TransactionOut(BaseModel):
    transaction_id: str
    account_id: str
    item_id: str
    name: str
    amount: float
    date: date
    category: Optional[str]
    custom_category: Optional[str]
    merchant_name: Optional[str]
    pending: bool
    splits: list[SplitOut] = []
    budget_sub_category: Optional[str] = None
    budget_category: Optional[str] = None
    budget_macro_category: Optional[str] = None
    is_discretionary: Optional[bool] = None
    is_recurring: Optional[bool] = None
    account_name: Optional[str] = None
    account_mask: Optional[str] = None
    account_type: Optional[str] = None
    account_subtype: Optional[str] = None
    institution_name: Optional[str] = None
    needs_review: bool = False

    model_config = {"from_attributes": True}


class CategoryCreate(BaseModel):
    sub_category: str
    category: str
    macro_category: str
    is_discretionary: bool = False
    is_recurring: bool = False
    keywords: list[str] = []


class KeywordOut(BaseModel):
    id: int
    budget_category_id: int
    keyword: str

    model_config = {"from_attributes": True}


class KeywordCreate(BaseModel):
    keyword: str


class ApplyKeywordsResponse(BaseModel):
    labeled: int
    skipped: int


class CategoryUpdate(BaseModel):
    custom_category: str


class SplitItem(BaseModel):
    amount: float
    category: str
    note: Optional[str] = None
    budget_sub_category: Optional[str] = None


class SplitRequest(BaseModel):
    splits: list[SplitItem]


class SyncResponse(BaseModel):
    added: int
    modified: int
    removed: int


class CashflowEntryCreate(BaseModel):
    name: str
    date: date
    amount: float
    notes: Optional[str] = None
    is_recurring: bool = False
    recurrence: Optional[str] = None       # monthly | biweekly | weekly | quarterly | yearly
    recurrence_end_date: Optional[date] = None


class CashflowEntryOut(BaseModel):
    id: int
    name: str
    date: date
    amount: float
    notes: Optional[str]
    is_recurring: bool
    recurrence: Optional[str]
    recurrence_end_date: Optional[date]

    model_config = {"from_attributes": True}
