import { describe, expect, it } from 'vitest';
import { inspectReturnHistoryResponse } from './borrowReturnHistory';
const borrowId = 'borrow-test-1';
const entry = {
  id: 'return-1', returnNumber: 'RT-001', borrowRequestId: borrowId,
  createdAt: '2026-10-24T07:00:00Z', receiver: { fullName: 'Technician A' },
  details: [{ itemId: 'part-1', item: { code: 'LED-5MM-RGB' }, quantity: 2, condition: 'GOOD' }],
};
const envelope = (rows: unknown[], id: string = borrowId) =>
  ({ success: true, data: { id, returnTransactions: rows } });
describe('Phase 11D Stage 4C-1 history reconciliation (read only)', () => {
  it('HISTORY-01: accepts and sorts detailed receipts newest first', () => {
    const newer = { ...entry, id: 'return-2', returnNumber: 'RT-002', createdAt: '2026-10-24T08:00:00Z' };
    expect(inspectReturnHistoryResponse(envelope([entry, newer]), borrowId).map(x => x.returnNumber))
      .toEqual(['RT-002', 'RT-001']);
  });
  it('HISTORY-02: rejects a history envelope for another borrow', () => {
    expect(() => inspectReturnHistoryResponse(envelope([entry], 'other'), borrowId)).toThrow(/không khớp/);
  });
  it('HISTORY-03: rejects receipt from a different borrow within the correct envelope', () => {
    expect(() => inspectReturnHistoryResponse(envelope([{ ...entry, borrowRequestId: 'other' }]), borrowId)).toThrow();
  });
  it('HISTORY-04: rejects false success, missing lists and malformed quantities', () => {
    expect(() => inspectReturnHistoryResponse({success: false, data: {id: borrowId}}, borrowId)).toThrow();
    expect(() => inspectReturnHistoryResponse({success: true, data: {id: borrowId}}, borrowId)).toThrow();
    expect(() => inspectReturnHistoryResponse(envelope([{...entry, details: [{quantity: -1, condition: 'GOOD'}]}]),borrowId)).toThrow();
  });
  it('HISTORY-05: keeps empty server history distinct from proof of non-commit', () => {
    expect(inspectReturnHistoryResponse(envelope([]), borrowId)).toEqual([]);
  });
  it('HISTORY-06: rejects invalid createdAt or transaction number', () => {
    expect(() => inspectReturnHistoryResponse(envelope([{...entry, createdAt: 'invalid'}]), borrowId)).toThrow();
    expect(() => inspectReturnHistoryResponse(envelope([{...entry, returnNumber: ''}]), borrowId)).toThrow();
  });
});
