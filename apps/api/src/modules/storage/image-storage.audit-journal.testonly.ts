/**
 * L4 TEST-ONLY on-disk audit journal fixture. NEVER instantiate in a server.
 *
 * File data is fsync'd before same-directory rename. This simulates a
 * restart/replay scenario, NOT actual power-loss durability, append-only
 * authentication, atomic cross-resource commit, or a production audit sink.
 * No file is automatically deleted or repaired, including pending writes.
 */
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ItemImageAuditEvent, ItemImageAuditSink } from './image-storage.audit.contract';
import type { ImageReconciliationSnapshot } from './image-storage.orphan-reconcile.review';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_EVENT_BYTES = 4096;
const EVENT_FIELDS = 'action,actorId,byteLength,imageId,itemId,recordedAt,sha256';

export type JournalFindingCode =
  'PENDING_EVENT' | 'CORRUPT_EVENT' | 'UNKNOWN_ENTRY' | 'UNSAFE_ENTRY';
export interface JournalFinding {
  code: JournalFindingCode;
  /** A local basename only; never source filename, authorization or content. */
  reference: string;
}
export interface TestOnlyJournalReview {
  snapshot: ImageReconciliationSnapshot;
  findings: readonly JournalFinding[];
}

interface StoredEvent {
  version: 1;
  id: string;
  event: ItemImageAuditEvent;
  checksum: string;
}

function requireSyntheticTestMode(): void {
  if (process.env.NODE_ENV !== 'test' ||
      ['cloud_staging', 'production'].includes(process.env.ACM_DEPLOYMENT_PROFILE || '')) {
    throw new Error('LOCAL_AUDIT_JOURNAL_TEST_ONLY');
  }
}
function absoluteNonRoot(directory: string): string {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new Error('LOCAL_AUDIT_JOURNAL_REQUIRES_ABSOLUTE_NONROOT');
  }
  const root = path.resolve(directory);
  if (root === path.parse(root).root) {
    throw new Error('LOCAL_AUDIT_JOURNAL_REQUIRES_ABSOLUTE_NONROOT');
  }
  return root;
}
async function safeDirectory(directory: string, create: boolean): Promise<void> {
  const parsed = path.parse(directory);
  let cursor = parsed.root;
  for (const part of directory.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (create) {
      try {
        await fs.mkdir(cursor, { mode: 0o700 });
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    const stat = await fs.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('LOCAL_AUDIT_JOURNAL_UNSAFE_DIRECTORY');
    }
  }
}
function validateEvent(event: ItemImageAuditEvent): void {
  if (!event || typeof event !== 'object' ||
      Object.keys(event).sort().join(',') !== EVENT_FIELDS ||
      !['IMAGE_UPLOAD', 'IMAGE_READ'].includes(event.action) ||
      typeof event.actorId !== 'string' || !UUID.test(event.actorId) ||
      typeof event.itemId !== 'string' || !UUID.test(event.itemId) ||
      typeof event.imageId !== 'string' || !UUID.test(event.imageId) ||
      typeof event.sha256 !== 'string' || !SHA256.test(event.sha256) ||
      !Number.isSafeInteger(event.byteLength) || event.byteLength <= 0 ||
      typeof event.recordedAt !== 'string' ||
      !Number.isFinite(Date.parse(event.recordedAt))) {
    throw new Error('LOCAL_AUDIT_JOURNAL_INVALID_EVENT');
  }
}
function payloadDigest(version: 1, id: string, event: ItemImageAuditEvent): string {
  return createHash('sha256').update(JSON.stringify({ version, id, event })).digest('hex');
}
function copyEvent(event: ItemImageAuditEvent): ItemImageAuditEvent {
  return {
    action: event.action, actorId: event.actorId.toLowerCase(),
    itemId: event.itemId.toLowerCase(), imageId: event.imageId.toLowerCase(),
    sha256: event.sha256, byteLength: event.byteLength, recordedAt: event.recordedAt,
  };
}

/**
 * Test failure hook runs after the pending file has been fsync'd and closed,
 * but before rename publishes the event. It never writes real data.
 */
export class TestOnlyFileImageAuditJournal implements ItemImageAuditSink {
  private readonly root: string;
  constructor(rootDirectory: string, private readonly afterFileSync?: () => Promise<void>) {
    requireSyntheticTestMode();
    this.root = absoluteNonRoot(rootDirectory);
  }

  async record(event: Readonly<ItemImageAuditEvent>): Promise<void> {
    requireSyntheticTestMode();
    validateEvent(event);
    await safeDirectory(this.root, true);
    const id = randomUUID();
    const stored: StoredEvent = {
      version: 1, id, event: copyEvent(event),
      checksum: payloadDigest(1, id, copyEvent(event)),
    };
    const serialized = JSON.stringify(stored);
    if (Buffer.byteLength(serialized) > MAX_EVENT_BYTES) {
      throw new Error('LOCAL_AUDIT_JOURNAL_RECORD_TOO_LARGE');
    }
    const pending = path.join(this.root, id + '.pending');
    const published = path.join(this.root, id + '.json');
    const handle = await fs.open(pending, 'wx', 0o600);
    try {
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Intentionally preserve the .pending record if publication fails.
    // The read-only inspector must flag it and require operator review.
    if (this.afterFileSync) await this.afterFileSync();
    await fs.rename(pending, published);
  }

  async readForReview(): Promise<TestOnlyJournalReview> {
    requireSyntheticTestMode();
    await safeDirectory(this.root, false);
    const events: ItemImageAuditEvent[] = [];
    const findings: JournalFinding[] = [];
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || !entry.isFile()) {
        findings.push({ code: 'UNSAFE_ENTRY', reference: entry.name });
        continue;
      }
      if (entry.name.endsWith('.pending')) {
        findings.push({ code: 'PENDING_EVENT', reference: entry.name });
        continue;
      }
      const matched = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i.exec(entry.name);
      if (!matched) {
        findings.push({ code: 'UNKNOWN_ENTRY', reference: entry.name });
        continue;
      }
      try {
        const filename = path.join(this.root, entry.name);
        const stat = await fs.lstat(filename);
        if (!stat.isFile() || stat.isSymbolicLink() ||
            stat.size <= 0 || stat.size > MAX_EVENT_BYTES) {
          throw new Error('UNSAFE_EVENT');
        }
        const raw = JSON.parse(await fs.readFile(filename, 'utf8')) as StoredEvent;
        if (!raw || raw.version !== 1 ||
            raw.id?.toLowerCase() !== matched[1].toLowerCase() ||
            typeof raw.checksum !== 'string' || !SHA256.test(raw.checksum)) {
          throw new Error('INVALID_EVENT_RECORD');
        }
        validateEvent(raw.event);
        if (payloadDigest(raw.version, raw.id, raw.event) !== raw.checksum) {
          throw new Error('EVENT_CHECKSUM_MISMATCH');
        }
        events.push(copyEvent(raw.event));
      } catch {
        findings.push({ code: 'CORRUPT_EVENT', reference: entry.name });
      }
    }
    findings.sort((a, b) => a.reference.localeCompare(b.reference) || a.code.localeCompare(b.code));
    return {
      snapshot: { complete: findings.length === 0, events },
      findings,
    };
  }
}
