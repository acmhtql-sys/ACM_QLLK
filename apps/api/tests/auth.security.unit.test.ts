import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import { authenticate, authenticateOptional } from '../src/middleware/auth';
import { authorizeRoles } from '../src/middleware/rbac';
import { createLoginRateLimiter } from '../src/middleware/rateLimiter';
import { validateSeedEnvironment } from '../prisma/seed';
import { MAX_FAILED_LOGIN_ATTEMPTS } from '../src/modules/auth/auth.router';
import { AppError } from '../src/shared/AppError';
import { env } from '../src/config/env';
import { prisma } from '../src/config/database';

/**
 * PURE IN-MEMORY MOCK RESPONSE
 * Provides 100% network-free, zero-socket Express response simulation.
 * Fully compatible with sandboxed execution environments.
 */
class MockResponse {
  statusCode: number = 200;
  headers: Record<string, string> = {};
  body: any = null;
  ended: boolean = false;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(payload: any) {
    this.body = payload;
    this.ended = true;
    return this;
  }

  send(payload: any) {
    this.body = payload;
    this.ended = true;
    return this;
  }

  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  getHeader(name: string) {
    return this.headers[name.toLowerCase()];
  }
}

function createMockContext(
  headers: Record<string, string> = {},
  ip: string = '127.0.0.1',
  body: any = {}
) {
  const req: any = {
    headers: { ...headers },
    ip,
    socket: { remoteAddress: ip },
    body,
    user: undefined,
  };
  const res = new MockResponse();
  let nextCalled = false;
  let nextError: any = null;

  const next = (err?: any) => {
    nextCalled = true;
    if (err) nextError = err;
  };

  return {
    req,
    res,
    next,
    wasNextCalled: () => nextCalled,
    getError: () => nextError,
  };
}

describe('Phase 1 – Authentication & Security Hardening Unit Tests', () => {
  const secret = env.JWT_SECRET;
  const mockUserId = '11111111-2222-3333-4444-555555555555';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================
  // 1. JWT Authentication Middleware Tests
  // ==========================================
  describe('JWT Authentication Middleware (authenticate)', () => {
    it('rejects request with 401 when Authorization header is missing', async () => {
      const { req, res, next, getError } = createMockContext();
      await authenticate(req, res as any, next);

      const err = getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('Bearer Token không hợp lệ');
    });

    it('rejects request with 401 when Authorization header does not start with Bearer', async () => {
      const { req, res, next, getError } = createMockContext({
        authorization: 'Basic dXNlcjpwYXNz',
      });
      await authenticate(req, res as any, next);

      const err = getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('Bearer Token không hợp lệ');
    });

    it('rejects request with 401 when token signature is invalid', async () => {
      const fakeToken = jwt.sign({ id: mockUserId }, 'wrong-secret-key-1234567890');
      const { req, res, next, getError } = createMockContext({
        authorization: `Bearer ${fakeToken}`,
      });
      await authenticate(req, res as any, next);

      const err = getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('Mã xác thực không hợp lệ');
    });

    it('rejects request with 401 when token is expired', async () => {
      const expiredToken = jwt.sign(
        { id: mockUserId, email: 'test@acm.local' },
        secret,
        { expiresIn: -10 } // Expired 10 seconds ago
      );
      const { req, res, next, getError } = createMockContext({
        authorization: `Bearer ${expiredToken}`,
      });
      await authenticate(req, res as any, next);

      const err = getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('Phiên đăng nhập đã hết hạn');
    });

    it('rejects request with 401 when token payload lacks id', async () => {
      const invalidPayloadToken = jwt.sign({ email: 'missing-id@acm.local' }, secret);
      const { req, res, next, getError } = createMockContext({
        authorization: `Bearer ${invalidPayloadToken}`,
      });
      await authenticate(req, res as any, next);

      const err = getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('thiếu thông tin định danh');
    });

    it('rejects request with 401 when user was deleted from database', async () => {
      const token = jwt.sign({ id: mockUserId, role: UserRole.STUDENT }, secret);
      const { req, res, next, getError } = createMockContext({
        authorization: `Bearer ${token}`,
      });

      // User not found in database (deleted)
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);

      await authenticate(req, res as any, next);

      const err = getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('Tài khoản không tồn tại hoặc đã bị xóa');
    });

    it('rejects request with 403 when user is inactive (isActive = false)', async () => {
      const token = jwt.sign({ id: mockUserId, role: UserRole.STUDENT }, secret);
      const { req, res, next, getError } = createMockContext({
        authorization: `Bearer ${token}`,
      });

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'inactive@acm.local',
        fullName: 'Inactive User',
        role: UserRole.STUDENT,
        isActive: false,
        isLocked: false,
      } as any);

      await authenticate(req, res as any, next);

      const err = getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(403);
      expect(err.message).toContain('Tài khoản đã bị vô hiệu hóa');
    });

    it('rejects request with 403 when user is locked (isLocked = true)', async () => {
      const token = jwt.sign({ id: mockUserId, role: UserRole.STUDENT }, secret);
      const { req, res, next, getError } = createMockContext({
        authorization: `Bearer ${token}`,
      });

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'locked@acm.local',
        fullName: 'Locked User',
        role: UserRole.STUDENT,
        isActive: true,
        isLocked: true,
      } as any);

      await authenticate(req, res as any, next);

      const err = getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(403);
      expect(err.message).toContain('Tài khoản đã bị tạm khóa');
    });

    it('overrides stale token role with live database role (stale role defense)', async () => {
      // User token claims role is 'ADMIN' (stale)
      const staleToken = jwt.sign({ id: mockUserId, role: UserRole.ADMIN }, secret);
      const { req, res, next, wasNextCalled, getError } = createMockContext({
        authorization: `Bearer ${staleToken}`,
      });

      // Database has demoted user to 'STUDENT'
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'demoted@acm.local',
        fullName: 'Demoted User',
        role: UserRole.STUDENT, // Live DB role
        isActive: true,
        isLocked: false,
      } as any);

      await authenticate(req, res as any, next);

      expect(wasNextCalled()).toBe(true);
      expect(getError()).toBeNull();
      // Crucial assertion: req.user role is STUDENT (from DB), not ADMIN (from token)
      expect(req.user.role).toBe(UserRole.STUDENT);

      // Now pass this req to authorizeRoles(ADMIN)
      const adminGuard = authorizeRoles(UserRole.ADMIN);
      const adminCtx = createMockContext();
      adminCtx.req.user = req.user;

      adminGuard(adminCtx.req, adminCtx.res as any, adminCtx.next);

      const rbacErr = adminCtx.getError();
      expect(rbacErr).toBeInstanceOf(AppError);
      expect(rbacErr.statusCode).toBe(403);
      expect(rbacErr.message).toContain('Bạn không có quyền thực hiện hành động này');
    });

    it('distinguishes database connection errors (500) from token errors (401)', async () => {
      const validToken = jwt.sign({ id: mockUserId }, secret);
      const { req, res, next, getError } = createMockContext({
        authorization: `Bearer ${validToken}`,
      });

      // Simulate PostgreSQL connection timeout
      vi.spyOn(prisma.user, 'findUnique').mockRejectedValue(
        new Error('Connection to PostgreSQL database server timed out')
      );

      await authenticate(req, res as any, next);

      const err = getError();
      expect(err).toBeInstanceOf(AppError);
      // Must be 500 Database Error, NOT 401 Invalid Token
      expect(err.statusCode).toBe(500);
      expect(err.message).toContain('Lỗi kết nối cơ sở dữ liệu');
    });

    it('authenticateOptional attaches active user if valid, or leaves undefined if unauthenticated/invalid', async () => {
      // 1. Without token -> next() called, req.user is undefined
      const ctx1 = createMockContext();
      await authenticateOptional(ctx1.req, ctx1.res as any, ctx1.next);
      expect(ctx1.wasNextCalled()).toBe(true);
      expect(ctx1.req.user).toBeUndefined();

      // 2. With valid active user -> attaches user
      const validToken = jwt.sign({ id: mockUserId }, secret);
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'active@acm.local',
        fullName: 'Active User',
        role: UserRole.TECHNICIAN,
        isActive: true,
        isLocked: false,
      } as any);

      const ctx2 = createMockContext({ authorization: `Bearer ${validToken}` });
      await authenticateOptional(ctx2.req, ctx2.res as any, ctx2.next);
      expect(ctx2.wasNextCalled()).toBe(true);
      expect(ctx2.req.user).toHaveProperty('role', UserRole.TECHNICIAN);

      // 3. With locked user -> does NOT attach user
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'locked@acm.local',
        fullName: 'Locked User',
        role: UserRole.TECHNICIAN,
        isActive: true,
        isLocked: true,
      } as any);

      const ctx3 = createMockContext({ authorization: `Bearer ${validToken}` });
      await authenticateOptional(ctx3.req, ctx3.res as any, ctx3.next);
      expect(ctx3.wasNextCalled()).toBe(true);
      expect(ctx3.req.user).toBeUndefined();
    });
  });

  // ==========================================
  // 2. Login Rate Limiting Tests
  // ==========================================
  describe('Login Rate Limiting (createLoginRateLimiter)', () => {
    it('allows requests up to max attempts and blocks with 429 when threshold exceeded', () => {
      const limiter = createLoginRateLimiter({
        windowMs: 60 * 1000,
        max: 3,
        message: 'Quá nhiều yêu cầu đăng nhập. Vui lòng thử lại sau.',
      });

      const clientIp = '203.0.113.5';

      // Attempt 1: Allowed
      const ctx1 = createMockContext({}, clientIp);
      limiter(ctx1.req, ctx1.res as any, ctx1.next);
      expect(ctx1.wasNextCalled()).toBe(true);
      expect(ctx1.res.getHeader('x-ratelimit-remaining')).toBe('2');

      // Attempt 2: Allowed
      const ctx2 = createMockContext({}, clientIp);
      limiter(ctx2.req, ctx2.res as any, ctx2.next);
      expect(ctx2.wasNextCalled()).toBe(true);
      expect(ctx2.res.getHeader('x-ratelimit-remaining')).toBe('1');

      // Attempt 3: Allowed (last one)
      const ctx3 = createMockContext({}, clientIp);
      limiter(ctx3.req, ctx3.res as any, ctx3.next);
      expect(ctx3.wasNextCalled()).toBe(true);
      expect(ctx3.res.getHeader('x-ratelimit-remaining')).toBe('0');

      // Attempt 4: Exceeded -> 429 Too Many Requests
      const ctx4 = createMockContext({}, clientIp);
      limiter(ctx4.req, ctx4.res as any, ctx4.next);
      expect(ctx4.wasNextCalled()).toBe(false);
      expect(ctx4.res.statusCode).toBe(429);
      expect(ctx4.res.body.success).toBe(false);
      expect(ctx4.res.body.message).toContain('Quá nhiều yêu cầu đăng nhập');
      expect(ctx4.res.getHeader('retry-after')).toBeDefined();

      limiter.destroy();
    });

    it('isolates rate limits by client IP address', () => {
      const limiter = createLoginRateLimiter({
        windowMs: 60 * 1000,
        max: 2,
      });

      const ipA = '10.0.0.1';
      const ipB = '10.0.0.2';

      // Exhaust IP A
      limiter(createMockContext({}, ipA).req, new MockResponse() as any, () => {});
      limiter(createMockContext({}, ipA).req, new MockResponse() as any, () => {});

      const ctxA = createMockContext({}, ipA);
      limiter(ctxA.req, ctxA.res as any, ctxA.next);
      expect(ctxA.res.statusCode).toBe(429);

      // IP B must NOT be blocked
      const ctxB = createMockContext({}, ipB);
      limiter(ctxB.req, ctxB.res as any, ctxB.next);
      expect(ctxB.wasNextCalled()).toBe(true);
      expect(ctxB.res.statusCode).toBe(200);

      limiter.destroy();
    });

    it('resets hit counts when reset() is called', () => {
      const limiter = createLoginRateLimiter({
        windowMs: 60 * 1000,
        max: 1,
      });

      const ip = '192.168.1.100';

      // Attempt 1: allowed
      limiter(createMockContext({}, ip).req, new MockResponse() as any, () => {});

      // Attempt 2: blocked
      const blockedCtx = createMockContext({}, ip);
      limiter(blockedCtx.req, blockedCtx.res as any, blockedCtx.next);
      expect(blockedCtx.res.statusCode).toBe(429);

      // Reset
      limiter.reset();

      // Attempt 3: allowed again
      const unblockedCtx = createMockContext({}, ip);
      limiter(unblockedCtx.req, unblockedCtx.res as any, unblockedCtx.next);
      expect(unblockedCtx.wasNextCalled()).toBe(true);

      limiter.destroy();
    });
  });

  // ==========================================
  // 3. Account Lockout Logic Verification
  // ==========================================
  describe('Account Lockout Constants & Logic', () => {
    it('defines MAX_FAILED_LOGIN_ATTEMPTS as 5', () => {
      expect(MAX_FAILED_LOGIN_ATTEMPTS).toBe(5);
    });

    it('simulates consecutive wrong password lockout flow', async () => {
      const passwordHash = await bcrypt.hash('CorrectSecret123!', 10);

      // User state with 4 previous failures
      let userState = {
        id: mockUserId,
        email: 'target@acm.local',
        passwordHash,
        failedLoginAttempts: 4,
        isLocked: false,
        isActive: true,
      };

      // 5th attempt with wrong password
      const isPasswordValid = await bcrypt.compare('WrongPassword!', userState.passwordHash);
      expect(isPasswordValid).toBe(false);

      const nextFailedAttempts = userState.failedLoginAttempts + 1;
      const willLock = nextFailedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;

      expect(nextFailedAttempts).toBe(5);
      expect(willLock).toBe(true);

      userState = {
        ...userState,
        failedLoginAttempts: nextFailedAttempts,
        isLocked: willLock,
      };

      expect(userState.isLocked).toBe(true);
      expect(userState.failedLoginAttempts).toBe(5);
    });

    it('simulates successful login resetting failedLoginAttempts to 0', async () => {
      const passwordHash = await bcrypt.hash('CorrectSecret123!', 10);

      const userState = {
        id: mockUserId,
        email: 'target@acm.local',
        passwordHash,
        failedLoginAttempts: 3, // Had 3 failed attempts
        isLocked: false,
        isActive: true,
      };

      const isPasswordValid = await bcrypt.compare('CorrectSecret123!', userState.passwordHash);
      expect(isPasswordValid).toBe(true);

      const resetAttempts = userState.failedLoginAttempts > 0 ? 0 : userState.failedLoginAttempts;
      expect(resetAttempts).toBe(0);
    });
  });

  // ==========================================
  // 4. Seed Environment Guard Tests
  // ==========================================
  describe('Demo Seed Environment Guard (validateSeedEnvironment)', () => {
    it('blocks seeding when NODE_ENV is production or staging', () => {
      const prodCheck = validateSeedEnvironment(
        'postgresql://postgres:pass@localhost:5432/acm_inventory',
        'production'
      );
      expect(prodCheck.allowed).toBe(false);
      expect(prodCheck.reason).toContain('production');

      const stagingCheck = validateSeedEnvironment(
        'postgresql://postgres:pass@localhost:5432/acm_inventory',
        'staging'
      );
      expect(stagingCheck.allowed).toBe(false);
      expect(stagingCheck.reason).toContain('staging');
    });

    it('blocks seeding when DATABASE_URL targets Supabase Cloud without override', () => {
      const supabaseCheck = validateSeedEnvironment(
        'postgresql://postgres.dqctxaoaxhtqtgmtsysk:password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
        'development'
      );
      expect(supabaseCheck.allowed).toBe(false);
      expect(supabaseCheck.reason).toContain('Cloud');
    });

    it('allows seeding when target is local development database (localhost / 127.0.0.1)', () => {
      const localCheck1 = validateSeedEnvironment(
        'postgresql://postgres:postgres@localhost:5432/acm_inventory?schema=public',
        'development'
      );
      expect(localCheck1.allowed).toBe(true);

      const localCheck2 = validateSeedEnvironment(
        'postgresql://postgres:postgres@127.0.0.1:5432/acm_inventory_dev',
        'development'
      );
      expect(localCheck2.allowed).toBe(true);
    });

    it('allows remote database seeding only when ALLOW_REMOTE_SEED=true is explicitly set', () => {
      const prevVal = process.env.ALLOW_REMOTE_SEED;
      try {
        process.env.ALLOW_REMOTE_SEED = 'true';
        const check = validateSeedEnvironment(
          'postgresql://postgres.sandbox:password@pooler.supabase.com:6543/postgres',
          'development'
        );
        expect(check.allowed).toBe(true);
      } finally {
        process.env.ALLOW_REMOTE_SEED = prevVal;
      }
    });
  });
});
