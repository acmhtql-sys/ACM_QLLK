# ACM L4 — Synthetic image↔audit orphan reconciliation (REVIEW ONLY)

**Date:** 2026-11-08 · **Decision:** `RELEASE_NO_GO` · **Scope:** ephemeral test directories only, no operational endpoint or real records.

## Why the new check exists

[Draft PR #63](https://github.com/acmhtql-sys/ACM_QLLK/pull/63) tests fail-closed HTTP behavior: if the `IMAGE_UPLOAD` audit sink fails after the image is written, the handler returns HTTP 503 and attempts to delete the image. **If both audit and compensating deletion fail, a file can remain without an acknowledged upload audit.** A 503 response does not imply the file was atomically rolled back.

This branch adds **read-only synthetic reconciliation** instead of deleting unverified data. The utility is accessible only when `NODE_ENV=test`, refuses `cloud_staging` and `production`, requires an absolute non-root directory, rejects symlink ancestors and does not create/delete/rename/mutate files.

## Inspected facts

Given an explicit audit snapshot and isolated local image-record directory, it verifies image-record filenames, symlink status, JSON shape, canonical base64, valid MIME/magic and SHA-256/size. For `IMAGE_UPLOAD` records it compares server-issued actor, item and image IDs plus hash and byte count, then reports:

| Finding | Meaning | Action in this PR |
|---|---|---|
| `ORPHAN_NO_UPLOAD_AUDIT` | Local image exists, supplied snapshot has no upload audit | Report, **do not delete** |
| `MISMATCHED_UPLOAD_AUDIT` | Image exists but supplied audit identity/hash/size differs | Report, **do not repair** |
| `DUPLICATE_UPLOAD_AUDIT` | More than one upload event references same image | Report, **do not deduplicate** |
| `AUDIT_WITHOUT_IMAGE` | Audit references image file absent from snapshot | Report, **do not delete audit** |
| `CORRUPT_IMAGE_RECORD` | Invalid JSON, digest, size or payload | Report, **do not overwrite** |
| `UNSAFE_ENTRY` | Symlink, non-file or unexpected entry type | Report, **do not traverse** |
| `PENDING_FILE` | Possible interrupted staging write | Report, **do not clean up** |
| `UNKNOWN_ENTRY` | Unexpected pathname | Report, **do not clean up** |

A caller must explicitly supply `complete: true` for a clean report. **This is an unverified assertion from the caller, not proof that the source audit is complete, authentic, immutable or durable.** If `complete: false`, the report returns `EVIDENCE_INCOMPLETE` even when all image records appear to match. Multiple process snapshots are not necessarily transactionally consistent.

## Evidence and safety controls

- Source: `apps/api/src/modules/storage/image-storage.orphan-reconcile.review.ts`, pure-ish read-only filesystem inspector with **no write/delete** operations.
- Tests: `apps/api/tests/image-storage.orphan-reconcile.review.unit.test.ts` — 15 isolated cases under `mkdtemp(os.tmpdir())`, cleaned up only by the test fixture itself.
- Source-fence test asserts the review module is not imported in real `app.ts` or `items.router.ts`.
- The feature does not change any Express route, authenticate/RBAC policy, real database, Prisma model, migration, CI workflow, Render, Supabase, Cloudinary or user-data filesystem.

## Independent approval still mandatory before operational L4

1. **Durable audit source:** design append-only, tamper-evident event storage and a way to prove the audit snapshot is complete, including crash recovery and backup/restore.
2. **Atomicity / staging:** decide transactionally coupled metadata/outbox + staged object promotion (or an equivalent design), with retry/replay identity, garbage collection and quarantine for uncertain files.
3. **No silent cleanup:** create a human-approved retention/destruction policy, traceable dry-run evidence, and restoration before enabling any deletion in a real environment.
4. **Filesystem security:** Windows owner/ACL and reparse-point/TOCTOU review, anti-malware/image decoding, quotas, directory persistence and symlink race protections.
5. **Operational acceptance:** only after [AppSec #42](https://github.com/acmhtql-sys/ACM_QLLK/issues/42), L4/local UAT [#26](https://github.com/acmhtql-sys/ACM_QLLK/issues/26) and release signoff [#15](https://github.com/acmhtql-sys/ACM_QLLK/issues/15). Other Stage4C/DBA/PG17 gates remain separate.

**This code only identifies anomalies in synthetic fixtures; it does not guarantee that production orphan files will be detected, removed or prevented. Do not mount, run against Windows UAT, merge `main`, deploy or claim L4 accepted.**
