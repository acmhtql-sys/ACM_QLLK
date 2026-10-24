import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingBorrowReturn,
  listPendingBorrowReturns,
  readPendingBorrowReturn,
  savePendingBorrowReturn,
  listDurableBorrowReturnGuards,
  clearDurableBorrowReturnGuard,
  type PendingBorrowReturn,
} from './borrowReturnPending';

const record = (overrides: Partial<PendingBorrowReturn> = {}): PendingBorrowReturn => ({
  version: 1,
  userId: 'admin-a',
  borrowId: 'borrow-a',
  key: 'return_0123456789abcdef0123456789abcdef',
  payload: { items: [{ borrowDetailId: 'detail-a', returnedQuantity: 1, condition: 'GOOD' }], notes: 'Test' },
  createdAt: 123456789,
  ...overrides,
});

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
  };
}

let storage: Storage;
beforeEach(() => { storage = makeStorage(); });

describe('Phase 11D — persisted return intent', () => {
  it('PEND-01: stores key and complete immutable POST payload', () => {
    const r = record();
    savePendingBorrowReturn(r, storage);
    expect(readPendingBorrowReturn(r.userId, r.borrowId, storage)).toEqual(r);
  });

  it('PEND-02: does not overwrite a pending return with a different intent', () => {
    savePendingBorrowReturn(record(), storage);
    expect(() => savePendingBorrowReturn(record({
      key: 'return_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }), storage)).toThrow(/không ghi đè/);
    expect(readPendingBorrowReturn('admin-a', 'borrow-a', storage)?.key)
      .toBe('return_0123456789abcdef0123456789abcdef');
  });

  it('PEND-03: isolates records by authenticated user', () => {
    savePendingBorrowReturn(record(), storage);
    expect(listPendingBorrowReturns('admin-b', storage)).toEqual([]);
    expect(listPendingBorrowReturns('admin-a', storage)).toHaveLength(1);
  });

  it('PEND-04: rejects corrupted saved payload rather than generating a new key', () => {
    savePendingBorrowReturn(record(), storage);
    storage.setItem('acm:borrow-return-pending:v1:admin-a:borrow-a', 'not json');
    expect(() => readPendingBorrowReturn('admin-a', 'borrow-a', storage)).toThrow();
    expect(() => listPendingBorrowReturns('admin-a', storage)).toThrow();
  });

  it('PEND-05: rejects duplicate line items and invalid return quantities', () => {
    expect(() => savePendingBorrowReturn(record({
      payload: { items: [
        { borrowDetailId: 'x', returnedQuantity: 1, condition: 'GOOD' },
        { borrowDetailId: 'x', returnedQuantity: 1, condition: 'GOOD' },
      ], notes: 'test' },
    }), storage)).toThrow();
    expect(() => savePendingBorrowReturn(record({
      payload: { items: [{ borrowDetailId: 'x', returnedQuantity: -1, condition: 'GOOD' }], notes: 'test' },
    }), storage)).toThrow();
  });

  it('PEND-06: clears only the confirmed borrow intent', () => {
    savePendingBorrowReturn(record(), storage);
    savePendingBorrowReturn(record({ borrowId: 'borrow-b', key: 'return_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }), storage);
    clearPendingBorrowReturn('admin-a', 'borrow-a', record().key, storage);
    expect(readPendingBorrowReturn('admin-a', 'borrow-a', storage)).toBeNull();
    expect(readPendingBorrowReturn('admin-a', 'borrow-b', storage)).not.toBeNull();
  });

  it('PEND-07: aborts when storage rejects writes', () => {
    const rejectingStore = makeStorage();
    rejectingStore.setItem = () => { throw new Error('storage blocked'); };
    expect(() => savePendingBorrowReturn(record(), rejectingStore)).toThrow('storage blocked');
  });
});


describe('Phase 11D — durable lost-session guard (no payload in localStorage)', () => {
  it('GUARD-01: blocks a new key after sessionStorage is lost', () => {
    const session = makeStorage();
    const durable = makeStorage();
    savePendingBorrowReturn(record(), session, durable);
    session.clear(); // tab closed; localStorage survives
    expect(readPendingBorrowReturn('admin-a', 'borrow-a', session, durable)).toBeNull();
    expect(listDurableBorrowReturnGuards('admin-a', durable)).toHaveLength(1);
    expect(() => savePendingBorrowReturn(record({ key: 'return_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }), session, durable))
      .toThrow(/chưa đối soát/);
  });

  it('GUARD-02: stores only minimal metadata, never item payload or notes', () => {
    const session = makeStorage();
    const durable = makeStorage();
    savePendingBorrowReturn(record(), session, durable);
    const serialized = durable.getItem('acm:borrow-return-guard:v1:admin-a:borrow-a') || '';
    expect(serialized).toContain('return_0123456789abcdef0123456789abcdef');
    expect(serialized).not.toContain('detail-a');
    expect(serialized).not.toContain('Test');
    expect(serialized).not.toContain('payload');
  });

  it('GUARD-03: hides another actor guards from the current actor list', () => {
    const session = makeStorage();
    const durable = makeStorage();
    savePendingBorrowReturn(record(), session, durable);
    expect(listDurableBorrowReturnGuards('admin-b', durable)).toEqual([]);
  });

  it('GUARD-04: refuses a corrupted or mismatched durable guard', () => {
    const session = makeStorage();
    const durable = makeStorage();
    savePendingBorrowReturn(record(), session, durable);
    durable.setItem('acm:borrow-return-guard:v1:admin-a:borrow-a', 'broken json');
    expect(() => readPendingBorrowReturn('admin-a', 'borrow-a', session, durable)).toThrow(/dấu chặn/i);
    expect(() => savePendingBorrowReturn(record({ key: 'return_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }), makeStorage(), durable)).toThrow();
  });

  it('GUARD-05: if durable storage refuses writes, no POST intent is saved in session', () => {
    const session = makeStorage();
    const durable = makeStorage();
    durable.setItem = () => { throw new Error('localStorage denied'); };
    expect(() => savePendingBorrowReturn(record(), session, durable)).toThrow('localStorage denied');
    expect(session.length).toBe(0);
  });

  it('GUARD-06: backfills the guard for a pre-upgrade session intent without changing payload', () => {
    const session = makeStorage();
    const durable = makeStorage();
    session.setItem('acm:borrow-return-pending:v1:admin-a:borrow-a', JSON.stringify(record()));
    expect(readPendingBorrowReturn('admin-a', 'borrow-a', session, durable)).toEqual(record());
    expect(listDurableBorrowReturnGuards('admin-a', durable)[0].key).toBe(record().key);
  });

  it('GUARD-07: clearing durable metadata requires the exact known key', () => {
    const session = makeStorage();
    const durable = makeStorage();
    savePendingBorrowReturn(record(), session, durable);
    session.clear();
    expect(() => clearDurableBorrowReturnGuard('admin-a', 'borrow-a', 'return_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', durable))
      .toThrow(/không khớp/);
    expect(listDurableBorrowReturnGuards('admin-a', durable)).toHaveLength(1);
    clearDurableBorrowReturnGuard('admin-a', 'borrow-a', record().key, durable);
    expect(listDurableBorrowReturnGuards('admin-a', durable)).toHaveLength(0);
  });

  it('GUARD-08: successful confirmed clear removes session and durable guard together', () => {
    const session = makeStorage();
    const durable = makeStorage();
    savePendingBorrowReturn(record(), session, durable);
    clearPendingBorrowReturn('admin-a', 'borrow-a', record().key, session, durable);
    expect(readPendingBorrowReturn('admin-a', 'borrow-a', session, durable)).toBeNull();
    expect(listDurableBorrowReturnGuards('admin-a', durable)).toEqual([]);
  });

  it('GUARD-09: default browser storage keeps payload only in session, guard only in local', () => {
    const session = makeStorage();
    const durable = makeStorage();
    vi.stubGlobal('window', { sessionStorage: session, localStorage: durable });
    try {
      savePendingBorrowReturn(record());
      expect(session.length).toBe(1);
      expect(durable.length).toBe(1);
      expect(listPendingBorrowReturns('admin-a')).toHaveLength(1);
      expect(session.length).toBe(1);
      expect(durable.length).toBe(1);
      expect(session.key(0)).toBe('acm:borrow-return-pending:v1:admin-a:borrow-a');
      expect(durable.key(0)).toBe('acm:borrow-return-guard:v1:admin-a:borrow-a');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('GUARD-10: confirmed clear of default browser stores permits a new return key', () => {
    const session = makeStorage();
    const durable = makeStorage();
    vi.stubGlobal('window', { sessionStorage: session, localStorage: durable });
    try {
      savePendingBorrowReturn(record());
      expect(listPendingBorrowReturns('admin-a')).toHaveLength(1);
      clearPendingBorrowReturn('admin-a', 'borrow-a', record().key);
      expect(session.length).toBe(0);
      expect(durable.length).toBe(0);
      const next = record({ key: 'return_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
      savePendingBorrowReturn(next);
      expect(readPendingBorrowReturn('admin-a', 'borrow-a')).toEqual(next);
      expect(session.length).toBe(1);
      expect(durable.length).toBe(1);
      expect(listPendingBorrowReturns('admin-a')[0].key).toBe(next.key);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});


describe('Phase 11D — Stage 4A exact-key cleanup across tabs', () => {
  const anotherKey = 'return_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  it('GUARD-11: stale K1 completion cannot clear a newer K2 guard created in another tab', () => {
    const tabA = makeStorage();
    const tabB = makeStorage();
    const durable = makeStorage();
    const first = record();
    savePendingBorrowReturn(first, tabA, durable);
    // Tab B verifies K1 on the server and releases only its durable guard.
    clearDurableBorrowReturnGuard(first.userId, first.borrowId, first.key, durable);
    const next = record({ key: anotherKey, createdAt: 123456790 });
    savePendingBorrowReturn(next, tabB, durable);
    // Tab A receives an old K1 response after K2 has begun: reject before any removal.
    expect(() => clearPendingBorrowReturn(first.userId, first.borrowId, first.key, tabA, durable))
      .toThrow(/Dấu chặn hoàn trả đã thay đổi/);
    expect(tabA.getItem('acm:borrow-return-pending:v1:admin-a:borrow-a')).toContain(first.key);
    expect(readPendingBorrowReturn(next.userId, next.borrowId, tabB, durable)).toEqual(next);
    expect(listDurableBorrowReturnGuards('admin-a', durable)[0].key).toBe(next.key);
  });

  it('GUARD-12: a wrong expected key cannot remove session data or the durable guard', () => {
    const session = makeStorage();
    const durable = makeStorage();
    const first = record();
    savePendingBorrowReturn(first, session, durable);
    expect(() => clearPendingBorrowReturn(first.userId, first.borrowId, anotherKey, session, durable))
      .toThrow(/Khóa giao dịch trong phiên đã thay đổi/);
    expect(readPendingBorrowReturn(first.userId, first.borrowId, session, durable)).toEqual(first);
    expect(listDurableBorrowReturnGuards('admin-a', durable)[0].key).toBe(first.key);
  });

  it('GUARD-13: no session intent must never authorize deleting a durable guard', () => {
    const session = makeStorage();
    const durable = makeStorage();
    const first = record();
    savePendingBorrowReturn(first, session, durable);
    session.clear();
    expect(() => clearPendingBorrowReturn(first.userId, first.borrowId, first.key, session, durable))
      .toThrow(/Không tìm thấy giao dịch gốc/);
    expect(listDurableBorrowReturnGuards('admin-a', durable)[0].key).toBe(first.key);
  });

  it('GUARD-14: malformed or missing expected key is rejected before any mutation', () => {
    const session = makeStorage();
    const durable = makeStorage();
    const first = record();
    savePendingBorrowReturn(first, session, durable);
    expect(() => clearPendingBorrowReturn(first.userId, first.borrowId, '', session, durable))
      .toThrow(/không hợp lệ/);
    expect(readPendingBorrowReturn(first.userId, first.borrowId, session, durable)).toEqual(first);
    expect(listDurableBorrowReturnGuards('admin-a', durable)[0].key).toBe(first.key);
  });
});


describe('Phase 11D — Stage 4B failed session write is safe', () => {
  it('GUARD-15: rejected session write rolls back only its guard before POST', () => {
    const session = makeStorage();
    const durable = makeStorage();
    session.setItem = () => { throw new Error('session quota'); };
    expect(() => savePendingBorrowReturn(record(), session, durable)).toThrow('session quota');
    expect(session.length).toBe(0);
    expect(listDurableBorrowReturnGuards('admin-a', durable)).toEqual([]);
    const fresh = makeStorage();
    const next = record({ key: 'return_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
    savePendingBorrowReturn(next, fresh, durable);
    expect(readPendingBorrowReturn('admin-a', 'borrow-a', fresh, durable)).toEqual(next);
  });

  it('GUARD-16: partial session write that throws retains original key and guard', () => {
    const session = makeStorage();
    const durable = makeStorage();
    const normalSet = session.setItem.bind(session);
    session.setItem = (key, value) => { normalSet(key, value); throw new Error('write interrupted'); };
    expect(() => savePendingBorrowReturn(record(), session, durable)).toThrow('write interrupted');
    expect(session.getItem('acm:borrow-return-pending:v1:admin-a:borrow-a')).toContain(record().key);
    expect(listDurableBorrowReturnGuards('admin-a', durable)[0].key).toBe(record().key);
  });

  it('GUARD-17: rollback failure retains durable guard and blocks a new key', () => {
    const session = makeStorage();
    const durable = makeStorage();
    session.setItem = () => { throw new Error('session denied'); };
    durable.removeItem = () => { throw new Error('durable removal denied'); };
    expect(() => savePendingBorrowReturn(record(), session, durable)).toThrow('session denied');
    expect(listDurableBorrowReturnGuards('admin-a', durable)[0].key).toBe(record().key);
    expect(() => savePendingBorrowReturn(
      record({ key: 'return_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }), makeStorage(), durable,
    )).toThrow(/chưa đối soát/);
  });
});
