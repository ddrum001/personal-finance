# Claude Code Instructions

## Workflow
- **Always push to GitHub after the user accepts a code change.** Do not wait to be asked. Commit and push immediately after changes are finalized.

## Databases
- **Production database is Railway PostgreSQL** — this is what the live app at personal-finance-roan.vercel.app uses.
- **Local `backend/finance.db` is a SQLite dev database** — it is NOT in sync with production. Never query it to check production state.
- **To query production:** use the Railway console → PostgreSQL service → Data → Query tab (free, no egress fees). Do not connect via DATABASE_PUBLIC_URL (incurs egress charges).
- **To fix production data:** run UPDATE/DELETE statements in the Railway Query tab, one statement at a time.

## Railway SQL console quirks
- **LIMIT does not work** — omit it from all queries
- Run statements one at a time; multi-statement batches silently fail
- Avoid `SET col = (SELECT ...)` subqueries — NOT NULL constraints cause silent failures
- Tuple IN comparisons `(a, b) IN (SELECT ...)` don't work — use `DELETE ... USING` for dedup
- Use `WHERE col LIKE 'prefix%'` instead of exact match when copy-pasting long IDs
