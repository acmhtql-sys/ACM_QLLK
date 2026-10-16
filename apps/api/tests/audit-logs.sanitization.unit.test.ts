import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole, AuditLogSortField, SortOrder } from '@acm/shared';
import {
  auditLogsService,
  sanitizeAuditData,
  formatAuditLogResponse,
} from '../src/modules/audit-logs/audit-logs.service';
import { prisma } from '../src/config/database';
import { AppError } from '../src/shared/AppError';

vi.mock('../src/config/database', () => ({
  prisma: {
    auditLog: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe('Phase 6 – Audit Log & Credential Sanitization Unit Tests', () => {
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
    fullName: 'Sinh Viên',
    role: UserRole.STUDENT,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sanitizeAuditData', () => {
    it('redacts password and passwordHash fields', () => {
      const sensitiveInput = {
        email: 'user@acm.local',
        password: 'PlainSecretPassword123!',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz123456',
        fullName: 'Nguyễn Văn A',
      };

      const sanitized = sanitizeAuditData(sensitiveInput);

      expect(sanitized.email).toBe('user@acm.local');
      expect(sanitized.fullName).toBe('Nguyễn Văn A');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.passwordHash).toBe('[REDACTED]');
    });

    it('redacts newPassword, oldPassword, token, jwt, secret, authorization fields', () => {
      const sensitiveInput = {
        action: 'RESET_PASSWORD',
        newPassword: 'MyNewPassword@2026',
        oldPassword: 'OldPassword@2025',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        jwt: 'jwt_string_value',
        secret: 'api_secret_key_123',
        authorization: 'Bearer eyJhbGciOi...',
      };

      const sanitized = sanitizeAuditData(sensitiveInput);

      expect(sanitized.action).toBe('RESET_PASSWORD');
      expect(sanitized.newPassword).toBe('[REDACTED]');
      expect(sanitized.oldPassword).toBe('[REDACTED]');
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.jwt).toBe('[REDACTED]');
      expect(sanitized.secret).toBe('[REDACTED]');
      expect(sanitized.authorization).toBe('[REDACTED]');
    });

    it('recursively redacts nested objects and arrays without mutating other keys', () => {
      const deeplyNested = {
        entity: 'User',
        changes: {
          user: {
            email: 'admin@acm.local',
            credentials: {
              password: 'super_secret_password',
            },
          },
          items: [
            { id: 1, name: 'Normal Item' },
            { id: 2, token: 'secret_token_in_array' },
          ],
        },
      };

      const sanitized = sanitizeAuditData(deeplyNested);

      expect(sanitized.entity).toBe('User');
      expect(sanitized.changes.user.email).toBe('admin@acm.local');
      expect(sanitized.changes.user.credentials.password).toBe('[REDACTED]');
      expect(sanitized.changes.items[0].name).toBe('Normal Item');
      expect(sanitized.changes.items[1].token).toBe('[REDACTED]');
    });

    it('redacts raw Bearer token and JWT strings', () => {
      expect(sanitizeAuditData('Bearer secret_bearer_token')).toBe('[REDACTED_TOKEN]');
      expect(sanitizeAuditData('eyJhbGciOiJIUzI1Ni...')).toBe('[REDACTED_TOKEN]');
      expect(sanitizeAuditData('Normal log message')).toBe('Normal log message');
      expect(sanitizeAuditData(null)).toBe(null);
      expect(sanitizeAuditData(undefined)).toBe(undefined);
    });
  });

  describe('formatAuditLogResponse', () => {
    it('formats audit log record and sanitizes oldValue and newValue', () => {
      const rawLog = {
        id: 'audit-uuid-001',
        userId: adminUser.id,
        user: adminUser,
        action: 'UPDATE_USER',
        entity: 'User',
        entityId: 'user-002',
        oldValue: { fullName: 'Old Name', passwordHash: 'hash_old' },
        newValue: { fullName: 'New Name', passwordHash: 'hash_new' },
        ipAddress: '192.168.1.50',
        userAgent: 'Mozilla/5.0 Chrome',
        createdAt: new Date('2026-03-01'),
      };

      const formatted = formatAuditLogResponse(rawLog);

      expect(formatted.id).toBe('audit-uuid-001');
      expect(formatted.user?.fullName).toBe('Quản Trị Viên');
      expect(formatted.oldValue.fullName).toBe('Old Name');
      expect(formatted.oldValue.passwordHash).toBe('[REDACTED]');
      expect(formatted.newValue.fullName).toBe('New Name');
      expect(formatted.newValue.passwordHash).toBe('[REDACTED]');
      expect(formatted.ipAddress).toBe('192.168.1.50');
    });
  });

  describe('listAuditLogs & RBAC', () => {
    const mockAuditRecord = {
      id: 'log-uuid-1',
      userId: adminUser.id,
      user: adminUser,
      action: 'CREATE_ITEM',
      entity: 'Item',
      entityId: 'item-001',
      oldValue: null,
      newValue: { code: 'ESP32', name: 'ESP32 DevKit' },
      ipAddress: '127.0.0.1',
      userAgent: 'PostmanRuntime',
      createdAt: new Date('2026-03-01T10:00:00Z'),
    };

    it('allows ADMIN to list audit logs with default pagination', async () => {
      vi.mocked(prisma.auditLog.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([mockAuditRecord as any]);

      const result = await auditLogsService.listAuditLogs({}, adminUser as any);

      expect(result.items).toHaveLength(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.totalItems).toBe(1);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: { [AuditLogSortField.CREATED_AT]: SortOrder.DESC },
        })
      );
    });

    it('allows LAB_MANAGER to list audit logs', async () => {
      vi.mocked(prisma.auditLog.count).mockResolvedValueOnce(0);
      vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([]);

      const result = await auditLogsService.listAuditLogs({}, managerUser as any);
      expect(result.items).toHaveLength(0);
    });

    it('rejects STUDENT with 403 Forbidden', async () => {
      await expect(
        auditLogsService.listAuditLogs({}, studentUser as any)
      ).rejects.toThrow(
        new AppError('Bạn không có quyền truy cập nhật ký kiểm toán hệ thống', 403)
      );
    });

    it('applies action, entity, date range and search filters', async () => {
      vi.mocked(prisma.auditLog.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([mockAuditRecord as any]);

      await auditLogsService.listAuditLogs(
        {
          action: 'CREATE_ITEM',
          entity: 'Item',
          userId: adminUser.id,
          startDate: '2026-03-01',
          endDate: '2026-03-05',
          search: 'ESP32',
          sortBy: AuditLogSortField.ACTION,
          sortOrder: SortOrder.ASC,
          page: 2,
          limit: 10,
        },
        adminUser as any
      );

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action: { equals: 'CREATE_ITEM', mode: 'insensitive' },
            entity: { equals: 'Item', mode: 'insensitive' },
            userId: adminUser.id,
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
            OR: expect.arrayContaining([
              { action: { contains: 'ESP32', mode: 'insensitive' } },
            ]),
          }),
          skip: 10,
          take: 10,
          orderBy: { [AuditLogSortField.ACTION]: SortOrder.ASC },
        })
      );
    });
  });

  describe('getAuditLogById', () => {
    it('returns sanitized single audit log by ID', async () => {
      const mockRecord = {
        id: 'log-uuid-99',
        userId: adminUser.id,
        user: adminUser,
        action: 'RESET_PASSWORD',
        entity: 'User',
        entityId: 'target-user-id',
        oldValue: null,
        newValue: { targetEmail: 'target@acm.local', newPassword: 'SuperSecret123!' },
        ipAddress: '10.0.0.1',
        userAgent: 'Chrome',
        createdAt: new Date(),
      };

      vi.mocked(prisma.auditLog.findUnique).mockResolvedValueOnce(mockRecord as any);

      const result = await auditLogsService.getAuditLogById('log-uuid-99', adminUser as any);

      expect(result.id).toBe('log-uuid-99');
      expect(result.action).toBe('RESET_PASSWORD');
      expect(result.newValue.targetEmail).toBe('target@acm.local');
      expect(result.newValue.newPassword).toBe('[REDACTED]');
    });

    it('throws 404 when audit log not found', async () => {
      vi.mocked(prisma.auditLog.findUnique).mockResolvedValueOnce(null);

      await expect(
        auditLogsService.getAuditLogById('non-existent-log', adminUser as any)
      ).rejects.toThrow(
        new AppError('Bản ghi nhật ký kiểm toán không tồn tại', 404)
      );
    });
  });
});
