import React, { useState, useEffect } from 'react';
import {
  Boxes,
  Plus,
  Package,
  Search,
  RefreshCw,
  X,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  ArrowRight,
  Wrench,
  Archive,
  Eye,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { DemoDataNotice } from '../components/DemoDataNotice';
import { StatusBadge } from '../components/StatusBadge';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { apiClient } from '../services/api';
import { KitStatus } from '@acm/shared';

interface KitItemComponent {
  id: string;
  itemId: string;
  item?: { id: string; code: string; name: string; unit: string; type: string };
  quantity: number;
  notes?: string | null;
}

interface KitRecord {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  status: string;
  locationId?: string | null;
  location?: { id: string; code: string; name: string } | null;
  createdById?: string | null;
  createdBy?: { id: string; fullName: string; email: string } | null;
  items: KitItemComponent[];
  totalItems: number;
  createdAt: string;
  updatedAt: string;
}

interface ItemOption {
  id: string;
  code: string;
  name: string;
  unit: string;
}

interface LocationOption {
  id: string;
  code: string;
  name: string;
}

export const KitsPage: React.FC = () => {
  const [kits, setKits] = useState<KitRecord[]>([]);
  const [itemsList, setItemsList] = useState<ItemOption[]>([]);
  const [locationsList, setLocationsList] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [expandedKitId, setExpandedKitId] = useState<string | null>(null);

  // Create Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [createFormData, setCreateFormData] = useState<{
    code: string;
    name: string;
    description: string;
    locationId: string;
    items: { itemId: string; quantity: number; notes: string }[];
  }>({
    code: '',
    name: '',
    description: '',
    locationId: '',
    items: [{ itemId: '', quantity: 1, notes: '' }],
  });

  // Confirmation Modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: 'STATUS' | 'DELETE';
    kit: KitRecord | null;
    targetStatus?: KitStatus;
  }>({
    isOpen: false,
    type: 'STATUS',
    kit: null,
  });

  const fetchKits = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (searchTerm.trim()) params.search = searchTerm.trim();
      if (activeTab !== 'ALL') params.status = activeTab;

      const res = await apiClient.get('/kits', { params });
      if (res.data?.success) {
        const rawData = res.data.data;
        const list = Array.isArray(rawData) ? rawData : rawData?.items || [];
        setKits(list);
      }
    } catch (err: any) {
      console.error('Lỗi khi tải danh sách kit:', err);
      setStatusMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Không thể tải danh sách hộp kit',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchMetadata = async () => {
    try {
      const [itemsRes, locsRes] = await Promise.all([
        apiClient.get('/items', { params: { limit: 100 } }),
        apiClient.get('/locations', { params: { limit: 100 } }),
      ]);

      if (itemsRes.data?.success) {
        const raw = itemsRes.data.data;
        setItemsList(Array.isArray(raw) ? raw : raw?.items || []);
      }
      if (locsRes.data?.success) {
        const raw = locsRes.data.data;
        setLocationsList(Array.isArray(raw) ? raw : raw?.items || []);
      }
    } catch (err) {
      // Fallback
    }
  };

  useEffect(() => {
    fetchKits();
  }, [activeTab]);

  useEffect(() => {
    fetchMetadata();
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchKits();
  };

  const handleAddItemRow = () => {
    setCreateFormData({
      ...createFormData,
      items: [...createFormData.items, { itemId: '', quantity: 1, notes: '' }],
    });
  };

  const handleRemoveItemRow = (index: number) => {
    if (createFormData.items.length <= 1) return;
    const newItems = createFormData.items.filter((_, i) => i !== index);
    setCreateFormData({ ...createFormData, items: newItems });
  };

  const handleItemRowChange = (index: number, field: string, value: any) => {
    const updated = [...createFormData.items];
    updated[index] = { ...updated[index], [field]: value };
    setCreateFormData({ ...createFormData, items: updated });
  };

  const handleCreateKit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading('create');
    setStatusMessage(null);

    // Validate duplicate items
    const itemIds = createFormData.items.map((i) => i.itemId).filter(Boolean);
    if (new Set(itemIds).size !== itemIds.length) {
      setStatusMessage({
        type: 'error',
        text: 'Hộp kit không được chứa linh kiện thành phần trùng lặp!',
      });
      setActionLoading(null);
      return;
    }

    try {
      const payload = {
        code: createFormData.code.trim(),
        name: createFormData.name.trim(),
        description: createFormData.description.trim() || undefined,
        locationId: createFormData.locationId || undefined,
        items: createFormData.items.map((i) => ({
          itemId: i.itemId,
          quantity: Number(i.quantity),
          notes: i.notes.trim() || undefined,
        })),
      };

      const res = await apiClient.post('/kits', payload);
      if (res.data?.success) {
        setStatusMessage({ type: 'success', text: 'Tạo hộp kit và giữ chỗ tồn kho thành công!' });
        setIsCreateModalOpen(false);
        setCreateFormData({
          code: '',
          name: '',
          description: '',
          locationId: '',
          items: [{ itemId: '', quantity: 1, notes: '' }],
        });
        await fetchKits();
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Lỗi khi tạo hộp kit',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleStatusTransition = (kit: KitRecord, targetStatus: KitStatus) => {
    setConfirmModal({
      isOpen: true,
      type: 'STATUS',
      kit,
      targetStatus,
    });
  };

  const executeStatusTransition = async () => {
    if (!confirmModal.kit || !confirmModal.targetStatus) return;
    const kit = confirmModal.kit;
    const targetStatus = confirmModal.targetStatus;
    setActionLoading(`status-${kit.id}`);
    setStatusMessage(null);
    try {
      const res = await apiClient.patch(`/kits/${kit.id}/status`, { status: targetStatus });
      if (res.data?.success) {
        setStatusMessage({
          type: 'success',
          text: `Đã cập nhật trạng thái hộp kit ${kit.code} thành công!`,
        });
        setConfirmModal({ isOpen: false, type: 'STATUS', kit: null });
        await fetchKits();
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Lỗi khi cập nhật trạng thái hộp kit',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteKit = (kit: KitRecord) => {
    setConfirmModal({
      isOpen: true,
      type: 'DELETE',
      kit,
    });
  };

  const executeDeleteKit = async () => {
    if (!confirmModal.kit) return;
    const kit = confirmModal.kit;
    setActionLoading(`delete-${kit.id}`);
    setStatusMessage(null);
    try {
      const res = await apiClient.delete(`/kits/${kit.id}`);
      if (res.data?.success) {
        setStatusMessage({
          type: 'success',
          text: res.data.message || 'Xóa hộp kit thành công!',
        });
        setConfirmModal({ isOpen: false, type: 'DELETE', kit: null });
        await fetchKits();
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Không thể xóa hộp kit',
      });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between space-y-4 sm:flex-row sm:items-center sm:space-y-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Quản trị Hộp Kit Thực hành (Kits Management)
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Quản lý gói bộ linh kiện thực hành, kiểm soát định mức và đồng bộ trừ giữ chỗ tồn kho
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center space-x-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-blue-500/20 hover:bg-blue-700 transition"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Thêm hộp kit mới</span>
        </button>
      </div>

      <DemoDataNotice moduleName="Kit & Practice Bundle Management" />

      {/* Alert Messages */}
      {statusMessage && (
        <div
          className={`flex items-center justify-between rounded-lg p-3 text-xs ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <div className="flex items-center space-x-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-rose-600 flex-shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button onClick={() => setStatusMessage(null)} className="text-slate-400 hover:text-slate-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Filter Tabs & Search */}
      <div className="space-y-3">
        <div className="flex border-b border-slate-200 overflow-x-auto text-xs font-medium">
          {[
            { id: 'ALL', label: 'Tất cả' },
            { id: KitStatus.AVAILABLE, label: 'Sẵn sàng' },
            { id: KitStatus.ALLOCATED, label: 'Đã phân bổ' },
            { id: KitStatus.MAINTENANCE, label: 'Bảo trì' },
            { id: KitStatus.RETIRED, label: 'Đã thanh lý / rã' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 py-2.5 px-4 whitespace-nowrap transition ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
          <form onSubmit={handleSearchSubmit} className="flex flex-1 items-center space-x-2 w-full sm:max-w-md">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm mã kit, tên hộp kit, mô tả..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-slate-300 py-1.5 pl-9 pr-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
            >
              Tìm
            </button>
          </form>

          <button
            onClick={fetchKits}
            disabled={loading}
            className="inline-flex items-center space-x-1 rounded-lg border border-slate-200 p-1.5 text-xs text-slate-600 hover:bg-slate-50"
            title="Làm mới"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Kit Table */}
      <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200/80 bg-slate-50 font-semibold text-slate-600">
              <tr>
                <th className="py-3 px-4">Mã hộp Kit</th>
                <th className="py-3 px-4">Tên gói / Mô tả</th>
                <th className="py-3 px-4">Vị trí lưu kho</th>
                <th className="py-3 px-4 text-center">Trạng thái</th>
                <th className="py-3 px-4 text-center">Linh kiện</th>
                <th className="py-3 px-4">Người tạo</th>
                <th className="py-3 px-4 text-right">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading && kits.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-blue-500" />
                    Đang tải danh sách hộp kit...
                  </td>
                </tr>
              ) : kits.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    Không tìm thấy hộp kit phù hợp.
                  </td>
                </tr>
              ) : (
                kits.map((k) => (
                  <React.Fragment key={k.id}>
                    <tr className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 font-mono font-bold text-blue-600">{k.code}</td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{k.name}</div>
                        {k.description && <div className="text-[11px] text-slate-500">{k.description}</div>}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {k.location ? (
                          <span className="inline-flex items-center text-slate-700">
                            <span className="font-mono text-[11px] text-slate-500 mr-1">[{k.location.code}]</span>
                            {k.location.name}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Chưa xác định</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <StatusBadge status={k.status} variant="kitStatus" />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => setExpandedKitId(expandedKitId === k.id ? null : k.id)}
                          className="inline-flex items-center space-x-1 rounded px-2 py-0.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100"
                        >
                          <Boxes className="h-3 w-3" />
                          <span>{k.items.length} loại ({k.totalItems})</span>
                          {expandedKitId === k.id ? (
                            <ChevronUp className="h-3 w-3 ml-0.5" />
                          ) : (
                            <ChevronDown className="h-3 w-3 ml-0.5" />
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {k.createdBy ? k.createdBy.fullName : '-'}
                      </td>
                      <td className="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                        {/* Status FSM Actions */}
                        {k.status === KitStatus.AVAILABLE && (
                          <>
                            <button
                              onClick={() => handleStatusTransition(k, KitStatus.ALLOCATED)}
                              disabled={actionLoading !== null}
                              className="rounded bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                              title="Bàn giao kit"
                            >
                              Bàn giao
                            </button>
                            <button
                              onClick={() => handleStatusTransition(k, KitStatus.MAINTENANCE)}
                              disabled={actionLoading !== null}
                              className="rounded bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100"
                              title="Chuyển bảo trì"
                            >
                              Bảo trì
                            </button>
                            <button
                              onClick={() => handleStatusTransition(k, KitStatus.RETIRED)}
                              disabled={actionLoading !== null}
                              className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
                              title="Rã kit trả linh kiện về kho"
                            >
                              Rã kit
                            </button>
                          </>
                        )}

                        {k.status === KitStatus.ALLOCATED && (
                          <button
                            onClick={() => handleStatusTransition(k, KitStatus.AVAILABLE)}
                            disabled={actionLoading !== null}
                            className="rounded bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                            title="Xác nhận nhận lại kit"
                          >
                            Thu hồi
                          </button>
                        )}

                        {k.status === KitStatus.MAINTENANCE && (
                          <>
                            <button
                              onClick={() => handleStatusTransition(k, KitStatus.AVAILABLE)}
                              disabled={actionLoading !== null}
                              className="rounded bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                              title="Hoàn tất bảo trì"
                            >
                              Xong bảo trì
                            </button>
                            <button
                              onClick={() => handleStatusTransition(k, KitStatus.RETIRED)}
                              disabled={actionLoading !== null}
                              className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
                              title="Rã kit"
                            >
                              Rã kit
                            </button>
                          </>
                        )}

                        {k.status === KitStatus.RETIRED && (
                          <button
                            onClick={() => handleStatusTransition(k, KitStatus.AVAILABLE)}
                            disabled={actionLoading !== null}
                            className="rounded bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                            title="Tái lắp ráp hộp kit"
                          >
                            Tái lắp ráp
                          </button>
                        )}

                        {/* Delete Button (disabled if allocated) */}
                        <button
                          onClick={() => handleDeleteKit(k)}
                          disabled={k.status === KitStatus.ALLOCATED || actionLoading !== null}
                          className="rounded p-1 text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:hover:bg-transparent"
                          title={k.status === KitStatus.ALLOCATED ? 'Không thể xóa kit đang phân bổ' : 'Xóa hộp kit'}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>

                    {/* Accordion Component items details */}
                    {expandedKitId === k.id && (
                      <tr className="bg-slate-50/80">
                        <td colSpan={7} className="p-4">
                          <div className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="font-semibold text-xs text-slate-800 mb-2">
                              Danh sách linh kiện trong hộp kit ({k.items.length} loại linh kiện):
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                              {k.items.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between rounded border border-slate-100 p-2 text-xs bg-slate-50/50"
                                >
                                  <div>
                                    <div className="font-semibold text-slate-900">
                                      {item.item?.name || item.itemId}
                                    </div>
                                    <div className="font-mono text-[10px] text-slate-500">
                                      {item.item?.code || '-'}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <span className="font-bold text-blue-600">
                                      x{item.quantity} {item.item?.unit || 'cái'}
                                    </span>
                                    {item.notes && (
                                      <div className="text-[10px] text-slate-400 italic">
                                        {item.notes}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Thêm hộp kit mới */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">Thêm hộp kit thực hành mới</h2>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateKit} className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700">Mã hộp kit *</label>
                  <input
                    type="text"
                    required
                    placeholder="KIT-IOT-001"
                    value={createFormData.code}
                    onChange={(e) => setCreateFormData({ ...createFormData, code: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono uppercase focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700">Tên hộp kit *</label>
                  <input
                    type="text"
                    required
                    placeholder="Bộ thực hành IoT ESP32 Cơ bản"
                    value={createFormData.name}
                    onChange={(e) => setCreateFormData({ ...createFormData, name: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Vị trí lưu trữ hộp kit (kho/tủ) *</label>
                <select
                  required
                  value={createFormData.locationId}
                  onChange={(e) => setCreateFormData({ ...createFormData, locationId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">-- Chọn vị trí lưu kho để kiểm tra & trừ giữ chỗ tồn kho --</option>
                  {locationsList.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      [{loc.code}] {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Mô tả bài thực hành</label>
                <textarea
                  rows={2}
                  placeholder="Ghi chú thành phần, bài học hoặc đề tài thực tập tương ứng..."
                  value={createFormData.description}
                  onChange={(e) => setCreateFormData({ ...createFormData, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Dynamic Items Rows */}
              <div className="border-t border-slate-100 pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-900">
                    Linh kiện thành phần trong Kit ({createFormData.items.length}) *
                  </label>
                  <button
                    type="button"
                    onClick={handleAddItemRow}
                    className="inline-flex items-center space-x-1 rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-slate-200"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Thêm linh kiện</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {createFormData.items.map((row, idx) => (
                    <div key={idx} className="flex items-center space-x-2 bg-slate-50 p-2 rounded-lg border border-slate-200/80">
                      <select
                        required
                        value={row.itemId}
                        onChange={(e) => handleItemRowChange(idx, 'itemId', e.target.value)}
                        className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-xs bg-white"
                      >
                        <option value="">-- Chọn linh kiện --</option>
                        {itemsList.map((itm) => (
                          <option key={itm.id} value={itm.id}>
                            [{itm.code}] {itm.name} ({itm.unit})
                          </option>
                        ))}
                      </select>

                      <input
                        type="number"
                        required
                        min={1}
                        placeholder="SL"
                        value={row.quantity}
                        onChange={(e) => handleItemRowChange(idx, 'quantity', e.target.value)}
                        className="w-16 rounded border border-slate-300 px-2 py-1.5 text-xs text-center bg-white"
                      />

                      <input
                        type="text"
                        placeholder="Ghi chú (tuỳ chọn)"
                        value={row.notes}
                        onChange={(e) => handleItemRowChange(idx, 'notes', e.target.value)}
                        className="w-32 rounded border border-slate-300 px-2 py-1.5 text-xs bg-white"
                      />

                      <button
                        type="button"
                        onClick={() => handleRemoveItemRow(idx)}
                        disabled={createFormData.items.length <= 1}
                        className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="rounded-lg px-4 py-2 font-medium text-slate-600 hover:bg-slate-100"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === 'create'}
                  className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {actionLoading === 'create' ? 'Đang tạo...' : 'Lưu hộp Kit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Status Transition or Delete */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={
          confirmModal.type === 'DELETE'
            ? `Xác nhận xóa hộp Kit ${confirmModal.kit?.code}`
            : `Thay đổi trạng thái Kit ${confirmModal.kit?.code}`
        }
        message={
          confirmModal.type === 'DELETE' ? (
            <div>
              <p>
                Bạn có chắc chắn muốn xóa hộp kit <strong>"{confirmModal.kit?.name}"</strong> ({confirmModal.kit?.code})?
              </p>
              <p className="mt-2 text-rose-600 font-semibold">
                Toàn bộ các linh kiện thành phần đã gán vào kit này sẽ được tự động giải phóng hoàn toàn về kho khả dụng (Available).
              </p>
            </div>
          ) : (
            <p>
              Bạn có chắc muốn chuyển trạng thái hộp kit sang{' '}
              <strong className="text-blue-600">{confirmModal.targetStatus}</strong>?
            </p>
          )
        }
        confirmLabel={confirmModal.type === 'DELETE' ? 'Xác nhận xóa Kit' : 'Cập nhật trạng thái'}
        variant={confirmModal.type === 'DELETE' ? 'danger' : 'warning'}
        isLoading={Boolean(actionLoading)}
        onConfirm={confirmModal.type === 'DELETE' ? executeDeleteKit : executeStatusTransition}
        onCancel={() => setConfirmModal({ isOpen: false, type: 'STATUS', kit: null })}
      />
    </div>
  );
};
