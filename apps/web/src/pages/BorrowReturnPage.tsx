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
  X,
  Package,
  Calendar,
  User,
  Trash2,
} from 'lucide-react';
import { DemoDataNotice } from '../components/DemoDataNotice';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSkeleton, TableSkeleton } from '../components/common/LoadingSkeleton';
import { EmptyState } from '../components/common/EmptyState';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { apiClient } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { canApproveBorrow, canProcessHandoverOrReturn } from '../config/access';
import { useToast } from '../context/ToastContext';

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

interface ItemOption {
  id: string;
  code: string;
  name: string;
  unit: string;
  available: number;
}

export const BorrowReturnPage: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const canManage = canApproveBorrow(user?.role);
  const canHandoverOrReturn = canProcessHandoverOrReturn(user?.role);

  const [borrows, setBorrows] = useState<BorrowRecord[]>([]);
  const [itemsList, setItemsList] = useState<ItemOption[]>([]);
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Return dialog state
  const [returningBorrow, setReturningBorrow] = useState<BorrowRecord | null>(null);
  const [returnCondition, setReturnCondition] = useState<'GOOD' | 'DAMAGED' | 'LOST'>('GOOD');
  const [returnNotes, setReturnNotes] = useState<string>('');

  // Reject dialog state
  const [rejectingBorrowId, setRejectingBorrowId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');

  // Create Borrow Request Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [createFormData, setCreateFormData] = useState({
    purpose: '',
    expectedBorrowDate: new Date().toISOString().slice(0, 10),
    expectedReturnDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    notes: '',
    items: [{ itemId: '', quantity: 1, notes: '' }],
  });
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});

  // Confirmation Modal state for critical actions
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: 'APPROVE' | 'HANDOVER' | 'CANCEL';
    borrow: BorrowRecord | null;
  }>({
    isOpen: false,
    type: 'APPROVE',
    borrow: null,
  });

  const fetchBorrows = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/borrow-requests');
      if (res.data?.success) {
        setBorrows(res.data.data);
      }
    } catch (err: any) {
      toast.error('Lỗi tải dữ liệu', err?.response?.data?.message || 'Không thể tải danh sách phiếu mượn.');
    } finally {
      setLoading(false);
    }
  };

  const fetchItems = async () => {
    try {
      const res = await apiClient.get('/items', { params: { limit: 100 } });
      if (res.data?.success && res.data.data?.items) {
        setItemsList(
          res.data.data.items.map((i: any) => ({
            id: i.id,
            code: i.code,
            name: i.name,
            unit: i.unit,
            available: i.available ?? 0,
          }))
        );
      }
    } catch {
      // Graceful fallback
    }
  };

  useEffect(() => {
    fetchBorrows();
    fetchItems();
  }, []);

  const openCreateModal = () => {
    setCreateFormData({
      purpose: '',
      expectedBorrowDate: new Date().toISOString().slice(0, 10),
      expectedReturnDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      notes: '',
      items: [{ itemId: itemsList[0]?.id || '', quantity: 1, notes: '' }],
    });
    setCreateErrors({});
    setIsCreateModalOpen(true);
  };

  const handleAddItemRow = () => {
    setCreateFormData({
      ...createFormData,
      items: [...createFormData.items, { itemId: '', quantity: 1, notes: '' }],
    });
  };

  const handleRemoveItemRow = (idx: number) => {
    if (createFormData.items.length <= 1) return;
    setCreateFormData({
      ...createFormData,
      items: createFormData.items.filter((_, i) => i !== idx),
    });
  };

  const validateCreateForm = () => {
    const errs: Record<string, string> = {};
    if (!createFormData.purpose.trim() || createFormData.purpose.trim().length < 5) {
      errs.purpose = 'Mục đích mượn phải có ít nhất 5 ký tự (VD: Thực hành môn Robot)';
    }
    if (!createFormData.expectedBorrowDate) {
      errs.expectedBorrowDate = 'Vui lòng chọn ngày mượn dự kiến';
    }
    if (!createFormData.expectedReturnDate) {
      errs.expectedReturnDate = 'Vui lòng chọn ngày trả dự kiến';
    } else if (createFormData.expectedReturnDate < createFormData.expectedBorrowDate) {
      errs.expectedReturnDate = 'Ngày hẹn trả không thể trước ngày mượn';
    }

    createFormData.items.forEach((it, idx) => {
      if (!it.itemId) {
        errs[`item_${idx}`] = 'Vui lòng chọn linh kiện';
      }
      if (it.quantity < 1) {
        errs[`qty_${idx}`] = 'Số lượng mượn tối thiểu là 1';
      }
    });

    setCreateErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateCreateForm()) return;

    setSubmittingCreate(true);
    try {
      const payload = {
        purpose: createFormData.purpose.trim(),
        expectedBorrowDate: new Date(createFormData.expectedBorrowDate).toISOString(),
        expectedReturnDate: new Date(createFormData.expectedReturnDate).toISOString(),
        notes: createFormData.notes.trim() || undefined,
        items: createFormData.items.map((it) => ({
          itemId: it.itemId,
          quantity: Number(it.quantity),
          notes: it.notes.trim() || undefined,
        })),
      };

      const res = await apiClient.post('/borrow-requests', payload);
      if (res.data?.success) {
        toast.success(
          'Tạo phiếu mượn thành công',
          `Phiếu ${res.data.data?.requestNumber || ''} đã được gửi và đang chờ quản lý Lab duyệt.`
        );
        setIsCreateModalOpen(false);
        await fetchBorrows();
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Có lỗi xảy ra khi tạo phiếu mượn';
      toast.error('Lỗi tạo phiếu mượn', msg);
    } finally {
      setSubmittingCreate(false);
    }
  };

  const handleApproveConfirm = async () => {
    if (!confirmModal.borrow) return;
    const bId = confirmModal.borrow.id;
    setActionLoading(bId);
    try {
      const res = await apiClient.patch(`/borrow-requests/${bId}/approve`, {
        notes: 'Phê duyệt từ giao diện quản trị',
      });
      if (res.data?.success) {
        toast.success(
          'Đã phê duyệt phiếu mượn',
          `Phiếu ${confirmModal.borrow.requestNumber} đã duyệt thành công và giữ chỗ (Reserved) tồn kho.`
        );
        setConfirmModal({ isOpen: false, type: 'APPROVE', borrow: null });
        await fetchBorrows();
      }
    } catch (err: any) {
      toast.error('Lỗi phê duyệt', err.response?.data?.message || 'Không thể phê duyệt phiếu mượn.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleHandoverConfirm = async () => {
    if (!confirmModal.borrow) return;
    const bId = confirmModal.borrow.id;
    setActionLoading(bId);
    try {
      const res = await apiClient.patch(`/borrow-requests/${bId}/handover`, {
        notes: 'Xác nhận bàn giao thực tế tại phòng Lab',
      });
      if (res.data?.success) {
        toast.success(
          'Bàn giao kho thành công',
          `Đã xuất kho bàn giao linh kiện phiếu ${confirmModal.borrow.requestNumber}.`
        );
        setConfirmModal({ isOpen: false, type: 'HANDOVER', borrow: null });
        await fetchBorrows();
      }
    } catch (err: any) {
      toast.error('Lỗi bàn giao', err.response?.data?.message || 'Không thể xác nhận bàn giao.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelConfirm = async () => {
    if (!confirmModal.borrow) return;
    const bId = confirmModal.borrow.id;
    setActionLoading(bId);
    try {
      const res = await apiClient.patch(`/borrow-requests/${bId}/cancel`, {
        reason: 'Hủy phiếu theo yêu cầu của người mượn hoặc quản trị viên',
      });
      if (res.data?.success) {
        toast.success('Đã hủy phiếu mượn', `Phiếu ${confirmModal.borrow.requestNumber} đã được hủy.`);
        setConfirmModal({ isOpen: false, type: 'CANCEL', borrow: null });
        await fetchBorrows();
      }
    } catch (err: any) {
      toast.error('Lỗi hủy phiếu', err.response?.data?.message || 'Không thể hủy phiếu mượn.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectingBorrowId) return;
    if (!rejectReason.trim() || rejectReason.trim().length < 3) {
      toast.error('Yêu cầu nhập lý do', 'Vui lòng cung cấp lý do từ chối tối thiểu 3 ký tự.');
      return;
    }
    setActionLoading(rejectingBorrowId);
    try {
      const res = await apiClient.patch(`/borrow-requests/${rejectingBorrowId}/reject`, {
        rejectionReason: rejectReason.trim(),
      });
      if (res.data?.success) {
        toast.success('Đã từ chối phiếu mượn', 'Hệ thống đã cập nhật trạng thái từ chối.');
        setRejectingBorrowId(null);
        setRejectReason('');
        await fetchBorrows();
      }
    } catch (err: any) {
      toast.error('Lỗi từ chối', err.response?.data?.message || 'Không thể từ chối phiếu mượn.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReturnSubmit = async () => {
    if (!returningBorrow || !returningBorrow.details) return;
    setActionLoading(returningBorrow.id);
    try {
      const returnItems = returningBorrow.details
        .filter((d) => d.quantity > (d.returnedQuantity || 0))
        .map((d) => ({
          borrowDetailId: d.id,
          returnedQuantity: d.quantity - (d.returnedQuantity || 0),
          condition: returnCondition,
          notes: returnNotes || undefined,
        }));

      if (returnItems.length === 0) {
        toast.warning('Thông báo', 'Không còn linh kiện nào cần hoàn trả trong phiếu này.');
        setReturningBorrow(null);
        return;
      }

      const res = await apiClient.post(`/borrow-requests/${returningBorrow.id}/return`, {
        items: returnItems,
        notes: returnNotes || 'Hoàn trả linh kiện tại phòng Lab',
      });

      if (res.data?.success) {
        toast.success(
          'Hoàn trả thành công',
          `Đã nhập lại kho thành công! Mã giao dịch trả: ${res.data.data?.returnNumber || ''}`
        );
        setReturningBorrow(null);
        setReturnNotes('');
        await fetchBorrows();
      }
    } catch (err: any) {
      toast.error('Lỗi hoàn trả', err.response?.data?.message || 'Có lỗi xảy ra khi xác nhận hoàn trả.');
    } finally {
      setActionLoading(null);
    }
  };

  const overdueCount = borrows.filter((b) => b.isOverdue).length;

  const filtered = borrows.filter((b) => {
    if (activeTab === 'OVERDUE') {
      if (!b.isOverdue) return false;
    } else if (activeTab !== 'ALL') {
      if (b.status !== activeTab) return false;
    }

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
      {/* Header */}
      <div className="flex flex-col justify-between space-y-4 sm:flex-row sm:items-center sm:space-y-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Quản lý Mượn & Trả (Borrow & Return)
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Quy trình đăng ký, duyệt giữ chỗ (Reserved), bàn giao xuất kho và kiểm tra hoàn trả linh kiện
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
          <button
            onClick={openCreateModal}
            className="inline-flex items-center space-x-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-blue-500/20 hover:bg-blue-700"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Tạo phiếu mượn mới</span>
          </button>
        </div>
      </div>

      <DemoDataNotice moduleName="Borrow & Return Management" />

      {/* Filter Tabs & Search */}
      <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
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

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo mã phiếu, người mượn, mục đích..."
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Main Table */}
      {loading ? (
        <TableSkeleton rows={5} columns={7} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Không tìm thấy phiếu mượn nào"
          description={
            searchTerm
              ? `Không có phiếu mượn nào khớp với từ khóa "${searchTerm}".`
              : 'Không có phiếu mượn nào trong trạng thái đã chọn.'
          }
          icon={ClipboardList}
          actionLabel="Tạo phiếu mượn mới"
          onAction={openCreateModal}
        />
      ) : (
        <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200/80 bg-slate-50 font-semibold text-slate-600">
                <tr>
                  <th className="py-3 px-4">Mã phiếu</th>
                  <th className="py-3 px-4">Người mượn</th>
                  <th className="py-3 px-4">Trạng thái</th>
                  <th className="py-3 px-4">Mục đích mượn</th>
                  <th className="py-3 px-4">Ngày mượn - Hẹn trả</th>
                  <th className="py-3 px-4 text-center">Số loại LK</th>
                  <th className="py-3 px-4 text-center">Thao tác xử lý</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filtered.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-4 font-mono font-semibold text-blue-600">
                      {b.requestNumber}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{b.borrowerName || 'Không tên'}</div>
                      <div className="text-[11px] text-slate-400">{b.borrowerEmail || '-'}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-1.5">
                        <StatusBadge status={b.status} variant="borrow" />
                        {b.isOverdue && (
                          <span className="inline-flex items-center rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">
                            QUÁ HẠN
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 max-w-xs truncate text-slate-600" title={b.purpose}>
                      {b.purpose}
                    </td>
                    <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                      <div>
                        {new Date(b.expectedBorrowDate).toLocaleDateString('vi-VN')} &rarr;{' '}
                        <span className={b.isOverdue ? 'font-bold text-rose-600' : ''}>
                          {new Date(b.expectedReturnDate).toLocaleDateString('vi-VN')}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center font-semibold text-slate-800">
                      {b.itemCount} loại
                    </td>
                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      {b.status === 'PENDING' && canManage && (
                        <div className="inline-flex items-center space-x-1.5">
                          <button
                            onClick={() =>
                              setConfirmModal({
                                isOpen: true,
                                type: 'APPROVE',
                                borrow: b,
                              })
                            }
                            disabled={actionLoading === b.id}
                            className="inline-flex items-center space-x-1 rounded bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                          >
                            <Check className="h-3 w-3" />
                            <span>Duyệt</span>
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

                      {b.status === 'APPROVED' && canHandoverOrReturn && (
                        <div className="inline-flex items-center space-x-1.5">
                          <button
                            onClick={() =>
                              setConfirmModal({
                                isOpen: true,
                                type: 'HANDOVER',
                                borrow: b,
                              })
                            }
                            disabled={actionLoading === b.id}
                            className="inline-flex items-center space-x-1 rounded bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                          >
                            <ArrowRight className="h-3 w-3" />
                            <span>Bàn giao kho</span>
                          </button>
                          {canManage && <button
                            onClick={() =>
                              setConfirmModal({
                                isOpen: true,
                                type: 'CANCEL',
                                borrow: b,
                              })
                            }
                            disabled={actionLoading === b.id}
                            className="inline-flex items-center space-x-1 rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                          >
                            <span>Hủy phiếu</span>
                          </button>}
                        </div>
                      )}

                      {(b.status === 'HANDED_OVER' || b.status === 'PARTIALLY_RETURNED') && canHandoverOrReturn && (
                        <button
                          onClick={() => {
                            setReturningBorrow(b);
                            setReturnCondition('GOOD');
                            setReturnNotes('');
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CREATE BORROW REQUEST MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <Plus className="h-4 w-4 text-blue-600" />
                <span>Đăng ký Phiếu mượn Linh kiện mới</span>
              </h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700">Mục đích mượn *</label>
                <input
                  type="text"
                  value={createFormData.purpose}
                  onChange={(e) => setCreateFormData({ ...createFormData, purpose: e.target.value })}
                  placeholder="VD: Thực hành môn Robot & Vi điều khiển K18..."
                  className={`mt-1 w-full rounded-lg border px-3 py-2 text-xs focus:outline-none ${
                    createErrors.purpose ? 'border-rose-500' : 'border-slate-300 focus:border-blue-600'
                  }`}
                />
                {createErrors.purpose && <p className="mt-1 text-[11px] text-rose-600">{createErrors.purpose}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700">Ngày mượn dự kiến *</label>
                  <input
                    type="date"
                    value={createFormData.expectedBorrowDate}
                    onChange={(e) => setCreateFormData({ ...createFormData, expectedBorrowDate: e.target.value })}
                    className={`mt-1 w-full rounded-lg border px-3 py-2 text-xs focus:outline-none ${
                      createErrors.expectedBorrowDate ? 'border-rose-500' : 'border-slate-300 focus:border-blue-600'
                    }`}
                  />
                  {createErrors.expectedBorrowDate && (
                    <p className="mt-1 text-[11px] text-rose-600">{createErrors.expectedBorrowDate}</p>
                  )}
                </div>
                <div>
                  <label className="block font-semibold text-slate-700">Ngày hẹn trả *</label>
                  <input
                    type="date"
                    value={createFormData.expectedReturnDate}
                    onChange={(e) => setCreateFormData({ ...createFormData, expectedReturnDate: e.target.value })}
                    className={`mt-1 w-full rounded-lg border px-3 py-2 text-xs focus:outline-none ${
                      createErrors.expectedReturnDate ? 'border-rose-500' : 'border-slate-300 focus:border-blue-600'
                    }`}
                  />
                  {createErrors.expectedReturnDate && (
                    <p className="mt-1 text-[11px] text-rose-600">{createErrors.expectedReturnDate}</p>
                  )}
                </div>
              </div>

              {/* Items List inside request */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="font-semibold text-slate-700">Danh sách linh kiện mượn *</label>
                  <button
                    type="button"
                    onClick={handleAddItemRow}
                    className="inline-flex items-center space-x-1 text-blue-600 hover:text-blue-700 font-semibold text-[11px]"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Thêm linh kiện</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto p-1">
                  {createFormData.items.map((row, idx) => (
                    <div key={idx} className="flex items-center space-x-2 rounded-lg bg-slate-50 p-2 border border-slate-200">
                      <div className="flex-1">
                        <select
                          value={row.itemId}
                          onChange={(e) => {
                            const newItems = [...createFormData.items];
                            newItems[idx].itemId = e.target.value;
                            setCreateFormData({ ...createFormData, items: newItems });
                          }}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-blue-600 focus:outline-none"
                        >
                          <option value="">-- Chọn linh kiện --</option>
                          {itemsList.map((item) => (
                            <option key={item.id} value={item.id}>
                              [{item.code}] {item.name} (Khả dụng: {item.available} {item.unit})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="w-20">
                        <input
                          type="number"
                          min={1}
                          value={row.quantity}
                          onChange={(e) => {
                            const newItems = [...createFormData.items];
                            newItems[idx].quantity = Math.max(1, parseInt(e.target.value) || 1);
                            setCreateFormData({ ...createFormData, items: newItems });
                          }}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-center text-xs focus:border-blue-600 focus:outline-none"
                        />
                      </div>

                      {createFormData.items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveItemRow(idx)}
                          className="p-1 text-slate-400 hover:text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Ghi chú thêm</label>
                <textarea
                  rows={2}
                  value={createFormData.notes}
                  onChange={(e) => setCreateFormData({ ...createFormData, notes: e.target.value })}
                  placeholder="Ghi chú thêm nếu cần bàn giao phụ kiện kèm theo..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  disabled={submittingCreate}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submittingCreate}
                  className="inline-flex items-center space-x-1.5 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {submittingCreate && (
                    <svg className="h-3.5 w-3.5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                  <span>{submittingCreate ? 'Đang gửi yêu cầu...' : 'Gửi yêu cầu mượn'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL FOR CRITICAL ACTIONS */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={
          confirmModal.type === 'APPROVE'
            ? `Phê duyệt phiếu mượn ${confirmModal.borrow?.requestNumber}`
            : confirmModal.type === 'HANDOVER'
            ? `Xác nhận bàn giao kho ${confirmModal.borrow?.requestNumber}`
            : `Hủy phiếu mượn ${confirmModal.borrow?.requestNumber}`
        }
        message={
          confirmModal.type === 'APPROVE' ? (
            <p>
              Hệ thống sẽ chuyển trạng thái sang <strong>APPROVED</strong> và tự động giữ chỗ (Reserved) toàn bộ linh kiện tương ứng. Bạn có chắc chắn muốn phê duyệt?
            </p>
          ) : confirmModal.type === 'HANDOVER' ? (
            <p>
              Xác nhận đã giao đủ linh kiện vật lý cho người mượn. Số lượng linh kiện sẽ được trừ On-Hand xuất kho và chuyển sang trạng thái <strong>HANDED_OVER</strong>.
            </p>
          ) : (
            <p className="text-rose-600">
              Bạn có chắc chắn muốn hủy phiếu mượn này? Toàn bộ số lượng linh kiện đang giữ chỗ sẽ được giải phóng hoàn toàn về kho khả dụng.
            </p>
          )
        }
        confirmLabel={
          confirmModal.type === 'APPROVE'
            ? 'Phê duyệt ngay'
            : confirmModal.type === 'HANDOVER'
            ? 'Xác nhận xuất bàn giao'
            : 'Xác nhận hủy phiếu'
        }
        variant={confirmModal.type === 'CANCEL' ? 'danger' : 'info'}
        isLoading={actionLoading === confirmModal.borrow?.id}
        onConfirm={
          confirmModal.type === 'APPROVE'
            ? handleApproveConfirm
            : confirmModal.type === 'HANDOVER'
            ? handleHandoverConfirm
            : handleCancelConfirm
        }
        onCancel={() => setConfirmModal({ isOpen: false, type: 'APPROVE', borrow: null })}
      />

      {/* Return Dialog */}
      {returningBorrow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <CornerDownLeft className="h-4 w-4 text-emerald-600" />
              <span>Xác nhận hoàn trả linh kiện ({returningBorrow.requestNumber})</span>
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Người mượn: <span className="font-semibold text-slate-700">{returningBorrow.borrowerName}</span>
            </p>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Tình trạng kiểm tra thực tế:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setReturnCondition('GOOD')}
                    className={`py-2 px-2 rounded-lg font-semibold border ${
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
                    className={`py-2 px-2 rounded-lg font-semibold border ${
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
                    className={`py-2 px-2 rounded-lg font-semibold border ${
                      returnCondition === 'LOST'
                        ? 'border-rose-600 bg-rose-50 text-rose-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Mất (Bồi hoàn)
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ghi chú kiểm tra</label>
                <textarea
                  rows={2}
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="Ghi chú chi tiết về tình trạng vỏ hộp, dây nối hoặc hỏng hóc nếu có..."
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="mt-5 flex justify-end space-x-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setReturningBorrow(null)}
                  disabled={actionLoading === returningBorrow.id}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={handleReturnSubmit}
                  disabled={actionLoading === returningBorrow.id}
                  className="rounded-lg bg-emerald-600 px-4 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {actionLoading === returningBorrow.id ? 'Đang ghi nhận...' : 'Xác nhận nhận trả'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectingBorrowId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <h3 className="text-sm font-bold text-rose-600 flex items-center space-x-2">
              <XCircle className="h-4 w-4" />
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
