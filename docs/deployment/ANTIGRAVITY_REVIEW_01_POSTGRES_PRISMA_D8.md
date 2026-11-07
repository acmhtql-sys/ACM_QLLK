# Antigravity Task 01 — ACM PostgreSQL 17 / Prisma / DBA technical review

**Role:** You are a senior PostgreSQL 17 DBA and Prisma schema reviewer. Conduct a careful, independent-of-prior-AI-claims **technical code review**, not an approval or signature. Write all findings in Vietnamese.

**Repository:** `https://github.com/acmhtql-sys/ACM_QLLK`

**Pinned starting reference:** `codex/p3h-toolchain-security-probe-20261107` (Draft PR #41, stacked on #40 and #39). Also inspect `codex/cloud-staging-p2e-readonly-deploy-20261107` for effective Render staging source. Check latest commit hash at review time and record it.

**Required reference material:**
- [Issue #11 — receipt policy and Stage4C DDL hold](https://github.com/acmhtql-sys/ACM_QLLK/issues/11)
- [Issue #12 — PG1C independent cluster-creation approvals](https://github.com/acmhtql-sys/ACM_QLLK/issues/12)
- [Issue #13 — isolated migration / rollback / concurrency proof](https://github.com/acmhtql-sys/ACM_QLLK/issues/13)
- [Issue #14 — return-writer adapter and provenance](https://github.com/acmhtql-sys/ACM_QLLK/issues/14)
- [Issue #15 — release NO-GO](https://github.com/acmhtql-sys/ACM_QLLK/issues/15)
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/`, `apps/api/prisma/seed.ts`
- `apps/api/src/modules/borrow/borrow.router.ts` and `apps/api/src/modules/borrow/borrow.service.ts`
- `docs/deployment/ACM_D8_RELEASE_READINESS_GO_NO_GO_20261107.md` and `docs/deployment/ACM_D8_INDEPENDENT_REVIEW_PACKET_20261107.md`
- Stage4C/PG1C material described in Issues #11–#14. **If exact original Windows UAT artifacts or hash-pinned ZIP/scripts are not in this repository, report MISSING EVIDENCE, do not fabricate or silently replace them.**

## Mandatory inspection

1. Inventory actual Prisma models, indexes, compound FK/UNIQUE/CHECK constraints, critical transaction boundaries and migration history. Separate **current committed schema** from **unapproved Stage4C design**. Identify divergence with file and line numbers.
2. Evaluate receipt code proposal `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`, case sensitivity, duplicates, normalization, length and business constraints. **Do not decide on behalf of the business owner**; explain exact decisions needed.
3. Review borrow, return, partial returns, LOST/DAMAGED, quarantine, reservation, stock balance, audit and idempotency invariants. Look for over-return, duplicate COMMIT, concurrent requests, cross-location returns, non-atomic stock/receipt/audit, unsafe locks and missing provenance. Distinguish legacy borrow APIs from D8 return writer still blocked by Issue #14.
4. Review Stage4C migration plan forward/rollback, locking, Prisma client compatibility, RLS/permissions and possible destructive changes. Record whether source is missing.
5. Propose **non-destructive** verification SQL and exact local isolated-test scenarios (PG17 `127.0.0.1:55433`, intended new instance only), with expected PASS/FAIL and evidence capture. Do not execute SQL or create a cluster.
6. Assess restore/backup design and operator preflight: DB identity, checksum, independent signed approvals, RPO/RTO, offsite backup, failed restore recovery. Do not claim successful restore without actual evidence.

## Absolute safety restrictions

- **REVIEW ONLY.** No migrations, `prisma migrate deploy`, `prisma db push`, SQL write, seed, `DROP`, `TRUNCATE`, `RESET`, backups that expose secrets, PG cluster creation, real database connection, Render/Vercel/Supabase changes, payments, or git pushes/merges.
- No use of real or customer data and no secret/credential copying into prompts, files or logs. Treat any `.env`, `DATABASE_URL`, JWT, auth token or private dump as sensitive. Never request full credentials.
- Do not mark Issue #11/#12 as APPROVED, do not remove `503` guards, do not enable staging login/writes, and do not present an AI review as independent human DBA approval.

## Deliverable

Produce `ACM_ANTIGRAVITY_DBA_REVIEW_REPORT.md` locally with:
- Reviewed repository, branch, exact SHA, date, inspected artifacts and missing source evidence.
- Table **ID | Severity P0/P1/P2/P3 | File:line | Evidence | Reproduction without DB writes | Remediation | Release gate**.
- Explicit status for each requirement in #11, #12, #13, #14 as `VERIFIED`, `UNVERIFIED`, `BLOCKED`, or `NOT APPLICABLE` (never infer PASS from mocks).
- List of exact questions for business owner, DBA and authorized local PG operator.
- Proposed safe local isolated PG test matrix and rollback/restore evidence requirements.
- Final **TECHNICAL ASSESSMENT / RELEASE NO-GO** unless all human and DB-backed gates are actually met.
- Do **not** modify source code in this pass. Ask the user to approve specific patches in a separate task after review.
