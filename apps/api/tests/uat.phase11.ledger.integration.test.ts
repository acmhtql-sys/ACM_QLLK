import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../src/app';
import { prisma } from '../src/config/database';
import { loginRateLimiter } from '../src/middleware/rateLimiter';
import { AssetCondition, ItemType } from '@acm/shared';

const app = createApp();
const evidenceFile = resolve(__dirname, '../test-results/phase11-ledger-evidence.json');
type Balance = { onHand: number; reserved: number; borrowed: number; quarantined: number; kitAllocated: number; available: number };
const want = (onHand: number, reserved = 0, borrowed = 0, quarantined = 0): Balance => ({
  onHand, reserved, borrowed, quarantined, kitAllocated: 0, available: onHand - reserved - quarantined,
});
const evidence = {
  kind: 'AUTOMATED_POSTGRES_API_UAT',
  scope: 'isolated PostgreSQL acm_inventory_test, same-source return only',
  commit: process.env.GITHUB_SHA || null,
  status: 'INCOMPLETE',
  steps: [] as Array<{ id: string; action: string; httpStatus: number; before: Balance | null; after: Balance; expected: Balance }>,
  reconciliation: { returns: 0, movements: 0, auditEntries: 0 },
};
function save() {
  mkdirSync(resolve(__dirname, '../test-results'), { recursive: true });
  writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
}

let itemId = '', borrowId = '', detailId = '', stockTxId = '', locationId = '', categoryId = '';
let adminToken = '', managerToken = '', techToken = '', studentToken = '';
async function balance(): Promise<Balance> {
  const b = await prisma.stockBalance.findUniqueOrThrow({ where: { itemId_locationId: { itemId, locationId } } });
  const actual = { onHand: b.onHand, reserved: b.reserved, borrowed: b.borrowed,
    quarantined: b.quarantined, kitAllocated: b.kitAllocated,
    available: b.onHand - b.reserved - b.quarantined - b.kitAllocated };
  Object.values(actual).forEach(n => expect(n).toBeGreaterThanOrEqual(0));
  return actual;
}
async function snapshot(id: string, action: string, httpStatus: number, expected: Balance) {
  const after = await balance();
  const before = evidence.steps.length ? evidence.steps[evidence.steps.length - 1].after : null;
  evidence.steps.push({ id, action, httpStatus, before, after, expected });
  save();
  expect(after).toEqual(expected);
}

describe('Phase 11 — isolated PostgreSQL API ledger acceptance rehearsal', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || '');
    if (process.env.NODE_ENV !== 'test' ||
      !['127.0.0.1', 'localhost', '::1'].includes(url.hostname) ||
      url.pathname !== '/acm_inventory_test') {
      throw new Error('UAT SAFETY: only local acm_inventory_test with NODE_ENV=test is permitted');
    }
    const db = await prisma.$queryRawUnsafe<Array<{ db: string }>>('SELECT current_database() as db');
    if (db[0]?.db !== 'acm_inventory_test') throw new Error('UAT SAFETY: connected DB identity mismatch');
    const category = await prisma.category.findFirst();
    const location = await prisma.location.findFirst({ where: { isActive: true } });
    if (!category || !location) throw new Error('UAT fixture seed missing: category / location');
    categoryId = category.id;
    locationId = location.id;
    loginRateLimiter.reset();
    for (const [email, kind] of [
      ['admin@acm.local', 'admin'], ['manager@acm.local', 'manager'],
      ['tech@acm.local', 'tech'], ['student@acm.local', 'student'],
    ] as const) {
      const response = await request(app).post('/api/v1/auth/login')
        .send({ email, password: 'ACM@dev2026!' });
      expect(response.status).toBe(200);
      if (kind === 'admin') adminToken = response.body.data.token;
      if (kind === 'manager') managerToken = response.body.data.token;
      if (kind === 'tech') techToken = response.body.data.token;
      if (kind === 'student') studentToken = response.body.data.token;
    }
    save();
  }, 20_000);

  afterAll(async () => {
    if (!itemId) return;
    try {
      if (borrowId) {
        const returns = await prisma.returnTransaction.findMany({ where: { borrowRequestId: borrowId }, select: { id: true } });
        await prisma.returnDetail.deleteMany({ where: { returnTransactionId: { in: returns.map(r => r.id) } } });
        await prisma.returnTransaction.deleteMany({ where: { borrowRequestId: borrowId } });
        await prisma.stockReservation.deleteMany({ where: { borrowRequestId: borrowId } });
        await prisma.borrowDetail.deleteMany({ where: { borrowRequestId: borrowId } });
        await prisma.borrowRequest.deleteMany({ where: { id: borrowId } });
      }
      await prisma.stockMovement.deleteMany({ where: { itemId } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [itemId, borrowId, stockTxId].filter(Boolean) } } });
      await prisma.stockBalance.deleteMany({ where: { itemId } });
      await prisma.asset.deleteMany({ where: { itemId } });
      if (stockTxId) {
        await prisma.idempotencyRecord.deleteMany({ where: { transactionId: stockTxId } });
        await prisma.stockTransactionDetail.deleteMany({ where: { stockTransactionId: stockTxId } });
        await prisma.stockTransaction.deleteMany({ where: { id: stockTxId } });
      }
      await prisma.item.delete({ where: { id: itemId } });
    } finally {
      loginRateLimiter.destroy();
      save();
    }
  }, 25_000);

  it('imports 10; borrows 4; returns GOOD 2, DAMAGED 1, LOST 1 without ledger drift', async () => {
    const code = 'UAT11-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const created = await request(app).post('/api/v1/items').set('Authorization', 'Bearer ' + adminToken)
      .send({ code, name: 'Phase11 isolated UAT item', categoryId, type: ItemType.CONSUMABLE, unit: 'pcs' });
    expect(created.status).toBe(201);
    itemId = created.body.data.id;
    const imported = await request(app).post('/api/v1/stock-transactions/import')
      .set('Authorization', 'Bearer ' + managerToken)
      .set('Idempotency-Key', 'uat11-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7))
      .send({ notes: 'Phase11 isolated import', items: [{ itemId, locationId, quantity: 10 }] });
    expect(imported.status).toBe(201);
    stockTxId = imported.body.data.id;
    await snapshot('UAT-01', 'import 10', imported.status, want(10));

    const start = new Date();
    const requested = await request(app).post('/api/v1/borrow-requests')
      .set('Authorization', 'Bearer ' + studentToken)
      .send({ purpose: 'Phase11 ledger acceptance rehearsal',
        expectedBorrowDate: start.toISOString(),
        expectedReturnDate: new Date(start.getTime() + 7 * 86400000).toISOString(),
        items: [{ itemId, quantity: 4 }] });
    expect(requested.status).toBe(201);
    expect(requested.body.data.status).toBe('PENDING');
    borrowId = requested.body.data.id;
    detailId = requested.body.data.details[0].id;
    await snapshot('UAT-02', 'request borrow 4', requested.status, want(10));

    const approved = await request(app).patch('/api/v1/borrow-requests/' + borrowId + '/approve')
      .set('Authorization', 'Bearer ' + managerToken).send({});
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');
    await snapshot('UAT-03', 'approve borrow 4', approved.status, want(10, 4));

    const handed = await request(app).patch('/api/v1/borrow-requests/' + borrowId + '/handover')
      .set('Authorization', 'Bearer ' + techToken).send({});
    expect(handed.status).toBe(200);
    expect(handed.body.data.status).toBe('HANDED_OVER');
    await snapshot('UAT-04', 'handover 4', handed.status, want(6, 0, 4));

    const returnsBefore = await prisma.returnTransaction.count({ where: { borrowRequestId: borrowId } });
    const cross = await request(app).post('/api/v1/borrow-requests/' + borrowId + '/return')
      .set('Authorization', 'Bearer ' + techToken)
      .send({ items: [{ borrowDetailId: detailId, returnedQuantity: 1, condition: AssetCondition.GOOD,
        locationId: '00000000-0000-4000-8000-000000000001' }] });
    expect(cross.status).toBe(409);
    expect(await prisma.returnTransaction.count({ where: { borrowRequestId: borrowId } })).toBe(returnsBefore);
    await snapshot('UAT-11', 'cross-location rejected', cross.status, want(6, 0, 4));

    const dupe = await request(app).post('/api/v1/borrow-requests/' + borrowId + '/return')
      .set('Authorization', 'Bearer ' + techToken)
      .send({ items: [
        { borrowDetailId: detailId, returnedQuantity: 1, condition: AssetCondition.GOOD },
        { borrowDetailId: detailId, returnedQuantity: 1, condition: AssetCondition.GOOD },
      ] });
    expect(dupe.status).toBe(422);
    expect(await prisma.returnTransaction.count({ where: { borrowRequestId: borrowId } })).toBe(returnsBefore);
    await snapshot('UAT-10', 'duplicate details rejected', dupe.status, want(6, 0, 4));

    for (const [id, condition, quantity, expectedBalance, status] of [
      ['UAT-05', AssetCondition.GOOD, 2, want(8, 0, 2), 'PARTIALLY_RETURNED'],
      ['UAT-06', AssetCondition.DAMAGED, 1, want(9, 0, 1, 1), 'PARTIALLY_RETURNED'],
      ['UAT-07', AssetCondition.LOST, 1, want(9, 0, 0, 1), 'RETURNED'],
    ] as const) {
      const res = await request(app).post('/api/v1/borrow-requests/' + borrowId + '/return')
        .set('Authorization', 'Bearer ' + techToken)
        .send({ items: [{ borrowDetailId: detailId, returnedQuantity: quantity, condition, locationId }] });
      expect(res.status).toBe(200);
      expect(res.body.data.borrowRequest.status).toBe(status);
      await snapshot(id, 'return ' + quantity + ' as ' + condition, res.status, expectedBalance);
    }

    evidence.reconciliation.returns = await prisma.returnTransaction.count({ where: { borrowRequestId: borrowId } });
    evidence.reconciliation.movements = await prisma.stockMovement.count({ where: { itemId } });
    evidence.reconciliation.auditEntries = await prisma.auditLog.count({ where: { entityId: borrowId } });
    expect(evidence.reconciliation.returns).toBe(3);
    expect(evidence.reconciliation.movements).toBe(5);
    expect(evidence.reconciliation.auditEntries).toBeGreaterThanOrEqual(6);
    const detail = await prisma.borrowDetail.findUniqueOrThrow({ where: { id: detailId } });
    expect(detail.returnedQuantity).toBe(4);
    const movements = await prisma.stockMovement.findMany({ where: { itemId } });
    expect(movements.reduce((sum, row) => sum + row.quantityDelta, 0)).toBe(9);
    evidence.status = 'PASS';
    save();
    console.log('PHASE11_LEDGER_PASS steps=' + evidence.steps.length + ' movements=' + evidence.reconciliation.movements);
  }, 90_000);
});
