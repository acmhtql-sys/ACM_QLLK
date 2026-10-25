/**
 * ACM Phase 11D -- isolated PostgreSQL idempotency acceptance.
 * Run ONLY as the single explicit Vitest target against the sandbox
 * 127.0.0.1:55432/acm_inventory_test.
 * No migrations, no seeds, no legacy UAT tests.
 *
 * Creates a uniquely identified item/borrow, verifies replay + mismatch +
 * concurrent duplicate, and removes only fixtures created by this test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/config/database';
import { env } from '../src/config/env';
import { AssetCondition, ItemType } from '@acm/shared';

const app = createApp();
const EXPECTED_DIR = 'd:/acm_integration_sandbox/pgdata';
const fixtureTag = 'ID11D' + randomUUID().replace(/-/g, '').slice(0, 18).toUpperCase();
const expectedCounts = [
  'borrowRequest', 'borrowDetail', 'returnTransaction', 'returnDetail',
  'stockMovement', 'idempotencyRecord', 'stockTransaction',
  'stockTransactionDetail', 'stockBalance', 'stockReservation', 'item', 'auditLog',
] as const;
type CountName = typeof expectedCounts[number];
type Counts = Record<CountName, number>;

const fixture: {
  itemId?: string;
  borrowId?: string;
  detailId?: string;
  importTxId?: string;
  importKey?: string;
  returnKeys: string[];
  techUserId?: string;
  managerUserId?: string;
} = { returnKeys: [] };
let initialCounts: Counts | null = null;
let adminToken = '';
let managerToken = '';
let studentToken = '';
let techToken = '';
let locationId = '';
let categoryId = '';
let preflightPassed = false;

async function verifyExactSandbox() {
  // Independent protection: the test setup's database-name check alone is insufficient.
  if (process.env.NODE_ENV !== 'test') throw new Error('SAFETY: NODE_ENV must equal test');
  const u = new URL(env.DATABASE_URL);
  if (u.hostname !== '127.0.0.1' || u.port !== '55432' ||
      u.pathname !== '/acm_inventory_test' || decodeURIComponent(u.username) !== 'postgres') {
    throw new Error('SAFETY: refusing non-sandbox DATABASE_URL');
  }
  const rows = await prisma.$queryRawUnsafe<Array<{
    database_name: string; server_port: number | null; data_dir: string;
  }>>(
    'SELECT current_database() AS database_name, inet_server_port() AS server_port, ' +
    "current_setting('data_directory') AS data_dir"
  );
  const row = rows[0];
  const dir = row?.data_dir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (row?.database_name !== 'acm_inventory_test' || row?.server_port !== 55432 ||
      dir !== EXPECTED_DIR) {
    throw new Error('SAFETY: connected PostgreSQL cluster identity does not match sandbox');
  }
}

async function countDatabaseRows(): Promise<Counts> {
  const entries = await Promise.all(expectedCounts.map(async name =>
    [name, await (prisma[name] as any).count()] as const
  ));
  return Object.fromEntries(entries) as Counts;
}

function key(suffix: string) {
  return `phase11d_${suffix}_${randomUUID().replace(/-/g, '')}`;
}

function token(user: { id: string; email: string; fullName: string; role: string }) {
  return jwt.sign({ id: user.id, email: user.email, fullName: user.fullName, role: user.role },
    env.JWT_SECRET, { expiresIn: '15m' });
}

function stockShape(b: { onHand: number; reserved: number; borrowed: number; quarantined: number; kitAllocated: number }) {
  return { onHand: b.onHand, reserved: b.reserved, borrowed: b.borrowed,
    quarantined: b.quarantined, kitAllocated: b.kitAllocated };
}

async function stock() {
  if (!fixture.itemId) throw new Error('Fixture item not initialized');
  const b = await prisma.stockBalance.findUniqueOrThrow({
    where: { itemId_locationId: { itemId: fixture.itemId, locationId } },
  });
  return stockShape(b);
}

async function businessCounts() {
  const id = fixture.borrowId!;
  const itemId = fixture.itemId!;
  return {
    returns: await prisma.returnTransaction.count({ where: { borrowRequestId: id } }),
    returnDetails: await prisma.returnDetail.count({
      where: { returnTransaction: { borrowRequestId: id } },
    }),
    movements: await prisma.stockMovement.count({ where: { itemId } }),
    auditReturns: await prisma.auditLog.count({
      where: { entity: 'BorrowRequest', entityId: id, action: 'RETURN' },
    }),
    returnedQuantity: (await prisma.borrowDetail.findUniqueOrThrow({
      where: { id: fixture.detailId! }, select: { returnedQuantity: true },
    })).returnedQuantity,
  };
}

async function cleanupFixture() {
  if (!fixture.itemId) return;
  await verifyExactSandbox();
  const itemId = fixture.itemId;
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item || item.code !== fixtureTag) {
    throw new Error('SAFETY: fixture item code mismatch; cleanup refused');
  }
  const importKey = fixture.importKey;
  // Recover IDs from the test's unique item if an API call committed but failed
  // before its HTTP response was captured by the test process.
  const linkedBorrowDetails = await prisma.borrowDetail.findMany({
    where: { itemId }, select: { borrowRequestId: true },
  });
  const linkedBorrowIds = [...new Set(linkedBorrowDetails.map(d => d.borrowRequestId))];
  if (linkedBorrowIds.length > 1 || (fixture.borrowId && linkedBorrowIds.length &&
      linkedBorrowIds[0] !== fixture.borrowId)) {
    throw new Error('SAFETY: unexpected borrowed fixture ownership; cleanup refused');
  }
  const borrowId = fixture.borrowId || linkedBorrowIds[0];
  if (borrowId) {
    const ownBorrow = await prisma.borrowRequest.findUnique({ where: { id: borrowId } });
    if (!ownBorrow || ownBorrow.purpose !== 'Phase11D return idempotency safety') {
      throw new Error('SAFETY: unexpected borrow fixture; cleanup refused');
    }
  }
  const linkedTxs = await prisma.stockTransactionDetail.findMany({
    where: { itemId }, select: { stockTransactionId: true },
  });
  const linkedTxIds = [...new Set(linkedTxs.map(d => d.stockTransactionId))];
  if (linkedTxIds.length > 1 || (fixture.importTxId && linkedTxIds.length &&
      linkedTxIds[0] !== fixture.importTxId)) {
    throw new Error('SAFETY: unexpected stock transaction ownership; cleanup refused');
  }
  const importTxId = fixture.importTxId || linkedTxIds[0];
  const endpoint = borrowId ? `/api/v1/borrow-requests/${borrowId}/return` : null;
  console.log(`PHASE11D CLEANUP -- fixture item ${itemId}, borrow ${borrowId || '(none)'}`);

  await prisma.$transaction(async tx => {
    // Restrict each deletion to IDs created by THIS test. Shared category,
    // location, seeded users and pre-existing borrow/return are never deleted.
    if (endpoint) {
      const ownRecords = await tx.idempotencyRecord.findMany({ where: { endpoint } });
      if (ownRecords.some(r => !fixture.returnKeys.includes(r.key) ||
          r.userId !== fixture.techUserId)) {
        throw new Error('SAFETY: unexpected idempotency owner/key; cleanup refused');
      }
      await tx.idempotencyRecord.deleteMany({ where: { endpoint, key: { in: fixture.returnKeys } } });
    }
    if (importKey) {
      const importRecord = await tx.idempotencyRecord.findUnique({ where: { key: importKey } });
      if (importRecord && (importRecord.endpoint !== '/api/v1/stock-transactions/import' ||
          importRecord.userId !== fixture.managerUserId)) {
        throw new Error('SAFETY: unexpected stock import key owner; cleanup refused');
      }
      await tx.idempotencyRecord.deleteMany({ where: { key: importKey } });
    }
    const returnIds = borrowId ? (await tx.returnTransaction.findMany({
      where: { borrowRequestId: borrowId }, select: { id: true },
    })).map(x => x.id) : [];
    if (returnIds.length) {
      await tx.returnDetail.deleteMany({ where: { returnTransactionId: { in: returnIds } } });
      await tx.returnTransaction.deleteMany({ where: { id: { in: returnIds } } });
    }
    if (borrowId) {
      await tx.stockReservation.deleteMany({ where: { borrowRequestId: borrowId } });
      await tx.borrowDetail.deleteMany({ where: { borrowRequestId: borrowId } });
      await tx.borrowRequest.deleteMany({ where: { id: borrowId } });
    }
    await tx.stockMovement.deleteMany({ where: { itemId } });
    const auditEntityIds = [itemId, borrowId, importTxId, ...returnIds].filter(
      (x): x is string => Boolean(x)
    );
    await tx.auditLog.deleteMany({ where: { entityId: { in: auditEntityIds } } });
    await tx.stockBalance.deleteMany({ where: { itemId } });
    await tx.asset.deleteMany({ where: { itemId } });
    if (importTxId) {
      await tx.stockTransactionDetail.deleteMany({ where: { stockTransactionId: importTxId } });
      await tx.stockTransaction.deleteMany({ where: { id: importTxId } });
    }
    await tx.item.delete({ where: { id: itemId } });
  }, { timeout: 30_000, maxWait: 10_000 });
  console.log('PHASE11D FIXTURE CLEANUP: PASS');
}

describe('Phase 11D -- isolated PostgreSQL idempotency integration safety', () => {
  beforeAll(async () => {
    await verifyExactSandbox();
    const [category, location] = await Promise.all([
      prisma.category.findFirst(),
      prisma.location.findFirst({ where: { isActive: true } }),
    ]);
    if (!category || !location) throw new Error('SANDBOX: missing seed category/location');
    categoryId = category.id;
    locationId = location.id;
    const users = await Promise.all(['admin', 'manager', 'student', 'tech'].map(name =>
      prisma.user.findUnique({ where: { email: `${name}@acm.local` } })
    ));
    if (users.some(u => !u || !u.isActive || u.isLocked)) {
      throw new Error('SANDBOX: missing/locked seeded test user');
    }
    if (users[0]!.role !== 'ADMIN' || users[1]!.role !== 'LAB_MANAGER' ||
        users[2]!.role !== 'STUDENT' || users[3]!.role !== 'TECHNICIAN') {
      throw new Error('SANDBOX: seed user role mismatch');
    }
    adminToken = token(users[0]!);
    managerToken = token(users[1]!);
    studentToken = token(users[2]!);
    techToken = token(users[3]!);
    fixture.managerUserId = users[1]!.id;
    fixture.techUserId = users[3]!.id;
    initialCounts = await countDatabaseRows();
    preflightPassed = true;
    console.log('PHASE11D FIXTURE TAG: ' + fixtureTag);
    console.log('PHASE11D EXACT SANDBOX IDENTITY: PASS (127.0.0.1:55432)');
    console.log('PHASE11D EXISTING BASELINE -- no existing rows will be mutated');
  }, 20_000);

  afterAll(async () => {
    if (!preflightPassed) return;
    try {
      await cleanupFixture();
      await verifyExactSandbox();
      const finalCounts = await countDatabaseRows();
      expect(finalCounts).toEqual(initialCounts);
      console.log('PHASE11D GLOBAL BASELINE RESTORED: PASS');
    } catch (error) {
      console.error('PHASE11D CLEANUP/BASELINE ERROR: DO NOT RERUN TEST; MANUAL REVIEW REQUIRED',
        { fixtureTag, itemId: fixture.itemId, borrowId: fixture.borrowId });
      throw error;
    }
  }, 45_000);

  it('same-key replay, different-payload 409, concurrent duplicate, and exact ledger counts', async () => {
    // Stage 1: only this test's unique item/borrow receives new writes.
    const created = await request(app).post('/api/v1/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: fixtureTag, name: 'Phase11D dedicated idempotency fixture',
        categoryId, type: ItemType.CONSUMABLE, unit: 'pcs' });
    expect(created.status).toBe(201);
    fixture.itemId = created.body.data.id;

    fixture.importKey = key('import');
    const imported = await request(app).post('/api/v1/stock-transactions/import')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('Idempotency-Key', fixture.importKey)
      .send({ notes: 'Phase11D isolated import', items: [{ itemId: fixture.itemId, locationId, quantity: 10 }] });
    expect(imported.status).toBe(201);
    fixture.importTxId = imported.body.data.id;
    expect(await stock()).toEqual({ onHand: 10, borrowed: 0, reserved: 0, quarantined: 0, kitAllocated: 0 });

    const now = new Date();
    const requested = await request(app).post('/api/v1/borrow-requests')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ purpose: 'Phase11D return idempotency safety',
        expectedBorrowDate: now.toISOString(),
        expectedReturnDate: new Date(now.getTime() + 7 * 86400000).toISOString(),
        items: [{ itemId: fixture.itemId, quantity: 4 }] });
    expect(requested.status).toBe(201);
    fixture.borrowId = requested.body.data.id;
    fixture.detailId = requested.body.data.details[0].id;

    const approved = await request(app)
      .patch(`/api/v1/borrow-requests/${fixture.borrowId}/approve`)
      .set('Authorization', `Bearer ${managerToken}`).send({});
    expect(approved.status).toBe(200);
    const handed = await request(app)
      .patch(`/api/v1/borrow-requests/${fixture.borrowId}/handover`)
      .set('Authorization', `Bearer ${techToken}`).send({});
    expect(handed.status).toBe(200);
    expect(await stock()).toEqual({ onHand: 6, borrowed: 4, reserved: 0, quarantined: 0, kitAllocated: 0 });

    const returnURL = `/api/v1/borrow-requests/${fixture.borrowId}/return`;
    const original = { items: [{ borrowDetailId: fixture.detailId,
      returnedQuantity: 2, condition: AssetCondition.GOOD }], notes: 'Phase11D original' };
    const returnKey = key('first');
    fixture.returnKeys.push(returnKey);

    const first = await request(app).post(returnURL)
      .set('Authorization', `Bearer ${techToken}`)
      .set('Idempotency-Key', returnKey).send(original);
    expect(first.status).toBe(200);
    expect(first.body.data.returnNumber).toMatch(/^RT-/);
    expect(first.body.data.borrowRequest.status).toBe('PARTIALLY_RETURNED');
    const afterFirst = await businessCounts();
    expect(afterFirst).toMatchObject({ returns: 1, returnDetails: 1,
      returnedQuantity: 2, auditReturns: 1, movements: 3 });
    expect(await stock()).toEqual({ onHand: 8, borrowed: 2, reserved: 0, quarantined: 0, kitAllocated: 0 });

    const replay = await request(app).post(returnURL)
      .set('Authorization', `Bearer ${techToken}`)
      .set('Idempotency-Key', returnKey).send(original);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(first.body.data);
    expect(await businessCounts()).toEqual(afterFirst);
    expect(await stock()).toEqual({ onHand: 8, borrowed: 2, reserved: 0, quarantined: 0, kitAllocated: 0 });

    // Retention hint expiresAt is not a permit to reapply a committed return.
    // This protects the replay contract while a COMPLETED record is retained.
    const historicalCreatedAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const historicalExpiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.idempotencyRecord.update({
      where: { key: returnKey },
      data: { createdAt: historicalCreatedAt, expiresAt: historicalExpiresAt },
    });
    const expiredRecord = await prisma.idempotencyRecord.findUniqueOrThrow({
      where: { key: returnKey },
    });
    expect(expiredRecord.status).toBe('COMPLETED');
    expect(expiredRecord.expiresAt.getTime()).toBeGreaterThan(expiredRecord.createdAt.getTime());
    expect(expiredRecord.expiresAt.getTime()).toBeLessThan(Date.now());
    const expiredReplay = await request(app).post(returnURL)
      .set('Authorization', `Bearer ${techToken}`)
      .set('Idempotency-Key', returnKey).send(original);
    expect(expiredReplay.status).toBe(200);
    expect(expiredReplay.body.data).toEqual(first.body.data);
    expect(await businessCounts()).toEqual(afterFirst);
    expect(await stock()).toEqual({ onHand: 8, borrowed: 2, reserved: 0, quarantined: 0, kitAllocated: 0 });
    console.log('PHASE11D EXPIRED COMPLETED KEY REPLAY: PASS (no duplicate)');

    // Stage 3: read-only return-status API must match the committed response of
    // this exact actor + borrow + key, including when expiresAt is in the past.
    // None of these GETs may create a new return or touch the fixture ledger.
    const statusURL = `/api/v1/borrow-requests/${fixture.borrowId}/return-status/${returnKey}`;
    const getStatus = (auth: string, url = statusURL) => request(app).get(url)
      .set('Authorization', `Bearer ${auth}`);
    const verified = await getStatus(techToken);
    expect(verified.status).toBe(200);
    expect(verified.body.success).toBe(true);
    expect(verified.body.data).toEqual({
      state: 'COMPLETED', requiresReconciliation: false,
      receipt: { returnNumber: first.body.data.returnNumber, borrowRequestId: fixture.borrowId },
    });

    // ADMIN/MANAGER may see borrow records but must not see another sender's key.
    for (const otherActor of [adminToken, managerToken]) {
      const other = await getStatus(otherActor);
      expect(other.status).toBe(200);
      expect(other.body.data).toEqual({ state: 'NOT_FOUND', requiresReconciliation: true });
      expect(other.body.data.receipt).toBeUndefined();
    }
    const studentStatus = await getStatus(studentToken);
    expect(studentStatus.status).toBe(403);
    const anonymousStatus = await request(app).get(statusURL);
    expect(anonymousStatus.status).toBe(401);

    // Incorrect key or another endpoint must never disclose/confirm a return.
    const absentStatus = await getStatus(techToken,
      `/api/v1/borrow-requests/${fixture.borrowId}/return-status/${key('absent')}`);
    expect(absentStatus.status).toBe(200);
    expect(absentStatus.body.data).toEqual({ state: 'NOT_FOUND', requiresReconciliation: true });
    const importStatus = await getStatus(managerToken,
      `/api/v1/borrow-requests/${fixture.borrowId}/return-status/${fixture.importKey}`);
    expect(importStatus.status).toBe(200);
    expect(importStatus.body.data).toEqual({ state: 'NOT_FOUND', requiresReconciliation: true });
    const invalidKeyStatus = await getStatus(techToken,
      `/api/v1/borrow-requests/${fixture.borrowId}/return-status/bad`);
    expect(invalidKeyStatus.status).toBe(422);
    expect(await businessCounts()).toEqual(afterFirst);
    expect(await stock()).toEqual({ onHand: 8, borrowed: 2, reserved: 0, quarantined: 0, kitAllocated: 0 });
    console.log('PHASE11D READ-ONLY RETURN STATUS: PASS (verified receipt / RBAC / no writes)');

    const changed = await request(app).post(returnURL)
      .set('Authorization', `Bearer ${techToken}`)
      .set('Idempotency-Key', returnKey)
      .send({ ...original, items: [{ ...original.items[0], returnedQuantity: 1 }] });
    expect(changed.status).toBe(409);
    expect(await businessCounts()).toEqual(afterFirst);

    const concurrencyKey = key('parallel');
    fixture.returnKeys.push(concurrencyKey);
    const finalPayload = { items: [{ borrowDetailId: fixture.detailId,
      returnedQuantity: 2, condition: AssetCondition.GOOD }], notes: 'Phase11D concurrency' };
    const [a, b] = await Promise.all([1, 2].map(() => request(app).post(returnURL)
      .set('Authorization', `Bearer ${techToken}`)
      .set('Idempotency-Key', concurrencyKey).send(finalPayload)));
    const statuses = [a.status, b.status];
    expect(statuses.every(s => s === 200 || s === 409)).toBe(true);
    expect(statuses.some(s => s === 200)).toBe(true);
    const committedNumbers = [a, b].filter(r => r.status === 200).map(r => r.body.data.returnNumber);
    expect(new Set(committedNumbers).size).toBe(1);

    const finalReplay = await request(app).post(returnURL)
      .set('Authorization', `Bearer ${techToken}`)
      .set('Idempotency-Key', concurrencyKey).send(finalPayload);
    expect(finalReplay.status).toBe(200);
    expect(finalReplay.body.data.borrowRequest.status).toBe('RETURNED');
    if (committedNumbers.length) expect(finalReplay.body.data.returnNumber).toBe(committedNumbers[0]);
    const finalBusiness = await businessCounts();
    expect(finalBusiness).toMatchObject({ returns: 2, returnDetails: 2,
      returnedQuantity: 4, auditReturns: 2, movements: 4 });
    expect(await stock()).toEqual({ onHand: 10, borrowed: 0, reserved: 0, quarantined: 0, kitAllocated: 0 });

    const endpoint = `/api/v1/borrow-requests/${fixture.borrowId}/return`;
    const records = await prisma.idempotencyRecord.findMany({ where: { endpoint } });
    expect(records).toHaveLength(2);
    for (const row of records) {
      expect(row.status).toBe('COMPLETED');
      expect(row.responseBody).toBeTruthy();
      expect(row.userId).toBe(fixture.techUserId);
      expect(fixture.returnKeys).toContain(row.key);
    }
    console.log('PHASE11D IDEMPOTENCY LIVE INTEGRATION: PASS (replay/mismatch/concurrency/ledger)');
  }, 90_000);
});
