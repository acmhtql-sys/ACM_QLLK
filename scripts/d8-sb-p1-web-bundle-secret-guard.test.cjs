'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {scanText} = require('./d8-sb-p1-web-bundle-secret-guard.cjs');
const projectRef='dqctxaoaxhtqtgmtsysk';
const mockJwt = (role) => {
  const encode = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  return [encode({alg:'HS256',typ:'JWT'}),encode({role,sub:'no-real-user'}),'fake-signature'].join('.');
};
const allow = [
  ['safe bundled UI code','const url="http://127.0.0.1:1/api/v1";'],
  ['publishable keys are not secret','const key="sb_publishable_SYNTHETIC_TEST_KEY_ONLY";'],
  ['user JWT should not be flagged as privileged', mockJwt('authenticated')],
];
const deny = [
  ['Supabase secret key','const s="sb_secret_TEST_ONLY_NOT_REAL_KEY_123456789";','SUPABASE_SECRET'],
  ['PostgreSQL connection URL','const u="postgresql://fake-user:fake-pwd@host.invalid:5432/postgres";','POSTGRES_URL'],
  ['DATABASE_URL reference','window.__config="DATABASE_URL";','PRIVILEGED_ENV_NAME'],
  ['SHADOW_DATABASE_URL reference','const s="SHADOW_DATABASE_URL";','PRIVILEGED_ENV_NAME'],
  ['JWT_SECRET reference','const s="JWT_SECRET";','PRIVILEGED_ENV_NAME'],
  ['service role name','const s="SUPABASE_SERVICE_ROLE_KEY";','PRIVILEGED_ENV_NAME'],
  ['Supabase direct DB hostname','const host="db.'+projectRef+'.supabase.co";','SUPABASE_DATABASE_ENDPOINT'],
  ['Supabase pooler hostname','const host="aws-0-ap-southeast-1.pooler.supabase.com";','SUPABASE_DATABASE_ENDPOINT'],
  ['privileged legacy JWT',mockJwt('service_role'),'PRIVILEGED_JWT'],
  ['privileged admin JWT',mockJwt('supabase_admin'),'PRIVILEGED_JWT'],
];
for (const [name,value] of allow) test('allow '+name,()=>assert.deepEqual(scanText(value),[]));
for (const [name,value,rule] of deny) test('deny '+name,()=>assert.ok(scanText(value).includes(rule)));
