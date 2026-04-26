# Claude Code Instructions

## Workflow
- **Always push to GitHub after the user accepts a code change.** Do not wait to be asked. Commit and push immediately after changes are finalized.

## Databases
- **Production database is Neon Postgres** — this is what the live app at personal-finance-roan.vercel.app uses.
- **Backend is hosted on Render** at `https://personal-finance-api-y9rd.onrender.com`. Render auto-deploys from the `main` branch on GitHub.
- There is no local SQLite fallback — `DATABASE_URL` must be set or the app will raise a `RuntimeError` on startup.
- **To query production:** use the Neon console → SQL Editor tab.
- **To fix production data:** run UPDATE/DELETE statements in the Neon SQL Editor, one statement at a time.

## Neon SQL console quirks
- Run statements one at a time; multi-statement batches can behave unexpectedly
- Avoid `SET col = (SELECT ...)` subqueries — NOT NULL constraints cause silent failures
- Tuple IN comparisons `(a, b) IN (SELECT ...)` don't work — use `DELETE ... USING` for dedup
- Use `WHERE col LIKE 'prefix%'` instead of exact match when copy-pasting long IDs
