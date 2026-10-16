import { describe, it, expect } from 'vitest';
import {
  calculateAvailableStock,
  computeStockBreakdown,
  validateStockValues,
  validateStockInvariant,
  canExportStock,
  calculateTransferDelta,
  calculateAdjustmentDelta,
  isLowStock,
  getItemStockStatus,
  buildLocationTree,
  flattenLocationTree,
  isDescendantLocation,
} from './stock';
import { StockBalanceValues, LocationType, LocationResponse, StockStatus } from './types';

describe('ACM Inventory Balance Invariant & Domain Logic Tests', () => {
  it('correctly calculates Available = OnHand - Reserved - Quarantined - KitAllocated', () => {
    const balance: StockBalanceValues = {
      onHand: 100,
      reserved: 20,
      quarantined: 5,
      kitAllocated: 15,
      borrowed: 30, // Note: Borrowed is out-of-warehouse, NOT deducted from OnHand again!
    };

    // Expected Available = 100 - 20 - 5 - 15 = 60
    const available = calculateAvailableStock(balance);
    expect(available).toBe(60);

    const breakdown = computeStockBreakdown(balance);
    expect(breakdown.available).toBe(60);
    expect(breakdown.borrowed).toBe(30);
  });

  it('handles zero stock and zero allocations cleanly', () => {
    const balance: StockBalanceValues = {
      onHand: 0,
      reserved: 0,
      quarantined: 0,
      kitAllocated: 0,
      borrowed: 0,
    };
    expect(calculateAvailableStock(balance)).toBe(0);
    expect(() => validateStockInvariant(balance)).not.toThrow();
  });

  it('throws an error if any quantity is negative', () => {
    const invalidBalance: StockBalanceValues = {
      onHand: 10,
      reserved: -2,
      quarantined: 0,
      kitAllocated: 0,
      borrowed: 0,
    };
    expect(() => validateStockValues(invalidBalance)).toThrow(/cannot be negative/);
  });

  it('throws an error if any quantity is non-integer (decimal)', () => {
    const invalidBalance: StockBalanceValues = {
      onHand: 10.5,
      reserved: 0,
      quarantined: 0,
      kitAllocated: 0,
      borrowed: 0,
    };
    expect(() => validateStockValues(invalidBalance)).toThrow(/must be an integer/);
  });

  it('throws an error if reserved + quarantined + kitAllocated exceeds onHand', () => {
    const invalidBalance: StockBalanceValues = {
      onHand: 50,
      reserved: 30,
      quarantined: 15,
      kitAllocated: 10, // Sum = 55 > 50
      borrowed: 5,
    };
    expect(() => calculateAvailableStock(invalidBalance)).toThrow(/exceeds On-hand/);
    expect(() => validateStockInvariant(invalidBalance)).toThrow(/exceeds On-hand/);
  });

  describe('canExportStock', () => {
    const balance: StockBalanceValues = {
      onHand: 50,
      reserved: 10,
      quarantined: 5,
      kitAllocated: 5,
      borrowed: 0,
    }; // Available = 30

    it('returns true when export quantity is less than or equal to available stock', () => {
      expect(canExportStock(balance, 10)).toBe(true);
      expect(canExportStock(balance, 30)).toBe(true);
    });

    it('returns false when export quantity exceeds available stock', () => {
      expect(canExportStock(balance, 31)).toBe(false);
      expect(canExportStock(balance, 50)).toBe(false);
    });

    it('throws when export quantity is zero, negative, or not an integer', () => {
      expect(() => canExportStock(balance, 0)).toThrow(/positive integer/);
      expect(() => canExportStock(balance, -5)).toThrow(/positive integer/);
      expect(() => canExportStock(balance, 12.5)).toThrow(/positive integer/);
      expect(() => canExportStock(balance, NaN)).toThrow(/positive integer/);
    });
  });

  describe('calculateTransferDelta', () => {
    it('calculates equal and opposite deltas with zero net delta (Conservation of Stock)', () => {
      const result = calculateTransferDelta(25);
      expect(result.fromDelta).toBe(-25);
      expect(result.toDelta).toBe(25);
      expect(result.netDelta).toBe(0);
      expect(result.fromDelta + result.toDelta).toBe(0);
    });

    it('throws when transfer quantity is invalid', () => {
      expect(() => calculateTransferDelta(0)).toThrow(/positive integer/);
      expect(() => calculateTransferDelta(-10)).toThrow(/positive integer/);
      expect(() => calculateTransferDelta(1.5)).toThrow(/positive integer/);
    });
  });

  describe('calculateAdjustmentDelta', () => {
    it('calculates positive delta when actual count is higher than recorded onHand', () => {
      const result = calculateAdjustmentDelta(10, 15);
      expect(result.delta).toBe(5);
      expect(result.isReduction).toBe(false);
    });

    it('calculates negative delta when actual count is lower than recorded onHand', () => {
      const result = calculateAdjustmentDelta(20, 14);
      expect(result.delta).toBe(-6);
      expect(result.isReduction).toBe(true);
    });

    it('calculates zero delta when actual count matches onHand', () => {
      const result = calculateAdjustmentDelta(10, 10);
      expect(result.delta).toBe(0);
      expect(result.isReduction).toBe(false);
    });

    it('throws when current or actual counts are negative or invalid', () => {
      expect(() => calculateAdjustmentDelta(-1, 10)).toThrow(/non-negative integer/);
      expect(() => calculateAdjustmentDelta(10, -5)).toThrow(/non-negative integer/);
      expect(() => calculateAdjustmentDelta(10.2, 10)).toThrow(/non-negative integer/);
    });
  });

  describe('isLowStock business rule: available < minStockAlert', () => {
    it('returns true when available is strictly less than minStockAlert', () => {
      expect(isLowStock(4, 5)).toBe(true);
      expect(isLowStock(0, 1)).toBe(true);
      expect(isLowStock(0, 10)).toBe(true);
    });

    it('returns false when available is equal to or greater than minStockAlert', () => {
      expect(isLowStock(5, 5)).toBe(false);
      expect(isLowStock(10, 5)).toBe(false);
      expect(isLowStock(0, 0)).toBe(false);
    });

    it('throws when inputs are invalid, negative, or non-finite', () => {
      expect(() => isLowStock(-1, 5)).toThrow(/non-negative finite number/);
      expect(() => isLowStock(5, -1)).toThrow(/non-negative finite number/);
      expect(() => isLowStock(Infinity, 5)).toThrow(/non-negative finite number/);
      expect(() => isLowStock(5, Infinity)).toThrow(/non-negative finite number/);
      expect(() => isLowStock(NaN, 5)).toThrow(/non-negative finite number/);
    });
  });

  describe('getItemStockStatus business rule (OUT_OF_STOCK, LOW_STOCK, IN_STOCK)', () => {
    it('returns OUT_OF_STOCK when available is 0 or negative', () => {
      expect(getItemStockStatus(0, 5)).toBe(StockStatus.OUT_OF_STOCK);
      expect(getItemStockStatus(0, 0)).toBe(StockStatus.OUT_OF_STOCK);
      expect(getItemStockStatus(0, 10)).toBe(StockStatus.OUT_OF_STOCK);
    });

    it('returns LOW_STOCK when available > 0 and available < minStockAlert', () => {
      expect(getItemStockStatus(4, 5)).toBe(StockStatus.LOW_STOCK);
      expect(getItemStockStatus(1, 5)).toBe(StockStatus.LOW_STOCK);
      expect(getItemStockStatus(9, 10)).toBe(StockStatus.LOW_STOCK);
    });

    it('returns IN_STOCK when available >= minStockAlert and available > 0', () => {
      expect(getItemStockStatus(5, 5)).toBe(StockStatus.IN_STOCK);
      expect(getItemStockStatus(10, 5)).toBe(StockStatus.IN_STOCK);
      expect(getItemStockStatus(1, 0)).toBe(StockStatus.IN_STOCK);
      expect(getItemStockStatus(100, 10)).toBe(StockStatus.IN_STOCK);
    });

    it('throws when inputs are invalid, negative, or non-finite', () => {
      expect(() => getItemStockStatus(-1, 5)).toThrow(/non-negative finite number/);
      expect(() => getItemStockStatus(5, -1)).toThrow(/non-negative finite number/);
      expect(() => getItemStockStatus(Infinity, 5)).toThrow(/non-negative finite number/);
      expect(() => getItemStockStatus(5, Infinity)).toThrow(/non-negative finite number/);
      expect(() => getItemStockStatus(NaN, 5)).toThrow(/non-negative finite number/);
    });
  });

  describe('Location Hierarchy Domain Functions', () => {
    const mockLocations: LocationResponse[] = [
      {
        id: 'wh-1',
        code: 'WH-MAIN',
        name: 'Kho Tổng Lab',
        type: LocationType.WAREHOUSE,
        parentId: null,
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'rack-a',
        code: 'RACK-A',
        name: 'Kệ A',
        type: LocationType.RACK,
        parentId: 'wh-1',
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'rack-b',
        code: 'RACK-B',
        name: 'Kệ B',
        type: LocationType.RACK,
        parentId: 'wh-1',
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'shelf-a1',
        code: 'SHELF-A1',
        name: 'Tầng A1',
        type: LocationType.SHELF,
        parentId: 'rack-a',
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'bin-a1-1',
        code: 'BIN-A1-1',
        name: 'Khay A1-1',
        type: LocationType.BIN,
        parentId: 'shelf-a1',
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'bin-b1',
        code: 'BIN-B1',
        name: 'Khay B1',
        type: LocationType.BIN,
        parentId: 'rack-b', // Direct RACK -> BIN without SHELF (backward compatible)
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ];

    it('builds full hierarchical tree with accurate levels', () => {
      const tree = buildLocationTree(mockLocations);
      expect(tree).toHaveLength(1); // 1 root warehouse
      expect(tree[0].code).toBe('WH-MAIN');
      expect(tree[0].level).toBe(0);

      // Children of WH-MAIN
      expect(tree[0].children).toHaveLength(2); // RACK-A and RACK-B
      expect(tree[0].children[0].code).toBe('RACK-A');
      expect(tree[0].children[0].level).toBe(1);
      expect(tree[0].children[1].code).toBe('RACK-B');
      expect(tree[0].children[1].level).toBe(1);

      // RACK-A -> SHELF-A1 -> BIN-A1-1
      const rackA = tree[0].children[0];
      expect(rackA.children).toHaveLength(1);
      expect(rackA.children[0].code).toBe('SHELF-A1');
      expect(rackA.children[0].level).toBe(2);
      expect(rackA.children[0].children[0].code).toBe('BIN-A1-1');
      expect(rackA.children[0].children[0].level).toBe(3);

      // RACK-B -> BIN-B1 (direct RACK -> BIN)
      const rackB = tree[0].children[1];
      expect(rackB.children).toHaveLength(1);
      expect(rackB.children[0].code).toBe('BIN-B1');
      expect(rackB.children[0].level).toBe(2);
    });

    it('flattens tree into sequential IDs array', () => {
      const tree = buildLocationTree(mockLocations);
      const flattened = flattenLocationTree(tree);
      expect(flattened).toHaveLength(6);
      expect(flattened).toContain('wh-1');
      expect(flattened).toContain('rack-a');
      expect(flattened).toContain('shelf-a1');
      expect(flattened).toContain('bin-a1-1');
      expect(flattened).toContain('rack-b');
      expect(flattened).toContain('bin-b1');
    });

    it('detects circular parent hierarchy / descendant references accurately', () => {
      const simplified = [
        { id: 'wh-1', parentId: null },
        { id: 'rack-a', parentId: 'wh-1' },
        { id: 'shelf-a1', parentId: 'rack-a' },
        { id: 'bin-a1-1', parentId: 'shelf-a1' },
      ];

      // wh-1 is ancestor of shelf-a1 and bin-a1-1
      expect(isDescendantLocation(simplified, 'wh-1', 'wh-1')).toBe(true);
      expect(isDescendantLocation(simplified, 'wh-1', 'rack-a')).toBe(true);
      expect(isDescendantLocation(simplified, 'wh-1', 'bin-a1-1')).toBe(true);

      // rack-a is ancestor of shelf-a1 and bin-a1-1, but NOT wh-1
      expect(isDescendantLocation(simplified, 'rack-a', 'bin-a1-1')).toBe(true);
      expect(isDescendantLocation(simplified, 'rack-a', 'wh-1')).toBe(false);

      // bin-a1-1 is a leaf, not ancestor of any other
      expect(isDescendantLocation(simplified, 'bin-a1-1', 'wh-1')).toBe(false);
      expect(isDescendantLocation(simplified, 'bin-a1-1', 'rack-a')).toBe(false);
    });
  });
});
