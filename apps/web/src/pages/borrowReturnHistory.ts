/** Read-only history inspection. Never equate an empty list with proof that a lost POST was not committed. */
export interface ReturnHistoryItem {
  itemLabel: string;
  quantity: number;
  condition: 'GOOD' | 'DAMAGED' | 'LOST';
}
export interface ReturnHistoryEntry {
  id: string;
  returnNumber: string;
  createdAt: string;
  receiverName: string;
  details: ReturnHistoryItem[];
}
const object = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === 'object' && !Array.isArray(v));

export function inspectReturnHistoryResponse(envelope: unknown, borrowId: string): ReturnHistoryEntry[] {
  if (!object(envelope) || envelope.success !== true || !object(envelope.data)) {
    throw new Error('Máy chủ không xác nhận dữ liệu lịch sử hoàn trả');
  }
  const data = envelope.data;
  if (data.id !== borrowId || !Array.isArray(data.returnTransactions)) {
    throw new Error('Lịch sử hoàn trả không khớp mã phiếu');
  }
  const entries: ReturnHistoryEntry[] = data.returnTransactions.map((raw: unknown) => {
    if (!object(raw) || typeof raw.id !== 'string' || !raw.id ||
        raw.borrowRequestId !== borrowId || typeof raw.returnNumber !== 'string' ||
        !raw.returnNumber.trim() || typeof raw.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(raw.createdAt)) || !Array.isArray(raw.details)) {
      throw new Error('Dữ liệu lịch sử hoàn trả không hợp lệ; cần đối soát');
    }
    const details = raw.details.map((line: unknown): ReturnHistoryItem => {
      if (!object(line) || !Number.isSafeInteger(line.quantity) || (line.quantity as number) <= 0 ||
          !['GOOD', 'DAMAGED', 'LOST'].includes(String(line.condition))) {
        throw new Error('Chi tiết lịch sử hoàn trả không hợp lệ; cần đối soát');
      }
      const item = object(line.item) ? line.item : null;
      const label = item && typeof item.code === 'string' && item.code.trim()
        ? item.code : typeof line.itemId === 'string' && line.itemId.trim() ? line.itemId : 'Không rõ linh kiện';
      return { itemLabel: label, quantity: line.quantity as number,
        condition: line.condition as ReturnHistoryItem['condition'] };
    });
    const receiver = object(raw.receiver) ? raw.receiver : null;
    return {
      id: raw.id as string,
      returnNumber: raw.returnNumber as string,
      createdAt: raw.createdAt as string,
      receiverName: receiver && typeof receiver.fullName === 'string' ? receiver.fullName : 'Không rõ',
      details,
    };
  });
  return entries.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
