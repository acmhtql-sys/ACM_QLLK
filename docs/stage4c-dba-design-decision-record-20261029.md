# ACM Stage4C — DBA Design Decision Record (REVIEW ONLY / NO-GO)

**Date:** 2026-10-29
**Status:** DRAFT; not migration, no DB approval, no LOCAL/CLOUD GO.
**Baseline:** `0847a73088b98d8b00fb6ac06f02b2f56d288b78` (UAT base). DEV checkpoint `0be458b1dd36ee327670b684c571d03934e5397a` exists **only on operator's Windows machine**, not merged or pushed.

## Evidence / facts

- Operator verified 9/9 UAT WIP SHA-256 hashes; third REVIEW clone reproduces precisely 4 modified + 5 untracked files; DEV checkpoint remains clean.
- Distinct local suites: 474 PASS on DEV (54 offline, 135 Shared, 88 Web unit, 178 API Mock, 19 Playwright mocked UI); 31 PASS on REVIEW (22 WIP unit, 9 WIP schema-text). **505 is a sum across suites and environments, not fullstack coverage.**
- WIP Prisma validate, shared build, strict standalone return foundation TypeScript: PASS, **no Prisma client generation against WIP**.
- Offline `prisma migrate diff --from-schema-datamodel DEV --to-schema-datamodel REVIEW --script` SHA-256 `90ed5f9333795fdb475771bec2a47f206daffda4f469b89de4616405fe4ae6e2`: 1 CREATE TABLE, 6 indexes, 5 FKs, **no CHECK/partial unique** and no production execution.
- UAT 2A `53337db7d3c5e9447f581d2b3b2e6aea4f9df633b347d451ad63dc64657bcb4b`, UAT 2B `836f4b4397f0e71b7e0a7da67862c772cd48ee4ec8a6771acf69efeb18c272c6`, WIP Prisma schema `ab5bbdc7f6f1de397740fadb4d5522a59bbb9a819e23dfd658218cc144032fac`.

## Verified migration blockers

1. Prisma-generated diff and 2A both CREATE `borrow_return_operations`. Never concatenate them.
2. 2A and 2B both CREATE `borrow_return_operations_one_unresolved_per_borrow`. Generated diff omits this index. Require exactly one reviewed partial UNIQUE on borrow for `PREPARED`/`RECONCILIATION_REQUIRED`.
3. Generated diff `physical_evidence_ref NOT NULL` vs 2A `NULL`; 2B CHECK accepts too broad a format; raw unique is case-sensitive. Approved business direction requires ASCII regex `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`, canonical casefold, trusted issuer. **Owner selected GLOBAL case-insensitive uniqueness** on 2026-10-29 for REVIEW ONLY; Issue #11 still requires formal regex/issuer signoff and DBA index review.
4. Generated diff has composite receipt-to-borrow FK while 2A has only single-column FK; use verified composite relationship.
5. 2A/2B have overlapping terminal-state/hash CHECK constraints; generated diff has none; consolidate with explicit NULL handling.
6. Timestamp mismatch: Prisma diff `TIMESTAMP(3)` without timezone, 2A `TIMESTAMPTZ` and a different `updated_at` default.
7. No pre-COMMIT `received_by/received_at` and `verified_by/verified_at`; no per-line QC provenance, no LOST incident separation, no durable scoped idempotency/stock posting dedup or atomic writer.
8. The new HTTP API still returns 503; `ACM_RETURN_OPERATIONS_ENABLED=true` also disables the legacy return writer. **Never toggle flag until independently verified replacement exists.**

## Owner decision update — 2026-10-29 (business design only)

- **DECIDED for REVIEW ONLY:** A physical evidence reference must be globally unique after strict ASCII validation and case-folded canonicalization; `ACM-01` and `acm-01` conflict even across different borrow requests. A proposed PostgreSQL key is `physical_evidence_key` with a global unique constraint/index, **not** a composite per-borrow unique. Do not assume that a plain unique TEXT column or collation enforces it. Durable issuance and collision handling require DBA and security review.
- **DECIDED for REVIEW ONLY:** When physical RECEIVE has been recorded, a subsequent CANCEL request **must not** immediately set `CANCELLED`. The allowed proposal is `RECONCILIATION_REQUIRED` while preserving receiver and physical custody evidence. A final cancellation requires a separately verified reverse-handover record **or** an approved disposition with independent audit evidence. Neither action implicitly adds to available stock; any later physical inventory adjustment is a distinct authorized stock transaction.
- **NOT APPROVED:** SQL/migration, Prisma generation against WIP, live database writes, release, seed, Supabase, UAT/DEV mutation, toggling `ACM_RETURN_OPERATIONS_ENABLED`, merge or deploy. A conversation-level business decision is not a DBA/organizational sign-off or permission to execute DB operations.
- **Design detail still open:** trusted evidence issuer, exact custody disposition approval roles, timestamps, audit linkage, and reversals of existing physical receipt; all are fail-closed until evidenced.

## Proposed business and data model — requires owner/DBA review

- Continue established workflow `PREPARE -> RECEIVE -> independently VERIFY -> COMMIT -> QC_APPROVE`. Persist server-authenticated receiver/verifier actor IDs and timestamps separately, immutable audit event per action. PREPARE/RECEIVE roles: ADMIN/LAB_MANAGER/TECHNICIAN; VERIFY/COMMIT/QC/CANCEL: ADMIN/LAB_MANAGER; receiver cannot verify own receipt.
- Persist original physical evidence ref and canonical ASCII comparison key. Owner selected **GLOBAL case-insensitive** key (e.g., uniqueness on canonical ASCII uppercased value, not `(borrow_id, key)`); DBA must verify index/collation, historical collisions, and issuer provenance before approval.
- Add physical ReturnOperationLine records for only GOOD/DAMAGED quantities, quarantine-first; QC release only GOOD after COMMIT, with per-line actor/time and durable release dedup. LOST goes to separate incident workflow, never a fictitious physical receipt.
- Retain existing `PREPARED`, `RECONCILIATION_REQUIRED`, `COMPLETED`, `CANCELLED` states unless independently approved to change; RECEIVE and VERIFY as durable sub-events before COMMIT.
- Idempotency contract: scoped `(borrowId, requestKey)`, payload SHA-256, actor permission and at least 365 days retained metadata; committed receipt/stock dedup must survive TTL. Current generic `IdempotencyRecord.key @unique` cannot by itself prove this.
- Shared lock-first Serializable transaction covering borrow, details, operation/replay, balances, assets, receipt and audit; locked outstanding quantities must be read from DB rather than trusted HTTP payload. Legacy writer must obey the same lock order.
- **CANCEL after physical RECEIVE is APPROVED as business policy, DESIGN ONLY**: transition to `RECONCILIATION_REQUIRED`, retain recorded custody; only after approved reverse-handover evidence or an authorized disposition decision may the operation become `CANCELLED`; no automatic increment to available stock. Actual custody model, evidence authentication, roles and schema must still pass security/DBA review.

## Approvals and test gates (all OPEN beyond static evidence)

- **G1 Owner:** owner approved GLOBAL case-insensitive uniqueness and post-RECEIVE reconciliation-only cancellation in this project conversation on 2026-10-29, REVIEW ONLY. The proposed ASCII regex is used as the current BIZ-01 design, while **formal documented issuer/regex signoff and organizational approval evidence remain open**. Record accountable approver/date/evidence on [#11](https://github.com/acmhtql-sys/ACM_QLLK/issues/11).
- **G2 DBA:** one consolidated matching Prisma/schema PostgreSQL migration design, CHECK/partial unique/FK, timestamp, UUID, drift, data preflight, forward and guarded rollback. Design approval is not authorization to execute.
- **G3 Backend:** implement and peer-review authenticated return writer, QC, incident, atomic movement, tests, legacy compatibility.
- **G4 PG17 isolated authorization:** separate DB sandbox permission (#12/#13), synthetic fixture, negative constraints, 2-session races, fault-injection rollback, backup and independent restore.
- **G5 LOCAL GO:** real frontend↔backend↔PostgreSQL E2E, RBAC/IDOR/audit/security, storage ACL, performance and backup restore; owner signoff #15/#26.
- **G6 CLOUD GO:** only after LOCAL GO; separately authorize provisioning and testing Vercel/Render/Supabase/Cloudinary, data movement and production release.

## Deadline check

As of 2026-10-29 evening, **do not promise full completion by Friday 2026-10-30 evening**; only review-only design and additional offline implementation can be responsibly targeted in that period. Complete system still requires owner/DBA decisions, real PG17 transaction tests, end-to-end signoff and cloud rollout gates.

**Forbidden by this document:** migrations, `prisma db push`, real SQL or database writes, UAT/DEV checkpoint mutation, changing feature flag, merges, cloud resources, real-data transfers, release signoff.
