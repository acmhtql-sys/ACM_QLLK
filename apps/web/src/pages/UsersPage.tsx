import React, { useState, useEffect } from 'react';
import {
  Users as UsersIcon,
  Plus,
  UserCheck,
  UserX,
  Lock,
  Unlock,
  KeyRound,
  Search,
  RefreshCw,
  X,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { DemoDataNotice } from '../components/DemoDataNotice';
import { StatusBadge } from '../components/StatusBadge';
import { apiClient } from '../services/api';
import { UserRole } from '@acm/shared';

interface UserItem {
  id: string;
  email: string;
  fullName: string;
  role: string;
  studentOrStaffId?: string | null;
  department?: string | null;
  phoneNumber?: string | null;
  isActive: boolean;
  isLocked: boolean;
  failedLoginAttempts: number;
  createdAt: string;
}

export const UsersPage: React.FC = () => {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isResetPasswordModalOpen, setIsResetPasswordModalOpen] = useState<boolean>(false);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);

  // Create user form state
  const [createFormData, setCreateFormData] = useState({
    email: '',
    password: '',
    fullName: '',
    role: UserRole.STUDENT,
    studentOrStaffId: '',
    department: '',
    phoneNumber: '',
  });

  // Reset password form state
  const [newPassword, setNewPassword] = useState<string>('');

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (searchTerm.trim()) params.search = searchTerm.trim();
      if (roleFilter !== 'ALL') params.role = roleFilter;

      const res = await apiClient.get('/users', { params });
      if (res.data?.success) {
        const rawData = res.data.data;
        const list = Array.isArray(rawData) ? rawData : rawData?.items || [];
        setUsers(list);
      }
    } catch (err: any) {
      console.error('Lỗi khi tải danh sách người dùng:', err);
      setStatusMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Không thể tải danh sách người dùng',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [roleFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchUsers();
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading('create');
    setStatusMessage(null);
    try {
      const res = await apiClient.post('/users', createFormData);
      if (res.data?.success) {
        setStatusMessage({ type: 'success', text: 'Tạo tài khoản người dùng thành công!' });
        setIsCreateModalOpen(false);
        setCreateFormData({
          email: '',
          password: '',
          fullName: '',
          role: UserRole.STUDENT,
          studentOrStaffId: '',
          department: '',
          phoneNumber: '',
        });
        await fetchUsers();
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Lỗi khi tạo người dùng',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleStatus = async (user: UserItem, field: 'isActive' | 'isLocked') => {
    const actionName = field === 'isActive'
      ? (user.isActive ? 'vô hiệu hóa' : 'kích hoạt')
      : (user.isLocked ? 'mở khóa' : 'khóa');

    if (!window.confirm(`Bạn có chắc chắn muốn ${actionName} tài khoản ${user.email}?`)) {
      return;
    }

    setActionLoading(`${field}-${user.id}`);
    setStatusMessage(null);
    try {
      const payload = field === 'isActive'
        ? { isActive: !user.isActive }
        : { isLocked: !user.isLocked };

      const res = await apiClient.patch(`/users/${user.id}/status`, payload);
      if (res.data?.success) {
        setStatusMessage({ type: 'success', text: `Đã ${actionName} tài khoản thành công!` });
        await fetchUsers();
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.response?.data?.message || `Không thể ${actionName} tài khoản`,
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    setActionLoading(`reset-${selectedUser.id}`);
    setStatusMessage(null);
    try {
      const res = await apiClient.post(`/users/${selectedUser.id}/reset-password`, {
        newPassword,
      });
      if (res.data?.success) {
        setStatusMessage({
          type: 'success',
          text: `Đã đặt lại mật khẩu cho tài khoản ${selectedUser.email} thành công!`,
        });
        setIsResetPasswordModalOpen(false);
        setNewPassword('');
        setSelectedUser(null);
        await fetchUsers();
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Không thể đặt lại mật khẩu',
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
            Quản trị Người dùng (Users & RBAC)
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Quản lý tài khoản, trạng thái hoạt động, khóa bảo vệ và phân quyền 4 vai trò hệ thống
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center space-x-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-blue-500/20 hover:bg-blue-700 transition"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Thêm người dùng mới</span>
        </button>
      </div>

      <DemoDataNotice moduleName="User & RBAC Management" />

      {/* Status Alert Banner */}
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

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm">
        <form onSubmit={handleSearchSubmit} className="flex flex-1 items-center space-x-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm theo tên, email, MSSV/mã cán bộ, đơn vị..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-300 py-1.5 pl-9 pr-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition"
          >
            Tìm kiếm
          </button>
        </form>

        <div className="flex items-center space-x-2">
          <label className="text-xs text-slate-500 whitespace-nowrap">Vai trò:</label>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-lg border border-slate-300 py-1.5 px-2.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="ALL">Tất cả vai trò</option>
            <option value={UserRole.ADMIN}>Quản trị viên (ADMIN)</option>
            <option value={UserRole.LAB_MANAGER}>Quản lý Lab (LAB_MANAGER)</option>
            <option value={UserRole.TECHNICIAN}>Kỹ thuật viên (TECHNICIAN)</option>
            <option value={UserRole.STUDENT}>Sinh viên (STUDENT)</option>
          </select>

          <button
            onClick={fetchUsers}
            disabled={loading}
            className="inline-flex items-center space-x-1 rounded-lg border border-slate-200 p-1.5 text-xs text-slate-600 hover:bg-slate-50 transition"
            title="Làm mới danh sách"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200/80 bg-slate-50 font-semibold text-slate-600">
              <tr>
                <th className="py-3 px-4">Họ và tên</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Mã định danh (MSSV/CB)</th>
                <th className="py-3 px-4">Vai trò</th>
                <th className="py-3 px-4">Đơn vị / Khoa</th>
                <th className="py-3 px-4 text-center">Trạng thái</th>
                <th className="py-3 px-4 text-center">Bảo mật</th>
                <th className="py-3 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading && users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-blue-500" />
                    Đang tải danh sách người dùng...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    Không tìm thấy người dùng phù hợp.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-4 font-semibold text-slate-900">{u.fullName}</td>
                    <td className="py-3 px-4 font-mono text-slate-600">{u.email}</td>
                    <td className="py-3 px-4 font-mono text-slate-500">{u.studentOrStaffId || '-'}</td>
                    <td className="py-3 px-4">
                      <StatusBadge status={u.role} variant="role" />
                    </td>
                    <td className="py-3 px-4 text-slate-600">{u.department || '-'}</td>
                    <td className="py-3 px-4 text-center">
                      {u.isActive ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          <UserCheck className="h-3 w-3 mr-1" /> Hoạt động
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          <UserX className="h-3 w-3 mr-1" /> Vô hiệu hóa
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {u.isLocked ? (
                        <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                          <Lock className="h-3 w-3 mr-1" /> Tạm khóa
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-slate-400 text-[11px]">
                          <Unlock className="h-3 w-3 mr-1" /> Bình thường
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                      {/* Toggle Lock */}
                      <button
                        onClick={() => handleToggleStatus(u, 'isLocked')}
                        disabled={actionLoading !== null}
                        className={`inline-flex items-center rounded p-1 text-xs font-semibold ${
                          u.isLocked
                            ? 'text-emerald-600 hover:bg-emerald-50'
                            : 'text-amber-600 hover:bg-amber-50'
                        }`}
                        title={u.isLocked ? 'Mở khóa tài khoản' : 'Tạm khóa tài khoản'}
                      >
                        {u.isLocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                      </button>

                      {/* Toggle Active */}
                      <button
                        onClick={() => handleToggleStatus(u, 'isActive')}
                        disabled={actionLoading !== null}
                        className={`inline-flex items-center rounded p-1 text-xs font-semibold ${
                          u.isActive
                            ? 'text-rose-600 hover:bg-rose-50'
                            : 'text-emerald-600 hover:bg-emerald-50'
                        }`}
                        title={u.isActive ? 'Vô hiệu hóa tài khoản' : 'Kích hoạt lại tài khoản'}
                      >
                        {u.isActive ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                      </button>

                      {/* Reset Password */}
                      <button
                        onClick={() => {
                          setSelectedUser(u);
                          setNewPassword('');
                          setIsResetPasswordModalOpen(true);
                        }}
                        disabled={actionLoading !== null}
                        className="inline-flex items-center rounded p-1 text-xs text-blue-600 hover:bg-blue-50"
                        title="Đặt lại mật khẩu"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Thêm người dùng mới */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">Thêm người dùng mới</h2>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700">Họ và tên *</label>
                <input
                  type="text"
                  required
                  placeholder="Nguyễn Văn A"
                  value={createFormData.fullName}
                  onChange={(e) => setCreateFormData({ ...createFormData, fullName: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Email đăng nhập *</label>
                <input
                  type="email"
                  required
                  placeholder="user@acm.edu.vn"
                  value={createFormData.email}
                  onChange={(e) => setCreateFormData({ ...createFormData, email: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Mật khẩu khởi tạo *</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="Tối thiểu 6 ký tự"
                  value={createFormData.password}
                  onChange={(e) => setCreateFormData({ ...createFormData, password: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Vai trò hệ thống *</label>
                <select
                  value={createFormData.role}
                  onChange={(e) => setCreateFormData({ ...createFormData, role: e.target.value as UserRole })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value={UserRole.STUDENT}>Sinh viên (STUDENT)</option>
                  <option value={UserRole.TECHNICIAN}>Kỹ thuật viên (TECHNICIAN)</option>
                  <option value={UserRole.LAB_MANAGER}>Quản lý Lab (LAB_MANAGER)</option>
                  <option value={UserRole.ADMIN}>Quản trị viên (ADMIN)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700">Mã định danh (MSSV/CB)</label>
                  <input
                    type="text"
                    placeholder="SV-2026-001"
                    value={createFormData.studentOrStaffId}
                    onChange={(e) =>
                      setCreateFormData({ ...createFormData, studentOrStaffId: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700">Số điện thoại</label>
                  <input
                    type="text"
                    placeholder="0901234567"
                    value={createFormData.phoneNumber}
                    onChange={(e) =>
                      setCreateFormData({ ...createFormData, phoneNumber: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Đơn vị / Khoa</label>
                <input
                  type="text"
                  placeholder="Khoa Điện tử - Viễn thông"
                  value={createFormData.department}
                  onChange={(e) => setCreateFormData({ ...createFormData, department: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
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
                  {actionLoading === 'create' ? 'Đang tạo...' : 'Tạo tài khoản'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Đặt lại mật khẩu */}
      {isResetPasswordModalOpen && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">Đặt lại mật khẩu</h2>
              <button
                onClick={() => setIsResetPasswordModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="mt-4 space-y-3.5 text-xs">
              <p className="text-slate-600">
                Đặt lại mật khẩu mới cho tài khoản: <strong className="text-slate-900">{selectedUser.email}</strong>
              </p>

              <div>
                <label className="block font-semibold text-slate-700">Mật khẩu mới *</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="Tối thiểu 6 ký tự"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsResetPasswordModalOpen(false)}
                  className="rounded-lg px-4 py-2 font-medium text-slate-600 hover:bg-slate-100"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={actionLoading !== null}
                  className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Xác nhận đặt lại
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
