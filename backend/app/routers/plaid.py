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
from datetime import timezone

from ..database import get_db
from ..models import PlaidItem, Transaction, Account, TransactionSplit
from .categories import apply_keywords_to_transactions
from ..schemas import (
    LinkTokenResponse,
    ExchangeTokenRequest,
    ExchangeTokenResponse,
    SyncResponse,
)

load_dotenv()

router = APIRouter(prefix="/plaid", tags=["plaid"])

# Words too generic to use for account name matching
_GENERIC_WORDS = {"visa", "mastercard", "amex", "discover", "credit", "debit",
                  "card", "checking", "savings", "account", "bank"}


def _match_manual_account(plaid_acct: Account, manual_accounts: list) -> Account | None:
    """Return the manual account that best corresponds to a Plaid account.

    Strategy:
      1. Exact last-4 mask match (most reliable)
      2. Significant keyword match — words from the manual name that appear
         in the Plaid name/official_name (filters out generic card words)
    Returns None if no confident match found.
    """
    # 1. Mask match (only when both sides have a mask)
    if plaid_acct.mask:
        for ma in manual_accounts:
            if ma.mask and ma.mask == plaid_acct.mask and ma.subtype == plaid_acct.subtype:
                return ma

    # 2. Keyword match
    plaid_combined = (
        (plaid_acct.name or "") + " " + (plaid_acct.official_name or "")
    ).lower()
    for ma in manual_accounts:
        keywords = [
            w for w in (ma.name or "").lower().split()
            if len(w) >= 4 and w not in _GENERIC_WORDS
        ]
        if keywords and all(kw in plaid_combined for kw in keywords):
            return ma

    return None

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

    # Build institution → manual Account objects map once, used for CSV dedup below
    manual_accts_by_institution: dict[str, list[Account]] = {}
    for mi in db.query(PlaidItem).filter(PlaidItem.access_token == "manual").all():
        accts = db.query(Account).filter(Account.item_id == mi.item_id).all()
        if accts:
            manual_accts_by_institution.setdefault(mi.institution_name or "", []).extend(accts)

    for item in items:
        if item.access_token == "manual":
            continue  # CSV-import synthetic items have no real Plaid token

        # Manual accounts for the same institution — used to find CSV duplicates
        manual_accts = manual_accts_by_institution.get(item.institution_name or "", [])

        # Resume from the last saved cursor; None means start from the beginning
        cursor = item.sync_cursor
        added = modified = removed = 0
        new_ids: list[str] = []

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

                # Remove any matching manual CSV transaction for the same
                # account so the higher-quality Plaid record wins.
                # Match on date + amount; name can differ between CSV raw text
                # and Plaid's cleaned merchant name.
                saved_splits = []
                if manual_accts:
                    # Try to narrow dedup to the specific matched manual account
                    plaid_acct = db.get(Account, txn["account_id"])
                    matched_manual = _match_manual_account(plaid_acct, manual_accts) if plaid_acct else None
                    if matched_manual:
                        csv_dup = db.query(Transaction).filter(
                            Transaction.account_id == matched_manual.account_id,
                            Transaction.date == db_txn.date,
                            Transaction.amount == db_txn.amount,
                        ).first()
                    else:
                        # Fall back to institution-level dedup
                        manual_acct_ids = [a.account_id for a in manual_accts]
                        csv_dup = db.query(Transaction).filter(
                            Transaction.account_id.in_(manual_acct_ids),
                            Transaction.date == db_txn.date,
                            Transaction.amount == db_txn.amount,
                        ).first()
                    if csv_dup:
                        # Carry over any categorisation the user already did
                        if csv_dup.budget_sub_category and not db_txn.budget_sub_category:
                            db_txn.budget_sub_category = csv_dup.budget_sub_category
                        if csv_dup.custom_category and not db_txn.custom_category:
                            db_txn.custom_category = csv_dup.custom_category
                        db_txn.needs_review = csv_dup.needs_review
                        # Save splits before cascade-deletes them
                        saved_splits = [
                            {
                                "amount": s.amount,
                                "category": s.category,
                                "note": s.note,
                                "budget_sub_category": s.budget_sub_category,
                            }
                            for s in csv_dup.splits
                        ]
                        db.delete(csv_dup)
                        db.flush()  # process deletion before re-creating splits

                db.merge(db_txn)

                if saved_splits:
                    db.flush()  # ensure Plaid transaction exists before FK insert
                    for split_data in saved_splits:
                        db.add(TransactionSplit(
                            transaction_id=db_txn.transaction_id,
                            **split_data,
                        ))

                new_ids.append(db_txn.transaction_id)
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

        # Persist the cursor and sync timestamp
        item.sync_cursor = cursor
        item.last_synced_at = datetime.datetime.now(timezone.utc)
        # Refresh account metadata in case names/masks changed
        _upsert_accounts(client, item.access_token, item.item_id, db)
        db.commit()
        # Apply keyword rules to newly added transactions
        if new_ids:
            apply_keywords_to_transactions(db, transaction_ids=new_ids)
        total_added += added
        total_modified += modified
        total_removed += removed

    return SyncResponse(added=total_added, modified=total_modified, removed=total_removed)


# ---------------------------------------------------------------------------
# 4. List linked items / delete a stale item
# ---------------------------------------------------------------------------

@router.delete("/items/{item_id}")
def delete_item(item_id: str, db: Session = Depends(get_db)):
    """Remove a stale Plaid item and its accounts (e.g. after a duplicate reconnect)."""
    item = db.get(PlaidItem, item_id)
    if not item:
        raise HTTPException(404, f"Item {item_id!r} not found")
    db.delete(item)
    db.commit()
    return {"deleted": item_id}


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
            "last_synced_at": i.last_synced_at,
            "accounts": [
                {
                    "account_id": a.account_id,
                    "name": a.name,
                    "official_name": a.official_name,
                    "mask": a.mask,
                    "type": a.type,
                    "subtype": a.subtype,
                    "nickname": a.nickname,
                }
                for a in accounts
            ],
        })
    return result


@router.patch("/accounts/{account_id}")
def update_account(account_id: str, body: dict, db: Session = Depends(get_db)):
    acct = db.get(Account, account_id)
    if not acct:
        raise HTTPException(404, f"Account {account_id!r} not found")
    if "nickname" in body:
        acct.nickname = body["nickname"] or None
    db.commit()
    return {"account_id": account_id, "nickname": acct.nickname}


# ---------------------------------------------------------------------------
# Helper: fetch Plaid accounts and upsert into DB
# ---------------------------------------------------------------------------

def _upsert_accounts(client: plaid_api.PlaidApi, access_token: str, item_id: str, db: Session):
    try:
        resp = client.accounts_get(AccountsGetRequest(access_token=access_token))
    except plaid.ApiException:
        return  # non-fatal; we'll retry on next sync
    for acct in resp["accounts"]:
        acct_subtype = str(acct["subtype"]) if acct.get("subtype") else None
        acct_mask = acct.get("mask")

        # Prefer to reuse an existing account row with the same identity
        # (name + subtype + mask) so reconnecting the same bank doesn't
        # create duplicate rows when Plaid issues a new account_id.
        existing = db.query(Account).filter(
            Account.item_id == item_id,
            Account.name == acct["name"],
            Account.subtype == acct_subtype,
        ).first()
        if existing:
            existing.official_name = acct.get("official_name")
            existing.mask = acct_mask
            existing.type = str(acct["type"]) if acct.get("type") else None
            continue

        db.merge(Account(
            account_id=acct["account_id"],
            item_id=item_id,
            name=acct["name"],
            official_name=acct.get("official_name"),
            mask=acct_mask,
            type=str(acct["type"]) if acct.get("type") else None,
            subtype=acct_subtype,
        ))
    db.commit()
