/**
 * RC5: verified read-only cached physical-return acknowledgment.
 *
 * A COMPLETED idempotency row is not a substitute for an actual return receipt.
 * This helper is shared by POST retry and GET return-status without importing
 * the borrow service (avoids a cyclic dependency).
 *
 * No stock, receipt, audit or idempotency writes occur here.
 */
import { BorrowStatus, type BorrowRequestResponse } from '@acm/shared';
import { prisma } from '../../config/database';

interface CachedReturnEnvelope {
  borrowRequest: BorrowRequestResponse;
  returnNumber: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Whitelist the outer response and validate critical BorrowRequest DTO fields.
 * Persisted JSON has no TypeScript guarantees. Never pass unknown top-level
 * fields through to a caller just because the idempotency row was COMPLETED.
 */
export function parseCachedReturnEnvelope(
  value: unknown,
  borrowRequestId: string
): CachedReturnEnvelope | null {
  if (!isRecord(value) || !isRecord(value.borrowRequest) ||
      typeof value.returnNumber !== 'string' || !value.returnNumber.trim()) {
    return null;
  }
  const b = value.borrowRequest;
  if (b.id !== borrowRequestId ||
      typeof b.requestNumber !== 'string' || !b.requestNumber.trim() ||
      typeof b.borrowerId !== 'string' || !b.borrowerId.trim() ||
      typeof b.purpose !== 'string' ||
      (b.status !== BorrowStatus.RETURNED && b.status !== BorrowStatus.PARTIALLY_RETURNED) ||
      !Number.isSafeInteger(b.itemCount) || (b.itemCount as number) < 0 ||
      !Array.isArray(b.details) ||
      !b.details.every(detail => isRecord(detail) &&
        typeof detail.id === 'string' &&
        typeof detail.itemId === 'string' &&
        Number.isSafeInteger(detail.quantity) &&
        Number.isSafeInteger(detail.returnedQuantity))) {
    return null;
  }
  // The cached payload is generated from formatBorrowRequestResponse in the
  // original transaction. Only structural fields relevant to physical-return
  // acknowledgment are checked here; DB provenance is checked separately.
  return {
    borrowRequest: b as unknown as BorrowRequestResponse,
    returnNumber: value.returnNumber,
  };
}

/**
 * Receipt identity must be proven by the authoritative database, not by a
 * user-controlled cache JSON string. A corrupted or deleted receipt requires
 * operator reconciliation, NOT a second physical return.
 */
export async function hasAuthoritativeReturnReceipt(
  borrowRequestId: string,
  returnNumber: string
): Promise<boolean> {
  const receipt = await prisma.returnTransaction.findFirst({
    where: { borrowRequestId, returnNumber },
    select: { id: true },
  });
  return typeof receipt?.id === 'string' && receipt.id.length > 0;
}
