import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import httpRequest from 'supertest';
import { createApp } from '../src/app';
import { computePasswordTag } from '../src/modules/auth/auth.security';
import { env } from '../src/config/env';
import { prisma } from '../src/config/database';
import {
  assertSafeTestDatabaseUrl,
  assertRuntimeDatabaseIsTest,
} from '../src/config/databaseGuard';
import { borrowService } from '../src/modules/borrow/borrow.service';
import { idempotencyService } from '../src/modules/inventory/idempotency.service';
import { AssetCondition, BorrowStatus, ReservationStatus, UserRole } from '@acm/shared';

/**
 * D8-P0: real PostgreSQL row-lock and source-ledger check on CI-local
 * acm_inventory_test ONLY. Not the unapproved PG17/Stage4C acceptance.
 *
 * We deliberately keep this separate from the mock suite: two separate
 * Prisma transactions contend for a real database lock on a synthetic row.
 */
describe('D8 integration: same-source concurrency and cross-location rejection', () => {
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
  let adminPasswordHash = '';

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
    adminPasswordHash = admin!.passwordHash;

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

  it('CI-local DB: four real seeded roles, forged JWT role, IDOR and denied-write invariants', async () => {
    assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
    const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
    assertRuntimeDatabaseIsTest(db);

    const roleSources = [
      { email: 'admin@acm.local', role: UserRole.ADMIN },
      { email: 'manager@acm.local', role: UserRole.LAB_MANAGER },
      { email: 'tech@acm.local', role: UserRole.TECHNICIAN },
      { email: 'student@acm.local', role: UserRole.STUDENT },
    ];
    const loaded = await Promise.all(roleSources.map(({ email }) =>
      prisma.user.findUnique({ where: { email } })
    ));
    for (const [index, user] of loaded.entries()) {
      expect(user, roleSources[index].email).not.toBeNull();
      expect(user?.role).toBe(roleSources[index].role);
      expect(user?.isActive).toBe(true);
      expect(user?.isLocked).toBe(false);
    }
    const [admin, manager, technician, student] = loaded.map(user => user!);
    const tokenFor = (user: typeof admin, assertedRole: UserRole = user.role) =>
      jwt.sign({
        id: user.id,
        email: user.email,
        role: assertedRole,
        fullName: user.fullName,
        pwdTag: computePasswordTag(user.id, user.passwordHash),
      }, env.JWT_SECRET, { expiresIn: '1h' });
    const app = createApp();

    // Current database role wins over any stale token claim.
    for (const user of [admin, manager, technician, student]) {
      const claimedRole = user.role === UserRole.LAB_MANAGER ? UserRole.STUDENT : user.role;
      const res = await httpRequest(app)
        .get(`/api/v1/borrow-requests/${created.requestId}`)
        .set('Authorization', `Bearer ${tokenFor(user, claimedRole)}`);
      expect(res.status, user.email).toBe(200);
      expect(res.body.data.id).toBe(created.requestId);
    }

    const checkKey = `${idempotencyKeyPrefix}ROLE`;
    for (const user of [admin, manager, technician]) {
      const res = await httpRequest(app)
        .get(`/api/v1/borrow-requests/${created.requestId}/return-status/${checkKey}`)
        .set('Authorization', `Bearer ${tokenFor(user, UserRole.STUDENT)}`);
      expect(res.status, user.email).toBe(200);
      expect(res.body.data).toMatchObject({
        state: 'NOT_FOUND',
        requiresReconciliation: true,
      });
    }

    // Forged ADMIN role in a valid STUDENT token cannot expand permissions.
    const forgedStudentToken = tokenFor(student, UserRole.ADMIN);
    const deniedStatus = await httpRequest(app)
      .get(`/api/v1/borrow-requests/${created.requestId}/return-status/${checkKey}`)
      .set('Authorization', `Bearer ${forgedStudentToken}`);
    expect(deniedStatus.status).toBe(403);
    const deniedWrite = await httpRequest(app)
      .post(`/api/v1/borrow-requests/${created.requestId}/return`)
      .set('Authorization', `Bearer ${forgedStudentToken}`)
      .set('Idempotency-Key', `${idempotencyKeyPrefix}STUDENT`)
      .send({ items: [{ borrowDetailId: created.detailId, returnedQuantity: 1, condition: AssetCondition.GOOD }] });
    expect(deniedWrite.status).toBe(403);

    // Separate synthetic request owned by ADMIN demonstrates STUDENT IDOR.
    const foreign = await prisma.borrowRequest.create({
      data: {
        requestNumber: `BR-ACL-${suffix}`,
        borrowerId: admin.id,
        status: BorrowStatus.PENDING,
        purpose: 'CI-local role/IDOR synthetic fixture',
        expectedBorrowDate: new Date('2026-11-01T00:00:00Z'),
        expectedReturnDate: new Date('2026-11-15T00:00:00Z'),
      },
    });
    try {
      const forbidden = await httpRequest(app)
        .get(`/api/v1/borrow-requests/${foreign.id}`)
        .set('Authorization', `Bearer ${forgedStudentToken}`);
      expect(forbidden.status).toBe(403);
      const allowed = await httpRequest(app)
        .get(`/api/v1/borrow-requests/${foreign.id}`)
        .set('Authorization', `Bearer ${tokenFor(admin)}`);
      expect(allowed.status).toBe(200);
      const anonymous = await httpRequest(app).get(`/api/v1/borrow-requests/${foreign.id}`);
      expect(anonymous.status).toBe(401);

      const staleTag = jwt.sign({
        id: admin.id, email: admin.email, role: UserRole.ADMIN,
        fullName: admin.fullName, pwdTag: 'deliberately-invalid-pwd-tag',
      }, env.JWT_SECRET, { expiresIn: '1h' });
      const stale = await httpRequest(app)
        .get(`/api/v1/borrow-requests/${foreign.id}`)
        .set('Authorization', `Bearer ${staleTag}`);
      expect(stale.status).toBe(401);

      const expired = jwt.sign({
        id: admin.id, email: admin.email, role: UserRole.ADMIN,
        fullName: admin.fullName,
        pwdTag: computePasswordTag(admin.id, admin.passwordHash),
      }, env.JWT_SECRET, { expiresIn: -1 });
      const outOfTime = await httpRequest(app)
        .get(`/api/v1/borrow-requests/${foreign.id}`)
        .set('Authorization', `Bearer ${expired}`);
      expect(outOfTime.status).toBe(401);
    } finally {
      await prisma.borrowRequest.delete({ where: { id: foreign.id } });
    }

    // Forbidden mutation must not post stock, receipt or idempotency claim.
    const [receipts, claims, detail, balance] = await Promise.all([
      prisma.returnTransaction.count({ where: { borrowRequestId: created.requestId } }),
      prisma.idempotencyRecord.count({ where: { key: `${idempotencyKeyPrefix}STUDENT` } }),
      prisma.borrowDetail.findUnique({ where: { id: created.detailId } }),
      prisma.stockBalance.findUnique({
        where: { itemId_locationId: {
          itemId: created.itemId, locationId: created.sourceLocationId,
        } },
      }),
    ]);
    expect(receipts).toBe(0);
    expect(claims).toBe(0);
    expect(detail?.returnedQuantity).toBe(0);
    expect(balance).toMatchObject({ onHand: 6, borrowed: 4 });
  }, 30000);

  it('CI-local DB: stale PENDING/FAILED return key never replays physical stock', async () => {
    assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
    const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
    assertRuntimeDatabaseIsTest(db);

    const input = { items: [{
      borrowDetailId: created.detailId,
      returnedQuantity: 1,
      locationId: created.sourceLocationId,
      condition: AssetCondition.GOOD,
    }] };
    const endpoint = `/api/v1/borrow-requests/${created.requestId}/return`;
    const fingerprint = idempotencyService.generateFingerprint(operator.id, endpoint, input);
    const keys = [
      { key: `${idempotencyKeyPrefix}STALEP`, status: 'PENDING' },
      { key: `${idempotencyKeyPrefix}FAILED`, status: 'FAILED' },
    ] as const;
    for (const item of keys) {
      await prisma.idempotencyRecord.create({
        data: {
          key: item.key, userId: operator.id, endpoint,
          requestHash: fingerprint, status: item.status,
          createdAt: new Date(Date.now() - 120_000),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      await expect(borrowService.returnBorrowRequest(
        created.requestId, input, operator, item.key
      )).rejects.toMatchObject({ statusCode: 409 });
      const row = await prisma.idempotencyRecord.findUnique({
        where: { key: item.key },
      });
      expect(row?.status).toBe(item.status);
      expect(row?.responseBody).toBeNull();

      const token = jwt.sign({
        id: operator.id,
        pwdTag: computePasswordTag(operator.id, adminPasswordHash),
        email: operator.email,
        role: operator.role,
        fullName: operator.fullName,
      }, env.JWT_SECRET, { expiresIn: '1h' });
      const status = await httpRequest(createApp())
        .get(`/api/v1/borrow-requests/${created.requestId}/return-status/${item.key}`)
        .set('Authorization', `Bearer ${token}`);
      expect(status.status).toBe(200);
      expect(status.body.data).toMatchObject({
        state: item.status, requiresReconciliation: true,
      });
    }
    const [receipts, movements, detail, balance, claims] = await Promise.all([
      prisma.returnTransaction.count({ where: { borrowRequestId: created.requestId } }),
      prisma.stockMovement.count({
        where: { itemId: created.itemId, referenceType: 'RETURN' },
      }),
      prisma.borrowDetail.findUnique({ where: { id: created.detailId } }),
      prisma.stockBalance.findUnique({
        where: { itemId_locationId: {
          itemId: created.itemId, locationId: created.sourceLocationId,
        } },
      }),
      prisma.idempotencyRecord.count({
        where: { key: { in: keys.map(k => k.key) } },
      }),
    ]);
    expect(receipts).toBe(0);
    expect(movements).toBe(0);
    expect(detail?.returnedQuantity).toBe(0);
    expect(balance).toMatchObject({ onHand: 6, borrowed: 4 });
    expect(claims).toBe(2);
  }, 30000);

  it('real row lock serializes same-source returns and denies A-to-B writes', async () => {
    const input = {
      items: [{
        borrowDetailId: created.detailId,
        returnedQuantity: 4,
        locationId: created.sourceLocationId,
        condition: AssetCondition.GOOD,
      }],
    };

    // Cross-location return remains forbidden until custody/provenance approval.
    // Verify rejection rolls back its idempotency claim and all business writes.
    await expect(borrowService.returnBorrowRequest(
      created.requestId,
      { items: [{ ...input.items[0], locationId: created.destinationLocationId }] },
      operator,
      idempotencyKeyPrefix + 'X'
    )).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.returnTransaction.count({
      where: { borrowRequestId: created.requestId },
    })).toBe(0);
    const beforeLock = await prisma.stockBalance.findUnique({
      where: { itemId_locationId: {
        itemId: created.itemId, locationId: created.sourceLocationId,
      } },
    });
    expect(beforeLock).toMatchObject({ onHand: 6, borrowed: 4 });
    expect(await prisma.idempotencyRecord.count({
      where: { key: idempotencyKeyPrefix + 'X' },
    })).toBe(0);

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
    // Both outcomes fail closed: 400 when the return is already completed,
    // or 409 when PostgreSQL serializable contention is exhausted.
    const rejectedError = (rejections[0] as { ok: false; error: { statusCode: number } }).error;
    expect([400, 409]).toContain(rejectedError.statusCode);

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
      pwdTag: computePasswordTag(operator.id, adminPasswordHash),
      email: operator.email,
      role: operator.role,
      fullName: operator.fullName,
    }, env.JWT_SECRET, { expiresIn: '1h' });

    const readStatus = await httpRequest(app)
      .get(`/api/v1/borrow-requests/${created.requestId}/return-status/${winningKey}`)
      .set('Authorization', `Bearer ${token}`);
    expect(readStatus.status).toBe(200);
    expect(readStatus.body.data).toMatchObject({
      state: 'COMPLETED',
      requiresReconciliation: false,
      receipt: {
        returnNumber: winningReturn.result.returnNumber,
        borrowRequestId: created.requestId,
      },
    });
    const anonymousStatus = await httpRequest(app)
      .get(`/api/v1/borrow-requests/${created.requestId}/return-status/${winningKey}`);
    expect(anonymousStatus.status).toBe(401);
    const missingKey = await httpRequest(app)
      .post(`/api/v1/borrow-requests/${created.requestId}/return`)
      .set('Authorization', `Bearer ${token}`)
      .send(input);
    expect(missingKey.status).toBe(400);

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
    expect(origin).toMatchObject({ onHand: 10, borrowed: 0 });
    expect(destination).toMatchObject({ onHand: 0, borrowed: 0, quarantined: 0 });
    expect(detail?.returnedQuantity).toBe(4);
    expect(request?.status).toBe(BorrowStatus.RETURNED);
    expect(returnCount).toBe(1);
    expect(auditCount).toBe(1);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      locationId: created.sourceLocationId,
      quantityDelta: 4,
      onHandBefore: 6,
      onHandAfter: 10,
    });
  }, 20000);
});
