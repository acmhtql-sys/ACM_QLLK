import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../shared/AppError';
import { sendSuccess } from '../../shared/response';
import { authenticate } from '../../middleware/auth';
import { loginRateLimiter, accountLoginRateLimiter } from '../../middleware/rateLimiter';
import { loginSchema } from '@acm/shared';
import { UserRole, Prisma } from '@prisma/client';
import { computePasswordTag } from './auth.security';

export const authRouter = Router();

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;

/**
 * POST /api/v1/auth/login
 * Authenticates user credentials directly from PostgreSQL Database.
 * Protected by IP-level Rate Limiting and consecutive failed-login Account Lockout.
 * SEC-02: Suppresses automated lockout if target is the last operational ADMIN.
 * SEC-01: Binds pwdTag in JWT payload for session invalidation on password change.
 */
authRouter.post('/login', loginRateLimiter, accountLoginRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
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

    // Cloud Staging is read-only even for the narrowly allowed login endpoint.
    // Rate limiters remain active in memory; never increment login counters or lock accounts here.
    // env validation requires STAGING_READ_ONLY=true for this deployment profile.
    const isCloudStagingReadOnlyLogin = env.ACM_DEPLOYMENT_PROFILE === 'cloud_staging';
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      if (isCloudStagingReadOnlyLogin) {
        throw new AppError('Email hoặc mật khẩu không chính xác', 401);
      }
      // Execute counter increment and account locking atomically inside a PostgreSQL transaction.
      // The row-level lock acquired during tx.user.update prevents concurrent requests from observing
      // or resetting failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS before isLocked is committed.
      const { willLock } = await prisma.$transaction(async (tx) => {
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: { failedLoginAttempts: { increment: 1 } },
          select: { failedLoginAttempts: true, role: true, isActive: true, isLocked: true },
        });

        const locked = updatedUser.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;

        if (locked) {
          // SEC-02: Prevent automated lockout from eliminating the last operational ADMIN
          if (updatedUser.role === UserRole.ADMIN && updatedUser.isActive && !updatedUser.isLocked) {
            const operationalAdminCount = await tx.user.count({
              where: { role: UserRole.ADMIN, isActive: true, isLocked: false },
            });
            if (operationalAdminCount <= 1) {
              logger.warn(
                `[SECURITY_AUDIT] Brute-force threshold (${MAX_FAILED_LOGIN_ATTEMPTS}) reached for last operational ADMIN (${user.id}). Account lockout suppressed to maintain administrative availability.`
              );
              return { willLock: false, isLastAdmin: true };
            }
          }

          await tx.user.update({
            where: { id: user.id },
            data: { isLocked: true },
          });
        }

        return { willLock: locked, isLastAdmin: false };
      });

      if (willLock) {
        throw new AppError(
          `Tài khoản đã bị tạm khóa do nhập sai mật khẩu quá ${MAX_FAILED_LOGIN_ATTEMPTS} lần liên tiếp`,
          403
        );
      }

      // CRITICAL: Return standard 401 error message so attacker gets NO indication of admin status
      throw new AppError('Email hoặc mật khẩu không chính xác', 401);
    }

    if (isCloudStagingReadOnlyLogin) {
      // Re-read security-relevant fields without a transaction or any UPDATE.
      // Reject a disabled/locked/changed account and a breached existing login threshold.
      const latestUser = await prisma.user.findUnique({ where: { id: user.id } });
      if (
        !latestUser ||
        !latestUser.isActive ||
        latestUser.isLocked ||
        latestUser.passwordHash !== user.passwordHash ||
        latestUser.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS
      ) {
        throw new AppError('Tài khoản không còn đủ điều kiện đăng nhập', 403);
      }

      const tokenPayload = {
        id: latestUser.id,
        email: latestUser.email,
        role: latestUser.role,
        fullName: latestUser.fullName,
        pwdTag: computePasswordTag(latestUser.id, latestUser.passwordHash),
      };
      const token = jwt.sign(tokenPayload, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRES_IN as any,
      });
      return sendSuccess(
        res,
        {
          token,
          user: {
            id: latestUser.id,
            email: latestUser.email,
            fullName: latestUser.fullName,
            role: latestUser.role,
          },
        },
        'Đăng nhập thành công'
      );
    }

    // Atomically reset failed login attempts on successful authentication inside a Serializable transaction.
    // Concurrency and security guards:
    // 1. isLocked: false (fails closed if account was concurrently locked)
    // 2. isActive: true (fails closed if account was concurrently deactivated)
    // 3. passwordHash: user.passwordHash (fails closed if password was concurrently changed)
    // 4. Strict last operational ADMIN exception:
    //    - Standard accounts and non-last admins exceeding MAX_FAILED_LOGIN_ATTEMPTS are rejected (403).
    //    - ONLY the last operational ADMIN (operationalAdminCount <= 1 evaluated inside transaction)
    //      is granted the recovery exception to reset failedLoginAttempts to 0 and restore access without manual DB intervention.
    type TxAuthOutcome =
      | { status: 'SUCCESS' }
      | { status: 'LOCKED_THRESHOLD'; reason: string };

    let txOutcome: TxAuthOutcome | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        txOutcome = await prisma.$transaction(
          async (tx): Promise<TxAuthOutcome> => {
            const current = await tx.user.findUnique({
              where: { id: user.id },
              select: {
                id: true,
                role: true,
                isActive: true,
                isLocked: true,
                passwordHash: true,
                failedLoginAttempts: true,
              },
            });

            if (!current || !current.isActive || current.isLocked) {
              throw new AppError('Tài khoản đã bị tạm khóa do vi phạm chính sách bảo mật', 403);
            }

            if (current.passwordHash !== user.passwordHash) {
              throw new AppError('Phiên đăng nhập đã hết hiệu lực do mật khẩu đã thay đổi, vui lòng đăng nhập lại', 401);
            }

            if (current.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
              // Non-admins exceeding threshold are strictly forbidden and locked
              if (current.role !== UserRole.ADMIN) {
                const lockResult = await tx.user.updateMany({
                  where: { id: user.id, isLocked: false },
                  data: { isLocked: true },
                });
                if (lockResult.count === 0 && !current.isLocked) {
                  // Concurrent update conflict: rollback and fail-closed
                  throw new AppError('Xung đột cập nhật trạng thái khóa tài khoản', 409);
                }
                return {
                  status: 'LOCKED_THRESHOLD',
                  reason: 'Tài khoản đã bị tạm khóa do vi phạm chính sách bảo mật',
                };
              }

              // Evaluate operational ADMIN count directly inside transaction
              const operationalAdminCount = await tx.user.count({
                where: { role: UserRole.ADMIN, isActive: true, isLocked: false },
              });

              if (operationalAdminCount > 1) {
                // When multiple operational admins exist, this admin is NOT exempt from threshold lockout.
                // Atomically update isLocked to true.
                const lockResult = await tx.user.updateMany({
                  where: { id: user.id, isLocked: false },
                  data: { isLocked: true },
                });
                if (lockResult.count === 0 && !current.isLocked) {
                  // If update failed to match because of concurrent state change, rollback transaction and fail-closed
                  throw new AppError('Xung đột cập nhật trạng thái khóa tài khoản', 409);
                }
                // Return outcome so transaction COMMITS successfully to PostgreSQL before router throws 403
                return {
                  status: 'LOCKED_THRESHOLD',
                  reason: 'Tài khoản đã bị tạm khóa do vi phạm chính sách bảo mật',
                };
              }

              // If operationalAdminCount <= 1:
              // Target is the last operational ADMIN! Lockout is suppressed.
              // Fall through to reset failedLoginAttempts to 0.
            }

            const updateResult = await tx.user.updateMany({
              where: {
                id: user.id,
                isLocked: false,
                isActive: true,
                passwordHash: user.passwordHash,
              },
              data: { failedLoginAttempts: 0 },
            });

            if (updateResult.count === 0) {
              throw new AppError('Tài khoản đã bị tạm khóa do vi phạm chính sách bảo mật', 403);
            }

            return { status: 'SUCCESS' };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          }
        );

        break;
      } catch (err: any) {
        if (err instanceof AppError) throw err;
        const isP2034 = Boolean(err && typeof err === 'object' && 'code' in err && err.code === 'P2034');
        if (isP2034 && attempt < 2) {
          continue;
        }
        throw err;
      }
    }

    if (!txOutcome) {
      throw new AppError('Xung đột cập nhật người dùng đồng thời; vui lòng thử lại sau', 409);
    }

    if (txOutcome.status === 'LOCKED_THRESHOLD') {
      throw new AppError(txOutcome.reason, 403);
    }

    // SEC-01: Include HMAC-SHA256 password tag for session invalidation on password change
    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      pwdTag: computePasswordTag(user.id, user.passwordHash),
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
