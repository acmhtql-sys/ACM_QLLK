/**
 * ACM local-only private image storage foundation.
 * No HTTP routes, database access, Cloudinary calls, or credentials.
 * Integration MUST authenticate actors and authorize access to the target resource;
 * equality with uploadedById is only a conservative local guard, not full RBAC.
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, rm } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';

export type LocalImagePurpose = 'ITEM_IMAGE' | 'ASSET_IMAGE' | 'RECEIPT_EVIDENCE';
export type AllowedImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
export type StorageFailureCode = 'INVALID_INPUT' | 'UNSUPPORTED_MEDIA' | 'SIZE_LIMIT' |
  'FORBIDDEN' | 'NOT_FOUND' | 'CORRUPT_RECORD' | 'UNSAFE_DIRECTORY';

export class LocalStorageFailure extends Error {
  public readonly code: StorageFailureCode;
  constructor(code: StorageFailureCode) {
    super('ACM local storage rejected: ' + code);
    this.code = code;
    this.name = 'LocalStorageFailure';
  }
}
function fail(code: StorageFailureCode): never { throw new LocalStorageFailure(code); }

export interface LocalImageRecord {
  readonly id: string;
  readonly uploadedById: string;
  readonly purpose: LocalImagePurpose;
  readonly contentType: AllowedImageMime;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly createdAt: string;
}
export interface LocalImageUpload {
  readonly actorId: string;
  readonly purpose: LocalImagePurpose;
  readonly bytes: Uint8Array;
  readonly claimedMime?: string;
}
export interface LocalImageStorageProvider {
  put(input: LocalImageUpload): Promise<LocalImageRecord>;
  get(id: string, actorId: string): Promise<{ record: LocalImageRecord; bytes: Buffer }>;
  remove(id: string, actorId: string): Promise<boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PURPOSES = new Set<LocalImagePurpose>(['ITEM_IMAGE', 'ASSET_IMAGE', 'RECEIPT_EVIDENCE']);
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const ABSOLUTE_MAX_BYTES = 20 * 1024 * 1024;

function assertUuid(value: string): void {
  if (typeof value !== 'string' || !UUID.test(value)) fail('INVALID_INPUT');
}
function matchBytes(b: Buffer, offset: number, expected: number[]): boolean {
  return expected.every((v, i) => b[offset + i] === v);
}
/** Shallow signature screening: a full image decoder/security scanner is still required before production. */
export function detectImageMime(bytes: Uint8Array): AllowedImageMime {
  if (!(bytes instanceof Uint8Array)) fail('INVALID_INPUT');
  const b = Buffer.from(bytes);
  if (b.length >= 24 && matchBytes(b, 0, [137,80,78,71,13,10,26,10]) &&
      b.toString('ascii', 12, 16) === 'IHDR' && b.readUInt32BE(16) > 0 && b.readUInt32BE(20) > 0) {
    return 'image/png';
  }
  if (b.length >= 4 && matchBytes(b, 0, [255,216,255]) && matchBytes(b,b.length-2,[255,217])) {
    return 'image/jpeg';
  }
  if (b.length >= 16 && b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP' && b.readUInt32LE(4) === b.length - 8 &&
      ['VP8 ', 'VP8L', 'VP8X'].includes(b.toString('ascii', 12, 16))) {
    return 'image/webp';
  }
  fail('UNSUPPORTED_MEDIA');
}

function validRecord(v: unknown, expectedId: string): v is LocalImageRecord {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return r.id === expectedId && typeof r.uploadedById === 'string' && UUID.test(r.uploadedById) &&
    PURPOSES.has(r.purpose as LocalImagePurpose) &&
    (r.contentType === 'image/png' || r.contentType === 'image/jpeg' || r.contentType === 'image/webp') &&
    Number.isSafeInteger(r.sizeBytes) && (r.sizeBytes as number) > 0 &&
    typeof r.sha256 === 'string' && /^[0-9a-f]{64}$/.test(r.sha256) &&
    typeof r.createdAt === 'string' && Number.isFinite(Date.parse(r.createdAt));
}

export function createLocalImageStorage(options: {
  readonly directory: string;
  readonly maxBytes?: number;
}): LocalImageStorageProvider {
  if (!options || typeof options.directory !== 'string' || !options.directory.trim()) fail('UNSAFE_DIRECTORY');
  const directory = resolve(options.directory);
  if (directory === parse(directory).root) fail('UNSAFE_DIRECTORY');
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 24 || maxBytes > ABSOLUTE_MAX_BYTES) fail('INVALID_INPUT');

  async function safeDirectory(): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_DIRECTORY');
    // On POSIX, prevent local users from browsing private handover evidence.
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fail('UNSAFE_DIRECTORY');
  }
  function filePaths(id: string) {
    assertUuid(id); // never use a user-supplied path/filename
    return { binary: join(directory, id + '.bin'), meta: join(directory, id + '.json') };
  }
  async function load(id: string): Promise<LocalImageRecord | null> {
    const { meta } = filePaths(id);
    let text: string;
    try { text = await readFile(meta, 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    let v: unknown;
    try { v = JSON.parse(text); } catch { fail('CORRUPT_RECORD'); }
    if (!validRecord(v, id)) fail('CORRUPT_RECORD');
    return v;
  }
  function requireActor(actorId: string) { assertUuid(actorId); }

  return {
    async put(input) {
      if (!input || !(input.bytes instanceof Uint8Array) ||
          !PURPOSES.has(input.purpose) || input.bytes.length === 0) fail('INVALID_INPUT');
      requireActor(input.actorId);
      if (input.bytes.length > maxBytes) fail('SIZE_LIMIT');
      const data = Buffer.from(input.bytes); // copy caller buffer
      const mime = detectImageMime(data);
      if (input.claimedMime !== undefined && input.claimedMime !== mime) fail('UNSUPPORTED_MEDIA');
      await safeDirectory();
      const record: LocalImageRecord = {
        id: randomUUID(), uploadedById: input.actorId, purpose: input.purpose,
        contentType: mime, sizeBytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'), createdAt: new Date().toISOString(),
      };
      const { binary, meta } = filePaths(record.id);
      // O_EXCL prevents clobbering a previous object. No client-supplied filename.
      const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0);
      let binaryCreated = false;
      let metaCreated = false;
      try {
        const file = await open(binary, flags, 0o600);
        binaryCreated = true;
        try { await file.writeFile(data); } finally { await file.close(); }
        const manifest = await open(meta, flags, 0o600);
        metaCreated = true;
        try { await manifest.writeFile(JSON.stringify(record) + '\n'); }
        finally { await manifest.close(); }
        return record;
      } catch (error) {
        // Compensation for partial local write; no cross-system atomicity claim.
        if (metaCreated) await rm(meta, { force: true }).catch(() => undefined);
        if (binaryCreated) await rm(binary, { force: true }).catch(() => undefined);
        throw error;
      }
    },
    async get(id, actorId) {
      requireActor(actorId);
      await safeDirectory();
      const record = await load(id);
      if (!record) fail('NOT_FOUND');
      if (record.uploadedById !== actorId) fail('FORBIDDEN');
      let data: Buffer;
      try { data = await readFile(filePaths(id).binary); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') fail('CORRUPT_RECORD'); throw e; }
      if (data.length !== record.sizeBytes || data.length > maxBytes ||
          createHash('sha256').update(data).digest('hex') !== record.sha256) fail('CORRUPT_RECORD');
      try { if (detectImageMime(data) !== record.contentType) fail('CORRUPT_RECORD'); }
      catch { fail('CORRUPT_RECORD'); }
      return { record, bytes: data };
    },
    async remove(id, actorId) {
      requireActor(actorId);
      await safeDirectory();
      const record = await load(id);
      if (!record) return false; // idempotent repeated deletion
      if (record.uploadedById !== actorId) fail('FORBIDDEN');
      // Handover evidence cannot be destroyed through ordinary storage deletion.
      if (record.purpose === 'RECEIPT_EVIDENCE') fail('FORBIDDEN');
      const files = filePaths(id);
      await rm(files.binary, { force: true });
      await rm(files.meta, { force: true });
      return true;
    },
  };
}
