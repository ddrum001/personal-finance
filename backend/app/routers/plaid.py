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
        products=[Products("transactions"), Products("liabilities")],
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
# 1b. Update mode link token — reconnects an existing item to add new products
# ---------------------------------------------------------------------------

@router.post("/link/token/update/{item_id}")
def create_update_link_token(item_id: str, db: Session = Depends(get_db)):
    """Create a Plaid Link token in update mode for an existing item.
    Used to add new products (e.g. liabilities) to an already-connected item.
    """
    item = db.get(PlaidItem, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    client = _plaid_client()
    redirect_uri = os.getenv("PLAID_REDIRECT_URI", "").strip() or None
    kwargs = dict(
        access_token=item.access_token,
        products=[Products("transactions"), Products("liabilities")],
        client_name="Cormond",
        country_codes=[CountryCode("US")],
        language="en",
        user=LinkTokenCreateRequestUser(client_user_id="local-user"),
    )
    if redirect_uri:
        kwargs["redirect_uri"] = redirect_uri
    try:
        response = client.link_token_create(LinkTokenCreateRequest(**kwargs))
    except plaid.ApiException as e:
        raise HTTPException(status_code=502, detail=str(e.body))
    return LinkTokenResponse(
        link_token=response["link_token"],
        expiration=str(response["expiration"]),
    )


# ---------------------------------------------------------------------------
# 2. Exchange Public Token  (frontend sends public_token after Link success)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 2c. Replace Item — fresh reconnect that migrates all account/transaction data
# ---------------------------------------------------------------------------

@router.post("/items/{item_id}/replace")
def replace_item(item_id: str, body: ExchangeTokenRequest, db: Session = Depends(get_db)):
    """Exchange a fresh public token to replace an existing item.

    Migrates transactions, promo balances, and cashflow entries to the new
    account_ids returned by Plaid, preserving all history.  Used when the
    user needs to re-connect an institution to add a new product (liabilities).
    """
    from sqlalchemy import text

    old_item = db.get(PlaidItem, item_id)
    if not old_item:
        raise HTTPException(404, "Item not found")

    client = _plaid_client()

    try:
        resp = client.item_public_token_exchange(
            ItemPublicTokenExchangeRequest(public_token=body.public_token)
        )
    except plaid.ApiException as e:
        raise HTTPException(502, str(e.body))

    new_item_id = resp["item_id"]
    new_access_token = resp["access_token"]
    institution_name = body.institution_name or old_item.institution_name

    old_accounts = db.query(Account).filter(Account.item_id == item_id).all()

    try:
        accts_resp = client.accounts_get(AccountsGetRequest(access_token=new_access_token))
    except plaid.ApiException as e:
        raise HTTPException(502, str(e.body))

    new_plaid_accounts = accts_resp["accounts"]

    # Match new Plaid accounts to old DB accounts by mask + subtype
    account_id_map: dict[str, dict] = {}   # old_id -> {new_id, name, ...}
    unmatched_new = []
    for new_acct in new_plaid_accounts:
        new_id = new_acct["account_id"]
        new_mask = new_acct.get("mask")
        new_subtype = str(new_acct["subtype"]) if new_acct.get("subtype") else None
        new_type = str(new_acct["type"]) if new_acct.get("type") else None

        matched = None
        if new_mask:
            for old_acct in old_accounts:
                if old_acct.mask == new_mask and old_acct.subtype == new_subtype:
                    matched = old_acct
                    break

        if matched:
            account_id_map[matched.account_id] = {
                "new_id": new_id,
                "name": new_acct["name"],
                "official_name": new_acct.get("official_name"),
                "type": new_type,
                "subtype": new_subtype,
            }
        else:
            unmatched_new.append(new_acct)

    # Create the new PlaidItem first
    db.merge(PlaidItem(
        item_id=new_item_id,
        access_token=new_access_token,
        institution_name=institution_name,
    ))
    db.flush()

    # Migrate each matched account: new Account row + update all references
    for old_id, info in account_id_map.items():
        new_id = info["new_id"]
        old_acct = db.get(Account, old_id)

        db.add(Account(
            account_id=new_id,
            item_id=new_item_id,
            name=info["name"],
            official_name=info["official_name"],
            mask=old_acct.mask,
            type=info["type"],
            subtype=info["subtype"],
            nickname=old_acct.nickname,
            is_excluded=old_acct.is_excluded,
            balance=old_acct.balance,
            credit_limit=old_acct.credit_limit,
            statement_balance=old_acct.statement_balance,
            statement_due_date=old_acct.statement_due_date,
            minimum_payment=old_acct.minimum_payment,
            last_statement_date=old_acct.last_statement_date,
            liabilities_updated_at=old_acct.liabilities_updated_at,
        ))
        db.flush()

        db.execute(text("UPDATE transactions SET account_id=:n, item_id=:ni WHERE account_id=:o"),
                   {"n": new_id, "ni": new_item_id, "o": old_id})
        db.execute(text("UPDATE promo_balances SET account_id=:n WHERE account_id=:o"),
                   {"n": new_id, "o": old_id})
        db.execute(text("UPDATE cashflow_entries SET account_id=:n WHERE account_id=:o"),
                   {"n": new_id, "o": old_id})

        db.delete(old_acct)
        db.flush()

    # Add new accounts that had no match
    for new_acct in unmatched_new:
        new_type = str(new_acct["type"]) if new_acct.get("type") else None
        new_subtype = str(new_acct["subtype"]) if new_acct.get("subtype") else None
        db.merge(Account(
            account_id=new_acct["account_id"],
            item_id=new_item_id,
            name=new_acct["name"],
            official_name=new_acct.get("official_name"),
            mask=new_acct.get("mask"),
            type=new_type,
            subtype=new_subtype,
        ))

    # Delete old PlaidItem (cascades to any remaining unmatched old accounts)
    db.delete(old_item)
    db.commit()

    return {
        "item_id": new_item_id,
        "migrated_accounts": len(account_id_map),
        "new_accounts": len(unmatched_new),
    }




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
# 2b. Complete update-mode flow — exchange the new public token
# ---------------------------------------------------------------------------

@router.post("/items/{item_id}/update-complete")
def complete_item_update(
    item_id: str,
    body: ExchangeTokenRequest,
    db: Session = Depends(get_db),
):
    """Exchange the public token returned after a Plaid Link update-mode session.
    Stores the refreshed access_token (usually unchanged) so new products are active.
    """
    item = db.get(PlaidItem, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    client = _plaid_client()
    try:
        response = client.item_public_token_exchange(
            ItemPublicTokenExchangeRequest(public_token=body.public_token)
        )
    except plaid.ApiException as e:
        raise HTTPException(status_code=502, detail=str(e.body))
    item.access_token = response["access_token"]
    db.commit()
    return {"item_id": item_id, "updated": True}


# ---------------------------------------------------------------------------
# 3. Sync Transactions  (poll this to pull new/updated/removed transactions)
# ---------------------------------------------------------------------------

def _sync_item(item: PlaidItem, client: plaid_api.PlaidApi, manual_accts_by_institution: dict, db: Session) -> tuple[int, int, int]:
    """Sync a single Plaid item. Returns (added, modified, removed)."""
    manual_accts = manual_accts_by_institution.get(item.institution_name or "", [])
    cursor = item.sync_cursor
    added = modified = removed = 0
    new_ids: list[str] = []

    # Build set of excluded account_ids for this item so we skip joint accounts
    excluded_account_ids = {
        a.account_id for a in
        db.query(Account).filter(Account.item_id == item.item_id, Account.is_excluded == True).all()
    }

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
            if txn["account_id"] in excluded_account_ids:
                continue
            category_str = None
            if txn.get("personal_finance_category"):
                category_str = txn["personal_finance_category"].get("primary")
            elif txn.get("category"):
                category_str = txn["category"][0] if txn["category"] else None

            db_txn = Transaction(
                transaction_id=txn["transaction_id"],
                account_id=txn["account_id"],
                item_id=item.item_id,
                institution_name=item.institution_name,
                name=txn["name"],
                amount=txn["amount"],
                date=txn["date"],
                category=category_str,
                merchant_name=txn.get("merchant_name"),
                pending=txn.get("pending", False),
                needs_review=True,
            )

            # Dedup: skip if same account/date/amount/name already exists (Plaid occasionally
            # returns the same transaction with a different transaction_id)
            content_dup = db.query(Transaction).filter(
                Transaction.account_id == db_txn.account_id,
                Transaction.date == db_txn.date,
                Transaction.amount == db_txn.amount,
                Transaction.name == db_txn.name,
                Transaction.transaction_id != db_txn.transaction_id,
            ).first()
            if content_dup:
                continue

            saved_splits = []
            if manual_accts:
                plaid_acct = db.get(Account, txn["account_id"])
                matched_manual = _match_manual_account(plaid_acct, manual_accts) if plaid_acct else None
                if matched_manual:
                    csv_dup = db.query(Transaction).filter(
                        Transaction.account_id == matched_manual.account_id,
                        Transaction.date == db_txn.date,
                        Transaction.amount == db_txn.amount,
                    ).first()
                else:
                    manual_acct_ids = [a.account_id for a in manual_accts]
                    csv_dup = db.query(Transaction).filter(
                        Transaction.account_id.in_(manual_acct_ids),
                        Transaction.date == db_txn.date,
                        Transaction.amount == db_txn.amount,
                    ).first()
                if csv_dup:
                    if csv_dup.budget_sub_category and not db_txn.budget_sub_category:
                        db_txn.budget_sub_category = csv_dup.budget_sub_category
                    if csv_dup.custom_category and not db_txn.custom_category:
                        db_txn.custom_category = csv_dup.custom_category
                    db_txn.needs_review = csv_dup.needs_review
                    saved_splits = [
                        {"amount": s.amount, "category": s.category,
                         "note": s.note, "budget_sub_category": s.budget_sub_category}
                        for s in csv_dup.splits
                    ]
                    db.delete(csv_dup)
                    db.flush()

            db.merge(db_txn)

            if saved_splits:
                db.flush()
                for split_data in saved_splits:
                    db.add(TransactionSplit(transaction_id=db_txn.transaction_id, **split_data))

            new_ids.append(db_txn.transaction_id)
            added += 1

        for txn in response["modified"]:
            if txn["account_id"] in excluded_account_ids:
                continue
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

    item.sync_cursor = cursor
    item.last_synced_at = datetime.datetime.now(timezone.utc)
    _upsert_accounts(client, item.access_token, item.item_id, db)
    db.commit()
    if new_ids:
        apply_keywords_to_transactions(db, transaction_ids=new_ids)

    return added, modified, removed


def _build_manual_accts_map(db: Session) -> dict[str, list[Account]]:
    result: dict[str, list[Account]] = {}
    for mi in db.query(PlaidItem).filter(PlaidItem.access_token == "manual").all():
        accts = db.query(Account).filter(Account.item_id == mi.item_id).all()
        if accts:
            result.setdefault(mi.institution_name or "", []).extend(accts)
    return result


@router.post("/transactions/sync", response_model=SyncResponse)
def sync_transactions(db: Session = Depends(get_db)):
    """Sync all linked Plaid items."""
    items = db.query(PlaidItem).all()
    if not items:
        raise HTTPException(404, "No linked accounts. Complete the Link flow first.")

    client = _plaid_client()
    manual_map = _build_manual_accts_map(db)
    total_added = total_modified = total_removed = 0

    for item in items:
        if item.access_token == "manual":
            continue
        a, m, r = _sync_item(item, client, manual_map, db)
        total_added += a
        total_modified += m
        total_removed += r

    return SyncResponse(added=total_added, modified=total_modified, removed=total_removed)


@router.post("/items/{item_id}/sync", response_model=SyncResponse)
def sync_item(item_id: str, db: Session = Depends(get_db)):
    """Sync a single Plaid item."""
    item = db.get(PlaidItem, item_id)
    if not item:
        raise HTTPException(404, f"Item {item_id!r} not found")
    if item.access_token == "manual":
        raise HTTPException(400, "Cannot sync a manual CSV import item")

    client = _plaid_client()
    manual_map = _build_manual_accts_map(db)
    added, modified, removed = _sync_item(item, client, manual_map, db)
    return SyncResponse(added=added, modified=modified, removed=removed)


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
            "is_manual": i.access_token == "manual",
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
                    "is_excluded": a.is_excluded,
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
    if "is_excluded" in body:
        acct.is_excluded = bool(body["is_excluded"])
    db.commit()
    return {"account_id": account_id, "nickname": acct.nickname, "is_excluded": acct.is_excluded}


# ---------------------------------------------------------------------------
# Helper: fetch Plaid accounts and upsert into DB
# ---------------------------------------------------------------------------

def _upsert_accounts(client: plaid_api.PlaidApi, access_token: str, item_id: str, db: Session):
    try:
        resp = client.accounts_get(AccountsGetRequest(access_token=access_token))
    except plaid.ApiException:
        return  # non-fatal; we'll retry on next sync

    # Fetch institution name for this item (needed for cross-item joint account detection)
    this_item = db.get(PlaidItem, item_id)
    institution_name = this_item.institution_name if this_item else None

    for acct in resp["accounts"]:
        acct_subtype = str(acct["subtype"]) if acct.get("subtype") else None
        acct_mask = acct.get("mask")

        # Prefer to reuse an existing account row with the same identity
        # within this item so reconnects don't create duplicates.
        # When a mask is available use it as a discriminator so two cards
        # with the same generic name (e.g. "CREDIT CARD") aren't merged.
        q = db.query(Account).filter(
            Account.item_id == item_id,
            Account.name == acct["name"],
            Account.subtype == acct_subtype,
        )
        if acct_mask:
            q = q.filter(Account.mask == acct_mask)
        existing = q.first()
        if existing:
            existing.official_name = acct.get("official_name")
            existing.mask = acct_mask
            existing.type = str(acct["type"]) if acct.get("type") else None
            continue

        # Auto-detect joint accounts: if the same mask+subtype already exists
        # under a different non-manual item at the same institution, mark this
        # account as excluded so we don't sync it twice.
        is_excluded = False
        if acct_mask and institution_name:
            sibling = (
                db.query(Account)
                .join(PlaidItem, Account.item_id == PlaidItem.item_id)
                .filter(
                    PlaidItem.institution_name == institution_name,
                    PlaidItem.access_token != "manual",
                    Account.item_id != item_id,
                    Account.mask == acct_mask,
                    Account.subtype == acct_subtype,
                    Account.is_excluded == False,
                )
                .first()
            )
            if sibling:
                is_excluded = True

        db.merge(Account(
            account_id=acct["account_id"],
            item_id=item_id,
            name=acct["name"],
            official_name=acct.get("official_name"),
            mask=acct_mask,
            type=str(acct["type"]) if acct.get("type") else None,
            subtype=acct_subtype,
            is_excluded=is_excluded,
        ))
    db.commit()
