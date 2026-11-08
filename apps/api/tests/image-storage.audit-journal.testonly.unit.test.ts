import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { TestOnlyFileImageAuditJournal } from '../src/modules/storage/image-storage.audit-journal.testonly';
import { LocalOnlyDiskItemImageStorage } from '../src/modules/storage/image-storage.local';
import { inspectSyntheticLocalImageAudit } from '../src/modules/storage/image-storage.orphan-reconcile.review';
import type { ItemImageAuditEvent } from '../src/modules/storage/image-storage.audit.contract';
import type { StoredItemImage } from '../src/modules/storage/image-storage.contract';

const ITEM = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

describe('L4 TEST-ONLY fsynced audit journal (NOT production durability)', () => {
  let parent: string;
  let imageRoot: string;
  let journalRoot: string;
  let storage: LocalOnlyDiskItemImageStorage;

  beforeEach(async () => {
    vi.stubEnv('ACM_DEPLOYMENT_PROFILE', 'local_dev');
    parent = await mkdtemp(path.join(tmpdir(), 'acm-audit-fixture-'));
    imageRoot = path.join(parent, 'images');
    journalRoot = path.join(parent, 'journal');
    storage = new LocalOnlyDiskItemImageStorage(imageRoot);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(parent, { recursive: true, force: true });
  });
  const image = async (): Promise<StoredItemImage> => storage.save({
    itemId: ITEM, uploadedById: ACTOR, originalName: 'synthetic.png',
    mimeType: 'image/png', contents: Uint8Array.from(PNG),
  });
  const eventFor = (saved: StoredItemImage): ItemImageAuditEvent => ({
    action: 'IMAGE_UPLOAD', actorId: saved.uploadedById,
    itemId: saved.itemId, imageId: saved.id,
    sha256: saved.sha256, byteLength: saved.byteLength,
    recordedAt: saved.createdAt,
  });
  const journal = () => new TestOnlyFileImageAuditJournal(journalRoot);

  it('JOURNAL-01: fsynced upload audit reloads after a fresh journal instance', async () => {
    const saved = await image();
    await journal().record(eventFor(saved));
    const result = await journal().readForReview();
    expect(result.findings).toEqual([]);
    expect(result.snapshot).toEqual({ complete: true, events: [eventFor(saved)] });
    const reconciled = await inspectSyntheticLocalImageAudit(imageRoot, result.snapshot);
    expect(reconciled.status).toBe('CLEAN');
    expect(reconciled.scannedImages).toBe(1);
  });

  it('JOURNAL-02: without a matching audit, image remains an orphan for review', async () => {
    const saved = await image();
    const other = await image();
    await journal().record(eventFor(other));
    const evidence = await journal().readForReview();
    const report = await inspectSyntheticLocalImageAudit(imageRoot, evidence.snapshot);
    expect(report.status).toBe('REVIEW_REQUIRED');
    expect(report.findings).toContainEqual({
      code: 'ORPHAN_NO_UPLOAD_AUDIT', reference: saved.id,
    });
    expect((await storage.readForItem(ITEM, saved.id))?.contents).toEqual(PNG);
  });

  it('JOURNAL-03: separate IMAGE_READ audit never proves upload provenance', async () => {
    const saved = await image();
    await journal().record({ ...eventFor(saved), action: 'IMAGE_READ' });
    const evidence = await journal().readForReview();
    expect(evidence.snapshot.events).toHaveLength(1);
    const report = await inspectSyntheticLocalImageAudit(imageRoot, evidence.snapshot);
    expect(report.findings).toContainEqual({
      code: 'ORPHAN_NO_UPLOAD_AUDIT', reference: saved.id,
    });
  });

  it('JOURNAL-04: interruption after fsync and before rename leaves pending evidence', async () => {
    const saved = await image();
    const interrupted = new TestOnlyFileImageAuditJournal(journalRoot, async () => {
      throw new Error('SYNTHETIC_CRASH_AFTER_SYNC');
    });
    await expect(interrupted.record(eventFor(saved)))
      .rejects.toThrow('SYNTHETIC_CRASH_AFTER_SYNC');
    expect((await readdir(journalRoot)).some(f => f.endsWith('.pending'))).toBe(true);
    const evidence = await journal().readForReview();
    expect(evidence.snapshot.complete).toBe(false);
    expect(evidence.findings.some(f => f.code === 'PENDING_EVENT')).toBe(true);
    const report = await inspectSyntheticLocalImageAudit(imageRoot, evidence.snapshot);
    expect(report.status).toBe('EVIDENCE_INCOMPLETE');
    expect(report.findings).toContainEqual({
      code: 'ORPHAN_NO_UPLOAD_AUDIT', reference: saved.id,
    });
  });

  it('JOURNAL-05: tampering event SHA is detected without repairing the file', async () => {
    const saved = await image();
    await journal().record(eventFor(saved));
    const name = (await readdir(journalRoot))[0];
    const record = JSON.parse(await readFile(path.join(journalRoot, name), 'utf8'));
    record.event.sha256 = '0'.repeat(64);
    await writeFile(path.join(journalRoot, name), JSON.stringify(record));
    const evidence = await journal().readForReview();
    expect(evidence.snapshot.complete).toBe(false);
    expect(evidence.findings).toContainEqual({ code: 'CORRUPT_EVENT', reference: name });
    expect(await readFile(path.join(journalRoot, name), 'utf8')).toContain('0'.repeat(64));
  });

  it('JOURNAL-06: malformed JSON is incomplete, never silently ignored', async () => {
    const saved = await image();
    await journal().record(eventFor(saved));
    const name = (await readdir(journalRoot))[0];
    await writeFile(path.join(journalRoot, name), '{invalid');
    expect((await journal().readForReview()).findings)
      .toContainEqual({ code: 'CORRUPT_EVENT', reference: name });
  });

  it('JOURNAL-07: extra sensitive fields cannot be stored in an audit event', async () => {
    const saved = await image();
    const malicious = { ...eventFor(saved), authorization: 'Bearer should-not-write' };
    await expect(journal().record(malicious)).rejects.toThrow(
      'LOCAL_AUDIT_JOURNAL_INVALID_EVENT',
    );
    await expect(readdir(journalRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('JOURNAL-08: malformed identity/digest/quantity/time rejected before writing', async () => {
    const saved = await image();
    for (const changes of [
      { actorId: 'bad' }, { itemId: '../../file' }, { imageId: 'bad' },
      { sha256: '??' }, { byteLength: 0 }, { byteLength: 1.5 },
      { recordedAt: 'not-an-iso-date' },
    ]) {
      await expect(journal().record({ ...eventFor(saved), ...changes }))
        .rejects.toThrow('LOCAL_AUDIT_JOURNAL_INVALID_EVENT');
    }
    await expect(readdir(journalRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('JOURNAL-09: multiple unique audit files are readable without overwriting earlier events', async () => {
    const saved = await image();
    await Promise.all(Array.from({ length: 9 }, (_, index) =>
      journal().record({ ...eventFor(saved), recordedAt:
        new Date(Date.parse(saved.createdAt) + index * 1000).toISOString() })
    ));
    const evidence = await journal().readForReview();
    expect(evidence.snapshot.complete).toBe(true);
    expect(evidence.snapshot.events).toHaveLength(9);
    expect((await readdir(journalRoot))).toHaveLength(9);
    // A file journal is NOT automatically an exactly-once audit ledger.
    const report = await inspectSyntheticLocalImageAudit(imageRoot, evidence.snapshot);
    expect(report.findings).toContainEqual({
      code: 'DUPLICATE_UPLOAD_AUDIT', reference: saved.id,
    });
  });

  it('JOURNAL-10: unknown entry and symlink are marked incomplete without traversal', async () => {
    const saved = await image();
    await journal().record(eventFor(saved));
    await writeFile(path.join(journalRoot, 'README.txt'), 'unexpected');
    await symlink(path.join(journalRoot, 'README.txt'), path.join(journalRoot, 'alias.json'));
    const evidence = await journal().readForReview();
    expect(evidence.snapshot.complete).toBe(false);
    expect(evidence.findings).toContainEqual({
      code: 'UNKNOWN_ENTRY', reference: 'README.txt',
    });
    expect(evidence.findings).toContainEqual({
      code: 'UNSAFE_ENTRY', reference: 'alias.json',
    });
  });

  it('JOURNAL-11: rejects a symlink root and does not write into the target', async () => {
    const first = await image();
    await journal().record(eventFor(first));
    const alias = path.join(parent, 'alias');
    await symlink(journalRoot, alias, 'dir');
    const alternate = new TestOnlyFileImageAuditJournal(alias);
    const saved = await image();
    await expect(alternate.record(eventFor(saved)))
      .rejects.toThrow('LOCAL_AUDIT_JOURNAL_UNSAFE_DIRECTORY');
    expect((await readdir(journalRoot))).toHaveLength(1);
  });

  it('JOURNAL-12: journal is never allowed in cloud staging or production', async () => {
    for (const profile of ['cloud_staging', 'production']) {
      vi.stubEnv('ACM_DEPLOYMENT_PROFILE', profile);
      expect(() => journal()).toThrow('LOCAL_AUDIT_JOURNAL_TEST_ONLY');
    }
  });

  it('JOURNAL-13: journal rejects development mode even with local flags enabled', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ACM_LOCAL_IMAGE_STORAGE_ENABLED', 'true');
    expect(() => journal()).toThrow('LOCAL_AUDIT_JOURNAL_TEST_ONLY');
  });

  it('JOURNAL-14: relative filesystem paths and disk root are prohibited', () => {
    expect(() => new TestOnlyFileImageAuditJournal('relative'))
      .toThrow('LOCAL_AUDIT_JOURNAL_REQUIRES_ABSOLUTE_NONROOT');
    expect(() => new TestOnlyFileImageAuditJournal(path.parse(parent).root))
      .toThrow('LOCAL_AUDIT_JOURNAL_REQUIRES_ABSOLUTE_NONROOT');
  });

  it('JOURNAL-15: an uninitialized journal cannot be presented as complete evidence', async () => {
    await expect(journal().readForReview()).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('JOURNAL-16: stored audit data includes only approved fields and digest', async () => {
    const saved = await image();
    await journal().record(eventFor(saved));
    const name = (await readdir(journalRoot))[0];
    const text = await readFile(path.join(journalRoot, name), 'utf8');
    const stored = JSON.parse(text);
    expect(Object.keys(stored).sort()).toEqual(['checksum', 'event', 'id', 'version']);
    expect(Object.keys(stored.event).sort()).toEqual(
      ['action', 'actorId', 'byteLength', 'imageId', 'itemId', 'recordedAt', 'sha256'],
    );
    expect(text).not.toContain('synthetic.png');
    expect(text).not.toContain('Bearer');
    expect(text).not.toContain('contents');
  });
});
