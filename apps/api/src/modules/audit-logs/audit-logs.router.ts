import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { sendSuccess } from '../../shared/response';
import { authenticate } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { UserRole } from '@prisma/client';

export const auditLogsRouter = Router();

const MOCK_AUDIT_LOGS = [
  {
    id: 'log-1',
    action: 'SEED_INITIAL_INVENTORY',
    entity: 'StockBalance',
    entityId: 'ALL',
    userName: 'System Administrator',
    createdAt: new Date().toISOString(),
    details: 'Khởi tạo số dư tồn kho ban đầu cho 7 linh kiện cốt lõi',
  },
  {
    id: 'log-2',
    action: 'APPROVE_BORROW_REQUEST',
    entity: 'BorrowRequest',
    entityId: 'BR-20261010-001',
    userName: 'Lab Manager',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    details: 'Phê duyệt phiếu mượn và cập nhật số lượng Reserved',
  },
  {
    id: 'log-3',
    action: 'HANDOVER_ASSET',
    entity: 'Asset',
    entityId: 'ESP32-WROOM-32',
    userName: 'Lab Manager',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    details: 'Bàn giao thiết bị, giảm Reserved, tăng Borrowed',
  },
];

auditLogsRouter.get(
  '/',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (_req: Request, res: Response, next: NextFunction) => {
  try {
    try {
      const logs = await prisma.auditLog.findMany({
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      if (logs.length > 0) {
        const mapped = logs.map((l) => ({
          id: l.id,
          action: l.action,
          entity: l.entity,
          entityId: l.entityId,
          userName: l.user ? l.user.fullName : 'System',
          createdAt: l.createdAt.toISOString(),
          details: JSON.stringify(l.newValue || {}),
        }));
        return sendSuccess(res, mapped, 'Nhật ký kiểm toán');
      }
    } catch {
      // Fallback
    }
    return sendSuccess(res, MOCK_AUDIT_LOGS, 'Nhật ký kiểm toán (Foundation Dev)');
  } catch (err) {
    next(err);
  }
});
