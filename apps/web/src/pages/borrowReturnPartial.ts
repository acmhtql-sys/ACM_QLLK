export type ReturnCondition = 'GOOD' | 'DAMAGED' | 'LOST';

export interface ReturnInputRow {
  quantity: string;
  condition: ReturnCondition;
}

export interface ReturnBorrowDetail {
  id: string;
  quantity: number;
  returnedQuantity?: number | null;
}

export interface ReturnPayloadItem {
  borrowDetailId: string;
  returnedQuantity: number;
  condition: ReturnCondition;
  notes?: string;
}

export function buildReturnItems(
  details: readonly ReturnBorrowDetail[],
  rows: Record<string, ReturnInputRow>,
  notes = ''
): ReturnPayloadItem[] {
  const items: ReturnPayloadItem[] = [];
  const seen = new Set<string>();

  for (const detail of details) {
    if (seen.has(detail.id)) {
      throw new Error('Phiếu mượn có dòng chi tiết trùng lặp');
    }
    seen.add(detail.id);

    const alreadyReturned = detail.returnedQuantity ?? 0;
    const remaining = detail.quantity - alreadyReturned;

    if (
      !Number.isSafeInteger(detail.quantity) ||
      !Number.isSafeInteger(alreadyReturned) ||
      alreadyReturned < 0 ||
      remaining < 0
    ) {
      throw new Error('Số lượng trong phiếu mượn không hợp lệ');
    }

    const selection = rows[detail.id];
    const rawQuantity = (selection?.quantity ?? '0').trim();

    if (!/^\d+$/.test(rawQuantity)) {
      throw new Error('Số lượng trả phải là số nguyên không âm');
    }

    const quantity = Number(rawQuantity);

    if (!Number.isSafeInteger(quantity) || quantity > remaining) {
      throw new Error('Số lượng trả vượt số lượng còn phải trả');
    }

    if (quantity === 0) continue;

    const condition = selection?.condition ?? 'GOOD';

    if (!['GOOD', 'DAMAGED', 'LOST'].includes(condition)) {
      throw new Error('Tình trạng hoàn trả không hợp lệ');
    }

    items.push({
      borrowDetailId: detail.id,
      returnedQuantity: quantity,
      condition,
      notes: notes.trim() || undefined,
    });
  }

  if (items.length === 0) {
    throw new Error('Hãy chọn ít nhất một linh kiện có số lượng trả lớn hơn 0');
  }

  return items;
}

/** Unique 128-bit key for a single physical return operation. */
export function createReturnIdempotencyKey(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Trình duyệt không hỗ trợ tạo khóa giao dịch an toàn');
  }
  const random = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return 'return_' + Array.from(random, (b) => b.toString(16).padStart(2, '0')).join('');
}
