/** Textual checks for an UNAPPROVED review document ONLY.
 * No SQL execution, no PostgreSQL parser, no Prisma, no DB access.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const document=readFileSync(new URL('../docs/stage4c-consolidated-forward-ddl-candidate-20261030.md',import.meta.url),'utf8');
const fence=String.fromCharCode(96).repeat(3);
const blocks=document.split(fence+'sql\n');
assert.equal(blocks.length,2,'exactly one proposed SQL block');
const sql=blocks[1].split(fence)[0];
const count=r=>[...sql.matchAll(r)].length;
const has=(...parts)=>{for(const p of parts)assert.ok(sql.includes(p),'Missing: '+p);};

test('DDL-01 unapproved prose proposal has seven CREATE TABLE statements',()=>{
  assert.match(document,/REVIEW ONLY \/ UNAPPROVED \/ DO NOT RUN/);
  assert.match(document,/DBA has not approved any of these statements/);
  assert.equal(count(/CREATE TABLE public\./g),7);
});
test('DDL-02 exactly one proposed table per Stage4C entity',()=>{
  for(const name of ['return_evidence_registry','borrow_return_operations','return_operation_lines','return_custody_resolutions','return_operation_idempotency','return_stock_postings','return_loss_incidents'])
    assert.equal(count(new RegExp('CREATE TABLE public\\.'+name+'\\s*\\(','g')),1,name);
});
test('DDL-03 canonical GLOBAL ASCII casefold uniqueness not per-borrow',()=>{
  has('comparison_key text GENERATED ALWAYS AS (upper(original_ascii COLLATE "C")) STORED',
    "original_ascii COLLATE \"C\" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'",
    'CONSTRAINT return_evidence_registry_unique_key UNIQUE (comparison_key)');
  assert.doesNotMatch(sql,/UNIQUE\s*\(\s*borrow_request_id\s*,\s*comparison_key\s*\)/i);
});
test('DDL-04 global evidence registry retains issued references',()=>{
  has('physical_evidence_registry_id uuid NOT NULL UNIQUE',
    'REFERENCES public.return_evidence_registry(id) ON DELETE RESTRICT');
});
test('DDL-05 single partial UNIQUE unresolved operation per borrow',()=>{
  assert.equal(count(/CREATE UNIQUE INDEX return_ops_one_unresolved_per_borrow/g),1);
  has("WHERE state IN ('PREPARED','RECONCILIATION_REQUIRED')");
});
test('DDL-06 same-borrow composite FKs prevent wrong receipt/detail associations',()=>{
  has('REFERENCES public.return_transactions(id, "borrowRequestId")',
    'REFERENCES public.borrow_details(id,"borrowRequestId")',
    'REFERENCES public.borrow_return_operations(id,borrow_request_id)');
});
test('DDL-07 RECEIVED / VERIFIED provenance is separate',()=>{
  has('received_by_id uuid','received_at timestamptz(3)',
    'verified_by_id uuid','verified_at timestamptz(3)',
    'return_ops_independent_verify_chk','return_ops_verified_pair_chk');
});
test('DDL-08 post-RECEIVE CANCEL keeps custody until separate resolution',()=>{
  has('return_ops_post_receive_cancel_chk','POST_RECEIPT_CANCEL',
    'received_at IS NOT NULL AND cancel_requested_at IS NOT NULL',
    'received_at IS NULL OR custody_resolution_id IS NOT NULL',
    'return_ops_own_custody_resolution_fk');
});
test('DDL-16 post-RECEIVE reconciliation can finalize with approved custody reference',()=>{
  const start=sql.indexOf('CONSTRAINT return_ops_post_receive_cancel_chk CHECK');
  const end=sql.indexOf('CONSTRAINT return_ops_id_borrow_unique',start);
  assert.ok(start>=0 && end>start);
  const rule=sql.slice(start,end);
  assert.match(rule,/state = 'RECONCILIATION_REQUIRED'/);
  assert.match(rule,/state = 'CANCELLED' AND custody_resolution_id IS NOT NULL/);
  assert.match(rule,/received_at IS NOT NULL AND cancel_requested_at IS NOT NULL/);
  assert.match(document,/preserving the original reconciliation reason/);
});
test('DDL-09 custody resolution must contain approved actor and evidence',()=>{
  has('CREATE TABLE public.return_custody_resolutions',
    'REVERSE_HANDOVER','APPROVED_DISPOSITION',
    'approved_by_id uuid NOT NULL','evidence_registry_id uuid NOT NULL UNIQUE');
});
test('DDL-10 physical lines allow GOOD/DAMAGED only, with QC pair',()=>{
  has("condition IN ('GOOD','DAMAGED')",
    'return_lines_qc_pair_chk','return_lines_good_only_qc_chk');
  assert.doesNotMatch(sql,/condition\s+text\s+NOT NULL\s+CHECK\s*\(condition\s+IN\s*\([^)]*LOST/i);
});
test('DDL-11 scoped durable replay and permanent stock posting dedup',()=>{
  has('return_op_idempotency_borrow_key_unique UNIQUE(borrow_request_id,request_key)',
    "payload_sha256 ~ '^[0-9a-f]{64}$'",
    "retained_until >= first_seen_at + INTERVAL '365 days'",
    'return_postings_dedup_unique UNIQUE(operation_id,borrow_detail_id,posting_kind)');
});
test('DDL-12 no destructive SQL, data writes or transaction execution',()=>{
  const noComments=sql.replace(/--[^\n]*/g,'');
  assert.doesNotMatch(noComments,/\b(DROP TABLE|DROP INDEX|TRUNCATE|DELETE FROM|INSERT INTO|CREATE EXTENSION|GRANT)\b/i);
  assert.doesNotMatch(noComments,/\b(BEGIN|COMMIT|ROLLBACK)\s*;/i);
});
test('DDL-13 candidly states DB checks and old stock ledger are unresolved',()=>{
  assert.match(document,/separate, carefully audited DB\/service checks/);
  assert.match(document,/StockMovement.*quantityDelta/s);
  assert.match(document,/no PostgreSQL parser/i);
});
test('DDL-14 mutation simulates weaker borrow-scoped uniqueness',()=>{
  const mutated=sql.replace('UNIQUE (comparison_key)','UNIQUE (borrow_request_id, comparison_key)');
  assert.ok(!mutated.includes('CONSTRAINT return_evidence_registry_unique_key UNIQUE (comparison_key)'));
});
test('DDL-15 mutation simulates omitted UNIQUE unresolved index',()=>{
  const mutated=sql.replace('CREATE UNIQUE INDEX return_ops_one_unresolved_per_borrow','CREATE INDEX return_ops_one_unresolved_per_borrow');
  assert.equal([...mutated.matchAll(/CREATE UNIQUE INDEX return_ops_one_unresolved_per_borrow/g)].length,0);
});
