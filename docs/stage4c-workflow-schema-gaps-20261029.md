# ACM Stage4C — Backend transition planner & schema compatibility gaps

**Date 2026-10-29. REVIEW ONLY / NO-GO.** This document accompanies a **stacked Draft PR** based on the earlier pure policy PR #23. The files in this branch do **not** connect routes/services to Prisma, do not migrate the database, and do not enable the new return API.

## 1. Code added

- Extended `borrow.return-policy.ts` with `planReturnTransition(snapshot, command)`. Its output is a **proposed** next state and event; it is **not** evidence that receipt, inventory, Asset or audit were persisted.
- Enforces RECEIVE → independent VERIFY → COMMIT; denies same receiver/verifier; denies duplicate receipt, verify, COMMIT, CANCEL after COMMIT; refuses invalid, duplicate or damaged QC release; keeps GOOD and DAMAGED quarantined at COMMIT.
- COMMIT requires a caller-supplied `lockedBorrowDetails` snapshot and revalidates all returned quantities. **The eventual adapter must obtain those values inside a real lock-first Serializable transaction; a caller-provided array from HTTP is never trusted.**
- Adds `scripts/stage4c-return-workflow.offline.mjs` with 17 offline Node tests (WF-01…17). Combined with 15 POL tests from #23: **32 standalone tests** of pure functions. Does **not** test actual PostgreSQL concurrency, idempotency retention, audit durability or atomic effects.
- This branch intentionally leaves legacy writer, new 503 router, env flags and original nine UAT WIP files unchanged.

## 2. Verified Stage4C Prisma gaps to resolve with DBA and implementation

Inspected *operator-uploaded* Stage4C WIP `apps/api/prisma/schema.prisma` SHA-256 `ab5bbdc7f6f1de397740fadb4d5522a59bbb9a819e23dfd658218cc144032fac` (not committed as schema changes):

| Requirement from owner BIZ-01…05 | Available schema | Missing / reviewer decision |
|---|---|---|
| RECEIVE confirms actual physical receipt with actor/time BEFORE COMMIT | `ReturnTransaction.receiverId` only on final receipt | `BorrowReturnOperation` does not have independent receiver confirmation fields/time; decide persisted trusted provenance and state |
| VERIFY by another ADMIN/LAB_MANAGER BEFORE COMMIT | `BorrowReturnOperation.createdById/committedById/cancelledById` | No verifier actor/time field; design immutable independent approval, checks preventing self-verification at DB/service |
| Quarantine first, release GOOD by QC later | `StockBalance.quarantined`, `ReturnDetail.condition`, `Asset.status` exist | No per-line QC approval provenance, quarantine release stage or reviewed atomic stock/serial transition in new operation |
| COMMIT atomic and durable receipt even after idempotency TTL | `BorrowReturnOperation.returnTransactionId @unique`; `IdempotencyRecord.key @unique` with `expiresAt` | Existing idempotency key appears globally unique, not scoped by (borrow,key); confirm mapping/replay strategy and >=365-day storage; separate durable receipt uniqueness from expiring key |
| Exactly one unresolved return operation per borrow | 2B candidate has partial index `WHERE state IN ('PREPARED','RECONCILIATION_REQUIRED')` | Prisma model cannot express partial index; final one-piece DBA-reviewed DDL and real two-session race test required |
| Case-insensitive BIZ-01 code | `physicalEvidenceRef String` and `@@unique([borrowRequestId, physicalEvidenceRef])` | Default case-sensitive DB uniqueness may violate BIZ-01; decide canonical key, unique scope, collision handling and full regex CHECK. No blind `CITEXT` or data changes |
| Composite FK receipt belongs to same borrow | `ReturnTransaction @@unique([id, borrowRequestId])` and `BorrowReturnOperation` composite relation | 2A review SQL still uses single-column FK and nullable evidence; consolidate one reviewed final migration; **do not run 2A then 2B** |

**Scope note:** `BorrowReturnOperation` lacks the required BIZ-02 RECEIVE/VERIFY provenance and BIZ-03 per-line QC records. Therefore the offline planner is deliberately NOT wired to a live writer; claiming full implementation would be false.

## 3. Next engineering package (not yet implemented)

1. Choose and review exact persistent workflow records and API contracts (RECEIVE, VERIFY, COMMIT, QC_APPROVE, CANCEL, loss incident) using owner BIZ-01..05.
2. Implement server-only evidence issuer/verifier with authenticated actors and immutable audit; enforce NOT NULL, case-insensitive uniqueness and same-borrow FK via DBA-approved schema.
3. Shared lock order for old/new return; one Serializable transaction for borrow rows, receipt details, quarantine movements, Asset serial updates, audit and terminal status. Conservative retry and missing-response reconciliation.
4. Run the 32 offline tests, then approved PG17 negative constraint + 2-session race + rollback tests with synthetic fixtures.
5. Supabase staging migration/data-access policy needs **separate** explicit authorization; production release remains separate.

**NO-GO:** no DB access/SQL/migration, no generated Prisma client against WIP schema, no UAT mutation, no merge, no feature flag enable, no genuine production writer, no Supabase writes.
