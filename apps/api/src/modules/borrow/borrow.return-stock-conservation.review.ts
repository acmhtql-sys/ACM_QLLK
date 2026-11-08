/**
 * L2/DBA review-only accounting model for BIZ-03 quarantine-first returns.
 *
 * Pure arithmetic only: NO SQL/Prisma/HTTP/stock writes. Every input MUST be a
 * trusted, locked database snapshot if a future (separately approved) writer
 * ever adopts this logic. This file is NOT imported by any operational route.
 *
 * Important: a balance alone cannot prove receipt identity, original physical
 * source, independent verification, or once-only QC release. The approved
 * writer needs an immutable per-receipt/line claim and transaction locks.
 */
import { AppError } from '../../shared/AppError';
import type { QuarantineOnlyDisposition } from './borrow.return-commit-preflight.policy';
import { assertStage4CQcReleaseAllowed } from './borrow.return-commit-preflight.policy';

export interface ReviewStockBalance {
  onHand: number;
  borrowed: number;
  quarantined: number;
  reserved: number;
  kitAllocated: number;
}

export interface ReviewAccountingPlan {
  /** The original caller snapshot; never mutated by a plan. */
  before: ReviewStockBalance;
  /** Proposed post-state, subject to independent DBA approval. */
  after: ReviewStockBalance;
  availableBefore: number;
  availableAfter: number;
}

const fields: readonly (keyof ReviewStockBalance)[] = [
  'onHand', 'borrowed', 'quarantined', 'reserved', 'kitAllocated',
];

export function availableForReview(balance: ReviewStockBalance): number {
  if (!balance || typeof balance !== 'object') {
    throw new AppError('Thiếu snapshot tồn kho đáng tin cậy', 409);
  }
  for (const name of fields) {
    if (!Number.isSafeInteger(balance[name]) || balance[name] < 0) {
      throw new AppError('Số dư tồn kho không hợp lệ', 409);
    }
  }
  // Unlike the legacy UI, do NOT clamp negative values to zero. A negative
  // quantity is a reconciliation defect that must block any posting.
  const reservedTotal = balance.reserved + balance.quarantined + balance.kitAllocated;
  if (!Number.isSafeInteger(reservedTotal) || reservedTotal > balance.onHand) {
    throw new AppError('Tồn kho có phân bổ vượt quá số lượng vật lý', 409);
  }
  return balance.onHand - reservedTotal;
}

const validQty = (quantity: unknown): quantity is number =>
  typeof quantity === 'number' && Number.isSafeInteger(quantity) && quantity > 0;

const checkedAdd = (left: number, right: number): number => {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new AppError('Phép tính tồn kho vượt giới hạn số nguyên an toàn', 409);
  }
  return result;
};

/**
 * BIZ-03 candidate: received GOOD or DAMAGED both increase onHand and
 * quarantined while decreasing borrowed. Initial AVAILABLE stays unchanged.
 *
 * The disposition must originate from separately validated operation facts
 * and a confirmed, authoritative physical receipt. The pure function cannot
 * check that origin or commit to a real ledger.
 */
export function planQuarantineFirstPhysicalReturn(
  balance: ReviewStockBalance,
  disposition: QuarantineOnlyDisposition
): ReviewAccountingPlan {
  const availableBefore = availableForReview(balance);
  if (!disposition || !validQty(disposition.returnedQuantity) ||
      disposition.availableStockCreditAllowedAtCommit !== false ||
      (disposition.condition !== 'GOOD' && disposition.condition !== 'DAMAGED') ||
      disposition.disposition !== (disposition.condition === 'GOOD'
        ? 'QUARANTINE_PENDING_QC' : 'QUARANTINE_DAMAGED')) {
    throw new AppError('Disposition chưa đủ điều kiện nhận vật lý cách ly', 409);
  }
  const q = disposition.returnedQuantity;
  if (balance.borrowed < q) {
    throw new AppError('Số đang mượn không đủ để hoàn trả', 409);
  }
  const after: ReviewStockBalance = {
    ...balance,
    borrowed: balance.borrowed - q,
    onHand: checkedAdd(balance.onHand, q),
    quarantined: checkedAdd(balance.quarantined, q),
  };
  const availableAfter = availableForReview(after);
  if (availableAfter !== availableBefore ||
      after.onHand - balance.onHand !== balance.borrowed - after.borrowed) {
    throw new AppError('Vi phạm nguyên tắc bảo toàn tồn kho khi tiếp nhận', 409);
  }
  return {
    before: { ...balance }, after,
    availableBefore, availableAfter,
  };
}

/**
 * BIZ-03 candidate: after independent GOOD QC approves a specific received
 * batch, only quarantined decreases. NEVER increase onHand a second time.
 *
 * The approved DB transaction must additionally prove per-batch ownership,
 * QC idempotency/once-only posting and immutable audit to avoid double release
 * when multiple historical batches share a balance.
 */
export function planGoodQcRelease(
  balance: ReviewStockBalance,
  quantity: number,
  qc: Parameters<typeof assertStage4CQcReleaseAllowed>[0]
): ReviewAccountingPlan {
  const availableBefore = availableForReview(balance);
  assertStage4CQcReleaseAllowed(qc);
  if (!validQty(quantity) || balance.quarantined < quantity) {
    throw new AppError('Số cách ly không đủ hoặc số duyệt QC không hợp lệ', 409);
  }
  const after: ReviewStockBalance = {
    ...balance,
    quarantined: balance.quarantined - quantity,
  };
  const availableAfter = availableForReview(after);
  if (availableAfter - availableBefore !== quantity ||
      after.onHand !== balance.onHand || after.borrowed !== balance.borrowed) {
    throw new AppError('QC không được cộng tồn kho vật lý lần thứ hai', 409);
  }
  return { before: { ...balance }, after, availableBefore, availableAfter };
}
