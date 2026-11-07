# Antigravity Task 02 — ACM fullstack security, authentication, RBAC and release engineering review

**Role:** You are a senior application security / TypeScript backend-frontend reviewer. Perform a **review-only** audit; results are AI-assisted technical findings, not a human signoff. Report in Vietnamese.

**Repository:** `https://github.com/acmhtql-sys/ACM_QLLK`

**Branch comparison (required):** `main` vs Draft PR [#39](https://github.com/acmhtql-sys/ACM_QLLK/pull/39) (`codex/p3-staging-readonly-deployment-20261107`), Draft PR [#40](https://github.com/acmhtql-sys/ACM_QLLK/pull/40) (`codex/p3g-zod4-compat-probe-20261107`), Draft PR [#41](https://github.com/acmhtql-sys/ACM_QLLK/pull/41) (`codex/p3h-toolchain-security-probe-20261107`), and separate Render backend staging branch `codex/cloud-staging-p2e-readonly-deploy-20261107`. Check and record head SHAs; account for stacked diffs to avoid duplicate merge changes.

**Read-only evidence to review:**
- [#15 Release NO-GO](https://github.com/acmhtql-sys/ACM_QLLK/issues/15), [#42 Reviewer sourcing](https://github.com/acmhtql-sys/ACM_QLLK/issues/42)
- `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/hooks/useAuth.tsx`, `apps/web/src/services/api.ts`, `apps/web/vercel.json`
- `apps/api/src/middleware/cloudStagingReadOnly.ts`, `apps/api/src/middleware/auth.ts`, `apps/api/src/middleware/rbac.ts`, `apps/api/src/app.ts`, `apps/api/src/middleware/errorHandler.ts`, `apps/api/src/middleware/validateRequest.ts`
- `apps/api/src/modules/` API routers, especially borrow / stock / categories / items / users / audit
- `packages/shared/src/validators.ts`; Zod 3→4 changes, UUID-like `.guid()` choice and error messages
- `apps/web/src/hooks/useIdempotentTransaction.ts`, stock import/export/transfer modals and Playwright mocks
- CI workflows `.github/workflows/ci.yml` and `p3g-mock-browser-e2e.yml`; `package.json`, workspaces, `package-lock.json` and npm audit
- `render.yaml` on the actual Render backend branch (not just PR #41)
- `docs/deployment/ACM_D8_RELEASE_READINESS_GO_NO_GO_20261107.md` and related technical evidence

## Required checks

1. **Auth & sessions:** negative login; no offline/mock Admin fallback; invalid/mock tokens never grant access; JWT validation, storage, expiry, logout, role changes, enumeration, credential and error leakage; backend decisions must not trust client-local role flags.
2. **RBAC / IDOR:** verify ADMIN-only reports and audit, STUDENT own PENDING cancel, LAB_MANAGER/TECHNICIAN scope, path param ownership checks, catalog/stock anonymous access, direct URL and API bypasses. Provide exact file:line and attacker preconditions.
3. **Read-only fail-closed Cloud Staging:** all mutation HTTP methods, spoofed method override, encoded paths, CORS, body compression/size, unauthenticated reads, config drift. Verify `STAGING_READ_ONLY=true`, `ALLOW_STAGING_AUTH_LOGIN=false`, and that no hidden alternate route bypasses policy. **Do not test real write endpoints against a live service.**
4. **Zod4 semantic compatibility:** validation of UUID-like IDs (`.guid()`), numeric parsing, missing/invalid payloads, error shape, optional fields; avoid silent data acceptance/regression compared with legacy Zod3.
5. **Stock transaction idempotency:** HTTP 504 ambiguous must never trigger a second POST; 409 payload mismatch/concurrent requests remain locked, only server-authorized resolution; client notes cannot unlock without authoritative server proof.
6. **Supply-chain/CI:** check lockfile integrity, direct/transitive patched versions, npm audit residual `react-router` and `react-router-dom` Moderate findings. Confirm Playwright network guard cannot reach Render/Supabase and tests are not mistaken for data-backed acceptance; confirm no secrets/paid resources in workflows.
7. **Deployment and operations:** verify frontend preview vs backend staging branches, Render Free cold starts, Supabase Free backup limitations, CORS exact origin, readiness, monitoring, rollback plan and migration gates. Note that Render Free is not recommended for production and no automatic backup/PITR is included with Supabase Free.
8. **Authorization boundaries:** check #11–#15 OPEN approvals and #42 reviewer-needed status. Record that **0 Critical/High in audit + CI PASS is not production GO**, and AI work cannot supply an independent human code/security signoff.

## Safety

- REVIEW ONLY: do not push commits, merge PRs, deploy, run migrations/seed, change database data, toggle staging auth/write flags, generate production credentials, use real data, or change billing.
- Static repository analysis and optional local offline lint/typecheck allowed. Do not call live mutation endpoints or copy environment secrets.
- No external dependencies installed unless clearly necessary for static analysis; if offline tests run, use a disposable local sandbox only.

## Output

Write `ACM_ANTIGRAVITY_FULLSTACK_SECURITY_REVIEW.md` locally with:
- Exact reviewed refs/SHAs and any missing code/artifacts.
- Findings sorted P0→P3, table **finding ID | severity | exact file:line and proof | abuse scenario | recommended fix | test to prove fix | related release gate**.
- Subsection for each of checks 1–8, marked `VERIFIED`, `PARTIAL` or `BLOCKED`; distinguish unit/mock results from real backend evidence.
- Release-ready checklist with technical and nontechnical blockers separately; planned branch/PR patch locations.
- Clear **TECHNICAL REVIEW ONLY — NO INDEPENDENT HUMAN APPROVAL — RELEASE NO-GO**.
- No source modification in this pass; propose patches for the project owner to approve separately.
