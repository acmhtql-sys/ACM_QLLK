import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { apiClient } from '../services/api';
import { ShieldCheck, Cpu, ArrowRight, AlertCircle, Clock, AlertTriangle } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user was redirected due to 401 / session expiration
    const notice = sessionStorage.getItem('acm_session_expired');
    if (notice) {
      setSessionExpiredNotice(notice);
      sessionStorage.removeItem('acm_session_expired');
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSessionExpiredNotice(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Vui lòng nhập email đăng nhập');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError('Định dạng email không hợp lệ (ví dụ: user@domain.com)');
      return;
    }

    if (!password) {
      setError('Vui lòng nhập mật khẩu');
      return;
    }

    setIsLoading(true);

    try {
      const res = await apiClient.post('/auth/login', { email: trimmedEmail, password });
      if (res.data.success && res.data.data?.token) {
        login(res.data.data.token, res.data.data.user);
        navigate('/dashboard');
      } else {
        setError(res.data.message || 'Email hoặc mật khẩu không chính xác');
      }
    } catch (err: any) {
      if (err.response) {
        setError(err.response.data?.message || 'Email hoặc mật khẩu không chính xác');
      } else {
        setError('Không thể kết nối đến máy chủ backend (Network Error). Vui lòng kiểm tra lại dịch vụ API.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const fillCredentials = (userEmail: string) => {
    setEmail(userEmail);
    setPassword('ACM@dev2026!');
    setError(null);
    setSessionExpiredNotice(null);
  };

  return (
    <div className="flex min-h-screen bg-slate-900">
      {/* Left decorative brand panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 bg-gradient-to-br from-blue-900 via-slate-900 to-slate-950 border-r border-slate-800 text-white">
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 font-extrabold text-white shadow-xl shadow-blue-500/30">
            ACM
          </div>
          <div>
            <div className="text-base font-bold tracking-tight">ACM SYSTEM</div>
            <div className="text-xs text-blue-200">Components & Equipment Management</div>
          </div>
        </div>

        <div className="max-w-md space-y-4">
          <div className="inline-flex items-center space-x-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-300 backdrop-blur-sm">
            <Cpu className="h-3.5 w-3.5" />
            <span>Phòng Lab & Trung tâm AI Robotic</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Quản lý linh kiện & thiết bị thông minh, chính xác và minh bạch.
          </h1>
          <p className="text-sm text-slate-300">
            Giải pháp toàn diện kiểm soát tồn kho khả dụng thời gian thực, quản lý vòng đời mượn trả,
            đóng kit thực hành và truy vết kiểm toán tự động.
          </p>
        </div>

        <div className="text-xs text-slate-500">
          © 2026 ACM Engineering Team. Production Readiness Foundation.
        </div>
      </div>

      {/* Right Login Form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-6 sm:p-12 bg-slate-50">
        <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-8 shadow-xl shadow-slate-200/60 border border-slate-100">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Đăng nhập ACM</h2>
            <p className="mt-1 text-xs text-slate-500">
              Nhập tài khoản để truy cập hệ thống quản lý phòng Lab
            </p>
          </div>

          {sessionExpiredNotice && (
            <div className="flex items-start space-x-2 rounded-lg bg-amber-50 p-3.5 text-xs text-amber-800 border border-amber-200">
              <Clock className="h-4 w-4 flex-shrink-0 text-amber-600 mt-0.5" />
              <div>
                <span className="font-semibold">Hết hạn phiên làm việc:</span>
                <p className="mt-0.5 text-amber-700">{sessionExpiredNotice}</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center space-x-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700">Email người dùng</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                placeholder="ten.nguoidung@acm.local"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">Mật khẩu</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                placeholder="••••••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center space-x-2 rounded-lg bg-blue-600 py-2.5 text-xs font-semibold text-white shadow-md shadow-blue-600/20 transition-all hover:bg-blue-700 active:scale-[0.99] disabled:opacity-70"
            >
              {isLoading && (
                <svg className="h-3.5 w-3.5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
              <span>{isLoading ? 'Đang xác thực thông tin...' : 'Đăng nhập vào hệ thống'}</span>
              {!isLoading && <ArrowRight className="h-3.5 w-3.5" />}
            </button>
          </form>

          {/* Never ship demo credentials or shortcuts in built staging/production HTML. */}
          {(import.meta.env.MODE === 'development' || import.meta.env.MODE === 'test') && <div className="pt-4 border-t border-slate-100">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Tài khoản mẫu theo vai trò (Click để chọn nhanh)
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => fillCredentials('admin@acm.local')}
                className="rounded border border-slate-200 bg-slate-50 p-2 text-left hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
              >
                <div className="font-semibold text-slate-800">Quản trị viên (Admin)</div>
                <div className="text-slate-500 font-mono text-[10px]">admin@acm.local</div>
              </button>
              <button
                type="button"
                onClick={() => fillCredentials('manager@acm.local')}
                className="rounded border border-slate-200 bg-slate-50 p-2 text-left hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
              >
                <div className="font-semibold text-slate-800">Quản lý Lab (Manager)</div>
                <div className="text-slate-500 font-mono text-[10px]">manager@acm.local</div>
              </button>
              <button
                type="button"
                onClick={() => fillCredentials('tech@acm.local')}
                className="rounded border border-slate-200 bg-slate-50 p-2 text-left hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
              >
                <div className="font-semibold text-slate-800">Kỹ thuật viên (Tech)</div>
                <div className="text-slate-500 font-mono text-[10px]">tech@acm.local</div>
              </button>
              <button
                type="button"
                onClick={() => fillCredentials('student@acm.local')}
                className="rounded border border-slate-200 bg-slate-50 p-2 text-left hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
              >
                <div className="font-semibold text-slate-800">Sinh viên (Student)</div>
                <div className="text-slate-500 font-mono text-[10px]">student@acm.local</div>
              </button>
            </div>
          </div>}
        </div>
      </div>
    </div>
  );
};
