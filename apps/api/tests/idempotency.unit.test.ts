import { describe, it, expect } from 'vitest';
import { idempotencyService } from '../src/modules/inventory/idempotency.service';
import { AppError } from '../src/shared/AppError';

describe('Idempotency Foundation Unit Test Suite', () => {
  const userId = '11111111-1111-1111-1111-111111111111';
  const endpoint = '/api/v1/inventory/import';

  // ==========================================
  // 1. Key Format Validation
  // ==========================================
  describe('Key Format Validation (validateKey)', () => {
    it('accepts valid UUID v4 and alphanumeric hyphenated keys', () => {
      expect(idempotencyService.validateKey('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(idempotencyService.validateKey('client-req-import-20261011-001')).toBe(true);
      expect(idempotencyService.validateKey('ABC_123_xyz-999')).toBe(true);
    });

    it('rejects keys shorter than 8 characters', () => {
      expect(idempotencyService.validateKey('abc')).toBe(false);
      expect(idempotencyService.validateKey('1234567')).toBe(false);
    });

    it('rejects keys longer than 64 characters', () => {
      const longKey = 'a'.repeat(65);
      expect(idempotencyService.validateKey(longKey)).toBe(false);
    });

    it('rejects keys with invalid characters, spaces, or empty values', () => {
      expect(idempotencyService.validateKey('')).toBe(false);
      expect(idempotencyService.validateKey('   ')).toBe(false);
      expect(idempotencyService.validateKey('key with spaces')).toBe(false);
      expect(idempotencyService.validateKey('key@#$!%')).toBe(false);
      expect(idempotencyService.validateKey(null as any)).toBe(false);
    });
  });

  // ==========================================
  // 2. Canonical JSON Serialization
  // ==========================================
  describe('Canonical JSON Serialization', () => {
    it('produces identical serialized string regardless of property order', () => {
      const obj1 = {
        quantity: 10,
        itemId: 'item-001',
        locationId: 'loc-001',
        notes: 'test',
      };

      const obj2 = {
        notes: 'test',
        locationId: 'loc-001',
        quantity: 10,
        itemId: 'item-001',
      };

      const canonical1 = JSON.stringify(idempotencyService.canonicalize(obj1));
      const canonical2 = JSON.stringify(idempotencyService.canonicalize(obj2));

      expect(canonical1).toBe(canonical2);
    });

    it('recursively canonicalizes nested objects', () => {
      const nested1 = {
        header: { date: '2026-10-11', code: 'TX-01' },
        details: [{ z: 1, a: 2 }],
      };

      const nested2 = {
        details: [{ a: 2, z: 1 }],
        header: { code: 'TX-01', date: '2026-10-11' },
      };

      const canonical1 = JSON.stringify(idempotencyService.canonicalize(nested1));
      const canonical2 = JSON.stringify(idempotencyService.canonicalize(nested2));

      expect(canonical1).toBe(canonical2);
    });

    it('preserves array element ordering', () => {
      const arr1 = { items: [1, 2, 3] };
      const arr2 = { items: [3, 2, 1] };

      const canonical1 = JSON.stringify(idempotencyService.canonicalize(arr1));
      const canonical2 = JSON.stringify(idempotencyService.canonicalize(arr2));

      expect(canonical1).not.toBe(canonical2);
    });
  });

  // ==========================================
  // 3. Request Fingerprint Stability
  // ==========================================
  describe('Request Fingerprint Generation', () => {
    it('generates consistent 64-character SHA256 hex fingerprint for identical payload', () => {
      const body1 = { itemId: 'item-1', quantity: 50 };
      const body2 = { quantity: 50, itemId: 'item-1' };

      const hash1 = idempotencyService.generateFingerprint(userId, endpoint, body1);
      const hash2 = idempotencyService.generateFingerprint(userId, endpoint, body2);

      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(hash2);
    });

    it('generates different fingerprint when userId differs', () => {
      const body = { itemId: 'item-1', quantity: 50 };
      const otherUser = '22222222-2222-2222-2222-222222222222';

      const hash1 = idempotencyService.generateFingerprint(userId, endpoint, body);
      const hash2 = idempotencyService.generateFingerprint(otherUser, endpoint, body);

      expect(hash1).not.toBe(hash2);
    });

    it('generates different fingerprint when endpoint differs', () => {
      const body = { itemId: 'item-1', quantity: 50 };
      const otherEndpoint = '/api/v1/inventory/export';

      const hash1 = idempotencyService.generateFingerprint(userId, endpoint, body);
      const hash2 = idempotencyService.generateFingerprint(userId, otherEndpoint, body);

      expect(hash1).not.toBe(hash2);
    });

    it('generates different fingerprint when body content changes', () => {
      const body1 = { itemId: 'item-1', quantity: 50 };
      const body2 = { itemId: 'item-1', quantity: 51 };

      const hash1 = idempotencyService.generateFingerprint(userId, endpoint, body1);
      const hash2 = idempotencyService.generateFingerprint(userId, endpoint, body2);

      expect(hash1).not.toBe(hash2);
    });
  });

  // ==========================================
  // 4. Record Matching & Payload Mismatch Detection
  // ==========================================
  describe('Record Matching & Mismatch Detection (verifyRecordMatch)', () => {
    const validHash = 'a'.repeat(64);

    it('passes when record userId, endpoint, and requestHash match', () => {
      const record = {
        userId,
        endpoint,
        requestHash: validHash,
        status: 'COMPLETED',
      };

      expect(() =>
        idempotencyService.verifyRecordMatch(record, userId, endpoint, validHash)
      ).not.toThrow();
    });

    it('throws 409 Conflict when request payload differs (hash mismatch)', () => {
      const record = {
        userId,
        endpoint,
        requestHash: validHash,
        status: 'COMPLETED',
      };

      const alteredHash = 'b'.repeat(64);

      expect(() =>
        idempotencyService.verifyRecordMatch(record, userId, endpoint, alteredHash)
      ).toThrow(AppError);

      try {
        idempotencyService.verifyRecordMatch(record, userId, endpoint, alteredHash);
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
        expect(err.message).toMatch(/nội dung yêu cầu \(payload\) đã bị thay đổi/);
      }
    });

    it('throws 409 Conflict when key is reused by another user or endpoint', () => {
      const record = {
        userId,
        endpoint,
        requestHash: validHash,
        status: 'COMPLETED',
      };

      const otherUser = '99999999-9999-9999-9999-999999999999';

      expect(() =>
        idempotencyService.verifyRecordMatch(record, otherUser, endpoint, validHash)
      ).toThrow(AppError);
    });
  });

  // ==========================================
  // 5. Response Sanitization
  // ==========================================
  describe('Response Sanitization (sanitizeResponse)', () => {
    it('strips password, passwordHash, and token fields before caching', () => {
      const dirtyResponse = {
        id: 'tx-123',
        transactionNumber: 'TX-20261011-001',
        token: 'secret-jwt-token',
        user: {
          id: 'user-1',
          fullName: 'Test User',
          passwordHash: 'argon2-hash-value',
          secret: 'internal-secret',
        },
      };

      const sanitized = idempotencyService.sanitizeResponse(dirtyResponse);

      expect(sanitized.id).toBe('tx-123');
      expect(sanitized.transactionNumber).toBe('TX-20261011-001');
      expect(sanitized.user.fullName).toBe('Test User');
      expect(sanitized.token).toBeUndefined();
      expect(sanitized.user.passwordHash).toBeUndefined();
      expect(sanitized.user.secret).toBeUndefined();
    });
  });

  // ==========================================
  // Phase 11D -- cached HTTP response must match original JSON.
  // ==========================================
  describe('Date-safe response caching (Phase 11D)', () => {
    it('preserves nested Prisma Dates as ISO strings in the cached borrow return response', () => {
      const original = {
        returnNumber: 'RT-20261023-TEST',
        borrowRequest: {
          id: 'borrow-test',
          createdAt: new Date('2026-10-23T14:37:16.993Z'),
          updatedAt: new Date('2026-10-23T14:37:17.119Z'),
          details: [{ updatedAt: new Date('2026-10-23T14:37:17.110Z') }],
          reservations: [{ createdAt: new Date('2026-10-23T14:37:17.025Z') }],
          returnTransactions: [{
            createdAt: new Date('2026-10-23T14:37:17.099Z'),
            details: [{ createdAt: new Date('2026-10-23T14:37:17.102Z') }],
          }],
        },
      };
      const cached = idempotencyService.sanitizeResponse(original);
      expect(cached).toEqual(JSON.parse(JSON.stringify(original)));
      expect(cached.borrowRequest.createdAt).toBe('2026-10-23T14:37:16.993Z');
      expect(cached.borrowRequest.returnTransactions[0].details[0].createdAt)
        .toBe('2026-10-23T14:37:17.102Z');
    });

    it('preserves sensitive-field sanitization and JSON null for invalid Dates', () => {
      const sanitized = idempotencyService.sanitizeResponse({
        createdAt: new Date(Number.NaN),
        user: { token: 'SECRET', passwordHash: 'HASH',
          updatedAt: new Date('2026-10-23T00:00:00.000Z') },
        rows: [{ secret: 'HIDDEN', createdAt: new Date('2026-10-22T00:00:00.000Z') }],
      });
      expect(sanitized).toEqual({
        createdAt: null,
        user: { updatedAt: '2026-10-23T00:00:00.000Z' },
        rows: [{ createdAt: '2026-10-22T00:00:00.000Z' }],
      });
    });
  });

  // ==========================================
  // 6. TTL & Expiration Logic
  // ==========================================
  describe('TTL & Expiration Logic', () => {
    it('calculates correct expiration date in the future', () => {
      const now = Date.now();
      const expiresAt = idempotencyService.getExpirationDate(24);

      expect(expiresAt.getTime()).toBeGreaterThan(now + 23 * 60 * 60 * 1000);
      expect(idempotencyService.isExpired(expiresAt)).toBe(false);
    });

    it('detects past dates as expired', () => {
      const pastDate = new Date(Date.now() - 1000);
      expect(idempotencyService.isExpired(pastDate)).toBe(true);
    });
  });
});
