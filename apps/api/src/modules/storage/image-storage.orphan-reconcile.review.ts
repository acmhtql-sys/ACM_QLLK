/**
 * L4 synthetic, READ-ONLY file↔audit reconciliation. NEVER deletes or repairs.
 * Allowed only in NODE_ENV=test against ephemeral, isolated local fixtures.
 * The caller-provided audit snapshot is NOT authenticated/complete by this
 * utility; `complete: true` is a test assumption, NOT production evidence.
 *
 * This does not resolve real Windows ACL/reparse/TOCTOU, orphan GC, outbox or
 * audit durability. It MUST remain unmounted and absent from real servers.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ItemImageAuditEvent } from './image-storage.audit.contract';
import { validateItemImage } from './image-storage.contract';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_RECORD_BYTES = 8 * 1024 * 1024;

export type ImageReconciliationIssue =
  | 'ORPHAN_NO_UPLOAD_AUDIT'
  | 'MISMATCHED_UPLOAD_AUDIT'
  | 'DUPLICATE_UPLOAD_AUDIT'
  | 'AUDIT_WITHOUT_IMAGE'
  | 'CORRUPT_IMAGE_RECORD'
  | 'UNSAFE_ENTRY'
  | 'PENDING_FILE'
  | 'UNKNOWN_ENTRY';

export interface ImageReconciliationFinding {
  code: ImageReconciliationIssue;
  /** Safe basename only: never expose original filename or raw image bytes. */
  reference: string;
}

export interface ImageReconciliationSnapshot {
  /** Complete is an assertion made by the caller. It is NOT verified here. */
  complete: boolean;
  events: readonly ItemImageAuditEvent[];
}

export interface ImageReconciliationReport {
  status: 'CLEAN' | 'REVIEW_REQUIRED' | 'EVIDENCE_INCOMPLETE';
  scannedImages: number;
  examinedUploadAudits: number;
  /** All findings require independent operator review; NEVER auto-delete. */
  findings: readonly ImageReconciliationFinding[];
}

function validateAuditSnapshot(snapshot: ImageReconciliationSnapshot): void {
  if (!snapshot || typeof snapshot.complete !== 'boolean' || !Array.isArray(snapshot.events)) {
    throw new Error('LOCAL_IMAGE_RECONCILE_INVALID_AUDIT_SNAPSHOT');
  }
  for (const event of snapshot.events) {
    if (!event || !['IMAGE_UPLOAD', 'IMAGE_READ'].includes(event.action) ||
        !UUID.test(event.actorId) || !UUID.test(event.itemId) || !UUID.test(event.imageId) ||
        !SHA256.test(event.sha256) ||
        !Number.isSafeInteger(event.byteLength) || event.byteLength <= 0 ||
        typeof event.recordedAt !== 'string' ||
        !Number.isFinite(Date.parse(event.recordedAt))) {
      throw new Error('LOCAL_IMAGE_RECONCILE_INVALID_AUDIT_EVENT');
    }
  }
}

async function assertSafeRoot(root: string): Promise<void> {
  const parsed = path.parse(root);
  let cursor = parsed.root;
  for (const segment of root.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = await fs.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('LOCAL_IMAGE_RECONCILE_UNSAFE_ROOT');
    }
  }
}

/**
 * Inspect JSON records and independently supplied audit facts. Never creates,
 * mutates, renames, or unlinks a file. A missing/incomplete audit source cannot
 * satisfy a release gate, even when there are no obvious file mismatches.
 */
export async function inspectSyntheticLocalImageAudit(
  rootDirectory: string,
  snapshot: ImageReconciliationSnapshot
): Promise<ImageReconciliationReport> {
  if (process.env.NODE_ENV !== 'test' ||
      ['cloud_staging', 'production'].includes(process.env.ACM_DEPLOYMENT_PROFILE || '')) {
    throw new Error('LOCAL_IMAGE_RECONCILE_TEST_ONLY');
  }
  if (typeof rootDirectory !== 'string' || !path.isAbsolute(rootDirectory) ||
      path.resolve(rootDirectory) === path.parse(path.resolve(rootDirectory)).root) {
    throw new Error('LOCAL_IMAGE_RECONCILE_REQUIRES_ABSOLUTE_NONROOT_DIRECTORY');
  }
  validateAuditSnapshot(snapshot);
  const root = path.resolve(rootDirectory);
  await assertSafeRoot(root);

  const findings: ImageReconciliationFinding[] = [];
  const uploadAudits = new Map<string, ItemImageAuditEvent[]>();
  for (const event of snapshot.events) {
    if (event.action !== 'IMAGE_UPLOAD') continue;
    const key = event.imageId.toLowerCase();
    const seen = uploadAudits.get(key) || [];
    seen.push(event);
    uploadAudits.set(key, seen);
  }

  const foundIds = new Set<string>();
  let scannedImages = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const { name } = entry;
    if (entry.isSymbolicLink() || !entry.isFile()) {
      findings.push({ code: 'UNSAFE_ENTRY', reference: name });
      continue;
    }
    if (name.endsWith('.pending')) {
      findings.push({ code: 'PENDING_FILE', reference: name });
      continue;
    }
    const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i.exec(name);
    if (!match) {
      findings.push({ code: 'UNKNOWN_ENTRY', reference: name });
      continue;
    }
    const id = match[1].toLowerCase();
    foundIds.add(id);
    scannedImages += 1;
    try {
      const file = path.join(root, name);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() ||
          stat.size <= 0 || stat.size > MAX_RECORD_BYTES) {
        throw new Error('INVALID_RECORD_FILE');
      }
      const record = JSON.parse(await fs.readFile(file, 'utf8')) as {
        metadata?: { id: string; itemId: string; uploadedById: string;
          originalName: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
          sha256: string; byteLength: number };
        base64?: string;
      };
      if (!record || !record.metadata || typeof record.base64 !== 'string' ||
          record.metadata.id?.toLowerCase() !== id) {
        throw new Error('INVALID_RECORD_SHAPE');
      }
      // Reject malformed base64 rather than letting permissive Buffer.from()
      // silently decode a truncated or non-canonical payload.
      const bytes = Buffer.from(record.base64, 'base64');
      if (bytes.toString('base64') !== record.base64) throw new Error('INVALID_RECORD_BASE64');
      const digest = validateItemImage({
        itemId: record.metadata.itemId,
        uploadedById: record.metadata.uploadedById,
        originalName: record.metadata.originalName,
        mimeType: record.metadata.mimeType,
        contents: bytes,
      });
      if (digest.sha256 !== record.metadata.sha256 ||
          bytes.byteLength !== record.metadata.byteLength) {
        throw new Error('INVALID_RECORD_CHECKSUM');
      }

      const audits = uploadAudits.get(id) || [];
      if (audits.length === 0) {
        findings.push({ code: 'ORPHAN_NO_UPLOAD_AUDIT', reference: id });
      } else {
        if (audits.length > 1) {
          findings.push({ code: 'DUPLICATE_UPLOAD_AUDIT', reference: id });
        }
        if (!audits.some(a =>
          a.itemId.toLowerCase() === record.metadata!.itemId.toLowerCase() &&
          a.actorId.toLowerCase() === record.metadata!.uploadedById.toLowerCase() &&
          a.sha256 === record.metadata!.sha256 &&
          a.byteLength === record.metadata!.byteLength)) {
          findings.push({ code: 'MISMATCHED_UPLOAD_AUDIT', reference: id });
        }
      }
    } catch {
      findings.push({ code: 'CORRUPT_IMAGE_RECORD', reference: id });
    }
  }

  for (const id of uploadAudits.keys()) {
    if (!foundIds.has(id)) {
      findings.push({ code: 'AUDIT_WITHOUT_IMAGE', reference: id });
    }
  }
  findings.sort((a, b) => a.reference.localeCompare(b.reference) || a.code.localeCompare(b.code));
  return {
    status: !snapshot.complete ? 'EVIDENCE_INCOMPLETE'
      : findings.length > 0 ? 'REVIEW_REQUIRED' : 'CLEAN',
    scannedImages,
    examinedUploadAudits: [...uploadAudits.values()].reduce((sum, list) => sum + list.length, 0),
    findings,
  };
}
