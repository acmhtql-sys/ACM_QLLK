import { Router, Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { sendSuccess } from '../../shared/response';
import { AppError } from '../../shared/AppError';
import { usersService } from './users.service';
import {
  createUserSchema,
  updateUserSchema,
  updateUserStatusSchema,
  resetUserPasswordSchema,
  queryUsersSchema,
} from '@acm/shared';

export const usersRouter = Router();

function getRequestMetadata(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

/**
 * GET /api/v1/users
 * Lists users with filtering, sorting and pagination.
 * RBAC: ADMIN, LAB_MANAGER
 */
usersRouter.get(
  '/',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = queryUsersSchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError('Dữ liệu truy vấn danh sách người dùng không hợp lệ', 422, parsed.error.errors);
      }

      const result = await usersService.listUsers(parsed.data, req.user!);
      return sendSuccess(res, result, 'Danh sách người dùng');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/users/:id
 * Retrieves a user by ID.
 * RBAC: ADMIN, LAB_MANAGER, or the user themselves
 */
usersRouter.get(
  '/:id',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const user = await usersService.getUserById(id, req.user!);
      return sendSuccess(res, user, 'Thông tin người dùng');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/users
 * Creates a new user account.
 * RBAC: ADMIN
 */
usersRouter.post(
  '/',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu tạo người dùng không hợp lệ', 422, parsed.error.errors);
      }

      const user = await usersService.createUser(parsed.data, req.user!, getRequestMetadata(req));
      return sendSuccess(res, user, 'Tạo tài khoản người dùng thành công', 201);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/v1/users/:id
 * Updates user profile details with anti-privilege-escalation guards.
 * RBAC: ADMIN or the user themselves (restricted fields)
 */
usersRouter.put(
  '/:id',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu cập nhật người dùng không hợp lệ', 422, parsed.error.errors);
      }

      const user = await usersService.updateUser(id, parsed.data, req.user!, getRequestMetadata(req));
      return sendSuccess(res, user, 'Cập nhật thông tin người dùng thành công');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/users/:id/status
 * Toggles user active or locked status with last admin lockout protection.
 * RBAC: ADMIN
 */
usersRouter.patch(
  '/:id/status',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const parsed = updateUserStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu cập nhật trạng thái không hợp lệ', 422, parsed.error.errors);
      }

      const user = await usersService.updateUserStatus(
        id,
        parsed.data,
        req.user!,
        getRequestMetadata(req)
      );
      return sendSuccess(res, user, 'Cập nhật trạng thái người dùng thành công');
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/users/:id/reset-password
 * Resets user password.
 * RBAC: ADMIN only; self-service password changes require the current password.
 */
usersRouter.post(
  '/:id/reset-password',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const parsed = resetUserPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Dữ liệu đặt lại mật khẩu không hợp lệ', 422, parsed.error.errors);
      }

      const user = await usersService.resetPassword(
        id,
        parsed.data,
        req.user!,
        getRequestMetadata(req)
      );
      return sendSuccess(res, user, 'Đặt lại mật khẩu thành công');
    } catch (err) {
      next(err);
    }
  }
);
