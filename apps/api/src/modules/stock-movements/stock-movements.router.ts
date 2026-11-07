import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { UserRole } from '@prisma/client';
import { AppError } from '../../shared/AppError';
import { queryStockMovementsSchema } from '@acm/shared';
import { stockMovementsService } from './stock-movements.service';

export const stockMovementsRouter = Router();

/**
 * GET /api/v1/stock-movements
 * Retrieves paginated stock movement ledger with filters and search.
 * RBAC: ADMIN, LAB_MANAGER, TECHNICIAN only (STUDENT is forbidden).
 */
stockMovementsRouter.get(
  '/',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER, UserRole.TECHNICIAN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedQuery = queryStockMovementsSchema.safeParse(req.query);
      if (!parsedQuery.success) {
        throw new AppError('Tham số truy vấn biến động kho không hợp lệ', 422, parsedQuery.error.issues);
      }

      const result = await stockMovementsService.listMovements(parsedQuery.data);

      return res.status(200).json({
        success: true,
        message: 'Lịch sử biến động kho (Stock Movements Ledger)',
        data: result.movements,
        meta: result.meta,
      });
    } catch (err) {
      next(err);
    }
  }
);
