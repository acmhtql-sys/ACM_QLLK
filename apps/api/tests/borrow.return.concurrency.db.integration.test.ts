import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import httpRequest from 'supertest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { prisma } from '../src/config/database';
import {
  assertSafeTestDatabaseUrl,
  assertRuntimeDatabaseIsTest,
} from '../src/config/databaseGuard';
import { borrowService } from '../src/modules/borrow/borrow.service';
import { AssetCondition, BorrowStatus, ReservationStatus, UserRole } from '@acm/shared';

/**
 * D8-P0: real PostgreSQL row-lock and source-ledger check on CI-local
 * acm_inventory_test ONLY. Not the unapproved PG17/Stage4C acceptance.
 *
 * We deliberately keep this separate from the mock suite: two separate
 * Prisma transactions contend for a real database lock on a synthetic row.
 */
describe('D8-P0 isolated CI PostgreSQL return concurrency and A -> B ledger', () => {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const idempotencyKeyPrefix = `D8RET${suffix}`;
  const created = {
    itemId: '',
    sourceLocationId: '',
    destinationLocationId: '',
    requestId: '',
    detailId: '',
  };
  let operator: { id: string; email: string; fullName: string; role: UserRole };
  let requestNumber = '';

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
    const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`
      SELECT current_database() AS db
    `;
    assertRuntimeDatabaseIsTest(db);

    const admin = await prisma.user.findFirst({
      where: { email: 'admin@acm.local', role: UserRole.ADMIN },
    });
    const student = await prisma.user.findFirst({
      where: { email: 'student@acm.local', role: UserRole.STUDENT },
    });
    const category = await prisma.category.findFirst();
    expect(admin).not.toBeNull();
    expect(student).not.toBeNull();
    expect(category).not.toBeNull();
    operator = {
      id: admin!.id,
      email: admin!.email,
      fullName: admin!.fullName,
      role: UserRole.ADMIN,
    };

    const source = await prisma.location.create({
      data: { code: `D8-SRC-${suffix}`, name: 'D8 synthetic issuing warehouse' },
    });
    created.sourceLocationId = source.id;
    const destination = await prisma.location.create({
      data: { code: `D8-DST-${suffix}`, name: 'D8 synthetic receiving warehouse' },
    });
    created.destinationLocationId = destination.id;
    const item = await prisma.item.create({
      data: {
        code: `D8-P0-${suffix}`,
        name: 'D8 isolated concurrency fixture',
        unit: 'cai',
        categoryId: category!.id,
      },
    });
    created.itemId = item.id;

    await prisma.stockBalance.createMany({
      data: [
        {
          itemId: item.id,
          locationId: source.id,
          onHand: 6,
          borrowed: 4,
        },
        {
          itemId: item.id,
          locationId: destination.id,
          onHand: 0,
          borrowed: 0,
        },
      ],
    });

    requestNumber = `BR-D8-${suffix}`;
    const request = await prisma.borrowRequest.create({
      data: {
        requestNumber,
        borrowerId: student!.id,
        status: BorrowStatus.HANDED_OVER,
        purpose: 'CI-only synthetic A to B return lock test',
        expectedBorrowDate: new Date('2026-11-01T00:00:00Z'),
        expectedReturnDate: new Date('2026-11-15T00:00:00Z'),
      },
    });
    created.requestId = request.id;
    const detail = await prisma.borrowDetail.create({
      data: { borrowRequestId: request.id, itemId: item.id, quantity: 4 },
    });
    created.detailId = detail.id;
    await prisma.stockReservation.create({
      data: {
        borrowRequestId: request.id,
        itemId: item.id,
        locationId: source.id,
        quantity: 4,
        status: ReservationStatus.FULFILLED,
      },
    });
  }, 20000);

  afterAll(async () => {
    // All destructive cleanup is guarded by both URL and actual DB identity.
    assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
    const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`
      SELECT current_database() AS db
    `;
    assertRuntimeDatabaseIsTest(db);
    await prisma.idempotencyRecord.deleteMany({
      where: { key: { startsWith: idempotencyKeyPrefix } },
    });
    if (created.requestId) {
      const returns = await prisma.returnTransaction.findMany({
        where: { borrowRequestId: created.requestId },
        select: { id: true },
      });
      await prisma.stockMovement.deleteMany({
        where: { referenceId: { in: returns.map((r) => r.id) } },
      });
      await prisma.auditLog.deleteMany({
        where: { entity: 'BorrowRequest', entityId: created.requestId },
      });
      await prisma.returnDetail.deleteMany({
        where: { returnTransactionId: { in: returns.map((r) => r.id) } },
      });
      await prisma.returnTransaction.deleteMany({
        where: { borrowRequestId: created.requestId },
      });
      await prisma.stockReservation.deleteMany({
        where: { borrowRequestId: created.requestId },
      });
      await prisma.borrowDetail.deleteMany({
        where: { borrowRequestId: created.requestId },
      });
      await prisma.borrowRequest.delete({ where: { id: created.requestId } });
    }
    if (created.itemId) {
      await prisma.stockBalance.deleteMany({ where: { itemId: created.itemId } });
      await prisma.item.delete({ where: { id: created.itemId } });
    }
    if (created.sourceLocationId) {
      await prisma.location.delete({ where: { id: created.sourceLocationId } });
    }
    if (created.destinationLocationId) {
      await prisma.location.delete({ where: { id: created.destinationLocationId } });
    }
  }, 20000);

  it('real row lock serializes concurrent full returns; A borrowed goes to zero, B onHand gains exactly 4', async () => {
    const input = {
      items: [{
        borrowDetailId: created.detailId,
        returnedQuantity: 4,
        locationId: created.destinationLocationId,
        condition: AssetCondition.GOOD,
      }],
    };

    // Lock BorrowRequest using a third transaction to ensure both service
    // calls reach the database while the first row remains locked.
    let unlock: (() => void) | undefined;
    let signalLocked: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const heldLock = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "borrow_requests"
        WHERE "id" = ${created.requestId}::uuid FOR UPDATE`;
      await new Promise<void>((resolve) => {
        unlock = resolve;
        signalLocked?.();
      });
    }, { timeout: 8000, maxWait: 3000 });

    await locked;
    let completed = 0;
    const key1 = `${idempotencyKeyPrefix}A`;
    const key2 = `${idempotencyKeyPrefix}B`;
    const runReturn = (key: string) => borrowService.returnBorrowRequest(
      created.requestId, input, operator, key
    ).then(
      (result) => { completed++; return { ok: true as const, result }; },
      (error: unknown) => { completed++; return { ok: false as const, error }; }
    );

    const first = runReturn(key1);
    const second = runReturn(key2);
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(completed).toBe(0);
      const unchanged = await prisma.borrowDetail.findUnique({
        where: { id: created.detailId },
      });
      expect(unchanged?.returnedQuantity).toBe(0);
    } finally {
      unlock?.();
      await heldLock;
    }
    const outcomes = await Promise.all([first, second]);
    const successes = outcomes.filter((x) => x.ok);
    const rejections = outcomes.filter((x) => !x.ok);
    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(1);
    expect((rejections[0] as { ok: false; error: any }).error).toMatchObject({
      statusCode: 400,
    });

    // Replaying a committed return with the same key must return the original
    // receipt, even after the BorrowRequest itself has become RETURNED.
    const winningIndex = outcomes.findIndex((x) => x.ok);
    const winningKey = winningIndex === 0 ? key1 : key2;
    const winningReturn = outcomes[winningIndex] as {
      ok: true;
      result: { returnNumber: string };
    };
    const replay = await borrowService.returnBorrowRequest(
      created.requestId, input, operator, winningKey
    );
    expect(replay.returnNumber).toBe(winningReturn.result.returnNumber);

    // Same key, different meaning is an error, not a new business write.
    await expect(borrowService.returnBorrowRequest(
      created.requestId,
      { items: [{ ...input.items[0], returnedQuantity: 1 }] },
      operator,
      winningKey
    )).rejects.toMatchObject({ statusCode: 409 });

    const app = createApp();
    const token = jwt.sign({
      id: operator.id,
      email: operator.email,
      role: operator.role,
      fullName: operator.fullName,
    }, env.JWT_SECRET, { expiresIn: '1h' });

    const readStatus = await httpRequest(app)
      .get(`/api/v1/borrow-requests/${created.requestId}/return-idempotency/${winningKey}`)
      .set('Authorization', `Bearer ${token}`);
    expect(readStatus.status).toBe(200);
    expect(readStatus.body.data).toMatchObject({
      status: 'COMPLETED',
      confirmed: true,
      returnNumber: winningReturn.result.returnNumber,
    });
    const anonymousStatus = await httpRequest(app)
      .get(`/api/v1/borrow-requests/${created.requestId}/return-idempotency/${winningKey}`);
    expect(anonymousStatus.status).toBe(401);
    const missingKey = await httpRequest(app)
      .post(`/api/v1/borrow-requests/${created.requestId}/return`)
      .set('Authorization', `Bearer ${token}`)
      .send(input);
    expect(missingKey.status).toBe(428);

    const [origin, destination, request, detail, returnCount, movements, auditCount] = await Promise.all([
      prisma.stockBalance.findUnique({
        where: { itemId_locationId: {
          itemId: created.itemId, locationId: created.sourceLocationId,
        } },
      }),
      prisma.stockBalance.findUnique({
        where: { itemId_locationId: {
          itemId: created.itemId, locationId: created.destinationLocationId,
        } },
      }),
      prisma.borrowRequest.findUnique({ where: { id: created.requestId } }),
      prisma.borrowDetail.findUnique({ where: { id: created.detailId } }),
      prisma.returnTransaction.count({ where: { borrowRequestId: created.requestId } }),
      prisma.stockMovement.findMany({
        where: { itemId: created.itemId, referenceType: 'RETURN' },
      }),
      prisma.auditLog.count({
        where: { entity: 'BorrowRequest', entityId: created.requestId, action: 'RETURN' },
      }),
    ]);
    expect(origin).toMatchObject({ onHand: 6, borrowed: 0 });
    expect(destination).toMatchObject({ onHand: 4, borrowed: 0, quarantined: 0 });
    expect(detail?.returnedQuantity).toBe(4);
    expect(request?.status).toBe(BorrowStatus.RETURNED);
    expect(returnCount).toBe(1);
    expect(auditCount).toBe(1);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      locationId: created.destinationLocationId,
      quantityDelta: 4,
      onHandBefore: 0,
      onHandAfter: 4,
    });
  }, 20000);
});
