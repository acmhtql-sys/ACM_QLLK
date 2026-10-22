import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Search,
  Filter,
  AlertTriangle,
  Barcode,
  Eye,
  Pencil,
  Power,
  RotateCcw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Layers,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge';
import { ToastContainer, ToastMessage } from '../components/Toast';
import { ItemFormModal } from '../components/items/ItemFormModal';
import { ItemDetailModal } from '../components/items/ItemDetailModal';
import { ItemStatusModal } from '../components/items/ItemStatusModal';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { apiClient } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import {
  ItemResponse,
  ItemType,
  StockStatus,
  ItemSortField,
  SortOrder,
  PaginationMeta,
} from '@acm/shared';

export const ItemsPage: React.FC = () => {
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN' || user?.role === 'LAB_MANAGER';
  const isStudent = user?.role === 'STUDENT';

  // Data states
  const [items, setItems] = useState<ItemResponse[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 20,
    totalItems: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all'); // 'all', 'active', 'inactive'
  const [selectedStockStatus, setSelectedStockStatus] = useState<string>('all'); // 'all', IN_STOCK, LOW_STOCK, OUT_OF_STOCK
  const [isLowStockFilter, setIsLowStockFilter] = useState<boolean>(false);

  // Sorting and Pagination
  const [sortBy, setSortBy] = useState<ItemSortField>(ItemSortField.CREATED_AT);
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.DESC);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  // Modals state
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [formModalMode, setFormModalMode] = useState<'create' | 'edit'>('create');
  const [selectedItemForForm, setSelectedItemForForm] = useState<ItemResponse | null>(null);

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedItemIdForDetail, setSelectedItemIdForDetail] = useState<string | null>(null);

  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [selectedItemForStatus, setSelectedItemForStatus] = useState<ItemResponse | null>(null);

  // Delete confirmation modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ItemResponse | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);

  // Toast notifications state
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (type: 'success' | 'error' | 'warning' | 'info', title: string, description?: string) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, type, title, description }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1); // Reset to page 1 on new search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Fetch categories on mount
  useEffect(() => {
    async function fetchCategories() {
      try {
        const res = await apiClient.get('/categories');
        if (res.data?.success) {
          setCategories(res.data.data);
        }
      } catch (_err) {
        // Fallback silently if categories fail to load
      }
    }
    fetchCategories();
  }, []);

  // Fetch items from Backend API
  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.append('search', debouncedSearch);
      if (selectedCategory) params.append('categoryId', selectedCategory);
      if (selectedType) params.append('type', selectedType);

      // Status filter
      if (isStudent) {
        params.append('isActive', 'true');
      } else if (selectedStatus === 'active') {
        params.append('isActive', 'true');
      } else if (selectedStatus === 'inactive') {
        params.append('isActive', 'false');
      }

      // Stock status filter
      if (selectedStockStatus !== 'all') {
        params.append('stockStatus', selectedStockStatus);
      }

      if (isLowStockFilter) {
        params.append('isLowStock', 'true');
      }

      params.append('sortBy', sortBy);
      params.append('sortOrder', sortOrder);
      params.append('page', page.toString());
      params.append('limit', limit.toString());

      const res = await apiClient.get(`/items?${params.toString()}`);

      if (res.data?.success) {
        setItems(res.data.data || []);
        if (res.data.meta) {
          setMeta(res.data.meta);
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Không thể tải danh sách linh kiện từ máy chủ.');
      addToast('error', 'Lỗi tải dữ liệu', 'Không thể kết nối hoặc tải danh sách linh kiện.');
    } finally {
      setLoading(false);
    }
  }, [
    debouncedSearch,
    selectedCategory,
    selectedType,
    selectedStatus,
    selectedStockStatus,
    isLowStockFilter,
    sortBy,
    sortOrder,
    page,
    limit,
    isStudent,
  ]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Reset all filters
  const handleResetFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setSelectedCategory('');
    setSelectedType('');
    setSelectedStatus('all');
    setSelectedStockStatus('all');
    setIsLowStockFilter(false);
    setSortBy(ItemSortField.CREATED_AT);
    setSortOrder(SortOrder.DESC);
    setPage(1);
  };

  // Safe item deletion handler with confirmation modal
  const handleDeleteItem = (item: ItemResponse) => {
    setItemToDelete(item);
    setDeleteModalOpen(true);
  };

  const confirmDeleteItem = async () => {
    if (!itemToDelete) return;
    setDeletingItem(true);
    try {
      const res = await apiClient.delete(`/items/${itemToDelete.id}`);
      if (res.data?.success) {
        addToast('success', 'Xóa thành công', `Đã xóa linh kiện: ${itemToDelete.code}`);
        setDeleteModalOpen(false);
        setItemToDelete(null);
        fetchItems();
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Không thể xóa linh kiện';
      addToast('error', 'Lỗi xóa linh kiện', msg);
    } finally {
      setDeletingItem(false);
    }
  };

  // Header click for sorting
  const handleSort = (field: ItemSortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === SortOrder.ASC ? SortOrder.DESC : SortOrder.ASC);
    } else {
      setSortBy(field);
      setSortOrder(SortOrder.ASC);
    }
    setPage(1);
  };

  const renderSortIcon = (field: ItemSortField) => {
    if (sortBy !== field) {
      return <ArrowUpDown className="h-3 w-3 text-slate-300 group-hover:text-slate-500 inline ml-1" />;
    }
    return sortOrder === SortOrder.ASC ? (
      <ArrowUp className="h-3 w-3 text-blue-600 inline ml-1" />
    ) : (
      <ArrowDown className="h-3 w-3 text-blue-600 inline ml-1" />
    );
  };

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

      {/* Header */}
      <div className="flex flex-col justify-between space-y-4 sm:flex-row sm:items-center sm:space-y-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Quản lý Linh kiện & Thiết bị (Items)
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Danh mục phần cứng phòng Lab, theo dõi số lượng khả dụng và cảnh báo tồn kho an toàn
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => fetchItems()}
            disabled={loading}
            title="Làm mới dữ liệu"
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
          </button>

          {canManage && (
            <button
              onClick={() => {
                setSelectedItemForForm(null);
                setFormModalMode('create');
                setFormModalOpen(true);
              }}
              className="inline-flex items-center space-x-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-blue-500/20 hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Thêm linh kiện mới</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tìm theo mã SKU hoặc tên linh kiện..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-1.5 pl-9 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
            />
          </div>

          {/* Quick Active Filters & Counter */}
          <div className="flex items-center space-x-2 text-xs text-slate-500 shrink-0">
            <span>Tổng số: <strong className="font-semibold text-slate-900">{meta.totalItems}</strong> linh kiện</span>
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          <div className="flex items-center space-x-1 text-xs text-slate-500 mr-1">
            <Filter className="h-3.5 w-3.5" />
            <span className="font-medium">Bộ lọc:</span>
          </div>

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => {
              setSelectedCategory(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-200 bg-slate-50/50 py-1 px-2.5 text-xs text-slate-700 focus:bg-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Tất cả danh mục</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Item Type Filter */}
          <select
            value={selectedType}
            onChange={(e) => {
              setSelectedType(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-200 bg-slate-50/50 py-1 px-2.5 text-xs text-slate-700 focus:bg-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Tất cả loại (Item Type)</option>
            <option value={ItemType.CONSUMABLE}>Tiêu hao (CONSUMABLE)</option>
            <option value={ItemType.TRACKED_ASSET}>Quản lý Barcode (TRACKED_ASSET)</option>
            <option value={ItemType.EQUIPMENT}>Thiết bị máy móc (EQUIPMENT)</option>
          </select>

          {/* Status Filter (Hidden/Locked for Students) */}
          {!isStudent && (
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-200 bg-slate-50/50 py-1 px-2.5 text-xs text-slate-700 focus:bg-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Đang hoạt động (Active)</option>
              <option value="inactive">Ngưng hoạt động (Inactive)</option>
            </select>
          )}

          {/* Stock Status Filter */}
          <select
            value={selectedStockStatus}
            onChange={(e) => {
              setSelectedStockStatus(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-200 bg-slate-50/50 py-1 px-2.5 text-xs text-slate-700 focus:bg-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">Tất cả tình trạng tồn</option>
            <option value={StockStatus.IN_STOCK}>Sẵn sàng (IN_STOCK)</option>
            <option value={StockStatus.LOW_STOCK}>Sắp hết (LOW_STOCK)</option>
            <option value={StockStatus.OUT_OF_STOCK}>Đã hết (OUT_OF_STOCK)</option>
          </select>

          {/* Low Stock Toggle */}
          <button
            type="button"
            onClick={() => {
              setIsLowStockFilter(!isLowStockFilter);
              setPage(1);
            }}
            className={`inline-flex items-center space-x-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
              isLowStockFilter
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-slate-50/50 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <AlertTriangle className={`h-3 w-3 ${isLowStockFilter ? 'text-amber-600' : 'text-slate-400'}`} />
            <span>Cảnh báo thiếu hàng</span>
          </button>

          {/* Reset Filters Button */}
          {(debouncedSearch || selectedCategory || selectedType || selectedStatus !== 'all' || selectedStockStatus !== 'all' || isLowStockFilter) && (
            <button
              onClick={handleResetFilters}
              className="inline-flex items-center space-x-1 text-xs text-rose-600 hover:text-rose-700 ml-auto font-medium"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Xóa bộ lọc</span>
            </button>
          )}
        </div>
      </div>

      {/* Items Table */}
      <div className="rounded-xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200/80 bg-slate-50 font-semibold text-slate-600">
              <tr>
                <th
                  onClick={() => handleSort(ItemSortField.CODE)}
                  className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition-colors group"
                >
                  Mã SKU {renderSortIcon(ItemSortField.CODE)}
                </th>
                <th
                  onClick={() => handleSort(ItemSortField.NAME)}
                  className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition-colors group"
                >
                  Tên linh kiện / Thiết bị {renderSortIcon(ItemSortField.NAME)}
                </th>
                <th className="py-3 px-4">Danh mục</th>
                <th className="py-3 px-4">Loại Item</th>
                <th className="py-3 px-4 text-center">Đơn vị</th>
                <th className="py-3 px-4 text-right">Tồn vật lý</th>
                <th className="py-3 px-4 text-right">Khả dụng</th>
                <th
                  onClick={() => handleSort(ItemSortField.MIN_STOCK_ALERT)}
                  className="py-3 px-4 text-center cursor-pointer hover:bg-slate-100 transition-colors group"
                >
                  Ngưỡng {renderSortIcon(ItemSortField.MIN_STOCK_ALERT)}
                </th>
                <th className="py-3 px-4 text-center">Tồn kho</th>
                <th className="py-3 px-4 text-center">Trạng thái</th>
                <th className="py-3 px-4 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                      <span>Đang tải danh sách linh kiện...</span>
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-rose-500">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <AlertTriangle className="h-6 w-6" />
                      <span>{error}</span>
                      <button
                        onClick={() => fetchItems()}
                        className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-200"
                      >
                        Thử lại
                      </button>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <Layers className="h-8 w-8 text-slate-300" />
                      <span className="font-medium text-slate-600">Không tìm thấy linh kiện nào</span>
                      <span className="text-slate-400 text-[11px]">
                        Thử thay đổi từ khóa tìm kiếm hoặc xóa các điều kiện lọc.
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr
                    key={item.id}
                    className={`hover:bg-slate-50/70 transition-colors ${
                      item.isLowStock ? 'bg-amber-50/20' : ''
                    } ${!item.isActive ? 'opacity-70 bg-slate-50/50' : ''}`}
                  >
                    {/* SKU Code */}
                    <td className="py-3 px-4 font-mono font-semibold text-blue-600">
                      <div className="flex items-center space-x-1.5">
                        <Barcode className="h-3.5 w-3.5 text-slate-400" />
                        <span>{item.code}</span>
                      </div>
                    </td>

                    {/* Name */}
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{item.name}</div>
                      {item.description && (
                        <div className="text-[11px] text-slate-400 truncate max-w-xs">
                          {item.description}
                        </div>
                      )}
                    </td>

                    {/* Category */}
                    <td className="py-3 px-4 text-slate-600">
                      {item.category?.name || item.categoryName || 'Chưa phân loại'}
                    </td>

                    {/* Item Type */}
                    <td className="py-3 px-4">
                      <StatusBadge status={item.type} variant="itemType" />
                    </td>

                    {/* Unit */}
                    <td className="py-3 px-4 text-center text-slate-500">{item.unit}</td>

                    {/* Total On-hand */}
                    <td className="py-3 px-4 text-right font-semibold text-slate-800">
                      {item.totalOnHand}
                    </td>

                    {/* Available Stock */}
                    <td className="py-3 px-4 text-right">
                      {item.isLowStock ? (
                        <span
                          title={`Khả dụng (${item.available}) < Ngưỡng an toàn (${item.minStockAlert})`}
                          className="inline-flex items-center space-x-1 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800"
                        >
                          <AlertTriangle className="h-3 w-3 text-amber-600" />
                          <span>{item.available}</span>
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700">
                          {item.available}
                        </span>
                      )}
                    </td>

                    {/* Min Alert */}
                    <td className="py-3 px-4 text-center text-slate-400 font-mono">
                      &lt; {item.minStockAlert}
                    </td>

                    {/* Stock Status */}
                    <td className="py-3 px-4 text-center">
                      <StatusBadge status={item.stockStatus} variant="stockStatus" />
                    </td>

                    {/* Active Status */}
                    <td className="py-3 px-4 text-center">
                      <StatusBadge
                        status={item.isActive ? 'ACTIVE' : 'INACTIVE'}
                        variant="activeStatus"
                      />
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center space-x-1.5">
                        {/* View Detail */}
                        <button
                          onClick={() => {
                            setSelectedItemIdForDetail(item.id);
                            setDetailModalOpen(true);
                          }}
                          title="Xem chi tiết & tồn kho vị trí"
                          className="rounded-md p-1.5 text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>

                        {/* Edit (Admin/Manager only) */}
                        {canManage && (
                          <button
                            onClick={() => {
                              setSelectedItemForForm(item);
                              setFormModalMode('edit');
                              setFormModalOpen(true);
                            }}
                            title="Chỉnh sửa thông tin"
                            className="rounded-md p-1.5 text-slate-500 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* Toggle Status (Admin/Manager only) */}
                        {canManage && (
                          <button
                            onClick={() => {
                              setSelectedItemForStatus(item);
                              setStatusModalOpen(true);
                            }}
                            title={item.isActive ? 'Vô hiệu hóa linh kiện' : 'Kích hoạt lại linh kiện'}
                            className={`rounded-md p-1.5 transition-colors ${
                              item.isActive
                                ? 'text-slate-400 hover:bg-rose-50 hover:text-rose-600'
                                : 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-600'
                            }`}
                          >
                            <Power className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* Delete (Admin/Manager only) */}
                        {canManage && (
                          <button
                            onClick={() => handleDeleteItem(item)}
                            title="Xóa linh kiện (nếu tồn kho bằng 0 và chưa có giao dịch)"
                            className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 p-4 text-xs">
          <div className="flex items-center space-x-3 text-slate-500">
            <span>Số bản ghi / trang:</span>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-md border border-slate-200 bg-white py-1 px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
            <span>
              Trang <strong className="text-slate-900">{meta.page}</strong> / {meta.totalPages || 1}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!meta.hasPrevPage || loading}
              className="inline-flex items-center space-x-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Trước</span>
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!meta.hasNextPage || loading}
              className="inline-flex items-center space-x-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              <span>Sau</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      <ItemFormModal
        isOpen={formModalOpen}
        mode={formModalMode}
        item={selectedItemForForm}
        categories={categories}
        onClose={() => setFormModalOpen(false)}
        onSuccess={(msg) => {
          addToast('success', 'Thành công', msg);
          fetchItems();
        }}
      />

      <ItemDetailModal
        isOpen={detailModalOpen}
        itemId={selectedItemIdForDetail}
        onClose={() => {
          setDetailModalOpen(false);
          setSelectedItemIdForDetail(null);
        }}
      />

      <ItemStatusModal
        isOpen={statusModalOpen}
        item={selectedItemForStatus}
        onClose={() => {
          setStatusModalOpen(false);
          setSelectedItemForStatus(null);
        }}
        onSuccess={(msg) => {
          addToast('success', 'Cập nhật trạng thái', msg);
          fetchItems();
        }}
      />

      <ConfirmationModal
        isOpen={deleteModalOpen}
        title={`Xác nhận xóa linh kiện ${itemToDelete?.code}`}
        message={
          <div>
            <p>
              Bạn có chắc chắn muốn xóa linh kiện <strong>"{itemToDelete?.name}"</strong> (SKU:{' '}
              <span className="font-mono">{itemToDelete?.code}</span>)?
            </p>
            <p className="mt-2 text-rose-600 font-semibold">
              Lưu ý: Chỉ linh kiện có tồn kho bằng 0 và chưa từng phát sinh giao dịch xuất/nhập/mượn mới có thể xóa hoàn toàn.
            </p>
          </div>
        }
        confirmLabel="Xóa linh kiện"
        variant="danger"
        isLoading={deletingItem}
        onConfirm={confirmDeleteItem}
        onCancel={() => {
          setDeleteModalOpen(false);
          setItemToDelete(null);
        }}
      />
    </div>
  );
};
