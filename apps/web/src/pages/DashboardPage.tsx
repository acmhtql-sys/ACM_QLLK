import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Cpu,
  Layers,
  ClipboardList,
  AlertTriangle,
  Warehouse,
  Boxes,
  PlusCircle,
  FileSpreadsheet,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { KpiCard } from '../components/KpiCard';
import { DemoDataNotice } from '../components/DemoDataNotice';
import { apiClient } from '../services/api';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>({
    kpis: {
      totalItems: 7,
      totalOnHand: 570,
      totalAvailable: 438,
      totalReserved: 28,
      totalBorrowed: 67,
      totalQuarantined: 5,
      totalKitAllocated: 32,
      activeBorrows: 3,
      pendingApprovalBorrows: 1,
      overdueBorrows: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
      totalKits: 4,
      activeKits: 4,
    },
    distribution: [
      { name: 'Khả dụng (Available)', value: 438, color: '#3b82f6' },
      { name: 'Đang mượn (Borrowed)', value: 67, color: '#6366f1' },
      { name: 'Giữ chỗ (Reserved)', value: 28, color: '#f59e0b' },
      { name: 'Gán Kit (KitAllocated)', value: 32, color: '#10b981' },
      { name: 'Cách ly lỗi (Quarantined)', value: 5, color: '#ef4444' },
    ],
    monthlyTrends: [
      { month: 'T5', imports: 45, exports: 20, borrows: 15 },
      { month: 'T6', imports: 60, exports: 30, borrows: 25 },
      { month: 'T7', imports: 35, exports: 18, borrows: 20 },
      { month: 'T8', imports: 80, exports: 40, borrows: 35 },
      { month: 'T9', imports: 95, exports: 50, borrows: 48 },
      { month: 'T10', imports: 110, exports: 65, borrows: 52 },
    ],
  });

  const [recentActivities, setRecentActivities] = useState<any[]>([]);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const res = await apiClient.get('/reports/summary');
        if (res.data?.success && res.data.data) {
          const apiData = res.data.data;
          const colors = ['#3b82f6', '#6366f1', '#f59e0b', '#10b981', '#ef4444'];
          const distributionWithColors = apiData.distribution.map((d: any, idx: number) => ({
            ...d,
            color: colors[idx % colors.length],
          }));
          setData({
            ...apiData,
            distribution: distributionWithColors,
          });
        }
      } catch (err) {
        // Fallback remains active
      } finally {
        setLoading(false);
      }
    }

    async function fetchRecentAudit() {
      try {
        const res = await apiClient.get('/audit-logs', { params: { limit: 5 } });
        if (res.data?.success && res.data.data) {
          setRecentActivities(res.data.data);
        }
      } catch {
        // Non-admin or unauthenticated fallback
      }
    }

    fetchDashboard();
    fetchRecentAudit();
  }, []);

  const kpis = data.kpis;
  const availablePercentage = kpis.totalOnHand > 0 
    ? Math.round((kpis.totalAvailable / kpis.totalOnHand) * 100) 
    : 0;

  return (
    <div className="space-y-6">
      {/* Page Title & Actions */}
      <div className="flex flex-col justify-between space-y-4 sm:flex-row sm:items-center sm:space-y-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Bảng điều khiển Tổng quan (Dashboard)
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Hệ thống giám sát tồn kho linh kiện, thiết bị phòng Lab & AI Robotic thời gian thực
          </p>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => navigate('/reports')}
            className="inline-flex items-center space-x-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-slate-500" />
            <span>Báo cáo kiểm kê</span>
          </button>
          <button
            onClick={() => navigate('/borrow-return')}
            className="inline-flex items-center space-x-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-blue-500/20 hover:bg-blue-700"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            <span>Tạo phiếu mượn</span>
          </button>
        </div>
      </div>

      <DemoDataNotice moduleName="Dashboard & KPI Metrics" />

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Tổng danh mục (Items)"
          value={kpis.totalItems}
          subtitle="Chủng loại linh kiện đang quản lý"
          trend="Đang hoạt động"
          trendPositive={true}
          icon={Cpu}
          iconColor="bg-blue-50 text-blue-600"
        />
        <KpiCard
          title="Tồn kho thực tế (On-Hand)"
          value={kpis.totalOnHand}
          subtitle="Tổng số lượng linh kiện trong phòng Lab"
          trend="Kiểm kê vật lý"
          trendPositive={true}
          icon={Warehouse}
          iconColor="bg-indigo-50 text-indigo-600"
        />
        <KpiCard
          title="Khả dụng xuất kho (Available)"
          value={kpis.totalAvailable}
          subtitle="Sẵn sàng bàn giao hoặc phân bổ"
          trend={`${availablePercentage}% trên tổng On-Hand`}
          trendPositive={true}
          icon={Layers}
          iconColor="bg-emerald-50 text-emerald-600"
        />
        <KpiCard
          title="Đang mượn ngoài Lab (Borrowed)"
          value={kpis.totalBorrowed}
          subtitle="Sinh viên / GV đang lưu hành"
          trend="Đã bàn giao"
          trendPositive={true}
          icon={ClipboardList}
          iconColor="bg-sky-50 text-sky-600"
        />
      </div>

      {/* Secondary Operational Stats Ribbon */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Phiếu mượn cần xử lý
            </span>
            <div className="mt-1 text-xl font-bold text-slate-900">
              {kpis.activeBorrows}{' '}
              <span className="text-xs font-normal text-slate-500">phiếu</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {kpis.pendingApprovalBorrows} chờ duyệt •{' '}
              <span className={kpis.overdueBorrows > 0 ? 'text-rose-600 font-semibold' : 'text-slate-500'}>
                {kpis.overdueBorrows} quá hạn
              </span>
            </p>
          </div>
          <div className={`p-2.5 rounded-lg ${kpis.overdueBorrows > 0 ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'}`}>
            <Clock className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Cảnh báo tồn kho
            </span>
            <div className="mt-1 text-xl font-bold text-slate-900">
              {kpis.lowStockCount + kpis.outOfStockCount}{' '}
              <span className="text-xs font-normal text-slate-500">mặt hàng</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              <span className={kpis.outOfStockCount > 0 ? 'text-rose-600 font-semibold' : 'text-slate-500'}>
                {kpis.outOfStockCount} hết hàng
              </span>{' '}
              • {kpis.lowStockCount} sắp hết
            </p>
          </div>
          <div className={`p-2.5 rounded-lg ${kpis.lowStockCount + kpis.outOfStockCount > 0 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
            <AlertTriangle className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Hộp Kit thực hành
            </span>
            <div className="mt-1 text-xl font-bold text-slate-900">
              {kpis.activeKits}{' '}
              <span className="text-xs font-normal text-slate-500">/ {kpis.totalKits} kits</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Đang hoạt động & phân bổ học tập
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-teal-50 text-teal-600">
            <Boxes className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Giữ chỗ & Cách ly
            </span>
            <div className="mt-1 text-xl font-bold text-slate-900">
              {kpis.totalReserved + kpis.totalQuarantined + kpis.totalKitAllocated}{' '}
              <span className="text-xs font-normal text-slate-500">linh kiện</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {kpis.totalReserved} giữ chỗ • {kpis.totalKitAllocated} kit • {kpis.totalQuarantined} lỗi
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-100 text-slate-600">
            <ShieldCheck className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Invariant Rule Banner */}
      <div className="rounded-xl border border-blue-200/80 bg-gradient-to-r from-blue-50/80 to-indigo-50/60 p-4 text-xs text-blue-900">
        <div className="flex items-start space-x-3">
          <CheckCircle2 className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-blue-950">Quy tắc Cân bằng Kiểm toán Tồn kho (Audit Invariant):</span>
            <p className="mt-1 leading-relaxed text-blue-800">
              <code className="bg-white/80 px-1.5 py-0.5 rounded font-mono font-semibold text-blue-900">
                Available ({kpis.totalAvailable}) = OnHand ({kpis.totalOnHand}) - Reserved ({kpis.totalReserved}) - Quarantined ({kpis.totalQuarantined}) - KitAllocated ({kpis.totalKitAllocated})
              </code>
              . Số lượng <code className="bg-white/80 px-1 py-0.5 rounded font-mono">Borrowed ({kpis.totalBorrowed})</code> là linh kiện đã xuất giao thực tế khỏi phòng Lab, được theo dõi độc lập và không bị trừ trùng hai lần.
            </p>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Inventory Breakdown Donut Chart */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-1">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Phân bố Trạng thái Tồn kho
              </h3>
              <p className="text-[11px] text-slate-400">Tỷ trọng khả dụng và phân bổ vật lý</p>
            </div>
          </div>
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.distribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {data.distribution.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 text-center text-[11px] text-slate-500">
            Tổng cộng: <strong className="text-slate-800">{kpis.totalOnHand + kpis.totalBorrowed}</strong> linh kiện trên toàn hệ thống
          </div>
        </div>

        {/* Monthly Activity Bar Chart */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Lưu chuyển Kho theo Tháng (Xuất - Nhập - Mượn)
              </h3>
              <p className="text-[11px] text-slate-400">Số lượng giao dịch trong 6 tháng gần nhất</p>
            </div>
            <span className="text-[11px] font-medium text-slate-500">Dữ liệu thời gian thực</span>
          </div>
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthlyTrends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="imports" name="Nhập kho" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="borrows" name="Mượn ra ngoài" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="exports" name="Xuất tiêu hao" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Activity Table */}
      <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Hoạt động Hệ thống & Kiểm toán gần nhất</h3>
            <p className="text-xs text-slate-500">Nhật ký xử lý linh kiện và giao dịch phòng Lab</p>
          </div>
          <button
            onClick={() => navigate('/audit-logs')}
            className="inline-flex items-center space-x-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
          >
            <span>Xem tất cả nhật ký</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50/70 font-semibold text-slate-600">
              <tr>
                <th className="py-3 px-4">Thời gian</th>
                <th className="py-3 px-4">Người thực hiện</th>
                <th className="py-3 px-4">Hành động</th>
                <th className="py-3 px-4">Đối tượng</th>
                <th className="py-3 px-4">Chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {recentActivities.length > 0 ? (
                recentActivities.map((act) => (
                  <tr key={act.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                      {new Date(act.createdAt).toLocaleString('vi-VN')}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800">
                      {act.user?.fullName || act.user?.email || 'Hệ thống'}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 border border-blue-200">
                        {act.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600">
                      {act.entity} {act.entityId ? `(#${act.entityId.slice(0, 8)})` : ''}
                    </td>
                    <td className="py-3 px-4 text-slate-500 truncate max-w-xs">
                      {act.newValue ? JSON.stringify(act.newValue).slice(0, 60) + '...' : '-'}
                    </td>
                  </tr>
                ))
              ) : (
                <>
                  <tr className="hover:bg-slate-50/50">
                    <td className="py-3 px-4 text-slate-500">Hôm nay, 10:15</td>
                    <td className="py-3 px-4 font-medium text-slate-800">Nguyen Van A (Sinh viên)</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 border border-blue-200">
                        BORROW_REQUEST_CREATE
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600">BORROW_REQUEST (#BR-202610)</td>
                    <td className="py-3 px-4 text-slate-500">Mượn 3 linh kiện: Arduino Uno, ESP32, Servo SG90</td>
                  </tr>
                  <tr className="hover:bg-slate-50/50">
                    <td className="py-3 px-4 text-slate-500">Hôm nay, 09:30</td>
                    <td className="py-3 px-4 font-medium text-slate-800">Lab Manager</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200">
                        STOCK_IMPORT
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600">STOCK_TRANSACTION (#TX-0001)</td>
                    <td className="py-3 px-4 text-slate-500">Nhập kho +20 ESP32 DevKit V1</td>
                  </tr>
                  <tr className="hover:bg-slate-50/50">
                    <td className="py-3 px-4 text-slate-500">Hôm qua, 15:45</td>
                    <td className="py-3 px-4 font-medium text-slate-800">Tran Thi B (Sinh viên)</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 border border-indigo-200">
                        BORROW_HANDOVER
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600">BORROW_REQUEST (#BR-202609)</td>
                    <td className="py-3 px-4 text-slate-500">Bàn giao DHT22 và cảm biến khoảng cách HC-SR04</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
