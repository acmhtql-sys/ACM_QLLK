/**
 * Stage4C L2 REVIEW ONLY: join independent server-authoritative sources before
 * proposing a quarantine-first COMMIT. PURE, UNWIRED; never an HTTP/DB writer.
 *
 * This is an arithmetic/identity consistency check, NOT physical evidence
 * provenance, unique receipt issuance or proof that DB rows were locked.
 * A future approved transaction must lock source allocations and stock rows in
 * stable order, re-read them, claim receipt once, post + audit atomically.
 */
import { AppError } from '../../shared/AppError';
import {
  assertStage4CCommitPreconditions,
  type QuarantineOnlyDisposition,
  type TrustedBorrowLine,
  type TrustedStage4CCommitFacts,
} from './borrow.return-commit-preflight.policy';
import {
  planQuarantineFirstBatchForReview,
  type ReviewBalanceBucket,
  type ReviewBatchAccountingPlan,
} from './borrow.return-stock-conservation.review';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const idOrReject = (value: unknown): string => {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new AppError('Danh tính nguồn hoàn trả chưa được đối soát', 409);
  }
  return value.toLowerCase();
};

export interface ReviewLockedBorrowAllocation extends TrustedBorrowLine {
  /** Persistent source balance identity; must be loaded from locked DB state. */
  stockBalanceId: string;
  /** Server-reconciled item, NOT a client-provided return-line value. */
  itemId: string;
}

export interface ReviewLockedStockBucket extends ReviewBalanceBucket {
  itemId: string;
  locationId: string;
}

export interface ReviewJoinedReturnPosting {
  /** Canonical disposition; no stock available before independent QC. */
  dispositions: readonly QuarantineOnlyDisposition[];
  /** Grouped by persistent stock balance id, never by client location claim. */
  postings: readonly ReviewBatchAccountingPlan[];
}

/**
 * Reject mismatched borrow-detail / item / source-location / stock-balance
 * snapshots, including overlapping lines that would overconsume borrowed.
 * All inputs MUST be supplied by an approved future writer under common locks.
 */
export function planJoinedStage4CPostingForReview(
  trusted: TrustedStage4CCommitFacts,
  allocations: readonly ReviewLockedBorrowAllocation[],
  buckets: readonly ReviewLockedStockBucket[],
): ReviewJoinedReturnPosting {
  // The BIZ-02/04 checks run before posting plans; this is not an authority
  // to manufacture the trusted facts supplied by the calling DB transaction.
  const dispositions = assertStage4CCommitPreconditions(trusted);
  if (!Array.isArray(allocations) || !Array.isArray(buckets) ||
      allocations.length !== dispositions.length || buckets.length === 0) {
    throw new AppError('Thiếu snapshot kho nguồn được khóa cho COMMIT', 409);
  }

  const authoritativeLines = new Map<string, TrustedBorrowLine>();
  for (const line of trusted.borrowLines) {
    authoritativeLines.set(idOrReject(line.borrowDetailId), line);
  }
  const bucketById = new Map<string, ReviewLockedStockBucket>();
  for (const bucket of buckets) {
    if (!bucket) throw new AppError('Số dư kho nguồn không hợp lệ', 409);
    const id = idOrReject(bucket.stockBalanceId);
    const itemId = idOrReject(bucket.itemId);
    const locationId = idOrReject(bucket.locationId);
    if (bucketById.has(id)) {
      throw new AppError('Số dư kho nguồn trùng lặp', 409);
    }
    bucketById.set(id, { ...bucket, itemId, locationId });
  }

  const allocationByDetail = new Map<string, ReviewLockedBorrowAllocation>();
  for (const allocation of allocations) {
    if (!allocation) throw new AppError('Thiếu bản ghi phân bổ nguồn', 409);
    const detailId = idOrReject(allocation.borrowDetailId);
    const stockBalanceId = idOrReject(allocation.stockBalanceId);
    const itemId = idOrReject(allocation.itemId);
    const locationId = idOrReject(allocation.sourceLocationId);
    const sourceLine = authoritativeLines.get(detailId);
    const bucket = bucketById.get(stockBalanceId);
    if (allocationByDetail.has(detailId) || !sourceLine || !bucket ||
        idOrReject(sourceLine.sourceLocationId) !== locationId ||
        sourceLine.originalQuantity !== allocation.originalQuantity ||
        sourceLine.alreadyReturnedQuantity !== allocation.alreadyReturnedQuantity ||
        bucket.itemId !== itemId || bucket.locationId !== locationId) {
      throw new AppError('Ánh xạ dòng mượn, linh kiện và kho nguồn không nhất quán', 409);
    }
    allocationByDetail.set(detailId, {
      ...allocation, borrowDetailId: detailId, stockBalanceId, itemId,
      sourceLocationId: locationId,
    });
  }

  const assignments = dispositions.map(disposition => {
    const allocation = allocationByDetail.get(idOrReject(disposition.borrowDetailId));
    if (!allocation) {
      throw new AppError('Thiếu nguồn đã khóa cho dòng hoàn trả', 409);
    }
    return {
      stockBalanceId: allocation.stockBalanceId,
      disposition,
    };
  });
  const stockBuckets: ReviewBalanceBucket[] = [...bucketById].map(([stockBalanceId, bucket]) => ({
    stockBalanceId, balance: { ...bucket.balance },
  }));
  const postings = planQuarantineFirstBatchForReview(stockBuckets, assignments);
  // Defensive invariant: never permit a stock bucket to become available
  // through physical receipt alone, even if a helper changes in the future.
  if (postings.some(posting => posting.availableAfter !== posting.availableBefore)) {
    throw new AppError('Không được cộng tồn khả dụng trước QC', 409);
  }
  return { dispositions: dispositions.map(line => ({ ...line })), postings };
}
