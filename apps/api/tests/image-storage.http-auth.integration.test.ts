/**
 * Real ACM JWT/login + live PostgreSQL role integration, SYNTHETIC CI ONLY.
 * This suite runs only inside the existing guarded acm_inventory_test service;
 * no item-image reference, real file, cloud or production DB is modified.
 */
import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/database';
import { env } from '../src/config/env';
import { createApp } from '../src/app';
import { AppError } from '../src/shared/AppError';
import { createLocalItemImageReviewRouter } from '../src/modules/storage/image-storage.http-review';
import { TestOnlyMemoryItemImageStorage } from '../src/modules/storage/image-storage.memory';
import type { ItemImageAuditAction, ItemImageAuditEvent } from '../src/modules/storage/image-storage.audit.contract';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 4, 5, 6]);
const UNKNOWN = '44444444-4444-4444-8444-444444444444';

describe('L4 image review uses REAL ACM JWT and live user role (CI-local PG16)', () => {
  let itemId = '';
  const tokens: Record<string, string> = {};
  let store: TestOnlyMemoryItemImageStorage;
  let server: express.Express;
  let auditEvents: ItemImageAuditEvent[];
  let auditFailure: ItemImageAuditAction | null;

  beforeAll(async () => {
    const identity = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
    expect(identity[0]?.db).toBe('acm_inventory_test');

    const activeItem = await prisma.item.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    expect(activeItem).not.toBeNull();
    itemId = activeItem!.id;

    // Existing seeded CI users only; no synthetic users or image rows created.
    for (const [role, email] of [
      ['ADMIN', 'admin@acm.local'],
      ['LAB_MANAGER', 'manager@acm.local'],
      ['TECHNICIAN', 'tech@acm.local'],
      ['STUDENT', 'student@acm.local'],
    ]) {
      const result = await request(createApp()).post('/api/v1/auth/login')
        .send({ email, password: 'ACM@dev2026!' });
      expect(result.status).toBe(200);
      expect(result.body.data.user.role).toBe(role);
      tokens[role] = result.body.data.token;
    }
  });

  beforeEach(() => {
    // The memory provider cannot be constructed outside NODE_ENV=test.
    store = new TestOnlyMemoryItemImageStorage();
    auditEvents = [];
    auditFailure = null;
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ACM_DEPLOYMENT_PROFILE', 'local_dev');
    vi.stubEnv('ACM_LOCAL_IMAGE_STORAGE_ENABLED', 'true');
    vi.stubEnv('ACM_LOCAL_IMAGE_HTTP_REVIEW_ENABLED', 'true');

    // Isolated Express server: production createApp() STILL does not mount.
    server = express();
    server.use('/review-images', createLocalItemImageReviewRouter({
      storage: store,
      isActiveItem: async (id) => Boolean((await prisma.item.findUnique({
        where: { id }, select: { isActive: true },
      }))?.isActive),
      audit: { record: async (event) => {
        if (auditFailure === event.action) throw new Error('SYNTHETIC_AUDIT_UNAVAILABLE');
        auditEvents.push({ ...event });
      } },
    }));
    server.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const status = err instanceof AppError ? err.statusCode : 500;
      res.status(status).json({ success: false });
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  const upload = (app: express.Express, id: string, token?: string) => {
    const pending = request(app).post('/review-images/' + id)
      .set('Content-Type', 'image/png').set('X-File-Name', 'fixture.png')
      .send(PNG);
    return token ? pending.set('Authorization', 'Bearer ' + token) : pending;
  };

  it('AUTH-01: anonymous and invalid JWT fail 401 BEFORE item lookup/storage', async () => {
    expect((await upload(server, itemId)).status).toBe(401);
    expect((await upload(server, itemId, 'not-a-valid-jwt')).status).toBe(401);
  });

  it.each(['STUDENT', 'TECHNICIAN'])(
    'AUTH-02: real %s token is rejected from both HTTP upload/download', async (role) => {
      expect((await upload(server, itemId, tokens[role])).status).toBe(403);
      expect((await request(server).get('/review-images/' + itemId + '/' + UNKNOWN)
        .set('Authorization', 'Bearer ' + tokens[role])).status).toBe(403);
    },
  );

  it.each(['ADMIN', 'LAB_MANAGER'])(
    'AUTH-03: real %s token uploads a synthetic image with correct user identity', async (role) => {
      const uploadResult = await upload(server, itemId, tokens[role]);
      expect(uploadResult.status).toBe(201);
      expect(uploadResult.body.data.itemId).toBe(itemId);
      expect(uploadResult.body.data.uploadedById).toMatch(/^[0-9a-f-]{36}$/i);
      expect(uploadResult.body.data.sha256).toMatch(/^[0-9a-f]{64}$/);

      const read = await request(server)
        .get('/review-images/' + itemId + '/' + uploadResult.body.data.id)
        .set('Authorization', 'Bearer ' + tokens[role]);
      expect(read.status).toBe(200);
      expect(read.body).toEqual(PNG);
      expect(auditEvents.map(event => event.action)).toEqual(['IMAGE_UPLOAD', 'IMAGE_READ']);
      expect(auditEvents[0].actorId).toBe(uploadResult.body.data.uploadedById);
      expect(auditEvents[1].actorId).toBe(uploadResult.body.data.uploadedById);
    },
  );

  it('AUTH-04: token role claim cannot override current DB role', async () => {
    const decoded = jwt.verify(tokens.STUDENT, env.JWT_SECRET);
    expect(typeof decoded).toBe('object');
    const forged = jwt.sign({ ...(decoded as object), role: 'ADMIN' }, env.JWT_SECRET);
    expect((await upload(server, itemId, forged)).status).toBe(403);
  });

  it('AUTH-05: authenticated ADMIN cannot upload image for unknown item', async () => {
    expect((await upload(server, UNKNOWN, tokens.ADMIN)).status).toBe(404);
  });

  it('AUTH-06: even a valid admin token cannot enable HTTP route in cloud staging', async () => {
    vi.stubEnv('ACM_DEPLOYMENT_PROFILE', 'cloud_staging');
    expect((await upload(server, itemId, tokens.ADMIN)).status).toBe(404);
  });
  it('AUTH-07: audit unavailability after real-JWT upload returns 503 and removes synthetic image', async () => {
    const save = vi.spyOn(store, 'save');
    auditFailure = 'IMAGE_UPLOAD';
    const denied = await upload(server, itemId, tokens.ADMIN);
    expect(denied.status).toBe(503);
    expect(save).toHaveBeenCalledTimes(1);
    const saved = await save.mock.results[0].value;
    expect(await store.readForItem(itemId, saved.id)).toBeNull();
    expect(auditEvents).toEqual([]);
  });

  it('AUTH-08: audit unavailability prevents bytes from being returned to real LAB_MANAGER', async () => {
    const posted = await upload(server, itemId, tokens.LAB_MANAGER);
    expect(posted.status).toBe(201);
    auditFailure = 'IMAGE_READ';
    const denied = await request(server)
      .get('/review-images/' + itemId + '/' + posted.body.data.id)
      .set('Authorization', 'Bearer ' + tokens.LAB_MANAGER);
    expect(denied.status).toBe(503);
    expect(denied.body).not.toEqual(PNG);
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].action).toBe('IMAGE_UPLOAD');
  });

});
