import { Router, Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/response';
import { authenticate } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { UserRole } from '@prisma/client';
import { reportsService } from './reports.service';
import { queryReportsSchema } from '@acm/shared';
import { AppError } from '../../shared/AppError';

export const reportsRouter = Router();

/**
 * GET /api/v1/reports/summary
 * Retrieves ground-truth KPI metrics, inventory distribution and trend data for dashboard.
 */
reportsRouter.get(
  '/summary',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await reportsService.getDashboardSummary(req.user!);
      return sendSuccess(res, summary, 'Báo cáo tổng hợp KPI thời gian thực');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/reports/inventory
 * Retrieves detailed inventory valuation report by item, category and stock distribution.
 */
reportsRouter.get(
  '/inventory',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = queryReportsSchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError('Dữ liệu truy vấn báo cáo không hợp lệ', 422, parsed.error.errors);
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
