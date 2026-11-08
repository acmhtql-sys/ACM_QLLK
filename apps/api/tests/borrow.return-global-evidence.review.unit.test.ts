import { describe, expect, it } from 'vitest';
import {
  assertGlobalEvidenceSnapshotConsistentReviewOnly,
  canonicalEvidenceKeyReviewOnly,
} from '../src/modules/borrow/borrow.return-global-evidence.review';

const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';
const idC = '33333333-3333-4333-8333-333333333333';
const borrowA = '44444444-4444-4444-8444-444444444444';
const borrowB = '55555555-5555-4555-8555-555555555555';
const example = (operationId: string, borrowRequestId: string,
  physicalEvidenceRef: string, state = 'COMPLETED') => ({
  operationId, borrowRequestId, physicalEvidenceRef, state,
});

const check = assertGlobalEvidenceSnapshotConsistentReviewOnly;

// 100% PURE, offline, no SQL/DB/network. DBA must still choose actual UNIQUE DDL.
describe('Stage4C G03 global evidence namespace — review-only policy', () => {
  it('G03-R01: canonical comparison is case-insensitive without changing source display', () => {
    expect(canonicalEvidenceKeyReviewOnly('ACM-001')).toBe('acm-001');
    expect(canonicalEvidenceKeyReviewOnly('acm-001')).toBe('acm-001');
    expect(canonicalEvidenceKeyReviewOnly('AcM._:/-9')).toBe('acm._:/-9');
  });

  it('G03-R02: invalid ASCII evidence format fails without reflecting input', () => {
    const unsafe = 'ACM-🔐-001';
    expect(() => canonicalEvidenceKeyReviewOnly(unsafe)).toThrow('Dữ liệu chứng từ cần đối soát');
    try { canonicalEvidenceKeyReviewOnly(unsafe); }
    catch (err) {
      expect(String(err)).not.toContain(unsafe);
      expect(err).toMatchObject({ statusCode: 409 });
    }
  });

  it('G03-R03: unrelated operations with distinct references pass only snapshot checks', () => {
    expect(() => check([
      example(idA, borrowA, 'ACM-001'),
      example(idB, borrowB, 'ACM-002'),
    ])).not.toThrow();
  });

  it('G03-R04: duplicate case-insensitive reference across different borrows is rejected', () => {
    expect(() => check([
      example(idA, borrowA, 'ACM-001'),
      example(idB, borrowB, 'acm-001'),
    ])).toThrow('Dữ liệu chứng từ cần đối soát');
  });

  it('G03-R05: one borrow, two partial return operations cannot share a code', () => {
    expect(() => check([
      example(idA, borrowA, 'BB-2026-001'),
      example(idB, borrowA, 'bb-2026-001'),
    ])).toThrow();
  });

  it('G03-R06: CANCELLED consumes its issued code forever', () => {
    expect(() => check([
      example(idA, borrowA, 'ACM-RETIRED', 'CANCELLED'),
      example(idB, borrowB, 'acm-retired', 'PREPARED'),
    ])).toThrow();
    expect(() => check([
      example(idA, borrowA, 'ACM-RETIRED', 'CANCELLED'),
      example(idB, borrowB, 'ACM-NEW', 'PREPARED'),
    ])).not.toThrow();
  });

  it('G03-R07: RECONCILIATION_REQUIRED also reserves its code', () => {
    expect(() => check([
      example(idA, borrowA, 'ACM-RECON', 'RECONCILIATION_REQUIRED'),
      example(idB, borrowB, 'acm-recon', 'COMPLETED'),
    ])).toThrow();
  });

  it('G03-R08: different references for one operation are not two legitimate returns', () => {
    expect(() => check([
      example(idA, borrowA, 'ACM-001'),
      example(idA, borrowA, 'ACM-002'),
    ])).toThrow();
  });

  it('G03-R09: even duplicate identical operation rows fail as ambiguous review data', () => {
    expect(() => check([
      example(idA, borrowA, 'ACM-001'),
      example(idA.toUpperCase(), borrowA, 'acm-001'),
    ])).toThrow();
  });

  it('G03-R10: malformed and coerced snapshots fail closed', () => {
    const valid = example(idA, borrowA, 'ACM-001');
    for (const bad of [
      null, {}, 'ACM-001', [null], [valid, []],
      [{ ...valid, operationId: null }],
      [{ ...valid, borrowRequestId: 'not-uuid' }],
      [{ ...valid, state: ['CANCELLED'] }],
      [{ ...valid, state: 'PENDING' }],
      [{ ...valid, physicalEvidenceRef: ['ACM-001'] }],
      [{ ...valid, physicalEvidenceRef: 'ACM 001' }],
    ]) expect(() => check(bad)).toThrow();
  });

  it('G03-R11: output never exposes conflicting references or lab/borrow ids', () => {
    try {
      check([example(idA, borrowA, 'ACM-SENSITIVE'), example(idB, borrowB, 'acm-sensitive')]);
      throw new Error('Expected a collision');
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 409 });
      expect(String(err)).not.toContain('ACM-SENSITIVE');
      expect(String(err)).not.toContain(borrowA);
      expect(String(err)).not.toContain(borrowB);
    }
  });

  it('G03-R12: zero rows cannot prove uniqueness; helper does not authorize issuance', () => {
    expect(() => check([])).not.toThrow();
    // Pure review snapshot; only approved DB UNIQUE and writer transaction can
    // authorize issuing a previously unseen global physical evidence code.
  });

  it('G03-R13: a snapshot rejects duplicate operation rows; replay remains unproven', () => {
    // The original operation is stored once. Reading the same receipt/key
    // twice is a read, NOT a second operation row/code allocation.
    expect(() => check([example(idC, borrowB, 'ACM-REPLAY')])).not.toThrow();
    // Passing duplicate operation rows is ambiguous, not proof of safe replay.
    expect(() => check([
      example(idC, borrowB, 'ACM-REPLAY'),
      example(idC, borrowB, 'ACM-REPLAY'),
    ])).toThrow();
  });
});
