Tests pass (35/35) and typecheck is clean. The production build fails because the session secret is checked at import time, so I'm making that check lazy, then I'll write the README.

I built the app and packaged it as `multi-tenant.tar.gz`. All 35 tests pass, and typecheck and `next build` are clean. I ran them against a local Postgres 16 on port 5433, because Docker isn't available in my sandbox. The `docker-compose.yml` uses the same port and credentials, but I haven't run it.

Run it with:

```
npm install
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev        # http://localhost:3000
npm test           # re-runs migrate and seed first
```

The README has the other commands. Seed users all use the password `password123`; `alice@acme.test` is a good first login (owner of Acme).

**How isolation works**

- **Database roles:** the app connects as `app_user`, which has no superuser or `BYPASSRLS` rights. A separate owner role is used only for migrations and seeding.
- **Row-level security:** all five tables have it enabled and forced, and only explicit policies grant access. The user identity is set per transaction from the signed session cookie. If it is missing or wrong, the identity is NULL and every policy denies.
- **Cross-workspace links:** notes use a composite foreign key, so a note can't point at a project in another workspace.
- **Identity:** workspace and project IDs in URLs or request bodies are only selectors, checked against the user's memberships in the database. A body ID that disagrees with the URL returns the same 404.
- **Not found:** a non-member, a nonexistent ID and a malformed ID all get the identical `404 {"error":"Not found"}`.

**Roles**

- Viewers can read.
- Editors can create and edit projects and notes, delete notes, and run Summarize.
- Owners can also delete projects, list members and invite members.
- Each rule is enforced in the route handlers (403) and again by the database policies.

**Summarize project**

- **Notes as untrusted input:** note text goes to the model only as JSON-escaped data inside an `<untrusted_notes>` block, and the system prompt tells the model to treat it as data.
- **Output validation:** the result must pass a strict schema before it is stored. It retries once; if it still fails, the API returns 502 and saves nothing.
- **Flagging:** notes that look like injection attempts are flagged, which is informational only.
- **Mock provider:** it needs no API keys, and `MOCK_LLM_MALFORMED_ONCE=1` makes it return garbage on its first call.

**Edge cases**

1. The swapped-ID attacks are tested three ways in `tests/isolation.test.ts`: in the URL, in the request body, and as direct database calls. Real and random IDs give identical results.
2. The malformed-once and "ignore previous instructions" case is in `tests/summary.test.ts`. The app retries, stores a valid summary, flags the note, and no data is deleted.

**Known limits** (also in the README)

- CSRF protection relies on `SameSite=Lax` and JSON bodies.
- There is no rate limiting, member removal, or last-owner protection.
- Invites only work for users who already exist.
- Tests share the seeded database and run one file at a time.
