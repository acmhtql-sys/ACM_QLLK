import { describe, expect, it } from 'vitest';
import { planJoinedStage4CPostingForReview } from
  '../src/modules/borrow/borrow.return-joined-posting.review';
import type { TrustedStage4CCommitFacts } from
  '../src/modules/borrow/borrow.return-commit-preflight.policy';
import type { ReviewLockedBorrowAllocation, ReviewLockedStockBucket } from
  '../src/modules/borrow/borrow.return-joined-posting.review';

const BORROW = '11111111-1111-4111-8111-111111111111';
const DETAIL_A = 'a2222222-2222-4222-8222-222222222222';
const DETAIL_B = '33333333-3333-4333-8333-333333333333';
const SOURCE = '44444444-4444-4444-8444-444444444444';
const ITEM = 'c5555555-5555-4555-8555-555555555555';
const STOCK = 'b6666666-6666-4666-8666-666666666666';
const RECEIVER = '77777777-7777-4777-8777-777777777777';
const VERIFIER = '88888888-8888-4888-8888-888888888888';
const OTHER = '99999999-9999-4999-8999-999999999999';

const trusted = (): TrustedStage4CCommitFacts => ({
  operationState: 'PREPARED',
  borrowRequestId: BORROW,
  operationBorrowRequestId: BORROW,
  evidenceReference: 'ACM-RET-2026-001',
  receivedByActorId: RECEIVER, receivedAt: '2026-11-08T02:00:00Z',
  verifiedByActorId: VERIFIER, verifiedAt: '2026-11-08T02:05:00Z',
  verifierRole: 'LAB_MANAGER', committerRole: 'ADMIN',
  payload: { items: [
    { borrowDetailId: DETAIL_A, returnedQuantity: 2, condition: 'GOOD', locationId: SOURCE },
    { borrowDetailId: DETAIL_B, returnedQuantity: 3, condition: 'DAMAGED', locationId: SOURCE },
  ] },
  borrowLines: [
    { borrowDetailId: DETAIL_A, originalQuantity: 4, alreadyReturnedQuantity: 0, sourceLocationId: SOURCE },
    { borrowDetailId: DETAIL_B, originalQuantity: 3, alreadyReturnedQuantity: 0, sourceLocationId: SOURCE },
  ],
});

const allocations = (): ReviewLockedBorrowAllocation[] => [
  { borrowDetailId: DETAIL_A, stockBalanceId: STOCK, itemId: ITEM,
    sourceLocationId: SOURCE, originalQuantity: 4, alreadyReturnedQuantity: 0 },
  { borrowDetailId: DETAIL_B, stockBalanceId: STOCK, itemId: ITEM,
    sourceLocationId: SOURCE, originalQuantity: 3, alreadyReturnedQuantity: 0 },
];
const buckets = (): ReviewLockedStockBucket[] => [{
  stockBalanceId: STOCK, itemId: ITEM, locationId: SOURCE,
  balance: { onHand: 10, borrowed: 6, quarantined: 2, reserved: 1, kitAllocated: 1 },
}];

describe('Stage4C review-only joined posting plan — NO DB/HTTP/WRITER', () => {
  it('JOIN-01: two receipt lines share one changing physical stock balance', () => {
    const result = planJoinedStage4CPostingForReview(trusted(), allocations(), buckets());
    expect(result.dispositions).toHaveLength(2);
    expect(result.dispositions.every(d => d.availableStockCreditAllowedAtCommit === false)).toBe(true);
    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]).toMatchObject({
      stockBalanceId: STOCK,
      after: { onHand: 15, borrowed: 1, quarantined: 7, reserved: 1, kitAllocated: 1 },
      availableBefore: 6, availableAfter: 6,
      borrowDetailIds: [DETAIL_B, DETAIL_A], // Canonical UUID lexical order: '3' before 'a'
    });
  });

  it('JOIN-02: individual lines pass, aggregate overreturn at same balance fails', () => {
    const f = trusted();
    f.payload = { items: [
      { borrowDetailId: DETAIL_A, returnedQuantity: 4, condition: 'GOOD', locationId: SOURCE },
      { borrowDetailId: DETAIL_B, returnedQuantity: 3, condition: 'GOOD', locationId: SOURCE },
    ] };
    expect(() => planJoinedStage4CPostingForReview(f, allocations(), buckets())).toThrow();
  });

  it('JOIN-03: wrong stock bucket item or source location is rejected', () => {
    const a = allocations();
    const b = buckets();
    expect(() => planJoinedStage4CPostingForReview(trusted(), a,
      [{ ...b[0], itemId: OTHER }])).toThrow(/Ánh xạ/);
    expect(() => planJoinedStage4CPostingForReview(trusted(), a,
      [{ ...b[0], locationId: OTHER }])).toThrow(/Ánh xạ/);
  });

  it('JOIN-04: forged source allocation quantity or location fails to match trusted borrow detail', () => {
    for (const changes of [
      { originalQuantity: 5 },
      { alreadyReturnedQuantity: 1 },
      { sourceLocationId: OTHER },
    ]) {
      const a = allocations();
      a[0] = { ...a[0], ...changes };
      expect(() => planJoinedStage4CPostingForReview(trusted(), a, buckets())).toThrow(/Ánh xạ/);
    }
  });

  it('JOIN-05: rejects duplicated detail allocations even with valid source ids', () => {
    const a = allocations();
    a[1] = { ...a[0], borrowDetailId: DETAIL_A.toUpperCase() };
    expect(() => planJoinedStage4CPostingForReview(trusted(), a, buckets())).toThrow(/Ánh xạ/);
  });

  it('JOIN-06: rejects missing allocation, unknown balance and duplicate stock bucket', () => {
    expect(() => planJoinedStage4CPostingForReview(trusted(), [allocations()[0]], buckets())).toThrow();
    const a = allocations();
    a[0] = { ...a[0], stockBalanceId: OTHER };
    expect(() => planJoinedStage4CPostingForReview(trusted(), a, buckets())).toThrow(/Ánh xạ/);
    expect(() => planJoinedStage4CPostingForReview(trusted(), allocations(),
      [buckets()[0], { ...buckets()[0], stockBalanceId: STOCK.toUpperCase() }])).toThrow(/trùng lặp/);
  });

  it('JOIN-07: rejects unrelated or malformed identities without coercion', () => {
    const a = allocations();
    a[0] = { ...a[0], itemId: [ITEM] as unknown as string };
    expect(() => planJoinedStage4CPostingForReview(trusted(), a, buckets())).toThrow();
    const b = buckets();
    b[0] = { ...b[0], locationId: 'not-a-uuid' };
    expect(() => planJoinedStage4CPostingForReview(trusted(), allocations(), b)).toThrow();
  });

  it('JOIN-08: invalid receipt, self-verification and LOST still fail before stock planning', () => {
    const f = trusted();
    f.verifiedByActorId = RECEIVER;
    expect(() => planJoinedStage4CPostingForReview(f, allocations(), buckets())).toThrow();
    const lost = trusted();
    lost.payload = { items: [
      { borrowDetailId: DETAIL_A, returnedQuantity: 2, condition: 'LOST', locationId: SOURCE },
      { borrowDetailId: DETAIL_B, returnedQuantity: 3, condition: 'GOOD', locationId: SOURCE },
    ] };
    expect(() => planJoinedStage4CPostingForReview(lost, allocations(), buckets())).toThrow();
  });

  it('JOIN-09: deterministic plan, independent of input order and original case', () => {
    const f = trusted();
    const p = f.payload as { items: Record<string, unknown>[] };
    f.payload = { items: [...p.items].reverse() };
    const a = allocations().reverse();
    a[0] = { ...a[0], stockBalanceId: STOCK.toUpperCase() };
    const result = planJoinedStage4CPostingForReview(f, a, buckets());
    const expected = planJoinedStage4CPostingForReview(trusted(), allocations(), buckets());
    expect(result).toEqual(expected);
  });

  it('JOIN-10: caller snapshots are not modified and invalid stock arithmetic fails closed', () => {
    const f = trusted(), a = allocations(), b = buckets();
    const baseline = JSON.stringify({ f, a, b });
    const output = planJoinedStage4CPostingForReview(f, a, b);
    output.postings[0].after.onHand = 999;
    expect(JSON.stringify({ f, a, b })).toBe(baseline);
    b[0].balance.borrowed = 4;
    expect(() => planJoinedStage4CPostingForReview(f, a, b)).toThrow();
  });
});
