import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { sendSuccess } from '../../shared/response';
import { authenticate } from '../../middleware/auth';

export const reportsRouter = Router();

reportsRouter.get('/summary', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const totalItems = await prisma.item.count();
    const balances = await prisma.stockBalance.findMany();

    const totalOnHand = balances.reduce((sum, b) => sum + b.onHand, 0);
    const totalReserved = balances.reduce((sum, b) => sum + b.reserved, 0);
    const totalQuarantined = balances.reduce((sum, b) => sum + b.quarantined, 0);
    const totalKitAllocated = balances.reduce((sum, b) => sum + b.kitAllocated, 0);
    const totalBorrowed = balances.reduce((sum, b) => sum + b.borrowed, 0);

    const totalAvailable = Math.max(
      0,
      totalOnHand - totalReserved - totalQuarantined - totalKitAllocated
    );

    const activeBorrows = await prisma.borrowRequest.count({
      where: { status: { in: ['APPROVED', 'HANDED_OVER'] } },
    });

    const pendingApprovalBorrows = await prisma.borrowRequest.count({
      where: { status: 'PENDING' },
    });

    const lowStockCount = await prisma.item.count({
      where: {
        stockBalances: {
          some: {
            onHand: { lt: 5 },
          },
        },
      },
    });

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
        monthlyTrends: [
          { month: 'T5', imports: 45, exports: 20, borrows: 15 },
          { month: 'T6', imports: 60, exports: 30, borrows: 25 },
          { month: 'T7', imports: 35, exports: 18, borrows: 20 },
          { month: 'T8', imports: 80, exports: 40, borrows: 35 },
          { month: 'T9', imports: 95, exports: 50, borrows: 48 },
          { month: 'T10', imports: 110, exports: 65, borrows: 52 },
        ],
      },
      'Báo cáo tổng hợp KPI thời gian thực'
    );
  } catch (err) {
    next(err);
  }
});
