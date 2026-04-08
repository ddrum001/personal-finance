import base64
import json
import os
import re
from datetime import date, datetime, timedelta, timezone

import jwt
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AmazonOrder, BudgetCategory, CategoryKeyword, GmailCredential, Transaction

router = APIRouter(prefix="/gmail", tags=["gmail"])

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GMAIL_REDIRECT_URI = os.getenv("GMAIL_REDIRECT_URI", "http://localhost:8000/api/gmail/callback")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
SESSION_SECRET = os.getenv("SESSION_SECRET", "dev-secret-change-me")

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

# ---------------------------------------------------------------------------
# IMPORTANT: This is the ONLY sender we ever query from Gmail.
# The API call below uses this as a hard filter — no other emails are fetched.
# ---------------------------------------------------------------------------
AMAZON_SENDER = "auto-confirm@amazon.com"

_CLIENT_CONFIG = {
    "web": {
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": [GMAIL_REDIRECT_URI],
    }
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_flow() -> Flow:
    return Flow.from_client_config(_CLIENT_CONFIG, scopes=GMAIL_SCOPES, redirect_uri=GMAIL_REDIRECT_URI)


def _get_user_email(request: Request) -> str:
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, SESSION_SECRET, algorithms=["HS256"])
        return payload["email"]
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid session")


def _build_gmail_service(cred: GmailCredential, db: Session):
    """Build an authenticated Gmail API client, refreshing the token if needed."""
    credentials = Credentials(
        token=cred.access_token,
        refresh_token=cred.refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
    )
    if credentials.expired and credentials.refresh_token:
        credentials.refresh(GoogleRequest())
        cred.access_token = credentials.token
        cred.token_expiry = credentials.expiry
        db.commit()
    return build("gmail", "v1", credentials=credentials, cache_discovery=False)


def _extract_html_body(payload: dict) -> str | None:
    """Recursively extract the HTML body from a Gmail message payload."""
    mime_type = payload.get("mimeType", "")
    if mime_type == "text/html":
        data = payload.get("body", {}).get("data", "")
        if data:
            return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="ignore")
    elif mime_type.startswith("multipart/"):
        for part in payload.get("parts", []):
            result = _extract_html_body(part)
            if result:
                return result
    return None


def _extract_items(soup: BeautifulSoup) -> list[dict]:
    """
    Extract purchased item descriptions from an Amazon order confirmation email.
    Uses multiple strategies since Amazon's HTML structure changes over time.
    """
    items = []
    seen = set()

    # Strategy 1: anchor tags pointing to amazon.com product pages with descriptive text.
    # Amazon product names are typically wrapped in <a> tags linking to the product.
    for a in soup.find_all("a", href=True):
        href = a.get("href", "")
        text = a.get_text(" ", strip=True)
        if (
            ("/dp/" in href or "/gp/product" in href or "amazon.com/gp/" in href)
            and 15 < len(text) < 300
            and text not in seen
        ):
            seen.add(text)
            items.append({"description": text, "quantity": 1})

    # Strategy 2: look for explicit quantity markers ("Qty: N" or "1 of:") and capture
    # the surrounding text as the product name.
    if not items:
        qty_pattern = re.compile(r'(?:Qty|Quantity)[:\s]+(\d+)', re.IGNORECASE)
        for tag in soup.find_all(string=qty_pattern):
            parent = tag.parent
            if parent:
                block = parent.get_text(" ", strip=True)
                qty_match = qty_pattern.search(block)
                qty = int(qty_match.group(1)) if qty_match else 1
                # Strip the qty fragment and nearby price to get the description
                desc = qty_pattern.sub("", block).strip()
                desc = re.sub(r'\$[\d,]+\.\d{2}', '', desc).strip()
                if 10 < len(desc) < 300 and desc not in seen:
                    seen.add(desc)
                    items.append({"description": desc, "quantity": qty})

    # Strategy 3: broad fallback — table cells with substantive text that don't look
    # like boilerplate. Only used if neither strategy above produced results.
    if not items:
        skip_phrases = {
            "amazon.com", "all rights", "privacy", "unsubscribe", "click here",
            "your account", "order total", "shipping", "estimated", "copyright",
            "gift", "tax", "subtotal", "payment", "address", "delivery",
        }
        for td in soup.find_all(["td", "div"]):
            text = td.get_text(" ", strip=True)
            lower = text.lower()
            if (
                25 < len(text) < 250
                and not any(p in lower for p in skip_phrases)
                and text not in seen
            ):
                seen.add(text)
                items.append({"description": text, "quantity": 1})
                if len(items) >= 8:
                    break

    return items[:10]


def _parse_amazon_email(msg: dict) -> dict | None:
    """Parse a Gmail message into an order dict. Returns None if no order ID found."""
    # Email date from Gmail metadata (reliable)
    internal_ms = int(msg.get("internalDate", 0))
    order_date = datetime.fromtimestamp(internal_ms / 1000, tz=timezone.utc).date() if internal_ms else None

    html = _extract_html_body(msg["payload"])
    if not html:
        return None

    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(" ", strip=True)

    # Order ID — always present in Amazon order confirmation emails
    order_match = re.search(r'\d{3}-\d{7}-\d{7}', text)
    if not order_match:
        return None
    order_id = order_match.group(0)

    # Order total — find "Order Total" label and the dollar amount that follows it
    order_total = None
    total_match = re.search(r'Order Total[^$]*\$\s*([\d,]+\.\d{2})', text, re.IGNORECASE)
    if total_match:
        try:
            order_total = float(total_match.group(1).replace(",", ""))
        except ValueError:
            pass

    items = _extract_items(soup)

    return {
        "order_id": order_id,
        "order_date": order_date,
        "order_total": order_total,
        "items": items,
    }


def _try_auto_match(order: AmazonOrder, db: Session):
    """
    Try to find exactly one Amazon transaction that matches this order by amount + date.
    Only sets the link if the match is unambiguous (exactly one candidate).
    """
    if not order.order_total or not order.order_date:
        return

    window = timedelta(days=5)
    candidates = db.query(Transaction).filter(
        Transaction.date >= order.order_date - window,
        Transaction.date <= order.order_date + window,
        Transaction.amount >= order.order_total - 0.05,
        Transaction.amount <= order.order_total + 0.05,
    ).all()

    amazon_candidates = [
        t for t in candidates
        if "amazon" in (t.merchant_name or "").lower() or "amazon" in (t.name or "").lower()
    ]

    if len(amazon_candidates) == 1:
        order.transaction_id = amazon_candidates[0].transaction_id
        order.match_type = "auto"


def _suggest_category(order: AmazonOrder, db: Session):
    """Run item descriptions through existing keyword rules to suggest a category."""
    if not order.items:
        return

    try:
        items = json.loads(order.items)
    except (json.JSONDecodeError, TypeError):
        return

    keywords = db.query(CategoryKeyword).all()
    cat_map = {c.id: c for c in db.query(BudgetCategory).all()}

    rules = sorted(
        [
            (kw.keyword, cat_map[kw.budget_category_id].sub_category)
            for kw in keywords
            if kw.budget_category_id in cat_map
        ],
        key=lambda r: len(r[0]),
        reverse=True,
    )

    search_text = " ".join(item.get("description", "") for item in items).lower()
    match = next((sub_cat for kw, sub_cat in rules if kw in search_text), None)
    if match:
        order.suggested_category = match


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

@router.get("/status")
def gmail_status(request: Request, db: Session = Depends(get_db)):
    email = _get_user_email(request)
    cred = db.get(GmailCredential, email)
    if cred:
        return {"connected": True, "gmail_address": cred.gmail_address}
    return {"connected": False, "gmail_address": None}


# ---------------------------------------------------------------------------
# Connect
# ---------------------------------------------------------------------------

@router.get("/connect")
def gmail_connect(request: Request):
    email = _get_user_email(request)
    state = jwt.encode(
        {"email": email, "exp": datetime.now(timezone.utc) + timedelta(minutes=10)},
        SESSION_SECRET,
        algorithm="HS256",
    )
    flow = _make_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        state=state,
        include_granted_scopes="false",
    )
    return {"auth_url": auth_url}


# ---------------------------------------------------------------------------
# Callback (public — whitelisted in auth middleware)
# ---------------------------------------------------------------------------

@router.get("/callback")
def gmail_callback(
    code: str = None, state: str = None, error: str = None,
    db: Session = Depends(get_db),
):
    if error:
        return RedirectResponse(f"{FRONTEND_URL}/accounts?gmail_error={error}")
    if not code or not state:
        return RedirectResponse(f"{FRONTEND_URL}/accounts?gmail_error=missing_params")

    try:
        payload = jwt.decode(state, SESSION_SECRET, algorithms=["HS256"])
        user_email = payload["email"]
    except jwt.ExpiredSignatureError:
        return RedirectResponse(f"{FRONTEND_URL}/accounts?gmail_error=state_expired")
    except jwt.PyJWTError:
        return RedirectResponse(f"{FRONTEND_URL}/accounts?gmail_error=invalid_state")

    try:
        flow = _make_flow()
        flow.fetch_token(code=code)
        credentials = flow.credentials
    except Exception:
        return RedirectResponse(f"{FRONTEND_URL}/accounts?gmail_error=token_exchange_failed")

    gmail_address = None
    if credentials.id_token and isinstance(credentials.id_token, dict):
        gmail_address = credentials.id_token.get("email")

    cred = db.get(GmailCredential, user_email)
    if cred:
        cred.access_token = credentials.token
        cred.refresh_token = credentials.refresh_token or cred.refresh_token
        cred.token_expiry = credentials.expiry
        if gmail_address:
            cred.gmail_address = gmail_address
    else:
        cred = GmailCredential(
            email=user_email,
            gmail_address=gmail_address,
            access_token=credentials.token,
            refresh_token=credentials.refresh_token,
            token_expiry=credentials.expiry,
        )
        db.add(cred)
    db.commit()

    return RedirectResponse(f"{FRONTEND_URL}/accounts?gmail=connected")


# ---------------------------------------------------------------------------
# Disconnect
# ---------------------------------------------------------------------------

@router.delete("/disconnect")
def gmail_disconnect(request: Request, db: Session = Depends(get_db)):
    email = _get_user_email(request)
    cred = db.get(GmailCredential, email)
    if cred:
        db.delete(cred)
        db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Amazon order sync
# ---------------------------------------------------------------------------

@router.post("/amazon/sync")
def sync_amazon_orders(request: Request, db: Session = Depends(get_db)):
    email = _get_user_email(request)
    cred = db.get(GmailCredential, email)
    if not cred:
        raise HTTPException(400, "Gmail not connected")

    service = _build_gmail_service(cred, db)

    # -----------------------------------------------------------------------
    # FILTER: We request ONLY emails from auto-confirm@amazon.com.
    # This query is sent to the Gmail API server-side — only matching message
    # IDs are returned. No other emails are fetched or transmitted.
    # -----------------------------------------------------------------------
    query = f"from:{AMAZON_SENDER}"

    # Collect all matching message IDs (paginated)
    message_refs = []
    page_token = None
    while True:
        params = {"userId": "me", "q": query, "maxResults": 100}
        if page_token:
            params["pageToken"] = page_token
        result = service.users().messages().list(**params).execute()
        message_refs.extend(result.get("messages", []))
        page_token = result.get("nextPageToken")
        if not page_token or len(message_refs) >= 500:
            break

    added = 0
    skipped = 0

    for ref in message_refs:
        msg_id = ref["id"]

        # Skip messages already in the DB
        if db.query(AmazonOrder).filter(AmazonOrder.gmail_message_id == msg_id).first():
            skipped += 1
            continue

        # Fetch the full message content
        msg = service.users().messages().get(userId="me", id=msg_id, format="full").execute()

        parsed = _parse_amazon_email(msg)
        if not parsed or not parsed.get("order_id"):
            skipped += 1
            continue

        # Skip if we already have this order (duplicate email, e.g. resend)
        if db.query(AmazonOrder).filter(AmazonOrder.order_id == parsed["order_id"]).first():
            skipped += 1
            continue

        order = AmazonOrder(
            order_id=parsed["order_id"],
            order_date=parsed.get("order_date"),
            order_total=parsed.get("order_total"),
            items=json.dumps(parsed.get("items", [])),
            gmail_message_id=msg_id,
        )
        db.add(order)
        db.flush()

        _try_auto_match(order, db)
        if order.transaction_id:
            _suggest_category(order, db)

        added += 1

    db.commit()
    return {"added": added, "skipped": skipped, "total_found": len(message_refs)}


# ---------------------------------------------------------------------------
# List Amazon orders
# ---------------------------------------------------------------------------

@router.get("/amazon/orders")
def list_amazon_orders(request: Request, db: Session = Depends(get_db)):
    _get_user_email(request)  # auth check
    orders = db.query(AmazonOrder).order_by(AmazonOrder.order_date.desc()).all()
    result = []
    for o in orders:
        txn = db.get(Transaction, o.transaction_id) if o.transaction_id else None
        result.append({
            "id": o.id,
            "order_id": o.order_id,
            "order_date": o.order_date.isoformat() if o.order_date else None,
            "order_total": o.order_total,
            "items": json.loads(o.items) if o.items else [],
            "match_type": o.match_type,
            "suggested_category": o.suggested_category,
            "transaction": {
                "transaction_id": txn.transaction_id,
                "name": txn.name,
                "date": txn.date.isoformat(),
                "amount": txn.amount,
            } if txn else None,
        })
    return result


# ---------------------------------------------------------------------------
# Manually link an order to a transaction
# ---------------------------------------------------------------------------

class LinkBody(BaseModel):
    transaction_id: str


@router.patch("/amazon/orders/{order_id}/link")
def link_amazon_order(order_id: int, body: LinkBody, request: Request, db: Session = Depends(get_db)):
    _get_user_email(request)
    order = db.get(AmazonOrder, order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    txn = db.get(Transaction, body.transaction_id)
    if not txn:
        raise HTTPException(404, "Transaction not found")
    order.transaction_id = body.transaction_id
    order.match_type = "manual"
    _suggest_category(order, db)
    db.commit()
    return {"ok": True, "suggested_category": order.suggested_category}


@router.delete("/amazon/orders/{order_id}/link")
def unlink_amazon_order(order_id: int, request: Request, db: Session = Depends(get_db)):
    _get_user_email(request)
    order = db.get(AmazonOrder, order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    order.transaction_id = None
    order.match_type = None
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Candidate transactions for manual linking
# ---------------------------------------------------------------------------

@router.get("/amazon/orders/{order_id}/candidates")
def get_order_candidates(order_id: int, request: Request, db: Session = Depends(get_db)):
    """
    Return Amazon transactions within ±14 days of the order date,
    sorted by amount proximity to the order total.
    """
    _get_user_email(request)
    order = db.get(AmazonOrder, order_id)
    if not order:
        raise HTTPException(404, "Order not found")

    if not order.order_date:
        return []

    window = timedelta(days=14)
    candidates = db.query(Transaction).filter(
        Transaction.date >= order.order_date - window,
        Transaction.date <= order.order_date + window,
        Transaction.amount > 0,
        or_(
            Transaction.merchant_name.ilike("%amazon%"),
            Transaction.name.ilike("%amazon%"),
        ),
    ).all()

    if order.order_total is not None:
        candidates.sort(key=lambda t: abs(t.amount - order.order_total))
    else:
        candidates.sort(key=lambda t: t.date)

    return [
        {
            "transaction_id": t.transaction_id,
            "name": t.name,
            "merchant_name": t.merchant_name,
            "date": t.date.isoformat(),
            "amount": t.amount,
            "amount_diff": round(abs(t.amount - order.order_total), 2) if order.order_total is not None else None,
        }
        for t in candidates
    ]
