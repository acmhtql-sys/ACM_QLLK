import { Router, Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/response';
import { authenticate } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { UserRole } from '@prisma/client';
import { AppError } from '../../shared/AppError';
import {
  queryStockTransactionsSchema,
  queryIdempotencyParamsSchema,
  importStockSchema,
  exportStockSchema,
  transferStockSchema,
  adjustStockSchema,
  adjustStockSchemaV2,
} from '@acm/shared';
import { requireIdempotencyKey, IdempotencyRequest } from '../../middleware/idempotency';
import { stockTransactionsService } from './stock-transactions.service';

export const stockTransactionsRouter = Router();

/**
 * GET /api/v1/stock-transactions
 * Retrieves paginated stock transactions with search, filters, and sorting.
 * RBAC: ADMIN, LAB_MANAGER, TECHNICIAN only (STUDENT is forbidden).
 */
stockTransactionsRouter.get(
  '/',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER, UserRole.TECHNICIAN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedQuery = queryStockTransactionsSchema.safeParse(req.query);
      if (!parsedQuery.success) {
        throw new AppError('Tham số truy vấn giao dịch kho không hợp lệ', 422, parsedQuery.error.issues);
      }

      const result = await stockTransactionsService.listTransactions(parsedQuery.data);

      return res.status(200).json({
        success: true,
        message: 'Danh sách giao dịch kho từ Database',
        data: result.transactions,
        meta: result.meta,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/stock-transactions/idempotency/:key
 * Retrieves stock transaction execution state by Idempotency-Key.
 * RBAC: ADMIN, LAB_MANAGER, TECHNICIAN (STUDENT is forbidden with 403).
 * Ownership Isolation: Strictly owner-only (non-owners receive 404 to prevent key probing).
 * Pure SELECT: Zero DB mutations, zero AuditLogs created.
 * MUST be registered BEFORE dynamic route GET /:id to prevent route shadowing.
 */
stockTransactionsRouter.get(
  '/idempotency/:key',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER, UserRole.TECHNICIAN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedParams = queryIdempotencyParamsSchema.safeParse(req.params);
      if (!parsedParams.success) {
        throw new AppError(
          "Định dạng 'Idempotency-Key' không hợp lệ (yêu cầu từ 8 đến 64 ký tự chữ, số, gạch ngang, gạch dưới)",
          400,
          { errorCode: 'INVALID_IDEMPOTENCY_KEY_FORMAT' }
        );
      }

      const currentUserId = req.user?.id;
      if (!currentUserId) {
        throw new AppError('Yêu cầu xác thực tài khoản', 401);
      }

      const result = await stockTransactionsService.queryIdempotencyRecord(
        parsedParams.data.key,
        currentUserId
      );

      return sendSuccess(res, result, 'Tra cứu trạng thái idempotency thành công');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/stock-transactions/:id
 * Retrieves single transaction details with all line details.
 * RBAC: ADMIN, LAB_MANAGER, TECHNICIAN only (STUDENT is forbidden).
 */
stockTransactionsRouter.get(
  '/:id',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER, UserRole.TECHNICIAN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const transaction = await stockTransactionsService.getTransactionById(req.params.id);
      return sendSuccess(res, transaction, 'Thông tin chi tiết giao dịch kho');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/stock-transactions/import
 * Imports components/equipment into inventory.
 * RBAC: ADMIN, LAB_MANAGER only (TECHNICIAN, STUDENT: 403 Forbidden).
 * Requires header: Idempotency-Key
 */
stockTransactionsRouter.post(
  '/import',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  requireIdempotencyKey,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedBody = importStockSchema.safeParse(req.body);
      if (!parsedBody.success) {
        throw new AppError('Dữ liệu nhập kho không hợp lệ', 422, parsedBody.error.issues);
      }

      const userId = req.user!.id;
      const idempotencyKey = (req as IdempotencyRequest).idempotencyKey!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
      const userAgent = req.headers['user-agent'] || '';

      const result = await stockTransactionsService.importStock(
        parsedBody.data,
        userId,
        idempotencyKey,
        ipAddress,
        userAgent
      );

      res.setHeader('X-Cache-Lookup', result.cached ? 'HIT' : 'MISS');
      return res.status(result.statusCode).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/stock-transactions/export
 * Exports components/equipment from inventory with available stock protection.
 * RBAC: ADMIN, LAB_MANAGER only (TECHNICIAN, STUDENT: 403 Forbidden).
 * Requires header: Idempotency-Key
 */
stockTransactionsRouter.post(
  '/export',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  requireIdempotencyKey,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedBody = exportStockSchema.safeParse(req.body);
      if (!parsedBody.success) {
        throw new AppError('Dữ liệu xuất kho không hợp lệ', 422, parsedBody.error.issues);
      }

      const userId = req.user!.id;
      const idempotencyKey = (req as IdempotencyRequest).idempotencyKey!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
      const userAgent = req.headers['user-agent'] || '';

      const result = await stockTransactionsService.exportStock(
        parsedBody.data,
        userId,
        idempotencyKey,
        ipAddress,
        userAgent
      );

      res.setHeader('X-Cache-Lookup', result.cached ? 'HIT' : 'MISS');
      return res.status(result.statusCode).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/stock-transactions/transfer
 * Transfers components/equipment between locations.
 * RBAC: ADMIN, LAB_MANAGER only (TECHNICIAN, STUDENT: 403 Forbidden).
 * Requires header: Idempotency-Key
 */
stockTransactionsRouter.post(
  '/transfer',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  requireIdempotencyKey,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedBody = transferStockSchema.safeParse(req.body);
      if (!parsedBody.success) {
        throw new AppError('Dữ liệu điều chuyển kho không hợp lệ', 422, parsedBody.error.issues);
      }

      const userId = req.user!.id;
      const idempotencyKey = (req as IdempotencyRequest).idempotencyKey!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
      const userAgent = req.headers['user-agent'] || '';

      const result = await stockTransactionsService.transferStock(
        parsedBody.data,
        userId,
        idempotencyKey,
        ipAddress,
        userAgent
      );

      res.setHeader('X-Cache-Lookup', result.cached ? 'HIT' : 'MISS');
      return res.status(result.statusCode).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/stock-transactions/adjustment
 * Adjusts inventory balances based on physical inventory counts.
 * RBAC: ADMIN, LAB_MANAGER only (TECHNICIAN, STUDENT: 403 Forbidden).
 * Requires header: Idempotency-Key
 */
stockTransactionsRouter.post(
  '/adjustment',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  requireIdempotencyKey,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedBody = adjustStockSchemaV2.safeParse(req.body);
      if (!parsedBody.success) {
        throw new AppError('Dữ liệu điều chỉnh tồn kho không hợp lệ (yêu cầu snapshot tồn kho V2)', 422, parsedBody.error.issues);
      }

      const userId = req.user!.id;
      const idempotencyKey = (req as IdempotencyRequest).idempotencyKey!;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
      const userAgent = req.headers['user-agent'] || '';

      const result = await stockTransactionsService.adjustStock(
        parsedBody.data,
        userId,
        idempotencyKey,
        ipAddress,
        userAgent
      );

      res.setHeader('X-Cache-Lookup', result.cached ? 'HIT' : 'MISS');
      return res.status(result.statusCode).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/v1/stock-transactions/:id
 * Completed transactions are strictly immutable. Updating is forbidden.
 */
stockTransactionsRouter.put('/:id', (_req: Request, _res: Response, next: NextFunction) => {
  next(
    new AppError(
      'Hệ thống không hỗ trợ sửa đổi chứng từ kho đã ghi sổ. Vui lòng thực hiện giao dịch điều chỉnh hoặc bù trừ.',
      405
    )
  );
});

/**
 * DELETE /api/v1/stock-transactions/:id
 * Deletion is forbidden to preserve stock ledger integrity.
 */
stockTransactionsRouter.delete('/:id', (_req: Request, _res: Response, next: NextFunction) => {
  next(
    new AppError(
      'Hệ thống không hỗ trợ xóa chứng từ kho. Lịch sử giao dịch phải được bảo toàn vĩnh viễn.',
      405
    )
  );
});
