/**
 * DBA REVIEW ONLY: one-time QC posting proposal tied to one receipt detail.
 * Never imported by a route/service; NO SQL, external I/O or stock mutations.
 *
 * The server must load these facts from a locked, immutable receipt-detail
 * ledger. A deterministic claim key + snapshot check DOES NOT prove uniqueness
 * across two processes: the future approved DB needs a durable unique index
 * and a single atomic transaction for claim, stock and audit.
 */
import { AppError } from '../../shared/AppError';
import { assertStage4CQcReleaseAllowed } from './borrow.return-commit-preflight.policy';
import { planGoodQcRelease, type ReviewAccountingPlan, type ReviewStockBalance }
  from './borrow.return-stock-conservation.review';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TrustedQcReceiptLineSnapshot {
  /** Stable persisted returnDetail ID, not borrowed item ID or browser input. */
  receiptDetailId: string;
  condition: 'GOOD' | 'DAMAGED' | 'LOST';
  committedQuantity: number;
  alreadyQcReleasedQuantity: number;
  /** Reconciled durable claim row for this exact receipt detail, not client. */
  qcClaimStatus: 'ABSENT' | 'IN_PROGRESS' | 'COMMITTED';
  sourceLocationId: string;
}

export interface ReviewOnceOnlyQcPlan extends ReviewAccountingPlan {
  /** Future DB candidate UNIQUE(receiptDetailId, claimType) */
  claimKey: string;
  receiptDetailId: string;
  releaseQuantity: number;
  /** Values to write together only with a verified unique claim + audit. */
  proposedReleasedQuantity: number;
  onHandDelta: 0;
  quarantinedDelta: number;
}

/**
 * Conservative initial proposal: a receipt detail is QC-released once,
 * in full. Partial QC per receipt detail requires separate owner/DBA approval.
 * Receipt details already partially released are held for reconciliation.
 */
export function planOneTimeGoodQcRelease(
  balance: ReviewStockBalance,
  receipt: TrustedQcReceiptLineSnapshot,
  qc: Parameters<typeof assertStage4CQcReleaseAllowed>[0],
): ReviewOnceOnlyQcPlan {
  if (!receipt ||
      typeof receipt.receiptDetailId !== 'string' ||
      !UUID.test(receipt.receiptDetailId) ||
      typeof receipt.sourceLocationId !== 'string' ||
      !UUID.test(receipt.sourceLocationId) ||
      !Number.isSafeInteger(receipt.committedQuantity) ||
      receipt.committedQuantity <= 0 ||
      !Number.isSafeInteger(receipt.alreadyQcReleasedQuantity) ||
      receipt.alreadyQcReleasedQuantity < 0 ||
      receipt.alreadyQcReleasedQuantity > receipt.committedQuantity ||
      !['ABSENT', 'IN_PROGRESS', 'COMMITTED'].includes(receipt.qcClaimStatus)) {
    throw new AppError('Dòng chứng từ QC chưa có snapshot đáng tin cậy', 409);
  }
  if (receipt.condition !== 'GOOD') {
    throw new AppError('Chỉ hàng GOOD được xuất khỏi khu cách ly sau QC', 409);
  }
  if (receipt.qcClaimStatus !== 'ABSENT' || receipt.alreadyQcReleasedQuantity !== 0) {
    throw new AppError('Dòng chứng từ đã có hoặc đang ghi nhận giải phóng QC', 409);
  }
  if (!qc || qc.condition !== 'GOOD') {
    throw new AppError('QC không trùng khớp tình trạng GOOD của chứng từ', 409);
  }
  assertStage4CQcReleaseAllowed(qc);
  const quantity = receipt.committedQuantity;
  const plan = planGoodQcRelease(balance, quantity, qc);
  return {
    ...plan,
    claimKey: receipt.receiptDetailId.toLowerCase() + ':QC_RELEASE',
    receiptDetailId: receipt.receiptDetailId.toLowerCase(),
    releaseQuantity: quantity,
    proposedReleasedQuantity: quantity,
    onHandDelta: 0,
    quarantinedDelta: -quantity,
  };
}
