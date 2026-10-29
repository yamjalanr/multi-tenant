# Tenant notes

Workspaces -> projects -> notes. Isolation is enforced by Postgres row-level security.

## Run
    npm install
    npm run db:up        # Postgres 16 in Docker (port 5433)
    npm run db:migrate
    npm run db:seed      # users alice/bob/carol, password: password123
    npm run dev          # http://localhost:3000   (MOCK_MALFORMED_ONCE=1 to see the retry)

## Test
    npm run db:up && npm test     # migrates automatically, reseeds per test

## Design
- The app connects as `app_user` (no superuser, no BYPASSRLS). Each request runs in a transaction that
  sets `app.user_id` (from the signed session cookie only). No setting => `app_uid()` is NULL => every policy
  evaluates to NULL => deny. All 5 tables have RLS enabled AND forced; a test fails if any public table lacks it.
- Role checks (`app_role(ws)`) are security-definer SQL, used by policies and by the server (403 for members
  lacking permission). Non-members get the same 404 as for nonexistent IDs.
- Workspace/project IDs in URL/body are only lookups scoped by RLS; the server never accepts a user id or
  a workspace id from the body. Invites go through `app_invite()` (owner-only, silent no-op for unknown emails).
- Summaries: note text is escaped and wrapped in `<note>` tags, system prompt marks it as data, output must pass a strict
  zod schema (one retry) before storing; failures return 502 and store nothing. Flagged "injection-looking" notes are counted by the app.
