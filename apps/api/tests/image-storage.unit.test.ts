import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ImageStorageValidationError,
  MAX_ITEM_IMAGE_BYTES,
  ItemImageUpload,
  validateItemImage,
} from '../src/modules/storage/image-storage.contract';
import { TestOnlyMemoryItemImageStorage } from '../src/modules/storage/image-storage.memory';

const ITEM_1 = '11111111-1111-4111-8111-111111111111';
const ITEM_2 = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const WEBP = Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 1]);

const image = (updates: Partial<ItemImageUpload> = {}): ItemImageUpload => ({
  itemId: ITEM_1,
  uploadedById: ACTOR,
  originalName: 'item.png',
  mimeType: 'image/png',
  contents: Uint8Array.from(PNG),
  ...updates,
});

describe('L4 test-only image storage (no DB, filesystem, HTTP or cloud)', () => {
  it('accepts valid PNG and returns a content hash and item-scoped receipt', async () => {
    const store = new TestOnlyMemoryItemImageStorage();
    const stored = await store.save(image());
    expect(stored.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored.itemId).toBe(ITEM_1);
    expect(stored.byteLength).toBe(PNG.length);
    expect(stored.sha256).toBe(createHash('sha256').update(PNG).digest('hex'));
    expect(stored.createdAt).toBeTruthy();
    expect((await store.readForItem(ITEM_1, stored.id))?.contents).toEqual(PNG);
  });

  it('copies upload bytes so the caller cannot mutate the stored fixture', async () => {
    const input = image();
    const store = new TestOnlyMemoryItemImageStorage();
    const stored = await store.save(input);
    input.contents[0] = 0;
    expect((await store.readForItem(ITEM_1, stored.id))?.contents[0]).toBe(137);
  });

  it('copies downloaded bytes and metadata on every read', async () => {
    const store = new TestOnlyMemoryItemImageStorage();
    const stored = await store.save(image());
    const read = await store.readForItem(ITEM_1, stored.id);
    expect(read).not.toBeNull();
    read!.contents[0] = 0;
    read!.metadata.originalName = 'forged.png';
    const next = await store.readForItem(ITEM_1, stored.id);
    expect(next?.contents[0]).toBe(137);
    expect(next?.metadata.originalName).toBe('item.png');
  });

  it('does not reveal another item image by its known ID', async () => {
    const store = new TestOnlyMemoryItemImageStorage();
    const a = await store.save(image());
    expect(await store.readForItem(ITEM_2, a.id)).toBeNull();
    expect(await store.deleteForItem(ITEM_2, a.id)).toBe(false);
    expect(await store.readForItem(ITEM_1, a.id)).not.toBeNull();
  });

  it('deletes only images for the matching item', async () => {
    const store = new TestOnlyMemoryItemImageStorage();
    const a = await store.save(image());
    expect(await store.deleteForItem(ITEM_1, a.id)).toBe(true);
    expect(await store.deleteForItem(ITEM_1, a.id)).toBe(false);
    expect(await store.readForItem(ITEM_1, a.id)).toBeNull();
  });

  it('does not share objects between independent test providers', async () => {
    const first = new TestOnlyMemoryItemImageStorage();
    const second = new TestOnlyMemoryItemImageStorage();
    const a = await first.save(image());
    expect(await second.readForItem(ITEM_1, a.id)).toBeNull();
  });

  it('accepts JPEG with matching extension and signature', () => {
    expect(() => validateItemImage(image({
      originalName: 'photo.JPEG',
      mimeType: 'image/jpeg',
      contents: JPG,
    }))).not.toThrow();
  });

  it('accepts WebP with matching RIFF+WEBP signature', () => {
    expect(() => validateItemImage(image({
      originalName: 'photo.webp',
      mimeType: 'image/webp',
      contents: WEBP,
    }))).not.toThrow();
  });

  it.each(['../private.png', 'nested/file.png', 'nested\\file.png', '.hidden.png'])(
    'rejects unsafe filename %s',
    (name) => {
      expect(() => validateItemImage(image({ originalName: name })))
        .toThrow(ImageStorageValidationError);
    }
  );

  it('rejects whitespace-padded/control-character names', () => {
    expect(() => validateItemImage(image({ originalName: ' image.png' })))
      .toThrow(ImageStorageValidationError);
    expect(() => validateItemImage(image({ originalName: 'bad\u0000file.png' })))
      .toThrow(ImageStorageValidationError);
  });

  it('rejects misleading filename extension', () => {
    expect(() => validateItemImage(image({ originalName: 'item.jpg' })))
      .toThrow(ImageStorageValidationError);
  });

  it('rejects MIME spoofing with a valid extension but wrong bytes', () => {
    expect(() => validateItemImage(image({ contents: JPG })))
      .toThrow(ImageStorageValidationError);
  });

  it('rejects unsupported SVG/MIME types rather than attempting to sanitize active content', () => {
    expect(() => validateItemImage(image({
      originalName: 'item.svg', mimeType: 'image/svg+xml' as any,
    }))).toThrow(ImageStorageValidationError);
  });

  it('rejects empty content and missing content', () => {
    expect(() => validateItemImage(image({ contents: new Uint8Array() })))
      .toThrow(ImageStorageValidationError);
    expect(() => validateItemImage(image({ contents: undefined as any })))
      .toThrow(ImageStorageValidationError);
  });

  it('rejects content exceeding the 5 MiB mock policy cap', () => {
    expect(() => validateItemImage(image({
      contents: new Uint8Array(MAX_ITEM_IMAGE_BYTES + 1),
    }))).toThrow(ImageStorageValidationError);
  });

  it('rejects fake item or actor identity', () => {
    expect(() => validateItemImage(image({ itemId: '../admin' })))
      .toThrow(ImageStorageValidationError);
    expect(() => validateItemImage(image({ uploadedById: 'guest' })))
      .toThrow(ImageStorageValidationError);
  });

  it('reports only a 422 validation class, never a route or network response', () => {
    try {
      validateItemImage(image({ originalName: 'evil.jpg' }));
      throw new Error('Expected validation to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ImageStorageValidationError);
      expect((error as ImageStorageValidationError).statusCode).toBe(422);
    }
  });
});
