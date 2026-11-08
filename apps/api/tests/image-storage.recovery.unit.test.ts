/**
 * L4 synthetic backup/restore rehearsal. All paths live inside a fresh OS
 * temporary directory; no real ACM files, DB, network, or cloud are accessed.
 * This proves a *test fixture* survives backup, delete, restart and restore;
 * it is NOT a production RPO/RTO, Windows ACL or durable-storage signoff.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { LocalOnlyDiskItemImageStorage } from '../src/modules/storage/image-storage.local';

const ITEM_A = '11111111-1111-4111-8111-111111111111';
const ITEM_B = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 5, 6]);

const image = (itemId: string, kind: 'png' | 'jpeg') => ({
  itemId,
  uploadedById: ACTOR,
  originalName: kind === 'png' ? 'synthetic.png' : 'synthetic.jpg',
  mimeType: (kind === 'png' ? 'image/png' : 'image/jpeg') as 'image/png' | 'image/jpeg',
  contents: Uint8Array.from(kind === 'png' ? PNG : JPEG),
});

describe('L4 synthetic local image backup/restore drill (not a production acceptance)', () => {
  let sandbox: string;
  let primary: string;
  let backup: string;
  let restored: string;

  beforeEach(async () => {
    vi.stubEnv('ACM_DEPLOYMENT_PROFILE', 'local_dev');
    sandbox = await mkdtemp(path.join(tmpdir(), 'acm-l4-restore-'));
    primary = path.join(sandbox, 'primary');
    backup = path.join(sandbox, 'backup');
    restored = path.join(sandbox, 'restored');
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(sandbox, { recursive: true, force: true });
  });

  it('recovers two distinct items and immutable hashes after simulated loss of source', async () => {
    const writer = new LocalOnlyDiskItemImageStorage(primary);
    const a = await writer.save(image(ITEM_A, 'png'));
    const b = await writer.save(image(ITEM_B, 'jpeg'));
    await cp(primary, backup, { recursive: true, errorOnExist: true, force: false });
    const backupNames = (await readdir(backup)).sort();
    expect(backupNames).toEqual([a.id + '.json', b.id + '.json'].sort());

    // Remove only the synthetic primary tree to emulate a fixture loss.
    await rm(primary, { recursive: true, force: true });
    await cp(backup, restored, { recursive: true, errorOnExist: true, force: false });

    const reader = new LocalOnlyDiskItemImageStorage(restored);
    const readA = await reader.readForItem(ITEM_A, a.id);
    const readB = await reader.readForItem(ITEM_B, b.id);
    expect(readA?.contents).toEqual(PNG);
    expect(readB?.contents).toEqual(JPEG);
    expect(readA?.metadata.sha256).toBe(createHash('sha256').update(PNG).digest('hex'));
    expect(readB?.metadata.sha256).toBe(createHash('sha256').update(JPEG).digest('hex'));
    expect(await reader.readForItem(ITEM_A, b.id)).toBeNull();
    expect(await reader.readForItem(ITEM_B, a.id)).toBeNull();
  });

  it('does not accept a manipulated backup with a forged content checksum', async () => {
    const saved = await new LocalOnlyDiskItemImageStorage(primary).save(image(ITEM_A, 'png'));
    await cp(primary, backup, { recursive: true });
    const file = path.join(backup, saved.id + '.json');
    const record = JSON.parse(await readFile(file, 'utf8'));
    record.metadata.sha256 = '0'.repeat(64);
    await writeFile(file, JSON.stringify(record), 'utf8');

    const reader = new LocalOnlyDiskItemImageStorage(backup);
    await expect(reader.readForItem(ITEM_A, saved.id))
      .rejects.toThrow('LOCAL_IMAGE_STORAGE_RECORD_INTEGRITY_MISMATCH');
  });

  it('fails closed when an expected image is absent in restored snapshot', async () => {
    const saved = await new LocalOnlyDiskItemImageStorage(primary).save(image(ITEM_A, 'png'));
    await cp(primary, backup, { recursive: true });
    await rm(path.join(backup, saved.id + '.json'));
    expect(await new LocalOnlyDiskItemImageStorage(backup).readForItem(ITEM_A, saved.id))
      .toBeNull();
  });

  it('does not let a wrong item delete recovered data after restart', async () => {
    const saved = await new LocalOnlyDiskItemImageStorage(primary).save(image(ITEM_A, 'png'));
    await cp(primary, backup, { recursive: true });
    const reader = new LocalOnlyDiskItemImageStorage(backup);
    expect(await reader.deleteForItem(ITEM_B, saved.id)).toBe(false);
    expect((await reader.readForItem(ITEM_A, saved.id))?.contents).toEqual(PNG);
  });

  it('preserves source snapshot bytes when a restored copy is mutated', async () => {
    const saved = await new LocalOnlyDiskItemImageStorage(primary).save(image(ITEM_A, 'png'));
    await cp(primary, backup, { recursive: true });
    await cp(backup, restored, { recursive: true });
    const file = path.join(restored, saved.id + '.json');
    await writeFile(file, 'broken-json', 'utf8');
    await expect(new LocalOnlyDiskItemImageStorage(restored).readForItem(ITEM_A, saved.id))
      .rejects.toThrow();
    expect((await new LocalOnlyDiskItemImageStorage(backup).readForItem(ITEM_A, saved.id))?.contents)
      .toEqual(PNG);
  });

  it('refuses recovery access when deployment profile is cloud staging', async () => {
    const saved = await new LocalOnlyDiskItemImageStorage(primary).save(image(ITEM_A, 'png'));
    await cp(primary, backup, { recursive: true });
    vi.stubEnv('ACM_DEPLOYMENT_PROFILE', 'cloud_staging');
    expect(() => new LocalOnlyDiskItemImageStorage(backup))
      .toThrow('LOCAL_IMAGE_STORAGE_DISABLED_BY_DEFAULT');
    // Assert a real fixture was backed up rather than only a constructor guard.
    expect((await readdir(backup))).toContain(saved.id + '.json');
  });
});
