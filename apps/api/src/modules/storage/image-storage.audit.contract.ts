/**
 * L4 IMAGE AUDIT CONTRACT — REVIEW ONLY, NO IMPLEMENTATION / DB WRITES.
 *
 * A successful Promise resolution is the caller's acknowledgement of an
 * audit event. Real operational adoption MUST require a durable, append-only
 * and independently verified sink with failure/replay handling.
 *
 * The event deliberately excludes original filename, raw bytes, HTTP headers,
 * JWTs and any client-supplied principal. IDs come from verified server state.
 */
export type ItemImageAuditAction = 'IMAGE_UPLOAD' | 'IMAGE_READ';

export interface ItemImageAuditEvent {
  action: ItemImageAuditAction;
  actorId: string;
  itemId: string;
  imageId: string;
  sha256: string;
  byteLength: number;
  recordedAt: string;
}

export interface ItemImageAuditSink {
  record(event: Readonly<ItemImageAuditEvent>): Promise<void>;
}
