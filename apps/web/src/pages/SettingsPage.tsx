import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Server,
  Shield,
  Database,
  Save,
  CheckCircle2,
  Lock,
  User,
  KeyRound,
  RefreshCw,
  Mail,
  Building,
} from 'lucide-react';
import { DemoDataNotice } from '../components/DemoDataNotice';
import { StatusBadge } from '../components/StatusBadge';
import { apiClient } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();

  const [apiHealth, setApiHealth] = useState<any>(null);
  const [checking, setChecking] = useState(true);

  // Change Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await apiClient.get('/health');
        setApiHealth(res.data);
      } catch (err: any) {
        setApiHealth({ status: 'offline', error: err.message });
      } finally {
        setChecking(false);
      }
    }
    checkHealth();
  }, []);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    if (!currentPassword) {
      setPasswordError('Vui lòng nhập mật khẩu hiện tại');
      return;
    }

    if (!newPassword || newPassword.length < 8) {
      setPasswordError('Mật khẩu mới phải có tối thiểu 8 ký tự');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Mật khẩu mới và mật khẩu xác nhận không khớp');
      return;
    }

    setIsChangingPassword(true);
    try {
      const res = await apiClient.post('/auth/change-password', {
        currentPassword,
        newPassword,
      });

      if (res.data?.success) {
        toast.success('Đổi mật khẩu thành công', 'Mật khẩu đăng nhập của bạn đã được cập nhật.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Không thể đổi mật khẩu. Vui lòng kiểm tra lại.';
      setPasswordError(msg);
      toast.error('Lỗi đổi mật khẩu', msg);
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between space-y-4 sm:flex-row sm:items-center sm:space-y-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Cài đặt Hệ thống & Bảo mật (Settings)
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Quản lý tài khoản cá nhân, đổi mật khẩu và giám sát kết nối cơ sở dữ liệu phòng Lab
          </p>
        </div>
      </div>

      <DemoDataNotice moduleName="System & Security Settings" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* User Profile Card */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-100 pb-3">
            <User className="h-4 w-4 text-blue-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Thông tin Tài khoản Hiện tại
            </h3>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center space-x-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-700 font-extrabold text-base">
                {user?.fullName ? user.fullName[0] : 'U'}
              </div>
              <div>
                <div className="font-bold text-slate-900">{user?.fullName || 'Người dùng'}</div>
                <div className="text-slate-500 text-[11px]">{user?.email}</div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Vai trò (Role):</span>
                <StatusBadge status={user?.role || 'STUDENT'} variant="role" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Mã định danh (ID):</span>
                <span className="font-mono text-[11px] text-slate-700 truncate max-w-[150px]" title={user?.id}>
                  #{user?.id ? user.id.slice(0, 8) : 'unknown'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Môi trường:</span>
                <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                  Phiên làm việc bảo mật
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Change Password Card */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-2 space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-100 pb-3">
            <KeyRound className="h-4 w-4 text-blue-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Đổi Mật khẩu Cá nhân (Security Settings)
            </h3>
          </div>

          {passwordError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              {passwordError}
            </div>
          )}

          <form onSubmit={handleChangePassword} className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700">Mật khẩu hiện tại *</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Nhập mật khẩu bạn đang sử dụng..."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block font-semibold text-slate-700">Mật khẩu mới *</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Tối thiểu 8 ký tự..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700">Xác nhận mật khẩu mới *</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu mới..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end border-t border-slate-100 pt-3">
              <button
                type="submit"
                disabled={isChangingPassword}
                className="inline-flex items-center space-x-1.5 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {isChangingPassword && (
                  <svg className="h-3.5 w-3.5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                <span>{isChangingPassword ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* API & Backend Status Card */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center space-x-2 border-b border-slate-100 pb-3">
            <Server className="h-4 w-4 text-blue-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Trạng thái API Backend
            </h3>
          </div>
          <div className="mt-4 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Service:</span>
              <span className="font-semibold text-slate-800">
                {apiHealth?.service || 'ACM API Engine'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Trạng thái:</span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 font-bold text-[10px] ${
                  apiHealth?.status === 'ok'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}
              >
                {apiHealth?.status === 'ok' ? 'HEALTHY (OK)' : 'STANDALONE / LOCAL'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Cơ sở dữ liệu:</span>
              <span className="font-mono text-[11px] text-slate-700">
                {apiHealth?.database || 'PostgreSQL (Connected)'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Endpoint Prefix:</span>
              <span className="font-mono text-[11px] text-blue-600">/api/v1</span>
            </div>
          </div>
        </div>

        {/* General Lab Settings */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center space-x-2 border-b border-slate-100 pb-3">
            <Database className="h-4 w-4 text-blue-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Thông tin Cơ sở & Phòng Lab Quản lý
            </h3>
          </div>
          <div className="mt-4 space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700">Tên cơ sở / Trung tâm đào tạo</label>
              <input
                type="text"
                readOnly
                defaultValue="Trung tâm AI & Robotics Lab - Đại học Công nghệ"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700">Mã kho mặc định</label>
                <input
                  type="text"
                  readOnly
                  defaultValue="WH-MAIN-LAB"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-medium text-slate-900"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700">Múi giờ hệ thống</label>
                <input
                  type="text"
                  readOnly
                  defaultValue="Asia/Ho_Chi_Minh (UTC+7)"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
