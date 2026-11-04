import React, { useState, useEffect, useRef } from 'react';
import {
  ClipboardList,
  Plus,
  Check,
  ArrowRight,
  CornerDownLeft,
  Clock,
  XCircle,
  AlertTriangle,
  AlertCircle,
  Search,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { DemoDataNotice } from '../components/DemoDataNotice';
import { StatusBadge } from '../components/StatusBadge';
import { apiClient } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import {
  clearPendingBorrowReturn,
  listPendingBorrowReturns,
  readPendingBorrowReturn,
  savePendingBorrowReturn,
  withBorrowReturnWebLock,
  listDurableBorrowReturnGuards,
  clearDurableBorrowReturnGuard,
  type DurableBorrowReturnGuard,
  type PendingBorrowReturn,
} from './borrowReturnPending';
import { inspectBorrowReturnStatusResponse } from './borrowReturnStatusClient';
import {
  buildReturnItems,
  createReturnIdempotencyKey,
  type ReturnCondition,
  type ReturnInputRow,
  type ReturnPayloadItem,
} from './borrowReturnPartial';

interface BorrowDetailItem {
  id: string;
  itemId: string;
  item?: { id: string; code: string; name: string; unit: string };
  quantity: number;
  returnedQuantity: number;
}

interface BorrowRecord {
  id: string;
  requestNumber: string;
  borrowerName?: string;
  borrowerEmail?: string;
  status: string;
  purpose: string;
  expectedBorrowDate: string;
  expectedReturnDate: string;
  actualBorrowDate?: string | null;
  actualReturnDate?: string | null;
  rejectionReason?: string | null;
  itemCount: number;
  notes?: string | null;
  details?: BorrowDetailItem[];
  isOverdue?: boolean;
}

const canManageBorrow = (role?: string) => role === 'ADMIN' || role === 'LAB_MANAGER';
const canReturnBorrow = (role?: string) =>
  role === 'ADMIN' || role === 'LAB_MANAGER' || role === 'TECHNICIAN';

export const BorrowReturnPage: React.FC = () => {
  const { user } = useAuth();
  const isOperator = canReturnBorrow(user?.role);
  const isManager = canManageBorrow(user?.role);

  const [borrows, setBorrows] = useState<BorrowRecord[]>([]);
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);

  // Return dialog state
  const [returningBorrow, setReturningBorrow] = useState<BorrowRecord | null>(null);
  const [returnRows, setReturnRows] = useState<Record<string, ReturnInputRow>>({});
  const [returnNotes, setReturnNotes] = useState<string>('');

  // Persisted return intents & reconciliation state
  const [pendingReturns, setPendingReturns] = useState<PendingBorrowReturn[]>([]);
  const [lostReturnGuards, setLostReturnGuards] = useState<DurableBorrowReturnGuard[]>([]);
  const [reconciliationStatus, setReconciliationStatus] = useState<
    Record<string, { status: 'checking' | 'completed' | 'unresolved'; message?: string }>
  >({});
  const [rejectedReturn, setRejectedReturn] = useState<{
    borrowId: string;
    key: string;
    message: string;
  } | null>(null);

  // Synchronous double-click guard
  const isSubmittingRef = useRef<boolean>(false);
  const activeUserRef = useRef<string | undefined>(user?.id);
  activeUserRef.current = user?.id;

  // Reject dialog state
  const [rejectingBorrowId, setRejectingBorrowId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');

  const syncStorageIntents = () => {
    if (!user?.id) {
      setPendingReturns([]);
      setLostReturnGuards([]);
      return;
    }
    try {
      const pending = listPendingBorrowReturns(user.id);
      const guards = listDurableBorrowReturnGuards(user.id);
      setPendingReturns(pending);
      setLostReturnGuards(
        guards.filter(
          (g) => !pending.some((p) => p.borrowId === g.borrowId && p.key === g.key)
        )
      );
    } catch (err: any) {
      console.error('Lỗi khi đọc trạng thái giao dịch đã lưu:', err);
    }
  };

  useEffect(() => {
    syncStorageIntents();
  }, [user?.id]);

  const fetchBorrows = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/borrow-requests');
      if (res.data?.success) {
        setBorrows(res.data.data);
      }
    } catch (err: any) {
      console.error('Lỗi khi tải danh sách phiếu mượn:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBorrows();
  }, []);

  const handleApprove = async (id: string) => {
    if (!isManager) {
      setStatusMessage({
        type: 'error',
        text: 'Bạn không có quyền phê duyệt phiếu mượn (Yêu cầu vai trò ADMIN hoặc LAB_MANAGER)',
      });
      return;
    }
    setActionLoading(id);
    setStatusMessage(null);
    try {
      const res = await apiClient.patch(`/borrow-requests/${id}/approve`, {
        notes: 'Phê duyệt từ giao diện quản trị',
      });
      if (res.data?.success) {
        setStatusMessage({ type: 'success', text: `Đã phê duyệt thành công phiếu mượn!` });
        await fetchBorrows();
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Có lỗi xảy ra khi phê duyệt';
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectingBorrowId) return;
    if (!isManager) {
      setStatusMessage({
        type: 'error',
        text: 'Bạn không có quyền từ chối phiếu mượn (Yêu cầu vai trò ADMIN hoặc LAB_MANAGER)',
      });
      return;
    }
    if (!rejectReason.trim() || rejectReason.trim().length < 3) {
      setStatusMessage({ type: 'error', text: 'Lý do từ chối phải có ít nhất 3 ký tự' });
      return;
    }

    setActionLoading(rejectingBorrowId);
    setStatusMessage(null);
    try {
      const res = await apiClient.patch(`/borrow-requests/${rejectingBorrowId}/reject`, {
        rejectionReason: rejectReason.trim(),
      });
      if (res.data?.success) {
        setStatusMessage({ type: 'success', text: 'Đã từ chối phiếu mượn thành công' });
        setRejectingBorrowId(null);
        setRejectReason('');
        await fetchBorrows();
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Có lỗi xảy ra khi từ chối';
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setActionLoading(null);
    }
  };

  const handleHandover = async (id: string) => {
    if (!isOperator) {
      setStatusMessage({
        type: 'error',
        text: 'Bạn không có quyền bàn giao kho (Yêu cầu vai trò ADMIN, LAB_MANAGER hoặc TECHNICIAN)',
      });
      return;
    }
    setActionLoading(id);
    setStatusMessage(null);
    try {
      const res = await apiClient.patch(`/borrow-requests/${id}/handover`, {
        notes: 'Bàn giao linh kiện tại quầy Lab',
      });
      if (res.data?.success) {
        setStatusMessage({
          type: 'success',
          text: 'Bàn giao kho thành công! Linh kiện đã chuyển sang trạng thái đang mượn.',
        });
        await fetchBorrows();
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Có lỗi xảy ra khi bàn giao kho';
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (id: string) => {
    if (
      !window.confirm(
        'Bạn có chắc chắn muốn hủy phiếu mượn này? Các giữ chỗ tồn kho sẽ được giải phóng.'
      )
    ) {
      return;
    }
    setActionLoading(id);
    setStatusMessage(null);
    try {
      const res = await apiClient.patch(`/borrow-requests/${id}/cancel`, {
        reason: 'Hủy theo yêu cầu người dùng',
      });
      if (res.data?.success) {
        setStatusMessage({
          type: 'success',
          text: 'Đã hủy phiếu mượn thành công và giải phóng tồn kho!',
        });
        await fetchBorrows();
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Có lỗi xảy ra khi hủy phiếu mượn';
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setActionLoading(null);
    }
  };

  const openReturnModal = (b: BorrowRecord) => {
    if (!isOperator) {
      setStatusMessage({
        type: 'error',
        text: 'Bạn không có quyền thực hiện hoàn trả linh kiện (Yêu cầu vai trò ADMIN, LAB_MANAGER hoặc TECHNICIAN)',
      });
      return;
    }
    setReturningBorrow(b);
    setReturnNotes('');
    setRejectedReturn(null);

    // Initialize rows: default to '0' to avoid accidental mass returns, letting operator specify exact quantities
    const rows: Record<string, ReturnInputRow> = {};
    b.details?.forEach((d) => {
      rows[d.id] = {
        quantity: '0',
        condition: 'GOOD',
      };
    });
    setReturnRows(rows);
  };

  const handleReturnConfirm = async () => {
    if (!returningBorrow || !returningBorrow.details) return;
    if (!user?.id) {
      setStatusMessage({ type: 'error', text: 'Vui lòng đăng nhập để thực hiện hoàn trả' });
      return;
    }
    if (!isOperator) {
      setStatusMessage({
        type: 'error',
        text: 'Bạn không có quyền thực hiện hoàn trả linh kiện',
      });
      return;
    }

    // Synchronous click guard against rapid double clicks
    if (isSubmittingRef.current || actionLoading === returningBorrow.id) {
      return;
    }

    // Validate payload rows
    let items: ReturnPayloadItem[];
    try {
      items = buildReturnItems(returningBorrow.details, returnRows, returnNotes);
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Dữ liệu hoàn trả không hợp lệ',
      });
      return;
    }

    let key: string;
    try {
      key = createReturnIdempotencyKey();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Không thể tạo khóa giao dịch an toàn',
      });
      return;
    }

    const payload = {
      items,
      notes: returnNotes.trim() || 'Hoàn trả linh kiện tại phòng Lab',
    };
    const record: PendingBorrowReturn = {
      version: 1,
      userId: user.id,
      borrowId: returningBorrow.id,
      key,
      payload,
      createdAt: Date.now(),
    };

    // Synchronous click guard set BEFORE the first await
    isSubmittingRef.current = true;
    setActionLoading(returningBorrow.id);
    setStatusMessage(null);

    // Pre-dispatch persist: check durable guard and save intent while holding exclusive Web Lock
    try {
      await withBorrowReturnWebLock(user.id, returningBorrow.id, () => {
        savePendingBorrowReturn(record);
      });
    } catch (err: any) {
      isSubmittingRef.current = false;
      setActionLoading(null);
      setStatusMessage({
        type: 'error',
        text: `Không thể lưu an toàn ý định hoàn trả (${err.message}). Đã dừng thao tác gửi API để bảo vệ kho.`,
      });
      return;
    }

    try {
      const res = await apiClient.post(
        `/borrow-requests/${returningBorrow.id}/return`,
        payload,
        {
          headers: {
            'Idempotency-Key': key,
          },
        }
      );

      const resData = res.data?.data;
      const receiptReturnNumber = resData?.returnNumber;
      const receiptBorrowId = resData?.borrowRequest?.id;

      const isReceiptValid =
        res.data?.success === true &&
        typeof receiptReturnNumber === 'string' &&
        receiptReturnNumber.trim().length > 0 &&
        receiptBorrowId === returningBorrow.id;

      if (isReceiptValid) {
        clearPendingBorrowReturn(user.id, returningBorrow.id, key);
        syncStorageIntents();
        setReturningBorrow(null);
        setReturnRows({});
        setReturnNotes('');
        setStatusMessage({
          type: 'success',
          text: `Đã hoàn trả thành công! Mã phiếu trả: ${receiptReturnNumber}`,
        });
        await fetchBorrows();
      } else {
        syncStorageIntents();
        setStatusMessage({
          type: 'error',
          text: 'Máy chủ trả về kết quả không xác định hoặc biên nhận không hợp lệ. Khóa giao dịch đã được giữ lại để đối soát.',
        });
      }
    } catch (err: any) {
      const status = err.response?.status;
      const data = err.response?.data;

      if ((status === 400 || status === 422) && data?.success === false) {
        // Structured definitive API rejection before state change
        const rejectionMsg = data.message || 'Yêu cầu bị từ chối';
        setRejectedReturn({
          borrowId: returningBorrow.id,
          key,
          message: `${rejectionMsg} (HTTP ${status})`,
        });
        setStatusMessage({
          type: 'error',
          text: `${rejectionMsg}. Yêu cầu được giữ lại cho đến khi bạn xác minh và gỡ chặn.`,
        });
      } else {
        // Lost response, timeout, network error, or 5xx: keep guard and pending record intact
        syncStorageIntents();
        setStatusMessage({
          type: 'error',
          text: 'Mất kết nối hoặc phản hồi không rõ ràng từ máy chủ. Khóa Idempotency đã được lưu để bảo vệ số dư kho. Vui lòng đối soát trước khi thao tác tiếp.',
        });
      }
    } finally {
      isSubmittingRef.current = false;
      setActionLoading(null);
    }
  };

  const handleReconcile = async (borrowId: string, key: string) => {
    if (!user?.id) return;
    setActionLoading(borrowId);
    setReconciliationStatus((prev) => ({
      ...prev,
      [borrowId]: { status: 'checking', message: 'Đang kiểm tra đối soát với máy chủ...' },
    }));

    try {
      const res = await apiClient.get(`/borrow-requests/${borrowId}/return-status/${key}`);
      const decision = inspectBorrowReturnStatusResponse(res.data, borrowId);

      if (decision.kind === 'COMPLETED') {
        try {
          clearPendingBorrowReturn(user.id, borrowId, key);
        } catch {
          clearDurableBorrowReturnGuard(user.id, borrowId, key);
        }
        syncStorageIntents();
        setReconciliationStatus((prev) => ({
          ...prev,
          [borrowId]: {
            status: 'completed',
            message: `Giao dịch đã hoàn tất trên máy chủ. Mã phiếu trả: ${decision.returnNumber}`,
          },
        }));
        setStatusMessage({
          type: 'success',
          text: `Đối soát thành công: Giao dịch hoàn trả đã được ghi nhận trước đó (Mã phiếu trả: ${decision.returnNumber})`,
        });
        if (returningBorrow?.id === borrowId) {
          setReturningBorrow(null);
        }
        await fetchBorrows();
      } else {
        setReconciliationStatus((prev) => ({
          ...prev,
          [borrowId]: { status: 'unresolved', message: decision.message },
        }));
        setStatusMessage({
          type: 'warning',
          text: `Kết quả đối soát: ${decision.message}`,
        });
      }
    } catch (err: any) {
      const msg =
        err.response?.data?.message || err.message || 'Không thể kết nối đến máy chủ để đối soát';
      setReconciliationStatus((prev) => ({
        ...prev,
        [borrowId]: { status: 'unresolved', message: `Lỗi kết nối khi đối soát: ${msg}` },
      }));
      setStatusMessage({
        type: 'error',
        text: `Không thể hoàn tất đối soát: ${msg}`,
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleClearRejected = (borrowId: string, key: string) => {
    if (!user?.id) return;
    try {
      clearPendingBorrowReturn(user.id, borrowId, key);
      syncStorageIntents();
      setRejectedReturn(null);
      setStatusMessage({
        type: 'success',
        text: 'Đã gỡ bỏ yêu cầu bị từ chối. Bạn có thể kiểm tra lại thông tin và nhập lại số lượng.',
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `Không thể gỡ bỏ yêu cầu: ${err.message}`,
      });
    }
  };

  const overdueCount = borrows.filter((b) => b.isOverdue).length;

  const filtered = borrows.filter((b) => {
    // Tab filter
    if (activeTab === 'OVERDUE') {
      if (!b.isOverdue) return false;
    } else if (activeTab !== 'ALL') {
      if (b.status !== activeTab) return false;
    }

    // Search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchNumber = b.requestNumber?.toLowerCase().includes(term);
      const matchBorrower = b.borrowerName?.toLowerCase().includes(term);
      const matchPurpose = b.purpose?.toLowerCase().includes(term);
      if (!matchNumber && !matchBorrower && !matchPurpose) return false;
    }

    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between space-y-4 sm:flex-row sm:items-center sm:space-y-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Quản lý Mượn & Trả (Borrow & Return)
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Quy trình đăng ký, duyệt giữ chỗ (Reserved), bàn giao kho và xác nhận hoàn trả linh kiện an toàn
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={fetchBorrows}
            disabled={loading}
            className="inline-flex items-center space-x-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>
          <button className="inline-flex items-center space-x-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-blue-500/20 hover:bg-blue-700">
            <Plus className="h-3.5 w-3.5" />
            <span>Tạo phiếu mượn mới</span>
          </button>
        </div>
      </div>

      <DemoDataNotice moduleName="Borrow & Return Management" />

      {/* Role Notice */}
      {!isOperator && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center space-x-2">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            Bạn đang đăng nhập với vai trò <strong>{user?.role || 'Chưa đăng nhập'}</strong> (Chế độ xem chỉ đọc). Thao tác phê duyệt, bàn giao kho và nhận hoàn trả yêu cầu vai trò Thủ kho (Lab Manager) hoặc Kỹ thuật viên (Technician).
          </span>
        </div>
      )}

      {/* Pending Reconciliation Global Banner */}
      {(pendingReturns.length > 0 || lostReturnGuards.length > 0) && (
        <div className="p-3.5 rounded-lg bg-indigo-50 border border-indigo-200 text-xs text-indigo-900 space-y-2">
          <div className="flex items-center space-x-2 font-semibold">
            <AlertCircle className="h-4 w-4 text-indigo-600 shrink-0" />
            <span>
              Phát hiện {pendingReturns.length + lostReturnGuards.length} giao dịch hoàn trả đang chờ đối soát kết quả với máy chủ:
            </span>
          </div>
          <div className="space-y-1.5 pl-6">
            {pendingReturns.map((p) => (
              <div key={p.key} className="flex items-center justify-between">
                <span>
                  Phiếu <strong>{p.borrowId}</strong> (Khóa: <code className="font-mono">{p.key}</code>)
                </span>
                <button
                  type="button"
                  onClick={() => handleReconcile(p.borrowId, p.key)}
                  disabled={actionLoading === p.borrowId}
                  className="rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {actionLoading === p.borrowId ? 'Đang đối soát...' : 'Kiểm tra đối soát'}
                </button>
              </div>
            ))}
            {lostReturnGuards.map((g) => (
              <div key={g.key} className="flex items-center justify-between">
                <span>
                  Dấu chặn phiên trước: Phiếu <strong>{g.borrowId}</strong> (Khóa: <code className="font-mono">{g.key}</code>)
                </span>
                <button
                  type="button"
                  onClick={() => handleReconcile(g.borrowId, g.key)}
                  disabled={actionLoading === g.borrowId}
                  className="rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {actionLoading === g.borrowId ? 'Đang đối soát...' : 'Kiểm tra đối soát'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status banner */}
      {statusMessage && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center justify-between ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : statusMessage.type === 'warning'
              ? 'bg-amber-50 text-amber-800 border border-amber-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <span>{statusMessage.text}</span>
          <button
            onClick={() => setStatusMessage(null)}
            className="ml-2 font-bold hover:opacity-75"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        {/* Tabs */}
        <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-px">
          {[
            { key: 'ALL', label: 'Tất cả' },
            { key: 'PENDING', label: 'Chờ duyệt (Pending)' },
            { key: 'APPROVED', label: 'Đã duyệt (Approved)' },
            { key: 'HANDED_OVER', label: 'Đang mượn (Handed Over)' },
            { key: 'PARTIALLY_RETURNED', label: 'Đã trả 1 phần' },
            { key: 'RETURNED', label: 'Đã hoàn trả (Returned)' },
            {
              key: 'OVERDUE',
              label: `Quá hạn (${overdueCount})`,
              alert: overdueCount > 0,
            },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`border-b-2 px-3 py-2 text-xs font-semibold transition-colors flex items-center space-x-1 ${
                activeTab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              } ${t.alert ? 'text-red-600 font-bold' : ''}`}
            >
              <span>{t.label}</span>
              {t.alert && (
                <span className="h-2 w-2 rounded-full bg-red-500 inline-block animate-ping" />
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo mã phiếu, người mượn..."
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200/80 bg-slate-50 font-semibold text-slate-600">
              <tr>
                <th className="py-3 px-4">Mã phiếu</th>
                <th className="py-3 px-4">Người mượn</th>
                <th className="py-3 px-4">Trạng thái</th>
                <th className="py-3 px-4">Mục đích mượn</th>
                <th className="py-3 px-4">Ngày hẹn mượn - trả</th>
                <th className="py-3 px-4 text-center">Số loại linh kiện</th>
                <th className="py-3 px-4 text-center">Thao tác xử lý</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                    Không tìm thấy phiếu mượn nào phù hợp với bộ lọc hiện tại.
                  </td>
                </tr>
              ) : (
                filtered.map((b) => {
                  const pendingForThis = pendingReturns.find((p) => p.borrowId === b.id);
                  const guardForThis = lostReturnGuards.find((g) => g.borrowId === b.id);
                  const activeKey = pendingForThis?.key || guardForThis?.key;

                  return (
                    <tr key={b.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 font-mono font-semibold text-blue-600">
                        {b.requestNumber}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">
                          {b.borrowerName || 'Sinh viên'}
                        </div>
                        {b.borrowerEmail && (
                          <div className="text-[11px] text-slate-400">{b.borrowerEmail}</div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-1.5">
                          <StatusBadge status={b.status} variant="borrow" />
                          {b.isOverdue && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
                              Quá hạn
                            </span>
                          )}
                          {activeKey && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                              Chờ đối soát
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs truncate" title={b.purpose}>
                        {b.purpose}
                      </td>
                      <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                        <span>{b.expectedBorrowDate}</span>
                        <span className="mx-1">&rarr;</span>
                        <span className={b.isOverdue ? 'text-red-600 font-semibold' : ''}>
                          {b.expectedReturnDate}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-medium">
                        {b.itemCount}
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        {/* If this borrow has an unresolved return guard, surface reconcile button */}
                        {activeKey ? (
                          <button
                            type="button"
                            onClick={() => handleReconcile(b.id, activeKey)}
                            disabled={actionLoading === b.id}
                            className="inline-flex items-center space-x-1 rounded bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                          >
                            <RefreshCw
                              className={`h-3 w-3 ${actionLoading === b.id ? 'animate-spin' : ''}`}
                            />
                            <span>Đối soát giao dịch</span>
                          </button>
                        ) : (
                          <>
                            {b.status === 'PENDING' && (
                              <div className="inline-flex items-center space-x-1.5">
                                <button
                                  onClick={() => handleApprove(b.id)}
                                  disabled={actionLoading === b.id || !isManager}
                                  className="inline-flex items-center space-x-1 rounded bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                                >
                                  <Check className="h-3 w-3" />
                                  <span>Phê duyệt</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setRejectingBorrowId(b.id);
                                    setRejectReason('');
                                  }}
                                  disabled={actionLoading === b.id || !isManager}
                                  className="inline-flex items-center space-x-1 rounded bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                                >
                                  <XCircle className="h-3 w-3" />
                                  <span>Từ chối</span>
                                </button>
                              </div>
                            )}
                            {b.status === 'APPROVED' && (
                              <div className="inline-flex items-center space-x-1.5">
                                <button
                                  onClick={() => handleHandover(b.id)}
                                  disabled={actionLoading === b.id || !isOperator}
                                  className="inline-flex items-center space-x-1 rounded bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                                >
                                  <ArrowRight className="h-3 w-3" />
                                  <span>Bàn giao kho</span>
                                </button>
                                <button
                                  onClick={() => handleCancel(b.id)}
                                  disabled={actionLoading === b.id || !isManager}
                                  className="inline-flex items-center space-x-1 rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                                >
                                  <span>Hủy phiếu</span>
                                </button>
                              </div>
                            )}
                            {(b.status === 'HANDED_OVER' || b.status === 'PARTIALLY_RETURNED') && isOperator && (
                              <button
                                onClick={() => openReturnModal(b)}
                                disabled={actionLoading === b.id}
                                className="inline-flex items-center space-x-1 rounded bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                              >
                                <CornerDownLeft className="h-3 w-3" />
                                <span>Nhận hoàn trả</span>
                              </button>
                            )}
                            {b.status === 'RETURNED' && (
                              <span className="text-[11px] text-slate-400 font-medium">
                                Đã tất toán
                              </span>
                            )}
                            {b.status === 'REJECTED' && (
                              <span className="text-[11px] text-rose-400 font-medium">
                                Đã từ chối
                              </span>
                            )}
                            {b.status === 'CANCELLED' && (
                              <span className="text-[11px] text-slate-400 font-medium">
                                Đã hủy
                              </span>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Return Modal Dialog */}
      {returningBorrow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <CornerDownLeft className="h-4 w-4 text-emerald-600" />
              <span>Xác nhận hoàn trả linh kiện ({returningBorrow.requestNumber})</span>
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Người mượn: <span className="font-semibold text-slate-700">{returningBorrow.borrowerName}</span>
            </p>

            {/* If there is an unresolved rejected return for this borrow */}
            {rejectedReturn && rejectedReturn.borrowId === returningBorrow.id && (
              <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-2">
                <div className="font-semibold flex items-center space-x-1.5 text-amber-900">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <span>Yêu cầu trước bị máy chủ từ chối:</span>
                </div>
                <p>{rejectedReturn.message}</p>
                <button
                  type="button"
                  onClick={() => handleClearRejected(rejectedReturn.borrowId, rejectedReturn.key)}
                  className="rounded bg-amber-700 text-white px-2.5 py-1 text-[11px] font-semibold hover:bg-amber-800"
                >
                  Xác nhận gỡ bỏ yêu cầu bị từ chối để nhập lại
                </button>
              </div>
            )}

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Danh sách linh kiện và số lượng hoàn trả:
                </label>
                <p className="text-[11px] text-slate-500 mb-2">
                  Nhập số lượng thực tế nhận lại (tối đa bằng số lượng còn lại). Chỉ dòng có số lượng &gt; 0 mới được ghi nhận.
                </p>

                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {returningBorrow.details
                    ?.filter((d) => d.quantity > (d.returnedQuantity || 0))
                    .map((d) => {
                      const remaining = d.quantity - (d.returnedQuantity || 0);
                      const itemLabel = d.item?.code || d.itemId;
                      const selection = returnRows[d.id] || { quantity: '0', condition: 'GOOD' };

                      return (
                        <div
                          key={d.id}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs space-y-2"
                        >
                          <div className="flex items-center justify-between font-semibold text-slate-900">
                            <span>{d.item?.name || itemLabel} ({itemLabel})</span>
                            <span className="text-[11px] text-slate-500">
                              Còn lại: <strong>{remaining}</strong> {d.item?.unit || 'cái'}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label
                                htmlFor={`return-qty-${d.id}`}
                                className="block text-[11px] text-slate-600 mb-0.5"
                              >
                                Số lượng trả:
                              </label>
                              <input
                                id={`return-qty-${d.id}`}
                                aria-label={`Số lượng trả ${itemLabel}`}
                                type="number"
                                min={0}
                                max={remaining}
                                value={selection.quantity}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setReturnRows((prev) => ({
                                    ...prev,
                                    [d.id]: {
                                      quantity: val,
                                      condition: prev[d.id]?.condition || 'GOOD',
                                    },
                                  }));
                                }}
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor={`return-cond-${d.id}`}
                                className="block text-[11px] text-slate-600 mb-0.5"
                              >
                                Tình trạng kiểm tra:
                              </label>
                              <select
                                id={`return-cond-${d.id}`}
                                aria-label={`Tình trạng trả ${itemLabel}`}
                                value={selection.condition}
                                onChange={(e) => {
                                  const cond = e.target.value as ReturnCondition;
                                  setReturnRows((prev) => ({
                                    ...prev,
                                    [d.id]: {
                                      quantity: prev[d.id]?.quantity || '0',
                                      condition: cond,
                                    },
                                  }));
                                }}
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
                              >
                                <option value="GOOD">Tốt (Nhập kho khả dụng)</option>
                                <option value="DAMAGED">Hỏng (Cách ly kiểm tra)</option>
                                <option value="LOST">Báo mất (Giảm tài sản)</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ghi chú kiểm tra (Notes):
                </label>
                <textarea
                  rows={2}
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="Ghi chú thêm về linh kiện hoặc tình trạng bàn giao tại phòng Lab..."
                  className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end space-x-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setReturningBorrow(null)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleReturnConfirm}
                disabled={
                  actionLoading === returningBorrow.id ||
                  Boolean(rejectedReturn && rejectedReturn.borrowId === returningBorrow.id)
                }
                className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                {actionLoading === returningBorrow.id ? 'Đang xử lý...' : 'Xác nhận hoàn trả'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal Dialog */}
      {rejectingBorrowId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl border border-slate-200">
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2 text-rose-600">
              <AlertTriangle className="h-4 w-4" />
              <span>Từ chối yêu cầu mượn linh kiện</span>
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Vui lòng cung cấp lý do từ chối rõ ràng để gửi phản hồi cho người mượn:
            </p>

            <div className="mt-3">
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="VD: Không đủ số lượng khả dụng tại Lab, hoặc đề tài chưa được phê duyệt..."
                className="w-full rounded-lg border border-slate-300 p-2.5 text-xs focus:border-rose-500 focus:outline-none"
              />
            </div>

            <div className="mt-4 flex justify-end space-x-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setRejectingBorrowId(null)}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleRejectConfirm}
                disabled={actionLoading === rejectingBorrowId}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {actionLoading === rejectingBorrowId ? 'Đang xử lý...' : 'Xác nhận từ chối'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
