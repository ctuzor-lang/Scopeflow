# ScopeFlow

One agreed scope. Every change accounted for.

ScopeFlow keeps a shared, versioned record of what a supplier and its client agreed, assesses each change request against it, and records the client's decision. It is built by Chayse Consulting, used first on Chayse's own engagements, and designed to be resold to other consultancies as a white-label product.

## Status

Pre-build. Pilot slice in planning.

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
