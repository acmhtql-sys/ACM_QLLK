import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import {
  isSecureCloudJwtSecret,
  isValidCloudCorsOrigin,
  isValidCloudCorsAllowlist,
  deploymentProfileSchema,
  validateDeploymentProfileConfig,
  validateSecurityConfig,
  INSECURE_JWT_SECRETS,
} from './securityPolicy';
import { validateDatabaseUrl } from './databaseGuard';

export {
  isSecureCloudJwtSecret,
  isValidCloudCorsOrigin,
  isValidCloudCorsAllowlist,
  deploymentProfileSchema,
  validateDeploymentProfileConfig,
  validateSecurityConfig,
  INSECURE_JWT_SECRETS,
};

const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

if (isTest) {
  // Load .env.test strictly for test environment
  const apiTestEnv = path.resolve(__dirname, '../../.env.test');
  const rootTestEnv = path.resolve(__dirname, '../../../.env.test');

  if (fs.existsSync(apiTestEnv)) {
    dotenv.config({ path: apiTestEnv, override: true });
  } else if (fs.existsSync(rootTestEnv)) {
    dotenv.config({ path: rootTestEnv, override: true });
  } else if (process.env.CI) {
    // In CI environments, variables are provided directly by the workflow runner
  } else {
    console.error('❌ FATAL: .env.test not found. Test suite aborted to prevent accidental database corruption.');
    process.exit(1);
  }
} else {
  // Load development/production .env
  dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
  dotenv.config();
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(5000),
    API_PREFIX: z.string().default('/api/v1'),
    CORS_ORIGIN: z.string().default('*'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z.string().min(8).default('acm-default-jwt-secret-for-dev-only-min-32chars'),
    JWT_EXPIRES_IN: z.string().default('1d'),
    LOG_LEVEL: z.string().default('info'),
    ACM_DEPLOYMENT_PROFILE: z
      .enum(['local_dev', 'gate_b', 's2c_sandbox', 'cloud_staging', 'production'])
      .optional(),
    STAGING_READ_ONLY: z.enum(['true', 'false']).optional(),
    ALLOW_STAGING_AUTH_LOGIN: z.enum(['true', 'false']).optional(),
  })
  .superRefine((data, ctx) => {
    if (isTest || data.NODE_ENV === 'test') {
      // Safety check: tests must strictly target acm_inventory_test and never the dev/prod databases
      const guardResult = validateDatabaseUrl(data.DATABASE_URL);
      if (!guardResult.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `SAFETY VIOLATION: Test environment DATABASE_URL is invalid: ${guardResult.reason}`,
          path: ['DATABASE_URL'],
        });
      }
    }

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
      // In production (Render), ONLY 'cloud_staging' is approved in Phase C1A.2R
      if (profile !== 'cloud_staging') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Profile '${profile}' is not permitted in NODE_ENV=production (only 'cloud_staging' is approved in Phase C1A.2R)`,
          path: ['ACM_DEPLOYMENT_PROFILE'],
        });
        return;
      }
    }

    // RULE 2: Profile 'production' is strictly not yet approved in Phase C1A.2R
    if (profile === 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Profile 'production' is not approved for deployment in Phase C1A.2R (FAIL-CLOSED)",
        path: ['ACM_DEPLOYMENT_PROFILE'],
      });
      return;
    }

    // RULE 3: Cloud Staging profile validation
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

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`   - [${issue.path.join('.')}] ${issue.message}`);
  }
  process.exit(1);
}

export const env = {
  ...parsed.data,
  ACM_DEPLOYMENT_PROFILE: parsed.data.ACM_DEPLOYMENT_PROFILE ?? 'local_dev',
  ALLOW_STAGING_AUTH_LOGIN: parsed.data.ALLOW_STAGING_AUTH_LOGIN ?? 'false',
};
