import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Search,
  Filter,
  RefreshCw,
  Eye,
  ChevronLeft,
  ChevronRight,
  FileJson,
  User,
  Clock,
  Globe,
  Lock,
  AlertCircle,
  X,
  CheckCircle,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { apiClient } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { AuditLogResponse } from '@acm/shared';

export const AuditLogsPage: React.FC = () => {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLogResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 15,
    totalPages: 1,
  });

  // Modal inspection
  const [selectedLog, setSelectedLog] = useState<AuditLogResponse | null>(null);

  const isAuthorized = user?.role === 'ADMIN';

  useEffect(() => {
    if (isAuthorized) {
      fetchAuditLogs();
    }
  }, [page, actionFilter, entityFilter, isAuthorized]);

  async function fetchAuditLogs() {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, any> = {
        page,
        limit,
      };
      if (search.trim()) params.search = search.trim();
      if (actionFilter) params.action = actionFilter;
      if (entityFilter) params.entity = entityFilter;

      const res = await apiClient.get('/audit-logs', { params });
      if (res.data?.success && res.data.data) {
        setLogs(res.data.data);
        if (res.data.pagination) {
          setPagination(res.data.pagination);
        }
      }
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
          'Không thể tải dữ liệu nhật ký kiểm toán. Vui lòng kiểm tra quyền truy cập.'
      );
    } finally {
      setLoading(false);
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    fetchAuditLogs();
  }

  function handleResetFilters() {
    setSearch('');
    setActionFilter('');
    setEntityFilter('');
    setPage(1);
  }

  function getActionBadgeStyle(action: string) {
    if (action.includes('CREATE') || action.includes('IMPORT')) {
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    }
    if (action.includes('UPDATE') || action.includes('EDIT')) {
      return 'bg-blue-50 text-blue-700 border-blue-200';
    }
    if (action.includes('DELETE') || action.includes('REJECT') || action.includes('CANCEL')) {
      return 'bg-rose-50 text-rose-700 border-rose-200';
    }
    if (action.includes('BORROW') || action.includes('RETURN') || action.includes('HANDOVER')) {
      return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    }
    if (action.includes('KIT')) {
      return 'bg-teal-50 text-teal-700 border-teal-200';
    }
    return 'bg-slate-100 text-slate-700 border-slate-200';
  }

  if (!isAuthorized) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Nhật ký Hoạt động & Kiểm toán (Audit Logs)
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Hệ thống ghi nhận và kiểm toán mọi thao tác thay đổi dữ liệu
          </p>
        </div>

        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
          <Lock className="mx-auto h-12 w-12 text-rose-500 mb-3" />
          <h3 className="text-sm font-bold text-rose-900">Giới hạn Quyền Truy Cập (Access Denied)</h3>
          <p className="mt-1 text-xs text-rose-700 max-w-md mx-auto">
            Chức năng Nhật ký Hoạt động và Kiểm toán chỉ dành cho Quản trị viên (ADMIN) theo chính sách hiện hành.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between space-y-4 sm:flex-row sm:items-center sm:space-y-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Nhật ký Hoạt động & Kiểm toán (Audit Logs)
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Giám sát thao tác người dùng, truy vết biến động dữ liệu và đảm bảo tính bất biến của hệ thống
          </p>
        </div>
        <button
          onClick={() => fetchAuditLogs()}
          className="inline-flex items-center space-x-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
          <span>Làm mới nhật ký</span>
        </button>
      </div>

      {/* Security Compliance Banner */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-900 flex items-start space-x-3">
        <ShieldCheck className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-emerald-950">Chính sách Bảo mật & Chuẩn hóa Dữ liệu Kiểm toán:</span>
          <p className="mt-0.5 text-emerald-800 leading-relaxed">
            Hệ thống tự động thực hiện thanh lọc đệ quy (Recursive Deep Sanitization) đối với tất cả mật khẩu, passwordHash, JWT token và khóa bí mật trước khi lưu trữ hoặc phản hồi qua API, đảm bảo an toàn tuyệt đối theo tiêu chuẩn an ninh thông tin.
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm space-y-3">
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2 relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm kiếm theo hành động, mã đối tượng, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 pl-9 pr-4 py-2 text-xs focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none text-slate-700"
            >
              <option value="">-- Tất cả Hành động --</option>
              <option value="USER_LOGIN">Đăng nhập (USER_LOGIN)</option>
              <option value="ITEM_CREATE">Tạo linh kiện (ITEM_CREATE)</option>
              <option value="ITEM_UPDATE">Cập nhật linh kiện (ITEM_UPDATE)</option>
              <option value="ITEM_DELETE">Xóa linh kiện (ITEM_DELETE)</option>
              <option value="BORROW_REQUEST_CREATE">Tạo phiếu mượn (BORROW_CREATE)</option>
              <option value="BORROW_APPROVE">Phê duyệt mượn (BORROW_APPROVE)</option>
              <option value="BORROW_HANDOVER">Bàn giao mượn (BORROW_HANDOVER)</option>
              <option value="BORROW_RETURN">Nhận trả mượn (BORROW_RETURN)</option>
              <option value="STOCK_ADJUSTMENT">Điều chỉnh kho (STOCK_ADJUSTMENT)</option>
              <option value="STOCK_IMPORT">Nhập kho (STOCK_IMPORT)</option>
              <option value="KIT_CREATE">Tạo Kit (KIT_CREATE)</option>
              <option value="KIT_ALLOCATE">Phân bổ Kit (KIT_ALLOCATE)</option>
            </select>
          </div>

          <div>
            <select
              value={entityFilter}
              onChange={(e) => {
                setEntityFilter(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none text-slate-700"
            >
              <option value="">-- Tất cả Đối tượng --</option>
              <option value="ITEM">Linh kiện (ITEM)</option>
              <option value="BORROW_REQUEST">Phiếu mượn (BORROW_REQUEST)</option>
              <option value="USER">Người dùng (USER)</option>
              <option value="KIT">Hộp Kit (KIT)</option>
              <option value="STOCK_TRANSACTION">Giao dịch kho (STOCK_TRANSACTION)</option>
              <option value="CATEGORY">Danh mục (CATEGORY)</option>
            </select>
          </div>
        </form>

        {(search || actionFilter || entityFilter) && (
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
            <span className="text-slate-500">
              Đang áp dụng bộ lọc tùy chỉnh
            </span>
            <button
              onClick={handleResetFilters}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              Đặt lại bộ lọc
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
          {error}
        </div>
      )}

      {/* Audit Logs Table */}
      <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50/70 font-semibold text-slate-600">
              <tr>
                <th className="py-3 px-4">Thời gian</th>
                <th className="py-3 px-4">Người thực hiện</th>
                <th className="py-3 px-4">Hành động</th>
                <th className="py-3 px-4">Đối tượng</th>
                <th className="py-3 px-4">IP & Thiết bị</th>
                <th className="py-3 px-4 text-center">Chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {logs.length > 0 ? (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 whitespace-nowrap text-slate-500">
                      {new Date(log.createdAt).toLocaleString('vi-VN')}
                    </td>
                    <td className="py-3 px-4">
                      {log.user ? (
                        <div>
                          <div className="font-semibold text-slate-900">{log.user.fullName}</div>
                          <div className="text-[11px] text-slate-500 flex items-center space-x-1.5 mt-0.5">
                            <span>{log.user.email}</span>
                            <StatusBadge status={log.user.role || 'STUDENT'} variant="role" />
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Hệ thống tự động</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium border ${getActionBadgeStyle(
                          log.action
                        )}`}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600">
                      <div>
                        <span className="font-semibold text-slate-800">{log.entity}</span>
                        {log.entityId && (
                          <div className="text-slate-400 text-[10px] truncate max-w-[140px]" title={log.entityId}>
                            #{log.entityId}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-500 text-[11px]">
                      <div>{log.ipAddress || '127.0.0.1'}</div>
                      <div className="text-[10px] text-slate-400 truncate max-w-[160px]" title={log.userAgent || ''}>
                        {log.userAgent || 'Web Client'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="inline-flex items-center space-x-1 rounded bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
                      >
                        <Eye className="h-3 w-3" />
                        <span>Xem</span>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-slate-400">
                    {loading ? 'Đang tải dữ liệu kiểm toán...' : 'Không có bản ghi nhật ký nào phù hợp.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 bg-white">
          <div className="text-xs text-slate-500">
            Hiển thị trang <strong className="text-slate-800">{pagination.page}</strong> /{' '}
            <strong className="text-slate-800">{pagination.totalPages}</strong> (Tổng cộng{' '}
            <strong className="text-slate-800">{pagination.total}</strong> bản ghi)
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pagination.page <= 1 || loading}
              className="inline-flex items-center space-x-1 rounded border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Trang trước</span>
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={pagination.page >= pagination.totalPages || loading}
              className="inline-flex items-center space-x-1 rounded border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <span>Trang sau</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Details Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl overflow-hidden border border-slate-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 bg-slate-50">
              <div className="flex items-center space-x-2">
                <FileJson className="h-5 w-5 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Chi tiết Bản ghi Kiểm toán (#{selectedLog.id.slice(0, 8)})
                </h3>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {/* Metadata Grid */}
              <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3.5 border border-slate-100">
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Người thực hiện:
                  </span>
                  <div className="mt-0.5 font-medium text-slate-800">
                    {selectedLog.user ? `${selectedLog.user.fullName} (${selectedLog.user.email})` : 'Hệ thống'}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Thời điểm:
                  </span>
                  <div className="mt-0.5 text-slate-700">
                    {new Date(selectedLog.createdAt).toLocaleString('vi-VN')}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Hành động:
                  </span>
                  <div className="mt-0.5">
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium border ${getActionBadgeStyle(
                        selectedLog.action
                      )}`}
                    >
                      {selectedLog.action}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Đối tượng:
                  </span>
                  <div className="mt-0.5 font-mono text-slate-700">
                    {selectedLog.entity} {selectedLog.entityId ? `(#${selectedLog.entityId})` : ''}
                  </div>
                </div>
              </div>

              {/* Data Diff: Old Value vs New Value */}
              <div className="space-y-3">
                {selectedLog.oldValue && (
                  <div>
                    <span className="text-xs font-semibold text-slate-700 flex items-center space-x-1">
                      <span>Dữ liệu Trước thay đổi (Old Value):</span>
                    </span>
                    <pre className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-emerald-400">
                      {JSON.stringify(selectedLog.oldValue, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedLog.newValue && (
                  <div>
                    <span className="text-xs font-semibold text-slate-700 flex items-center space-x-1">
                      <span>Dữ liệu Sau thay đổi (New Value):</span>
                    </span>
                    <pre className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-blue-300">
                      {JSON.stringify(selectedLog.newValue, null, 2)}
                    </pre>
                  </div>
                )}

                {!selectedLog.oldValue && !selectedLog.newValue && (
                  <div className="rounded-lg bg-slate-50 p-4 text-center text-slate-400 italic">
                    Không có bản lưu payload chi tiết cho hành động này.
                  </div>
                )}
              </div>

              {/* Security info note */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-[11px] text-slate-600 flex items-center space-x-2">
                <CheckCircle className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                <span>
                  Các trường nhạy cảm (mật khẩu, jwt token, private keys) đã được tự động loại bỏ và mã hóa trước khi xuất hiện trên giao diện.
                </span>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-slate-200 px-5 py-3 bg-slate-50 flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
