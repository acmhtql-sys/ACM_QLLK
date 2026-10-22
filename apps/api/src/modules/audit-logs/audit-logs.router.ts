import { Router, Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { sendSuccess } from '../../shared/response';
import { AppError } from '../../shared/AppError';
import { auditLogsService } from './audit-logs.service';
import { queryAuditLogsSchema } from '@acm/shared';

export const auditLogsRouter = Router();

/**
 * GET /api/v1/audit-logs
 * Retrieves paginated audit logs with search, action, entity, user and date filtering.
 * RBAC: ADMIN
 */
auditLogsRouter.get(
  '/',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = queryAuditLogsSchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError('Dữ liệu truy vấn nhật ký kiểm toán không hợp lệ', 422, parsed.error.errors);
      }

      const result = await auditLogsService.listAuditLogs(parsed.data, req.user!);
      return sendSuccess(res, result, 'Danh sách nhật ký kiểm toán hệ thống');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/audit-logs/:id
 * Retrieves a single audit log by ID with sanitized details.
 * RBAC: ADMIN
 */
auditLogsRouter.get(
  '/:id',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const log = await auditLogsService.getAuditLogById(id, req.user!);
      return sendSuccess(res, log, 'Chi tiết nhật ký kiểm toán');
    } catch (err) {
      next(err);
    }
  }
);
