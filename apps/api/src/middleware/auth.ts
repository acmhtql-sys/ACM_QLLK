import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { AppError } from '../shared/AppError';
import { UserRole } from '@prisma/client';
import { computePasswordTag, verifyPasswordTag } from '../modules/auth/auth.security';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Mandatory authentication middleware.
 * Verifies JWT signature & expiration, validates active/locked status,
 * enforces cryptographically bound pwdTag (SEC-01 session invalidation on password change),
 * applies live database role (overriding any stale token role),
 * and strictly distinguishes token errors (401) from database connection errors (500).
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Yêu cầu xác thực (Bearer Token không hợp lệ)', 401));
  }

  const token = authHeader.split(' ')[1];

  let decoded: any;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET);
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return next(new AppError('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại', 401));
    }
    return next(new AppError('Mã xác thực không hợp lệ', 401));
  }

  if (
    !decoded ||
    typeof decoded !== 'object' ||
    typeof decoded.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded.id)
  ) {
    return next(new AppError('Mã xác thực không hợp lệ: thiếu thông tin định danh', 401));
  }

  let user;
  try {
    user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        role: true,
        fullName: true,
        isActive: true,
        isLocked: true,
        passwordHash: true,
      },
    });
  } catch (dbErr: any) {
    logger.error('Database connection error during user authentication:', dbErr);
    // CRITICAL: Distinguish database connection/query errors from invalid token errors
    return next(new AppError('Lỗi kết nối cơ sở dữ liệu khi xác thực người dùng', 500));
  }

  if (!user) {
    return next(new AppError('Tài khoản không tồn tại hoặc đã bị xóa khỏi hệ thống', 401));
  }

  if (!user.isActive) {
    return next(new AppError('Tài khoản đã bị vô hiệu hóa, vui lòng liên hệ quản trị viên', 403));
  }

  if (user.isLocked) {
    return next(new AppError('Tài khoản đã bị tạm khóa do vi phạm chính sách bảo mật', 403));
  }

  // SEC-01: Invalidate JWT session if password has changed or pwdTag claim is missing/invalid
  const expectedPwdTag = computePasswordTag(user.id, user.passwordHash);
  if (!verifyPasswordTag(expectedPwdTag, decoded.pwdTag)) {
    return next(
      new AppError('Phiên đăng nhập đã hết hiệu lực do mật khẩu đã thay đổi, vui lòng đăng nhập lại', 401)
    );
  }

  // Use current role and attributes from database (stale role in token payload is overridden)
  req.user = {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
  };

  next();
}

/**
 * Optional authentication middleware.
 * If token is present, verifies token and attaches active user if valid.
 * Does not reject unauthenticated requests.
 */
export async function authenticateOptional(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];

  let decoded: any;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET);
  } catch (_err) {
    // If optional token is invalid or expired, proceed unauthenticated
    return next();
  }

  if (
    !decoded ||
    typeof decoded !== 'object' ||
    typeof decoded.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded.id)
  ) {
    return next();
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        role: true,
        fullName: true,
        isActive: true,
        isLocked: true,
        passwordHash: true,
      },
    });

    if (user && user.isActive && !user.isLocked) {
      const expectedPwdTag = computePasswordTag(user.id, user.passwordHash);
      if (verifyPasswordTag(expectedPwdTag, decoded.pwdTag)) {
        req.user = {
          id: user.id,
          email: user.email,
          role: user.role,
          fullName: user.fullName,
        };
      }
    }
  } catch (dbErr) {
    logger.error('Database error during authenticateOptional:', dbErr);
    return next(new AppError('Lỗi kết nối cơ sở dữ liệu khi xác thực người dùng', 500));
  }

  next();
}

/**
 * Prevent unauthenticated catalog and stock reads in Cloud Staging.
 * Non-staging environments retain existing optional-auth catalog behavior.
 */
export async function authenticateCatalogInStaging(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const profile = process.env.ACM_DEPLOYMENT_PROFILE ?? env.ACM_DEPLOYMENT_PROFILE;
  if (profile === 'cloud_staging') {
    return authenticate(req, res, next);
  }
  return authenticateOptional(req, res, next);
}
