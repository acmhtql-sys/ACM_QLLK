/**
 * In-memory fixture ONLY. No persistence, database, filesystem, network, or
 * cloud dependency. The constructor refuses non-test runtime environments.
 *
 * NEVER wire this provider to an operational HTTP router; L4 production
 * adapter requires independent security, storage/retention and owner approval.
 */
import { randomUUID } from 'node:crypto';
import {
  ItemImageRead,
  ItemImageStorageProvider,
  ItemImageUpload,
  StoredItemImage,
  validateItemImage,
} from './image-storage.contract';

type Entry = { metadata: StoredItemImage; contents: Uint8Array };

export class TestOnlyMemoryItemImageStorage implements ItemImageStorageProvider {
  private readonly entries = new Map<string, Entry>();

  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('TEST_ONLY_STORAGE_NOT_ALLOWED_OUTSIDE_NODE_ENV_TEST');
    }
  }

  async save(input: ItemImageUpload): Promise<StoredItemImage> {
    const { sha256 } = validateItemImage(input);
    const record: StoredItemImage = {
      id: randomUUID(),
      itemId: input.itemId.toLowerCase(),
      uploadedById: input.uploadedById.toLowerCase(),
      originalName: input.originalName,
      mimeType: input.mimeType,
      byteLength: input.contents.byteLength,
      sha256,
      createdAt: new Date().toISOString(),
    };

    // Copy bytes on entry: the caller cannot mutate stored content afterwards.
    this.entries.set(record.id, {
      metadata: { ...record },
      contents: Uint8Array.from(input.contents),
    });
    return { ...record };
  }

  async readForItem(itemId: string, imageId: string): Promise<ItemImageRead | null> {
    const entry = this.entries.get(imageId);
    if (!entry || entry.metadata.itemId !== itemId.toLowerCase()) return null;
    return {
      metadata: { ...entry.metadata },
      // Copy bytes on exit: consumers cannot mutate the stored fixture.
      contents: Uint8Array.from(entry.contents),
    };
  }

  async deleteForItem(itemId: string, imageId: string): Promise<boolean> {
    const entry = this.entries.get(imageId);
    if (!entry || entry.metadata.itemId !== itemId.toLowerCase()) return false;
    return this.entries.delete(imageId);
  }
}
