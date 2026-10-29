/**
 * ACM Stage4C DBA review artifact lint, not Prisma validation or a real DB test.
 * No network, database, secrets, or migrations. Node's native test runner.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const doc = readFileSync(new URL('../docs/stage4c-prisma-dba-design-20261029.md', import.meta.url),'utf8');
const sql = readFileSync(new URL('../docs/stage4c-ddl-constraints-review-only.sql.txt', import.meta.url),'utf8');
const must = (s,terms) => terms.forEach(t => assert.ok(s.includes(t),'missing: '+t));
test('DBR-01 non-executable SQL comments only',()=>{
  assert.deepEqual(sql.split(/\r?\n/).filter(x=>x.trim()&&!/^\s*--/.test(x)),[]);
});
test('DBR-02 explicit no migration or DBA approval',()=>{
  must(sql,['NEVER EXECUTE','NOT DBA APPROVED','NOT A PRISMA MIGRATION']);
  must(doc,['NO-GO','DBA REVIEW ONLY']);
});
test('DBR-03 actual UAT schema SHA evidence pinned',()=>{
  must(doc,['ab5bbdc7f6f1de397740fadb4d5522a59bbb9a819e23dfd658218cc144032fac','938479d53afa7f16b2923bbf9611b4480957c19ce24d835b84d19c59d5fc332a']);
});
test('DBR-04 all BIZ policy identifiers',()=>{
  for(const id of ['BIZ-01','BIZ-02','BIZ-03','BIZ-04','BIZ-05']) assert.ok(doc.includes(id),id);
});
test('DBR-05 strict ASCII evidence code and length proposal',()=>{
  must(sql,["^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$",'char_length(physical_evidence_ref) BETWEEN 1 AND 128','COLLATE "C"','physical_evidence_ref IS NOT NULL']);
});
test('DBR-06 case-insensitive canonical uniqueness scope not silently settled',()=>{
  must(sql,['physical_evidence_canonical','upper(physical_evidence_ref COLLATE "C")','PROPOSED GLOBAL','Alternative: UNIQUE']);
  must(doc,['scope','review']);
});
test('DBR-07 independent RECEIVE/VERIFY actor and timestamp',()=>{
  must(sql,['received_by_id','received_at','verified_by_id','verified_at','received_by_id <> verified_by_id']);
});
test('DBR-08 completed state depends on receipt, verifier and receipt ID',()=>{
  must(sql,["state <> 'COMPLETED'",'received_by_id IS NOT NULL','verified_by_id IS NOT NULL','return_transaction_id IS NOT NULL']);
});
test('DBR-09 exactly one unresolved operation index in proposal',()=>{
  assert.equal((sql.match(/CREATE UNIQUE INDEX borrow_return_operations_one_unresolved_per_borrow/g)||[]).length,1);
  must(sql,["WHERE state IN ('PREPARED','RECONCILIATION_REQUIRED')"]);
});
test('DBR-10 composite parent FK uses accurate mixed-case column',()=>{
  must(sql,['return_transactions(id,"borrowRequestId")','return_transaction_id, borrow_request_id']);
});
test('DBR-11 same-borrow returned line uses parent composite FK',()=>{
  must(sql,['borrow_details(id,"borrowRequestId")','borrow_detail_id,borrow_request_id','UNIQUE (operation_id,borrow_detail_id)']);
});
test('DBR-12 only GOOD/DAMAGED physically received, only GOOD QC released',()=>{
  must(sql,["condition IN ('GOOD','DAMAGED')","condition = 'GOOD'",'qc_released_by_id']);
  assert.ok(doc.includes('LOST'));
});
test('DBR-13 borrow/request-key scope and 365-day minimum',()=>{
  must(sql,['borrow_return_request_keys','UNIQUE (borrow_request_id,request_key)',"INTERVAL '365 days'"]);
});
test('DBR-14 permanent stock-effect uniqueness separate from retention',()=>{
  must(sql,['stock-effect UNIQUE','after key expiry']);
  must(doc,['BorrowReturnPosting','durable']);
});
test('DBR-15 cancel after physical receipt is a governance blocker',()=>{
  must(doc,['CRITICAL OPEN GOVERNANCE','CANCEL after physical RECEIVE','before COMMIT']);
});
test('DBR-16 no existing migration candidates executed together',()=>{
  must(doc,['MUST NOT run sequentially','2A','2B']);
});
test('DBR-17 explicit independent DBA and separate DB permission gates',()=>{
  must(doc,['#11','#12','#13','#21','#15','independent']);
});
test('DBR-18 Supabase Data API/RLS review, no writes',()=>{
  must(doc,['Data API','RLS','No action on Supabase authorized']);
});
