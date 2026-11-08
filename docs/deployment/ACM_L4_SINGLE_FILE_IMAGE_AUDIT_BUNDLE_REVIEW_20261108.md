# ACM L4 — One-file image + metadata + upload-audit publication protocol

**2026-11-08 · Engineering experiment only · `RELEASE_NO_GO`.**

This review follows [Draft PR #65](https://github.com/acmhtql-sys/ACM_QLLK/pull/65), whose separate image and audit files remain vulnerable to failures between the two writes. This PR tests a **single-file publication alternative** using synthetic PNG, metadata and upload audit stored together. This is **not** an operational file system, database transaction, or a production audit ledger.

## Experiment

- The test-only `TestOnlyImageAuditBundle` constructs one JSON envelope `{version,metadata,uploadAudit,base64,checksum}` using a server-like, preallocated UUID claim as the immutable filename. It checks MIME/magic, file length, content hash and correlation of actor/item/image IDs and event timestamp. No JWT, bearer token or network request is included.
- A unique `.pending` file is opened exclusively, written and **file-synced**, then published with **same-filesystem hard-link creation**, rejecting a second claim file without overwriting. A successful publication makes complete image metadata and upload-audit bytes visible **together within the one record**.
- If two callers race with the same claim and same content, one record is published and the other receives the prior result. A different payload on the same claim is rejected as a conflict; this is **synthetic local-file claim idempotency**, not a DB-level idempotency or custody proof.
- A before-publish failure leaves only a `.pending` file. A simulated lost acknowledgment after publication leaves a published record and potentially a pending hard-link; retry with the same claim recovers the previously published record without writing a second published claim.
- A read-only inspector flags pending/unexpected/symlink/corrupt records. It does **not** clean up or repair files and does not assert a trustworthy external audit source.
- 17 tests cover matching image+audit, identical and conflicting retries, 6-way concurrent publish, interrupted stages, lost ACK recovery, tampered image/audit/checksum, invalid base64, symlink/root guards and profile denial. CI only accesses `mkdtemp(os.tmpdir())` synthetic fixtures.

## Why this is not enough for L4 acceptance

1. **Cross-resource atomicity remains unsolved.** A single JSON file avoids a two-file local split inside the fixture, but the real ACM design requires item-image catalog metadata, authenticated durable audit events and transactional consistency with PostgreSQL. This prototype is not imported into the operational server or image storage provider.
2. **Hard-link semantics are platform dependent.** A no-overwrite `link()` publication is only proven against the Linux CI synthetic filesystem. Windows NTFS/reparse-point/ACL and concurrent rename/link/delete attacks require AppSec review and local negative testing.
3. **Power loss is not tested.** File `sync()` does not guarantee published directory metadata survives sudden power interruption. The fixture does not fsync the directory; even directory sync behavior differs by OS. Failure hooks are deterministic thrown errors, not a real crash/power-loss test.
4. **Checksum is not authenticated.** A malicious writer with file access can recalculate SHA-256 over altered content; independent append-only audit storage/signatures and key management remain unapproved.
5. **Read-only inspection is not a recovery manager.** Pending entries or ambiguous claims are reported, not deleted or repaired. A production design needs lifecycle states, retention, cleanup approvals, immutable receipts, quotas, media decoding, antivirus, backup and restore.
6. **No production route or paid cloud.** The class is restricted to `NODE_ENV=test` and rejects cloud-staging/production. Source regression tests prove the module is not imported by ACM `app.ts` or `items.router.ts`. No schema/migration, SQL, cloud, UAT, real user data or Render/Supabase changes are made.

## Next human decisions

| Gate | Needed decision |
|---|---|
| L4 AppSec / owner — [#42](https://github.com/acmhtql-sys/ACM_QLLK/issues/42) | Decide real storage medium, durable authenticated audit, image↔metadata transaction/outbox, Windows ACL/TOCTOU, source privilege and orphan cleanup/retention |
| L4 local UAT — [#26](https://github.com/acmhtql-sys/ACM_QLLK/issues/26) | Prove synthetic same-file publication, local recovery, backup and restore in the approved target without customer records |
| Whole-system release — [#15](https://github.com/acmhtql-sys/ACM_QLLK/issues/15) | Independent QA/security/owner GO, actual four-role flows, mobile scope and full backend/DB acceptance |
| Stage4C DBA / PG17 — [#11](https://github.com/acmhtql-sys/ACM_QLLK/issues/11), [#12](https://github.com/acmhtql-sys/ACM_QLLK/issues/12), [#13](https://github.com/acmhtql-sys/ACM_QLLK/issues/13) | Separate independent approvals before PostgreSQL 17 Create, DDL, SQL/race/restore or live Return Writer |

**Not approved for real data, HTTP mounting, migration, deployment, or merging `main`; all formal release gates remain OPEN.**
