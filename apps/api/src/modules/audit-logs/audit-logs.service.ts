import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/AppError';
import { AuthenticatedUser } from '../../middleware/auth';
import {
  UserRole,
  AuditLogSortField,
  SortOrder,
  AuditLogResponse,
  PaginatedResponse,
  QueryAuditLogsInput,
} from '@acm/shared';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'newpassword',
  'oldpassword',
  'token',
  'jwt',
  'secret',
  'authorization',
  'bearer',
]);

/**
 * Deeply sanitizes objects and arrays, replacing any sensitive fields (passwords, tokens, secrets)
 * with '[REDACTED]' to ensure data privacy and prevent credential leakage in audit logs.
 */
export function sanitizeAuditData(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // If string itself looks like a JWT or Bearer token, redact it
    if (data.startsWith('Bearer ') || data.startsWith('eyJhbGciOi')) {
      return '[REDACTED_TOKEN]';
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeAuditData(item));
  }

  if (typeof data === 'object') {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeAuditData(value);
      }
    }
    return sanitized;
  }

  return data;
}

export function formatAuditLogResponse(log: any): AuditLogResponse {
  return {
    id: log.id,
    userId: log.userId ?? null,
    user: log.user
      ? {
          id: log.user.id,
          fullName: log.user.fullName,
          email: log.user.email,
          role: log.user.role,
        }
      : null,
    action: log.action,
    entity: log.entity,
    entityId: log.entityId,
    oldValue: sanitizeAuditData(log.oldValue),
    newValue: sanitizeAuditData(log.newValue),
    ipAddress: log.ipAddress ?? null,
    userAgent: log.userAgent ?? null,
    createdAt: log.createdAt,
  };
}

export class AuditLogsService {
  /**
   * Lists audit logs with advanced filtering, full sanitization and pagination.
   * RBAC: Restricted to ADMIN only (same policy as the API router).
   */
  async listAuditLogs(
    query: QueryAuditLogsInput,
    currentUser: AuthenticatedUser
  ): Promise<PaginatedResponse<AuditLogResponse>> {
    if (currentUser.role !== UserRole.ADMIN) {
      throw new AppError('Bạn không có quyền truy cập nhật ký kiểm toán hệ thống', 403);
    }

    const where: Prisma.AuditLogWhereInput = {};

    if (query.action) {
      where.action = { equals: query.action.trim(), mode: 'insensitive' };
    }

    if (query.entity) {
      where.entity = { equals: query.entity.trim(), mode: 'insensitive' };
    }

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        if (query.endDate.length === 10) {
          end.setHours(23, 59, 59, 999);
        }
        where.createdAt.lte = end;
      }
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { entity: { contains: search, mode: 'insensitive' } },
        { entityId: { contains: search, mode: 'insensitive' } },
        { user: { fullName: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const sortByField = query.sortBy || AuditLogSortField.CREATED_AT;
    const sortOrderVal = query.sortOrder || SortOrder.DESC;

    const [totalItems, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortByField]: sortOrderVal },
        include: {
          user: {
            select: { id: true, fullName: true, email: true, role: true },
          },
        },
      }),
    ]);

    const items = logs.map((l) => formatAuditLogResponse(l));
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
   * Retrieves single audit log by ID with sanitized details.
   */
  async getAuditLogById(id: string, currentUser: AuthenticatedUser): Promise<AuditLogResponse> {
    if (currentUser.role !== UserRole.ADMIN) {
      throw new AppError('Bạn không có quyền truy cập nhật ký kiểm toán hệ thống', 403);
    }

    const log = await prisma.auditLog.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, fullName: true, email: true, role: true },
        },
      },
    });

    if (!log) {
      throw new AppError('Bản ghi nhật ký kiểm toán không tồn tại', 404);
    }

    return formatAuditLogResponse(log);
  }
}

export const auditLogsService = new AuditLogsService();
