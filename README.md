# ScopeFlow

One agreed scope. Every change accounted for.

ScopeFlow keeps a shared, versioned record of what a supplier and its client agreed, assesses each change request against it, and records the client's decision. It is built by Chayse Consulting, used first on Chayse's own engagements, and designed to be resold to other consultancies as a white-label product.

## Status

Slices 1–2 built, not yet deployed:

- Slice 1: email-code sign-in, tenant-aware workspace, white-label branding settings, audit trail
- Slice 2: projects, scope import from Excel/CSV (template at `/projects/template.csv`), draft editing, locked and fingerprinted baseline versions with changes shown against the previous version

## Running it locally

Needs Node.js 20+ and PostgreSQL 16.

```bash
npm install
cp .env.example .env            # then set DATABASE_URL and SECRET_KEY
echo "DEV_TENANT_SLUG=chayse" > .env.development   # dev only: lets localhost open the Chayse workspace
npm run db:migrate
npm run tenant:create -- --slug chayse --name "Chayse Consulting" \
  --admin-email you@chayse.com --hostname app.chayse.com --verified
npm run dev                     # http://localhost:3000 ; sign-in codes print in the terminal
npm test                        # needs a scopeflow_test database (see tests/setup.ts)
```

## Deploying (one.com cloud server)

1. Install Node.js 20+ and PostgreSQL 16; create a database and user.
2. Set the environment variables from `.env.example` (production values, `MAIL_TRANSPORT=smtp`, no `DEV_TENANT_SLUG`).
3. `npm ci && npm run build && npm run db:migrate`
4. Run `node .next/standalone/server.js` with `PORT` set, bound to 127.0.0.1, under a process manager. Copy `.next/static` to `.next/standalone/.next/static` first.
5. Point app.chayse.com at the server; the web server proxies to the app and sets `X-Forwarded-Host`.

See `docs/review-notes.md` before any real client uses it.

## Agreed decisions (6 Nov 2026)

| Topic | Decision |
| --- | --- |
| First customer and operator | Chayse Consulting |
| Hosting for the pilot | one.com cloud server, Copenhagen (EU). Move to a UK region to be considered before reselling |
| Chayse portal address | app.chayse.com |
| Build route | AI-assisted build directed by Chayse, independently security-reviewed before any real client uses it |
| White label | Designed in from the start: tenant branding, custom domains, branded email and exports |

## Pilot slices

1. Sign-in, the Chayse workspace and tenant branding
2. Import an agreed scope and publish it as a versioned baseline
3. Raise a change request and record its impact
4. Client approval by email code, with authority confirmation and an audit trail
5. Branded emails and the change control note PDF
6. AI suggestions on change requests (advisory only)

## Design documents

- Functional Requirements (FRS-001)
- Product and UX Design (UX-002)
- Technical Architecture

The current versions include the white-label additions (v0.10).

## Keeping a later move cheap

- Run the app and worker as standard processes or containers
- Keep all configuration in environment variables
- Use plain PostgreSQL, no host-specific extensions
- Store files through an S3-compatible interface
- Take a nightly database dump to separate storage, in addition to the host's backups
