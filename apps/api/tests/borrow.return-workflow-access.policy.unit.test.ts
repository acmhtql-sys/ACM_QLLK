import { describe, expect, it } from 'vitest';
import {
  assertIndependentReceiptVerification,
  assertStage4CActionAllowed,
  assertStage4CCancelReason,
  canPerformStage4CAction,
  type Stage4CAction,
} from '../src/modules/borrow/borrow.return-workflow-access.policy';

const receiver = 'a1111111-1111-4111-8111-111111111111';
const verifier = 'b2222222-2222-4222-8222-222222222222';
const actions: Stage4CAction[] = [
  'PREPARE', 'CONFIRM_RECEIPT', 'VERIFY', 'COMMIT', 'QC_APPROVE', 'CANCEL',
];

describe('Stage4C BIZ-02/BIZ-04 pure role and separation of duty rules (NO DB)', () => {
  it.each(['ADMIN', 'LAB_MANAGER'])('%s may perform approved role actions', (role) => {
    for (const action of actions) {
      expect(canPerformStage4CAction(role, action)).toBe(true);
      expect(() => assertStage4CActionAllowed(role, action)).not.toThrow();
    }
  });

  it('TECHNICIAN may prepare/receive but never verify/commit/cancel/QC', () => {
    for (const action of actions) {
      const allowed = action === 'PREPARE' || action === 'CONFIRM_RECEIPT';
      expect(canPerformStage4CAction('TECHNICIAN', action)).toBe(allowed);
      if (!allowed) {
        expect(() => assertStage4CActionAllowed('TECHNICIAN', action)).toThrow();
      }
    }
  });

  it.each(['STUDENT', 'UNKNOWN', undefined, null])('%s has no Stage4C operation authority', (role) => {
    for (const action of actions) {
      expect(canPerformStage4CAction(role, action)).toBe(false);
      expect(() => assertStage4CActionAllowed(role, action)).toThrow();
    }
  });

  it('unknown or forged action strings fail closed even for ADMIN', () => {
    for (const action of ['', 'FORCE_COMMIT', 'DELETE', 'release', null]) {
      expect(canPerformStage4CAction('ADMIN', action)).toBe(false);
      expect(() => assertStage4CActionAllowed('ADMIN', action)).toThrow();
    }
  });

  it('allows an independent verifier when physical receipt has been recorded', () => {
    expect(() => assertIndependentReceiptVerification(
      receiver, verifier, '2026-10-29T01:00:00Z', 'LAB_MANAGER',
    )).not.toThrow();
    expect(() => assertIndependentReceiptVerification(
      receiver, verifier, new Date('2026-10-29T01:00:00Z'), 'ADMIN',
    )).not.toThrow();
  });

  it('rejects same RECEIVER/VERIFY even with different UUID casing', () => {
    expect(() => assertIndependentReceiptVerification(
      receiver, receiver.toUpperCase(), '2026-10-29T01:00:00Z', 'ADMIN',
    )).toThrow(/không được tự xác minh/);
  });

  it('rejects verifier roles without approval', () => {
    for (const role of ['TECHNICIAN', 'STUDENT', 'UNKNOWN']) {
      expect(() => assertIndependentReceiptVerification(
        receiver, verifier, '2026-10-29T01:00:00Z', role,
      )).toThrow();
    }
  });

  it('rejects missing or invalid receipt confirmation times', () => {
    for (const at of [undefined, null, '', 'not-a-date', new Date('invalid')]) {
      expect(() => assertIndependentReceiptVerification(receiver, verifier, at, 'ADMIN'))
        .toThrow();
    }
  });

  it('rejects invalid server-authenticated actor identifiers', () => {
    for (const id of [null, undefined, '', 'student', '../../x']) {
      expect(() => assertIndependentReceiptVerification(
        id, verifier, '2026-10-29T01:00:00Z', 'ADMIN',
      )).toThrow();
      expect(() => assertIndependentReceiptVerification(
        receiver, id, '2026-10-29T01:00:00Z', 'ADMIN',
      )).toThrow();
    }
  });

  it('requires meaningful cancellation reason with no controls', () => {
    for (const reason of [undefined, null, '', '   ', 'x\n'] as unknown[]) {
      expect(() => assertStage4CCancelReason(reason)).toThrow();
    }
    expect(assertStage4CCancelReason('  Người mượn chưa bàn giao  '))
      .toBe('Người mượn chưa bàn giao');
  });

  it('pure verification yields no DB posting or authorized receipt', () => {
    expect(assertIndependentReceiptVerification(
      receiver, verifier, new Date('2026-10-29T01:00:00Z'), 'ADMIN',
    )).toBeUndefined();
  });
});
