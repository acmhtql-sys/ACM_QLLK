import { Request, Response, NextFunction, RequestHandler } from 'express';
import path from 'path';
import { z } from 'zod';

export interface SecurityPolicyConfig {
  profile?: string;
  readOnly?: string;
  allowAuthLogin?: string;
  apiPrefix?: string;
}

export const INSECURE_JWT_SECRETS = [
  'acm-default-jwt-secret-for-dev-only-min-32chars',
  'super-secret-acm-jwt-token-key-change-in-production-2026',
  'test',
  'secret',
  'default',
  '12345678',
];

/**
 * Checks whether a JWT secret is sufficiently strong for cloud deployment.
 * Requires at least 32 characters, rejects known development/test secrets,
 * rejects low character diversity (e.g. repeated characters 'aaaaaaaa...'),
 * and rejects simple repeating sequences.
 */
export function isSecureCloudJwtSecret(secret?: string): { valid: boolean; reason?: string } {
  if (!secret || typeof secret !== 'string') {
    return { valid: false, reason: 'Cloud deployment requires explicit JWT_SECRET (cannot be empty or undefined)' };
  }
  const trimmed = secret.trim();
  if (trimmed.length < 32) {
    return { valid: false, reason: 'JWT_SECRET must be at least 32 characters long' };
  }
  if (INSECURE_JWT_SECRETS.includes(trimmed)) {
    return { valid: false, reason: 'JWT_SECRET cannot use insecure development default or known test key' };
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('dev-only') ||
    lower.includes('change-in-production') ||
    lower.includes('placeholder')
  ) {
    return { valid: false, reason: 'JWT_SECRET cannot contain development placeholder tokens' };
  }

  // Check character diversity (reject repeated-character secrets like 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  const uniqueChars = new Set(trimmed).size;
  if (uniqueChars < 10) {
    return { valid: false, reason: 'JWT_SECRET has insufficient character diversity / repeated characters' };
  }

  // Reject simple repeating character sequences (8 or more identical characters in a row)
  if (/(.)\1{7,}/.test(trimmed)) {
    return { valid: false, reason: 'JWT_SECRET contains simple repeating character sequences' };
  }

  return { valid: true };
}

/**
 * Validates CORS origin for cloud deployment.
 * Enforces strict exact HTTPS origin:
 * - protocol === 'https:'
 * - valid domain hostname with dot
 * - NO wildcard '*'
 * - NO localhost or loopback (127.0.0.1)
 * - NO credentials (@)
 * - NO path segments (e.g. /dashboard or /foo)
 * - NO query strings (?)
 * - NO hash fragments (#)
 */
export function isValidCloudCorsOrigin(origin?: string): { valid: boolean; reason?: string } {
  if (!origin || typeof origin !== 'string') {
    return { valid: false, reason: 'CORS_ORIGIN is required for Cloud deployment' };
  }
  const trimmed = origin.trim();
  if (trimmed === '*' || trimmed === '' || trimmed.includes('*')) {
    return { valid: false, reason: 'CORS_ORIGIN cannot be wildcard (*)' };
  }
  if (trimmed.includes('localhost') || trimmed.includes('127.0.0.1')) {
    return { valid: false, reason: 'CORS_ORIGIN cannot be localhost or loopback in cloud deployment' };
  }
  if (trimmed.includes('@')) {
    return { valid: false, reason: 'CORS_ORIGIN cannot contain credentials' };
  }
  if (trimmed.includes('?')) {
    return { valid: false, reason: 'CORS_ORIGIN cannot contain query parameters' };
  }
  if (trimmed.includes('#')) {
    return { valid: false, reason: 'CORS_ORIGIN cannot contain hash fragments' };
  }
  if (!trimmed.startsWith('https://')) {
    return { valid: false, reason: 'CORS_ORIGIN must use HTTPS protocol' };
  }

  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:') {
      return { valid: false, reason: 'CORS_ORIGIN must use HTTPS protocol' };
    }
    if (u.username || u.password) {
      return { valid: false, reason: 'CORS_ORIGIN cannot contain credentials' };
    }
    if (u.search || u.hash) {
      return { valid: false, reason: 'CORS_ORIGIN cannot contain query or hash' };
    }
    if (u.pathname !== '/' && u.pathname !== '') {
      return { valid: false, reason: 'CORS_ORIGIN cannot contain path segments' };
    }

    // Verify raw string does not contain path after hostname
    const afterHost = trimmed.replace(/^https:\/\/[^/?#]+/, '');
    if (afterHost !== '' && afterHost !== '/') {
      return { valid: false, reason: 'CORS_ORIGIN cannot contain path segments' };
    }

    if (!u.hostname.includes('.') || u.hostname.endsWith('.')) {
      return { valid: false, reason: 'CORS_ORIGIN must have a valid domain hostname' };
    }
  } catch {
    return { valid: false, reason: 'CORS_ORIGIN has invalid URL format' };
  }

  return { valid: true };
}


/**
 * Explicit, bounded CORS allowlist for the non-production pilot.
 * Existing single-origin and local-development wildcard behavior is preserved.
 * Only cloud_staging accepts HTTPS origins after checking every entry below.
 */
export function splitCorsOrigins(raw: string): string | string[] {
  const normalized = raw.trim();
  return normalized.includes(',')
    ? normalized.split(',').map((part) => part.trim())
    : normalized;
}

export function isValidCloudCorsAllowlist(raw?: string): { valid: boolean; reason?: string } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { valid: false, reason: 'CORS_ORIGIN is required for Cloud deployment' };
  }
  if (/[\r\n\t]/.test(raw)) {
    return { valid: false, reason: 'CORS_ORIGIN must not contain control characters' };
  }

  const configured = splitCorsOrigins(raw);
  const origins = Array.isArray(configured) ? configured : [configured];
  if (origins.length > 4) {
    return { valid: false, reason: 'CORS_ORIGIN supports at most four explicit HTTPS origins' };
  }

  const seen = new Set<string>();
  for (const origin of origins) {
    const checked = isValidCloudCorsOrigin(origin);
    if (!checked.valid) return checked;
    const canonical = new URL(origin).origin.toLowerCase();
    if (seen.has(canonical)) {
      return { valid: false, reason: 'CORS_ORIGIN must not contain duplicate origins' };
    }
    seen.add(canonical);
  }
  return { valid: true };
}

export const deploymentProfileSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    ACM_DEPLOYMENT_PROFILE: z
      .enum(['local_dev', 'gate_b', 's2c_sandbox', 'cloud_staging', 'production'])
      .optional(),
    STAGING_READ_ONLY: z.enum(['true', 'false']).optional(),
    ALLOW_STAGING_AUTH_LOGIN: z.enum(['true', 'false']).optional(),
    JWT_SECRET: z.string().optional(),
    CORS_ORIGIN: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const isProdEnv = data.NODE_ENV === 'production';
    const profile = data.ACM_DEPLOYMENT_PROFILE;

    // RULE 1: In production NODE_ENV, ACM_DEPLOYMENT_PROFILE is mandatory
    if (isProdEnv) {
      if (!profile) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'NODE_ENV=production requires explicit ACM_DEPLOYMENT_PROFILE declaration',
          path: ['ACM_DEPLOYMENT_PROFILE'],
        });
        return;
      }
      // RULE 2: In production (Render), ONLY 'cloud_staging' is approved in Phase C1A.2R
      if (profile !== 'cloud_staging') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Profile '${profile}' is not permitted in NODE_ENV=production (only 'cloud_staging' is approved in Phase C1A.2R)`,
          path: ['ACM_DEPLOYMENT_PROFILE'],
        });
        return;
      }
    }

    // RULE 3: Profile 'production' is strictly not yet approved in Phase C1A.2R
    if (profile === 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Profile 'production' is not approved for deployment in Phase C1A.2R (FAIL-CLOSED)",
        path: ['ACM_DEPLOYMENT_PROFILE'],
      });
      return;
    }

    // RULE 4: Cloud Staging profile validation
    if (profile === 'cloud_staging') {
      if (data.STAGING_READ_ONLY !== 'true') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'cloud_staging requires STAGING_READ_ONLY=true',
          path: ['STAGING_READ_ONLY'],
        });
      }

      const jwtCheck = isSecureCloudJwtSecret(data.JWT_SECRET);
      if (!jwtCheck.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: jwtCheck.reason || 'Cloud deployment requires a high-entropy JWT_SECRET',
          path: ['JWT_SECRET'],
        });
      }

      const corsCheck = isValidCloudCorsAllowlist(data.CORS_ORIGIN);
      if (!corsCheck.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: corsCheck.reason || 'Cloud deployment requires valid HTTPS CORS_ORIGIN',
          path: ['CORS_ORIGIN'],
        });
      }
    }
  });

export function validateDeploymentProfileConfig(envObj: Record<string, any>) {
  return deploymentProfileSchema.safeParse(envObj);
}

export function validateSecurityConfig(envObj: Record<string, any>) {
  return deploymentProfileSchema.safeParse(envObj);
}

/**
 * Pure policy evaluation for Staging Read-Only.
 * In cloud_staging, read-only is ALWAYS active.
 */
export function evaluateReadOnlyPolicy(config: SecurityPolicyConfig): boolean {
  if (config.profile === 'cloud_staging') {
    return true;
  }
  return config.readOnly === 'true';
}

/**
 * Pure policy evaluation for Login Exception.
 * In cloud_staging, login exception requires explicit 'true' from environment policy.
 */
export function evaluateLoginPolicy(config: SecurityPolicyConfig): boolean {
  if (config.profile === 'cloud_staging') {
    return config.allowAuthLogin === 'true';
  }
  return config.allowAuthLogin === 'true';
}

/**
 * Detects whether a path contains URL encoding, duplicate slashes, or path traversal.
 */
export function isAmbiguousOrTraversedPath(rawPath: string): boolean {
  if (!rawPath || typeof rawPath !== 'string') return true;
  if (rawPath.includes('//')) return true;
  if (rawPath.includes('/.') || rawPath.includes('./') || rawPath.includes('..')) return true;
  if (rawPath.includes('%') || rawPath.includes('\\')) return true;
  if (rawPath.endsWith('/') && rawPath.length > 1) return true;
  return false;
}

/**
 * Normalizes HTTP method, detecting potential method-override headers or query params.
 */
export function extractEffectiveHttpMethod(req: Request): string {
  const rawMethod = (req.method || 'GET').toUpperCase();
  const overrideHeader =
    req.headers['x-http-method-override'] ||
    req.headers['x-method-override'] ||
    req.headers['x-http-method'];

  const overrideQuery = (req.query?._method as string | undefined);
  const override = (overrideHeader || overrideQuery || '').toString().toUpperCase();

  const mutationMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (mutationMethods.includes(rawMethod)) {
    return rawMethod;
  }
  if (mutationMethods.includes(override)) {
    return override;
  }
  return rawMethod;
}

/**
 * Normalizes request URL path for general logging and matching.
 */
export function extractNormalizedPath(req: Request): string {
  let raw = req.originalUrl || req.path || '';
  raw = raw.split('?')[0];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Keep raw if decoding fails
  }
  let normalized = path.posix.normalize(raw);
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Creates an in-memory Pure Read-Only Guard middleware with an injected configuration provider.
 * The guard NEVER allows request options to weaken cloud_staging protection.
 */
export function createPureReadOnlyGuard(
  configProvider: () => SecurityPolicyConfig
): RequestHandler {
  return function cloudStagingReadOnlyHandler(req: Request, res: Response, next: NextFunction) {
    const config = configProvider();
    const isReadOnlyActive = evaluateReadOnlyPolicy(config);

    if (!isReadOnlyActive) {
      return next();
    }

    const method = extractEffectiveHttpMethod(req);
    const normalizedPath = extractNormalizedPath(req);
    const rawUrl = (req.originalUrl || req.path || '').split('?')[0];

    // Safe methods pass through
    if (method === 'OPTIONS' || method === 'GET' || method === 'HEAD') {
      return next();
    }

    // Narrow audited login exception
    const prefix = (config.apiPrefix || '/api/v1').replace(/\/$/, '');
    const approvedLoginPaths = [`${prefix}/auth/login`, '/auth/login'];

    const isLiteralPost = (req.method || '').toUpperCase() === 'POST';
    const isLiteralPathMatch = approvedLoginPaths.includes(rawUrl);
    const hasAmbiguity = isAmbiguousOrTraversedPath(rawUrl);
    const isStrictApprovedLogin = isLiteralPost && isLiteralPathMatch && !hasAmbiguity;

    const allowLogin = evaluateLoginPolicy(config);

    if (isStrictApprovedLogin && allowLogin) {
      return next();
    }

    // Block all mutations with 403 Forbidden
    return res.status(403).json({
      success: false,
      code: 'STAGING_READ_ONLY_BLOCKED',
      message: 'Thao tác ghi bị chặn: Môi trường Cloud Staging đang hoạt động ở chế độ Chỉ đọc (Read-Only). Mọi yêu cầu thêm, sửa, xóa dữ liệu bị vô hiệu hóa trên toàn hệ thống.',
      method,
      path: normalizedPath,
    });
  };
}
