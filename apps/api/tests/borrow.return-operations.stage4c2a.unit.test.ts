import { describe, expect, it, vi } from 'vitest';
import {
  returnOperationCutoverRequested,
  assertLegacyReturnWriteAllowed,
  rejectUnreleasedReturnOperations,
  canonicalReturnOperationPayload,
  hashReturnOperationPayload,
  assertOperationSnapshotConsistent,
  nextOperationPolicy,
  assertPhysicalEvidenceReference,
} from '../src/modules/borrow/borrow.return-operation-foundation';

const id = '11111111-1111-4111-8111-111111111111';
const borrow = '22222222-2222-4222-8222-222222222222';
const detail2 = '33333333-3333-4333-8333-333333333333';
const resultId = '44444444-4444-4444-8444-444444444444';
const line = { borrowDetailId: id, returnedQuantity: 2, condition: 'GOOD' as const };
const op = {
  id, borrowRequestId: borrow, state: 'PREPARED', returnTransactionId: null,
  returnNumber: null, completedAt: null, cancelledAt: null, cancelReason: null,
};

// All tests use pure functions: zero database, HTTP or file-system accesses.
describe('Phase 11D Stage 4C-2A — inert operation foundation', () => {
  it('OP-F01: cutover flag is off unless exactly "true"', () => {
    vi.stubEnv('ACM_RETURN_OPERATIONS_ENABLED', 'false');
    try {
      for (const flag of [undefined, '', 'false', 'TRUE', '1', ' true ']) {
        expect(returnOperationCutoverRequested(flag)).toBe(false);
      }
      expect(returnOperationCutoverRequested('true')).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('OP-F02: legacy write path remains available when flag off', () => {
    expect(() => assertLegacyReturnWriteAllowed('false')).not.toThrow();
  });
  it('OP-F03: legacy service cannot write when cutover requested', () => {
    expect(() => assertLegacyReturnWriteAllowed('true')).toThrow(/khóa/);
  });
  it('OP-F04: incomplete new endpoints fail closed even if flag on', () => {
    expect(() => rejectUnreleasedReturnOperations()).toThrow(/chưa được phát hành/);
  });
  it('OP-F05: snapshot has deterministic canonical order and fields', () => {
    const a = { items: [{ ...line, notes: null }, { ...line, borrowDetailId: detail2, condition: 'LOST' }] };
    const b = { items: [...a.items].reverse(), notes: null };
    expect(canonicalReturnOperationPayload(a)).toEqual(canonicalReturnOperationPayload(b));
    expect(hashReturnOperationPayload(a)).toBe(hashReturnOperationPayload(b));
  });
  it('OP-F06: changed quantity yields a different server-side hash', () => {
    expect(hashReturnOperationPayload({ items: [line] })).not.toBe(
      hashReturnOperationPayload({ items: [{...line, returnedQuantity: 3}] })
    );
  });
  it('OP-F07: rejects repeated borrow detail even across letter case', () => {
    expect(() => canonicalReturnOperationPayload({ items: [line, {...line, borrowDetailId: id.toUpperCase()}] })).toThrow();
  });
  it('OP-F08: rejects zero, negative, fractional or unsafe quantities', () => {
    for (const returnedQuantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => canonicalReturnOperationPayload({items: [{...line, returnedQuantity}]})).toThrow();
    }
  });
  it('OP-F09: rejects malformed IDs, conditions and extra properties', () => {
    for (const bad of [
      {...line, borrowDetailId: 'invalid'}, {...line, condition: 'OTHER'},
      {...line, payload: 'unrecognized'}, {...line, locationId: 'bad'},
    ]) expect(() => canonicalReturnOperationPayload({items:[bad]})).toThrow();
    expect(() => canonicalReturnOperationPayload({items:[line], state:'COMPLETED'})).toThrow();
  });
  it('OP-F10: PREPARED is a valid persisted intent, not a receipt', () => {
    expect(() => assertOperationSnapshotConsistent(op)).not.toThrow();
  });
  it('OP-F11: PREPARED carrying a result must be blocked', () => {
    expect(() => assertOperationSnapshotConsistent({ ...op, returnTransactionId: resultId })).toThrow();
  });
  it('OP-F12: completed operation requires exact receipt fields', () => {
    const completed = { ...op, state: 'COMPLETED', returnTransactionId: resultId,
      completedAt: '2026-10-24T04:00:00Z', returnNumber: 'RT-20261024-001' };
    expect(() => assertOperationSnapshotConsistent(completed)).not.toThrow();
    expect(() => assertOperationSnapshotConsistent({...completed, returnNumber:''})).toThrow();
    expect(() => assertOperationSnapshotConsistent({...completed, returnTransactionId:null})).toThrow();
  });
  it('OP-F13: cancelled operation requires reason and timestamp', () => {
    const cancelled = { ...op, state:'CANCELLED', cancelledAt:'2026-10-24T04:00:00Z', cancelReason:'Confirmed no handover' };
    expect(() => assertOperationSnapshotConsistent(cancelled)).not.toThrow();
    expect(() => assertOperationSnapshotConsistent({...cancelled,cancelReason:''})).toThrow();
  });
  it('OP-F14: unknown states always fail closed', () => {
    expect(() => assertOperationSnapshotConsistent({...op,state:'PROCESSING'})).toThrow();
  });
  it('OP-F15: unresolved operation blocks a new operation', () => {
    expect(nextOperationPolicy('PREPARED')).toBe('BLOCKED');
    expect(nextOperationPolicy('RECONCILIATION_REQUIRED')).toBe('BLOCKED');
  });
  it('OP-F16: terminal operation still requires independent physical-evidence review', () => {
    expect(nextOperationPolicy('COMPLETED')).toBe('PHYSICAL_EVIDENCE_REVIEW');
    expect(nextOperationPolicy('CANCELLED')).toBe('PHYSICAL_EVIDENCE_REVIEW');
  });
});

// Stage 4C-2B candidate evidence format tests (structural only; no issuer verification).
describe('Stage 4C-2B — physical evidence structural checks', () => {
  it('MIG-F01: accepts a nonempty canonical evidence identifier', () => {
    expect(assertPhysicalEvidenceReference('BB-2026-001')).toBe('BB-2026-001');
  });
  it('MIG-F02: rejects null, missing or blank physical evidence', () => {
    for (const value of [null, undefined, '', ' ', '\n']) {
      expect(() => assertPhysicalEvidenceReference(value)).toThrow();
    }
  });
  it('MIG-F03: rejects leading/trailing whitespace and control chars', () => {
    for (const value of [' A', 'A ', 'A\nB', 'A\u0000B']) {
      expect(() => assertPhysicalEvidenceReference(value)).toThrow();
    }
  });
  it('MIG-F04: rejects references exceeding 128 UTF-16 units', () => {
    expect(() => assertPhysicalEvidenceReference('X'.repeat(129))).toThrow();
  });
  it('MIG-F05: never lowercases or rewrites evidence identifiers', () => {
    expect(assertPhysicalEvidenceReference('evidence-01')).toBe('evidence-01');
  });
  it('MIG-F06: a syntactically valid code is NOT proof of physical handover', () => {
    // Issuer validation and independent verification are explicit release gates,
    // and this foundation intentionally exposes no "verified" indicator.
    expect(assertPhysicalEvidenceReference('UNVERIFIED')).toBe('UNVERIFIED');
  });
});
