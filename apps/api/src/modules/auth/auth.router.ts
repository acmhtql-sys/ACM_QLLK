import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../shared/AppError';
import { sendSuccess } from '../../shared/response';
import { authenticate } from '../../middleware/auth';
import { loginRateLimiter } from '../../middleware/rateLimiter';
import { loginSchema, changePasswordSchema } from '@acm/shared';

export const authRouter = Router();

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;

/**
 * POST /api/v1/auth/login
 * Authenticates user credentials directly from PostgreSQL Database.
 * Protected by IP-level Rate Limiting and consecutive failed-login Account Lockout.
 */
authRouter.post('/login', loginRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Email hoặc mật khẩu không hợp lệ', 422, parsed.error.errors);
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      throw new AppError('Email hoặc mật khẩu không chính xác', 401);
    }

    if (!user.isActive) {
      throw new AppError('Tài khoản đã bị vô hiệu hóa, vui lòng liên hệ quản trị viên', 403);
    }

    if (user.isLocked) {
      throw new AppError('Tài khoản đã bị tạm khóa do vi phạm chính sách bảo mật', 403);
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      const nextFailedAttempts = (user.failedLoginAttempts || 0) + 1;
      const willLock = nextFailedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: nextFailedAttempts,
          isLocked: willLock ? true : user.isLocked,
        },
      });

      if (willLock) {
        throw new AppError(
          `Tài khoản đã bị tạm khóa do nhập sai mật khẩu quá ${MAX_FAILED_LOGIN_ATTEMPTS} lần liên tiếp`,
          403
        );
      }

      throw new AppError('Email hoặc mật khẩu không chính xác', 401);
    }

    // Reset failed login attempts on successful authentication
    if (user.failedLoginAttempts > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0 },
      });
    }

    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
    };

    const token = jwt.sign(tokenPayload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as any,
    });

    return sendSuccess(
      res,
      {
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
        },
      },
      'Đăng nhập thành công'
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/auth/me
 * Returns current authenticated user profile retrieved and verified from database
 */
authRouter.get('/me', authenticate, (req: Request, res: Response) => {
  sendSuccess(res, { user: req.user }, 'Thông tin tài khoản hiện tại');
});

/**
 * POST /api/v1/auth/change-password
 * Changes password for currently authenticated user.
 */
authRouter.post('/change-password', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Dữ liệu đổi mật khẩu không hợp lệ', 422, parsed.error.errors);
    }

    const { currentPassword, newPassword } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, passwordHash: true, email: true },
    });

    if (!user) {
      throw new AppError('Người dùng không tồn tại', 404);
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Mật khẩu hiện tại không chính xác', 400);
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    // Audit log (strictly without passwords)
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_CHANGE_PASSWORD',
        entity: 'USER',
        entityId: user.id,
        newValue: { changed: true },
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      },
    });

    return sendSuccess(res, { changed: true }, 'Đổi mật khẩu thành công');
  } catch (err) {
    next(err);
  }
});

