// ACM Stage4C read-only static preflight. No database/network access or source mutation.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.argv[2];
if (!root) { console.error('USAGE: node stage4c-preflight.mjs <review-folder>'); process.exit(1); }
const load = (p) => readFileSync(join(root, p));
const txt = (p) => load(p).toString('utf8').replace(/^\uFEFF/, '');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const manifest = JSON.parse(txt('verified-metadata.json'));
if (manifest.format !== 'ACM_UAT_RECONCILE_METADATA_V2' || manifest.headCommit !== '0847a73088b98d8b00fb6ac06f02b2f56d288b78') {
  throw new Error('UNEXPECTED_SOURCE_MANIFEST');
}
if (!Array.isArray(manifest.files) || manifest.files.length !== 9) throw new Error('UNEXPECTED_FILE_COUNT');
for (const file of manifest.files) {
  if (typeof file.path !== 'string' || !/^apps\/api\/(prisma|src|tests)\//.test(file.path) || file.path.includes('..')) throw new Error('UNSAFE_SOURCE_PATH');
  const data = load(file.path);
  if (data.length !== file.lengthBytes || sha256(data) !== file.sha256) throw new Error('SOURCE_INTEGRITY_FAILED: ' + file.path);
}
const schema = txt('apps/api/prisma/schema.prisma');
const sql2A = txt('apps/api/prisma/Stage4C2A_MIGRATION_REVIEW_ONLY.sql.txt');
const sql2B = txt('apps/api/prisma/Stage4C2B_CONSTRAINTS_REVIEW_ONLY.sql.txt');
const router = txt('apps/api/src/modules/borrow/borrow.router.ts');
const foundation = txt('apps/api/src/modules/borrow/borrow.return-operation-foundation.ts');
const service = txt('apps/api/src/modules/borrow/borrow.service.ts');
const integration = txt('apps/api/tests/uat.phase11.ledger.integration.test.ts');
const checks = [
  ['schema_nonnullable_evidence', /physicalEvidenceRef\s+String\s+@map\("physical_evidence_ref"\)/.test(schema)],
  ['schema_composite_receipt_fk', schema.includes('fields: [returnTransactionId, borrowRequestId]') && schema.includes('references: [id, borrowRequestId]')],
  ['sql_2A_review_only', /DO NOT RUN/.test(sql2A)],
  ['sql_2B_review_only', /DO NOT EXECUTE/.test(sql2B)],
  ['operation_hard_gate', router.includes('rejectUnreleasedReturnOperations') && foundation.includes('API giao dịch hoàn trả liên thiết bị chưa được phát hành')],
  ['legacy_feature_gate', service.includes('assertLegacyReturnWriteAllowed') && foundation.includes('ACM_RETURN_OPERATIONS_ENABLED')],
  ['local_only_legacy_test', integration.includes('acm_inventory_test') && integration.includes('55432')],
];
const blockers = [
  ['2A_allows_null_evidence', /physical_evidence_ref\s+text\s+NULL/.test(sql2A)],
  ['2A_uses_single_column_receipt_fk', /return_transaction_id\s+uuid\s+NULL\s+UNIQUE\s+REFERENCES\s+public\.return_transactions\(id\)/.test(sql2A)],
  ['2A_2B_duplicate_partial_index', [sql2A, sql2B].every(t => t.includes('CREATE UNIQUE INDEX borrow_return_operations_one_unresolved_per_borrow'))],
  ['new_operation_writer_not_live', router.includes('rejectUnreleasedReturnOperations')],
];
const result = {
  gate: 'STAGE4C_STATIC_REVIEW_ONLY',
  sourceHashChecks: '9/9',
  sourceHead: manifest.headCommit,
  checks: checks.map(([name, passed]) => ({ name, status: passed ? 'PASS_STATIC' : 'FAIL_STATIC' })),
  blockers: blockers.filter(([name, present]) => present).map(([name]) => name),
  externalApprovals: 'NOT_VERIFIED',
  dbTests: 'NOT_RUN',
  migrationAuthorization: 'NO_GO',
  outcome: checks.every(([,ok]) => ok) && blockers.length > 0 ? 'STATIC_CHECKS_PASS_BUT_RELEASE_HOLD' : 'REVIEW_REQUIRED',
};
console.log(JSON.stringify(result, null, 2));
if (!checks.every(([,ok]) => ok)) process.exitCode = 1;
else process.exitCode = 0; // CLI succeeds only for static integrity; release status remains HOLD.
