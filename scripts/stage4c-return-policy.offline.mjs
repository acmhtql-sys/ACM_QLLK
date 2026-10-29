/**
 * Node.js 22.16+ offline-only test suite. Does not read environment variables,
 * connect to DB or import application services. Only a local TypeScript module.
 * Run from repository root:
 *   node --experimental-strip-types --test scripts/stage4c-return-policy.offline.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEvidenceCode, assertReturnActionAllowed,
  assertNoUnresolvedOperation, assertPhysicalReturnQuantities,
  classifyReceivedStock, compareReplay,
  assertIdempotencyRetentionDays, MIN_IDEMPOTENCY_RETENTION_DAYS,
} from '../apps/api/src/modules/borrow/borrow.return-policy.ts';

const reviewer = { id: 'manager-2', role: 'LAB_MANAGER' };
const receiver = { id: 'tech-1', role: 'TECHNICIAN' };
const admin = { id: 'admin-1', role: 'ADMIN' };
const student = { id: 'student-1', role: 'STUDENT' };
const prepared = { status: 'PREPARED', receiverId: null, verifierId: null, physicallyReceived: false, independentlyVerified: false };
const received = { ...prepared, receiverId: receiver.id, physicallyReceived: true };
const verified = { ...received, verifierId: reviewer.id, independentlyVerified: true };
const loan = [{ id: 'line-1', quantity: 10, returnedQuantity: 0 }];
const sha = 'a'.repeat(64);
const replay = { borrowRequestId: 'borrow-1', key: 'request-1', payloadSha256: sha, actorId: admin.id };

function rejectsCode(fn, code) {
  assert.throws(fn, (error) => error?.name === 'ReturnPolicyError' && error.code === code);
}

test('OFF-01 BIZ-01 validates ASCII, length, punctuation, no whitespace/Unicode', () => {
  assert.equal(normalizeEvidenceCode('A').comparisonKey, 'A');
  assert.equal(normalizeEvidenceCode('A'.repeat(128)).original.length, 128);
  assert.equal(normalizeEvidenceCode('ACM_01.a:/-9').comparisonKey, 'ACM_01.A:/-9');
  for (const bad of [null, '', '-ABC', '_ABC', ' X', 'X ', 'A\nB', 'A\n', 'A\r', 'A\u2028', 'A B', 'ĐƠN-1', 'A'.repeat(129), 1]) {
    rejectsCode(() => normalizeEvidenceCode(bad), 'INVALID_EVIDENCE');
  }
});
test('OFF-02 BIZ-01 case-insensitive collision key', () => {
  assert.equal(normalizeEvidenceCode('ACM-001').comparisonKey, normalizeEvidenceCode('acm-001').comparisonKey);
});
test('OFF-03 BIZ-04 TECHNICIAN/STUDENT cannot VERIFY, COMMIT, CANCEL, QC', () => {
  for (const action of ['VERIFY', 'COMMIT', 'CANCEL', 'QC_APPROVE']) {
    rejectsCode(() => assertReturnActionAllowed(action, receiver, verified, 'reason'), 'NOT_AUTHORIZED');
    rejectsCode(() => assertReturnActionAllowed(action, student, verified, 'reason'), 'NOT_AUTHORIZED');
  }
});
test('OFF-04 BIZ-02/04 no privileged self-verification', () => {
  const same = { ...received, receiverId: admin.id };
  rejectsCode(() => assertReturnActionAllowed('VERIFY', admin, same), 'SELF_VERIFICATION');
});
test('OFF-05 BIZ-02 independent verification required before COMMIT', () => {
  rejectsCode(() => assertReturnActionAllowed('COMMIT', admin, prepared), 'RECEIPT_REQUIRED');
  rejectsCode(() => assertReturnActionAllowed('COMMIT', admin, received), 'VERIFICATION_REQUIRED');
  rejectsCode(() => assertReturnActionAllowed('COMMIT', admin, { ...verified, verifierId: receiver.id }), 'SELF_VERIFICATION');
  assert.doesNotThrow(() => assertReturnActionAllowed('COMMIT', admin, verified));
});
test('OFF-06 BIZ-05 4+6 partial return accepted, overreturn rejected', () => {
  assert.doesNotThrow(() => assertPhysicalReturnQuantities(loan, [{ borrowDetailId: 'line-1', returnedQuantity: 4, condition: 'GOOD' }]));
  const after4 = [{ ...loan[0], returnedQuantity: 4 }];
  assert.doesNotThrow(() => assertPhysicalReturnQuantities(after4, [{ borrowDetailId: 'line-1', returnedQuantity: 6, condition: 'GOOD' }]));
  rejectsCode(() => assertPhysicalReturnQuantities(after4, [{ borrowDetailId: 'line-1', returnedQuantity: 7, condition: 'GOOD' }]), 'OVER_RETURN');
});
test('OFF-07 BIZ-05 authorized same-key same-payload is a REPLAY decision', () => {
  assert.equal(compareReplay(replay, { ...replay }), 'REPLAY');
});
test('OFF-08 BIZ-05 wrong payload/actor and other borrow scopes', () => {
  assert.equal(compareReplay(replay, { ...replay, payloadSha256: 'b'.repeat(64) }), 'CONFLICT');
  assert.equal(compareReplay(replay, { ...replay, actorId: 'other' }), 'FORBIDDEN');
  assert.equal(compareReplay(replay, { ...replay, borrowRequestId: 'borrow-2' }), 'DIFFERENT_SCOPE');
  rejectsCode(() => compareReplay(replay, { ...replay, payloadSha256: 'bad' }), 'INVALID_REPLAY');
});
test('OFF-09 BIZ-05 existing unresolved blocks a second operation', () => {
  rejectsCode(() => assertNoUnresolvedOperation(['PREPARED']), 'OPERATION_UNRESOLVED');
  rejectsCode(() => assertNoUnresolvedOperation(['RECONCILIATION_REQUIRED']), 'OPERATION_UNRESOLVED');
  assert.doesNotThrow(() => assertNoUnresolvedOperation(['COMPLETED', 'CANCELLED']));
});
test('OFF-10 BIZ-05 retention minimum 365, not a DB durability proof', () => {
  assert.equal(MIN_IDEMPOTENCY_RETENTION_DAYS, 365);
  assert.doesNotThrow(() => assertIdempotencyRetentionDays(365));
  assert.doesNotThrow(() => assertIdempotencyRetentionDays(730));
  for (const bad of [0, 364, 365.5, Number.NaN]) rejectsCode(() => assertIdempotencyRetentionDays(bad), 'INVALID_RETENTION');
});
test('OFF-11 BIZ-04 CANCEL only before commit and with reason', () => {
  rejectsCode(() => assertReturnActionAllowed('CANCEL', admin, prepared), 'CANCEL_REASON_REQUIRED');
  assert.doesNotThrow(() => assertReturnActionAllowed('CANCEL', admin, prepared, 'withdrawn before receipt'));
  rejectsCode(() => assertReturnActionAllowed('CANCEL', admin, { ...verified, status: 'COMPLETED' }, 'reason'), 'STATE_CONFLICT');
});
test('OFF-12 BIZ-03 quarantine GOOD/DAMAGED, lost is incident not receipt', () => {
  assert.equal(classifyReceivedStock('GOOD'), 'QUARANTINE');
  assert.equal(classifyReceivedStock('DAMAGED'), 'QUARANTINE');
  assert.equal(classifyReceivedStock('LOST'), 'LOSS_INCIDENT_ONLY');
  rejectsCode(() => assertPhysicalReturnQuantities(loan, [{ borrowDetailId: 'line-1', returnedQuantity: 1, condition: 'LOST' }]), 'LOSS_REQUIRES_INCIDENT');
});
test('OFF-13 BIZ-05 duplicate and malformed return lines are denied', () => {
  rejectsCode(() => assertPhysicalReturnQuantities(loan, []), 'INVALID_QUANTITY');
  rejectsCode(() => assertPhysicalReturnQuantities(loan, [{ borrowDetailId: 'line-1', returnedQuantity: 1.5, condition:'GOOD' }]), 'INVALID_QUANTITY');
  rejectsCode(() => assertPhysicalReturnQuantities(loan, [{ borrowDetailId: 'line-x', returnedQuantity: 1, condition:'GOOD' }]), 'UNRECOGNIZED_DETAIL');
  rejectsCode(() => assertPhysicalReturnQuantities(loan, [
    {borrowDetailId:'line-1', returnedQuantity:1, condition:'GOOD'},
    {borrowDetailId:'line-1', returnedQuantity:1, condition:'GOOD'}
  ]), 'DUPLICATE_DETAIL');
});
test('OFF-14 BIZ-04 QC release requires authorized role and committed receipt', () => {
  assert.doesNotThrow(() => assertReturnActionAllowed('QC_APPROVE', reviewer, { ...verified, status:'COMPLETED' }));
  rejectsCode(() => assertReturnActionAllowed('QC_APPROVE', reviewer, verified), 'STATE_CONFLICT');
  rejectsCode(() => assertReturnActionAllowed('QC_APPROVE', reviewer, { ...verified, status:'COMPLETED', verifierId:receiver.id }), 'STATE_CONFLICT');
  rejectsCode(() => assertReturnActionAllowed('QC_APPROVE', receiver, { ...verified, status:'COMPLETED' }), 'NOT_AUTHORIZED');
});
test('OFF-15 PREPARE/RECEIVE RBAC allowed roles, wrong state denied', () => {
  assert.doesNotThrow(() => assertReturnActionAllowed('PREPARE', receiver, prepared));
  assert.doesNotThrow(() => assertReturnActionAllowed('RECEIVE', receiver, prepared));
  rejectsCode(() => assertReturnActionAllowed('PREPARE', student, prepared), 'NOT_AUTHORIZED');
  rejectsCode(() => assertReturnActionAllowed('RECEIVE', receiver, { ...prepared, status:'CANCELLED' }), 'STATE_CONFLICT');
});
