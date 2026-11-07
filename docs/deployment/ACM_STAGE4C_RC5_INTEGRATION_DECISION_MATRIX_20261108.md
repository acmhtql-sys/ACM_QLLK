# ACM — Stage4C ↔ RC5 source decision matrix (REVIEW ONLY / NO GO)

**Captured:** 2026-11-08 · **Repository:** `acmhtql-sys/ACM_QLLK` · **Authority:** source reconciliation only. **NO database or release authorization.**

## Pinned remote objects

| Source | Commit SHA | Status |
|---|---|---|
| Actual RC5 + Zod4 integration | [Draft PR #48](https://github.com/acmhtql-sys/ACM_QLLK/pull/48) @ `b255dc96e0da27845f1939eb3622a71f9fedee20` | CI/Playwright PASS on preceding documentation checkpoint; new docs head requires own CI |
| UAT history anchor | `review/d8-uat-0847a730-baseline` @ `0847a73088b98d8b00fb6ac06f02b2f56d288b78` | Git ref exists |
| Six-file Stage4C inert patch | [Draft PR #16](https://github.com/acmhtql-sys/ACM_QLLK/pull/16) @ `9e9d6078c6831107bfa1c51ffbc5f094ecdba314` | 1 commit/6 changed paths vs UAT anchor |
| Stage4C portable fixes | [Draft PR #17](https://github.com/acmhtql-sys/ACM_QLLK/pull/17) @ `07c12670a062ee9fc1836a7b0b4dda55e7de8cff` | Stacked on #16; no DB acceptance |
| Stage4C offline CI | [Draft PR #18](https://github.com/acmhtql-sys/ACM_QLLK/pull/18) @ `935d86c132fea9b445fccfb912c57484c08366e4` | Stacked on #17; no production writer |

**Comparison warning:** PR #16 branch vs PR #48 diverged (54 commits ahead and 199 behind at capture), so **never use whole-branch merge, blanket ours/theirs or direct schema cherry-pick**. Historical #14 handoff recorded a SHA-verified UAT ZIP with 15 source files and nine dirty Git status rows; that does not mean nine new independent remote source modules. Inspect the original byte-exact artifact and its manifest before declaring L0 closed.

## Per-path reconciliation — exactly the six files in PR #16

| Path | Stage4C content | RC5 conflict / outcome |
|---|---|---|
| `apps/api/prisma/schema.prisma` | Adds `BorrowReturnOperation` and references (20 models vs RC5 19). | **HOLD**: no approved Stage4C consolidated DDL, FK/index parity, migration and guarded rollback. Neither source can be blindly selected. |
| `apps/api/src/modules/borrow/borrow.return-operation-foundation.ts` | Pure snapshot/canonical payload/evidence checks and fail-closed 503 helper; not a Prisma writer. | **REVIEW CANDIDATE ONLY**: can be evaluated as a standalone pure contract but does not prove custody or permission. #17 fixes non-completed phantom receipt invariant. Do not wire feature flag. |
| `apps/api/src/modules/borrow/borrow.router.ts` | Adds `return-operations` route with hard 503. | **HOLD**: RC5 retains mandatory legacy `Idempotency-Key`, `GET /return-status/:key`, RBAC and partial-return UI. Avoid opening a competing unsafe writer or weakening staging. |
| `apps/api/src/modules/borrow/borrow.service.ts` | Adds legacy cutover guard and D7 lock-first changes based on old UAT service. | **DO NOT OVERWRITE** RC5 consolidated return: current service already has Serializable row locks, PG conflict normalization, original receipt replay and same-origin 409 policy verified in CI-local PG16. Stage4C requires one shared lock order and explicit migration plan before real adapter. |
| `apps/api/tests/borrow.return-operations.stage4c2a.unit.test.ts` | Pure 22-case Stage4C foundation checks including fail-closed states, payload hash and evidence shape. | **PORTABLE AFTER REVIEW** into separate isolated test candidate; no DB acceptance, no route enablement. |
| `apps/api/tests/borrow.return-operations.stage4c2b.schema-contract.unit.test.ts` | Static checks depend on the 20-model candidate schema (different from RC5 19). | **HOLD** until DBA-approved canonical schema; do not weaken tests simply to make the 19-model build green. |

## Additional #17 changes (not present in six-file #16 base)

`apps/api/package.json`, `borrow.return-operation-foundation.ts`, `borrow.service.ts`, `borrow.return.unit.test.ts`, `borrow.return-operations.stage4c2a.unit.test.ts`, `borrow.return-operations.stage4c2b.schema-contract.unit.test.ts`, plus `borrow.return-operations.stage4c2b.sql-contract.review.test.ts` and `borrow.return.validation.stage4c.unit.test.ts`. **Total 8 paths changed** vs #16 (9 commits ahead); tests are portable assertions only, not proof of approved SQL or history.

## Business policy vs engineering proof (never equate them)

The [#14](https://github.com/acmhtql-sys/ACM_QLLK/issues/14) chronology recorded **owner business choices BIZ-01…BIZ-05** (receipt-code format, independent physical RECEIVE/VERIFY, quarantine-first QC, separation of duties, partial-wave/idempotency policies). These are **business decisions**, not independent DBA signatures or deployed enforcement. In particular, global canonical evidence uniqueness, backward-compatible history/backfill, custody after RECEIVE-before-COMMIT, permanent posting claims, and composite FK/constraint enforcement require the **single** consolidated DBA-approved design [#11](https://github.com/acmhtql-sys/ACM_QLLK/issues/11). Do not concatenate obsolete 2A/2B SQL review texts.

## Safe accelerated execution order

1. **Owner/operator:** use historic verified 15-file UAT ZIP + source manifest from #14, identify any nine local rows not represented in Draft #16–#18; verify byte-exact hashes and secrets before any new publish. No Windows UAT mutation.
2. **Code reviewer:** preserve PR #48 existing RowLock/CAS, RC5 GET-only status and Web Lock; document `borrow.service.ts` line-level diff, verify 503 remains for new Stage4C operation routes.
3. **DBA and business reviewer:** resolve global evidence scope, backfill, custody, rollback, migration hash and source provenance on #11; real signatures/timestamps required. AI/CIs do not sign.
4. **Owner and independent technical reviewer:** approve exact isolated PG17 Create scope #12; approved local operator verifies new cluster identity. The generic instruction “continue” does not grant Create.
5. **Separate SQL gate:** after #11/#12, authorize #13 migrations + two-session concurrency + restore. Keep all data synthetic and existing Windows PG service untouched.
6. **Engineer:** integrate real Stage4C writer with durable receive/verify, one pending operation, 365-day replay, permanent receipt uniqueness, audit, QC and safe rollout only on separately reviewed branch; keep 503 and feature OFF until evidence #14.
7. **QA/owner:** real four-role frontend↔backend/mobile/storage local E2E, restore and owner signoff #15, then separate cloud C1 and production C2.

**Release decision: `RELEASE_NO_GO`. Nothing in this matrix approves merge, cloud API writes, service provisioning, Stage4C SQL, feature activation, real data transfer or paid resources.**
