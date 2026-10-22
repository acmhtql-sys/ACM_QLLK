import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/database';
import { stockTransactionsService } from '../src/modules/stock-transactions/stock-transactions.service';

vi.mock('../src/config/database', () => {
  const tx = {
    idempotencyRecord: {
      create: vi.fn(),
      update: vi.fn(),
    },
    stockBalance: {
      update: vi.fn(),
    },
    stockTransaction: {
      create: vi.fn(async () => ({
        id: 'tx-test',
        transactionNumber: 'ADJ-TEST',
        type: 'ADJUSTMENT',
        status: 'COMPLETED',
        notes: null,
        createdAt: new Date('2026-10-18T00:00:00Z'),
      })),
    },
    stockTransactionDetail: {
      create: vi.fn(async ({ data }: any) => {
        if (data.quantity <= 0) {
          throw new Error('DB CHECK: quantity must be positive');
        }
        return { id: 'detail-test', ...data };
      }),
    },
    stockMovement: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $queryRawUnsafe: vi.fn(async (_sql: string, itemId: string) => [{
      id: `balance-${itemId}`,
      itemId,
      locationId: 'loc-test',
      onHand: 10,
      reserved: 0,
      quarantined: 0,
      kitAllocated: 0,
      borrowed: 0,
    }]),
  };

  return {
    prisma: {
      $transaction: vi.fn(async (fn: any) => fn(tx)),
      __tx: tx,
    },
  };
});

vi.mock('../src/modules/inventory/inventory.helpers', () => ({
  validateActiveItemAndLocation: vi.fn(async () => undefined),
  sortLockOrder: (lines: any[]) => lines,
  validateMovementLedgerConsistency: vi.fn(),
  generateTransactionNumber: vi.fn(async () => 'ADJ-TEST'),
  withRetry: async (fn: any) => fn(),
}));

vi.mock('../src/modules/inventory/idempotency.service', () => ({
  idempotencyService: {
    handlePrecheck: vi.fn(async () => ({
      action: 'PROCEED',
      requestHash: 'test-hash',
    })),
    getExpirationDate: vi.fn(() => new Date('2030-01-01')),
    sanitizeResponse: (data: any) => data,
  },
}));

const tx = (prisma as any).__tx;

function line(itemId: string, actualOnHand: number) {
  return {
    itemId,
    locationId: 'loc-test',
    actualOnHand,
    expectedOnHand: 10,
    expectedReserved: 0,
    expectedQuarantined: 0,
    expectedKitAllocated: 0,
  };
}

describe('Adjustment zero-delta regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists only changed lines in a mixed adjustment', async () => {
    const result = await stockTransactionsService.adjustStock(
      {
        reason: 'Regression test',
        items: [
          line('unchanged-item', 10),
          line('changed-item', 15),
        ],
      } as any,
      'user-test',
      'regression-key-01'
    );

    expect(result.statusCode).toBe(201);
    expect(result.data.data.itemCount).toBe(1);
    expect(result.data.data.adjustedItemsCount).toBe(1);
    expect(result.data.data.details).toHaveLength(1);
    expect(result.data.data.details[0].quantity).toBe(5);

    expect(tx.stockTransactionDetail.create).toHaveBeenCalledTimes(1);
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(tx.stockBalance.update).toHaveBeenCalledTimes(1);
  });

  it('rejects an adjustment where every delta is zero', async () => {
    await expect(stockTransactionsService.adjustStock(
      {
        reason: 'No change',
        items: [line('unchanged-item', 10)],
      } as any,
      'user-test',
      'regression-key-02'
    )).rejects.toThrow(/delta = 0/);

    expect(tx.stockTransaction.create).not.toHaveBeenCalled();
    expect(tx.stockTransactionDetail.create).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });
});
