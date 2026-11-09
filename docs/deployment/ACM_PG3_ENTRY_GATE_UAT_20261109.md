# ACM — 09/11/2026: Pilot UAT → PG17 Stage4C G11 entry packet

**Scope:** Review-only / synthetic-only. **Status:** `PG3_EXECUTION_HOLD`, `RELEASE_NO_GO`. This packet does NOT authorize SQL, migrations, rollback, backup/restore, PostgreSQL cluster changes, deployment or production release.

## 1. Human-reported pilot observation (not independent signed QA evidence)
Based on an operator-supplied smoke/UAT statement on 2026-11-09 (Asia/Ho_Chi_Minh):
- **Reported PASS:** Web↔API CORS and login with three roles `ADMIN`, `TECHNICIAN`, `STUDENT`; no localhost fallback seen by operator.
- **Reported PASS:** stock/category/location browsing and role-aware UI; STUDENT read-only notification.
- **NOT TESTED/NOT COMPLETE:** full creating a borrow request, real borrow/return posting and end-to-end transaction.
- **Only three of four roles tested:** `LAB_MANAGER` signoff is still missing.
- `apps/web/src/pages/BorrowReturnPage.tsx` lines 561–564 have the "Tạo phiếu mượn mới" button **without any onClick**. Track in [Issue #93](https://github.com/acmhtql-sys/ACM_QLLK/issues/93).
- `STAGING_READ_ONLY=true` must remain enforced on Render; no writes authorized for browser UAT.

**Cloud data cross-check (read-only SELECT on `acm-qllk-staging`, 2026-11-09):** `public.items` **3 item rows**, `SUM(stock_balances.onHand)` **215 units**, `borrow_requests` **0**, `return_transactions` **0**. Therefore "215 linh kiện" is consistent with 215 on-hand units, **not** evidence of 215 separate SKU records. This SQL only counted records; it did not authenticate the operator's three role sessions or browser origin.

**Source state:** [PR #92](https://github.com/acmhtql-sys/ACM_QLLK/pull/92) CORS patch is now merged into the still-Draft [PR #90](https://github.com/acmhtql-sys/ACM_QLLK/pull/90) source branch. This is neither a main merge nor independent proof of deployed-code SHA, runtime CORS, or migration readiness.

## 2. PG17 state independently recorded in GitHub, not re-run by this packet
- [#12](https://github.com/acmhtql-sys/ACM_QLLK/issues/12) / [#13](https://github.com/acmhtql-sys/ACM_QLLK/issues/13): PG1D FIX3 identity evidence lists a *separate local Windows cluster* `127.0.0.1:55433`, `postgres` database, `acm_d8_admin` role, PostgreSQL 17.11, PGDATA `%LOCALAPPDATA%\ACM_D8_PG17_55433_NEW_ONLY`, `transaction_read_only=on`. This is a historical operator-evidence PASS, not an authenticated live session from this report.
- DBA and AppSec's Issue #13 **plan-level approvals** exist. **No approval for a named byte-exact SQL/migration/rollback set** has been established here.
- [#11](https://github.com/acmhtql-sys/ACM_QLLK/issues/11): G01–G10 design principle is recorded; G11 remains blocked pending canonical schema, exact SQL and signer evidence.
- Current RC5 `apps/api/prisma/schema.prisma` is **19 Prisma models** (includes `ReturnTransaction`, `IdempotencyRecord`, not `BorrowReturnOperation`). Review-inert Stage4C model snapshot at `review/d8-wr7e-stage4c-inert-20261029` has **20 models** and a `BorrowReturnOperation` skeleton. Neither is final G01–G11 canonical schema.

## 3. Exact artifacts required BEFORE any PG17 migration operation
1. **Single canonical `schema.prisma`** from the current reviewed source branch; complete model/table inventory including operation, global evidence registry, independent QC and LOST incident design, or a documented decision explaining the absence/presence of each.
2. **Separate forward SQL and guarded rollback SQL** generated/reviewed for this canonical schema, with commit source, SHA-256 of every file and a Prisma diff/detailed DDL review. Review-only `Stage4C2A/2B` SQL must NOT be concatenated or executed.
3. Owner/DBA resolution on legacy `ReturnTransaction.returnNumber` global namespace, historical collision policy, immutable `CANCELLED` issued codes, and original↔canonical ref enforcement under ASCII/PG `COLLATE "C"`.
4. DBA/AppSec approval of those **exact byte-level artifacts** (not only concept/test plan), with review comments and conflict-of-interest/independence check.
5. A **separate execution authorization** naming approved operator, local isolated target database and verified identity, execution window, negative-control/test sequence, backup/restore/guarded rollback and abort protocol. **Do not reuse `postgres` maintenance DB as an implicit migration target.**
6. After authorized isolated SQL: catalog + migration history before/after; G03 global case-insensitive collision and append-only checks; G04 one PREPARED per borrow in two sessions; G05 durable ≥365-day claim; G06 composite FK and once-only receipt; G07–G09 QC/LOST stock; G10 40001/40P01/409; rollback/restore reconciliation; exact hash of redacted evidence and independent operator/QA signoffs.

**If any prerequisite fails or cannot be independently verified: STOP.** Do not retry destructive SQL, disable `STAGING_READ_ONLY`, or claim release acceptance.

## 4. Offline, non-DB artifact inventory prepared
Tool: `scripts/review/pg17_stage4c_offline_inventory.py` (Python 3 stdlib only).
It **only reads files** and prints SHA-256, file sizes, Prisma model names/count and added/removed model lists. It does not import a DB client, connect to a network, run psql, apply Prisma, or parse/execute SQL as commands. Exit 0 still returns `PG3_ENTRY_REVIEW_ONLY_NO_GO`.

From a checked-out repository with an explicit source SHA:
```powershell
py -3 scripts/review/pg17_stage4c_offline_inventory.py --baseline apps/api/prisma/schema.prisma
```
After a canonical candidate and both final SQL files are supplied by DBA for **review only**, add `--candidate path\to\schema.prisma --forward path\to\forward.sql --rollback path\to\guarded_rollback.sql`. No database instance is needed.

Offline unit coverage lives in `scripts/review/test_pg17_stage4c_offline_inventory.py`. Unit tests verify absent candidate never equals GO, supplied SQL is never authorized, and non-schema/secret files are refused.

## 5. Decisions and current gate
- Pilot UI **reported** 3-role/CORS/read-only PASS, pending exact-browser, source SHA and QA evidence. The separate four-role/full write acceptance is NOT DONE.
- New frontend borrow creation defect tracked in #93.
- Issue #13 next safe action = secure **canonical schema + two SHA-pinned SQL candidate files** and independent DBA/AppSec exact-byte review, with all execution steps still HOLD.
- **Do not merge `main`, run PG17 SQL/migration, change Render/Supabase/Vercel, unlock writes, or incur paid resources because this review packet exists.**
