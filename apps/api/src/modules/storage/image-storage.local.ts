/**
 * L4 LOCAL-ONLY, OPT-IN durable prototype. No HTTP route or Cloudinary.
 * Never store real user data until retention, backup and RBAC are approved.
 *
 * A single atomic JSON record stores metadata + bytes together. This avoids
 * half-written sidecars but is intentionally unsuitable for production scale.
 */
import { randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ItemImageRead,
  ItemImageStorageProvider,
  ItemImageUpload,
  StoredItemImage,
  validateItemImage,
} from './image-storage.contract';

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const MAX_RECORD_BYTES = 8 * 1024 * 1024;

type DiskRecord = { metadata: StoredItemImage; base64: string };

export class LocalOnlyDiskItemImageStorage implements ItemImageStorageProvider {
  private readonly root: string;

  constructor(rootDirectory: string) {
    const profile = process.env.ACM_DEPLOYMENT_PROFILE;
    const isTest = process.env.NODE_ENV === 'test';
    const explicitlyLocal =
      process.env.NODE_ENV === 'development' &&
      profile === 'local_dev' &&
      process.env.ACM_LOCAL_IMAGE_STORAGE_ENABLED === 'true';
    if (profile === 'cloud_staging' || profile === 'production' || (!isTest && !explicitlyLocal)) {
      throw new Error('LOCAL_IMAGE_STORAGE_DISABLED_BY_DEFAULT');
    }
    if (!path.isAbsolute(rootDirectory) || path.parse(rootDirectory).root === path.resolve(rootDirectory)) {
      throw new Error('LOCAL_IMAGE_STORAGE_REQUIRES_ABSOLUTE_NONROOT_DIRECTORY');
    }
    this.root = path.resolve(rootDirectory);
  }

  private async prepareRoot(): Promise<void> {
    // Never use recursive mkdir here: it silently follows a pre-existing
    // symlink anywhere in the path. Validate each component before descending.
    // This is a local prototype; concurrent malicious path replacement still
    // requires OS-level directory ownership/ACL review before production.
    const parsed = path.parse(this.root);
    let current = parsed.root;
    for (const segment of this.root.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        await fs.mkdir(current, { mode: 0o700 });
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('LOCAL_IMAGE_STORAGE_UNSAFE_ROOT');
      }
    }
  }

  private recordPath(imageId: string): string | null {
    if (typeof imageId !== 'string' || !UUID.test(imageId)) return null;
    return path.join(this.root, imageId.toLowerCase() + '.json');
  }

  async save(input: ItemImageUpload): Promise<StoredItemImage> {
    const { sha256 } = validateItemImage(input);
    await this.prepareRoot();

    const metadata: StoredItemImage = {
      id: randomUUID(),
      itemId: input.itemId.toLowerCase(),
      uploadedById: input.uploadedById.toLowerCase(),
      originalName: input.originalName,
      mimeType: input.mimeType,
      byteLength: input.contents.byteLength,
      sha256,
      createdAt: new Date().toISOString(),
    };
    const finalPath = this.recordPath(metadata.id)!;
    const tempPath = path.join(this.root, randomUUID() + '.pending');
    const payload = JSON.stringify({
      metadata,
      base64: Buffer.from(input.contents).toString('base64'),
    } satisfies DiskRecord);
    if (Buffer.byteLength(payload) > MAX_RECORD_BYTES) {
      throw new Error('LOCAL_IMAGE_STORAGE_RECORD_TOO_LARGE');
    }

    const file = await fs.open(tempPath, 'wx', 0o600);
    try {
      await file.writeFile(payload, 'utf8');
      await file.sync();
      await file.close();
      // Same-directory rename publishes the complete record atomically.
      await fs.rename(tempPath, finalPath);
    } catch (error) {
      await file.close().catch(() => undefined);
      await fs.unlink(tempPath).catch(() => undefined);
      throw error;
    }
    return { ...metadata };
  }

  async readForItem(itemId: string, imageId: string): Promise<ItemImageRead | null> {
    if (typeof itemId !== 'string' || !UUID.test(itemId)) return null;
    const file = this.recordPath(imageId);
    if (!file) return null;
    await this.prepareRoot();
    // A separate lstat() + readFile() can follow an attacker-swapped symlink
    // between the two calls. Open O_NOFOLLOW and inspect the SAME descriptor.
    // If the platform cannot guarantee NOFOLLOW, deny reads rather than guess.
    const noFollow = constants.O_NOFOLLOW;
    if (typeof noFollow !== 'number') {
      throw new Error('LOCAL_IMAGE_STORAGE_NOFOLLOW_UNAVAILABLE');
    }
    let serialized: string;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(file, constants.O_RDONLY | noFollow);
      const stat = await handle.stat();
      // Reject hard-linked records: a file owned/changed outside this root
      // could otherwise pass an ordinary regular-file check.
      if (!stat.isFile() || stat.nlink !== 1 ||
          stat.size <= 0 || stat.size > MAX_RECORD_BYTES) {
        throw new Error('LOCAL_IMAGE_STORAGE_UNSAFE_RECORD');
      }
      serialized = await handle.readFile({ encoding: 'utf8' });
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      if (code === 'ELOOP' || code === 'EMLINK') {
        throw new Error('LOCAL_IMAGE_STORAGE_UNSAFE_RECORD');
      }
      throw error;
    } finally {
      await handle?.close();
    }
    const record = JSON.parse(serialized) as DiskRecord;
    if (!record || !record.metadata || typeof record.base64 !== 'string' ||
        record.metadata.id !== imageId.toLowerCase() ||
        record.metadata.itemId !== itemId.toLowerCase()) return null;
    // Buffer.from(..., 'base64') silently tolerates invalid and non-canonical
    // sequences. Reject them before validating the image checksum.
    if (record.base64.length > MAX_RECORD_BYTES * 2) {
      throw new Error('LOCAL_IMAGE_STORAGE_NONCANONICAL_BASE64');
    }
    const contents = Buffer.from(record.base64, 'base64');
    if (contents.toString('base64') !== record.base64) {
      throw new Error('LOCAL_IMAGE_STORAGE_NONCANONICAL_BASE64');
    }
    const { sha256 } = validateItemImage({
      itemId: record.metadata.itemId,
      uploadedById: record.metadata.uploadedById,
      originalName: record.metadata.originalName,
      mimeType: record.metadata.mimeType,
      contents,
    });
    if (sha256 !== record.metadata.sha256 || contents.byteLength !== record.metadata.byteLength) {
      throw new Error('LOCAL_IMAGE_STORAGE_RECORD_INTEGRITY_MISMATCH');
    }
    return { metadata: { ...record.metadata }, contents: Uint8Array.from(contents) };
  }

  async deleteForItem(itemId: string, imageId: string): Promise<boolean> {
    const record = await this.readForItem(itemId, imageId);
    if (!record) return false;
    const file = this.recordPath(imageId)!;
    try {
      await fs.unlink(file);
      return true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}
