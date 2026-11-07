# ACM Cloud P3 — Staging Deployment Gate (Review Only)

**Scope:** `acmhtql-sys/ACM_QLLK` monorepo; frontend hosted on Vercel; Express API on Render Free; PostgreSQL on Supabase project `acm-qllk-staging` (`dqctxaoaxhtqtgmtsysk`).

**Status (2026-11-07):** Review-only. Existing Render service identified; build passed but runtime failed because DATABASE_URL is not configured. No merge, migration, or seed was performed.

## Preconditions

1. Review the Draft PR removing the frontend's network-failure mock authentication and public default-demo credential UI. Never use real users or production secrets to test the public staging site.
2. Review `render.yaml` and verify Render's **Free** plan and available monthly usage. The Free plan can be subject to usage/bandwidth charges beyond included quotas. Avoid any paid add-ons and disable auto-deploys.
3. Confirmed Render workspace ACM (`tea-db8cil2j9qps73cf0gcg`) and **existing** Free web service `acm-api-staging-29fw` (`srv-dbn9lu3rjlhs73856bag`). Reuse this service; **do not create or import a duplicate service**.
4. Do not run `prisma migrate`, `prisma db push`, any seed, destructive SQL, or connect to any real-data database.
5. No merge to `main` until the PR has passed code review and CI; no public functional rollout before confirming staging guards.

## Existing backend service parameters (review before any further deploy)

- Source: GitHub repository root, existing Render branch `codex/cloud-staging-p2e-readonly-deploy-20261107`. **Do not switch to or merge main.**
- Existing Render region: Singapore; runtime: Node; compute plan: Free; automatic deploys disabled. Check currently pinned Node version in the connected Render Blueprint before modifying it.
- Current successful build: `npm ci --include=dev && npm run prisma:generate && npm run build:shared && npm run build:api`
- Start: `npm run start --workspace=@acm/api`
- Health probe: `GET /api/v1/health/readiness` (requires DB connection)
- Minimal safe environment:
  - `NODE_ENV=production`
  - `ACM_DEPLOYMENT_PROFILE=cloud_staging`
  - `STAGING_READ_ONLY=true`
  - `ALLOW_STAGING_AUTH_LOGIN=false`
  - `API_PREFIX=/api/v1`
  - `CORS_ORIGIN=https://acm-qllk-staging-web.vercel.app`
  - `JWT_SECRET`: strong generated secret, stored only in Render secrets
  - `DATABASE_URL`: actual **staging-only** PostgreSQL connection string, entered directly in Render, never posted in a chat or committed in Git

For a persistent IPv4-only app, Supabase documents its **Session pooler** connection (port 5432); obtain the exact project connection string via the Supabase Dashboard > Connect. Do not guess a pooler hostname. Transaction pooling has prepared-statement considerations with Prisma. Never put `DATABASE_URL` or `JWT_SECRET` in any `VITE_*` variable or browser build.

## Gates before enabling frontend API URL

1. Observed build success on 2026-11-07; subsequent startup **failed** with `[DATABASE_URL] Required`. Enter the valid Supabase staging-only connection secret *directly* through Render > Environment (do not paste it in chat). Confirm the service's effective `ALLOW_STAGING_AUTH_LOGIN=false` and `STAGING_READ_ONLY=true`; the earlier Blueprint branch uses `ALLOW_STAGING_AUTH_LOGIN=true`, so it must not override this fail-closed policy on a future sync.
2. `GET /api/v1/health/liveness` returns 200 and `GET /api/v1/health/readiness` returns 200 with database connected (otherwise **NO-GO**).
3. `POST /api/v1/auth/login` returns HTTP 403 with code `STAGING_READ_ONLY_BLOCKED` when `ALLOW_STAGING_AUTH_LOGIN=false`. Confirm without valid credentials.
4. Any other mutation endpoint (POST/PUT/PATCH/DELETE) must also return 403; reads requiring authentication may correctly respond 401/403 without a session.
5. Confirm HTTPS origin and CORS match the frontend site, then configure the real Render API prefix as Vercel `VITE_API_BASE_URL` and redeploy the **reviewed** frontend code. Never configure a placeholder or `localhost`.
6. Check response behavior and logs; capture evidence. Do not equate 200 on liveness with database readiness or full business acceptance.

## Completion and risk notes

- Existing frontend `/login` being visible proves deployment/routing only, not successful authentication or business flows.
- Cloud Staging is intentionally read-only. Full borrow/return, inventory mutation, account lockout, and kit lifecycle flows require a separately approved isolated test environment and reviewed synthetic data.
- Render Free can spin down when idle; free service capacity and platform usage quotas must be monitored to honor **$0 spend**. Updating service env through the connector may trigger a new deployment and use pipeline minutes even with auto-deploy disabled.
- The root-level `render.yaml` from the draft security PR was removed to avoid accidentally defining a second Render service. This runbook is for the existing service only.
- This staging gate does **not** authorize any billing change, database migration, seed execution, production data access, PR merge, or enabling staging login.
