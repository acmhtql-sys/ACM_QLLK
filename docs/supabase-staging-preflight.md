# ACM → Supabase Cloud: Staging preflight (PREPARE ONLY)

**Date:** 2026-10-29  
**Decision:** NO-GO for migrations, data import, cutover, PR merge, and production deployment.  
**Tracking:** [#21](https://github.com/acmhtql-sys/ACM_QLLK/issues/21), dependencies [#11](https://github.com/acmhtql-sys/ACM_QLLK/issues/11)–[#15](https://github.com/acmhtql-sys/ACM_QLLK/issues/15).

## Verified read-only inventory

- Supabase project `acm-qllk-staging`, ref `dqctxaoaxhtqtgmtsysk`, Singapore region, PostgreSQL 17.11, healthy at time of review.
- Supabase `public` schema contains **no tables**; migrations list empty; security advisor returned no notices. This is not a statement about application security.
- GitHub `main` has Express / Prisma 5 / TypeScript backend; `apps/api/prisma/schema.prisma` uses `DATABASE_URL` and `SHADOW_DATABASE_URL`.
- **Do not mistake GitHub main for the Stage4C UAT working tree.** Issue #14 reports nine local WIP paths absent from remote, a stale generated Prisma client, and a return-operations route currently returning HTTP 503.

## Architecture boundary

Browser/mobile frontend → existing ACM backend (authentication/authorization) → Prisma → Supabase PostgreSQL.

Do not put `DATABASE_URL`, service-role/secret keys, or privileged credentials in frontend code, git, test evidence, or browser-visible environment variables. No frontend direct write to inventory via Supabase Data API as part of this transition.

## Before any connection or schema modification

- [ ] Collect UAT WIP artifact with SHA-256; manually review diffs against pinned remote commit and scrub credentials/real data.
- [ ] Verify intended `acm-qllk-staging` project, separate from all real data, and record reviewer sign-off.
- [ ] Resolve Stage4C DDL, physical evidence/receipt policy and approval gates in #11/#12/#13.
- [ ] Select runtime connection type based on backend network: IPv6 direct or IPv4 session pooler for long-running backend, dedicated connection for maintenance/migrations when supported. Confirm TLS and connection limits. **Do not use transaction pooling blindly for Prisma interactive transactions.**
- [ ] Plan dedicated least-privilege application DB role and separate migration role; review Supabase's official Prisma instructions. Do not execute any example CREATE USER/GRANT statements without separate explicit approval.
- [ ] Decide Data API exposure: if solely Prisma, prefer disabling the Data API; otherwise protect every exposed table with correct grants and RLS policies. Validate application role permissions, including negative access tests.
- [ ] Verify Prisma version/client generation matches the pinned schema, and preserve `SHADOW_DATABASE_URL` isolation. Never point shadow database to a real or shared application database.
- [ ] Prepare synthetic fixtures, read-only validation script, constrained connection/retry tests, concurrency and idempotency scenarios, and backup/restore rehearsal.
- [ ] Obtain separate sign-off for any migration, SQL execution, actual writes, rollback exercise or cutover.

## Acceptance matrix

| Gate | Proof expected | State |
|---|---|---|
| Source parity | UAT artifact SHA and reviewed diff | BLOCKED |
| DDL/policy | DBA + business approvals, pinned SQL/schema | BLOCKED |
| Supabase connection | Environment identity, TLS, effective role, pooler mode | NOT RUN |
| Schema migration | Isolated approved DB, forward migration and rollback proof | NOT AUTHORIZED |
| Inventory integrity | FK/UNIQUE/CHECK negatives, atomic movement/receipt/audit | NOT RUN |
| Borrow/return | Full/partial return, idempotency, concurrent sessions, 503 removed behind gate | NOT RUN |
| Security | Auth/RBAC/IDOR, SQL privileges and RLS/Data API review | NOT RUN |
| Disaster recovery | Backup + verified restore on separate DB | NOT RUN |
| E2E + release | Approved integration test, evidence, independent release sign-off | NO-GO |

## References

- https://supabase.com/docs/guides/database/prisma
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/api/securing-your-api
- https://github.com/acmhtql-sys/ACM_QLLK/issues/21

**Important:** This file is documentation only. It does not create DB connections, credentials, schema, users, tables, migrations, or run any tests.
