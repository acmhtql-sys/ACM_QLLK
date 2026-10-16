import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { sendSuccess } from '../../shared/response';
import { authenticate } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { UserRole } from '@prisma/client';

export const auditLogsRouter = Router();

auditLogsRouter.get(
  '/',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const logs = await prisma.auditLog.findMany({
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      const mapped = logs.map((log) => ({
        id: log.id,
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        userName: log.user ? log.user.fullName : 'System',
        createdAt: log.createdAt.toISOString(),
        details: JSON.stringify(log.newValue || {}),
      }));

      return sendSuccess(res, mapped, 'Nhật ký kiểm toán');
    } catch (err) {
      next(err);
    }
  }
);
