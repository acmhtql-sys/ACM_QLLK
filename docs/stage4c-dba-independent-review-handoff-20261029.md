# ACM Stage4C — DBA independent review handoff (NO-GO / 2026-10-29)

**Purpose:** make it possible for a real independent PostgreSQL/Prisma reviewer to evaluate the design, reject unsafe assumptions and issue a verifiable decision. This is **not** executable SQL or permission to touch Supabase/PostgreSQL.

## 1. Scope and evidence register

- Repo: private `acmhtql-sys/ACM_QLLK`, Draft PR #22; owner-approved business rules: `docs/stage4c-owner-business-policy-proposal-20261029.md` (**5/5 business rules**, not DBA approvals).
- UAT source archive: `ACM_UAT_SourceReview_ONLY_20261029_204537.zip`, SHA-256 `938479d53afa7f16b2923bbf9611b4480957c19ce24d835b84d19c59d5fc332a`; nine files matched signed-off V2 manifest; source HEAD `0847a73088b98d8b00fb6ac06f02b2f56d288b78`.
- Prisma Stage4C schema SHA-256 `ab5bbdc7f6f1de397740fadb4d5522a59bbb9a819e23dfd658218cc144032fac`. These bytes are **local WIP**, not GitHub tracked source at that HEAD.
- Review-only SQL inputs: `apps/api/prisma/Stage4C2A_MIGRATION_REVIEW_ONLY.sql.txt` and `Stage4C2B_CONSTRAINTS_REVIEW_ONLY.sql.txt` (never execute). Both include a named unresolved-operation unique index: must not apply in sequence.
- Review source evidence: `docs/uat-stage4c-source-review-20261029.md` and implementation contract `docs/stage4c-backend-implementation-contract-20261029.md`.
- Historical PG17 isolated sandbox gate #12 is **not yet approved by two real people**; no independent DBA has signed issue #11 at this time.

## 2. DBA must review and decide on

| ID | Required independent finding | Acceptance evidence |
|---|---|---|
| DBA-01 | Mandatory physical evidence ref is NOT NULL, full BIZ-01 ASCII 1–128 regex consistent in TS/DB; comparison case-insensitive; avoid silent data collisions | Reviewed canonicalization + DB CHECK + unique index/collation plan; scope of uniqueness specified |
| DBA-02 | Parent composite key and child composite FK tie each return receipt to the same borrow; verify `(returnTransactionId, borrowRequestId)` and correct parent UNIQUE | Actual Prisma-generated diff + schema DDL mapping, negative wrong-parent tests |
| DBA-03 | Single unresolved operation per borrow; one unique durable COMMIT identity; unique borrow + idempotency key for >=365 days, resistant to TTL expiry replays | Exact constraints/index predicates and test plan; no duplicate index from 2A/2B |
| DBA-04 | State machine PREPARE/RECEIVE/VERIFY/COMMIT/CANCEL and BIZ-02/04 separation of actors; no forged receipt via client-controlled fields | Enforced server auth + server-controlled identities, condition CHECK, audit structure and transition tests |
| DBA-05 | Quarantine-first stock/accounting: no premature available increment; GOOD after authorized QC; DAMAGED quarantine; LOST incident not receipt; match Asset/serial | Data-flow + ledger balance invariants and serial transitions reviewed, written disposition of edge cases |
| DBA-06 | Legacy and new writer share deterministic lock order; Serializable tx contains every receipt/stock/asset/audit effect; bounded retry and rollback | Two-session concurrency and injected-failure test plan (NOT fake-only proof) |
| DBA-07 | Migration is a **single, explicit** reviewed forward script, catalog precheck/guarded rollback, pinned SHA; new Prisma client generated with consistent version, not stale | Human approval tied to exact DDL SHA and schema hash; do not rely on code-only tests |
| DBA-08 | Supabase architecture: app uses server-side Prisma to PG17, connection mode chosen for deployment network; migration connection separately planned; TLS, secrets and minimal roles; Data API/RLS exposure | Threat model, role/grants plan, not browser-exposed credentials, recovery and backup/restore outline |

**DBA-08 is an additional review topic, not retroactive approval of DBA-01…07.** If reviewers find missing requirements, mark REQUEST CHANGES and keep NO-GO.

## 3. Known blockers from inspected source

1. Current `return-operations` endpoint is a hard **503**; `ACM_RETURN_OPERATIONS_ENABLED=true` can disable legacy path before new writer is ready. Keep flag false.
2. Candidate 2A `physical_evidence_ref` permits NULL; Stage4C Prisma requires a string; 2A's receipt FK is not the composite FK in the schema.
3. 2A and 2B cannot be run sequentially: both contain a matching named partial unique index, with incompatible definition staging.
4. Foundation function validates evidence formatting but **does not verify a human actually received equipment**; BIZ-02 requires independent receiver/verifier.
5. Existing integration test is pinned to a local PG sandbox on `127.0.0.1:55432`; never point that test at Supabase by changing environment variables.
6. UAT Prisma-generated client has been reported stale compared with local WIP schema. Any regenerated client must be validated in an isolated permitted workspace.

## 4. Required negative-control checklist for an authorized isolated PostgreSQL 17

**Design only; do not run until separate approvals (#11/#12/#13 and environment identity) are recorded.**

- [ ] Reject NULL/out-of-regex physical ref; reject same-code case variants as duplicates under approved scope.
- [ ] Reject composite receipt FK with wrong borrow owner, missing parent or mismatched parent; enforce approved ON DELETE.
- [ ] Reject two concurrent unresolved operations for same borrow; no race through check-then-insert.
- [ ] Reject overreturn, negative stock and COMMIT without independent verification; no asset/stock side effect from CANCEL.
- [ ] Reject same borrow/key but different payload, or replay by invalid actor; same allowed retry results in one durable receipt.
- [ ] COMMIT twice or after key expiry does not double-post; retention policy minimum 365 days.
- [ ] Two PostgreSQL sessions race legacy return vs new operation; deadlocks/40001/P2034 are bounded retries and no partial effects.
- [ ] Inject failure at last audit/Asset/stock step and demonstrate rollback of full transaction.
- [ ] Backup/restore proof on separately approved disposable DB using **synthetic** fixtures, catalog/migration hashes before and after.
- [ ] Verify release data access privileges, Data API exposure/RLS, TLS, rotateable credentials, and restore readiness.

## 5. Recommended Supabase connection review (not deployment instruction)

Official references:
- https://supabase.com/docs/guides/database/prisma
- https://supabase.com/docs/guides/database/connecting-to-postgres

Supabase documents direct PG access for migrations/long-lived hosts (IPv6 unless IPv4 add-on) and session pooler for persistent clients on IPv4-only networks; transaction mode is designed for ephemeral/serverless clients. **Do not blindly use transaction mode for long-running/locking Prisma operations without testing its semantics**, and do not expose DB URLs or privileged keys to the frontend. Their current Prisma quickstart may differ from this repo's **Prisma 5.x** conventions: pin code versions, validate exact project configuration and deployment style before adjusting adapters or connection strings. Supabase documentation also recommends disabling Data API if Prisma is the sole DB interface; verify whether frontend needs Data API first, otherwise enforce RLS and least privilege in exposed schemas.

No credentials, SQL or migration commands are supplied in this packet.

## 6. Signoff placeholders — must be completed by real people

**Business (BIZ-01..05):** OWNER APPROVED in recorded project conversation 2026-10-29. Owner's ability to act as authorized decision-maker was self-asserted; organizational signature/audit reference not independently verified.

**Independent DBA reviewer (currently MISSING):**
- Name / professional role: [not assigned]
- Independence from business owner confirmed: [not reviewed]
- Source ZIP & Prisma SHA independently checked: [pending]
- DB DDL / security / concurrency finding IDs: [pending]
- Exact final DDL forward/rollback SHA: [not produced]
- APPROVE / REQUEST CHANGES / REJECT + reasons: [pending]
- Date/time and independently verifiable review URL / signed record: [pending]

**Separate isolated PostgreSQL create approval (#12):** two distinct real-human signoffs [missing].
**Separate execute migration and DB test authorization (#13):** [missing].
**Separate Supabase staging SQL/data change authorization (#21):** [missing].
**Release / production cutover (#15):** [missing].

**Decision status: DBA REVIEW PENDING — NO-GO.** A ChatGPT review, an issue comment, or business approval cannot be represented as independent DBA signoff.
