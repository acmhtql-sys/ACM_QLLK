import { gzipSync } from 'node:zlib';
/**
 * ACM P3-F live negative probes — run only against EXISTING read-only staging.
 *
 * No credentials, no seed, no database writes. Mutations target a deliberately
 * nonexistent path: a disabled guard yields 404 instead of modifying business data.
 * No request is ever sent to /items, /borrow-requests or other mutating routes.
 */
const base = 'https://acm-api-staging-29fw.onrender.com';
const path = '/api/v1/__acm_p3f_nonexistent_readonly_probe__';
const allowedOrigin = 'https://acm-qllk-staging-web-git-codex-p3-staging-reado-9c73d1-acm-1cfa.vercel.app';
const tests = [
  ...['POST', 'PUT', 'PATCH', 'DELETE'].map(method => ({ method, path, status: 403, errorCode: 'STAGING_READ_ONLY_BLOCKED' })),
  { method: 'GET', path: '/api/v1/users', status: 401 },
  { method: 'GET', path: '/api/v1/auth/me', status: 401 },
  { method: 'GET', path: '/api/v1/categories', status: 401 },
  { method: 'GET', path: '/api/v1/categories/00000000-0000-4000-8000-000000000000', status: 401 },
  { method: 'GET', path: '/api/v1/items', status: 401 },
  { method: 'GET', path: '/api/v1/items/00000000-0000-4000-8000-000000000000', status: 401 },
  { method: 'GET', path: '/api/v1/items/barcode/ACM-P3G-NOT-REAL', status: 401 },
  { method: 'GET', path: '/api/v1/health/liveness', status: 200 },
  { method: 'GET', path, status: 403, headers: { 'X-HTTP-Method-Override': 'POST' }, errorCode: 'STAGING_READ_ONLY_BLOCKED' },
  { method: 'GET', path: path + '?_method=DELETE', status: 403, errorCode: 'STAGING_READ_ONLY_BLOCKED' },
];

async function check(t) {
  const response = await fetch(base + t.path, {
    method: t.method,
    headers: { Accept: 'application/json', ...(t.headers || {}) },
    redirect: 'manual',
    signal: AbortSignal.timeout(110000),
  });
  const bodyText = await response.text();
  let parsed;
  try { parsed = JSON.parse(bodyText); } catch { parsed = null; }
  if (response.status !== t.status || (t.errorCode && parsed?.code !== t.errorCode)) {
    throw new Error(`${t.method} ${t.path.split('?')[0]}: expected ${t.status}/${t.errorCode || '-'}, got ${response.status}/${parsed?.code || '-'}`);
  }
  console.log(`PASS ${t.method} ${t.path.split('?')[0]} -> ${response.status}`);
}

for (const test of tests) {
  await check(test);
}

// Preflight is safe and should identify the one approved browser origin.
const preflight = await fetch(base + '/api/v1/auth/login', {
  method: 'OPTIONS',
  headers: {
    Origin: allowedOrigin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type',
  },
  redirect: 'manual',
  signal: AbortSignal.timeout(110000),
});
if (preflight.status !== 204 || preflight.headers.get('access-control-allow-origin') !== allowedOrigin) {
  throw new Error('CORS preview origin mismatch: preflight did not return the approved origin');
}
console.log('PASS OPTIONS preflight -> approved Preview origin');

// A rejected origin must never be reflected as an approved origin.
const disallowed = 'https://untrusted-acm-probe.invalid';
const rejectProbe = await fetch(base + '/api/v1/health/liveness', {
  method: 'GET',
  headers: { Origin: disallowed },
  redirect: 'manual',
  signal: AbortSignal.timeout(110000),
});
if (rejectProbe.headers.get('access-control-allow-origin') === disallowed) {
  throw new Error('CORS reflected an unauthorized origin');
}
console.log('PASS CORS does not reflect an unauthorized origin');
// Only probe an impossible route: compressed payload must fail before routing.
const compressedResponse = await fetch(base + path, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Encoding': 'gzip',
  },
  body: gzipSync(Buffer.from('{"syntheticProbeOnly":true}')),
  redirect: 'manual',
  signal: AbortSignal.timeout(110000),
});
if (compressedResponse.status !== 415) {
  throw new Error(`Compressed body must fail with HTTP 415, got ${compressedResponse.status}`);
}
console.log('PASS compressed JSON request body -> 415');

console.log('P3-F live negative matrix PASS — no business writes attempted');
