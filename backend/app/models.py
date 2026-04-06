from sqlalchemy import Column, String, Float, Date, DateTime, Boolean, Integer, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base


class BudgetCategory(Base):
    __tablename__ = "budget_categories"
    id = Column(Integer, primary_key=True, autoincrement=True)
    sub_category = Column(String, unique=True, nullable=False, index=True)
    category = Column(String, nullable=False, index=True)
    macro_category = Column(String, nullable=False, index=True)
    is_discretionary = Column(Boolean, default=False)
    is_recurring = Column(Boolean, default=False)
    hide_from_reports = Column(Boolean, default=False)


class PlaidItem(Base):
    """Stores a linked Plaid Item (bank connection)."""
    __tablename__ = "plaid_items"

    item_id = Column(String, primary_key=True)
    access_token = Column(String, nullable=False)
    institution_name = Column(String, nullable=True)
    sync_cursor = Column(String, nullable=True)  # persisted Plaid transactions/sync cursor
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Account(Base):
    """Stores individual Plaid accounts (credit cards, checking, etc.) within an Item."""
    __tablename__ = "accounts"

    account_id = Column(String, primary_key=True)
    item_id = Column(String, ForeignKey("plaid_items.item_id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    official_name = Column(String, nullable=True)
    mask = Column(String, nullable=True)       # last-4 digits
    type = Column(String, nullable=True)       # depository | credit | loan | investment
    subtype = Column(String, nullable=True)    # checking | savings | credit card | etc.
    nickname = Column(String, nullable=True)   # user-defined display name
    is_excluded = Column(Boolean, default=False, nullable=False)  # skip sync (e.g. joint account on second login)
    balance = Column(Float, nullable=True)
    balance_updated_at = Column(DateTime(timezone=True), nullable=True)


class Transaction(Base):
    __tablename__ = "transactions"

    transaction_id = Column(String, primary_key=True)
    account_id = Column(String, nullable=False)
    item_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    amount = Column(Float, nullable=False)          # positive = debit, negative = credit
    date = Column(Date, nullable=False)
    category = Column(String, nullable=True)        # Plaid-assigned category
    custom_category = Column(String, nullable=True) # user override
    merchant_name = Column(String, nullable=True)
    pending = Column(Boolean, default=False)
    needs_review = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    budget_sub_category = Column(String, nullable=True)
    splits = relationship("TransactionSplit", back_populates="transaction", cascade="all, delete-orphan")


class CashflowEntry(Base):
    """User-defined future cashflow events (income or expenses) for projection."""
    __tablename__ = "cashflow_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    date = Column(Date, nullable=False)
    amount = Column(Float, nullable=False)          # positive = income, negative = expense
    notes = Column(String, nullable=True)
    is_recurring = Column(Boolean, default=False)
    recurrence = Column(String, nullable=True)      # monthly | biweekly | weekly | quarterly | yearly
    recurrence_end_date = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CategoryKeyword(Base):
    """Keywords used to auto-label transactions with a budget sub-category."""
    __tablename__ = "category_keywords"

    id = Column(Integer, primary_key=True, autoincrement=True)
    budget_category_id = Column(Integer, ForeignKey("budget_categories.id", ondelete="CASCADE"), nullable=False)
    keyword = Column(String, nullable=False)


class MerchantSplitTemplate(Base):
    """Reusable percentage-based split templates keyed to a merchant name pattern."""
    __tablename__ = "merchant_split_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    merchant_pattern = Column(String, nullable=False)  # case-insensitive contains match, e.g. "amazon"
    name = Column(String, nullable=False)              # display name e.g. "Household + Personal"
    splits = Column(Text, nullable=False)              # JSON: [{"note": "...", "budget_sub_category": "...", "percent": 60}]


class TransactionSplit(Base):
    """User-defined splits of a transaction across multiple categories."""
    __tablename__ = "transaction_splits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    transaction_id = Column(String, ForeignKey("transactions.transaction_id", ondelete="CASCADE"), nullable=False)
    amount = Column(Float, nullable=False)
    category = Column(String, nullable=False)
    note = Column(String, nullable=True)
    budget_sub_category = Column(String, nullable=True)
    transaction = relationship("Transaction", back_populates="splits")
