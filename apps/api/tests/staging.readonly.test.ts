import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import net from 'net';
import cors from 'cors';
import http from 'http';
import fs from 'fs';
import path from 'path';
import {
  validateDeploymentProfileConfig,
  validateSecurityConfig,
  isSecureCloudJwtSecret,
  isValidCloudCorsOrigin,
  isValidCloudCorsAllowlist,
  splitCorsOrigins,
  INSECURE_JWT_SECRETS,
  createPureReadOnlyGuard,
  evaluateReadOnlyPolicy,
  evaluateLoginPolicy,
  isAmbiguousOrTraversedPath,
  extractEffectiveHttpMethod,
  extractNormalizedPath,
  SecurityPolicyConfig,
} from '../src/config/securityPolicy';
import {
  getEffectiveSecurityConfig,
  assertCloudStagingPolicy,
  isStagingReadOnlyActive,
  cloudStagingReadOnlyMiddleware,
} from '../src/middleware/cloudStagingReadOnly';

/**
 * PURE MOCK RESPONSE IMPLEMENTATION
 * Simulates Express Response object in-memory with ZERO network or TCP listeners.
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

  end() {
    this.ended = true;
    return this;
  }
}

/**
 * PURE MOCK REQUEST FACTORY
 */
function createMockRequest(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, any>;
  params?: Record<string, string>;
  user?: any;
} = {}): any {
  const url = options.url || '/';
  const method = (options.method || 'GET').toUpperCase();
  const headers = Object.fromEntries(
    Object.entries(options.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
  );

  return {
    method,
    url,
    originalUrl: url,
    path: url.split('?')[0],
    headers,
    query: options.query || {},
    params: options.params || {},
    body: options.body || {},
    user: options.user,
  };
}

/**
 * PURE IN-MEMORY DISPATCHER
 * Executes an Express middleware in-memory without any HTTP listener, net.Server, or Supertest.
 */
async function dispatch(
  middleware: any,
  reqOptions: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: any;
    query?: Record<string, any>;
    user?: any;
  } = {}
) {
  const req = createMockRequest(reqOptions);
  const res = new MockResponse();
  let nextCalled = false;
  let nextError: any = undefined;

  await new Promise<void>((resolve) => {
    const next = (err?: any) => {
      nextCalled = true;
      nextError = err;
      resolve();
    };

    try {
      const result = middleware(req, res, next);
      if (result && typeof result.then === 'function') {
        result.then(() => resolve()).catch((err: any) => {
          nextError = err;
          resolve();
        });
      } else {
        resolve();
      }
    } catch (err: any) {
      nextError = err;
      resolve();
    }
  });

  return { req, res, nextCalled, nextError };
}

// Spies for listener tracking across the entire test lifecycle
let netServerSpy: any;
let httpServerSpy: any;
let processExitSpy: any;

beforeAll(() => {
  netServerSpy = vi.spyOn(net, 'createServer');
  httpServerSpy = vi.spyOn(http, 'createServer');
  processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
});

afterAll(() => {
  netServerSpy?.mockRestore();
  httpServerSpy?.mockRestore();
  processExitSpy?.mockRestore();
});

// Standard Cloud Staging Pure Guard instance
const standardStagingGuard = createPureReadOnlyGuard(() => ({
  profile: 'cloud_staging',
  readOnly: 'true',
  allowAuthLogin: 'false',
  apiPrefix: '/api/v1',
}));

describe('Phase C1A.2R: Pure Mock Security Test Suite (Zero HTTP Listeners & Zero DB)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  // ==========================================
  // R01: Cloud Staging mutation blocked
  // ==========================================
  it('R01: Cloud Staging mutation blocked', async () => {
    const { res, nextCalled } = await dispatch(standardStagingGuard, {
      method: 'POST',
      url: '/api/v1/stock-transactions/import',
      body: { warehouseId: 'loc-1', items: [] },
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
    expect(res.body.method).toBe('POST');
  });

  // ==========================================
  // R02: active=false cannot bypass
  // ==========================================
  it('R02: active=false cannot bypass', async () => {
    process.env.ACM_DEPLOYMENT_PROFILE = 'cloud_staging';
    process.env.STAGING_READ_ONLY = 'true';

    // Injected active: false
    const config = getEffectiveSecurityConfig({ active: false });
    expect(config.profile).toBe('cloud_staging');
    expect(config.readOnly).toBe('true');

    const middleware = cloudStagingReadOnlyMiddleware({ active: false });
    const { res, nextCalled } = await dispatch(middleware, {
      method: 'POST',
      url: '/api/v1/stock-transactions/import',
      body: { warehouseId: 'loc-1' },
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
  });

  // ==========================================
  // R03: policy.profile=local_dev cannot bypass actual cloud_staging
  // ==========================================
  it('R03: policy.profile=local_dev cannot bypass actual cloud_staging', async () => {
    process.env.ACM_DEPLOYMENT_PROFILE = 'cloud_staging';
    process.env.STAGING_READ_ONLY = 'true';

    // Adversarial policy injection attempting to spoof local_dev
    const config = getEffectiveSecurityConfig({
      policy: { profile: 'local_dev', readOnly: 'false' },
    });
    expect(config.profile).toBe('cloud_staging');
    expect(config.readOnly).toBe('true');

    const middleware = cloudStagingReadOnlyMiddleware({
      policy: { profile: 'local_dev', readOnly: 'false' },
    });
    const { res, nextCalled } = await dispatch(middleware, {
      method: 'POST',
      url: '/api/v1/stock-transactions/import',
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
  });

  // ==========================================
  // R04: policy.readOnly=false cannot bypass actual STAGING_READ_ONLY=true
  // ==========================================
  it('R04: policy.readOnly=false cannot bypass actual STAGING_READ_ONLY=true', async () => {
    process.env.ACM_DEPLOYMENT_PROFILE = 'cloud_staging';
    process.env.STAGING_READ_ONLY = 'true';

    const config = getEffectiveSecurityConfig({
      policy: { readOnly: 'false' },
    });
    expect(config.readOnly).toBe('true');

    const middleware = cloudStagingReadOnlyMiddleware({
      policy: { readOnly: 'false' },
    });
    const { res, nextCalled } = await dispatch(middleware, {
      method: 'PUT',
      url: '/api/v1/items/mock-item-1',
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
  });

  // ==========================================
  // R05: policy.allowAuthLogin=true cannot bypass environment login lock
  // ==========================================
  it('R05: policy.allowAuthLogin=true cannot bypass environment login lock', async () => {
    process.env.ACM_DEPLOYMENT_PROFILE = 'cloud_staging';
    process.env.STAGING_READ_ONLY = 'true';
    process.env.ALLOW_STAGING_AUTH_LOGIN = 'false'; // Locked in environment

    // Adversarial attempt to enable login via options
    const config = getEffectiveSecurityConfig({
      allowAuthLogin: true,
      policy: { allowAuthLogin: 'true' },
    });
    expect(config.allowAuthLogin).toBe('false');

    const middleware = cloudStagingReadOnlyMiddleware({
      allowAuthLogin: true,
      policy: { allowAuthLogin: 'true' },
    });
    const { res, nextCalled } = await dispatch(middleware, {
      method: 'POST',
      url: '/api/v1/auth/login',
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
  });

  // ==========================================
  // R06: production + missing profile rejected
  // ==========================================
  it('R06: production + missing profile rejected', () => {
    const result = validateDeploymentProfileConfig({
      NODE_ENV: 'production',
      // ACM_DEPLOYMENT_PROFILE missing
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((i) => i.message.includes('NODE_ENV=production requires explicit ACM_DEPLOYMENT_PROFILE'))
    ).toBe(true);
  });

  // ==========================================
  // R07: production + local_dev rejected
  // ==========================================
  it('R07: production + local_dev rejected', () => {
    const result = validateDeploymentProfileConfig({
      NODE_ENV: 'production',
      ACM_DEPLOYMENT_PROFILE: 'local_dev',
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((i) => i.message.includes("Profile 'local_dev' is not permitted in NODE_ENV=production"))
    ).toBe(true);
  });

  // ==========================================
  // R08: production + gate_b rejected
  // ==========================================
  it('R08: production + gate_b rejected', () => {
    const result = validateDeploymentProfileConfig({
      NODE_ENV: 'production',
      ACM_DEPLOYMENT_PROFILE: 'gate_b',
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((i) => i.message.includes("Profile 'gate_b' is not permitted in NODE_ENV=production"))
    ).toBe(true);
  });

  // ==========================================
  // R09: production + s2c_sandbox rejected
  // ==========================================
  it('R09: production + s2c_sandbox rejected', () => {
    const result = validateDeploymentProfileConfig({
      NODE_ENV: 'production',
      ACM_DEPLOYMENT_PROFILE: 's2c_sandbox',
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((i) => i.message.includes("Profile 's2c_sandbox' is not permitted in NODE_ENV=production"))
    ).toBe(true);
  });

  // ==========================================
  // R10: production + unapproved production profile rejected
  // ==========================================
  it('R10: production + unapproved production profile rejected', () => {
    const result = validateDeploymentProfileConfig({
      NODE_ENV: 'production',
      ACM_DEPLOYMENT_PROFILE: 'production',
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((i) => i.message.includes("Profile 'production' is not permitted in NODE_ENV=production"))
    ).toBe(true);
  });

  // ==========================================
  // R11: cloud_staging + missing read-only rejected
  // ==========================================
  it('R11: cloud_staging + missing read-only rejected', () => {
    const result = validateDeploymentProfileConfig({
      NODE_ENV: 'production',
      ACM_DEPLOYMENT_PROFILE: 'cloud_staging',
      JWT_SECRET: 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2',
      CORS_ORIGIN: 'https://staging.acm.vercel.app',
      // STAGING_READ_ONLY missing
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes('STAGING_READ_ONLY=true'))).toBe(true);
  });

  // ==========================================
  // R12: cloud_staging + read-only=false rejected
  // ==========================================
  it('R12: cloud_staging + read-only=false rejected', () => {
    const result = validateDeploymentProfileConfig({
      NODE_ENV: 'production',
      ACM_DEPLOYMENT_PROFILE: 'cloud_staging',
      STAGING_READ_ONLY: 'false',
      JWT_SECRET: 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2',
      CORS_ORIGIN: 'https://staging.acm.vercel.app',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes('STAGING_READ_ONLY=true'))).toBe(true);
  });

  // ==========================================
  // R13: Cloud missing JWT_SECRET rejected
  // ==========================================
  it('R13: Cloud missing JWT_SECRET rejected', () => {
    const result = validateDeploymentProfileConfig({
      NODE_ENV: 'production',
      ACM_DEPLOYMENT_PROFILE: 'cloud_staging',
      STAGING_READ_ONLY: 'true',
      CORS_ORIGIN: 'https://staging.acm.vercel.app',
      // JWT_SECRET missing
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes('JWT_SECRET'))).toBe(true);
  });

  // ==========================================
  // R14: Cloud insecure default JWT rejected
  // ==========================================
  it('R14: Cloud insecure default JWT rejected', () => {
    for (const badSecret of INSECURE_JWT_SECRETS) {
      const check = isSecureCloudJwtSecret(badSecret);
      expect(check.valid).toBe(false);

      const valResult = validateDeploymentProfileConfig({
        NODE_ENV: 'production',
        ACM_DEPLOYMENT_PROFILE: 'cloud_staging',
        STAGING_READ_ONLY: 'true',
        JWT_SECRET: badSecret,
        CORS_ORIGIN: 'https://staging.acm.vercel.app',
      });
      expect(valResult.success).toBe(false);
    }
  });

  // ==========================================
  // R15: Cloud repeated-character JWT rejected
  // ==========================================
  it('R15: Cloud repeated-character JWT rejected', () => {
    const repeated1 = 'a'.repeat(64);
    const repeated2 = '12345678'.repeat(8);
    const repeated3 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    expect(isSecureCloudJwtSecret(repeated1).valid).toBe(false);
    expect(isSecureCloudJwtSecret(repeated2).valid).toBe(false);
    expect(isSecureCloudJwtSecret(repeated3).valid).toBe(false);

    const valResult = validateDeploymentProfileConfig({
      NODE_ENV: 'production',
      ACM_DEPLOYMENT_PROFILE: 'cloud_staging',
      STAGING_READ_ONLY: 'true',
      JWT_SECRET: repeated1,
      CORS_ORIGIN: 'https://staging.acm.vercel.app',
    });
    expect(valResult.success).toBe(false);
  });

  // ==========================================
  // R16: Valid generated-format JWT accepted
  // ==========================================
  it('R16: Valid generated-format JWT accepted', () => {
    // 64-character hex string generated from 32 cryptographically secure random bytes
    const validHexSecret = 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2';
    const check = isSecureCloudJwtSecret(validHexSecret);
    expect(check.valid).toBe(true);

    const result = validateDeploymentProfileConfig({
      NODE_ENV: 'production',
      ACM_DEPLOYMENT_PROFILE: 'cloud_staging',
      STAGING_READ_ONLY: 'true',
      JWT_SECRET: validHexSecret,
      CORS_ORIGIN: 'https://staging.acm.vercel.app',
    });
    expect(result.success).toBe(true);
  });

  // ==========================================
  // R17: HTTPS origin accepted
  // ==========================================
  it('R17: HTTPS origin accepted', () => {
    const validOrigin = 'https://acm-staging.vercel.app';
    const check = isValidCloudCorsOrigin(validOrigin);
    expect(check.valid).toBe(true);

    const result = validateDeploymentProfileConfig({
      NODE_ENV: 'production',
      ACM_DEPLOYMENT_PROFILE: 'cloud_staging',
      STAGING_READ_ONLY: 'true',
      JWT_SECRET: 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2',
      CORS_ORIGIN: validOrigin,
    });
    expect(result.success).toBe(true);
  });

  // ==========================================
  // R18: URL origin with path rejected
  // ==========================================
  it('R18: URL origin with path rejected', () => {
    const badOrigins = [
      'https://acm-staging.vercel.app/dashboard',
      'https://allowed.vercel.app/foo',
      'https://staging.acm.vercel.app/api/v1',
    ];
    for (const bad of badOrigins) {
      const check = isValidCloudCorsOrigin(bad);
      expect(check.valid).toBe(false);
      expect(check.reason).toContain('path segments');
    }
  });

  // ==========================================
  // R19: URL origin with query rejected
  // ==========================================
  it('R19: URL origin with query rejected', () => {
    const badOrigins = [
      'https://acm-staging.vercel.app?token=1',
      'https://allowed.vercel.app?bar=1',
    ];
    for (const bad of badOrigins) {
      const check = isValidCloudCorsOrigin(bad);
      expect(check.valid).toBe(false);
      expect(check.reason).toContain('query');
    }
  });

  // ==========================================
  // R20: URL origin with hash rejected
  // ==========================================
  it('R20: URL origin with hash rejected', () => {
    const badOrigins = [
      'https://acm-staging.vercel.app/#fragment',
      'https://allowed.vercel.app#frag',
    ];
    for (const bad of badOrigins) {
      const check = isValidCloudCorsOrigin(bad);
      expect(check.valid).toBe(false);
      expect(check.reason).toContain('hash');
    }
  });

  // ==========================================
  // R21: Wildcard and localhost rejected
  // ==========================================
  it('R21: Wildcard and localhost rejected', () => {
    const badOrigins = [
      '*',
      'http://localhost:5173',
      'https://localhost:3000',
      'http://127.0.0.1:5000',
      'https://user:pass@acm-staging.vercel.app',
    ];
    for (const bad of badOrigins) {
      const check = isValidCloudCorsOrigin(bad);
      expect(check.valid).toBe(false);
    }
  });

  // ==========================================
  // R22: ADMIN cannot bypass write guard
  // ==========================================
  it('R22: ADMIN cannot bypass write guard', async () => {
    const { res, nextCalled } = await dispatch(standardStagingGuard, {
      method: 'POST',
      url: '/api/v1/stock-transactions/import',
      headers: { authorization: 'Bearer mock-admin-token' },
      user: { role: 'ADMIN', username: 'admin' },
      body: { warehouseId: 'loc-1' },
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
  });

  // ==========================================
  // R23: LAB_MANAGER cannot bypass write guard
  // ==========================================
  it('R23: LAB_MANAGER cannot bypass write guard', async () => {
    const { res, nextCalled } = await dispatch(standardStagingGuard, {
      method: 'POST',
      url: '/api/v1/stock-transactions/import',
      headers: { authorization: 'Bearer mock-manager-token' },
      user: { role: 'LAB_MANAGER', username: 'manager' },
      body: { warehouseId: 'loc-1' },
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
  });

  // ==========================================
  // R24: Idempotency-Key cannot bypass
  // ==========================================
  it('R24: Idempotency-Key cannot bypass', async () => {
    const { res, nextCalled } = await dispatch(standardStagingGuard, {
      method: 'POST',
      url: '/api/v1/stock-transactions/import',
      headers: { 'idempotency-key': '123e4567-e89b-12d3-a456-426614174000' },
      body: { warehouseId: 'loc-1' },
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
  });

  // ==========================================
  // R25: All Stock POST methods blocked
  // ==========================================
  it('R25: All Stock POST methods blocked', async () => {
    const stockEndpoints = [
      '/api/v1/stock-transactions/import',
      '/api/v1/stock-transactions/export',
      '/api/v1/stock-transactions/transfer',
      '/api/v1/stock-transactions/adjust',
    ];

    for (const ep of stockEndpoints) {
      const { res, nextCalled } = await dispatch(standardStagingGuard, {
        method: 'POST',
        url: ep,
        body: { mock: true },
      });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
    }
  });

  // ==========================================
  // R26: Other mutation methods blocked
  // ==========================================
  it('R26: Other mutation methods blocked', async () => {
    const mutations = [
      { method: 'PUT', url: '/api/v1/items/mock-1' },
      { method: 'PATCH', url: '/api/v1/locations/mock-loc-1' },
      { method: 'DELETE', url: '/api/v1/items/mock-1' },
      { method: 'POST', url: '/api/v1/borrow-requests' },
    ];

    for (const m of mutations) {
      const { res, nextCalled } = await dispatch(standardStagingGuard, {
        method: m.method,
        url: m.url,
      });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
      expect(res.body.method).toBe(m.method);
    }
  });

  // ==========================================
  // R27: Exact login exception defaults OFF
  // ==========================================
  it('R27: Exact login exception defaults OFF', async () => {
    // Default configuration has allowAuthLogin unset or 'false'
    const defaultGuard = createPureReadOnlyGuard(() => ({
      profile: 'cloud_staging',
      readOnly: 'true',
      allowAuthLogin: 'false',
      apiPrefix: '/api/v1',
    }));

    const { res, nextCalled } = await dispatch(defaultGuard, {
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { username: 'test', password: 'password' },
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
  });

  // ==========================================
  // R28: Login exception cannot be enabled by unsafe options
  // ==========================================
  it('R28: Login exception cannot be enabled by unsafe options', async () => {
    process.env.ACM_DEPLOYMENT_PROFILE = 'cloud_staging';
    process.env.STAGING_READ_ONLY = 'true';
    process.env.ALLOW_STAGING_AUTH_LOGIN = 'false';

    const middleware = cloudStagingReadOnlyMiddleware({
      allowAuthLogin: true, // Unsafe option override attempt
      policy: { allowAuthLogin: 'true' },
    });

    const { res, nextCalled } = await dispatch(middleware, {
      method: 'POST',
      url: '/api/v1/auth/login',
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
  });

  // ==========================================
  // R29: Encoded/ambiguous login paths blocked
  // ==========================================
  it('R29: Encoded/ambiguous login paths blocked', async () => {
    // Even when allowAuthLogin is explicitly 'true'
    const guardWithLogin = createPureReadOnlyGuard(() => ({
      profile: 'cloud_staging',
      readOnly: 'true',
      allowAuthLogin: 'true',
      apiPrefix: '/api/v1',
    }));

    // 1. Exact valid login passes
    const validLogin = await dispatch(guardWithLogin, {
      method: 'POST',
      url: '/api/v1/auth/login',
    });
    expect(validLogin.nextCalled).toBe(true);

    // 2. Ambiguous or traversed paths are strictly blocked
    const ambiguousPaths = [
      '/api/v1//auth/login',
      '/api/v1/auth//login',
      '/api/v1/%61uth/login',
      '/api/v1/auth/../auth/login',
      '/api/v1/auth/login/',
      '/api/v1/auth/login/..',
      '/api/v1\\auth\\login',
    ];

    for (const badPath of ambiguousPaths) {
      const { res, nextCalled } = await dispatch(guardWithLogin, {
        method: 'POST',
        url: badPath,
      });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
    }
  });

  // ==========================================
  // R30: Method override cannot bypass
  // ==========================================
  it('R30: Method override cannot bypass', async () => {
    // 1. GET attempting to override into POST is blocked
    const getWithPostOverride = await dispatch(standardStagingGuard, {
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-http-method-override': 'POST' },
    });
    expect(getWithPostOverride.nextCalled).toBe(false);
    expect(getWithPostOverride.res.statusCode).toBe(403);

    // 2. POST attempting to override into GET remains blocked (raw method is mutation)
    const postWithGetOverride = await dispatch(standardStagingGuard, {
      method: 'POST',
      url: '/api/v1/stock-transactions/import',
      headers: { 'x-http-method-override': 'GET' },
    });
    expect(postWithGetOverride.nextCalled).toBe(false);
    expect(postWithGetOverride.res.statusCode).toBe(403);
  });

  // ==========================================
  // R31: Unknown mutation route blocked
  // ==========================================
  it('R31: Unknown mutation route blocked', async () => {
    const { res, nextCalled } = await dispatch(standardStagingGuard, {
      method: 'POST',
      url: '/api/v1/nonexistent-route-xyz',
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('STAGING_READ_ONLY_BLOCKED');
  });

  // ==========================================
  // R32: No business service invoked after blocked requests
  // ==========================================
  it('R32: No business service invoked after blocked requests', async () => {
    let downstreamCalled = false;
    const testChain = (req: any, res: any) => {
      standardStagingGuard(req, res, () => {
        downstreamCalled = true;
      });
    };

    const req = createMockRequest({ method: 'POST', url: '/api/v1/items' });
    const res = new MockResponse();
    testChain(req, res);

    expect(downstreamCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  // ==========================================
  // R33: No real Prisma instance or database connection used by test harness
  // ==========================================
  it('R33: No real Prisma instance or database connection used by test harness', () => {
    const testFileContent = fs.readFileSync(__filename, 'utf-8');

    // Verify zero imports of Prisma, database, or stock services in this test suite
    expect(testFileContent).not.toMatch(/from\s+['"].*prisma.*['"]/i);
    expect(testFileContent).not.toMatch(/from\s+['"].*database.*['"]/i);
    expect(testFileContent).not.toMatch(/from\s+['"].*stock-transactions\.service.*['"]/i);
    expect(testFileContent).not.toMatch(/from\s+['"].*idempotency\.service.*['"]/i);
    expect(testFileContent).not.toMatch(/from\s+['"]\.\.\/src\/app['"]/);
  });

  // ==========================================
  // R34: No network listeners created by test harness
  // ==========================================
  it('R34: No network listeners created by test harness', () => {
    // Assert that zero net.createServer or http.createServer calls occurred during the suite
    expect(netServerSpy).toHaveBeenCalledTimes(0);
    expect(httpServerSpy).toHaveBeenCalledTimes(0);
  });

  // ==========================================
  // R35: No process termination by test harness
  // ==========================================
  it('R35: No process termination by test harness', () => {
    expect(processExitSpy).toHaveBeenCalledTimes(0);
  });

  // ==========================================
  // R36: Mounting order inspected without real API startup
  // ==========================================
  it('R36: Mounting order inspected without real API startup', () => {
    const appTsPath = path.resolve(__dirname, '../src/app.ts');
    const appSource = fs.readFileSync(appTsPath, 'utf-8');

    // 1. Verify cloudStagingReadOnlyMiddleware is imported
    expect(appSource).toContain("import { cloudStagingReadOnlyMiddleware");

    // 2. Locate middleware mount line vs business routers mount lines
    const middlewareMountMatch = appSource.search(/app\.use\(\s*cloudStagingReadOnlyMiddleware/);
    const firstRouterMountMatch = appSource.search(/app\.use\(\s*`\$\{prefix\}\//);

    expect(middlewareMountMatch).toBeGreaterThan(-1);
    expect(firstRouterMountMatch).toBeGreaterThan(-1);
    // cloudStagingReadOnlyMiddleware MUST be mounted before the first business router
    expect(middlewareMountMatch).toBeLessThan(firstRouterMountMount(firstRouterMountMatch));

    function firstRouterMountMount(idx: number) {
      return idx;
    }
  });

  // ==========================================
  // R37: GET/HEAD forwarding tested only as middleware behavior
  // ==========================================
  it('R37: GET/HEAD forwarding tested only as middleware behavior', async () => {
    const endpoints = [
      { method: 'GET', url: '/api/v1/health' },
      { method: 'GET', url: '/api/v1/health/liveness' },
      { method: 'GET', url: '/api/v1/items' },
      { method: 'HEAD', url: '/api/v1/health' },
      { method: 'OPTIONS', url: '/api/v1/stock-transactions/import' },
    ];

    for (const ep of endpoints) {
      const { res, nextCalled } = await dispatch(standardStagingGuard, ep);
      expect(nextCalled).toBe(true);
      expect(res.statusCode).toBe(200);
    }
  });

  // ==========================================
  // R38: Cloud startup config validation verified on actual source execution path
  // ==========================================
  it('R38: Cloud startup config validation verified on actual source execution path', () => {
    const envTsPath = path.resolve(__dirname, '../src/config/env.ts');
    const serverTsPath = path.resolve(__dirname, '../src/server.ts');

    const envSource = fs.readFileSync(envTsPath, 'utf-8');
    const serverSource = fs.readFileSync(serverTsPath, 'utf-8');

    // 1. server.ts imports env.ts before app.listen
    const envImportIndex = serverSource.indexOf("from './config/env'");
    const listenIndex = serverSource.indexOf('app.listen');
    expect(envImportIndex).toBeGreaterThan(-1);
    expect(listenIndex).toBeGreaterThan(-1);
    expect(envImportIndex).toBeLessThan(listenIndex);

    // 2. env.ts executes envSchema.safeParse at module top-level
    expect(envSource).toContain('envSchema.safeParse(process.env)');
    expect(envSource).toContain('process.exit(1)');

    // 3. env.ts validates production profile allowlist
    expect(envSource).toContain("if (profile !== 'cloud_staging')");
  });
});

describe('Pilot 09-15 Nov 2026: fail-closed staging CORS origin allowlist', () => {
  const oldPreview = 'https://acm-qllk-staging-web-git-codex-p3-staging-reado-9c73d1-acm-1cfa.vercel.app';
  const newPreview = 'https://acm-qllk-staging-34v3pwrnb-acm-1cfa.vercel.app';

  it('accepts one legacy origin and at most four explicit HTTPS origins', () => {
    expect(isValidCloudCorsAllowlist(oldPreview).valid).toBe(true);
    expect(isValidCloudCorsAllowlist(`${oldPreview}, ${newPreview}`).valid).toBe(true);
    expect(splitCorsOrigins(oldPreview)).toBe(oldPreview);
    expect(splitCorsOrigins('*')).toBe('*'); // preserve local dev wildcard behavior
    expect(splitCorsOrigins(`${oldPreview}, ${newPreview}`)).toEqual([oldPreview, newPreview]);

    const validated = validateDeploymentProfileConfig({
      NODE_ENV: 'production',
      ACM_DEPLOYMENT_PROFILE: 'cloud_staging',
      STAGING_READ_ONLY: 'true',
      JWT_SECRET: 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2',
      CORS_ORIGIN: `${oldPreview}, ${newPreview}`,
    });
    expect(validated.success).toBe(true);
  });

  it('rejects a wildcard, non-HTTPS/localhost, empty element, duplicate or oversized list', () => {
    for (const invalid of [
      `${oldPreview},*`,
      `${oldPreview},http://localhost:5173`,
      `${oldPreview},`,
      `${oldPreview},${oldPreview}`,
      `${oldPreview},${newPreview},${oldPreview.toUpperCase()}`,
      `${oldPreview},${newPreview},https://a.example.com,https://b.example.com,https://c.example.com`,
      `${oldPreview},\n${newPreview}`,
    ]) {
      expect(isValidCloudCorsAllowlist(invalid).valid, invalid).toBe(false);
    }
  });

  it('responds to OPTIONS only for exactly configured origins without listening on a TCP port', async () => {
    const middleware = cors({
      origin: splitCorsOrigins(`${oldPreview},${newPreview}`),
      credentials: true,
    });
    const fromNew = await dispatch(middleware, {
      method: 'OPTIONS',
      url: '/api/v1/health/liveness',
      headers: {
        Origin: newPreview,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    });
    expect(fromNew.res.statusCode).toBe(204);
    expect(fromNew.res.headers['access-control-allow-origin']).toBe(newPreview);
    expect(fromNew.res.headers['access-control-allow-credentials']).toBe('true');

    const fromOld = await dispatch(middleware, {
      method: 'OPTIONS',
      url: '/api/v1/health/liveness',
      headers: {
        Origin: oldPreview,
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(fromOld.res.headers['access-control-allow-origin']).toBe(oldPreview);

    const untrusted = await dispatch(middleware, {
      method: 'OPTIONS',
      url: '/api/v1/health/liveness',
      headers: {
        Origin: 'https://attacker.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(untrusted.res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
