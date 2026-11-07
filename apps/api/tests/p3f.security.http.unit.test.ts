import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { gzipSync } from 'node:zlib';
import { createApp } from '../src/app';

// Exercise the real Express middleware stack against an in-process test server.
// All mutation probes target an intentionally nonexistent endpoint so that even
// a regression in the guard cannot modify records. No credentials, seeds,
// Supabase access or external HTTP calls are used.
const app = createApp({
  stagingReadOnly: {
    active: true,
    allowAuthLogin: false,
    apiPrefix: '/api/v1',
    policy: { profile: 'cloud_staging', readOnly: 'true', allowAuthLogin: 'false' },
  },
});

describe('P3-F: staging fail-closed HTTP acceptance (local, no DB)', () => {
  for (const method of ['post', 'put', 'patch', 'delete'] as const) {
    it(`blocks ${method.toUpperCase()} before routing with HTTP 403`, async () => {
      const res = await request(app)[method]('/api/v1/__acm_security_probe_no_route__')
        .send({ syntheticProbeOnly: true });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
      expect(res.body.method).toBe(method.toUpperCase());
    });
  }

  it('rejects a compressed JSON request body with 415 before parsing', async () => {
    const compressed = gzipSync(Buffer.from(JSON.stringify({ syntheticProbeOnly: true })));
    const res = await request(app)
      .post('/api/v1/__acm_security_probe_no_route__')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .send(compressed);
    expect(res.status).toBe(415);
    expect(res.body.success).toBe(false);
  });

  it('blocks login without attempting to authenticate or create sessions', async () => {
    const res = await request(app).post('/api/v1/auth/login')
      .send({ email: 'synthetic@example.invalid', password: 'synthetic-not-a-real-password' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
  });

  it('blocks a GET with X-HTTP-Method-Override: POST', async () => {
    const res = await request(app)
      .get('/api/v1/__acm_security_probe_no_route__')
      .set('X-HTTP-Method-Override', 'POST');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
  });

  it('blocks a GET with _method=DELETE query override', async () => {
    const res = await request(app).get('/api/v1/__acm_security_probe_no_route__?_method=DELETE');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
  });

  it('rejects duplicate slash / encoded login path mutations', async () => {
    for (const route of ['/api/v1//auth/login', '/api/v1/%61uth/login']) {
      const res = await request(app).post(route).send({});
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
    }
  });

  it('blocks anonymous catalog and stock reads in cloud_staging', async () => {
    const oldProfile = process.env.ACM_DEPLOYMENT_PROFILE;
    process.env.ACM_DEPLOYMENT_PROFILE = 'cloud_staging';
    try {
      for (const path of [
        '/api/v1/items',
        '/api/v1/items/nonexistent',
        '/api/v1/items/barcode/nonexistent',
        '/api/v1/categories',
      ]) {
        const res = await request(app).get(path);
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      }
    } finally {
      if (oldProfile === undefined) {
        delete process.env.ACM_DEPLOYMENT_PROFILE;
      } else {
        process.env.ACM_DEPLOYMENT_PROFILE = oldProfile;
      }
    }
  });

  it('permits only safe readiness GET without a token', async () => {
    const res = await request(app).get('/api/v1/health/liveness');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  for (const path of [
    '/api/v1/auth/me',
    '/api/v1/users',
    '/api/v1/locations',
    '/api/v1/inventory/balance',
    '/api/v1/stock-transactions',
    '/api/v1/stock-movements',
    '/api/v1/borrow-requests',
    '/api/v1/reports/summary',
    '/api/v1/audit-logs',
    '/api/v1/health/sandbox-attestation',
  ]) {
    it(`does not disclose protected GET ${path} without authentication`, async () => {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  }
});
