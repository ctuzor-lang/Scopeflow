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
