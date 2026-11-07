import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { sendSuccess } from '../../shared/response';
import { authenticate } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { UserRole } from '@prisma/client';
import { reportsService } from './reports.service';
import { queryReportsSchema } from '@acm/shared';
import { AppError } from '../../shared/AppError';

export const reportsRouter = Router();

reportsRouter.get(
  '/summary',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const totalItems = await prisma.item.count();
      const balances = await prisma.stockBalance.findMany();

      // Aggregate warehouse inventory figures
      const totalOnHand = balances.reduce((sum, b) => sum + b.onHand, 0);
      const totalReserved = balances.reduce((sum, b) => sum + b.reserved, 0);
      const totalQuarantined = balances.reduce((sum, b) => sum + b.quarantined, 0);
      const totalKitAllocated = balances.reduce((sum, b) => sum + b.kitAllocated, 0);
      const totalBorrowed = balances.reduce((sum, b) => sum + b.borrowed, 0);

      // Invariant: Available = max(0, OnHand - Reserved - Quarantined - KitAllocated)
      // Borrowed items are physically outside lab and NOT subtracted twice.
      const totalAvailable = Math.max(
        0,
        totalOnHand - totalReserved - totalQuarantined - totalKitAllocated
      );

      // Active borrows: consider APPROVED, HANDED_OVER, and PARTIALLY_RETURNED
      const activeBorrows = await prisma.borrowRequest.count({
        where: {
          status: { in: ['APPROVED', 'HANDED_OVER', 'PARTIALLY_RETURNED'] },
        },
      });

      const pendingApprovalBorrows = await prisma.borrowRequest.count({
        where: { status: 'PENDING' },
      });

      // Low stock evaluation: compare against minStockAlert per Item across active items
      const activeItems = await prisma.item.findMany({
        where: { isActive: true },
        select: {
          id: true,
          minStockAlert: true,
          stockBalances: {
            select: {
              onHand: true,
              reserved: true,
              quarantined: true,
              kitAllocated: true,
              borrowed: true,
            },
          },
        },
      });

      let lowStockCount = 0;
      for (const item of activeItems) {
        const itemTotalAvailable = item.stockBalances.reduce((sum, sb) => {
          const availAtLoc = Math.max(
            0,
            sb.onHand - sb.reserved - sb.quarantined - sb.kitAllocated
          );
          return sum + availAtLoc;
        }, 0);

        if (itemTotalAvailable < item.minStockAlert) {
          lowStockCount++;
        }
      }

      // Compute monthly trends from real database transactions over the last 6 months
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      sixMonthsAgo.setDate(1);
      sixMonthsAgo.setHours(0, 0, 0, 0);

      const [transactions, borrows] = await Promise.all([
        prisma.stockTransaction.findMany({
          where: {
            status: 'COMPLETED',
            createdAt: { gte: sixMonthsAgo },
          },
          include: { details: true },
        }),
        prisma.borrowRequest.findMany({
          where: {
            createdAt: { gte: sixMonthsAgo },
            status: { in: ['APPROVED', 'HANDED_OVER', 'RETURNED', 'PARTIALLY_RETURNED'] },
          },
        }),
      ]);

      let monthlyTrends: Array<{
        month: string;
        imports: number;
        exports: number;
        borrows: number;
      }> = [];

      // Only generate monthlyTrends if there is actual recorded historical activity
      if (transactions.length > 0 || borrows.length > 0) {
        const monthFormatter = new Intl.DateTimeFormat('vi-VN', { month: 'numeric' });
        const buckets: Record<string, { month: string; imports: number; exports: number; borrows: number }> = {};

        for (let i = 5; i >= 0; i--) {
          const d = new Date();
          d.setMonth(d.getMonth() - i);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          const monthLabel = `T${monthFormatter.format(d)}`;
          buckets[key] = { month: monthLabel, imports: 0, exports: 0, borrows: 0 };
        }

        for (const tx of transactions) {
          const txDate = new Date(tx.createdAt);
          const key = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}`;
          if (buckets[key]) {
            const qty = tx.details.reduce((sum, d) => sum + d.quantity, 0);
            if (tx.type === 'IMPORT') {
              buckets[key].imports += qty;
            } else if (tx.type === 'EXPORT') {
              buckets[key].exports += qty;
            }
          }
        }

        for (const b of borrows) {
          const bDate = new Date(b.createdAt);
          const key = `${bDate.getFullYear()}-${String(bDate.getMonth() + 1).padStart(2, '0')}`;
          if (buckets[key]) {
            buckets[key].borrows += 1;
          }
        }

        monthlyTrends = Object.values(buckets);
      }

      return sendSuccess(
        res,
        {
          kpis: {
            totalItems,
            totalOnHand,
            totalAvailable,
            totalReserved,
            totalBorrowed,
            totalQuarantined,
            totalKitAllocated,
            activeBorrows,
            pendingApprovalBorrows,
            lowStockCount,
          },
          distribution: [
            { name: 'Khả dụng (Available)', value: totalAvailable },
            { name: 'Đang mượn (Borrowed)', value: totalBorrowed },
            { name: 'Giữ chỗ (Reserved)', value: totalReserved },
            { name: 'Gán Kit (KitAllocated)', value: totalKitAllocated },
            { name: 'Cách ly lỗi (Quarantined)', value: totalQuarantined },
          ],
          monthlyTrends,
        },
        'Báo cáo tổng hợp KPI thời gian thực'
      );
    } catch (err) {
      next(err);
    }
  }
);


/**
 * GET /api/v1/reports/inventory
 * Retrieves detailed inventory valuation report by item, category and stock distribution.
 * RBAC: ADMIN only
 */
reportsRouter.get(
  '/inventory',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = queryReportsSchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError('Dữ liệu truy vấn báo cáo không hợp lệ', 422, parsed.error.issues);
      }

      const report = await reportsService.getInventoryReport(parsed.data, req.user!);
      return sendSuccess(res, report, 'Báo cáo chi tiết kiểm kê tồn kho');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/reports/borrow-return
 * Retrieves borrow request statistics, return rate, damaged/lost counts and overdue loans.
 * RBAC: ADMIN only
 */
reportsRouter.get(
  '/borrow-return',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await reportsService.getBorrowReturnReport(req.user!);
      return sendSuccess(res, report, 'Báo cáo vận hành mượn - trả và quá hạn');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/reports/low-stock
 * Retrieves urgent alerts for items at or below their configured minStockAlert threshold.
 * RBAC: ADMIN only
 */
reportsRouter.get(
  '/low-stock',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const alerts = await reportsService.getLowStockAlerts(req.user!);
      return sendSuccess(res, alerts, 'Báo cáo cảnh báo tồn kho sắp hết và đã hết');
    } catch (err) {
      next(err);
    }
  }
);
