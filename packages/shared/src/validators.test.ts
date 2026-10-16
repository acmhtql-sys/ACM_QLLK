import { describe, it, expect } from 'vitest';
import {
  createItemSchema,
  updateItemSchema,
  updateItemStatusSchema,
  queryItemsSchema,
  createLocationSchema,
  updateLocationSchema,
  updateLocationStatusSchema,
  queryLocationsSchema,
  queryLocationTreeSchema,
  importStockSchema,
  exportStockSchema,
  transferStockSchema,
  adjustStockSchema,
  adjustStockItemSchemaV2,
  adjustStockSchemaV2,
  queryStockBalancesSchema,
  queryStockTransactionsSchema,
  queryStockMovementsSchema,
  queryIdempotencyParamsSchema,
  idempotencyQueryResponseSchema,
  createBorrowRequestSchema,
  approveBorrowRequestSchema,
  rejectBorrowRequestSchema,
  cancelBorrowRequestSchema,
  handoverBorrowRequestSchema,
  returnBorrowRequestSchema,
  queryBorrowRequestsSchema,
} from './validators';
import {
  ItemType,
  ItemSortField,
  SortOrder,
  LocationType,
  LocationSortField,
  StockTransactionType,
  TransactionStatus,
  StockTransactionSortField,
  StockMovementSortField,
  StockBalanceSortField,
  StockStatus,
  BorrowStatus,
  AssetCondition,
  BorrowSortField,
} from './types';

describe('Shared Validators Tests', () => {
  const validUUID = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
  const validUUID2 = 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e';

  describe('createItemSchema', () => {
    it('validates a correct item input', () => {
      const data = {
        code: 'STM32-F401',
        name: 'STM32F401 Black Pill',
        description: 'ARM Cortex-M4 development board',
        unit: 'cái',
        type: ItemType.TRACKED_ASSET,
        categoryId: validUUID,
        minStockAlert: 10,
        imageUrl: 'https://example.com/stm32.jpg',
      };
      const parsed = createItemSchema.parse(data);
      expect(parsed.code).toBe('STM32-F401');
      expect(parsed.type).toBe(ItemType.TRACKED_ASSET);
      expect(parsed.minStockAlert).toBe(10);
    });

    it('applies default values for type and minStockAlert', () => {
      const data = {
        code: 'RES-10K',
        name: 'Điện trở 10k Ohm',
        unit: 'chiếc',
        categoryId: validUUID,
      };
      const parsed = createItemSchema.parse(data);
      expect(parsed.type).toBe(ItemType.CONSUMABLE);
      expect(parsed.minStockAlert).toBe(5);
    });

    it('rejects short code or name and invalid categoryId', () => {
      expect(() =>
        createItemSchema.parse({
          code: 'A',
          name: 'B',
          unit: 'cái',
          categoryId: 'invalid-uuid',
        })
      ).toThrow();
    });

    it('rejects code or name containing only whitespace', () => {
      expect(() =>
        createItemSchema.parse({
          code: '   ',
          name: 'Valid Name',
          unit: 'cái',
          categoryId: validUUID,
        })
      ).toThrow();

      expect(() =>
        createItemSchema.parse({
          code: 'VALID-CODE',
          name: '    ',
          unit: 'cái',
          categoryId: validUUID,
        })
      ).toThrow();
    });

    it('validates SKU format: allows alphanumeric, hyphen, underscore, dot; rejects invalid symbols and >50 chars', () => {
      const validSKU = createItemSchema.parse({
        code: 'ESP32_WROOM-32.V1',
        name: 'ESP32 Module',
        unit: 'cái',
        categoryId: validUUID,
      });
      expect(validSKU.code).toBe('ESP32_WROOM-32.V1');

      // Reject special symbols
      expect(() =>
        createItemSchema.parse({
          code: 'INVALID/SKU@123',
          name: 'ESP32 Module',
          unit: 'cái',
          categoryId: validUUID,
        })
      ).toThrow(/chữ cái, số, dấu gạch ngang/);

      // Reject > 50 chars
      expect(() =>
        createItemSchema.parse({
          code: 'A'.repeat(51),
          name: 'ESP32 Module',
          unit: 'cái',
          categoryId: validUUID,
        })
      ).toThrow(/tối đa 50 ký tự/);
    });

    it('rejects unexpected / disallowed keys including stock quantities (strict)', () => {
      expect(() =>
        createItemSchema.parse({
          code: 'VALID-CODE',
          name: 'Valid Name',
          unit: 'cái',
          categoryId: validUUID,
          onHand: 100, // Disallowed field!
        })
      ).toThrow();

      expect(() =>
        createItemSchema.parse({
          code: 'VALID-CODE',
          name: 'Valid Name',
          unit: 'cái',
          categoryId: validUUID,
          reserved: 5, // Disallowed field!
        })
      ).toThrow();
    });

    it('allows empty string or null for optional imageUrl', () => {
      const parsedNull = createItemSchema.parse({
        code: 'CAP-100UF',
        name: 'Tụ 100uF',
        unit: 'cái',
        categoryId: validUUID,
        imageUrl: null,
      });
      expect(parsedNull.imageUrl).toBeNull();

      const parsedEmpty = createItemSchema.parse({
        code: 'CAP-100UF',
        name: 'Tụ 100uF',
        unit: 'cái',
        categoryId: validUUID,
        imageUrl: '',
      });
      expect(parsedEmpty.imageUrl).toBe('');
    });
  });

  describe('updateItemSchema', () => {
    it('allows partial update of descriptive attributes', () => {
      const data = {
        name: 'STM32F401 Updated Name',
        minStockAlert: 15,
      };
      const parsed = updateItemSchema.parse(data);
      expect(parsed.name).toBe('STM32F401 Updated Name');
      expect(parsed.minStockAlert).toBe(15);
      expect(parsed.description).toBeUndefined();
    });

    it('rejects empty object update', () => {
      expect(() => updateItemSchema.parse({})).toThrow(/Dữ liệu cập nhật không được để trống/);
    });

    it('rejects negative minStockAlert', () => {
      expect(() =>
        updateItemSchema.parse({
          minStockAlert: -1,
        })
      ).toThrow();
    });

    it('rejects whitespace-only code or name', () => {
      expect(() =>
        updateItemSchema.parse({
          name: '   ',
        })
      ).toThrow();

      expect(() =>
        updateItemSchema.parse({
          code: '   ',
        })
      ).toThrow();
    });

    it('strictly rejects stock quantities in schema (strict mode)', () => {
      expect(() =>
        updateItemSchema.parse({
          name: 'Valid Name',
          onHand: 9999,
        })
      ).toThrow();

      expect(() =>
        updateItemSchema.parse({
          reserved: 10,
        })
      ).toThrow();
    });
  });

  describe('updateItemStatusSchema', () => {
    it('validates active flag and optional reason', () => {
      const deactivate = updateItemStatusSchema.parse({
        isActive: false,
        reason: 'Hết hàng tạm thời / ngưng bảo dưỡng',
      });
      expect(deactivate.isActive).toBe(false);
      expect(deactivate.reason).toBe('Hết hàng tạm thời / ngưng bảo dưỡng');

      const reactivate = updateItemStatusSchema.parse({
        isActive: true,
      });
      expect(reactivate.isActive).toBe(true);
      expect(reactivate.reason).toBeUndefined();
    });

    it('rejects missing or non-boolean isActive', () => {
      expect(() => updateItemStatusSchema.parse({})).toThrow();
      expect(() => updateItemStatusSchema.parse({ isActive: 'yes' })).toThrow();
    });

    it('rejects unknown fields in status update', () => {
      expect(() =>
        updateItemStatusSchema.parse({
          isActive: true,
          extraField: 'not allowed',
        })
      ).toThrow();
    });
  });

  describe('queryItemsSchema', () => {
    it('provides sensible defaults for pagination and sorting', () => {
      const query = queryItemsSchema.parse({});
      expect(query.page).toBe(1);
      expect(query.limit).toBe(20);
      expect(query.sortBy).toBe(ItemSortField.CREATED_AT);
      expect(query.sortOrder).toBe(SortOrder.DESC);
      expect(query.isActive).toBeUndefined();
      expect(query.isLowStock).toBeUndefined();
    });

    it('parses string query params correctly from URL query strings', () => {
      const query = queryItemsSchema.parse({
        search: '  stm32  ',
        isActive: 'true',
        isLowStock: 'false',
        page: '2',
        limit: '50',
        sortBy: 'name',
        sortOrder: 'asc',
      });
      expect(query.search).toBe('stm32');
      expect(query.isActive).toBe(true);
      expect(query.isLowStock).toBe(false);
      expect(query.page).toBe(2);
      expect(query.limit).toBe(50);
      expect(query.sortBy).toBe(ItemSortField.NAME);
      expect(query.sortOrder).toBe(SortOrder.ASC);
    });

    it('rejects invalid boolean query parameter values instead of silently ignoring them', () => {
      expect(() =>
        queryItemsSchema.parse({
          isActive: 'not_a_boolean',
        })
      ).toThrow(/Giá trị lọc phải là true hoặc false/);

      expect(() =>
        queryItemsSchema.parse({
          isLowStock: 'invalid',
        })
      ).toThrow(/Giá trị lọc phải là true hoặc false/);
    });

    it('enforces limit constraints between 1 and 100', () => {
      expect(() => queryItemsSchema.parse({ limit: '0' })).toThrow();
      expect(() => queryItemsSchema.parse({ limit: '101' })).toThrow();
    });

    it('parses stockStatus and barcode filters correctly', () => {
      const inStock = queryItemsSchema.parse({ stockStatus: StockStatus.IN_STOCK, barcode: 'BC-999' });
      expect(inStock.stockStatus).toBe(StockStatus.IN_STOCK);
      expect(inStock.barcode).toBe('BC-999');

      const lowStock = queryItemsSchema.parse({ stockStatus: 'LOW_STOCK' });
      expect(lowStock.stockStatus).toBe(StockStatus.LOW_STOCK);

      const outOfStock = queryItemsSchema.parse({ stockStatus: 'OUT_OF_STOCK' });
      expect(outOfStock.stockStatus).toBe(StockStatus.OUT_OF_STOCK);

      expect(() => queryItemsSchema.parse({ stockStatus: 'INVALID_STATUS' })).toThrow();
    });
  });

  // ==========================================
  // LOCATION VALIDATION SUITES
  // ==========================================

  describe('createLocationSchema', () => {
    it('validates a correct warehouse location with default type', () => {
      const parsed = createLocationSchema.parse({
        code: 'WH-MAIN',
        name: 'Kho Tổng Phòng Lab',
      });
      expect(parsed.code).toBe('WH-MAIN');
      expect(parsed.type).toBe(LocationType.WAREHOUSE);
      expect(parsed.parentId).toBeUndefined();
    });

    it('validates child location types (RACK, SHELF, BIN) with parentId', () => {
      const rack = createLocationSchema.parse({
        code: 'RACK-A',
        name: 'Kệ A',
        type: LocationType.RACK,
        parentId: validUUID,
      });
      expect(rack.type).toBe(LocationType.RACK);
      expect(rack.parentId).toBe(validUUID);

      const shelf = createLocationSchema.parse({
        code: 'SHELF-A1',
        name: 'Tầng A1',
        type: LocationType.SHELF,
        parentId: validUUID,
      });
      expect(shelf.type).toBe(LocationType.SHELF);

      const bin = createLocationSchema.parse({
        code: 'BIN-A1-01',
        name: 'Khay 01',
        type: LocationType.BIN,
        parentId: validUUID,
      });
      expect(bin.type).toBe(LocationType.BIN);
    });

    it('rejects invalid code with special characters or spaces', () => {
      expect(() =>
        createLocationSchema.parse({
          code: 'WH MAIN', // Space not allowed
          name: 'Kho Lab',
        })
      ).toThrow(/chữ cái, số, dấu gạch ngang/);

      expect(() =>
        createLocationSchema.parse({
          code: 'WH@#01', // Special chars not allowed
          name: 'Kho Lab',
        })
      ).toThrow(/chữ cái, số, dấu gạch ngang/);
    });

    it('rejects whitespace-only code or name', () => {
      expect(() =>
        createLocationSchema.parse({
          code: '   ',
          name: 'Kho Lab',
        })
      ).toThrow();

      expect(() =>
        createLocationSchema.parse({
          code: 'WH-01',
          name: '   ',
        })
      ).toThrow();
    });

    it('strictly rejects injected stock fields', () => {
      expect(() =>
        createLocationSchema.parse({
          code: 'WH-01',
          name: 'Kho Lab',
          onHand: 100, // Disallowed!
        })
      ).toThrow();
    });
  });

  describe('updateLocationSchema', () => {
    it('validates partial update of location name and type', () => {
      const parsed = updateLocationSchema.parse({
        name: 'Kệ A Cập Nhật',
        type: LocationType.RACK,
      });
      expect(parsed.name).toBe('Kệ A Cập Nhật');
      expect(parsed.type).toBe(LocationType.RACK);
    });

    it('rejects empty object update', () => {
      expect(() => updateLocationSchema.parse({})).toThrow(/Dữ liệu cập nhật không được để trống/);
    });

    it('strictly rejects unexpected fields', () => {
      expect(() =>
        updateLocationSchema.parse({
          name: 'Kệ B',
          totalOnHand: 50,
        })
      ).toThrow();
    });
  });

  describe('updateLocationStatusSchema', () => {
    it('validates status change with reason', () => {
      const deactivate = updateLocationStatusSchema.parse({
        isActive: false,
        reason: 'Bảo trì giá đỡ kho',
      });
      expect(deactivate.isActive).toBe(false);
      expect(deactivate.reason).toBe('Bảo trì giá đỡ kho');
    });

    it('rejects missing or invalid isActive', () => {
      expect(() => updateLocationStatusSchema.parse({})).toThrow();
      expect(() => updateLocationStatusSchema.parse({ isActive: 'false' })).toThrow();
    });
  });

  describe('queryLocationsSchema & queryLocationTreeSchema', () => {
    it('provides defaults for query locations', () => {
      const query = queryLocationsSchema.parse({});
      expect(query.page).toBe(1);
      expect(query.limit).toBe(20);
      expect(query.sortBy).toBe(LocationSortField.CODE);
      expect(query.sortOrder).toBe(SortOrder.ASC);
    });

    it('parses type, search and parentId correctly', () => {
      const query = queryLocationsSchema.parse({
        search: 'RACK',
        type: LocationType.RACK,
        parentId: validUUID,
        isActive: 'true',
      });
      expect(query.search).toBe('RACK');
      expect(query.type).toBe(LocationType.RACK);
      expect(query.parentId).toBe(validUUID);
      expect(query.isActive).toBe(true);
    });

    it('parses queryLocationTreeSchema', () => {
      const treeQuery = queryLocationTreeSchema.parse({
        includeInactive: 'true',
      });
      expect(treeQuery.includeInactive).toBe(true);
    });
  });

  // ==========================================
  // STOCK TRANSACTION VALIDATION SUITES
  // ==========================================

  describe('importStockSchema', () => {
    it('validates a valid stock import batch with unitCost and notes', () => {
      const parsed = importStockSchema.parse({
        notes: 'Nhập lô vi điều khiển đầu kỳ',
        idempotencyKey: 'tx-import-001',
        items: [
          {
            itemId: validUUID,
            locationId: validUUID2,
            quantity: 50,
            unitCost: 120000,
            notes: 'Hàng mới 100%',
          },
        ],
      });
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0].quantity).toBe(50);
      expect(parsed.items[0].unitCost).toBe(120000);
      expect(parsed.idempotencyKey).toBe('tx-import-001');
    });

    it('rejects duplicate (itemId, locationId) pairs in the same batch', () => {
      expect(() =>
        importStockSchema.parse({
          items: [
            { itemId: validUUID, locationId: validUUID2, quantity: 10 },
            { itemId: validUUID, locationId: validUUID2, quantity: 20 }, // Duplicate!
          ],
        })
      ).toThrow(/Không được trùng lặp linh kiện tại cùng một vị trí/);
    });

    it('allows same itemId at different locations in the same batch', () => {
      const thirdUUID = 'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f';
      const parsed = importStockSchema.parse({
        items: [
          { itemId: validUUID, locationId: validUUID2, quantity: 10 },
          { itemId: validUUID, locationId: thirdUUID, quantity: 20 },
        ],
      });
      expect(parsed.items).toHaveLength(2);
    });

    it('rejects zero, negative, or decimal quantity in import', () => {
      expect(() =>
        importStockSchema.parse({
          items: [{ itemId: validUUID, locationId: validUUID2, quantity: 0 }],
        })
      ).toThrow(/phải lớn hơn 0/);

      expect(() =>
        importStockSchema.parse({
          items: [{ itemId: validUUID, locationId: validUUID2, quantity: -5 }],
        })
      ).toThrow(/phải lớn hơn 0/);

      expect(() =>
        importStockSchema.parse({
          items: [{ itemId: validUUID, locationId: validUUID2, quantity: 10.5 }],
        })
      ).toThrow(/phải là số nguyên/);
    });

    it('strictly rejects any attempts to inject direct stock fields', () => {
      expect(() =>
        importStockSchema.parse({
          items: [
            {
              itemId: validUUID,
              locationId: validUUID2,
              quantity: 10,
              onHand: 100, // Disallowed!
            },
          ],
        })
      ).toThrow();
    });
  });

  describe('exportStockSchema', () => {
    it('validates a valid export batch with required reason', () => {
      const parsed = exportStockSchema.parse({
        reason: 'Xuất phục vụ nghiên cứu đề tài vi điều khiển',
        notes: 'Xuất cấp phát sinh viên lớp Robotics',
        items: [
          {
            itemId: validUUID,
            locationId: validUUID2,
            quantity: 5,
            reason: 'Thực hành môn Vi điều khiển',
          },
        ],
      });
      expect(parsed.reason).toBe('Xuất phục vụ nghiên cứu đề tài vi điều khiển');
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0].reason).toBe('Thực hành môn Vi điều khiển');
    });

    it('rejects missing root reason', () => {
      expect(() =>
        exportStockSchema.parse({
          notes: 'Chỉ có notes mà không có reason',
          items: [
            {
              itemId: validUUID,
              locationId: validUUID2,
              quantity: 5,
            },
          ],
        })
      ).toThrow();
    });

    it('rejects whitespace-only or too short root reason (< 3 chars)', () => {
      expect(() =>
        exportStockSchema.parse({
          reason: '   ',
          items: [
            {
              itemId: validUUID,
              locationId: validUUID2,
              quantity: 5,
            },
          ],
        })
      ).toThrow(/Lý do xuất kho phải có ít nhất 3 ký tự/);

      expect(() =>
        exportStockSchema.parse({
          reason: 'AB',
          items: [
            {
              itemId: validUUID,
              locationId: validUUID2,
              quantity: 5,
            },
          ],
        })
      ).toThrow(/Lý do xuất kho phải có ít nhất 3 ký tự/);
    });

    it('rejects duplicate (itemId, locationId) pairs in export batch', () => {
      expect(() =>
        exportStockSchema.parse({
          reason: 'Lý do xuất kho hợp lệ',
          items: [
            { itemId: validUUID, locationId: validUUID2, quantity: 5, reason: 'Lý do 1' },
            { itemId: validUUID, locationId: validUUID2, quantity: 3, reason: 'Lý do 2' },
          ],
        })
      ).toThrow(/Không được trùng lặp linh kiện tại cùng một vị trí/);
    });

    it('strictly rejects direct balance manipulation fields', () => {
      expect(() =>
        exportStockSchema.parse({
          reason: 'Lý do xuất kho hợp lệ',
          items: [
            {
              itemId: validUUID,
              locationId: validUUID2,
              quantity: 5,
              reason: 'Thực hành',
              reserved: 10,
            },
          ],
        })
      ).toThrow();
    });
  });

  describe('transferStockSchema', () => {
    it('validates a valid transfer between two different locations', () => {
      const parsed = transferStockSchema.parse({
        fromLocationId: validUUID,
        toLocationId: validUUID2,
        reason: 'Điều chuyển linh kiện phục vụ lớp thực hành',
        notes: 'Chuyển linh kiện từ Kho tổng sang Khay thực hành',
        items: [
          {
            itemId: 'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f',
            quantity: 15,
            reason: 'Bổ sung khay thực hành',
          },
        ],
      });
      expect(parsed.fromLocationId).toBe(validUUID);
      expect(parsed.toLocationId).toBe(validUUID2);
      expect(parsed.reason).toBe('Điều chuyển linh kiện phục vụ lớp thực hành');
      expect(parsed.items[0].quantity).toBe(15);
      expect(parsed.items[0].reason).toBe('Bổ sung khay thực hành');
    });

    it('rejects missing or whitespace-only root reason (< 5 chars)', () => {
      expect(() =>
        transferStockSchema.parse({
          fromLocationId: validUUID,
          toLocationId: validUUID2,
          items: [{ itemId: 'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f', quantity: 10 }],
        })
      ).toThrow();

      expect(() =>
        transferStockSchema.parse({
          fromLocationId: validUUID,
          toLocationId: validUUID2,
          reason: '   ',
          items: [{ itemId: 'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f', quantity: 10 }],
        })
      ).toThrow(/ít nhất 5 ký tự/);

      expect(() =>
        transferStockSchema.parse({
          fromLocationId: validUUID,
          toLocationId: validUUID2,
          reason: 'ABCD',
          items: [{ itemId: 'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f', quantity: 10 }],
        })
      ).toThrow(/ít nhất 5 ký tự/);
    });

    it('rejects transfer when fromLocationId is identical to toLocationId', () => {
      expect(() =>
        transferStockSchema.parse({
          fromLocationId: validUUID,
          toLocationId: validUUID, // Same location!
          reason: 'Điều chuyển linh kiện cùng vị trí',
          items: [
            {
              itemId: 'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f',
              quantity: 10,
            },
          ],
        })
      ).toThrow(/Vị trí nguồn và vị trí đích không được trùng nhau/);
    });

    it('rejects duplicate items within the same transfer payload', () => {
      const itemId = 'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f';
      expect(() =>
        transferStockSchema.parse({
          fromLocationId: validUUID,
          toLocationId: validUUID2,
          reason: 'Điều chuyển linh kiện thực hành',
          items: [
            { itemId, quantity: 10 },
            { itemId, quantity: 5 }, // Duplicate itemId!
          ],
        })
      ).toThrow(/Không được trùng lặp mặt hàng trong cùng một phiếu điều chuyển/);
    });

    it('strictly rejects direct stock balance parameters', () => {
      expect(() =>
        transferStockSchema.parse({
          fromLocationId: validUUID,
          toLocationId: validUUID2,
          reason: 'Điều chuyển linh kiện thực hành',
          items: [
            {
              itemId: 'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f',
              quantity: 10,
              onHandBefore: 20, // Disallowed!
            },
          ],
        })
      ).toThrow();
    });
  });

  describe('adjustStockSchema', () => {
    it('validates a valid inventory stock count adjustment with required reason', () => {
      const parsed = adjustStockSchema.parse({
        locationId: validUUID,
        reason: 'Kiểm kê định kỳ kho linh kiện tháng 10',
        notes: 'Kiểm kê kho tháng 10',
        items: [
          {
            itemId: validUUID2,
            actualOnHand: 35,
            reason: 'Kiểm kê định kỳ phát hiện thừa 2 chiếc',
          },
        ],
      });
      expect(parsed.locationId).toBe(validUUID);
      expect(parsed.reason).toBe('Kiểm kê định kỳ kho linh kiện tháng 10');
      expect(parsed.items[0].actualOnHand).toBe(35);
      expect(parsed.items[0].reason).toBe('Kiểm kê định kỳ phát hiện thừa 2 chiếc');
    });

    it('allows actualOnHand = 0 (out of stock adjustment)', () => {
      const parsed = adjustStockSchema.parse({
        locationId: validUUID,
        reason: 'Kiểm kê phát hiện hỏng hết linh kiện',
        items: [
          {
            itemId: validUUID2,
            actualOnHand: 0,
            reason: 'Đã dùng hết phục vụ dự án capstone',
          },
        ],
      });
      expect(parsed.items[0].actualOnHand).toBe(0);
    });

    it('rejects missing or whitespace-only root reason (< 5 chars)', () => {
      expect(() =>
        adjustStockSchema.parse({
          locationId: validUUID,
          items: [{ itemId: validUUID2, actualOnHand: 10 }],
        })
      ).toThrow();

      expect(() =>
        adjustStockSchema.parse({
          locationId: validUUID,
          reason: '   ',
          items: [{ itemId: validUUID2, actualOnHand: 10 }],
        })
      ).toThrow(/ít nhất 5 ký tự/);

      expect(() =>
        adjustStockSchema.parse({
          locationId: validUUID,
          reason: 'ABC',
          items: [{ itemId: validUUID2, actualOnHand: 10 }],
        })
      ).toThrow(/ít nhất 5 ký tự/);
    });

    it('rejects when reason is provided ONLY at line level without voucher-level reason', () => {
      expect(() =>
        adjustStockSchema.parse({
          locationId: validUUID,
          // voucher reason omitted
          items: [
            {
              itemId: validUUID2,
              actualOnHand: 10,
              reason: 'Lý do chỉ ghi ở cấp dòng mặt hàng',
            },
          ],
        })
      ).toThrow();
    });

    it('rejects negative actualOnHand', () => {
      expect(() =>
        adjustStockSchema.parse({
          locationId: validUUID,
          reason: 'Kiểm kê kho định kỳ',
          items: [
            {
              itemId: validUUID2,
              actualOnHand: -1,
              reason: 'Kiểm kê định kỳ',
            },
          ],
        })
      ).toThrow(/không được âm/);
    });

    it('rejects duplicate items within the same adjustment payload', () => {
      expect(() =>
        adjustStockSchema.parse({
          locationId: validUUID,
          reason: 'Kiểm kê kho linh kiện',
          items: [
            { itemId: validUUID2, actualOnHand: 10, reason: 'Lý do 1 kiểm kê' },
            { itemId: validUUID2, actualOnHand: 12, reason: 'Lý do 2 kiểm kê' },
          ],
        })
      ).toThrow(/Không được trùng lặp linh kiện tại cùng một vị trí/);
    });

    it('strictly rejects direct delta or balance overrides', () => {
      expect(() =>
        adjustStockSchema.parse({
          locationId: validUUID,
          reason: 'Kiểm kê kho linh kiện',
          items: [
            {
              itemId: validUUID2,
              actualOnHand: 10,
              reason: 'Kiểm kê',
              quantityDelta: 2, // Disallowed!
            },
          ],
        })
      ).toThrow();
    });
  });

  // ==========================================
  // INVENTORY QUERY VALIDATION SUITES
  // ==========================================

  describe('queryStockBalancesSchema', () => {
    it('provides sensible defaults and parses boolean filters', () => {
      const query = queryStockBalancesSchema.parse({
        isLowStock: 'true',
        sortBy: StockBalanceSortField.AVAILABLE,
        sortOrder: SortOrder.ASC,
      });
      expect(query.isLowStock).toBe(true);
      expect(query.sortBy).toBe(StockBalanceSortField.AVAILABLE);
      expect(query.sortOrder).toBe(SortOrder.ASC);
      expect(query.page).toBe(1);
      expect(query.limit).toBe(20);
    });
  });

  describe('queryStockTransactionsSchema & queryStockMovementsSchema', () => {
    it('validates query params for stock transactions', () => {
      const query = queryStockTransactionsSchema.parse({
        type: StockTransactionType.IMPORT,
        status: TransactionStatus.COMPLETED,
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        sortBy: StockTransactionSortField.CREATED_AT,
        sortOrder: SortOrder.DESC,
      });
      expect(query.type).toBe(StockTransactionType.IMPORT);
      expect(query.status).toBe(TransactionStatus.COMPLETED);
      expect(query.startDate).toBe('2026-10-01');
    });

    it('validates query params for stock movements', () => {
      const query = queryStockMovementsSchema.parse({
        itemId: validUUID,
        type: StockTransactionType.TRANSFER,
        sortBy: StockMovementSortField.QUANTITY_DELTA,
      });
      expect(query.itemId).toBe(validUUID);
      expect(query.type).toBe(StockTransactionType.TRANSFER);
      expect(query.sortBy).toBe(StockMovementSortField.QUANTITY_DELTA);
    });
  });

  describe('queryIdempotencyParamsSchema & idempotencyQueryResponseSchema (Step S2A)', () => {
    it('ZT-IDEM-01: validates a valid idempotency key parameter', () => {
      const validKeys = [
        '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        'valid-key-1234',
        'KEY_UPPER_LOWER_1234',
        '8charsmn',
      ];
      for (const key of validKeys) {
        const result = queryIdempotencyParamsSchema.safeParse({ key });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.key).toBe(key);
        }
      }
    });

    it('ZT-IDEM-02: rejects invalid idempotency key parameter (< 8 chars, > 64 chars, special chars, empty)', () => {
      const invalidKeys = [
        'short',
        '',
        '   ',
        'key$with@specials',
        'key with spaces',
        'a'.repeat(65),
      ];
      for (const key of invalidKeys) {
        const result = queryIdempotencyParamsSchema.safeParse({ key });
        expect(result.success).toBe(false);
      }
    });

    it('validates idempotencyQueryResponseSchema for COMMITTED status', () => {
      const responsePayload = {
        success: true,
        message: 'Tra cứu trạng thái thành công',
        data: {
          key: 'valid-uuid-key-1234',
          status: 'COMMITTED',
          endpoint: '/api/v1/stock-transactions/import',
          statusCode: 201,
          transaction: {
            id: validUUID,
            transactionNumber: 'TX-20261013-0001',
            type: StockTransactionType.IMPORT,
            status: TransactionStatus.COMPLETED,
            notes: 'Nhập kho thử nghiệm',
            itemCount: 2,
            totalQuantity: 10,
          },
        },
      };
      const parsed = idempotencyQueryResponseSchema.safeParse(responsePayload);
      expect(parsed.success).toBe(true);
    });

    it('validates idempotencyQueryResponseSchema for IN_PROGRESS and UNKNOWN status', () => {
      const inProgressPayload = {
        success: true,
        data: {
          key: 'valid-uuid-key-1234',
          status: 'IN_PROGRESS',
          retryAfterSeconds: 2,
        },
      };
      expect(idempotencyQueryResponseSchema.safeParse(inProgressPayload).success).toBe(true);

      const unknownPayload = {
        success: false,
        message: 'Không tìm thấy bản ghi',
        data: {
          key: 'valid-uuid-key-1234',
          status: 'UNKNOWN',
        },
      };
      expect(idempotencyQueryResponseSchema.safeParse(unknownPayload).success).toBe(true);
    });
  });

  // =========================================================================
  // Step S2B: Shared Zod Adjustment V2 Schema Tests (ZT-ADJ-01 .. ZT-ADJ-05)
  // =========================================================================
  describe('adjustStockSchemaV2 & adjustStockItemSchemaV2 (Step S2B)', () => {
    const validPayload = {
      reason: 'Kiểm kê kho định kỳ cuối tháng',
      locationId: validUUID2,
      items: [
        {
          itemId: validUUID,
          expectedOnHand: 50,
          expectedReserved: 10,
          expectedQuarantined: 5,
          expectedKitAllocated: 5,
          actualOnHand: 55,
          reason: 'Tìm thấy thêm linh kiện',
        },
      ],
    };

    // ZT-ADJ-01: Valid payload with all 4 snapshot fields and actualOnHand
    it('ZT-ADJ-01: validates adjustStockSchemaV2 with complete snapshot fields', () => {
      const result = adjustStockSchemaV2.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items[0].expectedOnHand).toBe(50);
        expect(result.data.items[0].expectedReserved).toBe(10);
        expect(result.data.items[0].expectedQuarantined).toBe(5);
        expect(result.data.items[0].expectedKitAllocated).toBe(5);
        expect(result.data.items[0].actualOnHand).toBe(55);
      }
    });

    // ZT-ADJ-02: Missing expectedOnHand -> fails with required field error
    it('ZT-ADJ-02: rejects when expectedOnHand is missing', () => {
      const invalidPayload = {
        ...validPayload,
        items: [
          {
            itemId: validUUID,
            // expectedOnHand omitted
            expectedReserved: 10,
            expectedQuarantined: 5,
            expectedKitAllocated: 5,
            actualOnHand: 55,
          },
        ],
      };
      const result = adjustStockSchemaV2.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = result.error.errors;
        expect(errors.some((e) => e.path.includes('expectedOnHand'))).toBe(true);
      }
    });

    // ZT-ADJ-03: expectedOnHand is negative (-5) or decimal (5.5) -> fails
    it('ZT-ADJ-03: rejects when expectedOnHand is negative or decimal', () => {
      const negativePayload = {
        ...validPayload,
        items: [
          {
            ...validPayload.items[0],
            expectedOnHand: -5,
          },
        ],
      };
      const negResult = adjustStockSchemaV2.safeParse(negativePayload);
      expect(negResult.success).toBe(false);

      const decimalPayload = {
        ...validPayload,
        items: [
          {
            ...validPayload.items[0],
            expectedOnHand: 5.5,
          },
        ],
      };
      const decResult = adjustStockSchemaV2.safeParse(decimalPayload);
      expect(decResult.success).toBe(false);
    });

    // ZT-ADJ-04: Missing expectedReserved, expectedQuarantined, or expectedKitAllocated -> fails (no fallback .default(0))
    it('ZT-ADJ-04: rejects when any committed snapshot field is missing (no fallback default)', () => {
      const missingReserved = {
        ...validPayload,
        items: [
          {
            itemId: validUUID,
            expectedOnHand: 50,
            // expectedReserved omitted
            expectedQuarantined: 5,
            expectedKitAllocated: 5,
            actualOnHand: 55,
          },
        ],
      };
      expect(adjustStockSchemaV2.safeParse(missingReserved).success).toBe(false);

      const missingQuarantined = {
        ...validPayload,
        items: [
          {
            itemId: validUUID,
            expectedOnHand: 50,
            expectedReserved: 10,
            // expectedQuarantined omitted
            expectedKitAllocated: 5,
            actualOnHand: 55,
          },
        ],
      };
      expect(adjustStockSchemaV2.safeParse(missingQuarantined).success).toBe(false);

      const missingKitAllocated = {
        ...validPayload,
        items: [
          {
            itemId: validUUID,
            expectedOnHand: 50,
            expectedReserved: 10,
            expectedQuarantined: 5,
            // expectedKitAllocated omitted
            actualOnHand: 55,
          },
        ],
      };
      expect(adjustStockSchemaV2.safeParse(missingKitAllocated).success).toBe(false);
    });

    // ZT-ADJ-05: Missing locationId at both header and line level -> fails refinement
    it('ZT-ADJ-05: rejects when locationId is missing at both header and line level', () => {
      const noLocationPayload = {
        reason: 'Kiểm kê kho định kỳ cuối tháng',
        // header locationId omitted
        items: [
          {
            itemId: validUUID,
            // line locationId omitted
            expectedOnHand: 50,
            expectedReserved: 10,
            expectedQuarantined: 5,
            expectedKitAllocated: 5,
            actualOnHand: 55,
          },
        ],
      };
      const result = adjustStockSchemaV2.safeParse(noLocationPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.some((e) => e.path.includes('locationId'))).toBe(true);
      }
    });
  });

  describe('Borrow & Return Schemas', () => {
    describe('createBorrowRequestSchema', () => {
      it('validates a valid borrow request', () => {
        const payload = {
          expectedBorrowDate: '2026-10-20',
          expectedReturnDate: '2026-10-25',
          purpose: 'Phục vụ đề tài nghiên cứu robot AGV',
          notes: 'Mượn thêm cáp kết nối',
          items: [{ itemId: validUUID, quantity: 2 }],
        };
        const parsed = createBorrowRequestSchema.parse(payload);
        expect(parsed.purpose).toBe('Phục vụ đề tài nghiên cứu robot AGV');
        expect(parsed.items).toHaveLength(1);
        expect(parsed.items[0].quantity).toBe(2);
      });

      it('rejects when expectedReturnDate is before expectedBorrowDate', () => {
        const payload = {
          expectedBorrowDate: '2026-10-25',
          expectedReturnDate: '2026-10-20',
          purpose: 'Mượn thiết bị kiểm thử',
          items: [{ itemId: validUUID, quantity: 1 }],
        };
        const result = createBorrowRequestSchema.safeParse(payload);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.errors.some((e) => e.path.includes('expectedReturnDate'))).toBe(true);
        }
      });

      it('rejects when items array is empty', () => {
        const payload = {
          expectedBorrowDate: '2026-10-20',
          expectedReturnDate: '2026-10-25',
          purpose: 'Mượn thiết bị kiểm thử',
          items: [],
        };
        const result = createBorrowRequestSchema.safeParse(payload);
        expect(result.success).toBe(false);
      });

      it('rejects when quantity is zero or negative', () => {
        const payload = {
          expectedBorrowDate: '2026-10-20',
          expectedReturnDate: '2026-10-25',
          purpose: 'Mượn linh kiện thí nghiệm',
          items: [{ itemId: validUUID, quantity: 0 }],
        };
        expect(createBorrowRequestSchema.safeParse(payload).success).toBe(false);
      });

      it('rejects short purpose (< 3 characters)', () => {
        const payload = {
          expectedBorrowDate: '2026-10-20',
          expectedReturnDate: '2026-10-25',
          purpose: 'OK',
          items: [{ itemId: validUUID, quantity: 1 }],
        };
        expect(createBorrowRequestSchema.safeParse(payload).success).toBe(false);
      });
    });

    describe('rejectBorrowRequestSchema', () => {
      it('validates rejection reason with >= 3 characters', () => {
        const payload = { rejectionReason: 'Kho đã hết số lượng khả dụng' };
        expect(rejectBorrowRequestSchema.parse(payload).rejectionReason).toBe('Kho đã hết số lượng khả dụng');
      });

      it('rejects empty or too short rejectionReason', () => {
        expect(rejectBorrowRequestSchema.safeParse({ rejectionReason: 'No' }).success).toBe(false);
        expect(rejectBorrowRequestSchema.safeParse({ rejectionReason: '' }).success).toBe(false);
      });
    });

    describe('returnBorrowRequestSchema', () => {
      it('validates valid return items with condition', () => {
        const payload = {
          items: [
            {
              borrowDetailId: validUUID,
              returnedQuantity: 2,
              condition: AssetCondition.GOOD,
            },
            {
              borrowDetailId: validUUID2,
              returnedQuantity: 1,
              condition: AssetCondition.DAMAGED,
              notes: 'Gãy chân cắm',
            },
          ],
          notes: 'Đã kiểm tra linh kiện khi trả',
        };
        const parsed = returnBorrowRequestSchema.parse(payload);
        expect(parsed.items).toHaveLength(2);
        expect(parsed.items[1].condition).toBe(AssetCondition.DAMAGED);
      });

      it('rejects when return items array is empty', () => {
        expect(returnBorrowRequestSchema.safeParse({ items: [] }).success).toBe(false);
      });

      it('rejects when returnedQuantity is <= 0', () => {
        const payload = {
          items: [{ borrowDetailId: validUUID, returnedQuantity: 0 }],
        };
        expect(returnBorrowRequestSchema.safeParse(payload).success).toBe(false);
      });
    });

    describe('queryBorrowRequestsSchema', () => {
      it('applies defaults for page, limit, sortBy, sortOrder', () => {
        const parsed = queryBorrowRequestsSchema.parse({});
        expect(parsed.page).toBe(1);
        expect(parsed.limit).toBe(20);
        expect(parsed.sortBy).toBe(BorrowSortField.CREATED_AT);
        expect(parsed.sortOrder).toBe(SortOrder.DESC);
      });

      it('parses isOverdue boolean query param', () => {
        const parsedTrue = queryBorrowRequestsSchema.parse({ isOverdue: 'true' });
        expect(parsedTrue.isOverdue).toBe(true);

        const parsedFalse = queryBorrowRequestsSchema.parse({ isOverdue: 'false' });
        expect(parsedFalse.isOverdue).toBe(false);
      });

      it('rejects invalid isOverdue value', () => {
        expect(queryBorrowRequestsSchema.safeParse({ isOverdue: 'invalid_val' }).success).toBe(false);
      });

      it('validates status filter', () => {
        const parsed = queryBorrowRequestsSchema.parse({ status: BorrowStatus.APPROVED });
        expect(parsed.status).toBe(BorrowStatus.APPROVED);
      });
    });
  });
});

