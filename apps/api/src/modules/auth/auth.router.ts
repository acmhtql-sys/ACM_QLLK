import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../shared/AppError';
import { sendSuccess } from '../../shared/response';
import { authenticate } from '../../middleware/auth';
import { loginRateLimiter } from '../../middleware/rateLimiter';
import { loginSchema } from '@acm/shared';

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
      // Execute counter increment and account locking atomically inside a PostgreSQL transaction.
      // The row-level lock acquired during tx.user.update prevents concurrent requests from observing
      // or resetting failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS before isLocked is committed.
      const { willLock } = await prisma.$transaction(async (tx) => {
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: { failedLoginAttempts: { increment: 1 } },
          select: { failedLoginAttempts: true },
        });

        const locked = updatedUser.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;

        if (locked) {
          await tx.user.update({
            where: { id: user.id },
            data: { isLocked: true },
          });
        }

        return { willLock: locked };
      });

      if (willLock) {
        throw new AppError(
          `Tài khoản đã bị tạm khóa do nhập sai mật khẩu quá ${MAX_FAILED_LOGIN_ATTEMPTS} lần liên tiếp`,
          403
        );
      }

      throw new AppError('Email hoặc mật khẩu không chính xác', 401);
    }

    // Atomically reset failed login attempts on successful authentication,
    // and verify the account was not concurrently locked, deactivated, or reached the failed attempt threshold
    // during password verification.
    const resetResult = await prisma.user.updateMany({
      where: {
        id: user.id,
        isLocked: false,
        isActive: true,
        failedLoginAttempts: { lt: MAX_FAILED_LOGIN_ATTEMPTS },
      },
      data: { failedLoginAttempts: 0 },
    });

    if (resetResult.count === 0) {
      throw new AppError('Tài khoản đã bị tạm khóa do vi phạm chính sách bảo mật', 403);
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

