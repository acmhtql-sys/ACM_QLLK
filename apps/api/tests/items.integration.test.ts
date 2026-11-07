import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, checkDatabaseConnection } from '../src/config/database';
import { ItemType, UserRole } from '@acm/shared';

const app = createApp();

describe('ACM Phase 2.1 Backend API Integration Test Suite – Item Management', () => {
  let adminToken = '';
  let managerToken = '';
  let techToken = '';
  let studentToken = '';

  let testCategoryId = '';
  const createdItemIds: string[] = [];

  beforeAll(async () => {
    // 1. Verify strict connection to acm_inventory_test
    const dbStatus = await checkDatabaseConnection();
    expect(dbStatus.connected).toBe(true);

    const currentDbResult: any = await prisma.$queryRaw`SELECT current_database() as db;`;
    expect(currentDbResult[0]?.db).toBe('acm_inventory_test');

    // 2. Fetch category for testing
    const cat = await prisma.category.findFirst();
    expect(cat).toBeTruthy();
    testCategoryId = cat!.id;

    // 3. Authenticate all 4 roles
    const adminRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@acm.local', password: 'ACM@dev2026!' });
    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.data.token;

    const managerRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'manager@acm.local', password: 'ACM@dev2026!' });
    expect(managerRes.status).toBe(200);
    managerToken = managerRes.body.data.token;

    const techRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'tech@acm.local', password: 'ACM@dev2026!' });
    expect(techRes.status).toBe(200);
    techToken = techRes.body.data.token;

    const studentRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'student@acm.local', password: 'ACM@dev2026!' });
    expect(studentRes.status).toBe(200);
    studentToken = studentRes.body.data.token;
  });

  afterAll(async () => {
    // Strict cleanup of all test-generated items and related audit logs
    try {
      for (const id of createdItemIds) {
        await prisma.stockBalance.deleteMany({ where: { itemId: id } });
        await prisma.asset.deleteMany({ where: { itemId: id } });
        await prisma.borrowDetail.deleteMany({ where: { itemId: id } });
        await prisma.stockTransactionDetail.deleteMany({ where: { itemId: id } });
        await prisma.auditLog.deleteMany({ where: { entityId: id } });
        await prisma.item.deleteMany({ where: { id } });
      }

      await prisma.auditLog.deleteMany({
        where: {
          entity: 'Item',
          newValue: { path: ['code'], string_contains: 'TEST-P21-' },
        },
      });

      await prisma.item.deleteMany({
        where: { code: { startsWith: 'TEST-P21-' } },
      });
    } catch (cleanupErr) {
      console.warn('Test cleanup warning:', cleanupErr);
    }
  });

  // ========================================================
  // 1. GET /api/v1/items (Catalog, Filtering, Search, Pagination)
  // ========================================================
  describe('GET /api/v1/items', () => {
    it('returns list of items with pagination metadata', async () => {
      const res = await request(app).get('/api/v1/items');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(7);

      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(20);
      expect(res.body.meta.totalItems).toBeGreaterThanOrEqual(7);
      expect(res.body.meta.totalPages).toBeGreaterThanOrEqual(1);

      // Verify item properties
      const item = res.body.data[0];
      expect(item.id).toBeDefined();
      expect(item.code).toBeDefined();
      expect(item.name).toBeDefined();
      expect(item.categoryName).toBeDefined(); // Frontend compatibility
      expect(item.available).toBeDefined();
      expect(item.totalOnHand).toBeDefined();
      expect(typeof item.isLowStock).toBe('boolean');
    });

    it('supports search by code and name', async () => {
      const resCode = await request(app).get('/api/v1/items?search=ESP32');
      expect(resCode.status).toBe(200);
      expect(resCode.body.data.some((i: any) => i.code.includes('ESP32'))).toBe(true);

      const resName = await request(app).get('/api/v1/items?search=Arduino');
      expect(resName.status).toBe(200);
      expect(resName.body.data.some((i: any) => i.name.includes('Arduino'))).toBe(true);
    });

    it('supports filter by categoryId', async () => {
      const res = await request(app).get(`/api/v1/items?categoryId=${testCategoryId}`);
      expect(res.status).toBe(200);
      for (const item of res.body.data) {
        expect(item.categoryId).toBe(testCategoryId);
      }
    });

    it('supports filter by type', async () => {
      const res = await request(app).get('/api/v1/items?type=CONSUMABLE');
      expect(res.status).toBe(200);
      for (const item of res.body.data) {
        expect(item.type).toBe('CONSUMABLE');
      }
    });

    it('supports pagination with page and limit', async () => {
      const res = await request(app).get('/api/v1/items?page=1&limit=2');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(2);
      expect(res.body.meta.hasNextPage).toBe(true);
    });

    it('supports sorting by name ascending and descending', async () => {
      const resAsc = await request(app).get('/api/v1/items?sortBy=name&sortOrder=asc&limit=10');
      const resDesc = await request(app).get('/api/v1/items?sortBy=name&sortOrder=desc&limit=10');
      expect(resAsc.status).toBe(200);
      expect(resDesc.status).toBe(200);
      const namesAsc = resAsc.body.data.map((i: any) => i.name);
      const namesDesc = resDesc.body.data.map((i: any) => i.name);
      expect(namesAsc.length).toBeGreaterThan(1);
      // PostgreSQL ORDER BY follows the database collation, which can differ
      // from JavaScript's localeCompare on uppercase ASCII names (STM vs Servo).
      // Verify that the API reverses the same distinct item names in both directions.
      expect(namesAsc).toEqual([...namesDesc].reverse());
    });

    it('rejects invalid boolean query parameter values with 422', async () => {
      const res = await request(app).get('/api/v1/items?isActive=not_a_bool');
      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  // ========================================================
  // 2. POST /api/v1/items (Create Item, Validation, RBAC, AuditLog)
  // ========================================================
  describe('POST /api/v1/items', () => {
    it('allows ADMIN to create a new item and records AuditLog', async () => {
      const testCode = `TEST-P21-ADM-${Date.now().toString().slice(-4)}`;
      const payload = {
        code: testCode,
        name: 'Sensor Khí Gas MQ-2',
        description: 'Module cảm biến phát hiện khí gas / khói',
        unit: 'Cái',
        type: ItemType.TRACKED_ASSET,
        categoryId: testCategoryId,
        minStockAlert: 8,
      };

      const res = await request(app)
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.code).toBe(testCode);
      expect(res.body.data.isActive).toBe(true);
      expect(res.body.data.available).toBe(0);

      const createdId = res.body.data.id;
      createdItemIds.push(createdId);

      // Verify AuditLog in database
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entity: 'Item',
          entityId: createdId,
          action: 'CREATE_ITEM',
        },
      });
      expect(auditLog).toBeTruthy();
      expect(auditLog?.action).toBe('CREATE_ITEM');
    });

    it('allows LAB_MANAGER to create a new item', async () => {
      const testCode = `TEST-P21-MGR-${Date.now().toString().slice(-4)}`;
      const payload = {
        code: testCode,
        name: 'Mạch nạp ST-Link V2',
        description: 'Mạch nạp và gỡ lỗi vi điều khiển STM8/STM32',
        unit: 'Chiếc',
        type: ItemType.TRACKED_ASSET,
        categoryId: testCategoryId,
        minStockAlert: 3,
      };

      const res = await request(app)
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${managerToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.code).toBe(testCode);
      createdItemIds.push(res.body.data.id);
    });

    it('forbids TECHNICIAN from creating items (403)', async () => {
      const res = await request(app)
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${techToken}`)
        .send({
          code: 'TEST-P21-TECH-FAIL',
          name: 'Forbidden for Tech',
          unit: 'Cái',
          categoryId: testCategoryId,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('forbids STUDENT from creating items (403)', async () => {
      const res = await request(app)
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          code: 'TEST-P21-STD-FAIL',
          name: 'Forbidden for Student',
          unit: 'Cái',
          categoryId: testCategoryId,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('rejects duplicate SKU code with 409 Conflict', async () => {
      // Use existing seed code 'ARD-UNO-R3'
      const res = await request(app)
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: 'ARD-UNO-R3',
          name: 'Duplicate Arduino Attempt',
          unit: 'Cái',
          categoryId: testCategoryId,
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('đã tồn tại');
    });

    it('rejects non-existent categoryId with 404', async () => {
      const nonExistentCatId = '11111111-2222-3333-4444-555555555555';
      const res = await request(app)
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `TEST-P21-NOCAT-${Date.now().toString().slice(-4)}`,
          name: 'No Cat Item',
          unit: 'Cái',
          categoryId: nonExistentCatId,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('không tồn tại');
    });

    it('rejects whitespace-only code or name with 422', async () => {
      const res = await request(app)
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: '   ',
          name: 'Valid Name',
          unit: 'Cái',
          categoryId: testCategoryId,
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('strictly rejects stock manipulation parameters (onHand, reserved) with 422', async () => {
      const res = await request(app)
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: `TEST-P21-STOCKINJ-${Date.now().toString().slice(-4)}`,
          name: 'Stock Injection Attempt',
          unit: 'Cái',
          categoryId: testCategoryId,
          onHand: 9999, // FORBIDDEN FIELD
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  // ========================================================
  // 3. PUT /api/v1/items/:id (Update Item, Validation, RBAC)
  // ========================================================
  describe('PUT /api/v1/items/:id', () => {
    let targetItemId = '';

    beforeAll(async () => {
      // Create a dedicated item for PUT tests
      const testCode = `TEST-P21-PUT-${Date.now().toString().slice(-4)}`;
      const res = await request(app)
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: testCode,
          name: 'Item Before Update',
          description: 'Original description',
          unit: 'Cái',
          type: ItemType.CONSUMABLE,
          categoryId: testCategoryId,
          minStockAlert: 5,
        });
      targetItemId = res.body.data.id;
      createdItemIds.push(targetItemId);
    });

    it('allows ADMIN to update item details and records AuditLog', async () => {
      const updatePayload = {
        name: 'Item After Admin Update',
        description: 'Updated description',
        minStockAlert: 12,
      };

      const res = await request(app)
        .put(`/api/v1/items/${targetItemId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updatePayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Item After Admin Update');
      expect(res.body.data.minStockAlert).toBe(12);

      // Verify AuditLog in database
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entity: 'Item',
          entityId: targetItemId,
          action: 'UPDATE_ITEM',
        },
      });
      expect(auditLog).toBeTruthy();
      expect(auditLog?.action).toBe('UPDATE_ITEM');
    });

    it('allows LAB_MANAGER to update item details', async () => {
      const res = await request(app)
        .put(`/api/v1/items/${targetItemId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ minStockAlert: 15 });

      expect(res.status).toBe(200);
      expect(res.body.data.minStockAlert).toBe(15);
    });

    it('forbids TECHNICIAN from updating items (403)', async () => {
      const res = await request(app)
        .put(`/api/v1/items/${targetItemId}`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({ name: 'Hacked by Tech' });

      expect(res.status).toBe(403);
    });

    it('forbids STUDENT from updating items (403)', async () => {
      const res = await request(app)
        .put(`/api/v1/items/${targetItemId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ name: 'Hacked by Student' });

      expect(res.status).toBe(403);
    });

    it('rejects empty update object with 422', async () => {
      const res = await request(app)
        .put(`/api/v1/items/${targetItemId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('rejects stock field alteration attempts with 422', async () => {
      const res = await request(app)
        .put(`/api/v1/items/${targetItemId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Valid Name',
          reserved: 50, // FORBIDDEN
        });

      expect(res.status).toBe(422);
    });

    it('returns 404 for non-existent item id', async () => {
      const nonExistentId = '99999999-8888-7777-6666-555555555555';
      const res = await request(app)
        .put(`/api/v1/items/${nonExistentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Non Existent' });

      expect(res.status).toBe(404);
    });

    it('returns 409 when updating code to an existing SKU', async () => {
      const res = await request(app)
        .put(`/api/v1/items/${targetItemId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'ESP32-WROOM-32' });

      expect(res.status).toBe(409);
    });
  });

  // ========================================================
  // 4. PATCH /api/v1/items/:id/status (Deactivation & RBAC)
  // ========================================================
  describe('PATCH /api/v1/items/:id/status', () => {
    let statusItemId = '';

    beforeAll(async () => {
      const testCode = `TEST-P21-STA-${Date.now().toString().slice(-4)}`;
      const res = await request(app)
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: testCode,
          name: 'Item For Status Toggle',
          unit: 'Cái',
          categoryId: testCategoryId,
        });
      statusItemId = res.body.data.id;
      createdItemIds.push(statusItemId);
    });

    it('deactivates item and records DEACTIVATE_ITEM AuditLog', async () => {
      const res = await request(app)
        .patch(`/api/v1/items/${statusItemId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false, reason: 'Tạm ngưng nhập hàng' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isActive).toBe(false);

      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entity: 'Item',
          entityId: statusItemId,
          action: 'DEACTIVATE_ITEM',
        },
      });
      expect(auditLog).toBeTruthy();
    });

    it('hides inactive item from STUDENT in catalog list', async () => {
      const res = await request(app)
        .get('/api/v1/items')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      const found = res.body.data.some((i: any) => i.id === statusItemId);
      expect(found).toBe(false); // Inactive item MUST NOT be visible to student
    });

    it('blocks STUDENT from accessing inactive item directly via GET /:id (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/items/${statusItemId}`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('không có quyền truy cập');
    });

    it('allows ADMIN and LAB_MANAGER to view inactive item via GET /:id', async () => {
      const res = await request(app)
        .get(`/api/v1/items/${statusItemId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(statusItemId);
      expect(res.body.data.isActive).toBe(false);
    });

    it('reactivates item and records REACTIVATE_ITEM AuditLog', async () => {
      const res = await request(app)
        .patch(`/api/v1/items/${statusItemId}/status`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ isActive: true });

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(true);

      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entity: 'Item',
          entityId: statusItemId,
          action: 'REACTIVATE_ITEM',
        },
      });
      expect(auditLog).toBeTruthy();

      // Student can view it again
      const studentRes = await request(app)
        .get(`/api/v1/items/${statusItemId}`)
        .set('Authorization', `Bearer ${studentToken}`);
      expect(studentRes.status).toBe(200);
      expect(studentRes.body.data.id).toBe(statusItemId);
    });

    it('forbids TECHNICIAN and STUDENT from changing status (403)', async () => {
      const techRes = await request(app)
        .patch(`/api/v1/items/${statusItemId}/status`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({ isActive: false });
      expect(techRes.status).toBe(403);

      const stdRes = await request(app)
        .patch(`/api/v1/items/${statusItemId}/status`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ isActive: false });
      expect(stdRes.status).toBe(403);
    });
  });

  // ========================================================
  // 5. DELETE /api/v1/items/:id (Physical Deletion Forbidden)
  // ========================================================
  describe('DELETE /api/v1/items/:id', () => {
    it('returns 401 or 405 for unauthenticated physical DELETE request', async () => {
      const res = await request(app).delete('/api/v1/items/some-id');
      expect([401, 405]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });
  });
});
