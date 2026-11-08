import { describe, expect, it } from 'vitest';
import {
  planOneTimeGoodQcRelease,
  type TrustedQcReceiptLineSnapshot,
} from '../src/modules/borrow/borrow.return-qc-claim.review';
import type { ReviewStockBalance } from '../src/modules/borrow/borrow.return-stock-conservation.review';

const LINE = '11111111-1111-4111-8111-111111111111';
const LOCATION = '22222222-2222-4222-8222-222222222222';

const balance = (): ReviewStockBalance => ({
  onHand: 20, borrowed: 2, quarantined: 9, reserved: 3, kitAllocated: 1,
});
const receipt = (changes: Partial<TrustedQcReceiptLineSnapshot> = {}): TrustedQcReceiptLineSnapshot => ({
  receiptDetailId: LINE, sourceLocationId: LOCATION,
  condition: 'GOOD', committedQuantity: 4, alreadyQcReleasedQuantity: 0,
  qcClaimStatus: 'ABSENT', ...changes,
});
const qc = () => ({
  role: 'LAB_MANAGER', committed: true, condition: 'GOOD',
  qcApprovedAt: '2026-11-08T03:30:00Z', evidenceVerified: true,
});

describe('DBA review: immutable per-receipt QC claim proposal (NO SQL/HTTP)', () => {
  it('QC-CLAIM-01: releases only the exact receipt quantity once in full, not physical onHand', () => {
    const plan = planOneTimeGoodQcRelease(balance(), receipt(), qc());
    expect(plan.claimKey).toBe(LINE + ':QC_RELEASE');
    expect(plan.receiptDetailId).toBe(LINE);
    expect(plan.releaseQuantity).toBe(4);
    expect(plan.proposedReleasedQuantity).toBe(4);
    expect(plan.onHandDelta).toBe(0);
    expect(plan.quarantinedDelta).toBe(-4);
    expect(plan.availableAfter - plan.availableBefore).toBe(4);
    expect(plan.after.onHand).toBe(20);
    expect(plan.after.quarantined).toBe(5);
  });

  it('QC-CLAIM-02: same receipt cannot be planned when claim has been COMMITTED', () => {
    expect(() => planOneTimeGoodQcRelease(balance(), receipt({
      qcClaimStatus: 'COMMITTED', alreadyQcReleasedQuantity: 4,
    }), qc())).toThrow(/đã có hoặc đang ghi nhận/);
  });

  it('QC-CLAIM-03: simultaneous in-progress claim is blocked in trusted snapshot', () => {
    expect(() => planOneTimeGoodQcRelease(balance(), receipt({
      qcClaimStatus: 'IN_PROGRESS',
    }), qc())).toThrow();
  });

  it('QC-CLAIM-04: partially released receipt is not silently topped up', () => {
    expect(() => planOneTimeGoodQcRelease(balance(), receipt({
      alreadyQcReleasedQuantity: 2,
    }), qc())).toThrow();
  });

  it('QC-CLAIM-05: different receipt IDs yield different future unique keys', () => {
    const second = '33333333-3333-4333-8333-333333333333';
    const a = planOneTimeGoodQcRelease(balance(), receipt(), qc());
    const b = planOneTimeGoodQcRelease(balance(), receipt({ receiptDetailId: second }), qc());
    expect(a.claimKey).not.toBe(b.claimKey);
  });

  it('QC-CLAIM-06: receipt key case is normalized for deterministic DB proposal', () => {
    const out = planOneTimeGoodQcRelease(balance(), receipt({
      receiptDetailId: LINE.toUpperCase(),
    }), qc());
    expect(out.claimKey).toBe(LINE + ':QC_RELEASE');
  });

  it('QC-CLAIM-07: DAMAGED and LOST receipts cannot be QC-released as GOOD', () => {
    for (const condition of ['DAMAGED', 'LOST'] as const) {
      expect(() => planOneTimeGoodQcRelease(balance(), receipt({ condition }), qc())).toThrow();
    }
  });

  it('QC-CLAIM-08: missing authorization, approval, or confirmed posting is denied', () => {
    for (const changed of [
      { ...qc(), role: 'TECHNICIAN' },
      { ...qc(), committed: false },
      { ...qc(), evidenceVerified: false },
      { ...qc(), qcApprovedAt: null },
      { ...qc(), condition: 'DAMAGED' },
    ]) {
      expect(() => planOneTimeGoodQcRelease(balance(), receipt(), changed)).toThrow();
    }
  });

  it('QC-CLAIM-09: forged or malformed identifiers and corrupted counters are rejected', () => {
    for (const changed of [
      { receiptDetailId: '../../other' },
      { sourceLocationId: 'not-uuid' },
      { committedQuantity: 0 },
      { committedQuantity: Number.MAX_SAFE_INTEGER + 1 },
      { alreadyQcReleasedQuantity: -1 },
      { alreadyQcReleasedQuantity: 5 },
      { qcClaimStatus: 'UNKNOWN' as TrustedQcReceiptLineSnapshot['qcClaimStatus'] },
    ]) {
      expect(() => planOneTimeGoodQcRelease(balance(), receipt(changed), qc())).toThrow();
    }
  });

  it('QC-CLAIM-10: unrelated quarantine cannot substitute for receipt quantity', () => {
    expect(() => planOneTimeGoodQcRelease({
      ...balance(), quarantined: 3,
    }, receipt(), qc())).toThrow(/cách ly không đủ/);
  });

  it('QC-CLAIM-11: original receipt and balance are not mutated', () => {
    const b = balance();
    const line = receipt();
    const out = planOneTimeGoodQcRelease(b, line, qc());
    out.after.quarantined = 999;
    expect(b.quarantined).toBe(9);
    expect(line.alreadyQcReleasedQuantity).toBe(0);
  });

  it('QC-CLAIM-12: two stale processes derive same deterministic key — DB unique index still required', () => {
    const a = planOneTimeGoodQcRelease(balance(), receipt(), qc());
    const b = planOneTimeGoodQcRelease(balance(), receipt(), qc());
    expect(a.claimKey).toBe(b.claimKey);
    // BOTH pass the same stale snapshot. Only a DB UNIQUE constraint +
    // transaction lock can ensure once-only posting and audit.
  });
});
