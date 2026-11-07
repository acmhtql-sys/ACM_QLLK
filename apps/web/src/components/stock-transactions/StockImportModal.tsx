import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  ShieldAlert,
  ArrowRight,
  Check,
} from 'lucide-react';
import { z } from 'zod';
import {
  ImportStockInput,
  ItemResponse,
  LocationResponse,
  UserRole,
} from '@acm/shared';
import { useIdempotentTransaction } from '../../hooks/useIdempotentTransaction';
import { stockTransactionsService } from '../../services/stock-transactions.service';
import { isStockTransactionWriteEnabled } from '../../config/features';
import { canPerformStockMutation } from '../../services/stock-rbac';

export interface ImportItemLine {
  itemId: string;
  locationId: string;
  quantity: number | '';
  unitCost?: number | null;
  notes?: string | null;
}

export interface StockImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: ItemResponse[];
  locations: LocationResponse[];
  userId: string;
  userRole?: UserRole | string;
  onSuccess: (result: any) => void;
}

// Zod validation schema for client import form (strictly requires UUIDs)
const clientImportItemSchema = z
  .object({
    itemId: z.string().trim().guid('Vui lòng chọn linh kiện hợp lệ (UUID).'),
    locationId: z.string().trim().guid('Vui lòng chọn vị trí kho hợp lệ (UUID).'),
    quantity: z
      .number({ error: 'Số lượng phải là số nguyên dương lớn hơn 0.' })
      .int('Số lượng phải là số nguyên dương lớn hơn 0.')
      .positive('Số lượng phải là số nguyên dương lớn hơn 0.'),
    unitCost: z
      .number({ error: 'Đơn giá không được là số âm.' })
      .min(0, 'Đơn giá không được là số âm.')
      .optional()
      .nullable(),
    notes: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự.').optional().nullable(),
  })
  .strict();

const clientImportSchema = z
  .object({
    notes: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự.').optional().nullable(),
    items: z
      .array(clientImportItemSchema)
      .min(1, 'Phiếu nhập kho phải có ít nhất 1 mặt hàng.')
      .max(100, 'Phiếu nhập kho tối đa 100 mặt hàng mỗi lần.')
      .refine(
        (items) => {
          const seen = new Set<string>();
          for (const item of items) {
            if (!item.itemId || !item.locationId) continue;
            const key = `${item.itemId}:${item.locationId}`;
            if (seen.has(key)) return false;
            seen.add(key);
          }
          return true;
        },
        {
          message: 'Trùng lặp linh kiện tại cùng vị trí đã chọn ở dòng trước.',
        }
      ),
  })
  .strict();

export const StockImportModal: React.FC<StockImportModalProps> = ({
  isOpen,
  onClose,
  items,
  locations,
  userId,
  userRole,
  onSuccess,
}) => {
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<ImportItemLine[]>([
    { itemId: '', locationId: '', quantity: 1, unitCost: null, notes: '' },
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

  // Filter only active items and active locations
  const activeItems = items.filter((it) => it.isActive);
  const activeLocations = locations.filter((loc) => loc.isActive);

  // Initialize Idempotency FSM Hook
  const fsm = useIdempotentTransaction<ImportStockInput, any>({
    endpoint: '/api/v1/stock-transactions/import',
    userId,
    onSuccess: (result) => {
      onSuccess(result);
      handleClose();
    },
  });

  const handleClose = () => {
    fsm.resetToDraft();
    setNotes('');
    setLines([{ itemId: '', locationId: '', quantity: 1, unitCost: null, notes: '' }]);
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

  // Strict Fail-Closed Check: Missing role or non-mutation role evaluates to false!
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
    setLines([...lines, { itemId: '', locationId: '', quantity: 1, unitCost: null, notes: '' }]);
  };

  const handleRemoveLine = (index: number) => {
    if (lines.length <= 1) return;
    if (isConfirming) setIsConfirming(false);
    setLines(lines.filter((_, i) => i !== index));
    setFieldErrors({});
  };

  const handleLineChange = (index: number, field: keyof ImportItemLine, value: any) => {
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

  const validateForm = (): ImportStockInput | null => {
    const errors: string[] = [];
    const fields: Record<string, string> = {};

    const rawPayload = {
      notes: notes.trim() || null,
      items: lines.map((l) => ({
        itemId: l.itemId,
        locationId: l.locationId,
        quantity: l.quantity === '' ? 0 : Number(l.quantity),
        unitCost: l.unitCost != null && l.unitCost !== ('' as any) ? Number(l.unitCost) : null,
        notes: l.notes?.trim() || null,
      })),
    };

    const parseResult = clientImportSchema.safeParse(rawPayload);
    if (!parseResult.success) {
      for (const issue of parseResult.error.issues) {
        const path = issue.path.join('.');
        if (path.endsWith('.quantity')) {
          fields[path] = 'Số lượng không hợp lệ.';
        } else if (path.endsWith('.itemId')) {
          fields[path] = issue.message || 'Vui lòng chọn linh kiện hợp lệ (UUID).';
        } else if (path.endsWith('.locationId')) {
          fields[path] = issue.message || 'Vui lòng chọn vị trí kho hợp lệ (UUID).';
        } else {
          fields[path] = issue.message;
        }

        if (!errors.includes(issue.message)) {
          errors.push(issue.message);
        }
      }
    }

    if (errors.length > 0) {
      setFieldErrors(fields);
      setClientErrors(errors);
      return null;
    }

    setFieldErrors({});
    setClientErrors([]);
    return rawPayload as ImportStockInput;
  };

  const handleProceedToReview = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isOperationBlocked || !writeEnabled || !isRoleAllowed) {
      if (!isRoleAllowed) {
        setClientErrors(['Bạn không có quyền thực hiện nghiệp vụ Nhập kho (Chỉ dành cho ADMIN hoặc LAB_MANAGER).']);
      } else {
        setClientErrors(['Thao tác ghi kho bị khóa do quyền hạn hoặc cấu hình hệ thống (Write Flag = false).']);
      }
      return;
    }
    const valid = validateForm();
    if (valid) {
      setIsConfirming(true);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    // TASK 3: STRICT SUBMIT GUARD
    if (isOperationBlocked || !writeEnabled || !isRoleAllowed) {
      if (!isRoleAllowed) {
        setClientErrors(['Bạn không có quyền thực hiện nghiệp vụ Nhập kho (Chỉ dành cho ADMIN hoặc LAB_MANAGER).']);
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
      return await stockTransactionsService.importStock(pl, key);
    });
  };

  const handleConfirmSubmit = async () => {
    await handleSubmit();
  };

  const totalQuantity = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  const totalEstimatedCost = lines.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0),
    0
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto"
      data-testid="stock-import-modal"
    >
      <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-slate-200 my-8 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-blue-50/50 px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/20">
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isConfirming ? 'Xác Nhận Lập Phiếu Nhập Kho' : 'Tạo Phiếu Nhập Kho (IMPORT)'}
              </h3>
              <p className="text-xs text-slate-500">
                {isConfirming
                  ? 'Kiểm tra lại toàn bộ thông tin linh kiện và số lượng trước khi phát lệnh ghi sổ'
                  : 'Nhập linh kiện & thiết bị vào kho lưu trữ (Bảo vệ bằng Idempotency-Key)'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={fsm.isSubmitting}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-200/50 hover:text-slate-600 transition"
            data-testid="btn-close-import-modal"
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
                  Yêu cầu đã được gửi với khóa <code className="font-mono font-bold">{fsm.idempotencyKey}</code> nhưng kết nối mạng bị gián đoạn, quá thời gian phản hồi hoặc đang được xử lý trên máy chủ. Giao dịch có thể đã được ghi sổ.
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
                        name="reconcile-outcome-import"
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
                        name="reconcile-outcome-import"
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
                          placeholder="VD: IMP-20261014-001..."
                          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                          data-testid="input-reconcile-txnumber"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block font-medium text-gray-700 mb-1">Căn cứ sổ cái kiểm kê thực tế (evidenceDetails - tối thiểu 20 ký tự):</label>
                    <input
                      type="text"
                      value={reconcileEvidence}
                      onChange={(e) => setReconcileEvidence(e.target.value)}
                      placeholder="Ghi rõ chi tiết sổ cái và căn cứ thực tế (không dùng 404 thuần túy)..."
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

            {/* Error Message */}
            {fsm.errorMessage && !fsm.isAmbiguous && !fsm.isReconciliationRequired && (
              <div
                className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 flex items-start space-x-2"
                data-testid="import-error-banner"
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

            {/* Confirmation Screen (Phase 2 Review Step) */}
            {isConfirming && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3" data-testid="import-confirmation-step">
                <div className="flex items-center space-x-2 text-blue-900 font-bold text-xs uppercase tracking-wider">
                  <CheckCircle2 className="h-4 w-4 text-blue-600" />
                  <span>Xác Nhận Danh Mục Nhập Kho Trước Khi Ghi Sổ</span>
                </div>
                <p className="text-xs text-slate-600">
                  Vui lòng kiểm tra kỹ danh mục linh kiện, vị trí nhập và số lượng trước khi phát lệnh ghi sổ.
                </p>

                {notes && (
                  <div className="rounded-lg bg-white p-2.5 border border-blue-100 text-xs">
                    <span className="font-semibold text-slate-700">Ghi chú phiếu: </span>
                    <span className="text-slate-900 italic">{notes}</span>
                  </div>
                )}

                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
                      <tr>
                        <th className="py-2 px-3 text-center w-8">#</th>
                        <th className="py-2 px-3">Linh kiện</th>
                        <th className="py-2 px-3">Vị trí nhập</th>
                        <th className="py-2 px-3 text-right">Số lượng</th>
                        <th className="py-2 px-3 text-right">Đơn giá</th>
                        <th className="py-2 px-3">Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lines.map((l, i) => {
                        const it = activeItems.find((item) => item.id === l.itemId);
                        const loc = activeLocations.find((location) => location.id === l.locationId);
                        return (
                          <tr key={i} className="hover:bg-slate-50/50" data-testid={`confirm-line-${i}`}>
                            <td className="py-2 px-3 text-center text-slate-400 font-mono">{i + 1}</td>
                            <td className="py-2 px-3 font-semibold text-slate-900">
                              [{it?.code || 'N/A'}] {it?.name || l.itemId}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-700">
                              {loc?.code || l.locationId}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-blue-700">
                              +{l.quantity}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-700">
                              {l.unitCost ? Number(l.unitCost).toLocaleString('vi-VN') + ' đ' : '-'}
                            </td>
                            <td className="py-2 px-3 text-slate-500 italic">{l.notes || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setIsConfirming(false)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                    data-testid="btn-back-edit-import"
                  >
                    Quay lại chỉnh sửa
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmSubmit}
                    disabled={fsm.isSubmitting || fsm.isAmbiguous || fsm.isReconciliationRequired}
                    className="inline-flex items-center space-x-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition cursor-pointer"
                    data-testid="btn-confirm-submit-import"
                  >
                    {fsm.isSubmitting ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Đang xử lý giao dịch...</span>
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        <span>Xác nhận gửi phiếu nhập</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Voucher Header Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ghi chú nghiệp vụ nhập kho
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={fsm.isSubmitting || fsm.isAmbiguous}
                  placeholder="Ví dụ: Nhập bổ sung linh kiện thực hành đợt 1 / Hóa đơn #1234"
                  maxLength={500}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  data-testid="import-notes-input"
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
                  Danh sách linh kiện nhập kho ({lines.length}/100)
                </label>
                <button
                  type="button"
                  onClick={handleAddLine}
                  disabled={lines.length >= 100 || fsm.isSubmitting || fsm.isAmbiguous}
                  className="inline-flex items-center space-x-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition"
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
                      <th className="py-2.5 px-3 min-w-[200px]">Linh kiện *</th>
                      <th className="py-2.5 px-3 min-w-[180px]">Vị trí kho nhập *</th>
                      <th className="py-2.5 px-3 w-28">Số lượng *</th>
                      <th className="py-2.5 px-3 w-32">Đơn giá (VNĐ)</th>
                      <th className="py-2.5 px-3">Ghi chú dòng</th>
                      <th className="py-2.5 px-3 w-10 text-center">Xóa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {lines.map((line, idx) => (
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
                                : 'border-slate-200 focus:border-blue-500'
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
                            value={line.locationId}
                            onChange={(e) => handleLineChange(idx, 'locationId', e.target.value)}
                            disabled={fsm.isSubmitting || fsm.isAmbiguous}
                            className={`w-full rounded-lg border px-2 py-1.5 text-xs text-slate-800 focus:outline-none ${
                              fieldErrors[`items.${idx}.locationId`]
                                ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                                : 'border-slate-200 focus:border-blue-500'
                            }`}
                            data-testid={`select-location-${idx}`}
                          >
                            <option value="">-- Chọn vị trí kho --</option>
                            {activeLocations.map((loc) => (
                              <option key={loc.id} value={loc.id}>
                                [{loc.type}] {loc.code} - {loc.name}
                              </option>
                            ))}
                          </select>
                          {fieldErrors[`items.${idx}.locationId`] && (
                            <p className="mt-0.5 text-[10px] text-red-600" data-testid={`error-location-${idx}`}>
                              {fieldErrors[`items.${idx}.locationId`]}
                            </p>
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
                              fieldErrors[`items.${idx}.quantity`]
                                ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                                : 'border-slate-200 focus:border-blue-500'
                            }`}
                            data-testid={`input-qty-${idx}`}
                          />
                          {fieldErrors[`items.${idx}.quantity`] && (
                            <p className="mt-0.5 text-[10px] text-red-600" data-testid={`error-qty-${idx}`}>
                              {fieldErrors[`items.${idx}.quantity`]}
                            </p>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="number"
                            min="0"
                            step="1000"
                            value={line.unitCost ?? ''}
                            onChange={(e) =>
                              handleLineChange(
                                idx,
                                'unitCost',
                                e.target.value !== '' ? parseFloat(e.target.value) : null
                              )
                            }
                            disabled={fsm.isSubmitting || fsm.isAmbiguous}
                            placeholder="0"
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-mono text-slate-800 focus:border-blue-500 focus:outline-none"
                            data-testid={`input-cost-${idx}`}
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={line.notes || ''}
                            onChange={(e) => handleLineChange(idx, 'notes', e.target.value)}
                            disabled={fsm.isSubmitting || fsm.isAmbiguous}
                            placeholder="Tùy chọn"
                            maxLength={500}
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
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
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Summary Footer */}
            <div className="flex flex-col sm:flex-row items-center justify-between rounded-xl bg-slate-50 p-4 border border-slate-200/80 text-xs text-slate-700">
              <div className="space-y-1">
                <div>
                  <span className="text-slate-500">Tổng số mặt hàng: </span>
                  <span className="font-bold text-slate-900 font-mono">{lines.length} dòng</span>
                </div>
                <div>
                  <span className="text-slate-500">Tổng số lượng nhập: </span>
                  <span className="font-bold text-blue-700 font-mono text-sm" data-testid="total-qty-display">
                    {totalQuantity}
                  </span>
                </div>
              </div>
              <div className="mt-2 sm:mt-0 text-right">
                <span className="text-slate-500 block">Tổng giá trị dự kiến:</span>
                <span className="font-bold text-emerald-700 font-mono text-base" data-testid="total-cost-display">
                  {totalEstimatedCost.toLocaleString('vi-VN')} VNĐ
                </span>
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
              className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition"
              data-testid="btn-review-import"
            >
              <span>Xem lại & Xác nhận</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
