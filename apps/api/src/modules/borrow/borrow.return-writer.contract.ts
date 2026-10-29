/**
 * ACM Stage4C — transaction-bound writer ORCHESTRATION CONTRACT ONLY.
 * REVIEW ONLY. NOT a Prisma adapter or a live return route.
 * A future DBA-approved port must provide real SERIALIZABLE transactions,
 * durable globally unique evidence issuance, locked state, atomic stock,
 * idempotency, immutable audit and trusted custody resolution records.
 * No DB access, env, HTTP, filesystem or Prisma imports in this module.
 */
import { createHash } from 'node:crypto';
import {
  compareReplay, normalizeEvidenceCode, planReturnTransition,
  ReturnPolicyError,
} from './borrow.return-policy.ts';
import type {
  BorrowedDetail, ReturnActor, ReturnWorkflowCommand,
  ReturnWorkflowPlan, ReturnWorkflowSnapshot, ReturnOperationState,
  TrustedCustodyResolution,
} from './borrow.return-policy.ts';

export type WriterAction = ReturnWorkflowCommand['action'];
export type StockPostingKind = 'PHYSICAL_RETURN_TO_QUARANTINE' | 'QC_GOOD_RELEASE';

export interface StockPostingIntent {
  readonly dedupKey: string;
  readonly borrowDetailId: string;
  readonly kind: StockPostingKind;
  readonly borrowedDelta: number;
  readonly quarantinedDelta: number;
  readonly availableDelta: number;
}
export interface WriterResult {
  readonly borrowRequestId: string;
  readonly operationId: string;
  readonly state: ReturnOperationState;
  readonly event: ReturnWorkflowPlan['event'];
  readonly replayed: boolean;
}
export interface DurableReplayRow {
  readonly borrowRequestId: string;
  readonly operationId: string;
  readonly requestKey: string;
  readonly payloadSha256: string;
  readonly actorId: string;
  readonly result: Omit<WriterResult, 'replayed'>;
}
export interface AtomicReturnWrite {
  readonly borrowRequestId: string;
  readonly operationId: string;
  readonly actor: ReturnActor;
  readonly requestKey: string;
  readonly payloadSha256: string;
  readonly before: ReturnWorkflowSnapshot;
  readonly plan: ReturnWorkflowPlan;
  readonly postings: readonly StockPostingIntent[];
  readonly auditEvent: ReturnWorkflowPlan['event'];
  readonly idempotencyRetentionDays: 365;
}

/** DBA implementation must lock all affected rows, enforce unique keys in DB,
 * and roll back the ENTIRE operation (including replay row, audit and postings).
 * No external callbacks or HTTP-sourced trusted state are accepted.
 */
export interface Stage4CTransactionPort {
  /** Trusted session actor and borrow-object access checked server-side. */
  authenticateBorrowScope(principalId: string, borrowRequestId: string): Promise<ReturnActor | null>;
  /** Fixed lock order shared with legacy writer; serialize borrow scope first. */
  lockBorrowRequest(borrowRequestId: string): Promise<void>;
  findReplayForUpdate(borrowRequestId: string, requestKey: string): Promise<DurableReplayRow | null>;
  loadOperationForUpdate(borrowRequestId: string, operationId: string): Promise<ReturnWorkflowSnapshot | null>;
  /** Only used for COMMIT; must read under same transaction and locks. */
  loadBorrowDetailsForUpdate(borrowRequestId: string): Promise<readonly BorrowedDetail[]>;
  /** Must validate trusted immutable evidence and approver, NOT HTTP claims. */
  loadApprovedCustodyResolutionForUpdate(
    borrowRequestId: string, operationId: string, resolutionId: string,
  ): Promise<TrustedCustodyResolution | null>;
  /** Durable write of every element or none, with all uniqueness rules enforced. */
  persistAtomically(write: AtomicReturnWrite): Promise<Omit<WriterResult, 'replayed'>>;
}
export interface Stage4CWriterPort {
  serializable<T>(work: (tx: Stage4CTransactionPort) => Promise<T>): Promise<T>;
}

export type WriterInput =
  | { readonly action: 'RECEIVE' | 'VERIFY' | 'COMMIT'; readonly borrowRequestId: string; readonly operationId: string; readonly requestKey: string }
  | { readonly action: 'CANCEL'; readonly borrowRequestId: string; readonly operationId: string; readonly requestKey: string; readonly reason: string }
  | { readonly action: 'QC_APPROVE'; readonly borrowRequestId: string; readonly operationId: string; readonly requestKey: string; readonly borrowDetailIds: readonly string[] }
  | { readonly action: 'FINALIZE_CANCELLATION'; readonly borrowRequestId: string; readonly operationId: string; readonly requestKey: string; readonly custodyResolutionId: string };

export class ReturnWriterContractError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'REPLAY_CONFLICT' | 'WRITE_CONTRACT_BREACH') {
    super('Stage4C writer denied: ' + code);
    this.name = 'ReturnWriterContractError';
  }
}
function fail(code: ReturnWriterContractError['code']): never { throw new ReturnWriterContractError(code); }
const textId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(v);
function safeAction(raw: unknown): WriterInput {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('INVALID_INPUT');
  const obj = raw as Record<string, unknown>;
  const a = obj.action;
  const baseKeys = ['action','borrowRequestId','operationId','requestKey'];
  if (!textId(obj.borrowRequestId) || !textId(obj.operationId) || !textId(obj.requestKey)) fail('INVALID_INPUT');
  let extended: readonly string[] = [];
  switch (a) {
    case 'RECEIVE':
    case 'VERIFY':
    case 'COMMIT':
      break;
    case 'CANCEL':
      if (typeof obj.reason !== 'string' || obj.reason.trim().length < 1 || obj.reason.trim().length > 512) fail('INVALID_INPUT');
      extended = ['reason']; break;
    case 'QC_APPROVE':
      if (!Array.isArray(obj.borrowDetailIds) || obj.borrowDetailIds.length < 1 || obj.borrowDetailIds.length > 100 ||
          obj.borrowDetailIds.some(x => !textId(x)) ||
          new Set(obj.borrowDetailIds).size !== obj.borrowDetailIds.length) fail('INVALID_INPUT');
      extended = ['borrowDetailIds']; break;
    case 'FINALIZE_CANCELLATION':
      if (!textId(obj.custodyResolutionId)) fail('INVALID_INPUT');
      extended = ['custodyResolutionId']; break;
    default: fail('INVALID_INPUT');
  }
  const permitted = new Set([...baseKeys, ...extended]);
  if (Object.keys(obj).some(k => !permitted.has(k))) fail('INVALID_INPUT');
  if (a === 'CANCEL') return {
    action: a, borrowRequestId: obj.borrowRequestId as string,
    operationId: obj.operationId as string, requestKey: obj.requestKey as string,
    reason: (obj.reason as string).trim(),
  };
  if (a === 'QC_APPROVE') return {
    action: a, borrowRequestId: obj.borrowRequestId as string,
    operationId: obj.operationId as string, requestKey: obj.requestKey as string,
    borrowDetailIds: [...obj.borrowDetailIds as string[]],
  };
  if (a === 'FINALIZE_CANCELLATION') return {
    action: a, borrowRequestId: obj.borrowRequestId as string,
    operationId: obj.operationId as string, requestKey: obj.requestKey as string,
    custodyResolutionId: obj.custodyResolutionId as string,
  };
  return {
    action: a as 'RECEIVE' | 'VERIFY' | 'COMMIT',
    borrowRequestId: obj.borrowRequestId as string, operationId: obj.operationId as string,
    requestKey: obj.requestKey as string,
  };
}
function requestHash(input: WriterInput): string {
  // Stable explicit tuple: property insertion order / unknown HTTP properties
  // never change what is hashed. No trusted actor or DB state comes from HTTP.
  const aux = input.action === 'CANCEL' ? input.reason
    : input.action === 'QC_APPROVE' ? input.borrowDetailIds
    : input.action === 'FINALIZE_CANCELLATION' ? input.custodyResolutionId : null;
  return createHash('sha256').update(JSON.stringify([
    'acm-stage4c-v1', input.borrowRequestId, input.operationId, input.action, aux,
  ])).digest('hex');
}
function postingsFor(input: WriterInput, before: ReturnWorkflowSnapshot, plan: ReturnWorkflowPlan): readonly StockPostingIntent[] {
  const postings: StockPostingIntent[] = [];
  if (input.action === 'COMMIT') {
    for (const line of before.lines) {
      postings.push({
        dedupKey: input.operationId + ':' + line.borrowDetailId + ':RETURN',
        borrowDetailId: line.borrowDetailId, kind: 'PHYSICAL_RETURN_TO_QUARANTINE',
        borrowedDelta: -line.quantity, quarantinedDelta: line.quantity, availableDelta: 0,
      });
    }
  }
  if (input.action === 'QC_APPROVE') {
    for (const id of input.borrowDetailIds) {
      const line = before.lines.find(l => l.borrowDetailId === id);
      if (!line || line.condition !== 'GOOD' || line.qualityReleased) fail('WRITE_CONTRACT_BREACH');
      postings.push({
        dedupKey: input.operationId + ':' + id + ':QC_GOOD_RELEASE',
        borrowDetailId: id, kind: 'QC_GOOD_RELEASE',
        borrowedDelta: 0, quarantinedDelta: -line.quantity, availableDelta: line.quantity,
      });
    }
  }
  if (input.action === 'CANCEL' || input.action === 'FINALIZE_CANCELLATION') {
    if (postings.length || plan.cancellationAvailableStockDelta !== 0) fail('WRITE_CONTRACT_BREACH');
  }
  return postings;
}

/** Transaction orchestrator. NO adapter is instantiated or route registered here.
 * The trusted principal ID is created by server authentication middleware;
 * it MUST NOT be accepted directly from the HTTP body.
 */
export async function executeStage4CWriter(
  port: Stage4CWriterPort, serverPrincipalId: string, rawInput: unknown,
): Promise<WriterResult> {
  if (!textId(serverPrincipalId)) fail('FORBIDDEN');
  const input = safeAction(rawInput);
  const hash = requestHash(input);
  return port.serializable(async tx => {
    const actor = await tx.authenticateBorrowScope(serverPrincipalId, input.borrowRequestId);
    if (!actor || actor.id !== serverPrincipalId) fail('FORBIDDEN');
    await tx.lockBorrowRequest(input.borrowRequestId);
    const replay = await tx.findReplayForUpdate(input.borrowRequestId, input.requestKey);
    if (replay) {
      if (replay.borrowRequestId !== input.borrowRequestId || replay.requestKey !== input.requestKey ||
          replay.operationId !== input.operationId || !replay.result ||
          replay.result.borrowRequestId !== input.borrowRequestId || replay.result.operationId !== input.operationId) fail('REPLAY_CONFLICT');
      const decision = compareReplay({
        borrowRequestId: replay.borrowRequestId, key: replay.requestKey,
        payloadSha256: replay.payloadSha256, actorId: replay.actorId,
      }, { borrowRequestId: input.borrowRequestId, key: input.requestKey,
        payloadSha256: hash, actorId: actor.id });
      if (decision === 'FORBIDDEN') fail('FORBIDDEN');
      if (decision !== 'REPLAY') fail('REPLAY_CONFLICT');
      return { ...replay.result, replayed: true };
    }
    const before = await tx.loadOperationForUpdate(input.borrowRequestId, input.operationId);
    if (!before) fail('NOT_FOUND');
    let command: ReturnWorkflowCommand;
    switch (input.action) {
      case 'COMMIT':
        command = { action: input.action, actor,
          lockedBorrowDetails: await tx.loadBorrowDetailsForUpdate(input.borrowRequestId) };
        break;
      case 'FINALIZE_CANCELLATION': {
        const resolution = await tx.loadApprovedCustodyResolutionForUpdate(
          input.borrowRequestId, input.operationId, input.custodyResolutionId,
        );
        if (!resolution) throw new ReturnPolicyError('INVALID_CUSTODY_PROOF');
        // This only checks the STRUCTURE of a record the DB adapter promises is authentic.
        normalizeEvidenceCode(resolution.evidenceRef);
        command = { action: input.action, actor, trustedResolution: resolution };
        break;
      }
      case 'CANCEL': command = { action: input.action, actor, reason: input.reason }; break;
      case 'QC_APPROVE': command = { action: input.action, actor, borrowDetailIds: input.borrowDetailIds }; break;
      default: command = { action: input.action, actor };
    }
    const plan = planReturnTransition(before, command);
    const postings = postingsFor(input, before, plan);
    const result = await tx.persistAtomically({
      borrowRequestId: input.borrowRequestId,
      operationId: input.operationId, actor, requestKey: input.requestKey,
      payloadSha256: hash, before, plan, postings,
      auditEvent: plan.event, idempotencyRetentionDays: 365,
    });
    if (!result || result.borrowRequestId !== input.borrowRequestId ||
        result.operationId !== input.operationId ||
        result.state !== plan.next.status || result.event !== plan.event) fail('WRITE_CONTRACT_BREACH');
    return { ...result, replayed: false };
  });
}
