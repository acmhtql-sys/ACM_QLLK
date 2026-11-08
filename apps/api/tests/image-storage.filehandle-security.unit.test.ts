import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { constants, promises as fs } from 'node:fs';
import { link, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalOnlyDiskItemImageStorage } from '../src/modules/storage/image-storage.local';

const ITEM = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const image = () => ({
  itemId: ITEM, uploadedById: ACTOR,
  originalName: 'fixture.png', mimeType: 'image/png' as const,
  contents: Uint8Array.from(PNG),
});

describe('L4 isolated local image: file-descriptor / NOFOLLOW regression', () => {
  let sandbox: string;
  let root: string;
  let storage: LocalOnlyDiskItemImageStorage;
  beforeEach(async () => {
    vi.stubEnv('ACM_DEPLOYMENT_PROFILE', 'local_dev');
    sandbox = await mkdtemp(path.join(tmpdir(), 'acm-l4-nofollow-'));
    root = path.join(sandbox, 'images');
    storage = new LocalOnlyDiskItemImageStorage(root);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(sandbox, { recursive: true, force: true });
  });

  it('FD-01: a saved image remains readable by its owning item', async () => {
    const saved = await storage.save(image());
    const read = await storage.readForItem(ITEM, saved.id);
    expect(read?.contents).toEqual(PNG);
    expect(read?.metadata.sha256).toBe(saved.sha256);
    expect(await storage.readForItem(OTHER, saved.id)).toBeNull();
  });

  it('FD-02: symlink replaced just before open is rejected, not followed', async () => {
    const saved = await storage.save(image());
    const file = path.join(root, saved.id + '.json');
    const outside = path.join(sandbox, 'external-copy.json');
    await writeFile(outside, await readFile(file));
    const realOpen = fs.open.bind(fs);
    let switched = false;
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (String(args[0]) === file) {
        expect((args[1] as number) & constants.O_NOFOLLOW).not.toBe(0);
        await rm(file);
        await symlink(outside, file);
        switched = true;
      }
      return realOpen(...args);
    });
    await expect(storage.readForItem(ITEM, saved.id))
      .rejects.toThrow('LOCAL_IMAGE_STORAGE_UNSAFE_RECORD');
    expect(switched).toBe(true);
    spy.mockRestore();
    expect((await readFile(outside)).length).toBeGreaterThan(0);
  });

  it('FD-03: symlink swapped after open does not redirect the already-open handle', async () => {
    const saved = await storage.save(image());
    const file = path.join(root, saved.id + '.json');
    const originalCopy = path.join(sandbox, 'saved-original.json');
    await writeFile(originalCopy, await readFile(file));
    const hostile = path.join(sandbox, 'hostile.json');
    await writeFile(hostile, 'not-image-json');
    const realOpen = fs.open.bind(fs);
    let swapped = false;
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      if (String(args[0]) === file) {
        await rename(file, originalCopy);
        await symlink(hostile, file);
        swapped = true;
      }
      return handle;
    });
    const read = await storage.readForItem(ITEM, saved.id);
    expect(swapped).toBe(true);
    expect(read?.contents).toEqual(PNG);
    spy.mockRestore();
    expect(await readFile(hostile, 'utf8')).toBe('not-image-json');
  });

  it('FD-04: hard-linked record is rejected even though it is a regular file', async () => {
    const saved = await storage.save(image());
    const file = path.join(root, saved.id + '.json');
    const linked = path.join(sandbox, 'extra-hard-link.json');
    await link(file, linked);
    await expect(storage.readForItem(ITEM, saved.id))
      .rejects.toThrow('LOCAL_IMAGE_STORAGE_UNSAFE_RECORD');
    expect((await readFile(linked)).byteLength).toBeGreaterThan(0);
  });

  it('FD-05: non-base64 characters are not silently decoded', async () => {
    const saved = await storage.save(image());
    const file = path.join(root, saved.id + '.json');
    const record = JSON.parse(await readFile(file, 'utf8'));
    record.base64 += '@@';
    await writeFile(file, JSON.stringify(record), 'utf8');
    await expect(storage.readForItem(ITEM, saved.id))
      .rejects.toThrow('LOCAL_IMAGE_STORAGE_NONCANONICAL_BASE64');
  });

  it('FD-06: missing required base64 padding is rejected', async () => {
    const saved = await storage.save(image());
    const file = path.join(root, saved.id + '.json');
    const record = JSON.parse(await readFile(file, 'utf8'));
    expect(record.base64).toMatch(/=$/);
    record.base64 = record.base64.replace(/=+$/, '');
    await writeFile(file, JSON.stringify(record), 'utf8');
    await expect(storage.readForItem(ITEM, saved.id))
      .rejects.toThrow('LOCAL_IMAGE_STORAGE_NONCANONICAL_BASE64');
  });

  it('FD-07: zero-byte image record is not accepted', async () => {
    const saved = await storage.save(image());
    await writeFile(path.join(root, saved.id + '.json'), '');
    await expect(storage.readForItem(ITEM, saved.id))
      .rejects.toThrow('LOCAL_IMAGE_STORAGE_UNSAFE_RECORD');
  });

  it('FD-08: a symlinked image cannot be deleted through item-scoped cleanup', async () => {
    const saved = await storage.save(image());
    const file = path.join(root, saved.id + '.json');
    const elsewhere = path.join(sandbox, 'no-delete.json');
    await writeFile(elsewhere, await readFile(file));
    await rm(file);
    await symlink(elsewhere, file);
    await expect(storage.deleteForItem(ITEM, saved.id))
      .rejects.toThrow('LOCAL_IMAGE_STORAGE_UNSAFE_RECORD');
    expect(await readdir(sandbox)).toContain('no-delete.json');
  });
});
