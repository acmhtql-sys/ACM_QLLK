/**
 * ACM Stage4C — pure business-policy guards (BIZ-01..05).
 *
 * REVIEW ONLY: deliberately no database, HTTP, filesystem, or env access.
 * These functions do NOT authenticate a caller, generate trusted evidence,
 * establish atomic writes, or authorize enabling the new return API.
 * Trusted persisted state must be loaded and locked by a future DB adapter.
 */

export type ReturnStaffRole = 'ADMIN' | 'LAB_MANAGER' | 'TECHNICIAN' | 'STUDENT';
export type ReturnAction = 'PREPARE' | 'RECEIVE' | 'VERIFY' | 'COMMIT' | 'QC_APPROVE' | 'CANCEL';
export type ReturnCondition = 'GOOD' | 'DAMAGED' | 'LOST';
export type ReturnOperationState = 'PREPARED' | 'RECONCILIATION_REQUIRED' | 'COMPLETED' | 'CANCELLED';

export type ReturnPolicyErrorCode =
  | 'INVALID_EVIDENCE' | 'NOT_AUTHORIZED' | 'INVALID_ACTOR' | 'STATE_CONFLICT'
  | 'SELF_VERIFICATION' | 'RECEIPT_REQUIRED' | 'VERIFICATION_REQUIRED'
  | 'CANCEL_REASON_REQUIRED' | 'OPERATION_UNRESOLVED' | 'INVALID_QUANTITY'
  | 'UNRECOGNIZED_DETAIL' | 'DUPLICATE_DETAIL' | 'OVER_RETURN'
  | 'LOSS_REQUIRES_INCIDENT' | 'INVALID_REPLAY' | 'INVALID_RETENTION';

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
