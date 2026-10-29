/**
 * ACM Stage4C: prepare / global evidence issuance transaction PORT.
 * REVIEW ONLY. No Prisma, DB driver, HTTP router, network, env or file I/O.
 * The adapter MUST implement globally unique canonical evidence issuance,
 * scope auth, BORROW locks, and durable idempotency in one SERIALIZABLE TX.
 * This module's validations do NOT substitute for DB uniqueness.
 */
import { createHash } from 'node:crypto';
import {
  assertNoUnresolvedOperation, assertPhysicalReturnQuantities,
  assertReturnActionAllowed, compareReplay, normalizeEvidenceCode,
} from './borrow.return-policy.ts';
import type {
  BorrowedDetail, PhysicalReturnLine, ReturnActor, ReturnOperationState,
} from './borrow.return-policy.ts';

export interface PreparedReturnResult {
  readonly borrowRequestId: string;
  readonly operationId: string;
  readonly evidenceComparisonKey: string;
  readonly state: 'PREPARED';
  readonly replayed: boolean;
}
export interface PrepareReplay {
  readonly borrowRequestId: string;
  readonly requestKey: string;
  readonly actorId: string;
  readonly payloadSha256: string;
  readonly originalResult: Omit<PreparedReturnResult, 'replayed'>;
}
export interface AtomicPrepareIntent {
  readonly borrowRequestId: string;
  readonly requestKey: string;
  readonly actor: ReturnActor;
  readonly originalEvidenceRef: string;
  readonly evidenceComparisonKey: string;
  readonly physicalLines: readonly PhysicalReturnLine[];
  readonly payloadSha256: string;
  readonly idempotencyRetentionDays: 365;
  readonly auditEvent: 'RETURN_PREPARED';
}
export interface PrepareTransactionPort {
  /** Must check actor, roles, borrower visibility server-side, not just client ID. */
  authenticateBorrowScope(principalId: string, borrowRequestId: string): Promise<ReturnActor | null>;
  /** Lock borrow scope BEFORE replay and state reads; use same lock order as POST/legacy writer. */
  lockBorrowRequest(borrowRequestId: string): Promise<void>;
  /** Scope must include every action's replay key for this borrow, not PREPARE alone. */
  findReplayForUpdate(borrowRequestId: string, requestKey: string): Promise<PrepareReplay | null>;
  /** Includes both PREPARED and RECONCILIATION_REQUIRED. */
  loadOperationStatesForUpdate(borrowRequestId: string): Promise<readonly ReturnOperationState[]>;
  loadBorrowDetailsForUpdate(borrowRequestId: string): Promise<readonly BorrowedDetail[]>;
  /**
   * Must atomically INSERT:
   *  - immutable GLOBAL evidence registry row with DB UNIQUE(canonical_key),
   *  - borrow_return_operation + positive GOOD/DAMAGED detail lines,
   *  - durable (borrowId,requestKey) replay fingerprint, and audit event.
   * Any failure must ROLLBACK ALL inserts; never use read-then-insert evidence
   * uniqueness, since distinct borrows do not share a borrow-scope lock.
   * The DB UNIQUE violation must be mapped to deterministic EVIDENCE_CONFLICT.
   */
  persistPrepareAtomically(intent: AtomicPrepareIntent): Promise<Omit<PreparedReturnResult, 'replayed'>>;
}
export interface PrepareWriterPort {
  serializable<T>(fn: (tx: PrepareTransactionPort) => Promise<T>): Promise<T>;
}
export class PrepareContractError extends Error {
  readonly code: 'INVALID_INPUT' | 'FORBIDDEN' | 'REPLAY_CONFLICT' | 'BAD_ADAPTER_RESULT';
  constructor(code: 'INVALID_INPUT' | 'FORBIDDEN' | 'REPLAY_CONFLICT' | 'BAD_ADAPTER_RESULT') {
    super('Stage4C PREPARE rejected: ' + code);
    this.name = 'PrepareContractError';
    this.code = code;
  }
}
function fail(code: PrepareContractError['code']): never { throw new PrepareContractError(code); }
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const validId = (v: unknown): v is string => typeof v === 'string' && idPattern.test(v);

interface CleanPrepare {
  readonly borrowRequestId: string;
  readonly requestKey: string;
  readonly physicalEvidenceRef: string;
  readonly lines: readonly PhysicalReturnLine[];
}
function cleanInput(raw: unknown): CleanPrepare {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('INVALID_INPUT');
  const d = raw as Record<string, unknown>;
  if (Object.keys(d).some(k => !['borrowRequestId','requestKey','physicalEvidenceRef','lines'].includes(k))) fail('INVALID_INPUT');
  if (!validId(d.borrowRequestId) || !validId(d.requestKey)) fail('INVALID_INPUT');
  const ref = normalizeEvidenceCode(d.physicalEvidenceRef);
  if (!Array.isArray(d.lines) || d.lines.length < 1 || d.lines.length > 100) fail('INVALID_INPUT');
  const lines: PhysicalReturnLine[] = [];
  const unique = new Set<string>();
  for (const rawLine of d.lines) {
    if (!rawLine || typeof rawLine !== 'object' || Array.isArray(rawLine)) fail('INVALID_INPUT');
    const l = rawLine as Record<string, unknown>;
    if (Object.keys(l).some(k => !['borrowDetailId','returnedQuantity','condition'].includes(k)) ||
        !validId(l.borrowDetailId) ||
        !Number.isSafeInteger(l.returnedQuantity) || (l.returnedQuantity as number) <= 0 ||
        (l.condition !== 'GOOD' && l.condition !== 'DAMAGED') || unique.has(l.borrowDetailId)) fail('INVALID_INPUT');
    unique.add(l.borrowDetailId);
    lines.push({ borrowDetailId:l.borrowDetailId, returnedQuantity:l.returnedQuantity as number, condition:l.condition });
  }
  return { borrowRequestId:d.borrowRequestId, requestKey:d.requestKey,
    physicalEvidenceRef:ref.original, lines };
}
function prepareHash(clean: CleanPrepare, evidenceComparisonKey: string): string {
  const lines = [...clean.lines]
    .sort((a,b) => a.borrowDetailId < b.borrowDetailId ? -1 : a.borrowDetailId > b.borrowDetailId ? 1 : 0)
    .map(l=>[l.borrowDetailId,l.returnedQuantity,l.condition]);
  return createHash('sha256').update(JSON.stringify([
    'acm-stage4c-v1','PREPARE',clean.borrowRequestId,evidenceComparisonKey,lines,
  ])).digest('hex');
}
export async function executeStage4CPrepare(
  port: PrepareWriterPort, serverPrincipalId: string, rawInput: unknown,
): Promise<PreparedReturnResult> {
  if (!validId(serverPrincipalId)) fail('FORBIDDEN');
  const clean = cleanInput(rawInput);
  const evidence = normalizeEvidenceCode(clean.physicalEvidenceRef);
  const hash = prepareHash(clean,evidence.comparisonKey);
  return port.serializable(async tx => {
    const actor = await tx.authenticateBorrowScope(serverPrincipalId, clean.borrowRequestId);
    if (!actor || actor.id !== serverPrincipalId) fail('FORBIDDEN');
    assertReturnActionAllowed('PREPARE',actor,{
      status:'PREPARED',receiverId:null,verifierId:null,
      physicallyReceived:false,independentlyVerified:false,
    });
    await tx.lockBorrowRequest(clean.borrowRequestId);
    const replay = await tx.findReplayForUpdate(clean.borrowRequestId,clean.requestKey);
    if (replay) {
      const decision=compareReplay({
        borrowRequestId:replay.borrowRequestId, key:replay.requestKey,
        actorId:replay.actorId,payloadSha256:replay.payloadSha256,
      },{
        borrowRequestId:clean.borrowRequestId,key:clean.requestKey,
        actorId:actor.id,payloadSha256:hash,
      });
      if (decision==='FORBIDDEN') fail('FORBIDDEN');
      if (decision!=='REPLAY' || !replay.originalResult ||
          replay.originalResult.borrowRequestId!==clean.borrowRequestId ||
          replay.originalResult.state!=='PREPARED' ||
          replay.originalResult.evidenceComparisonKey!==evidence.comparisonKey ||
          !validId(replay.originalResult.operationId)) fail('REPLAY_CONFLICT');
      return { ...replay.originalResult,replayed:true };
    }
    const states=await tx.loadOperationStatesForUpdate(clean.borrowRequestId);
    assertNoUnresolvedOperation(states);
    const borrowed=await tx.loadBorrowDetailsForUpdate(clean.borrowRequestId);
    assertPhysicalReturnQuantities(borrowed,clean.lines);
    // Only the adapter can atomically enforce uniqueness ACROSS borrows, since
    // the borrow lock above is scoped to only this borrow ID.
    const result=await tx.persistPrepareAtomically({
      borrowRequestId:clean.borrowRequestId,requestKey:clean.requestKey,
      actor,originalEvidenceRef:evidence.original,
      evidenceComparisonKey:evidence.comparisonKey,
      physicalLines:clean.lines,payloadSha256:hash,
      idempotencyRetentionDays:365,auditEvent:'RETURN_PREPARED',
    });
    if (!result || result.borrowRequestId!==clean.borrowRequestId ||
        !validId(result.operationId) ||
        result.state!=='PREPARED' ||
        result.evidenceComparisonKey!==evidence.comparisonKey) fail('BAD_ADAPTER_RESULT');
    return { ...result,replayed:false };
  });
}
