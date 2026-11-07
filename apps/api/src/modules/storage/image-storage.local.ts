/**
 * L4 LOCAL-ONLY, OPT-IN durable prototype. No HTTP route or Cloudinary.
 * Never store real user data until retention, backup and RBAC are approved.
 *
 * A single atomic JSON record stores metadata + bytes together. This avoids
 * half-written sidecars but is intentionally unsuitable for production scale.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
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
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('LOCAL_IMAGE_STORAGE_UNSAFE_ROOT');
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
    let serialized: string;
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RECORD_BYTES) {
        throw new Error('LOCAL_IMAGE_STORAGE_UNSAFE_RECORD');
      }
      serialized = await fs.readFile(file, 'utf8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const record = JSON.parse(serialized) as DiskRecord;
    if (!record || !record.metadata || typeof record.base64 !== 'string' ||
        record.metadata.id !== imageId.toLowerCase() ||
        record.metadata.itemId !== itemId.toLowerCase()) return null;
    const contents = Buffer.from(record.base64, 'base64');
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
