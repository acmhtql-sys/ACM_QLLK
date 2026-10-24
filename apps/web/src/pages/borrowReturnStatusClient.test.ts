import { describe, expect, it } from 'vitest';
import { inspectBorrowReturnStatusResponse as inspect } from './borrowReturnStatusClient';
const borrowId = 'borrow-test-1';
const completed = {
  success: true,
  data: { state: 'COMPLETED', requiresReconciliation: false,
    receipt: { borrowRequestId: borrowId, returnNumber: 'RT-TEST-001' } },
};

describe('Stage 2B read-only lost-session response validation', () => {
  it('RECON-01: accepts an exact verified COMPLETED receipt', () => {
    expect(inspect(completed, borrowId)).toEqual({ kind: 'COMPLETED', returnNumber: 'RT-TEST-001' });
  });
  it('RECON-02: refuses another borrow request receipt', () => {
    expect(inspect(completed, 'another-borrow').kind).toBe('UNRESOLVED');
  });
  it('RECON-03: refuses a missing transaction number', () => {
    expect(inspect({ ...completed, data: { ...completed.data, receipt: { borrowRequestId: borrowId } } }, borrowId).kind)
      .toBe('UNRESOLVED');
  });
  it('RECON-04: refuses success envelope with requiresReconciliation=true', () => {
    expect(inspect({ ...completed, data: { ...completed.data, requiresReconciliation: true } }, borrowId).kind)
      .toBe('UNRESOLVED');
  });
  it('RECON-05: NOT_FOUND is never a permission to retry', () => {
    const result = inspect({ success: true, data: { state: 'NOT_FOUND', requiresReconciliation: true } }, borrowId);
    expect(result.kind).toBe('UNRESOLVED');
    if (result.kind === 'UNRESOLVED') expect(result.message).toContain('không phải bằng chứng');
  });
  it('RECON-06: PENDING/FAILED/NEEDS_RECONCILIATION all remain unresolved', () => {
    for (const state of ['PENDING', 'FAILED', 'NEEDS_RECONCILIATION']) {
      expect(inspect({ success: true, data: { state, requiresReconciliation: true } }, borrowId).kind)
        .toBe('UNRESOLVED');
    }
  });
  it('RECON-07: malformed envelope, null or success:false cannot clear', () => {
    for (const value of [undefined, null, false, {}, { success: false, data: completed.data },
      { success: true, data: [] }, { success: true, data: { state: 'COMPLETED' } }]) {
      expect(inspect(value, borrowId).kind).toBe('UNRESOLVED');
    }
  });
  it('RECON-08: unknown server states remain blocked', () => {
    expect(inspect({ success: true, data: { state: 'FINISHED', requiresReconciliation: true } }, borrowId).kind)
      .toBe('UNRESOLVED');
  });
});
