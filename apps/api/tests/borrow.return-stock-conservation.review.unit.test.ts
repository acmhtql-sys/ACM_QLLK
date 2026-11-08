import { describe, expect, it } from 'vitest';
import {
  availableForReview,
  planGoodQcRelease,
  planQuarantineFirstPhysicalReturn,
  planQuarantineFirstBatchForReview,
  type ReviewStockBalance,
} from '../src/modules/borrow/borrow.return-stock-conservation.review';
import type { QuarantineOnlyDisposition } from '../src/modules/borrow/borrow.return-commit-preflight.policy';

const initial = (): ReviewStockBalance => ({
  onHand: 10, borrowed: 7, quarantined: 2, reserved: 3, kitAllocated: 1,
});

const received = (condition: 'GOOD' | 'DAMAGED', qty = 4): QuarantineOnlyDisposition => ({
  borrowDetailId: '11111111-1111-4111-8111-111111111111',
  returnedQuantity: qty,
  condition,
  disposition: condition === 'GOOD' ? 'QUARANTINE_PENDING_QC' : 'QUARANTINE_DAMAGED',
  availableStockCreditAllowedAtCommit: false,
});

const approvedQc = () => ({
  role: 'LAB_MANAGER', committed: true, condition: 'GOOD',
  evidenceVerified: true, qcApprovedAt: '2026-11-08T03:30:00Z',
});

describe('Stage4C DBA proposal: pure stock conservation (NO WRITER/SQL)', () => {
  it('STOCK-01: GOOD receipt enters quarantine and availability does not increase', () => {
    const plan = planQuarantineFirstPhysicalReturn(initial(), received('GOOD'));
    expect(plan.before).toEqual(initial());
    expect(plan.after).toEqual({
      onHand: 14, borrowed: 3, quarantined: 6, reserved: 3, kitAllocated: 1,
    });
    expect(plan.availableBefore).toBe(4);
    expect(plan.availableAfter).toBe(4);
  });

  it('STOCK-02: DAMAGED receipt enters quarantine with no available credit', () => {
    const plan = planQuarantineFirstPhysicalReturn(initial(), received('DAMAGED'));
    expect(plan.after.quarantined).toBe(6);
    expect(plan.after.onHand).toBe(14);
    expect(plan.availableAfter).toBe(plan.availableBefore);
  });

  it('STOCK-03: a separately approved GOOD QC releases quarantine, not onHand twice', () => {
    const first = planQuarantineFirstPhysicalReturn(initial(), received('GOOD'));
    const second = planGoodQcRelease(first.after, 4, approvedQc());
    expect(second.after).toEqual({
      onHand: 14, borrowed: 3, quarantined: 2, reserved: 3, kitAllocated: 1,
    });
    expect(second.availableBefore).toBe(4);
    expect(second.availableAfter).toBe(8);
    expect(second.after.onHand).toBe(first.after.onHand);
  });

  it('STOCK-04: original snapshot and input disposition are not mutated', () => {
    const before = initial();
    const disposition = received('GOOD');
    const result = planQuarantineFirstPhysicalReturn(before, disposition);
    result.after.onHand = 999;
    expect(before).toEqual(initial());
    expect(disposition.returnedQuantity).toBe(4);
  });

  it('STOCK-05: overreturn and zero/negative/fractional quantity fail closed', () => {
    for (const q of [0, -1, 1.5, 8, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => planQuarantineFirstPhysicalReturn(initial(), received('GOOD', q))).toThrow();
    }
  });

  it('STOCK-06: only approved quarantine disposition is accepted', () => {
    const wrong = { ...received('GOOD'), disposition: 'AVAILABLE_NOW' };
    expect(() => planQuarantineFirstPhysicalReturn(initial(),
      wrong as unknown as QuarantineOnlyDisposition)).toThrow();
    const wrongCredit = { ...received('GOOD'), availableStockCreditAllowedAtCommit: true };
    expect(() => planQuarantineFirstPhysicalReturn(initial(),
      wrongCredit as unknown as QuarantineOnlyDisposition)).toThrow();
    expect(() => planQuarantineFirstPhysicalReturn(initial(),
      { ...received('GOOD'), condition: 'LOST' } as unknown as QuarantineOnlyDisposition)).toThrow();
  });

  it('STOCK-07: corrupted negative or overallocated balance must not be clamped', () => {
    for (const bad of [
      { ...initial(), quarantined: -1 },
      { ...initial(), reserved: 20 },
      { ...initial(), borrowed: NaN },
      { ...initial(), onHand: 1.25 },
      { ...initial(), onHand: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(() => availableForReview(bad)).toThrow();
      expect(() => planQuarantineFirstPhysicalReturn(bad, received('GOOD'))).toThrow();
    }
  });

  it('STOCK-08: integer overflow cannot create an invalid physical balance', () => {
    const nearLimit: ReviewStockBalance = {
      onHand: Number.MAX_SAFE_INTEGER, borrowed: 1,
      quarantined: 0, reserved: 0, kitAllocated: 0,
    };
    expect(() => planQuarantineFirstPhysicalReturn(nearLimit, received('GOOD', 1))).toThrow();
  });

  it('STOCK-09: malformed input and incompatible accounting shape fail closed', () => {
    expect(() => availableForReview(null as unknown as ReviewStockBalance)).toThrow();
    expect(() => planQuarantineFirstPhysicalReturn(initial(), null as unknown as QuarantineOnlyDisposition)).toThrow();
    expect(() => planGoodQcRelease(initial(), 0, approvedQc())).toThrow();
  });

  it('QC-10: unauthorized or missing evidence/approval denies release', () => {
    for (const qc of [
      { ...approvedQc(), role: 'TECHNICIAN' },
      { ...approvedQc(), committed: false },
      { ...approvedQc(), evidenceVerified: false },
      { ...approvedQc(), qcApprovedAt: null },
      { ...approvedQc(), condition: 'DAMAGED' },
    ]) {
      expect(() => planGoodQcRelease({ ...initial(), quarantined: 5 }, 2, qc)).toThrow();
    }
  });

  it('QC-11: cannot release more than the quarantined balance', () => {
    expect(() => planGoodQcRelease(initial(), 3, approvedQc())).toThrow();
  });

  it('QC-12: a QC plan alone is not durable once-only proof', () => {
    const first = planQuarantineFirstPhysicalReturn(initial(), received('GOOD'));
    const valid = planGoodQcRelease(first.after, 4, approvedQc());
    // This is intentionally a risk demonstration: if another unrelated batch
    // left 4 quarantined, a balance-only plan could release twice. The actual
    // DB writer MUST enforce per-receipt immutable QC posting identity.
    const unrelated = { ...valid.after, quarantined: 8, onHand: 20 };
    expect(() => planGoodQcRelease(unrelated, 4, approvedQc())).not.toThrow();
  });
});


const STOCK_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STOCK_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DETAIL_B = '22222222-2222-4222-8222-222222222222';
const DETAIL_C = '33333333-3333-4333-8333-333333333333';

describe('Stage4C DBA proposal: deterministic MULTI-LINE batch preflight (UNWIRED)', () => {
  const bucket = (stockBalanceId: string, borrowed = 5) => ({
    stockBalanceId,
    balance: { ...initial(), borrowed },
  });
  const assignment = (stockBalanceId: string, detailId: string, qty: number) => ({
    stockBalanceId,
    disposition: { ...received('GOOD', qty), borrowDetailId: detailId },
  });

  it('BATCH-01: two details sharing a balance consume one evolving snapshot, never increase available', () => {
    const balances = [bucket(STOCK_A)];
    const items = [assignment(STOCK_A, DETAIL_B, 2), assignment(STOCK_A, DETAIL_C, 3)];
    const plan = planQuarantineFirstBatchForReview(balances, items);
    expect(plan).toHaveLength(1);
    expect(plan[0].after.borrowed).toBe(0);
    expect(plan[0].after.onHand).toBe(15);
    expect(plan[0].after.quarantined).toBe(7);
    expect(plan[0].availableBefore).toBe(plan[0].availableAfter);
    expect(balances[0].balance).toEqual({ ...initial(), borrowed: 5 });
    expect(items[0].disposition.returnedQuantity).toBe(2);
  });

  it('BATCH-02: two individually-valid lines may exceed the SHARED balance in aggregate', () => {
    const lines = [assignment(STOCK_A, DETAIL_B, 3), assignment(STOCK_A, DETAIL_C, 3)];
    expect(() => planQuarantineFirstPhysicalReturn(initial(), lines[0].disposition)).not.toThrow();
    expect(() => planQuarantineFirstBatchForReview([bucket(STOCK_A)], lines)).toThrow();
  });

  it('BATCH-03: rejects duplicate detail even if routed through different balances', () => {
    expect(() => planQuarantineFirstBatchForReview(
      [bucket(STOCK_A), bucket(STOCK_B)], [
        assignment(STOCK_A, DETAIL_B, 1),
        assignment(STOCK_B, DETAIL_B.toUpperCase(), 1),
      ])).toThrow();
  });

  it('BATCH-04: rejects duplicate balance keys and unknown balance references', () => {
    expect(() => planQuarantineFirstBatchForReview(
      [bucket(STOCK_A), bucket(STOCK_A.toUpperCase())],
      [assignment(STOCK_A, DETAIL_B, 1)])).toThrow();
    expect(() => planQuarantineFirstBatchForReview(
      [bucket(STOCK_A)], [assignment(STOCK_B, DETAIL_B, 1)])).toThrow();
  });

  it('BATCH-05: order-independent totals and stable output with two balances', () => {
    const buckets = [bucket(STOCK_B, 4), bucket(STOCK_A, 5)];
    const lines = [
      assignment(STOCK_B, DETAIL_C, 2),
      assignment(STOCK_A, DETAIL_B, 3),
    ];
    const actual = planQuarantineFirstBatchForReview(buckets, lines);
    expect(actual).toEqual(planQuarantineFirstBatchForReview([...buckets].reverse(), [...lines].reverse()));
    expect(actual.map(x => x.stockBalanceId)).toEqual([STOCK_A, STOCK_B]);
    expect(actual.map(x => x.after.borrowed)).toEqual([2, 2]);
  });

  it('BATCH-06: malformed, missing, LOST, and unsafe arithmetic all fail closed', () => {
    const input = [assignment(STOCK_A, DETAIL_B, 1)];
    expect(() => planQuarantineFirstBatchForReview([], input)).toThrow();
    expect(() => planQuarantineFirstBatchForReview([bucket(STOCK_A)], [])).toThrow();
    expect(() => planQuarantineFirstBatchForReview([bucket(STOCK_A)],
      [assignment('bad', DETAIL_B, 1)])).toThrow();
    expect(() => planQuarantineFirstBatchForReview([bucket(STOCK_A)],
      [assignment(STOCK_A, 'bad', 1)])).toThrow();
    expect(() => planQuarantineFirstBatchForReview([bucket(STOCK_A)],
      [{ ...input[0], disposition: { ...received('GOOD', 1), borrowDetailId: DETAIL_B, condition: 'LOST' } } as never])).toThrow();
    const overflowing = {
      stockBalanceId: STOCK_A,
      balance: {
        onHand: Number.MAX_SAFE_INTEGER, borrowed: 1, quarantined: 0,
        reserved: 0, kitAllocated: 0,
      },
    };
    expect(() => planQuarantineFirstBatchForReview([overflowing],
      [assignment(STOCK_A, DETAIL_B, 1)])).toThrow();
  });
});
