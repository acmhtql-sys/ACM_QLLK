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

export enum BorrowSortField {
  REQUEST_NUMBER = 'requestNumber',
  CREATED_AT = 'createdAt',
  EXPECTED_BORROW_DATE = 'expectedBorrowDate',
  EXPECTED_RETURN_DATE = 'expectedReturnDate',
  STATUS = 'status',
}

export enum UserSortField {
  FULL_NAME = 'fullName',
  EMAIL = 'email',
  ROLE = 'role',
  STUDENT_OR_STAFF_ID = 'studentOrStaffId',
  CREATED_AT = 'createdAt',
  IS_ACTIVE = 'isActive',
}

export enum KitSortField {
  CODE = 'code',
  NAME = 'name',
  STATUS = 'status',
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
}

export enum AuditLogSortField {
  CREATED_AT = 'createdAt',
  ACTION = 'action',
  ENTITY = 'entity',
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

// Kit Status
export enum KitStatus {
  AVAILABLE = 'AVAILABLE',
  ALLOCATED = 'ALLOCATED',
  MAINTENANCE = 'MAINTENANCE',
  RETIRED = 'RETIRED',
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

// Borrow Request Detail DTO
export interface BorrowDetailResponse {
  id: string;
  borrowRequestId: string;
  itemId: string;
  item?: {
    id: string;
    code: string;
    name: string;
    unit: string;
  };
  assetId?: string | null;
  quantity: number;
  returnedQuantity: number;
  notes?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// Return Detail DTO
export interface ReturnDetailResponse {
  id: string;
  returnTransactionId: string;
  itemId: string;
  item?: {
    id: string;
    code: string;
    name: string;
    unit: string;
  };
  assetId?: string | null;
  quantity: number;
  condition: AssetCondition;
  notes?: string | null;
  createdAt: string | Date;
}

// Return Transaction DTO
export interface ReturnTransactionResponse {
  id: string;
  returnNumber: string;
  borrowRequestId: string;
  receiverId: string;
  receiver?: {
    id: string;
    fullName: string;
    email: string;
  };
  notes?: string | null;
  details: ReturnDetailResponse[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

// Stock Reservation DTO
export interface StockReservationResponse {
  id: string;
  borrowRequestId: string;
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
  status: ReservationStatus;
  expiresAt?: string | Date | null;
  createdAt: string | Date;
}

// Borrow Request DTO
export interface BorrowRequestResponse {
  id: string;
  requestNumber: string;
  borrowerId: string;
  borrower?: {
    id: string;
    fullName: string;
    email: string;
  };
  borrowerName?: string;
  borrowerEmail?: string;
  approverId?: string | null;
  approver?: {
    id: string;
    fullName: string;
    email: string;
  } | null;
  approverName?: string | null;
  status: BorrowStatus;
  purpose: string;
  expectedBorrowDate: string | Date;
  expectedReturnDate: string | Date;
  actualBorrowDate?: string | Date | null;
  actualReturnDate?: string | Date | null;
  rejectionReason?: string | null;
  notes?: string | null;
  itemCount: number;
  details: BorrowDetailResponse[];
  reservations?: StockReservationResponse[];
  returnTransactions?: ReturnTransactionResponse[];
  isOverdue: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// User Response DTO
export interface UserResponse {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  roleId?: string;
  studentOrStaffId?: string | null;
  department?: string | null;
  phoneNumber?: string | null;
  isActive: boolean;
  isLocked: boolean;
  failedLoginAttempts: number;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// Kit Item Response DTO
export interface KitItemResponse {
  id: string;
  kitId: string;
  itemId: string;
  item?: {
    id: string;
    code: string;
    name: string;
    unit: string;
    type: ItemType;
  };
  quantity: number;
  notes?: string | null;
  createdAt: string | Date;
}

// Kit Response DTO
export interface KitResponse {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  status: KitStatus;
  locationId?: string | null;
  location?: {
    id: string;
    code: string;
    name: string;
  } | null;
  createdById?: string | null;
  createdBy?: {
    id: string;
    fullName: string;
    email: string;
  } | null;
  items: KitItemResponse[];
  totalItems: number;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// Audit Log Response DTO
export interface AuditLogResponse {
  id: string;
  userId?: string | null;
  user?: {
    id: string;
    fullName: string;
    email: string;
    role?: UserRole;
  } | null;
  action: string;
  entity: string;
  entityId: string;
  oldValue?: any;
  newValue?: any;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string | Date;
}

// Dashboard KPI Metrics DTO
export interface DashboardKpisResponse {
  totalItems: number;
  totalOnHand: number;
  totalAvailable: number;
  totalReserved: number;
  totalBorrowed: number;
  totalQuarantined: number;
  totalKitAllocated: number;
  activeBorrows: number;
  pendingApprovalBorrows: number;
  overdueBorrows: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalKits: number;
  activeKits: number;
}

// Dashboard Distribution Chart Item
export interface DashboardDistributionItem {
  name: string;
  value: number;
  color?: string;
}

// Dashboard Monthly Trend Point
export interface DashboardMonthlyTrend {
  month: string;
  imports: number;
  exports: number;
  borrows: number;
}

// Complete Dashboard Summary Response
export interface DashboardSummaryResponse {
  kpis: DashboardKpisResponse;
  distribution: DashboardDistributionItem[];
  monthlyTrends: DashboardMonthlyTrend[];
}

// Inventory Valuation & Breakdown Report Item
export interface InventoryReportItem {
  id: string;
  code: string;
  name: string;
  unit: string;
  type: ItemType;
  categoryName: string;
  onHand: number;
  reserved: number;
  quarantined: number;
  kitAllocated: number;
  borrowed: number;
  available: number;
  minStockAlert: number;
  stockStatus: StockStatus;
}

// Borrow & Return Operational Report Summary
export interface BorrowReturnReportSummary {
  totalRequests: number;
  approvedCount: number;
  handedOverCount: number;
  returnedCount: number;
  partiallyReturnedCount: number;
  rejectedCount: number;
  cancelledCount: number;
  overdueCount: number;
  returnRatePercent: number;
  damagedOrLostCount: number;
}

// Low & Out of Stock Critical Alert Item
export interface LowStockAlertItem {
  id: string;
  code: string;
  name: string;
  unit: string;
  categoryName: string;
  onHand: number;
  available: number;
  minStockAlert: number;
  stockStatus: StockStatus;
  urgencyRatio: number;
}

// Overdue Loan Item Detail
export interface OverdueLoanItem {
  id: string;
  requestNumber: string;
  borrowerName?: string;
  borrowerEmail?: string;
  borrowerPhone?: string | null;
  purpose?: string | null;
  expectedBorrowDate: string | Date;
  expectedReturnDate: string | Date;
  daysOverdue: number;
  items: {
    code?: string;
    name?: string;
    quantity: number;
    returnedQuantity: number;
  }[];
}

// Complete Borrow & Return Report Response
export interface BorrowReturnReportResponse {
  summary: BorrowReturnReportSummary;
  overdueList: OverdueLoanItem[];
}

