/**
 * Synthetic API Data Fixtures for Isolated Mock Browser E2E (Mode A)
 * Conforming strictly to Backend API Contract and @acm/shared DTO schemas.
 * NOT derived from or pretending to be live PostgreSQL data.
 */

export const SYNTHETIC_USERS = {
  admin: {
    id: 'usr-admin-mock-01',
    email: 'admin@acm.local',
    fullName: 'Quản Trị Viên ACM',
    role: 'ADMIN' as const,
  },
  manager: {
    id: 'usr-manager-mock-02',
    email: 'manager@acm.local',
    fullName: 'Trưởng Phòng Lab ACM',
    role: 'LAB_MANAGER' as const,
  },
  tech: {
    id: 'usr-tech-mock-03',
    email: 'tech@acm.local',
    fullName: 'Kỹ Thuật Viên Lab',
    role: 'TECHNICIAN' as const,
  },
  student: {
    id: 'usr-student-mock-04',
    email: 'student@acm.local',
    fullName: 'Sinh Viên Nghiên Cứu',
    role: 'STUDENT' as const,
  },
};

export const SYNTHETIC_CATEGORIES = [
  { id: '30000000-0000-4000-8000-000000000001', code: 'MCU', name: 'Vi điều khiển (Microcontrollers)', description: 'Arduino, ESP32, STM32' },
  { id: '30000000-0000-4000-8000-000000000002', code: 'SNS', name: 'Cảm biến (Sensors)', description: 'Nhiệt độ, khoảng cách, siêu âm' },
  { id: '30000000-0000-4000-8000-000000000003', code: 'ACT', name: 'Động cơ & Cơ cấu chấp hành', description: 'Servo, Stepper, DC Motor' },
  { id: '30000000-0000-4000-8000-000000000004', code: 'PAS', name: 'Linh kiện thụ động', description: 'Điện trở, tụ điện, cuộn cảm' },
];

export const SYNTHETIC_ITEMS = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    code: 'ARD-UNO-R3',
    name: 'Arduino Uno R3',
    type: 'EQUIPMENT',
    categoryId: '30000000-0000-4000-8000-000000000001',
    unit: 'Cái',
    minStockAlert: 5,
    isActive: true,
    totalOnHand: 25,
    available: 18,
    category: SYNTHETIC_CATEGORIES[0],
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    code: 'ESP32-WROOM',
    name: 'Module Wifi ESP32 Wroom-32',
    type: 'COMPONENT',
    categoryId: '30000000-0000-4000-8000-000000000001',
    unit: 'Cái',
    minStockAlert: 10,
    isActive: true,
    totalOnHand: 40,
    available: 35,
    category: SYNTHETIC_CATEGORIES[0],
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    code: 'SRV-SG90',
    name: 'Động cơ Servo Mini SG90',
    type: 'COMPONENT',
    categoryId: '30000000-0000-4000-8000-000000000003',
    unit: 'Cái',
    minStockAlert: 8,
    isActive: true,
    totalOnHand: 30,
    available: 22,
    category: SYNTHETIC_CATEGORIES[2],
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    code: 'RES-10K',
    name: 'Điện trở 10k Ohm 1/4W',
    type: 'CONSUMABLE',
    categoryId: '30000000-0000-4000-8000-000000000004',
    unit: 'Con',
    minStockAlert: 50,
    isActive: true,
    totalOnHand: 200,
    available: 190,
    category: SYNTHETIC_CATEGORIES[3],
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    code: 'OLD-RASPI-2',
    name: 'Raspberry Pi 2 Model B (Hỏng/Ngưng dùng)',
    type: 'EQUIPMENT',
    categoryId: '30000000-0000-4000-8000-000000000001',
    unit: 'Cái',
    minStockAlert: 0,
    isActive: false, // Inactive item
    totalOnHand: 2,
    available: 0,
    category: SYNTHETIC_CATEGORIES[0],
  },
];

// Locations strictly conforming to WAREHOUSE -> RACK -> SHELF -> BIN
export const SYNTHETIC_LOCATIONS = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    code: 'WH-MAIN',
    name: 'Kho Tổng Lab Robotics',
    type: 'WAREHOUSE' as const,
    parentId: null,
    isActive: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    code: 'RACK-A',
    name: 'Dãy Kệ A - Linh kiện bán dẫn',
    type: 'RACK' as const,
    parentId: '20000000-0000-4000-8000-000000000001',
    isActive: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    code: 'SHELF-A1',
    name: 'Tầng Kệ A1',
    type: 'SHELF' as const,
    parentId: '20000000-0000-4000-8000-000000000002',
    isActive: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000004',
    code: 'BIN-A1-01',
    name: 'Hộp Ngăn A1-01 (Vi điều khiển)',
    type: 'BIN' as const,
    parentId: '20000000-0000-4000-8000-000000000003',
    isActive: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000005',
    code: 'BIN-A1-02',
    name: 'Hộp Ngăn A1-02 (Cảm biến)',
    type: 'BIN' as const,
    parentId: '20000000-0000-4000-8000-000000000003',
    isActive: true,
  },
];

export const SYNTHETIC_LOCATION_HIERARCHY = [
  {
    ...SYNTHETIC_LOCATIONS[0],
    children: [
      {
        ...SYNTHETIC_LOCATIONS[1],
        children: [
          {
            ...SYNTHETIC_LOCATIONS[2],
            children: [
              SYNTHETIC_LOCATIONS[3],
              SYNTHETIC_LOCATIONS[4],
            ],
          },
        ],
      },
    ],
  },
];

export const SYNTHETIC_BALANCES = [
  {
    id: 'bal-01',
    itemId: '10000000-0000-4000-8000-000000000001',
    locationId: '20000000-0000-4000-8000-000000000004',
    onHand: 25,
    reserved: 3,
    quarantined: 2,
    kitAllocated: 2,
    borrowed: 5,
    available: 18, // Available = 25 - 3 - 2 - 2 = 18 (Borrowed NOT subtracted)
    item: SYNTHETIC_ITEMS[0],
    location: SYNTHETIC_LOCATIONS[3],
  },
  {
    id: 'bal-02',
    itemId: '10000000-0000-4000-8000-000000000002',
    locationId: '20000000-0000-4000-8000-000000000004',
    onHand: 40,
    reserved: 2,
    quarantined: 1,
    kitAllocated: 2,
    borrowed: 4,
    available: 35, // Available = 40 - 2 - 1 - 2 = 35
    item: SYNTHETIC_ITEMS[1],
    location: SYNTHETIC_LOCATIONS[3],
  },
  {
    id: 'bal-03',
    itemId: '10000000-0000-4000-8000-000000000003',
    locationId: '20000000-0000-4000-8000-000000000005',
    onHand: 30,
    reserved: 5,
    quarantined: 1,
    kitAllocated: 2,
    borrowed: 3,
    available: 22, // Available = 30 - 5 - 1 - 2 = 22
    item: SYNTHETIC_ITEMS[2],
    location: SYNTHETIC_LOCATIONS[4],
  },
  {
    id: 'bal-04',
    itemId: '10000000-0000-4000-8000-000000000004',
    locationId: '20000000-0000-4000-8000-000000000005',
    onHand: 200,
    reserved: 10,
    quarantined: 0,
    kitAllocated: 0,
    borrowed: 0,
    available: 190, // Available = 200 - 10 - 0 - 0 = 190
    item: SYNTHETIC_ITEMS[3],
    location: SYNTHETIC_LOCATIONS[4],
  },
];

export const SYNTHETIC_TRANSACTIONS = [
  {
    id: 'tx-mock-01',
    transactionNumber: 'IMP-20261013-0001',
    type: 'IMPORT',
    status: 'COMPLETED',
    notes: 'Nhập bổ sung linh kiện thực hành đợt 1',
    itemCount: 2,
    totalQuantity: 15,
    createdById: SYNTHETIC_USERS.admin.id,
    createdBy: SYNTHETIC_USERS.admin,
    createdAt: '2026-10-13T08:30:00.000Z',
  },
  {
    id: 'tx-mock-02',
    transactionNumber: 'EXP-20261013-0002',
    type: 'EXPORT',
    status: 'COMPLETED',
    notes: 'Xuất phục vụ đề tài nghiên cứu Robot',
    itemCount: 1,
    totalQuantity: 5,
    createdById: SYNTHETIC_USERS.admin.id,
    createdBy: SYNTHETIC_USERS.admin,
    createdAt: '2026-10-13T09:15:00.000Z',
  },
  {
    id: 'tx-mock-03',
    transactionNumber: 'TRF-20261013-0003',
    type: 'TRANSFER',
    status: 'COMPLETED',
    notes: 'Chuyển ngăn dự phòng sang trạm hàn',
    itemCount: 1,
    totalQuantity: 8,
    createdById: SYNTHETIC_USERS.manager.id,
    createdBy: SYNTHETIC_USERS.manager,
    createdAt: '2026-10-13T09:45:00.000Z',
  },
  {
    id: 'tx-mock-04',
    transactionNumber: 'ADJ-20261013-0004',
    type: 'ADJUSTMENT',
    status: 'COMPLETED',
    notes: 'Kiểm kê định kỳ đầu tuần',
    itemCount: 1,
    totalQuantity: 3,
    createdById: SYNTHETIC_USERS.admin.id,
    createdBy: SYNTHETIC_USERS.admin,
    createdAt: '2026-10-13T10:00:00.000Z',
  },
  // Historical 0-detail fixture representing the 96 baseline fixtures
  {
    id: 'tx-orphan-9021',
    transactionNumber: 'IMP-20261013-9021',
    type: 'IMPORT',
    status: 'COMPLETED',
    notes: 'Dữ liệu test fixture lịch sử',
    itemCount: 0,
    totalQuantity: 0,
    createdById: SYNTHETIC_USERS.admin.id,
    createdBy: SYNTHETIC_USERS.admin,
    createdAt: '2026-10-13T07:00:00.000Z',
  },
];

export const SYNTHETIC_TRANSACTION_DETAILS: Record<string, any> = {
  'tx-mock-01': {
    ...SYNTHETIC_TRANSACTIONS[0],
    details: [
      {
        id: 'det-01',
        stockTransactionId: 'tx-mock-01',
        itemId: '10000000-0000-4000-8000-000000000001',
        locationId: '20000000-0000-4000-8000-000000000004',
        quantity: 10,
        unitCost: 150000,
        item: SYNTHETIC_ITEMS[0],
        location: SYNTHETIC_LOCATIONS[3],
        snapshotOnHandBefore: 15,
        snapshotOnHandAfter: 25,
      },
      {
        id: 'det-02',
        stockTransactionId: 'tx-mock-01',
        itemId: '10000000-0000-4000-8000-000000000002',
        locationId: '20000000-0000-4000-8000-000000000004',
        quantity: 5,
        unitCost: 95000,
        item: SYNTHETIC_ITEMS[1],
        location: SYNTHETIC_LOCATIONS[3],
        snapshotOnHandBefore: 35,
        snapshotOnHandAfter: 40,
      },
    ],
  },
  'tx-orphan-9021': {
    ...SYNTHETIC_TRANSACTIONS[4],
    details: [], // Empty details for defensive orphan fixture testing
  },
};
