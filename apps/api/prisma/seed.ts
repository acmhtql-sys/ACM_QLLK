import { PrismaClient, UserRole, ItemType, LocationType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Strict Environment Guard for Demo Seeding.
 * Restricts seed execution strictly to authorized local development environments.
 * Prevents accidental execution in staging, production, or against remote cloud databases (e.g. Supabase).
 */
export function validateSeedEnvironment(
  databaseUrl?: string,
  nodeEnv?: string
): { allowed: boolean; reason?: string } {
  const envName = (nodeEnv || process.env.NODE_ENV || 'development').toLowerCase();
  const profile = (process.env.ACM_DEPLOYMENT_PROFILE || 'local_dev').toLowerCase();

  if (envName === 'production' || envName === 'staging' || envName === 'test') {
    return {
      allowed: false,
      reason: `Thao tác seed dữ liệu demo bị từ chối trong môi trường "${envName}".`,
    };
  }

  if (profile !== 'local_dev') {
    return {
      allowed: false,
      reason: `Seed dữ liệu demo chỉ được phép với ACM_DEPLOYMENT_PROFILE=local_dev (profile hiện tại: "${profile}").`,
    };
  }

  const url = databaseUrl || process.env.DATABASE_URL || '';
  if (!url) {
    return { allowed: false, reason: 'DATABASE_URL không được định nghĩa.' };
  }

  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return { allowed: false, reason: 'DATABASE_URL không hợp lệ.' };
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);
  if (!localHosts.has(hostname)) {
    return {
      allowed: false,
      reason: 'Seed dữ liệu demo chỉ được phép trên database local (localhost/127.0.0.1/::1/host.docker.internal).',
    };
  }

  return { allowed: true };
}

async function main() {
  const guard = validateSeedEnvironment(process.env.DATABASE_URL, process.env.NODE_ENV);
  if (!guard.allowed) {
    console.error(`\n❌ [SEED GUARD REJECTION] ${guard.reason}\n`);
    process.exit(1);
  }

  console.log('🌱 Starting ACM Database Seeding...');

  // 1. Roles
  const roles = [
    { name: UserRole.ADMIN, description: 'Quản trị viên toàn hệ thống' },
    { name: UserRole.LAB_MANAGER, description: 'Quản lý phòng Lab / Thủ kho' },
    { name: UserRole.TECHNICIAN, description: 'Kỹ thuật viên / Trợ giảng hỗ trợ' },
    { name: UserRole.STUDENT, description: 'Sinh viên / Người mượn linh kiện' },
  ];

  const roleMap = new Map<UserRole, string>();
  for (const r of roles) {
    const createdRole = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description },
      create: r,
    });
    roleMap.set(r.name, createdRole.id);
  }
  console.log('✅ Roles seeded (4 roles)');

  // 2. Demo Users (Password: ACM@dev2026! hashed with bcrypt)
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('ACM@dev2026!', salt);

  const demoUsers = [
    {
      email: 'admin@acm.local',
      fullName: 'System Administrator',
      role: UserRole.ADMIN,
      roleId: roleMap.get(UserRole.ADMIN)!,
      studentOrStaffId: 'ADM-001',
      department: 'IT & Lab Operation',
    },
    {
      email: 'manager@acm.local',
      fullName: 'Lab Manager',
      role: UserRole.LAB_MANAGER,
      roleId: roleMap.get(UserRole.LAB_MANAGER)!,
      studentOrStaffId: 'MGR-002',
      department: 'Robotics & AI Center',
    },
    {
      email: 'tech@acm.local',
      fullName: 'Technician Instructor',
      role: UserRole.TECHNICIAN,
      roleId: roleMap.get(UserRole.TECHNICIAN)!,
      studentOrStaffId: 'TCH-003',
      department: 'Hardware Prototyping Lab',
    },
    {
      email: 'student@acm.local',
      fullName: 'Nguyen Van A (Student)',
      role: UserRole.STUDENT,
      roleId: roleMap.get(UserRole.STUDENT)!,
      studentOrStaffId: 'STD-2026-099',
      department: 'Faculty of Computer Engineering',
    },
  ];

  for (const u of demoUsers) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        fullName: u.fullName,
        role: u.role,
        roleId: u.roleId,
      },
      create: {
        ...u,
        passwordHash,
      },
    });
  }
  console.log('✅ Demo Users seeded');

  // 3. Locations
  const warehouse = await prisma.location.upsert({
    where: { code: 'WH-MAIN' },
    update: {},
    create: {
      code: 'WH-MAIN',
      name: 'Kho Trung tâm AI Robotic Lab',
      type: LocationType.WAREHOUSE,
    },
  });

  const rackA = await prisma.location.upsert({
    where: { code: 'RACK-A' },
    update: {},
    create: {
      code: 'RACK-A',
      name: 'Kệ A - Vi điều khiển & Module',
      type: LocationType.RACK,
      parentId: warehouse.id,
    },
  });

  const binA1 = await prisma.location.upsert({
    where: { code: 'BIN-A1' },
    update: {},
    create: {
      code: 'BIN-A1',
      name: 'Ngăn A1 - Arduino & ESP',
      type: LocationType.BIN,
      parentId: rackA.id,
    },
  });

  const binA2 = await prisma.location.upsert({
    where: { code: 'BIN-A2' },
    update: {},
    create: {
      code: 'BIN-A2',
      name: 'Ngăn A2 - Sensors & Actuators',
      type: LocationType.BIN,
      parentId: rackA.id,
    },
  });

  const rackB = await prisma.location.upsert({
    where: { code: 'RACK-B' },
    update: {},
    create: {
      code: 'RACK-B',
      name: 'Kệ B - Linh kiện tiêu hao & Thụ động',
      type: LocationType.RACK,
      parentId: warehouse.id,
    },
  });

  const binB1 = await prisma.location.upsert({
    where: { code: 'BIN-B1' },
    update: {},
    create: {
      code: 'BIN-B1',
      name: 'Ngăn B1 - LED & Điện trở',
      type: LocationType.BIN,
      parentId: rackB.id,
    },
  });
  console.log('✅ Warehouse Locations seeded');

  // 4. Categories
  const catMCU = await prisma.category.upsert({
    where: { code: 'CAT-MCU' },
    update: {},
    create: {
      code: 'CAT-MCU',
      name: 'Vi điều khiển & Bo mạch nhúng',
      description: 'Microcontroller units, dev boards',
    },
  });

  const catSensor = await prisma.category.upsert({
    where: { code: 'CAT-SENSOR' },
    update: {},
    create: {
      code: 'CAT-SENSOR',
      name: 'Cảm biến (Sensors)',
      description: 'Nhiệt độ, độ ẩm, khoảng cách, chuyển động',
    },
  });

  const catMotor = await prisma.category.upsert({
    where: { code: 'CAT-MOTOR' },
    update: {},
    create: {
      code: 'CAT-MOTOR',
      name: 'Động cơ & Cơ cấu chấp hành',
      description: 'Servo, Step motor, DC motor',
    },
  });

  const catPassive = await prisma.category.upsert({
    where: { code: 'CAT-PASSIVE' },
    update: {},
    create: {
      code: 'CAT-PASSIVE',
      name: 'Linh kiện thụ động & Tiêu hao',
      description: 'Điện trở, tụ điện, LED, diode, cáp nhảy',
    },
  });
  console.log('✅ Categories seeded');

  // 5. Items required by prompt:
  // Arduino Uno, ESP32, DHT22, LED, Điện trở, Servo Motor, Cảm biến siêu âm
  const items = [
    {
      code: 'ARD-UNO-R3',
      name: 'Arduino Uno R3',
      description: 'Bo mạch vi điều khiển ATmega328P DIP kèm cáp USB',
      unit: 'Cái',
      type: ItemType.TRACKED_ASSET,
      categoryId: catMCU.id,
      minStockAlert: 10,
      locationId: binA1.id,
      stock: { onHand: 45, reserved: 5, quarantined: 2, kitAllocated: 10, borrowed: 15 },
    },
    {
      code: 'ESP32-WROOM-32',
      name: 'ESP32 DevKit V1 (30 chân)',
      description: 'Bo mạch SoC Wi-Fi & Bluetooth Dual-Core 240MHz',
      unit: 'Cái',
      type: ItemType.TRACKED_ASSET,
      categoryId: catMCU.id,
      minStockAlert: 10,
      locationId: binA1.id,
      stock: { onHand: 60, reserved: 8, quarantined: 0, kitAllocated: 12, borrowed: 20 },
    },
    {
      code: 'DHT22-AM2302',
      name: 'Cảm biến nhiệt độ & độ ẩm DHT22',
      description: 'Cảm biến kỹ thuật số độ chính xác cao AM2302 kèm trở kéo',
      unit: 'Cái',
      type: ItemType.TRACKED_ASSET,
      categoryId: catSensor.id,
      minStockAlert: 5,
      locationId: binA2.id,
      stock: { onHand: 30, reserved: 4, quarantined: 1, kitAllocated: 5, borrowed: 8 },
    },
    {
      code: 'SR04-ULTRASONIC',
      name: 'Cảm biến siêu âm HC-SR04',
      description: 'Cảm biến đo khoảng cách siêu âm dải đo 2cm - 400cm',
      unit: 'Cái',
      type: ItemType.TRACKED_ASSET,
      categoryId: catSensor.id,
      minStockAlert: 8,
      locationId: binA2.id,
      stock: { onHand: 35, reserved: 5, quarantined: 0, kitAllocated: 10, borrowed: 10 },
    },
    {
      code: 'SERVO-SG90',
      name: 'Servo Motor TowerPro SG90 9g',
      description: 'Động cơ servo mini góc quay 180 độ kèm phụ kiện cánh tay đòn',
      unit: 'Cái',
      type: ItemType.TRACKED_ASSET,
      categoryId: catMotor.id,
      minStockAlert: 12,
      locationId: binA2.id,
      stock: { onHand: 50, reserved: 6, quarantined: 2, kitAllocated: 12, borrowed: 14 },
    },
    {
      code: 'LED-5MM-RGB',
      name: 'LED 5mm (Đỏ / Xanh lá / Vàng)',
      description: 'LED siêu sáng 5mm gói 100 bóng phục vụ thực hành mạch',
      unit: 'Gói',
      type: ItemType.CONSUMABLE,
      categoryId: catPassive.id,
      minStockAlert: 10,
      locationId: binB1.id,
      stock: { onHand: 200, reserved: 0, quarantined: 0, kitAllocated: 30, borrowed: 0 },
    },
    {
      code: 'RES-KIT-1-4W',
      name: 'Bộ điện trở các giá trị 1/4W (100R - 100kR)',
      description: 'Tập điện trở kim loại 30 giá trị thông dụng',
      unit: 'Bộ',
      type: ItemType.CONSUMABLE,
      categoryId: catPassive.id,
      minStockAlert: 15,
      locationId: binB1.id,
      stock: { onHand: 150, reserved: 0, quarantined: 0, kitAllocated: 20, borrowed: 0 },
    },
  ];

  for (const itemData of items) {
    const { stock, locationId, ...itemFields } = itemData;
    const item = await prisma.item.upsert({
      where: { code: itemFields.code },
      update: itemFields,
      create: itemFields,
    });

    await prisma.stockBalance.upsert({
      where: {
        itemId_locationId: {
          itemId: item.id,
          locationId: locationId,
        },
      },
      update: {
        onHand: stock.onHand,
        reserved: stock.reserved,
        quarantined: stock.quarantined,
        kitAllocated: stock.kitAllocated,
        borrowed: stock.borrowed,
      },
      create: {
        itemId: item.id,
        locationId: locationId,
        onHand: stock.onHand,
        reserved: stock.reserved,
        quarantined: stock.quarantined,
        kitAllocated: stock.kitAllocated,
        borrowed: stock.borrowed,
      },
    });
  }
  console.log('✅ 7 Required Items & Initial StockBalances seeded');
  console.log('🎉 Seeding successfully completed!');
}

if (require.main === module || (process.argv[1] && process.argv[1].includes('seed'))) {
  main()
    .catch((e) => {
      console.error('❌ Seeding error:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
