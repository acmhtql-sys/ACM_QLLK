# ACM Stage4C — SINGLE CONSOLIDATED POSTGRESQL DDL DESIGN CANDIDATE

**30 October 2026 — REVIEW ONLY / UNAPPROVED / DO NOT RUN.** This document contains **illustrative PostgreSQL DDL text** in a Markdown code fence, **not a .sql migration**. It is deliberately outside `apps/api/prisma/migrations`. No database was connected or modified while preparing this design. An authorized DBA must reconcile this proposal with migration history, the current catalog, the Prisma schema and all return writers BEFORE producing separately signed forward/rollback SQL.

**Source references:** UAT WIP Prisma SHA-256 `ab5bbdc7f6f1de397740fadb4d5522a59bbb9a819e23dfd658218cc144032fac`; 2A SQL SHA `53337db7d3c5e9447f581d2b3b2e6aea4f9df633b347d451ad63dc64657bcb4b`; 2B SQL SHA `836f4b4397f0e71b7e0a7da67862c772cd48ee4ec8a6771acf69efeb18c272c6`; Prisma diff SHA `90ed5f9333795fdb475771bec2a47f206daffda4f469b89de4616405fe4ae6e2`. **Do not concatenate any of those three proposals or run this Markdown as SQL.**

## Proposed SQL (unexecuted)

The target assumes these legacy tables *exist* as represented by the UAT Prisma schema: `users(id UUID)`, `borrow_requests(id UUID)`, `borrow_details(id UUID, "borrowRequestId" UUID)`, `return_transactions(id UUID, "borrowRequestId" UUID)`, `stock_movements(id UUID)`. Identifiers and timestamp mappings require live catalog verification after separate approval. All NEW timestamps are proposed as `TIMESTAMPTZ(3)`; legacy columns are not altered here. All UUIDs are supplied by the trusted adapter; there is no implicit extension installation.

```sql
-- *** DBA REVIEW-ONLY PROPOSAL / NEVER EXECUTED ***
-- Assumes BASE Prisma schema without borrow_return_operations; do not run
-- against WIP-migrated databases. No CREATE IF NOT EXISTS: fail on drift.
-- No trigger/procedure/body grants yet. See unresolved gates below.

-- Global immutable issuance register. The ASCII-only CHECK and C-collation
-- canonical expression must be verified by the DBA on PG17.
CREATE TABLE public.return_evidence_registry (
  id uuid PRIMARY KEY,
  original_ascii text NOT NULL,
  comparison_key text GENERATED ALWAYS AS (upper(original_ascii COLLATE "C")) STORED,
  purpose_type text NOT NULL,
  owner_object_id uuid NOT NULL,
  issuer_actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  issued_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT return_evidence_registry_format_chk
    CHECK (original_ascii COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  CONSTRAINT return_evidence_registry_purpose_chk
    CHECK (purpose_type IN ('PHYSICAL_RETURN','REVERSE_HANDOVER','CUSTODY_DISPOSITION')),
  CONSTRAINT return_evidence_registry_unique_key UNIQUE (comparison_key)
);
-- Global uniqueness is NOT scoped by borrow, issuer or purpose.
-- Registry deletion/UPDATE must be prevented with separately reviewed
-- privileges and immutable audit/trigger policy. Unique alone is insufficient
-- to guarantee permanent non-reuse if rows can be deleted.

-- Existing legacy parent IDs are already unique; redundant composite keys
-- are required for child same-borrow foreign-key enforcement.
ALTER TABLE public.return_transactions
  ADD CONSTRAINT return_transactions_id_borrow_ref_unique
  UNIQUE (id, "borrowRequestId");
ALTER TABLE public.borrow_details
  ADD CONSTRAINT borrow_details_id_borrow_ref_unique
  UNIQUE (id, "borrowRequestId");

-- New operation replaces BOTH 2A candidate and Prisma generated CREATE TABLE.
CREATE TABLE public.borrow_return_operations (
  id uuid PRIMARY KEY,
  borrow_request_id uuid NOT NULL REFERENCES public.borrow_requests(id) ON DELETE RESTRICT,
  created_by_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'PREPARED',
  payload jsonb NOT NULL,
  request_hash text NOT NULL,
  physical_evidence_registry_id uuid NOT NULL UNIQUE
    REFERENCES public.return_evidence_registry(id) ON DELETE RESTRICT,
  return_transaction_id uuid UNIQUE,
  received_by_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  received_at timestamptz(3),
  verified_by_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  verified_at timestamptz(3),
  cancel_requested_by_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  cancel_requested_at timestamptz(3),
  cancel_reason text,
  reconciliation_reason text,
  committed_by_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  completed_at timestamptz(3),
  cancelled_by_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  cancelled_at timestamptz(3),
  custody_resolution_id uuid,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT return_ops_state_chk CHECK
    (state IN ('PREPARED','RECONCILIATION_REQUIRED','COMPLETED','CANCELLED')),
  CONSTRAINT return_ops_hash_chk CHECK
    (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT return_ops_received_pair_chk CHECK
    ((received_by_id IS NULL) = (received_at IS NULL)),
  CONSTRAINT return_ops_verified_pair_chk CHECK
    ((verified_by_id IS NULL) = (verified_at IS NULL)),
  CONSTRAINT return_ops_independent_verify_chk CHECK
    (verified_by_id IS NULL OR
     (received_by_id IS NOT NULL AND verified_by_id <> received_by_id)),
  CONSTRAINT return_ops_cancel_request_pair_chk CHECK
    ((cancel_requested_by_id IS NULL) = (cancel_requested_at IS NULL)),
  CONSTRAINT return_ops_completed_chk CHECK
    (state <> 'COMPLETED' OR
      (return_transaction_id IS NOT NULL AND received_by_id IS NOT NULL
       AND verified_by_id IS NOT NULL AND committed_by_id IS NOT NULL
       AND completed_at IS NOT NULL AND cancelled_by_id IS NULL
       AND cancelled_at IS NULL AND custody_resolution_id IS NULL)),
  CONSTRAINT return_ops_cancelled_chk CHECK
    (state <> 'CANCELLED' OR
      (return_transaction_id IS NULL AND committed_by_id IS NULL
       AND completed_at IS NULL AND cancelled_by_id IS NOT NULL
       AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL
       AND NULLIF(btrim(cancel_reason),'') IS NOT NULL
       AND (received_at IS NULL OR custody_resolution_id IS NOT NULL))),
  CONSTRAINT return_ops_prepared_chk CHECK
    (state <> 'PREPARED' OR
      (return_transaction_id IS NULL AND committed_by_id IS NULL
       AND completed_at IS NULL AND cancelled_by_id IS NULL
       AND cancelled_at IS NULL AND custody_resolution_id IS NULL)),
  CONSTRAINT return_ops_post_receive_cancel_chk CHECK
    (reconciliation_reason IS DISTINCT FROM 'POST_RECEIPT_CANCEL' OR
      (received_at IS NOT NULL AND cancel_requested_at IS NOT NULL
       AND cancel_reason IS NOT NULL
       AND NULLIF(btrim(cancel_reason),'') IS NOT NULL
       AND (state = 'RECONCILIATION_REQUIRED' OR
            (state = 'CANCELLED' AND custody_resolution_id IS NOT NULL)))),
  CONSTRAINT return_ops_id_borrow_unique UNIQUE (id, borrow_request_id),
  CONSTRAINT return_ops_receipt_same_borrow_fk FOREIGN KEY
    (return_transaction_id, borrow_request_id)
    REFERENCES public.return_transactions(id, "borrowRequestId")
    ON DELETE RESTRICT
);
CREATE UNIQUE INDEX return_ops_one_unresolved_per_borrow
  ON public.borrow_return_operations(borrow_request_id)
  WHERE state IN ('PREPARED','RECONCILIATION_REQUIRED');
CREATE INDEX return_ops_borrow_created_idx
  ON public.borrow_return_operations(borrow_request_id,created_at);
CREATE INDEX return_ops_creator_idx
  ON public.borrow_return_operations(created_by_id);

-- A physical line must belong to the SAME borrow as the return operation.
CREATE TABLE public.return_operation_lines (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL,
  borrow_request_id uuid NOT NULL,
  borrow_detail_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  condition text NOT NULL CHECK (condition IN ('GOOD','DAMAGED')),
  qc_approved_by_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  qc_approved_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT return_lines_operation_detail_unique UNIQUE (operation_id,borrow_detail_id),
  CONSTRAINT return_lines_op_fk FOREIGN KEY (operation_id,borrow_request_id)
    REFERENCES public.borrow_return_operations(id,borrow_request_id)
    ON DELETE RESTRICT,
  CONSTRAINT return_lines_borrow_fk FOREIGN KEY (borrow_detail_id,borrow_request_id)
    REFERENCES public.borrow_details(id,"borrowRequestId")
    ON DELETE RESTRICT,
  CONSTRAINT return_lines_qc_pair_chk CHECK
    ((qc_approved_by_id IS NULL) = (qc_approved_at IS NULL)),
  CONSTRAINT return_lines_good_only_qc_chk CHECK
    (qc_approved_by_id IS NULL OR condition = 'GOOD')
);

-- Approved disposition is an independently recorded immutable event.
-- No SQL claim of cross-row review scope or actor authorization: service,
-- audit and future DBA-approved immutable triggers MUST enforce those.
CREATE TABLE public.return_custody_resolutions (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE
    REFERENCES public.borrow_return_operations(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('REVERSE_HANDOVER','APPROVED_DISPOSITION')),
  evidence_registry_id uuid NOT NULL UNIQUE
    REFERENCES public.return_evidence_registry(id) ON DELETE RESTRICT,
  custody_receiver_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_by_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_at timestamptz(3) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT return_custody_resolutions_operation_id_id_unique UNIQUE (operation_id,id)
);
-- Operation references an approved-resolution row FOR THE SAME operation.
ALTER TABLE public.borrow_return_operations
  ADD CONSTRAINT return_ops_own_custody_resolution_fk
  FOREIGN KEY (id,custody_resolution_id)
  REFERENCES public.return_custody_resolutions(operation_id,id) ON DELETE RESTRICT;

-- Global borrow-key replay (not generic expiring inventory IdempotencyRecord).
CREATE TABLE public.return_operation_idempotency (
  id uuid PRIMARY KEY,
  borrow_request_id uuid NOT NULL REFERENCES public.borrow_requests(id) ON DELETE RESTRICT,
  request_key text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  payload_sha256 text NOT NULL,
  first_seen_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retained_until timestamptz(3) NOT NULL,
  result_operation_id uuid REFERENCES public.borrow_return_operations(id) ON DELETE RESTRICT,
  result_json jsonb,
  CONSTRAINT return_op_idempotency_borrow_key_unique UNIQUE(borrow_request_id,request_key),
  CONSTRAINT return_op_idempotency_key_chk CHECK
    (request_key COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  CONSTRAINT return_op_idempotency_hash_chk CHECK
    (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT return_op_idempotency_retention_chk CHECK
    (retained_until >= first_seen_at + INTERVAL '365 days')
);
CREATE INDEX return_op_idempotency_retained_idx
  ON public.return_operation_idempotency(retained_until);

-- Permanent committed-posting dedup: MUST survive replay metadata expiry.
-- Stock movement semantics/quarantine adjustment require an adapter review
-- because existing stock_movements has onHandBefore/After, not quarantine deltas.
CREATE TABLE public.return_stock_postings (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL,
  borrow_request_id uuid NOT NULL,
  borrow_detail_id uuid NOT NULL,
  posting_kind text NOT NULL CHECK
    (posting_kind IN ('PHYSICAL_RETURN_TO_QUARANTINE','QC_GOOD_RELEASE')),
  stock_movement_id uuid UNIQUE
    REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT return_postings_dedup_unique UNIQUE(operation_id,borrow_detail_id,posting_kind),
  CONSTRAINT return_postings_op_fk FOREIGN KEY (operation_id,borrow_request_id)
    REFERENCES public.borrow_return_operations(id,borrow_request_id) ON DELETE RESTRICT,
  CONSTRAINT return_postings_line_fk FOREIGN KEY (operation_id,borrow_detail_id)
    REFERENCES public.return_operation_lines(operation_id,borrow_detail_id) ON DELETE RESTRICT
);

-- LOST remains a separate incident, NEVER a received physical line.
CREATE TABLE public.return_loss_incidents (
  id uuid PRIMARY KEY,
  borrow_request_id uuid NOT NULL REFERENCES public.borrow_requests(id) ON DELETE RESTRICT,
  borrow_detail_id uuid NOT NULL,
  reported_by_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('OPEN','REVIEWED','RESOLVED','CANCELLED')),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT return_loss_detail_borrow_fk
    FOREIGN KEY(borrow_detail_id,borrow_request_id)
    REFERENCES public.borrow_details(id,"borrowRequestId") ON DELETE RESTRICT
);
-- *** END REVIEW-ONLY DDL PROPOSAL ***
```

## Hard blockers and explicit limitations

1. **DBA has not approved any of these statements.** The exact existing migration history and live catalog have NOT been inspected under authorized credentials. Do not add this file to `prisma/migrations`, run `prisma migrate dev/deploy`, `db push`, SQL CLI, or enable `ACM_RETURN_OPERATIONS_ENABLED`.
2. **Important missing enforcement:** global registry immutability, issuer ownership/purpose consistency, custody proof authenticity and independent approver, per-line QC only after committed return, consistency of status transitions and audit events, row-level authorization, duplicate stock movement prevention outside posting table, and asset serial lifecycle require **separate, carefully audited DB/service checks**. This is not a production-safe migration by itself.
3. **Legacy writer compatibility:** original `StockMovement` has `quantityDelta`, `onHandBefore/After` but not separate `quarantined` deltas. Return ledger and `StockBalance` movement rules, including no accidental double counting of `onHand` vs `quarantined`, must be specified and tested with current legacy flow. An operation-level posting record alone is NOT a full accounting ledger.
4. **Prisma target schema is not updated** by this draft. DB-aware Prisma types, inverse relations, `@db.Timestamptz(3)` mapping and any manual index/constraint drift must be reconciled after DBA approval.
5. **Cancellation transition correction:** A POST_RECEIPT_CANCEL reconciliation must be allowed to reach terminal CANCELLED after an approved custody resolution, while preserving the original reconciliation reason. A CHECK restricting POST_RECEIPT_CANCEL exclusively to RECONCILIATION_REQUIRED would make lawful finalization impossible. The candidate CHECK now allows precisely the reconciled or resolved-terminal branch; cross-table approver authenticity still needs service/DBA enforcement.
6. **Cancellation evidence scope:** one custody resolution per operation is a proposed minimum; if multiple handovers/dispositions are required, the DBA must revise to an immutable event log and final approved-resolution reference before GO. Reconciliation reasons include uncertain transactions **without** a physical RECEIVE; do not assert all reconciliations imply custody.
7. **Default privilege model:** application role must not be able to delete/rewrite immutable evidence/stock/audit rows; explicit grant and audited trigger controls pending. SQL `UNIQUE` prevents duplicates only while registry rows remain present.
8. **Negative preflight:** legacy evidence spelling and cross-issuer existing records must be scanned with approved privacy-safe access before declaring global uniqueness compatible. Do not infer an empty database from 0 public tables or other cloud metadata.
9. **Structural DDL is untested:** no PostgreSQL parser, `psql` or migration runner was invoked; all syntax/transaction semantics remain subject to DBA and isolated PG17 proof.

## Acceptance plan after independent approval (NOT EXECUTED)

- Verify exact SHA-pinned baseline schema and migration directory, DB identity and permissions in a **new approved isolated PostgreSQL 17** only, using synthetic fixtures.
- Have DBA author one consolidated forward and guarded rollback migration, matching Prisma generated/client types and custom checks; capture execution hash and two independent approvals.
- Test duplicate `abc-01` / `ABC-01` issued concurrently in two DB sessions and across distinct borrows/issuer types, and verify no reuse after CANCEL. Test cross-borrow receipt FK, cross-borrow detail FK, same-operation custody resolution, partial unique active state, NULL/CHECK negatives, invalid timestamps and unauthorized roles.
- Test RECEIVE/VERIFY independence, CANCEL-after-RECEIVE custody and no available credit, completed return/quarantine with GOOD/DAMAGED, QC release only GOOD, LOST as incident, over-return, audit, lost COMMIT response via durable status lookup, repeated request after TTL, fault rollback including `StockBalance`, `StockMovement` and assets.
- Backup and restore to independent test DB, then full frontend↔backend↔PG17 E2E, RBAC/IDOR/security and LOCAL release signoffs. Supabase Cloud remains a separate approved phase.

**Current gates:** Owner business decisions for design approved. DBA #11 OPEN. Two human PG17 approval #12 OPEN. SQL test #13 OPEN. LOCAL #15 / #26 NO-GO. Cloud NO-GO.
