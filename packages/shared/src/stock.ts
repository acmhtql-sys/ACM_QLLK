import { StockBalanceValues, StockBreakdown, LocationResponse, LocationNode, StockStatus } from './types';

/**
 * Calculates Available Stock based on ACM Business Rules:
 * Available = On-hand - Reserved - Quarantined - KitAllocated
 *
 * NOTE: Borrowed is NOT deducted from On-hand here because On-hand represents
 * physical inventory currently in the lab warehouse. When assets are handed over,
 * On-hand is deducted and Borrowed is increased. Deducting Borrowed again would
 * double-count the reduction.
 */
export function calculateAvailableStock(balance: StockBalanceValues): number {
  validateStockValues(balance);
  const available = balance.onHand - balance.reserved - balance.quarantined - balance.kitAllocated;
  return Math.max(0, available);
}

/**
 * Computes full stock breakdown including validated Available quantity
 */
export function computeStockBreakdown(balance: StockBalanceValues): StockBreakdown {
  const available = calculateAvailableStock(balance);
  return {
    ...balance,
    available,
  };
}

/**
 * Validates that all stock values are non-negative integers and allocations do not exceed On-hand
 */
export function validateStockValues(balance: StockBalanceValues): void {
  const entries: [string, number][] = [
    ['onHand', balance.onHand],
    ['reserved', balance.reserved],
    ['quarantined', balance.quarantined],
    ['kitAllocated', balance.kitAllocated],
    ['borrowed', balance.borrowed],
  ];

  for (const [key, value] of entries) {
    if (typeof value !== 'number' || isNaN(value) || !Number.isFinite(value)) {
      throw new Error(`Stock quantity '${key}' must be a valid finite number`);
    }
    if (!Number.isInteger(value)) {
      throw new Error(`Stock quantity '${key}' must be an integer (received: ${value})`);
    }
    if (value < 0) {
      throw new Error(`Stock quantity '${key}' cannot be negative (received: ${value})`);
    }
  }

  // Ensure reserved + quarantined + kitAllocated does not exceed onHand in warehouse
  const totalAllocatedInWarehouse = balance.reserved + balance.quarantined + balance.kitAllocated;
  if (totalAllocatedInWarehouse > balance.onHand) {
    throw new Error(
      `Invalid stock distribution: Reserved (${balance.reserved}) + Quarantined (${balance.quarantined}) + KitAllocated (${balance.kitAllocated}) exceeds On-hand (${balance.onHand})`
    );
  }
}

/**
 * Comprehensive domain invariant check for stock balances
 */
export function validateStockInvariant(balance: StockBalanceValues): void {
  validateStockValues(balance);
  const available = balance.onHand - balance.reserved - balance.quarantined - balance.kitAllocated;
  if (available < 0) {
    throw new Error(`Stock invariant violated: available quantity cannot be negative (calculated: ${available})`);
  }
}

/**
 * Checks whether an export quantity can be fulfilled from current stock balance.
 * Business Rule: Export quantity must be <= Available stock.
 */
export function canExportStock(balance: StockBalanceValues, exportQuantity: number): boolean {
  if (
    typeof exportQuantity !== 'number' ||
    isNaN(exportQuantity) ||
    !Number.isFinite(exportQuantity) ||
    !Number.isInteger(exportQuantity) ||
    exportQuantity <= 0
  ) {
    throw new Error(`Export quantity must be a positive integer (received: ${exportQuantity})`);
  }

  const available = calculateAvailableStock(balance);
  return exportQuantity <= available;
}

/**
 * Calculates stock balance deltas for a transfer transaction between two locations.
 * Invariant: Sum of deltas must equal zero (Conservation of stock items).
 */
export function calculateTransferDelta(quantity: number): {
  fromDelta: number;
  toDelta: number;
  netDelta: number;
} {
  if (
    typeof quantity !== 'number' ||
    isNaN(quantity) ||
    !Number.isFinite(quantity) ||
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    throw new Error(`Transfer quantity must be a positive integer (received: ${quantity})`);
  }

  const fromDelta = -quantity;
  const toDelta = quantity;
  const netDelta = fromDelta + toDelta;

  return {
    fromDelta,
    toDelta,
    netDelta,
  };
}

/**
 * Calculates the delta and type of change for a stock count adjustment.
 * Business Rule: Delta = ActualOnHand - CurrentOnHand.
 */
export function calculateAdjustmentDelta(
  currentOnHand: number,
  actualOnHand: number
): { delta: number; isReduction: boolean } {
  if (
    typeof currentOnHand !== 'number' ||
    isNaN(currentOnHand) ||
    !Number.isFinite(currentOnHand) ||
    !Number.isInteger(currentOnHand) ||
    currentOnHand < 0
  ) {
    throw new Error(`Current onHand must be a non-negative integer (received: ${currentOnHand})`);
  }

  if (
    typeof actualOnHand !== 'number' ||
    isNaN(actualOnHand) ||
    !Number.isFinite(actualOnHand) ||
    !Number.isInteger(actualOnHand) ||
    actualOnHand < 0
  ) {
    throw new Error(`Actual onHand must be a non-negative integer (received: ${actualOnHand})`);
  }

  const delta = actualOnHand - currentOnHand;
  return {
    delta,
    isReduction: delta < 0,
  };
}

/**
 * Determines whether an item is currently below minimum stock alert threshold.
 * Business Rule: Low stock condition is met when Available < minStockAlert.
 */
export function isLowStock(available: number, minStockAlert: number): boolean {
  if (
    typeof available !== 'number' ||
    isNaN(available) ||
    !Number.isFinite(available) ||
    available < 0
  ) {
    throw new Error(`Available quantity must be a non-negative finite number (received: ${available})`);
  }
  if (
    typeof minStockAlert !== 'number' ||
    isNaN(minStockAlert) ||
    !Number.isFinite(minStockAlert) ||
    minStockAlert < 0
  ) {
    throw new Error(`minStockAlert must be a non-negative finite number (received: ${minStockAlert})`);
  }
  return available < minStockAlert;
}

/**
 * Determines item stock status based on available stock and configured minStockAlert threshold:
 * - OUT_OF_STOCK (Đã hết): available <= 0
 * - LOW_STOCK (Sắp hết): 0 < available < minStockAlert (when minStockAlert > 0)
 * - IN_STOCK (Sẵn sàng): available >= minStockAlert and available > 0
 */
export function getItemStockStatus(available: number, minStockAlert: number): StockStatus {
  if (
    typeof available !== 'number' ||
    isNaN(available) ||
    !Number.isFinite(available) ||
    available < 0
  ) {
    throw new Error(`Available quantity must be a non-negative finite number (received: ${available})`);
  }
  if (
    typeof minStockAlert !== 'number' ||
    isNaN(minStockAlert) ||
    !Number.isFinite(minStockAlert) ||
    minStockAlert < 0
  ) {
    throw new Error(`minStockAlert must be a non-negative finite number (received: ${minStockAlert})`);
  }

  if (available <= 0) {
    return StockStatus.OUT_OF_STOCK;
  }
  if (isLowStock(available, minStockAlert)) {
    return StockStatus.LOW_STOCK;
  }
  return StockStatus.IN_STOCK;
}

/**
 * Builds a hierarchical location tree from a flat list of location records.
 * Supports WAREHOUSE -> RACK -> SHELF -> BIN and arbitrary depth structures.
 */
export function buildLocationTree(locations: LocationResponse[]): LocationNode[] {
  const nodeMap = new Map<string, LocationNode>();

  // 1. Initialize all nodes
  for (const loc of locations) {
    nodeMap.set(loc.id, {
      id: loc.id,
      code: loc.code,
      name: loc.name,
      type: loc.type,
      parentId: loc.parentId,
      isActive: loc.isActive,
      children: [],
      level: 0,
    });
  }

  const rootNodes: LocationNode[] = [];

  // 2. Link children to their parent or register as root
  for (const loc of locations) {
    const node = nodeMap.get(loc.id)!;
    if (loc.parentId && nodeMap.has(loc.parentId)) {
      const parentNode = nodeMap.get(loc.parentId)!;
      parentNode.children.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  // 3. Compute levels and sort children recursively
  function processLevelAndSort(nodes: LocationNode[], currentLevel: number): void {
    nodes.sort((a, b) => a.code.localeCompare(b.code));
    for (const node of nodes) {
      node.level = currentLevel;
      if (node.children.length > 0) {
        processLevelAndSort(node.children, currentLevel + 1);
      }
    }
  }

  processLevelAndSort(rootNodes, 0);
  return rootNodes;
}

/**
 * Flattens a location tree into an array of IDs in traversal order.
 */
export function flattenLocationTree(tree: LocationNode[]): string[] {
  const ids: string[] = [];
  function traverse(nodes: LocationNode[]) {
    for (const node of nodes) {
      ids.push(node.id);
      if (node.children.length > 0) {
        traverse(node.children);
      }
    }
  }
  traverse(tree);
  return ids;
}

/**
 * Checks whether targetId is ancestorId itself or a descendant of ancestorId.
 * Used to prevent circular hierarchies when changing parentId of a location.
 */
export function isDescendantLocation(
  locations: Array<{ id: string; parentId?: string | null }>,
  ancestorId: string,
  targetId: string
): boolean {
  if (ancestorId === targetId) return true;

  // Build parent -> children adjacency map
  const childrenMap = new Map<string, string[]>();
  for (const loc of locations) {
    if (loc.parentId) {
      const existing = childrenMap.get(loc.parentId) || [];
      existing.push(loc.id);
      childrenMap.set(loc.parentId, existing);
    }
  }

  // BFS / DFS from ancestorId
  const queue = [ancestorId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const children = childrenMap.get(current) || [];
    for (const childId of children) {
      if (childId === targetId) return true;
      if (!visited.has(childId)) {
        queue.push(childId);
      }
    }
  }

  return false;
}
