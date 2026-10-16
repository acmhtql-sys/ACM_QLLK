import React, { useState, useEffect } from 'react';
import {
  Layers,
  Plus,
  Search,
  FolderTree,
  Pencil,
  Trash2,
  RefreshCw,
  X,
  Package,
  Boxes,
  AlertCircle,
} from 'lucide-react';
import { DemoDataNotice } from '../components/DemoDataNotice';
import { LoadingSkeleton, CardSkeleton } from '../components/common/LoadingSkeleton';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorAlert } from '../components/common/ErrorAlert';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { apiClient } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';

interface CategoryItem {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  parent?: { id: string; name: string; code: string } | null;
  _count?: {
    items: number;
    children: number;
  };
}

export const CategoriesPage: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const canManage = user?.role === 'ADMIN' || user?.role === 'LAB_MANAGER';

  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Form Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [selectedCategory, setSelectedCategory] = useState<CategoryItem | null>(null);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    description: '',
    parentId: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Delete Modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<CategoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchCategories = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/categories');
      if (res.data?.success) {
        setCategories(res.data.data);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Không thể tải danh sách danh mục. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const openCreateModal = () => {
    setModalMode('create');
    setSelectedCategory(null);
    setFormData({
      code: '',
      name: '',
      description: '',
      parentId: '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (cat: CategoryItem) => {
    setModalMode('edit');
    setSelectedCategory(cat);
    setFormData({
      code: cat.code,
      name: cat.name,
      description: cat.description || '',
      parentId: cat.parentId || '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (modalMode === 'create' && (!formData.code || formData.code.trim().length < 2)) {
      errors.code = 'Mã danh mục phải có ít nhất 2 ký tự';
    }
    if (!formData.name || formData.name.trim().length < 2) {
      errors.name = 'Tên danh mục phải có ít nhất 2 ký tự';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    try {
      if (modalMode === 'create') {
        const payload = {
          code: formData.code.trim().toUpperCase(),
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          parentId: formData.parentId || null,
        };
        const res = await apiClient.post('/categories', payload);
        if (res.data?.success) {
          toast.success('Tạo danh mục thành công', `Đã thêm danh mục "${formData.name}" vào hệ thống.`);
          setIsModalOpen(false);
          await fetchCategories();
        }
      } else if (selectedCategory) {
        const payload = {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          parentId: formData.parentId || null,
        };
        const res = await apiClient.put(`/categories/${selectedCategory.id}`, payload);
        if (res.data?.success) {
          toast.success('Cập nhật thành công', `Đã cập nhật danh mục "${formData.name}".`);
          setIsModalOpen(false);
          await fetchCategories();
        }
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Có lỗi xảy ra khi lưu danh mục';
      toast.error('Lỗi lưu danh mục', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!categoryToDelete) return;
    setDeleting(true);
    try {
      const res = await apiClient.delete(`/categories/${categoryToDelete.id}`);
      if (res.data?.success) {
        toast.success('Xóa danh mục thành công', `Đã xóa danh mục "${categoryToDelete.name}".`);
        setDeleteModalOpen(false);
        setCategoryToDelete(null);
        await fetchCategories();
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Không thể xóa danh mục';
      toast.error('Lỗi xóa danh mục', msg);
    } finally {
      setDeleting(false);
    }
  };

  const filteredCategories = categories.filter((cat) => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return (
      cat.name.toLowerCase().includes(term) ||
      cat.code.toLowerCase().includes(term) ||
      (cat.description && cat.description.toLowerCase().includes(term))
    );
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between space-y-4 sm:flex-row sm:items-center sm:space-y-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Danh mục Linh kiện & Thiết bị (Categories)
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Cấu trúc phân loại theo nhóm phần cứng, mô-đun và mục đích thực hành phòng Lab
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={fetchCategories}
            disabled={loading}
            className="inline-flex items-center space-x-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
            <span>Làm mới</span>
          </button>
          {canManage && (
            <button
              onClick={openCreateModal}
              className="inline-flex items-center space-x-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-blue-500/20 hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Tạo danh mục mới</span>
            </button>
          )}
        </div>
      </div>

      <DemoDataNotice moduleName="Category Management" />

      {/* Search and Filters */}
      <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm theo mã danh mục, tên nhóm linh kiện..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-200 pl-9 pr-4 py-2 text-xs focus:border-blue-500 focus:outline-none"
          />
        </div>
        <span className="text-xs text-slate-500">
          Tổng cộng: <strong className="text-slate-800">{filteredCategories.length}</strong> danh mục
        </span>
      </div>

      {error && <ErrorAlert message={error} onRetry={fetchCategories} />}

      {/* Content Rendering */}
      {loading ? (
        <CardSkeleton count={4} />
      ) : filteredCategories.length === 0 ? (
        <EmptyState
          title="Không tìm thấy danh mục nào"
          description={
            searchTerm
              ? `Không có danh mục nào khớp với từ khóa "${searchTerm}".`
              : 'Chưa có danh mục nào được khởi tạo trong hệ thống.'
          }
          icon={FolderTree}
          actionLabel={canManage ? 'Tạo danh mục đầu tiên' : undefined}
          onAction={canManage ? openCreateModal : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredCategories.map((cat) => (
            <div
              key={cat.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm hover:border-blue-300 hover:shadow-md transition-all"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200/80 px-2.5 py-0.5 rounded-md">
                    {cat.code}
                  </span>
                  <div className="flex items-center space-x-1.5">
                    {cat.parent && (
                      <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                        Thuộc: {cat.parent.code}
                      </span>
                    )}
                    <FolderTree className="h-4 w-4 text-slate-400" />
                  </div>
                </div>

                <h3 className="mt-3 text-sm font-bold text-slate-900 leading-snug">{cat.name}</h3>
                <p className="mt-1 text-xs text-slate-500 line-clamp-2">
                  {cat.description || 'Chưa có thông tin mô tả chi tiết cho danh mục này.'}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs">
                  <span className="inline-flex items-center space-x-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    <Package className="h-3 w-3 text-slate-500 mr-1" />
                    <strong>{cat._count?.items ?? 0}</strong> linh kiện
                  </span>
                  {Boolean(cat._count?.children) && (
                    <span className="inline-flex items-center rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                      +{cat._count?.children} con
                    </span>
                  )}
                </div>

                {canManage && (
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => openEditModal(cat)}
                      title="Chỉnh sửa danh mục"
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setCategoryToDelete(cat);
                        setDeleteModalOpen(true);
                      }}
                      title="Xóa danh mục"
                      className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Category Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                {modalMode === 'create' ? 'Tạo danh mục mới' : `Chỉnh sửa: ${selectedCategory?.name}`}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700">Mã danh mục (Code)</label>
                <input
                  type="text"
                  disabled={modalMode === 'edit'}
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="VD: SENSOR, MCU, POWER..."
                  className={`mt-1 w-full rounded-lg border px-3 py-2 uppercase font-mono text-xs focus:outline-none ${
                    modalMode === 'edit'
                      ? 'bg-slate-100 text-slate-500 cursor-not-allowed border-slate-200'
                      : 'border-slate-300 focus:border-blue-600'
                  } ${formErrors.code ? 'border-rose-500' : ''}`}
                />
                {formErrors.code && <p className="mt-1 text-[11px] text-rose-600">{formErrors.code}</p>}
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Tên danh mục</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="VD: Cảm biến & Đo lường, Vi điều khiển..."
                  className={`mt-1 w-full rounded-lg border px-3 py-2 text-xs focus:outline-none ${
                    formErrors.name ? 'border-rose-500' : 'border-slate-300 focus:border-blue-600'
                  }`}
                />
                {formErrors.name && <p className="mt-1 text-[11px] text-rose-600">{formErrors.name}</p>}
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Danh mục cha (Tùy chọn)</label>
                <select
                  value={formData.parentId}
                  onChange={(e) => setFormData({ ...formData, parentId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
                >
                  <option value="">-- Danh mục gốc (Không có cha) --</option>
                  {categories
                    .filter((c) => (selectedCategory ? c.id !== selectedCategory.id : true))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} - {c.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Mô tả chi tiết</label>
                <textarea
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Nhập thông tin giới thiệu, phạm vi áp dụng của danh mục..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={submitting}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center space-x-1.5 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting && (
                    <svg className="h-3.5 w-3.5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                  <span>{submitting ? 'Đang lưu...' : modalMode === 'create' ? 'Tạo danh mục' : 'Lưu thay đổi'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Delete Category */}
      <ConfirmationModal
        isOpen={deleteModalOpen}
        title={`Xác nhận xóa danh mục ${categoryToDelete?.code}`}
        message={
          <div>
            <p>
              Bạn có chắc chắn muốn xóa danh mục <strong>"{categoryToDelete?.name}"</strong> khỏi hệ thống?
            </p>
            {Boolean(categoryToDelete?._count?.items) && (
              <p className="mt-2 text-rose-600 font-semibold">
                Cảnh báo: Danh mục này đang chứa {categoryToDelete?._count?.items} linh kiện. Hệ thống sẽ từ chối xóa nếu chưa chuyển hết linh kiện sang danh mục khác.
              </p>
            )}
          </div>
        }
        confirmLabel="Xóa danh mục"
        variant="danger"
        isLoading={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteModalOpen(false);
          setCategoryToDelete(null);
        }}
      />
    </div>
  );
};
