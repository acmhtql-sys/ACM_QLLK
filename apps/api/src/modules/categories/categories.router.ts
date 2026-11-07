import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { sendSuccess } from '../../shared/response';
import { authenticateCatalogInStaging } from '../../middleware/auth';

export const categoriesRouter = Router();

categoriesRouter.get('/', authenticateCatalogInStaging, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        _count: { select: { items: true } },
      },
      orderBy: { name: 'asc' },
    });
    return sendSuccess(res, categories, 'Danh sách danh mục linh kiện');
  } catch (err) {
    next(err);
  }
});
