# Stage4C Return Writer — transaction-bound contract only

**REVIEW ONLY — NO DB / NO SQL / NO ROUTE / NO MIGRATION / NO FEATURE FLAG.** Date 2026-10-30. Branch stacked on Draft PR #30 pure policy so its owner decisions remain intact.

## Deliverable

The new `apps/api/src/modules/borrow/borrow.return-writer.contract.ts` is a **transaction orchestrator** behind the `Stage4CWriterPort` interface. It never creates a Prisma connection, opens a database, mounts an endpoint, executes SQL or alters legacy borrower/stock flows. A future separately authorized DBA-approved implementation must supply a **real** `serializable(callback)` transaction port; absent that implementation the module is dormant.

The orchestrator validates command input with allowlisted fields; rejects HTTP attempts to supply `actor`, `lockedBorrowDetails`, or `trustedResolution`. It gets authenticated borrow-scope actor from the adapter inside the transaction, locks borrow scope first, looks up persisted idempotency, locks operation state, loads locked outstanding details for COMMIT and trusted custody proof for finalization, applies the pure BIZ policy, then submits **one atomic write intent** for state, audit, scoped replay and deterministic stock postings.

| Action | Intended effects (future transaction adapter must persist them atomically) |
|---|---|
| RECEIVE | Custody/receiver evidence; **no available stock credit** |
| VERIFY | Separate authorized verifier, must differ from receiver |
| COMMIT | Borrowed decreases and quarantined increases, with durable posting dedup per operation/detail; GOOD and DAMAGED quarantined |
| QC_APPROVE | Only approved GOOD moves quarantined to available, once |
| CANCEL pre-RECEIVE | Cancels with reason; no stock effect |
| CANCEL post-RECEIVE | `RECONCILIATION_REQUIRED` preserves custody; no stock effect |
| FINALIZE_CANCELLATION | Requires adapter-loaded approved reverse handover/disposition; terminal cancellation; no stock effect |
| LOST | Never a physical receipt; separate incident writer is pending |

**Replay contract:** same borrow/request key, same canonical hashed command and authenticated actor yields stored result; same key other payload/actor is conflict or forbidden. A durable UNIQUE `(borrow_request_id, request_key)` and immutable stock posting dedup must be enforced in the eventual DB adapter. The mock tests do **not** validate PostgreSQL concurrency or rollback.

## Safety caveats and blockers

- **This is not yet a functioning Backend Writer.** The essential production Prisma adapter, tables, migrations, global evidence issuer/registry, positive-scoped authorization, immutable custodian approvals, audit persistence and real serializable lock/retry logic are not implemented. Route remains 503; feature flag remains disabled.
- The `Stage4CTransactionPort` is a boundary contract, **not a verified transaction**; an untrusted or incomplete implementation may violate its promises. All real security, unique constraints, and durable persistence must be independently reviewed and tested in isolated PG17 after approval.
- **PREPARE/evidence issuance** is deliberately excluded from this phase because the owner-approved globally unique canonical evidence registry has no approved database implementation.
- An injected/fake custody resolution in mock tests does not establish authenticity: server must retrieve approved, immutable, scope-matching record and audit outside untrusted HTTP input.
- Same code must be exercised on approved PG17 for real two-session conflicts, rollback, retry, idempotency TTL, assets/stock balances, and legacy writer lock compatibility before LIVE API.
- The local DEV checkpoint `0be458b1dd36ee327670b684c571d03934e5397a` and UAT WIP remain untouched. PRs remain Draft.

## Offline tests

`node --experimental-strip-types --test scripts/stage4c-return-policy.offline.mjs scripts/stage4c-return-workflow.offline.mjs scripts/stage4c-owner-decisions.offline.mjs scripts/stage4c-return-writer.offline.mjs`

The new mock transaction adapter tests deliberately stage state then throw to verify **mock-only** rollback semantics; this does **not** imply a PostgreSQL transaction has been executed.

## Next safe implementation gate

After owner/DBA signoff on the consolidated target schema and explicit isolated PG17 authorization, implement a real Prisma/PostgreSQL port **only** in the isolated review branch using DB-specific constraints and transaction locks, then replay the same cases with synthetic fixtures and two separate connections. Keep NEW Return routes fail-closed until complete backend + browser DB E2E and owner LOCAL GO.
