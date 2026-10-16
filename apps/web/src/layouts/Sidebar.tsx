import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Cpu,
  Layers,
  Boxes,
  Warehouse,
  ArrowLeftRight,
  ClipboardList,
  Users,
  BarChart3,
  History,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const navItems = [
  { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { name: 'Linh kiện & Thiết bị', path: '/items', icon: Cpu },
  { name: 'Danh mục (Categories)', path: '/categories', icon: Layers },
  { name: 'Hộp Kit thực hành (Kits)', path: '/kits', icon: Boxes },
  { name: 'Kho & Tồn kho (Inventory)', path: '/inventory', icon: Warehouse },
  { name: 'Giao dịch kho (Stock Tx)', path: '/transactions', icon: ArrowLeftRight },
  { name: 'Mượn & Trả (Borrow & Return)', path: '/borrow-return', icon: ClipboardList },
  { name: 'Người dùng (Users)', path: '/users', icon: Users },
  { name: 'Báo cáo & Thống kê', path: '/reports', icon: BarChart3 },
  { name: 'Nhật ký kiểm toán (Audit)', path: '/audit-logs', icon: History },
  { name: 'Cài đặt hệ thống', path: '/settings', icon: Settings },
];

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-slate-900 text-slate-300 transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-0 -translate-x-full'
        }`}
      >
        {/* Logo Section */}
        <div className="flex h-16 items-center justify-between border-b border-slate-800 px-5">
          <div className="flex items-center space-x-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white font-extrabold shadow-lg shadow-blue-500/30">
              ACM
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-white">ACM SYSTEM</div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Lab & AI Robotic</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Main Navigation
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => onClose()}
                className={({ isActive }) =>
                  `flex items-center space-x-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                      : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
                  }`
                }
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{item.name}</span>
              </NavLink>
            );
          })}
        </div>

        {/* Bottom System Info */}
        <div className="border-t border-slate-800 p-3">
          <div className="flex items-center space-x-2 rounded-lg bg-slate-800/60 p-2.5 text-xs">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <div>
              <div className="text-[11px] font-semibold text-slate-200">Phase 1 Foundation</div>
              <div className="text-[10px] text-slate-400">v1.0.0 Monorepo Active</div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
