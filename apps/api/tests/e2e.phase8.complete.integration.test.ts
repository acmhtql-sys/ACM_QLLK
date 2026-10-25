import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { prisma, checkDatabaseConnection } from '../src/config/database';
import { ItemType, UserRole, AssetCondition } from '@acm/shared';
import { loginRateLimiter } from '../src/middleware/rateLimiter';

const app = createApp();

describe('ACM Phase 8 – Comprehensive Integration & E2E Acceptance Test Suite', () => {
  let adminToken = '';
  let managerToken = '';
  let techToken = '';
  let studentToken = '';

  let studentUserId = '';
  let testCategoryId = '';
  let testLocationId = '';

  let testItemId = '';
  let testItemCode = '';
  let testBorrowRequestId = '';
  let testBorrowDetailId = '';

  const cleanupItemIds: string[] = [];
  const cleanupBorrowRequestIds: string[] = [];
  // Record every return request key (including both concurrent attempts)
  // so cleanup never needs to delete records outside this suite.
  const e2eReturnKeys: string[] = [];
  const trackedE2EReturnKey = (): string => {
    const key = 'borrow_' + randomUUID();
    e2eReturnKeys.push(key);
    return key;
  };


  beforeEach(() => {
    loginRateLimiter.reset();
  });

  beforeAll(async () => {
    loginRateLimiter.reset();

    // -----------------------------------------------------------------------
    // SAFETY GATE: Verify strict isolation on dedicated database 'acm_inventory_test'
    // -----------------------------------------------------------------------
    const dbStatus = await checkDatabaseConnection();
    expect(dbStatus.connected).toBe(true);

    const currentDbResult: any = await prisma.$queryRaw`SELECT current_database() as db;`;
    const currentDb = currentDbResult[0]?.db;
    if (currentDb !== 'acm_inventory_test') {
      throw new Error(`CRITICAL ABORT: Connected to '${currentDb}', expected strictly 'acm_inventory_test'`);
    }
    expect(currentDb).toBe('acm_inventory_test');

    // Fetch prerequisite category and location
    const category = await prisma.category.findFirst();
    expect(category).toBeTruthy();
    testCategoryId = category!.id;

    const location = await prisma.location.findFirst({ where: { isActive: true } });
    expect(location).toBeTruthy();
    testLocationId = location!.id;

    // Test-only JWT fixtures: existing users are read-only.
    // The real authenticate middleware still verifies each user in PostgreSQL.
    for (const [email, role, target] of [
      ['admin@acm.local', UserRole.ADMIN, 'admin'],
      ['manager@acm.local', UserRole.LAB_MANAGER, 'manager'],
      ['tech@acm.local', UserRole.TECHNICIAN, 'tech'],
      ['student@acm.local', UserRole.STUDENT, 'student'],
    ] as const) {
      const seedUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, fullName: true, role: true, isActive: true, isLocked: true },
      });
      if (!seedUser || !seedUser.isActive || seedUser.isLocked || seedUser.role !== role) {
        throw new Error('E2E seed role/identity is missing or unavailable: ' + email);
      }
      const token = jwt.sign(
        { id: seedUser.id, email: seedUser.email, role: seedUser.role, fullName: seedUser.fullName },
        env.JWT_SECRET,
        { expiresIn: env.JWT_EXPIRES_IN as any },
      );
      if (target === 'admin') adminToken = token;
      if (target === 'manager') managerToken = token;
      if (target === 'tech') techToken = token;
      if (target === 'student') { studentToken = token; studentUserId = seedUser.id; }
    }
  });

  afterAll(async () => {
    // Clean up created entities safely
    try {
      // Return keys belong only to this test suite; remove cached results
      // before their parent test fixture borrow requests are deleted.
      if (e2eReturnKeys.length > 0) {
        await prisma.idempotencyRecord.deleteMany({
          where: { key: { in: e2eReturnKeys } },
        });
        const leftovers = await prisma.idempotencyRecord.count({
          where: { key: { in: e2eReturnKeys } },
        });
        if (leftovers !== 0) throw new Error('PHASE8 RETURN IDEMPOTENCY CLEANUP FAILED');
      }
      for (const reqId of cleanupBorrowRequestIds) {
        await prisma.auditLog.deleteMany({
          where: { entity: 'BorrowRequest', entityId: reqId },
        });
        const returnTxs = await prisma.returnTransaction.findMany({ where: { borrowRequestId: reqId } });
        for (const rtx of returnTxs) {
          await prisma.returnDetail.deleteMany({ where: { returnTransactionId: rtx.id } });
        }
        await prisma.returnTransaction.deleteMany({ where: { borrowRequestId: reqId } });
        await prisma.stockReservation.deleteMany({ where: { borrowRequestId: reqId } });
        await prisma.borrowDetail.deleteMany({ where: { borrowRequestId: reqId } });
        await prisma.borrowRequest.deleteMany({ where: { id: reqId } });
      }

      for (const itemId of cleanupItemIds) {
        await prisma.stockBalance.deleteMany({ where: { itemId } });
        await prisma.asset.deleteMany({ where: { itemId } });
        await prisma.stockTransactionDetail.deleteMany({ where: { itemId } });
        await prisma.stockMovement.deleteMany({ where: { itemId } });
        await prisma.auditLog.deleteMany({ where: { entityId: itemId } });
        await prisma.item.deleteMany({ where: { id: itemId } });
      }
    } catch (err) {
      console.error('Cleanup failed:', err);
      throw err;
    } finally {
      loginRateLimiter.destroy();
    }
  });

  // =========================================================================
  // 1. AUTHENTICATION & SECURITY (ĐĂNG NHẬP & BẢO MẬT TÀI KHOẢN)
  // =========================================================================
  describe('1. Authentication & Security Flows', () => {
    it('TC-E2E-AUTH-01: successfully authenticates valid user credentials and returns live JWT session', async () => {
      const role = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
      expect(role).not.toBeNull();
      const email = 'e2e-auth-valid-' + randomUUID() + '@acm.local';
      const password = 'E2E-valid-' + randomUUID() + '!';
      const fixture = await prisma.user.create({
        data: {
          email, fullName: 'E2E isolated admin login fixture', role: UserRole.ADMIN,
          roleId: role!.id, passwordHash: await bcrypt.hash(password, 4),
        },
      });
      try {
        const res = await request(app)
          .post('/api/v1/auth/login')
          .send({ email, password });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty('token');
        expect(res.body.data.user).toHaveProperty('email', email);
        expect(res.body.data.user).toHaveProperty('role', 'ADMIN');
      } finally {
        await prisma.auditLog.deleteMany({ where: { userId: fixture.id } });
        await prisma.user.delete({ where: { id: fixture.id } });
      }
    });

    it('TC-E2E-AUTH-02: rejects invalid password with HTTP 401', async () => {
      const role = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
      expect(role).not.toBeNull();
      const email = 'e2e-auth-denied-' + randomUUID() + '@acm.local';
      const fixture = await prisma.user.create({
        data: {
          email, fullName: 'E2E isolated invalid login fixture', role: UserRole.ADMIN,
          roleId: role!.id, passwordHash: await bcrypt.hash('E2E-valid-' + randomUUID() + '!', 4),
        },
      });
      try {
        const res = await request(app)
          .post('/api/v1/auth/login')
          .send({ email, password: 'CompletelyWrongPassword!' });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      } finally {
        await prisma.auditLog.deleteMany({ where: { userId: fixture.id } });
        await prisma.user.delete({ where: { id: fixture.id } });
      }
    });

    it('TC-E2E-AUTH-06: atomically locks an isolated account after five concurrent wrong passwords', async () => {
      const role = await prisma.role.findUnique({ where: { name: 'STUDENT' } });
      expect(role).not.toBeNull();
      const password = 'ConcurrentValidPass2026!';
      const email = `ci-lockout-${Date.now()}-${Math.random().toString(36).slice(2)}@acm.local`;
      const user = await prisma.user.create({
        data: {
          email,
          fullName: 'CI Concurrent Lockout Fixture',
          role: 'STUDENT',
          roleId: role!.id,
          passwordHash: await bcrypt.hash(password, 4),
        },
      });

      try {
        // Exactly five requests from one IP: all pass the IP-level rate limit.
        // The database counter must be incremented atomically, not lost in races.
        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            request(app).post('/api/v1/auth/login').send({
              email,
              password: 'IncorrectConcurrentPass2026!',
            })
          )
        );
        expect(results.every((res) => res.status === 401 || res.status === 403)).toBe(true);
        expect(results.filter((res) => res.status === 403)).toHaveLength(1);

        const state = await prisma.user.findUnique({
          where: { id: user.id },
          select: { failedLoginAttempts: true, isLocked: true },
        });
        expect(state).toEqual({ failedLoginAttempts: 5, isLocked: true });

        // Reset only the test rate limiter: a locked account must still reject
        // the correct password from any new IP / rate-limit window.
        loginRateLimiter.reset();
        const afterLock = await request(app).post('/api/v1/auth/login').send({ email, password });
        expect(afterLock.status).toBe(403);
      } finally {
        await prisma.user.delete({ where: { id: user.id } });
        loginRateLimiter.reset();
      }
    }, 30_000);

    it('TC-E2E-AUTH-07: valid login resets four concurrent failed attempts before lockout', async () => {
      const role = await prisma.role.findUnique({ where: { name: 'STUDENT' } });
      expect(role).not.toBeNull();
      const password = 'ConcurrentRecoveryPass2026!';
      const email = `ci-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}@acm.local`;
      const user = await prisma.user.create({
        data: {
          email,
          fullName: 'CI Concurrent Recovery Fixture',
          role: 'STUDENT',
          roleId: role!.id,
          passwordHash: await bcrypt.hash(password, 4),
        },
      });

      try {
        const failed = await Promise.all(
          Array.from({ length: 4 }, () =>
            request(app).post('/api/v1/auth/login').send({
              email,
              password: 'InvalidRecoveryPass2026!',
            })
          )
        );
        expect(failed.every((res) => res.status === 401)).toBe(true);

        const before = await prisma.user.findUnique({
          where: { id: user.id },
          select: { failedLoginAttempts: true, isLocked: true },
        });
        expect(before).toEqual({ failedLoginAttempts: 4, isLocked: false });

        const valid = await request(app).post('/api/v1/auth/login').send({ email, password });
        expect(valid.status).toBe(200);
        expect(valid.body.data.token).toBeTruthy();

        const after = await prisma.user.findUnique({
          where: { id: user.id },
          select: { failedLoginAttempts: true, isLocked: true },
        });
        expect(after).toEqual({ failedLoginAttempts: 0, isLocked: false });
      } finally {
        await prisma.user.delete({ where: { id: user.id } });
        loginRateLimiter.reset();
      }
    }, 30_000);

    it('TC-E2E-AUTH-03: returns current user profile via /me with authenticated token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user).toHaveProperty('email', 'student@acm.local');
      expect(res.body.data.user).toHaveProperty('role', 'STUDENT');
    });

    it('TC-E2E-AUTH-04: rejects fake or forged JWT token with HTTP 401', async () => {
      const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.forged_signature';
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${fakeToken}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('TC-E2E-AUTH-05: verifies self-service password change rejects incorrect current password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          currentPassword: 'IncorrectOldPassword123!',
          newPassword: 'BrandNewValidPassword2026!',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 2. ROLE-BASED ACCESS CONTROL (RBAC - PHÂN QUYỀN)
  // =========================================================================
  describe('2. Role-Based Access Control (RBAC) Enforcement', () => {
    it('TC-E2E-RBAC-01: STUDENT is prohibited from creating items (HTTP 403)', async () => {
      const res = await request(app)
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          code: 'UNAUTH-ITEM-01',
          name: 'Unauthorized Student Item',
          categoryId: testCategoryId,
          type: ItemType.CONSUMABLE,
          unit: 'pcs',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('TC-E2E-RBAC-02: STUDENT is prohibited from accessing user administration (HTTP 403)', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('TC-E2E-RBAC-03: TECHNICIAN cannot alter user status or privilege levels (HTTP 403)', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${studentUserId}/status`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({ isLocked: true });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('TC-E2E-RBAC-04: STUDENT is prohibited from approving borrow requests (HTTP 403)', async () => {
      const res = await request(app)
        .patch('/api/v1/borrow-requests/00000000-0000-0000-0000-000000000000/approve')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('TC-E2E-RBAC-06: denies unauthenticated and STUDENT access to audit logs', async () => {
      const endpoint = '/api/v1/audit-logs';
      const anonymous = await request(app).get(endpoint);
      expect(anonymous.status).toBe(401);
      const student = await request(app).get(endpoint).set('Authorization', `Bearer ${studentToken}`);
      expect(student.status).toBe(403);
      const manager = await request(app).get(endpoint).set('Authorization', `Bearer ${managerToken}`);
      expect(manager.status).toBe(403);
      const admin = await request(app).get(endpoint).set('Authorization', `Bearer ${adminToken}`);
      expect(admin.status).toBe(200);
    });

    it('TC-E2E-RBAC-07: restricts all sensitive report endpoints to ADMIN', async () => {
      for (const endpoint of ['/api/v1/reports/summary', '/api/v1/reports/inventory', '/api/v1/reports/borrow-return', '/api/v1/reports/low-stock']) {
        const student = await request(app).get(endpoint).set('Authorization', `Bearer ${studentToken}`);
        expect(student.status).toBe(403);
        const manager = await request(app).get(endpoint).set('Authorization', `Bearer ${managerToken}`);
        expect(manager.status).toBe(403);
      }
      const summary = await request(app).get('/api/v1/reports/summary').set('Authorization', `Bearer ${adminToken}`);
      expect(summary.status).toBe(200);
    });

    it('TC-E2E-RBAC-08: prevents STUDENT from invoking admin password reset', async () => {
      const before = await prisma.user.findUnique({ where: { id: studentUserId }, select: { passwordHash: true } });
      const forbidden = await request(app)
        .post(`/api/v1/users/${studentUserId}/reset-password`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ newPassword: 'ShouldNotChange-2026-strong' });
      expect(forbidden.status).toBe(403);
      const after = await prisma.user.findUnique({ where: { id: studentUserId }, select: { passwordHash: true } });
      expect(after?.passwordHash).toBe(before?.passwordHash);
    });

    it('TC-E2E-RBAC-05: ADMIN has full authorized access to administrative endpoints', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });
  });

  // =========================================================================
  // 3. INVENTORY MANAGEMENT (QUẢN LÝ TỒN KHO)
  // =========================================================================
  describe('3. Inventory Management & Stock Consistency', () => {
    it('TC-E2E-INV-01: ADMIN creates a test component and sets up stock balance', async () => {
      testItemCode = `TEST-P8-${Date.now().toString().slice(-4)}`;

      const res = await request(app)
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: testItemCode,
          name: `E2E Microcontroller Board ${Date.now()}`,
          categoryId: testCategoryId,
          type: ItemType.TRACKED_ASSET,
          unit: 'cái',
          minStockAlert: 5,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      testItemId = res.body.data.id;
      cleanupItemIds.push(testItemId);

      // Create stock balance of 20 units for this item at testLocation
      await prisma.stockBalance.create({
        data: {
          itemId: testItemId,
          locationId: testLocationId,
          onHand: 20,
          reserved: 0,
        },
      });

      // Verify item inventory via GET /items/:id
      const itemRes = await request(app)
        .get(`/api/v1/items/${testItemId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(itemRes.status).toBe(200);
      expect(itemRes.body.data.totalOnHand).toBe(20);
      expect(itemRes.body.data.available).toBe(20);
    });

    it('TC-E2E-INV-02: search and filter returns the created component by code', async () => {
      const res = await request(app)
        .get(`/api/v1/items?search=${encodeURIComponent(testItemCode)}`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const items = res.body.data;
      const found = items.find((i: any) => i.id === testItemId);
      expect(found).toBeDefined();
      expect(found.code).toBe(testItemCode);
    });

    it('TC-E2E-INV-03: rejects invalid item data with 422', async () => {
      const res = await request(app)
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          // missing code and unit
          name: 'Invalid Item',
          categoryId: testCategoryId,
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 4. BORROW & RETURN LIFECYCLE (VÒNG ĐỜI MƯỢN / TRẢ)
  // =========================================================================
  describe('4. Borrow & Return Lifecycle with Transactional Stock Reservation', () => {
    it('TC-E2E-BORROW-01: STUDENT requests to borrow items within available stock', async () => {
      const today = new Date();
      const borrowDate = today.toISOString();
      const returnDate = new Date(today.getTime() + 7 * 86400000).toISOString();

      const res = await request(app)
        .post('/api/v1/borrow-requests')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          purpose: 'Mượn thiết bị làm đồ án tốt nghiệp AI Robotics',
          expectedBorrowDate: borrowDate,
          expectedReturnDate: returnDate,
          items: [
            {
              itemId: testItemId,
              quantity: 5,
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.status).toBe('PENDING');

      testBorrowRequestId = res.body.data.id;
      cleanupBorrowRequestIds.push(testBorrowRequestId);

      expect(Array.isArray(res.body.data.details)).toBe(true);
      expect(res.body.data.details.length).toBeGreaterThan(0);
      testBorrowDetailId = res.body.data.details[0].id;
    });

    it('TC-E2E-BORROW-02: rejects borrow approval when requested quantity exceeds available stock', async () => {
      const today = new Date();
      const borrowDate = today.toISOString();
      const returnDate = new Date(today.getTime() + 7 * 86400000).toISOString();

      const createRes = await request(app)
        .post('/api/v1/borrow-requests')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          purpose: 'Mượn vượt quá số lượng tồn kho khả dụng',
          expectedBorrowDate: borrowDate,
          expectedReturnDate: returnDate,
          items: [
            {
              itemId: testItemId,
              quantity: 9999,
            },
          ],
        });

      expect(createRes.status).toBe(201);
      const excessRequestId = createRes.body.data.id;
      cleanupBorrowRequestIds.push(excessRequestId);

      // Approval attempt must fail with 400 Bad Request
      const approveRes = await request(app)
        .patch(`/api/v1/borrow-requests/${excessRequestId}/approve`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ notes: 'Thử duyệt số lượng vượt tồn kho' });

      expect(approveRes.status).toBe(400);
      expect(approveRes.body.success).toBe(false);
      expect(approveRes.body.message).toContain('Không đủ tồn kho khả dụng');
    });

    it('TC-E2E-BORROW-08: concurrent approvals never reserve more than one available unit', async () => {
      const item = await prisma.item.create({
        data: {
          code: `RACE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: 'Concurrent reservation test fixture',
          categoryId: testCategoryId,
          type: ItemType.CONSUMABLE,
          unit: 'pcs',
        },
      });
      cleanupItemIds.push(item.id);
      await prisma.stockBalance.create({
        data: { itemId: item.id, locationId: testLocationId, onHand: 1, reserved: 0 },
      });

      const now = new Date();
      const expectedReturnDate = new Date(now.getTime() + 7 * 86400000);
      const requestIds: string[] = [];
      for (let i = 0; i < 2; i++) {
        const created = await request(app).post('/api/v1/borrow-requests')
          .set('Authorization', `Bearer ${studentToken}`)
          .send({
            purpose: 'PostgreSQL parallel approval stock safety',
            expectedBorrowDate: now.toISOString(),
            expectedReturnDate: expectedReturnDate.toISOString(),
            items: [{ itemId: item.id, quantity: 1 }],
          });
        expect(created.status).toBe(201);
        requestIds.push(created.body.data.id);
        cleanupBorrowRequestIds.push(created.body.data.id);
      }

      const results = await Promise.all(requestIds.map((id) =>
        request(app).patch(`/api/v1/borrow-requests/${id}/approve`)
          .set('Authorization', `Bearer ${managerToken}`).send({})
      ));
      expect(results.filter((result) => result.status === 200)).toHaveLength(1);
      expect(results.filter((result) => [400, 409].includes(result.status))).toHaveLength(1);

      const balance = await prisma.stockBalance.findUnique({
        where: { itemId_locationId: { itemId: item.id, locationId: testLocationId } },
      });
      expect(balance?.onHand).toBe(1);
      expect(balance?.reserved).toBe(1);
      expect(balance!.onHand - balance!.reserved - balance!.quarantined - balance!.kitAllocated).toBe(0);
      const reservations = await prisma.stockReservation.findMany({
        where: { borrowRequestId: { in: requestIds }, status: 'ACTIVE' },
      });
      expect(reservations.reduce((sum, reservation) => sum + reservation.quantity, 0)).toBe(1);
    }, 30_000);

    it('TC-E2E-BORROW-03: LAB_MANAGER approves request, placing items into reserved stock', async () => {
      const res = await request(app)
        .patch(`/api/v1/borrow-requests/${testBorrowRequestId}/approve`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ notes: 'Đã duyệt yêu cầu mượn đồ án' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('APPROVED');

      // Verify item reservation: availableStock decreases by 5, reservedStock increases by 5
      const itemRes = await request(app)
        .get(`/api/v1/items/${testItemId}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(itemRes.body.data.totalOnHand).toBe(20);
      expect(itemRes.body.data.available).toBe(15);
    });

    it('TC-E2E-BORROW-04: TECHNICIAN performs physical handover of reserved items', async () => {
      const res = await request(app)
        .patch(`/api/v1/borrow-requests/${testBorrowRequestId}/handover`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({ notes: 'Bàn giao linh kiện tại bàn Lab 102' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('HANDED_OVER');
    });

    it('TC-E2E-BORROW-06: rejects duplicate detail rows before stock or return history changes', async () => {
      const beforeDetail = await prisma.borrowDetail.findUnique({
        where: { id: testBorrowDetailId },
        select: { returnedQuantity: true },
      });
      const beforeReturns = await prisma.returnTransaction.count({ where: { borrowRequestId: testBorrowRequestId } });

      const rejected = await request(app)
        .post(`/api/v1/borrow-requests/${testBorrowRequestId}/return`).set('Idempotency-Key', trackedE2EReturnKey())
        .set('Authorization', `Bearer ${techToken}`)
        .send({
          items: [
            { borrowDetailId: testBorrowDetailId, returnedQuantity: 5, condition: AssetCondition.GOOD },
            { borrowDetailId: testBorrowDetailId, returnedQuantity: 5, condition: AssetCondition.DAMAGED },
          ],
        });

      expect(rejected.status).toBe(422);
      const afterDetail = await prisma.borrowDetail.findUnique({
        where: { id: testBorrowDetailId },
        select: { returnedQuantity: true },
      });
      const afterReturns = await prisma.returnTransaction.count({ where: { borrowRequestId: testBorrowRequestId } });
      expect(afterDetail?.returnedQuantity).toBe(beforeDetail?.returnedQuantity);
      expect(afterReturns).toBe(beforeReturns);
    });

    it('TC-E2E-BORROW-07: rejects return to a different warehouse without changing source ledger', async () => {
      const before = await prisma.stockBalance.findUnique({
        where: { itemId_locationId: { itemId: testItemId, locationId: testLocationId } },
        select: { onHand: true, borrowed: true, reserved: true },
      });
      const beforeReturns = await prisma.returnTransaction.count({
        where: { borrowRequestId: testBorrowRequestId },
      });
      const invalidDestination = '00000000-0000-4000-8000-000000000001';
      const res = await request(app)
        .post(`/api/v1/borrow-requests/${testBorrowRequestId}/return`).set('Idempotency-Key', trackedE2EReturnKey())
        .set('Authorization', `Bearer ${techToken}`)
        .send({
          items: [{ borrowDetailId: testBorrowDetailId, returnedQuantity: 1,
            condition: AssetCondition.GOOD, locationId: invalidDestination }],
        });
      expect(res.status).toBe(409);
      const after = await prisma.stockBalance.findUnique({
        where: { itemId_locationId: { itemId: testItemId, locationId: testLocationId } },
        select: { onHand: true, borrowed: true, reserved: true },
      });
      expect(after).toEqual(before);
      expect(await prisma.returnTransaction.count({ where: { borrowRequestId: testBorrowRequestId } }))
        .toBe(beforeReturns);
    });

    it('TC-E2E-BORROW-05: TECHNICIAN confirms return in GOOD condition and reconciles inventory stock', async () => {
      const res = await request(app)
        .post(`/api/v1/borrow-requests/${testBorrowRequestId}/return`).set('Idempotency-Key', trackedE2EReturnKey())
        .set('Authorization', `Bearer ${techToken}`)
        .send({
          items: [
            {
              borrowDetailId: testBorrowDetailId,
              returnedQuantity: 5,
              condition: AssetCondition.GOOD,
              notes: 'Thiết bị hoạt động tốt, không trầy xước',
            },
          ],
          notes: 'Hoàn tất kiểm tra và nhập lại kho',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify item inventory returned to full available stock
      const itemRes = await request(app)
        .get(`/api/v1/items/${testItemId}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(itemRes.body.data.totalOnHand).toBe(20);
      expect(itemRes.body.data.available).toBe(20);
    });
    it('TC-E2E-BORROW-09: concurrent duplicate returns cannot double-credit stock', async () => {
      const item = await prisma.item.create({
        data: {
          code: `RETURN-RACE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: 'Concurrent return test fixture',
          categoryId: testCategoryId,
          type: ItemType.CONSUMABLE,
          unit: 'pcs',
        },
      });
      cleanupItemIds.push(item.id);
      await prisma.stockBalance.create({
        data: { itemId: item.id, locationId: testLocationId, onHand: 1, reserved: 0 },
      });
      const now = new Date();
      const created = await request(app).post('/api/v1/borrow-requests')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          purpose: 'PostgreSQL parallel return stock safety',
          expectedBorrowDate: now.toISOString(),
          expectedReturnDate: new Date(now.getTime() + 7 * 86400000).toISOString(),
          items: [{ itemId: item.id, quantity: 1 }],
        });
      expect(created.status).toBe(201);
      const requestId = created.body.data.id;
      const detailId = created.body.data.details[0].id;
      cleanupBorrowRequestIds.push(requestId);

      const approved = await request(app).patch(`/api/v1/borrow-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${managerToken}`).send({});
      expect(approved.status).toBe(200);
      const handedOver = await request(app).patch(`/api/v1/borrow-requests/${requestId}/handover`)
        .set('Authorization', `Bearer ${techToken}`).send({});
      expect(handedOver.status).toBe(200);

      const response = await Promise.all(Array.from({ length: 2 }, () =>
        request(app).post(`/api/v1/borrow-requests/${requestId}/return`).set('Idempotency-Key', trackedE2EReturnKey())
          .set('Authorization', `Bearer ${techToken}`)
          .send({ items: [{ borrowDetailId: detailId, returnedQuantity: 1,
            condition: AssetCondition.GOOD }] })
      ));
      expect(response.filter((res) => res.status === 200)).toHaveLength(1);
      expect(response.filter((res) => [400, 409].includes(res.status))).toHaveLength(1);
      const balance = await prisma.stockBalance.findUnique({
        where: { itemId_locationId: { itemId: item.id, locationId: testLocationId } },
      });
      expect(balance?.onHand).toBe(1);
      expect(balance?.borrowed).toBe(0);
      expect((await prisma.borrowDetail.findUnique({ where: { id: detailId } }))?.returnedQuantity).toBe(1);
      expect(await prisma.returnTransaction.count({ where: { borrowRequestId: requestId } })).toBe(1);
    }, 30_000);
  });

  // =========================================================================
  // 5. AUDIT LOG INTEGRITY & SANITIZATION (NHẬT KÝ KIỂM TOÁN VÀ BẢO MẬT DỮ LIỆU)
  // =========================================================================
  describe('5. Audit Log Integrity and Sanitization', () => {
    it('TC-E2E-AUDIT-01: confirms system created immutable audit log entries for item and borrow operations', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs?limit=20')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThan(0);

      // Verify log structure
      const sample = res.body.data.items[0];
      expect(sample).toHaveProperty('id');
      expect(sample).toHaveProperty('action');
      expect(sample).toHaveProperty('entity');
      expect(sample).toHaveProperty('createdAt');
      expect(sample).toHaveProperty('user');
    });

    it('TC-E2E-AUDIT-02: verifies sensitive credentials are NEVER leaked into audit log records', async () => {
      const logs = await prisma.auditLog.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' },
      });

      for (const log of logs) {
        const jsonStr = JSON.stringify(log);
        expect(jsonStr).not.toContain('ACM@dev2026!');
        expect(jsonStr).not.toContain('super-secret-acm-jwt-token');
        if (log.newValue && typeof log.newValue === 'object') {
          const nv = log.newValue as Record<string, any>;
          expect(nv.password).toBeUndefined();
          expect(nv.passwordHash).toBeUndefined();
        }
      }
    });
  });
});
