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
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSkeleton, TableSkeleton } from '../components/common/LoadingSkeleton';
import { EmptyState } from '../components/common/EmptyState';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { apiClient } from '../services/api';
import {
  clearPendingBorrowReturn,
  listPendingBorrowReturns,
  readPendingBorrowReturn,
  savePendingBorrowReturn,
  listDurableBorrowReturnGuards,
  clearDurableBorrowReturnGuard,
  type DurableBorrowReturnGuard,
  type PendingBorrowReturn,
} from './borrowReturnPending';
import { inspectBorrowReturnStatusResponse } from './borrowReturnStatusClient';
import { inspectReturnHistoryResponse, type ReturnHistoryEntry } from './borrowReturnHistory';
import { useAuth } from '../hooks/useAuth';
import { canApproveBorrow, canProcessHandoverOrReturn } from '../config/access';
import { useToast } from '../context/ToastContext';
import {
  buildReturnItems,
  createReturnIdempotencyKey,
  type ReturnCondition,
  type ReturnInputRow,
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
  borrowerId: string;
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
  const [returnRows, setReturnRows] = useState<Record<string, ReturnInputRow>>({});
  const [returnNotes, setReturnNotes] = useState<string>('');
  // Outstanding return intents survive reload in this tab until server confirmation.
  const [pendingReturns, setPendingReturns] = useState<PendingBorrowReturn[]>([]);
  const [lostReturnGuards, setLostReturnGuards] = useState<DurableBorrowReturnGuard[]>([]);
  const [checkingLostReturn, setCheckingLostReturn] = useState<string | null>(null);
  const [lostReturnMessages, setLostReturnMessages] = useState<Record<string, string>>({});
  const activeActorRef = React.useRef(user?.id);
  activeActorRef.current = user?.id;
  // Stage 4C-1: server-backed, read-only return history, never permission to replay a lost POST.
  const [historyBorrow, setHistoryBorrow] = useState<{ id: string; number: string } | null>(null);
  const [historyItems, setHistoryItems] = useState<ReturnHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRequestRef = React.useRef(0);
  const [returnStorageError, setReturnStorageError] = useState<string | null>(null);
  // Only an explicit API 400/422 rejection permits an operator to release a saved intent.
  const [rejectedReturn, setRejectedReturn] = useState<{
    borrowId: string;
    key: string;
    status: 400 | 422;
  } | null>(null);
  const pendingReturnForDialog = Boolean(returningBorrow &&
    pendingReturns.some((p) => p.borrowId === returningBorrow.id));

  useEffect(() => {
    // A previous actor's in-flight return must not alter the next actor's view.
    setBorrows([]);
    setItemsList([]);
    setActionLoading(null);
    setCheckingLostReturn(null);
    setRejectedReturn(null);
    setReturningBorrow(null);
    historyRequestRef.current++;
    setHistoryBorrow(null);
    setHistoryItems([]);
    setHistoryError(null);
    setHistoryLoading(false);
    setReturnRows({});
    setReturnNotes('');
    setReturnStorageError(null);
    if (!user?.id) {
      setPendingReturns([]);
      setLostReturnGuards([]);
      setLostReturnMessages({});
      return;
    }
    try {
      const pending = listPendingBorrowReturns(user.id);
      const guards = listDurableBorrowReturnGuards(user.id);
      setPendingReturns(pending);
      setLostReturnGuards(guards.filter((g) => !pending.some((p) => p.borrowId === g.borrowId && p.key === g.key)));
      setLostReturnMessages({});
      setReturnStorageError(null);
    } catch (err) {
      setLostReturnGuards([]);
      setReturnStorageError(err instanceof Error ? err.message : 'Không đọc được giao dịch tạm');
    }
  }, [user?.id]);

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
    const requestActor = activeActorRef.current;
    setLoading(true);
    try {
      const res = await apiClient.get('/borrow-requests');
      if (activeActorRef.current === requestActor && res.data?.success) {
        setBorrows(res.data.data);
      }
    } catch (err: any) {
      if (activeActorRef.current === requestActor) {
        toast.error('Lỗi tải dữ liệu', err?.response?.data?.message || 'Không thể tải danh sách phiếu mượn.');
      }
    } finally {
      if (activeActorRef.current === requestActor) setLoading(false);
    }
  };

  const fetchItems = async () => {
    const requestActor = activeActorRef.current;
    try {
      const res = await apiClient.get('/items', { params: { limit: 100 } });
      if (activeActorRef.current === requestActor && res.data?.success) {
        // /items returns data as an array and pagination in meta, not data.items.
        // Accept the object shape only for backwards-compatible fixtures.
        const list = Array.isArray(res.data.data) ? res.data.data : res.data.data?.items || [];
        setItemsList(
          list.map((i: any) => ({
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
    if (user?.id) {
      fetchBorrows();
      fetchItems();
    }
  }, [user?.id]);

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

  const postSavedReturn = async (record: PendingBorrowReturn) => {
    const res = await apiClient.post(
      `/borrow-requests/${record.borrowId}/return`,
      record.payload,
      { headers: { 'Idempotency-Key': record.key } }
    );
    // Even a valid delayed receipt must not mutate a different actor's UI/storage.
    // Leave the old actor's persisted key to be reconciled after switching back.
    if (activeActorRef.current !== record.userId) return;
    if (!res.data?.success) {
      throw new Error('API không xác nhận giao dịch hoàn trả thành công');
    }
    // Check the server receipt before removing the only copy of the original key/payload.
    const returnNumber = res.data?.data?.returnNumber;
    const confirmedBorrowId = res.data?.data?.borrowRequest?.id;
    if (typeof returnNumber !== 'string' || !returnNumber.trim() ||
        confirmedBorrowId !== record.borrowId) {
      throw new Error('Biên nhận hoàn trả thiếu mã giao dịch hoặc không khớp phiếu mượn; giữ nguyên yêu cầu đã lưu để đối soát');
    }
    // Only a verified matching server receipt authorizes clearing the saved intent.
    clearPendingBorrowReturn(record.userId, record.borrowId, record.key);
    setPendingReturns(listPendingBorrowReturns(record.userId));
    setRejectedReturn((prev) => prev?.borrowId === record.borrowId && prev.key === record.key ? null : prev);
    setReturnStorageError(null);
    toast.success(
      'Hoàn trả thành công',
      `Đã ghi nhận giao dịch trả: ${returnNumber}`
    );
    if (returningBorrow?.id === record.borrowId) {
      setReturningBorrow(null);
      setReturnRows({});
      setReturnNotes('');
    }
    await fetchBorrows();
  };

  const handleReturnFailure = (record: PendingBorrowReturn, err: any) => {
    if (activeActorRef.current !== record.userId) return;
    const status = err?.response?.status;
    const body = err?.response?.data;
    // A structured API rejection is different from timeout, 409, 5xx or malformed 2xx.
    if ((status === 400 || status === 422) && body?.success === false &&
        typeof body?.message === 'string' && body.message.trim()) {
      setRejectedReturn({ borrowId: record.borrowId, key: record.key, status });
      toast.error('Yêu cầu hoàn trả bị từ chối',
        `${body.message} (HTTP ${status}). Yêu cầu được giữ lại cho đến khi bạn xác minh và xác nhận gỡ chặn.`);
      return;
    }
    setRejectedReturn(null);
    toast.error('Giao dịch chưa xác nhận',
      err?.response?.data?.message || err?.message ||
      'Giữ nguyên khóa và nội dung giao dịch đã lưu. Vui lòng kiểm tra trước khi gửi lại.');
  };

  const handleReleaseRejectedReturn = async () => {
    if (!user?.id || !rejectedReturn || actionLoading || returnStorageError) return;
    const rejected = rejectedReturn;
    try {
      const saved = readPendingBorrowReturn(user.id, rejected.borrowId);
      if (!saved || saved.key !== rejected.key) {
        throw new Error('Khóa giao dịch đang lưu không khớp — không thể gỡ chặn');
      }
      const confirmed = window.confirm(
        `API đã trả HTTP ${rejected.status}, từ chối yêu cầu này. Chỉ xóa yêu cầu chờ nếu bạn đã đối soát và xác nhận chưa có giao dịch hoàn trả được ghi. Bạn có chắc muốn gỡ chặn không?`
      );
      if (!confirmed) return;
      clearPendingBorrowReturn(saved.userId, saved.borrowId, saved.key);
      setPendingReturns(listPendingBorrowReturns(saved.userId));
      setRejectedReturn(null);
      if (returningBorrow?.id === saved.borrowId) {
        setReturningBorrow(null);
        setReturnRows({});
        setReturnNotes('');
      }
      toast.warning('Đã gỡ yêu cầu bị API từ chối',
        'Hãy kiểm tra lại tồn kho và phiếu mượn trước khi tạo yêu cầu mới.');
      await fetchBorrows();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Không thể đọc yêu cầu đã lưu';
      setReturnStorageError(message);
      toast.error('Không thể gỡ chặn an toàn', message);
    }
  };

  const handleReturnSubmit = async () => {
    if (!returningBorrow || actionLoading === returningBorrow.id || !user?.id || returnStorageError) return;
    let saved: PendingBorrowReturn;
    try {
      const existing = readPendingBorrowReturn(user.id, returningBorrow.id);
      if (existing) {
        // Never recompute the body from an edited form when reusing a key.
        saved = existing;
      } else {
        const returnItems = buildReturnItems(
          returningBorrow.details || [], returnRows, returnNotes
        );
        saved = {
          version: 1,
          userId: user.id,
          borrowId: returningBorrow.id,
          key: createReturnIdempotencyKey(),
          payload: {
            items: returnItems,
            notes: returnNotes.trim() || 'Hoàn trả linh kiện tại phòng Lab',
          },
          createdAt: Date.now(),
        };
        // Must persist before sending; fail closed if storage is unavailable.
        savePendingBorrowReturn(saved);
      }
      setPendingReturns(listPendingBorrowReturns(user.id));
    } catch (err) {
      toast.error('Không thể gửi hoàn trả',
        err instanceof Error ? err.message : 'Không lưu được giao dịch an toàn');
      return;
    }
    setActionLoading(returningBorrow.id);
    try {
      await postSavedReturn(saved);
    } catch (err: any) {
      handleReturnFailure(saved, err);
    } finally {
      if (activeActorRef.current === saved.userId) setActionLoading(null);
    }
  };

  const handleResumePendingReturn = async (borrowId: string) => {
    if (!user?.id || actionLoading || returnStorageError) return;
    let saved: PendingBorrowReturn;
    try {
      const existing = readPendingBorrowReturn(user.id, borrowId);
      if (!existing) throw new Error('Không tìm thấy giao dịch đã lưu');
      saved = existing;
    } catch (err) {
      toast.error('Không thể khôi phục giao dịch', err instanceof Error ? err.message : 'Lỗi dữ liệu');
      return;
    }
    setActionLoading(borrowId);
    try {
      // Explicit click only: this POST might execute if the original never reached the server.
      await postSavedReturn(saved);
    } catch (err: any) {
      handleReturnFailure(saved, err);
    } finally {
      if (activeActorRef.current === saved.userId) setActionLoading(null);
    }
  };
  // Stage 2B: missing session payload means GET status only. Never POST a reconstructed return.
  const handleCheckLostReturn = async (guard: DurableBorrowReturnGuard) => {
    if (!user?.id || !canHandoverOrReturn || user.id !== guard.userId ||
        actionLoading || checkingLostReturn || returnStorageError) return;
    setCheckingLostReturn(guard.borrowId);
    try {
      const latest = listDurableBorrowReturnGuards(guard.userId)
        .find((g) => g.borrowId === guard.borrowId);
      if (!latest || latest.key !== guard.key) {
        throw new Error('Dấu chặn đã thay đổi — vui lòng tải lại trang trước khi đối soát');
      }
      if (readPendingBorrowReturn(guard.userId, guard.borrowId)) {
        throw new Error('Vẫn còn payload trong phiên; dùng luồng giao dịch đã lưu, không giải phóng dấu chặn này');
      }
      const res = await apiClient.get(
        `/borrow-requests/${guard.borrowId}/return-status/${encodeURIComponent(guard.key)}`
      );
      if (activeActorRef.current !== guard.userId) {
        throw new Error('Tài khoản đã thay đổi khi đang đối soát — giữ nguyên dấu chặn');
      }
      const result = inspectBorrowReturnStatusResponse(res.data, guard.borrowId);
      if (result.kind !== 'COMPLETED') {
        setLostReturnMessages((prev) => ({ ...prev, [guard.borrowId]: result.message }));
        toast.warning('Chưa thể gỡ chặn hoàn trả', result.message);
        return;
      }
      const current = listDurableBorrowReturnGuards(guard.userId)
        .find((g) => g.borrowId === guard.borrowId);
      if (!current || current.key !== guard.key || readPendingBorrowReturn(guard.userId, guard.borrowId)) {
        throw new Error('Dữ liệu giao dịch đã thay đổi trong lúc đối soát — giữ nguyên dấu chặn');
      }
      // Verified status from this actor, this exact key and borrow request permits releasing metadata.
      clearDurableBorrowReturnGuard(guard.userId, guard.borrowId, guard.key);
      setLostReturnGuards(listDurableBorrowReturnGuards(guard.userId));
      setLostReturnMessages((prev) => {
        const updated = { ...prev };
        delete updated[guard.borrowId];
        return updated;
      });
      toast.success('Đã đối soát hoàn trả', `Đã xác nhận giao dịch ${result.returnNumber} từ máy chủ.`);
      await fetchBorrows();
    } catch (err: any) {
      if (activeActorRef.current !== guard.userId) return;
      const message = 'Không thể tra cứu trạng thái: ' +
        (err?.response?.data?.message || err?.message || 'Lỗi kết nối máy chủ');
      setLostReturnMessages((prev) => ({ ...prev, [guard.borrowId]: message }));
      toast.error('Không thể đối soát hoàn trả', message);
    } finally {
      if (activeActorRef.current === guard.userId) setCheckingLostReturn(null);
    }
  };

  const handleOpenReturnHistory = async (borrow: BorrowRecord) => {
    const actorId = activeActorRef.current;
    if (!actorId || !canHandoverOrReturn) return;
    const requestId = ++historyRequestRef.current;
    setHistoryBorrow({ id: borrow.id, number: borrow.requestNumber });
    setHistoryItems([]);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const response = await apiClient.get(`/borrow-requests/${encodeURIComponent(borrow.id)}`);
      if (activeActorRef.current !== actorId || historyRequestRef.current !== requestId) return;
      setHistoryItems(inspectReturnHistoryResponse(response.data, borrow.id));
    } catch (err: any) {
      if (activeActorRef.current !== actorId || historyRequestRef.current !== requestId) return;
      setHistoryError(err?.response?.data?.message || err?.message || 'Không tra cứu được lịch sử hoàn trả');
    } finally {
      if (activeActorRef.current === actorId && historyRequestRef.current === requestId) {
        setHistoryLoading(false);
      }
    }
  };
  const closeReturnHistory = () => {
    historyRequestRef.current++;
    setHistoryBorrow(null);
    setHistoryItems([]);
    setHistoryError(null);
    setHistoryLoading(false);
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
      {returnStorageError && (
        <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          Không thể xác minh dữ liệu giao dịch hoàn trả đang lưu. Chặn thao tác hoàn trả mới:
          {returnStorageError}
        </div>
      )}
      {rejectedReturn && pendingReturns.some((p) =>
        p.borrowId === rejectedReturn.borrowId && p.key === rejectedReturn.key) && (
        <div role="alert" className="rounded-lg border border-orange-400 bg-orange-50 p-3 text-sm text-orange-900">
          <strong>API đã từ chối giao dịch (HTTP {rejectedReturn.status}).</strong>
          Yêu cầu vẫn được lưu nguyên vẹn để đối soát. Chỉ gỡ chặn khi đã xác nhận
          giao dịch này chưa được ghi nhận; không áp dụng cho lỗi mạng, HTTP 409 hay 5xx.
          <button
            type="button"
            onClick={handleReleaseRejectedReturn}
            disabled={Boolean(actionLoading) || Boolean(returnStorageError)}
            className="mt-2 block rounded border border-orange-500 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50"
          >
            Xóa yêu cầu đã bị từ chối sau khi đối soát
          </button>
        </div>
      )}
      {lostReturnGuards.length > 0 && (
        <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          <strong>Có giao dịch hoàn trả mất dữ liệu phiên, chưa được đối soát.</strong>
          <p className="mt-1">Không tạo giao dịch mới cho các phiếu này. Chỉ tra cứu trạng thái bằng
            khóa đã lưu; không gửi lại POST khi không còn payload gốc.</p>
          {lostReturnGuards.map((guard) => (
            <div key={guard.key} className="mt-3 space-y-2 rounded border border-rose-200 p-2">
              <p>Phiếu {guard.borrowId.slice(0, 8)} — khóa hoàn trả {guard.key.slice(0, 15)}…</p>
              {canHandoverOrReturn && (
                <button type="button"
                  onClick={() => void handleCheckLostReturn(guard)}
                  disabled={Boolean(actionLoading) || Boolean(checkingLostReturn) || Boolean(returnStorageError)}
                  className="rounded border border-rose-500 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">
                  Kiểm tra trạng thái giao dịch ({guard.borrowId.slice(0, 8)})
                </button>
              )}
              {lostReturnMessages[guard.borrowId] && (
                <p role="status" className="text-xs font-semibold">{lostReturnMessages[guard.borrowId]}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {pendingReturns.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Yêu cầu hoàn trả chưa được xác nhận.</strong> Mỗi lần gửi lại sử dụng
          đúng khóa và nội dung đã gửi, kể cả sau khi tải lại trang. Không tự động gửi API.
          <div className="mt-2 flex flex-wrap gap-2">
            {pendingReturns.map((pending) => (
              <button
                key={pending.key}
                type="button"
                onClick={() => handleResumePendingReturn(pending.borrowId)}
                disabled={Boolean(actionLoading) || Boolean(returnStorageError)}
                className="rounded-lg border border-amber-500 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50"
              >
                Gửi lại giao dịch đã lưu ({pending.borrowId.slice(0, 8)})
              </button>
            ))}
          </div>
        </div>
      )}
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 lg:hidden">
            <span className="text-[11px] text-slate-600">
              Cuộn ngang để xem đủ thông tin
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => document.getElementById('acm-borrow-table-scroll')?.scrollTo({ left: 0, behavior: 'smooth' })}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
              >
                ← Mã phiếu
              </button>
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById('acm-borrow-table-scroll');
                  if (el) el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
                }}
                className="rounded bg-blue-600 px-2 py-1 text-xs text-white"
              >
                Thao tác →
              </button>
            </div>
          </div>
          <div
            id="acm-borrow-table-scroll"
            role="region"
            aria-label="Bảng phiếu mượn có thể cuộn ngang"
            tabIndex={0}
            className="overflow-x-auto overscroll-x-contain"
          >
            <table className="w-full min-w-[960px] text-left text-xs">
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
                      <div className="mb-1 font-mono text-[10px] text-slate-500 lg:hidden">{b.requestNumber}</div>
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

                      {b.status === 'PENDING' && user?.role === 'STUDENT' && b.borrowerId === user.id && (
                        <button
                          onClick={() => setConfirmModal({ isOpen: true, type: 'CANCEL', borrow: b })}
                          disabled={actionLoading === b.id}
                          className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                        >
                          Hủy phiếu của tôi
                        </button>
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

                      {canHandoverOrReturn && ['HANDED_OVER', 'PARTIALLY_RETURNED', 'RETURNED'].includes(b.status) && (
                        <button
                          type="button"
                          onClick={() => { void handleOpenReturnHistory(b); }}
                          className="mr-2 inline-flex items-center rounded bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-100"
                        >
                          Đối soát lịch sử
                        </button>
                      )}

                      {(b.status === 'HANDED_OVER' || b.status === 'PARTIALLY_RETURNED') && canHandoverOrReturn && (
                        <button
                          onClick={() => {
                            const details = b.details || [];

                            if (!details.some((d) => d.quantity > (d.returnedQuantity || 0))) {
                              toast.warning(
                                'Không còn số lượng phải trả',
                                'Phiếu mượn này không còn linh kiện cần hoàn trả.'
                              );
                              return;
                            }

                            const nextRows: Record<string, ReturnInputRow> = {};

                            details.forEach((d) => {
                              if (d.quantity > (d.returnedQuantity || 0)) {
                                nextRows[d.id] = {
                                  quantity: '0',
                                  condition: 'GOOD',
                                };
                              }
                            });

                            setReturnRows(nextRows);
                            setReturningBorrow(b);
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
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <CornerDownLeft className="h-4 w-4 text-emerald-600" />
              <span>Xác nhận hoàn trả linh kiện ({returningBorrow.requestNumber})</span>
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Người mượn: <span className="font-semibold text-slate-700">{returningBorrow.borrowerName}</span>
            </p>

            <div className="mt-4 space-y-3 text-xs">
              <div className="space-y-3">
                <p className="text-slate-600">
                  Chọn số lượng trả cho từng linh kiện. Mặc định là 0 để tránh
                  hoàn trả nhầm toàn bộ. Chỉ những dòng có số lượng lớn hơn 0
                  mới được gửi lên hệ thống.
                </p>

                {returningBorrow.details
                  ?.filter((d) => d.quantity > (d.returnedQuantity || 0))
                  .map((d) => {
                    const remaining = d.quantity - (d.returnedQuantity || 0);
                    const selection = returnRows[d.id] || {
                      quantity: '0',
                      condition: 'GOOD' as const,
                    };
                    const itemLabel = d.item?.code || d.itemId;

                    return (
                      <div
                        key={d.id}
                        className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2"
                      >
                        <div className="font-semibold text-slate-900">
                          {d.item?.name || itemLabel} ({itemLabel})
                        </div>
                        <div className="text-slate-500">
                          Đã mượn: {d.quantity} · Đã trả: {d.returnedQuantity || 0}
                          {' · '}Còn lại: {remaining}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label
                              htmlFor={`return-quantity-${d.id}`}
                              className="block font-semibold text-slate-700 mb-1"
                            >
                              Số lượng trả lần này
                            </label>
                            <input disabled={pendingReturnForDialog}
                              id={`return-quantity-${d.id}`}
                              aria-label={`Số lượng trả ${itemLabel}`}
                              type="number"
                              min={0}
                              max={remaining}
                              step={1}
                              value={selection.quantity}
                              onChange={(e) =>
                                setReturnRows((prev) => ({
                                  ...prev,
                                  [d.id]: {
                                    ...(prev[d.id] || {
                                      quantity: '0',
                                      condition: 'GOOD' as const,
                                    }),
                                    quantity: e.target.value,
                                  },
                                }))
                              }
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor={`return-condition-${d.id}`}
                              className="block font-semibold text-slate-700 mb-1"
                            >
                              Tình trạng
                            </label>
                            <select disabled={pendingReturnForDialog}
                              id={`return-condition-${d.id}`}
                              aria-label={`Tình trạng trả ${itemLabel}`}
                              value={selection.condition}
                              onChange={(e) =>
                                setReturnRows((prev) => ({
                                  ...prev,
                                  [d.id]: {
                                    ...(prev[d.id] || {
                                      quantity: '0',
                                      condition: 'GOOD' as const,
                                    }),
                                    condition: e.target.value as ReturnCondition,
                                  },
                                }))
                              }
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                            >
                              <option value="GOOD">GOOD — Tốt</option>
                              <option value="DAMAGED">DAMAGED — Hỏng, cách ly</option>
                              <option value="LOST">LOST — Mất</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ghi chú kiểm tra</label>
                <textarea disabled={pendingReturnForDialog}
                  rows={2}
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="Ghi chú chi tiết về tình trạng vỏ hộp, dây nối hoặc hỏng hóc nếu có..."
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-600 focus:outline-none"
                />
              </div>

              {pendingReturnForDialog && (
                <p role="status" className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                  Yêu cầu hoàn trả này đã được gửi hoặc đang chờ xác minh. Biểu mẫu đã khóa;
                  nhấn “Xác nhận nhận trả” để gửi lại đúng khóa và nội dung ban đầu.
                </p>
              )}
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

      {/* Stage 4C-1: read-only history from the server. Never clears pending guards. */}
      {historyBorrow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div role="dialog" aria-label="Đối soát lịch sử hoàn trả"
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-base font-bold">Lịch sử hoàn trả — {historyBorrow.number}</h3>
            <p className="mt-2 text-xs text-amber-800">
              Chỉ là dữ liệu đã ghi nhận trên máy chủ. Không thấy giao dịch không chứng minh một yêu cầu
              bị mất đã không thực hiện; hãy đối soát trước khi tạo lần trả mới.
            </p>
            {historyLoading && <p role="status" className="mt-3 text-sm">Đang tải lịch sử...</p>}
            {historyError && <p role="alert" className="mt-3 text-sm text-rose-700">
              Không xác minh được lịch sử: {historyError}. Không coi đây là bằng chứng chưa hoàn trả.
            </p>}
            {!historyLoading && !historyError && historyItems.length === 0 && (
              <p className="mt-3 text-sm">Máy chủ chưa trả về bản ghi hoàn trả. Điều này không chứng minh yêu cầu trước chưa được ghi.</p>
            )}
            {!historyLoading && !historyError && historyItems.map((entry) => (
              <div key={entry.id} className="mt-3 rounded-lg border border-slate-200 p-3 text-sm">
                <div className="font-semibold">{entry.returnNumber}</div>
                <div className="text-xs text-slate-600">
                  {new Date(entry.createdAt).toLocaleString('vi-VN')} · Người nhận: {entry.receiverName}
                </div>
                <ul className="mt-2 list-disc pl-5 text-xs">
                  {entry.details.map((detail, index) => (
                    <li key={`${entry.id}-${index}`}>
                      {detail.itemLabel}: {detail.quantity} · {detail.condition}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <button type="button" onClick={closeReturnHistory}
              className="mt-4 rounded bg-slate-100 px-3 py-2 text-sm font-semibold">
              Đóng lịch sử hoàn trả
            </button>
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
