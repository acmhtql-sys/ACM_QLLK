# ACM D8 — Supabase Cloud migration feasibility and isolated sandbox gates
**Status: DESIGN / REVIEW ONLY — RELEASE NO-GO — 2026-10-29**

## Decision and immutable scope
Owner chose **Option A: Supabase Cloud for primary database after a verified migration**. Preserve current React frontend, Express API, Prisma ORM, JWT/RBAC and existing business logic. **This decision does not approve provisioning, database connections, SQL, migration, data transfer, cutover, or payment.** Existing PG17 (#12) and DBA (#11) approvals are not silently fulfilled or cancelled: propose a formally reviewed change of test environment, and amend #12/#13 after the relevant owners decide.

**Source baseline**: PR #18 head `935d86c132fea9b445fccfb912c57484c08366e4`; parent PR #17 code `07c12670a062ee9fc1836a7b0b4dda55e7de8cff`; Windows + safe Linux mock tests 207/207 PASS. PRs #16–#18 remain Draft; main untouched.

## Confirmed ACM integration characteristics
- Prisma 5.x schema at `apps/api/prisma/schema.prisma`: datasource provider `postgresql`, `DATABASE_URL`, `SHADOW_DATABASE_URL`; twenty models in previously generated Prisma Client.
- `apps/api/src/config/database.ts` injects `env.DATABASE_URL` into PrismaClient, and includes a real `SELECT current_database()` health helper. **Do not call or import this code in a P0 preflight**.
- `apps/api/src/config/env.ts` requires an isolated `.env.test` and checks `acm_inventory_test` for Vitest; never point tests at a Supabase project, even if the name contains this substring. Keep mock CI with dummy `127.0.0.1:1`.
- `apps/api/src/modules/borrow/borrow.service.ts` runs Serializable transactions with parameterized `FOR UPDATE` row lock, and route `/:id/return-operations` is hard 503. Feature flag `ACM_RETURN_OPERATIONS_ENABLED` stays false.
- Current `.env.example` already mentions Supabase pooler but should **not** be interpreted as approved connection configuration.

## Proposed target architecture
React → Express/JWT/RBAC → Prisma ORM → isolated Supabase PostgreSQL for business tables; optional Supabase Storage for file attachments only after a separate design gate. **No direct browser-side DB credentials, no new Auth migration, no use of service-role keys in frontend.** If a Supabase Data API exposes public-schema tables, evaluate disablement or correct RLS/policies; do not rely on Express RBAC to protect an independently exposed Data API.

## Connection mode decision (not yet applied)
- Long-running Express with IPv6: Supabase **direct** connection (typically port 5432), if network permits; for IPv4-only hosting: shared **session pooler** (port 5432).
- Serverless/short-lived connections: assess **transaction pooler** (port 6543) only with a separate risk review and compatible Prisma `pgbouncer=true`; transaction pooler does not preserve session state and has prepared statement limits. Do NOT use it blindly with D7 lock-first/Serializable until atomicity proven.
- Migrations, dump/restore and other admin work: dedicated **direct session** per vendor guidance, with a separately authorized least-privilege migration role and explicit DBA-approved, SHA-pinned SQL. Current Prisma datasource still references `SHADOW_DATABASE_URL`; prohibit dev migration against shared or production cloud.
- Secrets: use environment secret manager, private backend only, TLS required; confirm certificate verification strategy (`sslmode=require` encrypts but alone does not verify hostname). Copy connection strings from project Dashboard → Connect; never assemble pooler host or paste credentials into GitHub chat/issues.

## Staged gates and acceptance
**P0 — DONE WHEN**: static source-only review/PR and documented exact application baseline; no network connections, no DB activity.
**P1 — HUMAN DECISIONS PENDING**: Approve provider/region/cost/residency/backup/RPO/RTO, identity of project owner, independent security reviewer and DBA, data policy, rollback, and explicit permission to create an *isolated empty test* project. Complete #11 business+DBA design decision; formally review replacement of local PG17 #12 gate with cloud equivalence. No secrets in PR.
**P2 — AFTER APPROVAL**: owner creates project using official dashboard/account with MFA, budget alert and database network restrictions. Reviewer checks project identity and blank state. Limited read-only connectivity probe only after separate, scoped authorization (no Prisma migrate, no seed). Do not claim project exists now.
**P3 — SEPARATE DB-CHANGE AUTHORIZATION REQUIRED**: compare exact Prisma models, migrations, catalog, extension/version compatibility, composite FK/CHECK/UNIQUE and partial indexes; DBA-approved forward and guarded rollback on empty isolated project and synthetic data only; establish backup/restore proof.
**P4 — REAL TRANSACTION INTEGRATION**: true two-session PostgreSQL concurrency for PREPARE/COMMIT, stock/receipt/audit atomicity, idempotency replay and lock order, RBAC/IDOR and frontend/backend E2E, error/retry behavior and connection pool limits.
**P5 — SEPARATE PRODUCTION CUTOVER**: approved actual data inventory, data protection and migration plan, freeze/export/import reconciliation, backups/restore, observability, security review and release GO by authorized humans. Never import real data into test.

## Explicit STOP conditions
- Any unauthenticated approval or missing independent DBA/security signoff;
- Any attempt to alter UAT, main, merge PRs, enable Stage4C route/writer, use real credentials in Git, expose Postgres to browser, run SQL/migrations/seed or transfer real data;
- Unexpected remote host, mismatch of project identity or network/cost boundary;
- Missing rollback evidence or mismatch between Prisma and actual DB.

**Current**: Supabase project NOT CREATED/NOT VERIFIED, connection NOT TESTED, migration NOT AUTHORIZED, production RELEASE NO-GO. Eight D6 release blockers remain OPEN.

## Sources
- Supabase connection methods: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase Prisma: https://supabase.com/docs/guides/database/prisma
- Supabase Prisma pooler troubleshooting: https://supabase.com/docs/guides/database/prisma/prisma-troubleshooting
