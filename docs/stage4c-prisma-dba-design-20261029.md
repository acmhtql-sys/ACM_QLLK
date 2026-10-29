# ACM Stage4C — Prisma schema delta proposal (DBA REVIEW ONLY / NO-GO)

**29/10/2026 — REVIEW ONLY.** This is **not** a modified runtime Prisma schema, executable migration, release approval, PostgreSQL test, or proof that the Backend writer is operational. Owner business decisions BIZ-01…BIZ-05 are in Draft PR #22. Offline guards/planner are in Draft PR #23/#24.

## Evidence checked against actual operator UAT source
- 9-file UAT ZIP SHA256: `938479d53afa7f16b2923bbf9611b4480957c19ce24d835b84d19c59d5fc332a`.
- WIP `apps/api/prisma/schema.prisma` SHA256: `ab5bbdc7f6f1de397740fadb4d5522a59bbb9a819e23dfd658218cc144032fac`.
- WIP `BorrowReturnOperation` has `state`, `createdById`, `committedById`, `cancelledById`, `physicalEvidenceRef`, `requestHash`, `returnTransactionId` but **no** distinct persisted RECEIVE/VERIFY actor + timestamp, nor per-line QC release.
- `ReturnTransaction` has `receiverId` and `@@unique([id,borrowRequestId])`. Its DB column is quoted `"borrowRequestId"` (NO `@map`). `BorrowDetail` also uses quoted `"borrowRequestId"`, but lacks `@@unique([id,borrowRequestId])`.
- `StockBalance` has `onHand`, `reserved`, `quarantined`, `kitAllocated`, `borrowed`; `StockMovement` has `referenceType`/`referenceId` but no unique stock-effect posting key. `IdempotencyRecord.key` is globally unique and record expiration is present.
- Previous `Stage4C2A` and `Stage4C2B` are REVIEW ONLY and **MUST NOT run sequentially**: nullable evidence and single-column FK in 2A, duplicate unresolved index name, missing BIZ-01 regex/case-insensitivity.

## Proposed Prisma field-level changes — NOT a full valid schema
Every relation requires inverses (User, BorrowRequest, BorrowDetail, Asset etc), correct `@map` and Prisma 5.21.x validation, plus a DBA-generated single final diff.

| Target model | Proposed fields or relation | Business rule |
|---|---|---|
| `BorrowReturnOperation` | `receivedById String? @map("received_by_id") @db.Uuid`; `receivedAt DateTime? @map("received_at")`; `verifiedById String? @map("verified_by_id") @db.Uuid`; `verifiedAt DateTime? @map("verified_at")` | BIZ-02 and BIZ-04: trusted receiver and DIFFERENT authorized verifier, immutable audit |
| `BorrowReturnOperation` | `evidenceIssuedAt DateTime @default(now()) @map("evidence_issued_at")`; `evidenceIssuer String @default("ACM") @map("evidence_issuer")`; `physicalEvidenceCanonical String @map("physical_evidence_canonical")` | BIZ-01/BIZ-02: ACM-only issuance and ASCII uppercase comparison; code issuance ≠ physical receipt |
| `BorrowReturnOperation` | `@@unique([id,borrowRequestId])` and collection relations for lines/keys | Composite FK ownership |
| New `BorrowReturnOperationLine` | `operationId`, `borrowRequestId`, `borrowDetailId`, `quantity Int`, `condition AssetCondition`, optional `assetId`, `qcReleasedById`, `qcReleasedAt`; `@@unique([operationId,borrowDetailId])` | Physical GOOD/DAMAGED lines go to quarantine. Only GOOD after authorized QC may release. LOST must use separate incident, NOT physical receipt |
| `BorrowDetail` | `@@unique([id,borrowRequestId])` | Composite FK ensures physical return line belongs to same borrow |
| New `BorrowReturnRequestKey` | `borrowRequestId`, `requestKey`, `actorId`, `payloadHash`, `operationId`, `createdAt`, `retainUntil`, `resultRef`; `@@unique([borrowRequestId,requestKey])` | BIZ-05: scope by borrow+key; >=365 days; existing global key record must not be silently rewritten |
| New `BorrowReturnPosting` | `operationLineId`, `effectKind`, `stockMovementId`; `@@unique([operationLineId,effectKind])` | Exactly-once receipt/quarantine/QC stock effect, survives key expiry |
| Separate future loss incident | borrower/borrow line, reporter, evidence, authorization, resolution | LOST must not fake physical receipt or return available stock |

**OPEN:** BIZ-01 does not specify whether a canonical evidence code is UNIQUE globally or per borrow. Propose global uniqueness for review, not as an implicit owner approval.

## Required constraints and negative tests (DDL design only)
- BIZ-01 strict ASCII 1–128 and case-insensitive canonical key; reject Unicode/space/empty/trim/non-ASCII/control and case variant duplicates; review `COLLATE "C"` semantics.
- BIZ-02/04: receiver + receivedAt present together, verifier + verifiedAt present together; verifier distinct from receiver; completed state requires legitimate receipt, verification, committedBy, returnTransactionId, completedAt. DB CHECK cannot replace server RBAC/provenance.
- BIZ-03: received GOOD/DAMAGED always quarantined on COMMIT; GOOD releases only after distinct authorized QC. LOST is a separate incident without RECEIVED.
- BIZ-05: one unresolved operation/borrow with one reviewed partial UNIQUE index; quantity nonnegative/overreturn locked; same-borrow composite FK for receipt and lines; idempotency unique borrow+key, >=365 days; durable posting/receipt uniqueness after TTL.
- **CRITICAL OPEN GOVERNANCE:** owner approved pre-COMMIT CANCEL with no stock effects, but CANCEL after physical RECEIVE before COMMIT can leave real goods unaccounted. Must choose a controlled physical-return reversal/incident procedure or forbid CANCEL after RECEIVE until compensating custody handling. Do not implement a silent path.
- Real 2-session concurrency, Serializable lock order with legacy return, injected failure rollback, stock ledger/Asset serial accuracy, backup/restore and retention require separately approved PostgreSQL 17 tests. No mock/regex proof substitutes.

## Cross-version and Supabase safety
This repository uses Prisma 5.x, not necessarily the latest Supabase quickstart API. Never transplant a current Prisma adapter migration guide without version checks. Keep PostgreSQL credentials on the Backend only. If the application uses only Prisma and no Supabase REST/GraphQL Data API, review disabling Data API; otherwise review grants and RLS on exposed tables. No action on Supabase authorized.

Official documentation: https://supabase.com/docs/guides/database/prisma and https://supabase.com/docs/guides/api/securing-your-api

## Approval / execution blockers
- Owner-approved business rules 5/5: **YES (conversation)**. Organizational identity/signature outside conversation not independently verified.
- Independent DBA approval (#11): **NO**.
- Two-person isolated PostgreSQL creation approval (#12): **NO**.
- Exact forward + guarded rollback and test SQL authorization (#13): **NO**.
- Separate Supabase staging DDL/data authorization (#21): **NO**.
- Release UAT/restore/E2E signoff (#15): **NO**.
- Status: **PREPARE / DBA REVIEW PENDING / SQL NO-GO**. Do not edit the Windows UAT working tree, publish its nine WIP source files, merge PRs, enable return endpoints, or migrate data.
