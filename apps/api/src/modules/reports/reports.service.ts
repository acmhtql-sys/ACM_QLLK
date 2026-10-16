import { prisma } from '../../config/database';
import { AuthenticatedUser } from '../../middleware/auth';
import {
  BorrowStatus,
  KitStatus,
  StockStatus,
  StockTransactionType,
  ItemType,
  DashboardSummaryResponse,
  DashboardKpisResponse,
  DashboardDistributionItem,
  DashboardMonthlyTrend,
  InventoryReportItem,
  BorrowReturnReportSummary,
  BorrowReturnReportResponse,
  LowStockAlertItem,
  QueryReportsInput,
} from '@acm/shared';

export class ReportsService {
  /**
   * Computes ground-truth real-time KPIs and distributions for the system dashboard.
   * Reconciles physical onHand with allocated components (reserved + quarantined + kitAllocated),
   * active & overdue borrow requests, and kit usage.
   */
  async getDashboardSummary(_currentUser: AuthenticatedUser): Promise<DashboardSummaryResponse> {
    const totalItems = await prisma.item.count({ where: { isActive: true } });

    // Fetch all active items with their location stock balances
    const items = await prisma.item.findMany({
      where: { isActive: true },
      include: {
        stockBalances: true,
      },
    });

    let totalOnHand = 0;
    let totalReserved = 0;
    let totalQuarantined = 0;
    let totalKitAllocated = 0;
    let totalBorrowed = 0;
    let totalAvailable = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const item of items) {
      let itemOnHand = 0;
      let itemReserved = 0;
      let itemQuarantined = 0;
      let itemKitAllocated = 0;
      let itemBorrowed = 0;

      for (const bal of item.stockBalances) {
        itemOnHand += bal.onHand;
        itemReserved += bal.reserved;
        itemQuarantined += bal.quarantined;
        itemKitAllocated += bal.kitAllocated;
        itemBorrowed += bal.borrowed;
      }

      const itemAvailable = Math.max(
        0,
        itemOnHand - itemReserved - itemQuarantined - itemKitAllocated
      );

      totalOnHand += itemOnHand;
      totalReserved += itemReserved;
      totalQuarantined += itemQuarantined;
      totalKitAllocated += itemKitAllocated;
      totalBorrowed += itemBorrowed;
      totalAvailable += itemAvailable;

      if (itemAvailable === 0) {
        outOfStockCount++;
      } else if (itemAvailable <= item.minStockAlert) {
        lowStockCount++;
      }
    }

    // Borrow Request counts & overdue detection
    const [activeBorrows, pendingApprovalBorrows, handedOverRecords] = await Promise.all([
      prisma.borrowRequest.count({
        where: { status: { in: [BorrowStatus.APPROVED, BorrowStatus.HANDED_OVER] } },
      }),
      prisma.borrowRequest.count({
        where: { status: BorrowStatus.PENDING },
      }),
      prisma.borrowRequest.findMany({
        where: { status: BorrowStatus.HANDED_OVER },
        select: { expectedReturnDate: true },
      }),
    ]);

    const now = new Date();
    const overdueBorrows = handedOverRecords.filter(
      (b) => new Date(b.expectedReturnDate) < now
    ).length;

    // Kit counts
    const [totalKits, activeKits] = await Promise.all([
      prisma.kit.count(),
      prisma.kit.count({
        where: { status: { in: [KitStatus.AVAILABLE, KitStatus.ALLOCATED] } },
      }),
    ]);

    const kpis: DashboardKpisResponse = {
      totalItems,
      totalOnHand,
      totalAvailable,
      totalReserved,
      totalBorrowed,
      totalQuarantined,
      totalKitAllocated,
      activeBorrows,
      pendingApprovalBorrows,
      overdueBorrows,
      lowStockCount,
      outOfStockCount,
      totalKits,
      activeKits,
    };

    const distribution: DashboardDistributionItem[] = [
      { name: 'Khả dụng (Available)', value: totalAvailable, color: '#3b82f6' },
      { name: 'Đang mượn (Borrowed)', value: totalBorrowed, color: '#6366f1' },
      { name: 'Giữ chỗ (Reserved)', value: totalReserved, color: '#f59e0b' },
      { name: 'Gán Kit (KitAllocated)', value: totalKitAllocated, color: '#10b981' },
      { name: 'Cách ly lỗi (Quarantined)', value: totalQuarantined, color: '#ef4444' },
    ];

    // Historical monthly trends (past 6 months)
    const monthlyTrends = await this.computeMonthlyTrends();

    return {
      kpis,
      distribution,
      monthlyTrends,
    };
  }

  /**
   * Computes monthly import, export, and borrow counts for the last 6 months.
   */
  private async computeMonthlyTrends(): Promise<DashboardMonthlyTrend[]> {
    const trends: DashboardMonthlyTrend[] = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      const monthLabel = `T${d.getMonth() + 1}`;

      const [imports, exports, borrows] = await Promise.all([
        prisma.stockTransaction.count({
          where: {
            type: StockTransactionType.IMPORT,
            createdAt: { gte: startOfMonth, lte: endOfMonth },
          },
        }),
        prisma.stockTransaction.count({
          where: {
            type: StockTransactionType.EXPORT,
            createdAt: { gte: startOfMonth, lte: endOfMonth },
          },
        }),
        prisma.borrowRequest.count({
          where: {
            createdAt: { gte: startOfMonth, lte: endOfMonth },
          },
        }),
      ]);

      trends.push({
        month: monthLabel,
        imports,
        exports,
        borrows,
      });
    }

    return trends;
  }

  /**
   * Retrieves detailed inventory report by category, type and stock balance breakdown.
   */
  async getInventoryReport(
    query: QueryReportsInput,
    _currentUser: AuthenticatedUser
  ): Promise<InventoryReportItem[]> {
    const where: any = { isActive: true };

    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    if (query.type) {
      where.type = query.type;
    }

    const items = await prisma.item.findMany({
      where,
      include: {
        category: { select: { name: true } },
        stockBalances: true,
      },
      orderBy: { code: 'asc' },
    });

    return items.map((item) => {
      let onHand = 0;
      let reserved = 0;
      let quarantined = 0;
      let kitAllocated = 0;
      let borrowed = 0;

      for (const bal of item.stockBalances) {
        onHand += bal.onHand;
        reserved += bal.reserved;
        quarantined += bal.quarantined;
        kitAllocated += bal.kitAllocated;
        borrowed += bal.borrowed;
      }

      const available = Math.max(0, onHand - reserved - quarantined - kitAllocated);

      let stockStatus = StockStatus.IN_STOCK;
      if (available === 0) {
        stockStatus = StockStatus.OUT_OF_STOCK;
      } else if (available <= item.minStockAlert) {
        stockStatus = StockStatus.LOW_STOCK;
      }

      return {
        id: item.id,
        code: item.code,
        name: item.name,
        unit: item.unit,
        type: item.type as unknown as ItemType,
        categoryName: item.category?.name || 'Chưa phân loại',
        onHand,
        reserved,
        quarantined,
        kitAllocated,
        borrowed,
        available,
        minStockAlert: item.minStockAlert,
        stockStatus,
      };
    });
  }

  /**
   * Retrieves comprehensive borrow and return operational statistics.
   */
  async getBorrowReturnReport(_currentUser: AuthenticatedUser): Promise<BorrowReturnReportResponse> {
    const [
      totalRequests,
      approvedCount,
      handedOverCount,
      returnedCount,
      partiallyReturnedCount,
      rejectedCount,
      cancelledCount,
      damagedOrLostDetails,
      overdueRecords,
    ] = await Promise.all([
      prisma.borrowRequest.count(),
      prisma.borrowRequest.count({ where: { status: BorrowStatus.APPROVED } }),
      prisma.borrowRequest.count({ where: { status: BorrowStatus.HANDED_OVER } }),
      prisma.borrowRequest.count({ where: { status: BorrowStatus.RETURNED } }),
      prisma.borrowRequest.count({ where: { status: BorrowStatus.PARTIALLY_RETURNED } }),
      prisma.borrowRequest.count({ where: { status: BorrowStatus.REJECTED } }),
      prisma.borrowRequest.count({ where: { status: BorrowStatus.CANCELLED } }),
      prisma.returnDetail.count({
        where: { condition: { in: ['DAMAGED', 'LOST'] } },
      }),
      prisma.borrowRequest.findMany({
        where: {
          status: BorrowStatus.HANDED_OVER,
          expectedReturnDate: { lt: new Date() },
        },
        include: {
          borrower: { select: { fullName: true, email: true, phoneNumber: true } },
          details: { include: { item: { select: { name: true, code: true } } } },
        },
        orderBy: { expectedReturnDate: 'asc' },
      }),
    ]);

    const activeOrCompleted = handedOverCount + returnedCount + partiallyReturnedCount;
    const returnRatePercent =
      activeOrCompleted > 0 ? Math.round((returnedCount / activeOrCompleted) * 100) : 100;

    const summary: BorrowReturnReportSummary = {
      totalRequests,
      approvedCount,
      handedOverCount,
      returnedCount,
      partiallyReturnedCount,
      rejectedCount,
      cancelledCount,
      overdueCount: overdueRecords.length,
      returnRatePercent,
      damagedOrLostCount: damagedOrLostDetails,
    };

    const overdueList = overdueRecords.map((r) => ({
      id: r.id,
      requestNumber: r.requestNumber,
      borrowerName: r.borrower?.fullName,
      borrowerEmail: r.borrower?.email,
      borrowerPhone: r.borrower?.phoneNumber,
      purpose: r.purpose,
      expectedBorrowDate: r.expectedBorrowDate,
      expectedReturnDate: r.expectedReturnDate,
      daysOverdue: Math.max(
        1,
        Math.floor((Date.now() - new Date(r.expectedReturnDate).getTime()) / (1000 * 3600 * 24))
      ),
      items: r.details.map((d) => ({
        code: d.item?.code,
        name: d.item?.name,
        quantity: d.quantity,
        returnedQuantity: d.returnedQuantity,
      })),
    }));

    return {
      summary,
      overdueList,
    };
  }

  /**
   * Retrieves items whose available quantity is at or below their configured minStockAlert threshold.
   * Sorted by urgency ratio (available / minStockAlert) ascending.
   */
  async getLowStockAlerts(_currentUser: AuthenticatedUser): Promise<LowStockAlertItem[]> {
    const items = await prisma.item.findMany({
      where: { isActive: true },
      include: {
        category: { select: { name: true } },
        stockBalances: true,
      },
    });

    const alerts: LowStockAlertItem[] = [];

    for (const item of items) {
      let onHand = 0;
      let reserved = 0;
      let quarantined = 0;
      let kitAllocated = 0;

      for (const bal of item.stockBalances) {
        onHand += bal.onHand;
        reserved += bal.reserved;
        quarantined += bal.quarantined;
        kitAllocated += bal.kitAllocated;
      }

      const available = Math.max(0, onHand - reserved - quarantined - kitAllocated);

      if (available <= item.minStockAlert) {
        const stockStatus = available === 0 ? StockStatus.OUT_OF_STOCK : StockStatus.LOW_STOCK;
        const urgencyRatio = item.minStockAlert > 0 ? available / item.minStockAlert : 0;

        alerts.push({
          id: item.id,
          code: item.code,
          name: item.name,
          unit: item.unit,
          categoryName: item.category?.name || 'Chưa phân loại',
          onHand,
          available,
          minStockAlert: item.minStockAlert,
          stockStatus,
          urgencyRatio,
        });
      }
    }

    alerts.sort((a, b) => a.urgencyRatio - b.urgencyRatio);
    return alerts;
  }
}

export const reportsService = new ReportsService();
