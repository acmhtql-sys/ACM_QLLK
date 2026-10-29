# ACM Stage4C — proposed PostgreSQL/Prisma constraint contract

**Date:** 2026-10-30. **REVIEW ONLY / NO-GO.** Draft linked to owner-approved business decisions and [Draft PR #29](https://github.com/acmhtql-sys/ACM_QLLK/pull/29). [Manifest](./stage4c-dba-target-contract.review.json) and [offline design checks](../scripts/stage4c-dba-target-contract.offline.test.mjs) describe requirements; they are **not** executable migrations and do **not** demonstrate PostgreSQL safety.

## 1. Owner decisions — now fixed at business-design level

- Evidence must have a **global** canonical key. The same evidence string ignoring ASCII letter case is forbidden even if it refers to *another borrow* or another issuer/entity type. Validate the approved 1–128-character ASCII format `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$` before ASCII-uppercase normalization. Retain original for audit and display. Do not recycle issued codes after CANCEL.
- A cancellation request **before** physical receipt can become CANCELLED with an authorized actor and reason. A cancellation request **after** recorded RECEIVE enters **RECONCILIATION_REQUIRED**, retains receiver identity and physical custody. Only a separately verified **REVERSE_HANDOVER** or **APPROVED_DISPOSITION** may settle the custody record and allow final CANCELLED. None of these cancellation actions automatically credits available inventory.
- This approval is **REVIEW ONLY**, not authorization to create or alter tables, run queries, turn on the return API, create Supabase resources, access real data, integrate into Windows DEV or UAT, or merge pull requests.

## 2. Proposed persistence schema (DBA must review)

| Entity / contract | Proposed fields and invariants | Why |
|---|---|---|
| **evidence_registry** — new global namespace proposal | ID, original ASCII value, canonical ASCII-uppercase key, issuer actor, purpose type, owner reference, issued timestamp. A global UNIQUE index/constraint on canonical key, not scoped to a borrow. Immutable issuance ledger; no reuse on cancel. | One namespace across different borrows, receipt/custody/other issuers; app-only collision checks cannot prevent races |
| **borrow_return_operations** | Existing WIP fields plus physical `received_by_id`/`received_at`, independent `verified_by_id`/`verified_at`, cancel-request actor/time/reason, `reconciliation_reason`; link physical evidence to global registry. Keep committed and cancelled actor/time distinct. | Durable multi-person custody and transaction history |
| **return_operation_lines** | Operation, borrowed detail, GOOD/DAMAGED condition, positive quantity, QC reviewer/time, permanent stock posting ID, unique operation/detail. | No fabricated LOST receipt, quarantine-first, per-line QC provenance |
| **return_custody_resolutions** | Unique operation reference, kind REVERSE_HANDOVER or APPROVED_DISPOSITION, immutable global evidence reference, custody receiver, independent authorized approver and timestamp. | Cannot finalize cancellation after RECEIVE without trusted resolution |
| **return_operation_idempotency** | Borrow ID, request key, canonical payload hash, authenticated actor, creation and minimum 365-day retention deadline, result reference; UNIQUE (borrow ID, request key). | Scope idempotency per borrow without depending only on expiring keys |
| **return_stock_postings** | Unique operation/borrow detail/posting kind; immutable stock movement reference. | Durable stock/receipt dedup even after idempotency expiration |
| **return_loss_incidents** | Separate borrower/detail, reporter, state, resolution and audit reference (full spec to be reviewed). | LOST does not count as returned physical inventory |

**Prisma mapping caveat:** PostgreSQL generated/computed columns, custom CHECK constraints and partial UNIQUE indexes may not be fully representable in Prisma Schema DSL. Use one **DBA-reviewed consolidated** Prisma-plus-manual DDL migration after approved design, not the current three SQL proposals concatenated. Review generated column vs materialized canonical key trade-offs; if materialized, DB must independently enforce canonical equality, not trust the caller.

**Existing table caveat:** WIP `return_transactions` references must preserve **composite same-borrow FK** `(return_transaction_id, borrow_request_id)` → `return_transactions(id, borrowRequestId)`. New timestamps are proposed as UTC-aware `TIMESTAMPTZ(3)`, while the existing WIP Schema Diff uses `TIMESTAMP(3)`; DBA must approve compatibility and migration choreography. Do not blindly change legacy timestamps.

## 3. Database-enforced invariants to approve

1. Single global evidence key register (unique across **all** issuer types), strict ASCII regex before folding, immutable issuance and server-only issuance authorization. Verify historical registry / legacy code collisions before constraint creation.
2. Exactly one unresolved operation per borrow (states PREPARED or RECONCILIATION_REQUIRED), with one partial UNIQUE index—not duplicated 2A and 2B definitions.
3. No operation may use a return receipt belonging to another borrow; enforce composite FK, with terminal state constraints and explicit handling of NULLs in CHECK expressions.
4. RECEIVED and VERIFIED identity/time persist separately, are audit linked and cannot be silently overwritten. The receiver may not also verify. An authorized administrator acting as COMMITTER is a separate identity/event.
5. A post-RECEIVE CANCEL **request** must generate reconciliation and retain custody. Finalized cancellation demands a valid persisted custody resolution reference, approved actor, evidence and audit event. This is cross-table business logic and cannot be proven by a single row CHECK alone.
6. Reconciliation can also be triggered by uncertain transaction outcomes, not just physical custody; distinguish causes using `reconciliation_reason`. Do not add a CHECK requiring every RECONCILIATION_REQUIRED row to have physical RECEIVED timestamp.
7. Only positive GOOD/DAMAGED physical lines; COMMIT places returned physical goods into **quarantined** balance, never immediately available. QC_APPROVE later releases only GOOD with durable stock movement, never DAMAGED.
8. Authenticated service computes scoped payload SHA-256 and idempotency key, locks the persisted row and rechecks everything under one SERIALIZABLE transaction. Unique committed posting references prevent retry double credits after a 365-day record TTL.
9. Enforce a shared deterministic lock order for old/new return writers. Current feature flag leaves new routes at HTTP 503; **do not enable it** while old return is disabled and new writer missing.

**Safety note:** Constraints prevent some classes of corruption; only authenticated server authorization, locking, immutable audit and independent PostgreSQL concurrency/failure tests can enforce the remaining workflow invariants.

## 4. Single migration design — planned, NOT generated or authorized

- **Gate A, design:** verify production-like schema history, actual catalog, identifiers and existing historical evidence formats without accessing real data until separately authorized. DBA chooses generated-vs-materialized canonical key, timestamp mapping, CHECK, indexing and FK strategy, plus detection of duplicates before cutover.
- **Gate B, empty isolated PG17:** after specific permission, create a new database dedicated to synthetic fixtures, review a *single* forward + guarded rollback plan. Run constraint-negative tests before any historical data is copied.
- **Gate C, negative and race:** two sessions competing for same casefolded global code across different borrows and issuer types, duplicate unresolved operation, composite mismatched receipt, over-return, self-verification, replay after timeout, concurrent QC/return, failure injection with complete rollback. Prove no double stock and audit trace on retry.
- **Gate D, rehearsal:** explicit backup/restore exercise, synthetic end-to-end React↔Express↔Postgres, security/RBAC/IDOR tests, manual UAT signoff. Then and only then consider LOCAL GO.
- **Gate E, cloud:** separate owner permission for Supabase staging migration/data handling and cloud rollout; LOCAL GO is a prerequisite but is not authorization to run cloud writes.

## 5. Explicit outstanding approvals and handoff

- **Owner:** approved the two business choices in conversation. Formal accountable signoff and issuance source/regex may require additional organizational evidence per [Issue #11](https://github.com/acmhtql-sys/ACM_QLLK/issues/11).
- **DBA:** choose physical DB mapping and sign off complete migration/check constraints/rollback, including legacy data/clock compatibility. **OPEN**.
- **Backend:** implement trusted evidence registry issuance, authenticated scoped controller, custody proof storage and retrieval, durable audit, PG transaction writer. **OPEN**.
- **Infrastructure / operator:** authorize isolated PG17 creation, synthetic DB schema application, two-session concurrency/restore tests. **OPEN**.
- **Release:** full local E2E, backup restore, security and owner signoff remain **NO-GO** at [#15](https://github.com/acmhtql-sys/ACM_QLLK/issues/15) and [#26](https://github.com/acmhtql-sys/ACM_QLLK/issues/26).

### Source safety / baseline

Evidence known as of 2026-10-30: Windows DEV checkpoint `0be458b1dd36ee327670b684c571d03934e5397a` is **local only**; UAT pinned base `0847a73088b98d8b00fb6ac06f02b2f56d288b78` with nine separately verified WIP files; isolated REVIEW clone preserves overlay. 474 previous DEV tests, 31 REVIEW WIP tests, and 43 GitHub pure policy tests were separately observed. They are not one run nor proof of PostgreSQL migration or actual Web↔API behavior. This document and manifest do not alter any of those environments.
