#!/usr/bin/env node
/**
 * Phase 11 offline staging-readiness preflight.
 * Reads repository source/templates only; never opens sockets, queries databases,
 * reads actual .env files or cloud credentials, or changes external systems.
 * Passing indicates source-policy alignment, NOT cloud deployment readiness.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const checks = [];
const check = (name, predicate) => checks.push({ name, ok: Boolean(predicate) });
const ci = read('.github/workflows/ci.yml');
const app = read('apps/api/src/app.ts');
const policy = read('apps/api/src/config/securityPolicy.ts');
const env = read('apps/api/src/config/env.ts');
const apiTemplate = read('apps/api/.env.example');
const webFeatures = read('apps/web/src/config/features.ts');
const health = read('apps/api/src/modules/health/health.router.ts');
const auth = read('apps/api/src/modules/auth/auth.router.ts');
const client = read('apps/web/src/services/api.ts');
const webConfig = JSON.parse(read('vercel.json'));
const pkg = JSON.parse(read('package.json'));

check('GitHub Actions uses Node.js 22 (matches tested CI runtime)', /node-version:\s*22\b/.test(ci));
check('GitHub Actions isolates PostgreSQL CI database', ci.includes('postgres:16-alpine') && ci.includes('/acm_inventory_test?schema=public'));
check('Root monorepo has ordered Shared/API/Web builds', /build --workspace=@acm\/shared.*build --workspace=@acm\/api.*build --workspace=@acm\/web/.test(pkg.scripts.build));
check('Static preflight wired into CI', ci.includes('npm run preflight:staging') && pkg.scripts['preflight:staging'] === 'node scripts/phase11-preflight.mjs');
check('Production runtime profile is restricted to cloud_staging', env.includes("profile !== 'cloud_staging'"));
check('Cloud staging requires STAGING_READ_ONLY=true', env.includes("data.STAGING_READ_ONLY !== 'true'"));
check('API mounts server-side read-only middleware', app.includes('app.use(cloudStagingReadOnlyMiddleware('));
check('Read-only guard blocks HTTP mutation verbs', policy.includes("'POST', 'PUT', 'PATCH', 'DELETE'"));
check('API example disables cloud-staging login', /^ALLOW_STAGING_AUTH_LOGIN=false\s*$/m.test(apiTemplate));
check('Login performs DB writes (must not be falsely treated as read-only)', auth.includes('failedLoginAttempts: { increment: 1 }') && auth.includes('prisma.user.updateMany('));
check('Only HTTPS Vercel endpoint can be configured for cloud CORS', env.includes('isValidCloudCorsOrigin(data.CORS_ORIGIN)'));
check('Liveness and readiness endpoints are present', health.includes("healthRouter.get('/liveness'") && health.includes("healthRouter.get('/readiness'"));
check('Frontend write feature gates default off', ['VITE_ENABLE_LOCATION_WRITES','VITE_ENABLE_STOCK_TRANSACTION_WRITES','VITE_ENABLE_STOCK_ADJUSTMENT'].every(flag => webFeatures.includes("import.meta.env."+flag+" === 'true'")));
check('Frontend API uses configurable VITE_API_BASE_URL', client.includes('import.meta.env.VITE_API_BASE_URL'));
check('Vercel SPA rewrite targets index.html', Array.isArray(webConfig.rewrites) && webConfig.rewrites.some(x => x.source === '/(.*)' && x.destination === '/index.html'));
check('Phase 11 operator docs exist', existsSync(resolve(root, 'docs/phase11/STAGING_READINESS.md')) && existsSync(resolve(root, 'docs/phase11/UAT_CHECKLIST.md')));

for (const item of checks) console.log((item.ok ? 'PASS' : 'FAIL') + ' ' + item.name);
const failed = checks.filter(x => !x.ok);
console.log('Phase 11 OFFLINE preflight: ' + (checks.length-failed.length) + '/' + checks.length + ' static checks passed; NO cloud connection performed.');
if (failed.length) process.exitCode = 1;
