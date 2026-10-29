'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkShape } = require('./d8-supabase-p1-url-guard.cjs');
const ref = 'dqctxaoaxhtqtgmtsysk';
const d = `postgresql://postgres:FAKE_PASSWORD_FOR_TESTS@db.${ref}.supabase.co:5432/postgres?schema=public&sslmode=verify-full`;
const s = `postgresql://postgres.${ref}:FAKE_PASSWORD_FOR_TESTS@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?schema=public&sslmode=verify-ca`;
const positives = [
  [d, 'direct'], [s, 'session_pooler'], [d+'&connection_limit=8','direct']
];
const negatives = [
  ['blank', ''],
  ['wrong project',d.replace(ref, 'aaaaaaaaaaaaaaaaaaaa')],
  ['wrong pooler account',s.replace(`postgres.${ref}`, 'postgres.aaaaaaaaaaaaaaaaaaaa')],
  ['transaction port',s.replace(':5432/',':6543/')],
  ['pooler wrong region',s.replace('ap-southeast-1','us-east-1')],
  ['SSL disabled',d.replace('verify-full','disable')],
  ['SSL require but not certificate verifying',d.replace('verify-full','require')],
  ['missing SSL mode',d.replace('&sslmode=verify-full','')],
  ['wrong database',d.replace('/postgres?','/acm_inventory?')],
  ['wrong schema',d.replace('schema=public','schema=auth')],
  ['extra query',d+'&unsafe=true'],
  ['transaction flag',d+'&pgbouncer=true'],
  ['duplicate TLS',d+'&sslmode=verify-ca'],
  ['password absent',d.replace(':FAKE_PASSWORD_FOR_TESTS@','@')],
  ['other protocol',d.replace('postgresql:','mysql:')],
  ['non-supabase host',d.replace(`db.${ref}.supabase.co`,'example.com')],
  ['hash fragment',d+'#password'],
  ['bad conn limit',d+'&connection_limit=0']
];
for (const [url, mode] of positives) test(`accept synthetic ${mode} shape`,()=> {
  const value=checkShape(url);
  assert.equal(value.mode,mode);assert.equal(value.verified,false);assert.equal(value.projectRef,ref);
});
for(const [name,url] of negatives) test(`reject ${name}`,()=>assert.throws(()=>checkShape(url),{name:'GuardError'}));
console.log('SBP1_TEST_VECTORS_TOTAL='+String(positives.length+negatives.length));
