// System Roles
export enum UserRole {
  ADMIN = 'ADMIN',
  LAB_MANAGER = 'LAB_MANAGER',
  TECHNICIAN = 'TECHNICIAN',
  STUDENT = 'STUDENT',
}

// Item Classification
export enum ItemType {
  CONSUMABLE = 'CONSUMABLE',      // Linh kiện tiêu hao: điện trở, LED, thiếc hàn
  TRACKED_ASSET = 'TRACKED_ASSET',// Linh kiện có barcode, kiểm soát mượn trả: Arduino, ESP32, Cảm biến
  EQUIPMENT = 'EQUIPMENT',        // Thiết bị máy móc phòng Lab: Máy hiện sóng, Trạm hàn, Máy in 3D
}

// Location Hierarchy Levels
export enum LocationType {
  WAREHOUSE = 'WAREHOUSE', // Kho tổng / Phòng thí nghiệm chính
  RACK = 'RACK',           // Kệ / Dãy giá đỡ
  SHELF = 'SHELF',         // Tầng kệ / Ngăn kệ
  BIN = 'BIN',             // Hộp / Khay linh kiện chi tiết
}

// Sorting and Filtering Enums
export enum ItemSortField {
  NAME = 'name',
  CODE = 'code',
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
  MIN_STOCK_ALERT = 'minStockAlert',
}

export enum LocationSortField {
  CODE = 'code',
  NAME = 'name',
  TYPE = 'type',
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
}

export enum StockTransactionSortField {
  TRANSACTION_NUMBER = 'transactionNumber',
  TYPE = 'type',
  STATUS = 'status',
  CREATED_AT = 'createdAt',
}

export enum StockMovementSortField {
  CREATED_AT = 'createdAt',
  QUANTITY_DELTA = 'quantityDelta',
  TYPE = 'type',
}

export enum StockBalanceSortField {
  ON_HAND = 'onHand',
  AVAILABLE = 'available',
  UPDATED_AT = 'updatedAt',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

// Transaction Types
export enum StockTransactionType {
  IMPORT = 'IMPORT',
  EXPORT = 'EXPORT',
  ADJUSTMENT = 'ADJUSTMENT',
  TRANSFER = 'TRANSFER',
}

// Transaction Status
export enum TransactionStatus {
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

// Reservation Status
export enum ReservationStatus {
  ACTIVE = 'ACTIVE',
  FULFILLED = 'FULFILLED',
  RELEASED = 'RELEASED',
}

// Borrow Request Status
export enum BorrowStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  HANDED_OVER = 'HANDED_OVER',
  RETURNED = 'RETURNED',
  PARTIALLY_RETURNED = 'PARTIALLY_RETURNED',
  CANCELLED = 'CANCELLED',
}

// Return Item Quality Condition
export enum AssetCondition {
  GOOD = 'GOOD',
  DAMAGED = 'DAMAGED',
  LOST = 'LOST',
}

// Stock Balance Numbers Interface
export interface StockBalanceValues {
  onHand: number;
  reserved: number;
  quarantined: number;
  kitAllocated: number;
  borrowed: number;
}

// Computed Stock Breakdown
export interface StockBreakdown extends StockBalanceValues {
  available: number;
}

// Item Category Summary
export interface ItemCategorySummary {
  id: string;
  code: string;
  name: string;
}

// Item Location Stock Detail
export interface ItemLocationBalance {
  id: string;
  locationId: string;
  location: {
    code: string;
    name: string;
  };
  onHand: number;
  reserved: number;
  quarantined: number;
  kitAllocated: number;
  borrowed: number;
  available: number;
}

// Stock Status Enum
export enum StockStatus {
  IN_STOCK = 'IN_STOCK',
  LOW_STOCK = 'LOW_STOCK',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
}

// Complete Item Response DTO
export interface ItemResponse {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  unit: string;
  type: ItemType;
  categoryId: string;
  category?: ItemCategorySummary;
  categoryName?: string;
  minStockAlert: number;
  imageUrl?: string | null;
  isActive: boolean;
  totalOnHand: number;
  totalReserved: number;
  totalQuarantined: number;
  totalKitAllocated: number;
  totalBorrowed: number;
  available: number;
  isLowStock: boolean;
  stockStatus: StockStatus;
  stockBalances?: ItemLocationBalance[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

// Location DTOs
export interface LocationSummary {
  id: string;
  code: string;
  name: string;
  type?: LocationType;
}

export interface LocationResponse {
  id: string;
  code: string;
  name: string;
  type: LocationType;
  parentId?: string | null;
  isActive: boolean;
  parent?: LocationSummary | null;
  childrenCount?: number;
  itemsCount?: number;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface LocationNode {
  id: string;
  code: string;
  name: string;
  type: LocationType;
  parentId?: string | null;
  isActive: boolean;
  children: LocationNode[];
  level?: number;
}

export type LocationTreeResponse = LocationNode[];

// Stock Balance DTOs
export interface StockBalanceResponse {
  id: string;
  itemId: string;
  locationId: string;
  item?: {
    id: string;
    code: string;
    name: string;
    unit: string;
    type: ItemType;
  };
  location?: {
    id: string;
    code: string;
    name: string;
    type: LocationType;
  };
  onHand: number;
  reserved: number;
  quarantined: number;
  kitAllocated: number;
  borrowed: number;
  available: number;
  isLowStock: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface InventorySummaryResponse {
  totalOnHand: number;
  totalReserved: number;
  totalQuarantined: number;
  totalKitAllocated: number;
  totalBorrowed: number;
  totalAvailable: number;
  lowStockItemCount: number;
  outOfStockItemCount?: number;
  inStockItemCount?: number;
  totalLocations: number;
  totalItems: number;
}

// Stock Transaction DTOs
export interface StockTransactionDetailResponse {
  id: string;
  stockTransactionId: string;
  itemId: string;
  item?: {
    id: string;
    code: string;
    name: string;
    unit: string;
  };
  locationId: string;
  location?: {
    id: string;
    code: string;
    name: string;
  };
  quantity: number;
  unitCost?: number | null;
  notes?: string | null;
  createdAt: string | Date;
}

export interface StockTransactionResponse {
  id: string;
  transactionNumber: string;
  type: StockTransactionType;
  status: TransactionStatus;
  notes?: string | null;
  createdById: string;
  createdBy?: {
    id: string;
    fullName: string;
    email: string;
  };
  details: StockTransactionDetailResponse[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

// Stock Movement DTO
export interface StockMovementResponse {
  id: string;
  itemId: string;
  item?: {
    id: string;
    code: string;
    name: string;
    unit: string;
  };
  locationId: string;
  location?: {
    id: string;
    code: string;
    name: string;
  };
  type: StockTransactionType;
  quantityDelta: number;
  onHandBefore: number;
  onHandAfter: number;
  referenceType: string;
  referenceId?: string | null;
  reason?: string | null;
  createdById?: string | null;
  createdBy?: {
    id: string;
    fullName: string;
  } | null;
  createdAt: string | Date;
}

// Pagination Metadata
export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

// Generic Paginated Response
export interface PaginatedResponse<T> {
  items: T[];
  meta: PaginationMeta;
}
