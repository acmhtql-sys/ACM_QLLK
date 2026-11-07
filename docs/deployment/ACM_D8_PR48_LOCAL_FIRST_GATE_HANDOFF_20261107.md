# ACM D8 — PR #48 local-first acceptance & independent review handoff

**As of 2026-11-07 · Mode: REVIEW ONLY · Decision: `RELEASE_NO_GO`**

This is a reproducible evidence index and decision queue, **not** authorization to merge, publish, create a database, run SQL, or engage a paid service. It does not confer business-owner, DBA, security-reviewer or QA signoff.

## 0. Immutable reference at evidence capture

| Object | Reference |
|---|---|
| Repository | `acmhtql-sys/ACM_QLLK` |
| Integration | [Draft PR #48](https://github.com/acmhtql-sys/ACM_QLLK/pull/48), `codex/d8-rc5-zod4-integration-20261107` |
| Candidate head tested | `dffbc3913a89262b554b5fd5d51fa32f8e542ef9` |
| Candidate base / actual Render RC5 source | `codex/cloud-staging-p2e-readonly-deploy-20261107` @ `9d0e797116c72e65dd86e0fe7c5652d815851864` |
| Untouched main at review | `375947d0f2e65faf335f0279e12e6daa7be9ac4f` |
| Full CI (push) | [42386444819](https://github.com/acmhtql-sys/ACM_QLLK/actions/runs/42386444819), **SUCCESS** |
| Full CI (PR event) | [42386449828](https://github.com/acmhtql-sys/ACM_QLLK/actions/runs/42386449828), **SUCCESS** |
| Mock browser (push) | [42386444740](https://github.com/acmhtql-sys/ACM_QLLK/actions/runs/42386444740), **SUCCESS** |
| Mock browser (PR event) | [42386449846](https://github.com/acmhtql-sys/ACM_QLLK/actions/runs/42386449846), **SUCCESS** |

**Counts on tested candidate:** shared Vitest 128/128; API unit Vitest 282/282; Web unit Vitest 405/405; existing CI-local PostgreSQL integration 104/104; separate CI-local return concurrency test 1/1; isolated Chromium Playwright 36 passed, 1 skipped. PostgreSQL **16** in ephemeral GitHub runner is NOT independent authorized PostgreSQL **17** Stage4C acceptance. Browser uses localhost fixtures, NOT real frontend-to-backend UAT.

**Diff to RC5:** 53 paths changed. No `render.yaml`, `supabase/` or `apps/api/prisma/migrations/` changes found in comparison at capture time. CI workflows differ but do **not** deploy. GitHub's mergeability indicator is NOT a release approval.

## 1. Gate board — ordered decisions and genuine witnesses

| Gate | Next action | Owner / evidence record | Current |
|---|---|---|---|
| L0 source reconciliation | Previous Issue #14 evidence recorded 15/15 UAT file SHA256 and a nine-path local working state; Draft PR #16 has since published an exact **six-file inert Stage4C review branch**. Reconcile those pinned sources against RC5 / PR #48 without assuming all nine local paths are published. Maintain Render source and original `main` hashes. | Operator, [#14](https://github.com/acmhtql-sys/ACM_QLLK/issues/14), [#44](https://github.com/acmhtql-sys/ACM_QLLK/issues/44), [#26](https://github.com/acmhtql-sys/ACM_QLLK/issues/26) | **PARTIAL — historical hash-reviewed evidence and PR #16 source verified; RC5 line-level reconciliation outstanding** |
| DBA/business design #11 | Business owner chooses canonical evidence/receipt formatting, case sensitivity, source-of-truth, multi-origin, LOST/DAMAGED and custody; independent DBA reviews exact Stage4C Prisma/DDL/rollback and lock order. | [#11](https://github.com/acmhtql-sys/ACM_QLLK/issues/11), independent recorded decisions | **HOLD — signatures missing** |
| PG1C #12 | Two **different real humans** approve *exact* NEW-only PG17 instance creation scope. Verify owner-provided archive/script SHA256, target path, port, permission, existing services, and near-time preflight. | [#12](https://github.com/acmhtql-sys/ACM_QLLK/issues/12) | **HOLD — no Create authority** |
| PG1D & PG3 #13 | **Only after above approvals and a separate SQL execution authorization:** authorized Windows operator proves isolated cluster identity, then runs pinned synthetic Stage4C forward/checks/rollback/2-session races and backup→restore into separate empty database. | [#13](https://github.com/acmhtql-sys/ACM_QLLK/issues/13) | **NOT RUN/NOT APPROVED** |
| Real D8 writer #14 | Reconcile missing Stage4C source; implement audited PREPARE/COMMIT Prisma adapter, independent custody/evidence authority and permanent posting claims only after design approval; keep 503 while incomplete. | [#14](https://github.com/acmhtql-sys/ACM_QLLK/issues/14) | **NOT ACCEPTED** |
| Local end-to-end & recovery | Four-role real frontend↔backend synthetic UAT, stock quantity ledger, negative auth/IDOR, partial GOOD/DAMAGED/LOST returns, idempotent retry and reconciliation, audit, backup restore, RPO/RTO. | [#8](https://github.com/acmhtql-sys/ACM_QLLK/issues/8), [#9](https://github.com/acmhtql-sys/ACM_QLLK/issues/9), [#10](https://github.com/acmhtql-sys/ACM_QLLK/issues/10), [#15](https://github.com/acmhtql-sys/ACM_QLLK/issues/15) | **NOT ACCEPTED** |
| Storage / non-Web scope | Product brief explicitly includes Mobile App + Backend API. Track [#49](https://github.com/acmhtql-sys/ACM_QLLK/issues/49) and confirm supported platform(s) and genuine on-device acceptance; Web Chromium mocks cannot close mobile scope. StorageProvider / Cloudinary adapter also awaits separate local-first acceptance. | [#26](https://github.com/acmhtql-sys/ACM_QLLK/issues/26), [#49](https://github.com/acmhtql-sys/ACM_QLLK/issues/49), product owner | **MOBILE IMPLEMENTATION / SCOPE PENDING** |
| Human code/security review | Recruit qualified DBA and application security reviewer; review PR #48 against `dffbc391...` and any newer head, not only retired stacked #39–#41. Log findings P0/P1/P2/P3 and real reviewer identity, UTC timestamp, exact reviewed SHA. | [#42](https://github.com/acmhtql-sys/ACM_QLLK/issues/42), PR #48 | **UNASSIGNED, NO APPROVAL** |
| Release #15 | Confirm **all** prior signatures, zero open P0/P1, successful real UAT/restore, acceptable Free-tier reliability/data-protection model; explicit final named owner decision. | [#15](https://github.com/acmhtql-sys/ACM_QLLK/issues/15) | **NO-GO** |

## 1A. Newly re-verified Stage4C source lineage (remote GitHub, not DB acceptance)

The earlier shorthand “nine UAT WIP files are missing from GitHub” is **not precise**. The [Issue #14 evidence chronology](https://github.com/acmhtql-sys/ACM_QLLK/issues/14) records that the operator's fifteen-file Windows handoff and SHA256 manifest were uploaded/verified in 2026-10-29. A separate reviewed **six-path inert candidate** was later published via [Draft PR #16](https://github.com/acmhtql-sys/ACM_QLLK/pull/16). This handoff has not independently re-opened the original local ZIP's bytes; **historical evidence ≠ fresh validation of the Windows UAT today**.

| Ref/source | Exact pinned object | Source verification |
|---|---|---|
| Legacy UAT Git HEAD (now published remote) | `review/d8-uat-0847a730-baseline` @ `0847a73088b98d8b00fb6ac06f02b2f56d288b78` | Remote Git ref exists |
| Stage4C inert review head | `review/d8-wr7e-stage4c-inert-20261029` @ `9e9d6078c6831107bfa1c51ffbc5f094ecdba314` | PR #16 Draft, 1 commit ahead of UAT HEAD, six changed paths |
| RC5 + P0/Zod4 actual integration | `codex/d8-rc5-zod4-integration-20261107` @ `b5a45bcec0c00e8988754ea5deb5ee5152059001` (prior verified documentation checkpoint; use PR head for newer commits) | Distinct code family; PR #48 Draft; no Stage4C merge |
| GitHub comparison | Stage4C review head vs PR #48: `ahead 54 / behind 199` | **DIVERGED**, NOT a safe direct merge or proof of complete WIP publication |

**Six source paths in PR #16** (all verified in the remote compare): `apps/api/prisma/schema.prisma`, `apps/api/src/modules/borrow/borrow.return-operation-foundation.ts`, `apps/api/src/modules/borrow/borrow.router.ts`, `apps/api/src/modules/borrow/borrow.service.ts`, `apps/api/tests/borrow.return-operations.stage4c2a.unit.test.ts`, `apps/api/tests/borrow.return-operations.stage4c2b.schema-contract.unit.test.ts`.

**Concrete schema divergence:** PR #48 Prisma schema currently has **19 models**, whereas the published inert Stage4C review schema has **20** (adds `BorrowReturnOperation`). Neither represents an independently approved canonical Stage4C DDL. The Stage4C source includes an explicit hard-`503` `rejectUnreleasedReturnOperations()`; never enable `ACM_RETURN_OPERATIONS_ENABLED=true` with only that inert code, as it blocks legacy return and does not provide a live writer.

**Action to close L0:** independently review the exact historical 15-file ZIP and nine-path working-state manifest already recorded on #14; compare remote PR #16–#18 plus current PR #48 line-by-line and resolve only reviewed code differences in a fresh isolated proposal. Do **not** treat 9 local Git status rows as 9 remote code files, and do **not** copy the unapproved 20-model schema/migration to PR #48. Obtain human DBA/security signoff and explicit DB authorization separately.

## 2. Engineering facts preserved by PR #48 (review them, do not assume production proof)

1. **RC5-first integration:** Zod4 compatibility and 9 conflict resolutions retain original auth/RBAC, partial-return Web Lock, mandatory Idempotency-Key, cached receipt and GET `/return-status/:key`.
2. **Return concurrency:** Serializable transaction locks BorrowRequest and source StockBalance; serialization/deadlock conflicts map to safe HTTP 409. Cross-warehouse return remains **denied 409**; a successful A→B stock-credit feature is **not** implemented/approved. Test synthetic A→B rejection and same-source posting separately.
3. **Supply/lineage:** Historic multi-origin source attribution and permanently unique D8 evidence claims are unresolved in Stage4C; the current legacy `IdempotencyRecord` expiry is not a substitute for permanent posting history. A green return test does not attest historical ownership.
4. **Cloud fence:** Staging remains read-only, auth login disabled by existing `render.yaml`, deployment source still the RC5 branch, auto-deploy off. This is **source-static** inspection, not a fresh live Render/Supabase configuration attestation.
5. **Security:** Latest available review dossier noted two Moderate router dependency advisories. Require a fresh versioned `npm audit --omit=dev` + full audit, documented risk treatment and real code review; do not infer zero-risk from old results.

## 3. Safe reviewer handoff (no secrets or DDL execution)

**Reviewer A (independent DBA):** inspect `apps/api/prisma/schema.prisma`, migrations, `borrow.service.ts`, `borrow.return-status.ts`, `idempotency.service.ts`, DB guard, Stage4C WIP source/hash and proposed SQL from the owner. Reject ambiguous provenance, unsafe rollback, duplicated evidence or unprovable multi-origin allocation. Record exact code SHA, SQL/ZIP SHA256, line references, findings, signed conclusion.

**Reviewer B (independent security/frontend):** inspect `apps/api/src/app.ts`, `middleware/auth.ts`, `middleware/cloudStagingReadOnly.ts`, `config/securityPolicy.ts`, Zod4 validators, Web auth, return hook and browser network guard. Check JWT/RBAC/IDOR, rate-limit spoofing, injection, raw SQL param binding, 504/409 ambiguous commit, audit immutability, negative tests and dependency advisories. Record exact SHA and signed conclusion.

**Operator (after authorization only):** keep existing PostgreSQL services and `D:\ACM_QLLK_UAT` untouched. Preflight PG1C per #12; do **not** interpret this doc as permission to execute `initdb`, migration, rollback, seed, `DROP`, REST writes, or cloud operations. Do not paste connection strings, passwords, tokens, dumps or sensitive logs into GitHub.

## 4. Release stop rules

If reviewer signatures/Stage4C WIP are missing, SQL target identity is unknown, real UAT/restore are incomplete, high-risk stock/accounting invariants fail, or Free-only hosting cannot meet approved data durability requirements: **STOP, `RELEASE_NO_GO`**. No merge of #48 (or #39–#41) to `main`, no automatic merge, no Blueprint/Render/Vercel/Supabase/Cloudinary change, no new paid resource or real data movement.

## 5. Human signature ledger (intentionally blank)

| Required signer | Reviewed object + SHA | Decision & conditions | Verifiable channel/reference | UTC |
|---|---|---|---|---|
| Business owner — receipt/custody policy | — | **PENDING** | — | — |
| Independent DBA — Stage4C DDL/PG17 | — | **PENDING** | — | — |
| Owner — PG1C Create | — | **PENDING** | — | — |
| Independent technical reviewer — PG1C | — | **PENDING** | — | — |
| Security reviewer — consolidated PR #48 | — | **PENDING** | — | — |
| QA/UAT witness — end-to-end & restore | — | **PENDING** | — | — |
| Owner — final LOCAL GO/release | — | **PENDING** | — | — |

**Prepared for review only. Neither AI code inspection nor CI replaces independent human authorization.**
