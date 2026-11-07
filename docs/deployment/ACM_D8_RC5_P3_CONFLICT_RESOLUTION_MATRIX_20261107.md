# ACM D8 — RC5 vs P3/P0/P1 merge conflict resolution matrix

**Date:** 2026-11-07 UTC · **Decision:** `RC5_MERGE_BLOCKED_9_CONFLICTS` · **Draft / review-only, no merge to any deployment branch**

## Pinned sources

- **Render live source** `codex/cloud-staging-p2e-readonly-deploy-20261107` @ `9d0e797116c72e65dd86e0fe7c5652d815851864`.
- **Security+business candidate** `codex/d8-p1-return-idempotency-20261107` @ `17728e6d19da39f59338c159e16a40dfa22b018e` (Draft PRs #39 → #40 → #41 → #45 → #46, not merged).
- **Isolated review branch** `codex/d8-rc5-consolidation-preflight-20261107` created from the exact Render source. **Render remains on its original branch.**
- [Real GitHub Actions local merge preflight](https://github.com/acmhtql-sys/ACM_QLLK/actions/runs/42382868797): exit code **1** from `git merge --no-commit --no-ff`, **9 file conflicts**. The reporting workflow showed SUCCESS because conflict reporting was deliberately non-blocking; this must **never** be interpreted as a successful merge. The merge was aborted on the runner, no branch push or production deployment.

### Why merge is not a mechanical file copy

GitHub compare shows **34 unique RC5 commits** and **115 unique candidate commits**; they diverge from `main`. There are **16 file overlaps by name**, **9 real Git merge conflicts**, plus automatically merged files that may still have TypeScript/API semantic incompatibilities. The RC5 source includes a richer borrow/return UI, kits, reports, categories, users, and security hardening absent from the candidate branch; replacing it wholesale would cause functional regression.

## Exact conflict list and reconciliation policy

| File (from live preflight) | RC5 functionality that must survive | Candidate change worth preserving | Safe resolution approach; NOT yet implemented |
|---|---|---|---|
| `apps/api/package.json` | Extended RC5 tests, all runtime dependencies/scripts | Vitest 4 and new PostgreSQL return concurrency test | Merge scripts as a union, retain RC5 tests and append new test; upgrade Vitest in reviewed lockfile |
| `apps/api/src/middleware/auth.ts` | Strict Cloud Staging read-only authentication and RBAC | P3 fallback-deny/validation | Manual function-level comparison; preserve stronger deny logic, don't overwrite entire module |
| `apps/api/src/modules/borrow/borrow.router.ts` | Existing `requireIdempotencyKey`, `GET /:id/return-status/:key` and protected return POST | P1 status contract/validation | **Retain RC5 public API**, avoid adding a second, incompatible `return-idempotency` endpoint without deprecation plan. Test both HTTP contracts |
| `apps/api/src/modules/borrow/borrow.service.ts` | Existing atomic idempotency claim+cached response, handover/return status, source-verified same-location fail-closed rule | P0 BorrowRequest `FOR UPDATE` and conditional source debit; A→B posting proposal | Prefer safe policy: **retain RC5 rejection of A→B** until business owner approves transfer. Integrate row locking/CAS into existing transaction without losing existing idempotency; test deadlocks/timeouts and return receipt/audit |
| `apps/api/src/modules/categories/categories.router.ts` | RC5 full category CRUD+RBAC+validators (143 lines) | Zod4 error/compat migration (candidate file 21 lines) | Keep RC5 functionality; adapt error handling to Zod4 `.issues` without deleting routes |
| `apps/api/tests/borrow.return.unit.test.ts` | RC5 idempotency and business regression suite | P0 row lock / source and concurrency tests | Preserve all RC5 tests, port additional assertions and fixtures, never drop test cases to get green |
| `apps/web/src/pages/BorrowReturnPage.tsx` | RC5 ~1090-line advanced partial return, per-item quantity, durable pending keys, Web Lock, status UI | P1 fail-closed principle; candidate ~679-line simpler return UI | **Keep RC5 UI as primary**, do not replace with simpler page. Verify its idempotency key endpoint and receipt status against merged backend |
| `package.json` | RC5 workspace/build dependencies and scripts | Patched `qs`, `postcss-selector-parser`, Vite/Vitest lockfile changes | Reconcile dependency graphs; run `npm ci` clean, `npm audit`, and npm lock validation; avoid forced major upgrades |
| `packages/shared/src/validators.ts` | RC5 ~811-line new category/kit/report/return validation contracts | Zod4 semantic adaptation from candidate ~694 lines | Keep **all** RC5 exported validators, ports and schemas; migrate to Zod4 individually with exhaustive malformed/valid inputs |

## Non-conflicting automatic merge is not automatically safe

Even `git`-auto-merged `app.ts`, `auth.router.ts`, `errorHandler.ts`, `items.router.ts`, `users.router.ts` and `package-lock.json` need a semantic integration review, because cross-file imports, Zod major version and return API contracts changed on both branches.

RC5-specific files such as `apps/api/src/modules/kits/`, reports, category services, audit security, camera and UI module tests must **not** be removed. Preserve RC5 `render.yaml` intact in a production-like verification branch. **Do not sync the Blueprint:** review effective `STAGING_READ_ONLY=true`, `ALLOW_STAGING_AUTH_LOGIN=false` and CORS before any later deployment.

## Recommended staged integration

1. Freeze baseline SHAs and add a red, safe merge-gate workflow that **fails** while conflicts remain, rather than reporting green.
2. Construct an **isolated consolidation candidate** with 9 explicit conflict resolutions. Default to RC5 behavior on business-sensitive and fail-closed paths; selectively port P0 row locking and CI tests. Branch is **not** authorized for deployment.
3. Run `npm ci`, Prisma validate/generate, TypeScript, lint, builds, all RC5 and new mock/PG CI tests, browser E2E, and security audit.
4. Human DBA/security review P0 and API/validation behavior. Require exact owner choice for **cross-location return**: *reject safely* vs *support with custody/provenance*, and how partial/multi-source returns should behave.
5. Only with Issue #11–#15 approvals, independently authorized PG17 Stage4C evidence, tested restore and release owner GO, prepare production cutover. No real-data writes or cost change before approval.

**Important finding:** RC5 already has mandatory return `Idempotency-Key`, cached replay and an advanced read-only `return-status/:key` route and frontend. Candidate PR #46 **duplicates portions of this solution**. The integration must not replace RC5 with the simpler candidate implementation or introduce two divergent status protocols.

**Current verdict:** `CONFLICT_REVIEW_ONLY__RELEASE_NO_GO`.
