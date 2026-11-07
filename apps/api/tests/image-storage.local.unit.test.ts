import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { LocalOnlyDiskItemImageStorage } from '../src/modules/storage/image-storage.local';

const ITEM = '11111111-1111-4111-8111-111111111111';
const OTHER_ITEM = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]);

describe('L4 opt-in local image storage (ephemeral CI filesystem only)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'acm-l4-local-only-'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  const image = () => ({
    itemId: ITEM,
    uploadedById: ACTOR,
    originalName: 'test.png',
    mimeType: 'image/png' as const,
    contents: Uint8Array.from(PNG),
  });

  it('writes exactly one atomic record and can read after fresh instance starts', async () => {
    const first = new LocalOnlyDiskItemImageStorage(root);
    const record = await first.save(image());
    expect((await readdir(root))).toEqual([record.id + '.json']);
    const restarted = new LocalOnlyDiskItemImageStorage(root);
    expect((await restarted.readForItem(ITEM, record.id))?.contents).toEqual(PNG);
    expect((await restarted.readForItem(ITEM, record.id))?.metadata.sha256).toBe(record.sha256);
  });

  it('does not permit cross-item reading or deletion, even if image ID is known', async () => {
    const store = new LocalOnlyDiskItemImageStorage(root);
    const imageRecord = await store.save(image());
    expect(await store.readForItem(OTHER_ITEM, imageRecord.id)).toBeNull();
    expect(await store.deleteForItem(OTHER_ITEM, imageRecord.id)).toBe(false);
    expect(await store.readForItem(ITEM, imageRecord.id)).not.toBeNull();
  });

  it('refuses traversal IDs and does not touch files outside the root', async () => {
    const store = new LocalOnlyDiskItemImageStorage(root);
    expect(await store.readForItem(ITEM, '../../elsewhere')).toBeNull();
    expect(await store.deleteForItem(ITEM, '../../elsewhere')).toBe(false);
  });

  it('deletes its own image and returns missing on reload', async () => {
    const store = new LocalOnlyDiskItemImageStorage(root);
    const record = await store.save(image());
    expect(await store.deleteForItem(ITEM, record.id)).toBe(true);
    expect(await store.deleteForItem(ITEM, record.id)).toBe(false);
    expect(await store.readForItem(ITEM, record.id)).toBeNull();
  });

  it('does not leak mutable bytes to or from its caller', async () => {
    const store = new LocalOnlyDiskItemImageStorage(root);
    const input = image();
    const record = await store.save(input);
    input.contents[0] = 0;
    const read = await store.readForItem(ITEM, record.id);
    expect(read?.contents[0]).toBe(137);
    read!.contents[0] = 0;
    expect((await store.readForItem(ITEM, record.id))?.contents[0]).toBe(137);
  });

  it('rejects an altered record hash rather than silently serving corrupt images', async () => {
    const store = new LocalOnlyDiskItemImageStorage(root);
    const record = await store.save(image());
    const file = path.join(root, record.id + '.json');
    const stored = JSON.parse(await readFile(file, 'utf8'));
    stored.metadata.sha256 = '0'.repeat(64);
    await writeFile(file, JSON.stringify(stored), 'utf8');
    await expect(store.readForItem(ITEM, record.id))
      .rejects.toThrow('LOCAL_IMAGE_STORAGE_RECORD_INTEGRITY_MISMATCH');
  });

  it('does not follow a symlink planted in place of an image record', async () => {
    const store = new LocalOnlyDiskItemImageStorage(root);
    const record = await store.save(image());
    const file = path.join(root, record.id + '.json');
    const elsewhere = path.join(root, 'elsewhere.json');
    const contents = await readFile(file);
    await writeFile(elsewhere, contents);
    await rm(file);
    await symlink(elsewhere, file);
    await expect(store.readForItem(ITEM, record.id))
      .rejects.toThrow('LOCAL_IMAGE_STORAGE_UNSAFE_RECORD');
  });

  it('refuses a symlink as the storage root instead of writing to its target', async () => {
    const target = path.join(root, 'target');
    await mkdir(target);
    const alias = path.join(root, 'alias');
    await symlink(target, alias, 'dir');
    const store = new LocalOnlyDiskItemImageStorage(alias);
    await expect(store.save(image())).rejects.toThrow('LOCAL_IMAGE_STORAGE_UNSAFE_ROOT');
    expect(await readdir(target)).toEqual([]);
  });

  it('refuses a symlink in any ancestor before descending and creating folders', async () => {
    const target = path.join(root, 'original');
    await mkdir(target);
    const alias = path.join(root, 'alias');
    await symlink(target, alias, 'dir');
    const store = new LocalOnlyDiskItemImageStorage(path.join(alias, 'nested', 'images'));
    await expect(store.save(image())).rejects.toThrow('LOCAL_IMAGE_STORAGE_UNSAFE_ROOT');
    expect(await readdir(target)).toEqual([]);
  });

  it('refuses cloud staging even with test NODE_ENV', () => {
    vi.stubEnv('ACM_DEPLOYMENT_PROFILE', 'cloud_staging');
    expect(() => new LocalOnlyDiskItemImageStorage(root))
      .toThrow('LOCAL_IMAGE_STORAGE_DISABLED_BY_DEFAULT');
  });

  it('refuses relative and root directory paths', () => {
    expect(() => new LocalOnlyDiskItemImageStorage('relative/data'))
      .toThrow('LOCAL_IMAGE_STORAGE_REQUIRES_ABSOLUTE_NONROOT_DIRECTORY');
    expect(() => new LocalOnlyDiskItemImageStorage(path.parse(root).root))
      .toThrow('LOCAL_IMAGE_STORAGE_REQUIRES_ABSOLUTE_NONROOT_DIRECTORY');
  });

  it('rejects malformed image content before writing any bytes', async () => {
    const store = new LocalOnlyDiskItemImageStorage(root);
    await expect(store.save({ ...image(), contents: Uint8Array.from([0, 0, 0]) }))
      .rejects.toMatchObject({ statusCode: 422 });
    expect(await readdir(root)).toEqual([]);
  });
});
