# ACM Stage4C — PG17 review handoff & two-person approval request

**Date:** 2026-10-30 | **REVIEW ONLY / NO-GO** | Owner business scope is decided, but **DBA and independent execution approvals are NOT yet present**.

This is a handoff packet and not a signed approval or permission to access PostgreSQL. Do not run scripts, SQL, Prisma migration, database connection tests, create new DB resources or modify Windows UAT/DEV merely because this document exists.

## Evidence frozen for reviewer

- Local Windows UAT base commit: `0847a73088b98d8b00fb6ac06f02b2f56d288b78`; 9 UAT WIP Stage4C file hashes pinned previously. Local isolated DEV checkpoint: `0be458b1dd36ee327670b684c571d03934e5397a`, not published to GitHub or merged; original Windows user confirmed clean. Current reviewer cannot independently attest to Windows state.
- Schema WIP: SHA-256 `ab5bbdc7f6f1de397740fadb4d5522a59bbb9a819e23dfd658218cc144032fac`.
- Prisma datamodel diff review only: SHA-256 `90ed5f9333795fdb475771bec2a47f206daffda4f469b89de4616405fe4ae6e2`.
- Old Stage4C 2A SQL text SHA-256 `53337db7d3c5e9447f581d2b3b2e6aea4f9df633b347d451ad63dc64657bcb4b`, 2B constraints SQL text SHA-256 `836f4b4397f0e71b7e0a7da67862c772cd48ee4ec8a6771acf69efeb18c272c6`. **Do not concatenate or execute these SQL candidates.**
- Source-only, unmerged GitHub Draft PRs: [#29](https://github.com/acmhtql-sys/ACM_QLLK/pull/29) DBA decision record; [#30](https://github.com/acmhtql-sys/ACM_QLLK/pull/30) owner pure policy; [#31](https://github.com/acmhtql-sys/ACM_QLLK/pull/31) proposed global registry/custody model; [#32](https://github.com/acmhtql-sys/ACM_QLLK/pull/32) writer port; [#33](https://github.com/acmhtql-sys/ACM_QLLK/pull/33) PREPARE global evidence port. These PRs are **not production integrated**.
- Source CI #40976282603: 73/73 pure/mock tests PASS. Does **not** establish PostgreSQL integrity, service integration, backup restore, cloud readiness or any human signoff.

## Owner decisions for DBA to implement, not reselect

1. `physical_evidence_ref` is ASCII validated, canonicalized case-insensitively, and **globally unique** across borrows/issuers. Never recycle on cancel. The exact proposed regex `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$` and trusted issuer process still need formal business verification.
2. CANCEL after physical RECEIVE means **RECONCILIATION_REQUIRED**, preserving custodial identity and receipt record, no available-stock increase. Final CANCELLED only after separately approved reverse handover or authorized disposition. Different reconciliation causes (e.g., uncertain commit outcome) must not be falsely represented as physically received.

## Gate G1 — DBA design approval, Issue #11 (still OPEN)

The **named DBA** must inspect one consistent future migration design, not approve the three incompatible SQL candidates. Checklist:

- [ ] Match current Prisma migration history to an independently captured catalog under a separately approved read-only access scope.
- [ ] Resolve duplicate CREATE TABLE / duplicate partial index in candidates, `physical_evidence_ref NULL` vs NOT NULL, single vs composite receipt FK, custom CHECK omissions, global canonical UNIQUE, TIMESTAMP(3) vs TIMESTAMPTZ(3).
- [ ] Explicitly model global evidence issuer registry and immutable ownership; all-code historical collision detection, integration with legacy returns, failure modes and issuer auth.
- [ ] Preserve independent `received_by/received_at`, `verified_by/verified_at`, custody resolution approval evidence, per-line GOOD/DAMAGED QC and separate LOST incident.
- [ ] Ensure exactly one active/reconciliation operation per borrow and durable scoped idempotency plus permanent stock posting dedup. Define cancellation custody and reconciliation reason checks.
- [ ] Document deterministic lock order shared with legacy return writer, Serializable retries ONLY after verified rollback, post-commit ambiguity handling through persisted replay status, race cases and rollback/restore plan.
- [ ] Produce **one** forward design and independently reviewed guarded rollback; pin exact artifact hash.
- [ ] Independent recorded approval or rejection containing reviewer identity, role, timestamp, authoritative reference and conditions. **No real SQL until separate execution authorization.**

**DBA decision record (must be supplied by an actual authorized person; blanks intentionally unfilled):**

`DBA person / role: __________ | decision: APPROVE / REJECT / DEFER | timestamp TZ: __________ | authoritative signed source: __________ | pinned design SHA: __________ | conditions: __________`

## Gate G2 — two-person authorization to CREATE isolated local PG17, Issue #12 (still OPEN)

Target is a **new-only**, isolated local cluster (not the existing Windows service), and create permission does **not** authorize schema writes:

`%LOCALAPPDATA%\ACM_D8_PG17_55433_NEW_ONLY` — `127.0.0.1:55433` — PostgreSQL 17 — separate `acm_d8_admin` role, interactive SCRAM secret. Operator must inspect `ACM_D8_PG1C_Independent_Review_Packet_NO_GO_20261028.zip` (SHA-256 `3197944c40f2ddb949e778e54752d7781c5a178dc9d14317b9311415c58d64a4`), confirm new empty target directory/available port and identity tests, and never affect `postgresql-x64-17`, UAT/DEV, real data, SQL or Supabase.

- [ ] Project owner approval with signed identity, role, UTC-offset timestamp, precise CREATE-only scope, packet hash and verifiable source reference.
- [ ] **Different** independent technical/security reviewer approval with equally verifiable source and no role overlap.
- [ ] Authorized operator and a fresh preflight demonstrating target does not exist, port is free, service separation; identity proof following Create.
- [ ] If evidence incomplete or conflicts with other cloud alternatives, remain **NO-GO**.

`Owner approver / role: __________ | decision: APPROVE / REJECT / DEFER | timestamp TZ: __________ | independently verifiable reference: __________`

`Independent technical reviewer / role: __________ | decision: APPROVE / REJECT / DEFER | timestamp TZ: __________ | independently verifiable reference: __________`

**If the team instead chooses the already-known Supabase staging alternative, obtain a separately reviewed replacement scope with two-person cloud approvals and data residency/role/security acceptance; a local PG17 CREATE approval cannot be silently reused for Supabase.**

## Gate G3 — isolated PG17 SQL/rollback test authorization, Issue #13 (still OPEN)

This **third, separate** permission is requested only AFTER G1/G2 and post-create PG identity verification. Document exact DB name, authorized operator, migration hash, synthetic fixtures, backup strategy, rollback boundaries, test window, and reviewer evidence source. No real data or shared database.

Required acceptance includes PostgreSQL actual two-connection global evidence collisions across different borrows, one-unresolved-per-borrow race, composite receipt FK cross-borrow rejection, independent actor provenance, post-RECEIVE cancellation custody, GOOD/DAMAGED quarantine-first, LOST as incident only, idempotent retries, injected transaction failure, and independent restore. If any critical test fails, STOP / NO-GO.

`SQL test approver / role: __________ | permitted isolated cluster fingerprint: __________ | migration SHA: __________ | synthetic-only DB: __________ | window: __________ | signed evidence: __________`

## Gate G4 — Backend & release, Issues #15 and #26 (still OPEN)

Only after successful isolated PG tests: implement a real reviewed Prisma adapter with hardened authorization and immutable audit; satisfy API/frontend↔backend↔PG E2E, security/RBAC/IDOR, legacy writer compatibility, physical receipt and borrow partial/full journeys, stock balances, backup/restore and release signoff. Do not enable `ACM_RETURN_OPERATIONS_ENABLED` while the new writer is incomplete and the legacy path is disabled by the flag.

## Transaction retry boundary already available as source-only code

Draft PR for this handoff adds `borrow.return-transaction-retry.ts`: the wrapper catches **only a trusted adapter's explicit confirmed-rollback error** (e.g. a *verified fully aborted* Serializable conflict), retries the **entire** operation at most three total attempts, and does NOT retry raw Prisma `P2034`, uniqueness `P2002`, connection drops or ambiguous COMMIT outcome. A future adapter must actually guarantee this safety contract, including durable replay and no external side effects; the pure source and its CI cannot verify that.

### Status at handoff

**OWNER BUSINESS DESIGN: approved for REVIEW ONLY. DBA SIGNOFF: OPEN. PG17 TWO-APPROVER CREATE: OPEN. PG17 SQL EXECUTION: OPEN. REAL ADAPTER: NOT IMPLEMENTED. LOCAL GO: NO-GO. CLOUD GO: NO-GO.**

The absent human identity and approval signature fields are deliberately not simulated, inferred from GitHub account comments or completed by automation.
