# ACM – CLOUD STAGING DEPLOYMENT CHECKLIST

> **Phase 11 overlay (17/10/2026):** Nội dung bên dưới là kế hoạch cũ, không phải bằng chứng Cloud đã triển khai. Xem [docs/phase11/STAGING_READINESS.md](./docs/phase11/STAGING_READINESS.md). Đặc biệt, đăng nhập **không chỉ đọc** (có cập nhật số lần nhập sai và reset bộ đếm). Giữ `ALLOW_STAGING_AUTH_LOGIN=false`; không thử write UAT trên Cloud chỉ đọc. Các bước sync repo ban đầu đã lỗi thời. 

## Execution Guide for Phased Multi-Platform Staging Launch

**Document ID:** `ACM-DEPLOY-CHECKLIST-C1A`  
**Revision:** `1.1 (Phase C1B-4A Controlled Documentation & Remote Alignment Specification)`  
**Scope:** Step-by-Step Operator Guide for Future Authorized Deployment  
**Operational Status:** `DEPLOYMENT NOT EXECUTED – PLANNING & SPECIFICATION ONLY`  

---

## 1. Governance Principles & Safe Deployment Gates

Deployment must progress sequentially across **6 execution gates**. Automatic or unattended progression is prohibited:

```mermaid
flowchart LR
    Gate1["Gate 1: GitHub<br/>(Remote Sync)"] --> Gate2["Gate 2: Supabase<br/>(Schema Deploy)"]
    Gate2 --> Gate3["Gate 3: Render<br/>(API Service)"]
    Gate3 --> Gate4["Gate 4: Vercel<br/>(Web SPA)"]
    Gate4 --> Gate5["Gate 5: Smoke Test<br/>(Read-Only Audit)"]
    Gate5 --> Gate6["Gate 6: Handoff<br/>(Sign-Off)"]
```

---

## 2. Gate 1: GitHub Remote & Repository Synchronization

### Baseline & Current State:
- **Local Working Branch:** `master` (at commit `34372045450a3c07877ab95792837160569a4186`).
- **Local Git Remote:** `0` configured remotes (`origin` is currently unset).
- **Target Remote Repository:** `https://github.com/acmhtql-sys/ACM_QLLK.git` (Existing repository; do NOT create a new one).
- **Remote Visibility:** Confirmed `PRIVATE` (Independently audited).
- **Remote Default Branch Metadata:** `main`.
- **Remote Commit State:** Confirmed `EMPTY` (0 commits).
- **Working Tree:** Exactly 62 approved files committed; zero uncommitted business logic changes.
- **Safety Rule:** Private visibility alone does NOT constitute authorization to push.

### Future Branch Alignment Strategy (PLANNED – NOT EXECUTED):
- Because the empty GitHub repository has default branch metadata set to `main`, while the local repository is on `master`, branch alignment must occur prior to synchronization.
- **Planned Alignment:** Align local branch to `main` via `git branch -M main` upon explicit operator authorization, or push via refspec `git push -u origin master:main`.
- Force-push (`--force` or `+`) is **STRICTLY FORBIDDEN**.

### Phased Execution Steps (AWAITING SEPARATE OPERATOR AUTHORIZATION):
1. [ ] **Step 1.1 (Authorization Required):** Align local branch name if approved:
   ```bash
   git branch -M main
   ```
2. [ ] **Step 1.2 (Authorization Required):** Add remote `origin` pointing to the verified private repository:
   ```bash
   git remote add origin https://github.com/acmhtql-sys/ACM_QLLK.git
   ```
3. [ ] **Step 1.3:** Verify remote configuration and URL:
   ```bash
   git remote -v
   ```
   *Expected Output:* `origin  https://github.com/acmhtql-sys/ACM_QLLK.git (fetch)` and `(push)`.
4. [ ] **Step 1.4 (Authorization Required):** Perform dry-run push verification:
   ```bash
   git push --dry-run -u origin main
   ```
5. [ ] **Step 1.5 (Authorization Required):** Execute initial non-destructive push:
   ```bash
   git push -u origin main
   ```

### Verification & Stop Condition:
- [ ] Inspect GitHub web interface to confirm repository root contains `package.json`, `vercel.json`, `packages/`, and `apps/`.
- [ ] Confirm no `.env` files, archives, dumps, or unauthorized workflows are visible in the repository file tree.
- **GATE 1 STATUS:** `PLANNED – NOT EXECUTED (Awaiting Operator Authorization)`

---

## 3. Gate 2: Supabase PostgreSQL Project & Schema Migration

### Preconditions:
- Supabase account active.
- Zero local PostgreSQL connections initiated during creation.

### Execution Steps (PLANNED – NOT EXECUTED):
1. [ ] Log in to [Supabase Dashboard](https://supabase.com/dashboard) and click **New Project**.
2. [ ] Enter Project Configuration:
   - **Name:** `acm-inventory-staging`
   - **Database Password:** Generate a secure 32-character random password.
   - **Region:** `Southeast Asia (Singapore)` (or geographically adjacent to Render).
   - **Pricing Plan:** Free or Pro.
3. [ ] Extract Connection Strings under **Project Settings $\rightarrow$ Database**:
   - **Direct Connection (Port 5432):** `postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres?sslmode=require` (Direct engine; username `postgres`).
   - **Session Pooler (Port 5432):** `postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres?sslmode=require` (Supavisor pooler; username requires `.[PROJECT_REF]`).
   - *Note:* Actual connection strings and pooler hostnames must be retrieved directly from the project dashboard upon provisioning.
4. [ ] Execute Database Migrations from local developer terminal targeting Supabase:
   ```bash
   # Execute migrations against Supabase Direct or Session Pooler connection
   cd D:\ACM_QLLK\apps\api
   $env:DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres?sslmode=require"
   npx prisma migrate deploy
   ```
   *Expected Output:*
   ```text
   2 migrations found in prisma/migrations
   Applying migration `20261010143500_init_acm`
   Applying migration `20261011160000_add_idempotency_and_transfer_location`
   The following migrations have been successfully applied:
   - 20261010143500_init_acm
   - 20261011160000_add_idempotency_and_transfer_location
   All migrations have been successfully applied.
   ```
5. [ ] (Optional) Seed Minimal Staging Fixtures:
   ```bash
   npm run prisma:seed
   ```

### Verification & Stop Condition:
- [ ] Inspect Supabase **Table Editor**: Verify that exactly **17 application tables** and **1 `_prisma_migrations` table** exist (18 physical tables total).
- [ ] Verify that enum types (9 application enums) are created in schema `public`.
- **GATE 2 STATUS:** `PLANNED – NOT EXECUTED`

---

## 4. Gate 3: Render Backend Web Service Deployment

### Preconditions:
- GitHub repository accessible from Render.
- Supabase database provisioned and migrations completed.

### Execution Steps (PLANNED – NOT EXECUTED):
1. [ ] Log in to [Render Dashboard](https://dashboard.render.com) and click **New + $\rightarrow$ Web Service**.
2. [ ] Connect the `ACM_QLLK` GitHub repository (`https://github.com/acmhtql-sys/ACM_QLLK.git`).
3. [ ] Configure Service Parameters:
   - **Name:** `acm-backend-staging`
   - **Region:** Same as Supabase (e.g. `Singapore`)
   - **Branch:** `main` *(aligned from local `master` during Gate 1 synchronization)*
   - **Root Directory:** `.` *(Repository Root)*
   - **Runtime:** `Node`
   - **Build Command:**
     ```bash
     npm ci && npm run build:shared && npm run prisma:generate && npm run build:api
     ```
   - **Start Command:**
     ```bash
     npm run start --workspace=@acm/api
     ```
   - **Instance Type:** `Free` or `Starter`
4. [ ] Enter Environment Variables in Render Dashboard:
   - `NODE_ENV`: `production`
   - `ACM_DEPLOYMENT_PROFILE`: `cloud_staging` *(**MANDATORY**: Required by security policy; non-staging profiles fail closed)*
   - `STAGING_READ_ONLY`: `'true'` *(**MANDATORY**: Enforces global Express read-only mutation block)*
   - `ALLOW_STAGING_AUTH_LOGIN`: `'false'` *(**MANDATORY**: Defaults to 'false'; login blocked unless explicitly authorized)*
   - `API_PREFIX`: `/api/v1`
   - `DATABASE_URL`: *(Supabase Session Pooler or Direct URI from Gate 2)*
   - `JWT_SECRET`: *(Cryptographically secure 64-char hex string; no development placeholders)*
   - `JWT_EXPIRES_IN`: `1d`
   - `LOG_LEVEL`: `info`
   - `CORS_ORIGIN`: *(Exact HTTPS domain of Vercel frontend, e.g. `https://acm-web-staging.vercel.app`; NO wildcard `*`, NO localhost)*
5. [ ] Set **Health Check Path**: `/api/v1/health/liveness`
6. [ ] Click **Create Web Service** and await deployment logs.

### Verification & Stop Condition:
- [ ] Check deployment logs: verify `@acm/shared` builds first, `prisma generate` finishes, and TypeScript compiles.
- [ ] Probe the public health endpoint:
   ```bash
   curl -s https://acm-backend-staging-xxxx.onrender.com/api/v1/health/liveness
   ```
   *Expected Response:* HTTP 200 OK with `{"status":"ok", "service":"ACM API", ...}`.

- [ ] Probe the readiness endpoint:
   ```bash
   curl -s https://acm-backend-staging-xxxx.onrender.com/api/v1/health/readiness
   ```
   *Expected Response:* HTTP 200 OK with `status: "ready"`, `database: "connected"`.
- **GATE 3 STATUS:** `PLANNED – NOT EXECUTED`

---

## 5. Gate 4: Vercel Frontend Static Deployment

### Preconditions:
- Render backend URL is active and verified healthy.
- `vercel.json` present at repository root.

### Execution Steps (PLANNED – NOT EXECUTED):
1. [ ] Log in to [Vercel Dashboard](https://vercel.com) and click **Add New... $\rightarrow$ Project**.
2. [ ] Import the `ACM_QLLK` GitHub repository (`https://github.com/acmhtql-sys/ACM_QLLK.git`).
3. [ ] Configure Build & Output Settings:
   - **Framework Preset:** `Vite`
   - **Root Directory:** `.` *(Repository Root)*
   - **Build Command:**
     ```bash
     npm run build:shared && npm run build:web
     ```
   - **Output Directory:** `apps/web/dist`
   - **Install Command:** `npm install`
4. [ ] Configure Environment Variables in Vercel:
   - `VITE_API_BASE_URL`: `https://acm-backend-staging-xxxx.onrender.com/api/v1`
   - `VITE_ENABLE_LOCATION_WRITES`: `false`
   - `VITE_ENABLE_STOCK_TRANSACTION_WRITES`: `false`
   - `VITE_ENABLE_STOCK_ADJUSTMENT`: `false`
5. [ ] Click **Deploy** and await build completion.
6. [ ] Note assigned frontend domain: `https://acm-web-xxxx.vercel.app`.
7. [ ] Return to Render Dashboard $\rightarrow$ Environment: update `CORS_ORIGIN` to match `https://acm-web-xxxx.vercel.app`.

### Verification & Stop Condition:
- [ ] Open frontend in browser: `https://acm-web-xxxx.vercel.app`.
- [ ] Refresh page on a deep URL (`https://acm-web-xxxx.vercel.app/dashboard`): verify no 404 error occurs (verifies `vercel.json` SPA rewrite).
- **GATE 4 STATUS:** `PLANNED – NOT EXECUTED`

---

## 6. Gate 5: Read-Only Cloud Staging Verification & Smoke Test

### Preconditions:
- Frontend and backend deployed and wired.
- Write feature flags verified to be `false` on Vercel.
- Backend verified running with `ACM_DEPLOYMENT_PROFILE=cloud_staging` and `STAGING_READ_ONLY=true`.

### Verification Protocol (PLANNED – NOT EXECUTED):
1. [ ] **Authentication Policy Verification:**
   - If `ALLOW_STAGING_AUTH_LOGIN=false` (default): verify `POST /api/v1/auth/login` returns HTTP 403 Forbidden with `code: "STAGING_READ_ONLY_BLOCKED"`.
   - If `ALLOW_STAGING_AUTH_LOGIN=true` (operator authorized): verify `POST /api/v1/auth/login` successfully issues a JWT token.
   - *Database Role Interaction Note:* In the current codebase, login is strictly read-only (SELECT query only). If audit logging or `last_login_at` updates are introduced in the future, they will conflict with a database-level `acm_staging_ro` read-only role.
2. [ ] **Catalog Read Test:** Navigate to `/items` and `/categories`; verify inventory items load from Supabase.
3. [ ] **Stock Balance Read Test:** Navigate to `/inventory`; verify stock balances display calculated available quantities.
4. [ ] **Transaction History Read Test:** Navigate to `/transactions`; verify past transactions list properly.
5. [ ] **Zero Write Capability Audit:**
   - Verify that UI buttons for "Nhập kho", "Xuất kho", "Điều chỉnh", "Tạo vị trí" are hidden or disabled due to client feature flags.
   - Verify that direct HTTP mutation requests (`POST`, `PUT`, `PATCH`, `DELETE`) to `/api/v1/inventory/*`, `/api/v1/locations/*`, `/api/v1/stock-transactions/*`, `/api/v1/stock-movements/*` are intercepted by `cloudStagingReadOnlyMiddleware` and return HTTP 403 Forbidden (`STAGING_READ_ONLY_BLOCKED`).
- **GATE 5 STATUS:** `PLANNED – NOT EXECUTED`

---

## 7. Gate 6: Operational Handoff & Governance Sign-Off

### Sign-off Checklist (PLANNED – NOT EXECUTED):
- [ ] Staging database verified 100% physically isolated from local Dev (5432), Gate B (5433), and S2C (5434).
- [ ] Zero stock POST operations executed against production or pre-live targets.
- [ ] Write feature flags remain locked to `false`.
- [ ] All staging secrets documented in secure vault; zero secrets in version control.
- **GATE 6 STATUS:** `PLANNED – NOT EXECUTED`
