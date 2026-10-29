/** REVIEW ONLY — static contract acceptance and mutation checks.
 * No application imports, Prisma, SQL, filesystem writes, DB or network access.
 * Run: node --test scripts/stage4c-dba-target-contract.offline.test.mjs
 * Passing these tests means the design manifest is self-consistent, NOT that a
 * real migration, PostgreSQL constraints or Backend writer have been validated.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../docs/stage4c-dba-target-contract.review.json', import.meta.url), 'utf8'));
const requiredEntities = {
  evidence_registry: ['original_ascii','comparison_key','issuer_actor_id','purpose_type','owner_object_id','issued_at'],
  borrow_return_operations: ['borrow_request_id','physical_evidence_registry_id','received_by_id','received_at','verified_by_id','verified_at','cancel_requested_by_id','cancel_requested_at','cancel_reason','reconciliation_reason','return_transaction_id'],
  return_operation_lines: ['operation_id','borrow_detail_id','quantity','condition','qc_approved_by_id','qc_approved_at','stock_posting_id'],
  return_custody_resolutions: ['operation_id','resolution_kind','evidence_registry_id','approved_by_id','approved_at','custody_receiver_id'],
  return_operation_idempotency: ['borrow_request_id','request_key','payload_sha256','actor_id','first_seen_at','retained_until'],
  return_stock_postings: ['operation_id','borrow_detail_id','posting_kind','stock_movement_id'],
  return_loss_incidents: ['borrow_request_id','borrow_detail_id','reported_by_id'],
};
const requiredEnforcements = [
  'evidenceRegistryGlobalCanonicalUnique', 'evidenceRegistryAsciiFormatAndCanonicalEquality',
  'oneUnresolvedReturnOperationPerBorrowPartialUnique','operationReceiptSameBorrowCompositeFK',
  'receiverAndVerifierImmutableProvenance','receiverCannotSelfVerify',
  'qcApprovalsRequireCommittedGoodItems','custodyResolutionBeforeFinalCancelAfterReceive',
  'lossIsNeverPhysicalReceipt','scopedBorrowAndRequestKeyIdempotencyUnique',
  'permanentCommittedPostingDedup','operationStateAndTerminalFieldsCheck'
];
const requiredProofs = [
  'pg17_two_session_concurrent_evidence_issue',
  'pg17_two_session_concurrent_unresolved_operations',
  'pg17_composite_fk_rejects_other_borrow_receipt',
  'pg17_cancel_after_receive_keeps_custody_and_stock_constant',
  'pg17_refuse_unapproved_or_mismatched_custody_proof',
  'pg17_rollback_fault_injection_all_affected_tables',
  'pg17_retry_idempotency_and_posting_after_ttl',
  'pg17_backup_and_independent_restore',
  'real_api_rbac_idor_end_to_end_and_legacy_writer_compatibility'
];
function ensureContract(m) {
  assert.equal(m.executable, false, 'contract must not be executable');
  assert.equal(m.migrationApproved, false, 'migration permission must remain false');
  assert.equal(m.dataAccessApproved, false, 'DB permission must remain false');
  assert.equal(m.globalEvidence.scope, 'GLOBAL_ALL_ISSUERS', 'evidence must be globally unique, not per borrow');
  assert.equal(m.globalEvidence.regex, '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$');
  assert.equal(m.globalEvidence.key, 'ASCII_UPPERCASE');
  assert.equal(m.globalEvidence.validation, 'ASCII_ONLY_BEFORE_CASEFOLD');
  assert.equal(m.globalEvidence.keyUniqueness, 'GLOBAL_UNIQUE');
  assert.equal(m.globalEvidence.registry, 'evidence_registry');
  assert.equal(m.globalEvidence.reuseAfterCancellation, false);
  assert.equal(m.globalEvidence.crossBorrowCollisionDenied, true);
  assert.equal(m.globalEvidence.crossEntityTypeCollisionDenied, true);
  assert.equal(m.globalEvidence.issuerAuthRequired, true);
  assert.equal(m.globalEvidence.existingCodeScanBeforeMigration, true);
  assert.equal(m.custody.cancelAfterPhysicalReceive, 'RECONCILIATION_REQUIRED');
  assert.equal(m.custody.cancelBeforeReceive, 'CANCELLED');
  assert.equal(m.custody.cancellationRequiresReason, true);
  assert.equal(m.custody.preserveReceiverAndCustody, true);
  assert.deepEqual([...m.custody.resolutionKinds].sort(), ['APPROVED_DISPOSITION','REVERSE_HANDOVER']);
  assert.equal(m.custody.requireApprovedResolutionBeforeFinalCancelled, true);
  assert.equal(m.custody.requireImmutableEvidenceAndReviewer, true);
  assert.equal(m.custody.cancellationAvailableStockDelta, 0);
  assert.equal(m.custody.reconciliationReasonForPostReceiptCancel, 'POST_RECEIPT_CANCEL');
  assert.equal(m.custody.otherReconciliationReasonsAllowed, true, 'Do not redefine all reconciliation as physical custody');
  assert.equal(m.workflow.receiverCannotVerify, true);
  assert.equal(m.workflow.lostHandling, 'SEPARATE_INCIDENT');
  assert.deepEqual([...m.workflow.physicalReturnAllowedConditions].sort(), ['DAMAGED','GOOD']);
  assert.equal(m.workflow.physicalCommitStockDestination, 'QUARANTINE');
  assert.equal(m.workflow.qcGoodReleaseAfterCommitOnly, true);
  assert.equal(m.workflow.damagedNeverAutomaticallyAvailable, true);
  assert.deepEqual([...m.workflow.receiveRoles].sort(), ['ADMIN','LAB_MANAGER','TECHNICIAN']);
  assert.deepEqual([...m.workflow.verifyCommitQcCancelRoles].sort(), ['ADMIN','LAB_MANAGER']);
  for (const [entity, columns] of Object.entries(requiredEntities)) {
    assert.ok(Array.isArray(m.requiredEntities[entity]), 'Missing entity '+entity);
    for(const column of columns) assert.ok(m.requiredEntities[entity].includes(column), entity+' needs '+column);
  }
  for (const check of requiredEnforcements) assert.equal(m.requiredDatabaseEnforcement[check], true, check);
  assert.equal(m.requiredDatabaseEnforcement.newTimestampPrecision, 'TIMESTAMPTZ_3');
  assert.equal(m.transactionContract.isolation, 'SERIALIZABLE');
  for(const k of ['serverAuthenticatedActors','lockThenReloadPersistedState','legacyWriterSameLockOrder',
                  'durableReceiptAndStockDedupSurvivesIdempotencyTTL','rollbackOnAnyPostFailure','retryDoesNotDoublePost'])
    assert.equal(m.transactionContract[k], true, k);
  assert.deepEqual(m.idempotency.scope, ['borrow_request_id','request_key']);
  assert.ok(m.idempotency.minRetentionDays >= 365);
  assert.equal(m.idempotency.permanentCommittedPostingDedup, true);
  for (const t of requiredProofs) assert.ok(m.requiredProofs.includes(t), 'Missing evidence gate '+t);
  assert.equal(m.gates.ownerBusinessReview, 'APPROVED_REVIEW_ONLY');
  for(const g of ['formalIssuerRegexApproval','DBADesign','isolatedPG17Authorization','isolatedPG17Evidence','backendWriter','localFullstackGo','cloudGo'])
    assert.equal(m.gates[g], 'OPEN', 'must not invent GO: '+g);
}
const copy = () => structuredClone(manifest);
const mutate = (name,fn) => test(name,()=>{
  const bad=copy(); fn(bad);
  assert.throws(()=>ensureContract(bad),undefined,'mutation must be detected');
});

test('DBA-01 owner-approved design contract passes static invariants',()=>ensureContract(copy()));
mutate('DBA-02 refuses accidental migration permission',m=>m.migrationApproved=true);
mutate('DBA-03 refuses per-borrow evidence uniqueness',m=>m.globalEvidence.scope='PER_BORROW');
mutate('DBA-04 refuses ASCII/casefold policy weakening',m=>m.globalEvidence.key='RAW_CASE_SENSITIVE');
mutate('DBA-05 refuses reuse of globally-issued code after cancellation',m=>m.globalEvidence.reuseAfterCancellation=true);
mutate('DBA-06 refuses skipping cross-entity type uniqueness',m=>m.globalEvidence.crossEntityTypeCollisionDenied=false);
mutate('DBA-07 refuses immediate cancellation after physical receipt',m=>m.custody.cancelAfterPhysicalReceive='CANCELLED');
mutate('DBA-08 refuses any automatic available stock credit on cancellation',m=>m.custody.cancellationAvailableStockDelta=1);
mutate('DBA-09 refuses cancellation without independently approved custody disposition',m=>m.custody.requireApprovedResolutionBeforeFinalCancelled=false);
mutate('DBA-10 refuses treating all reconciliation causes as physical returns',m=>m.custody.otherReconciliationReasonsAllowed=false);
mutate('DBA-11 refuses missing receiver/verifier persistence fields',m=>{m.requiredEntities.borrow_return_operations=m.requiredEntities.borrow_return_operations.filter(x=>x!=='verified_by_id')});
mutate('DBA-12 refuses missing custody resolution provenance',m=>{m.requiredEntities.return_custody_resolutions=m.requiredEntities.return_custody_resolutions.filter(x=>x!=='approved_by_id')});
mutate('DBA-13 refuses omission of global canonical unique enforcement',m=>m.requiredDatabaseEnforcement.evidenceRegistryGlobalCanonicalUnique=false);
mutate('DBA-14 refuses omission of active-operation partial unique',m=>m.requiredDatabaseEnforcement.oneUnresolvedReturnOperationPerBorrowPartialUnique=false);
mutate('DBA-15 refuses loss masquerading as returned inventory',m=>m.workflow.lostHandling='PHYSICAL_RECEIPT');
mutate('DBA-16 refuses weak idempotency retention',m=>m.idempotency.minRetentionDays=364);
mutate('DBA-17 refuses non-atomic writer design',m=>m.transactionContract.isolation='READ_COMMITTED');
mutate('DBA-18 refuses missing PG17 concurrency acceptance proof',m=>{m.requiredProofs=m.requiredProofs.filter(x=>x!=='pg17_two_session_concurrent_evidence_issue')});
mutate('DBA-19 refuses claiming DBA GO without independent signoff',m=>m.gates.DBADesign='PASS');
mutate('DBA-20 refuses claiming LOCAL GO without real E2E',m=>m.gates.localFullstackGo='PASS');
