import os
from datetime import datetime, timedelta, timezone

import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request, Response
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel

load_dotenv()

router = APIRouter(prefix="/auth", tags=["auth"])

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
ALLOWED_EMAILS = {e.strip().lower() for e in os.getenv("ALLOWED_EMAILS", "").split(",") if e.strip()}
SESSION_SECRET = os.getenv("SESSION_SECRET", "dev-secret-change-me")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
COOKIE_MAX_AGE = 86400 * 30  # 30 days


class GoogleTokenRequest(BaseModel):
    credential: str


@router.post("/google")
def google_login(body: GoogleTokenRequest, response: Response):
    try:
        idinfo = id_token.verify_oauth2_token(
            body.credential,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
    except Exception:
        raise HTTPException(401, "Invalid Google token")

    email = idinfo.get("email", "").lower()
    if email not in ALLOWED_EMAILS:
        raise HTTPException(403, "This Google account is not authorized")

    token = jwt.encode(
        {
            "email": email,
            "name": idinfo.get("name", ""),
            "picture": idinfo.get("picture", ""),
            "exp": datetime.now(timezone.utc) + timedelta(days=30),
        },
        SESSION_SECRET,
        algorithm="HS256",
    )

    response.set_cookie(
        key="session",
        value=token,
        httponly=True,
        max_age=COOKIE_MAX_AGE,
        samesite="lax",
        secure=COOKIE_SECURE,
    )
    return {"email": email, "name": idinfo.get("name", ""), "picture": idinfo.get("picture", "")}


@router.get("/me")
def get_me(request: Request):
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, SESSION_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid session")
    return {
        "email": payload["email"],
        "name": payload.get("name", ""),
        "picture": payload.get("picture", ""),
    }


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("session", samesite="lax")
    return {"ok": True}
