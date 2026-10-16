import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  UserRole,
  ItemType,
  BorrowStatus,
  KitStatus,
  StockStatus,
  StockTransactionType,
} from '@acm/shared';
import { reportsService } from '../src/modules/reports/reports.service';
import { prisma } from '../src/config/database';

vi.mock('../src/config/database', () => ({
  prisma: {
    item: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    stockBalance: {
      findMany: vi.fn(),
    },
    borrowRequest: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    kit: {
      count: vi.fn(),
    },
    stockTransaction: {
      count: vi.fn(),
    },
    returnDetail: {
      count: vi.fn(),
    },
  },
}));

describe('Phase 6 – Dashboard KPIs, Reports & Analytics Unit Tests', () => {
  const adminUser = {
    id: 'admin-uuid-001',
    email: 'admin@acm.local',
    fullName: 'Quản Trị Viên',
    role: UserRole.ADMIN,
  };

  const sampleItems = [
    {
      id: 'item-1',
      code: 'ESP32-WROOM',
      name: 'ESP32 DevKit V1',
      unit: 'cái',
      type: ItemType.TRACKED_ASSET,
      minStockAlert: 10,
      isActive: true,
      category: { name: 'Vi điều khiển' },
      stockBalances: [
        {
          locationId: 'loc-1',
          onHand: 50,
          reserved: 5,
          quarantined: 2,
          kitAllocated: 10,
          borrowed: 8,
        },
        {
          locationId: 'loc-2',
          onHand: 30,
          reserved: 0,
          quarantined: 0,
          kitAllocated: 5,
          borrowed: 2,
        },
      ],
    },
    {
      id: 'item-2',
      code: 'DHT22-SEN',
      name: 'Cảm biến nhiệt ẩm DHT22',
      unit: 'cái',
      type: ItemType.CONSUMABLE,
      minStockAlert: 15,
      isActive: true,
      category: { name: 'Cảm biến' },
      stockBalances: [
        {
          locationId: 'loc-1',
          onHand: 12,
          reserved: 4,
          quarantined: 0,
          kitAllocated: 2,
          borrowed: 0,
        },
      ],
    },
    {
      id: 'item-3',
      code: 'STM32-NUCLEO',
      name: 'Board STM32 Nucleo-64',
      unit: 'cái',
      type: ItemType.TRACKED_ASSET,
      minStockAlert: 5,
      isActive: true,
      category: { name: 'Vi điều khiển' },
      stockBalances: [
        {
          locationId: 'loc-1',
          onHand: 5,
          reserved: 5,
          quarantined: 0,
          kitAllocated: 0,
          borrowed: 0,
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDashboardSummary', () => {
    it('computes exact ground-truth KPIs reconciling onHand, reserved, quarantined, kitAllocated, and borrowed', async () => {
      // Mock item count & items
      vi.mocked(prisma.item.count).mockResolvedValueOnce(3);
      vi.mocked(prisma.item.findMany).mockResolvedValueOnce(sampleItems as any);

      // Borrow request mocks
      vi.mocked(prisma.borrowRequest.count).mockResolvedValueOnce(4); // activeBorrows
      vi.mocked(prisma.borrowRequest.count).mockResolvedValueOnce(2); // pendingApprovalBorrows
      vi.mocked(prisma.borrowRequest.findMany).mockResolvedValueOnce([
        { expectedReturnDate: new Date(Date.now() - 86400000 * 2) }, // overdue (2 days ago)
        { expectedReturnDate: new Date(Date.now() + 86400000 * 5) }, // not overdue
      ] as any);

      // Kit mocks
      vi.mocked(prisma.kit.count).mockResolvedValueOnce(10); // totalKits
      vi.mocked(prisma.kit.count).mockResolvedValueOnce(8); // activeKits

      // Monthly trends mocks
      vi.mocked(prisma.stockTransaction.count).mockResolvedValue(15);
      vi.mocked(prisma.borrowRequest.count).mockResolvedValue(8);

      const summary = await reportsService.getDashboardSummary(adminUser as any);

      expect(summary.kpis.totalItems).toBe(3);

      // Expected sums:
      // Item 1: onHand 80, reserved 5, quarantined 2, kitAllocated 15, borrowed 10 -> available = 80 - 22 = 58 (> minStock 10)
      // Item 2: onHand 12, reserved 4, quarantined 0, kitAllocated 2, borrowed 0 -> available = 12 - 6 = 6 (<= minStock 15, > 0 -> lowStock!)
      // Item 3: onHand 5, reserved 5, quarantined 0, kitAllocated 0, borrowed 0 -> available = 5 - 5 = 0 (outOfStock!)
      const expectedTotalOnHand = 80 + 12 + 5; // 97
      const expectedTotalReserved = 5 + 4 + 5; // 14
      const expectedTotalQuarantined = 2 + 0 + 0; // 2
      const expectedTotalKitAllocated = 15 + 2 + 0; // 17
      const expectedTotalBorrowed = 10 + 0 + 0; // 10
      const expectedTotalAvailable = 58 + 6 + 0; // 64

      expect(summary.kpis.totalOnHand).toBe(expectedTotalOnHand);
      expect(summary.kpis.totalReserved).toBe(expectedTotalReserved);
      expect(summary.kpis.totalQuarantined).toBe(expectedTotalQuarantined);
      expect(summary.kpis.totalKitAllocated).toBe(expectedTotalKitAllocated);
      expect(summary.kpis.totalBorrowed).toBe(expectedTotalBorrowed);
      expect(summary.kpis.totalAvailable).toBe(expectedTotalAvailable);

      // Verify low stock and out of stock counts
      expect(summary.kpis.lowStockCount).toBe(1); // Item 2
      expect(summary.kpis.outOfStockCount).toBe(1); // Item 3

      // Verify borrow request KPIs
      expect(summary.kpis.activeBorrows).toBe(4);
      expect(summary.kpis.pendingApprovalBorrows).toBe(2);
      expect(summary.kpis.overdueBorrows).toBe(1);

      // Verify kit KPIs
      expect(summary.kpis.totalKits).toBe(10);
      expect(summary.kpis.activeKits).toBe(8);

      // Verify distribution chart has 5 categories with exact values
      expect(summary.distribution).toHaveLength(5);
      expect(summary.distribution.find((d) => d.name.includes('Available'))?.value).toBe(64);
      expect(summary.distribution.find((d) => d.name.includes('Borrowed'))?.value).toBe(10);
      expect(summary.distribution.find((d) => d.name.includes('Reserved'))?.value).toBe(14);
      expect(summary.distribution.find((d) => d.name.includes('KitAllocated'))?.value).toBe(17);
      expect(summary.distribution.find((d) => d.name.includes('Quarantined'))?.value).toBe(2);

      // Verify monthly trends array
      expect(summary.monthlyTrends).toHaveLength(6);
    });
  });

  describe('getInventoryReport', () => {
    it('returns detailed item inventory breakdown with grounded stock statuses', async () => {
      vi.mocked(prisma.item.findMany).mockResolvedValueOnce(sampleItems as any);

      const report = await reportsService.getInventoryReport({}, adminUser as any);

      expect(report).toHaveLength(3);

      // Item 1 (ESP32)
      expect(report[0].code).toBe('ESP32-WROOM');
      expect(report[0].categoryName).toBe('Vi điều khiển');
      expect(report[0].onHand).toBe(80);
      expect(report[0].available).toBe(58);
      expect(report[0].stockStatus).toBe(StockStatus.IN_STOCK);

      // Item 2 (DHT22)
      expect(report[1].code).toBe('DHT22-SEN');
      expect(report[1].available).toBe(6);
      expect(report[1].minStockAlert).toBe(15);
      expect(report[1].stockStatus).toBe(StockStatus.LOW_STOCK);

      // Item 3 (STM32)
      expect(report[2].code).toBe('STM32-NUCLEO');
      expect(report[2].available).toBe(0);
      expect(report[2].stockStatus).toBe(StockStatus.OUT_OF_STOCK);
    });
  });

  describe('getBorrowReturnReport', () => {
    it('computes borrow metrics, return rate percentage and overdue list', async () => {
      vi.mocked(prisma.borrowRequest.count).mockResolvedValueOnce(10); // totalRequests
      vi.mocked(prisma.borrowRequest.count).mockResolvedValueOnce(2); // approved
      vi.mocked(prisma.borrowRequest.count).mockResolvedValueOnce(3); // handedOver
      vi.mocked(prisma.borrowRequest.count).mockResolvedValueOnce(4); // returned
      vi.mocked(prisma.borrowRequest.count).mockResolvedValueOnce(1); // partiallyReturned
      vi.mocked(prisma.borrowRequest.count).mockResolvedValueOnce(0); // rejected
      vi.mocked(prisma.borrowRequest.count).mockResolvedValueOnce(0); // cancelled
      vi.mocked(prisma.returnDetail.count).mockResolvedValueOnce(1); // damagedOrLost

      const overduePastDate = new Date(Date.now() - 86400000 * 3);
      vi.mocked(prisma.borrowRequest.findMany).mockResolvedValueOnce([
        {
          id: 'br-overdue-1',
          requestNumber: 'BR-20261010-001',
          borrower: { fullName: 'Sinh Viên Quá Hạn', email: 'sv@acm.local', phoneNumber: '0912345678' },
          purpose: 'Làm đồ án môn học',
          expectedBorrowDate: new Date('2026-10-01'),
          expectedReturnDate: overduePastDate,
          details: [
            {
              item: { code: 'ESP32', name: 'ESP32 DevKit' },
              quantity: 2,
              returnedQuantity: 0,
            },
          ],
        },
      ] as any);

      const report = await reportsService.getBorrowReturnReport(adminUser as any);

      expect(report.summary.totalRequests).toBe(10);
      expect(report.summary.approvedCount).toBe(2);
      expect(report.summary.handedOverCount).toBe(3);
      expect(report.summary.returnedCount).toBe(4);
      expect(report.summary.partiallyReturnedCount).toBe(1);
      expect(report.summary.damagedOrLostCount).toBe(1);
      expect(report.summary.overdueCount).toBe(1);

      // Return rate = 4 / (3 + 4 + 1) = 4 / 8 = 50%
      expect(report.summary.returnRatePercent).toBe(50);

      expect(report.overdueList).toHaveLength(1);
      expect(report.overdueList[0].requestNumber).toBe('BR-20261010-001');
      expect(report.overdueList[0].daysOverdue).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getLowStockAlerts', () => {
    it('returns items at or below minStockAlert sorted by urgencyRatio ascending (0 available first)', async () => {
      vi.mocked(prisma.item.findMany).mockResolvedValueOnce(sampleItems as any);

      const alerts = await reportsService.getLowStockAlerts(adminUser as any);

      // Only Item 2 (available 6 <= min 15) and Item 3 (available 0 <= min 5)
      expect(alerts).toHaveLength(2);

      // Most urgent first: Item 3 has urgencyRatio 0 / 5 = 0
      expect(alerts[0].code).toBe('STM32-NUCLEO');
      expect(alerts[0].stockStatus).toBe(StockStatus.OUT_OF_STOCK);
      expect(alerts[0].urgencyRatio).toBe(0);

      // Next: Item 2 has urgencyRatio 6 / 15 = 0.4
      expect(alerts[1].code).toBe('DHT22-SEN');
      expect(alerts[1].stockStatus).toBe(StockStatus.LOW_STOCK);
      expect(alerts[1].urgencyRatio).toBeCloseTo(0.4);
    });
  });
});
