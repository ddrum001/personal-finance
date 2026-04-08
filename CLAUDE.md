# Claude Code Instructions

## Workflow
- **Always push to GitHub after the user accepts a code change.** Do not wait to be asked. Commit and push immediately after changes are finalized.

## Railway SQL console quirks
- **LIMIT does not work** — omit it from all queries
- Run statements one at a time; multi-statement batches silently fail
- Avoid `SET col = (SELECT ...)` subqueries — NOT NULL constraints cause silent failures
- Tuple IN comparisons `(a, b) IN (SELECT ...)` don't work — use `DELETE ... USING` for dedup
- Use `WHERE col LIKE 'prefix%'` instead of exact match when copy-pasting long IDs
