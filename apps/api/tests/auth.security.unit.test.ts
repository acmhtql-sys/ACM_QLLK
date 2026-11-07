import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import { authenticate, authenticateOptional } from '../src/middleware/auth';
import { computePasswordTag } from '../src/modules/auth/auth.security';
import { authorizeRoles } from '../src/middleware/rbac';
import { createLoginRateLimiter, loginRateLimiter, accountLoginRateLimiter } from '../src/middleware/rateLimiter';
import { validateSeedEnvironment } from '../prisma/seed';
import { authRouter, MAX_FAILED_LOGIN_ATTEMPTS } from '../src/modules/auth/auth.router';
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
  body: any = {},
  method: string = 'GET',
  url: string = '/'
) {
  const req: any = {
    method,
    url,
    originalUrl: url,
    path: url,
    baseUrl: '',
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
const mockPasswordHash = '$2a$12$e8YvXmCjB8N123456789012345678901234567890123456789012';

  beforeEach(() => {
    vi.restoreAllMocks();
    loginRateLimiter.reset();
    accountLoginRateLimiter.reset();
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => {
      if (typeof callback === 'function') {
        return callback(prisma);
      }
      return Promise.all(callback);
    });
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

    it('validates UUID format in token payload: accepts valid fixture UUIDs and rejects malformed strings', async () => {
      const validUuids = [
        '11111111-2222-3333-4444-555555555555',
        'c38fdbe1-7a5c-4a8b-9e22-e5486de41067',
        '00000000-0000-0000-0000-000000000000',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
      ];

      const mockPasswordHash = '$2a$12$e8kP0PzK3J5K3J5K3J5K3.O3n3o3n3o3n3o3n3o3n3o3n3o3n3o';
      for (const validId of validUuids) {
        const token = jwt.sign(
          { id: validId, pwdTag: computePasswordTag(validId, mockPasswordHash) },
          secret
        );
        const { req, res, next, getError } = createMockContext({
          authorization: `Bearer ${token}`,
        });
        vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce({
          id: validId,
          email: 'valid@acm.local',
          fullName: 'Valid User',
          role: UserRole.STUDENT,
          isActive: true,
          isLocked: false,
          passwordHash: mockPasswordHash,
        } as any);

        await authenticate(req, res as any, next);
        expect(getError()).toBeNull();
        expect(req.user?.id).toBe(validId);
      }

      const malformedIds = [
        'not-a-uuid',
        '11111111-2222-3333-4444-55555555555g',
        '11111111222233334444555555555555',
        '1111111-2222-3333-4444-555555555555',
        "11111111-2222-3333-4444-555555555555' OR 1=1 --",
        '<script>alert(1)</script>',
        '',
      ];

      for (const invalidId of malformedIds) {
        const token = jwt.sign({ id: invalidId }, secret);
        const { req, res, next, getError } = createMockContext({
          authorization: `Bearer ${token}`,
        });

        await authenticate(req, res as any, next);
        const err = getError();
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(401);
        expect(err.message).toContain('thiếu thông tin định danh');
      }
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
      const mockPasswordHash = '$2a$12$e8kP0PzK3J5K3J5K3J5K3.O3n3o3n3o3n3o3n3o3n3o3n3o3n3o';
      const staleToken = jwt.sign(
        { id: mockUserId, role: UserRole.ADMIN, pwdTag: computePasswordTag(mockUserId, mockPasswordHash) },
        secret
      );
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
        passwordHash: mockPasswordHash,
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

    it('fails closed when optional authentication cannot query the database', async () => {
      const token = jwt.sign({ id: mockUserId }, secret);
      const { req, res, next, getError } = createMockContext({
        authorization: `Bearer ${token}`,
      });
      vi.spyOn(prisma.user, 'findUnique').mockRejectedValue(new Error('database unavailable'));

      await authenticateOptional(req, res as any, next);

      expect(getError()).toBeInstanceOf(AppError);
      expect(getError().statusCode).toBe(500);
      expect(req.user).toBeUndefined();
    });

    it('authenticateOptional attaches active user if valid, or leaves undefined if unauthenticated/invalid', async () => {
      // 1. Without token -> next() called, req.user is undefined
      const ctx1 = createMockContext();
      await authenticateOptional(ctx1.req, ctx1.res as any, ctx1.next);
      expect(ctx1.wasNextCalled()).toBe(true);
      expect(ctx1.req.user).toBeUndefined();

      // 2. With valid active user -> attaches user
      const mockPasswordHash = '$2a$12$e8kP0PzK3J5K3J5K3J5K3.O3n3o3n3o3n3o3n3o3n3o3n3o3n3o';
      const validToken = jwt.sign(
        { id: mockUserId, pwdTag: computePasswordTag(mockUserId, mockPasswordHash) },
        secret
      );
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'active@acm.local',
        fullName: 'Active User',
        role: UserRole.TECHNICIAN,
        isActive: true,
        isLocked: false,
        passwordHash: mockPasswordHash,
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

    it('does not trust a client-supplied X-Forwarded-For header for the rate-limit key', () => {
      const limiter = createLoginRateLimiter({ windowMs: 60 * 1000, max: 1 });
      const ip = '198.51.100.25';

      const first = createMockContext({ 'x-forwarded-for': '203.0.113.9' }, ip);
      limiter(first.req, first.res as any, first.next);
      expect(first.wasNextCalled()).toBe(true);

      const second = createMockContext({ 'x-forwarded-for': '203.0.113.10' }, ip);
      limiter(second.req, second.res as any, second.next);
      expect(second.res.statusCode).toBe(429);
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

    // ========================================================
    // SEC-02 CONCURRENCY & RACE CONDITION GUARDS SIMULATION
    // ========================================================
    it('aborts login with 403 Forbidden and denies token if account is concurrently locked during password verification', async () => {
      const password = 'CorrectSecret123!';
      const passwordHash = await bcrypt.hash(password, 10);

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'concurrent-locked@acm.local',
        fullName: 'Concurrent Locked User',
        role: UserRole.STUDENT,
        passwordHash,
        failedLoginAttempts: 4,
        isLocked: false, // Initially unlocked when query started
        isActive: true,
      } as any);

      // Simulate race condition: another concurrent request locked the account while bcrypt was evaluating.
      // updateMany returns count: 0 because isLocked = false no longer matches.
      const updateManySpy = vi.spyOn(prisma.user, 'updateMany').mockResolvedValue({ count: 0 });

      const ctx = createMockContext(
        {},
        '127.0.0.1',
        { email: 'concurrent-locked@acm.local', password },
        'POST',
        '/login'
      );

      await new Promise<void>((resolve) => {
        let finished = false;
        const done = () => { if (!finished) { finished = true; resolve(); } };
        const origJson = ctx.res.json.bind(ctx.res);
        ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
        authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
      });

      const err = ctx.getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(403);
      expect(err.message).toContain('Tài khoản đã bị tạm khóa do vi phạm chính sách bảo mật');
      // Crucial security invariant: No token was issued
      expect(ctx.res.body).toBeNull();
      expect(updateManySpy).toHaveBeenCalledWith({
        where: {
          id: mockUserId,
          isLocked: false,
          isActive: true,
          passwordHash,
        },
        data: { failedLoginAttempts: 0 },
      });
    });

    it('aborts login with 403 Forbidden and denies token if account is concurrently deactivated during password verification', async () => {
      const password = 'CorrectSecret123!';
      const passwordHash = await bcrypt.hash(password, 10);

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'concurrent-deactivated@acm.local',
        fullName: 'Concurrent Deactivated User',
        role: UserRole.STUDENT,
        passwordHash,
        failedLoginAttempts: 0,
        isLocked: false,
        isActive: true, // Active when checked initially
      } as any);

      // Simulate race condition: administrator deactivated user while bcrypt was evaluating.
      // updateMany returns count: 0 because isActive = true no longer matches.
      const updateManySpy = vi.spyOn(prisma.user, 'updateMany').mockResolvedValue({ count: 0 });

      const ctx = createMockContext(
        {},
        '127.0.0.1',
        { email: 'concurrent-deactivated@acm.local', password },
        'POST',
        '/login'
      );

      await new Promise<void>((resolve) => {
        let finished = false;
        const done = () => { if (!finished) { finished = true; resolve(); } };
        const origJson = ctx.res.json.bind(ctx.res);
        ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
        authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
      });

      const err = ctx.getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(403);
      expect(err.message).toContain('Tài khoản đã bị tạm khóa do vi phạm chính sách bảo mật');
      expect(ctx.res.body).toBeNull();
    });

    it('successfully resets failedLoginAttempts to 0 and issues token when account remains active and unlocked', async () => {
      const password = 'CorrectSecret123!';
      const passwordHash = await bcrypt.hash(password, 10);

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'valid-success@acm.local',
        fullName: 'Valid Success User',
        role: UserRole.STUDENT,
        passwordHash,
        failedLoginAttempts: 3, // Had previous failed attempts
        isLocked: false,
        isActive: true,
      } as any);

      const updateManySpy = vi.spyOn(prisma.user, 'updateMany').mockResolvedValue({ count: 1 });

      const ctx = createMockContext(
        {},
        '127.0.0.1',
        { email: 'valid-success@acm.local', password },
        'POST',
        '/login'
      );

      await new Promise<void>((resolve) => {
        let finished = false;
        const done = () => { if (!finished) { finished = true; resolve(); } };
        const origJson = ctx.res.json.bind(ctx.res);
        ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
        authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
      });

      expect(ctx.getError()).toBeNull();
      expect(ctx.res.statusCode).toBe(200);
      expect(ctx.res.body.success).toBe(true);
      expect(ctx.res.body.data).toHaveProperty('token');
      expect(ctx.res.body.data.user.id).toBe(mockUserId);

      // Verify token is valid and signed
      const decoded: any = jwt.verify(ctx.res.body.data.token, secret);
      expect(decoded.id).toBe(mockUserId);
      expect(decoded.role).toBe(UserRole.STUDENT);

      // Verify atomic reset call
      expect(updateManySpy).toHaveBeenCalledWith({
        where: {
          id: mockUserId,
          isLocked: false,
          isActive: true,
          passwordHash,
        },
        data: { failedLoginAttempts: 0 },
      });
    });

    it('increments failedLoginAttempts atomically in database on failed password attempt', async () => {
      const passwordHash = await bcrypt.hash('CorrectSecret123!', 10);

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'atomic-increment@acm.local',
        fullName: 'Atomic User',
        role: UserRole.STUDENT,
        passwordHash,
        failedLoginAttempts: 2,
        isLocked: false,
        isActive: true,
      } as any);

      // Atomic DB increment returns new count (3 < 5)
      const updateSpy = vi.spyOn(prisma.user, 'update').mockResolvedValue({
        failedLoginAttempts: 3,
      } as any);

      const ctx = createMockContext(
        {},
        '127.0.0.1',
        { email: 'atomic-increment@acm.local', password: 'WrongPassword999!' },
        'POST',
        '/login'
      );

      await new Promise<void>((resolve) => {
        let finished = false;
        const done = () => { if (!finished) { finished = true; resolve(); } };
        const origJson = ctx.res.json.bind(ctx.res);
        ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
        authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
      });

      const err = ctx.getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('Email hoặc mật khẩu không chính xác');

      // Assert database-side atomic increment was executed with { increment: 1 }
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: mockUserId },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true, role: true, isActive: true, isLocked: true },
      });
    });

    it('locks account and returns 403 when atomic counter increment reaches MAX_FAILED_LOGIN_ATTEMPTS', async () => {
      const passwordHash = await bcrypt.hash('CorrectSecret123!', 10);

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'reach-lock@acm.local',
        fullName: 'Lock Target User',
        role: UserRole.STUDENT,
        passwordHash,
        failedLoginAttempts: 4,
        isLocked: false,
        isActive: true,
      } as any);

      // 1st update: increment reaches 5
      // 2nd update: locks the user
      const updateSpy = vi.spyOn(prisma.user, 'update')
        .mockResolvedValueOnce({ failedLoginAttempts: 5 } as any)
        .mockResolvedValueOnce({ id: mockUserId, isLocked: true } as any);

      const ctx = createMockContext(
        {},
        '127.0.0.1',
        { email: 'reach-lock@acm.local', password: 'WrongPassword999!' },
        'POST',
        '/login'
      );

      await new Promise<void>((resolve) => {
        let finished = false;
        const done = () => { if (!finished) { finished = true; resolve(); } };
        const origJson = ctx.res.json.bind(ctx.res);
        ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
        authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
      });

      const err = ctx.getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(403);
      expect(err.message).toContain('Tài khoản đã bị tạm khóa do nhập sai mật khẩu quá 5 lần liên tiếp');

      expect(updateSpy).toHaveBeenNthCalledWith(1, {
        where: { id: mockUserId },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true, role: true, isActive: true, isLocked: true },
      });
      expect(updateSpy).toHaveBeenNthCalledWith(2, {
        where: { id: mockUserId },
        data: { isLocked: true },
      });
    });

    it('immediately blocks login attempt with 403 when account is already locked prior to password check', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'already-locked@acm.local',
        fullName: 'Already Locked User',
        role: UserRole.STUDENT,
        passwordHash: 'dummy-hash',
        failedLoginAttempts: 5,
        isLocked: true,
        isActive: true,
      } as any);

      const bcryptSpy = vi.spyOn(bcrypt, 'compare');

      const ctx = createMockContext(
        {},
        '127.0.0.1',
        { email: 'already-locked@acm.local', password: 'AnyPassword123!' },
        'POST',
        '/login'
      );

      await new Promise<void>((resolve) => {
        let finished = false;
        const done = () => { if (!finished) { finished = true; resolve(); } };
        const origJson = ctx.res.json.bind(ctx.res);
        ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
        authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
      });

      const err = ctx.getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(403);
      expect(err.message).toContain('Tài khoản đã bị tạm khóa do vi phạm chính sách bảo mật');
      // bcrypt.compare must not be called
      expect(bcryptSpy).not.toHaveBeenCalled();
    });

    it('prevents Request B from resetting counter and acquiring JWT if Request A reached MAX_FAILED_LOGIN_ATTEMPTS before isLocked is updated', async () => {
      const password = 'CorrectSecret123!';
      const passwordHash = await bcrypt.hash(password, 10);

      // User state read before Request A incremented: was 4 failures, unlocked
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'race-condition@acm.local',
        fullName: 'Race Target User',
        role: UserRole.STUDENT,
        passwordHash,
        failedLoginAttempts: 4,
        isLocked: false,
        isActive: true,
      } as any);

      // In the database, Request A has incremented failedLoginAttempts to 5 (>= MAX_FAILED_LOGIN_ATTEMPTS).
      // Even if isLocked was not yet set to true in DB, the conditional updateMany with { lt: MAX_FAILED_LOGIN_ATTEMPTS }
      // matches ZERO rows because failedLoginAttempts is 5.
      const updateManySpy = vi.spyOn(prisma.user, 'updateMany').mockResolvedValue({ count: 0 });

      const ctx = createMockContext(
        {},
        '127.0.0.1',
        { email: 'race-condition@acm.local', password },
        'POST',
        '/login'
      );

      await new Promise<void>((resolve) => {
        let finished = false;
        const done = () => { if (!finished) { finished = true; resolve(); } };
        const origJson = ctx.res.json.bind(ctx.res);
        ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
        authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
      });

      const err = ctx.getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(403);
      expect(err.message).toContain('Tài khoản đã bị tạm khóa do vi phạm chính sách bảo mật');
      // Crucial invariant: zero JWT token issued to user
      expect(ctx.res.body).toBeNull();

      expect(updateManySpy).toHaveBeenCalledWith({
        where: {
          id: mockUserId,
          isLocked: false,
          isActive: true,
          passwordHash,
        },
        data: { failedLoginAttempts: 0 },
      });
    });

    it('executes counter increment and account locking atomically inside a database transaction', async () => {
      const passwordHash = await bcrypt.hash('CorrectSecret123!', 10);

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'tx-lock@acm.local',
        fullName: 'Tx Lock User',
        role: UserRole.STUDENT,
        passwordHash,
        failedLoginAttempts: 4,
        isLocked: false,
        isActive: true,
      } as any);

      const txSpy = vi.spyOn(prisma, '$transaction');
      const updateSpy = vi.spyOn(prisma.user, 'update')
        .mockResolvedValueOnce({ failedLoginAttempts: 5 } as any)
        .mockResolvedValueOnce({ id: mockUserId, isLocked: true } as any);

      const ctx = createMockContext(
        {},
        '127.0.0.1',
        { email: 'tx-lock@acm.local', password: 'WrongPassword999!' },
        'POST',
        '/login'
      );

      await new Promise<void>((resolve) => {
        let finished = false;
        const done = () => { if (!finished) { finished = true; resolve(); } };
        const origJson = ctx.res.json.bind(ctx.res);
        ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
        authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
      });

      expect(txSpy).toHaveBeenCalled();
      expect(updateSpy).toHaveBeenNthCalledWith(1, {
        where: { id: mockUserId },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true, role: true, isActive: true, isLocked: true },
      });
      expect(updateSpy).toHaveBeenNthCalledWith(2, {
        where: { id: mockUserId },
        data: { isLocked: true },
      });
      expect(ctx.getError()?.statusCode).toBe(403);
    });
  });

  // ==========================================
  // 4. Seed Environment Guard Tests
  // ==========================================

    // ========================================================
    // SEC-01: JWT Session Invalidation via pwdTag Tests
    // ========================================================
    it('SEC-01: rejects request with 401 when token lacks pwdTag claim', async () => {
      const tokenWithoutTag = jwt.sign({ id: mockUserId }, secret);
      const { req, res, next, getError } = createMockContext({
        authorization: `Bearer ${tokenWithoutTag}`,
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'user@acm.local',
        fullName: 'User',
        role: UserRole.STUDENT,
        isActive: true,
        isLocked: false,
        passwordHash: mockPasswordHash,
      } as any);

      await authenticate(req, res as any, next);
      const err = getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('mật khẩu đã thay đổi');
    });

    it('SEC-01: rejects request with 401 when token has tampered/invalid pwdTag', async () => {
      const tokenWithWrongTag = jwt.sign({ id: mockUserId, pwdTag: '0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff' }, secret);
      const { req, res, next, getError } = createMockContext({
        authorization: `Bearer ${tokenWithWrongTag}`,
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'user@acm.local',
        fullName: 'User',
        role: UserRole.STUDENT,
        isActive: true,
        isLocked: false,
        passwordHash: mockPasswordHash,
      } as any);

      await authenticate(req, res as any, next);
      const err = getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('mật khẩu đã thay đổi');
    });

    it('SEC-01: rejects request with 401 when password was reset (passwordHash changed)', async () => {
      // Token issued with old password hash
      const token = jwt.sign({ id: mockUserId, pwdTag: computePasswordTag(mockUserId, mockPasswordHash) }, secret);
      const { req, res, next, getError } = createMockContext({
        authorization: `Bearer ${token}`,
      });

      // User in database now has NEW password hash after reset
      const newHashAfterReset = '$2a$12$DIFFERENT_HASH_AFTER_RESET_9999999999999999999999999';
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'user@acm.local',
        fullName: 'User',
        role: UserRole.STUDENT,
        isActive: true,
        isLocked: false,
        passwordHash: newHashAfterReset,
      } as any);

      await authenticate(req, res as any, next);
      const err = getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('mật khẩu đã thay đổi');
    });

    it('SEC-01: accepts request when token pwdTag matches current passwordHash', async () => {
      const token = jwt.sign({ id: mockUserId, pwdTag: computePasswordTag(mockUserId, mockPasswordHash) }, secret);
      const { req, res, next, getError, wasNextCalled } = createMockContext({
        authorization: `Bearer ${token}`,
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'user@acm.local',
        fullName: 'User',
        role: UserRole.STUDENT,
        isActive: true,
        isLocked: false,
        passwordHash: mockPasswordHash,
      } as any);

      await authenticate(req, res as any, next);
      expect(getError()).toBeNull();
      expect(wasNextCalled()).toBe(true);
      expect(req.user?.id).toBe(mockUserId);
      // Ensure passwordHash is NOT exposed in req.user
      expect((req.user as any).passwordHash).toBeUndefined();
    });

    // ========================================================
    // SEC-02: Last Operational Admin Login Safety Tests
    // ========================================================
    it('SEC-02: login failure on last operational ADMIN increments counter but suppresses account lockout', async () => {
      const passwordHash = await bcrypt.hash('AdminSecret123!', 10);

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'last-admin@acm.local',
        fullName: 'Last Operational Admin',
        role: UserRole.ADMIN,
        passwordHash,
        failedLoginAttempts: 4,
        isLocked: false,
        isActive: true,
      } as any);

      const updateSpy = vi.spyOn(prisma.user, 'update').mockResolvedValue({
        failedLoginAttempts: 5,
        role: UserRole.ADMIN,
        isActive: true,
        isLocked: false,
      } as any);

      // Operational admin count is 1 (this is the last admin!)
      const countSpy = vi.spyOn(prisma.user, 'count').mockResolvedValue(1);

      const ctx = createMockContext(
        {},
        '127.0.0.1',
        { email: 'last-admin@acm.local', password: 'WrongPassword999!' },
        'POST',
        '/login'
      );

      await new Promise<void>((resolve) => {
        let finished = false;
        const done = () => { if (!finished) { finished = true; resolve(); } };
        const origJson = ctx.res.json.bind(ctx.res);
        ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
        authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
      });

      const err = ctx.getError();
      expect(err).toBeInstanceOf(AppError);
      // MUST return 401 (not 403) so attacker does not know this is the last admin
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('Email hoặc mật khẩu không chính xác');

      // Crucial: update was called only once to increment counter, NOT to set isLocked: true
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: mockUserId },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true, role: true, isActive: true, isLocked: true },
      });
      // isLocked was NEVER updated to true
      expect(updateSpy).not.toHaveBeenCalledWith(expect.objectContaining({
        data: { isLocked: true },
      }));
    });

    it('SEC-02: login failure on ADMIN when multiple operational ADMINs exist locks account after 5 attempts', async () => {
      const passwordHash = await bcrypt.hash('AdminSecret123!', 10);

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: mockUserId,
        email: 'admin-one@acm.local',
        fullName: 'Admin One',
        role: UserRole.ADMIN,
        passwordHash,
        failedLoginAttempts: 4,
        isLocked: false,
        isActive: true,
      } as any);

      const updateSpy = vi.spyOn(prisma.user, 'update')
        .mockResolvedValueOnce({ failedLoginAttempts: 5, role: UserRole.ADMIN, isActive: true, isLocked: false } as any)
        .mockResolvedValueOnce({ id: mockUserId, isLocked: true } as any);

      // Operational admin count is 2 (safe to lock)
      vi.spyOn(prisma.user, 'count').mockResolvedValue(2);

      const ctx = createMockContext(
        {},
        '127.0.0.1',
        { email: 'admin-one@acm.local', password: 'WrongPassword999!' },
        'POST',
        '/login'
      );

      await new Promise<void>((resolve) => {
        let finished = false;
        const done = () => { if (!finished) { finished = true; resolve(); } };
        const origJson = ctx.res.json.bind(ctx.res);
        ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
        authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
      });

      const err = ctx.getError();
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(403);
      expect(err.message).toContain('Tài khoản đã bị tạm khóa');
      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(updateSpy).toHaveBeenNthCalledWith(2, {
        where: { id: mockUserId },
        data: { isLocked: true },
      });
    });


    // ========================================================
    // SEC-02 & P1 HARDENING: AUTH-LASTADMIN & AUTH-JWT TEST SUITE
    // ========================================================
    describe('SEC-02 & P1 Verification: Last Operational Admin Recovery & JWT Invalidation', () => {
      it('AUTH-LASTADMIN-01: 4 consecutive failed logins followed by correct password succeeds', async () => {
        const password = 'CorrectAdminPass@2026';
        const passwordHash = await bcrypt.hash(password, 10);

        vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
          id: mockUserId,
          email: 'last-admin-01@acm.local',
          fullName: 'Last Operational Admin',
          role: UserRole.ADMIN,
          passwordHash,
          failedLoginAttempts: 4, // 4 previous failed attempts
          isLocked: false,
          isActive: true,
        } as any);

        const updateManySpy = vi.spyOn(prisma.user, 'updateMany').mockResolvedValue({ count: 1 });

        const ctx = createMockContext(
          {},
          '127.0.0.1',
          { email: 'last-admin-01@acm.local', password },
          'POST',
          '/login'
        );

        await new Promise<void>((resolve) => {
          let finished = false;
          const done = () => { if (!finished) { finished = true; resolve(); } };
          const origJson = ctx.res.json.bind(ctx.res);
          ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
          authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
        });

        expect(ctx.getError()).toBeNull();
        expect(ctx.res.statusCode).toBe(200);
        expect(ctx.res.body.success).toBe(true);
        expect(ctx.res.body.data).toHaveProperty('token');
        expect(ctx.res.body.data.user.role).toBe(UserRole.ADMIN);

        // Counter reset to 0
        expect(updateManySpy).toHaveBeenCalledWith({
          where: {
            id: mockUserId,
            isLocked: false,
            isActive: true,
            passwordHash,
          },
          data: { failedLoginAttempts: 0 },
        });
      });

      it('AUTH-LASTADMIN-02: 5 consecutive failed logins suppresses account lockout for last operational ADMIN', async () => {
        const passwordHash = await bcrypt.hash('CorrectAdminPass@2026', 10);

        vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
          id: mockUserId,
          email: 'last-admin-02@acm.local',
          fullName: 'Last Operational Admin',
          role: UserRole.ADMIN,
          passwordHash,
          failedLoginAttempts: 4,
          isLocked: false,
          isActive: true,
        } as any);

        const updateSpy = vi.spyOn(prisma.user, 'update').mockResolvedValue({
          failedLoginAttempts: 5,
          role: UserRole.ADMIN,
          isActive: true,
          isLocked: false,
        } as any);

        // Only 1 operational admin exists in directory
        vi.spyOn(prisma.user, 'count').mockResolvedValue(1);

        const ctx = createMockContext(
          {},
          '127.0.0.1',
          { email: 'last-admin-02@acm.local', password: 'WrongPassword999!' },
          'POST',
          '/login'
        );

        await new Promise<void>((resolve) => {
          let finished = false;
          const done = () => { if (!finished) { finished = true; resolve(); } };
          const origJson = ctx.res.json.bind(ctx.res);
          ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
          authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
        });

        const err = ctx.getError();
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(401);
        expect(err.message).toBe('Email hoặc mật khẩu không chính xác');

        // Increment counter called once, isLocked: true was NEVER set
        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(updateSpy).not.toHaveBeenCalledWith(expect.objectContaining({
          data: { isLocked: true },
        }));
      });

      it('AUTH-LASTADMIN-03: after rate limit cooldown, last operational ADMIN with 5 failed attempts logs in successfully', async () => {
        const password = 'CorrectAdminPass@2026';
        const passwordHash = await bcrypt.hash(password, 10);

        // State in DB: 5 failed attempts recorded, but isLocked remains false (SEC-02)
        vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
          id: mockUserId,
          email: 'last-admin-03@acm.local',
          fullName: 'Last Operational Admin',
          role: UserRole.ADMIN,
          passwordHash,
          failedLoginAttempts: 5, // >= MAX_FAILED_LOGIN_ATTEMPTS
          isLocked: false, // NOT locked due to SEC-02
          isActive: true,
        } as any);

        // Rate limit window has elapsed / reset
        loginRateLimiter.reset();
        accountLoginRateLimiter.reset();

        vi.spyOn(prisma.user, 'count').mockResolvedValue(1);
        const updateManySpy = vi.spyOn(prisma.user, 'updateMany').mockResolvedValue({ count: 1 });

        const ctx = createMockContext(
          {},
          '127.0.0.1',
          { email: 'last-admin-03@acm.local', password },
          'POST',
          '/login'
        );

        await new Promise<void>((resolve) => {
          let finished = false;
          const done = () => { if (!finished) { finished = true; resolve(); } };
          const origJson = ctx.res.json.bind(ctx.res);
          ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
          authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
        });

        // Crucial verification: Admin is NOT blocked by failedLoginAttempts >= 5
        expect(ctx.getError()).toBeNull();
        expect(ctx.res.statusCode).toBe(200);
        expect(ctx.res.body.success).toBe(true);
        expect(ctx.res.body.data).toHaveProperty('token');
        expect(ctx.res.body.data.user.role).toBe(UserRole.ADMIN);

        // Counter successfully reset to 0 in database
        expect(updateManySpy).toHaveBeenCalledWith({
          where: {
            id: mockUserId,
            isLocked: false,
            isActive: true,
            passwordHash,
          },
          data: { failedLoginAttempts: 0 },
        });
      });

      it('AUTH-LASTADMIN-04: standard ADMIN is locked after 5 failed attempts when multiple operational ADMINs exist', async () => {
        const passwordHash = await bcrypt.hash('StandardAdminPass@2026', 10);

        vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
          id: mockUserId,
          email: 'standard-admin-04@acm.local',
          fullName: 'Standard Admin User',
          role: UserRole.ADMIN,
          passwordHash,
          failedLoginAttempts: 4,
          isLocked: false,
          isActive: true,
        } as any);

        const updateSpy = vi.spyOn(prisma.user, 'update')
          .mockResolvedValueOnce({ failedLoginAttempts: 5, role: UserRole.ADMIN, isActive: true, isLocked: false } as any)
          .mockResolvedValueOnce({ id: mockUserId, isLocked: true } as any);

        // 2 operational ADMINs exist -> account lockout MUST execute
        vi.spyOn(prisma.user, 'count').mockResolvedValue(2);

        const ctx = createMockContext(
          {},
          '127.0.0.1',
          { email: 'standard-admin-04@acm.local', password: 'WrongPassword999!' },
          'POST',
          '/login'
        );

        await new Promise<void>((resolve) => {
          let finished = false;
          const done = () => { if (!finished) { finished = true; resolve(); } };
          const origJson = ctx.res.json.bind(ctx.res);
          ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
          authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
        });

        const err = ctx.getError();
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(403);
        expect(err.message).toContain('Tài khoản đã bị tạm khóa');
        expect(updateSpy).toHaveBeenCalledTimes(2);
        expect(updateSpy).toHaveBeenNthCalledWith(2, {
          where: { id: mockUserId },
          data: { isLocked: true },
        });
      });

      it('AUTH-LASTADMIN-04b: when multiple operational ADMINs exist, an ADMIN with 5 failed attempts entering correct password is rejected with 403 and locked with transaction commit', async () => {
        const password = 'AdminPassword123!';
        const passwordHash = await bcrypt.hash(password, 10);

        vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
          id: mockUserId,
          email: 'standard-admin-04b@acm.local',
          fullName: 'Non-Last Admin User',
          role: UserRole.ADMIN,
          passwordHash,
          failedLoginAttempts: 5,
          isLocked: false,
          isActive: true,
        } as any);

        // 2 operational ADMINs exist in directory
        vi.spyOn(prisma.user, 'count').mockResolvedValue(2);
        const updateManySpy = vi.spyOn(prisma.user, 'updateMany').mockResolvedValue({ count: 1 });
        const txSpy = vi.spyOn(prisma, '$transaction');

        loginRateLimiter.reset();
        accountLoginRateLimiter.reset();

        const ctx = createMockContext(
          {},
          '127.0.0.1',
          { email: 'standard-admin-04b@acm.local', password },
          'POST',
          '/login'
        );

        await new Promise<void>((resolve) => {
          let finished = false;
          const done = () => { if (!finished) { finished = true; resolve(); } };
          const origJson = ctx.res.json.bind(ctx.res);
          ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
          authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
        });

        // 1. Transaction COMMITS successfully with outcome LOCKED_THRESHOLD (does not rollback)
        await expect(txSpy.mock.results[0].value).resolves.toEqual({
          status: 'LOCKED_THRESHOLD',
          reason: 'Tài khoản đã bị tạm khóa do vi phạm chính sách bảo mật',
        });

        // 2. State update executed
        expect(updateManySpy).toHaveBeenCalledWith({
          where: { id: mockUserId, isLocked: false },
          data: { isLocked: true },
        });

        // 3. Router throws HTTP 403 and zero token is issued
        const err = ctx.getError();
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(403);
        expect(err.message).toContain('Tài khoản đã bị tạm khóa do vi phạm chính sách bảo mật');
        expect(ctx.res.body).toBeNull();
      });

      it('AUTH-LASTADMIN-10: when transaction fails during lockout update, transaction rolls back and fails closed without fake lock success', async () => {
        const password = 'AdminPassword123!';
        const passwordHash = await bcrypt.hash(password, 10);

        vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
          id: mockUserId,
          email: 'standard-admin-10@acm.local',
          fullName: 'Non-Last Admin User',
          role: UserRole.ADMIN,
          passwordHash,
          failedLoginAttempts: 5,
          isLocked: false,
          isActive: true,
        } as any);

        vi.spyOn(prisma.user, 'count').mockResolvedValue(2);
        // Simulate database connection failure or deadlock during the lock update inside transaction
        vi.spyOn(prisma.user, 'updateMany').mockRejectedValue(
          new Error('Connection terminated unexpectedly during lock update')
        );

        loginRateLimiter.reset();
        accountLoginRateLimiter.reset();

        const ctx = createMockContext(
          {},
          '127.0.0.1',
          { email: 'standard-admin-10@acm.local', password },
          'POST',
          '/login'
        );

        await new Promise<void>((resolve) => {
          let finished = false;
          const done = () => { if (!finished) { finished = true; resolve(); } };
          const origJson = ctx.res.json.bind(ctx.res);
          ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
          authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
        });

        const err = ctx.getError();
        expect(err).toBeDefined();
        expect(err.message).toContain('Connection terminated unexpectedly during lock update');
        // Crucial security invariant: Zero token issued, zero fake lock success response
        expect(ctx.res.body).toBeNull();
      });

      it('AUTH-LASTADMIN-11: bounded P2034 retry preserves lock evaluation and security permissions on non-last ADMIN', async () => {
        const password = 'AdminPassword123!';
        const passwordHash = await bcrypt.hash(password, 10);

        vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
          id: mockUserId,
          email: 'standard-admin-11@acm.local',
          fullName: 'Non-Last Admin User',
          role: UserRole.ADMIN,
          passwordHash,
          failedLoginAttempts: 5,
          isLocked: false,
          isActive: true,
        } as any);

        vi.spyOn(prisma.user, 'count').mockResolvedValue(2);
        const updateManySpy = vi.spyOn(prisma.user, 'updateMany').mockResolvedValue({ count: 1 });

        loginRateLimiter.reset();
        accountLoginRateLimiter.reset();

        // Simulate 1 transient P2034 on first attempt, then normal execution on retry
        let txAttempt = 0;
        vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => {
          txAttempt++;
          if (txAttempt === 1) {
            const p2034Err: any = new Error('P2034 transaction conflict');
            p2034Err.code = 'P2034';
            throw p2034Err;
          }
          return callback(prisma);
        });

        const ctx = createMockContext(
          {},
          '127.0.0.1',
          { email: 'standard-admin-11@acm.local', password },
          'POST',
          '/login'
        );

        await new Promise<void>((resolve) => {
          let finished = false;
          const done = () => { if (!finished) { finished = true; resolve(); } };
          const origJson = ctx.res.json.bind(ctx.res);
          ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
          authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
        });

        const err = ctx.getError();
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(403);
        expect(err.message).toContain('Tài khoản đã bị tạm khóa do vi phạm chính sách bảo mật');
        expect(ctx.res.body).toBeNull();
        expect(txAttempt).toBe(2); // Retried after P2034
        expect(updateManySpy).toHaveBeenCalledWith({
          where: { id: mockUserId, isLocked: false },
          data: { isLocked: true },
        });
      });

      it('AUTH-LASTADMIN-07: dynamic admin transition: when 1 of 2 admins becomes locked, remaining active admin becomes last operational admin and can recover', async () => {
        const password = 'RemainingAdminPass@2026';
        const passwordHash = await bcrypt.hash(password, 10);

        // Active admin 2 enters password after 5 failed attempts
        vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
          id: 'admin-id-2',
          email: 'admin2@acm.local',
          fullName: 'Remaining Operational Admin',
          role: UserRole.ADMIN,
          passwordHash,
          failedLoginAttempts: 5,
          isLocked: false,
          isActive: true,
        } as any);

        // Only 1 operational admin now exists (admin 1 was locked)
        vi.spyOn(prisma.user, 'count').mockResolvedValue(1);
        const updateManySpy = vi.spyOn(prisma.user, 'updateMany').mockResolvedValue({ count: 1 });

        loginRateLimiter.reset();
        accountLoginRateLimiter.reset();

        const ctx = createMockContext(
          {},
          '127.0.0.1',
          { email: 'admin2@acm.local', password },
          'POST',
          '/login'
        );

        await new Promise<void>((resolve) => {
          let finished = false;
          const done = () => { if (!finished) { finished = true; resolve(); } };
          const origJson = ctx.res.json.bind(ctx.res);
          ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
          authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
        });

        expect(ctx.getError()).toBeNull();
        expect(ctx.res.statusCode).toBe(200);
        expect(ctx.res.body.success).toBe(true);
        expect(ctx.res.body.data.user.id).toBe('admin-id-2');
        expect(updateManySpy).toHaveBeenCalledWith({
          where: {
            id: 'admin-id-2',
            isLocked: false,
            isActive: true,
            passwordHash,
          },
          data: { failedLoginAttempts: 0 },
        });
      });

      it('AUTH-LASTADMIN-08: account-level rate limiter blocks distributed brute force across different IPs targeting same email with 429', async () => {
        const passwordHash = await bcrypt.hash('CorrectSecret123!', 10);
        loginRateLimiter.reset();
        accountLoginRateLimiter.reset();

        vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
          id: mockUserId,
          email: 'victim@acm.local',
          fullName: 'Victim User',
          role: UserRole.STUDENT,
          passwordHash,
          failedLoginAttempts: 0,
          isLocked: false,
          isActive: true,
        } as any);
        vi.spyOn(prisma.user, 'update').mockResolvedValue({
          failedLoginAttempts: 1,
          role: UserRole.STUDENT,
          isActive: true,
          isLocked: false,
        } as any);

        // 5 requests from 5 DIFFERENT IP addresses to bypass IP-level rate limiter
        const ips = ['198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.4', '198.51.100.5'];
        for (const ip of ips) {
          const ctx = createMockContext({}, ip, { email: 'victim@acm.local', password: 'WrongPassword!' }, 'POST', '/login');
          await new Promise<void>((resolve) => {
            let finished = false;
            const done = () => { if (!finished) { finished = true; resolve(); } };
            const origJson = ctx.res.json.bind(ctx.res);
            ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
            authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
          });
          expect(ctx.getError()?.statusCode).toBe(401);
        }

        // 6th attempt from a 6th DIFFERENT IP address must be blocked with 429 by accountLoginRateLimiter
        const ctx6 = createMockContext({}, '198.51.100.6', { email: 'victim@acm.local', password: 'WrongPassword!' }, 'POST', '/login');
        await new Promise<void>((resolve) => {
          let finished = false;
          const done = () => { if (!finished) { finished = true; resolve(); } };
          const origJson = ctx6.res.json.bind(ctx6.res);
          ctx6.res.json = (payload: any) => { origJson(payload); done(); return ctx6.res; };
          authRouter(ctx6.req, ctx6.res as any, (err) => { ctx6.next(err); done(); });
        });

        expect(ctx6.getError()).toBeNull();
        expect(ctx6.res.statusCode).toBe(429);
        expect(ctx6.res.body.success).toBe(false);
        expect(ctx6.res.body.message).toContain('Tài khoản này đã vượt quá số lần thử đăng nhập cho phép');
        expect(ctx6.res.getHeader('retry-after')).toBeDefined();
      });

      it('AUTH-LASTADMIN-09: concurrent good and bad logins handle transaction conflicts cleanly', async () => {
        const password = 'CorrectPassword123!';
        const passwordHash = await bcrypt.hash(password, 10);
        loginRateLimiter.reset();
        accountLoginRateLimiter.reset();

        vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
          id: mockUserId,
          email: 'concurrent@acm.local',
          fullName: 'Concurrent Test User',
          role: UserRole.STUDENT,
          passwordHash,
          failedLoginAttempts: 0,
          isLocked: false,
          isActive: true,
        } as any);

        // Simulate 1 transient P2034 serialization failure on transaction, then success on retry attempt 2
        let txAttempt = 0;
        vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => {
          txAttempt++;
          if (txAttempt === 1) {
            const p2034Err: any = new Error('Serialization conflict');
            p2034Err.code = 'P2034';
            throw p2034Err;
          }
          return callback(prisma);
        });

        vi.spyOn(prisma.user, 'updateMany').mockResolvedValue({ count: 1 });

        const ctx = createMockContext({}, '127.0.0.1', { email: 'concurrent@acm.local', password }, 'POST', '/login');
        await new Promise<void>((resolve) => {
          let finished = false;
          const done = () => { if (!finished) { finished = true; resolve(); } };
          const origJson = ctx.res.json.bind(ctx.res);
          ctx.res.json = (payload: any) => { origJson(payload); done(); return ctx.res; };
          authRouter(ctx.req, ctx.res as any, (err) => { ctx.next(err); done(); });
        });

        expect(ctx.getError()).toBeNull();
        expect(ctx.res.statusCode).toBe(200);
        expect(ctx.res.body.success).toBe(true);
        expect(txAttempt).toBe(2); // Retried after P2034 and succeeded
      });

      it('AUTH-LASTADMIN-05: 5th failed login on last operational ADMIN never leaks admin status or lockout suppression', async () => {
        const passwordHash = await bcrypt.hash('SomeSecretPass@2026', 10);

        // 1. Normal user failed attempt 5
        vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce({
          id: 'student-id-1',
          email: 'student-05@acm.local',
          fullName: 'Student User',
          role: UserRole.STUDENT,
          passwordHash,
          failedLoginAttempts: 2,
          isLocked: false,
          isActive: true,
        } as any);
        vi.spyOn(prisma.user, 'update').mockResolvedValueOnce({
          failedLoginAttempts: 3, role: UserRole.STUDENT, isActive: true, isLocked: false,
        } as any);

        const ctxStudent = createMockContext(
          {},
          '127.0.0.1',
          { email: 'student-05@acm.local', password: 'WrongPassword!' },
          'POST',
          '/login'
        );
        await new Promise<void>((resolve) => {
          let finished = false;
          const done = () => { if (!finished) { finished = true; resolve(); } };
          const origJson = ctxStudent.res.json.bind(ctxStudent.res);
          ctxStudent.res.json = (payload: any) => { origJson(payload); done(); return ctxStudent.res; };
          authRouter(ctxStudent.req, ctxStudent.res as any, (err) => { ctxStudent.next(err); done(); });
        });

        // 2. Last operational admin failed attempt 5
        vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce({
          id: 'admin-id-1',
          email: 'admin-05@acm.local',
          fullName: 'Last Operational Admin',
          role: UserRole.ADMIN,
          passwordHash,
          failedLoginAttempts: 4,
          isLocked: false,
          isActive: true,
        } as any);
        vi.spyOn(prisma.user, 'update').mockResolvedValueOnce({
          failedLoginAttempts: 5, role: UserRole.ADMIN, isActive: true, isLocked: false,
        } as any);
        vi.spyOn(prisma.user, 'count').mockResolvedValueOnce(1);

        const ctxAdmin = createMockContext(
          {},
          '127.0.0.1',
          { email: 'admin-05@acm.local', password: 'WrongPassword!' },
          'POST',
          '/login'
        );
        await new Promise<void>((resolve) => {
          let finished = false;
          const done = () => { if (!finished) { finished = true; resolve(); } };
          const origJson = ctxAdmin.res.json.bind(ctxAdmin.res);
          ctxAdmin.res.json = (payload: any) => { origJson(payload); done(); return ctxAdmin.res; };
          authRouter(ctxAdmin.req, ctxAdmin.res as any, (err) => { ctxAdmin.next(err); done(); });
        });

        // Compare responses: exact status code and message matching
        expect(ctxStudent.getError()?.statusCode).toBe(401);
        expect(ctxAdmin.getError()?.statusCode).toBe(401);
        expect(ctxAdmin.getError()?.message).toBe(ctxStudent.getError()?.message);
        expect(ctxAdmin.getError()?.message).toBe('Email hoặc mật khẩu không chính xác');

        // Ensure zero metadata leaking admin identity or lockout suppression
        expect(ctxAdmin.res.body).toBeNull();
      });

      it('AUTH-LASTADMIN-06: concurrent modifications during password evaluation strictly fail closed', async () => {
        const password = 'CorrectSecret123!';
        const passwordHash = await bcrypt.hash(password, 10);

        // Case 6a: Password was changed concurrently during bcrypt check -> updateMany matches 0 rows
        const concurrentPasswordUser = {
          id: mockUserId,
          email: 'concurrent-pass@acm.local',
          fullName: 'User Password Changed',
          role: UserRole.ADMIN,
          passwordHash,
          failedLoginAttempts: 0,
          isLocked: false,
          isActive: true,
        } as any;
        // Login first reads outside the transaction and then re-reads inside it.
        // Mock BOTH reads: never leak a zero-DB unit case into live Prisma.
        vi.spyOn(prisma.user, 'findUnique')
          .mockResolvedValueOnce(concurrentPasswordUser)
          .mockResolvedValueOnce(concurrentPasswordUser);
        // updateMany matches 0 rows because passwordHash in DB is now new-hash-2
        vi.spyOn(prisma.user, 'updateMany').mockResolvedValueOnce({ count: 0 });

        const ctx1 = createMockContext(
          {},
          '127.0.0.1',
          { email: 'concurrent-pass@acm.local', password },
          'POST',
          '/login'
        );
        await new Promise<void>((resolve) => {
          let finished = false;
          const done = () => { if (!finished) { finished = true; resolve(); } };
          const origJson = ctx1.res.json.bind(ctx1.res);
          ctx1.res.json = (payload: any) => { origJson(payload); done(); return ctx1.res; };
          authRouter(ctx1.req, ctx1.res as any, (err) => { ctx1.next(err); done(); });
        });

        expect(ctx1.getError()).toBeInstanceOf(AppError);
        expect(ctx1.getError().statusCode).toBe(403);
        expect(ctx1.res.body).toBeNull();

        // Case 6b: Account was deactivated concurrently -> updateMany matches 0 rows
        const concurrentDeactivatedUser = {
          id: mockUserId,
          email: 'concurrent-deact@acm.local',
          fullName: 'User Deactivated',
          role: UserRole.STUDENT,
          passwordHash,
          failedLoginAttempts: 0,
          isLocked: false,
          isActive: true,
        } as any;
        vi.spyOn(prisma.user, 'findUnique')
          .mockResolvedValueOnce(concurrentDeactivatedUser)
          .mockResolvedValueOnce(concurrentDeactivatedUser);
        vi.spyOn(prisma.user, 'updateMany').mockResolvedValueOnce({ count: 0 });

        const ctx2 = createMockContext(
          {},
          '127.0.0.1',
          { email: 'concurrent-deact@acm.local', password },
          'POST',
          '/login'
        );
        await new Promise<void>((resolve) => {
          let finished = false;
          const done = () => { if (!finished) { finished = true; resolve(); } };
          const origJson = ctx2.res.json.bind(ctx2.res);
          ctx2.res.json = (payload: any) => { origJson(payload); done(); return ctx2.res; };
          authRouter(ctx2.req, ctx2.res as any, (err) => { ctx2.next(err); done(); });
        });

        expect(ctx2.getError()).toBeInstanceOf(AppError);
        expect(ctx2.getError().statusCode).toBe(403);
        expect(ctx2.res.body).toBeNull();
      });

      it('AUTH-JWT-07: old JWT token is rejected immediately after password reset', async () => {
        const oldPasswordHash = '$2a$12$oldHash111111111111111111111111111111111111111111111111111';
        const newPasswordHash = '$2a$12$newHash222222222222222222222222222222222222222222222222222';

        // Old token signed with old password tag
        const oldPwdTag = computePasswordTag(mockUserId, oldPasswordHash);
        const oldToken = jwt.sign(
          { id: mockUserId, email: 'user@acm.local', role: UserRole.STUDENT, pwdTag: oldPwdTag },
          secret
        );

        // Database now has newPasswordHash
        vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
          id: mockUserId,
          email: 'user@acm.local',
          fullName: 'Test User',
          role: UserRole.STUDENT,
          isActive: true,
          isLocked: false,
          passwordHash: newPasswordHash,
        } as any);

        const { req, res, next, getError } = createMockContext({
          authorization: `Bearer ${oldToken}`,
        });

        await authenticate(req, res as any, next);

        const err = getError();
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(401);
        expect(err.message).toContain('Phiên đăng nhập đã hết hiệu lực do mật khẩu đã thay đổi, vui lòng đăng nhập lại');
        expect(req.user).toBeUndefined();
      });

      it('AUTH-JWT-08: token missing pwdTag or with tampered pwdTag is rejected with 401', async () => {
        const passwordHash = '$2a$12$validHash11111111111111111111111111111111111111111111111111';

        vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
          id: mockUserId,
          email: 'user@acm.local',
          fullName: 'Test User',
          role: UserRole.STUDENT,
          isActive: true,
          isLocked: false,
          passwordHash,
        } as any);

        // Case 8a: Token missing pwdTag claim
        const tokenMissingTag = jwt.sign(
          { id: mockUserId, email: 'user@acm.local', role: UserRole.STUDENT },
          secret
        );
        const ctx1 = createMockContext({ authorization: `Bearer ${tokenMissingTag}` });
        await authenticate(ctx1.req, ctx1.res as any, ctx1.next);
        expect(ctx1.getError()?.statusCode).toBe(401);
        expect(ctx1.req.user).toBeUndefined();

        // Case 8b: Token with tampered/invalid 64-hex pwdTag
        const tokenTamperedTag = jwt.sign(
          { id: mockUserId, email: 'user@acm.local', role: UserRole.STUDENT, pwdTag: '0000000000000000000000000000000000000000000000000000000000000000' },
          secret
        );
        const ctx2 = createMockContext({ authorization: `Bearer ${tokenTamperedTag}` });
        await authenticate(ctx2.req, ctx2.res as any, ctx2.next);
        expect(ctx2.getError()?.statusCode).toBe(401);
        expect(ctx2.req.user).toBeUndefined();

        // Case 8c: Token with malformed non-hex / wrong length string
        const tokenMalformedTag = jwt.sign(
          { id: mockUserId, email: 'user@acm.local', role: UserRole.STUDENT, pwdTag: 'invalid-short-tag' },
          secret
        );
        const ctx3 = createMockContext({ authorization: `Bearer ${tokenMalformedTag}` });
        await authenticate(ctx3.req, ctx3.res as any, ctx3.next);
        expect(ctx3.getError()?.statusCode).toBe(401);
        expect(ctx3.req.user).toBeUndefined();
      });
    });

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

    it('blocks remote database seeding even if a legacy override is present', () => {
      const prevVal = process.env.ALLOW_REMOTE_SEED;
      try {
        process.env.ALLOW_REMOTE_SEED = 'true';
        const check = validateSeedEnvironment(
          'postgresql://postgres.sandbox:password@pooler.supabase.com:6543/postgres',
          'development'
        );
        expect(check.allowed).toBe(false);
      } finally {
        if (prevVal === undefined) delete process.env.ALLOW_REMOTE_SEED;
        else process.env.ALLOW_REMOTE_SEED = prevVal;
      }
    });

    it('blocks seed execution in the test environment', () => {
      const check = validateSeedEnvironment(
        'postgresql://postgres:postgres@localhost:5432/acm_inventory_test',
        'test'
      );
      expect(check.allowed).toBe(false);
    });
  });
});
