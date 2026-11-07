import React from 'react';
import { Menu, Bell, Search, LogOut, User as UserIcon } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { StatusBadge } from '../components/StatusBadge';

interface HeaderProps {
  onOpenSidebar: () => void;
  isSidebarOpen: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSidebar, isSidebarOpen }) => {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur-md sm:px-6">
      {/* Left: Mobile hamburger & search */}
      <div className="flex items-center space-x-3">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Mở menu điều hướng"
          aria-controls="acm-mobile-sidebar"
          aria-expanded={isSidebarOpen}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="relative hidden w-72 sm:block md:w-96">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm kiếm linh kiện, mã SKU, vị trí, phiếu mượn..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50/80 py-1.5 pl-9 pr-3 text-xs text-slate-800 placeholder-slate-400 transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Right: Notifications & User profile */}
      <div className="flex items-center space-x-3">
        <button className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-blue-600" />
        </button>

        <div className="h-5 w-[1px] bg-slate-200" />

        {/* User Pill */}
        <div className="flex items-center space-x-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-xs">
            {user?.fullName ? user.fullName[0] : <UserIcon className="h-4 w-4" />}
          </div>
          <div className="hidden text-left sm:block">
            <div className="text-xs font-semibold text-slate-800">{user?.fullName || 'Demo User'}</div>
            <div className="flex items-center space-x-1.5">
              <StatusBadge status={user?.role || 'ADMIN'} variant="role" />
            </div>
          </div>

          <button
            onClick={logout}
            title="Đăng xuất"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
