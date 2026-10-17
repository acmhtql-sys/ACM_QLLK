import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

describe('Auth API /api/v1/auth', () => {
  it('allows logging in with demo admin credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@acm.local',
        password: 'ACM@dev2026!',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data.user).toHaveProperty('role', 'ADMIN');
  });

  it.each([
    ['/api/v1/audit-logs', 'audit logs'],
    ['/api/v1/reports/summary', 'reports summary'],
    ['/api/v1/borrow-requests', 'borrow requests'],
  ])('rejects unauthenticated access to %s (%s) with 401', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects invalid password with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@acm.local',
        password: 'WrongPassword!',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
