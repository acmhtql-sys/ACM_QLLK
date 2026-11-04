/** Phase 11D Stage 2B — validate an authenticated read-only status response before releasing a lost-session guard. */
export type ReconciliationDecision =
  | { kind: 'COMPLETED'; returnNumber: string }
  | { kind: 'UNRESOLVED'; message: string };

type RecordLike = Record<string, unknown>;
const objectLike = (value: unknown): value is RecordLike =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Missing keys, malformed envelopes and non-final server states never permit a new return POST. */
export function inspectBorrowReturnStatusResponse(
  response: unknown, expectedBorrowId: string
): ReconciliationDecision {
  const unresolved = (message: string): ReconciliationDecision => ({ kind: 'UNRESOLVED', message });
  if (!expectedBorrowId || !objectLike(response) || response.success !== true || !objectLike(response.data)) {
    return unresolved('Phản hồi đối soát không hợp lệ. Giữ nguyên dấu chặn và liên hệ quản trị viên.');
  }
  const data = response.data;
  if (data.state === 'COMPLETED') {
    if (data.requiresReconciliation !== false || !objectLike(data.receipt) ||
        data.receipt.borrowRequestId !== expectedBorrowId ||
        typeof data.receipt.returnNumber !== 'string' || !data.receipt.returnNumber.trim()) {
      return unresolved('Biên nhận hoàn trả không hợp lệ hoặc không khớp phiếu. Giữ nguyên dấu chặn.');
    }
    return { kind: 'COMPLETED', returnNumber: data.receipt.returnNumber };
  }
  if (data.requiresReconciliation === true && typeof data.state === 'string') {
    switch (data.state) {
      case 'NOT_FOUND':
        return unresolved('Không tìm thấy khóa trên máy chủ; đây không phải bằng chứng chưa ghi kho. Cần đối soát thủ công.');
      case 'PENDING':
        return unresolved('Máy chủ báo giao dịch còn đang xử lý. Không gửi giao dịch mới.');
      case 'FAILED':
        return unresolved('Máy chủ báo trạng thái thất bại; cần đối soát trước khi mở khóa.');
      case 'NEEDS_RECONCILIATION':
        return unresolved('Máy chủ yêu cầu đối soát thủ công. Không gửi giao dịch mới.');
    }
  }
  return unresolved('Trạng thái đối soát không xác định. Giữ nguyên dấu chặn.');
}
