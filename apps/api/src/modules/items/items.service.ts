import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/AppError';
import { AuthenticatedUser } from '../../middleware/auth';
import {
  CreateItemInput,
  UpdateItemInput,
  UpdateItemStatusInput,
  QueryItemsInput,
  ItemResponse,
  PaginationMeta,
  UserRole,
  ItemSortField,
  SortOrder,
  calculateAvailableStock,
  isLowStock,
  getItemStockStatus,
  StockStatus,
} from '@acm/shared';

export interface FormattedItemWithCompat extends ItemResponse {
  categoryName?: string;
}

/**
 * Transforms raw database item record into ItemResponse DTO
 */
export function formatItemResponse(item: any): FormattedItemWithCompat {
  const stockBalances = item.stockBalances || [];
  const totalOnHand = stockBalances.reduce((sum: number, b: any) => sum + (b.onHand || 0), 0);
  const totalReserved = stockBalances.reduce((sum: number, b: any) => sum + (b.reserved || 0), 0);
  const totalQuarantined = stockBalances.reduce((sum: number, b: any) => sum + (b.quarantined || 0), 0);
  const totalKitAllocated = stockBalances.reduce((sum: number, b: any) => sum + (b.kitAllocated || 0), 0);
  const totalBorrowed = stockBalances.reduce((sum: number, b: any) => sum + (b.borrowed || 0), 0);

  const available = calculateAvailableStock({
    onHand: totalOnHand,
    reserved: totalReserved,
    quarantined: totalQuarantined,
    kitAllocated: totalKitAllocated,
    borrowed: totalBorrowed,
  });

  const lowStock = isLowStock(available, item.minStockAlert);
  const stockStatus = getItemStockStatus(available, item.minStockAlert);

  const formattedBalances = stockBalances.map((b: any) => ({
    id: b.id,
    locationId: b.locationId,
    location: b.location
      ? { code: b.location.code, name: b.location.name }
      : { code: '', name: '' },
    onHand: b.onHand,
    reserved: b.reserved,
    quarantined: b.quarantined,
    kitAllocated: b.kitAllocated,
    borrowed: b.borrowed,
    available: Math.max(0, b.onHand - b.reserved - b.quarantined - b.kitAllocated),
  }));

  return {
    id: item.id,
    code: item.code,
    name: item.name,
    description: item.description,
    unit: item.unit,
    type: item.type,
    categoryId: item.categoryId,
    category: item.category
      ? {
          id: item.category.id,
          code: item.category.code,
          name: item.category.name,
        }
      : undefined,
    categoryName: item.category?.name || '',
    minStockAlert: item.minStockAlert,
    imageUrl: item.imageUrl,
    isActive: item.isActive,
    totalOnHand,
    totalReserved,
    totalQuarantined,
    totalKitAllocated,
    totalBorrowed,
    available,
    isLowStock: lowStock,
    stockStatus,
    stockBalances: formattedBalances,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export class ItemsService {
  /**
   * Retrieves paginated items with filtering, search, and role-based active status restriction
   */
  async listItems(
    query: QueryItemsInput,
    user?: AuthenticatedUser
  ): Promise<{ items: FormattedItemWithCompat[]; meta: PaginationMeta }> {
    // RBAC: Student can ONLY see active items
    let effectiveIsActive: boolean | undefined = query.isActive;
    if (user?.role === UserRole.STUDENT || !user) {
      effectiveIsActive = true;
    }

    const where: Prisma.ItemWhereInput = {
      AND: [
        query.search
          ? {
              OR: [
                { name: { contains: query.search.trim(), mode: 'insensitive' } },
                { code: { contains: query.search.trim(), mode: 'insensitive' } },
                { description: { contains: query.search.trim(), mode: 'insensitive' } },
                {
                  assets: {
                    some: {
                      barcode: { contains: query.search.trim(), mode: 'insensitive' },
                    },
                  },
                },
              ],
            }
          : {},
        query.barcode
          ? {
              OR: [
                { code: { equals: query.barcode.trim(), mode: 'insensitive' } },
                {
                  assets: {
                    some: {
                      barcode: { equals: query.barcode.trim(), mode: 'insensitive' },
                    },
                  },
                },
              ],
            }
          : {},
        query.categoryId ? { categoryId: query.categoryId } : {},
        query.type ? { type: query.type } : {},
        effectiveIsActive !== undefined ? { isActive: effectiveIsActive } : {},
      ],
    };

    // Sort order
    const sortField = query.sortBy || ItemSortField.CREATED_AT;
    const sortDirection = query.sortOrder || SortOrder.DESC;

    let orderBy: Prisma.ItemOrderByWithRelationInput = { createdAt: 'desc' };
    if (sortField === ItemSortField.NAME) {
      orderBy = { name: sortDirection };
    } else if (sortField === ItemSortField.CODE) {
      orderBy = { code: sortDirection };
    } else if (sortField === ItemSortField.CREATED_AT) {
      orderBy = { createdAt: sortDirection };
    } else if (sortField === ItemSortField.UPDATED_AT) {
      orderBy = { updatedAt: sortDirection };
    } else if (sortField === ItemSortField.MIN_STOCK_ALERT) {
      orderBy = { minStockAlert: sortDirection };
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));

    // When filtering by computed low stock or stock status, fetch all matching criteria and filter in memory
    if (query.isLowStock !== undefined || query.stockStatus !== undefined) {
      const allMatching = await prisma.item.findMany({
        where,
        orderBy,
        include: {
          category: { select: { id: true, code: true, name: true } },
          stockBalances: {
            include: {
              location: { select: { code: true, name: true } },
            },
          },
        },
      });

      let formatted = allMatching.map(formatItemResponse);
      if (query.isLowStock !== undefined) {
        formatted = formatted.filter((item) => item.isLowStock === query.isLowStock);
      }
      if (query.stockStatus !== undefined) {
        formatted = formatted.filter((item) => item.stockStatus === query.stockStatus);
      }
      const totalItems = formatted.length;
      const totalPages = Math.ceil(totalItems / limit) || 1;
      const paginatedItems = formatted.slice((page - 1) * limit, page * limit);

      return {
        items: paginatedItems,
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

    // Standard database pagination
    const [totalItems, items] = await Promise.all([
      prisma.item.count({ where }),
      prisma.item.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          category: { select: { id: true, code: true, name: true } },
          stockBalances: {
            include: {
              location: { select: { code: true, name: true } },
            },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(totalItems / limit) || 1;
    const formatted = items.map(formatItemResponse);

    return {
      items: formatted,
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
   * Retrieves single item details with RBAC check
   */
  async getItemById(id: string, user?: AuthenticatedUser): Promise<FormattedItemWithCompat> {
    const item = await prisma.item.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, code: true, name: true } },
        stockBalances: {
          include: {
            location: { select: { code: true, name: true } },
          },
        },
      },
    });

    if (!item) {
      throw new AppError('Không tìm thấy linh kiện yêu cầu', 404);
    }

    // RBAC: Student cannot access inactive item directly
    if (!item.isActive && (user?.role === UserRole.STUDENT || !user)) {
      throw new AppError('Bạn không có quyền truy cập linh kiện đã ngưng hoạt động', 403);
    }

    return formatItemResponse(item);
  }

  /**
   * Retrieves single item by barcode (checking tracked assets and item code)
   */
  async getItemByBarcode(barcode: string, user?: AuthenticatedUser): Promise<FormattedItemWithCompat> {
    const trimmed = barcode.trim();
    if (!trimmed) {
      throw new AppError('Mã barcode không hợp lệ', 400);
    }

    // 1. Try matching Asset barcode
    const asset = await prisma.asset.findFirst({
      where: { barcode: trimmed },
      include: {
        item: {
          include: {
            category: { select: { id: true, code: true, name: true } },
            stockBalances: {
              include: {
                location: { select: { code: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (asset && asset.item) {
      if (!asset.item.isActive && (user?.role === UserRole.STUDENT || !user)) {
        throw new AppError('Bạn không có quyền truy cập linh kiện đã ngưng hoạt động', 403);
      }
      return formatItemResponse(asset.item);
    }

    // 2. Try matching Item code
    const item = await prisma.item.findFirst({
      where: {
        code: { equals: trimmed, mode: 'insensitive' },
      },
      include: {
        category: { select: { id: true, code: true, name: true } },
        stockBalances: {
          include: {
            location: { select: { code: true, name: true } },
          },
        },
      },
    });

    if (!item) {
      throw new AppError(`Không tìm thấy linh kiện nào với mã barcode/SKU '${trimmed}'`, 404);
    }

    if (!item.isActive && (user?.role === UserRole.STUDENT || !user)) {
      throw new AppError('Bạn không có quyền truy cập linh kiện đã ngưng hoạt động', 403);
    }

    return formatItemResponse(item);
  }

  /**
   * Creates new item and writes audit log in transaction
   */
  async createItem(
    data: CreateItemInput,
    userId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<FormattedItemWithCompat> {
    const normalizedCode = data.code.trim().toUpperCase();

    // Check duplicate SKU case-insensitively
    const existing = await prisma.item.findFirst({
      where: { code: { equals: normalizedCode, mode: 'insensitive' } },
    });
    if (existing) {
      throw new AppError(
        `Mã linh kiện/thiết bị '${normalizedCode}' đã tồn tại trong hệ thống`,
        409
      );
    }

    // Check category existence
    const category = await prisma.category.findUnique({
      where: { id: data.categoryId },
    });
    if (!category) {
      throw new AppError(`Danh mục với ID '${data.categoryId}' không tồn tại`, 404);
    }

    return await prisma.$transaction(async (tx) => {
      const created = await tx.item.create({
        data: {
          code: normalizedCode,
          name: data.name.trim(),
          description: data.description ? data.description.trim() : null,
          unit: data.unit.trim(),
          type: data.type,
          categoryId: data.categoryId,
          minStockAlert: data.minStockAlert,
          imageUrl: data.imageUrl ? data.imageUrl.trim() : null,
        },
        include: {
          category: { select: { id: true, code: true, name: true } },
          stockBalances: {
            include: {
              location: { select: { code: true, name: true } },
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'CREATE_ITEM',
          entity: 'Item',
          entityId: created.id,
          oldValue: Prisma.DbNull,
          newValue: {
            code: created.code,
            name: created.name,
            unit: created.unit,
            type: created.type,
            categoryId: created.categoryId,
            minStockAlert: created.minStockAlert,
            isActive: created.isActive,
          },
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
        },
      });

      return formatItemResponse(created);
    });
  }

  /**
   * Updates descriptive item attributes and writes audit log in transaction
   */
  async updateItem(
    id: string,
    data: UpdateItemInput,
    userId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<FormattedItemWithCompat> {
    const existing = await prisma.item.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new AppError('Không tìm thấy linh kiện cần cập nhật', 404);
    }

    let normalizedCode: string | undefined = undefined;
    if (data.code) {
      normalizedCode = data.code.trim().toUpperCase();
      if (normalizedCode !== existing.code.toUpperCase()) {
        const codeConflict = await prisma.item.findFirst({
          where: {
            code: { equals: normalizedCode, mode: 'insensitive' },
            NOT: { id },
          },
        });
        if (codeConflict) {
          throw new AppError(
            `Mã linh kiện/thiết bị '${normalizedCode}' đã tồn tại trong hệ thống`,
            409
          );
        }
      }
    }

    // Check category existence if updating categoryId
    if (data.categoryId && data.categoryId !== existing.categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: data.categoryId },
      });
      if (!category) {
        throw new AppError(`Danh mục với ID '${data.categoryId}' không tồn tại`, 404);
      }
    }

    return await prisma.$transaction(async (tx) => {
      const updated = await tx.item.update({
        where: { id },
        data: {
          code: normalizedCode,
          name: data.name !== undefined ? data.name.trim() : undefined,
          description: data.description !== undefined ? (data.description ? data.description.trim() : null) : undefined,
          unit: data.unit !== undefined ? data.unit.trim() : undefined,
          type: data.type,
          categoryId: data.categoryId,
          minStockAlert: data.minStockAlert,
          imageUrl: data.imageUrl !== undefined ? (data.imageUrl ? data.imageUrl.trim() : null) : undefined,
        },
        include: {
          category: { select: { id: true, code: true, name: true } },
          stockBalances: {
            include: {
              location: { select: { code: true, name: true } },
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'UPDATE_ITEM',
          entity: 'Item',
          entityId: updated.id,
          oldValue: {
            code: existing.code,
            name: existing.name,
            description: existing.description,
            unit: existing.unit,
            type: existing.type,
            categoryId: existing.categoryId,
            minStockAlert: existing.minStockAlert,
            imageUrl: existing.imageUrl,
          },
          newValue: {
            code: updated.code,
            name: updated.name,
            description: updated.description,
            unit: updated.unit,
            type: updated.type,
            categoryId: updated.categoryId,
            minStockAlert: updated.minStockAlert,
            imageUrl: updated.imageUrl,
          },
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
        },
      });

      return formatItemResponse(updated);
    });
  }

  /**
   * Updates item status (Active/Inactive) and writes audit log in transaction
   */
  async updateItemStatus(
    id: string,
    data: UpdateItemStatusInput,
    userId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<FormattedItemWithCompat> {
    const existing = await prisma.item.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new AppError('Không tìm thấy linh kiện cần thay đổi trạng thái', 404);
    }

    const action = data.isActive ? 'REACTIVATE_ITEM' : 'DEACTIVATE_ITEM';

    return await prisma.$transaction(async (tx) => {
      const updated = await tx.item.update({
        where: { id },
        data: { isActive: data.isActive },
        include: {
          category: { select: { id: true, code: true, name: true } },
          stockBalances: {
            include: {
              location: { select: { code: true, name: true } },
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action,
          entity: 'Item',
          entityId: updated.id,
          oldValue: { isActive: existing.isActive },
          newValue: { isActive: updated.isActive, reason: data.reason || null },
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
        },
      });

      return formatItemResponse(updated);
    });
  }

  /**
   * Safe item deletion with referential integrity and audit logging.
   * If item has active stock (>0) or historical ledger movements / borrows / kits, deletion is rejected.
   */
  async deleteItem(
    id: string,
    userId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ id: string; code: string; name: string }> {
    const item = await prisma.item.findUnique({
      where: { id },
      include: {
        stockBalances: true,
        stockMovements: { select: { id: true }, take: 1 },
        stockTransactionDetails: { select: { id: true }, take: 1 },
        borrowDetails: { select: { id: true }, take: 1 },
        kitItems: { select: { id: true }, take: 1 },
        assets: { select: { id: true }, take: 1 },
      },
    });

    if (!item) {
      throw new AppError('Không tìm thấy linh kiện cần xóa', 404);
    }

    // 1. Check if item has any non-zero physical stock balances
    const totalOnHand = item.stockBalances.reduce((sum, b) => sum + (b.onHand || 0), 0);
    const totalReserved = item.stockBalances.reduce((sum, b) => sum + (b.reserved || 0), 0);
    const totalQuarantined = item.stockBalances.reduce((sum, b) => sum + (b.quarantined || 0), 0);
    const totalKitAllocated = item.stockBalances.reduce((sum, b) => sum + (b.kitAllocated || 0), 0);
    const totalBorrowed = item.stockBalances.reduce((sum, b) => sum + (b.borrowed || 0), 0);

    if (totalOnHand > 0 || totalReserved > 0 || totalQuarantined > 0 || totalKitAllocated > 0 || totalBorrowed > 0) {
      throw new AppError(
        `Không thể xóa linh kiện '${item.code}' vì đang còn số dư tồn kho (Tồn vật lý: ${totalOnHand}, Đang mượn: ${totalBorrowed}). Vui lòng điều chỉnh/xuất kho về 0 hoặc chuyển trạng thái sang ngưng hoạt động.`,
        400
      );
    }

    // 2. Check if item is tied to historical transactions, borrow requests, kits or assets
    const hasHistory =
      item.stockMovements.length > 0 ||
      item.stockTransactionDetails.length > 0 ||
      item.borrowDetails.length > 0 ||
      item.kitItems.length > 0 ||
      item.assets.length > 0;

    if (hasHistory) {
      throw new AppError(
        `Không thể xóa vật lý linh kiện '${item.code}' do đã phát sinh lịch sử giao dịch kho, phiếu mượn hoặc cấu hình bộ kit. Vui lòng sử dụng tính năng vô hiệu hóa (deactivate) để bảo toàn lịch sử dữ liệu.`,
        409
      );
    }

    // 3. Safe to physically delete
    return await prisma.$transaction(async (tx) => {
      // Delete zero-balance stock balance records first to satisfy FK
      await tx.stockBalance.deleteMany({
        where: { itemId: id },
      });

      const deleted = await tx.item.delete({
        where: { id },
      });

      // Write audit log
      await tx.auditLog.create({
        data: {
          userId,
          action: 'DELETE_ITEM',
          entity: 'Item',
          entityId: id,
          oldValue: {
            code: item.code,
            name: item.name,
            unit: item.unit,
            type: item.type,
            categoryId: item.categoryId,
            minStockAlert: item.minStockAlert,
          },
          newValue: Prisma.DbNull,
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
        },
      });

      return {
        id: deleted.id,
        code: deleted.code,
        name: deleted.name,
      };
    });
  }
}

export const itemsService = new ItemsService();
