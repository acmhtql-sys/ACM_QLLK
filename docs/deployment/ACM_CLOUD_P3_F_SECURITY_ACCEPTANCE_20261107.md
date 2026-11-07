# ACM Cloud P3-F — Security Acceptance Evidence (2026-11-07)

**Target:** isolated ACM Staging only (`acm-qllk-staging-web` Vercel Preview / Render `acm-api-staging-29fw` / Supabase `dqctxaoaxhtqtgmtsysk`).

**Release verdict:** **NO-GO for merge or real operations.** This is a controlled engineering review, not production acceptance. No real data, no Supabase migration or seed, no upgrades, no second Render service, and no change to `main` are authorized.

## Evidence and test scope

- Browser Preview login and backend: Render request log on 2026-11-07T06:34:41Z recorded `POST /api/v1/auth/login` returning **HTTP 403**; browser remained on login and displayed the read-only message. This is a verified single live login-negative test, not proof of all methods.
- `GET /api/v1/health/readiness` returned 200 with `database: connected` after rotating staging DB credentials (operator updated secret in Render; none recorded in Git).
- `apps/api/tests/p3f.security.http.unit.test.ts` exercises the actual Express stack against **in-process local tests**, using deliberately nonexistent paths for all mutation methods, plus authentication requirements on private read endpoints and method override attempts. No Supabase connection, credentials or real writes.
- `scripts/p3f-live-readonly-acceptance.mjs` performs limited unauthenticated public HTTP probes on the **existing** Render staging service. Its POST/PUT/PATCH/DELETE tests only target `/api/v1/__acm_p3f_nonexistent_readonly_probe__`, so failure of the guard can return 404 but cannot invoke a business mutation. It also checks private GET = 401, liveness = 200, CORS Preview origin and method-override attacks. **Verified:** GitHub CI run #133 (`42349991483`) completed successfully. Job logs show POST/PUT/PATCH/DELETE = 403, method overrides = 403, private GETs = 401, liveness = 200, allowed Preview CORS and untrusted origin rejection. No business writes attempted.
- GitHub Actions is modified to run a report-only `npm audit` (all and `--omit=dev`). It does not auto-fix, install new versions, merge or release.

## Blueprint drift finding and correction

- Existing Render-managed source Blueprint branch `codex/cloud-staging-p2e-readonly-deploy-20261107` contained `ALLOW_STAGING_AUTH_LOGIN=true` despite effective runtime policy `false`.
- Corrected **source** `render.yaml` to `ALLOW_STAGING_AUTH_LOGIN=false` in commit `ad7518438a0f530236410f272de83cc0ea31f1dd`; kept `STAGING_READ_ONLY=true`, `cloud_staging`, `autoDeployTrigger: off` and plan Free.
- This source correction is **not** a claim that a Blueprint sync occurred. Existing staging API branch source additionally received compressed-body parsing mitigations in commits `629a9d0` and `0e357af`; a Render deploy was triggered for this existing Free service, and its status must be confirmed independently. Do not sync automatically: confirm linked Blueprint and that `DATABASE_URL`/JWT secrets will remain protected.

## Dependency findings (npm audit from CI, not release-approved)

| Audit scope | Critical | High | Moderate | Total |
|---|---:|---:|---:|---:|
| All (dev + runtime) | 2 | 5 | 7 | 14 |
| `--omit=dev` | 0 | 3 | 3 | 6 |

- Runtime High: `body-parser` 1.20.8 (GHSA-27r3-jxmh-p828; patched 1.20.9), `follow-redirects` 1.16.1 (GHSA-mrwp-f3q8-3g9p; patched 1.16.2), `zod` 3.25.76 (GHSA-mrhx-c7xc-m3w5; v4 migration required).
- The two Critical findings (`tinypool`, `vitest`) are in dev/test tooling according to `npm audit --omit=dev` but still require triage before release.
- Added proposed code-level mitigation in the PR: reject compressed request bodies before body-parser inflation, return HTTP 415 for unsupported encodings, and test locally. **Not deployed to Render backend until independently reviewed and verified.**
- **Do not run** `npm audit fix --force` or blindly upgrade Zod 3 to v4: the shared validators and API error handling require a coordinated compatibility review.

## Read access and Supabase review

- API routes requiring authentication include `/auth/me`, `/users`, `/locations`, `/inventory/balance`, `/stock-transactions`, `/stock-movements`, `/borrow-requests`, `/reports/summary`, and `/audit-logs`; the in-process negative suite expects 401 without credentials.
- `GET /api/v1/items`, `/items/:id` and `/items/barcode/:barcode` use **optional** authentication; `GET /api/v1/categories` is public. Item responses include quantities/stock by location. **Explicit owner review required** to decide if public catalog/stock disclosure is intentional, particularly for any future real-data environment.
- Supabase Security Advisor flagged **20 INFO** findings `rls_enabled_no_policy`. A read-only metadata query found no `anon`/`authenticated` table grants in `information_schema.role_table_grants`. Do not infer application-layer access control from RLS alone; backend Prisma uses database credentials. Do not add permissive policies or enable anon access as a shortcut.

## Outstanding release blockers

- [x] GitHub CI #133 and safe live negative matrix both succeeded (see run `42349991483`)
- [ ] Security review independent of PR author, including runtime changes
- [ ] Triage/patch vulnerable dependencies with verified lockfile and regression tests (especially Zod migration)
- [ ] Explicit public catalog stock-disclosure policy
- [ ] Blueprint sync/secret retention check (no uncontrolled deploy)
- [ ] Isolated synthetic **write-capable** E2E test environment, migration and business tests **only after separate approval**
- [ ] Formal review signoff before merging `main` or promoting any deployment

Never paste secrets, database URLs or user passwords into logs, PRs or chat.
