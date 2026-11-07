import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { sendSuccess } from '../../shared/response';
import { AppError } from '../../shared/AppError';
import { authenticate } from '../../middleware/auth';
import { authorizeRoles } from '../../middleware/rbac';
import { UserRole } from '@prisma/client';
import { updateUserWithAudit, updateUserStatusWithAudit, resetUserPasswordWithAudit } from './users.mutation.service';

export const usersRouter = Router();

const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  studentOrStaffId: true,
  department: true,
  isActive: true,
  isLocked: true,
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
        throw new AppError('Dữ liệu tạo người dùng không hợp lệ', 422, parsed.error.issues);
      }

      const data = parsed.data;
      const roleId = await findRoleId(data.role);
      const passwordHash = await bcrypt.hash(data.password, 12);
      const user = await prisma.$transaction(async (tx) => {
        // SEC-07: Revalidate actor within the transaction
        const actor = await tx.user.findUnique({
          where: { id: req.user!.id },
          select: { role: true, isActive: true, isLocked: true },
        });
        if (!actor || actor.role !== UserRole.ADMIN || !actor.isActive || actor.isLocked) {
          throw new AppError('Tài khoản thực hiện không có quyền quản trị viên hợp lệ', 403);
        }

        const created = await tx.user.create({
          data: {
            email: data.email.toLowerCase(), fullName: data.fullName,
            passwordHash, role: data.role, roleId,
            studentOrStaffId: data.studentOrStaffId ?? null,
            department: data.department ?? null, phoneNumber: data.phoneNumber ?? null,
          },
          select: publicUserSelect,
        });
        await tx.auditLog.create({ data: {
          userId: req.user!.id, action: 'CREATE', entity: 'User', entityId: created.id,
          newValue: {
            email: created.email, fullName: created.fullName, role: created.role,
            isActive: created.isActive, isLocked: created.isLocked,
          },
        } });
        return created;
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
        throw new AppError('Dữ liệu cập nhật người dùng không hợp lệ', 422, parsed.error.issues);
      }

      const user = await updateUserWithAudit(idParsed.data, req.user!.id, parsed.data);
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
        throw new AppError('Trạng thái tài khoản không hợp lệ', 422, parsed.error.issues);
      }

      const user = await updateUserStatusWithAudit(idParsed.data, req.user!.id, parsed.data);
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
        throw new AppError('Mật khẩu mới không đáp ứng chính sách bảo mật', 422, parsed.error.issues);
      }

      const result = await resetUserPasswordWithAudit(idParsed.data, req.user!.id, parsed.data.password);
      return sendSuccess(res, result, 'Đặt lại mật khẩu thành công');
    } catch (err) {
      next(err);
    }
  }
);
