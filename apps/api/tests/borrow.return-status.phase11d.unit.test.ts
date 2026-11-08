import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBorrowReturnStatus } from '../src/modules/borrow/borrow.return-status';
import { prisma } from '../src/config/database';
import { borrowService } from '../src/modules/borrow/borrow.service';
import { AppError } from '../src/shared/AppError';
import { BorrowStatus } from '@acm/shared';

vi.mock('../src/config/database', () => ({
  prisma: {
    idempotencyRecord: { findUnique: vi.fn() },
    returnTransaction: { findFirst: vi.fn() },
  },
}));
vi.mock('../src/modules/borrow/borrow.service', () => ({
  borrowService: { getBorrowRequestById: vi.fn() },
}));

const borrowId = '22222222-2222-4222-8222-222222222222';
const key = 'return_0123456789abcdef0123456789abcdef';
const route = `/api/v1/borrow-requests/${borrowId}/return`;
const user = {
  id: '11111111-1111-4111-8111-111111111111', role: 'TECHNICIAN',
  email: 'technician@example.test', fullName: 'Test Technician',
};
const record = (overrides: Record<string, unknown> = {}) => ({
  userId: user.id, endpoint: route, status: 'COMPLETED', statusCode: 200,
  responseBody: {
    returnNumber: 'RT-TEST-0001',
    borrowRequest: {
      id: borrowId,
      requestNumber: 'BR-TEST-0001',
      borrowerId: '99999999-9999-4999-8999-999999999999',
      status: BorrowStatus.RETURNED,
      purpose: 'synthetic status test',
      itemCount: 1,
      details: [{
        id: '33333333-3333-4333-8333-333333333333',
        itemId: '44444444-4444-4444-8444-444444444444',
        quantity: 1, returnedQuantity: 1,
      }],
    },
  },
  ...overrides,
});
const lookup = () => (prisma.idempotencyRecord.findUnique as any);
const receiptLookup = () => (prisma.returnTransaction.findFirst as any);
const borrowLookup = () => (borrowService.getBorrowRequestById as any);

beforeEach(() => {
  vi.resetAllMocks();
  borrowLookup().mockResolvedValue({ id: borrowId });
  lookup().mockResolvedValue(null);
  receiptLookup().mockResolvedValue({ id: 'real-return-transaction' });
});

describe('Phase 11D — read-only lost-session return-key status', () => {
  it('STATUS-01: returns verified receipt without applying any return', async () => {
    lookup().mockResolvedValue(record());
    expect(await getBorrowReturnStatus(borrowId, key, user as any)).toEqual({
      state: 'COMPLETED', requiresReconciliation: false,
      receipt: { returnNumber: 'RT-TEST-0001', borrowRequestId: borrowId },
    });
    expect(lookup()).toHaveBeenCalledWith({
      where: { key },
      select: { userId: true, endpoint: true, status: true, statusCode: true, responseBody: true },
    });
    expect(receiptLookup()).toHaveBeenCalledWith({
      where: { borrowRequestId: borrowId, returnNumber: 'RT-TEST-0001', receiverId: user.id },
      select: { id: true },
    });
  });

  it('STATUS-02: refuses to treat a missing record as proof of non-commit', async () => {
    expect(await getBorrowReturnStatus(borrowId, key, user as any))
      .toEqual({ state: 'NOT_FOUND', requiresReconciliation: true });
  });

  it('STATUS-03: never discloses another actor’s cached receipt', async () => {
    lookup().mockResolvedValue(record({ userId: '99999999-9999-4999-8999-999999999999' }));
    expect(await getBorrowReturnStatus(borrowId, key, user as any))
      .toEqual({ state: 'NOT_FOUND', requiresReconciliation: true });
  });

  it('STATUS-04: never discloses receipt from another endpoint', async () => {
    lookup().mockResolvedValue(record({ endpoint: '/api/v1/inventory/import' }));
    expect(await getBorrowReturnStatus(borrowId, key, user as any))
      .toEqual({ state: 'NOT_FOUND', requiresReconciliation: true });
  });

  it('STATUS-05: PENDING and FAILED require operator reconciliation', async () => {
    for (const status of ['PENDING', 'FAILED'] as const) {
      lookup().mockResolvedValue(record({ status }));
      expect(await getBorrowReturnStatus(borrowId, key, user as any))
        .toEqual({ state: status, requiresReconciliation: true });
    }
  });

  it('STATUS-06: corrupt success cache never returns a completed receipt', async () => {
    for (const bad of [
      { returnNumber: 'RT-TEST-0001' },
      { returnNumber: '', borrowRequest: { id: borrowId } },
      { returnNumber: 'RT-TEST-0001', borrowRequest: { id: 'other' } },
      null,
    ]) {
      lookup().mockResolvedValue(record({ responseBody: bad }));
      expect(await getBorrowReturnStatus(borrowId, key, user as any))
        .toEqual({ state: 'NEEDS_RECONCILIATION', requiresReconciliation: true });
    }
  });

  it('STATUS-07: malformed key or borrow ID rejected before querying storage', async () => {
    await expect(getBorrowReturnStatus(borrowId, 'BAD', user as any)).rejects
      .toMatchObject({ statusCode: 422 });
    await expect(getBorrowReturnStatus('not-a-uuid', key, user as any)).rejects
      .toMatchObject({ statusCode: 422 });
    expect(lookup()).not.toHaveBeenCalled();
  });

  it('STATUS-08: authorization failure blocks key lookup', async () => {
    borrowLookup().mockRejectedValueOnce(new AppError('Không được truy cập', 403));
    await expect(getBorrowReturnStatus(borrowId, key, user as any)).rejects
      .toMatchObject({ statusCode: 403 });
    expect(lookup()).not.toHaveBeenCalled();
  });

  it('STATUS-10: well-shaped but fabricated cached number requires reconciliation', async () => {
    lookup().mockResolvedValue(record());
    receiptLookup().mockResolvedValueOnce(null);
    expect(await getBorrowReturnStatus(borrowId, key, user as any)).toEqual({
      state: 'NEEDS_RECONCILIATION', requiresReconciliation: true,
    });
    expect(receiptLookup()).toHaveBeenCalledOnce();
  });

  it('STATUS-12: authoritatively scope a valid receipt to the idempotency sender', async () => {
    lookup().mockResolvedValue(record());
    // A real receipt with a different receiver must fail the scoped query.
    receiptLookup().mockResolvedValueOnce(null);
    expect(await getBorrowReturnStatus(borrowId, key, user as any)).toEqual({
      state: 'NEEDS_RECONCILIATION', requiresReconciliation: true,
    });
    expect(receiptLookup()).toHaveBeenCalledWith({
      where: { borrowRequestId: borrowId, returnNumber: 'RT-TEST-0001', receiverId: user.id },
      select: { id: true },
    });
  });

  it('STATUS-11: cannot report COMPLETED when receipt lookup is absent', async () => {
    lookup().mockResolvedValue(record());
    receiptLookup().mockResolvedValueOnce(undefined);
    expect(await getBorrowReturnStatus(borrowId, key, user as any)).toEqual({
      state: 'NEEDS_RECONCILIATION', requiresReconciliation: true,
    });
  });

  it('STATUS-09: incomplete or non-200 completion remains unresolved', async () => {
    for (const invalid of [record({ statusCode: 202 }), record({ status: 'MYSTERY' })]) {
      lookup().mockResolvedValue(invalid);
      expect(await getBorrowReturnStatus(borrowId, key, user as any))
        .toEqual({ state: 'NEEDS_RECONCILIATION', requiresReconciliation: true });
    }
  });
});
