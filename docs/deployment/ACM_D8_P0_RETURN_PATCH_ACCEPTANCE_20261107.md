# D8-P0 — Candidate safe return posting: verification and NO-GO checklist

**Date:** 2026-11-07. **PR:** [#45](https://github.com/acmhtql-sys/ACM_QLLK/pull/45) based on Draft PR #41. **Stage:** code candidate only; no DBA approval; no production or staging deployment.

## Source and threat model

Two Antigravity technical reports identified: (1) legacy `returnBorrowRequest` reads `BorrowRequest`/`BorrowDetail` without row locks, and (2) incorrectly decrements `borrowed` on the *return destination* rather than the *issuing source*. The reports are AI-assisted technical evidence and **not independent human review**. The finding was independently verified in [Issue #43](https://github.com/acmhtql-sys/ACM_QLLK/issues/43); original line numbers were outdated.

- Intended invariant: for a single proven issuing location, a return of N units must reduce `StockBalance(source).borrowed` exactly N. GOOD increases `StockBalance(destination).onHand` by N; DAMAGED also increases `quarantined` by N; LOST increases neither `onHand` nor `quarantined`.
- Every return on one BorrowRequest must serialize before checking `returnedQuantity`. Other requests for the same stock balance must not decrease `borrowed` below zero.
- If a single source cannot be demonstrated from **FULFILLED** reservations, the proposed legacy route **must fail closed with 409**. Multi-origin returns require the new Stage4C provenance model; never guess source from destination/first balance.
- To protect audit `onHandBefore`/ `onHandAfter`, sort and lock participating stock rows before re-reading values.
- A new destination balance must be established by an authorized inventory process; this patch never silently creates one during a return.

## Candidate implementation (PR #45)
- Parameterized PostgreSQL `SELECT id ... FOR UPDATE` locks the BorrowRequest inside the Prisma transaction **before reading request details**.
- `StockReservation` with `FULFILLED` status identifies a single issuing source location for the relevant item. Sum of reservation quantities must cover the issued BorrowDetails. Ambiguous/missing evidence → 409.
- Deterministic `FOR UPDATE` locking of source/destination `StockBalance` rows, re-read after lock, and conditional `updateMany` source `borrowed >= quantity`; count 0 → rollback + 409.
- GOOD/DAMAGED: source borrowed decrease; onHand and quarantine increment only at designated destination. LOST: borrowed decrease at source, no physical stock increment.
- Duplicate BorrowDetail IDs in one payload are rejected with 422.
- No Prisma migration or schema modification; no new feature toggle; Staging read-only controls remain unchanged.

## Evidence quality (do NOT overstate)
- New mock-only tests: cross-location A→B, missing/multiple origin, inadequate source borrowed, missing destination, duplicate detail and conditional CAS conflict; existing same-origin GOOD/DAMAGED/LOST tests.
- Tests are not proof of PostgreSQL transaction isolation, row-level lock ordering, rollback, true stock conservation under two SQL sessions, or atomic receipt/audit.
- The existing GitHub CI PostgreSQL **16** database and isolated Chromium mock browser are **not the approved PG17 D8 cluster** at port 55433.
- If CI is red, keep this PR Draft and review before changes.

## Pending design choices / real-DB acceptance
1. [Issue #11](https://github.com/acmhtql-sys/ACM_QLLK/issues/11): business/DBA signoff on multi-source partial return, source reservation precision, GOODS/LOST/DAMAGED and receipt provenance; Stage4C SQL and guarded rollback.
2. [Issue #12](https://github.com/acmhtql-sys/ACM_QLLK/issues/12): independent, human scope approval for new PG17 55433 cluster. No implied approval to Create.
3. [Issue #13](https://github.com/acmhtql-sys/ACM_QLLK/issues/13): after separately authorized test, demonstrate two concurrent returns (one successful, one clean 409 or idempotent replay), cross-location GOOD/DAMAGED/LOST and mixed-source safe blocking; verify total borrowed + stock invariants and atomic receipt/audit; rehearsal of rollback on isolated DB.
4. [Issue #14](https://github.com/acmhtql-sys/ACM_QLLK/issues/14): replace review-only Stage4C port with real Prisma DB adapter; retain D8 hard 503 until signed approval. Legacy return route **still lacks HTTP Idempotency-Key**, and a 504 after commit cannot yet be replayed safely.
5. [Issue #44](https://github.com/acmhtql-sys/ACM_QLLK/issues/44): RC5 Render branch divergence; integrate candidate with all RC fixes on a separately reviewed branch, not a blind PR merge.
6. [Issue #15](https://github.com/acmhtql-sys/ACM_QLLK/issues/15): independent human code/DBA review, PG17 restore drill, RPO/RTO, and production approval.

**Release verdict:** `D8-P0_PATCH_CANDIDATE_ONLY — RELEASE_NO_GO`. Never merge to `main`, deploy to Render, change Supabase staging, run migration/seed on Supabase, allow staging login/writes, move real data or upgrade paid plans without the exact separate authorizations.
