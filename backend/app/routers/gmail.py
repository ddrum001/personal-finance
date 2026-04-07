import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from google_auth_oauthlib.flow import Flow
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import GmailCredential

router = APIRouter(prefix="/gmail", tags=["gmail"])

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GMAIL_REDIRECT_URI = os.getenv("GMAIL_REDIRECT_URI", "http://localhost:8000/api/gmail/callback")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
SESSION_SECRET = os.getenv("SESSION_SECRET", "dev-secret-change-me")

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

_CLIENT_CONFIG = {
    "web": {
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": [GMAIL_REDIRECT_URI],
    }
}


def _make_flow() -> Flow:
    return Flow.from_client_config(_CLIENT_CONFIG, scopes=GMAIL_SCOPES, redirect_uri=GMAIL_REDIRECT_URI)


def _get_user_email(request: Request) -> str:
    """Extract the logged-in user's email from the session cookie."""
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, SESSION_SECRET, algorithms=["HS256"])
        return payload["email"]
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid session")


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
# Connect — returns the Google OAuth URL for the frontend to redirect to
# ---------------------------------------------------------------------------

@router.get("/connect")
def gmail_connect(request: Request):
    email = _get_user_email(request)

    # Sign a short-lived state token carrying the user email (10 min TTL)
    state = jwt.encode(
        {"email": email, "exp": datetime.now(timezone.utc) + timedelta(minutes=10)},
        SESSION_SECRET,
        algorithm="HS256",
    )

    flow = _make_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",   # force refresh_token to be returned every time
        state=state,
        include_granted_scopes="false",
    )
    return {"auth_url": auth_url}


# ---------------------------------------------------------------------------
# Callback — called by Google, then redirects back to the frontend
# This endpoint is public (whitelisted in main.py auth middleware)
# ---------------------------------------------------------------------------

@router.get("/callback")
def gmail_callback(code: str = None, state: str = None, error: str = None, db: Session = Depends(get_db)):
    if error:
        return RedirectResponse(f"{FRONTEND_URL}/accounts?gmail_error={error}")
    if not code or not state:
        return RedirectResponse(f"{FRONTEND_URL}/accounts?gmail_error=missing_params")

    # Validate state and extract user email
    try:
        payload = jwt.decode(state, SESSION_SECRET, algorithms=["HS256"])
        user_email = payload["email"]
    except jwt.ExpiredSignatureError:
        return RedirectResponse(f"{FRONTEND_URL}/accounts?gmail_error=state_expired")
    except jwt.PyJWTError:
        return RedirectResponse(f"{FRONTEND_URL}/accounts?gmail_error=invalid_state")

    # Exchange authorization code for tokens
    try:
        flow = _make_flow()
        flow.fetch_token(code=code)
        credentials = flow.credentials
    except Exception as e:
        return RedirectResponse(f"{FRONTEND_URL}/accounts?gmail_error=token_exchange_failed")

    # Resolve the Gmail address from the ID token if available
    gmail_address = None
    if credentials.id_token and isinstance(credentials.id_token, dict):
        gmail_address = credentials.id_token.get("email")

    # Upsert credentials
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
