# ACM Stage4C — Joined COMMIT preflight (REVIEW ONLY)

**Date:** 2026-11-08. **State:** `DRAFT / RELEASE_NO_GO`. **Source:** new review-only `borrow.return-joined-posting.review.ts`, stacked on security/Stage4C preflight PR #74, **not a deployed writer**.

## Purpose and gap addressed

Earlier isolated functions proved (1) BIZ-02 independent physical RECEIVE/VERIFY, per-detail remaining quantity, BIZ-03 quarantine-first and (2) multi-line stock balance arithmetic. They did **not** join the server's borrow-detail/source-allocation identities with the authoritative item/location/stock-balance mapping in one call. A future transactional writer may otherwise post individually valid return lines into a wrong balance or overrun a shared balance.

This patch exposes `planJoinedStage4CPostingForReview(trustedFacts, allocations, buckets)` as an **offline, deterministic arithmetic plan**. The three arguments are *not* HTTP payloads. They MUST eventually be loaded from trusted and locked DB rows in a **separately DBA-approved** Serializable transaction.

## Invariants checked

1. Original BIZ-01/02/03/04/05 COMMIT preflight **must succeed first**: PREPARED; distinct RECEIVER and VERIFY; authorization; evidence syntax; no LOST disguised as received; no cross-source return; no per-detail overreturn.
2. Every proposed disposition has exactly one selected locked borrow allocation, identified by case-normalized UUID. Duplicate or unknown detail IDs fail closed.
3. Allocation `originalQuantity`, `alreadyReturnedQuantity`, and source location agree with the source-of-truth borrow line; no client-selected stockBalanceId is trusted.
4. Selected `stockBalanceId` maps to an immutable `itemId` and `locationId`; any mismatch, missing or duplicate stock bucket is denied.
5. Every item/location shared by multiple return lines is planned from **one evolving stock balance**, so aggregate returns greater than `borrowed` are denied even where each line is individually valid.
6. Initial receipt adjusts `borrowed -= qty; onHand += qty; quarantined += qty`, while `availableAfter == availableBefore`. Independent GOOD QC and per-receipt unique claim must be a separate transaction.
7. Inputs are not mutated. IDs and output order are normalized deterministically; arithmetic overflow and malformed snapshots fail closed.
8. Existing RC5 router/service and Stage4C hard-503 fence remain unchanged.

## What is NOT proven

- Database row ownership/locking and source-of-truth/provenance cannot be established by TypeScript data types. **Source rows must be read after DB locks; client must not provide these records.**
- No SQL, Prisma migration, new route, live PostgreSQL 17, real physical custody, asset/serial posting, post-error recovery, audit atomicity, unique receipt/idempotency constraint, durable QC claim, backup or restore.
- No authentication or RBAC integration; an actual API must fetch roles from a valid session/DB and enforce on server.
- No guarantee of zero bugs from CI. The 19-model RC5 Prisma schema is unchanged; no Stage4C 20th model has been approved.
- Linux/CI-local PostgreSQL 16 passing is **not** DBA approval, Windows UAT evidence or PG17 validation.

## Release gate and next handoff

- [ ] **DBA #11**: decide all G01–G11, especially unique evidence key scope, once-only receipt, stock-item-location provenance, lock ordering, QC/LOST accounting, schema/DDL/rollback; record person/role/reviewed SHA/UTC.
- [ ] **AppSec #42**: independently inspect the joined-trust boundary, user-supplied IDs, duplicate/replay/IDOR, stale snapshots, 503 release fence and RC5 coexistence.
- [ ] **PostgreSQL 17 Create #12**: two **different real humans** approve exact isolated new-cluster scope. General consent is not approval.
- [ ] **SQL/restore/concurrency #13**: separate explicit authorization after #11/#12, with real session/identity hashes.
- [ ] **Return Writer #14**: implement DB-attested authenticated PREPARE→RECEIVE→VERIFY→COMMIT, conditional locked updates + unique claim + receipt + audit in one transaction. No routing until signoff.
- [ ] **UAT #15/#26**: 4 roles with synthetic data, real local DB-backed E2E, two sessions, backup→restore on separate DB, ownership and mobile choice #49. Final owner/QA LOCAL GO only on exact SHA.

**DO NOT** merge `main`, alter `D:\\ACM_QLLK_UAT`, run initdb/SQL/migration, open the Stage4C API, touch Render/Supabase/production, use real user data or paid services through this document. **RELEASE_NO_GO.**
