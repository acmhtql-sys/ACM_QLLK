/**
 * L4 review-only item-image storage contract.
 *
 * There is deliberately NO MOUNTED or operational HTTP upload route,
 * Cloudinary client, or production-ready storage implementation. A local
 * filesystem prototype and an UNMOUNTED HTTP review candidate are separate.
 * The authenticated application layer must enforce item-level RBAC and audit
 * before any future adapter can accept real data.
 */
import { createHash } from 'node:crypto';

export type AllowedImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ItemImageUpload {
  /** Trusted UUID resolved by the backend, not accepted as client authority. */
  itemId: string;
  /** Trusted authenticated actor UUID (audit correlation only, not an ACL). */
  uploadedById: string;
  originalName: string;
  mimeType: AllowedImageMime;
  contents: Uint8Array;
}

export interface StoredItemImage {
  id: string;
  itemId: string;
  uploadedById: string;
  originalName: string;
  mimeType: AllowedImageMime;
  byteLength: number;
  sha256: string;
  createdAt: string;
}

export interface ItemImageRead {
  metadata: StoredItemImage;
  contents: Uint8Array;
}

export interface ItemImageStorageProvider {
  save(input: ItemImageUpload): Promise<StoredItemImage>;
  /** Never return another item's bytes, even when its image ID is known. */
  readForItem(itemId: string, imageId: string): Promise<ItemImageRead | null>;
  /** Returns false for missing or non-matching item/image, without metadata. */
  deleteForItem(itemId: string, imageId: string): Promise<boolean>;
}

export class ImageStorageValidationError extends Error {
  readonly statusCode = 422;
  constructor(message: string) {
    super(message);
    this.name = 'ImageStorageValidationError';
  }
}

export const MAX_ITEM_IMAGE_BYTES = 5 * 1024 * 1024;

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const EXTENSIONS: Record<AllowedImageMime, readonly string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};

const isPng = (b: Uint8Array): boolean =>
  b.length >= 8 &&
  [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => b[i] === x);

const isJpeg = (b: Uint8Array): boolean =>
  b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

const isWebp = (b: Uint8Array): boolean =>
  b.length >= 12 &&
  String.fromCharCode(...b.slice(0, 4)) === 'RIFF' &&
  String.fromCharCode(...b.slice(8, 12)) === 'WEBP';

/**
 * Header checks are a narrow early guard, NOT a media decoder/virus scanner.
 * Production adapters need independent content inspection, access checks and
 * lifecycle policies approved before accepting real uploads.
 */
export function validateItemImage(input: ItemImageUpload): { sha256: string } {
  if (!input || !UUID.test(input.itemId) || !UUID.test(input.uploadedById)) {
    throw new ImageStorageValidationError('Thiếu định danh linh kiện hoặc người tải lên');
  }
  if (
    typeof input.originalName !== 'string' ||
    input.originalName.length < 5 ||
    input.originalName.length > 150 ||
    input.originalName !== input.originalName.trim() ||
    input.originalName.startsWith('.') ||
    /[\\/\u0000-\u001f\u007f]/.test(input.originalName)
  ) {
    throw new ImageStorageValidationError('Tên tệp hình ảnh không hợp lệ');
  }

  if (
    typeof input.mimeType !== 'string' ||
    !Object.prototype.hasOwnProperty.call(EXTENSIONS, input.mimeType)
  ) {
    throw new ImageStorageValidationError('Chỉ cho phép PNG, JPEG hoặc WebP');
  }
  const mime = input.mimeType as AllowedImageMime;
  const lowerName = input.originalName.toLowerCase();
  if (!EXTENSIONS[mime].some((ext) => lowerName.endsWith(ext))) {
    throw new ImageStorageValidationError('Đuôi tệp không khớp loại hình ảnh');
  }

  if (!(input.contents instanceof Uint8Array) ||
      input.contents.byteLength === 0 ||
      input.contents.byteLength > MAX_ITEM_IMAGE_BYTES) {
    throw new ImageStorageValidationError('Kích thước hình ảnh không hợp lệ');
  }
  const validHeader =
    mime === 'image/png' ? isPng(input.contents)
      : mime === 'image/jpeg' ? isJpeg(input.contents)
        : isWebp(input.contents);
  if (!validHeader) {
    throw new ImageStorageValidationError('Chữ ký nội dung hình ảnh không khớp');
  }

  return { sha256: createHash('sha256').update(input.contents).digest('hex') };
}
