import crypto from 'crypto';
import { AppError } from '../../shared/AppError';

export interface IdempotencyLockResult {
  isNew: boolean;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  cachedResponse?: any;
  statusCode?: number;
}

export class IdempotencyService {
  /**
   * Validates format of Idempotency-Key.
   * Accepts UUIDs or alphanumeric strings with hyphens/underscores between 8 and 64 characters.
   */
  validateKey(key: string): boolean {
    if (!key || typeof key !== 'string') return false;
    const trimmed = key.trim();
    if (trimmed.length < 8 || trimmed.length > 64) return false;
    // Allow alphanumeric characters, hyphens, and underscores
    return /^[a-zA-Z0-9_-]+$/.test(trimmed);
  }

  /**
   * Recursively sorts object keys to produce a deterministic, canonical JSON representation.
   * Guarantees that { a: 1, b: 2 } and { b: 2, a: 1 } produce identical strings.
   */
  canonicalize(value: any): any {
    if (value === null || typeof value !== 'object') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.canonicalize(item));
    }

    const sortedKeys = Object.keys(value).sort();
    const sortedObj: Record<string, any> = {};
    for (const key of sortedKeys) {
      // Exclude volatile metadata such as client timestamps or idempotency key inside body if present
      if (key === 'idempotencyKey') continue;
      sortedObj[key] = this.canonicalize(value[key]);
    }
    return sortedObj;
  }

  /**
   * Generates SHA-256 fingerprint bound strictly to userId, endpoint, and canonical request body.
   */
  generateFingerprint(userId: string, endpoint: string, body: any): string {
    const canonicalBody = JSON.stringify(this.canonicalize(body) || {});
    const payloadToHash = `${userId}:${endpoint}:${canonicalBody}`;
    return crypto.createHash('sha256').update(payloadToHash).digest('hex');
  }

  /**
   * Sanitizes cached response body to ensure sensitive data (passwords, tokens) is never persisted.
   */
  sanitizeResponse(data: any): any {
    if (data === null || typeof data !== 'object') {
      return data;
    }

    // A Date has no enumerable own fields: treating it as an object caches {}.
    // toJSON() matches Express/JSON.stringify, including invalid dates (null).
    if (data instanceof Date) {
      return data.toJSON();
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeResponse(item));
    }

    const sanitized: Record<string, any> = {};
    const sensitiveKeys = new Set(['password', 'passwordHash', 'token', 'jwt', 'secret', 'refreshToken']);

    for (const [key, value] of Object.entries(data)) {
      if (sensitiveKeys.has(key)) {
        continue;
      }
      sanitized[key] = this.sanitizeResponse(value);
    }
    return sanitized;
  }

  /**
   * Verifies idempotency record matches request context.
   * - If requestHash differs: throws HTTP 409 Conflict (Payload Mismatch).
   * - If userId or endpoint differs: throws HTTP 409 Conflict (Tenant/Endpoint Mismatch).
   */
  verifyRecordMatch(
    record: { userId: string; endpoint: string; requestHash: string; status: string },
    currentUserId: string,
    currentEndpoint: string,
    currentHash: string
  ): void {
    if (record.userId !== currentUserId || record.endpoint !== currentEndpoint) {
      throw new AppError(
        'Khóa Idempotency-Key này đã được sử dụng cho một người dùng hoặc thao tác khác',
        409
      );
    }

    if (record.requestHash !== currentHash) {
      throw new AppError(
        'Phát hiện xung đột Idempotency: Cùng Idempotency-Key nhưng nội dung yêu cầu (payload) đã bị thay đổi',
        409
      );
    }
  }

  /**
   * Computes standard TTL expiration date (default 24 hours).
   */
  getExpirationDate(ttlHours = 24): Date {
    return new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  }

  /**
   * Checks whether an idempotency record has expired.
   */
  isExpired(expiresAt: Date): boolean {
    return new Date() > new Date(expiresAt);
  }

  /**
   * Distinguishes whether a Prisma P2002 error is specifically caused by the idempotency key unique constraint.
   * Prevents false positives where P2002 on another entity (like transactionNumber, serialNumber, code)
   * is incorrectly treated as an idempotency conflict.
   */
  isIdempotencyKeyConflict(err: any): boolean {
    if (!err || err.code !== 'P2002') return false;
    const target = err.meta?.target;
    if (Array.isArray(target) && target.includes('key')) return true;
    if (typeof target === 'string' && target.includes('key')) return true;
    const msg = err.message || '';
    if (msg.includes('idempotency_records_key_key') || msg.includes('(`key`)') || msg.includes('(key)')) return true;
    return false;
  }

  /**
   * Performs precheck for incoming request:
   * - If COMPLETED record exists with matching fingerprint: returns cached response
   * - If PENDING record exists (< 30s): throws 409 Conflict
   * - If mismatch: throws 409 Conflict
   */
  async handlePrecheck(
    key: string,
    userId: string,
    endpoint: string,
    body: any,
    client: any
  ): Promise<{
    action: 'PROCEED' | 'RETURN_CACHED' | 'RETRY_PENDING' | 'RETRY_FAILED';
    cachedResponse?: any;
    statusCode?: number;
    requestHash: string;
    existingRecord?: any;
  }> {
    const requestHash = this.generateFingerprint(userId, endpoint, body);
    const existing = await client.idempotencyRecord.findUnique({ where: { key } });

    if (!existing) {
      return { action: 'PROCEED', requestHash };
    }

    // Verify tenant and payload hash
    this.verifyRecordMatch(existing, userId, endpoint, requestHash);

    if (existing.status === 'COMPLETED') {
      return {
        action: 'RETURN_CACHED',
        cachedResponse: existing.responseBody,
        statusCode: existing.statusCode || 200,
        requestHash,
        existingRecord: existing,
      };
    }

    if (existing.status === 'PENDING') {
      const ageMs = Date.now() - new Date(existing.createdAt).getTime();
      // If request has been pending for less than 30s, treat as actively executing
      if (ageMs < 30000) {
        throw new AppError(
          'Yêu cầu với Idempotency-Key này đang được xử lý, vui lòng chờ trong giây lát',
          409
        );
      }
      // If orphaned PENDING (> 30s), allow retry
      return { action: 'RETRY_PENDING', requestHash, existingRecord: existing };
    }

    if (existing.status === 'FAILED') {
      return { action: 'RETRY_FAILED', requestHash, existingRecord: existing };
    }

    return { action: 'PROCEED', requestHash };
  }
}

export const idempotencyService = new IdempotencyService();
