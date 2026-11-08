/**
 * L4 TEST ONLY: single-file image+metadata+upload-audit publication proof.
 * NOT compatible with the live API/storage provider and NEVER mounted.
 *
 * The synced pending record is published using a no-overwrite filesystem
 * hard-link, so concurrent *synthetic* calls cannot replace the same claim.
 * This is NOT a database transaction, authenticated audit, or verified
 * power-loss durable commit (directory metadata may not be fsynced).
 */
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ItemImageUpload, StoredItemImage, ItemImageRead } from './image-storage.contract';
import { validateItemImage } from './image-storage.contract';
import type { ItemImageAuditEvent } from './image-storage.audit.contract';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;

interface BundleBody {
  version: 1;
  metadata: StoredItemImage;
  uploadAudit: ItemImageAuditEvent;
  base64: string;
}
interface BundleRecord extends BundleBody { checksum: string; }
export interface BundleRead {
  image: ItemImageRead;
  audit: ItemImageAuditEvent;
}
export type BundleAnomalyCode = 'PENDING' | 'CORRUPT' | 'UNSAFE' | 'UNKNOWN';
export interface BundleAnomaly { code: BundleAnomalyCode; reference: string; }
export interface BundleReview {
  /** Not an authoritative audit-completeness certificate. */
  status: 'CLEAN_FIXTURE' | 'REVIEW_REQUIRED';
  published: number;
  anomalies: readonly BundleAnomaly[];
}

function requireSyntheticMode(): void {
  if (process.env.NODE_ENV !== 'test' ||
      ['cloud_staging', 'production'].includes(process.env.ACM_DEPLOYMENT_PROFILE || '')) {
    throw new Error('IMAGE_AUDIT_BUNDLE_TEST_ONLY');
  }
}
function requireUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new Error('IMAGE_AUDIT_BUNDLE_INVALID_' + label);
  }
  return value.toLowerCase();
}
function safeRootPath(directory: string): string {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new Error('IMAGE_AUDIT_BUNDLE_ABSOLUTE_NONROOT_REQUIRED');
  }
  const full = path.resolve(directory);
  if (full === path.parse(full).root) {
    throw new Error('IMAGE_AUDIT_BUNDLE_ABSOLUTE_NONROOT_REQUIRED');
  }
  return full;
}
async function ensureSafeDirectory(root: string, create: boolean): Promise<void> {
  const parsed = path.parse(root);
  let current = parsed.root;
  for (const part of root.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (create) {
      try { await fs.mkdir(current, { mode: 0o700 }); }
      catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('IMAGE_AUDIT_BUNDLE_UNSAFE_DIRECTORY');
    }
  }
}
function hash(body: BundleBody): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}
function bytesFromCanonicalBase64(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length > MAX_BUNDLE_BYTES * 2) {
    throw new Error('IMAGE_AUDIT_BUNDLE_INVALID_BASE64');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    throw new Error('IMAGE_AUDIT_BUNDLE_INVALID_BASE64');
  }
  return bytes;
}
function verifyBundle(record: BundleRecord, claimId: string): BundleRead {
  if (!record || record.version !== 1 ||
      !record.metadata || !record.uploadAudit || !SHA256.test(record.checksum)) {
    throw new Error('IMAGE_AUDIT_BUNDLE_INVALID_RECORD');
  }
  const imageId = requireUuid(record.metadata.id, 'IMAGE_ID');
  const itemId = requireUuid(record.metadata.itemId, 'ITEM_ID');
  const actorId = requireUuid(record.metadata.uploadedById, 'ACTOR_ID');
  if (imageId !== claimId || record.uploadAudit.action !== 'IMAGE_UPLOAD' ||
      record.uploadAudit.imageId?.toLowerCase() !== imageId ||
      record.uploadAudit.itemId?.toLowerCase() !== itemId ||
      record.uploadAudit.actorId?.toLowerCase() !== actorId ||
      record.uploadAudit.recordedAt !== record.metadata.createdAt ||
      record.uploadAudit.sha256 !== record.metadata.sha256 ||
      record.uploadAudit.byteLength !== record.metadata.byteLength) {
    throw new Error('IMAGE_AUDIT_BUNDLE_AUDIT_MISMATCH');
  }
  const contents = bytesFromCanonicalBase64(record.base64);
  const { sha256 } = validateItemImage({
    itemId, uploadedById: actorId, originalName: record.metadata.originalName,
    mimeType: record.metadata.mimeType, contents,
  });
  if (sha256 !== record.metadata.sha256 || contents.byteLength !== record.metadata.byteLength) {
    throw new Error('IMAGE_AUDIT_BUNDLE_IMAGE_MISMATCH');
  }
  const { checksum, ...body } = record;
  if (hash(body) !== checksum) {
    throw new Error('IMAGE_AUDIT_BUNDLE_CHECKSUM_MISMATCH');
  }
  return {
    image: { metadata: { ...record.metadata }, contents: Uint8Array.from(contents) },
    audit: { ...record.uploadAudit },
  };
}
function matchesInput(read: BundleRead, input: ItemImageUpload, sha256: string): boolean {
  const m = read.image.metadata;
  return m.itemId === input.itemId.toLowerCase() &&
    m.uploadedById === input.uploadedById.toLowerCase() &&
    m.originalName === input.originalName && m.mimeType === input.mimeType &&
    m.sha256 === sha256 && m.byteLength === input.contents.byteLength;
}

export interface TestOnlyBundleFailureHooks {
  /** Simulated interruption after pending bytes are synced, before publish. */
  afterPendingSync?: () => Promise<void>;
  /** Simulated lost response after publish, before ack/cleanup. */
  afterPublished?: () => Promise<void>;
}

export class TestOnlyImageAuditBundle {
  private readonly root: string;
  constructor(directory: string, private readonly hooks: TestOnlyBundleFailureHooks = {}) {
    requireSyntheticMode();
    this.root = safeRootPath(directory);
  }

  /**
   * Caller supplies a pre-allocated, trusted synthetic claim UUID so retries
   * can locate the previous result. No external client should use this class.
   */
  async publish(claim: string, input: ItemImageUpload): Promise<StoredItemImage> {
    requireSyntheticMode();
    const id = requireUuid(claim, 'CLAIM');
    const { sha256 } = validateItemImage(input);
    await ensureSafeDirectory(this.root, true);

    const existing = await this.read(claim);
    if (existing) {
      if (!matchesInput(existing, input, sha256)) {
        throw new Error('IMAGE_AUDIT_BUNDLE_CLAIM_CONFLICT');
      }
      return { ...existing.image.metadata };
    }

    const now = new Date().toISOString();
    const metadata: StoredItemImage = {
      id, itemId: input.itemId.toLowerCase(), uploadedById: input.uploadedById.toLowerCase(),
      originalName: input.originalName, mimeType: input.mimeType,
      sha256, byteLength: input.contents.byteLength, createdAt: now,
    };
    const uploadAudit: ItemImageAuditEvent = {
      action: 'IMAGE_UPLOAD', actorId: metadata.uploadedById,
      itemId: metadata.itemId, imageId: id,
      sha256, byteLength: metadata.byteLength, recordedAt: now,
    };
    const body: BundleBody = {
      version: 1, metadata, uploadAudit, base64: Buffer.from(input.contents).toString('base64'),
    };
    const serialized = JSON.stringify({ ...body, checksum: hash(body) });
    if (Buffer.byteLength(serialized) > MAX_BUNDLE_BYTES) {
      throw new Error('IMAGE_AUDIT_BUNDLE_TOO_LARGE');
    }

    // Pending file is owned by this attempt, never silently clobbered.
    const pending = path.join(this.root, id + '.' + randomUUID() + '.pending');
    const final = path.join(this.root, id + '.json');
    const handle = await fs.open(pending, 'wx', 0o600);
    try {
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Keep pending bytes on simulated interruption for read-only inspection.
    if (this.hooks.afterPendingSync) await this.hooks.afterPendingSync();

    try {
      // link(2) is an atomic no-clobber *publication* on the same local FS,
      // unlike rename() which may overwrite a previously published claim.
      await fs.link(pending, final);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await fs.unlink(pending);
      const winner = await this.read(id);
      if (!winner) throw new Error('IMAGE_AUDIT_BUNDLE_MISSING_WINNER');
      if (!matchesInput(winner, input, sha256)) {
        throw new Error('IMAGE_AUDIT_BUNDLE_CLAIM_CONFLICT');
      }
      return { ...winner.image.metadata };
    }

    // Ambiguous success: final record exists, but the client may see failure.
    if (this.hooks.afterPublished) await this.hooks.afterPublished();
    await fs.unlink(pending);
    return { ...metadata };
  }

  async read(claim: string): Promise<BundleRead | null> {
    requireSyntheticMode();
    const id = requireUuid(claim, 'CLAIM');
    try {
      await ensureSafeDirectory(this.root, false);
      const file = path.join(this.root, id + '.json');
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() ||
          stat.size <= 0 || stat.size > MAX_BUNDLE_BYTES) {
        throw new Error('IMAGE_AUDIT_BUNDLE_UNSAFE_RECORD');
      }
      return verifyBundle(JSON.parse(await fs.readFile(file, 'utf8')) as BundleRecord, id);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** NEVER mutates anything; even pending records are left for an operator. */
  async inspect(): Promise<BundleReview> {
    requireSyntheticMode();
    await ensureSafeDirectory(this.root, false);
    const anomalies: BundleAnomaly[] = [];
    let published = 0;
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || !entry.isFile()) {
        anomalies.push({ code: 'UNSAFE', reference: entry.name });
      } else if (entry.name.endsWith('.pending')) {
        anomalies.push({ code: 'PENDING', reference: entry.name });
      } else if (!UUID.test(entry.name.slice(0, -5)) || !entry.name.endsWith('.json')) {
        anomalies.push({ code: 'UNKNOWN', reference: entry.name });
      } else {
        try {
          const read = await this.read(entry.name.slice(0, -5));
          if (!read) throw new Error('MISSING');
          published += 1;
        } catch {
          anomalies.push({ code: 'CORRUPT', reference: entry.name });
        }
      }
    }
    anomalies.sort((a, b) => a.reference.localeCompare(b.reference));
    return {
      status: anomalies.length === 0 ? 'CLEAN_FIXTURE' : 'REVIEW_REQUIRED',
      published, anomalies,
    };
  }
}
