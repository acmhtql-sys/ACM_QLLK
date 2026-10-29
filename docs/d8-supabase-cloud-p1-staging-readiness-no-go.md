# D8 SB-P1 — Supabase staging readiness (NO DATABASE ACTIONS)

Status: REVIEW ONLY / RELEASE NO-GO / 2026-10-29.
Prerequisite: SB-P0 Draft PR #19, review-only GitHub CI PASS. Current app source is inherited unchanged from WR7G/WR7F.

## Discovered cloud project — *metadata only*
- Organization: ACM-QLLK.
- Project: `acm-qllk-staging` (ref `dqctxaoaxhtqtgmtsysk`), `ap-southeast-1`, PostgreSQL 17.11, ACTIVE_HEALTHY.
- Supabase metadata API returned **no public tables, no tracked Supabase migrations and no development branches**. Security/performance advisors returned zero findings at the observed snapshot. This does **NOT** establish the entire database is empty, that there are no sensitive objects in other schemas or that the project is authorized for experiments.
- No SQL, user data, keys, schema alterations or network connection from the ACM backend was involved in this checkpoint.

## Why a strict offline endpoint-shape gate
- Keep React → Express/JWT/RBAC → Prisma → PostgreSQL. Do not move database credentials into React, and do not replace ACM Auth in this change.
- Persistently running Express can use direct Postgres connection on IPv6 or a **session** pooler on IPv4-only infrastructure. The **transaction** pooler (6543) needs separate review: prepared statement limitations and real concurrency behavior are not proven.
- Before using a candidate app URL, `scripts/d8-supabase-p1-url-guard.cjs` can statically reject wrong project/host/port, missing TLS-verifying intent, schema mismatch, disabled TLS, unapproved transaction mode and arbitrary query params. It does **not** open a socket, read `.env`, access Supabase, verify TLS certificates or server/database identity. Never treat success as connection approval.
- In this first stage the guard **requires** a `verify-ca` or `verify-full` TLS verification policy, but driver support and runtime certificate trust must still be established before connecting. It pins the staging project's published ref, direct hostname or session pooler pattern in Singapore, and `postgres` DB in `public`. All values must be independently checked against **Dashboard → Connect**; the session pooler host is not inferred to be a confirmed endpoint. It rejects transaction pooling on port 6543.
- Store any real database URLs **only** in the backend's approved secret manager, never in GitHub issues, logs, chat or scripts. `ACM_SUPABASE_CANDIDATE_DB_URL` CLI mode (not used in CI) must not be executed with real credentials until cloud-access scope is explicitly approved. The CI suite uses **synthetic fake passwords only**.

## No-data migration and RBAC threat model
- Supabase Data API and Prisma direct PostgreSQL access have different security boundaries. **Before creating any ACM tables**, decide whether to disable the Data API for this server-only architecture, or use a private unexposed schema, or enable RLS plus audited explicit grants for every exposed table. A blank security-advisor result today is NOT permission to expose future tables.
- Preserve legacy row-lock and Serializable consistency semantics for borrow/return. Need a real two-session transaction/replay proof on a separately authorized empty project populated with synthetic fixtures before writer release. Keep `ACM_RETURN_OPERATIONS_ENABLED=false` and HTTP 503 for unfinished endpoint.
- Existing Prisma schema has `DATABASE_URL` and `SHADOW_DATABASE_URL`; NEVER point a shadow database URL at the same project/database as the target, and NEVER run `prisma migrate dev` against a shared Supabase environment. DBA must separately review approved forward/rollback migrations, extensions, IDs, enum constraints and shadow strategy.
- Not a replacement for production backup/recovery, migration history reconciliation, region/retention/cost decision, operator/DBA ownership or independent approval.

## Stage decision register
| Gate | Status | What must be verified |
|---|---|---|
| P0 static feasibility + CI | PASS | Existing PR #19 P0 source-only CI, prior Windows/Linux 207/207 mock tests |
| P1 staging metadata | READ-ONLY REVIEWED | Project name/ref/version/region, public table/migration summary, advisors |
| P1 URL synthetic unit gate | **CI PASS (21/21)** | Job `40876023726/123454920962` success on GitHub Actions; no DB/network writes or secrets |
| P1 owner/security/DBA decisions | **HOLD** | Exact project ref, accountable operator, budget, region, RBAC/Data API design and approvals |
| P2 identity and read-only connectivity | **HOLD** | Requires authenticated project approval and scoped connect authorization |
| P3 DDL/migration on synthetic data | **HOLD** | DBA approved byte-exact SQL/rollback, independent test environment and restore proof |
| P4 concurrency/E2E | **HOLD** | Two-session PostgreSQL writer/inventory/RBAC frontend E2E |
| P5 real-data cutover | **HOLD** | Backup, import reconciliation, authorized release GO |

STOP on missing approvals, changed project ref, cloud credentials in code, SQL/seed/data transfer or attempted merge/deploy. Eight D6 blockers remain OPEN; RELEASE NO-GO.

## Official docs reviewed
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/database/prisma
- https://supabase.com/docs/guides/database/secure-data
- https://supabase.com/docs/guides/api/securing-your-api
