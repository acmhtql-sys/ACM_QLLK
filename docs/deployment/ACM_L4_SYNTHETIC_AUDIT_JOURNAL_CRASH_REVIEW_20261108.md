# ACM L4 — Synthetic file-backed image audit journal (REVIEW ONLY)

**Date:** 2026-11-08 · **Status:** `RELEASE_NO_GO` · **Source base:** Draft [#64](https://github.com/acmhtql-sys/ACM_QLLK/pull/64).

## Engineering problem

The unmounted local-image HTTP candidate in [#63](https://github.com/acmhtql-sys/ACM_QLLK/pull/63) requires a successful audit acknowledgement before HTTP 201/200, but no durable audit implementation exists. Its best-effort compensating deletion may fail and leave an unaudited image. [#64](https://github.com/acmhtql-sys/ACM_QLLK/pull/64) can only inspect such evidence if a sufficiently complete audit snapshot is supplied. This PR creates a **synthetic, test-only file-backed audit journal** to exercise this boundary, not to operate it.

## What is implemented (and what is not)

- Test-only `TestOnlyFileImageAuditJournal` implements the `ItemImageAuditSink` contract for **ephemeral fixtures only**. It requires `NODE_ENV=test`, rejects cloud-staging/production, requires an absolute non-root directory and rejects pre-existing symlink ancestors.
- Each event is server-shaped `IMAGE_UPLOAD` or `IMAGE_READ`, with only action, actor/item/image IDs, SHA-256, byte length, timestamp. It refuses unknown/sensitive properties. It creates an isolated UUID `.pending` file (`wx`, restrictive mode), writes JSON, synchronizes file contents and closes it, then renames it to an event `.json` file.
- It provides a **read-only** review method. A `.pending`, corrupt/modified event, unexpected filename or symlink **marks the snapshot incomplete**, not clean. A SHA-256 checksum detects accidental change against the record; **it is NOT a cryptographic authenticity signature** because an attacker who can write the file can recompute the checksum.
- A synthetic after-fsync/before-rename failure hook leaves a `.pending` record for inspection without deleting it. This is a deterministic code-level interruption, **not proof of surviving a real OS/power crash**. The directory rename is not necessarily fsynced, and Windows/NTFS crash behavior is not established.
- The journal's `readForReview()` snapshot can be passed into [#64's](https://github.com/acmhtql-sys/ACM_QLLK/pull/64) read-only image↔audit reconciler. This demonstrates detection of an orphan, duplicate upload audits and incomplete evidence under synthetic conditions. A returned `complete: true` means only **no anomalies detected within the supplied local fixture**; it does not prove the audit source is authoritative or globally complete.
- It is **not imported into ACM `app.ts` or item router**, never mounted, and never used against actual user images or database. CI runs test-only fixtures under `mkdtemp(os.tmpdir())` with automated cleanup only of the isolated test sandbox.

## Explicitly unresolved before real deployment

1. **Atomicity:** No cross-resource transaction exists between image bytes, catalog metadata, and audit. A durable DB outbox or equivalent staged-publish protocol needs its own independently reviewed specification, idempotency and retry semantics.
2. **Trust:** Local checksums are not tamper-evident against an adversarial writer. Require externally anchored/authenticated audit identity and independent append-only controls, authorization, time source and retention.
3. **Crash recovery:** File `sync()` before rename is insufficient to prove power-loss durability. Require directory durability, ownership, replay and integrity proofs for the actual Windows storage target, including reparse points and rename races.
4. **Consistency:** Review snapshots can race writers and are not transactionally consistent. The test hook simulates a single failure point only, not all crash windows, network errors or concurrent processes.
5. **Safe cleanup:** No automated removal or repair is allowed. Human-reviewed orphan handling needs backups, per-object claims, quarantining and a traceable destruction policy.
6. **Release controls:** Independent AppSec/owner signoff at [#42](https://github.com/acmhtql-sys/ACM_QLLK/issues/42), [#26](https://github.com/acmhtql-sys/ACM_QLLK/issues/26) and [#15](https://github.com/acmhtql-sys/ACM_QLLK/issues/15). DBA/PG17/Stage4C approvals at [#11–#13](https://github.com/acmhtql-sys/ACM_QLLK/issues/11) are separate and still pending.

**Strictly no main merge, Prisma/SQL/PG17 Create, Render/Supabase/cloud deployment, actual Windows UAT actions, paid services or real customer data.** This is an engineering test fixture and DOES NOT close L4.
