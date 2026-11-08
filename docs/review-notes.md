# Notes for the independent security review

Things a reviewer should look at closely, and known gaps deliberately left for later slices.

## How tenants are kept apart

- The tenant is resolved from the request address (`src/lib/tenant.ts`). Only verified hostnames count.
- Sessions are stored per tenant and only accepted on the tenant that issued them (`userForSession`).
- Sign-in codes are keyed to tenant + email, so a code issued on one tenant's address fails on another.
- Session cookies are host-only (no `Domain` attribute), HttpOnly, SameSite=Lax, and Secure in production.
- Tests: `tests/auth.test.ts` ("tenant isolation").

## Proxy trust

Next.js renders redirects from form actions through an internal hop that moves the real address into
`X-Forwarded-Host`. The app therefore reads that header (`TRUST_PROXY=true`). This is only safe if the
app listens on 127.0.0.1 and is reachable solely through the web server in front of it, which must set
`X-Forwarded-Host` itself and not pass through a client-supplied value.

## Scope and baselines (slice 2)

- Every scope row carries `tenant_id`, and composite foreign keys stop a row pointing at another tenant's project.
- Published baselines, their items and item revisions are protected by database triggers: content can't be
  updated or deleted; only a baseline's review status may change.
- Each baseline stores a SHA-256 fingerprint of its content; the version page recomputes it on every view.

## Client decisions (slice 4)

- Client people have per-project access only; every agency page and server action rejects a client session.
- A decision binds to one published revision (id + fingerprint). If a newer revision exists, it is refused.
- Decisions and comments are append-only at database level; one decision per change request.
- Emails never contain prices or message text (FR-017); they link to the signed-in page.

## AI suggestions (slice 6)

- Off unless `ANTHROPIC_API_KEY` is set on the server **and** a workspace admin turns it on.
- Sends only the change request title/text and the agreed items of the version it was raised against.
  No prices, client organisation, names or email addresses (tested).
- Request text is fenced with random markers and the model is told to treat it as data. Output is
  schema-validated; unknown item references are dropped; nothing is applied without a person accepting it.
- Every run records model, prompt version and an input fingerprint (not the content).
- **Contract point:** Anthropic becomes a subprocessor for workspaces that turn this on. Add it to the
  subprocessor list and check client contracts before enabling it for a client's project.

## Known gaps to close before a real client uses it

- **Approval wording** (`authorityStatement` in `src/lib/decisions.ts`) is a draft. A lawyer must review it.
- Client access doesn't expire on its own (FRS-001 FR-003 asks for expiring invitations); it lasts until removed.
- Incorporating an approved change into the next scope version is manual for now (edit the draft, publish);
  the link from change to new version (FR-016) comes in a later slice.

- Spreadsheet import reads uploaded .xlsx files with ExcelJS, capped at 5 MB and 1,000 rows. A reviewer
  should check decompression limits (very compressed .xlsx files) and run imports in a background job.
- Request timing differs slightly between member and non-member addresses on "Email me a code"
  (only members trigger database writes and an email). Consider sending in a background job.
- Rate limiting is per tenant + email only; add a per-IP limit at the web server or in the app.
- No Content-Security-Policy header yet (Next.js inline scripts need a nonce setup).
- Customer domain verification by DNS (FR-029) is modelled but not built; the operator script marks
  domains verified, so it must only be used for domains the operator controls.
- Logos are stored on local disk; move to S3-compatible storage before running more than one server.
- Audit chain verification exists (`verifyAuditChain`) but nothing runs it on a schedule yet.

## Observed after going live (8 Nov 2026)

- Within minutes of DNS going live, automated scanners sent bogus Next.js server-action IDs ("Server Reference ID did not match"). They were rejected. Consider rate limiting or blocking at nginx, and log monitoring.
- `npm audit --omit=dev`: postcss (via next, build-time only, no untrusted CSS processed) and uuid (via exceljs, the affected buffer API isn't used). Re-check when Next 16 / exceljs updates are adopted.
- Sign-in codes were written to the server log until SMTP was configured. Once email is on, the log no longer contains codes; older journal entries age out under journald's normal rotation.

## Independent security review, 8 Nov 2026 — status

Reviewed by a separate agent with no part in building the code (findings F1–F11). Fixed in the release after cf52b9d:

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| F1 | High | Changes and version pages leaked data without sign-in (check only in layout) | **Fixed**: every page checks access; test fails the build if a page doesn't. Verified against a production build (no data before sign-in, including RSC requests). |
| F2 | Medium | 12 KB spreadsheet could exhaust memory and crash the app | **Fixed**: inflate with a 25 MB cap and check rows/columns before ExcelJS loads it; test with the reviewer's file. |
| F3 | Medium | Display names on the shared user table can be set by another tenant | **Open; must fix before a second tenant goes live.** Only one tenant exists today. Plan: store names per membership/project access. |
| F4 | Medium | App's database account owned the tables, so it could disable triggers or truncate | **Fixed**: `scopeflow_owner` owns everything; the app can only read/write rows. Migrations come from the root-owned clone. Verified: ALTER/TRUNCATE/DROP refused for the app role. **Open:** key the audit hash chain (HMAC) and anchor daily heads off-server. |
| F5 | Medium | Code guessing: 2,400 guesses/day; simultaneous requests bypassed the limit | **Fixed**: per-address lock; 10 wrong codes per 24 h then locked for the day; nginx POST rate limit. Tests added. |
| F6 | Medium | Nightly backup failed every night; restore steps wrong | **Fixed**: root-only folder, verified dump, retention works; runbook corrected. **Open:** encrypt and copy backups off-server. |
| F7 | Low | Backup script followed planted symlinks as root | **Fixed** (root-only 0700 folder, mktemp). |
| F8 | Low | Stored approval wording could differ from what the client saw | **Fixed**: the page sends a hash of the wording; approval refused if it differs. |
| F9 | Low | Sign-in timing revealed membership | **Fixed**: email sent in the background. |
| F10 | Low | HTTPS catch-all missing; no rate limits; nginx version shown | **Fixed**: 443 default rejects unknown names; per-IP limits; server_tokens off. Tested with nginx locally. |
| F11 | Low | Production silently logs sign-in codes when email isn't set | **Partly**: loud warning at start-up; still allowed for first-time setup. |
| Info | — | CSP, extra systemd hardening, email in URLs, AI free-text minimisation, AI hourly limit race | Open, low priority. |

Also found while verifying the fixes: the production build was missing files that the scope page (spreadsheet import) and the change control PDF need, so both would have failed on the live server. Fixed in next.config.ts and checked against a production build.

## Public demo (added 8 Nov 2026) — for the next security review

New public surface: `/tour` and the `startDemoAction` / `switchDemoRoleAction` / `endDemoAction` server actions, live only on `DEMO_HOSTNAME`. Points to check:
- Tenant on the demo host comes only from the HMAC-signed `sf_demo` cookie and only for tenants with `sandbox_expires_at` in the future; `resolveTenant` (real hosts) excludes sandboxes. Tests cover forged/garbage cookies and a real tenant's id.
- `openSession` creates sessions without a code; it's called only from the demo actions, which check the demo host and that the tenant is a sandbox.
- Abuse limits: 5 sandboxes per IP per hour, 300 active, 5 projects per sandbox, nginx POST rate limit. No email (mailerFor), no AI, no logo upload; invitations rewritten to `@sandbox.invalid` so no real `app_user` rows (avoids F3 via the demo).
- `scopeflow-demo-cleanup` runs as the postgres superuser with `session_replication_role = replica` to bypass the immutability triggers, scoped to sandbox tenants and `@sandbox.invalid` users. Covered by a test that checks a real tenant's audit trail survives.
