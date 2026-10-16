import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { sendSuccess } from '../../shared/response';
import { authenticate } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { UserRole } from '@prisma/client';
import { AppError } from '../../shared/AppError';
import { createCategorySchema, updateCategorySchema } from '@acm/shared';

export const categoriesRouter = Router();

/**
 * GET /api/v1/categories
 * Returns list of categories with item counts and hierarchy.
 */
categoriesRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        _count: { select: { items: true, children: true } },
        parent: { select: { id: true, name: true, code: true } },
      },
      orderBy: { name: 'asc' },
    });
    return sendSuccess(res, categories, 'Danh sách danh mục linh kiện');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/categories
 * Creates a new category.
 * RBAC: ADMIN, LAB_MANAGER.
 */
categoriesRouter.post(
  '/',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu tạo danh mục không hợp lệ', 422, parsed.error.errors);
      }

      const { code, name, description, parentId } = parsed.data;

      // Check duplicate code
      const existing = await prisma.category.findUnique({
        where: { code: code.toUpperCase() },
      });
      if (existing) {
        throw new AppError(`Mã danh mục '${code}' đã tồn tại trong hệ thống`, 409);
      }

      // Check parent category if provided
      if (parentId) {
        const parent = await prisma.category.findUnique({ where: { id: parentId } });
        if (!parent) {
          throw new AppError('Danh mục cha không tồn tại', 404);
        }
      }

      const category = await prisma.category.create({
        data: {
          code: code.toUpperCase(),
          name,
          description,
          parentId: parentId || null,
        },
        include: {
          _count: { select: { items: true, children: true } },
          parent: { select: { id: true, name: true, code: true } },
        },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CATEGORY_CREATE',
          entity: 'CATEGORY',
          entityId: category.id,
          newValue: { code: category.code, name: category.name },
          ipAddress: req.ip || null,
          userAgent: req.get('user-agent') || null,
        },
      });

      return sendSuccess(res, category, 'Tạo danh mục linh kiện thành công', 201);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/v1/categories/:id
 * Updates an existing category.
 * RBAC: ADMIN, LAB_MANAGER.
 */
categoriesRouter.put(
  '/:id',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu cập nhật danh mục không hợp lệ', 422, parsed.error.errors);
      }

      const { id } = req.params;
      const current = await prisma.category.findUnique({ where: { id } });
      if (!current) {
        throw new AppError('Danh mục không tồn tại', 404);
      }

      const { name, description, parentId } = parsed.data;

      if (parentId) {
        if (parentId === id) {
          throw new AppError('Danh mục không thể làm cha của chính nó', 400);
        }
        const parent = await prisma.category.findUnique({ where: { id: parentId } });
        if (!parent) {
          throw new AppError('Danh mục cha không tồn tại', 404);
        }
      }

      const updated = await prisma.category.update({
        where: { id },
        data: {
          name: name ?? current.name,
          description: description !== undefined ? description : current.description,
          parentId: parentId !== undefined ? parentId : current.parentId,
        },
        include: {
          _count: { select: { items: true, children: true } },
          parent: { select: { id: true, name: true, code: true } },
        },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CATEGORY_UPDATE',
          entity: 'CATEGORY',
          entityId: updated.id,
          oldValue: { name: current.name, description: current.description },
          newValue: { name: updated.name, description: updated.description },
          ipAddress: req.ip || null,
          userAgent: req.get('user-agent') || null,
        },
      });

      return sendSuccess(res, updated, 'Cập nhật danh mục thành công');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/categories/:id
 * Deletes an empty category.
 * RBAC: ADMIN, LAB_MANAGER.
 */
categoriesRouter.delete(
  '/:id',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const category = await prisma.category.findUnique({
        where: { id },
        include: {
          _count: { select: { items: true, children: true } },
        },
      });

      if (!category) {
        throw new AppError('Danh mục không tồn tại', 404);
      }

      if (category._count.items > 0) {
        throw new AppError(
          `Không thể xóa danh mục đang có ${category._count.items} linh kiện. Vui lòng chuyển linh kiện sang danh mục khác trước khi xóa.`,
          400
        );
      }

      if (category._count.children > 0) {
        throw new AppError(
          `Không thể xóa danh mục đang có ${category._count.children} danh mục con.`,
          400
        );
      }

      await prisma.category.delete({ where: { id } });

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CATEGORY_DELETE',
          entity: 'CATEGORY',
          entityId: id,
          oldValue: { code: category.code, name: category.name },
          ipAddress: req.ip || null,
          userAgent: req.get('user-agent') || null,
        },
      });

      return sendSuccess(res, { id }, 'Xóa danh mục thành công');
    } catch (err) {
      next(err);
    }
  }
);
