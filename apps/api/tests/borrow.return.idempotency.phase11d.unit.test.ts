import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetCondition, BorrowStatus, ReservationStatus, UserRole } from '@acm/shared';
import { borrowService } from '../src/modules/borrow/borrow.service';
import { prisma } from '../src/config/database';
import { AppError } from '../src/shared/AppError';

// Pure unit tests: fake transaction. Never connects to any database.
const mocks = vi.hoisted(() => ({
  precheck: vi.fn(),
  conflict: vi.fn(),
  sanitize: vi.fn(),
  expiration: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('../src/config/logger', () => ({ logger: { warn: mocks.warn } }));

vi.mock('../src/modules/inventory/idempotency.service', () => ({
  idempotencyService: {
    handlePrecheck: mocks.precheck,
    isIdempotencyKeyConflict: mocks.conflict,
    sanitizeResponse: mocks.sanitize,
    getExpirationDate: mocks.expiration,
  },
}));

vi.mock('../src/config/database', () => {
  const tx = {
    $queryRaw: vi.fn(),
    borrowRequest: { findUnique: vi.fn(), update: vi.fn() },
    borrowDetail: { update: vi.fn(), findMany: vi.fn() },
    returnTransaction: { findUnique: vi.fn(), create: vi.fn() },
    returnDetail: { create: vi.fn() },
    stockBalance: { findUnique: vi.fn(), update: vi.fn() },
    stockMovement: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    idempotencyRecord: { create: vi.fn(), update: vi.fn() },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (cb: any) => cb(tx)),
      returnTransaction: { findFirst: vi.fn() },
      __mockTx: tx,
    },
  };
});

const user = {
  id: '11111111-1111-1111-1111-111111111111',
  fullName: 'Lab Technician',
  role: UserRole.TECHNICIAN,
  email: 'tech@example.test',
};
const borrowId = '22222222-2222-2222-2222-222222222222';
const detailId = '33333333-3333-3333-3333-333333333333';
const itemId = '44444444-4444-4444-4444-444444444444';
const locationId = '55555555-5555-5555-5555-555555555555';
const key = 'Phase11D_Return_Test_000001';
const input = {
  items: [{ borrowDetailId: detailId, returnedQuantity: 2, condition: AssetCondition.GOOD }],
  notes: 'UAT partial return',
};
const baseBorrow = {
  id: borrowId,
  requestNumber: 'BR-20261023-0001',
  borrowerId: '66666666-6666-6666-6666-666666666666',
  status: BorrowStatus.HANDED_OVER,
  purpose: 'synthetic RC5 idempotency fixture',
  expectedBorrowDate: new Date('2026-10-22T00:00:00Z'),
  expectedReturnDate: new Date('2026-10-29T00:00:00Z'),
  details: [{
    id: detailId,
    itemId,
    quantity: 4,
    returnedQuantity: 0,
    item: { id: itemId, code: 'TEST-PARTIAL', name: 'Component fixture', unit: 'pcs' },
  }],
  reservations: [{ itemId, locationId, status: ReservationStatus.FULFILLED }],
  returnTransactions: [],
};

function txMock(): any {
  return (prisma as any).__mockTx;
}
function receiptLookup(): any {
  return (prisma as any).returnTransaction.findFirst;
}

function configureHappyPath() {
  const tx = txMock();
  tx.borrowRequest.findUnique.mockResolvedValue(baseBorrow);
  tx.returnTransaction.findUnique.mockResolvedValue(null);
  tx.returnTransaction.create.mockResolvedValue({ id: 'return-transaction-1' });
  tx.returnDetail.create.mockResolvedValue({});
  tx.borrowDetail.update.mockResolvedValue({});
  tx.stockBalance.findUnique.mockResolvedValue({ id: 'balance-1', onHand: 6, borrowed: 4 });
  tx.stockBalance.update.mockResolvedValue({});
  tx.stockMovement.create.mockResolvedValue({});
  tx.borrowDetail.findMany.mockResolvedValue([{ quantity: 4, returnedQuantity: 2 }]);
  tx.borrowRequest.update.mockResolvedValue({
    ...baseBorrow,
    status: BorrowStatus.PARTIALLY_RETURNED,
    details: [{ ...baseBorrow.details[0], returnedQuantity: 2 }],
  });
  tx.auditLog.create.mockResolvedValue({});
  tx.idempotencyRecord.create.mockResolvedValue({});
  tx.idempotencyRecord.update.mockResolvedValue({});
}

const proceed = { action: 'PROCEED' as const, requestHash: 'fake-request-hash' };

describe('Phase 11D — Borrow return idempotency (mock, zero DB writes)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const tx = txMock();
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(tx));
    configureHappyPath();
    receiptLookup().mockResolvedValue({ id: 'confirmed-return-transaction' });
    mocks.precheck.mockResolvedValue(proceed);
    mocks.conflict.mockImplementation((error: any) => error?.code === 'P2002' &&
      Array.isArray(error?.meta?.target) && error.meta.target.includes('key'));
    mocks.sanitize.mockImplementation((value: any) => value);
    mocks.expiration.mockReturnValue(new Date('2026-10-24T00:00:00Z'));
  });

  it('IDEM-01: creates and finalizes idempotency record atomically with stock changes', async () => {
    const result = await borrowService.returnBorrowRequest(borrowId, input, user as any, key);
    const tx = txMock();
    expect(result.borrowRequest.status).toBe(BorrowStatus.PARTIALLY_RETURNED);
    expect(result.returnNumber).toMatch(/^RT-/);
    expect(mocks.precheck).toHaveBeenCalledWith(
      key, user.id, `/api/v1/borrow-requests/${borrowId}/return`, input, prisma
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.idempotencyRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key, userId: user.id, status: 'PENDING', requestHash: proceed.requestHash,
      }),
    });
    expect(tx.stockBalance.update).toHaveBeenCalledTimes(1);
    expect(tx.idempotencyRecord.update).toHaveBeenCalledWith({
      where: { key },
      data: expect.objectContaining({
        status: 'COMPLETED', statusCode: 200,
        responseBody: expect.objectContaining({ returnNumber: result.returnNumber }),
      }),
    });
    const createdBeforeStock = tx.idempotencyRecord.create.mock.invocationCallOrder[0];
    const stockBeforeCompleted = tx.stockBalance.update.mock.invocationCallOrder[0];
    const completed = tx.idempotencyRecord.update.mock.invocationCallOrder[0];
    expect(createdBeforeStock).toBeLessThan(stockBeforeCompleted);
    expect(stockBeforeCompleted).toBeLessThan(completed);
  });

  it('IDEM-02: replay with the same key uses cached response without a second stock change', async () => {
    const first = await borrowService.returnBorrowRequest(borrowId, input, user as any, key);
    mocks.precheck.mockResolvedValueOnce({
      action: 'RETURN_CACHED', requestHash: proceed.requestHash,
      statusCode: 200, existingRecord: { status: 'COMPLETED', statusCode: 200 },
      cachedResponse: first,
    });
    const second = await borrowService.returnBorrowRequest(borrowId, input, user as any, key);
    expect(second).toEqual(first);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock().stockBalance.update).toHaveBeenCalledTimes(1);
    expect(txMock().returnTransaction.create).toHaveBeenCalledTimes(1);
    expect(txMock().auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('IDEM-03: payload/key fingerprint mismatch propagates 409 without stock writes', async () => {
    mocks.precheck.mockRejectedValueOnce(new AppError('Payload mismatch', 409));
    await expect(borrowService.returnBorrowRequest(borrowId, input, user as any, key))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(txMock().stockBalance.update).not.toHaveBeenCalled();
  });

  it('IDEM-04: in-progress duplicate rejects without business-side effects', async () => {
    mocks.precheck.mockRejectedValueOnce(new AppError('Request pending', 409));
    await expect(borrowService.returnBorrowRequest(borrowId, input, user as any, key))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(txMock().returnTransaction.create).not.toHaveBeenCalled();
  });

  it.each(['RETRY_PENDING', 'RETRY_FAILED'] as const)(
    'IDEM-08: ambiguous %s is reconciled, never auto-replayed after 30 seconds',
    async (action) => {
      mocks.precheck.mockResolvedValueOnce({
        action, requestHash: proceed.requestHash,
        existingRecord: { status: action === 'RETRY_PENDING' ? 'PENDING' : 'FAILED' },
      });
      await expect(borrowService.returnBorrowRequest(borrowId, input, user as any, key))
        .rejects.toMatchObject({ statusCode: 409 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(txMock().returnTransaction.create).not.toHaveBeenCalled();
      expect(txMock().stockBalance.update).not.toHaveBeenCalled();
      expect(txMock().idempotencyRecord.update).not.toHaveBeenCalled();
      expect(txMock().idempotencyRecord.create).not.toHaveBeenCalled();
    }
  );

  it('IDEM-09: unknown precheck decision must fail closed before stock mutation', async () => {
    mocks.precheck.mockResolvedValueOnce({
      action: 'SOMETHING_NEW', requestHash: proceed.requestHash,
    });
    await expect(borrowService.returnBorrowRequest(borrowId, input, user as any, key))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('IDEM-05: concurrent key unique-constraint conflict maps to HTTP 409', async () => {
    const conflict = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002', meta: { target: ['key'] },
    });
    (prisma.$transaction as any).mockRejectedValueOnce(conflict);
    await expect(borrowService.returnBorrowRequest(borrowId, input, user as any, key))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(txMock().stockBalance.update).not.toHaveBeenCalled();
  });

  it('IDEM-07: mid-transaction failure aborts transaction and does not finalize idempotency record', async () => {
    const tx = txMock();
    tx.stockBalance.update.mockRejectedValueOnce(new Error('Database disk write failure'));

    await expect(borrowService.returnBorrowRequest(borrowId, input, user as any, key))
      .rejects.toThrow('Database disk write failure');

    expect(tx.idempotencyRecord.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      })
    );
  });

  it('IDEM-10: mismatched or malformed cached receipt must never be acknowledged', async () => {
    const bad = [
      null, [],
      { returnNumber: 'RT-VALID', borrowRequest: { id: 'WRONG-BORROW' } },
      { returnNumber: 'RT-VALID', borrowRequest: [] },
      { returnNumber: 'RT-VALID', borrowRequest: null },
      { returnNumber: '', borrowRequest: { id: borrowId } },
      { returnNumber: '   ', borrowRequest: { id: borrowId } },
      { returnNumber: 23, borrowRequest: { id: borrowId } },
    ];
    for (const cachedResponse of bad) {
      mocks.precheck.mockResolvedValueOnce({
        action: 'RETURN_CACHED', requestHash: proceed.requestHash,
        statusCode: 200, existingRecord: { status: 'COMPLETED', statusCode: 200 },
        cachedResponse,
      });
      await expect(borrowService.returnBorrowRequest(borrowId, input, user as any, key))
        .rejects.toMatchObject({ statusCode: 409 });
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(txMock().stockBalance.update).not.toHaveBeenCalled();
    expect(txMock().returnTransaction.create).not.toHaveBeenCalled();
  });

  it.each([201, 202, 409, 500, undefined])(
    'IDEM-11: cached receipt with non-success HTTP status %s requires reconciliation',
    async (statusCode) => {
      mocks.precheck.mockResolvedValueOnce({
        action: 'RETURN_CACHED', requestHash: proceed.requestHash,
        statusCode,
        cachedResponse: {
          returnNumber: 'RT-EXAMPLE', borrowRequest: { id: borrowId },
        },
      });
      await expect(borrowService.returnBorrowRequest(borrowId, input, user as any, key))
        .rejects.toMatchObject({ statusCode: 409 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  it.each([null, undefined, 500])(
    'IDEM-12: underlying completed row status %s is authoritative over normalized cache',
    async (statusCode) => {
      mocks.precheck.mockResolvedValueOnce({
        action: 'RETURN_CACHED', requestHash: proceed.requestHash,
        statusCode: 200,
        existingRecord: { status: 'COMPLETED', statusCode },
        cachedResponse: {
          returnNumber: 'RT-EXAMPLE', borrowRequest: { id: borrowId },
        },
      });
      await expect(borrowService.returnBorrowRequest(borrowId, input, user as any, key))
        .rejects.toMatchObject({ statusCode: 409 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  it('IDEM-13: absent raw COMPLETED row fails closed, even with a valid-shaped cache', async () => {
    const first = await borrowService.returnBorrowRequest(borrowId, input, user as any, key);
    vi.clearAllMocks();
    mocks.precheck.mockResolvedValueOnce({
      action: 'RETURN_CACHED', statusCode: 200,
      requestHash: proceed.requestHash, cachedResponse: first,
    });
    await expect(borrowService.returnBorrowRequest(borrowId, input, user as any, key))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(receiptLookup()).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledOnce();
    const signal = mocks.warn.mock.calls[0];
    expect(signal[0]).toBe('RC5_RETURN_CACHE_RECONCILIATION_REQUIRED');
    expect(signal[1]).toMatchObject({
      actorId: user.id, borrowRequestId: borrowId,
      reason: 'invalid_completed_record',
      keySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(signal)).not.toContain(key);
    expect(JSON.stringify(signal)).not.toContain(input.notes);
  });

  it('IDEM-14: a well-shaped cache cannot invent a returnNumber without an actual receipt', async () => {
    const first = await borrowService.returnBorrowRequest(borrowId, input, user as any, key);
    vi.clearAllMocks();
    receiptLookup().mockResolvedValueOnce(null);
    mocks.precheck.mockResolvedValueOnce({
      action: 'RETURN_CACHED', statusCode: 200,
      requestHash: proceed.requestHash,
      existingRecord: { status: 'COMPLETED', statusCode: 200 },
      cachedResponse: { ...first, returnNumber: 'RT-NONEXISTENT' },
    });
    await expect(borrowService.returnBorrowRequest(borrowId, input, user as any, key))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(receiptLookup()).toHaveBeenCalledWith({
      where: { borrowRequestId: borrowId, returnNumber: 'RT-NONEXISTENT' },
      select: { id: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(
      'RC5_RETURN_CACHE_RECONCILIATION_REQUIRED',
      expect.objectContaining({ reason: 'return_receipt_not_found' })
    );
  });

  it('IDEM-15: a cache missing required borrow DTO fields is rejected without a read', async () => {
    mocks.precheck.mockResolvedValueOnce({
      action: 'RETURN_CACHED', statusCode: 200,
      requestHash: proceed.requestHash,
      existingRecord: { status: 'COMPLETED', statusCode: 200 },
      cachedResponse: {
        returnNumber: 'RT-FAKE',
        borrowRequest: { id: borrowId, status: BorrowStatus.RETURNED },
      },
    });
    await expect(borrowService.returnBorrowRequest(borrowId, input, user as any, key))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(receiptLookup()).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('IDEM-16: verified replay returns only the validated outer response fields', async () => {
    const first = await borrowService.returnBorrowRequest(borrowId, input, user as any, key);
    vi.clearAllMocks();
    receiptLookup().mockResolvedValueOnce({ id: 'confirmed-return-transaction' });
    mocks.precheck.mockResolvedValueOnce({
      action: 'RETURN_CACHED', statusCode: 200,
      requestHash: proceed.requestHash,
      existingRecord: { status: 'COMPLETED', statusCode: 200 },
      cachedResponse: { ...first, topLevelInjection: 'unexpected' },
    });
    const replay = await borrowService.returnBorrowRequest(borrowId, input, user as any, key);
    expect(replay).toEqual(first);
    expect(Object.keys(replay).sort()).toEqual(['borrowRequest', 'returnNumber']);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('IDEM-06: invalid completed cache is rejected rather than triggering a second return', async () => {
    mocks.precheck.mockResolvedValueOnce({
      action: 'RETURN_CACHED', requestHash: proceed.requestHash,
      statusCode: 200, cachedResponse: { returnNumber: 'RT-INVALID' },
    });
    await expect(borrowService.returnBorrowRequest(borrowId, input, user as any, key))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
