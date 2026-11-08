# ACM L4 — File descriptor safety in the local image prototype

**Date:** 2026-11-08  
**Scope:** local/test-only prototype, not operational HTTP or production acceptance.  
**Status:** `RELEASE_NO_GO`.

## Concrete risk and narrow correction

In the previous local image adapter, `readForItem()` used `lstat(file)` to reject symlinks and then independently called `readFile(file)`. Between those operations another process could replace `file` with a symlink, causing the second operation to follow a different path. The original unit test covered only a symlink *already present before lstat*, not the replacement window.

The revised adapter:
- Opens the record with `O_RDONLY | O_NOFOLLOW` (where available). It **fails closed** with `LOCAL_IMAGE_STORAGE_NOFOLLOW_UNAVAILABLE` on a platform without that flag, rather than silently using the insecure two-call pattern.
- Validates regular-file type, exactly one hard link, positive length and 8 MiB record ceiling on the **same open file descriptor**, then reads the contents from that descriptor. It converts link-follow errors to `LOCAL_IMAGE_STORAGE_UNSAFE_RECORD`.
- Rejects Base64 records that cannot be decoded and re-encoded byte-for-byte into the same canonical text, so permissive Node Base64 parsing cannot silently skip injected characters or missing padding.
- Preserves the existing strict item-to-image ID check, SHA-256, MIME/header/size checks and test/local-dev/cloud profile guard.

## Regression evidence

`apps/api/tests/image-storage.filehandle-security.unit.test.ts` exercises:

1. Normal item-owned image read and cross-item non-disclosure.
2. Deterministic symlink replacement **just before** descriptor opening, expected deny.
3. Replacement **after the descriptor is opened**, expected to retain the original inode's bytes.
4. Hard-link record denial.
5. Non-Base64 injected characters denial.
6. Non-canonical missing padding denial.
7. Zero-byte record denial.
8. Symlink-based item cleanup denial.

Tests use only temporary synthetic directories. No customer files, network or database are involved.

## Explicit residual security gaps — not approved for real data

- **Root ancestry TOCTOU:** `prepareRoot()` still validates path components sequentially. A hostile process can replace ancestor directories between these checks and subsequent file access; preventing that reliably requires filesystem ownership/sandbox controls and possibly platform-specific directory-handle APIs.
- **Deletion TOCTOU:** `deleteForItem()` still checks an image and later unlinks its path. A second actor could replace that path after the check. This PR **does not** claim safe atomic delete, nor add a real DELETE HTTP route. AppSec must design safe ownership, quarantine/GC and supported OS mechanisms.
- **Windows support:** `O_NOFOLLOW`, hard-link and reparse-point behavior must be verified on the actual Windows/NTFS UAT target. This patch deliberately denies access if `O_NOFOLLOW` is not exposed; Linux CI green does **not** prove Windows compatibility.
- **Content protection:** MIME magic is not image decoding or malware/metadata inspection. An ordinary SHA-256 checksum is not an authenticated audit trail, and local-disk image records are not atomically committed with PostgreSQL item metadata.
- **Operational scope:** the image router remains unmounted. No actual user uploads, schema/migration, Render/Supabase/cloud changes, paid resources or `main` merge are authorized.

Independent AppSec review and local UAT [#42](https://github.com/acmhtql-sys/ACM_QLLK/issues/42), [#26](https://github.com/acmhtql-sys/ACM_QLLK/issues/26), final owner release [#15](https://github.com/acmhtql-sys/ACM_QLLK/issues/15), and separate Stage4C/PG17 DBA approval gates [#11](https://github.com/acmhtql-sys/ACM_QLLK/issues/11) remain necessary.
