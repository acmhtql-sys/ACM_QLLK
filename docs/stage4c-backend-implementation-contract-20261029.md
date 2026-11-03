# Stage4C Return Writer — Backend implementation contract & offline test plan

**DRAFT / NO-GO; 2026-10-29.** Target is ACM Express + Prisma, not a new frontend/backend architecture. Decisions: 5/5 BIZ rules approved by project owner in `docs/stage4c-owner-business-policy-proposal-20261029.md`. Do **not** confuse this document with implemented code or passing DB tests.

**Pinned input:** UAT Stage4C 9-file ZIP SHA-256 `938479d53afa7f16b2923bbf9611b4480957c19ce24d835b84d19c59d5fc332a`; local Stage4C schema SHA-256 `ab5bbdc7f6f1de397740fadb4d5522a59bbb9a819e23dfd658218cc144032fac`. The nine WIP paths are local to operator and not merged to repo; do not overwrite `D:\ACM_QLLK_UAT`.

## 1. Guardrail and current implementation state

- `apps/api/src/modules/borrow/borrow.router.ts` registers a fail-closed `/:id/return-operations` route, invoking `rejectUnreleasedReturnOperations()`; current API returns **503**.
- `borrow.service.ts` guards the legacy return path if `ACM_RETURN_OPERATIONS_ENABLED=true`. Keep flag **unset/false** until migration, writer, legacy interoperability, rollback, E2E and independently approved cutover are ready.
- `borrow.return-operation-foundation.ts` is pure scaffolding, **not** a live DB transaction or trusted handover evidence verifier.
- Existing integration test `uat.phase11.ledger.integration.test.ts` pins local test DB `127.0.0.1:55432` and is **NOT safe to repoint to Supabase**.

## 2. Approved business rules to implement

| ID | Requirement | Server-side invariant / failure behavior |
|---|---|---|
| BIZ-01 | Evidence code ASCII 1–128, regex `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`, case-insensitive | Validate same in HTTP/service/DB after DBA chooses canonicalization/index/unique scope; never trust client-normalized code; collision test `ACM-001` vs `acm-001` |
| BIZ-02 | ACM issues electronic code; receiver confirms actual physical receipt; another authorized user verifies independently | `receiverId != verifierId`, signed-in role checked server-side; don't treat code existence or client boolean as actual receipt; missing physical event or verification means no COMMIT |
| BIZ-03 | Every physically received item initially quarantine/pending QC; GOOD approved for availability, DAMAGED remains quarantined, LOST uses separate incident | COMMIT physical return must not directly increase available stock. LOST must not produce fake received receipt, stock restock, or Asset AVAILABLE transition |
| BIZ-04 | ADMIN/LAB_MANAGER/TECHNICIAN can PREPARE/RECEIVE; only ADMIN/LAB_MANAGER VERIFY/COMMIT/QC/CANCEL (pre-COMMIT with reason) | Deny role escalations and self-VERIFY, enforce status transitions and actor id from authenticated context, audit authorized actions |
| BIZ-05 | Partial return sequentially; at most one unresolved operation/borrow, no overreturn, atomic commit; idempotency scoped borrow+key; >=365-day replay protection and durable committed receipt | Concurrent PREPARE must converge to one unresolved operation; same key/payload and authorized actor yields prior result without new posting, key mismatch or invalid actor → conflict/forbid; duplicate COMMIT zero side effects; CANCEL no inventory changes |

**Not yet approved/defined:** how to uniquely scope evidence codes across organizational entities, canonicalization/index, source for physical verification, QC timing, serial/Asset mapping for each line, loss compensation/write-off, stock ledger exact arithmetic, idempotency actor-sharing rule for authorized viewers, retention lifecycle. Document them before binding a new persistent schema. A proposal is not a policy signoff.

## 3. Proposed workflow (subject to code/DBA review)

1. `PREPARE`: authenticate + RBAC + strict payload validation + borrow ownership consistency; lock expected borrow + rows in **same deterministic order as legacy writer**, check remaining quantity & existing unresolved op, allocate ACM evidence code, store immutable canonical request hash + prepare audit. Do not update stock on PREPARE.
2. `RECEIVE`: allowed staff record physically received quantity/condition, time and actual actor. LOST is **not** RECEIVE; use separately reviewed loss workflow.
3. `VERIFY`: ADMIN/LAB_MANAGER other than RECEIVE actor cross-check evidence and physical receipt, with traceable server-side decision; exact actor identities persisted; no verification from client-supplied flag.
4. `COMMIT`: ADMIN/LAB_MANAGER authenticated, confirmed VERIFY + same borrow/lines, lock-first atomic transaction: return document, detail, stock/borrow balance, quarantine movement, asset serial state, audit and terminal operation status. GOOD stays quarantined until QC approval by authorized role. One committed receipt identity must be impossible to post twice even after idempotency TTL.
5. `QC APPROVE`: ADMIN/LAB_MANAGER approve actual GOOD inspection (separate, audited, atomic stock/asset release); DAMAGED remains quarantine; LOST is separate documented incident.
6. `CANCEL`: ADMIN/LAB_MANAGER before COMMIT only, mandatory reason; audit, terminal state, **no stock movement**.
7. `GET/RECONCILE`: read-only status, no retry-on-NOT_FOUND presumption; protect against IDOR and leaking evidence to unauthorized borrower.

### Failure semantics to design, not already implemented

- Validation (bad evidence/cross-borrow/invalid quantity) → request rejected and zero effects.
- RBAC violation or RECEIVE actor == VERIFY actor → denied; zero commit effects.
- Duplicate in-flight PREPARE or stale overreturn → conflict, no inconsistent reservation.
- Unknown outcome (lost HTTP response) → safe lookup by borrow/key and canonical payload; return existing receipt, never blind-new POST.
- Serializable conflict/deadlock → bounded retry with fresh state read and deterministic lock order; never retry side effects outside transaction.
- DB failure between stock and audit → entire operation rollback, no partial receipts.
- 503 fallback until all gates approved; **never** enable new flow just because offline tests pass.

## 4. Offline contract/negative-test matrix to implement

| Test ID | Scenario | Expected proof |
|---|---|---|
| OFF-01 | Valid/invalid evidence regex; 1 and 128 bounds; unicode/space/control char rejection | Pure validator PASS/FAIL |
| OFF-02 | Same code differing only in case | Same canonical key, no duplicate |
| OFF-03 | TECHNICIAN attempts VERIFY/COMMIT/CANCEL/QC | 403; no DB-call/mock effect |
| OFF-04 | ADMIN receives then attempts to VERIFY self | Deny regardless privileged role |
| OFF-05 | Without receipt or independent VERIFIED state, attempt COMMIT | Deny |
| OFF-06 | Partial return 4+6 of 10; attempt 4+7 of 10 | First sequences pass, overreturn denied |
| OFF-07 | Replay same borrow/key/canonical payload, authorized actor | Stable response, mock posting once |
| OFF-08 | Same key changed amount/actor invalid/other borrow | Conflicts or forbid; zero new posting |
| OFF-09 | Competing PREPARE for same borrow | At most one unresolved; prove on actual DB later |
| OFF-10 | COMMIT twice; second call after TTL | Same durable receipt, zero duplicate postings |
| OFF-11 | CANCEL before commit / after commit | Before no stock; after denied |
| OFF-12 | GOOD, DAMAGED physically received; LOST incident | Quarantine-first; no available stock increase/false RECEIVE |
| OFF-13 | Inject audit/stock/serial failure | No partial state (mock first, PostgreSQL proof later) |
| OFF-14 | Cross-borrow receipt/evidence, wrong parent or malicious replay | Reject; DB FK negative control later |
| OFF-15 | Legacy return and new operation concurrent | Shared lock order proof on approved two-session DB later |

Offline tests can validate pure logic/mocks only. Do **not** mark OFF-09, OFF-10 or OFF-13/15 as real concurrency/atomicity proof without PostgreSQL evidence. Keep an explicit evidence ledger (test name, source SHA, environment identity, executor, date, result, output hash).

## 5. Work packages for a future development branch

- `BE-01`: integrate BIZ-01 evidence canonicalizer and idempotency scope with named pure unit tests.
- `BE-02`: define trustworthy ACM code issuance + RECEIVE/VERIFY provenance, RBAC, separation-of-duties; no production writer until reviewed.
- `BE-03`: design Prisma Stage4C operation/receipt model + migration review-only spec; coordinate DBA packet.
- `BE-04`: implement lock-first prepare/commit service **fail-closed** and switchable only after signoff; harmonize with legacy writer.
- `BE-05`: quarantine-first stock and Asset handling, distinct LOST incident path and QC approval.
- `BE-06`: tests OFF-01…15, then separately approved PG negative constraints, 2-session races, backup/restore and E2E.

## 6. Acceptance and hard stops

Code readiness requires: source and dependency review, correct Prisma Client generated in isolated workspace, no compilation/lint/test regressions, audited API/RBAC, explicit test artifacts. This contract **does not** prove implementation.

DB write readiness requires independently approved DBA schema, #12 isolated environment authorization+identity, #13 migration/test authorization, #21 separate Supabase staging permission, synthetic data, backup/restore. GO/release needs #15 review and owner signoff.

**Current gate:** PREPARE ONLY / RELEASE NO-GO. No source overwrite, merge, SQL/migration, flag enable, real data or deployment.
