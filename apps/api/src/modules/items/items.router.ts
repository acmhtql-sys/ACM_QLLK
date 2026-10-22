import { Router, Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/response';
import { authenticate, authenticateOptional } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { UserRole } from '@prisma/client';
import { AppError } from '../../shared/AppError';
import {
  createItemSchema,
  updateItemSchema,
  updateItemStatusSchema,
  queryItemsSchema,
} from '@acm/shared';
import { itemsService } from './items.service';

export const itemsRouter = Router();

/**
 * GET /api/v1/items
 * Reads catalog with search, category/type filter, active status, low-stock filter, pagination, and sorting.
 * RBAC: Students can only view active items.
 */
itemsRouter.get('/', authenticateOptional, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsedQuery = queryItemsSchema.safeParse(req.query);
    if (!parsedQuery.success) {
      throw new AppError('Tham số truy vấn không hợp lệ', 422, parsedQuery.error.errors);
    }

    const result = await itemsService.listItems(parsedQuery.data, req.user);

    return res.status(200).json({
      success: true,
      message: 'Danh sách linh kiện từ cơ sở dữ liệu',
      data: result.items,
      meta: result.meta,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/items/barcode/:barcode
 * Reads item by asset barcode or item SKU code.
 * RBAC: Students cannot view inactive items.
 */
itemsRouter.get('/barcode/:barcode', authenticateOptional, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await itemsService.getItemByBarcode(req.params.barcode, req.user);
    return sendSuccess(res, item, 'Thông tin linh kiện theo barcode');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/items/:id
 * Reads item detail and location stock balances.
 * RBAC: Students cannot view inactive items.
 */
itemsRouter.get('/:id', authenticateOptional, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await itemsService.getItemById(req.params.id, req.user);
    return sendSuccess(res, item, 'Thông tin chi tiết linh kiện');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/items
 * Create new item with validation, duplicate SKU check, and transaction audit log.
 * RBAC: ADMIN, LAB_MANAGER only.
 */
itemsRouter.post(
  '/',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createItemSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu tạo linh kiện không hợp lệ', 422, parsed.error.errors);
      }

      const created = await itemsService.createItem(
        parsed.data,
        req.user!.id,
        req.ip,
        req.headers['user-agent']
      );

      return sendSuccess(res, created, 'Tạo linh kiện thành công', 201);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/v1/items/:id
 * Updates descriptive item properties without directly altering stock quantities.
 * RBAC: ADMIN, LAB_MANAGER only.
 */
itemsRouter.put(
  '/:id',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateItemSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu cập nhật không hợp lệ', 422, parsed.error.errors);
      }

      const updated = await itemsService.updateItem(
        req.params.id,
        parsed.data,
        req.user!.id,
        req.ip,
        req.headers['user-agent']
      );

      return sendSuccess(res, updated, 'Cập nhật linh kiện thành công', 200);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/items/:id/status
 * Activates or deactivates an item (Soft deactivation) with audit logging.
 * RBAC: ADMIN, LAB_MANAGER only.
 */
itemsRouter.patch(
  '/:id/status',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateItemStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu trạng thái không hợp lệ', 422, parsed.error.errors);
      }

      const updated = await itemsService.updateItemStatus(
        req.params.id,
        parsed.data,
        req.user!.id,
        req.ip,
        req.headers['user-agent']
      );

      const actionText = parsed.data.isActive ? 'Kích hoạt' : 'Vô hiệu hóa';
      return sendSuccess(res, updated, `${actionText} linh kiện thành công`, 200);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/items/:id
 * Safe deletion: allows deleting items with zero stock balances and no historical transactions.
 * Prevents data loss / ledger corruption if stock or history exists (recommends deactivation).
 * RBAC: ADMIN, LAB_MANAGER only.
 */
itemsRouter.delete(
  '/:id',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await itemsService.deleteItem(
        req.params.id,
        req.user!.id,
        req.ip,
        req.headers['user-agent']
      );
      return sendSuccess(res, deleted, 'Xóa linh kiện thành công', 200);
    } catch (err) {
      next(err);
    }
  }
);
