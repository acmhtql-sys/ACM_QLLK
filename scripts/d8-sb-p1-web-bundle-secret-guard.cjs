#!/usr/bin/env node
/**
 * ACM SB-P1: fail-closed scan of shipping web bundle.
 * No network, credentials, .env reading, subprocess, cloud or DB.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function scanText(source) {
  const findings = [];
  const checks = [
    ['POSTGRES_URL', /(?:postgres|postgresql):\/\/[^\s"'<>\\]+/i],
    ['SUPABASE_SECRET', /\bsb_secret_[A-Za-z0-9_-]{12,}/],
    ['PRIVILEGED_ENV_NAME', /\b(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|SHADOW_DATABASE_URL|DATABASE_URL|JWT_SECRET)\b/],
    ['SUPABASE_DATABASE_ENDPOINT', /\b(?:db\.[a-z0-9]{20}\.supabase\.co|aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com)\b/i],
  ];
  for (const [code, pattern] of checks) {
    if (pattern.test(source)) findings.push(code);
  }
  // Detect embedded legacy service_role JWTs, not generic user/anon JWTs.
  const candidate = /\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/g;
  for (const token of source.matchAll(candidate)) {
    try {
      const payload = JSON.parse(Buffer.from(token[0].split('.')[1], 'base64url').toString('utf8'));
      if (payload && (payload.role === 'service_role' || payload.role === 'supabase_admin')) {
        findings.push('PRIVILEGED_JWT');
        break;
      }
    } catch (_) { /* Not a parseable JWT, do not print any content. */ }
  }
  return [...new Set(findings)];
}

function scanBundle(distPath) {
  const folder = path.resolve(distPath);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw Error('MISSING_DIST_DIRECTORY');
  let totalFiles = 0, totalBytes = 0, sawCanary = false;
  const findings = new Set();
  const stack = [folder];
  while (stack.length) {
    const current = stack.pop();
    for (const ent of fs.readdirSync(current, {withFileTypes:true})) {
      const absolute = path.join(current, ent.name);
      if (ent.isSymbolicLink()) throw Error('BUNDLE_SYMLINK_NOT_ALLOWED');
      if (ent.isDirectory()) { stack.push(absolute); continue; }
      if (!ent.isFile()) throw Error('UNEXPECTED_BUNDLE_ENTRY');
      if (!/\.(?:js|mjs|css|html|map)$/i.test(ent.name)) continue;
      const size = fs.statSync(absolute).size;
      if (size > 32 * 1024 * 1024) throw Error('BUNDLE_FILE_TOO_LARGE');
      const text = fs.readFileSync(absolute, 'utf8');
      totalFiles++; totalBytes += size;
      if (text.includes('http://127.0.0.1:1/api/v1')) sawCanary = true;
      for (const finding of scanText(text)) findings.add(finding);
    }
  }
  if (totalFiles < 2 || totalBytes < 1000) throw Error('BUNDLE_NOT_BUILT');
  if (!sawCanary) throw Error('BUNDLE_API_CANARY_NOT_PRESENT');
  if (findings.size) throw Error('BUNDLE_FORBIDDEN_' + [...findings].sort().join('_'));
  return Object.freeze({fileCount:totalFiles, bytes:totalBytes, scannerMode:'NO_NETWORK'});
}

if (require.main === module) {
  try {
    const dist = path.join(__dirname,'..','apps','web','dist');
    const out=scanBundle(dist);
    console.log('PASS SBP1_WEB_BUNDLE_SECRET_GUARD_FILES='+out.fileCount);
    console.log('PASS SBP1_WEB_BUNDLE_UNREACHABLE_API_CANARY_NO_DB');
  } catch (err) {
    // Error codes are static; never expose bundle content, URL or environment values.
    console.error('STOP SBP1_WEB_BUNDLE_'+(err instanceof Error ? err.message : 'UNKNOWN'));
    process.exitCode=2;
  }
}
module.exports={scanText,scanBundle};
