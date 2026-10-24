/** Phase 11D — recover an ambiguous borrow-return POST without changing its key or body.
 * The original payload stays in sessionStorage. A minimal guard survives tab closure in localStorage; never silently discard it.
 */
export type ReturnConditionStored = 'GOOD' | 'DAMAGED' | 'LOST';
export interface PendingReturnItem {
  borrowDetailId: string;
  returnedQuantity: number;
  condition: ReturnConditionStored;
  locationId?: string | null;
  notes?: string | null;
}
export interface PendingReturnPayload {
  items: PendingReturnItem[];
  notes: string;
}
export interface PendingBorrowReturn {
  version: 1;
  userId: string;
  borrowId: string;
  key: string;
  payload: PendingReturnPayload;
  createdAt: number;
}

const PREFIX = 'acm:borrow-return-pending:v1:';
const GUARD_PREFIX = 'acm:borrow-return-guard:v1:';

/** A guard contains no return item, note or payload; it prevents silently minting a new key. */
export interface DurableBorrowReturnGuard {
  version: 1;
  userId: string;
  borrowId: string;
  key: string;
  createdAt: number;
}
const headerKeyPattern = /^return_[0-9a-f]{32}$/;

const storeFor = (store?: Storage): Storage => {
  if (store) return store;
  if (typeof window === 'undefined') {
    throw new Error('Không có bộ nhớ phiên giao dịch trong môi trường này');
  }
  return window.sessionStorage;
};

/** Tests can supply two distinct stores. A supplied legacy test store is used for both. */
const durableFor = (session?: Storage, durable?: Storage): Storage => {
  if (durable) return durable;
  if (session) return session;
  if (typeof window === 'undefined') {
    throw new Error('Không có kho lưu dấu chặn hoàn trả bền vững');
  }
  return window.localStorage;
};

const storageKey = (userId: string, borrowId: string): string => {
  if (!userId || !borrowId || userId.includes(':') || borrowId.includes(':')) {
    throw new Error('Thiếu thông tin người dùng hoặc phiếu mượn');
  }
  return `${PREFIX}${userId}:${borrowId}`;
};

const durableKey = (userId: string, borrowId: string): string =>
  storageKey(userId, borrowId).replace(PREFIX, GUARD_PREFIX);

const toGuard = (record: PendingBorrowReturn): DurableBorrowReturnGuard => ({
  version: 1,
  userId: record.userId,
  borrowId: record.borrowId,
  key: record.key,
  createdAt: record.createdAt,
});

function validateGuard(raw: string, userId: string, borrowId: string): DurableBorrowReturnGuard {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Dấu chặn hoàn trả bị hỏng — cần đối soát'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Dấu chặn hoàn trả không hợp lệ — cần đối soát');
  }
  const guard = parsed as DurableBorrowReturnGuard;
  if (guard.version !== 1 || guard.userId !== userId || guard.borrowId !== borrowId ||
      !headerKeyPattern.test(guard.key) || !Number.isFinite(guard.createdAt)) {
    throw new Error('Dấu chặn hoàn trả không khớp tài khoản hoặc phiếu — cần đối soát');
  }
  return guard;
}

function readGuard(userId: string, borrowId: string, durableStore: Storage): DurableBorrowReturnGuard | null {
  const raw = durableStore.getItem(durableKey(userId, borrowId));
  return raw === null ? null : validateGuard(raw, userId, borrowId);
}

function ensureGuard(record: PendingBorrowReturn, durableStore: Storage): void {
  const existing = readGuard(record.userId, record.borrowId, durableStore);
  const expected = toGuard(record);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(expected)) {
      throw new Error('Dấu chặn hoàn trả không khớp giao dịch đã lưu — cần đối soát');
    }
    return;
  }
  const key = durableKey(record.userId, record.borrowId);
  durableStore.setItem(key, JSON.stringify(expected));
  // Fail closed if the browser silently drops the durable write.
  const stored = readGuard(record.userId, record.borrowId, durableStore);
  if (!stored || JSON.stringify(stored) !== JSON.stringify(expected)) {
    throw new Error('Không thể lưu dấu chặn hoàn trả bền vững; không gửi API');
  }
}

/** Read only metadata for a user. No return payload is stored in localStorage. */
export function listDurableBorrowReturnGuards(userId: string, durableStore?: Storage): DurableBorrowReturnGuard[] {
  if (!userId || userId.includes(':')) throw new Error('Thiếu người dùng hiện tại');
  const s = durableFor(undefined, durableStore);
  const prefix = `${GUARD_PREFIX}${userId}:`;
  const guards: DurableBorrowReturnGuard[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (key?.startsWith(prefix)) {
      const borrowId = key.slice(prefix.length);
      guards.push(validateGuard(s.getItem(key) ?? '', userId, borrowId));
    }
  }
  return guards.sort((a, b) => a.createdAt - b.createdAt);
}

/** Only caller that has verified a matching server receipt may clear a recovered guard. */
export function clearDurableBorrowReturnGuard(
  userId: string, borrowId: string, expectedKey: string, durableStore?: Storage
): void {
  const s = durableFor(undefined, durableStore);
  const saved = readGuard(userId, borrowId, s);
  if (!saved || saved.key !== expectedKey) {
    throw new Error('Khóa dấu chặn không khớp — không thể xóa');
  }
  const k = durableKey(userId, borrowId);
  s.removeItem(k);
  if (s.getItem(k) !== null) throw new Error('Không thể xóa dấu chặn hoàn trả');
}

function validate(record: unknown, userId: string, borrowId: string): PendingBorrowReturn {
  if (!record || typeof record !== 'object') {
    throw new Error('Dữ liệu hoàn trả đã lưu không hợp lệ — cần kiểm tra thủ công');
  }
  const r = record as PendingBorrowReturn;
  const validItems = Array.isArray(r.payload?.items) && r.payload.items.length > 0 &&
    r.payload.items.every(i =>
      i !== null && typeof i === 'object' && typeof i.borrowDetailId === 'string' &&
      i.borrowDetailId.length > 0 && Number.isSafeInteger(i.returnedQuantity) &&
      i.returnedQuantity > 0 && ['GOOD', 'DAMAGED', 'LOST'].includes(i.condition) &&
      (i.locationId === undefined || i.locationId === null || typeof i.locationId === 'string') &&
      (i.notes === undefined || i.notes === null || typeof i.notes === 'string')
    );
  if (r.version !== 1 || r.userId !== userId || r.borrowId !== borrowId ||
      !headerKeyPattern.test(r.key) || !validItems ||
      typeof r.payload.notes !== 'string' || !Number.isFinite(r.createdAt)) {
    throw new Error('Dữ liệu hoàn trả đã lưu không hợp lệ — không thể gửi yêu cầu mới');
  }
  const ids = r.payload.items.map(i => i.borrowDetailId);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Dữ liệu hoàn trả đã lưu có chi tiết trùng lặp');
  }
  return r;
}

export function readPendingBorrowReturn(
  userId: string, borrowId: string, store?: Storage, durableStore?: Storage
): PendingBorrowReturn | null {
  const s = storeFor(store);
  const d = durableFor(store, durableStore);
  const raw = s.getItem(storageKey(userId, borrowId));
  if (raw === null) {
    // The durable guard may survive sessionStorage loss. A later save must refuse to replace it.
    readGuard(userId, borrowId, d);
    return null;
  }
  try {
    const record = validate(JSON.parse(raw), userId, borrowId);
    // Backfill guards for pre-upgrade pending requests, without ever changing their key/payload.
    ensureGuard(record, d);
    return record;
  } catch (err) {
    throw new Error('Không đọc được yêu cầu hoàn trả đã lưu: ' +
      (err instanceof Error ? err.message : 'dữ liệu hỏng'));
  }
}

export function listPendingBorrowReturns(
  userId: string, store?: Storage, durableStore?: Storage
): PendingBorrowReturn[] {
  if (!userId || userId.includes(':')) throw new Error('Thiếu người dùng hiện tại');
  const s = storeFor(store);
  const d = durableFor(store, durableStore);
  const prefix = `${PREFIX}${userId}:`;
  const result: PendingBorrowReturn[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (key?.startsWith(prefix)) {
      const borrowId = key.slice(prefix.length);
      const record = readPendingBorrowReturn(userId, borrowId, s, d);
      if (!record) throw new Error('Yêu cầu hoàn trả đang được thay đổi; vui lòng tải lại trang');
      result.push(record);
    }
  }
  return result.sort((a, b) => a.createdAt - b.createdAt);
}

export function savePendingBorrowReturn(
  record: PendingBorrowReturn, store?: Storage, durableStore?: Storage
): void {
  const s = storeFor(store);
  const d = durableFor(store, durableStore);
  const key = storageKey(record.userId, record.borrowId);
  validate(record, record.userId, record.borrowId);
  if (s.getItem(key) !== null) {
    throw new Error('Phiếu này đã có yêu cầu hoàn trả chờ xác nhận; không ghi đè');
  }
  // A guard with no session payload means the original request may have committed.
  if (readGuard(record.userId, record.borrowId, d)) {
    throw new Error('Phiếu có giao dịch từ phiên trước chưa đối soát; không tạo khóa mới');
  }
  // Durable guard FIRST. No POST is permitted until BOTH stores have been verified.
  ensureGuard(record, d);
  try {
    s.setItem(key, JSON.stringify(record));
    const checked = readPendingBorrowReturn(record.userId, record.borrowId, s, d);
    if (!checked || JSON.stringify(checked) !== JSON.stringify(record)) {
      throw new Error('Không thể lưu an toàn yêu cầu hoàn trả trước khi gửi');
    }
  } catch (err) {
    // The API has not been called. A failed/silently dropped session write with
    // NO saved payload may roll back ONLY this exact newly-written guard.
    // If reading session state, guard comparison, or cleanup fails, retain the
    // guard and fail closed rather than guessing that it is safe to POST.
    let definitelyNoSessionCopy = false;
    try { definitelyNoSessionCopy = s.getItem(key) === null; } catch { /* uncertain storage */ }
    if (definitelyNoSessionCopy) {
      try { clearDurableBorrowReturnGuard(record.userId, record.borrowId, record.key, d); }
      catch { /* keep unresolved guard on any failure */ }
    }
    throw err;
  }
}

/** A receipt or operator reconciliation can clear ONLY its own exact persisted key.
 * Do not remove anything if another tab has already replaced the durable guard.
 */
export function clearPendingBorrowReturn(
  userId: string, borrowId: string, expectedKey: string, store?: Storage, durableStore?: Storage
): void {
  const s = storeFor(store);
  const d = durableFor(store, durableStore);
  const key = storageKey(userId, borrowId);
  if (!headerKeyPattern.test(expectedKey)) {
    throw new Error('Khóa giao dịch cần xóa không hợp lệ — giữ nguyên yêu cầu đã lưu');
  }
  const raw = s.getItem(key);
  if (raw === null) {
    throw new Error('Không tìm thấy giao dịch gốc trong phiên — không thể xóa an toàn');
  }
  let saved: PendingBorrowReturn;
  try {
    saved = validate(JSON.parse(raw), userId, borrowId);
  } catch {
    throw new Error('Giao dịch gốc đã lưu bị hỏng — không thể xóa an toàn');
  }
  if (saved.key !== expectedKey) {
    throw new Error('Khóa giao dịch trong phiên đã thay đổi — không thể xóa');
  }
  const guard = readGuard(userId, borrowId, d);
  if (!guard || guard.key !== expectedKey) {
    throw new Error('Dấu chặn hoàn trả đã thay đổi — giữ nguyên giao dịch để đối soát');
  }
  // Delete the verified session intent first. A failed/interrupted cleanup
  // leaves the durable guard in place (fail closed).
  s.removeItem(key);
  if (s.getItem(key) !== null) throw new Error('Không thể xóa yêu cầu hoàn trả trong phiên');
  // Revalidate the exact expected key. Never clear a newer guard using its own key.
  clearDurableBorrowReturnGuard(userId, borrowId, expectedKey, d);
}
