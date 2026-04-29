import os

import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .database import engine, SessionLocal
from .models import Base
from .routers import auth, cashflow, categories, credit_cards, gmail, import_csv, plaid, templates, transactions
from .seed_categories import seed_budget_categories

load_dotenv()

# Create all tables on startup (new tables only)
Base.metadata.create_all(bind=engine)

# Incremental column migrations for existing tables
_MIGRATIONS = [
    "ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS sync_cursor VARCHAR",
    "ALTER TABLE budget_categories ADD COLUMN IF NOT EXISTS hide_from_reports BOOLEAN DEFAULT FALSE",
    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance FLOAT",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance_updated_at TIMESTAMP WITH TIME ZONE",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS nickname VARCHAR",
    "ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP WITH TIME ZONE",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_excluded BOOLEAN DEFAULT FALSE",
    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS institution_name VARCHAR",
    "ALTER TABLE amazon_orders ADD COLUMN IF NOT EXISTS subtotals TEXT",
    "ALTER TABLE amazon_orders ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT FALSE",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS credit_limit FLOAT",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS statement_balance FLOAT",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS statement_due_date DATE",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS minimum_payment FLOAT",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_statement_date DATE",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS liabilities_updated_at TIMESTAMP WITH TIME ZONE",
    "ALTER TABLE cashflow_entries ADD COLUMN IF NOT EXISTS account_id VARCHAR REFERENCES accounts(account_id) ON DELETE SET NULL",
    "CREATE TABLE IF NOT EXISTS promo_balances (id SERIAL PRIMARY KEY, account_id VARCHAR NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE, description VARCHAR NOT NULL, current_amount FLOAT NOT NULL, promo_end_date DATE NOT NULL, notes VARCHAR, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW())",
    "ALTER TABLE promo_balances ADD COLUMN IF NOT EXISTS promo_type VARCHAR NOT NULL DEFAULT 'balance_transfer'",
    "ALTER TABLE cashflow_entries ADD COLUMN IF NOT EXISTS is_autopay BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS autopay_type VARCHAR",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS autopay_fixed_amount FLOAT",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS autopay_timing VARCHAR",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS autopay_timing_value INTEGER",
    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes TEXT",
    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS original_description TEXT",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS short_name VARCHAR",
]
_SEEDS = [
    # Only hide true transfer/internal categories — NOT rewards or fees
    "UPDATE budget_categories SET hide_from_reports = TRUE WHERE sub_category IN ('Transfer Payment', 'ATM Deposit', 'Overdraft Protection')",
    "UPDATE budget_categories SET hide_from_reports = FALSE WHERE sub_category IN ('Credit Card Rewards', 'Credit Card Fees')",
    "UPDATE transactions SET needs_review = TRUE WHERE budget_sub_category IS NULL",
    # Backfill institution_name from plaid_items for existing transactions
    "UPDATE transactions SET institution_name = (SELECT institution_name FROM plaid_items WHERE plaid_items.item_id = transactions.item_id) WHERE institution_name IS NULL",
    "UPDATE amazon_orders SET dismissed = FALSE WHERE dismissed IS NULL",
]
with engine.connect() as _conn:
    for _sql in _MIGRATIONS:
        _conn.execute(text(_sql))
        _conn.commit()
    for _sql in _SEEDS:
        _conn.execute(text(_sql))
    _conn.commit()

# Seed budget categories
with SessionLocal() as db:
    seed_budget_categories(db)

app = FastAPI(title="Personal Finance API", version="0.1.0")

_extra_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"] + _extra_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_SESSION_SECRET = os.getenv("SESSION_SECRET", "dev-secret-change-me")

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    # Auth endpoints and health check are public
    if path.startswith("/api/auth") or path == "/health" or path == "/api/gmail/callback":
        return await call_next(request)
    token = request.cookies.get("session")
    if not token:
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    try:
        jwt.decode(token, _SESSION_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return JSONResponse({"detail": "Invalid session"}, status_code=401)
    return await call_next(request)

app.include_router(auth.router, prefix="/api")
app.include_router(gmail.router, prefix="/api")
app.include_router(plaid.router, prefix="/api")
app.include_router(transactions.router, prefix="/api")
app.include_router(categories.router, prefix="/api")
app.include_router(import_csv.router, prefix="/api")
app.include_router(templates.router, prefix="/api")
app.include_router(cashflow.router, prefix="/api")
app.include_router(credit_cards.router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
