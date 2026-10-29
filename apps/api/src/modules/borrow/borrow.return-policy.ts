/**
 * ACM Stage4C — pure business-policy guards (BIZ-01..05).
 *
 * REVIEW ONLY: deliberately no database, HTTP, filesystem, or env access.
 * These functions do NOT authenticate a caller, generate trusted evidence,
 * establish atomic writes, or authorize enabling the new return API.
 * Trusted persisted state must be loaded and locked by a future DB adapter.
 */

export type ReturnStaffRole = 'ADMIN' | 'LAB_MANAGER' | 'TECHNICIAN' | 'STUDENT';
export type ReturnAction = 'PREPARE' | 'RECEIVE' | 'VERIFY' | 'COMMIT' | 'QC_APPROVE' | 'CANCEL' | 'FINALIZE_CANCELLATION';
export type ReturnCondition = 'GOOD' | 'DAMAGED' | 'LOST';
export type ReturnOperationState = 'PREPARED' | 'RECONCILIATION_REQUIRED' | 'COMPLETED' | 'CANCELLED';

export type ReturnPolicyErrorCode =
  | 'INVALID_EVIDENCE' | 'NOT_AUTHORIZED' | 'INVALID_ACTOR' | 'STATE_CONFLICT'
  | 'SELF_VERIFICATION' | 'RECEIPT_REQUIRED' | 'VERIFICATION_REQUIRED'
  | 'CANCEL_REASON_REQUIRED' | 'OPERATION_UNRESOLVED' | 'INVALID_QUANTITY'
  | 'UNRECOGNIZED_DETAIL' | 'DUPLICATE_DETAIL' | 'OVER_RETURN'
  | 'LOSS_REQUIRES_INCIDENT' | 'INVALID_REPLAY' | 'INVALID_RETENTION'
  | 'EVIDENCE_CONFLICT' | 'INVALID_CUSTODY_PROOF';

export class ReturnPolicyError extends Error {
  public readonly code: ReturnPolicyErrorCode;
  constructor(code: ReturnPolicyErrorCode) {
    super('Stage4C policy denied: ' + code);
    this.code = code;
    this.name = 'ReturnPolicyError';
  }
}

function deny(code: ReturnPolicyErrorCode): never {
  throw new ReturnPolicyError(code);
}

const EVIDENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/** BIZ-01: uppercase only after ASCII validation; preserve original for display/audit. */
export function normalizeEvidenceCode(input: unknown): { original: string; comparisonKey: string } {
  if (typeof input !== 'string' || !EVIDENCE_PATTERN.test(input) || EVIDENCE_PATTERN.exec(input)?.[0] !== input) deny('INVALID_EVIDENCE');
  return { original: input, comparisonKey: input.toUpperCase() };
}

/** Owner decision 2026-10-29: comparison is GLOBAL, not scoped per borrow.
 * This is an offline guard only. The real writer MUST enforce a global DB
 * UNIQUE constraint on a canonical key within the same locked transaction.
 * A caller-provided list never establishes safe uniqueness.
 */
export function assertEvidenceGloballyUnused(
  proposed: unknown, persistedGlobalReferences: readonly string[],
): { original: string; comparisonKey: string } {
  const candidate = normalizeEvidenceCode(proposed);
  if (!Array.isArray(persistedGlobalReferences)) deny('INVALID_EVIDENCE');
  for (const existing of persistedGlobalReferences) {
    if (normalizeEvidenceCode(existing).comparisonKey === candidate.comparisonKey) deny('EVIDENCE_CONFLICT');
  }
  return candidate;
}

export interface ReturnActor { id: string; role: ReturnStaffRole }
export interface TrustedReturnState {
  status: ReturnOperationState;
  receiverId: string | null;
  verifierId: string | null;
  physicallyReceived: boolean;
  independentlyVerified: boolean;
  qualityApproved?: boolean;
}

const ROLE_PERMISSIONS: Readonly<Record<ReturnAction, ReadonlySet<ReturnStaffRole>>> = {
  PREPARE: new Set(['ADMIN', 'LAB_MANAGER', 'TECHNICIAN']),
  RECEIVE: new Set(['ADMIN', 'LAB_MANAGER', 'TECHNICIAN']),
  VERIFY: new Set(['ADMIN', 'LAB_MANAGER']),
  COMMIT: new Set(['ADMIN', 'LAB_MANAGER']),
  QC_APPROVE: new Set(['ADMIN', 'LAB_MANAGER']),
  CANCEL: new Set(['ADMIN', 'LAB_MANAGER']),
  FINALIZE_CANCELLATION: new Set(['ADMIN', 'LAB_MANAGER']),
};

/**
 * BIZ-02/04: checks only server-trusted actors & persisted state.
 * A calling service MUST authenticate, authorize scope and lock/load the state.
 */
export function assertReturnActionAllowed(
  action: ReturnAction,
  actor: ReturnActor,
  persisted: TrustedReturnState,
  cancelReason?: string,
): void {
  if (!actor || typeof actor.id !== 'string' || actor.id.trim() === '') deny('INVALID_ACTOR');
  if (!ROLE_PERMISSIONS[action]?.has(actor.role)) deny('NOT_AUTHORIZED');
  if (!persisted || !['PREPARED','RECONCILIATION_REQUIRED','COMPLETED','CANCELLED'].includes(persisted.status)) deny('STATE_CONFLICT');
  if (action === 'PREPARE') {
    if (persisted.status !== 'PREPARED') deny('STATE_CONFLICT');
    return;
  }
  if (action === 'QC_APPROVE') {
    if (persisted.status !== 'COMPLETED' || !persisted.physicallyReceived || !persisted.independentlyVerified || !persisted.receiverId || !persisted.verifierId || persisted.receiverId === persisted.verifierId) deny('STATE_CONFLICT');
    return;
  }
  if (action === 'FINALIZE_CANCELLATION') {
    if (persisted.status !== 'RECONCILIATION_REQUIRED' ||
        !persisted.physicallyReceived || !persisted.receiverId) deny('STATE_CONFLICT');
    return;
  }
  if (persisted.status !== 'PREPARED') deny('STATE_CONFLICT');
  if (action === 'CANCEL') {
    if (typeof cancelReason !== 'string' || cancelReason.trim().length === 0) deny('CANCEL_REASON_REQUIRED');
    return;
  }
  if (action === 'RECEIVE') return;
  if (!persisted.physicallyReceived || !persisted.receiverId) deny('RECEIPT_REQUIRED');
  if (action === 'VERIFY') {
    if (actor.id === persisted.receiverId) deny('SELF_VERIFICATION');
    if (persisted.independentlyVerified) deny('STATE_CONFLICT');
    return;
  }
  if (action === 'COMMIT') {
    if (!persisted.independentlyVerified || !persisted.verifierId) deny('VERIFICATION_REQUIRED');
    if (persisted.receiverId === persisted.verifierId) deny('SELF_VERIFICATION');
    return;
  }
  deny('STATE_CONFLICT');
}

/** BIZ-05: conservative guard; DB partial unique index is still mandatory. */
export function assertNoUnresolvedOperation(states: readonly ReturnOperationState[]): void {
  for (const state of states) {
    if (state === 'PREPARED' || state === 'RECONCILIATION_REQUIRED') deny('OPERATION_UNRESOLVED');
    if (state !== 'COMPLETED' && state !== 'CANCELLED') deny('STATE_CONFLICT');
  }
}

export interface BorrowedDetail { id: string; quantity: number; returnedQuantity: number }
export interface PhysicalReturnLine { borrowDetailId: string; returnedQuantity: number; condition: ReturnCondition }

/** BIZ-03/05: LOST is a separate incident, NEVER physical handover. */
export function assertPhysicalReturnQuantities(
  outstanding: readonly BorrowedDetail[],
  requestLines: readonly PhysicalReturnLine[],
): void {
  if (!Array.isArray(requestLines) || requestLines.length === 0 || !Array.isArray(outstanding)) deny('INVALID_QUANTITY');
  const expected = new Map<string, BorrowedDetail>();
  for (const detail of outstanding) {
    if (!detail || typeof detail.id !== 'string' || expected.has(detail.id) ||
        !Number.isSafeInteger(detail.quantity) || detail.quantity < 0 ||
        !Number.isSafeInteger(detail.returnedQuantity) || detail.returnedQuantity < 0 ||
        detail.returnedQuantity > detail.quantity) deny('INVALID_QUANTITY');
    expected.set(detail.id, detail);
  }
  const seen = new Set<string>();
  for (const line of requestLines) {
    if (!line || typeof line.borrowDetailId !== 'string') deny('UNRECOGNIZED_DETAIL');
    if (seen.has(line.borrowDetailId)) deny('DUPLICATE_DETAIL');
    seen.add(line.borrowDetailId);
    const detail = expected.get(line.borrowDetailId);
    if (!detail) deny('UNRECOGNIZED_DETAIL');
    if (!Number.isSafeInteger(line.returnedQuantity) || line.returnedQuantity <= 0) deny('INVALID_QUANTITY');
    if (line.condition === 'LOST') deny('LOSS_REQUIRES_INCIDENT');
    if (line.condition !== 'GOOD' && line.condition !== 'DAMAGED') deny('INVALID_QUANTITY');
    if (line.returnedQuantity > detail.quantity - detail.returnedQuantity) deny('OVER_RETURN');
  }
}

/** BIZ-03: physical receipt never immediately releases available stock. */
export function classifyReceivedStock(condition: ReturnCondition): 'QUARANTINE' | 'LOSS_INCIDENT_ONLY' {
  if (condition === 'GOOD' || condition === 'DAMAGED') return 'QUARANTINE';
  if (condition === 'LOST') return 'LOSS_INCIDENT_ONLY';
  deny('INVALID_QUANTITY');
}

export interface ReplayIdentity {
  borrowRequestId: string;
  key: string;
  payloadSha256: string;
  actorId: string;
}

/**
 * BIZ-05: two records from different borrow IDs have different key scopes.
 * This does not prove caller authorization, DB uniqueness, or durable replay.
 */
export function compareReplay(existing: ReplayIdentity, attempt: ReplayIdentity): 'REPLAY' | 'DIFFERENT_SCOPE' | 'CONFLICT' | 'FORBIDDEN' {
  for (const x of [existing, attempt]) {
    if (!x || typeof x.borrowRequestId !== 'string' || !x.borrowRequestId.trim() ||
        typeof x.key !== 'string' || !x.key.trim() ||
        typeof x.actorId !== 'string' || !x.actorId.trim() ||
        typeof x.payloadSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(x.payloadSha256)) deny('INVALID_REPLAY');
  }
  if (existing.borrowRequestId !== attempt.borrowRequestId || existing.key !== attempt.key) return 'DIFFERENT_SCOPE';
  if (existing.actorId !== attempt.actorId) return 'FORBIDDEN';
  return existing.payloadSha256.toLowerCase() === attempt.payloadSha256.toLowerCase() ? 'REPLAY' : 'CONFLICT';
}

export const MIN_IDEMPOTENCY_RETENTION_DAYS = 365;
export function assertIdempotencyRetentionDays(days: number): void {
  if (!Number.isSafeInteger(days) || days < MIN_IDEMPOTENCY_RETENTION_DAYS) deny('INVALID_RETENTION');
}

// Stage4C pure workflow transition planner.
// NO DATABASE: proposals do NOT persist receipts, inventory movement or audit.
// The real writer MUST authenticate caller, lock/load trusted data and recheck
// in the SAME approved Serializable transaction before posting anything.

export interface WorkflowLine {
  readonly borrowDetailId: string;
  readonly quantity: number;
  readonly condition: Exclude<ReturnCondition, 'LOST'>;
  readonly qualityReleased: boolean;
}
export type CustodyResolutionKind = 'REVERSE_HANDOVER' | 'APPROVED_DISPOSITION';
export interface CustodyRecord {
  readonly receivedById: string;
  readonly resolution?: { readonly kind: CustodyResolutionKind; readonly evidenceRef: string };
}
/** Trusted proof must be authenticated, scoped, locked and loaded by future DB adapter,
 * never accepted directly from HTTP; structurally valid proof is NOT a signature.
 */
export interface TrustedCustodyResolution {
  readonly kind: CustodyResolutionKind;
  readonly evidenceRef: string;
  readonly custodyReceiverId: string;
  readonly approvedById: string;
  readonly approved: true;
}
export interface ReturnWorkflowSnapshot extends TrustedReturnState {
  /** Proposed custody provenance; only the future DB writer can make it durable. */
  readonly custody?: CustodyRecord;
  /** Physically received goods; LOST is never represented as received. */
  readonly lines: readonly WorkflowLine[];
  readonly cancelReason?: string | null;
}
export type ReturnWorkflowCommand =
  | { readonly action: 'RECEIVE'; readonly actor: ReturnActor }
  | { readonly action: 'VERIFY'; readonly actor: ReturnActor }
  | { readonly action: 'COMMIT'; readonly actor: ReturnActor; readonly lockedBorrowDetails: readonly BorrowedDetail[] }
  | { readonly action: 'CANCEL'; readonly actor: ReturnActor; readonly reason: string }
  | { readonly action: 'FINALIZE_CANCELLATION'; readonly actor: ReturnActor; readonly trustedResolution: TrustedCustodyResolution }
  | { readonly action: 'QC_APPROVE'; readonly actor: ReturnActor; readonly borrowDetailIds: readonly string[] };

export interface ReturnWorkflowPlan {
  readonly next: ReturnWorkflowSnapshot;
  readonly actorId: string;
  readonly event: 'PHYSICAL_RECEIPT_CONFIRMED' | 'INDEPENDENTLY_VERIFIED' |
    'COMMIT_REQUESTED' | 'CANCEL_REQUESTED' | 'CUSTODY_RESOLUTION_APPROVED' | 'QUALITY_RELEASE_REQUESTED';
  /** For cancellation commands only: no automatic available-stock movement. */
  readonly cancellationAvailableStockDelta?: 0;
  /** Plan-only, NOT evidence that a transaction or audit entry was written. */
  readonly requiresAtomicDatabaseWrite: true;
}
function stateConflict(): never { throw new ReturnPolicyError('STATE_CONFLICT'); }
function invalidLine(): never { throw new ReturnPolicyError('INVALID_QUANTITY'); }

function assertCoherentSnapshot(s: ReturnWorkflowSnapshot): void {
  if (!s || !Array.isArray(s.lines) || s.lines.length === 0) invalidLine();
  const seen = new Set<string>();
  for (const l of s.lines) {
    if (!l || typeof l.borrowDetailId !== 'string' || !l.borrowDetailId.trim() ||
        seen.has(l.borrowDetailId) || !Number.isSafeInteger(l.quantity) || l.quantity <= 0 ||
        (l.condition !== 'GOOD' && l.condition !== 'DAMAGED') || typeof l.qualityReleased !== 'boolean') invalidLine();
    seen.add(l.borrowDetailId);
    if (l.qualityReleased && (l.condition !== 'GOOD' || s.status !== 'COMPLETED')) stateConflict();
  }
  if (typeof s.physicallyReceived !== 'boolean' || typeof s.independentlyVerified !== 'boolean') stateConflict();
  if (s.physicallyReceived !== (typeof s.receiverId === 'string' && s.receiverId.trim().length > 0)) stateConflict();
  if (s.independentlyVerified !== (typeof s.verifierId === 'string' && s.verifierId.trim().length > 0)) stateConflict();
  if (s.independentlyVerified && (!s.physicallyReceived || s.receiverId === s.verifierId)) stateConflict();
  if (s.physicallyReceived) {
    if (!s.custody || s.custody.receivedById !== s.receiverId) stateConflict();
  } else if (s.custody) stateConflict();
  if (s.status === 'RECONCILIATION_REQUIRED' &&
      (!s.physicallyReceived || !s.custody || s.custody.resolution)) stateConflict();
  if (s.status === 'CANCELLED' && s.physicallyReceived &&
      (!s.custody || !s.custody.resolution)) stateConflict();
  if (s.status === 'COMPLETED' && !s.independentlyVerified) stateConflict();
  if (s.status === 'CANCELLED' && s.lines.some(l => l.qualityReleased)) stateConflict();
}

/**
 * Generate a proposed transition from trusted persisted state and actor.
 * Never accept an actor, evidence or lockedBorrowDetails directly from HTTP.
 * This helper does not enforce DB uniqueness, retain idempotency records,
 * authenticate evidence provenance, or guarantee atomic commit.
 */
export function planReturnTransition(
  snapshot: ReturnWorkflowSnapshot,
  command: ReturnWorkflowCommand,
): ReturnWorkflowPlan {
  assertCoherentSnapshot(snapshot);
  if (!command || typeof command !== 'object') stateConflict();
  const reason = command.action === 'CANCEL' ? command.reason : undefined;
  assertReturnActionAllowed(command.action, command.actor, snapshot, reason);
  const common = { actorId: command.actor.id, requiresAtomicDatabaseWrite: true as const };
  switch (command.action) {
    case 'RECEIVE':
      // Prevent replacing the receiver's identity when one already confirmed.
      if (snapshot.physicallyReceived || snapshot.receiverId) stateConflict();
      return { ...common, event: 'PHYSICAL_RECEIPT_CONFIRMED', next: {
        ...snapshot, physicallyReceived: true, receiverId: command.actor.id,
        custody: { receivedById: command.actor.id },
      } };
    case 'VERIFY':
      if (snapshot.verifierId || snapshot.independentlyVerified) stateConflict();
      return { ...common, event: 'INDEPENDENTLY_VERIFIED', next: {
        ...snapshot, independentlyVerified: true, verifierId: command.actor.id,
      } };
    case 'COMMIT':
      // MUST be read under the same DB locks and within the same transaction
      // where the durable stock + receipt + Asset + audit posting will occur.
      assertPhysicalReturnQuantities(command.lockedBorrowDetails, snapshot.lines.map(l => ({
        borrowDetailId: l.borrowDetailId, returnedQuantity: l.quantity, condition: l.condition,
      })));
      // This changes only the *proposed* status. NO real DB write occurs.
      return { ...common, event: 'COMMIT_REQUESTED', next: {
        ...snapshot, status: 'COMPLETED',
      } };
    case 'CANCEL':
      // Owner-approved: physical custody requires reconciliation, not immediate cancellation.
      return { ...common, event: 'CANCEL_REQUESTED', cancellationAvailableStockDelta: 0, next: {
        ...snapshot,
        status: snapshot.physicallyReceived ? 'RECONCILIATION_REQUIRED' : 'CANCELLED',
        cancelReason: command.reason.trim(),
      } };
    case 'FINALIZE_CANCELLATION': {
      const proof = command.trustedResolution;
      if (!proof || proof.approved !== true ||
          (proof.kind !== 'REVERSE_HANDOVER' && proof.kind !== 'APPROVED_DISPOSITION') ||
          typeof proof.custodyReceiverId !== 'string' ||
          proof.custodyReceiverId !== snapshot.custody?.receivedById ||
          typeof proof.approvedById !== 'string' || !proof.approvedById.trim()) deny('INVALID_CUSTODY_PROOF');
      // Future DB adapter MUST load evidence, approval and actor from immutable trusted records.
      // Syntactic validation here cannot verify authenticity or legal disposition.
      try { normalizeEvidenceCode(proof.evidenceRef); }
      catch { deny('INVALID_CUSTODY_PROOF'); }
      return { ...common, event: 'CUSTODY_RESOLUTION_APPROVED',
        cancellationAvailableStockDelta: 0, next: {
          ...snapshot, status: 'CANCELLED',
          custody: { ...snapshot.custody!, resolution: {
            kind: proof.kind, evidenceRef: proof.evidenceRef,
          } },
        },
      };
    }
    case 'QC_APPROVE': {
      if (!Array.isArray(command.borrowDetailIds) || command.borrowDetailIds.length === 0) invalidLine();
      const approved = new Set<string>();
      const lines = snapshot.lines.map(l => ({ ...l }));
      for (const id of command.borrowDetailIds) {
        if (typeof id !== 'string' || approved.has(id)) invalidLine();
        approved.add(id);
        const line = lines.find(l => l.borrowDetailId === id);
        if (!line) invalidLine();
        if (line.condition !== 'GOOD' || line.qualityReleased) stateConflict();
        line.qualityReleased = true;
      }
      return { ...common, event: 'QUALITY_RELEASE_REQUESTED', next: {
        ...snapshot, lines,
      } };
    }
    default:
      return stateConflict();
  }
}
