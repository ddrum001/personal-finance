import os
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import plaid
from plaid.api import plaid_api
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.transactions_sync_request import TransactionsSyncRequest
from plaid.model.accounts_get_request import AccountsGetRequest
from plaid.model.products import Products
from plaid.model.country_code import CountryCode
from dotenv import load_dotenv
import datetime

from ..database import get_db
from ..models import PlaidItem, Transaction, Account
from ..schemas import (
    LinkTokenResponse,
    ExchangeTokenRequest,
    ExchangeTokenResponse,
    SyncResponse,
)

load_dotenv()

router = APIRouter(prefix="/plaid", tags=["plaid"])

# ---------------------------------------------------------------------------
# Plaid client factory (reads env at request time so .env reload works)
# ---------------------------------------------------------------------------

def _plaid_client() -> plaid_api.PlaidApi:
    env_name = os.getenv("PLAID_ENV", "sandbox").lower()
    env_map = {
        "sandbox": plaid.Environment.Sandbox,
        "production": plaid.Environment.Production,
    }
    if env_name not in env_map:
        raise HTTPException(400, f"Unknown PLAID_ENV: {env_name}")

    client_id = os.getenv("PLAID_CLIENT_ID")
    secret = os.getenv("PLAID_SECRET")
    missing = [k for k, v in [("PLAID_CLIENT_ID", client_id), ("PLAID_SECRET", secret)] if not v]
    if missing:
        raise HTTPException(500, f"Missing required env vars: {', '.join(missing)}")

    configuration = plaid.Configuration(
        host=env_map[env_name],
        api_key={"clientId": client_id, "secret": secret},
    )
    api_client = plaid.ApiClient(configuration)
    return plaid_api.PlaidApi(api_client)


# ---------------------------------------------------------------------------
# 1. Create Link Token  (frontend calls this to open Plaid Link)
# ---------------------------------------------------------------------------

@router.post("/link/token/create", response_model=LinkTokenResponse)
def create_link_token():
    client = _plaid_client()
    redirect_uri = os.getenv("PLAID_REDIRECT_URI", "").strip() or None
    env_name = os.getenv("PLAID_ENV", "sandbox").lower()

    # OAuth institutions (e.g. Bank of America) require a registered redirect URI.
    # In production, fail fast here rather than letting Plaid silently drop OAuth support.
    if env_name == "production" and not redirect_uri:
        raise HTTPException(
            status_code=500,
            detail="PLAID_REDIRECT_URI must be set in production to support OAuth institutions.",
        )

    kwargs = dict(
        products=[Products("transactions")],
        client_name="Cormond",
        country_codes=[CountryCode("US")],
        language="en",
        user=LinkTokenCreateRequestUser(client_user_id="local-user"),
    )
    if redirect_uri:
        kwargs["redirect_uri"] = redirect_uri
    request = LinkTokenCreateRequest(**kwargs)
    try:
        response = client.link_token_create(request)
    except plaid.ApiException as e:
        raise HTTPException(status_code=502, detail=str(e.body))
    except plaid.OpenApiException as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"{type(e).__name__}: {e}")

    return LinkTokenResponse(
        link_token=response["link_token"],
        expiration=str(response["expiration"]),
    )


# ---------------------------------------------------------------------------
# 2. Exchange Public Token  (frontend sends public_token after Link success)
# ---------------------------------------------------------------------------

@router.post("/link/token/exchange", response_model=ExchangeTokenResponse)
def exchange_public_token(
    body: ExchangeTokenRequest,
    db: Session = Depends(get_db),
):
    client = _plaid_client()
    request = ItemPublicTokenExchangeRequest(public_token=body.public_token)
    try:
        response = client.item_public_token_exchange(request)
    except plaid.ApiException as e:
        raise HTTPException(status_code=502, detail=str(e.body))
    except plaid.OpenApiException as e:
        raise HTTPException(status_code=502, detail=str(e))

    item_id = response["item_id"]
    access_token = response["access_token"]

    item = PlaidItem(
        item_id=item_id,
        access_token=access_token,
        institution_name=body.institution_name,
    )
    db.merge(item)
    db.commit()

    # Fetch and store account metadata for this item
    _upsert_accounts(client, access_token, item_id, db)

    return ExchangeTokenResponse(
        item_id=item_id,
        institution_name=body.institution_name,
    )


# ---------------------------------------------------------------------------
# 3. Sync Transactions  (poll this to pull new/updated/removed transactions)
# ---------------------------------------------------------------------------

@router.post("/transactions/sync", response_model=SyncResponse)
def sync_transactions(db: Session = Depends(get_db)):
    items = db.query(PlaidItem).all()
    if not items:
        raise HTTPException(404, "No linked accounts. Complete the Link flow first.")

    client = _plaid_client()
    total_added = total_modified = total_removed = 0

    for item in items:
        # Resume from the last saved cursor; None means start from the beginning
        cursor = item.sync_cursor
        added = modified = removed = 0

        while True:
            kwargs = {"access_token": item.access_token}
            if cursor:
                kwargs["cursor"] = cursor
            request = TransactionsSyncRequest(**kwargs)
            try:
                response = client.transactions_sync(request)
            except plaid.ApiException as e:
                raise HTTPException(status_code=502, detail=str(e.body))
            except plaid.OpenApiException as e:
                raise HTTPException(status_code=502, detail=str(e))

            for txn in response["added"]:
                category_str = None
                if txn.get("personal_finance_category"):
                    category_str = txn["personal_finance_category"].get("primary")
                elif txn.get("category"):
                    category_str = txn["category"][0] if txn["category"] else None

                db_txn = Transaction(
                    transaction_id=txn["transaction_id"],
                    account_id=txn["account_id"],
                    item_id=item.item_id,
                    name=txn["name"],
                    amount=txn["amount"],
                    date=txn["date"],
                    category=category_str,
                    merchant_name=txn.get("merchant_name"),
                    pending=txn.get("pending", False),
                    needs_review=True,
                )
                db.merge(db_txn)
                added += 1

            for txn in response["modified"]:
                existing = db.get(Transaction, txn["transaction_id"])
                if existing:
                    existing.name = txn["name"]
                    existing.amount = txn["amount"]
                    existing.pending = txn.get("pending", False)
                    modified += 1

            for txn in response["removed"]:
                existing = db.get(Transaction, txn["transaction_id"])
                if existing:
                    db.delete(existing)
                    removed += 1

            cursor = response.get("next_cursor")
            if not response.get("has_more"):
                break

        # Persist the cursor so the next sync only fetches new changes
        item.sync_cursor = cursor
        # Refresh account metadata in case names/masks changed
        _upsert_accounts(client, item.access_token, item.item_id, db)
        db.commit()
        total_added += added
        total_modified += modified
        total_removed += removed

    return SyncResponse(added=total_added, modified=total_modified, removed=total_removed)


# ---------------------------------------------------------------------------
# 4. List linked items
# ---------------------------------------------------------------------------

@router.get("/items")
def list_items(db: Session = Depends(get_db)):
    items = db.query(PlaidItem).all()
    result = []
    for i in items:
        accounts = db.query(Account).filter(Account.item_id == i.item_id).all()
        result.append({
            "item_id": i.item_id,
            "institution_name": i.institution_name,
            "created_at": i.created_at,
            "accounts": [
                {
                    "account_id": a.account_id,
                    "name": a.name,
                    "official_name": a.official_name,
                    "mask": a.mask,
                    "type": a.type,
                    "subtype": a.subtype,
                }
                for a in accounts
            ],
        })
    return result


# ---------------------------------------------------------------------------
# Helper: fetch Plaid accounts and upsert into DB
# ---------------------------------------------------------------------------

def _upsert_accounts(client: plaid_api.PlaidApi, access_token: str, item_id: str, db: Session):
    try:
        resp = client.accounts_get(AccountsGetRequest(access_token=access_token))
    except plaid.ApiException:
        return  # non-fatal; we'll retry on next sync
    for acct in resp["accounts"]:
        db.merge(Account(
            account_id=acct["account_id"],
            item_id=item_id,
            name=acct["name"],
            official_name=acct.get("official_name"),
            mask=acct.get("mask"),
            type=str(acct["type"]) if acct.get("type") else None,
            subtype=str(acct["subtype"]) if acct.get("subtype") else None,
        ))
    db.commit()
