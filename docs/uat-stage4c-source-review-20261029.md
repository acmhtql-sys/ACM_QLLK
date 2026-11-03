# ACM — Stage4C UAT Source Review (2026-10-29)

**Status: ARCHIVE INTEGRITY PASS / STATIC REVIEW COMPLETE / DB-BACKED ACCEPTANCE NOT RUN / RELEASE NO-GO.**

## Source provenance & integrity

- Operator archive: `ACM_UAT_SourceReview_ONLY_20261029_204537.zip`
- Independently calculated ZIP SHA-256: `938479d53afa7f16b2923bbf9611b4480957c19ce24d835b84d19c59d5fc332a` — matches operator PowerShell transcript.
- Internal manifest: `ACM_UAT_RECONCILE_METADATA_V2`, UAT HEAD `0847a73088b98d8b00fb6ac06f02b2f56d288b78`, source branch `fix/phase11d-partial-return-ui`.
- All **9/9** source paths existed in archive and matched the original manifest **file SHA-256 and byte lengths**. No extra file or missing source relative to manifest (only the included manifest and directory entries).
- 4 tracked locally modified; 5 untracked; 0 staged; 0 deleted.
- Heuristic scan: no pattern hits for PEM private keys, GitHub tokens, Supabase secret keys/JWT-like secrets, AWS access keys, literal password assignments, PostgreSQL connection URI, e-mail addresses or telephone-like identifiers in these 9 files. **Not a guarantee of data/secret absence.**
- Local WIP source files are **not** automatically uploaded/committed to GitHub, by design.

## Read-only code findings

### P0 — The new return-operation writer is deliberately unavailable
- `apps/api/src/modules/borrow/borrow.router.ts:207-224` sends all `/:id/return-operations` routes through `rejectUnreleasedReturnOperations()`.
- `apps/api/src/modules/borrow/borrow.return-operation-foundation.ts:1-5,60-63` declares inert behavior and an unconditional HTTP **503**. No production writer exists in supplied nine-file WIP.
- `apps/api/src/modules/borrow/borrow.service.ts:762-764` prevents legacy writes if `ACM_RETURN_OPERATIONS_ENABLED` is exactly `true`. **Setting this flag early could block both old and new return paths. Keep false until a separate approved cutover.**

### P0 — Review-only DDL is not deployable as submitted
- `apps/api/prisma/Stage4C2A_MIGRATION_REVIEW_ONLY.sql.txt:1-4` explicitly says DO NOT RUN. Its `physical_evidence_ref` is nullable (line 15), its receipt reference is a single-column FK (line 16).
- `apps/api/prisma/schema.prisma:480-506` instead requires `physicalEvidenceRef String` and composite receipt relation `[returnTransactionId, borrowRequestId]`.
- `apps/api/prisma/Stage4C2B_CONSTRAINTS_REVIEW_ONLY.sql.txt:1-7` explicitly depends on a regenerated Prisma DDL, requires non-null evidence and composite relationship; it is NOT an approved migration.
- Both candidate SQL files define the same named partial unique index `borrow_return_operations_one_unresolved_per_borrow` (2A lines 35-37; 2B lines 56-60). **Do not execute them sequentially.** Prepare a single consolidated, DBA-reviewed migration after policy and environment approvals.

### P0 — Physical evidence provenance and actual commit path remain missing
- Foundation `assertPhysicalEvidenceReference` is a *format check*, not proof of handover (`borrow.return-operation-foundation.ts:144-155`).
- No real DB adapter/receipt verifier for PREPARE/COMMIT exists in supplied foundation file. Receipt uniqueness, audit and inventory posting must be proven in a single properly isolated transaction, not inferred from static tests.
- State and cross-borrow FK guarantees require migration plus real PostgreSQL negative controls (e.g. wrong-parent receipt, duplicate evidence, null evidence, over-return, concurrent operations).

### P1 — Legacy return has useful protections but needs targeted DB tests
- `borrow.service.ts:205-224` uses Prisma `Serializable` and turns conflict `P2034` into 409.
- `borrow.service.ts:756-1091` includes RBAC, idempotency, anti-overreturn, same-source location checks, balance posting and audit.
- `borrow.router.ts:231-256` requires an idempotency header for legacy POST return.
- **Not established** that cross-session locking/replay/unique violation cases pass on the intended database or pooler. Do not equate code structure with a passed concurrency test.

### P1 — Asset-level return behavior needs reconciliation
- `borrow.service.ts:890-896` creates `ReturnDetail` without `assetId`; the reviewed return method does not visibly transition `Asset` status on return/loss/damage.
- `schema.prisma:378-396,418-435` includes optional `assetId` on BorrowDetail/ReturnDetail.
- This is a **review gap**, not proof of full-system defect. Check other Asset services and add real serial/asset lifecycle E2E tests before release.

### P1 — Existing integration test cannot be pointed at Supabase as-is
- `apps/api/tests/uat.phase11.ledger.integration.test.ts:33-79` explicitly checks local `127.0.0.1:55432`, database `acm_inventory_test`, PostgreSQL user `postgres`, and local `d:/acm_integration_sandbox/pgdata`.
- It writes business test records and deletes its own fixtures (`tests/uat.phase11.ledger.integration.test.ts:130+`). It must **not** run against Supabase by merely changing `DATABASE_URL`.
- Phase 11 DB-backed rehearsal and Stage4C tests are different: `borrow.return-operations.stage4c2a.unit.test.ts:23` uses pure functions; `stage4c2b.schema-contract.unit.test.ts:1-2,14+` uses string/static contract assertions. These do **not** prove real PostgreSQL constraints.

## Required acceptance order

1. Preserve the 9 local WIP files; independent code review and reconcile with branch history (#14).
2. Determine physical evidence issuing/verifying authority, receipt and Asset lifecycle rules; approve final Prisma model and consolidated Stage4C DDL (#11/#12).
3. Implement and review operation PREPARE/COMMIT writer/reader, lock-first transaction plan, idempotency+audit; keep HTTP 503 and legacy flag fail-closed until ready (#14).
4. Prepare approved isolated PostgreSQL 17 environment and identity checks; run dedicated migration, negative constraints, two-session race tests and rollback/restore **only after separate written approvals** (#13).
5. Validate Supabase connection mode/TLS/roles, Prisma generation, Data API/RLS exposure, secret isolation, backup/restore. Use synthetic data only and approved DB identity.
6. Run frontend-backend E2E, asset/serial cases, concurrent returns, UAT and security review with evidence; GO requires separate release signoff (#15).

## Limits and decision

- Static analysis of supplied 9 source files only: **no** package install, Prisma generate/validate, compiler, unit test, E2E, HTTP request, PostgreSQL connection, SQL execution or live Supabase write was carried out.
- Archive signature verification does not prove the entire repository or application is safe.
- Do not commit the raw archive or source files, or run candidate SQL, without explicit security/source review and DBA approval.
- **NO-GO for migration, data migration, real-data cutover, merging the release branch or deploying production.**
