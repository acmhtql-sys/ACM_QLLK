/**
 * Stage4C BIZ-02/BIZ-04 pure authorization rules. No HTTP, DB, Prisma, I/O,
 * or stock mutation. Candidate only: the actual server must derive actor
 * identity/role from authenticated session and enforce inside its own locked
 * transaction. This module is intentionally NOT imported into RC5 routes.
 *
 * Source of business decisions: docs/stage4c-owner-business-policy-proposal-
 * 20261029.md on Stage4C Draft PR #22 (business approved, DBA not signed).
 */
import { AppError } from '../../shared/AppError';

export type Stage4CAction =
  | 'PREPARE'
  | 'CONFIRM_RECEIPT'
  | 'VERIFY'
  | 'COMMIT'
  | 'QC_APPROVE'
  | 'CANCEL';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * BIZ-04: TECHNICIAN may PREPARE/CONFIRM_RECEIPT but never verify, commit,
 * approve QC or cancel. STUDENT is forbidden from every operation action.
 * Unknown actors/actions fail closed.
 */
export function canPerformStage4CAction(role: unknown, action: unknown): boolean {
  if (role === 'ADMIN' || role === 'LAB_MANAGER') {
    return action === 'PREPARE' || action === 'CONFIRM_RECEIPT' ||
      action === 'VERIFY' || action === 'COMMIT' ||
      action === 'QC_APPROVE' || action === 'CANCEL';
  }
  if (role === 'TECHNICIAN') {
    return action === 'PREPARE' || action === 'CONFIRM_RECEIPT';
  }
  return false;
}

export function assertStage4CActionAllowed(role: unknown, action: unknown): void {
  if (!canPerformStage4CAction(role, action)) {
    throw new AppError('Không có quyền thực hiện bước hoàn trả', 403);
  }
}

/**
 * BIZ-02: the physical RECEIVER must have recorded a confirmation timestamp.
 * A different human with an authorized role must VERIFY prior to COMMIT.
 * This checks supplied trusted facts only; it CANNOT validate the provenance
 * of issuer, receiver or session. Actual provenance belongs to the DB writer.
 */
export function assertIndependentReceiptVerification(
  receivedByActorId: unknown,
  verifiedByActorId: unknown,
  receivedAt: unknown,
  verifierRole: unknown
): void {
  assertStage4CActionAllowed(verifierRole, 'VERIFY');
  const validTime = receivedAt instanceof Date
    ? Number.isFinite(receivedAt.getTime())
    : typeof receivedAt === 'string' &&
      receivedAt.trim().length > 0 &&
      Number.isFinite(Date.parse(receivedAt));
  if (!validTime || typeof receivedByActorId !== 'string' ||
      typeof verifiedByActorId !== 'string' ||
      !UUID.test(receivedByActorId) || !UUID.test(verifiedByActorId)) {
    throw new AppError('Thiếu xác nhận tiếp nhận và danh tính xác minh hợp lệ', 409);
  }
  if (receivedByActorId.toLowerCase() === verifiedByActorId.toLowerCase()) {
    throw new AppError('Người nhận không được tự xác minh chứng từ', 409);
  }
}

/** BIZ-04: CANCEL before COMMIT requires a nonblank explicit reason.
 * Terminal-state enforcement and audit are separate DB writer requirements.
 */
export function assertStage4CCancelReason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() ||
      /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AppError('Thiếu lý do hủy phiếu hoàn trả', 422);
  }
  return value.trim();
}
