import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import {
  QueryStockBalancesInput,
  StockBalanceResponse,
  InventorySummaryResponse,
  PaginationMeta,
  computeStockBreakdown,
  calculateAvailableStock,
  getItemStockStatus,
  StockStatus,
  StockBalanceSortField,
  SortOrder,
} from '@acm/shared';

export class InventoryService {
  /**
   * Retrieves paginated list of stock balances with filtering, search, and sorting.
   * Enriches records with available quantity and low stock warning.
   */
  async listBalances(
    query: QueryStockBalancesInput
  ): Promise<{ balances: any[]; meta: PaginationMeta }> {
    const where: Prisma.StockBalanceWhereInput = {};

    if (query.itemId) {
      where.itemId = query.itemId;
    }

    if (query.locationId) {
      where.locationId = query.locationId;
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { item: { code: { contains: search, mode: 'insensitive' } } },
        { item: { name: { contains: search, mode: 'insensitive' } } },
        { location: { code: { contains: search, mode: 'insensitive' } } },
        { location: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const sortBy = query.sortBy || StockBalanceSortField.UPDATED_AT;
    const sortOrder = query.sortOrder || SortOrder.DESC;

    const orderBy: Prisma.StockBalanceOrderByWithRelationInput = {};
    if (sortBy === StockBalanceSortField.ON_HAND) {
      orderBy.onHand = sortOrder;
    } else {
      orderBy.updatedAt = sortOrder;
    }

    const [totalItems, balances] = await Promise.all([
      prisma.stockBalance.count({ where }),
      prisma.stockBalance.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          item: {
            select: {
              id: true,
              code: true,
              name: true,
              unit: true,
              type: true,
              minStockAlert: true,
              isActive: true,
            },
          },
          location: {
            select: {
              id: true,
              code: true,
              name: true,
              type: true,
              isActive: true,
            },
          },
        },
      }),
    ]);

    const enriched = balances.map((b) => {
      const breakdown = computeStockBreakdown({
        onHand: b.onHand,
        reserved: b.reserved,
        quarantined: b.quarantined,
        kitAllocated: b.kitAllocated,
        borrowed: b.borrowed,
      });

      const isLowStock = breakdown.available < b.item.minStockAlert;

      return {
        id: b.id,
        itemId: b.itemId,
        itemCode: b.item.code,
        itemName: b.item.name,
        itemUnit: b.item.unit,
        itemType: b.item.type,
        locationId: b.locationId,
        locationCode: b.location.code,
        locationName: b.location.name,
        locationType: b.location.type,
        onHand: b.onHand,
        reserved: b.reserved,
        quarantined: b.quarantined,
        kitAllocated: b.kitAllocated,
        borrowed: b.borrowed,
        available: breakdown.available,
        isLowStock,
        minStockAlert: b.item.minStockAlert,
        item: b.item,
        location: b.location,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      };
    });

    // If filtered by isLowStock
    let finalBalances = enriched;
    if (query.isLowStock !== undefined) {
      finalBalances = enriched.filter((b) => b.isLowStock === query.isLowStock);
    }

    // In-memory sort by available if requested
    if (sortBy === StockBalanceSortField.AVAILABLE) {
      finalBalances.sort((a, b) =>
        sortOrder === SortOrder.ASC ? a.available - b.available : b.available - a.available
      );
    }

    const totalPages = Math.ceil(totalItems / limit) || 1;

    return {
      balances: finalBalances,
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
   * Computes system-wide inventory overview summary.
   */
  async getInventorySummary(): Promise<InventorySummaryResponse> {
    const [balances, totalItems, totalLocations] = await Promise.all([
      prisma.stockBalance.findMany({
        include: {
          item: {
            select: { id: true, minStockAlert: true, isActive: true },
          },
        },
      }),
      prisma.item.count({ where: { isActive: true } }),
      prisma.location.count({ where: { isActive: true } }),
    ]);

    let totalOnHand = 0;
    let totalReserved = 0;
    let totalQuarantined = 0;
    let totalKitAllocated = 0;
    let totalBorrowed = 0;
    let totalAvailable = 0;

    // Track available stock per item to calculate low stock count
    const itemAvailableMap = new Map<string, { available: number; minStockAlert: number }>();

    for (const b of balances) {
      totalOnHand += b.onHand;
      totalReserved += b.reserved;
      totalQuarantined += b.quarantined;
      totalKitAllocated += b.kitAllocated;
      totalBorrowed += b.borrowed;

      const avail = calculateAvailableStock({
        onHand: b.onHand,
        reserved: b.reserved,
        quarantined: b.quarantined,
        kitAllocated: b.kitAllocated,
        borrowed: b.borrowed,
      });
      totalAvailable += avail;

      if (b.item && b.item.isActive) {
        const existing = itemAvailableMap.get(b.itemId) || {
          available: 0,
          minStockAlert: b.item.minStockAlert,
        };
        existing.available += avail;
        itemAvailableMap.set(b.itemId, existing);
      }
    }

    let lowStockItemCount = 0;
    let outOfStockItemCount = 0;
    let inStockItemCount = 0;

    for (const [, stats] of itemAvailableMap) {
      const status = getItemStockStatus(stats.available, stats.minStockAlert);
      if (status === StockStatus.OUT_OF_STOCK) {
        outOfStockItemCount++;
        lowStockItemCount++; // Included in low stock count for backwards compatibility
      } else if (status === StockStatus.LOW_STOCK) {
        lowStockItemCount++;
      } else {
        inStockItemCount++;
      }
    }

    return {
      totalOnHand,
      totalReserved,
      totalQuarantined,
      totalKitAllocated,
      totalBorrowed,
      totalAvailable,
      lowStockItemCount,
      outOfStockItemCount,
      inStockItemCount,
      totalLocations,
      totalItems,
    };
  }
}

export const inventoryService = new InventoryService();
