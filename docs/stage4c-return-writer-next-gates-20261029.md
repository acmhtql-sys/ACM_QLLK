# Stage4C — Implementation decisions and NO-GO gates (2026-10-29)

**Status: DRAFT / REVIEW ONLY. Not a release approval.**  
Dependencies: [#11 DB policy](https://github.com/acmhtql-sys/ACM_QLLK/issues/11), [#12 isolated PG signoffs](https://github.com/acmhtql-sys/ACM_QLLK/issues/12), [#13 isolated PG migration/concurrency](https://github.com/acmhtql-sys/ACM_QLLK/issues/13), [#14 return writer](https://github.com/acmhtql-sys/ACM_QLLK/issues/14), [#21 Supabase](https://github.com/acmhtql-sys/ACM_QLLK/issues/21), [#15 release](https://github.com/acmhtql-sys/ACM_QLLK/issues/15).

## Decision record (not approved)

1. **Physical handover evidence code** — business owner to approve/reject proposed `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$` (ASCII, 1–128 characters), document whether case-sensitive. The current Stage4C TS guard only checks 1–128, trims and rejects controls; DB 2B CHECK uses a broader pattern. Do not present them as already policy-consistent.
2. **Independent evidence provenance** — define which system/person issues the code, who receives equipment, who verifies issuer and protects against forged or reused codes. Issuer and verifier must be independent for authorization. Receipt format validation alone is NOT handover proof.
3. **Return conditions** — approve what GOOD, DAMAGED and LOST mean for stock on-hand, quarantined, borrowed and serialized Asset transitions; specify who can approve write-offs. No assumptions about auto-restocking damaged/lost stock.
4. **Return permissions** — confirm ADMIN/LAB_MANAGER/TECHNICIAN permission to PREPARE/COMMIT/CANCEL, whether borrower can see status; separate actors as policy requires.
5. **DDL & source** — DBA compares verified `schema.prisma` SHA256 `ab5bbdc7f6f1de397740fadb4d5522a59bbb9a819e23dfd658218cc144032fac` against Prisma diff and selects a *single* reviewed migration with NOT NULL evidence, FK `(return_transaction_id, borrow_request_id)`, compatible parent UNIQUE, request hash CHECK, partial unresolved UNIQUE index, state CHECK. **Neither 2A nor 2B .sql.txt is runnable approval.**
6. **Review record** — each decision needs real approver name/role/date/reference and distinct independent technical DBA reviewer. Text in this file and ordinary chat agreement are not proof of these approvals.

## Implementation sequence when decisions are recorded

- [ ] **S1. Protect source:** keep nine uploaded WIP files hash-pinned and unmodified in UAT; implement on reviewed new branch, never overwrite UAT.
- [ ] **S2. Normalize API contract:** document PREPARE, GET/LIST, COMMIT, CANCEL; authenticate first; RBAC; Zod strict payload; immutable hash + physical evidence ref; idempotency key semantics; return status for lost response.
- [ ] **S3. Lock-first writer:** one shared lock order for legacy return and operation COMMIT; use one Serializable transaction for receipt, detail, stock, serial Asset, audit and terminal operation status; short retry on known serialization conflicts with bounded attempts; never confirm partial posting.
- [ ] **S4. Fail closed:** keep operation routes HTTP 503 and `ACM_RETURN_OPERATIONS_ENABLED` unset/false while schema/adapter unready. Enabling flag early blocks legacy returns as well.
- [ ] **S5. Test design (offline first):** operation canonicalization, invalid evidence, duplicate lines/evidence, multi-user idempotency key conflict, overreturn, partial return, one unresolved operation, same-borrow FK, status consistency, wrong actor, nonmatching receipt.
- [ ] **S6. Approved isolated PostgreSQL:** after separate #11–#13 approvals, regenerate Prisma client in isolated environment, apply single approved migration, assert positive/negative real FK/CHECK/UNIQUE, 2-session concurrency, fault injection rollback, backup/restore with synthetic fixtures.
- [ ] **S7. Supabase staging:** separate approval for *new* environment SQL; verify project DB identity, TLS, direct/session pooler mode, least privilege, Data API exposure/RLS strategy, secrets server-only. Existing hardcoded integration tests for local `127.0.0.1:55432` must not be re-pointed to Supabase.
- [ ] **S8. E2E+GO:** proof for frontend/backend stock, return, Asset serial, audit, security, restore; separate written signoff before merge, deploy, cutover, or real data transfer.

## Explicitly forbidden at current gate

Do not run 2A/2B SQL, `prisma migrate`, DB writes/DDL, deploy or merge release branch; do not set `ACM_RETURN_OPERATIONS_ENABLED=true`; do not push raw UAT source/credentials/real receipts without further independent source review.

## Evidence base

- Operator-uploaded ZIP: SHA256 `938479d53afa7f16b2923bbf9611b4480957c19ce24d835b84d19c59d5fc332a`; 9/9 file hashes verified.
- Source review: `docs/uat-stage4c-source-review-20261029.md` in draft PR #22.
- Supabase Prisma and connection documentation: https://supabase.com/docs/guides/database/prisma and https://supabase.com/docs/guides/database/connecting-to-postgres

**No SQL or migration executed; no business or DBA approval is implied by this document.**
