/**
 * Stage 4C-2A: inert server-side return-operation foundation.
 * This module deliberately performs NO database reads or writes.
 * The operation API is unavailable until schema migration, shared transactional
 * stock posting, permissions and cutover are independently verified.
 */
import { createHash } from 'crypto';
import { AppError } from '../../shared/AppError';

export type ReturnOperationState =
  | 'PREPARED'
  | 'RECONCILIATION_REQUIRED'
  | 'COMPLETED'
  | 'CANCELLED';

type ReturnCondition = 'GOOD' | 'DAMAGED' | 'LOST';
export interface ReturnOperationLineSnapshot {
  borrowDetailId: string;
  returnedQuantity: number;
  condition: ReturnCondition;
  locationId: string | null;
  notes: string | null;
}
export interface ReturnOperationPayloadSnapshot {
  items: ReturnOperationLineSnapshot[];
  notes: string | null;
}

export interface ReturnOperationStatusSnapshot {
  id: string;
  borrowRequestId: string;
  state: string;
  returnTransactionId: string | null;
  returnNumber?: string | null;
  completedAt: Date | string | null;
  cancelledAt: Date | string | null;
  cancelReason: string | null;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const textOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : typeof value === 'string' ? value : (() => { throw new AppError('Ghi chú không hợp lệ', 422); })();

/** Only the exact opt-in string enables cutover; false/undefined stays legacy. */
export function returnOperationCutoverRequested(value: string | undefined = process.env.ACM_RETURN_OPERATIONS_ENABLED): boolean {
  return value === 'true';
}

/** Server-side gate: service callers cannot bypass the HTTP route. */
export function assertLegacyReturnWriteAllowed(
  value: string | undefined = process.env.ACM_RETURN_OPERATIONS_ENABLED
): void {
  if (returnOperationCutoverRequested(value)) {
    throw new AppError('Đường hoàn trả cũ đã bị khóa; hệ thống cần hoàn tất chuyển đổi operation', 503);
  }
}

/** Hard gate: even setting the flag to true cannot activate an unfinished writer. */
export function rejectUnreleasedReturnOperations(): never {
  throw new AppError('API giao dịch hoàn trả liên thiết bị chưa được phát hành', 503);
}

/**
 * Immutable canonical snapshot; never trust a client's request hash or operation state.
 * UUID line IDs sort deterministically; duplicate line IDs and unsupported fields fail closed.
 */
export function canonicalReturnOperationPayload(input: unknown): ReturnOperationPayloadSnapshot {
  if (!record(input) || Object.keys(input).some(k => !['items', 'notes'].includes(k)) ||
      !Array.isArray(input.items) || input.items.length === 0) {
    throw new AppError('Payload hoàn trả không hợp lệ', 422);
  }
  const seen = new Set<string>();
  const items: ReturnOperationLineSnapshot[] = input.items.map((value: unknown) => {
    if (!record(value) || Object.keys(value).some(k => ![
      'borrowDetailId', 'returnedQuantity', 'condition', 'locationId', 'notes',
    ].includes(k))) {
      throw new AppError('Chi tiết hoàn trả không hợp lệ', 422);
    }
    const id = value.borrowDetailId;
    if (typeof id !== 'string' || !uuid.test(id) || seen.has(id.toLowerCase())) {
      throw new AppError('ID dòng mượn không hợp lệ hoặc trùng lặp', 422);
    }
    seen.add(id.toLowerCase());
    if (!Number.isSafeInteger(value.returnedQuantity) || (value.returnedQuantity as number) <= 0 ||
        !['GOOD', 'DAMAGED', 'LOST'].includes(String(value.condition))) {
      throw new AppError('Số lượng hoặc tình trạng hoàn trả không hợp lệ', 422);
    }
    const locationId = value.locationId;
    if (locationId !== null && locationId !== undefined &&
        (typeof locationId !== 'string' || !uuid.test(locationId))) {
      throw new AppError('Kho nhận trả không hợp lệ', 422);
    }
    return {
      borrowDetailId: id.toLowerCase(),
      returnedQuantity: value.returnedQuantity as number,
      condition: value.condition as ReturnCondition,
      locationId: typeof locationId === 'string' ? locationId.toLowerCase() : null,
      notes: textOrNull(value.notes),
    };
  });
  items.sort((a, b) => a.borrowDetailId.localeCompare(b.borrowDetailId));
  return { items, notes: textOrNull(input.notes) };
}

export function hashReturnOperationPayload(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalReturnOperationPayload(input))).digest('hex');
}

export function assertOperationSnapshotConsistent(op: ReturnOperationStatusSnapshot): void {
  if (!uuid.test(op.id) || !uuid.test(op.borrowRequestId)) {
    throw new AppError('Mã operation hoặc phiếu mượn không hợp lệ', 409);
  }
  if (!['PREPARED','RECONCILIATION_REQUIRED','COMPLETED','CANCELLED'].includes(op.state)) {
    throw new AppError('Trạng thái operation không xác định, cần đối soát', 409);
  }
  const hasResult = typeof op.returnTransactionId === 'string' && uuid.test(op.returnTransactionId);
  const hasCompletedAt = Boolean(op.completedAt && Number.isFinite(Date.parse(String(op.completedAt))));
  const hasCancelledAt = Boolean(op.cancelledAt && Number.isFinite(Date.parse(String(op.cancelledAt))));
  if (op.state === 'COMPLETED') {
    if (!hasResult || !hasCompletedAt || hasCancelledAt ||
        typeof op.returnNumber !== 'string' || !op.returnNumber.trim()) {
      throw new AppError('Biên nhận operation thiếu hoặc không khớp', 409);
    }
  } else if (hasResult || op.returnTransactionId !== null || op.completedAt !== null || hasCompletedAt ||
             (op.returnNumber !== null && op.returnNumber !== undefined)) {
    throw new AppError('Operation chưa hoàn tất nhưng có biên nhận bất thường', 409);
  }
  if (op.state === 'CANCELLED') {
    if (!hasCancelledAt || typeof op.cancelReason !== 'string' || !op.cancelReason.trim()) {
      throw new AppError('Operation hủy không có đủ chứng cứ', 409);
    }
  } else if (hasCancelledAt || op.cancelledAt !== null || op.cancelReason !== null) {
    throw new AppError('Operation chưa hủy nhưng có dữ liệu hủy bất thường', 409);
  }
}

/** No implicit cross-device retry/duplicate decision based only on item quantities. */
export function nextOperationPolicy(state: ReturnOperationState): 'BLOCKED' | 'PHYSICAL_EVIDENCE_REVIEW' {
  return state === 'PREPARED' || state === 'RECONCILIATION_REQUIRED'
    ? 'BLOCKED' : 'PHYSICAL_EVIDENCE_REVIEW';
}

/**
 * Structural guard for evidence identifiers. Does not prove an authentic handover:
 * the issuer / verifier process is a separate, not-yet-approved release gate.
 * A physical evidence identifier is required at PREPARED in the candidate schema.
 */
export function assertPhysicalEvidenceReference(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 ||
      value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AppError('Mã chứng từ bàn giao vật lý không hợp lệ', 422);
  }
  return value;
}
