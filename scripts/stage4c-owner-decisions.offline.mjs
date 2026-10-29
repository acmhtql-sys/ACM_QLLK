/** OWNER-01..11: approved business design, REVIEW ONLY.
 * Node 22.16+ --experimental-strip-types --test. No DB/Prisma/network/HTTP/env.
 * These tests exercise proposed transitions, NOT durable custody or uniqueness.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEvidenceCode, assertEvidenceGloballyUnused, assertNoUnresolvedOperation,
  planReturnTransition,
} from '../apps/api/src/modules/borrow/borrow.return-policy.ts';

const tech = { id: 'technician-1', role: 'TECHNICIAN' };
const admin = { id: 'admin-1', role: 'ADMIN' };
const manager = { id: 'manager-2', role: 'LAB_MANAGER' };
const student = { id: 'student-3', role: 'STUDENT' };
const initial = () => ({
  status: 'PREPARED', receiverId: null, verifierId: null,
  physicallyReceived: false, independentlyVerified: false,
  lines: [{ borrowDetailId: 'line-1', quantity: 2, condition: 'GOOD', qualityReleased: false }],
});
const receive = (s) => planReturnTransition(s, { action: 'RECEIVE', actor: tech }).next;
const cancel = (s, actor = admin) =>
  planReturnTransition(s, { action: 'CANCEL', actor, reason: ' borrower requested cancellation ' });
const proof = (kind = 'REVERSE_HANDOVER') => ({
  kind, evidenceRef: 'CUSTODY-2026-01', custodyReceiverId: tech.id,
  approvedById: manager.id, approved: true,
});
const finalize = (s, p = proof(), actor = admin) =>
  planReturnTransition(s, { action: 'FINALIZE_CANCELLATION', actor, trustedResolution: p });
const reject = (fn, code) => assert.throws(fn,
  err => err?.name === 'ReturnPolicyError' && err.code === code);

test('OWNER-01 globally casefolded evidence cannot be reused across borrows', () => {
  const existingFromDifferentBorrow = ['AcM-0001', 'BR-17'];
  reject(() => assertEvidenceGloballyUnused('acm-0001', existingFromDifferentBorrow), 'EVIDENCE_CONFLICT');
  assert.equal(assertEvidenceGloballyUnused('ACM-0002', existingFromDifferentBorrow).comparisonKey, 'ACM-0002');
  assert.equal(normalizeEvidenceCode('AcM-0001').comparisonKey, 'ACM-0001');
});
test('OWNER-02 invalid or pre-existing malformed evidence fails closed', () => {
  for (const invalid of ['', 'ĐƠN-1', 'bad evidence', 'x'.repeat(129), '-starting-dash', null]) {
    reject(() => assertEvidenceGloballyUnused(invalid, []), 'INVALID_EVIDENCE');
  }
  reject(() => assertEvidenceGloballyUnused('ACM-1', ['bad evidence']), 'INVALID_EVIDENCE');
  reject(() => assertEvidenceGloballyUnused('ACM-1', null), 'INVALID_EVIDENCE');
});
test('OWNER-03 cancellation before physical receipt is terminal without custody', () => {
  const p = cancel(initial());
  assert.equal(p.next.status, 'CANCELLED');
  assert.equal(p.next.custody, undefined);
  assert.equal(p.cancellationAvailableStockDelta, 0);
});
test('OWNER-04 after RECEIVE cancellation enters reconciliation retaining custody', () => {
  const physicallyReceived = receive(initial());
  const before = JSON.stringify(physicallyReceived);
  const p = cancel(physicallyReceived);
  assert.equal(p.next.status, 'RECONCILIATION_REQUIRED');
  assert.equal(p.next.receiverId, tech.id);
  assert.deepEqual(p.next.custody, { receivedById: tech.id });
  assert.equal(p.next.cancelReason, 'borrower requested cancellation');
  assert.equal(p.cancellationAvailableStockDelta, 0);
  assert.equal(JSON.stringify(physicallyReceived), before);
});
test('OWNER-05 unresolved custody blocks duplicate workflow or blind final cancel', () => {
  const s = cancel(receive(initial())).next;
  reject(() => assertNoUnresolvedOperation([s.status]), 'OPERATION_UNRESOLVED');
  reject(() => cancel(s), 'STATE_CONFLICT');
  reject(() => planReturnTransition(s, { action: 'VERIFY', actor: manager }), 'STATE_CONFLICT');
  reject(() => planReturnTransition(s, { action: 'RECEIVE', actor: admin }), 'STATE_CONFLICT');
  reject(() => planReturnTransition(s, { action: 'COMMIT', actor: admin, lockedBorrowDetails: [] }), 'STATE_CONFLICT');
});
test('OWNER-06 custody finalization requires authorized staff role', () => {
  const s = cancel(receive(initial())).next;
  reject(() => finalize(s, proof(), tech), 'NOT_AUTHORIZED');
  reject(() => finalize(s, proof(), student), 'NOT_AUTHORIZED');
});
test('OWNER-07 missing, denied, unscoped or malformed custody proof is rejected', () => {
  const s = cancel(receive(initial())).next;
  for (const bad of [
    null,
    { ...proof(), approved: false },
    { ...proof(), kind: 'AUTO_RELEASE' },
    { ...proof(), custodyReceiverId: 'someone-else' },
    { ...proof(), approvedById: '' },
    { ...proof(), evidenceRef: 'bad evidence' },
  ]) {
    reject(() => finalize(s, bad), 'INVALID_CUSTODY_PROOF');
  }
});
test('OWNER-08 verified reverse handover permits final cancellation, without stock credit', () => {
  const s = cancel(receive(initial())).next;
  const p = finalize(s);
  assert.equal(p.event, 'CUSTODY_RESOLUTION_APPROVED');
  assert.equal(p.next.status, 'CANCELLED');
  assert.equal(p.next.cancelReason, s.cancelReason);
  assert.equal(p.cancellationAvailableStockDelta, 0);
  assert.deepEqual(p.next.custody, {
    receivedById: tech.id,
    resolution: { kind: 'REVERSE_HANDOVER', evidenceRef: 'CUSTODY-2026-01' },
  });
});
test('OWNER-09 approved disposition permits final cancellation, without stock credit', () => {
  const s = cancel(receive(initial())).next;
  const p = finalize(s, proof('APPROVED_DISPOSITION'));
  assert.equal(p.next.status, 'CANCELLED');
  assert.equal(p.next.custody.resolution.kind, 'APPROVED_DISPOSITION');
  assert.equal(p.cancellationAvailableStockDelta, 0);
});
test('OWNER-10 no finalization without an unresolved physical custody record', () => {
  reject(() => finalize(initial()), 'STATE_CONFLICT');
  const cancelledBeforeReceipt = cancel(initial()).next;
  reject(() => finalize(cancelledBeforeReceipt), 'STATE_CONFLICT');
  const s = finalize(cancel(receive(initial())).next).next;
  reject(() => finalize(s), 'STATE_CONFLICT');
  reject(() => planReturnTransition(s, { action: 'QC_APPROVE', actor: manager, borrowDetailIds: ['line-1'] }), 'STATE_CONFLICT');
});
test('OWNER-11 cancellation proposals do not make persistent writes or change line quality', () => {
  const s = receive(initial());
  const snapshot = JSON.stringify(s);
  const proposal = cancel(s);
  assert.equal(proposal.requiresAtomicDatabaseWrite, true);
  assert.equal(proposal.cancellationAvailableStockDelta, 0);
  assert.equal(JSON.stringify(s), snapshot);
  assert.deepEqual(proposal.next.lines, s.lines);
  const end = finalize(proposal.next);
  assert.equal(end.requiresAtomicDatabaseWrite, true);
  assert.deepEqual(end.next.lines, s.lines);
});
