import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  AlertCircle,
  RefreshCw,
  ArrowLeftRight,
  ShieldAlert,
  ArrowRight,
  Check,
  CheckCircle2,
  Package,
} from 'lucide-react';
import { z } from 'zod';
import {
  TransferStockInput,
  ItemResponse,
  LocationResponse,
  StockBalanceResponse,
  calculateAvailableStock,
  UserRole,
} from '@acm/shared';
import { useIdempotentTransaction } from '../../hooks/useIdempotentTransaction';
import { stockTransactionsService } from '../../services/stock-transactions.service';
import { isStockTransactionWriteEnabled } from '../../config/features';
import { canPerformStockMutation } from '../../services/stock-rbac';

export interface TransferItemLine {
  itemId: string;
  fromLocationId?: string;
  toLocationId?: string;
  quantity: number | '';
  notes?: string | null;
}

export interface StockTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: ItemResponse[];
  locations: LocationResponse[];
  balances: StockBalanceResponse[];
  userId: string;
  userRole?: UserRole | string;
  onSuccess: (result: any) => void;
}

// Zod validation schema for client transfer form (strictly requires UUIDs)
const clientTransferItemSchema = z
  .object({
    itemId: z.string().trim().guid('Vui lòng chọn linh kiện hợp lệ (UUID).'),
    fromLocationId: z.string().trim().guid('Vui lòng chọn vị trí nguồn hợp lệ (UUID).'),
    toLocationId: z.string().trim().guid('Vui lòng chọn vị trí đích hợp lệ (UUID).'),
    quantity: z
      .number({ error: 'Số lượng phải là số nguyên dương lớn hơn 0.' })
      .int('Số lượng phải là số nguyên dương lớn hơn 0.')
      .positive('Số lượng phải là số nguyên dương lớn hơn 0.'),
    notes: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự.').optional().nullable(),
  })
  .strict();

const clientTransferSchema = z
  .object({
    fromLocationId: z.string().trim().optional(),
    toLocationId: z.string().trim().optional(),
    reason: z
      .string({ error: 'Lý do điều chuyển là bắt buộc và phải có ít nhất 5 ký tự.' })
      .trim()
      .min(5, 'Lý do điều chuyển là bắt buộc và phải có ít nhất 5 ký tự.')
      .max(500, 'Lý do điều chuyển tối đa 500 ký tự.'),
    notes: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự.').optional().nullable(),
    items: z
      .array(clientTransferItemSchema)
      .min(1, 'Phiếu điều chuyển kho phải có ít nhất 1 mặt hàng.')
      .max(100, 'Phiếu điều chuyển kho tối đa 100 mặt hàng mỗi lần.'),
  })
  .strict();

export const StockTransferModal: React.FC<StockTransferModalProps> = ({
  isOpen,
  onClose,
  items,
  locations,
  balances,
  userId,
  userRole,
  onSuccess,
}) => {
  const [headerFromLoc, setHeaderFromLoc] = useState('');
  const [headerToLoc, setHeaderToLoc] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<TransferItemLine[]>([
    { itemId: '', fromLocationId: '', toLocationId: '', quantity: 1, notes: '' },
  ]);
  const [clientErrors, setClientErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isConfirming, setIsConfirming] = useState(false);

  // Authoritative Reconciliation state
  const [reconcileOutcome, setReconcileOutcome] = useState<'TRANSACTION_CONFIRMED_UNEXECUTED' | 'TRANSACTION_ALREADY_SUCCEEDED'>('TRANSACTION_CONFIRMED_UNEXECUTED');
  const [reconcileAuditTicket, setReconcileAuditTicket] = useState('');
  const [reconcileAuthorizedBy, setReconcileAuthorizedBy] = useState('');
  const [reconcileToken, setReconcileToken] = useState('');
  const [reconcileEvidence, setReconcileEvidence] = useState('');
  const [reconcileTxId, setReconcileTxId] = useState('');
  const [reconcileTxNumber, setReconcileTxNumber] = useState('');
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const activeItems = useMemo(() => items.filter((it) => it.isActive), [items]);
  const activeLocations = useMemo(() => locations.filter((loc) => loc.isActive), [locations]);

  // Balance lookup map: key = `${itemId}:${locationId}`
  const balanceMap = useMemo(() => {
    const map = new Map<string, StockBalanceResponse>();
    for (const b of balances) {
      map.set(`${b.itemId}:${b.locationId}`, b);
    }
    return map;
  }, [balances]);

  // Compute aggregated quantities across lines sharing (itemId, fromLocationId)
  const aggregatedRequests = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lines) {
      const fromLoc = l.fromLocationId || headerFromLoc;
      if (l.itemId && fromLoc && typeof l.quantity === 'number' && l.quantity > 0) {
        const key = `${l.itemId}:${fromLoc}`;
        map.set(key, (map.get(key) || 0) + Number(l.quantity));
      }
    }
    return map;
  }, [lines, headerFromLoc]);

  const getAvailableStock = (itemId: string, locationId: string): number => {
    if (!itemId || !locationId) return 0;
    const balance = balanceMap.get(`${itemId}:${locationId}`);
    if (!balance) return 0;
    return calculateAvailableStock({
      onHand: balance.onHand,
      reserved: balance.reserved,
      quarantined: balance.quarantined,
      kitAllocated: balance.kitAllocated,
      borrowed: balance.borrowed,
    });
  };

  // Idempotency FSM Hook
  const fsm = useIdempotentTransaction<TransferStockInput, any>({
    endpoint: '/api/v1/stock-transactions/transfer',
    userId,
    onSuccess: (result) => {
      onSuccess(result);
      handleClose();
    },
  });

  const handleClose = () => {
    fsm.resetToDraft();
    setHeaderFromLoc('');
    setHeaderToLoc('');
    setReason('');
    setNotes('');
    setLines([{ itemId: '', fromLocationId: '', toLocationId: '', quantity: 1, notes: '' }]);
    setClientErrors([]);
    setFieldErrors({});
    setIsConfirming(false);
    setReconcileOutcome('TRANSACTION_CONFIRMED_UNEXECUTED');
    setReconcileAuditTicket('');
    setReconcileAuthorizedBy('');
    setReconcileToken('');
    setReconcileEvidence('');
    setReconcileTxId('');
    setReconcileTxNumber('');
    setReconcileError(null);
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !fsm.isSubmitting) {
        handleClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, fsm.isSubmitting]);

  if (!isOpen) return null;

  // Strict Fail-Closed Verification: Missing role or non-mutation role evaluates to false!
  const writeEnabled = isStockTransactionWriteEnabled();
  const isRoleAllowed = canPerformStockMutation(userRole);
  const isOperationBlocked = !writeEnabled || !isRoleAllowed;

  const handleResolveReconciliation = () => {
    setReconcileError(null);
    const success = fsm.resolveReconciliation();

    if (!success) {
      // Never display an old 409 message as evidence that manual reconciliation was accepted.
      // The client cannot provide authoritative proof or release the transaction lock.
      setReconcileError(
        'Chức năng giải phóng đối soát thủ công từ giao diện người dùng đã bị vô hiệu hóa vì lý do an toàn. Cần dịch vụ xác minh có thẩm quyền từ máy chủ.'
      );
    }
  };

  const handleAddLine = () => {
    if (lines.length >= 100) return;
    if (isConfirming) setIsConfirming(false);
    setLines([
      ...lines,
      {
        itemId: '',
        fromLocationId: headerFromLoc || '',
        toLocationId: headerToLoc || '',
        quantity: 1,
        notes: '',
      },
    ]);
  };

  const handleRemoveLine = (index: number) => {
    if (lines.length <= 1) return;
    if (isConfirming) setIsConfirming(false);
    setLines(lines.filter((_, i) => i !== index));
    setFieldErrors({});
  };

  const handleLineChange = (index: number, field: keyof TransferItemLine, value: any) => {
    if (isConfirming) setIsConfirming(false);
    const updated = [...lines];
    updated[index] = { ...updated[index], [field]: value };
    setLines(updated);
    if (fieldErrors[`items.${index}.${field}`]) {
      const newErrors = { ...fieldErrors };
      delete newErrors[`items.${index}.${field}`];
      setFieldErrors(newErrors);
    }
  };

  const validateForm = (): TransferStockInput | null => {
    const errors: string[] = [];
    const fields: Record<string, string> = {};

    // Check header identical locations if both specified
    if (headerFromLoc && headerToLoc && headerFromLoc === headerToLoc) {
      const msg = 'Vị trí nguồn và vị trí đích mặc định ở đầu phiếu không được trùng nhau.';
      fields['headerToLoc'] = msg;
      errors.push(msg);
    }

    const rawPayload = {
      fromLocationId: headerFromLoc || undefined,
      toLocationId: headerToLoc || undefined,
      reason: reason.trim(),
      notes: notes.trim() || null,
      items: lines.map((l) => ({
        itemId: l.itemId,
        fromLocationId: l.fromLocationId || headerFromLoc || '',
        toLocationId: l.toLocationId || headerToLoc || '',
        quantity: l.quantity === '' ? 0 : Number(l.quantity),
        notes: l.notes?.trim() || null,
      })),
    };

    // 1. Zod Schema Validation
    const parseResult = clientTransferSchema.safeParse(rawPayload);

    if (!parseResult.success) {
      for (const issue of parseResult.error.issues) {
        const path = issue.path.join('.');
        if (path === 'reason') {
          fields[path] = 'Vui lòng nhập tối thiểu 5 ký tự.';
        } else if (path.endsWith('.itemId')) {
          fields[path] = issue.message || 'Vui lòng chọn linh kiện hợp lệ (UUID).';
        } else if (path.endsWith('.fromLocationId')) {
          fields[path] = issue.message || 'Vui lòng chọn vị trí nguồn hợp lệ (UUID).';
        } else if (path.endsWith('.toLocationId')) {
          fields[path] = issue.message || 'Vui lòng chọn vị trí đích hợp lệ (UUID).';
        } else {
          fields[path] = issue.message;
        }
        if (!errors.includes(issue.message)) {
          errors.push(issue.message);
        }
      }
    }

    // 2. Individual line checks & source availability
    lines.forEach((line, idx) => {
      const from = line.fromLocationId || headerFromLoc;
      const to = line.toLocationId || headerToLoc;

      if (from && to && from === to) {
        const msg = 'Vị trí nguồn và vị trí đích không được trùng nhau.';
        fields[`items.${idx}.toLocationId`] = 'Vị trí nguồn và đích bị trùng';
        if (!errors.includes(msg)) errors.push(msg);
      }

      if (line.itemId && from) {
        const available = getAvailableStock(line.itemId, from);
        const qty = Number(line.quantity) || 0;
        if (qty > available) {
          const msg = `Số lượng điều chuyển (${qty}) vượt quá tồn khả dụng (${available}) tại vị trí nguồn.`;
          fields[`items.${idx}.quantity`] = msg;
          if (!errors.includes(msg)) errors.push(msg);
        }
      }
    });

    // 3. Aggregate Over-Available check
    aggregatedRequests.forEach((totalRequested, key) => {
      const [itemId, fromLoc] = key.split(':');
      const available = getAvailableStock(itemId, fromLoc);
      if (totalRequested > available) {
        const itemObj = activeItems.find((it) => it.id === itemId);
        const locObj = activeLocations.find((l) => l.id === fromLoc);
        const msg = `Tổng số lượng điều chuyển của linh kiện '${itemObj?.code || itemId}' từ vị trí nguồn '${
          locObj?.code || fromLoc
        }' (${totalRequested}) vượt quá tồn khả dụng (${available})`;
        if (!errors.includes(msg)) errors.push(msg);
      }
    });

    if (errors.length > 0) {
      setFieldErrors(fields);
      setClientErrors(errors);
      return null;
    }

    setFieldErrors({});
    setClientErrors([]);
    return rawPayload as TransferStockInput;
  };

  const handleProceedToReview = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isOperationBlocked || !writeEnabled || !isRoleAllowed) {
      if (!isRoleAllowed) {
        setClientErrors(['Bạn không có quyền thực hiện nghiệp vụ Điều chuyển kho (Chỉ dành cho ADMIN hoặc LAB_MANAGER).']);
      } else {
        setClientErrors(['Thao tác ghi kho bị khóa do quyền hạn hoặc cấu hình hệ thống (Write Flag = false).']);
      }
      return;
    }
    const validPayload = validateForm();
    if (validPayload) {
      setIsConfirming(true);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    // TASK 3: STRICT SUBMIT GUARD
    if (isOperationBlocked || !writeEnabled || !isRoleAllowed) {
      if (!isRoleAllowed) {
        setClientErrors(['Bạn không có quyền thực hiện nghiệp vụ Điều chuyển kho (Chỉ dành cho ADMIN hoặc LAB_MANAGER).']);
      } else {
        setClientErrors(['Thao tác ghi kho bị khóa do quyền hạn hoặc cấu hình hệ thống (Write Flag = false).']);
      }
      return;
    }
    if (fsm.state !== 'DRAFT') {
      setClientErrors([`Chỉ có thể phát lệnh khi phiếu ở trạng thái DRAFT. Trạng thái hiện tại: ${fsm.state}`]);
      return;
    }
    if (!isConfirming) {
      setClientErrors(['Bắt buộc phải xem lại và xác nhận thông tin phiếu trước khi phát lệnh ghi sổ.']);
      return;
    }
    if (fsm.isSubmitting) return; // Strict double-click prevention

    const validPayload = validateForm();
    if (!validPayload) {
      setIsConfirming(false);
      return;
    }

    await fsm.submit(validPayload, async (pl, key) => {
      return await stockTransactionsService.transferStock(pl, key);
    });
  };

  const handleConfirmSubmit = async () => {
    await handleSubmit();
  };

  const totalQuantity = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto"
      data-testid="stock-transfer-modal"
    >
      <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-slate-200 my-8 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-purple-50/50 px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white shadow-md shadow-purple-500/20">
              <ArrowLeftRight className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isConfirming ? 'Xác Nhận Lập Phiếu Điều Chuyển Kho' : 'Tạo Phiếu Điều Chuyển Kho (TRANSFER)'}
              </h3>
              <p className="text-xs text-slate-500">
                {isConfirming
                  ? 'Kiểm tra lại toàn bộ vị trí nguồn, vị trí đích và số lượng trước khi phát lệnh ghi sổ'
                  : 'Điều chuyển linh kiện giữa các vị trí trong kho lưu trữ (Bảo vệ bằng Idempotency-Key)'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={fsm.isSubmitting}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-200/50 hover:text-slate-600 transition"
            data-testid="btn-close-transfer-modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="p-6 space-y-6 max-h-[72vh] overflow-y-auto">
            {/* Ambiguous State Banner */}
            {fsm.isAmbiguous && (
              <div
                className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 space-y-2"
                data-testid="ambiguous-state-banner"
              >
                <div className="flex items-center space-x-2 font-bold">
                  <AlertCircle className="h-5 w-5 text-amber-600" />
                  <span>KẾT QUẢ CHƯA XÁC NHẬN (AMBIGUOUS OUTCOME)</span>
                </div>
                {fsm.errorMessage && (
                  <p className="font-semibold text-amber-900 bg-amber-100/80 p-2 rounded border border-amber-200" data-testid="ambiguous-error-detail">
                    {fsm.errorMessage}
                  </p>
                )}
                <p>
                  Yêu cầu điều chuyển kho đã gửi với khóa <code className="font-mono font-bold">{fsm.idempotencyKey}</code> nhưng kết nối mạng bị ngắt hoặc đang xử lý. Giao dịch có thể đã được ghi nhận.
                </p>
                <div className="flex items-center space-x-3 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      fsm.checkAmbiguousStatus((key) => stockTransactionsService.queryIdempotencyRecord(key))
                    }
                    disabled={fsm.isSubmitting}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50 transition"
                    data-testid="btn-retry-ambiguous"
                  >
                    {fsm.isSubmitting ? 'Đang tra cứu...' : 'Tra cứu trạng thái máy chủ (GET Idempotency)'}
                  </button>
                  <button
                    type="button"
                    onClick={fsm.requestReconciliation}
                    className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition"
                    data-testid="btn-request-reconciliation"
                  >
                    Yêu cầu Đối chiếu / Thay đổi
                  </button>
                </div>
              </div>
            )}

            {/* Reconciliation Required Banner */}
            {fsm.isReconciliationRequired && (
              <div
                className="rounded-xl border border-red-300 bg-red-50 p-4 text-xs text-red-900 space-y-3"
                data-testid="reconciliation-banner"
              >
                <div className="flex items-center space-x-2 font-bold text-red-700">
                  <ShieldAlert className="h-5 w-5 text-red-600 flex-shrink-0" />
                  <span>CẢNH BÁO BẮT BUỘC ĐỐI CHIẾU (RECONCILIATION REQUIRED)</span>
                </div>
                {fsm.errorMessage && (
                  <p className="font-semibold text-red-800 bg-red-100/80 p-2 rounded border border-red-200" data-testid="reconciliation-error-detail">
                    {fsm.errorMessage}
                  </p>
                )}
                <p className="text-red-800">
                  Giao dịch chưa được xác nhận hoàn tất hoặc phát hiện xung đột dữ liệu Idempotency. Vui lòng đối chiếu với trang Lịch sử giao dịch hoặc cơ sở dữ liệu trước khi tiếp tục. Không tự ý tạo phiếu mới nếu giao dịch cũ đã được thực thi.
                </p>

                <div className="bg-white/80 border border-red-200 rounded-lg p-3 space-y-2.5">
                  <div className="font-semibold text-gray-800">Biên bản đối soát có thẩm quyền:</div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <label className="flex items-center space-x-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="reconcile-outcome-transfer"
                        value="TRANSACTION_CONFIRMED_UNEXECUTED"
                        checked={reconcileOutcome === 'TRANSACTION_CONFIRMED_UNEXECUTED'}
                        onChange={() => setReconcileOutcome('TRANSACTION_CONFIRMED_UNEXECUTED')}
                        className="text-red-600 focus:ring-red-500"
                        data-testid="radio-reconcile-unexecuted"
                      />
                      <span className="text-gray-700">Xác nhận giao dịch CHƯA được thực thi (Cần Audit Ticket)</span>
                    </label>
                    <label className="flex items-center space-x-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="reconcile-outcome-transfer"
                        value="TRANSACTION_ALREADY_SUCCEEDED"
                        checked={reconcileOutcome === 'TRANSACTION_ALREADY_SUCCEEDED'}
                        onChange={() => setReconcileOutcome('TRANSACTION_ALREADY_SUCCEEDED')}
                        className="text-red-600 focus:ring-red-500"
                        data-testid="radio-reconcile-succeeded"
                      />
                      <span className="text-gray-700">Giao dịch ĐÃ thành công trên hệ thống</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">Mã biên bản đối soát (auditTicketId):</label>
                      <input
                        type="text"
                        value={reconcileAuditTicket}
                        onChange={(e) => setReconcileAuditTicket(e.target.value)}
                        placeholder="VD: AUDIT-20261014-0001"
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                        data-testid="input-reconcile-auditticket"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">Người duyệt đối soát (authorizedBy):</label>
                      <input
                        type="text"
                        value={reconcileAuthorizedBy}
                        onChange={(e) => setReconcileAuthorizedBy(e.target.value)}
                        placeholder="VD: supervisor-admin-id"
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                        data-testid="input-reconcile-authorizedby"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-medium text-gray-700 mb-1">Mã chứng thực đối soát (authorizationSecretOrToken - tối thiểu 16 ký tự):</label>
                    <input
                      type="password"
                      value={reconcileToken}
                      onChange={(e) => setReconcileToken(e.target.value)}
                      placeholder="Nhập mã chứng thực thẩm quyền (tối thiểu 16 ký tự)..."
                      className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                      data-testid="input-reconcile-token"
                    />
                  </div>

                  {reconcileOutcome === 'TRANSACTION_ALREADY_SUCCEEDED' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block font-medium text-gray-700 mb-1">Transaction UUID (id):</label>
                        <input
                          type="text"
                          value={reconcileTxId}
                          onChange={(e) => setReconcileTxId(e.target.value)}
                          placeholder="UUID (VD: 11111111-1111-4111-8111-111111111111)..."
                          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                          data-testid="input-reconcile-txid"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-gray-700 mb-1">Mã chứng từ (transactionNumber):</label>
                        <input
                          type="text"
                          value={reconcileTxNumber}
                          onChange={(e) => setReconcileTxNumber(e.target.value)}
                          placeholder="VD: TRF-20261014-001..."
                          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                          data-testid="input-reconcile-txnumber"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block font-medium text-gray-700 mb-1">
                      Căn cứ sổ cái kiểm kê thực tế (evidenceDetails - tối thiểu 20 ký tự):
                    </label>
                    <input
                      type="text"
                      value={reconcileEvidence}
                      onChange={(e) => setReconcileEvidence(e.target.value)}
                      placeholder="Ghi rõ phương thức đối soát (VD: Đã kiểm tra sổ cái và số dư tồn kho không đổi...)..."
                      className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                      data-testid="input-reconcile-evidence"
                    />
                  </div>

                  {reconcileError && (
                    <p className="text-red-600 font-semibold" data-testid="reconcile-error-msg">
                      {reconcileError}
                    </p>
                  )}
                </div>

                <div className="flex items-center space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={handleResolveReconciliation}
                    className="rounded-lg bg-red-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-800 transition"
                    data-testid="btn-resolve-reconciliation"
                  >
                    Xác nhận kết quả đối chiếu
                  </button>
                </div>
              </div>
            )}

            {/* Server Error Message */}
            {fsm.errorMessage && !fsm.isAmbiguous && !fsm.isReconciliationRequired && (
              <div
                className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 flex items-start space-x-2"
                data-testid="transfer-error-banner"
              >
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-bold">Lỗi từ máy chủ: </span>
                  {fsm.errorMessage}
                </div>
              </div>
            )}

            {/* Client Validation Errors */}
            {clientErrors.length > 0 && (
              <div
                className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 space-y-1"
                data-testid="client-validation-errors"
              >
                <div className="font-bold">Vui lòng kiểm tra lại thông tin:</div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {clientErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* CONFIRMATION REVIEW STEP (Phase 4 Requirement) */}
            {isConfirming && (
              <div className="space-y-4" data-testid="transfer-confirmation-step">
                <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-4 space-y-3">
                  <div className="flex items-center space-x-2 text-purple-900 font-bold text-xs uppercase tracking-wider">
                    <CheckCircle2 className="h-4 w-4 text-purple-600" />
                    <span>Xem Lại Danh Mục Mặt Hàng Điều Chuyển</span>
                  </div>

                  <div className="rounded-lg bg-white p-3 border border-purple-100 text-xs space-y-1">
                    <div>
                      <span className="font-semibold text-slate-700">Lý do điều chuyển: </span>
                      <span className="text-slate-900 font-medium">{reason}</span>
                    </div>
                    {notes && (
                      <div>
                        <span className="font-semibold text-slate-700">Ghi chú phiếu: </span>
                        <span className="text-slate-700 italic">{notes}</span>
                      </div>
                    )}
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
                        <tr>
                          <th className="py-2.5 px-3 text-center w-8">#</th>
                          <th className="py-2.5 px-3">Linh kiện</th>
                          <th className="py-2.5 px-3">Vị trí nguồn</th>
                          <th className="py-2.5 px-3">Vị trí đích</th>
                          <th className="py-2.5 px-3 text-center">Tồn khả dụng nguồn</th>
                          <th className="py-2.5 px-3 text-right">Số lượng chuyển</th>
                          <th className="py-2.5 px-3">Ghi chú dòng</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {lines.map((l, i) => {
                          const it = activeItems.find((item) => item.id === l.itemId);
                          const fromLocId = l.fromLocationId || headerFromLoc;
                          const toLocId = l.toLocationId || headerToLoc;
                          const fromLoc = activeLocations.find((location) => location.id === fromLocId);
                          const toLoc = activeLocations.find((location) => location.id === toLocId);
                          const available = getAvailableStock(l.itemId, fromLocId);
                          const qty = Number(l.quantity) || 0;

                          return (
                            <tr key={i} className="hover:bg-slate-50/50" data-testid={`confirm-line-${i}`}>
                              <td className="py-2 px-3 text-center text-slate-400 font-mono">{i + 1}</td>
                              <td className="py-2 px-3 font-semibold text-slate-900">
                                [{it?.code || 'N/A'}] {it?.name || 'Chưa chọn'} ({it?.unit || 'Cái'})
                              </td>
                              <td className="py-2 px-3 font-mono text-slate-700">
                                {fromLoc?.code} - {fromLoc?.name}
                              </td>
                              <td className="py-2 px-3 font-mono text-slate-700">
                                {toLoc?.code} - {toLoc?.name}
                              </td>
                              <td className="py-2 px-3 text-center font-mono font-medium text-slate-600">
                                {available}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-purple-700">
                                {qty}
                              </td>
                              <td className="py-2 px-3 text-slate-500 italic">{l.notes || '-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-between items-center rounded-lg bg-purple-100/50 p-3 text-xs">
                    <div>
                      <span className="text-slate-600">Tổng số mặt hàng chuyển: </span>
                      <span className="font-bold text-slate-900 font-mono">{lines.length} dòng</span>
                    </div>
                    <div>
                      <span className="text-slate-600">Tổng số lượng chuyển: </span>
                      <span className="font-bold text-purple-700 font-mono text-sm">{totalQuantity}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end space-x-3 pt-3 border-t border-purple-200">
                    <button
                      type="button"
                      onClick={() => setIsConfirming(false)}
                      disabled={fsm.isSubmitting}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                      data-testid="btn-back-edit-transfer"
                    >
                      Quay lại chỉnh sửa
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmSubmit}
                      disabled={fsm.isSubmitting || fsm.isAmbiguous || fsm.isReconciliationRequired}
                      className="inline-flex items-center space-x-2 rounded-lg bg-purple-600 px-5 py-2 text-xs font-semibold text-white shadow-md shadow-purple-500/20 hover:bg-purple-700 disabled:opacity-50 transition cursor-pointer"
                      data-testid="btn-confirm-submit-transfer"
                    >
                      {fsm.isSubmitting ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          <span>Đang xử lý điều chuyển...</span>
                        </>
                      ) : (
                        <>
                          <Check className="h-4 w-4" />
                          <span>Xác nhận gửi phiếu điều chuyển</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* EDIT FORM VIEW */}
            <div className="space-y-6">
              {/* Header Defaults (Optional quick fill) */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Vị trí mặc định toàn phiếu (Tùy chọn)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-600 mb-1">Vị trí nguồn mặc định:</label>
                    <select
                      value={headerFromLoc}
                      onChange={(e) => setHeaderFromLoc(e.target.value)}
                      disabled={fsm.isSubmitting || fsm.isAmbiguous}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-800 focus:border-purple-500 focus:outline-none"
                    >
                      <option value="">-- Áp dụng riêng từng dòng --</option>
                      {activeLocations.map((l) => (
                        <option key={l.id} value={l.id}>
                          [{l.type}] {l.code} - {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">Vị trí đích mặc định:</label>
                    <select
                      value={headerToLoc}
                      onChange={(e) => setHeaderToLoc(e.target.value)}
                      disabled={fsm.isSubmitting || fsm.isAmbiguous}
                      className={`w-full rounded-lg border bg-white px-2.5 py-1.5 text-slate-800 focus:outline-none ${
                        fieldErrors['headerToLoc']
                          ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                          : 'border-slate-200 focus:border-purple-500'
                      }`}
                    >
                      <option value="">-- Áp dụng riêng từng dòng --</option>
                      {activeLocations.map((l) => (
                        <option key={l.id} value={l.id}>
                          [{l.type}] {l.code} - {l.name}
                        </option>
                      ))}
                    </select>
                    {fieldErrors['headerToLoc'] && (
                      <p className="mt-1 text-[11px] text-red-600">{fieldErrors['headerToLoc']}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Header Reason & Notes & Idempotency Key */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Lý do điều chuyển kho * (Tối thiểu 5 ký tự)
                  </label>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    disabled={fsm.isSubmitting || fsm.isAmbiguous}
                    placeholder="Ví dụ: Điều chuyển linh kiện sang Ngăn B2 phục vụ bảo dưỡng"
                    maxLength={500}
                    className={`w-full rounded-lg border px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 ${
                      fieldErrors['reason']
                        ? 'border-red-400 focus:border-red-500 focus:ring-red-500 bg-red-50/30'
                        : 'border-slate-200 focus:border-purple-500 focus:ring-purple-500'
                    }`}
                    data-testid="transfer-reason-input"
                  />
                  {fieldErrors['reason'] && (
                    <p className="mt-1 text-[11px] text-red-600" data-testid="error-reason">
                      {fieldErrors['reason']}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Ghi chú bổ sung
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={fsm.isSubmitting || fsm.isAmbiguous}
                    placeholder="Tùy chọn: người bàn giao, số văn bản phê duyệt..."
                    maxLength={500}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    data-testid="transfer-notes-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Khóa giao dịch Idempotency-Key
                  </label>
                  <input
                    type="text"
                    value={fsm.idempotencyKey}
                    readOnly
                    disabled
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-500"
                    data-testid="idempotency-key-display"
                  />
                </div>
              </div>

              {/* Line Items Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Danh sách linh kiện điều chuyển ({lines.length}/100)
                  </label>
                  <button
                    type="button"
                    onClick={handleAddLine}
                    disabled={lines.length >= 100 || fsm.isSubmitting || fsm.isAmbiguous}
                    className="inline-flex items-center space-x-1 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-100 transition"
                    data-testid="btn-add-line"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Thêm dòng</span>
                  </button>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                      <tr>
                        <th className="py-2.5 px-3 w-8 text-center">#</th>
                        <th className="py-2.5 px-3 min-w-[180px]">Linh kiện *</th>
                        <th className="py-2.5 px-3 min-w-[160px]">Vị trí nguồn *</th>
                        <th className="py-2.5 px-3 min-w-[160px]">Vị trí đích *</th>
                        <th className="py-2.5 px-3 w-28 text-center">Tồn nguồn</th>
                        <th className="py-2.5 px-3 w-24">Số lượng *</th>
                        <th className="py-2.5 px-3">Ghi chú dòng</th>
                        <th className="py-2.5 px-3 w-10 text-center">Xóa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {lines.map((line, idx) => {
                        const effectiveFrom = line.fromLocationId || headerFromLoc;
                        const effectiveTo = line.toLocationId || headerToLoc;
                        const available = getAvailableStock(line.itemId, effectiveFrom);
                        const isIdentical = effectiveFrom && effectiveTo && effectiveFrom === effectiveTo;

                        const aggKey = `${line.itemId}:${effectiveFrom}`;
                        const totalRequested = aggregatedRequests.get(aggKey) || 0;
                        const isAggregateOver = line.itemId && effectiveFrom && totalRequested > available;

                        return (
                          <tr key={idx} className="hover:bg-slate-50/50" data-testid={`line-row-${idx}`}>
                            <td className="py-2 px-3 text-center text-slate-400 font-mono">{idx + 1}</td>
                            <td className="py-2 px-3">
                              <select
                                value={line.itemId}
                                onChange={(e) => handleLineChange(idx, 'itemId', e.target.value)}
                                disabled={fsm.isSubmitting || fsm.isAmbiguous}
                                className={`w-full rounded-lg border px-2 py-1.5 text-xs text-slate-800 focus:outline-none ${
                                  fieldErrors[`items.${idx}.itemId`]
                                    ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                                    : 'border-slate-200 focus:border-purple-500'
                                }`}
                                data-testid={`select-item-${idx}`}
                              >
                                <option value="">-- Chọn linh kiện --</option>
                                {activeItems.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    [{item.code}] {item.name} ({item.unit})
                                  </option>
                                ))}
                              </select>
                              {fieldErrors[`items.${idx}.itemId`] && (
                                <p className="mt-0.5 text-[10px] text-red-600" data-testid={`error-item-${idx}`}>
                                  {fieldErrors[`items.${idx}.itemId`]}
                                </p>
                              )}
                            </td>
                            <td className="py-2 px-3">
                              <select
                                value={line.fromLocationId || ''}
                                onChange={(e) => handleLineChange(idx, 'fromLocationId', e.target.value)}
                                disabled={fsm.isSubmitting || fsm.isAmbiguous}
                                className={`w-full rounded-lg border px-2 py-1.5 text-xs text-slate-800 focus:outline-none ${
                                  fieldErrors[`items.${idx}.fromLocationId`]
                                    ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                                    : 'border-slate-200 focus:border-purple-500'
                                }`}
                                data-testid={`select-from-location-${idx}`}
                              >
                                <option value="">{headerFromLoc ? '(Theo mặc định phiếu)' : '-- Chọn nguồn --'}</option>
                                {activeLocations.map((loc) => (
                                  <option key={loc.id} value={loc.id}>
                                    [{loc.type}] {loc.code} - {loc.name}
                                  </option>
                                ))}
                              </select>
                              {fieldErrors[`items.${idx}.fromLocationId`] && (
                                <p className="mt-0.5 text-[10px] text-red-600" data-testid={`error-from-loc-${idx}`}>
                                  {fieldErrors[`items.${idx}.fromLocationId`]}
                                </p>
                              )}
                            </td>
                            <td className="py-2 px-3">
                              <select
                                value={line.toLocationId || ''}
                                onChange={(e) => handleLineChange(idx, 'toLocationId', e.target.value)}
                                disabled={fsm.isSubmitting || fsm.isAmbiguous}
                                className={`w-full rounded-lg border px-2 py-1.5 text-xs text-slate-800 focus:outline-none ${
                                  isIdentical || fieldErrors[`items.${idx}.toLocationId`]
                                    ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                                    : 'border-slate-200 focus:border-purple-500'
                                }`}
                                data-testid={`select-to-location-${idx}`}
                              >
                                <option value="">{headerToLoc ? '(Theo mặc định phiếu)' : '-- Chọn đích --'}</option>
                                {activeLocations.map((loc) => (
                                  <option key={loc.id} value={loc.id}>
                                    [{loc.type}] {loc.code} - {loc.name}
                                  </option>
                                ))}
                              </select>
                              {isIdentical && (
                                <p className="mt-0.5 text-[10px] text-red-600 font-semibold" data-testid={`same-location-error-${idx}`}>
                                  Vị trí nguồn và đích bị trùng
                                </p>
                              )}
                              {!isIdentical && fieldErrors[`items.${idx}.toLocationId`] && (
                                <p className="mt-0.5 text-[10px] text-red-600" data-testid={`error-to-loc-${idx}`}>
                                  {fieldErrors[`items.${idx}.toLocationId`]}
                                </p>
                              )}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {line.itemId && effectiveFrom ? (
                                <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-800" data-testid={`available-stock-${idx}`}>
                                  {available}
                                </span>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                            <td className="py-2 px-3">
                              <input
                                type="number"
                                min="1"
                                step="1"
                                value={line.quantity}
                                onChange={(e) =>
                                  handleLineChange(
                                    idx,
                                    'quantity',
                                    e.target.value === '' ? '' : parseInt(e.target.value, 10)
                                  )
                                }
                                disabled={fsm.isSubmitting || fsm.isAmbiguous}
                                className={`w-full rounded-lg border px-2 py-1.5 text-xs font-mono font-bold text-slate-900 focus:outline-none ${
                                  isAggregateOver || fieldErrors[`items.${idx}.quantity`]
                                    ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                                    : 'border-slate-200 focus:border-purple-500'
                                }`}
                                data-testid={`input-qty-${idx}`}
                              />
                              {isAggregateOver && (
                                <p className="mt-0.5 text-[10px] text-red-600 font-semibold" data-testid={`aggregate-over-error-${idx}`}>
                                  Vượt tổng tồn nguồn khả dụng
                                </p>
                              )}
                              {!isAggregateOver && fieldErrors[`items.${idx}.quantity`] && (
                                <p className="mt-0.5 text-[10px] text-red-600" data-testid={`error-qty-${idx}`}>
                                  {fieldErrors[`items.${idx}.quantity`]}
                                </p>
                              )}
                            </td>
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                value={line.notes || ''}
                                onChange={(e) => handleLineChange(idx, 'notes', e.target.value)}
                                disabled={fsm.isSubmitting || fsm.isAmbiguous}
                                placeholder="Tùy chọn"
                                maxLength={500}
                                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-800 focus:border-purple-500 focus:outline-none"
                                data-testid={`input-notes-${idx}`}
                              />
                            </td>
                            <td className="py-2 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveLine(idx)}
                                disabled={lines.length <= 1 || fsm.isSubmitting || fsm.isAmbiguous}
                                className="text-slate-400 hover:text-red-600 disabled:opacity-30 transition"
                                data-testid={`btn-remove-line-${idx}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Summary Footer */}
              <div className="flex flex-col sm:flex-row items-center justify-between rounded-xl bg-slate-50 p-4 border border-slate-200/80 text-xs text-slate-700">
                <div>
                  <span className="text-slate-500">Tổng số mặt hàng chuyển: </span>
                  <span className="font-bold text-slate-900 font-mono">{lines.length} dòng</span>
                </div>
                <div>
                  <span className="text-slate-500">Tổng số lượng chuyển: </span>
                  <span className="font-bold text-purple-700 font-mono text-sm" data-testid="total-qty-display">
                    {totalQuantity}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end space-x-3 border-t border-slate-100 bg-slate-50/50 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={fsm.isSubmitting}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Hủy bỏ
            </button>
            <button
              type="button"
              onClick={handleProceedToReview}
              disabled={fsm.isSubmitting || fsm.isAmbiguous || fsm.isReconciliationRequired || isOperationBlocked}
              className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-100 disabled:opacity-50 transition"
              data-testid="btn-review-transfer"
            >
              <span>Xem lại & Xác nhận</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
