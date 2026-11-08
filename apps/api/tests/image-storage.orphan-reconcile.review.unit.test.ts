import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { LocalOnlyDiskItemImageStorage } from '../src/modules/storage/image-storage.local';
import { inspectSyntheticLocalImageAudit } from '../src/modules/storage/image-storage.orphan-reconcile.review';
import type { ItemImageAuditEvent } from '../src/modules/storage/image-storage.audit.contract';
import type { StoredItemImage } from '../src/modules/storage/image-storage.contract';

const ITEM = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);

describe('L4 read-only synthetic orphan↔audit reconciliation (NO DELETE / NO LIVE DATA)', () => {
  let sandbox: string;
  let images: string;
  let storage: LocalOnlyDiskItemImageStorage;

  beforeEach(async () => {
    vi.stubEnv('ACM_DEPLOYMENT_PROFILE', 'local_dev');
    sandbox = await mkdtemp(path.join(tmpdir(), 'acm-l4-orphan-review-'));
    images = path.join(sandbox, 'synthetic-images');
    storage = new LocalOnlyDiskItemImageStorage(images);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(sandbox, { recursive: true, force: true });
  });
  const save = async (): Promise<StoredItemImage> => storage.save({
    itemId: ITEM, uploadedById: ACTOR,
    originalName: 'synthetic.png', mimeType: 'image/png',
    contents: Uint8Array.from(PNG),
  });
  const auditFor = (saved: StoredItemImage): ItemImageAuditEvent => ({
    action: 'IMAGE_UPLOAD',
    actorId: saved.uploadedById,
    itemId: saved.itemId,
    imageId: saved.id,
    sha256: saved.sha256,
    byteLength: saved.byteLength,
    recordedAt: saved.createdAt,
  });
  const inspect = (events: readonly ItemImageAuditEvent[], complete = true) =>
    inspectSyntheticLocalImageAudit(images, { complete, events });

  it('RECON-01: matching full UPLOAD audit and image bytes report CLEAN', async () => {
    const image = await save();
    const result = await inspect([auditFor(image)]);
    expect(result).toEqual({
      status: 'CLEAN', scannedImages: 1, examinedUploadAudits: 1, findings: [],
    });
  });
  it('RECON-02: saved image without upload audit is flagged, never deleted', async () => {
    const saved = await save();
    const result = await inspect([]);
    expect(result.status).toBe('REVIEW_REQUIRED');
    expect(result.findings).toContainEqual({
      code: 'ORPHAN_NO_UPLOAD_AUDIT', reference: saved.id,
    });
    expect((await storage.readForItem(ITEM, saved.id))?.contents).toEqual(PNG);
  });
  it('RECON-03: forged sha/actor in audit cannot validate image provenance', async () => {
    const image = await save();
    const result = await inspect([{ ...auditFor(image), sha256: '0'.repeat(64), actorId: ACTOR }]);
    expect(result.findings).toContainEqual({
      code: 'MISMATCHED_UPLOAD_AUDIT', reference: image.id,
    });
  });
  it('RECON-04: two upload audit entries for one image are reported', async () => {
    const image = await save();
    const e = auditFor(image);
    const result = await inspect([e, { ...e }]);
    expect(result.findings).toContainEqual({
      code: 'DUPLICATE_UPLOAD_AUDIT', reference: image.id,
    });
    expect(result.examinedUploadAudits).toBe(2);
  });
  it('RECON-05: audit record for absent image is flagged', async () => {
    const image = await save();
    const e = auditFor(image);
    const gone = { ...e, imageId: '33333333-3333-4333-8333-333333333333' };
    const result = await inspect([e, gone]);
    expect(result.findings).toContainEqual({
      code: 'AUDIT_WITHOUT_IMAGE', reference: gone.imageId,
    });
  });
  it('RECON-06: incomplete audit evidence is never reported CLEAN', async () => {
    const image = await save();
    const result = await inspect([auditFor(image)], false);
    expect(result.status).toBe('EVIDENCE_INCOMPLETE');
    expect(result.findings).toEqual([]);
  });
  it('RECON-07: leftover pending write is flagged, never auto-removed', async () => {
    const image = await save();
    await writeFile(path.join(images, 'synthetic.pending'), 'torn write');
    const result = await inspect([auditFor(image)]);
    expect(result.findings).toContainEqual({
      code: 'PENDING_FILE', reference: 'synthetic.pending',
    });
    expect(await readdir(images)).toContain('synthetic.pending');
  });
  it('RECON-08: unexpected filenames and symlinks flagged without following', async () => {
    const image = await save();
    await writeFile(path.join(images, 'README.txt'), 'untrusted');
    await symlink(path.join(images, image.id + '.json'), path.join(images, 'alias.json'));
    const result = await inspect([auditFor(image)]);
    expect(result.findings).toContainEqual({ code: 'UNKNOWN_ENTRY', reference: 'README.txt' });
    expect(result.findings).toContainEqual({ code: 'UNSAFE_ENTRY', reference: 'alias.json' });
  });
  it('RECON-09: forged checksum and broken JSON are flagged, not served or deleted', async () => {
    const image = await save();
    const file = path.join(images, image.id + '.json');
    const original = JSON.parse(await readFile(file, 'utf8'));
    original.metadata.sha256 = '0'.repeat(64);
    await writeFile(file, JSON.stringify(original));
    const result = await inspect([auditFor(image)]);
    expect(result.findings).toContainEqual({
      code: 'CORRUPT_IMAGE_RECORD', reference: image.id,
    });
    await writeFile(file, '{corrupt');
    const again = await inspect([auditFor(image)]);
    expect(again.findings).toContainEqual({
      code: 'CORRUPT_IMAGE_RECORD', reference: image.id,
    });
  });
  it('RECON-10: rejects malformed and noncanonical base64 bytes', async () => {
    const image = await save();
    const file = path.join(images, image.id + '.json');
    const original = JSON.parse(await readFile(file, 'utf8'));
    original.base64 = original.base64.replace(/=+$/, '') + '?';
    await writeFile(file, JSON.stringify(original));
    const result = await inspect([auditFor(image)]);
    expect(result.findings).toContainEqual({
      code: 'CORRUPT_IMAGE_RECORD', reference: image.id,
    });
  });
  it('RECON-11: a read audit alone never proves uploaded bytes were audited', async () => {
    const image = await save();
    const result = await inspect([{ ...auditFor(image), action: 'IMAGE_READ' }]);
    expect(result.findings).toContainEqual({
      code: 'ORPHAN_NO_UPLOAD_AUDIT', reference: image.id,
    });
    expect(result.examinedUploadAudits).toBe(0);
  });
  it('RECON-12: invalid or incomplete audit payloads fail closed', async () => {
    const image = await save();
    const event = auditFor(image);
    await expect(inspectSyntheticLocalImageAudit(images, {
      complete: true, events: [{ ...event, sha256: '../../file' }],
    })).rejects.toThrow('LOCAL_IMAGE_RECONCILE_INVALID_AUDIT_EVENT');
    await expect(inspectSyntheticLocalImageAudit(images, {
      complete: 'yes' as unknown as boolean, events: [],
    })).rejects.toThrow('LOCAL_IMAGE_RECONCILE_INVALID_AUDIT_SNAPSHOT');
  });
  it('RECON-13: disallows cloud staging and production, even inside test process', async () => {
    await save();
    for (const profile of ['cloud_staging', 'production']) {
      vi.stubEnv('ACM_DEPLOYMENT_PROFILE', profile);
      await expect(inspect([])).rejects.toThrow('LOCAL_IMAGE_RECONCILE_TEST_ONLY');
    }
  });
  it('RECON-14: rejects root and relative directory paths', async () => {
    await expect(inspectSyntheticLocalImageAudit('relative', { complete: true, events: [] }))
      .rejects.toThrow('LOCAL_IMAGE_RECONCILE_REQUIRES_ABSOLUTE_NONROOT_DIRECTORY');
    await expect(inspectSyntheticLocalImageAudit(path.parse(images).root, { complete: true, events: [] }))
      .rejects.toThrow('LOCAL_IMAGE_RECONCILE_REQUIRES_ABSOLUTE_NONROOT_DIRECTORY');
  });
  it('RECON-15: rejects symlink root ancestors and does not inspect target tree', async () => {
    const image = await save();
    const alias = path.join(sandbox, 'synthetic-link');
    await symlink(images, alias, 'dir');
    await expect(inspectSyntheticLocalImageAudit(alias, {
      complete: true, events: [auditFor(image)],
    })).rejects.toThrow('LOCAL_IMAGE_RECONCILE_UNSAFE_ROOT');
  });
});
