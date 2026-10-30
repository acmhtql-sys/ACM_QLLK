/**
 * ACM Stage4C - bounded retry ONLY after a trusted adapter confirms complete
 * rollback of an isolated SERIALIZABLE transaction. REVIEW ONLY / NO DATABASE.
 *
 * P2034, SQLSTATE 40001 and 40P01 MUST NOT be blindly matched here: the
 * future adapter must verify the transaction has really aborted and no
 * external side-effects occurred before it marks an error as safe to replay.
 *
 * A connection drop, lost COMMIT acknowledgement, validation error, unique
 * evidence collision, auth failure or an unknown error is NOT retryable.
 * Port implementations must provide durable idempotency and dedup in real DB.
 */
import { executeStage4CPrepare } from './borrow.return-prepare.contract.ts';
import { executeStage4CWriter } from './borrow.return-writer.contract.ts';
import type { PrepareWriterPort, PreparedReturnResult } from './borrow.return-prepare.contract.ts';
import type { Stage4CWriterPort, WriterResult } from './borrow.return-writer.contract.ts';

export type TransactionRollbackKind = 'SERIALIZATION_CONFLICT' | 'DEADLOCK_ABORT';

/** Trusted adapter-only marker. It is not a substitute for DB rollback proof. */
export class ConfirmedRolledBackTransactionError extends Error {
  public readonly rollbackConfirmed = true as const;
  public readonly kind: TransactionRollbackKind;
  constructor(kind: TransactionRollbackKind) {
    super('Stage4C transaction rolled back: ' + kind);
    this.name = 'ConfirmedRolledBackTransactionError';
    this.kind = kind;
  }
}

export class RetryPolicyConfigurationError extends Error {
  constructor() {
    super('Stage4C retry attempts must be a safe integer from 1 to 3');
    this.name = 'RetryPolicyConfigurationError';
  }
}

/**
 * Safe retry scope:
 * - no more than 3 attempts, including the initial attempt
 * - retry only the adapter's explicit confirmed-rollback marker
 * - re-run the entire transaction, including scope auth, borrow lock,
 *   replay lookup, locked domain state, and DB persistence
 * - NEVER retry ambiguous COMMIT, unknown provider errors or unique conflicts
 * - no wall-clock timers, I/O, or hidden background work
 *
 * This is a reusable contract boundary, NOT an active API or DB adapter.
 */
export async function runStage4CWithConfirmedRollbackRetry<T>(
  operation: (attempt: number) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new RetryPolicyConfigurationError();
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!(error instanceof ConfirmedRolledBackTransactionError) ||
          error.rollbackConfirmed !== true ||
          (error.kind !== 'SERIALIZATION_CONFLICT' && error.kind !== 'DEADLOCK_ABORT') ||
          attempt >= maxAttempts) {
        throw error;
      }
      // Future production adapter should add bounded backoff at its own
      // transaction boundary, with deadline and cancellation controls.
    }
  }
  throw new Error('Unreachable Stage4C retry state');
}

/** Convenience entry points: still DORMANT until passed a real approved port. */
export function executeStage4CPrepareWithRetry(
  port: PrepareWriterPort, serverPrincipalId: string, request: unknown,
  maxAttempts = 3,
): Promise<PreparedReturnResult> {
  return runStage4CWithConfirmedRollbackRetry(
    () => executeStage4CPrepare(port, serverPrincipalId, request), maxAttempts,
  );
}

export function executeStage4CWriterWithRetry(
  port: Stage4CWriterPort, serverPrincipalId: string, request: unknown,
  maxAttempts = 3,
): Promise<WriterResult> {
  return runStage4CWithConfirmedRollbackRetry(
    () => executeStage4CWriter(port, serverPrincipalId, request), maxAttempts,
  );
}
