import { describe, expect, it } from 'vitest';
import {
  assertNoPendingStage4COperation,
  assertStage4CCommitPreconditions,
  assertStage4CQcReleaseAllowed,
  type TrustedStage4CCommitFacts,
} from '../src/modules/borrow/borrow.return-commit-preflight.policy';

const BORROW = '11111111-1111-4111-8111-111111111111';
const DETAIL = '33333333-3333-4333-8333-333333333333';
const SOURCE = '55555555-5555-4555-8555-555555555555';
const RECEIVER = '77777777-7777-4777-8777-777777777777';
const VERIFIER = '88888888-8888-4888-8888-888888888888';

const facts = (changes: Partial<TrustedStage4CCommitFacts> = {}): TrustedStage4CCommitFacts => ({
  operationState: 'PREPARED',
  borrowRequestId: BORROW,
  operationBorrowRequestId: BORROW,
  evidenceReference: 'ACM-2026-001',
  receivedByActorId: RECEIVER,
  receivedAt: '2026-11-08T01:00:00Z',
  verifiedByActorId: VERIFIER,
  verifiedAt: '2026-11-08T01:05:00Z',
  verifierRole: 'LAB_MANAGER',
  committerRole: 'ADMIN',
  payload: { items: [{
    borrowDetailId: DETAIL, returnedQuantity: 4, condition: 'GOOD', locationId: SOURCE,
  }] },
  borrowLines: [{
    borrowDetailId: DETAIL, originalQuantity: 10,
    alreadyReturnedQuantity: 0, sourceLocationId: SOURCE,
  }],
  ...changes,
});
const item = (changes: Record<string, unknown>) => ({
  items: [{
    borrowDetailId: DETAIL, returnedQuantity: 4, condition: 'GOOD', locationId: SOURCE,
    ...changes,
  }],
});

describe('L2 Stage4C offline pre-COMMIT, quarantine and QC policy (zero I/O)', () => {
  it('BIZ03-01: GOOD is quarantine-only at initial COMMIT', () => {
    expect(assertStage4CCommitPreconditions(facts())).toEqual([{
      borrowDetailId: DETAIL, returnedQuantity: 4, condition: 'GOOD',
      disposition: 'QUARANTINE_PENDING_QC', availableStockCreditAllowedAtCommit: false,
    }]);
  });
  it('BIZ03-02: DAMAGED remains quarantined, no available credit', () => {
    expect(assertStage4CCommitPreconditions(facts({
      payload: item({ condition: 'DAMAGED' }),
    }))[0]).toMatchObject({
      condition: 'DAMAGED', disposition: 'QUARANTINE_DAMAGED',
      availableStockCreditAllowedAtCommit: false,
    });
  });
  it('BIZ03-03: LOST must use an incident workflow, never fake RECEIVE', () => {
    expect(() => assertStage4CCommitPreconditions(facts({
      payload: item({ condition: 'LOST' }),
    }))).toThrow(/biên bản sự cố riêng/);
  });
  it('BIZ05-04: two sequential partial returns of 4+6 from 10 pass', () => {
    expect(assertStage4CCommitPreconditions(facts())).toHaveLength(1);
    expect(assertStage4CCommitPreconditions(facts({
      payload: item({ returnedQuantity: 6 }),
      borrowLines: [{
        borrowDetailId: DETAIL, originalQuantity: 10,
        alreadyReturnedQuantity: 4, sourceLocationId: SOURCE,
      }],
    }))[0].returnedQuantity).toBe(6);
  });
  it('BIZ05-05: partial return of 4+7 from 10 is rejected', () => {
    expect(() => assertStage4CCommitPreconditions(facts({
      payload: item({ returnedQuantity: 7 }),
      borrowLines: [{
        borrowDetailId: DETAIL, originalQuantity: 10,
        alreadyReturnedQuantity: 4, sourceLocationId: SOURCE,
      }],
    }))).toThrow(/vượt/);
  });
  it('BIZ05-06: reject invalid quantity/duplicate payload details', () => {
    for (const n of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertStage4CCommitPreconditions(facts({
        payload: item({ returnedQuantity: n }),
      }))).toThrow();
    }
    const d = { borrowDetailId: DETAIL, returnedQuantity: 1, condition: 'GOOD' };
    expect(() => assertStage4CCommitPreconditions(facts({
      payload: { items: [d, { ...d, borrowDetailId: DETAIL.toUpperCase() }] },
    }))).toThrow();
  });
  it('BIZ05-07: unknown borrow detail never receives a stock plan', () => {
    expect(() => assertStage4CCommitPreconditions(facts({
      payload: item({ borrowDetailId: '44444444-4444-4444-8444-444444444444' }),
    }))).toThrow(/không thuộc phiếu mượn/);
  });
  it('RC5-08: cross-warehouse destination remains denied', () => {
    expect(() => assertStage4CCommitPreconditions(facts({
      payload: item({ locationId: '66666666-6666-4666-8666-666666666666' }),
    }))).toThrow(/khác kho nguồn/);
  });
  it('RC5-09: inconsistent/duplicate source allocations fail closed', () => {
    for (const borrowLines of [
      [{ borrowDetailId: DETAIL, originalQuantity: 10, alreadyReturnedQuantity: 0, sourceLocationId: '' }],
      [{ borrowDetailId: DETAIL, originalQuantity: 10, alreadyReturnedQuantity: 11, sourceLocationId: SOURCE }],
      [{ borrowDetailId: DETAIL, originalQuantity: 0, alreadyReturnedQuantity: 0, sourceLocationId: SOURCE }],
      [
        { borrowDetailId: DETAIL, originalQuantity: 10, alreadyReturnedQuantity: 0, sourceLocationId: SOURCE },
        { borrowDetailId: DETAIL.toUpperCase(), originalQuantity: 10, alreadyReturnedQuantity: 0, sourceLocationId: SOURCE },
      ],
    ]) {
      expect(() => assertStage4CCommitPreconditions(facts({ borrowLines })))
        .toThrow(/đối soát/);
    }
  });
  it('BIZ05-10: cross-borrow operation is rejected', () => {
    expect(() => assertStage4CCommitPreconditions(facts({
      operationBorrowRequestId: '22222222-2222-4222-8222-222222222222',
    }))).toThrow(/không thuộc phiếu mượn/);
  });
  it.each(['COMPLETED', 'CANCELLED', 'RECONCILIATION_REQUIRED'] as const)(
    'BIZ05-11: %s cannot COMMIT again', (operationState) => {
      expect(() => assertStage4CCommitPreconditions(facts({ operationState })))
        .toThrow(/PREPARED/);
    },
  );
  it.each(['STUDENT', 'TECHNICIAN', null])(
    'BIZ04-12: %s cannot COMMIT', (committerRole) => {
      expect(() => assertStage4CCommitPreconditions(facts({ committerRole })))
        .toThrow(/quyền/);
    },
  );
  it('BIZ02-13: receiver cannot verify their own receipt', () => {
    expect(() => assertStage4CCommitPreconditions(facts({
      verifiedByActorId: RECEIVER.toUpperCase(), verifierRole: 'ADMIN',
    }))).toThrow(/tự xác minh/);
  });
  it('BIZ02-14: missing, malformed or premature verification is rejected', () => {
    for (const changes of [
      { receivedAt: null }, { verifiedAt: null }, { verifiedAt: '2026-11-08' },
      { verifiedAt: '2026-11-07T23:59:00Z' }, { receivedAt: 'invalid' },
    ]) {
      expect(() => assertStage4CCommitPreconditions(facts(changes))).toThrow();
    }
  });
  it('BIZ02-15: TECHNICIAN cannot VERIFY', () => {
    expect(() => assertStage4CCommitPreconditions(facts({
      verifierRole: 'TECHNICIAN',
    }))).toThrow(/quyền/);
  });
  it('BIZ01-16: invalid evidence code denies COMMIT', () => {
    for (const evidenceReference of ['', 'A B', 'BÀN-GIAO', 'A@B', null]) {
      expect(() => assertStage4CCommitPreconditions(facts({ evidenceReference })))
        .toThrow();
    }
  });
  it('BIZ05-17: unresolved PREPARED/RECONCILIATION_REQUIRED blocks second prepare', () => {
    for (const state of ['PREPARED', 'RECONCILIATION_REQUIRED']) {
      expect(() => assertNoPendingStage4COperation([state])).toThrow(/chưa kết thúc/);
    }
    expect(() => assertNoPendingStage4COperation([])).not.toThrow();
    expect(() => assertNoPendingStage4COperation(['COMPLETED', 'CANCELLED']))
      .not.toThrow();
    expect(() => assertNoPendingStage4COperation(['CORRUPTED'])).toThrow();
  });
  it('BIZ05-17B: coerced state objects cannot bypass the pending-operation guard', () => {
    for (const candidate of [
      new String('PREPARED'),
      new String('COMPLETED'),
      ['PREPARED'],
      { toString: () => 'RECONCILIATION_REQUIRED' },
      null, 0, false,
    ]) {
      expect(() => assertNoPendingStage4COperation([candidate])).toThrow();
    }
    expect(() => assertNoPendingStage4COperation(['COMPLETED', 'CANCELLED'])).not.toThrow();
  });
  it('BIZ03-18: QC may release only committed independently verified GOOD', () => {
    expect(() => assertStage4CQcReleaseAllowed({
      role: 'LAB_MANAGER', condition: 'GOOD', committed: true,
      evidenceVerified: true, qcApprovedAt: '2026-11-08T02:00:00Z',
    })).not.toThrow();
  });
  it('BIZ03-19: DAMAGED or LOST never release as GOOD', () => {
    for (const condition of ['DAMAGED', 'LOST', 'UNKNOWN']) {
      expect(() => assertStage4CQcReleaseAllowed({
        role: 'ADMIN', condition, committed: true,
        evidenceVerified: true, qcApprovedAt: '2026-11-08T02:00:00Z',
      })).toThrow();
    }
  });
  it('BIZ04-20: STUDENT and TECHNICIAN cannot approve QC', () => {
    for (const role of ['STUDENT', 'TECHNICIAN']) {
      expect(() => assertStage4CQcReleaseAllowed({
        role, condition: 'GOOD', committed: true,
        evidenceVerified: true, qcApprovedAt: '2026-11-08T02:00:00Z',
      })).toThrow();
    }
  });
  it('BIZ03-21: QC release requires COMMIT, independent evidence and QC timestamp', () => {
    for (const changes of [
      { committed: false }, { evidenceVerified: false }, { qcApprovedAt: null },
    ]) {
      expect(() => assertStage4CQcReleaseAllowed({
        role: 'ADMIN', condition: 'GOOD', committed: true,
        evidenceVerified: true, qcApprovedAt: '2026-11-08T02:00:00Z',
        ...changes,
      })).toThrow();
    }
  });
});
