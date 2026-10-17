import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole, ItemType, StockStatus, calculateAvailableStock, isLowStock, getItemStockStatus } from '@acm/shared';
import { itemsService, formatItemResponse } from '../src/modules/items/items.service';
import { itemsRouter } from '../src/modules/items/items.router';
import { prisma } from '../src/config/database';
import { AppError } from '../src/shared/AppError';

// Mock prisma client methods
vi.mock('../src/config/database', () => {
  const mockTx = {
    item: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    stockBalance: {
      deleteMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };

  return {
    prisma: {
      item: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      category: {
        findUnique: vi.fn(),
      },
      asset: {
        findFirst: vi.fn(),
      },
      stockBalance: {
        deleteMany: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(mockTx)),
      __mockTx: mockTx,
    },
  };
});

/**
 * Pure In-Memory Mock Response for route invocation testing
 */
class MockResponse {
  statusCode: number = 200;
  headers: Record<string, string> = {};
  body: any = null;
  ended: boolean = false;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(payload: any) {
    this.body = payload;
    this.ended = true;
    return this;
  }

  send(payload: any) {
    this.body = payload;
    this.ended = true;
    return this;
  }

  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  getHeader(name: string) {
    return this.headers[name.toLowerCase()];
  }
}

describe('ACM Phase 3 – Inventory Management & Items Suite', () => {
  const validUUID = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
  const categoryId = 'c1c2c3c4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
  const userId = 'u1u2u3u4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

  const mockCategory = {
    id: categoryId,
    code: 'CAT-MCU',
    name: 'Microcontrollers',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // SUITE 1: STOCK STATUS BUSINESS RULES GROUNDING
  // ==========================================
  describe('Stock Status Business Rules Grounding', () => {
    it('accurately identifies OUT_OF_STOCK when available is 0 or negative', () => {
      // 0 available with default minStockAlert (5)
      expect(getItemStockStatus(0, 5)).toBe(StockStatus.OUT_OF_STOCK);
      // 0 available with 0 alert
      expect(getItemStockStatus(0, 0)).toBe(StockStatus.OUT_OF_STOCK);
    });

    it('accurately identifies LOW_STOCK when 0 < available < minStockAlert', () => {
      expect(getItemStockStatus(1, 5)).toBe(StockStatus.LOW_STOCK);
      expect(getItemStockStatus(4, 5)).toBe(StockStatus.LOW_STOCK);
      expect(getItemStockStatus(9, 10)).toBe(StockStatus.LOW_STOCK);
    });

    it('accurately identifies IN_STOCK when available >= minStockAlert and available > 0', () => {
      expect(getItemStockStatus(5, 5)).toBe(StockStatus.IN_STOCK);
      expect(getItemStockStatus(20, 5)).toBe(StockStatus.IN_STOCK);
      expect(getItemStockStatus(1, 0)).toBe(StockStatus.IN_STOCK);
    });

    it('correctly aggregates location balances and computes available and stockStatus in formatItemResponse', () => {
      const mockRawItem = {
        id: validUUID,
        code: 'ARD-UNO-R3',
        name: 'Arduino Uno R3',
        description: 'ATmega328P Board',
        unit: 'Cái',
        type: ItemType.TRACKED_ASSET,
        categoryId,
        category: mockCategory,
        minStockAlert: 10,
        imageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        stockBalances: [
          {
            id: 'sb-1',
            locationId: 'loc-1',
            location: { code: 'WH-01', name: 'Kho Tổng' },
            onHand: 15,
            reserved: 3,
            quarantined: 1,
            kitAllocated: 2,
            borrowed: 0,
          },
          {
            id: 'sb-2',
            locationId: 'loc-2',
            location: { code: 'LAB-A', name: 'Phòng Thí Nghiệm A' },
            onHand: 5,
            reserved: 1,
            quarantined: 0,
            kitAllocated: 0,
            borrowed: 0,
          },
        ],
      };

      const formatted = formatItemResponse(mockRawItem);

      // totalOnHand = 15 + 5 = 20
      expect(formatted.totalOnHand).toBe(20);
      // totalReserved = 3 + 1 = 4
      expect(formatted.totalReserved).toBe(4);
      // totalQuarantined = 1 + 0 = 1
      expect(formatted.totalQuarantined).toBe(1);
      // totalKitAllocated = 2 + 0 = 2
      expect(formatted.totalKitAllocated).toBe(2);
      // available = 20 - 4 - 1 - 2 = 13
      expect(formatted.available).toBe(13);
      // 13 >= minStockAlert (10) -> IN_STOCK
      expect(formatted.isLowStock).toBe(false);
      expect(formatted.stockStatus).toBe(StockStatus.IN_STOCK);
    });

    it('computes LOW_STOCK and OUT_OF_STOCK correctly in formatItemResponse', () => {
      const mockLowStockItem = {
        id: validUUID,
        code: 'ESP32',
        name: 'ESP32 NodeMCU',
        unit: 'Cái',
        type: ItemType.TRACKED_ASSET,
        categoryId,
        category: mockCategory,
        minStockAlert: 10,
        isActive: true,
        stockBalances: [
          {
            id: 'sb-1',
            onHand: 5,
            reserved: 1,
            quarantined: 0,
            kitAllocated: 0,
            borrowed: 0,
          },
        ],
      };
      // available = 5 - 1 = 4 < 10 -> LOW_STOCK
      const lowResult = formatItemResponse(mockLowStockItem);
      expect(lowResult.available).toBe(4);
      expect(lowResult.isLowStock).toBe(true);
      expect(lowResult.stockStatus).toBe(StockStatus.LOW_STOCK);

      const mockOutOfStockItem = {
        ...mockLowStockItem,
        stockBalances: [
          {
            id: 'sb-1',
            onHand: 2,
            reserved: 2,
            quarantined: 0,
            kitAllocated: 0,
            borrowed: 0,
          },
        ],
      };
      // available = 2 - 2 = 0 -> OUT_OF_STOCK
      const outResult = formatItemResponse(mockOutOfStockItem);
      expect(outResult.available).toBe(0);
      expect(outResult.isLowStock).toBe(true);
      expect(outResult.stockStatus).toBe(StockStatus.OUT_OF_STOCK);
    });
  });

  // ==========================================
  // SUITE 2: RBAC & ACCESS CONTROL
  // ==========================================
  describe('RBAC & Role Access Control on Items', () => {
    it('restricts STUDENT to only active items when listing items', async () => {
      const studentUser = {
        id: userId,
        email: 'student@acm.edu.vn',
        role: UserRole.STUDENT,
        fullName: 'Student User',
      };

      (prisma.item.count as any).mockResolvedValue(1);
      (prisma.item.findMany as any).mockResolvedValue([
        {
          id: validUUID,
          code: 'ARD-UNO-R3',
          name: 'Arduino Uno R3',
          unit: 'Cái',
          type: ItemType.CONSUMABLE,
          categoryId,
          minStockAlert: 5,
          isActive: true,
          stockBalances: [],
        },
      ]);

      const result = await itemsService.listItems({ page: 1, limit: 20 }, studentUser as any);
      expect(result.items.length).toBe(1);

      // Verify the query where clause enforced isActive: true
      const callArgs = (prisma.item.findMany as any).mock.calls[0][0];
      const andClauses = callArgs.where.AND;
      const activeClause = andClauses.find((c: any) => c.isActive !== undefined);
      expect(activeClause).toEqual({ isActive: true });
    });

    it('forbids STUDENT from viewing inactive item directly by ID (403)', async () => {
      const studentUser = {
        id: userId,
        email: 'student@acm.edu.vn',
        role: UserRole.STUDENT,
        fullName: 'Student User',
      };

      (prisma.item.findUnique as any).mockResolvedValue({
        id: validUUID,
        code: 'OLD-SENSOR',
        name: 'Old Sensor (Discontinued)',
        unit: 'Cái',
        type: ItemType.CONSUMABLE,
        categoryId,
        minStockAlert: 5,
        isActive: false, // Inactive item
        stockBalances: [],
      });

      await expect(itemsService.getItemById(validUUID, studentUser as any)).rejects.toThrow(
        new AppError('Bạn không có quyền truy cập linh kiện đã ngưng hoạt động', 403)
      );
    });

    it('allows ADMIN to view inactive item directly by ID', async () => {
      const adminUser = {
        id: userId,
        email: 'admin@acm.edu.vn',
        role: UserRole.ADMIN,
        fullName: 'Admin User',
      };

      (prisma.item.findUnique as any).mockResolvedValue({
        id: validUUID,
        code: 'OLD-SENSOR',
        name: 'Old Sensor',
        unit: 'Cái',
        type: ItemType.CONSUMABLE,
        categoryId,
        minStockAlert: 5,
        isActive: false,
        stockBalances: [],
      });

      const res = await itemsService.getItemById(validUUID, adminUser as any);
      expect(res.id).toBe(validUUID);
      expect(res.isActive).toBe(false);
    });
  });

  // ==========================================
  // SUITE 3: VALIDATION & SKU NORMALIZATION & CONFLICTS
  // ==========================================
  describe('Validation, Normalization & Conflict Checks', () => {
    it('normalizes SKU to uppercase and trims spaces on create', async () => {
      (prisma.item.findFirst as any).mockResolvedValue(null);
      (prisma.category.findUnique as any).mockResolvedValue(mockCategory);

      const mockTx = (prisma as any).__mockTx;
      mockTx.item.create.mockResolvedValue({
        id: validUUID,
        code: 'STM32-F401',
        name: 'STM32 Microcontroller',
        unit: 'Cái',
        type: ItemType.TRACKED_ASSET,
        categoryId,
        minStockAlert: 5,
        imageUrl: null,
        isActive: true,
        stockBalances: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const created = await itemsService.createItem(
        {
          code: '  stm32-f401  ', // lower case with spaces
          name: '  STM32 Microcontroller  ',
          unit: 'Cái',
          type: ItemType.TRACKED_ASSET,
          categoryId,
          minStockAlert: 5,
        },
        userId
      );

      expect(created.code).toBe('STM32-F401');
      // Ensure the create call received the normalized uppercase code
      expect(mockTx.item.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            code: 'STM32-F401',
            name: 'STM32 Microcontroller',
          }),
        })
      );
    });

    it('rejects duplicate SKU case-insensitively on create (409 Conflict)', async () => {
      (prisma.item.findFirst as any).mockResolvedValue({
        id: 'existing-id',
        code: 'STM32-F401',
      });

      await expect(
        itemsService.createItem(
          {
            code: 'stm32-f401',
            name: 'Another STM32',
            unit: 'Cái',
            categoryId,
            minStockAlert: 5,
          },
          userId
        )
      ).rejects.toThrow(
        new AppError("Mã linh kiện/thiết bị 'STM32-F401' đã tồn tại trong hệ thống", 409)
      );
    });

    it('rejects creation when category does not exist (404)', async () => {
      (prisma.item.findFirst as any).mockResolvedValue(null);
      (prisma.category.findUnique as any).mockResolvedValue(null);

      await expect(
        itemsService.createItem(
          {
            code: 'NEW-ITEM',
            name: 'New Item',
            unit: 'Cái',
            categoryId: 'non-existent-cat',
            minStockAlert: 5,
          },
          userId
        )
      ).rejects.toThrow(
        new AppError("Danh mục với ID 'non-existent-cat' không tồn tại", 404)
      );
    });

    it('rejects SKU conflict when updating code to an existing item (409)', async () => {
      (prisma.item.findUnique as any).mockResolvedValue({
        id: validUUID,
        code: 'OLD-SKU',
        name: 'Item Name',
        categoryId,
      });

      (prisma.item.findFirst as any).mockResolvedValue({
        id: 'other-id',
        code: 'CONFLICT-SKU',
      });

      await expect(
        itemsService.updateItem(
          validUUID,
          {
            code: 'conflict-sku',
          },
          userId
        )
      ).rejects.toThrow(
        new AppError("Mã linh kiện/thiết bị 'CONFLICT-SKU' đã tồn tại trong hệ thống", 409)
      );
    });
  });

  // ==========================================
  // SUITE 4: SEARCH, FILTERING & BARCODE LOOKUP
  // ==========================================
  describe('Search, Category & Stock Status Filtering & Barcode Lookup', () => {
    it('resolves item by tracked Asset barcode', async () => {
      (prisma.asset.findFirst as any).mockResolvedValue({
        id: 'asset-1',
        barcode: 'BC-ASSET-001',
        item: {
          id: validUUID,
          code: 'ARD-UNO-R3',
          name: 'Arduino Uno R3',
          unit: 'Cái',
          type: ItemType.TRACKED_ASSET,
          categoryId,
          category: mockCategory,
          minStockAlert: 5,
          isActive: true,
          stockBalances: [],
        },
      });

      const res = await itemsService.getItemByBarcode('BC-ASSET-001');
      expect(res.id).toBe(validUUID);
      expect(res.code).toBe('ARD-UNO-R3');
    });

    it('resolves item by Item SKU code when scanned as barcode', async () => {
      (prisma.asset.findFirst as any).mockResolvedValue(null);
      (prisma.item.findFirst as any).mockResolvedValue({
        id: validUUID,
        code: 'RES-10K',
        name: 'Resistor 10k',
        unit: 'Cái',
        type: ItemType.CONSUMABLE,
        categoryId,
        category: mockCategory,
        minStockAlert: 100,
        isActive: true,
        stockBalances: [],
      });

      const res = await itemsService.getItemByBarcode('RES-10K');
      expect(res.id).toBe(validUUID);
      expect(res.code).toBe('RES-10K');
    });

    it('throws 404 when barcode does not match any asset or item', async () => {
      (prisma.asset.findFirst as any).mockResolvedValue(null);
      (prisma.item.findFirst as any).mockResolvedValue(null);

      await expect(itemsService.getItemByBarcode('UNKNOWN-BARCODE')).rejects.toThrow(
        new AppError("Không tìm thấy linh kiện nào với mã barcode/SKU 'UNKNOWN-BARCODE'", 404)
      );
    });

    it('filters items correctly by stockStatus in listItems', async () => {
      const itemsList = [
        {
          id: 'item-1',
          code: 'IT-1',
          name: 'Item Available',
          unit: 'Cái',
          type: ItemType.CONSUMABLE,
          categoryId,
          minStockAlert: 5,
          isActive: true,
          stockBalances: [{ onHand: 20, reserved: 0, quarantined: 0, kitAllocated: 0, borrowed: 0 }],
        },
        {
          id: 'item-2',
          code: 'IT-2',
          name: 'Item Low Stock',
          unit: 'Cái',
          type: ItemType.CONSUMABLE,
          categoryId,
          minStockAlert: 5,
          isActive: true,
          stockBalances: [{ onHand: 3, reserved: 0, quarantined: 0, kitAllocated: 0, borrowed: 0 }],
        },
        {
          id: 'item-3',
          code: 'IT-3',
          name: 'Item Out Of Stock',
          unit: 'Cái',
          type: ItemType.CONSUMABLE,
          categoryId,
          minStockAlert: 5,
          isActive: true,
          stockBalances: [{ onHand: 0, reserved: 0, quarantined: 0, kitAllocated: 0, borrowed: 0 }],
        },
      ];

      (prisma.item.findMany as any).mockResolvedValue(itemsList);

      // Filter OUT_OF_STOCK
      const outResult = await itemsService.listItems({ stockStatus: StockStatus.OUT_OF_STOCK });
      expect(outResult.items.length).toBe(1);
      expect(outResult.items[0].code).toBe('IT-3');

      // Filter LOW_STOCK
      const lowResult = await itemsService.listItems({ stockStatus: StockStatus.LOW_STOCK });
      expect(lowResult.items.length).toBe(1);
      expect(lowResult.items[0].code).toBe('IT-2');

      // Filter IN_STOCK
      const inResult = await itemsService.listItems({ stockStatus: StockStatus.IN_STOCK });
      expect(inResult.items.length).toBe(1);
      expect(inResult.items[0].code).toBe('IT-1');
    });
  });

  // ==========================================
  // SUITE 5: SAFE DELETION & AUDIT LOGGING
  // ==========================================
  describe('Safe Item Deletion & Audit Log Invariants', () => {
    it('rejects deletion if item has onHand physical stock > 0 (400)', async () => {
      (prisma.item.findUnique as any).mockResolvedValue({
        id: validUUID,
        code: 'ACTIVE-ITEM',
        name: 'Item with Stock',
        stockBalances: [{ onHand: 10, reserved: 0, quarantined: 0, kitAllocated: 0, borrowed: 0 }],
        stockMovements: [],
        stockTransactionDetails: [],
        borrowDetails: [],
        kitItems: [],
        assets: [],
      });

      await expect(itemsService.deleteItem(validUUID, userId)).rejects.toThrow(
        /Không thể xóa linh kiện 'ACTIVE-ITEM' vì đang còn số dư tồn kho/
      );
    });

    it('rejects deletion if item has borrowed stock > 0 (400)', async () => {
      (prisma.item.findUnique as any).mockResolvedValue({
        id: validUUID,
        code: 'BORROWED-ITEM',
        name: 'Item Borrowed',
        stockBalances: [{ onHand: 0, reserved: 0, quarantined: 0, kitAllocated: 0, borrowed: 5 }],
        stockMovements: [],
        stockTransactionDetails: [],
        borrowDetails: [],
        kitItems: [],
        assets: [],
      });

      await expect(itemsService.deleteItem(validUUID, userId)).rejects.toThrow(
        /Không thể xóa linh kiện 'BORROWED-ITEM' vì đang còn số dư tồn kho/
      );
    });

    it('rejects deletion if item has historical movements/transactions (409 Conflict)', async () => {
      (prisma.item.findUnique as any).mockResolvedValue({
        id: validUUID,
        code: 'HIST-ITEM',
        name: 'Item with History',
        stockBalances: [{ onHand: 0, reserved: 0, quarantined: 0, kitAllocated: 0, borrowed: 0 }],
        stockMovements: [{ id: 'sm-1' }],
        stockTransactionDetails: [],
        borrowDetails: [],
        kitItems: [],
        assets: [],
      });

      await expect(itemsService.deleteItem(validUUID, userId)).rejects.toThrow(
        /Không thể xóa vật lý linh kiện 'HIST-ITEM' do đã phát sinh lịch sử giao dịch kho/
      );
    });

    it('allows clean deletion and records AuditLog when stock is 0 and no transaction history exists', async () => {
      (prisma.item.findUnique as any).mockResolvedValue({
        id: validUUID,
        code: 'CLEAN-ITEM',
        name: 'Mistakenly Created Item',
        unit: 'Cái',
        type: ItemType.CONSUMABLE,
        categoryId,
        minStockAlert: 5,
        stockBalances: [{ onHand: 0, reserved: 0, quarantined: 0, kitAllocated: 0, borrowed: 0 }],
        stockMovements: [],
        stockTransactionDetails: [],
        borrowDetails: [],
        kitItems: [],
        assets: [],
      });

      const mockTx = (prisma as any).__mockTx;
      mockTx.item.delete.mockResolvedValue({
        id: validUUID,
        code: 'CLEAN-ITEM',
        name: 'Mistakenly Created Item',
      });

      const deleted = await itemsService.deleteItem(validUUID, userId, '192.168.1.100', 'TestAgent');
      expect(deleted.id).toBe(validUUID);
      expect(deleted.code).toBe('CLEAN-ITEM');

      // Verify zero balance cleanup
      expect(mockTx.stockBalance.deleteMany).toHaveBeenCalledWith({
        where: { itemId: validUUID },
      });

      // Verify AuditLog creation
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            action: 'DELETE_ITEM',
            entity: 'Item',
            entityId: validUUID,
            ipAddress: '192.168.1.100',
            userAgent: 'TestAgent',
          }),
        })
      );
    });

    it('records AuditLog on item update and item status deactivation', async () => {
      // 1. Update status
      (prisma.item.findUnique as any).mockResolvedValue({
        id: validUUID,
        code: 'ESP32',
        isActive: true,
      });

      const mockTx = (prisma as any).__mockTx;
      mockTx.item.update.mockResolvedValue({
        id: validUUID,
        code: 'ESP32',
        name: 'ESP32 NodeMCU',
        unit: 'Cái',
        type: ItemType.TRACKED_ASSET,
        categoryId,
        minStockAlert: 5,
        isActive: false,
        stockBalances: [],
      });

      await itemsService.updateItemStatus(
        validUUID,
        { isActive: false, reason: 'Tạm ngưng thí nghiệm' },
        userId,
        '127.0.0.1'
      );

      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            action: 'DEACTIVATE_ITEM',
            entity: 'Item',
            entityId: validUUID,
            oldValue: { isActive: true },
            newValue: { isActive: false, reason: 'Tạm ngưng thí nghiệm' },
          }),
        })
      );
    });
  });

  // ==========================================
  // SUITE 6: NEGATIVE STOCK PREVENTION & INVARIANTS
  // ==========================================
  describe('Stock Balance Invariants & Negative Stock Prevention', () => {
    it('throws domain error when onHand or other quantities are negative', () => {
      expect(() =>
        calculateAvailableStock({
          onHand: -5,
          reserved: 0,
          quarantined: 0,
          kitAllocated: 0,
          borrowed: 0,
        })
      ).toThrow(/Stock quantity 'onHand' cannot be negative/);
    });

    it('throws domain error when total warehouse allocations exceed On-hand', () => {
      expect(() =>
        calculateAvailableStock({
          onHand: 10,
          reserved: 6,
          quarantined: 3,
          kitAllocated: 2, // 6 + 3 + 2 = 11 > 10
          borrowed: 0,
        })
      ).toThrow(/exceeds On-hand/);
    });
  });
});
