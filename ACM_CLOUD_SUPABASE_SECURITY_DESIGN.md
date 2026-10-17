# ACM CLOUD SUPABASE SECURITY DESIGN

> **Phase 11 code review correction (17/10/2026):** Đoạn 4.4 bên dưới mô tả login là read-only đã **không còn đúng**. `auth.router.ts` hiện ghi `failedLoginAttempts` và `isLocked` qua UPDATE/transaction. Đối với Cloud Staging chỉ đọc, giữ `ALLOW_STAGING_AUTH_LOGIN=false` cho đến khi có thiết kế đăng nhập riêng được phê duyệt. Xem [Phase 11 Staging Readiness](./docs/phase11/STAGING_READINESS.md). 

## Phase C1B-4A – Staging & Production Database Security Architecture

**Document Version:** 2.2.0 (Phase C1B-4A Schema Parity & Documentation Alignment)  
**Status:** DESIGN ONLY – ZERO EXECUTION / ZERO CONNECTION TO SUPABASE  
**Classification:** STRICT STATIC SECURITY SPECIFICATION  
**Scope:** Supabase PostgreSQL Database for ACM Monorepo (Staging & Production)  
**Author:** ACM Core Architecture & Security Engineering Team  

---

## 1. EXECUTIVE SUMMARY & SECURITY PRINCIPLES

This document establishes the authoritative database security architecture for the ACM (Hệ thống Quản lý Linh kiện & Thiết bị) platform on Supabase PostgreSQL. 

### 1.1 Architectural Status Taxonomy
To maintain strict audit integrity, all architectural controls in this specification are classified under four rigorous statuses:
- `[IMPLEMENTED_IN_SOURCE]`: Fully implemented and verified in local code and configuration (e.g. Express fail-closed middleware, `securityPolicy.ts`, `env.ts`, `apps/api/prisma/schema.prisma`, and physical SQL migrations).
- `[DESIGN_ONLY]`: Blueprint specifications, DDL templates, and role grant scripts formulated on paper, awaiting authorized execution (e.g. `acm_staging_ro` PostgreSQL role creation script).
- `[NOT_YET_TESTED_ON_CLOUD]`: External cloud provider capabilities and behaviors (e.g. Supabase connection poolers, project settings, PITR add-ons, and network routing).
- `[OPERATOR_APPROVAL_REQUIRED]`: Actions strictly barred from execution until explicit, separate operator approval is granted.

### 1.2 Core Security Principles
- **Defense in Depth:** The Cloud Staging environment enforces security at two independent layers:
  1. Application Layer `[IMPLEMENTED_IN_SOURCE]`: Express fail-closed middleware (`cloudStagingReadOnlyMiddleware`) blocking HTTP mutations (`POST`, `PUT`, `PATCH`, `DELETE`).
  2. Database Layer `[DESIGN_ONLY]`: Dedicated PostgreSQL role (`acm_staging_ro`) with revoked mutation privileges (`REVOKE INSERT, UPDATE, DELETE, TRUNCATE`).
- **Zero Real Connection Mandate:** This document is **100% design-only**. No real Supabase database is connected, migrated, or altered during Phase C1B-4A.
- **Fail-Closed Default:** Unauthenticated access, plaintext transport, or pooler misconfigurations fail closed immediately.
- **No Premature Assumptions:** No connection mode, pooling behavior, or backup capability is assumed operational until a Supabase project is officially provisioned and verified in authorized phases.
- **Privilege Reality Caveat:** A `REVOKE` statement on a role is not self-executing proof of zero writes; privilege inheritance, `PUBLIC` grants, and `SECURITY DEFINER` routines must be audited upon live provisioning.

---

## 2. SCHEMA TRUTH & INVENTORY BASELINE

The database schema definition is strictly governed by the canonical local Prisma schema and migration SQL files:
- **Canonical Source Path `[IMPLEMENTED_IN_SOURCE]`:** `apps/api/prisma/schema.prisma`
- **Monorepo Structure Clarification:** The path `packages/database/prisma/schema.prisma` **DOES NOT EXIST**. Earlier references to a mirrored database package schema were historical artifacts; `apps/api/prisma/schema.prisma` is the sole, authoritative schema definition.

### 2.1 Migration History & Physical Table Counts
1. **Migration 1 (`20261010143500_init_acm`):**
   - Creates **16 application tables**:
     `roles`, `users`, `categories`, `items`, `locations`, `assets`, `stock_balances`, `stock_movements`, `stock_reservations`, `stock_transactions`, `stock_transaction_details`, `borrow_requests`, `borrow_details`, `return_transactions`, `return_details`, `audit_logs`.
   - *Historical Correction:* Old conceptual table names (`item_attributes`, `inventory_items`, `stock_movement_items`, `borrow_request_details`, `stock_alerts`, `stock_counts`, `stock_count_details`) were early design placeholders and do not exist in the physical migration SQL.
   - Creates **9 PostgreSQL enum types** with exact values:
     1. `UserRole`: `'ADMIN'`, `'LAB_MANAGER'`, `'TECHNICIAN'`, `'STUDENT'`
     2. `ItemType`: `'CONSUMABLE'`, `'TRACKED_ASSET'`, `'EQUIPMENT'`
     3. `StockTransactionType`: `'IMPORT'`, `'EXPORT'`, `'ADJUSTMENT'`, `'TRANSFER'`
     4. `TransactionStatus`: `'COMPLETED'`, `'CANCELLED'`
     5. `BorrowStatus`: `'PENDING'`, `'APPROVED'`, `'REJECTED'`, `'HANDED_OVER'`, `'RETURNED'`, `'PARTIALLY_RETURNED'`, `'CANCELLED'`
     6. `ReservationStatus`: `'ACTIVE'`, `'FULFILLED'`, `'RELEASED'`
     7. `AssetStatus`: `'AVAILABLE'`, `'RESERVED'`, `'BORROWED'`, `'QUARANTINED'`, `'LOST'`, `'RETIRED'`
     8. `AssetCondition`: `'GOOD'`, `'DAMAGED'`, `'LOST'`
     9. `LocationType`: `'WAREHOUSE'`, `'RACK'`, `'SHELF'`, `'BIN'`
   - Creates **29 foreign key constraints**.
2. **Migration 2 (`20261011160000_add_idempotency_and_transfer_location`):**
   - Creates **1 application table**: `idempotency_records` (11 columns).
   - Alters **1 existing table**: `stock_transaction_details` (adds column `to_location_id` UUID with foreign key constraint `stock_transaction_details_to_location_id_fkey` referencing `locations(id)`).
   - Creates **3 foreign key constraints**:
     - `stock_transaction_details_to_location_id_fkey`: `stock_transaction_details.to_location_id` $\rightarrow$ `locations.id`
     - `idempotency_records_user_id_fkey`: `idempotency_records.user_id` $\rightarrow$ `users.id`
     - `idempotency_records_transaction_id_fkey`: `idempotency_records.transaction_id` $\rightarrow$ `stock_transactions.id`
3. **Prisma Internal Tracking:**
   - Creates **1 tracking table**: `_prisma_migrations`.

**Authoritative Physical Totals:**
- **Application Tables:** 17
- **Internal Migration Tracking Tables:** 1
- **Total Physical Tables in Database:** 18
- **PostgreSQL Enum Types:** 9
- **Total Foreign Keys:** 32 across 17 application tables (29 in Migration 1 + 3 in Migration 2)

### 2.2 Key Table Specifications
- **`audit_logs` (15 columns):** Primary audit trail storing `id`, `user_id`, `action`, `entity_name`, `entity_id`, `old_values`, `new_values`, `ip_address`, `user_agent`, `status`, `error_message`, `created_at`, `duration_ms`, `module`, `risk_level`. Indexed on `(entity_name, entity_id)` and `created_at`.
- **`idempotency_records` (11 columns):** Mutation deduplication ledger with exact SQL columns:
  1. `id` (`UUID`, PRIMARY KEY)
  2. `key` (`TEXT`, UNIQUE) — Client idempotency key
  3. `user_id` (`UUID`, FK $\rightarrow$ `users.id`)
  4. `endpoint` (`TEXT`) — Targeted API endpoint
  5. `request_hash` (`TEXT`) — SHA-256 digest of request payload
  6. `status` (`TEXT`, CHECK `status IN ('PENDING', 'COMPLETED', 'FAILED')`, DEFAULT `'PENDING'`)
  7. `transaction_id` (`UUID`, UNIQUE, FK $\rightarrow$ `stock_transactions.id`)
  8. `response_body` (`JSONB`) — Cached JSON response
  9. `status_code` (`INTEGER`) — HTTP response status code
  10. `created_at` (`TIMESTAMP(3)`, DEFAULT `CURRENT_TIMESTAMP`)
  11. `expires_at` (`TIMESTAMP(3)`, CHECK `expires_at > created_at`)

---

## 3. CONNECTION TOPOLOGY & POOLING ARCHITECTURE

Supabase provides direct PostgreSQL connections and pooled connection endpoints via Supavisor / PgBouncer. ACM routes traffic according to workload characteristics:

```
[ CI/CD / Release Pipeline (Migration Only) ] ──── Port 5432 (Direct PG) ──── Direct Supabase PG (IPv6 / IPv4 Add-on)
                                                                                       │
[ Render Web Service (ACM API Runtime) ] ──────── Port 5432 (Session Pooler) ─────────┘
                                                  (aws-0-[region].pooler.supabase.com)
```

### 3.1 Connection Mode Strategy & Analysis

| Connection Architecture | Port | Protocol / Features | Operational Target | Recommendation & Status |
| :--- | :---: | :--- | :--- | :--- |
| **Direct Connection** | `5432` | Native PostgreSQL (`db.[ref].supabase.co`); supports DDL and advisory locks | Schema migrations (`prisma migrate deploy`) | **MANDATORY FOR MIGRATIONS `[DESIGN_ONLY]`:** Required to acquire `pg_advisory_lock` during schema migration deployment. Uses direct username `postgres`. *Note: If direct connection is blocked by IPv4 network restrictions, session pooler on port 5432 may be evaluated.* |
| **Session Pooler** | `5432` | Supavisor Session Mode; supports prepared statements, advisory locks, session variables | Render Web Service Backend Runtime | **RECOMMENDED FOR RENDER RUNTIME `[DESIGN_ONLY]`:** Persistent Express Node.js process benefits from full prepared statement compatibility without PgBouncer transaction limitations. |
| **Transaction Pooler** | `6543` | Supavisor / PgBouncer Transaction Mode; closes connection after transaction | High-concurrency or serverless endpoints | **RESTRICTED / CONDITIONAL `[DESIGN_ONLY]`:** Incompatible with `prisma migrate deploy` (drops advisory locks). Requires `?pgbouncer=true` and disables prepared statements in Prisma. |

> [!IMPORTANT]
> **Pre-Provisioning Verification Caveat:**
> No connection mode is assumed 100% operational until the target Supabase Project is provisioned and connectivity is experimentally verified in future authorized phases. All connection configurations in Phase C1B-4A remain in `[NOT_YET_TESTED_ON_CLOUD]` status.

### 3.2 Connection String Specifications & Pooler Username Format

1. **Shared Pooler vs. Direct Connection Username Format:**
   - **Shared Pooler (Supavisor, Port 5432 or 6543):** Connecting through shared poolers requires the tenant routing format:
     `[ROLE].[PROJECT_REF]` (e.g. `acm_staging_ro.[PROJECT_REF]` or `postgres.[PROJECT_REF]`).
   - **Direct PostgreSQL Connection (`db.[PROJECT_REF].supabase.co:5432`):** Direct connections to the dedicated database instance use the standard PostgreSQL username format (e.g. `postgres`), **WITHOUT** the project reference suffix. Do NOT append `.[PROJECT_REF]` to the direct connection username.
2. **Runtime Connection URL (Render Backend via Session Pooler) `[DESIGN_ONLY]`:**
   ```text
   postgresql://acm_staging_ro.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres?sslmode=require
   ```
3. **Migration Direct URL (CI/CD / Release Script) `[DESIGN_ONLY]`:**
   ```text
   postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres?sslmode=require
   ```
4. **Dashboard Source Mandate:** Actual hostnames, pooler endpoints, and connection strings must be obtained directly from the Supabase Project Dashboard upon provisioning.
5. **SSL Enforcement:** Any connection lacking `sslmode=require` must be rejected by firewall rules and PostgreSQL server configuration (`ssl = on`).

---

## 4. ROLE-BASED ACCESS CONTROL & PRIVILEGE ARCHITECTURE

To enforce least-privilege separation, dedicated database roles are architected:

```
                         [ postgres (Superuser / Project Admin) ]
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
        [ acm_migrator ]                                  [ acm_app ]
       (DDL + Migrations)                          (DML Read/Write for Prod)
                                                                 │
                                                                 ▼ (For Staging)
                                                         [ acm_staging_ro ]
                                                         (Strict SELECT only)
```

### 4.1 Role Matrix & Privilege Constraints

| Database Role | Intended Usage | DDL (CREATE/ALTER/DROP) | DML (INSERT/UPDATE/DELETE) | DQL (SELECT) | Privileges & Restrictions |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `postgres` | Supabase initial setup / maintenance | YES | YES | YES | Default master role; never used for runtime backend. |
| `acm_migrator` | CI/CD migration deployment | YES | YES (on `_prisma_migrations`) | YES | Zero access outside deployment pipeline; acquires advisory locks. |
| `acm_app` (Prod) | Production runtime API service | NO | YES (on all 17 tables) | YES | **FORBIDDEN ON CLOUD STAGING**. Restricted strictly to future Production. |
| `acm_staging_ro` (Staging) | Staging runtime API service | NO | **REVOKED (0 writes)** | YES (all 18 tables) | **MANDATORY ON STAGING**: Zero DDL, zero TRUNCATE, zero mutation privileges. |

### 4.2 Staging Database-Level Read-Only Specification (`acm_staging_ro`) `[DESIGN_ONLY – OPERATOR APPROVAL REQUIRED]`

```sql
-- 1. Create dedicated Staging Read-Only application user (LOGIN only, no admin capabilities)
CREATE ROLE acm_staging_ro WITH LOGIN PASSWORD 'STAGING_RO_SECURE_PASSWORD'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

-- 2. Revoke default public schema creation and mutation
REVOKE ALL ON SCHEMA public FROM acm_staging_ro;
GRANT USAGE ON SCHEMA public TO acm_staging_ro;

-- 3. Grant SELECT only on all 17 application tables + _prisma_migrations (18 physical tables)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO acm_staging_ro;

-- 4. Set default privileges for any future tables to SELECT only
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO acm_staging_ro;

-- 5. Explicitly revoke destructive capabilities and mutation privileges
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM acm_staging_ro;
```

### 4.3 Privilege Inheritance & PUBLIC Grant Audit Caveats
> [!CRITICAL]
> **Privilege Assurance Rules:**
> Simply running `REVOKE` on `acm_staging_ro` is **NOT sufficient** to guarantee zero database writes if privileges are inherited through default PostgreSQL settings. Upon live provisioning in future authorized phases, the following 8 vectors must be explicitly verified:
> 1. **PUBLIC Schema Grants:** PostgreSQL historically grants `CREATE` and `USAGE` on schema `public` to role `PUBLIC`. Verify `REVOKE CREATE ON SCHEMA public FROM PUBLIC;`.
> 2. **Role Memberships:** Verify `acm_staging_ro` is NOT a member of `postgres`, `anon`, `authenticated`, or `service_role`.
> 3. **Schema Ownership:** Ensure `public` schema is owned by `postgres`, never by `acm_staging_ro`.
> 4. **Table Ownership:** Ensure all tables are owned by the migration role, never by `acm_staging_ro` (table owners inherently have full DDL/DML rights).
> 5. **Function EXECUTE Privileges:** PostgreSQL grants `EXECUTE` on new functions to `PUBLIC` by default. Any custom function performing write operations could be invoked unless revoked.
> 6. **SECURITY DEFINER Functions:** Audit that no function executes with definer privileges to mutate tables on behalf of `acm_staging_ro`.
> 7. **Future Default Privileges:** Ensure `ALTER DEFAULT PRIVILEGES ... REVOKE INSERT, UPDATE, DELETE` is applied for tables created by the migration role.
> 8. **Live Verification Mandate:** Do NOT claim ZERO database writes until an authorized live privilege verification script (`has_table_privilege()`) is executed.  
> **Status:** `[NOT_YET_TESTED_ON_CLOUD – DESIGN ONLY]`

### 4.4 Authentication & Read-Only Role Interaction Analysis
- **Current Codebase Behavior:** The `POST /api/v1/auth/login` endpoint in `auth.router.ts` performs a single read-only operation: `prisma.user.findUnique(...)` followed by in-memory bcrypt password comparison and JWT signing. It executes zero write queries (`0` inserts to `audit_logs`, `0` updates to `last_login_at`).
- **Read-Only Compatibility:** Under this current implementation, login operations are compatible with the `acm_staging_ro` role because `SELECT ON users` is granted.
- **Future Conflict Warning:** If any future update adds automatic database audit logging, failed-attempt counters, or session persistence inside the login flow, those write queries will be rejected with `permission denied` under `acm_staging_ro`.
- **Policy Enforcement:** Login remains disabled by default on Cloud Staging via `ALLOW_STAGING_AUTH_LOGIN=false`.

---

## 5. SUPABASE DATA API (POSTGREST) & ROW LEVEL SECURITY (RLS)

### 5.1 Supabase Data API Evaluation
- **ACM Monorepo Architecture:**
  ```
  [ Client Browser (Vite/React SPA) ] ─── HTTPS ───> [ Express API (Render) ] ─── TLS/Pooler ───> [ PostgreSQL (Supabase) ]
  ```
- **Does ACM use the Supabase Data API (PostgREST)?** **NO**. 
  All client requests terminate at the Render Express API.
- **Data API Posture & Recommendation:**
  > [!IMPORTANT]
  > **DO NOT ASSUME DATA API IS AUTOMATICALLY DISABLED:**
  > Supabase enables the PostgREST Data API by default on all new projects. Because ACM does not consume PostgREST:
  > - **RECOMMENDATION:** Explicitly **DISABLE** the Supabase Data API in Project Settings (or unexpose the `public` schema).
  > - If the Data API remains enabled, an explicit privilege review and Row Level Security (RLS) on all 17 tables is mandatory to prevent unauthorized data access via Supabase anon keys.
  > - **Actual Setting Status:** `[NOT_YET_TESTED_ON_CLOUD]` (pending project creation).

---

## 6. BACKUP, RESTORE & POINT-IN-TIME RECOVERY (PITR)

### 6.1 Plan-Dependent Backup Capabilities
- **Supabase Free Plan:** 
  - Does **NOT** include automated point-in-time recovery (PITR).
  - Does **NOT** include scheduled automated daily backup downloads.
  - Disaster recovery on Free tier relies on manual logical dumps via `pg_dump`.
- **Supabase Pro Plan:** 
  - Includes daily automated backup snapshots retained for 7 days.
  - **Point-In-Time Recovery (PITR) is an OPTIONAL PAID ADD-ON**: PITR is **not** automatically included in standard Pro; it must be explicitly purchased and enabled.
- **Operational Protocol:**
  - For Staging, a verified `pg_dump` logical backup must be captured prior to any migration execution.
  - Backup scripts must safely manage credentials via `.pgpass` or environment variables without logging passwords.
  - **Restore Capability Status:** `[NOT_YET_TESTED_ON_CLOUD]` (cannot be tested without live infrastructure).

---

## 7. DOCUMENTATION RECONCILIATION & GOVERNANCE

1. **Frontend Framework:** Vite / React Single Page Application (`apps/web`), NOT Next.js.
2. **Authoritative Prisma Schema Path:** `apps/api/prisma/schema.prisma` ONLY. The path `packages/database/prisma/schema.prisma` does not exist in the codebase.
3. **Table & Enum Counts:** Exactly **17 application tables** (`roles`, `users`, `categories`, `items`, `locations`, `assets`, `stock_balances`, `stock_movements`, `stock_reservations`, `stock_transactions`, `stock_transaction_details`, `borrow_requests`, `borrow_details`, `return_transactions`, `return_details`, `audit_logs`, `idempotency_records`), **9 PostgreSQL enum types**, **1 Prisma tracking table** (`_prisma_migrations`), totaling **18 physical tables** and **32 foreign keys**.
4. **Zero Execution Guarantee:** No SQL statements, migrations, or database commands are executed during this phase.

---

## 8. CONCLUSION & SIGN-OFF

This Phase C1B-4A revision resolves all schema and configuration audit findings:
- Aligns physical schema documentation to 17 application tables, 9 PostgreSQL enum types, 32 foreign keys, and 11 `idempotency_records` columns.
- Eliminates the claim of a secondary `packages/database` schema mirror.
- Corrects direct connection username format (`postgres` vs `postgres.[PROJECT_REF]` on poolers).
- Documents the behavioral interaction between `auth/login` and database-level read-only roles.
- Classifies all controls under the four-status taxonomy (`[IMPLEMENTED_IN_SOURCE]`, `[DESIGN_ONLY]`, `[NOT_YET_TESTED_ON_CLOUD]`, `[OPERATOR_APPROVAL_REQUIRED]`).
- All live database operations remain strictly `[NOT_YET_TESTED_ON_CLOUD – ZERO EXECUTION]`.
