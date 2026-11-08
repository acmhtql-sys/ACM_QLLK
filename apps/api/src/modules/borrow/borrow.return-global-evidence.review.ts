/**
 * G03 business-rule proof only — PURE, UNWIRED, NO DB IO.
 *
 * Approved business rules 2026-11-08:
 * - evidence codes are unique GLOBAL_ACM, ASCII case-insensitive;
 * - an issued code is never reusable, including after CANCELLED;
 * - each distinct physical-return operation has its own code.
 *
 * This snapshot checker cannot establish DB-wide uniqueness, grant issuance,
 * validate a receiver or replace a PostgreSQL unique constraint. The future
 * DB-backed writer must obtain authoritative locked data and a DBA-approved
 * global unique index before accepting any evidence reference.
 */
import { AppError } from '../../shared/AppError';
import { assertPhysicalEvidenceReference } from './borrow.return-operation-foundation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = new Set([
  'PREPARED',
  'RECONCILIATION_REQUIRED',
  'COMPLETED',
  'CANCELLED',
]);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function invalidSnapshot(): never {
  // Avoid returning the conflicting reference, borrow or lab to callers.
  throw new AppError('Dữ liệu chứng từ cần đối soát', 409);
}

/**
 * ASCII-only normalization for comparing already-validated source snapshots.
 * It deliberately does NOT rewrite the displayed original evidence code.
 * PostgreSQL collation / CHECK / generated column remains DBA gate G03.
 */
export function canonicalEvidenceKeyReviewOnly(value: unknown): string {
  try {
    return assertPhysicalEvidenceReference(value).toLowerCase();
  } catch {
    return invalidSnapshot();
  }
}

export interface GlobalEvidenceAssignmentReview {
  /** One database operation identity, never a client-generated claim. */
  operationId: string;
  borrowRequestId: string;
  physicalEvidenceRef: string;
  state: 'PREPARED' | 'RECONCILIATION_REQUIRED' | 'COMPLETED' | 'CANCELLED';
}

/**
 * Scan a supplied, complete REVIEW snapshot for collisions.
 *
 * A return without exceptions means only that the *supplied rows* contain no
 * detectable conflict; it never proves the live DB was queried completely.
 * No CREATE/COMMIT decision may be based on this helper.
 */
export function assertGlobalEvidenceSnapshotConsistentReviewOnly(
  input: unknown
): void {
  if (!Array.isArray(input)) return invalidSnapshot();

  const operations = new Set<string>();
  const usedCodes = new Set<string>();
  for (const entry of input as readonly unknown[]) {
    if (!record(entry) ||
        typeof entry.operationId !== 'string' || !UUID.test(entry.operationId) ||
        typeof entry.borrowRequestId !== 'string' ||
        !UUID.test(entry.borrowRequestId) ||
        typeof entry.state !== 'string' || !STATES.has(entry.state) ||
        typeof entry.physicalEvidenceRef !== 'string') {
      return invalidSnapshot();
    }

    const operationId = entry.operationId.toLowerCase();
    const canonicalRef = canonicalEvidenceKeyReviewOnly(entry.physicalEvidenceRef);
    // Duplicate operation identities are ambiguous even when a JOIN happens
    // to return identical values; a real writer must use trusted unique rows.
    if (operations.has(operationId) || usedCodes.has(canonicalRef)) {
      return invalidSnapshot();
    }

    // CANCELLED is intentionally included: cancellation never frees a code.
    operations.add(operationId);
    usedCodes.add(canonicalRef);
  }
}
