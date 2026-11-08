# ACM L4 — Local image HTTP review candidate (UNMOUNTED / NO-GO)

**Date:** 2026-11-08 · **Scope:** test-only engineering artifact, **not an operational upload API**.

## Code delivered

- `apps/api/src/modules/storage/image-storage.http-review.ts` creates an Express Router candidate for **POST** raw PNG/JPEG/WebP bytes and **GET** private binary download by `itemId/imageId`.
- The router is intentionally **not imported or mounted** in `apps/api/src/app.ts`, `apps/api/src/modules/items/items.router.ts`, or any running server. A source-only CI test prevents accidental wiring.
- The router itself requires all four explicit conditions before doing any work:
  - `NODE_ENV=development`
  - `ACM_DEPLOYMENT_PROFILE=local_dev`
  - `ACM_LOCAL_IMAGE_STORAGE_ENABLED=true`
  - `ACM_LOCAL_IMAGE_HTTP_REVIEW_ENABLED=true`
- Even then the router itself runs ACM's real `authenticate` (JWT signature, live database user/role/status and password tag) **before** `authorizeRoles(ADMIN, LAB_MANAGER)`. It also requires a trusted `isActiveItem(itemId)` lookup, supported MIME, allowed filename, matching image magic, and a 5 MiB raw size limit.
- Download is private, non-cacheable, `Content-Disposition: attachment`, `nosniff`, and the injected provider only returns bytes for the requested item. No DELETE route exists; deletion and retention are not approved.
- HTTP parser/IDOR unit tests use a memory-only synthetic provider and fake authenticated principals. **A separate guarded integration suite** exercises the real ACM login/JWT/live-role middleware against the ephemeral CI-only `acm_inventory_test` PostgreSQL 16 service. It never reads real UAT/production records or mounts this router into the operational app.

## Security requirements before any real mounting

1. **Owner/AppSec approval** for audience, access by STUDENT, allowed formats, image re-encoding/metadata stripping, malware detection, length policy, rate/quota limits, audit events, retention/cleanup/backup and restore.
2. **Real JWT middleware:** this review router now includes the existing ACM `authenticate` itself before RBAC and body parsing; any future route adapter must preserve that order and must never trust `userId` or `role` from HTTP input. Real deployment still needs independent AppSec acceptance of token handling and item-level authorization.
3. **Durable provider hardening:** enforce OS ownership and ACL, symlink/reparse-point and TOCTOU resistance on Windows, per-item storage quotas, safe delete/restore and independent AppSec testing. The previous local disk adapter is not approved for real user data.
4. **Audit/metadata transaction:** define how a file write and DB item-image reference remain consistent on failures, prevent orphaned files and record immutable uploader/item references. No catalog `imageUrl` is updated by this candidate.
5. **Operational roll-out controls:** separate feature rollout approvals, isolated local synthetic UAT, negative tests for 401/403/404/413/415/422, review cloud-staging read-only upstream policy and confirm cloud/production environment blocks this router.
6. **Mobile/Web integration:** after authorized mounting and fully verified storage, connect the item form/view in a separate frontend PR. This candidate does not add UI image upload.

## No-go guarantees

- There is **no production path to this router** in the current app. Feature flags alone cannot mount it.
- No real data, UAT disk writes, PostgreSQL/Prisma migrations, Render/Supabase/Cloudinary, cloud deployment or paid service is touched.
- The CI-local real-JWT integration checks authentication behavior but cannot prove Windows ACL, real user/production token operation, audit durability or a real customer upload.
- Do not merge PR to `main`, deploy, remove guards or claim L4 accepted until an independent AppSec reviewer and owner record a verifiable approval.

**Status: `RELEASE_NO_GO`.** Review coordinator: [Issue #42](https://github.com/acmhtql-sys/ACM_QLLK/issues/42); local acceptance [#15](https://github.com/acmhtql-sys/ACM_QLLK/issues/15).
