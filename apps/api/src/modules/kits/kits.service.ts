import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/AppError';
import { AuthenticatedUser } from '../../middleware/auth';
import {
  UserRole,
  KitStatus,
  KitSortField,
  SortOrder,
  KitResponse,
  PaginatedResponse,
  CreateKitInput,
  UpdateKitInput,
  UpdateKitStatusInput,
  QueryKitsInput,
} from '@acm/shared';

export interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

export function formatKitResponse(k: any): KitResponse {
  return {
    id: k.id,
    code: k.code,
    name: k.name,
    description: k.description ?? null,
    status: k.status,
    locationId: k.locationId ?? null,
    location: k.location
      ? {
          id: k.location.id,
          code: k.location.code,
          name: k.location.name,
        }
      : null,
    createdById: k.createdById ?? null,
    createdBy: k.createdBy
      ? {
          id: k.createdBy.id,
          fullName: k.createdBy.fullName,
          email: k.createdBy.email,
        }
      : null,
    items: (k.items || []).map((ki: any) => ({
      id: ki.id,
      kitId: ki.kitId,
      itemId: ki.itemId,
      item: ki.item
        ? {
            id: ki.item.id,
            code: ki.item.code,
            name: ki.item.name,
            unit: ki.item.unit,
            type: ki.item.type,
          }
        : undefined,
      quantity: ki.quantity,
      notes: ki.notes ?? null,
      createdAt: ki.createdAt,
    })),
    totalItems: (k.items || []).reduce((acc: number, cur: any) => acc + (cur.quantity || 0), 0),
    createdAt: k.createdAt,
    updatedAt: k.updatedAt,
  };
}

export class KitsService {
  /**
   * Retrieves paginated list of kits with search, status, and location filtering.
   * RBAC: Accessible by all authenticated users.
   */
  async listKits(
    query: QueryKitsInput,
    _currentUser: AuthenticatedUser
  ): Promise<PaginatedResponse<KitResponse>> {
    const where: Prisma.KitWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.locationId) {
      where.locationId = query.locationId;
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const sortByField = query.sortBy || KitSortField.CREATED_AT;
    const sortOrderVal = query.sortOrder || SortOrder.DESC;

    const [totalItems, kits] = await Promise.all([
      prisma.kit.count({ where }),
      prisma.kit.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortByField]: sortOrderVal },
        include: {
          location: { select: { id: true, code: true, name: true } },
          createdBy: { select: { id: true, fullName: true, email: true } },
          items: {
            include: {
              item: { select: { id: true, code: true, name: true, unit: true, type: true } },
            },
          },
        },
      }),
    ]);

    const items = kits.map((k) => formatKitResponse(k));
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
   * Retrieves a single kit with component items and location details.
   */
  async getKitById(id: string, _currentUser: AuthenticatedUser): Promise<KitResponse> {
    const kit = await prisma.kit.findUnique({
      where: { id },
      include: {
        location: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, fullName: true, email: true } },
        items: {
          include: {
            item: { select: { id: true, code: true, name: true, unit: true, type: true } },
          },
        },
      },
    });

    if (!kit) {
      throw new AppError('Hộp kit không tồn tại trong hệ thống', 404);
    }

    return formatKitResponse(kit);
  }

  /**
   * Creates a new kit, validates available stock for component items, locks kitAllocated, and writes AuditLog.
   * RBAC: ADMIN, LAB_MANAGER, TECHNICIAN.
   */
  async createKit(
    input: CreateKitInput,
    currentUser: AuthenticatedUser,
    meta?: RequestMetadata
  ): Promise<KitResponse> {
    if (currentUser.role === UserRole.STUDENT) {
      throw new AppError('Sinh viên không có quyền tạo hộp kit thực hành', 403);
    }

    const normalizedCode = input.code.trim().toUpperCase();

    // Check code uniqueness
    const existing = await prisma.kit.findUnique({
      where: { code: normalizedCode },
    });

    if (existing) {
      throw new AppError(`Mã hộp kit '${normalizedCode}' đã tồn tại trong hệ thống`, 409);
    }

    // Verify location if provided
    if (input.locationId) {
      const loc = await prisma.location.findUnique({
        where: { id: input.locationId },
        select: { id: true, isActive: true },
      });
      if (!loc) {
        throw new AppError('Vị trí lưu trữ hộp kit không tồn tại', 404);
      }
      if (!loc.isActive) {
        throw new AppError('Vị trí lưu trữ hộp kit đã bị vô hiệu hóa', 400);
      }
    }

    // Verify all component items exist and check available inventory if location is specified
    for (const kitItem of input.items) {
      const itemRecord = await prisma.item.findUnique({
        where: { id: kitItem.itemId },
        include: { stockBalances: true },
      });

      if (!itemRecord) {
        throw new AppError(`Linh kiện với ID '${kitItem.itemId}' không tồn tại`, 404);
      }
      if (!itemRecord.isActive) {
        throw new AppError(`Linh kiện '${itemRecord.name}' đã bị ngừng hoạt động`, 400);
      }

      if (input.locationId) {
        const bal = itemRecord.stockBalances.find((b) => b.locationId === input.locationId);
        const onHand = bal?.onHand || 0;
        const reserved = bal?.reserved || 0;
        const quarantined = bal?.quarantined || 0;
        const kitAllocated = bal?.kitAllocated || 0;
        const available = Math.max(0, onHand - reserved - quarantined - kitAllocated);

        if (available < kitItem.quantity) {
          throw new AppError(
            `Không đủ tồn kho khả dụng cho linh kiện '${itemRecord.name}' tại vị trí đã chọn (cần: ${kitItem.quantity}, khả dụng: ${available})`,
            400
          );
        }
      }
    }

    return await prisma.$transaction(async (tx) => {
      const createdKit = await tx.kit.create({
        data: {
          code: normalizedCode,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          status: KitStatus.AVAILABLE,
          locationId: input.locationId || null,
          createdById: currentUser.id,
        },
      });

      for (const item of input.items) {
        await tx.kitItem.create({
          data: {
            kitId: createdKit.id,
            itemId: item.itemId,
            quantity: item.quantity,
            notes: item.notes?.trim() || null,
          },
        });

        if (input.locationId) {
          await tx.stockBalance.update({
            where: {
              itemId_locationId: {
                itemId: item.itemId,
                locationId: input.locationId,
              },
            },
            data: {
              kitAllocated: { increment: item.quantity },
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'CREATE_KIT',
          entity: 'Kit',
          entityId: createdKit.id,
          oldValue: Prisma.DbNull,
          newValue: {
            code: createdKit.code,
            name: createdKit.name,
            status: createdKit.status,
            locationId: createdKit.locationId,
            items: input.items,
          },
          ipAddress: meta?.ipAddress || null,
          userAgent: meta?.userAgent || null,
        },
      });

      const fullKit = await tx.kit.findUnique({
        where: { id: createdKit.id },
        include: {
          location: { select: { id: true, code: true, name: true } },
          createdBy: { select: { id: true, fullName: true, email: true } },
          items: {
            include: {
              item: { select: { id: true, code: true, name: true, unit: true, type: true } },
            },
          },
        },
      });

      return formatKitResponse(fullKit!);
    });
  }

  /**
   * Updates kit details, component items, or location with inventory reconciliation.
   * RBAC: ADMIN, LAB_MANAGER, TECHNICIAN.
   */
  async updateKit(
    id: string,
    input: UpdateKitInput,
    currentUser: AuthenticatedUser,
    meta?: RequestMetadata
  ): Promise<KitResponse> {
    if (currentUser.role === UserRole.STUDENT) {
      throw new AppError('Sinh viên không có quyền chỉnh sửa hộp kit', 403);
    }

    const kit = await prisma.kit.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });

    if (!kit) {
      throw new AppError('Hộp kit không tồn tại trong hệ thống', 404);
    }

    if (kit.status === KitStatus.ALLOCATED && input.items !== undefined) {
      throw new AppError('Không thể chỉnh sửa danh sách linh kiện khi hộp kit đang được phân bổ', 400);
    }

    const targetLocationId = input.locationId !== undefined ? input.locationId : kit.locationId;
    const currentLocationId = kit.locationId;
    const isKitActive = kit.status === KitStatus.AVAILABLE || kit.status === KitStatus.MAINTENANCE;

    // Check location if changed
    if (input.locationId && input.locationId !== kit.locationId) {
      const loc = await prisma.location.findUnique({
        where: { id: input.locationId },
        select: { id: true, isActive: true },
      });
      if (!loc || !loc.isActive) {
        throw new AppError('Vị trí mới cho hộp kit không hợp lệ hoặc đã bị vô hiệu hóa', 400);
      }
    }

    const hasItemsChanged = input.items !== undefined;
    const hasLocationChanged =
      input.locationId !== undefined && input.locationId !== kit.locationId;

    return await prisma.$transaction(async (tx) => {
      // If active and items or location is changing, reconcile stock allocation
      if (isKitActive && (hasItemsChanged || hasLocationChanged)) {
        // 1. Release previous allocation from old location
        if (currentLocationId) {
          for (const oldItem of kit.items) {
            await tx.stockBalance.updateMany({
              where: {
                itemId: oldItem.itemId,
                locationId: currentLocationId,
              },
              data: {
                kitAllocated: { decrement: oldItem.quantity },
              },
            });
          }
        }

        // 2. Determine new items list
        const newItemsList = input.items !== undefined ? input.items : kit.items;

        // 3. Verify availability & allocate at target location
        if (targetLocationId) {
          for (const item of newItemsList) {
            const bal = await tx.stockBalance.findUnique({
              where: {
                itemId_locationId: {
                  itemId: item.itemId,
                  locationId: targetLocationId,
                },
              },
              include: { item: { select: { name: true } } },
            });

            const onHand = bal?.onHand || 0;
            const reserved = bal?.reserved || 0;
            const quarantined = bal?.quarantined || 0;
            const kitAllocated = bal?.kitAllocated || 0;
            const available = Math.max(0, onHand - reserved - quarantined - kitAllocated);

            if (available < item.quantity) {
              throw new AppError(
                `Không đủ tồn kho khả dụng cho linh kiện '${bal?.item?.name || item.itemId}' (cần: ${item.quantity}, khả dụng: ${available})`,
                400
              );
            }

            await tx.stockBalance.update({
              where: {
                itemId_locationId: {
                  itemId: item.itemId,
                  locationId: targetLocationId,
                },
              },
              data: {
                kitAllocated: { increment: item.quantity },
              },
            });
          }
        }
      }

      // Update Kit record
      await tx.kit.update({
        where: { id },
        data: {
          name: input.name !== undefined ? input.name.trim() : undefined,
          description: input.description !== undefined ? input.description?.trim() || null : undefined,
          locationId: input.locationId !== undefined ? input.locationId : undefined,
        },
      });

      // Update Kit items if provided
      if (input.items !== undefined) {
        await tx.kitItem.deleteMany({ where: { kitId: id } });
        for (const item of input.items) {
          await tx.kitItem.create({
            data: {
              kitId: id,
              itemId: item.itemId,
              quantity: item.quantity,
              notes: item.notes?.trim() || null,
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'UPDATE_KIT',
          entity: 'Kit',
          entityId: id,
          oldValue: {
            name: kit.name,
            locationId: kit.locationId,
            itemCount: kit.items.length,
          },
          newValue: {
            name: input.name !== undefined ? input.name : kit.name,
            locationId: targetLocationId,
            items: input.items || kit.items,
          },
          ipAddress: meta?.ipAddress || null,
          userAgent: meta?.userAgent || null,
        },
      });

      const updatedKit = await tx.kit.findUnique({
        where: { id },
        include: {
          location: { select: { id: true, code: true, name: true } },
          createdBy: { select: { id: true, fullName: true, email: true } },
          items: {
            include: {
              item: { select: { id: true, code: true, name: true, unit: true, type: true } },
            },
          },
        },
      });

      return formatKitResponse(updatedKit!);
    });
  }

  /**
   * Updates kit status with FSM transition rules and stock release / re-allocation.
   * - AVAILABLE -> ALLOCATED: Kit loaned out.
   * - ALLOCATED -> AVAILABLE / MAINTENANCE: Kit returned.
   * - AVAILABLE / MAINTENANCE -> RETIRED: Kit disassembled, components released back to stock.
   * - RETIRED -> AVAILABLE: Re-commission kit, re-allocating components with availability check.
   */
  async updateKitStatus(
    id: string,
    input: UpdateKitStatusInput,
    currentUser: AuthenticatedUser,
    meta?: RequestMetadata
  ): Promise<KitResponse> {
    if (currentUser.role === UserRole.STUDENT) {
      throw new AppError('Sinh viên không có quyền cập nhật trạng thái hộp kit', 403);
    }

    const kit = await prisma.kit.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!kit) {
      throw new AppError('Hộp kit không tồn tại trong hệ thống', 404);
    }

    const currentStatus = kit.status;
    const targetStatus = input.status;

    if (currentStatus === targetStatus) {
      return this.getKitById(id, currentUser);
    }

    // Allowed FSM transitions
    const validTransitions: Record<KitStatus, KitStatus[]> = {
      [KitStatus.AVAILABLE]: [KitStatus.ALLOCATED, KitStatus.MAINTENANCE, KitStatus.RETIRED],
      [KitStatus.ALLOCATED]: [KitStatus.AVAILABLE, KitStatus.MAINTENANCE],
      [KitStatus.MAINTENANCE]: [KitStatus.AVAILABLE, KitStatus.RETIRED],
      [KitStatus.RETIRED]: [KitStatus.AVAILABLE],
    };

    if (!validTransitions[currentStatus]?.includes(targetStatus)) {
      throw new AppError(
        `Không thể chuyển trạng thái hộp kit từ '${currentStatus}' sang '${targetStatus}'`,
        400
      );
    }

    return await prisma.$transaction(async (tx) => {
      // 1. If retiring kit: release component allocations
      if (targetStatus === KitStatus.RETIRED && kit.locationId) {
        for (const item of kit.items) {
          await tx.stockBalance.updateMany({
            where: {
              itemId: item.itemId,
              locationId: kit.locationId,
            },
            data: {
              kitAllocated: { decrement: item.quantity },
            },
          });
        }
      }

      // 2. If re-commissioning kit from RETIRED to AVAILABLE: check stock availability and re-allocate
      if (currentStatus === KitStatus.RETIRED && targetStatus === KitStatus.AVAILABLE && kit.locationId) {
        for (const item of kit.items) {
          const bal = await tx.stockBalance.findUnique({
            where: {
              itemId_locationId: {
                itemId: item.itemId,
                locationId: kit.locationId,
              },
            },
            include: { item: { select: { name: true } } },
          });

          const onHand = bal?.onHand || 0;
          const reserved = bal?.reserved || 0;
          const quarantined = bal?.quarantined || 0;
          const kitAllocated = bal?.kitAllocated || 0;
          const available = Math.max(0, onHand - reserved - quarantined - kitAllocated);

          if (available < item.quantity) {
            throw new AppError(
              `Không đủ tồn kho khả dụng để tái lắp ráp hộp kit cho linh kiện '${bal?.item?.name || item.itemId}' (cần: ${item.quantity}, khả dụng: ${available})`,
              400
            );
          }

          await tx.stockBalance.update({
            where: {
              itemId_locationId: {
                itemId: item.itemId,
                locationId: kit.locationId,
              },
            },
            data: {
              kitAllocated: { increment: item.quantity },
            },
          });
        }
      }

      // Update status
      await tx.kit.update({
        where: { id },
        data: { status: targetStatus },
      });

      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'UPDATE_KIT_STATUS',
          entity: 'Kit',
          entityId: id,
          oldValue: { status: currentStatus },
          newValue: { status: targetStatus, notes: input.notes || null },
          ipAddress: meta?.ipAddress || null,
          userAgent: meta?.userAgent || null,
        },
      });

      const updated = await tx.kit.findUnique({
        where: { id },
        include: {
          location: { select: { id: true, code: true, name: true } },
          createdBy: { select: { id: true, fullName: true, email: true } },
          items: {
            include: {
              item: { select: { id: true, code: true, name: true, unit: true, type: true } },
            },
          },
        },
      });

      return formatKitResponse(updated!);
    });
  }

  /**
   * Safely deletes a kit, releasing component allocations if kit is not already retired.
   * Reject if kit is currently ALLOCATED.
   * RBAC: ADMIN, LAB_MANAGER.
   */
  async deleteKit(
    id: string,
    currentUser: AuthenticatedUser,
    meta?: RequestMetadata
  ): Promise<{ success: boolean; message: string }> {
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.LAB_MANAGER) {
      throw new AppError('Chỉ Quản trị viên hoặc Quản lý phòng Lab mới có quyền xóa hộp kit', 403);
    }

    const kit = await prisma.kit.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!kit) {
      throw new AppError('Hộp kit không tồn tại trong hệ thống', 404);
    }

    if (kit.status === KitStatus.ALLOCATED) {
      throw new AppError('Không thể xóa hộp kit đang được phân bổ / bàn giao cho người dùng', 400);
    }

    await prisma.$transaction(async (tx) => {
      // If kit was active (AVAILABLE or MAINTENANCE), release kitAllocated back to inventory
      if (kit.status !== KitStatus.RETIRED && kit.locationId) {
        for (const item of kit.items) {
          await tx.stockBalance.updateMany({
            where: {
              itemId: item.itemId,
              locationId: kit.locationId,
            },
            data: {
              kitAllocated: { decrement: item.quantity },
            },
          });
        }
      }

      // Delete kit items
      await tx.kitItem.deleteMany({ where: { kitId: id } });
      // Delete kit
      await tx.kit.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'DELETE_KIT',
          entity: 'Kit',
          entityId: id,
          oldValue: {
            code: kit.code,
            name: kit.name,
            status: kit.status,
            locationId: kit.locationId,
            itemCount: kit.items.length,
          },
          newValue: Prisma.DbNull,
          ipAddress: meta?.ipAddress || null,
          userAgent: meta?.userAgent || null,
        },
      });
    });

    return { success: true, message: `Hộp kit '${kit.code}' đã được xóa an toàn` };
  }
}

export const kitsService = new KitsService();
