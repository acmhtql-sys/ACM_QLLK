#!/usr/bin/env node
/* ACM D8 Supabase P0: strictly local, static, read-only review. No network, DB, or subprocesses. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function read(relative) {
  const p = path.resolve(root, relative);
  if (!p.startsWith(root + path.sep)) throw Error('PATH_OUTSIDE_REPO');
  return fs.readFileSync(p, 'utf8');
}
function requireMatch(text, regex, label) {
  if (!regex.test(text)) throw Error('STOP_' + label);
  process.stdout.write('PASS SUPABASE_P0_' + label + '\n');
}
const schema = read('apps/api/prisma/schema.prisma');
const env = read('apps/api/src/config/env.ts');
const db = read('apps/api/src/config/database.ts');
const route = read('apps/api/src/modules/borrow/borrow.router.ts');
const foundation = read('apps/api/src/modules/borrow/borrow.return-operation-foundation.ts');
const packageFile = JSON.parse(read('apps/api/package.json'));
const workflow = read('.github/workflows/wr7g-offline-review-no-db.yml');
requireMatch(schema, /provider\s*=\s*"postgresql"/, 'PROVIDER_POSTGRESQL');
requireMatch(schema, /url\s*=\s*env\("DATABASE_URL"\)/, 'ENV_DATABASE_URL');
requireMatch(schema, /shadowDatabaseUrl\s*=\s*env\("SHADOW_DATABASE_URL"\)/, 'SHADOW_URL_PINNED');
requireMatch(db, /url:\s*env\.DATABASE_URL/, 'BACKEND_PRISMA_URL');
requireMatch(env, /\.env\.test not found/, 'TEST_ENV_FAIL_CLOSED');
requireMatch(route, /rejectUnreleasedReturnOperations\(\)/, 'OPERATION_ROUTE_INERT');
requireMatch(foundation, /return value === 'true'/, 'FEATURE_EXPLICIT_OPT_IN');
requireMatch(workflow, /127\.0\.0\.1:1\/acm_inventory_test/, 'EXISTING_CI_DUMMY_LOOPBACK');
if (!packageFile.scripts['test:unit'].includes('vitest.mock.config.ts')) throw Error('STOP_MOCK_TEST_SUITE');
console.log('PASS SUPABASE_P0_MOCK_SUITE_CONFIGURED');
if (fs.existsSync(path.resolve(root, '.env')) || fs.existsSync(path.resolve(root, 'apps/api/.env.test'))) {
  // On local development machines, files could be real: never open or print their contents.
  console.log('INFO SUPABASE_P0_ENV_PRESENT_NOT_READ');
}
console.log('SUPABASE_P0_STATIC_REVIEW_PASS_NO_DB_NO_NETWORK_NO_WRITES_RELEASE_NO_GO');
