# ACM — Local private image storage: review packet

**2026-10-29 — DRAFT / LOCAL ONLY / NO CLOUD GO.** This is an isolated Backend module. It has no Express route, Prisma write, Cloudinary call, web UI, or production activation. It does **not** alter Windows UAT or any SQL/migration.

## Delivered and tested

- `apps/api/src/modules/storage/local-image.storage.ts`: private `LocalImageStorageProvider` with put/get/remove, random UUID paths, user/uploader identity guard, non-world-readable POSIX directory, optional MIME claim checked against PNG/JPEG/WebP signatures, default maximum 5 MiB, data SHA-256 integrity verification, file metadata, and repeat-safe deletion of non-evidence images.
- `scripts/acm-local-image-storage.offline.mjs`: **22 offline tests**, each using an isolated OS temporary directory and fake images. Includes MIME spoofing, file limit, path traversal, symlinks, ownership, tamper detection, malformed metadata, idempotent removal, and evidence non-deletion.
- **Receipt evidence is never removable via this ordinary provider**, even by the uploader. There is no public URL for any object. Exact uploader equality is a conservative local guard, not full domain-level authorization.

## Important missing engineering before functional integration

1. **Resource-level RBAC:** Image access needs authenticated server context and role/association to an Item/Asset/Borrow receipt, not just uploader equality. Determine immutable evidence audit and retention requirements.
2. **Validated real images:** Signature checks are a shallow allowlist, **not** full decoding, malware scanning, image-bomb defense, dimension checks or content sanitization. Implement safe image decoding/re-encoding and pixel/format quotas before live upload.
3. **Transactional references:** Document Prisma attachment metadata model, ownership and optional disposal policy; use an outbox or compensating cleanup for database/file-provider failure. Two separate stores cannot share a single ACID transaction.
4. **HTTP/UI workflow:** Explicitly authorized upload/download/list/delete routes, rate limits, request-size controls, audit and React UI; not part of this PR.
5. **Windows local safety:** Storage directory outside static web roots, filesystem ACL review, no secrets, no real evidence files; test on a separate worktree, not `D:\ACM_QLLK_UAT`.
6. **Cloudinary later:** Only after **LOCAL GO** and separate cloud staging approvals, implement Cloudinary server-side adapter behind the interface. Credentials stay in Backend, never Vite `VITE_` environment or Vercel browser. No Cloudinary API has been called.

## Testing and release gates

Offline Node 22.16 native tests + standalone TypeScript check can confirm only this module, not the whole frontend/backend or Postgres. Full monorepo lint/typecheck/build, integration and end-to-end/backup-restore are still required. DBA independent signoff and explicit SQL migration permissions remain blocked by issues #11–13; Local-first roadmap is Issue #26.

**No PR merge, no DB/Supabase write, no upload route enablement, no Cloudinary/Vercel/Render deployment.**
