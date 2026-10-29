# Stage4C — GLOBAL evidence PREPARE writer port (REVIEW ONLY)

**Date:** 2026-10-30. **Scope:** new isolated source code + mock tests only. No HTTP route, Prisma adapter, PostgreSQL connection, SQL, migrations, Supabase, data transfer, source UAT/DEV checkpoint change, feature flag, merge or release.

This change builds on the transaction-bound BIZ-02..05 return writer port in Draft PR #32. Draft PR #31 separately describes the *proposed* DBA schema; its schema is **not** approved, and current Prisma schema does not yet have the required global evidence registry or physical custody records.

## Proposed PREPARE transaction semantics

1. Server-authenticated actor ID comes from trusted middleware, **never HTTP body**. Adapter authenticates borrow-object scope and supplies role. ADMIN/LAB_MANAGER/TECHNICIAN may PREPARE; STUDENT cannot.
2. Reject input fields attempting to inject actor, issuer, database IDs, stock snapshots, or trusted state. Enforce code grammar `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$` before ASCII-uppercase canonicalization. Allowed physical lines are positive GOOD/DAMAGED only; LOST needs a separate incident.
3. Enter adapter-provided **SERIALIZABLE** transaction, lock the borrow scope in the standard lock order, inspect borrow-scoped replay key and authentic previous result, reject an unresolved PREPARED or RECONCILIATION_REQUIRED operation, then load the outstanding borrowed quantities under locks.
4. For exactly matching signed-in actor, borrow ID, request key, canonical code and canonical set of physical lines, return persisted replay. Same key with a changed payload is a conflict. The resulting **PREPARE** request fingerprint is canonicalized deterministically (sorting physical lines by detail ID).
5. Ask the **future database adapter** to persist **atomically**: an immutable global evidence registry row UNIQUE by canonical ASCII casefolded key across all borrows and issuer types; return operation + physical lines; request-key idempotency record with 365-day minimum metadata; audit entry. The evidence registry must never recycle a code after CANCEL. Any failure must roll back ALL writes.
6. Borrow-scoped locking alone does **not** prevent the same evidence key from being issued on two different borrows. Only a true DB UNIQUE constraint with the corresponding race-safe transaction and constraint-violation handling can establish that guarantee. **The module does not implement that constraint**, it only requires the future port to enforce it.

### Deliberately NOT implemented or approved

- No `Stage4CPrepareTransactionPort` Prisma or PostgreSQL implementation (no approved migrated tables); no new HTTP route, no actual PREPARE record, no global registry DDL.
- No live proof of global uniqueness, integrity, concurrent tx retry, rollback, collision handling or migration.
- No genuine physical RECEIVE/VERIFY, stock movement, audit or custody approval persistence. These remain blocked by DBA design #11 and separate test authorization #12/#13.
- No merging stacked PRs or enabling `ACM_RETURN_OPERATIONS_ENABLED`; new return router remains fail-closed.

### Offline acceptance

`scripts/stage4c-return-prepare.offline.mjs` contains 16 mock transaction scenarios:
- successful global canonical issuance with atomic PREPARE intent
- cross-borrow case-insensitive collisions, and no code reuse after cancellation
- deterministic retries despite letter-case and line reorder
- wrong payload/actor idempotency replay rejection
- RBAC and borrow-scope denial
- unresolved operation, malformed/LOST/over-return prevention
- injected late-stage failure with fake full rollback
- malformed adapter output protection
- subsequent valid partial return only after previous operation terminal
- two same-code cross-borrow concurrent calls using a **globally serialized in-memory fake** (this does not prove PostgreSQL concurrency).

CI also reruns 57 existing pure tests from Draft PR #32 and strict TypeScript checks. **A passing CI run is evidence for the pure modules and in-memory double only, not production readiness.**

### Next permissions needed

1. DBA reviews Issue #11, approves coherent global evidence registry/partial indexes, immutable ledger, per-line QC, custody and terminal-state checks.
2. Obtain verified independent sandbox-creation approval #12 and separate SQL/migration authorization #13; do **not** infer it from generic owner approval.
3. Only after those permissions, implement an isolated database adapter using approved Prisma+manual PostgreSQL migrations, synthetic fixtures, two actual PG connections, retry/race/fault tests, and an independent backup/restore exercise.
4. Only after real Web↔API↔PG17 E2E and RBAC acceptance (#15/#26) can owner grant LOCAL GO; cloud provisioning requires separate scope/signoff.
