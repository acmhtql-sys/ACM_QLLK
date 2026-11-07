import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';
import { authRouter, MAX_FAILED_LOGIN_ATTEMPTS } from '../src/modules/auth/auth.router';
import { loginRateLimiter, accountLoginRateLimiter } from '../src/middleware/rateLimiter';
import { prisma } from '../src/config/database';
import { env } from '../src/config/env';
import { AppError } from '../src/shared/AppError';

type LoginOutcome = { status: number; body: any; error: any };

async function requestLogin(email: string, password: string): Promise<LoginOutcome> {
  const req: any = {
    method: 'POST', url: '/login', originalUrl: '/login', path: '/login',
    baseUrl: '', headers: {}, ip: '127.0.0.12',
    socket: { remoteAddress: '127.0.0.12' }, body: { email, password },
  };
  const result: LoginOutcome = { status: 200, body: null, error: null };
  await new Promise<void>((resolve) => {
    let completed = false;
    const done = () => { if (!completed) { completed = true; resolve(); } };
    const res: any = {
      status(code: number) { result.status = code; return this; },
      json(body: any) { result.body = body; done(); return this; },
      setHeader() { return this; },
    };
    authRouter(req, res, (error: any) => { result.error = error; done(); });
  });
  return result;
}

describe('P2-E Cloud Staging authentication: zero database writes', () => {
  const originalProfile = env.ACM_DEPLOYMENT_PROFILE;
  const originalReadOnly = env.STAGING_READ_ONLY;
  const originalLoginFlag = env.ALLOW_STAGING_AUTH_LOGIN;
  const accountId = '11111111-2222-4333-8444-555555555555';
  const email = 'staging-unit-test@acm.internal';
  const password = 'UnitTestPassword123!';
  let passwordHash: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    loginRateLimiter.reset();
    accountLoginRateLimiter.reset();
    env.ACM_DEPLOYMENT_PROFILE = 'cloud_staging';
    env.STAGING_READ_ONLY = 'true';
    env.ALLOW_STAGING_AUTH_LOGIN = 'true';
    passwordHash = await bcrypt.hash(password, 4);
  });

  afterEach(() => {
    env.ACM_DEPLOYMENT_PROFILE = originalProfile;
    env.STAGING_READ_ONLY = originalReadOnly;
    env.ALLOW_STAGING_AUTH_LOGIN = originalLoginFlag;
    loginRateLimiter.reset();
    accountLoginRateLimiter.reset();
    vi.restoreAllMocks();
  });

  function mockAccount(overrides: Record<string, any> = {}) {
    const user = {
      id: accountId, email, fullName: '[CLOUD-STG] Test User', role: UserRole.ADMIN,
      isActive: true, isLocked: false, failedLoginAttempts: 2, passwordHash, ...overrides,
    };
    const find = vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(user as any);
    const update = vi.spyOn(prisma.user, 'update');
    const updateMany = vi.spyOn(prisma.user, 'updateMany');
    const transaction = vi.spyOn(prisma, '$transaction');
    const count = vi.spyOn(prisma.user, 'count');
    return { find, update, updateMany, transaction, count };
  }

  function assertNoWrites(mocks: ReturnType<typeof mockAccount>) {
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  }

  it('issues a valid JWT without resetting failedLoginAttempts on successful login', async () => {
    const mocks = mockAccount();
    const outcome = await requestLogin(email, password);
    expect(outcome.error).toBeNull();
    expect(outcome.body?.success).toBe(true);
    expect(outcome.body?.data?.user?.role).toBe(UserRole.ADMIN);
    const decoded: any = jwt.verify(outcome.body.data.token, env.JWT_SECRET);
    expect(decoded.id).toBe(accountId);
    expect(typeof decoded.pwdTag).toBe('string');
    expect(mocks.find).toHaveBeenCalledTimes(2);
    assertNoWrites(mocks);
  });

  it('rejects incorrect passwords without incrementing counters or locking accounts', async () => {
    const mocks = mockAccount();
    const outcome = await requestLogin(email, 'DefinitelyWrong123!');
    expect(outcome.error).toBeInstanceOf(AppError);
    expect(outcome.error.statusCode).toBe(401);
    expect(outcome.body).toBeNull();
    expect(mocks.find).toHaveBeenCalledTimes(1);
    assertNoWrites(mocks);
  });

  it('rejects accounts already past the attempt threshold without changing the database', async () => {
    const mocks = mockAccount({ failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS });
    const outcome = await requestLogin(email, password);
    expect(outcome.error).toBeInstanceOf(AppError);
    expect(outcome.error.statusCode).toBe(403);
    expect(outcome.body).toBeNull();
    assertNoWrites(mocks);
  });

  it('rejects a locked account even with a correct password', async () => {
    const mocks = mockAccount({ isLocked: true });
    const outcome = await requestLogin(email, password);
    expect(outcome.error).toBeInstanceOf(AppError);
    expect(outcome.error.statusCode).toBe(403);
    expect(outcome.body).toBeNull();
    assertNoWrites(mocks);
  });

  it('rejects a password change detected on the second read', async () => {
    const mocks = mockAccount();
    mocks.find.mockResolvedValueOnce({
      id: accountId, email, fullName: 'Unit Test', role: UserRole.ADMIN,
      isActive: true, isLocked: false, failedLoginAttempts: 0, passwordHash,
    } as any);
    mocks.find.mockResolvedValueOnce({
      id: accountId, email, fullName: 'Unit Test', role: UserRole.ADMIN,
      isActive: true, isLocked: false, failedLoginAttempts: 0, passwordHash: 'changed',
    } as any);
    const outcome = await requestLogin(email, password);
    expect(outcome.error).toBeInstanceOf(AppError);
    expect(outcome.error.statusCode).toBe(403);
    expect(outcome.body).toBeNull();
    assertNoWrites(mocks);
  });
});
