import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { UserRole, UserSortField, SortOrder } from '@acm/shared';
import { usersService, formatUserResponse } from '../src/modules/users/users.service';
import { prisma } from '../src/config/database';
import { AppError } from '../src/shared/AppError';

vi.mock('../src/config/database', () => {
  const mockTx = {
    user: {
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };

  return {
    prisma: {
      user: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      role: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(mockTx)),
      __mockTx: mockTx,
    },
  };
});

describe('Phase 5 – User Management & Anti-Privilege Escalation Unit Tests', () => {
  const adminUser = {
    id: 'admin-uuid-001',
    email: 'admin@acm.local',
    fullName: 'Quản Trị Viên',
    role: UserRole.ADMIN,
  };

  const managerUser = {
    id: 'manager-uuid-002',
    email: 'manager@acm.local',
    fullName: 'Quản Lý Lab',
    role: UserRole.LAB_MANAGER,
  };

  const studentUser = {
    id: 'student-uuid-003',
    email: 'student@acm.local',
    fullName: 'Sinh Viên A',
    role: UserRole.STUDENT,
  };

  const targetStudent = {
    id: 'student-uuid-004',
    email: 'target.student@acm.local',
    passwordHash: '$2a$10$hashedpassword',
    fullName: 'Sinh Viên Mục Tiêu',
    roleId: 'role-student-uuid',
    role: UserRole.STUDENT,
    studentOrStaffId: 'SV-2026-001',
    department: 'Khoa Điện - Điện tử',
    phoneNumber: '0901234567',
    isActive: true,
    isLocked: false,
    failedLoginAttempts: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatUserResponse', () => {
    it('formats user record into UserResponse without sensitive passwordHash', () => {
      const formatted = formatUserResponse(targetStudent);
      expect(formatted.id).toBe(targetStudent.id);
      expect(formatted.email).toBe(targetStudent.email);
      expect(formatted.fullName).toBe(targetStudent.fullName);
      expect(formatted.role).toBe(UserRole.STUDENT);
      expect((formatted as any).passwordHash).toBeUndefined();
    });
  });

  describe('listUsers', () => {
    it('allows ADMIN to list users with default pagination', async () => {
      vi.mocked(prisma.user.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.user.findMany).mockResolvedValueOnce([targetStudent as any]);

      const result = await usersService.listUsers({}, adminUser as any);

      expect(result.items).toHaveLength(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.totalItems).toBe(1);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: { [UserSortField.CREATED_AT]: SortOrder.DESC },
        })
      );
    });

    it('allows LAB_MANAGER to list users', async () => {
      vi.mocked(prisma.user.count).mockResolvedValueOnce(0);
      vi.mocked(prisma.user.findMany).mockResolvedValueOnce([]);

      const result = await usersService.listUsers({}, managerUser as any);
      expect(result.items).toHaveLength(0);
    });

    it('rejects STUDENT with 403 Forbidden', async () => {
      await expect(usersService.listUsers({}, studentUser as any)).rejects.toThrow(
        new AppError('Bạn không có quyền truy cập danh sách người dùng', 403)
      );
    });

    it('applies search and filtering parameters', async () => {
      vi.mocked(prisma.user.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.user.findMany).mockResolvedValueOnce([targetStudent as any]);

      await usersService.listUsers(
        {
          search: 'Điện tử',
          role: UserRole.STUDENT,
          isActive: true,
          isLocked: false,
          department: 'Điện',
          sortBy: UserSortField.FULL_NAME,
          sortOrder: SortOrder.ASC,
          page: 2,
          limit: 10,
        },
        adminUser as any
      );

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: UserRole.STUDENT,
            isActive: true,
            isLocked: false,
            department: { contains: 'Điện', mode: 'insensitive' },
            OR: expect.arrayContaining([
              { fullName: { contains: 'Điện tử', mode: 'insensitive' } },
            ]),
          }),
          skip: 10,
          take: 10,
          orderBy: { [UserSortField.FULL_NAME]: SortOrder.ASC },
        })
      );
    });
  });

  describe('getUserById', () => {
    it('allows ADMIN to view any user', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(targetStudent as any);

      const result = await usersService.getUserById(targetStudent.id, adminUser as any);
      expect(result.id).toBe(targetStudent.id);
    });

    it('allows user to view their own profile', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(targetStudent as any);

      const result = await usersService.getUserById(
        targetStudent.id,
        { id: targetStudent.id, role: UserRole.STUDENT } as any
      );
      expect(result.id).toBe(targetStudent.id);
    });

    it('rejects user attempting to view another profile with 403 Forbidden', async () => {
      await expect(
        usersService.getUserById(targetStudent.id, studentUser as any)
      ).rejects.toThrow(
        new AppError('Bạn không có quyền truy cập thông tin tài khoản này', 403)
      );
    });

    it('throws 404 when user does not exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      await expect(usersService.getUserById('non-existent-id', adminUser as any)).rejects.toThrow(
        new AppError('Người dùng không tồn tại', 404)
      );
    });
  });

  describe('createUser', () => {
    it('rejects non-admin from creating users with 403 Forbidden', async () => {
      await expect(
        usersService.createUser(
          {
            email: 'new@acm.local',
            password: 'Password@123',
            fullName: 'Người Dùng Mới',
            role: UserRole.STUDENT,
          },
          managerUser as any
        )
      ).rejects.toThrow(
        new AppError('Chỉ Quản trị viên (ADMIN) mới có quyền tạo tài khoản người dùng', 403)
      );
    });

    it('rejects duplicate email with 409 Conflict', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(targetStudent as any);

      await expect(
        usersService.createUser(
          {
            email: targetStudent.email,
            password: 'Password@123',
            fullName: 'Người Dùng Trùng',
            role: UserRole.STUDENT,
          },
          adminUser as any
        )
      ).rejects.toThrow(new AppError('Email đã được sử dụng trong hệ thống', 409));
    });

    it('hashes password and creates user with AuditLog inside transaction', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({
        id: 'role-tech-uuid',
        name: UserRole.TECHNICIAN,
      } as any);

      const mockTx = (prisma as any).__mockTx;
      mockTx.user.create.mockResolvedValueOnce({
        id: 'new-user-uuid',
        email: 'tech@acm.local',
        passwordHash: 'bcrypt_hashed_pass',
        fullName: 'Kỹ Thuật Viên Mới',
        role: UserRole.TECHNICIAN,
        roleId: 'role-tech-uuid',
        studentOrStaffId: 'KTV-001',
        department: 'Lab IoT',
        phoneNumber: null,
        isActive: true,
        isLocked: false,
        failedLoginAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await usersService.createUser(
        {
          email: 'tech@acm.local',
          password: 'SecurePass@123',
          fullName: 'Kỹ Thuật Viên Mới',
          role: UserRole.TECHNICIAN,
          studentOrStaffId: 'KTV-001',
          department: 'Lab IoT',
        },
        adminUser as any,
        { ipAddress: '127.0.0.1' }
      );

      expect(result.id).toBe('new-user-uuid');
      expect(result.role).toBe(UserRole.TECHNICIAN);
      expect(mockTx.user.create).toHaveBeenCalled();
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: adminUser.id,
            action: 'CREATE_USER',
            entity: 'User',
            entityId: 'new-user-uuid',
            ipAddress: '127.0.0.1',
          }),
        })
      );
    });
  });

  describe('updateUser & Anti-Privilege Escalation', () => {
    it('allows a user to update their own basic profile', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(targetStudent as any);

      const mockTx = (prisma as any).__mockTx;
      mockTx.user.update.mockResolvedValueOnce({
        ...targetStudent,
        fullName: 'Sinh Viên Tên Mới',
        phoneNumber: '0988888888',
      });

      const result = await usersService.updateUser(
        targetStudent.id,
        {
          fullName: 'Sinh Viên Tên Mới',
          phoneNumber: '0988888888',
        },
        { id: targetStudent.id, role: UserRole.STUDENT } as any
      );

      expect(result.fullName).toBe('Sinh Viên Tên Mới');
      expect(result.phoneNumber).toBe('0988888888');
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'UPDATE_USER',
            entityId: targetStudent.id,
          }),
        })
      );
    });

    it('rejects non-admin attempting to update another user profile with 403', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(targetStudent as any);

      await expect(
        usersService.updateUser(
          targetStudent.id,
          { fullName: 'Tên Hacker' },
          studentUser as any
        )
      ).rejects.toThrow(
        new AppError('Bạn chỉ có quyền cập nhật thông tin tài khoản của chính mình', 403)
      );
    });

    it('rejects non-admin attempting to elevate their own role with 403 Forbidden', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(targetStudent as any);

      await expect(
        usersService.updateUser(
          targetStudent.id,
          { role: UserRole.ADMIN },
          { id: targetStudent.id, role: UserRole.STUDENT } as any
        )
      ).rejects.toThrow(
        new AppError('Chỉ Quản trị viên (ADMIN) mới có quyền thay đổi vai trò người dùng', 403)
      );
    });

    it('rejects ADMIN attempting to change their own role with 400 Bad Request', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        ...adminUser,
        roleId: 'role-admin-uuid',
      } as any);

      await expect(
        usersService.updateUser(
          adminUser.id,
          { role: UserRole.STUDENT },
          adminUser as any
        )
      ).rejects.toThrow(
        new AppError('Quản trị viên không thể tự thay đổi vai trò của chính mình', 400)
      );
    });

    it('rejects demoting the last active ADMIN in the system with 400 Bad Request', async () => {
      const anotherAdmin = {
        id: 'admin-uuid-002',
        email: 'admin2@acm.local',
        role: UserRole.ADMIN,
        roleId: 'role-admin-uuid',
      };
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(anotherAdmin as any);
      vi.mocked(prisma.user.count).mockResolvedValueOnce(1); // Only 1 active admin!

      await expect(
        usersService.updateUser(
          anotherAdmin.id,
          { role: UserRole.LAB_MANAGER },
          adminUser as any
        )
      ).rejects.toThrow(
        new AppError('Không thể hạ quyền Quản trị viên cuối cùng của hệ thống', 400)
      );
    });

    it('allows ADMIN to update another user role when multiple admins exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(targetStudent as any);
      vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({
        id: 'role-mgr-uuid',
        name: UserRole.LAB_MANAGER,
      } as any);

      const mockTx = (prisma as any).__mockTx;
      mockTx.user.update.mockResolvedValueOnce({
        ...targetStudent,
        role: UserRole.LAB_MANAGER,
        roleId: 'role-mgr-uuid',
      });

      const result = await usersService.updateUser(
        targetStudent.id,
        { role: UserRole.LAB_MANAGER },
        adminUser as any
      );

      expect(result.role).toBe(UserRole.LAB_MANAGER);
      expect(mockTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: UserRole.LAB_MANAGER,
            roleId: 'role-mgr-uuid',
          }),
        })
      );
    });
  });

  describe('updateUserStatus', () => {
    it('rejects non-admin from updating status with 403 Forbidden', async () => {
      await expect(
        usersService.updateUserStatus(
          targetStudent.id,
          { isActive: false },
          managerUser as any
        )
      ).rejects.toThrow(
        new AppError('Chỉ Quản trị viên (ADMIN) mới có quyền thay đổi trạng thái tài khoản', 403)
      );
    });

    it('rejects ADMIN from deactivating themselves with 400 Bad Request', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(adminUser as any);

      await expect(
        usersService.updateUserStatus(
          adminUser.id,
          { isActive: false },
          adminUser as any
        )
      ).rejects.toThrow(
        new AppError('Quản trị viên không thể tự vô hiệu hóa tài khoản của chính mình', 400)
      );
    });

    it('rejects ADMIN from locking themselves with 400 Bad Request', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(adminUser as any);

      await expect(
        usersService.updateUserStatus(
          adminUser.id,
          { isLocked: true },
          adminUser as any
        )
      ).rejects.toThrow(
        new AppError('Quản trị viên không thể tự khóa tài khoản của chính mình', 400)
      );
    });

    it('rejects deactivating or locking the last active ADMIN', async () => {
      const anotherAdmin = {
        id: 'admin-uuid-002',
        role: UserRole.ADMIN,
        isActive: true,
        isLocked: false,
      };
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(anotherAdmin as any);
      vi.mocked(prisma.user.count).mockResolvedValueOnce(1); // Only 1 active admin!

      await expect(
        usersService.updateUserStatus(
          anotherAdmin.id,
          { isActive: false },
          adminUser as any
        )
      ).rejects.toThrow(
        new AppError(
          'Không thể vô hiệu hóa hoặc khóa Quản trị viên hoạt động cuối cùng của hệ thống',
          400
        )
      );
    });

    it('successfully locks a user and records AuditLog', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(targetStudent as any);

      const mockTx = (prisma as any).__mockTx;
      mockTx.user.update.mockResolvedValueOnce({
        ...targetStudent,
        isLocked: true,
      });

      const result = await usersService.updateUserStatus(
        targetStudent.id,
        { isLocked: true, reason: 'Nghi vấn xâm phạm tài khoản' },
        adminUser as any
      );

      expect(result.isLocked).toBe(true);
      expect(mockTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isLocked: true }),
        })
      );
      expect(mockTx.auditLog.create).toHaveBeenCalled();
    });

    it('resets failedLoginAttempts to 0 when unlocking an account', async () => {
      const lockedStudent = { ...targetStudent, isLocked: true, failedLoginAttempts: 5 };
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(lockedStudent as any);

      const mockTx = (prisma as any).__mockTx;
      mockTx.user.update.mockResolvedValueOnce({
        ...lockedStudent,
        isLocked: false,
        failedLoginAttempts: 0,
      });

      const result = await usersService.updateUserStatus(
        lockedStudent.id,
        { isLocked: false },
        adminUser as any
      );

      expect(result.isLocked).toBe(false);
      expect(result.failedLoginAttempts).toBe(0);
      expect(mockTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isLocked: false, failedLoginAttempts: 0 }),
        })
      );
    });
  });

  describe('resetPassword', () => {
    it('allows ADMIN to reset any user password', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(targetStudent as any);

      const mockTx = (prisma as any).__mockTx;
      mockTx.user.update.mockResolvedValueOnce({
        ...targetStudent,
        isLocked: false,
        failedLoginAttempts: 0,
      });

      const result = await usersService.resetPassword(
        targetStudent.id,
        { newPassword: 'NewSecurePass@2026' },
        adminUser as any
      );

      expect(result.id).toBe(targetStudent.id);
      expect(mockTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            failedLoginAttempts: 0,
            isLocked: false,
          }),
        })
      );
      // Ensure plaintext password is NOT recorded in audit log
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'RESET_PASSWORD',
            newValue: expect.not.objectContaining({ password: expect.anything() }),
          }),
        })
      );
    });

    it('allows a user to reset their own password', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(targetStudent as any);

      const mockTx = (prisma as any).__mockTx;
      mockTx.user.update.mockResolvedValueOnce(targetStudent as any);

      const result = await usersService.resetPassword(
        targetStudent.id,
        { newPassword: 'SelfResetPass@123' },
        { id: targetStudent.id, role: UserRole.STUDENT } as any
      );

      expect(result.id).toBe(targetStudent.id);
    });

    it('rejects third-party user from resetting password with 403 Forbidden', async () => {
      await expect(
        usersService.resetPassword(
          targetStudent.id,
          { newPassword: 'HackedPass@123' },
          studentUser as any
        )
      ).rejects.toThrow(
        new AppError('Bạn không có quyền đặt lại mật khẩu cho tài khoản này', 403)
      );
    });
  });
});
