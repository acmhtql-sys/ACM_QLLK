# ACM D8 — Independent Reviewer Packet (HUMAN APPROVAL REQUIRED)

**Date:** 2026-11-07 · **Status:** PREPARED, NOT REVIEWED · **Target:** GitHub repo `acmhtql-sys/ACM_QLLK`

This packet assigns **no review decisions** and cannot replace a qualified human reviewer/DBA. Check actual code and original artifacts; do not approve based solely on this text.

## 1. Required reviewers and their scope

| Reviewer (real person) | Separate decision needed | Where to record it | Current evidence |
|---|---|---|---|
| Business owner / lab operations | Receipt numbering regex `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`, source-location return behavior, LOST/DAMAGED logic, role boundaries | [Issue #11](https://github.com/acmhtql-sys/ACM_QLLK/issues/11), [RBAC #9](https://github.com/acmhtql-sys/ACM_QLLK/issues/9) | Pending |
| DBA | Stage4C Prisma/DDL diff, NOT NULL/FK/CHECK, idempotency constraints, row locking, safe forward/rollback, backup integrity | [Issue #11](https://github.com/acmhtql-sys/ACM_QLLK/issues/11) | Pending |
| Owner (PG1C scope) | Explicit decision on *new* isolated PostgreSQL 17 instance, path/port/checksum limitations | [Issue #12](https://github.com/acmhtql-sys/ACM_QLLK/issues/12) | Pending |
| Independent technical reviewer (different human than PG1C owner) | PG1C script review, DB host/port isolation, rollback/error handling | [Issue #12](https://github.com/acmhtql-sys/ACM_QLLK/issues/12) | Pending |
| Security / code reviewer | Auth, RBAC, validators, XSS, CORS, stale token cleanup, idempotency FSM, audit protection, dependency behavior | PR #39, #40, #41 reviews | Pending |
| QA / real user representatives | Manual four-role UAT, stock ledger, return full/partial/lost/damaged, restore rehearsal | [#8](https://github.com/acmhtql-sys/ACM_QLLK/issues/8), [#10](https://github.com/acmhtql-sys/ACM_QLLK/issues/10), [#15](https://github.com/acmhtql-sys/ACM_QLLK/issues/15) | Pending |

Reviewers must record **name, role, independent source reference, UTC timestamp, scope, outcome APPROVE/REJECT/CHANGES_REQUESTED and conditions**. Never fabricate an identity or treat ChatGPT analysis as independent human signoff.

## 2. Review order and code paths

**PR #39 — security / fail-closed staging**
- `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/hooks/useAuth.tsx`: never create offline mock Admin session, remove stale mock token, no default credentials.
- `apps/api/src/middleware/cloudStagingReadOnly.ts`, `apps/api/src/middleware/auth.ts`: all mutation methods 403 on Cloud Staging; method overrides blocked, private GETs 401, catalog/stock anonymous reads denied.
- `apps/api/src/app.ts`, `apps/api/src/middleware/errorHandler.ts`: reject compressed request bodies with 415; no parser body zip-bomb.
- `apps/web/vercel.json`: SPA deep-link fallback only; avoid unintended API rewrites.
- `docs/deployment/ACM_CLOUD_P3_F_SECURITY_ACCEPTANCE_20261107.md`, `scripts/p3f-live-readonly-acceptance.mjs`.
- **Deployment drift:** Render runs a *different* staging source branch `codex/cloud-staging-p2e-readonly-deploy-20261107`. Review its `render.yaml` with `ALLOW_STAGING_AUTH_LOGIN=false`, and service environment before any sync. This PR does not authorize a Blueprint update.

**PR #40 — Zod 4 validation & transaction FSM**
- `packages/shared/src/validators.ts` / tests: compare Zod3→4 error messages and UUID-like value contract; validate strictness and all required fields.
- `apps/api/src/middleware/validateRequest.ts`, `apps/api/src/middleware/errorHandler.ts`, `apps/api/src/modules/*/*.router.ts`: API 422 errors and RBAC remain compatible; request/query/params transformed values typed correctly.
- `apps/web/src/components/stock-transactions/StockImportModal.tsx`, `StockExportModal.tsx`, `StockTransferModal.tsx`: mandatory Review→Confirm; never let manual client notes unlock reconciliation.
- `apps/web/src/hooks/useIdempotentTransaction.ts`: HTTP 504 ambiguous requires GET-only status lookup; HTTP 409 payload conflict must not post again or rotate key without server proof.
- `apps/web/playwright/tests/06-stock-transactions.spec.ts`, `apps/web/playwright/fixtures/synthetic-data.ts`: isolated browser fixture values must match actual UUID contracts; never authorize writes to live backend.

**PR #41 — dependency toolchain**
- `package.json`, `package-lock.json`, workspace manifests: patched Vitest, Vite, Undici, qs, postcss-selector-parser. Check registry integrity and compatible Node runtime.
- `packages/shared/package.json`: Vitest 4 runs source tests; no silent reduction of test coverage.
- `.github/workflows/ci.yml`, `.github/workflows/p3g-mock-browser-e2e.yml`: CI-only synthetic PostgreSQL, Playwright localhost network isolation, audit findings; no secrets, remote writes or production deployment.
- Remaining Moderates in release candidate: `react-router` and `react-router-dom`; owner/security reviewer must accept risk explicitly or authorize isolated major-version migration with regression proof. Do not treat zero High/Critical as all advisories fixed.

## 3. Technical evidence and limitations

- PR #39 live Staging negative test: 403 for mutation requests to **nonexistent** routes; 401 on private GET; 415 compressed body, expected CORS. Does not exercise successful business writes.
- PR #40/41 mock browser: 36 executed PASS, 1 Mode B deferred; no real cloud data or full D8 writer.
- PR #41 CI #280: builds, typecheck, lint, unit, GitHub-local PostgreSQL synthetic integration PASS; **not** a Stage4C migration/rollback signoff.
- Automated release-gate read-only snapshot: [Actions #42375409098](https://github.com/acmhtql-sys/ACM_QLLK/actions/runs/42375409098), confirms Issues #11–#15 OPEN and no PR approvals recorded. A green snapshot workflow does not mean release readiness.
- Existing return-writer D8 blocker: [Issue #14](https://github.com/acmhtql-sys/ACM_QLLK/issues/14) records hard-503 and missing provenance/Prisma integration. Do not infer it is complete from legacy `borrow-requests` routes.

## 4. Reviewer check-and-sign template

**PR / artifact and exact commit SHA:** [real value]
**Reviewer real name and role:** [real value]
**Independent from author and owner?** [yes/no + evidence]
**Areas inspected and files/lines:** [real values]
**Findings classified P0/P1/P2/P3:** [real issue links]
**Decision (APPROVE / REJECT / CHANGES_REQUESTED):** [real decision]
**UTC time / approval channel / durable reference:** [real values]
**Conditions before merge/deployment:** [specific conditions]

No placeholder is an approval. If any required reviewer is unavailable, classify gate **BLOCKED**, not PASS.

## 5. Next owner action

Nominate a qualified independent technical reviewer and a DBA; obtain distinct, traceable approvals on #11 and #12. Only then let the authorized Windows operator run the checksum-pinned PG1C review preflight. **The general instruction to finish ACM quickly is not the narrow PG1C Create or migration authorization.**

**Release decision:** `NO_GO` until #11→#12→#13→#14→#15 are genuinely complete and restore + owner signoff are witnessed.
