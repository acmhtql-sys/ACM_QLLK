import React, { useState, useEffect } from 'react';
import {
  ClipboardList,
  Plus,
  Check,
  ArrowRight,
  CornerDownLeft,
  Clock,
  XCircle,
  AlertTriangle,
  Search,
  RefreshCw,
} from 'lucide-react';
import { DemoDataNotice } from '../components/DemoDataNotice';
import { StatusBadge } from '../components/StatusBadge';
import { apiClient } from '../services/api';

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

export const BorrowReturnPage: React.FC = () => {
  const [borrows, setBorrows] = useState<BorrowRecord[]>([]);
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Return dialog state
  const [returningBorrow, setReturningBorrow] = useState<BorrowRecord | null>(null);
  const [returnCondition, setReturnCondition] = useState<'GOOD' | 'DAMAGED' | 'LOST'>('GOOD');
  const [returnNotes, setReturnNotes] = useState<string>('');
  const [pendingReturn, setPendingReturn] = useState<{ borrowId: string; key: string } | null>(null);

  // Reject dialog state
  const [rejectingBorrowId, setRejectingBorrowId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');

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
    setActionLoading(id);
    setStatusMessage(null);
    try {
      const res = await apiClient.patch(`/borrow-requests/${id}/handover`, {
        notes: 'Bàn giao linh kiện tại quầy Lab',
      });
      if (res.data?.success) {
        setStatusMessage({ type: 'success', text: 'Bàn giao kho thành công! Linh kiện đã chuyển sang trạng thái đang mượn.' });
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
    if (!window.confirm('Bạn có chắc chắn muốn hủy phiếu mượn này? Các giữ chỗ tồn kho sẽ được giải phóng.')) {
      return;
    }
    setActionLoading(id);
    setStatusMessage(null);
    try {
      const res = await apiClient.patch(`/borrow-requests/${id}/cancel`, {
        reason: 'Hủy theo yêu cầu người dùng',
      });
      if (res.data?.success) {
        setStatusMessage({ type: 'success', text: 'Đã hủy phiếu mượn thành công và giải phóng tồn kho!' });
        await fetchBorrows();
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Có lỗi xảy ra khi hủy phiếu mượn';
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setActionLoading(null);
    }
  };

  const clearPendingReturn = (borrowId: string) => {
    setPendingReturn(null);
    try { window.sessionStorage.removeItem(`acm.return.pending.${borrowId}`); } catch { /* private mode */ }
  };

  const handleReturnConfirm = async () => {
    if (!returningBorrow || !returningBorrow.details) return;
    if (pendingReturn?.borrowId === returningBorrow.id) {
      setStatusMessage({
        type: 'error',
        text: 'Phiếu trả đang chờ xác minh kết quả. Chỉ được kiểm tra trạng thái, không gửi lại.',
      });
      return;
    }

    const returnItems = returningBorrow.details
      .filter((d) => d.quantity > (d.returnedQuantity || 0))
      .map((d) => ({
        borrowDetailId: d.id,
        returnedQuantity: d.quantity - (d.returnedQuantity || 0),
        condition: returnCondition,
        notes: returnNotes || undefined,
      }));

    if (returnItems.length === 0) {
      setStatusMessage({ type: 'error', text: 'Không còn linh kiện nào cần hoàn trả trong phiếu này' });
      setReturningBorrow(null);
      return;
    }

    // Crypto-generated key; never create a new business intent after an
    // ambiguous network result. Persist only the opaque key in sessionStorage
    // so re-opening the dialog cannot accidentally issue a duplicate POST.
    const key = window.crypto?.randomUUID?.();
    if (!key) {
      setStatusMessage({ type: 'error', text: 'Không thể tạo khóa xác nhận an toàn cho phiếu trả.' });
      return;
    }
    const borrowId = returningBorrow.id;
    setPendingReturn({ borrowId, key });
    try { window.sessionStorage.setItem(`acm.return.pending.${borrowId}`, key); } catch { /* memory only */ }

    setActionLoading(borrowId);
    setStatusMessage(null);
    try {
      const res = await apiClient.post(
        `/borrow-requests/${borrowId}/return`,
        { items: returnItems, notes: returnNotes || 'Hoàn trả linh kiện tại Lab' },
        { headers: { 'Idempotency-Key': key } }
      );

      if (res.data?.success) {
        clearPendingReturn(borrowId);
        setStatusMessage({
          type: 'success',
          text: `Đã hoàn trả thành công! Mã phiếu trả: ${res.data.data?.returnNumber || ''}`,
        });
        setReturningBorrow(null);
        setReturnNotes('');
        await fetchBorrows();
      } else {
        setStatusMessage({
          type: 'error',
          text: 'Phản hồi hoàn trả chưa đủ chứng cứ xác nhận. Hãy kiểm tra trạng thái, không gửi lại POST.',
        });
      }
    } catch {
      // Timeout, 409, 5xx, network error and even unexpected failures are
      // treated as ambiguous. Never resubmit a POST with a fresh key.
      setStatusMessage({
        type: 'error',
        text: 'Chưa xác minh được kết quả hoàn trả. Không gửi lại phiếu; hãy dùng nút Đối soát trạng thái.',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReturnStatusCheck = async () => {
    if (!pendingReturn || !returningBorrow || pendingReturn.borrowId !== returningBorrow.id) return;
    const { borrowId, key } = pendingReturn;
    setActionLoading(borrowId);
    try {
      const res = await apiClient.get(
        `/borrow-requests/${borrowId}/return-idempotency/${encodeURIComponent(key)}`
      );
      const state = res.data?.data;
      if (state?.status === 'COMPLETED' && state?.confirmed && state?.returnNumber) {
        clearPendingReturn(borrowId);
        setStatusMessage({
          type: 'success',
          text: `Đã xác minh hoàn trả thành công. Mã phiếu: ${state.returnNumber}`,
        });
        setReturningBorrow(null);
        setReturnNotes('');
        await fetchBorrows();
      } else {
        setStatusMessage({
          type: 'error',
          text: 'Máy chủ chưa xác nhận giao dịch đã hoàn tất. Giữ nguyên khóa và liên hệ người quản trị; không gửi phiếu mới.',
        });
      }
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'Không thể đối soát tự động. Giữ nguyên phiếu đang chờ và liên hệ quản trị viên.',
      });
    } finally {
      setActionLoading(null);
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
            Quy trình đăng ký, duyệt giữ chỗ (Reserved), bàn giao kho và xác nhận hoàn trả linh kiện
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

      {/* Status banner */}
      {statusMessage && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center justify-between ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <span>{statusMessage.text}</span>
          <button onClick={() => setStatusMessage(null)} className="ml-2 font-bold hover:opacity-75">
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
                filtered.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-4 font-mono font-semibold text-blue-600">
                      {b.requestNumber}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{b.borrowerName || 'Sinh viên'}</div>
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
                      {b.status === 'PENDING' && (
                        <div className="inline-flex items-center space-x-1.5">
                          <button
                            onClick={() => handleApprove(b.id)}
                            disabled={actionLoading === b.id}
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
                            disabled={actionLoading === b.id}
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
                            disabled={actionLoading === b.id}
                            className="inline-flex items-center space-x-1 rounded bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                          >
                            <ArrowRight className="h-3 w-3" />
                            <span>Bàn giao kho</span>
                          </button>
                          <button
                            onClick={() => handleCancel(b.id)}
                            disabled={actionLoading === b.id}
                            className="inline-flex items-center space-x-1 rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                          >
                            <span>Hủy phiếu</span>
                          </button>
                        </div>
                      )}
                      {(b.status === 'HANDED_OVER' || b.status === 'PARTIALLY_RETURNED') && (
                        <button
                          onClick={() => {
                            setReturningBorrow(b);
                            setReturnCondition('GOOD');
                            setReturnNotes('');
                            let pendingKey: string | null = null;
                            try {
                              pendingKey = window.sessionStorage.getItem(`acm.return.pending.${b.id}`);
                            } catch { /* private mode */ }
                            setPendingReturn(pendingKey ? { borrowId: b.id, key: pendingKey } : null);
                          }}
                          disabled={actionLoading === b.id}
                          className="inline-flex items-center space-x-1 rounded bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          <CornerDownLeft className="h-3 w-3" />
                          <span>Nhận hoàn trả</span>
                        </button>
                      )}
                      {b.status === 'RETURNED' && (
                        <span className="text-[11px] text-slate-400 font-medium">Đã tất toán</span>
                      )}
                      {b.status === 'REJECTED' && (
                        <span className="text-[11px] text-rose-400 font-medium">Đã từ chối</span>
                      )}
                      {b.status === 'CANCELLED' && (
                        <span className="text-[11px] text-slate-400 font-medium">Đã hủy</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Return Modal Dialog */}
      {returningBorrow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl border border-slate-200">
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <CornerDownLeft className="h-4 w-4 text-emerald-600" />
              <span>Xác nhận hoàn trả linh kiện ({returningBorrow.requestNumber})</span>
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Người mượn: <span className="font-semibold text-slate-700">{returningBorrow.borrowerName}</span>
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tình trạng kiểm tra thực tế:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setReturnCondition('GOOD')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold border ${
                      returnCondition === 'GOOD'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Tốt (Nhập kho)
                  </button>
                  <button
                    type="button"
                    onClick={() => setReturnCondition('DAMAGED')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold border ${
                      returnCondition === 'DAMAGED'
                        ? 'border-amber-600 bg-amber-50 text-amber-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Hỏng (Cách ly)
                  </button>
                  <button
                    type="button"
                    onClick={() => setReturnCondition('LOST')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold border ${
                      returnCondition === 'LOST'
                        ? 'border-rose-600 bg-rose-50 text-rose-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Báo mất
                  </button>
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
                  placeholder="Ghi chú thêm về linh kiện hoặc tình trạng hư hỏng..."
                  className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {pendingReturn?.borrowId === returningBorrow.id && (
              <div role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold">Phiếu trả đang chờ đối soát với máy chủ.</p>
                <p className="mt-1">Không tạo phiếu trả mới hoặc nhấn gửi lại khi chưa có bằng chứng giao dịch đã hoàn tất.</p>
                <button
                  type="button"
                  onClick={handleReturnStatusCheck}
                  disabled={actionLoading === returningBorrow.id}
                  className="mt-2 rounded border border-amber-500 px-3 py-1 font-semibold disabled:opacity-50"
                >
                  {actionLoading === returningBorrow.id ? 'Đang đối soát...' : 'Đối soát trạng thái (GET)'}
                </button>
              </div>
            )}

            <div className="mt-5 flex justify-end space-x-2">
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
                disabled={actionLoading === returningBorrow.id || pendingReturn?.borrowId === returningBorrow.id}
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
              Vui lòng cung cấp lý do từ chối để thông báo cho người mượn:
            </p>

            <div className="mt-3">
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Ví dụ: Kho hiện đang ưu tiên cấp cho đồ án khóa trước, hoặc linh kiện đang bảo trì..."
                className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-900 focus:border-rose-500 focus:outline-none"
              />
            </div>

            <div className="mt-4 flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setRejectingBorrowId(null)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Quay lại
              </button>
              <button
                type="button"
                onClick={handleRejectConfirm}
                disabled={actionLoading === rejectingBorrowId}
                className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
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
