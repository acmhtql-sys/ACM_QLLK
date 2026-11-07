import { Router, Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/response';
import { authenticate, authenticateOptional } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { UserRole } from '@prisma/client';
import { AppError } from '../../shared/AppError';
import {
  createLocationSchema,
  updateLocationSchema,
  updateLocationStatusSchema,
  queryLocationsSchema,
  queryLocationTreeSchema,
} from '@acm/shared';
import { locationsService } from './locations.service';

export const locationsRouter = Router();

/**
 * GET /api/v1/locations/tree
 * Returns full recursive location hierarchy tree.
 * RBAC: ADMIN, LAB_MANAGER, TECHNICIAN only (STUDENT is forbidden).
 */
locationsRouter.get(
  '/tree',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER, UserRole.TECHNICIAN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedQuery = queryLocationTreeSchema.safeParse(req.query);
      if (!parsedQuery.success) {
        throw new AppError('Tham số truy vấn cây vị trí không hợp lệ', 422, parsedQuery.error.issues);
      }

      const tree = await locationsService.getLocationTree(parsedQuery.data, req.user);
      return sendSuccess(res, tree, 'Cây phân cấp vị trí kho');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/locations
 * Returns paginated flat location list with filters, search, and sorting.
 * RBAC: ADMIN, LAB_MANAGER, TECHNICIAN only (STUDENT is forbidden).
 */
locationsRouter.get(
  '/',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER, UserRole.TECHNICIAN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedQuery = queryLocationsSchema.safeParse(req.query);
      if (!parsedQuery.success) {
        throw new AppError('Tham số truy vấn không hợp lệ', 422, parsedQuery.error.issues);
      }

      const result = await locationsService.listLocations(parsedQuery.data, req.user);
      return res.status(200).json({
        success: true,
        message: 'Danh sách vị trí kho từ cơ sở dữ liệu',
        data: result.locations,
        meta: result.meta,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/locations/:id
 * Returns single location detail, parent, children, and stock balances stored at this location.
 * RBAC: ADMIN, LAB_MANAGER, TECHNICIAN only (STUDENT is forbidden).
 */
locationsRouter.get(
  '/:id',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER, UserRole.TECHNICIAN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const location = await locationsService.getLocationById(req.params.id, req.user);
      return sendSuccess(res, location, 'Thông tin chi tiết vị trí kho');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/locations
 * Creates new location with duplicate code check, hierarchy level check, and audit log.
 * RBAC: ADMIN, LAB_MANAGER only.
 */
locationsRouter.post(
  '/',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createLocationSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu tạo vị trí kho không hợp lệ', 422, parsed.error.issues);
      }

      const created = await locationsService.createLocation(
        parsed.data,
        req.user!.id,
        req.ip,
        req.headers['user-agent']
      );

      return sendSuccess(res, created, 'Tạo vị trí kho thành công', 201);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/v1/locations/:id
 * Updates location attributes with anti-loop and hierarchy level checks.
 * RBAC: ADMIN, LAB_MANAGER only.
 */
locationsRouter.put(
  '/:id',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateLocationSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu cập nhật vị trí kho không hợp lệ', 422, parsed.error.issues);
      }

      const updated = await locationsService.updateLocation(
        req.params.id,
        parsed.data,
        req.user!.id,
        req.ip,
        req.headers['user-agent']
      );

      return sendSuccess(res, updated, 'Cập nhật vị trí kho thành công', 200);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/locations/:id/status
 * Safely activates or deactivates a location with guard against active children and active stock.
 * RBAC: ADMIN, LAB_MANAGER only.
 */
locationsRouter.patch(
  '/:id/status',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateLocationStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu trạng thái vị trí kho không hợp lệ', 422, parsed.error.issues);
      }

      const updated = await locationsService.updateLocationStatus(
        req.params.id,
        parsed.data,
        req.user!.id,
        req.ip,
        req.headers['user-agent']
      );

      const actionText = parsed.data.isActive ? 'Kích hoạt' : 'Vô hiệu hóa';
      return sendSuccess(res, updated, `${actionText} vị trí kho thành công`, 200);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/locations/:id
 * Physical deletion is explicitly forbidden to preserve location hierarchy and stock movements.
 */
locationsRouter.delete('/:id', (_req: Request, _res: Response, next: NextFunction) => {
  next(
    new AppError(
      'Hệ thống không hỗ trợ xóa vật lý vị trí kho. Vui lòng sử dụng cập nhật trạng thái PATCH /api/v1/locations/:id/status để vô hiệu hóa an toàn.',
      405
    )
  );
});
