import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { sendSuccess } from '../../shared/response';
import { AppError } from '../../shared/AppError';
import { authenticate } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { UserRole } from '@prisma/client';

export const usersRouter = Router();

const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  studentOrStaffId: true,
  department: true,
  phoneNumber: true,
  isActive: true,
  isLocked: true,
  failedLoginAttempts: true,
  createdAt: true,
  updatedAt: true,
} as const;

const userIdSchema = z.string().uuid('ID người dùng không hợp lệ');

const createUserSchema = z.object({
  email: z.string().trim().email().max(254),
  fullName: z.string().trim().min(1).max(160),
  password: z.string().min(12).max(128),
  role: z.nativeEnum(UserRole),
  studentOrStaffId: z.string().trim().max(80).nullable().optional(),
  department: z.string().trim().max(160).nullable().optional(),
  phoneNumber: z.string().trim().max(40).nullable().optional(),
});

const updateUserSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  fullName: z.string().trim().min(1).max(160).optional(),
  role: z.nativeEnum(UserRole).optional(),
  studentOrStaffId: z.string().trim().max(80).nullable().optional(),
  department: z.string().trim().max(160).nullable().optional(),
  phoneNumber: z.string().trim().max(40).nullable().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Cần cung cấp ít nhất một trường để cập nhật',
});

const updateStatusSchema = z.object({
  isActive: z.boolean().optional(),
  isLocked: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Cần cung cấp isActive hoặc isLocked',
});

const resetPasswordSchema = z.object({
  password: z.string().min(12).max(128),
});

async function findRoleId(role: UserRole): Promise<string> {
  const roleRecord = await prisma.role.findUnique({ where: { name: role }, select: { id: true } });
  if (!roleRecord) {
    throw new AppError(`Vai trò ${role} chưa được khởi tạo trong database`, 409);
  }
  return roleRecord.id;
}

// Read access: administrators and lab managers can view the user directory.
// Password hashes are never selected or returned.
usersRouter.get(
  '/',
  authenticate,
  authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const users = await prisma.user.findMany({
        select: publicUserSelect,
        orderBy: { createdAt: 'asc' },
      });
      return sendSuccess(res, users, 'Danh sách người dùng từ Database');
    } catch (err) {
      next(err);
    }
  }
);

// All user mutations are restricted to ADMIN.
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

      const data = parsed.data;
      const roleId = await findRoleId(data.role);
      const passwordHash = await bcrypt.hash(data.password, 12);
      const user = await prisma.user.create({
        data: {
          email: data.email.toLowerCase(),
          fullName: data.fullName,
          passwordHash,
          role: data.role,
          roleId,
          studentOrStaffId: data.studentOrStaffId ?? null,
          department: data.department ?? null,
          phoneNumber: data.phoneNumber ?? null,
        },
        select: publicUserSelect,
      });
      return sendSuccess(res, user, 'Tạo người dùng thành công', 201);
    } catch (err) {
      next(err);
    }
  }
);

usersRouter.put(
  '/:id',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idParsed = userIdSchema.safeParse(req.params.id);
      const parsed = updateUserSchema.safeParse(req.body);
      if (!idParsed.success) throw new AppError('ID người dùng không hợp lệ', 422);
      if (!parsed.success) {
        throw new AppError('Dữ liệu cập nhật người dùng không hợp lệ', 422, parsed.error.errors);
      }

      const data = parsed.data;
      const updateData: Record<string, unknown> = { ...data };
      if (data.email) updateData.email = data.email.toLowerCase();
      if (data.role) updateData.roleId = await findRoleId(data.role);

      const user = await prisma.user.update({
        where: { id: idParsed.data },
        data: updateData,
        select: publicUserSelect,
      });
      return sendSuccess(res, user, 'Cập nhật người dùng thành công');
    } catch (err) {
      next(err);
    }
  }
);

usersRouter.patch(
  '/:id/status',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idParsed = userIdSchema.safeParse(req.params.id);
      const parsed = updateStatusSchema.safeParse(req.body);
      if (!idParsed.success) throw new AppError('ID người dùng không hợp lệ', 422);
      if (!parsed.success) {
        throw new AppError('Trạng thái tài khoản không hợp lệ', 422, parsed.error.errors);
      }

      if (
        idParsed.data === req.user?.id &&
        (parsed.data.isActive === false || parsed.data.isLocked === true)
      ) {
        throw new AppError('Không thể tự vô hiệu hóa hoặc khóa chính tài khoản đang đăng nhập', 400);
      }

      const user = await prisma.user.update({
        where: { id: idParsed.data },
        data: {
          ...parsed.data,
          ...(parsed.data.isLocked === false ? { failedLoginAttempts: 0 } : {}),
        },
        select: publicUserSelect,
      });
      return sendSuccess(res, user, 'Cập nhật trạng thái tài khoản thành công');
    } catch (err) {
      next(err);
    }
  }
);

usersRouter.post(
  '/:id/reset-password',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idParsed = userIdSchema.safeParse(req.params.id);
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!idParsed.success) throw new AppError('ID người dùng không hợp lệ', 422);
      if (!parsed.success) {
        throw new AppError('Mật khẩu mới không đáp ứng chính sách bảo mật', 422, parsed.error.errors);
      }

      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      await prisma.user.update({
        where: { id: idParsed.data },
        data: { passwordHash, failedLoginAttempts: 0, isLocked: false },
        select: { id: true },
      });
      return sendSuccess(res, { id: idParsed.data }, 'Đặt lại mật khẩu thành công');
    } catch (err) {
      next(err);
    }
  }
);
