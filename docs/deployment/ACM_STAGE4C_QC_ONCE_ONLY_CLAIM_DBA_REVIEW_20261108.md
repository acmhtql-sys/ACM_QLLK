# Stage4C QC one-time posting — DBA decision record (NO SQL / NO-GO)

**Status:** review-only proposal · 2026-11-08 · owner/business BIZ-03 + BIZ-04 context, **not DBA signoff**.

## Risk observed

The previous pure stock model correctly shows that GOOD receives into quarantine without increasing available stock and QC later decrements quarantine without adding physical `onHand` again. It also demonstrates a **counterexample**: if other receipts contribute to the same `StockBalance.quarantined`, a repeated approval of an already released receipt can still decrement the unrelated quarantine when only the aggregate balance is checked. Arithmetic alone is not once-only proof.

## Proposed design for independent DBA review (not authoritative DDL)

- **Receipt identity:** immutable `ReturnDetail.id` + QC action `QC_RELEASE` as a deterministic claim. Never key the claim solely to an item, stock balance, or caller-supplied string.
- **State:** a server-trusted receipt-detail must have `committedQuantity > 0`, `condition=GOOD`, a verified physical receipt and recorded independent QC authorization. A per-receipt `alreadyQcReleasedQuantity` and durable claim row must prevent subsequent release.
- **Conservative first release:** full quantity once per receipt detail, no partial QC for this proposal. If partial QC is required, owner and DBA must decide split-line claims, reserved amounts and corresponding unique indexes before implementation.
- **Atomicity:** claim insertion, receipt-detail QC update, `StockBalance.quarantined -= q`, stock movement and audit must succeed or roll back as **one** approved PostgreSQL transaction. Replays should return the immutable prior receipt or safely conflict, never double-release.
- **Concurrency:** two transactions on the same still-unreleased snapshot produce the **same candidate key**. Only a database unique constraint (candidate composite key `receiptDetailId + claimType`), lock order and conflict handling can prevent both being posted. The pure model is intentionally insufficient.
- **Identity:** the receipt detail, its borrow request, item and original location, actor, QC decision and posting claim must all be checked in the same trusted transaction. A UUID syntax check is not a foreign-key proof.
- **Overflow/physical balance:** `onHand` must not change at GOOD QC release. For a valid received `GOOD` quantity `q`, `quarantined -= q`, available increases by `q`. The receiving commit has already incremented `onHand`.
- **Retention:** permanent QC claim identity must outlive short-lived idempotency caches. DBA to decide immutable retention, auditor trace, backup/restore and deletion policy.

## Offline evidence

[Draft PR #59](https://github.com/acmhtql-sys/ACM_QLLK/pull/59) contains:
1. `borrow.return-qc-claim.review.ts`: a **pure, not-imported-by-live-code** preflight and deterministic proposed key.
2. Twelve regression tests including stale double-process race demonstration, repeated claim rejection, source/data mismatch rejection, and invariant that physical `onHand` stays unchanged.
3. Release-fence source guard verifying module stays unwired. **No SQL, migration, Prisma model or external DB.**

## Explicit DBA decision checklist

- [ ] Select a schema for one durable QC posting claim per immutable receipt detail, explain FK/unique/partial index/constraint choice.
- [ ] Decide full versus partial QC and consequence for historic/quarantined records.
- [ ] Verify serializable lock order for `BorrowRequest`, `BorrowDetail`, `ReturnDetail`, `StockBalance`, claim and audit, including concurrent legacy RC5 return.
- [ ] Show the exact two-session conflict/rollback and retry semantics for the approved PostgreSQL 17 instance.
- [ ] Sign SHA256 of approved DDL and rollback plan with a real qualified independent reviewer, issue #11, then satisfy separate PG17 Create #12 and SQL authorization #13.

**This document never authorizes creation of PostgreSQL, running migrations, connecting cloud, merging `main`, or enabling Stage4C. `RELEASE_NO_GO`.**
