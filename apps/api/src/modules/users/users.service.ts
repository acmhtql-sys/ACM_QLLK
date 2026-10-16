import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/AppError';
import { AuthenticatedUser } from '../../middleware/auth';
import {
  UserRole,
  UserSortField,
  SortOrder,
  UserResponse,
  PaginatedResponse,
  CreateUserInput,
  UpdateUserInput,
  UpdateUserStatusInput,
  ResetUserPasswordInput,
  QueryUsersInput,
} from '@acm/shared';

export interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

export function formatUserResponse(u: any): UserResponse {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    roleId: u.roleId,
    studentOrStaffId: u.studentOrStaffId ?? null,
    department: u.department ?? null,
    phoneNumber: u.phoneNumber ?? null,
    isActive: u.isActive,
    isLocked: u.isLocked,
    failedLoginAttempts: u.failedLoginAttempts ?? 0,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export class UsersService {
  /**
   * Retrieves paginated list of users with search, role, active, locked and department filters.
   * RBAC: Accessible by ADMIN and LAB_MANAGER.
   */
  async listUsers(
    query: QueryUsersInput,
    currentUser: AuthenticatedUser
  ): Promise<PaginatedResponse<UserResponse>> {
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.LAB_MANAGER) {
      throw new AppError('Bạn không có quyền truy cập danh sách người dùng', 403);
    }

    const where: Prisma.UserWhereInput = {};

    if (query.role) {
      where.role = query.role;
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.isLocked !== undefined) {
      where.isLocked = query.isLocked;
    }

    if (query.department) {
      where.department = { contains: query.department.trim(), mode: 'insensitive' };
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { studentOrStaffId: { contains: search, mode: 'insensitive' } },
        { department: { contains: search, mode: 'insensitive' } },
      ];
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const sortByField = query.sortBy || UserSortField.CREATED_AT;
    const sortOrderVal = query.sortOrder || SortOrder.DESC;

    const [totalItems, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortByField]: sortOrderVal },
      }),
    ]);

    const items = users.map((u) => formatUserResponse(u));
    const totalPages = Math.ceil(totalItems / limit) || 1;

    return {
      items,
      meta: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * Retrieves single user by ID.
   * RBAC: ADMIN, LAB_MANAGER, or the user themselves.
   */
  async getUserById(id: string, currentUser: AuthenticatedUser): Promise<UserResponse> {
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.LAB_MANAGER &&
      currentUser.id !== id
    ) {
      throw new AppError('Bạn không có quyền truy cập thông tin tài khoản này', 403);
    }

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new AppError('Người dùng không tồn tại', 404);
    }

    return formatUserResponse(user);
  }

  /**
   * Creates a new user account with hashed password and writes AuditLog.
   * RBAC: Strictly restricted to ADMIN.
   */
  async createUser(
    input: CreateUserInput,
    currentUser: AuthenticatedUser,
    meta?: RequestMetadata
  ): Promise<UserResponse> {
    if (currentUser.role !== UserRole.ADMIN) {
      throw new AppError('Chỉ Quản trị viên (ADMIN) mới có quyền tạo tài khoản người dùng', 403);
    }

    const normalizedEmail = input.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      throw new AppError('Email đã được sử dụng trong hệ thống', 409);
    }

    // Ensure matching role record exists
    let roleRecord = await prisma.role.findUnique({
      where: { name: input.role },
    });
    if (!roleRecord) {
      roleRecord = await prisma.role.create({
        data: { name: input.role, description: `Vai trò hệ thống ${input.role}` },
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(input.password, salt);

    return await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          fullName: input.fullName.trim(),
          role: input.role,
          roleId: roleRecord.id,
          studentOrStaffId: input.studentOrStaffId?.trim() || null,
          department: input.department?.trim() || null,
          phoneNumber: input.phoneNumber?.trim() || null,
          isActive: true,
          isLocked: false,
          failedLoginAttempts: 0,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'CREATE_USER',
          entity: 'User',
          entityId: created.id,
          oldValue: Prisma.DbNull,
          newValue: {
            email: created.email,
            fullName: created.fullName,
            role: created.role,
            studentOrStaffId: created.studentOrStaffId,
            department: created.department,
          },
          ipAddress: meta?.ipAddress || null,
          userAgent: meta?.userAgent || null,
        },
      });

      return formatUserResponse(created);
    });
  }

  /**
   * Updates user details with anti-privilege-escalation and self-demotion guards.
   */
  async updateUser(
    id: string,
    input: UpdateUserInput,
    currentUser: AuthenticatedUser,
    meta?: RequestMetadata
  ): Promise<UserResponse> {
    const targetUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!targetUser) {
      throw new AppError('Người dùng không tồn tại', 404);
    }

    // RBAC & Anti-privilege escalation
    if (currentUser.role !== UserRole.ADMIN) {
      if (currentUser.id !== id) {
        throw new AppError('Bạn chỉ có quyền cập nhật thông tin tài khoản của chính mình', 403);
      }
      if (input.role !== undefined) {
        throw new AppError('Chỉ Quản trị viên (ADMIN) mới có quyền thay đổi vai trò người dùng', 403);
      }
    } else {
      // Current user is ADMIN
      if (input.role !== undefined && input.role !== targetUser.role) {
        if (currentUser.id === id) {
          throw new AppError('Quản trị viên không thể tự thay đổi vai trò của chính mình', 400);
        }
        if (targetUser.role === UserRole.ADMIN) {
          const activeAdminCount = await prisma.user.count({
            where: { role: UserRole.ADMIN, isActive: true },
          });
          if (activeAdminCount <= 1) {
            throw new AppError('Không thể hạ quyền Quản trị viên cuối cùng của hệ thống', 400);
          }
        }
      }
    }

    // Resolve Role record if role is changing
    let newRoleId = targetUser.roleId;
    if (input.role && input.role !== targetUser.role) {
      let roleRecord = await prisma.role.findUnique({
        where: { name: input.role },
      });
      if (!roleRecord) {
        roleRecord = await prisma.role.create({
          data: { name: input.role, description: `Vai trò hệ thống ${input.role}` },
        });
      }
      newRoleId = roleRecord.id;
    }

    return await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          fullName: input.fullName !== undefined ? input.fullName.trim() : undefined,
          role: input.role !== undefined ? input.role : undefined,
          roleId: input.role !== undefined ? newRoleId : undefined,
          studentOrStaffId:
            input.studentOrStaffId !== undefined
              ? input.studentOrStaffId?.trim() || null
              : undefined,
          department:
            input.department !== undefined ? input.department?.trim() || null : undefined,
          phoneNumber:
            input.phoneNumber !== undefined ? input.phoneNumber?.trim() || null : undefined,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'UPDATE_USER',
          entity: 'User',
          entityId: id,
          oldValue: {
            fullName: targetUser.fullName,
            role: targetUser.role,
            studentOrStaffId: targetUser.studentOrStaffId,
            department: targetUser.department,
            phoneNumber: targetUser.phoneNumber,
          },
          newValue: {
            fullName: updated.fullName,
            role: updated.role,
            studentOrStaffId: updated.studentOrStaffId,
            department: updated.department,
            phoneNumber: updated.phoneNumber,
          },
          ipAddress: meta?.ipAddress || null,
          userAgent: meta?.userAgent || null,
        },
      });

      return formatUserResponse(updated);
    });
  }

  /**
   * Updates user active/locked status with strict last active admin lockout guards.
   * RBAC: Strictly restricted to ADMIN.
   */
  async updateUserStatus(
    id: string,
    input: UpdateUserStatusInput,
    currentUser: AuthenticatedUser,
    meta?: RequestMetadata
  ): Promise<UserResponse> {
    if (currentUser.role !== UserRole.ADMIN) {
      throw new AppError('Chỉ Quản trị viên (ADMIN) mới có quyền thay đổi trạng thái tài khoản', 403);
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!targetUser) {
      throw new AppError('Người dùng không tồn tại', 404);
    }

    // Anti-self-deactivation and anti-self-lockout
    if (currentUser.id === id) {
      if (input.isActive === false) {
        throw new AppError('Quản trị viên không thể tự vô hiệu hóa tài khoản của chính mình', 400);
      }
      if (input.isLocked === true) {
        throw new AppError('Quản trị viên không thể tự khóa tài khoản của chính mình', 400);
      }
    }

    // Last active admin protection
    if (
      targetUser.role === UserRole.ADMIN &&
      (input.isActive === false || input.isLocked === true)
    ) {
      const activeAdminCount = await prisma.user.count({
        where: { role: UserRole.ADMIN, isActive: true, isLocked: false },
      });
      if (activeAdminCount <= 1) {
        throw new AppError(
          'Không thể vô hiệu hóa hoặc khóa Quản trị viên hoạt động cuối cùng của hệ thống',
          400
        );
      }
    }

    const willUnlock = input.isLocked === false;

    return await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          isActive: input.isActive !== undefined ? input.isActive : undefined,
          isLocked: input.isLocked !== undefined ? input.isLocked : undefined,
          failedLoginAttempts: willUnlock ? 0 : undefined,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'UPDATE_USER_STATUS',
          entity: 'User',
          entityId: id,
          oldValue: {
            isActive: targetUser.isActive,
            isLocked: targetUser.isLocked,
          },
          newValue: {
            isActive: updated.isActive,
            isLocked: updated.isLocked,
            reason: input.reason || null,
          },
          ipAddress: meta?.ipAddress || null,
          userAgent: meta?.userAgent || null,
        },
      });

      return formatUserResponse(updated);
    });
  }

  /**
   * Resets user password, clears failed login attempts, unlocks account, and writes AuditLog.
   * RBAC: ADMIN can reset any user's password; non-admin can only reset their own.
   */
  async resetPassword(
    id: string,
    input: ResetUserPasswordInput,
    currentUser: AuthenticatedUser,
    meta?: RequestMetadata
  ): Promise<UserResponse> {
    if (currentUser.role !== UserRole.ADMIN && currentUser.id !== id) {
      throw new AppError('Bạn không có quyền đặt lại mật khẩu cho tài khoản này', 403);
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!targetUser) {
      throw new AppError('Người dùng không tồn tại', 404);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(input.newPassword, salt);

    return await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          isLocked: false,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'RESET_PASSWORD',
          entity: 'User',
          entityId: id,
          oldValue: Prisma.DbNull,
          newValue: {
            resetBy: currentUser.id,
            targetEmail: targetUser.email,
          },
          ipAddress: meta?.ipAddress || null,
          userAgent: meta?.userAgent || null,
        },
      });

      return formatUserResponse(updated);
    });
  }
}

export const usersService = new UsersService();
