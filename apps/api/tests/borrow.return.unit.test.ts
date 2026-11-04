import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  UserRole,
  BorrowStatus,
  AssetCondition,
  ReservationStatus,
  StockTransactionType,
  BorrowSortField,
  SortOrder,
} from '@acm/shared';
import { borrowService, formatBorrowRequestResponse } from '../src/modules/borrow/borrow.service';
import { borrowRouter } from '../src/modules/borrow/borrow.router';
import { prisma } from '../src/config/database';
import { AppError } from '../src/shared/AppError';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env';

// Mock prisma client
vi.mock('../src/config/database', () => {
  const mockTx = {
    borrowRequest: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    borrowDetail: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    stockBalance: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    stockReservation: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    stockMovement: {
      create: vi.fn(),
    },
    returnTransaction: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    returnDetail: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };

  return {
    prisma: {
      borrowRequest: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      borrowDetail: {
        findMany: vi.fn(),
      },
      returnTransaction: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
      },
      item: {
        findUnique: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      stockBalance: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      stockReservation: {
        findMany: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(mockTx)),
      __mockTx: mockTx,
    },
  };
});

/**
 * Pure In-Memory Mock Response for Express route testing
 */
class MockResponse {
  statusCode: number = 200;
  headers: Record<string, string> = {};
  body: any = null;
  ended: boolean = false;

  private _resolve: (() => void) | null = null;
  public done: Promise<void>;

  constructor() {
    this.done = new Promise<void>((resolve) => {
      this._resolve = resolve;
    });
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(payload: any) {
    this.body = payload;
    this.ended = true;
    if (this._resolve) this._resolve();
    return this;
  }

  send(payload: any) {
    this.body = payload;
    this.ended = true;
    if (this._resolve) this._resolve();
    return this;
  }
}

function createMockContext(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  query?: Record<string, any>;
  body?: any;
  user?: any;
}) {
  const req: any = {
    method: options.method || 'GET',
    url: options.url || '/',
    headers: { ...(options.headers || {}) },
    params: { ...(options.params || {}) },
    query: { ...(options.query || {}) },
    body: options.body || {},
    user: options.user,
  };
  const res = new MockResponse();
  let nextCalled = false;
  let nextError: any = null;

  const next = (err?: any) => {
    nextCalled = true;
    if (err) nextError = err;
    (res as any)._resolve?.();
  };

  const waitForCompletion = async () => {
    await Promise.race([
      res.done,
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
  };

  return {
    req,
    res,
    next,
    wasNextCalled: () => nextCalled,
    getError: () => nextError,
    waitForCompletion,
  };
}

describe('ACM Phase 4 – Borrow & Return Management Test Suite', () => {
  const adminUser = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'admin@acm.edu.vn',
    fullName: 'System Administrator',
    role: UserRole.ADMIN,
  };

  const labManagerUser = {
    id: '22222222-2222-2222-2222-222222222222',
    email: 'manager@acm.edu.vn',
    fullName: 'Lab Manager',
    role: UserRole.LAB_MANAGER,
  };

  const technicianUser = {
    id: '33333333-3333-3333-3333-333333333333',
    email: 'technician@acm.edu.vn',
    fullName: 'Lab Technician',
    role: UserRole.TECHNICIAN,
  };

  const studentUser = {
    id: '44444444-4444-4444-4444-444444444444',
    email: 'student@acm.edu.vn',
    fullName: 'Nguyen Van Sinh Vien',
    role: UserRole.STUDENT,
  };

  const itemId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const locationId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const borrowRequestId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const borrowDetailId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const reservationId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

  function createAuthHeaders(user: any): Record<string, string> {
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, fullName: user.fullName },
      env.JWT_SECRET
    );
    return { authorization: `Bearer ${token}` };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockImplementation(async ({ where }: any) => {
      const users = [adminUser, labManagerUser, technicianUser, studentUser];
      const found = users.find((u) => u.id === where.id || u.email === where.email);
      if (found) {
        return {
          ...found,
          isActive: true,
          isLocked: false,
        } as any;
      }
      return null;
    });
  });

  describe('1. Normal Lifecycle (Create -> Approve -> Handover -> Partial Return -> Full Return)', () => {
    it('TC-BR-01: Creates a borrow request with available stock validation', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: studentUser.id,
        fullName: studentUser.fullName,
        email: studentUser.email,
        isActive: true,
        isLocked: false,
      } as any);

      vi.mocked(prisma.item.findUnique).mockResolvedValue({
        id: itemId,
        code: 'STM32-F401',
        name: 'STM32F401 Black Pill',
        unit: 'cái',
        isActive: true,
        stockBalances: [
          {
            id: 'sb-1',
            locationId,
            onHand: 10,
            reserved: 2,
            quarantined: 0,
            kitAllocated: 0,
            borrowed: 0,
          },
        ],
      } as any);

      vi.mocked(prisma.borrowRequest.findUnique).mockResolvedValue(null);

      const mockTx = (prisma as any).__mockTx;
      mockTx.borrowRequest.create.mockResolvedValue({
        id: borrowRequestId,
        requestNumber: 'BR-20261020-0001',
        borrowerId: studentUser.id,
        status: BorrowStatus.PENDING,
        purpose: 'Làm đồ án tốt nghiệp hệ thống nhúng',
        expectedBorrowDate: new Date('2026-10-20'),
        expectedReturnDate: new Date('2026-10-25'),
        notes: 'Cần cáp Type-C',
        details: [
          {
            id: borrowDetailId,
            itemId,
            quantity: 2,
            returnedQuantity: 0,
            item: { id: itemId, code: 'STM32-F401', name: 'STM32F401 Black Pill', unit: 'cái' },
          },
        ],
        borrower: { id: studentUser.id, fullName: studentUser.fullName, email: studentUser.email },
        reservations: [],
        returnTransactions: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await borrowService.createBorrowRequest(
        {
          expectedBorrowDate: '2026-10-20',
          expectedReturnDate: '2026-10-25',
          purpose: 'Làm đồ án tốt nghiệp hệ thống nhúng',
          notes: 'Cần cáp Type-C',
          items: [{ itemId, quantity: 2 }],
        },
        studentUser
      );

      expect(res.status).toBe(BorrowStatus.PENDING);
      expect(res.borrowerId).toBe(studentUser.id);
      expect(res.details).toHaveLength(1);
      expect(res.details[0].quantity).toBe(2);
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CREATE',
            entity: 'BorrowRequest',
          }),
        })
      );
    });

    it('TC-BR-02: Approves a PENDING request and reserves stock', async () => {
      const mockTx = (prisma as any).__mockTx;

      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        requestNumber: 'BR-20261020-0001',
        status: BorrowStatus.PENDING,
        details: [
          {
            id: borrowDetailId,
            itemId,
            quantity: 2,
            item: { id: itemId, name: 'STM32F401 Black Pill' },
          },
        ],
      });

      mockTx.stockBalance.findMany.mockResolvedValue([
        {
          id: 'sb-1',
          itemId,
          locationId,
          onHand: 10,
          reserved: 0,
          quarantined: 0,
          kitAllocated: 0,
          borrowed: 0,
        },
      ]);

      mockTx.borrowRequest.update.mockResolvedValue({
        id: borrowRequestId,
        requestNumber: 'BR-20261020-0001',
        status: BorrowStatus.APPROVED,
        approverId: labManagerUser.id,
        approver: { id: labManagerUser.id, fullName: labManagerUser.fullName, email: labManagerUser.email },
        details: [
          {
            id: borrowDetailId,
            itemId,
            quantity: 2,
            returnedQuantity: 0,
            item: { id: itemId, code: 'STM32-F401', name: 'STM32F401 Black Pill', unit: 'cái' },
          },
        ],
        reservations: [
          {
            id: reservationId,
            borrowRequestId,
            itemId,
            locationId,
            quantity: 2,
            status: ReservationStatus.ACTIVE,
          },
        ],
        expectedBorrowDate: new Date('2026-10-20'),
        expectedReturnDate: new Date('2026-10-25'),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await borrowService.approveBorrowRequest(
        borrowRequestId,
        { notes: 'Đã duyệt cấp linh kiện' },
        labManagerUser
      );

      expect(res.status).toBe(BorrowStatus.APPROVED);
      expect(mockTx.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sb-1' },
          data: { reserved: { increment: 2 } },
        })
      );
      expect(mockTx.stockReservation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            borrowRequestId,
            itemId,
            locationId,
            quantity: 2,
            status: ReservationStatus.ACTIVE,
          }),
        })
      );
    });

    it('TC-BR-03: Hands over items, moving stock from reserved/onHand to borrowed', async () => {
      const mockTx = (prisma as any).__mockTx;

      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        requestNumber: 'BR-20261020-0001',
        status: BorrowStatus.APPROVED,
        reservations: [
          {
            id: reservationId,
            itemId,
            locationId,
            quantity: 2,
            status: ReservationStatus.ACTIVE,
          },
        ],
        details: [{ id: borrowDetailId, itemId, quantity: 2 }],
      });

      mockTx.stockBalance.findUnique.mockResolvedValue({
        id: 'sb-1',
        itemId,
        locationId,
        onHand: 10,
        reserved: 2,
        quarantined: 0,
        kitAllocated: 0,
        borrowed: 0,
      });

      mockTx.borrowRequest.update.mockResolvedValue({
        id: borrowRequestId,
        requestNumber: 'BR-20261020-0001',
        status: BorrowStatus.HANDED_OVER,
        actualBorrowDate: new Date(),
        expectedBorrowDate: new Date('2026-10-20'),
        expectedReturnDate: new Date('2026-10-25'),
        details: [
          {
            id: borrowDetailId,
            itemId,
            quantity: 2,
            returnedQuantity: 0,
            item: { id: itemId, code: 'STM32-F401', name: 'STM32F401 Black Pill', unit: 'cái' },
          },
        ],
        reservations: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await borrowService.handoverBorrowRequest(
        borrowRequestId,
        { notes: 'Đã giao sinh viên nhận đủ' },
        technicianUser
      );

      expect(res.status).toBe(BorrowStatus.HANDED_OVER);
      // Verify inventory adjustment
      expect(mockTx.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sb-1' },
          data: {
            reserved: { decrement: 2 },
            onHand: { decrement: 2 },
            borrowed: { increment: 2 },
          },
        })
      );
      // Verify StockMovement entry
      expect(mockTx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            itemId,
            locationId,
            type: StockTransactionType.EXPORT,
            quantityDelta: -2,
            onHandBefore: 10,
            onHandAfter: 8,
            referenceType: 'BORROW_HANDOVER',
          }),
        })
      );
      // Verify reservation fulfilled
      expect(mockTx.stockReservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: reservationId },
          data: { status: ReservationStatus.FULFILLED },
        })
      );
    });

    it('TC-BR-04: Partially returns 1 item in GOOD condition -> PARTIALLY_RETURNED', async () => {
      const mockTx = (prisma as any).__mockTx;

      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        requestNumber: 'BR-20261020-0001',
        status: BorrowStatus.HANDED_OVER,
        details: [
          {
            id: borrowDetailId,
            itemId,
            quantity: 2,
            returnedQuantity: 0,
            item: { id: itemId, name: 'STM32F401' },
          },
        ],
        reservations: [{ itemId, locationId, status: ReservationStatus.FULFILLED }],
      });

      mockTx.returnTransaction.findUnique.mockResolvedValue(null);
      mockTx.returnTransaction.create.mockResolvedValue({
        id: 'rt-1',
        returnNumber: 'RT-20261022-0001',
      });

      mockTx.stockBalance.findUnique.mockResolvedValue({
        id: 'sb-1',
        itemId,
        locationId,
        onHand: 8,
        reserved: 0,
        quarantined: 0,
        kitAllocated: 0,
        borrowed: 2,
      });

      // Updated details: 1 returned out of 2
      mockTx.borrowDetail.findMany.mockResolvedValue([
        { id: borrowDetailId, quantity: 2, returnedQuantity: 1 },
      ]);

      mockTx.borrowRequest.update.mockResolvedValue({
        id: borrowRequestId,
        requestNumber: 'BR-20261020-0001',
        status: BorrowStatus.PARTIALLY_RETURNED,
        expectedBorrowDate: new Date('2026-10-20'),
        expectedReturnDate: new Date('2026-10-25'),
        details: [
          {
            id: borrowDetailId,
            itemId,
            quantity: 2,
            returnedQuantity: 1,
            item: { id: itemId, code: 'STM32-F401', name: 'STM32F401', unit: 'cái' },
          },
        ],
        returnTransactions: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await borrowService.returnBorrowRequest(
        borrowRequestId,
        {
          items: [
            {
              borrowDetailId,
              returnedQuantity: 1,
              condition: AssetCondition.GOOD,
            },
          ],
          notes: 'Trả trước 1 mạch',
        },
        technicianUser
      );

      expect(res.borrowRequest.status).toBe(BorrowStatus.PARTIALLY_RETURNED);
      expect(mockTx.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sb-1' },
          data: {
            borrowed: { decrement: 1 },
            onHand: { increment: 1 },
          },
        })
      );
      expect(mockTx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: StockTransactionType.IMPORT,
            quantityDelta: 1,
            referenceType: 'RETURN',
          }),
        })
      );
    });

    it('TC-BR-05: Returns remaining 1 item in DAMAGED condition -> RETURNED & Quarantined', async () => {
      const mockTx = (prisma as any).__mockTx;

      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        requestNumber: 'BR-20261020-0001',
        status: BorrowStatus.PARTIALLY_RETURNED,
        details: [
          {
            id: borrowDetailId,
            itemId,
            quantity: 2,
            returnedQuantity: 1,
            item: { id: itemId, name: 'STM32F401' },
          },
        ],
        reservations: [{ itemId, locationId, status: ReservationStatus.FULFILLED }],
      });

      mockTx.returnTransaction.findUnique.mockResolvedValue(null);
      mockTx.returnTransaction.create.mockResolvedValue({
        id: 'rt-2',
        returnNumber: 'RT-20261024-0002',
      });

      mockTx.stockBalance.findUnique.mockResolvedValue({
        id: 'sb-1',
        itemId,
        locationId,
        onHand: 9,
        reserved: 0,
        quarantined: 0,
        kitAllocated: 0,
        borrowed: 1,
      });

      // Updated details: all 2 returned
      mockTx.borrowDetail.findMany.mockResolvedValue([
        { id: borrowDetailId, quantity: 2, returnedQuantity: 2 },
      ]);

      mockTx.borrowRequest.update.mockResolvedValue({
        id: borrowRequestId,
        requestNumber: 'BR-20261020-0001',
        status: BorrowStatus.RETURNED,
        actualReturnDate: new Date(),
        expectedBorrowDate: new Date('2026-10-20'),
        expectedReturnDate: new Date('2026-10-25'),
        details: [
          {
            id: borrowDetailId,
            itemId,
            quantity: 2,
            returnedQuantity: 2,
            item: { id: itemId, code: 'STM32-F401', name: 'STM32F401', unit: 'cái' },
          },
        ],
        returnTransactions: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await borrowService.returnBorrowRequest(
        borrowRequestId,
        {
          items: [
            {
              borrowDetailId,
              returnedQuantity: 1,
              condition: AssetCondition.DAMAGED,
              notes: 'Chập nguồn cháy chip nạp',
            },
          ],
        },
        technicianUser
      );

      expect(res.borrowRequest.status).toBe(BorrowStatus.RETURNED);
      // Damaged condition: increments onHand and quarantined, decrements borrowed
      expect(mockTx.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sb-1' },
          data: {
            borrowed: { decrement: 1 },
            onHand: { increment: 1 },
            quarantined: { increment: 1 },
          },
        })
      );
      expect(mockTx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: StockTransactionType.IMPORT,
            quantityDelta: 1,
            referenceType: 'RETURN_DAMAGED',
          }),
        })
      );
    });
  });

  describe('2. Return Condition: LOST', () => {
    it('TC-BR-06: Handles LOST condition - does not add back to onHand', async () => {
      const mockTx = (prisma as any).__mockTx;

      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        requestNumber: 'BR-20261020-0001',
        status: BorrowStatus.HANDED_OVER,
        details: [
          {
            id: borrowDetailId,
            itemId,
            quantity: 1,
            returnedQuantity: 0,
            item: { id: itemId, name: 'STM32F401' },
          },
        ],
        reservations: [{ itemId, locationId, status: ReservationStatus.FULFILLED }],
      });

      mockTx.returnTransaction.findUnique.mockResolvedValue(null);
      mockTx.returnTransaction.create.mockResolvedValue({
        id: 'rt-lost',
        returnNumber: 'RT-20261024-LOST',
      });

      mockTx.stockBalance.findUnique.mockResolvedValue({
        id: 'sb-1',
        itemId,
        locationId,
        onHand: 10,
        reserved: 0,
        quarantined: 0,
        kitAllocated: 0,
        borrowed: 1,
      });

      mockTx.borrowDetail.findMany.mockResolvedValue([
        { id: borrowDetailId, quantity: 1, returnedQuantity: 1 },
      ]);

      mockTx.borrowRequest.update.mockResolvedValue({
        id: borrowRequestId,
        requestNumber: 'BR-20261020-0001',
        status: BorrowStatus.RETURNED,
        actualReturnDate: new Date(),
        expectedBorrowDate: new Date('2026-10-20'),
        expectedReturnDate: new Date('2026-10-25'),
        details: [{ id: borrowDetailId, itemId, quantity: 1, returnedQuantity: 1 }],
        returnTransactions: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await borrowService.returnBorrowRequest(
        borrowRequestId,
        {
          items: [
            {
              borrowDetailId,
              returnedQuantity: 1,
              condition: AssetCondition.LOST,
              notes: 'Sinh viên báo mất trong quá trình thí nghiệm',
            },
          ],
        },
        technicianUser
      );

      expect(res.borrowRequest.status).toBe(BorrowStatus.RETURNED);
      // LOST: only borrowed decrements, onHand is NOT incremented
      expect(mockTx.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sb-1' },
          data: {
            borrowed: { decrement: 1 },
          },
        })
      );
      expect(mockTx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            quantityDelta: 0,
            referenceType: 'RETURN_LOST',
          }),
        })
      );
    });
  });

  describe('3. Validation & Stock Invariants', () => {
    it('TC-BR-07: Rejects borrow request creation when item is inactive', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: studentUser.id,
        isActive: true,
        isLocked: false,
      } as any);

      vi.mocked(prisma.item.findUnique).mockResolvedValue({
        id: itemId,
        code: 'STM32-OLD',
        name: 'STM32 Hỏng',
        isActive: false, // Inactive
        stockBalances: [],
      } as any);

      await expect(
        borrowService.createBorrowRequest(
          {
            expectedBorrowDate: '2026-10-20',
            expectedReturnDate: '2026-10-25',
            purpose: 'Kiểm thử bo mạch',
            items: [{ itemId, quantity: 1 }],
          },
          studentUser
        )
      ).rejects.toThrow('đã bị vô hiệu hóa');
    });

    it('TC-BR-08: Rejects borrow request creation when item has 0 available stock', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: studentUser.id,
        isActive: true,
        isLocked: false,
      } as any);

      vi.mocked(prisma.item.findUnique).mockResolvedValue({
        id: itemId,
        code: 'ESP32',
        name: 'ESP32 NodeMCU',
        isActive: true,
        stockBalances: [
          {
            onHand: 5,
            reserved: 3,
            quarantined: 2,
            kitAllocated: 0,
            borrowed: 0, // available = 5 - 3 - 2 = 0
          },
        ],
      } as any);

      await expect(
        borrowService.createBorrowRequest(
          {
            expectedBorrowDate: '2026-10-20',
            expectedReturnDate: '2026-10-25',
            purpose: 'Mượn thử nghiệm',
            items: [{ itemId, quantity: 1 }],
          },
          studentUser
        )
      ).rejects.toThrow('hết hàng khả dụng');
    });

    it('TC-BR-09: Rejects approval when available stock is insufficient', async () => {
      const mockTx = (prisma as any).__mockTx;

      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        status: BorrowStatus.PENDING,
        details: [
          {
            id: borrowDetailId,
            itemId,
            quantity: 5, // Requesting 5
            item: { id: itemId, name: 'Cảm biến siêu âm HC-SR04' },
          },
        ],
      });

      // Only 3 available
      mockTx.stockBalance.findMany.mockResolvedValue([
        {
          id: 'sb-1',
          itemId,
          locationId,
          onHand: 3,
          reserved: 0,
          quarantined: 0,
          kitAllocated: 0,
          borrowed: 0,
        },
      ]);

      await expect(
        borrowService.approveBorrowRequest(borrowRequestId, {}, adminUser)
      ).rejects.toThrow('Không đủ tồn kho khả dụng để duyệt phiếu');
    });
  });

  describe('4. Anti-Double-Return & Return Quantity Guard', () => {
    it('TC-BR-10: Rejects return when returned quantity exceeds remaining borrowed quantity', async () => {
      const mockTx = (prisma as any).__mockTx;

      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        status: BorrowStatus.HANDED_OVER,
        details: [
          {
            id: borrowDetailId,
            itemId,
            quantity: 2,
            returnedQuantity: 1, // Only 1 left to return
            item: { id: itemId, name: 'Arduino Uno R3' },
          },
        ],
        reservations: [{ itemId, locationId, status: ReservationStatus.FULFILLED }],
      });

      await expect(
        borrowService.returnBorrowRequest(
          borrowRequestId,
          {
            items: [
              {
                borrowDetailId,
                returnedQuantity: 2, // Trying to return 2 when only 1 is outstanding
              },
            ],
          },
          technicianUser
        )
      ).rejects.toThrow('vượt quá số lượng đang mượn còn lại');
    });

    it('TC-BR-10B: Rejects duplicate detail rows before writing return transaction', async () => {
      const mockTx = (prisma as any).__mockTx;
      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        status: BorrowStatus.HANDED_OVER,
        details: [{ id: borrowDetailId, itemId, quantity: 2, returnedQuantity: 0, item: { name: 'Arduino Uno R3' } }],
        reservations: [{ itemId, locationId, status: ReservationStatus.FULFILLED }],
      });

      await expect(borrowService.returnBorrowRequest(
        borrowRequestId,
        { items: [
          { borrowDetailId, returnedQuantity: 2, condition: AssetCondition.GOOD },
          { borrowDetailId, returnedQuantity: 2, condition: AssetCondition.DAMAGED },
        ] },
        technicianUser
      )).rejects.toThrow('Không được hoàn trả trùng dòng chi tiết mượn');
      expect(mockTx.returnTransaction.create).not.toHaveBeenCalled();
      expect(mockTx.stockBalance.update).not.toHaveBeenCalled();
    });

    it('TC-BR-10C: Rejects return if borrowed balance at source location is insufficient', async () => {
      const mockTx = (prisma as any).__mockTx;
      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        status: BorrowStatus.HANDED_OVER,
        details: [{ id: borrowDetailId, itemId, quantity: 2, returnedQuantity: 0, item: { name: 'Arduino Uno R3' } }],
        reservations: [{ itemId, locationId, status: ReservationStatus.FULFILLED }],
      });
      mockTx.returnTransaction.findUnique.mockResolvedValue(null);
      mockTx.returnTransaction.create.mockResolvedValue({ id: 'rt-1' });
      mockTx.returnDetail.create.mockResolvedValue({});
      mockTx.borrowDetail.update.mockResolvedValue({});
      mockTx.stockBalance.findUnique.mockResolvedValue({ id: 'bal-1', onHand: 5, borrowed: 0 });

      await expect(borrowService.returnBorrowRequest(
        borrowRequestId,
        { items: [{ borrowDetailId, returnedQuantity: 2, condition: AssetCondition.GOOD }] },
        technicianUser
      )).rejects.toThrow('Tồn kho đang mượn tại kho nguồn không đủ để ghi nhận hoàn trả');
      expect(mockTx.stockBalance.update).not.toHaveBeenCalled();
    });

    it('TC-BR-10D: Rejects return to a different warehouse', async () => {
      const mockTx = (prisma as any).__mockTx;
      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        status: BorrowStatus.HANDED_OVER,
        details: [{ id: borrowDetailId, itemId, quantity: 2, returnedQuantity: 0, item: { name: 'Arduino Uno R3' } }],
        reservations: [{ itemId, locationId, status: ReservationStatus.FULFILLED }],
      });
      mockTx.returnTransaction.findUnique.mockResolvedValue(null);
      mockTx.returnTransaction.create.mockResolvedValue({ id: 'rt-1' });
      mockTx.returnDetail.create.mockResolvedValue({});
      mockTx.borrowDetail.update.mockResolvedValue({});

      await expect(borrowService.returnBorrowRequest(
        borrowRequestId,
        { items: [{ borrowDetailId, returnedQuantity: 2, condition: AssetCondition.GOOD, locationId: 'wrong-location-id' }] },
        technicianUser
      )).rejects.toThrow('Chưa hỗ trợ trả linh kiện sang kho khác');
      expect(mockTx.stockBalance.update).not.toHaveBeenCalled();
    });

    it('TC-BR-10E: Rejects return if source warehouse cannot be uniquely identified', async () => {
      const mockTx = (prisma as any).__mockTx;
      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        status: BorrowStatus.HANDED_OVER,
        details: [{ id: borrowDetailId, itemId, quantity: 2, returnedQuantity: 0, item: { name: 'Arduino Uno R3' } }],
        reservations: [
          { itemId, locationId: 'loc-1', status: ReservationStatus.FULFILLED },
          { itemId, locationId: 'loc-2', status: ReservationStatus.FULFILLED },
        ],
      });
      mockTx.returnTransaction.findUnique.mockResolvedValue(null);
      mockTx.returnTransaction.create.mockResolvedValue({ id: 'rt-1' });
      mockTx.returnDetail.create.mockResolvedValue({});
      mockTx.borrowDetail.update.mockResolvedValue({});

      await expect(borrowService.returnBorrowRequest(
        borrowRequestId,
        { items: [{ borrowDetailId, returnedQuantity: 2, condition: AssetCondition.GOOD }] },
        technicianUser
      )).rejects.toThrow('Không thể xác định duy nhất kho nguồn');
      expect(mockTx.stockBalance.update).not.toHaveBeenCalled();
    });

    it('TC-BR-11: Rejects return if request is not in HANDED_OVER or PARTIALLY_RETURNED state', async () => {
      const mockTx = (prisma as any).__mockTx;

      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        status: BorrowStatus.RETURNED, // Already completed
        details: [],
      });

      await expect(
        borrowService.returnBorrowRequest(
          borrowRequestId,
          { items: [{ borrowDetailId, returnedQuantity: 1 }] },
          technicianUser
        )
      ).rejects.toThrow('Chỉ phiếu mượn');
    });
  });

  describe('5. FSM State Transitions & Cancellation', () => {
    it('TC-BR-12: Rejects approval of an already APPROVED or CANCELLED request', async () => {
      const mockTx = (prisma as any).__mockTx;

      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        status: BorrowStatus.APPROVED,
        details: [],
      });

      await expect(
        borrowService.approveBorrowRequest(borrowRequestId, {}, adminUser)
      ).rejects.toThrow('Chỉ phiếu mượn \'Chờ duyệt (PENDING)\'');
    });

    it('TC-BR-13: Rejects handover of a PENDING (unapproved) request', async () => {
      const mockTx = (prisma as any).__mockTx;

      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        status: BorrowStatus.PENDING,
        reservations: [],
        details: [],
      });

      await expect(
        borrowService.handoverBorrowRequest(borrowRequestId, {}, technicianUser)
      ).rejects.toThrow('Chỉ phiếu mượn ở trạng thái \'Đã duyệt (APPROVED)\'');
    });

    it('TC-BR-14: Cancels an APPROVED request and safely releases reserved stock', async () => {
      const mockTx = (prisma as any).__mockTx;

      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        status: BorrowStatus.APPROVED,
        reservations: [
          {
            id: reservationId,
            itemId,
            locationId,
            quantity: 3,
            status: ReservationStatus.ACTIVE,
          },
        ],
      });

      mockTx.borrowRequest.update.mockResolvedValue({
        id: borrowRequestId,
        status: BorrowStatus.CANCELLED,
        details: [],
        reservations: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await borrowService.cancelBorrowRequest(
        borrowRequestId,
        { reason: 'Lớp học hủy buổi thực hành' },
        adminUser
      );

      expect(res.status).toBe(BorrowStatus.CANCELLED);
      // Reserved stock rolled back
      expect(mockTx.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { itemId_locationId: { itemId, locationId } },
          data: { reserved: { decrement: 3 } },
        })
      );
      // Reservation released
      expect(mockTx.stockReservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: reservationId },
          data: { status: ReservationStatus.RELEASED },
        })
      );
    });

    it('TC-BR-15: Rejects rejection if reason is missing or status is not PENDING', async () => {
      const mockTx = (prisma as any).__mockTx;

      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        status: BorrowStatus.HANDED_OVER,
      });

      await expect(
        borrowService.rejectBorrowRequest(
          borrowRequestId,
          { rejectionReason: 'Hết hàng' },
          adminUser
        )
      ).rejects.toThrow('Chỉ phiếu mượn \'Chờ duyệt (PENDING)\'');
    });
  });

  describe('6. Overdue Calculation & Filtering', () => {
    it('TC-BR-16: Computes isOverdue = true when HANDED_OVER and past expectedReturnDate', () => {
      const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
      const formatted = formatBorrowRequestResponse({
        id: borrowRequestId,
        requestNumber: 'BR-20261010-0001',
        status: BorrowStatus.HANDED_OVER,
        expectedBorrowDate: new Date('2026-10-05'),
        expectedReturnDate: pastDate,
        details: [],
      });

      expect(formatted.isOverdue).toBe(true);
    });

    it('TC-BR-17: Computes isOverdue = false when HANDED_OVER but return date is in future', () => {
      const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days in future
      const formatted = formatBorrowRequestResponse({
        id: borrowRequestId,
        requestNumber: 'BR-20261010-0001',
        status: BorrowStatus.HANDED_OVER,
        expectedBorrowDate: new Date(),
        expectedReturnDate: futureDate,
        details: [],
      });

      expect(formatted.isOverdue).toBe(false);
    });

    it('TC-BR-18: Computes isOverdue = false when RETURNED even if return date was in past', () => {
      const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const formatted = formatBorrowRequestResponse({
        id: borrowRequestId,
        requestNumber: 'BR-20261001-0001',
        status: BorrowStatus.RETURNED,
        expectedBorrowDate: new Date('2026-10-01'),
        expectedReturnDate: pastDate,
        details: [],
      });

      expect(formatted.isOverdue).toBe(false);
    });

    it('TC-BR-19: Filters overdue requests in listBorrowRequests', async () => {
      vi.mocked(prisma.borrowRequest.count).mockResolvedValue(1);
      vi.mocked(prisma.borrowRequest.findMany).mockResolvedValue([
        {
          id: borrowRequestId,
          requestNumber: 'BR-OVERDUE-01',
          status: BorrowStatus.HANDED_OVER,
          expectedBorrowDate: new Date('2026-10-01'),
          expectedReturnDate: new Date('2026-10-05'),
          details: [],
          reservations: [],
          returnTransactions: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      ]);

      const result = await borrowService.listBorrowRequests(
        { isOverdue: true, page: 1, limit: 20, sortBy: BorrowSortField.CREATED_AT, sortOrder: SortOrder.DESC },
        adminUser
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0].isOverdue).toBe(true);
      expect(prisma.borrowRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: [BorrowStatus.HANDED_OVER, BorrowStatus.PARTIALLY_RETURNED] },
            expectedReturnDate: expect.objectContaining({ lt: expect.any(Date) }),
          }),
        })
      );
    });
  });

  describe('7. RBAC & Data Isolation', () => {
    it('TC-BR-20: Student is isolated to only listing their own requests', async () => {
      vi.mocked(prisma.borrowRequest.count).mockResolvedValue(0);
      vi.mocked(prisma.borrowRequest.findMany).mockResolvedValue([]);

      await borrowService.listBorrowRequests(
        { page: 1, limit: 20, sortBy: BorrowSortField.CREATED_AT, sortOrder: SortOrder.DESC },
        studentUser
      );

      expect(prisma.borrowRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            borrowerId: studentUser.id,
          }),
        })
      );
    });

    it('TC-BR-21: Student cannot view another student\'s borrow request (403)', async () => {
      vi.mocked(prisma.borrowRequest.findUnique).mockResolvedValue({
        id: borrowRequestId,
        borrowerId: 'another-student-id',
        status: BorrowStatus.PENDING,
      } as any);

      await expect(
        borrowService.getBorrowRequestById(borrowRequestId, studentUser)
      ).rejects.toThrow('Bạn không có quyền xem thông tin phiếu mượn này');
    });

    it('TC-BR-22: Student cannot approve or handover requests', async () => {
      await expect(
        borrowService.approveBorrowRequest(borrowRequestId, {}, studentUser)
      ).rejects.toThrow('Chỉ Quản trị viên (ADMIN) hoặc Quản lý phòng Lab (LAB_MANAGER)');

      await expect(
        borrowService.handoverBorrowRequest(borrowRequestId, {}, studentUser)
      ).rejects.toThrow('Chỉ Quản trị viên, Quản lý Lab hoặc Kỹ thuật viên');
    });

    it('TC-BR-23: Student cannot cancel an APPROVED request (only PENDING)', async () => {
      const mockTx = (prisma as any).__mockTx;

      mockTx.borrowRequest.findUnique.mockResolvedValue({
        id: borrowRequestId,
        borrowerId: studentUser.id,
        status: BorrowStatus.APPROVED,
        reservations: [],
      });

      await expect(
        borrowService.cancelBorrowRequest(borrowRequestId, {}, studentUser)
      ).rejects.toThrow('Sinh viên chỉ có thể hủy phiếu mượn khi ở trạng thái \'Chờ duyệt (PENDING)\'');
    });
  });

  describe('8. Concurrency & Race Condition Safeguards', () => {
    it('TC-BR-24: Concurrent approvals on limited stock - only first succeeds, second fails with 400', async () => {
      const mockTx = (prisma as any).__mockTx;

      // Initial state: total available = 2
      let reservedStock = 0;
      mockTx.borrowRequest.findUnique.mockImplementation(async ({ where }: any) => ({
        id: where.id,
        status: BorrowStatus.PENDING,
        details: [
          {
            id: 'detail-' + where.id,
            itemId,
            quantity: 2,
            item: { id: itemId, name: 'Module ESP32' },
          },
        ],
      }));

      mockTx.stockBalance.findMany.mockImplementation(async () => [
        {
          id: 'sb-concurrent',
          itemId,
          locationId,
          onHand: 2,
          reserved: reservedStock,
          quarantined: 0,
          kitAllocated: 0,
          borrowed: 0,
        },
      ]);

      mockTx.stockBalance.update.mockImplementation(async ({ data }: any) => {
        if (data.reserved?.increment) {
          reservedStock += data.reserved.increment;
        }
      });

      mockTx.borrowRequest.update.mockImplementation(async ({ where }: any) => ({
        id: where.id,
        status: BorrowStatus.APPROVED,
        expectedBorrowDate: new Date('2026-10-20'),
        expectedReturnDate: new Date('2026-10-25'),
        details: [],
        reservations: [],
      }));

      // First approval: needs 2, available is 2 - reservedStock (0) = 2 -> succeeds
      const resultA = await borrowService.approveBorrowRequest('req-A', {}, adminUser);
      expect(resultA.status).toBe(BorrowStatus.APPROVED);
      expect(reservedStock).toBe(2);

      // Second approval: needs 2, available is 2 - reservedStock (2) = 0 -> throws 400
      await expect(
        borrowService.approveBorrowRequest('req-B', {}, adminUser)
      ).rejects.toThrow('Không đủ tồn kho khả dụng để duyệt phiếu');
    });

    it('TC-BR-25: Concurrent returns attempting duplicate items - second fails with 400', async () => {
      const mockTx = (prisma as any).__mockTx;

      let returnedQuantityState = 0;
      mockTx.borrowRequest.findUnique.mockImplementation(async () => ({
        id: borrowRequestId,
        requestNumber: 'BR-20261020-0001',
        status: BorrowStatus.HANDED_OVER,
        details: [
          {
            id: borrowDetailId,
            itemId,
            quantity: 1, // Only 1 was borrowed
            returnedQuantity: returnedQuantityState,
            item: { id: itemId, name: 'Cáp chuyển đổi UART' },
          },
        ],
        reservations: [{ itemId, locationId, status: ReservationStatus.FULFILLED }],
      }));

      mockTx.returnTransaction.findUnique.mockResolvedValue(null);
      mockTx.returnTransaction.create.mockResolvedValue({ id: 'rt-concur', returnNumber: 'RT-001' });
      mockTx.stockBalance.findUnique.mockResolvedValue({
        id: 'sb-1',
        itemId,
        locationId,
        onHand: 5,
        reserved: 0,
        quarantined: 0,
        kitAllocated: 0,
        borrowed: 1,
      });

      mockTx.borrowDetail.update.mockImplementation(async ({ data }: any) => {
        if (data.returnedQuantity?.increment) {
          returnedQuantityState += data.returnedQuantity.increment;
        }
      });

      mockTx.borrowDetail.findMany.mockImplementation(async () => [
        { id: borrowDetailId, quantity: 1, returnedQuantity: returnedQuantityState },
      ]);

      mockTx.borrowRequest.update.mockImplementation(async () => ({
        id: borrowRequestId,
        status: BorrowStatus.RETURNED,
        expectedBorrowDate: new Date('2026-10-20'),
        expectedReturnDate: new Date('2026-10-25'),
        details: [{ id: borrowDetailId, itemId, quantity: 1, returnedQuantity: returnedQuantityState }],
        returnTransactions: [],
      }));

      // Call 1 returns the 1 item -> succeeds
      const res1 = await borrowService.returnBorrowRequest(
        borrowRequestId,
        { items: [{ borrowDetailId, returnedQuantity: 1 }] },
        technicianUser
      );
      expect(res1.borrowRequest.status).toBe(BorrowStatus.RETURNED);
      expect(returnedQuantityState).toBe(1);

      // Call 2 tries to return 1 item when returnedQuantityState is already 1 -> fails
      await expect(
        borrowService.returnBorrowRequest(
          borrowRequestId,
          { items: [{ borrowDetailId, returnedQuantity: 1 }] },
          technicianUser
        )
      ).rejects.toThrow('vượt quá số lượng đang mượn còn lại');
    });
  });

  describe('9. HTTP Router Layer & Endpoints', () => {
    it('TC-BR-32: missing Idempotency-Key rejects return with HTTP 400', async () => {
      const { req, res, next, getError, waitForCompletion } = createMockContext({
        method: 'POST',
        url: `/${borrowRequestId}/return`,
        headers: createAuthHeaders(technicianUser),
        params: { id: borrowRequestId },
        body: { items: [{ borrowDetailId, returnedQuantity: 1, condition: AssetCondition.GOOD }] },
        user: technicianUser,
      });
      borrowRouter(req, res, next);
      await waitForCompletion();
      expect(getError()).toBeInstanceOf(AppError);
      expect(getError()?.statusCode).toBe(400);
    });

    it('TC-BR-33: malformed Idempotency-Key rejects return with HTTP 400', async () => {
      const { req, res, next, getError, waitForCompletion } = createMockContext({
        method: 'POST',
        url: `/${borrowRequestId}/return`,
        headers: { ...createAuthHeaders(technicianUser), 'idempotency-key': 'bad!' },
        params: { id: borrowRequestId },
        body: { items: [{ borrowDetailId, returnedQuantity: 1, condition: AssetCondition.GOOD }] },
        user: technicianUser,
      });
      borrowRouter(req, res, next);
      await waitForCompletion();
      expect(getError()).toBeInstanceOf(AppError);
      expect(getError()?.statusCode).toBe(400);
    });

    it('TC-BR-34: valid Idempotency-Key is forwarded to return service', async () => {
      const key = 'borrow_router_valid_key_01';
      const spy = vi.spyOn(borrowService, 'returnBorrowRequest').mockResolvedValueOnce({
        borrowRequest: { id: borrowRequestId, status: BorrowStatus.PARTIALLY_RETURNED } as any,
        returnNumber: 'RT-TEST-KEY',
      });
      const { req, res, next, getError, waitForCompletion } = createMockContext({
        method: 'POST',
        url: `/${borrowRequestId}/return`,
        headers: { ...createAuthHeaders(technicianUser), 'idempotency-key': key },
        params: { id: borrowRequestId },
        body: { items: [{ borrowDetailId, returnedQuantity: 1, condition: AssetCondition.GOOD }] },
        user: technicianUser,
      });
      borrowRouter(req, res, next);
      await waitForCompletion();
      expect(getError()).toBeNull();
      expect(res.statusCode).toBe(200);
      expect(spy).toHaveBeenCalledWith(
        borrowRequestId,
        expect.objectContaining({ items: [expect.objectContaining({ borrowDetailId })] }),
        expect.objectContaining({ id: technicianUser.id }),
        key
      );
    });

    it('TC-BR-26: POST / with invalid date range triggers 422 error', async () => {
      const { req, res, next, getError, waitForCompletion } = createMockContext({
        method: 'POST',
        url: '/',
        headers: createAuthHeaders(studentUser),
        body: {
          expectedBorrowDate: '2026-10-25',
          expectedReturnDate: '2026-10-20', // Before borrow date
          purpose: 'Mượn thiết bị kiểm thử',
          items: [{ itemId, quantity: 1 }],
        },
        user: studentUser,
      });

      borrowRouter(req, res, next);
      await waitForCompletion();
      expect(getError()).toBeInstanceOf(AppError);
      expect(getError()?.statusCode).toBe(422);
    });

    it('TC-BR-27: POST / creates borrow request and responds with 201', async () => {
      vi.spyOn(borrowService, 'createBorrowRequest').mockResolvedValueOnce({
        id: borrowRequestId,
        requestNumber: 'BR-20261020-0099',
        status: BorrowStatus.PENDING,
        borrowerId: studentUser.id,
      } as any);

      const { req, res, next, waitForCompletion } = createMockContext({
        method: 'POST',
        url: '/',
        headers: createAuthHeaders(studentUser),
        body: {
          expectedBorrowDate: '2026-10-20',
          expectedReturnDate: '2026-10-25',
          purpose: 'Thực hành môn Vi điều khiển',
          items: [{ itemId, quantity: 1 }],
        },
        user: studentUser,
      });

      borrowRouter(req, res, next);
      await waitForCompletion();
      expect(res.statusCode).toBe(201);
      expect(res.body?.success).toBe(true);
      expect(res.body?.data?.requestNumber).toBe('BR-20261020-0099');
    });

    it('TC-BR-28: PATCH /:id/approve approves request and returns 200', async () => {
      vi.spyOn(borrowService, 'approveBorrowRequest').mockResolvedValueOnce({
        id: borrowRequestId,
        status: BorrowStatus.APPROVED,
      } as any);

      const { req, res, next, waitForCompletion } = createMockContext({
        method: 'PATCH',
        url: `/${borrowRequestId}/approve`,
        headers: createAuthHeaders(adminUser),
        params: { id: borrowRequestId },
        body: { notes: 'Đã duyệt' },
        user: adminUser,
      });

      borrowRouter(req, res, next);
      await waitForCompletion();
      expect(res.statusCode).toBe(200);
      expect(res.body?.success).toBe(true);
    });

    it('TC-BR-29: PATCH /:id/reject validates rejectionReason (<3 chars -> 422)', async () => {
      const { req, res, next, getError, waitForCompletion } = createMockContext({
        method: 'PATCH',
        url: `/${borrowRequestId}/reject`,
        headers: createAuthHeaders(adminUser),
        params: { id: borrowRequestId },
        body: { rejectionReason: 'No' }, // < 3 chars
        user: adminUser,
      });

      borrowRouter(req, res, next);
      await waitForCompletion();
      expect(getError()).toBeInstanceOf(AppError);
      expect(getError()?.statusCode).toBe(422);
    });

    it('TC-BR-30: GET / lists borrow requests with pagination metadata', async () => {
      vi.spyOn(borrowService, 'listBorrowRequests').mockResolvedValueOnce({
        items: [
          { id: borrowRequestId, requestNumber: 'BR-001', status: BorrowStatus.PENDING } as any,
        ],
        meta: {
          page: 1,
          limit: 20,
          totalItems: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
      });

      const { req, res, next, waitForCompletion } = createMockContext({
        method: 'GET',
        url: '/',
        headers: createAuthHeaders(adminUser),
        query: { page: '1', limit: '20' },
        user: adminUser,
      });

      borrowRouter(req, res, next);
      await waitForCompletion();
      expect(res.statusCode).toBe(200);
      expect(res.body?.success).toBe(true);
      expect(res.body?.data).toHaveLength(1);
      expect(res.body?.meta?.totalItems).toBe(1);
    });

    it('TC-BR-31: GET /:id returns single borrow request details', async () => {
      vi.spyOn(borrowService, 'getBorrowRequestById').mockResolvedValueOnce({
        id: borrowRequestId,
        requestNumber: 'BR-001',
        status: BorrowStatus.PENDING,
      } as any);

      const { req, res, next, waitForCompletion } = createMockContext({
        method: 'GET',
        url: `/${borrowRequestId}`,
        headers: createAuthHeaders(adminUser),
        params: { id: borrowRequestId },
        user: adminUser,
      });

      borrowRouter(req, res, next);
      await waitForCompletion();
      expect(res.statusCode).toBe(200);
      expect(res.body?.success).toBe(true);
      expect(res.body?.data?.id).toBe(borrowRequestId);
    });
  });
});
