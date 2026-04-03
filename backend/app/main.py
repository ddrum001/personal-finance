import os

import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .database import engine, SessionLocal
from .models import Base
from .routers import auth, cashflow, categories, import_csv, plaid, templates, transactions
from .seed_categories import seed_budget_categories

load_dotenv()

# Create all tables on startup (new tables only)
Base.metadata.create_all(bind=engine)

# Incremental column migrations for existing tables
# Uses IF NOT EXISTS (supported by both SQLite 3.37+ and PostgreSQL 9.6+)
_MIGRATIONS = [
    "ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS sync_cursor VARCHAR",
    "ALTER TABLE budget_categories ADD COLUMN IF NOT EXISTS hide_from_reports BOOLEAN DEFAULT FALSE",
    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance FLOAT",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance_updated_at TIMESTAMP WITH TIME ZONE",
]
_SEEDS = [
    "UPDATE budget_categories SET hide_from_reports = TRUE WHERE macro_category = 'Financial Transactions'",
    "UPDATE transactions SET needs_review = TRUE WHERE budget_sub_category IS NULL",
]
with engine.connect() as _conn:
    for _sql in _MIGRATIONS:
        try:
            _conn.execute(text(_sql))
            _conn.commit()
        except Exception:
            pass  # column already exists (older SQLite without IF NOT EXISTS)
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
    if path.startswith("/api/auth") or path == "/health":
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
app.include_router(plaid.router, prefix="/api")
app.include_router(transactions.router, prefix="/api")
app.include_router(categories.router, prefix="/api")
app.include_router(import_csv.router, prefix="/api")
app.include_router(templates.router, prefix="/api")
app.include_router(cashflow.router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
