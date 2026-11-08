import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { TestOnlyImageAuditBundle } from '../src/modules/storage/image-storage.atomic-bundle.testonly';
import type { ItemImageUpload } from '../src/modules/storage/image-storage.contract';

const ITEM = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const CLAIM = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

describe('L4 TEST-ONLY single-file image+metadata+audit publication', () => {
  let parent: string;
  let root: string;
  beforeEach(async () => {
    vi.stubEnv('ACM_DEPLOYMENT_PROFILE', 'local_dev');
    parent = await mkdtemp(path.join(tmpdir(), 'acm-atomic-bundle-fixture-'));
    root = path.join(parent, 'bundles');
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(parent, { recursive: true, force: true });
  });
  const upload = (changes: Partial<ItemImageUpload> = {}): ItemImageUpload => ({
    itemId: ITEM, uploadedById: ACTOR, originalName: 'fixture.png',
    mimeType: 'image/png', contents: Uint8Array.from(PNG), ...changes,
  });
  const store = () => new TestOnlyImageAuditBundle(root);

  it('BUNDLE-01: published record has image, metadata and matching upload audit together', async () => {
    const result = await store().publish(CLAIM, upload());
    expect(result.id).toBe(CLAIM);
    expect(result.itemId).toBe(ITEM);
    const read = await store().read(CLAIM);
    expect(read).not.toBeNull();
    expect(read!.image.metadata).toEqual(result);
    expect(read!.image.contents).toEqual(PNG);
    expect(read!.audit).toEqual({
      action: 'IMAGE_UPLOAD', actorId: ACTOR, itemId: ITEM,
      imageId: CLAIM, sha256: result.sha256,
      byteLength: PNG.length, recordedAt: result.createdAt,
    });
    const files = await readdir(root);
    expect(files).toEqual([CLAIM + '.json']);
    expect(await store().inspect()).toEqual({
      status: 'CLEAN_FIXTURE', published: 1, anomalies: [],
    });
  });

  it('BUNDLE-02: same claim and same payload replays immutable prior receipt', async () => {
    const a = await store().publish(CLAIM, upload());
    const b = await store().publish(CLAIM, upload());
    expect(b).toEqual(a);
    expect(await readdir(root)).toEqual([CLAIM + '.json']);
  });

  it('BUNDLE-03: same claim with different payload cannot overwrite existing record', async () => {
    const original = await store().publish(CLAIM, upload());
    await expect(store().publish(CLAIM, upload({ originalName: 'different.png' })))
      .rejects.toThrow('IMAGE_AUDIT_BUNDLE_CLAIM_CONFLICT');
    expect((await store().read(CLAIM))!.image.metadata).toEqual(original);
    expect(await readdir(root)).toEqual([CLAIM + '.json']);
  });

  it('BUNDLE-04: identical concurrent publishes result in one final immutable claim', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () =>
      store().publish(CLAIM, upload())));
    expect(results.every(r => r.id === CLAIM)).toBe(true);
    expect(new Set(results.map(r => r.createdAt)).size).toBe(1);
    expect(await readdir(root)).toEqual([CLAIM + '.json']);
  });

  it('BUNDLE-05: conflicting concurrent claims cannot both publish different bytes', async () => {
    const results = await Promise.allSettled([
      store().publish(CLAIM, upload()),
      store().publish(CLAIM, upload({ originalName: 'other.png' })),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    const report = await store().inspect();
    expect(report.status).toBe('CLEAN_FIXTURE');
    expect(report.published).toBe(1);
  });

  it('BUNDLE-06: interrupted pending write cannot appear as a published record', async () => {
    const candidate = new TestOnlyImageAuditBundle(root, {
      afterPendingSync: async () => { throw new Error('SYNTHETIC_STOP_BEFORE_PUBLISH'); },
    });
    await expect(candidate.publish(CLAIM, upload()))
      .rejects.toThrow('SYNTHETIC_STOP_BEFORE_PUBLISH');
    expect(await store().read(CLAIM)).toBeNull();
    const report = await store().inspect();
    expect(report.status).toBe('REVIEW_REQUIRED');
    expect(report.published).toBe(0);
    expect(report.anomalies.some(f => f.code === 'PENDING')).toBe(true);
    expect((await readdir(root)).some(f => f.endsWith('.pending'))).toBe(true);
  });

  it('BUNDLE-07: after publication but before ack, retry finds same record', async () => {
    const candidate = new TestOnlyImageAuditBundle(root, {
      afterPublished: async () => { throw new Error('SYNTHETIC_LOST_ACK'); },
    });
    await expect(candidate.publish(CLAIM, upload()))
      .rejects.toThrow('SYNTHETIC_LOST_ACK');
    const earlier = (await store().read(CLAIM))!.image.metadata;
    const replay = await store().publish(CLAIM, upload());
    expect(replay).toEqual(earlier);
    const report = await store().inspect();
    expect(report.published).toBe(1);
    expect(report.status).toBe('REVIEW_REQUIRED'); // leftover pending -> operator review
    expect(report.anomalies.some(f => f.code === 'PENDING')).toBe(true);
  });

  it('BUNDLE-08: same claim rejected after ambiguous ack if actor or item changes', async () => {
    const candidate = new TestOnlyImageAuditBundle(root, {
      afterPublished: async () => { throw new Error('SYNTHETIC_LOST_ACK'); },
    });
    await expect(candidate.publish(CLAIM, upload())).rejects.toThrow();
    for (const changed of [{ uploadedById: OTHER }, { itemId: OTHER }]) {
      await expect(store().publish(CLAIM, upload(changed)))
        .rejects.toThrow('IMAGE_AUDIT_BUNDLE_CLAIM_CONFLICT');
    }
  });

  it('BUNDLE-09: tampering stored image hash or bytes is rejected, not repaired', async () => {
    await store().publish(CLAIM, upload());
    const filename = path.join(root, CLAIM + '.json');
    const record = JSON.parse(await readFile(filename, 'utf8'));
    record.metadata.sha256 = '0'.repeat(64);
    await writeFile(filename, JSON.stringify(record));
    await expect(store().read(CLAIM)).rejects.toThrow();
    expect((await store().inspect()).anomalies).toContainEqual({
      code: 'CORRUPT', reference: CLAIM + '.json',
    });
  });

  it('BUNDLE-10: audit actor, image ID or checksum mismatch invalidates entire record', async () => {
    await store().publish(CLAIM, upload());
    const file = path.join(root, CLAIM + '.json');
    const original = await readFile(file, 'utf8');
    for (const modify of [
      (x: { uploadAudit: { actorId: string; imageId: string }; checksum: string }) => { x.uploadAudit.actorId = OTHER; },
      (x: { uploadAudit: { actorId: string; imageId: string }; checksum: string }) => { x.uploadAudit.imageId = OTHER; },
      (x: { uploadAudit: { actorId: string; imageId: string }; checksum: string }) => { x.checksum = '0'.repeat(64); },
    ]) {
      const obj = JSON.parse(original);
      modify(obj);
      await writeFile(file, JSON.stringify(obj));
      await expect(store().read(CLAIM)).rejects.toThrow();
    }
  });

  it('BUNDLE-11: invalid base64 is rejected and not returned', async () => {
    await store().publish(CLAIM, upload());
    const file = path.join(root, CLAIM + '.json');
    const obj = JSON.parse(await readFile(file, 'utf8'));
    obj.base64 += '?';
    await writeFile(file, JSON.stringify(obj));
    await expect(store().read(CLAIM)).rejects.toThrow(
      'IMAGE_AUDIT_BUNDLE_INVALID_BASE64');
  });

  it('BUNDLE-12: unexpected files and symlinks are reported without cleanup', async () => {
    await store().publish(CLAIM, upload());
    await writeFile(path.join(root, 'extra.txt'), 'untrusted');
    await symlink(path.join(root, CLAIM + '.json'), path.join(root, 'alias.json'));
    const result = await store().inspect();
    expect(result.anomalies).toContainEqual({ code: 'UNKNOWN', reference: 'extra.txt' });
    expect(result.anomalies).toContainEqual({ code: 'UNSAFE', reference: 'alias.json' });
    expect((await readdir(root))).toHaveLength(3);
  });

  it('BUNDLE-13: symlink root is denied before access', async () => {
    await store().publish(CLAIM, upload());
    const alias = path.join(parent, 'bundle-link');
    await symlink(root, alias, 'dir');
    const alternate = new TestOnlyImageAuditBundle(alias);
    await expect(alternate.read(CLAIM)).rejects.toThrow(
      'IMAGE_AUDIT_BUNDLE_UNSAFE_DIRECTORY');
    await expect(alternate.publish(OTHER, upload())).rejects.toThrow(
      'IMAGE_AUDIT_BUNDLE_UNSAFE_DIRECTORY');
  });

  it('BUNDLE-14: invalid claim or malformed MIME/metadata cannot be published', async () => {
    await expect(store().publish('not-uuid', upload())).rejects.toThrow(
      'IMAGE_AUDIT_BUNDLE_INVALID_CLAIM');
    await expect(store().publish(CLAIM, upload({ mimeType: 'image/jpeg' })))
      .rejects.toThrow();
    await expect(store().publish(CLAIM, upload({ originalName: '../bad.png' })))
      .rejects.toThrow();
    await expect(readdir(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('BUNDLE-15: restricted to NODE_ENV=test and not cloud/prod profiles', async () => {
    for (const profile of ['cloud_staging', 'production']) {
      vi.stubEnv('ACM_DEPLOYMENT_PROFILE', profile);
      expect(() => store()).toThrow('IMAGE_AUDIT_BUNDLE_TEST_ONLY');
    }
    vi.stubEnv('ACM_DEPLOYMENT_PROFILE', 'local_dev');
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => store()).toThrow('IMAGE_AUDIT_BUNDLE_TEST_ONLY');
  });

  it('BUNDLE-16: relative or filesystem root paths cannot be used', () => {
    expect(() => new TestOnlyImageAuditBundle('relative')).toThrow(
      'IMAGE_AUDIT_BUNDLE_ABSOLUTE_NONROOT_REQUIRED');
    expect(() => new TestOnlyImageAuditBundle(path.parse(parent).root)).toThrow(
      'IMAGE_AUDIT_BUNDLE_ABSOLUTE_NONROOT_REQUIRED');
  });

  it('BUNDLE-17: unknown yet valid claim has no published image', async () => {
    await store().publish(CLAIM, upload());
    expect(await store().read(OTHER)).toBeNull();
    expect((await store().inspect()).published).toBe(1);
  });
});
