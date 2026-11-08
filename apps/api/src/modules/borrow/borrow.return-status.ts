/** Read-only Phase 11D lost-session reconciliation for one exact return key. */
import { prisma } from '../../config/database';
import type { AuthenticatedUser } from '../../middleware/auth';
import { AppError } from '../../shared/AppError';
import { idempotencyService } from '../inventory/idempotency.service';
import { borrowService } from './borrow.service';
import {
  parseCachedReturnEnvelope,
  hasAuthoritativeReturnReceipt,
} from './borrow.return-cache-integrity';

export type BorrowReturnStatus =
  | { state: 'COMPLETED'; requiresReconciliation: false; receipt: { returnNumber: string; borrowRequestId: string } }
  | { state: 'NOT_FOUND' | 'PENDING' | 'FAILED' | 'NEEDS_RECONCILIATION'; requiresReconciliation: true };

/**
 * No writes, no replays. NOT_FOUND is never proof that a lost POST was not applied.
 * A key is scoped to the original sender and exact route; results of other users
 * are intentionally indistinguishable from missing records.
 */
export async function getBorrowReturnStatus(
  borrowId: string,
  key: string,
  user: AuthenticatedUser
): Promise<BorrowReturnStatus> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(borrowId) || !idempotencyService.validateKey(key)) {
    throw new AppError('Mã phiếu hoặc khóa đối soát không hợp lệ', 422);
  }
  // Preserve existing borrow-level RBAC and conceal key existence from outsiders.
  await borrowService.getBorrowRequestById(borrowId, user);
  const endpoint = `/api/v1/borrow-requests/${borrowId}/return`;
  const record = await prisma.idempotencyRecord.findUnique({
    where: { key },
    select: { userId: true, endpoint: true, status: true, statusCode: true, responseBody: true },
  });
  if (!record || record.userId !== user.id || record.endpoint !== endpoint) {
    return { state: 'NOT_FOUND', requiresReconciliation: true };
  }
  if (record.status === 'PENDING' || record.status === 'FAILED') {
    return { state: record.status, requiresReconciliation: true };
  }
  if (record.status !== 'COMPLETED' || record.statusCode !== 200) {
    return { state: 'NEEDS_RECONCILIATION', requiresReconciliation: true };
  }
  const cached = parseCachedReturnEnvelope(record.responseBody, borrowId);
  if (!cached || !await hasAuthoritativeReturnReceipt(borrowId, cached.returnNumber)) {
    // Shape and an idempotency COMPLETED flag are insufficient to prove a
    // physical receipt. Never report a valid, but nonexistent, cached number.
    return { state: 'NEEDS_RECONCILIATION', requiresReconciliation: true };
  }
  return {
    state: 'COMPLETED', requiresReconciliation: false,
    receipt: { returnNumber: cached.returnNumber, borrowRequestId: borrowId },
  };
}
