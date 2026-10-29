#!/usr/bin/env node
/**
 * ACM SB-P1: offline PostgreSQL endpoint-shape policy. This is NOT a
 * connectivity, TLS-certificate, permission or database identity test.
 * No network, filesystem I/O, child processes or secret output.
 */
'use strict';

const PROJECT_REF = 'dqctxaoaxhtqtgmtsysk';
const DIRECT_HOST = `db.${PROJECT_REF}.supabase.co`;
const SHARED_POOLER_HOST = /^aws-[0-9]+-ap-southeast-1\.pooler\.supabase\.com$/;
const ALLOWED_PARAMS = new Set(['sslmode', 'schema', 'connection_limit']);

class GuardError extends Error {
  constructor(code) { super(code); this.name = 'GuardError'; this.code = code; }
}
function stop(code) { throw new GuardError(code); }
function checkShape(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 8192) stop('URL_NOT_PROVIDED_OR_TOO_LONG');
  let uri;
  try { uri = new URL(value); } catch { stop('INVALID_URL'); }
  if (uri.protocol !== 'postgresql:' && uri.protocol !== 'postgres:') stop('PROTOCOL_NOT_POSTGRESQL');
  if (uri.hash || !uri.username || !uri.password) stop('MISSING_CREDENTIAL_FIELDS_OR_FRAGMENT');
  // Passwords must not be logged. Validation uses only non-secret URI fields.
  if (uri.pathname !== '/postgres') stop('NON_STAGING_DATABASE_NAME');
  if (uri.searchParams.has('pgbouncer')) stop('TRANSACTION_POOLER_PARAMETER_DISALLOWED');
  for (const [key] of uri.searchParams) if (!ALLOWED_PARAMS.has(key)) stop('UNREVIEWED_QUERY_PARAMETER');
  for (const key of ALLOWED_PARAMS) if (uri.searchParams.getAll(key).length > 1) stop('DUPLICATE_QUERY_PARAMETER');
  if (uri.searchParams.get('schema') !== 'public') stop('SCHEMA_NOT_PINNED_PUBLIC');
  if (!['verify-full','verify-ca'].includes(uri.searchParams.get('sslmode'))) stop('TLS_CERTIFICATE_VERIFICATION_NOT_REQUIRED');
  if (uri.searchParams.has('connection_limit')) {
    const limit = uri.searchParams.get('connection_limit');
    if (!/^[1-9][0-9]?$/.test(limit)) stop('CONNECTION_LIMIT_INVALID');
  }
  if (uri.hostname === DIRECT_HOST && uri.port === '5432' && decodeURIComponent(uri.username) === 'postgres') {
    return Object.freeze({mode:'direct',projectRef:PROJECT_REF,port:5432,verified:false});
  }
  if (SHARED_POOLER_HOST.test(uri.hostname) && uri.port === '5432' && decodeURIComponent(uri.username) === `postgres.${PROJECT_REF}`) {
    return Object.freeze({mode:'session_pooler',projectRef:PROJECT_REF,port:5432,verified:false});
  }
  if (uri.port === '6543') stop('TRANSACTION_POOLER_NOT_APPROVED');
  stop('PROJECT_HOST_USER_OR_PORT_MISMATCH');
}

if (require.main === module) {
  try {
    const result = checkShape(process.env.ACM_SUPABASE_CANDIDATE_DB_URL);
    console.log('PASS SBP1_OFFLINE_SHAPE_ONLY_NO_CLOUD_CONNECTION');
    console.log(`PASS SBP1_MODE_${result.mode.toUpperCase()}_APPROVED_FOR_REVIEW_ONLY`);
    console.log('NOTICE SBP1_NO_TLS_OR_SERVER_IDENTITY_VERIFIED');
    console.log('NOTICE SBP1_DO_NOT_USE_FOR_PRISMA_MIGRATE_OR_PRODUCTION');
  } catch (err) {
    // Never print err.message from URL parsing or any input/secret.
    console.error(`STOP SBP1_${err instanceof GuardError ? err.code : 'UNEXPECTED_ERROR'}`);
    process.exitCode = 2;
  }
}
module.exports = { checkShape, GuardError };
