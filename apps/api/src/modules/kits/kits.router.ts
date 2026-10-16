import { Router, Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { sendSuccess } from '../../shared/response';
import { AppError } from '../../shared/AppError';
import { kitsService } from './kits.service';
import {
  createKitSchema,
  updateKitSchema,
  updateKitStatusSchema,
  queryKitsSchema,
} from '@acm/shared';

export const kitsRouter = Router();

function getRequestMetadata(req: Request) {
  return {
    ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
    userAgent: req.headers['user-agent'],
  };
}

/**
 * GET /api/v1/kits
 * Lists kits with filtering, sorting, and pagination.
 * RBAC: All authenticated users
 */
kitsRouter.get(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = queryKitsSchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError('Dữ liệu truy vấn danh sách kit không hợp lệ', 422, parsed.error.errors);
      }

      const result = await kitsService.listKits(parsed.data, req.user!);
      return sendSuccess(res, result, 'Danh sách hộp kit thực hành');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/kits/:id
 * Retrieves a single kit with component items.
 * RBAC: All authenticated users
 */
kitsRouter.get(
  '/:id',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const kit = await kitsService.getKitById(id, req.user!);
      return sendSuccess(res, kit, 'Thông tin hộp kit');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/kits
 * Creates a new kit with inventory stock allocation.
 * RBAC: ADMIN, LAB_MANAGER, TECHNICIAN
 */
kitsRouter.post(
  '/',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER, UserRole.TECHNICIAN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createKitSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu tạo hộp kit không hợp lệ', 422, parsed.error.errors);
      }

      const kit = await kitsService.createKit(parsed.data, req.user!, getRequestMetadata(req));
      return sendSuccess(res, kit, 'Tạo hộp kit thành công', 201);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/v1/kits/:id
 * Updates kit metadata, components, or location with inventory reconciliation.
 * RBAC: ADMIN, LAB_MANAGER, TECHNICIAN
 */
kitsRouter.put(
  '/:id',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER, UserRole.TECHNICIAN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const parsed = updateKitSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu cập nhật hộp kit không hợp lệ', 422, parsed.error.errors);
      }

      const kit = await kitsService.updateKit(id, parsed.data, req.user!, getRequestMetadata(req));
      return sendSuccess(res, kit, 'Cập nhật hộp kit thành công');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/kits/:id/status
 * Updates kit status (AVAILABLE, ALLOCATED, MAINTENANCE, RETIRED) with inventory release/re-allocation.
 * RBAC: ADMIN, LAB_MANAGER, TECHNICIAN
 */
kitsRouter.patch(
  '/:id/status',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER, UserRole.TECHNICIAN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const parsed = updateKitStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu cập nhật trạng thái kit không hợp lệ', 422, parsed.error.errors);
      }

      const kit = await kitsService.updateKitStatus(
        id,
        parsed.data,
        req.user!,
        getRequestMetadata(req)
      );
      return sendSuccess(res, kit, 'Cập nhật trạng thái hộp kit thành công');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/kits/:id
 * Deletes a kit and releases component allocations if not already retired.
 * RBAC: ADMIN, LAB_MANAGER
 */
kitsRouter.delete(
  '/:id',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const result = await kitsService.deleteKit(id, req.user!, getRequestMetadata(req));
      return sendSuccess(res, result, result.message);
    } catch (err) {
      next(err);
    }
  }
);
