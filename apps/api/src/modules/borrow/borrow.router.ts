import { Router, Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/response';
import { authenticate } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { UserRole } from '@prisma/client';
import { AppError } from '../../shared/AppError';
import {
  createBorrowRequestSchema,
  approveBorrowRequestSchema,
  rejectBorrowRequestSchema,
  cancelBorrowRequestSchema,
  handoverBorrowRequestSchema,
  returnBorrowRequestSchema,
  queryBorrowRequestsSchema,
} from '@acm/shared';
import { borrowService } from './borrow.service';
import { idempotencyService } from '../inventory/idempotency.service';
import { prisma } from '../../config/database';

export const borrowRouter = Router();

/**
 * GET /api/v1/borrow-requests
 * Lists borrow requests with pagination, status, search, overdue filtering, and RBAC isolation.
 */
borrowRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsedQuery = queryBorrowRequestsSchema.safeParse(req.query);
    if (!parsedQuery.success) {
      throw new AppError('Tham số truy vấn không hợp lệ', 422, parsedQuery.error.issues);
    }

    const result = await borrowService.listBorrowRequests(parsedQuery.data, req.user!);

    return res.status(200).json({
      success: true,
      message: 'Danh sách phiếu mượn từ Database',
      data: result.items,
      meta: result.meta,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/borrow-requests/:id
 * Retrieves single borrow request details with RBAC authorization check.
 */
borrowRouter.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const borrowRequest = await borrowService.getBorrowRequestById(req.params.id, req.user!);
    return sendSuccess(res, borrowRequest, 'Thông tin chi tiết phiếu mượn');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/borrow-requests
 * Creates a new borrow request with stock availability check and date validation.
 */
borrowRouter.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createBorrowRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Dữ liệu tạo phiếu mượn không hợp lệ', 422, parsed.error.issues);
    }

    const created = await borrowService.createBorrowRequest(parsed.data, req.user!);
    return sendSuccess(res, created, 'Tạo phiếu mượn thành công', 201);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/borrow-requests/:id/approve
 * Approves a PENDING borrow request and reserves inventory stock.
 * RBAC: ADMIN, LAB_MANAGER only.
 */
borrowRouter.patch(
  '/:id/approve',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = approveBorrowRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu phê duyệt không hợp lệ', 422, parsed.error.issues);
      }

      const approved = await borrowService.approveBorrowRequest(
        req.params.id,
        parsed.data,
        req.user!
      );
      return sendSuccess(res, approved, 'Phê duyệt phiếu mượn thành công');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/borrow-requests/:id/reject
 * Rejects a PENDING borrow request with required rejection reason.
 * RBAC: ADMIN, LAB_MANAGER only.
 */
borrowRouter.patch(
  '/:id/reject',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = rejectBorrowRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu từ chối không hợp lệ', 422, parsed.error.issues);
      }

      const rejected = await borrowService.rejectBorrowRequest(
        req.params.id,
        parsed.data,
        req.user!
      );
      return sendSuccess(res, rejected, 'Từ chối phiếu mượn thành công');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/borrow-requests/:id/cancel
 * Cancels a borrow request. If APPROVED, releases active reservations.
 * RBAC: STUDENT (own PENDING requests only), ADMIN/LAB_MANAGER (PENDING or APPROVED).
 */
borrowRouter.patch(
  '/:id/cancel',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = cancelBorrowRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu hủy phiếu không hợp lệ', 422, parsed.error.issues);
      }

      const cancelled = await borrowService.cancelBorrowRequest(
        req.params.id,
        parsed.data,
        req.user!
      );
      return sendSuccess(res, cancelled, 'Hủy phiếu mượn thành công');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/borrow-requests/:id/handover
 * Performs physical handover of items: moves stock from reserved/onHand to borrowed and records movement.
 * RBAC: ADMIN, LAB_MANAGER, TECHNICIAN.
 */
borrowRouter.patch(
  '/:id/handover',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER, UserRole.TECHNICIAN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = handoverBorrowRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu bàn giao không hợp lệ', 422, parsed.error.issues);
      }

      const handedOver = await borrowService.handoverBorrowRequest(
        req.params.id,
        parsed.data,
        req.user!
      );
      return sendSuccess(res, handedOver, 'Bàn giao linh kiện thành công');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/borrow-requests/:id/return
 * Confirms full or partial return of borrowed items with condition inspection and stock reconciliation.
 * RBAC: ADMIN, LAB_MANAGER, TECHNICIAN.
 */
borrowRouter.post(
  '/:id/return',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER, UserRole.TECHNICIAN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = returnBorrowRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu hoàn trả không hợp lệ', 422, parsed.error.issues);
      }

      const idempotencyKey = req.get('Idempotency-Key');
      if (!idempotencyKey) {
        throw new AppError('Thiếu Idempotency-Key bắt buộc cho thao tác hoàn trả', 428);
      }
      if (!idempotencyService.validateKey(idempotencyKey)) {
        throw new AppError('Idempotency-Key phải có 8-64 ký tự chữ, số, - hoặc _', 422);
      }

      const result = await borrowService.returnBorrowRequest(
        req.params.id,
        parsed.data,
        req.user!,
        idempotencyKey
      );
      return sendSuccess(res, result, 'Xác nhận hoàn trả linh kiện thành công');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/borrow-requests/:id/return-idempotency/:key
 * Authenticated, same-actor read-only reconciliation after ambiguous 504.
 * Never triggers a second business write.
 */
borrowRouter.get(
  '/:id/return-idempotency/:key',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER, UserRole.TECHNICIAN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = req.params.key;
      if (!idempotencyService.validateKey(key)) {
        throw new AppError('Idempotency-Key không hợp lệ', 422);
      }
      const record = await prisma.idempotencyRecord.findUnique({ where: { key } });
      const endpoint = `/api/v1/borrow-requests/${req.params.id}/return`;

      // Do not reveal the existence of a key belonging to another user,
      // another borrow request or a different API operation.
      if (!record || record.userId !== req.user!.id || record.endpoint !== endpoint) {
        throw new AppError('Không tìm thấy thông tin đối soát thuộc quyền truy cập', 404);
      }

      const stored = record.responseBody as { returnNumber?: string } | null;
      return res.status(200).json({
        success: true,
        data: {
          status: record.status,
          returnNumber: record.status === 'COMPLETED'
            ? stored?.returnNumber ?? null : null,
          confirmed: record.status === 'COMPLETED' && Boolean(stored?.returnNumber),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);
