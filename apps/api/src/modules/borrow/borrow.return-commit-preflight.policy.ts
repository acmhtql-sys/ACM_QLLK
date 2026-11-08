/**
 * Stage4C BIZ-02/03/04/05 fail-closed COMMIT preflight, PURE and UNWIRED.
 * Inputs MUST come from trusted persisted server-side snapshots under the
 * approved database locks in any future writer. Never pass client claims here.
 *
 * This is NOT an authorization source, SQL constraint, custody verifier or
 * stock posting implementation. All live Stage4C endpoints remain blocked.
 */
import { AppError } from '../../shared/AppError';
import {
  assertIndependentReceiptVerification,
  assertStage4CActionAllowed,
} from './borrow.return-workflow-access.policy';
import {
  assertPhysicalEvidenceReference,
  canonicalReturnOperationPayload,
  type ReturnOperationLineSnapshot,
} from './borrow.return-operation-foundation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const validTimestamp = (value: unknown): number | null => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

export interface TrustedBorrowLine {
  borrowDetailId: string;
  /** Borrowed quantity under an approved, locked source-of-truth. */
  originalQuantity: number;
  alreadyReturnedQuantity: number;
  /** Deterministically reconciled, unique source location (not client input). */
  sourceLocationId: string;
}

export interface TrustedStage4CCommitFacts {
  operationState: 'PREPARED' | 'RECONCILIATION_REQUIRED' | 'COMPLETED' | 'CANCELLED';
  borrowRequestId: string;
  operationBorrowRequestId: string;
  /** Server-issued physical evidence code, not proof of actual handover. */
  evidenceReference: unknown;
  /** Server-persisted actual physical receiving event and actor. */
  receivedByActorId: unknown;
  receivedAt: unknown;
  /** Server-persisted independent verification event and actor. */
  verifiedByActorId: unknown;
  verifiedAt: unknown;
  /** Roles MUST come from a fresh authenticated/server-authoritative lookup. */
  verifierRole: unknown;
  committerRole: unknown;
  /** Persisted canonical operation payload, not frontend POST body. */
  payload: unknown;
  /** Locked, validated borrow detail/source allocation snapshot. */
  borrowLines: readonly TrustedBorrowLine[];
}

/**
 * BIZ-03: physical returns quarantine first, never credit available stock on
 * initial COMMIT. GOOD can only become available after a separate QC approval;
 * DAMAGED stays quarantined; LOST requires a distinct incident operation.
 */
export interface QuarantineOnlyDisposition {
  borrowDetailId: string;
  returnedQuantity: number;
  condition: 'GOOD' | 'DAMAGED';
  disposition: 'QUARANTINE_PENDING_QC' | 'QUARANTINE_DAMAGED';
  availableStockCreditAllowedAtCommit: false;
}

/** No stock quantities are computed or persisted by this pure function. */
export function assertStage4CCommitPreconditions(
  trusted: TrustedStage4CCommitFacts
): readonly QuarantineOnlyDisposition[] {
  assertStage4CActionAllowed(trusted.committerRole, 'COMMIT');
  if (trusted.operationState !== 'PREPARED') {
    throw new AppError('Chỉ operation PREPARED được xem xét COMMIT', 409);
  }
  if (!UUID.test(trusted.borrowRequestId) ||
      !UUID.test(trusted.operationBorrowRequestId) ||
      trusted.borrowRequestId.toLowerCase() !== trusted.operationBorrowRequestId.toLowerCase()) {
    throw new AppError('Operation không thuộc phiếu mượn được khóa', 409);
  }

  assertPhysicalEvidenceReference(trusted.evidenceReference);
  assertIndependentReceiptVerification(
    trusted.receivedByActorId,
    trusted.verifiedByActorId,
    trusted.receivedAt,
    trusted.verifierRole,
  );
  const received = validTimestamp(trusted.receivedAt);
  const verified = validTimestamp(trusted.verifiedAt);
  if (received === null || verified === null || verified < received) {
    throw new AppError('Chưa có xác minh độc lập hợp lệ sau khi tiếp nhận thực tế', 409);
  }

  const payload = canonicalReturnOperationPayload(trusted.payload);
  const sourceByDetail = new Map<string, TrustedBorrowLine>();
  for (const line of trusted.borrowLines) {
    if (!UUID.test(line.borrowDetailId) || !UUID.test(line.sourceLocationId) ||
        !Number.isSafeInteger(line.originalQuantity) || line.originalQuantity <= 0 ||
        !Number.isSafeInteger(line.alreadyReturnedQuantity) ||
        line.alreadyReturnedQuantity < 0 ||
        line.alreadyReturnedQuantity > line.originalQuantity ||
        sourceByDetail.has(line.borrowDetailId.toLowerCase())) {
      throw new AppError('Dữ liệu nguồn/chi tiết mượn cần đối soát', 409);
    }
    sourceByDetail.set(line.borrowDetailId.toLowerCase(), line);
  }

  return payload.items.map((item: ReturnOperationLineSnapshot): QuarantineOnlyDisposition => {
    const line = sourceByDetail.get(item.borrowDetailId);
    if (!line) {
      throw new AppError('Dòng hoàn trả không thuộc phiếu mượn đã xác minh', 409);
    }
    if (item.returnedQuantity > line.originalQuantity - line.alreadyReturnedQuantity) {
      throw new AppError('Số lượng hoàn trả vượt số lượng đang mượn', 409);
    }
    if (item.locationId && item.locationId !== line.sourceLocationId.toLowerCase()) {
      throw new AppError('Chưa hỗ trợ hoàn trả khác kho nguồn khi chưa có custody ledger', 409);
    }
    if (item.condition === 'LOST') {
      throw new AppError('LOST phải có biên bản sự cố riêng, không xác nhận đã nhận vật lý', 409);
    }
    return {
      borrowDetailId: item.borrowDetailId,
      returnedQuantity: item.returnedQuantity,
      condition: item.condition,
      disposition: item.condition === 'GOOD'
        ? 'QUARANTINE_PENDING_QC'
        : 'QUARANTINE_DAMAGED',
      availableStockCreditAllowedAtCommit: false,
    };
  });
}

/**
 * BIZ-05: a second unresolved operation must be rejected; this is a
 * snapshot-only preflight, NOT a substitute for a DB partial unique index
 * and transactional lock against concurrent PREPARE requests.
 */
export function assertNoPendingStage4COperation(
  states: readonly unknown[]
): void {
  if (!Array.isArray(states) || states.some(state =>
    !['PREPARED', 'RECONCILIATION_REQUIRED', 'COMPLETED', 'CANCELLED'].includes(String(state)))) {
    throw new AppError('Trạng thái operation không hợp lệ', 409);
  }
  if (states.includes('PREPARED') || states.includes('RECONCILIATION_REQUIRED')) {
    throw new AppError('Phiếu mượn đã có operation chưa kết thúc', 409);
  }
}

/** BIZ-03/04: only server-persisted GOOD with approved QC may be released. */
export function assertStage4CQcReleaseAllowed(input: {
  role: unknown;
  committed: boolean;
  condition: unknown;
  qcApprovedAt: unknown;
  evidenceVerified: boolean;
}): void {
  assertStage4CActionAllowed(input.role, 'QC_APPROVE');
  if (input.committed !== true || input.condition !== 'GOOD' ||
      input.evidenceVerified !== true || validTimestamp(input.qcApprovedAt) === null) {
    throw new AppError('Hàng chưa đủ điều kiện duyệt QC để đưa vào tồn khả dụng', 409);
  }
}
