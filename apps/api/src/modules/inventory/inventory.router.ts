import { Router, Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/response';
import { authenticate, authenticateOptional } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { UserRole } from '@prisma/client';
import { AppError } from '../../shared/AppError';
import { queryStockBalancesSchema, computeStockBreakdown } from '@acm/shared';
import { inventoryService } from './inventory.service';

export const inventoryRouter = Router();

/**
 * GET /api/v1/inventory/balance
 * Returns real-time stock balances with search, filters (itemId, locationId, isLowStock), sorting, and pagination.
 * RBAC: ADMIN (200), LAB_MANAGER (200), TECHNICIAN (200). STUDENT (403). Unauthenticated (401).
 */
inventoryRouter.get(
  '/balance',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER, UserRole.TECHNICIAN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {

      const parsedQuery = queryStockBalancesSchema.safeParse(req.query);
      if (!parsedQuery.success) {
        throw new AppError('Tham số truy vấn số dư kho không hợp lệ', 422, parsedQuery.error.issues);
      }

      const result = await inventoryService.listBalances(parsedQuery.data);

      return res.status(200).json({
        success: true,
        message: 'Dữ liệu số dư tồn kho từ Database',
        data: result.balances,
        meta: result.meta,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/inventory/summary
 * Returns aggregated inventory metrics (total onHand, reserved, available, low stock count, etc.).
 * RBAC: ADMIN, LAB_MANAGER, TECHNICIAN only. STUDENT is forbidden (403).
 */
inventoryRouter.get(
  '/summary',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER, UserRole.TECHNICIAN),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await inventoryService.getInventorySummary();
      return sendSuccess(res, summary, 'Tổng quan tình trạng tồn kho hệ thống');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/inventory/calculate
 * Direct calculation endpoint validating ACM Inventory rules:
 * Available = OnHand - Reserved - Quarantined - KitAllocated
 */
inventoryRouter.post('/calculate', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { onHand, reserved, quarantined, kitAllocated, borrowed } = req.body;
    const balance = {
      onHand: Number(onHand) || 0,
      reserved: Number(reserved) || 0,
      quarantined: Number(quarantined) || 0,
      kitAllocated: Number(kitAllocated) || 0,
      borrowed: Number(borrowed) || 0,
    };

    const breakdown = computeStockBreakdown(balance);
    return sendSuccess(res, breakdown, 'Tính toán tồn kho thành công theo quy tắc ACM');
  } catch (err) {
    next(err);
  }
});
