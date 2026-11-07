import { Router, Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/response';
import { authenticate, authenticateCatalogInStaging } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { UserRole } from '@prisma/client';
import { AppError } from '../../shared/AppError';
import {
  createCategorySchema,
  updateCategorySchema,
  categoryIdParamSchema,
} from './categories.validator';
import { categoriesService } from './categories.service';

export const categoriesRouter = Router();

/**
 * GET /api/v1/categories
 * List all categories with parent reference and item/child counts.
 * RBAC: Open to all authenticated/public users for catalog browsing.
 */
categoriesRouter.get('/', authenticateCatalogInStaging, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await categoriesService.listCategories();
    return sendSuccess(res, categories, 'Danh sách danh mục linh kiện');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/categories/:id
 * Get single category detail by UUID.
 */
categoriesRouter.get('/:id', authenticateCatalogInStaging, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const paramParsed = categoryIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      throw new AppError('ID danh mục không hợp lệ (yêu cầu UUID)', 400, paramParsed.error.errors);
    }

    const category = await categoriesService.getCategoryById(req.params.id);
    return sendSuccess(res, category, 'Thông tin chi tiết danh mục');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/categories
 * Create new category with code uniqueness and atomic AuditLog.
 * RBAC: ADMIN, LAB_MANAGER only.
 */
categoriesRouter.post(
  '/',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu tạo danh mục không hợp lệ', 400, parsed.error.errors);
      }

      const created = await categoriesService.createCategory(
        parsed.data,
        req.user!.id,
        req.ip,
        req.headers['user-agent']
      );

      return sendSuccess(res, created, 'Tạo danh mục linh kiện thành công', 201);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/categories/:id
 * Update category fields (name, code, description, parentId) with cycle detection.
 * RBAC: ADMIN, LAB_MANAGER only.
 */
categoriesRouter.patch(
  '/:id',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const paramParsed = categoryIdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        throw new AppError('ID danh mục không hợp lệ (yêu cầu UUID)', 400, paramParsed.error.errors);
      }

      const parsed = updateCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu cập nhật danh mục không hợp lệ', 400, parsed.error.errors);
      }

      const updated = await categoriesService.updateCategory(
        req.params.id,
        parsed.data,
        req.user!.id,
        req.ip,
        req.headers['user-agent']
      );

      return sendSuccess(res, updated, 'Cập nhật danh mục thành công');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/categories/:id
 * Guarded Hard Delete: Blocks deletion if category has items or subcategories.
 * RBAC: ADMIN, LAB_MANAGER only.
 */
categoriesRouter.delete(
  '/:id',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const paramParsed = categoryIdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        throw new AppError('ID danh mục không hợp lệ (yêu cầu UUID)', 400, paramParsed.error.errors);
      }

      const deleted = await categoriesService.deleteCategory(
        req.params.id,
        req.user!.id,
        req.ip,
        req.headers['user-agent']
      );

      return sendSuccess(res, { id: deleted.id, deleted: true }, 'Xóa danh mục thành công');
    } catch (err) {
      next(err);
    }
  }
);
