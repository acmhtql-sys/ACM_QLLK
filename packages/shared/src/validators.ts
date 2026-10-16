import { z } from 'zod';
import {
  UserRole,
  ItemType,
  ItemSortField,
  SortOrder,
  StockTransactionType,
  TransactionStatus,
  LocationType,
  LocationSortField,
  StockTransactionSortField,
  StockMovementSortField,
  StockBalanceSortField,
  BorrowSortField,
  BorrowStatus,
  AssetCondition,
  StockStatus,
  KitStatus,
  UserSortField,
  KitSortField,
  AuditLogSortField,
} from './types';

// Auth validation schemas
export const loginSchema = z.object({
  email: z.string().email('Email không đúng định dạng'),
  password: z.string().min(6, 'Mật khẩu phải có ít nhất 6 ký tự'),
});

export const createUserSchema = z.object({
  email: z.string().email('Email không đúng định dạng'),
  password: z.string().min(6, 'Mật khẩu phải có ít nhất 6 ký tự'),
  fullName: z.string().min(2, 'Họ tên phải có ít nhất 2 ký tự'),
  role: z.nativeEnum(UserRole).default(UserRole.STUDENT),
  studentOrStaffId: z.string().optional(),
  department: z.string().optional(),
  phoneNumber: z.string().optional(),
});

// User update schema (empty object is rejected)
export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Họ tên phải có ít nhất 2 ký tự').optional(),
    role: z.nativeEnum(UserRole).optional(),
    studentOrStaffId: z.string().trim().optional().nullable(),
    department: z.string().trim().optional().nullable(),
    phoneNumber: z.string().trim().optional().nullable(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Dữ liệu cập nhật người dùng không được để trống',
  });

// User status update schema (Activate/Deactivate or Lock/Unlock)
export const updateUserStatusSchema = z
  .object({
    isActive: z.boolean({ invalid_type_error: 'Trạng thái hoạt động phải là boolean' }).optional(),
    isLocked: z.boolean({ invalid_type_error: 'Trạng thái khóa phải là boolean' }).optional(),
    reason: z.string().trim().max(255, 'Lý do thay đổi trạng thái tối đa 255 ký tự').optional(),
  })
  .strict()
  .refine((data) => data.isActive !== undefined || data.isLocked !== undefined, {
    message: 'Phải chỉ định ít nhất một trạng thái cần thay đổi (isActive hoặc isLocked)',
  });

// Admin reset password schema
export const resetUserPasswordSchema = z
  .object({
    newPassword: z.string().min(6, 'Mật khẩu mới phải có ít nhất 6 ký tự'),
  })
  .strict();

// Helper to safely parse boolean query params without silently ignoring invalid strings
export const booleanQueryParam = z.preprocess((val) => {
  if (val === undefined || val === null || val === '') return undefined;
  if (val === 'true' || val === true) return true;
  if (val === 'false' || val === false) return false;
  return val; // Returns raw value so z.boolean throws error instead of silently passing undefined
}, z.boolean({ invalid_type_error: 'Giá trị lọc phải là true hoặc false' }).optional());

// Query users schema
export const queryUsersSchema = z.object({
  search: z.string().trim().optional(),
  role: z.nativeEnum(UserRole).optional(),
  isActive: booleanQueryParam,
  isLocked: booleanQueryParam,
  department: z.string().trim().optional(),
  sortBy: z.nativeEnum(UserSortField).default(UserSortField.CREATED_AT),
  sortOrder: z.nativeEnum(SortOrder).default(SortOrder.DESC),
  page: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 20), z.number().int().min(1).max(100).default(20)),
});


// Category schema
export const createCategorySchema = z.object({
  name: z.string().min(2, 'Tên danh mục phải có ít nhất 2 ký tự'),
  code: z.string().min(2, 'Mã danh mục phải có ít nhất 2 ký tự'),
  description: z.string().optional(),
  parentId: z.string().uuid().optional().nullable(),
});

// Item create schema
export const createItemSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2, 'Mã linh kiện/thiết bị phải có ít nhất 2 ký tự')
      .max(50, 'Mã linh kiện/thiết bị tối đa 50 ký tự')
      .regex(/^[A-Za-z0-9_.\-]+$/, 'Mã linh kiện chỉ được chứa chữ cái, số, dấu gạch ngang (-), gạch dưới (_) và dấu chấm (.)'),
    name: z.string().trim().min(2, 'Tên linh kiện/thiết bị phải có ít nhất 2 ký tự'),
    description: z.string().optional().nullable(),
    unit: z.string().trim().min(1, 'Đơn vị tính là bắt buộc'),
    type: z.nativeEnum(ItemType).default(ItemType.CONSUMABLE),
    categoryId: z.string().uuid('ID danh mục không hợp lệ'),
    minStockAlert: z.number().int().min(0, 'Mức cảnh báo tồn kho tối thiểu không được âm').default(5),
    imageUrl: z.string().url('URL hình ảnh không hợp lệ').optional().nullable().or(z.literal('')),
  })
  .strict();

// Item update schema (Stock is NOT editable directly via Items API; empty object is rejected)
export const updateItemSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2, 'Mã linh kiện/thiết bị phải có ít nhất 2 ký tự')
      .max(50, 'Mã linh kiện/thiết bị tối đa 50 ký tự')
      .regex(/^[A-Za-z0-9_.\-]+$/, 'Mã linh kiện chỉ được chứa chữ cái, số, dấu gạch ngang (-), gạch dưới (_) và dấu chấm (.)')
      .optional(),
    name: z.string().trim().min(2, 'Tên linh kiện/thiết bị phải có ít nhất 2 ký tự').optional(),
    description: z.string().optional().nullable(),
    unit: z.string().trim().min(1, 'Đơn vị tính là bắt buộc').optional(),
    type: z.nativeEnum(ItemType).optional(),
    categoryId: z.string().uuid('ID danh mục không hợp lệ').optional(),
    minStockAlert: z.number().int().min(0, 'Mức cảnh báo tồn kho tối thiểu không được âm').optional(),
    imageUrl: z.string().url('URL hình ảnh không hợp lệ').optional().nullable().or(z.literal('')),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Dữ liệu cập nhật không được để trống',
  });

// Item status update schema (Soft deactivation / reactivation)
export const updateItemStatusSchema = z
  .object({
    isActive: z.boolean({ required_error: 'Trạng thái hoạt động là bắt buộc' }),
    reason: z.string().max(255, 'Lý do thay đổi trạng thái tối đa 255 ký tự').optional(),
  })
  .strict();

// Query items schema with pagination, filtering and sorting
export const queryItemsSchema = z
  .object({
    search: z.string().trim().optional(),
    categoryId: z.string().uuid('ID danh mục không hợp lệ').optional(),
    type: z.nativeEnum(ItemType).optional(),
    isActive: booleanQueryParam,
    isLowStock: booleanQueryParam,
    stockStatus: z.nativeEnum(StockStatus).optional(),
    barcode: z.string().trim().optional(),
    sortBy: z.nativeEnum(ItemSortField).default(ItemSortField.CREATED_AT),
    sortOrder: z.nativeEnum(SortOrder).default(SortOrder.DESC),
    page: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 1), z.number().int().min(1).default(1)),
    limit: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 20), z.number().int().min(1).max(100).default(20)),
  });

// ==========================================
// LOCATION SCHEMAS
// ==========================================

export const createLocationSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2, 'Mã vị trí phải có ít nhất 2 ký tự')
      .max(50, 'Mã vị trí tối đa 50 ký tự')
      .regex(/^[A-Za-z0-9_-]+$/, 'Mã vị trí chỉ được chứa chữ cái, số, dấu gạch ngang (-) và gạch dưới (_)'),
    name: z.string().trim().min(2, 'Tên vị trí phải có ít nhất 2 ký tự').max(100, 'Tên vị trí tối đa 100 ký tự'),
    type: z.nativeEnum(LocationType).default(LocationType.WAREHOUSE),
    parentId: z.string().uuid('ID vị trí cha không hợp lệ').optional().nullable(),
  })
  .strict();

export const updateLocationSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2, 'Mã vị trí phải có ít nhất 2 ký tự')
      .max(50, 'Mã vị trí tối đa 50 ký tự')
      .regex(/^[A-Za-z0-9_-]+$/, 'Mã vị trí chỉ được chứa chữ cái, số, dấu gạch ngang (-) và gạch dưới (_)')
      .optional(),
    name: z.string().trim().min(2, 'Tên vị trí phải có ít nhất 2 ký tự').max(100, 'Tên vị trí tối đa 100 ký tự').optional(),
    type: z.nativeEnum(LocationType).optional(),
    parentId: z.string().uuid('ID vị trí cha không hợp lệ').optional().nullable(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Dữ liệu cập nhật không được để trống',
  });

export const updateLocationStatusSchema = z
  .object({
    isActive: z.boolean({ required_error: 'Trạng thái hoạt động là bắt buộc' }),
    reason: z.string().trim().max(255, 'Lý do thay đổi trạng thái tối đa 255 ký tự').optional(),
  })
  .strict();

export const queryLocationsSchema = z.object({
  search: z.string().trim().optional(),
  type: z.nativeEnum(LocationType).optional(),
  isActive: booleanQueryParam,
  parentId: z.string().uuid('ID vị trí cha không hợp lệ').optional().nullable().or(z.literal('null')),
  sortBy: z.nativeEnum(LocationSortField).default(LocationSortField.CODE),
  sortOrder: z.nativeEnum(SortOrder).default(SortOrder.ASC),
  page: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 20), z.number().int().min(1).max(100).default(20)),
});

export const queryLocationTreeSchema = z.object({
  includeInactive: booleanQueryParam,
});

// ==========================================
// STOCK BALANCE & INVENTORY QUERY SCHEMAS
// ==========================================

export const stockBalanceSchema = z.object({
  itemId: z.string().uuid(),
  locationId: z.string().uuid(),
  onHand: z.number().int().min(0),
  reserved: z.number().int().min(0).default(0),
  quarantined: z.number().int().min(0).default(0),
  kitAllocated: z.number().int().min(0).default(0),
  borrowed: z.number().int().min(0).default(0),
});

export const queryStockBalancesSchema = z.object({
  search: z.string().trim().optional(),
  itemId: z.string().uuid('ID linh kiện không hợp lệ').optional(),
  locationId: z.string().uuid('ID vị trí không hợp lệ').optional(),
  isLowStock: booleanQueryParam,
  sortBy: z.nativeEnum(StockBalanceSortField).default(StockBalanceSortField.UPDATED_AT),
  sortOrder: z.nativeEnum(SortOrder).default(SortOrder.DESC),
  page: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 20), z.number().int().min(1).max(100).default(20)),
});

// ==========================================
// STOCK TRANSACTION SCHEMAS (IMPORT, EXPORT, TRANSFER, ADJUSTMENT)
// Note: Strict mode rejects all direct balance updates (onHand, reserved, etc.)
// ==========================================

// Import
export const importStockItemSchema = z
  .object({
    itemId: z.string().uuid('ID linh kiện không hợp lệ'),
    locationId: z.string().uuid('ID vị trí kho không hợp lệ'),
    quantity: z.number().int('Số lượng phải là số nguyên').positive('Số lượng nhập kho phải lớn hơn 0'),
    unitCost: z.number().min(0, 'Đơn giá không được âm').optional().nullable(),
    notes: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự').optional().nullable(),
  })
  .strict();

export const importStockSchema = z
  .object({
    notes: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự').optional().nullable(),
    idempotencyKey: z.string().trim().min(1).max(64).optional(),
    items: z
      .array(importStockItemSchema)
      .min(1, 'Phiếu nhập kho phải có ít nhất 1 mặt hàng')
      .max(100, 'Phiếu nhập kho tối đa 100 mặt hàng mỗi lần'),
  })
  .strict()
  .refine(
    (data) => {
      const seen = new Set<string>();
      for (const item of data.items) {
        const key = `${item.itemId}:${item.locationId}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
    {
      message: 'Không được trùng lặp linh kiện tại cùng một vị trí trong cùng một phiếu nhập',
    }
  );

// Export
export const exportStockItemSchema = z
  .object({
    itemId: z.string().uuid('ID linh kiện không hợp lệ'),
    locationId: z.string().uuid('ID vị trí kho không hợp lệ'),
    quantity: z.number().int('Số lượng phải là số nguyên').positive('Số lượng xuất kho phải lớn hơn 0'),
    reason: z.string().trim().min(3, 'Lý do xuất kho phải có ít nhất 3 ký tự').max(500, 'Lý do xuất kho tối đa 500 ký tự').optional().nullable(),
    notes: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự').optional().nullable(),
  })
  .strict();

export const exportStockSchema = z
  .object({
    reason: z.string().trim().min(3, 'Lý do xuất kho phải có ít nhất 3 ký tự').max(500, 'Lý do xuất kho tối đa 500 ký tự'),
    notes: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự').optional().nullable(),
    idempotencyKey: z.string().trim().min(1).max(64).optional(),
    items: z
      .array(exportStockItemSchema)
      .min(1, 'Phiếu xuất kho phải có ít nhất 1 mặt hàng')
      .max(100, 'Phiếu xuất kho tối đa 100 mặt hàng mỗi lần'),
  })
  .strict()
  .refine(
    (data) => {
      const seen = new Set<string>();
      for (const item of data.items) {
        const key = `${item.itemId}:${item.locationId}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
    {
      message: 'Không được trùng lặp linh kiện tại cùng một vị trí trong cùng một phiếu xuất',
    }
  );

// Transfer
export const transferStockItemSchema = z
  .object({
    itemId: z.string().uuid('ID linh kiện không hợp lệ'),
    fromLocationId: z.string().uuid('ID vị trí nguồn không hợp lệ').optional(),
    toLocationId: z.string().uuid('ID vị trí đích không hợp lệ').optional(),
    quantity: z.number().int('Số lượng phải là số nguyên').positive('Số lượng điều chuyển phải lớn hơn 0'),
    reason: z.string().trim().max(500, 'Lý do dòng điều chuyển tối đa 500 ký tự').optional().nullable(),
    notes: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự').optional().nullable(),
  })
  .strict();

export const transferStockSchema = z
  .object({
    fromLocationId: z.string().uuid('ID vị trí nguồn không hợp lệ').optional(),
    toLocationId: z.string().uuid('ID vị trí đích không hợp lệ').optional(),
    reason: z.string().trim().min(5, 'Lý do điều chuyển kho phải có ít nhất 5 ký tự').max(500, 'Lý do điều chuyển tối đa 500 ký tự'),
    notes: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự').optional().nullable(),
    idempotencyKey: z.string().trim().min(8, 'Khóa Idempotency tối thiểu 8 ký tự').max(64, 'Khóa Idempotency tối đa 64 ký tự').regex(/^[a-zA-Z0-9_-]+$/, 'Định dạng Idempotency-Key không hợp lệ').optional(),
    items: z
      .array(transferStockItemSchema)
      .min(1, 'Phiếu điều chuyển phải có ít nhất 1 mặt hàng')
      .max(100, 'Phiếu điều chuyển tối đa 100 mặt hàng mỗi lần'),
  })
  .strict()
  .refine(
    (data) => {
      for (const item of data.items) {
        const from = item.fromLocationId || data.fromLocationId;
        const to = item.toLocationId || data.toLocationId;
        if (!from || !to) return false;
      }
      return true;
    },
    {
      message: 'Vị trí nguồn và vị trí đích phải được xác định cho tất cả mặt hàng điều chuyển',
    }
  )
  .refine(
    (data) => {
      for (const item of data.items) {
        const from = item.fromLocationId || data.fromLocationId;
        const to = item.toLocationId || data.toLocationId;
        if (from && to && from === to) return false;
      }
      return true;
    },
    {
      message: 'Vị trí nguồn và vị trí đích không được trùng nhau',
      path: ['toLocationId'],
    }
  )
  .refine(
    (data) => {
      const seen = new Set<string>();
      for (const item of data.items) {
        const from = item.fromLocationId || data.fromLocationId;
        const to = item.toLocationId || data.toLocationId;
        const key = `${item.itemId}:${from}:${to}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
    {
      message: 'Không được trùng lặp mặt hàng trong cùng một phiếu điều chuyển',
    }
  );

// Adjustment
export const adjustStockItemSchema = z
  .object({
    itemId: z.string().uuid('ID linh kiện không hợp lệ'),
    locationId: z.string().uuid('ID vị trí kiểm kê không hợp lệ').optional(),
    actualOnHand: z.number().int('Số lượng tồn thực tế phải là số nguyên').min(0, 'Số lượng tồn thực tế không được âm'),
    reason: z.string().trim().max(500, 'Lý do dòng điều chỉnh tối đa 500 ký tự').optional().nullable(),
    notes: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự').optional().nullable(),
  })
  .strict();

export const adjustStockSchema = z
  .object({
    locationId: z.string().uuid('ID vị trí kiểm kê không hợp lệ').optional(),
    reason: z.string().trim().min(5, 'Lý do điều chỉnh tồn kho phải có ít nhất 5 ký tự').max(500, 'Lý do điều chỉnh tối đa 500 ký tự'),
    notes: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự').optional().nullable(),
    idempotencyKey: z.string().trim().min(8, 'Khóa Idempotency tối thiểu 8 ký tự').max(64, 'Khóa Idempotency tối đa 64 ký tự').regex(/^[a-zA-Z0-9_-]+$/, 'Định dạng Idempotency-Key không hợp lệ').optional(),
    items: z
      .array(adjustStockItemSchema)
      .min(1, 'Phiếu điều chỉnh phải có ít nhất 1 mặt hàng')
      .max(100, 'Phiếu điều chỉnh tối đa 100 mặt hàng mỗi lần'),
  })
  .strict()
  .refine(
    (data) => {
      for (const item of data.items) {
        if (!item.locationId && !data.locationId) return false;
      }
      return true;
    },
    {
      message: 'Vị trí kho phải được cung cấp ở cấp phiếu hoặc trên từng dòng mặt hàng',
      path: ['locationId'],
    }
  )
  .refine(
    (data) => {
      const seen = new Set<string>();
      for (const item of data.items) {
        const loc = item.locationId || data.locationId;
        const key = `${item.itemId}:${loc}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
    {
      message: 'Không được trùng lặp linh kiện tại cùng một vị trí trong cùng một phiếu điều chỉnh',
    }
  );

// Adjustment V2 (Concurrency Protected with Snapshot Validation - Step S2B)
export const adjustStockItemSchemaV2 = z
  .object({
    itemId: z.string().uuid('ID linh kiện không hợp lệ'),
    locationId: z.string().uuid('ID vị trí kiểm kê không hợp lệ').optional(),
    expectedOnHand: z
      .number({ required_error: 'Số lượng tồn sổ sách (expectedOnHand) là bắt buộc' })
      .int('Số lượng tồn sổ sách phải là số nguyên')
      .min(0, 'Số lượng tồn sổ sách không được âm'),
    expectedReserved: z
      .number({ required_error: 'Số lượng đã giữ chỗ (expectedReserved) là bắt buộc' })
      .int('Số lượng đã giữ chỗ phải là số nguyên')
      .min(0, 'Số lượng đã giữ chỗ không được âm'),
    expectedQuarantined: z
      .number({ required_error: 'Số lượng cách ly (expectedQuarantined) là bắt buộc' })
      .int('Số lượng cách ly phải là số nguyên')
      .min(0, 'Số lượng cách ly không được âm'),
    expectedKitAllocated: z
      .number({ required_error: 'Số lượng kit (expectedKitAllocated) là bắt buộc' })
      .int('Số lượng kit phải là số nguyên')
      .min(0, 'Số lượng kit không được âm'),
    actualOnHand: z
      .number({ required_error: 'Số lượng kiểm đếm thực tế (actualOnHand) là bắt buộc' })
      .int('Số lượng kiểm đếm thực tế phải là số nguyên')
      .min(0, 'Số lượng kiểm đếm thực tế không được âm'),
    reason: z.string().trim().max(500, 'Lý do dòng điều chỉnh tối đa 500 ký tự').optional().nullable(),
    notes: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự').optional().nullable(),
  })
  .strict();

export const adjustStockSchemaV2 = z
  .object({
    locationId: z.string().uuid('ID vị trí kiểm kê không hợp lệ').optional(),
    reason: z
      .string({ required_error: 'Lý do điều chỉnh tồn kho là bắt buộc' })
      .trim()
      .min(5, 'Lý do điều chỉnh tồn kho phải có ít nhất 5 ký tự')
      .max(500, 'Lý do điều chỉnh tối đa 500 ký tự'),
    notes: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự').optional().nullable(),
    items: z
      .array(adjustStockItemSchemaV2)
      .min(1, 'Phiếu điều chỉnh phải có ít nhất 1 mặt hàng')
      .max(100, 'Phiếu điều chỉnh tối đa 100 mặt hàng mỗi lần'),
  })
  .strict()
  .refine(
    (data) => {
      for (const item of data.items) {
        if (!item.locationId && !data.locationId) return false;
      }
      return true;
    },
    {
      message: 'Vị trí kho phải được cung cấp ở cấp phiếu hoặc trên từng dòng mặt hàng',
      path: ['locationId'],
    }
  )
  .refine(
    (data) => {
      const seen = new Set<string>();
      for (const item of data.items) {
        const loc = item.locationId || data.locationId;
        const key = `${item.itemId}:${loc}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
    {
      message: 'Không được trùng lặp linh kiện tại cùng một vị trí trong cùng một phiếu điều chỉnh',
    }
  );

// Legacy/Generic Stock Transaction Schema (Backwards compatibility)
export const createStockTransactionSchema = z.object({
  type: z.nativeEnum(StockTransactionType),
  notes: z.string().optional(),
  details: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        locationId: z.string().uuid(),
        quantity: z.number().int().positive('Số lượng giao dịch phải lớn hơn 0'),
        unitCost: z.number().min(0).optional(),
      })
    )
    .min(1, 'Giao dịch phải có ít nhất 1 mặt hàng'),
});

// Stock Transaction & Movement Query Schemas
export const queryStockTransactionsSchema = z.object({
  search: z.string().trim().optional(),
  type: z.nativeEnum(StockTransactionType).optional(),
  status: z.nativeEnum(TransactionStatus).optional(),
  startDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  endDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  sortBy: z.nativeEnum(StockTransactionSortField).default(StockTransactionSortField.CREATED_AT),
  sortOrder: z.nativeEnum(SortOrder).default(SortOrder.DESC),
  page: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 20), z.number().int().min(1).max(100).default(20)),
});

export const queryStockMovementsSchema = z.object({
  search: z.string().trim().optional(),
  itemId: z.string().uuid('ID linh kiện không hợp lệ').optional(),
  locationId: z.string().uuid('ID vị trí không hợp lệ').optional(),
  type: z.nativeEnum(StockTransactionType).optional(),
  referenceType: z.string().trim().optional(),
  startDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  endDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  sortBy: z.nativeEnum(StockMovementSortField).default(StockMovementSortField.CREATED_AT),
  sortOrder: z.nativeEnum(SortOrder).default(SortOrder.DESC),
  page: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 20), z.number().int().min(1).max(100).default(20)),
});

// Borrow Request Item Schema
export const borrowRequestItemSchema = z.object({
  itemId: z.string().uuid('ID linh kiện không hợp lệ'),
  quantity: z.number().int().positive('Số lượng mượn phải lớn hơn 0'),
});

// Create Borrow Request Schema
export const createBorrowRequestSchema = z
  .object({
    borrowerId: z.string().uuid('ID người mượn không hợp lệ').optional(),
    expectedBorrowDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Ngày mượn dự kiến không đúng định dạng YYYY-MM-DD')),
    expectedReturnDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Ngày trả dự kiến không đúng định dạng YYYY-MM-DD')),
    purpose: z.string().trim().min(3, 'Mục đích mượn phải ghi rõ ít nhất 3 ký tự'),
    notes: z.string().optional().nullable(),
    items: z
      .array(borrowRequestItemSchema)
      .min(1, 'Phiếu mượn phải có ít nhất 1 linh kiện/thiết bị'),
  })
  .refine(
    (data) => {
      const borrowDate = new Date(data.expectedBorrowDate);
      const returnDate = new Date(data.expectedReturnDate);
      return returnDate.getTime() >= borrowDate.getTime();
    },
    {
      message: 'Hạn trả (expectedReturnDate) phải bằng hoặc sau ngày bắt đầu mượn (expectedBorrowDate)',
      path: ['expectedReturnDate'],
    }
  );

// Approve Borrow Request Schema
export const approveBorrowRequestSchema = z.object({
  notes: z.string().optional().nullable(),
});

// Reject Borrow Request Schema
export const rejectBorrowRequestSchema = z.object({
  rejectionReason: z.string().trim().min(3, 'Lý do từ chối phải có ít nhất 3 ký tự'),
});

// Cancel Borrow Request Schema
export const cancelBorrowRequestSchema = z.object({
  reason: z.string().trim().optional().nullable(),
});

// Handover Borrow Request Schema
export const handoverBorrowRequestSchema = z.object({
  notes: z.string().optional().nullable(),
});

// Return Borrow Item Schema
export const returnBorrowItemSchema = z.object({
  borrowDetailId: z.string().uuid('ID dòng phiếu mượn (borrowDetailId) không hợp lệ'),
  returnedQuantity: z.number().int().positive('Số lượng hoàn trả phải lớn hơn 0'),
  condition: z.nativeEnum(AssetCondition).default(AssetCondition.GOOD),
  locationId: z.string().uuid('ID vị trí lưu kho không hợp lệ').optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Return Borrow Request Schema
export const returnBorrowRequestSchema = z.object({
  items: z.array(returnBorrowItemSchema).min(1, 'Phải có ít nhất 1 linh kiện được hoàn trả'),
  notes: z.string().optional().nullable(),
});

// Query Borrow Requests Schema
export const queryBorrowRequestsSchema = z.object({
  page: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 20), z.number().int().min(1).max(100).default(20)),
  status: z.nativeEnum(BorrowStatus).optional(),
  search: z.string().trim().optional(),
  borrowerId: z.string().uuid('ID người mượn không hợp lệ').optional(),
  isOverdue: booleanQueryParam,
  sortBy: z.nativeEnum(BorrowSortField).default(BorrowSortField.CREATED_AT),
  sortOrder: z.nativeEnum(SortOrder).default(SortOrder.DESC),
});

// ==========================================
// KIT SCHEMAS
// ==========================================

export const kitItemInputSchema = z.object({
  itemId: z.string().uuid('ID linh kiện (itemId) không hợp lệ'),
  quantity: z.number().int().positive('Số lượng linh kiện trong kit phải lớn hơn 0'),
  notes: z.string().trim().max(255, 'Ghi chú linh kiện trong kit tối đa 255 ký tự').optional().nullable(),
});

export const createKitSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2, 'Mã hộp kit phải có ít nhất 2 ký tự')
      .max(50, 'Mã hộp kit tối đa 50 ký tự')
      .regex(/^[A-Za-z0-9_-]+$/, 'Mã hộp kit chỉ được chứa chữ cái, số, dấu gạch ngang (-) và gạch dưới (_)'),
    name: z.string().trim().min(2, 'Tên hộp kit phải có ít nhất 2 ký tự').max(100, 'Tên hộp kit tối đa 100 ký tự'),
    description: z.string().trim().optional().nullable(),
    locationId: z.string().uuid('ID vị trí lưu trữ hộp kit (locationId) không hợp lệ').optional().nullable(),
    items: z.array(kitItemInputSchema).min(1, 'Hộp kit phải có ít nhất 1 linh kiện thành phần'),
  })
  .strict()
  .refine(
    (data) => {
      const itemIds = data.items.map((i) => i.itemId);
      return new Set(itemIds).size === itemIds.length;
    },
    { message: 'Danh sách linh kiện trong hộp kit không được chứa linh kiện trùng lặp' }
  );

export const updateKitSchema = z
  .object({
    name: z.string().trim().min(2, 'Tên hộp kit phải có ít nhất 2 ký tự').max(100, 'Tên hộp kit tối đa 100 ký tự').optional(),
    description: z.string().trim().optional().nullable(),
    locationId: z.string().uuid('ID vị trí lưu trữ hộp kit (locationId) không hợp lệ').optional().nullable(),
    items: z
      .array(kitItemInputSchema)
      .min(1, 'Hộp kit phải có ít nhất 1 linh kiện thành phần')
      .refine(
        (items) => {
          const itemIds = items.map((i) => i.itemId);
          return new Set(itemIds).size === itemIds.length;
        },
        { message: 'Danh sách linh kiện trong hộp kit không được chứa linh kiện trùng lặp' }
      )
      .optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Dữ liệu cập nhật hộp kit không được để trống',
  });

export const updateKitStatusSchema = z
  .object({
    status: z.nativeEnum(KitStatus, { required_error: 'Trạng thái kit là bắt buộc' }),
    notes: z.string().trim().max(255, 'Ghi chú thay đổi trạng thái tối đa 255 ký tự').optional().nullable(),
  })
  .strict();

export const queryKitsSchema = z.object({
  search: z.string().trim().optional(),
  status: z.nativeEnum(KitStatus).optional(),
  locationId: z.string().uuid('ID vị trí không hợp lệ').optional(),
  sortBy: z.nativeEnum(KitSortField).default(KitSortField.CREATED_AT),
  sortOrder: z.nativeEnum(SortOrder).default(SortOrder.DESC),
  page: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 20), z.number().int().min(1).max(100).default(20)),
});

// ==========================================
// AUDIT LOG & REPORT SCHEMAS
// ==========================================

export const queryAuditLogsSchema = z.object({
  page: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val !== undefined && val !== '' ? Number(val) : 20), z.number().int().min(1).max(100).default(20)),
  action: z.string().trim().optional(),
  entity: z.string().trim().optional(),
  userId: z.string().uuid('ID người dùng không hợp lệ').optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().trim().optional(),
  sortBy: z.nativeEnum(AuditLogSortField).default(AuditLogSortField.CREATED_AT),
  sortOrder: z.nativeEnum(SortOrder).default(SortOrder.DESC),
});

export const queryReportsSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  categoryId: z.string().uuid('ID danh mục không hợp lệ').optional(),
  locationId: z.string().uuid('ID vị trí không hợp lệ').optional(),
  type: z.nativeEnum(ItemType).optional(),
});

// Inferred Types
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
export type QueryUsersInput = z.infer<typeof queryUsersSchema>;
export type QueryAuditLogsInput = z.infer<typeof queryAuditLogsSchema>;
export type QueryReportsInput = z.infer<typeof queryReportsSchema>;

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type UpdateItemStatusInput = z.infer<typeof updateItemStatusSchema>;
export type QueryItemsInput = z.infer<typeof queryItemsSchema>;

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type UpdateLocationStatusInput = z.infer<typeof updateLocationStatusSchema>;
export type QueryLocationsInput = z.infer<typeof queryLocationsSchema>;
export type QueryLocationTreeInput = z.infer<typeof queryLocationTreeSchema>;

export type StockBalanceInput = z.infer<typeof stockBalanceSchema>;
export type QueryStockBalancesInput = z.infer<typeof queryStockBalancesSchema>;

export type ImportStockItemInput = z.infer<typeof importStockItemSchema>;
export type ImportStockInput = z.infer<typeof importStockSchema>;

export type ExportStockItemInput = z.infer<typeof exportStockItemSchema>;
export type ExportStockInput = z.infer<typeof exportStockSchema>;

export type TransferStockItemInput = z.infer<typeof transferStockItemSchema>;
export type TransferStockInput = z.infer<typeof transferStockSchema>;

export type AdjustStockItemInput = z.infer<typeof adjustStockItemSchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type AdjustStockItemInputV2 = z.infer<typeof adjustStockItemSchemaV2>;
export type AdjustStockInputV2 = z.infer<typeof adjustStockSchemaV2>;

export type CreateStockTransactionInput = z.infer<typeof createStockTransactionSchema>;
export type QueryStockTransactionsInput = z.infer<typeof queryStockTransactionsSchema>;
export type QueryStockMovementsInput = z.infer<typeof queryStockMovementsSchema>;

export type BorrowRequestItemInput = z.infer<typeof borrowRequestItemSchema>;
export type CreateBorrowRequestInput = z.infer<typeof createBorrowRequestSchema>;
export type ApproveBorrowRequestInput = z.infer<typeof approveBorrowRequestSchema>;
export type RejectBorrowRequestInput = z.infer<typeof rejectBorrowRequestSchema>;
export type CancelBorrowRequestInput = z.infer<typeof cancelBorrowRequestSchema>;
export type HandoverBorrowRequestInput = z.infer<typeof handoverBorrowRequestSchema>;
export type ReturnBorrowItemInput = z.infer<typeof returnBorrowItemSchema>;
export type ReturnBorrowRequestInput = z.infer<typeof returnBorrowRequestSchema>;
export type QueryBorrowRequestsInput = z.infer<typeof queryBorrowRequestsSchema>;

export type KitItemInput = z.infer<typeof kitItemInputSchema>;
export type CreateKitInput = z.infer<typeof createKitSchema>;
export type UpdateKitInput = z.infer<typeof updateKitSchema>;
export type UpdateKitStatusInput = z.infer<typeof updateKitStatusSchema>;
export type QueryKitsInput = z.infer<typeof queryKitsSchema>;



// Idempotency Query Schemas & Types (Step S2A)
export const queryIdempotencyParamsSchema = z.object({
  key: z
    .string()
    .trim()
    .min(8, 'Khóa Idempotency tối thiểu 8 ký tự')
    .max(64, 'Khóa Idempotency tối đa 64 ký tự')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Định dạng Idempotency-Key không hợp lệ'),
});

export const idempotencyQueryStatusEnum = z.enum([
  'COMMITTED',
  'IN_PROGRESS',
  'CONFIRMED_FAILED',
  'EXPIRED',
  'UNKNOWN',
]);

export const idempotencyQueryResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  data: z.object({
    key: z.string(),
    status: idempotencyQueryStatusEnum,
    endpoint: z.string().optional(),
    statusCode: z.number().int().optional(),
    transaction: z
      .object({
        id: z.string().uuid(),
        transactionNumber: z.string(),
        type: z.nativeEnum(StockTransactionType),
        status: z.nativeEnum(TransactionStatus),
        notes: z.string().nullable().optional(),
        itemCount: z.number().int(),
        totalQuantity: z.number().int(),
        createdAt: z.string().or(z.date()).optional(),
      })
      .optional(),
    error: z
      .object({
        statusCode: z.number().int(),
        errorCode: z.string().optional(),
        message: z.string(),
      })
      .optional(),
    retryAfterSeconds: z.number().int().optional(),
    createdAt: z.string().or(z.date()).optional(),
    expiresAt: z.string().or(z.date()).optional(),
  }),
});

export type QueryIdempotencyParams = z.infer<typeof queryIdempotencyParamsSchema>;
export type IdempotencyQueryStatus = z.infer<typeof idempotencyQueryStatusEnum>;
export type IdempotencyQueryResponse = z.infer<typeof idempotencyQueryResponseSchema>;
