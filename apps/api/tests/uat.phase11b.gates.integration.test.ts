import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/config/database';
import { env } from '../src/config/env';
import { loginRateLimiter } from '../src/middleware/rateLimiter';
import { AssetCondition, ItemType } from '@acm/shared';

// Explicitly isolated automated API/DB UAT, not manual UI approval.
const app = createApp();
const gatesReturnKeys: string[] = [];
const trackedGatesReturnKey = (): string => {
  const key = 'borrow_' + randomUUID();
  gatesReturnKeys.push(key);
  return key;
};

const evidencePath = resolve(__dirname, '../test-results/phase11b-gates-evidence.json');
const evidence = {
  kind: 'PHASE11B_AUTOMATED_API_DB_UAT',
  environment: 'local acm_inventory_test only',
  commit: process.env.GITHUB_SHA || null,
  status: 'INCOMPLETE',
  cleanup: 'PENDING',
  cases: [] as Array<{ id: string; outcome: string; checks: string[] }>,
};
function save() {
  mkdirSync(resolve(__dirname, '../test-results'), { recursive: true });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
}
function pass(id: string, ...checks: string[]) {
  evidence.cases.push({ id, outcome: 'PASS', checks });
  save();
}
const prefix = 'UAT11B-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
let admin = '', manager = '', technician = '', student = '', outsider = '';
let adminBaseline: any;
let firstItemId = '', multisourceItemId = '', locationId = '', secondLocationId = '';
let borrowerId = '', outsiderId = '', categoryId = '';
let cancelledRequestId = '', excessRequestId = '', multisourceRequestId = '';
const requestIds: string[] = [];
const itemIds: string[] = [];
const balance = async (itemId: string, placeId = locationId) => {
  const row = await prisma.stockBalance.findUniqueOrThrow({
    where: { itemId_locationId: { itemId, locationId: placeId } },
  });
  return {
    onHand: row.onHand, reserved: row.reserved, borrowed: row.borrowed,
    quarantined: row.quarantined, kitAllocated: row.kitAllocated,
    available: row.onHand - row.reserved - row.quarantined - row.kitAllocated,
  };
};
const createRequest = async (itemId: string, quantity: number) => {
  const d = new Date();
  const response = await request(app).post('/api/v1/borrow-requests')
    .set('Authorization', 'Bearer ' + student)
    .send({
      purpose: 'Phase 11B isolated UAT ledger gate',
      expectedBorrowDate: d.toISOString(),
      expectedReturnDate: new Date(d.getTime() + 7 * 86400000).toISOString(),
      items: [{ itemId, quantity }],
    });
  expect(response.status).toBe(201);
  requestIds.push(response.body.data.id);
  return response.body.data;
};

describe('Phase 11B — isolated PostgreSQL UAT release gates', () => {
  beforeAll(async () => {
    const connection = new URL(process.env.DATABASE_URL || '');
    if (process.env.NODE_ENV !== 'test' ||
        !['127.0.0.1', 'localhost', '::1'].includes(connection.hostname) ||
        connection.pathname !== '/acm_inventory_test') {
      throw new Error('UAT SAFETY: refuses anything other than local acm_inventory_test');
    }
    const db = await prisma.$queryRawUnsafe<Array<{ db: string }>>('SELECT current_database() AS db');
    if (db[0]?.db !== 'acm_inventory_test') throw new Error('UAT SAFETY: connected DB differs');
    const category = await prisma.category.findFirst();
    const location = await prisma.location.findFirst({ where: { isActive: true } });
    const role = await prisma.role.findUnique({ where: { name: 'STUDENT' } });
    if (!category || !location || !role) throw new Error('Seed test data is incomplete');
    categoryId = category.id;
    locationId = location.id;
    loginRateLimiter.reset();
    // Test-only JWT fixtures: do not update existing seed users via login.
    // authenticate middleware still checks live database identity and role.
    for (const [email, key] of [
      ['admin@acm.local', 'admin'],
      ['manager@acm.local', 'manager'],
      ['tech@acm.local', 'technician'],
      ['student@acm.local', 'student'],
    ] as const) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          isLocked: true,
        },
      });

      if (!user || !user.isActive || user.isLocked) {
        throw new Error('UAT seed user missing or inactive: ' + email);
      }

      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
        },
        env.JWT_SECRET,
        { expiresIn: env.JWT_EXPIRES_IN as any }
      );

      if (key === 'admin') admin = token;
      if (key === 'manager') manager = token;
      if (key === 'technician') technician = token;
      if (key === 'student') {
        student = token;
        borrowerId = user.id;
      }
    }
    const outsiderPass = 'Phase11BOutsider-2026!123';
    const external = await prisma.user.create({
      data: {
        email: prefix.toLowerCase() + '@acm.local',
        fullName: 'Phase 11B isolated second student',
        role: 'STUDENT',
        roleId: role.id,
        passwordHash: await bcrypt.hash(outsiderPass, 4),
      },
    });
    outsiderId = external.id;
    loginRateLimiter.reset();
    const login = await request(app).post('/api/v1/auth/login')
      .send({ email: external.email, password: outsiderPass });
    expect(login.status).toBe(200);
    outsider = login.body.data.token;

    const baseline = await request(app).get('/api/v1/reports/summary')
      .set('Authorization', 'Bearer ' + admin);
    expect(baseline.status).toBe(200);
    adminBaseline = baseline.body.data.kpis;
    save();
  }, 30_000);

  afterAll(async () => {
    try {
      // An invalid return normally rolls back its idempotency record.
      // Delete ONLY any records created by this suite's return request key.
      if (gatesReturnKeys.length > 0) {
        await prisma.idempotencyRecord.deleteMany({
          where: { key: { in: gatesReturnKeys } },
        });
        const leftovers = await prisma.idempotencyRecord.count({
          where: { key: { in: gatesReturnKeys } },
        });
        if (leftovers !== 0) throw new Error('PHASE11B RETURN IDEMPOTENCY CLEANUP FAILED');
      }
      // Never delete user or shared seed fixtures. Only remove IDs created here.
      for (const id of requestIds) {
        const relatedReturns = await prisma.returnTransaction.findMany({
          where: { borrowRequestId: id }, select: { id: true },
        });
        await prisma.returnDetail.deleteMany({
          where: { returnTransactionId: { in: relatedReturns.map(x => x.id) } },
        });
        await prisma.returnTransaction.deleteMany({ where: { borrowRequestId: id } });
        await prisma.stockReservation.deleteMany({ where: { borrowRequestId: id } });
        await prisma.borrowDetail.deleteMany({ where: { borrowRequestId: id } });
        await prisma.borrowRequest.deleteMany({ where: { id } });
      }
      await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { entityId: { in: [...requestIds, ...itemIds] } },
            ...(outsiderId ? [{ userId: outsiderId }] : []),
          ],
        },
      });
      await prisma.stockBalance.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.stockTransactionDetail.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      if (secondLocationId) await prisma.location.delete({ where: { id: secondLocationId } });
      if (outsiderId) await prisma.user.delete({ where: { id: outsiderId } });
      evidence.cleanup = 'PASS';
      if (evidence.cases.length === 6 && evidence.cases.every(c => c.outcome === 'PASS')) {
        evidence.status = 'PASS';
      } else {
        evidence.status = 'FAIL';
      }
    } catch (err) {
      evidence.cleanup = 'FAIL';
      evidence.status = 'FAIL';
      throw err;
    } finally {
      loginRateLimiter.destroy();
      save();
    }
  }, 30_000);

  it('UAT-08: cancelling APPROVED request releases the exact reserved amount', async () => {
    const created = await request(app).post('/api/v1/items')
      .set('Authorization', 'Bearer ' + admin)
      .send({ code: prefix + '-I', name: 'Phase11B isolated ledger item',
        categoryId, type: ItemType.CONSUMABLE, unit: 'pcs' });
    expect(created.status).toBe(201);
    firstItemId = created.body.data.id;
    itemIds.push(firstItemId);
    await prisma.stockBalance.create({
      data: { itemId: firstItemId, locationId, onHand: 10 },
    });
    const pending = await createRequest(firstItemId, 4);
    cancelledRequestId = pending.id;
    const approved = await request(app).patch('/api/v1/borrow-requests/' + pending.id + '/approve')
      .set('Authorization', 'Bearer ' + manager).send({});
    expect(approved.status).toBe(200);
    expect(await balance(firstItemId)).toMatchObject({ onHand: 10, reserved: 4, available: 6 });
    const cancelled = await request(app).patch('/api/v1/borrow-requests/' + pending.id + '/cancel')
      .set('Authorization', 'Bearer ' + manager).send({ reason: 'Phase11B verify release' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(await balance(firstItemId)).toMatchObject({
      onHand: 10, reserved: 0, borrowed: 0, available: 10,
    });
    const reservations = await prisma.stockReservation.findMany({ where: { borrowRequestId: pending.id } });
    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe('RELEASED');
    pass('UAT-08', 'approved reserved=4', 'cancelled reserved=0', 'onHand=10', 'reservation released');
  });

  it('UAT-09: approval exceeding available stock changes neither ledger nor request state', async () => {
    const pending = await createRequest(firstItemId, 99);
    excessRequestId = pending.id;
    const old = await balance(firstItemId);
    const rejected = await request(app).patch('/api/v1/borrow-requests/' + pending.id + '/approve')
      .set('Authorization', 'Bearer ' + manager).send({});
    expect(rejected.status).toBe(400);
    expect(await balance(firstItemId)).toEqual(old);
    expect(await prisma.stockReservation.count({ where: { borrowRequestId: pending.id } })).toBe(0);
    expect((await prisma.borrowRequest.findUnique({ where: { id: pending.id } }))?.status).toBe('PENDING');
    pass('UAT-09', 'insufficient stock denied', 'no reservations created', 'stock unchanged');
  });

  it('UAT-15: another STUDENT cannot view, cancel or discover someone else’s request', async () => {
    const forbidden = await request(app).get('/api/v1/borrow-requests/' + excessRequestId)
      .set('Authorization', 'Bearer ' + outsider);
    expect(forbidden.status).toBe(403);
    const forbiddenCancel = await request(app).patch('/api/v1/borrow-requests/' + excessRequestId + '/cancel')
      .set('Authorization', 'Bearer ' + outsider).send({ reason: 'not owned' });
    expect(forbiddenCancel.status).toBe(403);
    const listed = await request(app).get('/api/v1/borrow-requests?limit=100')
      .set('Authorization', 'Bearer ' + outsider);
    expect(listed.status).toBe(200);
    expect(listed.body.data.some((b: any) => b.id === excessRequestId)).toBe(false);
    expect((await prisma.borrowRequest.findUnique({ where: { id: excessRequestId } }))?.status).toBe('PENDING');
    pass('UAT-15', 'view other borrower 403', 'cancel other borrower 403', 'list hides other borrower');
  });

  it('UAT-12: multi-origin handover forbids ambiguous return and preserves both warehouses', async () => {
    const location = await prisma.location.create({
      data: { code: prefix + '-L', name: 'Phase11B second warehouse', isActive: true },
    });
    secondLocationId = location.id;
    const item = await prisma.item.create({
      data: { code: prefix + '-II', name: 'Phase11B multi-source item',
        categoryId, type: ItemType.CONSUMABLE, unit: 'pcs' },
    });
    multisourceItemId = item.id;
    itemIds.push(item.id);
    await prisma.stockBalance.createMany({ data: [
      { itemId: item.id, locationId, onHand: 1 },
      { itemId: item.id, locationId: secondLocationId, onHand: 1 },
    ] });
    const pending = await createRequest(item.id, 2);
    multisourceRequestId = pending.id;
    const approved = await request(app).patch('/api/v1/borrow-requests/' + pending.id + '/approve')
      .set('Authorization', 'Bearer ' + manager).send({});
    expect(approved.status).toBe(200);
    const handed = await request(app).patch('/api/v1/borrow-requests/' + pending.id + '/handover')
      .set('Authorization', 'Bearer ' + technician).send({});
    expect(handed.status).toBe(200);
    const origins = await prisma.stockReservation.findMany({
      where: { borrowRequestId: pending.id, status: 'FULFILLED' },
    });
    expect(new Set(origins.map(x => x.locationId)).size).toBe(2);
    const beforeA = await balance(item.id, locationId);
    const beforeB = await balance(item.id, secondLocationId);
    expect(beforeA).toMatchObject({ onHand: 0, borrowed: 1 });
    expect(beforeB).toMatchObject({ onHand: 0, borrowed: 1 });
    const rejected = await request(app).post('/api/v1/borrow-requests/' + pending.id + '/return').set('Idempotency-Key', trackedGatesReturnKey())
      .set('Authorization', 'Bearer ' + technician)
      .send({ items: [{ borrowDetailId: pending.details[0].id, returnedQuantity: 1,
        condition: AssetCondition.GOOD, locationId }] });
    expect(rejected.status).toBe(409);
    expect(await balance(item.id, locationId)).toEqual(beforeA);
    expect(await balance(item.id, secondLocationId)).toEqual(beforeB);
    expect(await prisma.returnTransaction.count({ where: { borrowRequestId: pending.id } })).toBe(0);
    pass('UAT-12', 'two source locations fulfilled', 'return HTTP 409', 'no stock or return mutation');
  });

  it('UAT-16/18: audit trails are attributable and privileged access is ADMIN-only', async () => {
    const logs = await prisma.auditLog.findMany({
      where: { entity: 'BorrowRequest', entityId: cancelledRequestId },
      orderBy: { createdAt: 'asc' },
    });
    const actions = new Set(logs.map(x => x.action));
    for (const action of ['CREATE', 'APPROVE', 'CANCEL']) expect(actions.has(action)).toBe(true);
    expect(logs.length).toBeGreaterThanOrEqual(3);
    for (const log of logs) {
      expect(log.userId).toBeTruthy();
      expect(log.createdAt).toBeInstanceOf(Date);
    }
    const adminRead = await request(app).get('/api/v1/audit-logs/' + logs[0].id)
      .set('Authorization', 'Bearer ' + admin);
    expect(adminRead.status).toBe(200);
    expect(adminRead.body.data.entityId).toBe(cancelledRequestId);
    expect(JSON.stringify(adminRead.body.data)).not.toMatch(/passwordHash|Bearer |"jwtSecret"/i);
    const managerRead = await request(app).get('/api/v1/audit-logs')
      .set('Authorization', 'Bearer ' + manager);
    expect(managerRead.status).toBe(403);
    const studentRead = await request(app).get('/api/v1/audit-logs')
      .set('Authorization', 'Bearer ' + student);
    expect(studentRead.status).toBe(403);
    pass('UAT-16/18', 'CREATE/APPROVE/CANCEL audit trail', 'ADMIN 200', 'LAB_MANAGER/STUDENT 403');
  });

  it('UAT-17: admin Dashboard and Inventory Report reconcile without double-counting Borrowed', async () => {
    const summary = await request(app).get('/api/v1/reports/summary')
      .set('Authorization', 'Bearer ' + admin);
    expect(summary.status).toBe(200);
    const now = summary.body.data.kpis;
    expect(now.totalOnHand - adminBaseline.totalOnHand).toBe(10);
    expect(now.totalBorrowed - adminBaseline.totalBorrowed).toBe(2);
    expect(now.totalReserved - adminBaseline.totalReserved).toBe(0);
    expect(now.totalQuarantined - adminBaseline.totalQuarantined).toBe(0);
    expect(now.totalAvailable - adminBaseline.totalAvailable).toBe(10);
    const inv = await request(app).get('/api/v1/reports/inventory')
      .set('Authorization', 'Bearer ' + admin);
    expect(inv.status).toBe(200);
    const first = inv.body.data.find((row: any) => row.id === firstItemId);
    const second = inv.body.data.find((row: any) => row.id === multisourceItemId);
    expect(first).toMatchObject({ onHand: 10, reserved: 0, borrowed: 0, available: 10 });
    expect(second).toMatchObject({ onHand: 0, reserved: 0, borrowed: 2, available: 0 });
    for (const roleToken of [manager, technician, student]) {
      const denied = await request(app).get('/api/v1/reports/summary')
        .set('Authorization', 'Bearer ' + roleToken);
      expect(denied.status).toBe(403);
    }
    pass('UAT-17', 'dashboard delta OnHand+10, Borrowed+2, Available+10',
      'two Inventory Report rows reconcile', 'non-ADMIN reports 403');
  });
});
