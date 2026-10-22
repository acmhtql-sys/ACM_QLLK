import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole, KitStatus, KitSortField, SortOrder, ItemType } from '@acm/shared';
import { kitsService, formatKitResponse } from '../src/modules/kits/kits.service';
import { prisma } from '../src/config/database';
import { AppError } from '../src/shared/AppError';

vi.mock('../src/config/database', () => {
  const mockTx = {
    kit: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
    kitItem: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    stockBalance: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };

  return {
    prisma: {
      kit: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      kitItem: {
        create: vi.fn(),
        deleteMany: vi.fn(),
      },
      item: {
        findUnique: vi.fn(),
      },
      location: {
        findUnique: vi.fn(),
      },
      stockBalance: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(mockTx)),
      __mockTx: mockTx,
    },
  };
});

describe('Phase 5 – Kit Management & Inventory Synchronization Unit Tests', () => {
  const adminUser = {
    id: 'admin-uuid-001',
    email: 'admin@acm.local',
    fullName: 'Quản Trị Viên',
    role: UserRole.ADMIN,
  };

  const managerUser = {
    id: 'manager-uuid-002',
    email: 'manager@acm.local',
    fullName: 'Quản Lý Lab',
    role: UserRole.LAB_MANAGER,
  };

  const techUser = {
    id: 'tech-uuid-003',
    email: 'tech@acm.local',
    fullName: 'Kỹ Thuật Viên',
    role: UserRole.TECHNICIAN,
  };

  const studentUser = {
    id: 'student-uuid-004',
    email: 'student@acm.local',
    fullName: 'Sinh Viên',
    role: UserRole.STUDENT,
  };

  const validLocationId = 'loc-wh-001';
  const validItemId1 = 'item-esp32-001';
  const validItemId2 = 'item-dht22-002';

  const mockKitRecord = {
    id: 'kit-uuid-001',
    code: 'KIT-IOT-001',
    name: 'Bộ thực hành IoT ESP32',
    description: 'Thực hành kết nối cảm biến và MQTT',
    status: KitStatus.AVAILABLE,
    locationId: validLocationId,
    location: { id: validLocationId, code: 'WH-MAIN', name: 'Kho Tổng Phòng Lab' },
    createdById: techUser.id,
    createdBy: { id: techUser.id, fullName: techUser.fullName, email: techUser.email },
    items: [
      {
        id: 'kit-item-01',
        kitId: 'kit-uuid-001',
        itemId: validItemId1,
        item: {
          id: validItemId1,
          code: 'ESP32-DEVKIT',
          name: 'ESP32 DevKit V1',
          unit: 'cái',
          type: ItemType.TRACKED_ASSET,
        },
        quantity: 1,
        notes: 'Board vi điều khiển chính',
        createdAt: new Date('2026-02-01'),
      },
      {
        id: 'kit-item-02',
        kitId: 'kit-uuid-001',
        itemId: validItemId2,
        item: {
          id: validItemId2,
          code: 'DHT22-SEN',
          name: 'Cảm biến nhiệt ẩm DHT22',
          unit: 'cái',
          type: ItemType.CONSUMABLE,
        },
        quantity: 2,
        notes: 'Cảm biến',
        createdAt: new Date('2026-02-01'),
      },
    ],
    createdAt: new Date('2026-02-01'),
    updatedAt: new Date('2026-02-01'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatKitResponse', () => {
    it('correctly maps kit record and calculates totalItems sum', () => {
      const formatted = formatKitResponse(mockKitRecord);
      expect(formatted.id).toBe(mockKitRecord.id);
      expect(formatted.code).toBe('KIT-IOT-001');
      expect(formatted.items).toHaveLength(2);
      expect(formatted.totalItems).toBe(3); // 1 + 2
      expect(formatted.location?.code).toBe('WH-MAIN');
    });
  });

  describe('listKits', () => {
    it('allows all users including STUDENT to view kit listings', async () => {
      vi.mocked(prisma.kit.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.kit.findMany).mockResolvedValueOnce([mockKitRecord as any]);

      const result = await kitsService.listKits({}, studentUser as any);
      expect(result.items).toHaveLength(1);
      expect(result.meta.totalItems).toBe(1);
      expect(result.items[0].code).toBe('KIT-IOT-001');
    });

    it('filters by status, locationId and applies sorting', async () => {
      vi.mocked(prisma.kit.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.kit.findMany).mockResolvedValueOnce([mockKitRecord as any]);

      await kitsService.listKits(
        {
          status: KitStatus.AVAILABLE,
          locationId: validLocationId,
          search: 'ESP32',
          sortBy: KitSortField.NAME,
          sortOrder: SortOrder.ASC,
          page: 1,
          limit: 10,
        },
        techUser as any
      );

      expect(prisma.kit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: KitStatus.AVAILABLE,
            locationId: validLocationId,
            OR: expect.arrayContaining([{ code: { contains: 'ESP32', mode: 'insensitive' } }]),
          }),
          orderBy: { [KitSortField.NAME]: SortOrder.ASC },
          take: 10,
        })
      );
    });
  });

  describe('getKitById', () => {
    it('returns kit details when found', async () => {
      vi.mocked(prisma.kit.findUnique).mockResolvedValueOnce(mockKitRecord as any);

      const result = await kitsService.getKitById(mockKitRecord.id, studentUser as any);
      expect(result.id).toBe(mockKitRecord.id);
      expect(result.items).toHaveLength(2);
    });

    it('throws 404 when kit does not exist', async () => {
      vi.mocked(prisma.kit.findUnique).mockResolvedValueOnce(null);

      await expect(kitsService.getKitById('unknown-kit-id', studentUser as any)).rejects.toThrow(
        new AppError('Hộp kit không tồn tại trong hệ thống', 404)
      );
    });
  });

  describe('createKit & Inventory Allocation', () => {
    it('rejects STUDENT from creating kits with 403 Forbidden', async () => {
      await expect(
        kitsService.createKit(
          {
            code: 'KIT-IOT-002',
            name: 'Kit Sinh Viên',
            items: [{ itemId: validItemId1, quantity: 1 }],
          },
          studentUser as any
        )
      ).rejects.toThrow(
        new AppError('Sinh viên không có quyền tạo hộp kit thực hành', 403)
      );
    });

    it('rejects duplicate kit code with 409 Conflict', async () => {
      vi.mocked(prisma.kit.findUnique).mockResolvedValueOnce(mockKitRecord as any);

      await expect(
        kitsService.createKit(
          {
            code: 'KIT-IOT-001',
            name: 'Kit Trùng Mã',
            items: [{ itemId: validItemId1, quantity: 1 }],
          },
          techUser as any
        )
      ).rejects.toThrow(
        new AppError("Mã hộp kit 'KIT-IOT-001' đã tồn tại trong hệ thống", 409)
      );
    });

    it('rejects creation when component item does not exist (404)', async () => {
      vi.mocked(prisma.kit.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.location.findUnique).mockResolvedValueOnce({
        id: validLocationId,
        isActive: true,
      } as any);
      vi.mocked(prisma.item.findUnique).mockResolvedValueOnce(null);

      await expect(
        kitsService.createKit(
          {
            code: 'KIT-IOT-002',
            name: 'Kit Thiếu Linh Kiện',
            locationId: validLocationId,
            items: [{ itemId: 'non-existent-item', quantity: 1 }],
          },
          techUser as any
        )
      ).rejects.toThrow(new AppError("Linh kiện với ID 'non-existent-item' không tồn tại", 404));
    });

    it('rejects creation when available stock is insufficient at target location (400)', async () => {
      vi.mocked(prisma.kit.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.location.findUnique).mockResolvedValueOnce({
        id: validLocationId,
        isActive: true,
      } as any);

      // Mock item with onHand = 5, reserved = 3, kitAllocated = 1 -> available = 1
      vi.mocked(prisma.item.findUnique).mockResolvedValueOnce({
        id: validItemId1,
        name: 'ESP32 DevKit V1',
        isActive: true,
        stockBalances: [
          {
            locationId: validLocationId,
            onHand: 5,
            reserved: 3,
            quarantined: 0,
            kitAllocated: 1,
          },
        ],
      } as any);

      // We request quantity: 2, but available is only 1!
      await expect(
        kitsService.createKit(
          {
            code: 'KIT-IOT-002',
            name: 'Kit Quá Tồn Kho',
            locationId: validLocationId,
            items: [{ itemId: validItemId1, quantity: 2 }],
          },
          techUser as any
        )
      ).rejects.toThrow(
        /Không đủ tồn kho khả dụng cho linh kiện 'ESP32 DevKit V1'/
      );
    });

    it('creates kit, increments StockBalance.kitAllocated, and writes AuditLog inside transaction', async () => {
      vi.mocked(prisma.kit.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.location.findUnique).mockResolvedValueOnce({
        id: validLocationId,
        isActive: true,
      } as any);

      // Item has onHand = 10, available = 10
      vi.mocked(prisma.item.findUnique).mockResolvedValueOnce({
        id: validItemId1,
        name: 'ESP32 DevKit V1',
        isActive: true,
        stockBalances: [
          {
            locationId: validLocationId,
            onHand: 10,
            reserved: 0,
            quarantined: 0,
            kitAllocated: 0,
          },
        ],
      } as any);

      const mockTx = (prisma as any).__mockTx;
      mockTx.kit.create.mockResolvedValueOnce({
        id: 'new-kit-uuid',
        code: 'KIT-IOT-002',
        name: 'Kit Mới Hợp Lệ',
        status: KitStatus.AVAILABLE,
        locationId: validLocationId,
      });

      mockTx.kit.findUnique.mockResolvedValueOnce({
        id: 'new-kit-uuid',
        code: 'KIT-IOT-002',
        name: 'Kit Mới Hợp Lệ',
        status: KitStatus.AVAILABLE,
        locationId: validLocationId,
        items: [
          {
            id: 'ki-1',
            itemId: validItemId1,
            quantity: 3,
            item: { id: validItemId1, code: 'ESP32', name: 'ESP32', unit: 'cái', type: ItemType.TRACKED_ASSET },
          },
        ],
      });

      const result = await kitsService.createKit(
        {
          code: 'KIT-IOT-002',
          name: 'Kit Mới Hợp Lệ',
          locationId: validLocationId,
          items: [{ itemId: validItemId1, quantity: 3 }],
        },
        techUser as any
      );

      expect(result.id).toBe('new-kit-uuid');
      expect(mockTx.kitItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            itemId: validItemId1,
            quantity: 3,
          }),
        })
      );
      // Confirms stock allocation increment
      expect(mockTx.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            itemId_locationId: {
              itemId: validItemId1,
              locationId: validLocationId,
            },
          },
          data: {
            kitAllocated: { increment: 3 },
          },
        })
      );
      // Confirms audit log
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CREATE_KIT',
            entity: 'Kit',
            entityId: 'new-kit-uuid',
          }),
        })
      );
    });
  });

  describe('updateKit & Stock Reconciliation', () => {
    it('rejects updating items when kit is in ALLOCATED status (400)', async () => {
      vi.mocked(prisma.kit.findUnique).mockResolvedValueOnce({
        ...mockKitRecord,
        status: KitStatus.ALLOCATED,
      } as any);

      await expect(
        kitsService.updateKit(
          mockKitRecord.id,
          { items: [{ itemId: validItemId1, quantity: 5 }] },
          techUser as any
        )
      ).rejects.toThrow(
        new AppError('Không thể chỉnh sửa danh sách linh kiện khi hộp kit đang được phân bổ', 400)
      );
    });

    it('updates kit name and description without modifying stock when items remain unchanged', async () => {
      vi.mocked(prisma.kit.findUnique).mockResolvedValueOnce(mockKitRecord as any);

      const mockTx = (prisma as any).__mockTx;
      mockTx.kit.findUnique.mockResolvedValueOnce({
        ...mockKitRecord,
        name: 'Tên Kit Sau Cập Nhật',
      });

      const result = await kitsService.updateKit(
        mockKitRecord.id,
        { name: 'Tên Kit Sau Cập Nhật' },
        managerUser as any
      );

      expect(result.name).toBe('Tên Kit Sau Cập Nhật');
      expect(mockTx.kit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Tên Kit Sau Cập Nhật' }),
        })
      );
    });
  });

  describe('updateKitStatus & Lifecycle FSM', () => {
    it('allows valid transition AVAILABLE -> ALLOCATED', async () => {
      vi.mocked(prisma.kit.findUnique).mockResolvedValueOnce(mockKitRecord as any);

      const mockTx = (prisma as any).__mockTx;
      mockTx.kit.findUnique.mockResolvedValueOnce({
        ...mockKitRecord,
        status: KitStatus.ALLOCATED,
      });

      const result = await kitsService.updateKitStatus(
        mockKitRecord.id,
        { status: KitStatus.ALLOCATED },
        techUser as any
      );

      expect(result.status).toBe(KitStatus.ALLOCATED);
      expect(mockTx.kit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: KitStatus.ALLOCATED },
        })
      );
    });

    it('rejects invalid transition ALLOCATED -> RETIRED directly with 400', async () => {
      vi.mocked(prisma.kit.findUnique).mockResolvedValueOnce({
        ...mockKitRecord,
        status: KitStatus.ALLOCATED,
      } as any);

      await expect(
        kitsService.updateKitStatus(
          mockKitRecord.id,
          { status: KitStatus.RETIRED },
          managerUser as any
        )
      ).rejects.toThrow(
        /Không thể chuyển trạng thái hộp kit từ 'ALLOCATED' sang 'RETIRED'/
      );
    });

    it('releases component allocations when kit is RETIRED (disassembly)', async () => {
      vi.mocked(prisma.kit.findUnique).mockResolvedValueOnce(mockKitRecord as any);

      const mockTx = (prisma as any).__mockTx;
      mockTx.kit.findUnique.mockResolvedValueOnce({
        ...mockKitRecord,
        status: KitStatus.RETIRED,
      });

      const result = await kitsService.updateKitStatus(
        mockKitRecord.id,
        { status: KitStatus.RETIRED, notes: 'Thanh lý / rã kit trả linh kiện' },
        managerUser as any
      );

      expect(result.status).toBe(KitStatus.RETIRED);
      // Verify decrements on stock balance for component items
      expect(mockTx.stockBalance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            itemId: validItemId1,
            locationId: validLocationId,
          },
          data: {
            kitAllocated: { decrement: 1 },
          },
        })
      );
      expect(mockTx.stockBalance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            itemId: validItemId2,
            locationId: validLocationId,
          },
          data: {
            kitAllocated: { decrement: 2 },
          },
        })
      );
    });

    it('re-allocates components when re-commissioning kit from RETIRED to AVAILABLE', async () => {
      const retiredKit = {
        ...mockKitRecord,
        status: KitStatus.RETIRED,
      };
      vi.mocked(prisma.kit.findUnique).mockResolvedValueOnce(retiredKit as any);

      const mockTx = (prisma as any).__mockTx;
      // Mock available stock at location
      mockTx.stockBalance.findUnique.mockResolvedValue({
        onHand: 10,
        reserved: 0,
        quarantined: 0,
        kitAllocated: 0,
        item: { name: 'Test Component' },
      });
      mockTx.kit.findUnique.mockResolvedValueOnce({
        ...mockKitRecord,
        status: KitStatus.AVAILABLE,
      });

      const result = await kitsService.updateKitStatus(
        mockKitRecord.id,
        { status: KitStatus.AVAILABLE, notes: 'Tái kích hoạt hộp kit' },
        managerUser as any
      );

      expect(result.status).toBe(KitStatus.AVAILABLE);
      expect(mockTx.stockBalance.update).toHaveBeenCalled();
    });

    it('rejects re-commissioning from RETIRED to AVAILABLE if stock is insufficient', async () => {
      const retiredKit = {
        ...mockKitRecord,
        status: KitStatus.RETIRED,
      };
      vi.mocked(prisma.kit.findUnique).mockResolvedValueOnce(retiredKit as any);

      const mockTx = (prisma as any).__mockTx;
      // Insufficient stock: onHand 1, kit requires 2
      mockTx.stockBalance.findUnique.mockResolvedValueOnce({
        onHand: 1,
        reserved: 1,
        quarantined: 0,
        kitAllocated: 0,
        item: { name: 'ESP32 DevKit V1' },
      });

      await expect(
        kitsService.updateKitStatus(
          mockKitRecord.id,
          { status: KitStatus.AVAILABLE },
          managerUser as any
        )
      ).rejects.toThrow(
        /Không đủ tồn kho khả dụng để tái lắp ráp hộp kit/
      );
    });
  });

  describe('deleteKit', () => {
    it('rejects STUDENT or TECHNICIAN from deleting kit with 403 Forbidden', async () => {
      await expect(
        kitsService.deleteKit(mockKitRecord.id, techUser as any)
      ).rejects.toThrow(
        new AppError('Chỉ Quản trị viên hoặc Quản lý phòng Lab mới có quyền xóa hộp kit', 403)
      );
    });

    it('rejects deleting kit when currently ALLOCATED with 400 Bad Request', async () => {
      vi.mocked(prisma.kit.findUnique).mockResolvedValueOnce({
        ...mockKitRecord,
        status: KitStatus.ALLOCATED,
      } as any);

      await expect(
        kitsService.deleteKit(mockKitRecord.id, managerUser as any)
      ).rejects.toThrow(
        new AppError('Không thể xóa hộp kit đang được phân bổ / bàn giao cho người dùng', 400)
      );
    });

    it('safely releases component allocations and deletes active kit', async () => {
      vi.mocked(prisma.kit.findUnique).mockResolvedValueOnce(mockKitRecord as any);

      const mockTx = (prisma as any).__mockTx;

      const result = await kitsService.deleteKit(mockKitRecord.id, adminUser as any);
      expect(result.success).toBe(true);
      expect(mockTx.stockBalance.updateMany).toHaveBeenCalled();
      expect(mockTx.kitItem.deleteMany).toHaveBeenCalledWith({ where: { kitId: mockKitRecord.id } });
      expect(mockTx.kit.delete).toHaveBeenCalledWith({ where: { id: mockKitRecord.id } });
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'DELETE_KIT',
            entityId: mockKitRecord.id,
          }),
        })
      );
    });
  });
});
