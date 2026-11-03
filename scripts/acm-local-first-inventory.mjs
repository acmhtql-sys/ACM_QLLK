#!/usr/bin/env node
/**
 * ACM local-first source inventory. STRICT READ-ONLY:
 * - Reads files, prints static facts; does not run npm, git, tests, SQL or HTTP.
 * - No database/network/credentials access; does not read .env values.
 * - A static PASS never means functional local UAT or permission to deploy cloud.
 * Usage: node scripts/acm-local-first-inventory.mjs "D:\ACM_QLLK_UAT"
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(process.argv[2] || '.');
const checks = [];
const add = (id, status, detail) => checks.push({ id, status, detail });
const pathAt = (p) => join(root, ...p.split('/'));
const present = (p) => existsSync(pathAt(p));
const read = (p) => present(p) ? readFileSync(pathAt(p), 'utf8') : null;
const parse = (p) => {
  const raw = read(p);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
};
const apiPkg = parse('apps/api/package.json');
const webPkg = parse('apps/web/package.json');
const rootPkg = parse('package.json');
const apiEnv = read('apps/api/src/config/env.ts');
const apiApp = read('apps/api/src/app.ts');
const webApi = read('apps/web/src/services/api.ts');
const prisma = read('apps/api/prisma/schema.prisma');
const policy = read('apps/api/src/config/securityPolicy.ts');

add('SRC-01', rootPkg?.workspaces?.includes('apps/*') && rootPkg?.workspaces?.includes('packages/*') ? 'PRESENT' : 'REVIEW_REQUIRED', 'npm monorepo workspaces');
add('SRC-02', webPkg?.dependencies?.react && webPkg?.devDependencies?.vite ? 'PRESENT' : 'REVIEW_REQUIRED', 'React/Vite source and dependencies');
add('SRC-03', apiPkg?.dependencies?.express && apiPkg?.dependencies?.['@prisma/client'] ? 'PRESENT' : 'REVIEW_REQUIRED', 'Express/Prisma source and dependencies');
add('SRC-04', prisma?.includes('provider') && prisma.includes('postgresql') ? 'PRESENT' : 'REVIEW_REQUIRED', 'Prisma PostgreSQL datasource declaration');
add('SRC-05', webApi?.includes('VITE_API_BASE_URL') ? 'PRESENT' : 'REVIEW_REQUIRED', 'Web API base URL configuration');
add('SRC-06', apiEnv?.includes('STAGING_READ_ONLY') && policy?.includes('cloud_staging') ? 'PRESENT' : 'REVIEW_REQUIRED', 'Backend staging read-only guard configuration');
add('SRC-07', apiEnv?.includes("profile === 'production'") || policy?.includes("profile === 'production'") ? 'BLOCKED_BY_POLICY' : 'MANUAL_REVIEW', 'Backend production deployment profile still fail-closed or needs audit');
add('SRC-08', apiApp?.includes('uploadsRouter') ? 'REGISTERED_NEEDS_TESTS' : 'NOT_REGISTERED_IN_APP', 'Upload router registration; does not prove absence of every upload implementation');
add('SRC-09', apiPkg?.dependencies?.cloudinary ? 'SDK_DECLARED_NEEDS_TESTS' : 'CLOUDINARY_SDK_NOT_DECLARED', 'Cloudinary SDK is not declared in API dependencies; custom adapters need a separate review');
add('SRC-10', present('apps/web/src') && present('apps/api/src') ? 'PRESENT' : 'REVIEW_REQUIRED', 'Frontend and Backend source directories');
add('GATE-LOCAL', 'NOT_VERIFIED', 'Build, unit, E2E, local PG17, StorageProvider, RBAC, receipt/stock/Asset correctness and backup/restore were NOT executed');
add('GATE-DBA', 'REQUIRES_HUMAN_APPROVAL', 'Independent DBA design review plus isolated PG and SQL authorization are separate gates');
add('GATE-CLOUD', 'NO_GO', 'No Vercel/Render/Supabase/Cloudinary deployment until local GO and separate cloud approval');

process.stdout.write(JSON.stringify({
  tool: 'ACM_LOCAL_FIRST_STATIC_INVENTORY',
  location: root,
  mode: 'read_only_no_db_no_network_no_env_contents',
  cloudGo: false,
  checks,
}, null, 2) + '\n');
