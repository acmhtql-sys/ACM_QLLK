import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileSpreadsheet,
  Download,
  TrendingUp,
  AlertTriangle,
  Search,
  RefreshCw,
  Clock,
  ArrowUpRight,
  ArrowLeftRight,
} from 'lucide-react';
import { DemoDataNotice } from '../components/DemoDataNotice';
import { StatusBadge } from '../components/StatusBadge';
import { apiClient } from '../services/api';
import {
  InventoryReportItem,
  BorrowReturnReportResponse,
  OverdueLoanItem,
  LowStockAlertItem,
} from '@acm/shared';

export const ReportsPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'inventory' | 'borrowReturn' | 'lowStock'>('inventory');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tab 1: Inventory state
  const [inventoryData, setInventoryData] = useState<InventoryReportItem[]>([]);
  const [inventorySearch, setInventorySearch] = useState('');

  // Tab 2: Borrow-Return state
  const [borrowReport, setBorrowReport] = useState<BorrowReturnReportResponse | null>(null);

  // Tab 3: Low stock alerts state
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlertItem[]>([]);

  useEffect(() => {
    fetchReportData();
  }, [activeTab]);

  async function fetchReportData() {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === 'inventory') {
        const res = await apiClient.get('/reports/inventory');
        if (res.data?.success && res.data.data) {
          setInventoryData(res.data.data);
        }
      } else if (activeTab === 'borrowReturn') {
        const res = await apiClient.get('/reports/borrow-return');
        if (res.data?.success && res.data.data) {
          setBorrowReport(res.data.data);
        }
      } else if (activeTab === 'lowStock') {
        const res = await apiClient.get('/reports/low-stock');
        if (res.data?.success && res.data.data) {
          setLowStockAlerts(res.data.data);
        }
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Không thể tải dữ liệu báo cáo. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }

  // Helper to trigger browser CSV download
  function downloadCsv(filename: string, csvContent: string) {
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function exportInventoryCsv() {
    const headers = [
      'Mã linh kiện (Code)',
      'Tên linh kiện',
      'Danh mục',
      'Đơn vị',
      'Loại tài sản',
      'Tồn vật lý (OnHand)',
      'Khả dụng (Available)',
      'Giữ chỗ (Reserved)',
      'Đang mượn (Borrowed)',
      'Gán Kit (KitAllocated)',
      'Cách ly (Quarantined)',
      'Ngưỡng tối thiểu',
      'Trạng thái tồn kho',
    ];
    const rows = filteredInventory.map((item: InventoryReportItem) => [
      `"${item.code}"`,
      `"${item.name}"`,
      `"${item.categoryName}"`,
      `"${item.unit}"`,
      `"${item.type}"`,
      item.onHand,
      item.available,
      item.reserved,
      item.borrowed,
      item.kitAllocated,
      item.quarantined,
      item.minStockAlert,
      `"${item.stockStatus}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r: (string | number)[]) => r.join(','))].join('\n');
    downloadCsv(`ACM_Kiem_Ke_Ton_Kho_${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  function exportOverdueCsv() {
    if (!borrowReport?.overdueList) return;
    const headers = [
      'Mã phiếu mượn',
      'Họ tên người mượn',
      'Email',
      'Ngày mượn',
      'Hạn trả dự kiến',
      'Số ngày trễ hạn',
      'Tổng số linh kiện',
    ];
    const rows = borrowReport.overdueList.map((loan: OverdueLoanItem) => [
      `"${loan.requestNumber}"`,
      `"${loan.borrowerName || ''}"`,
      `"${loan.borrowerEmail || ''}"`,
      `"${new Date(loan.expectedBorrowDate).toLocaleDateString('vi-VN')}"`,
      `"${new Date(loan.expectedReturnDate).toLocaleDateString('vi-VN')}"`,
      loan.daysOverdue,
      loan.items.reduce((sum, it) => sum + it.quantity, 0),
    ]);
    const csv = [headers.join(','), ...rows.map((r: (string | number)[]) => r.join(','))].join('\n');
    downloadCsv(`ACM_Phieu_Muon_Qua_Han_${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  function exportLowStockCsv() {
    const headers = [
      'Mã linh kiện (Code)',
      'Tên linh kiện',
      'Danh mục',
      'Tồn khả dụng',
      'Tồn vật lý',
      'Ngưỡng cảnh báo',
      'Tỉ lệ đáp ứng (%)',
      'Mức độ ưu tiên',
    ];
    const rows = lowStockAlerts.map((alert: LowStockAlertItem) => [
      `"${alert.code}"`,
      `"${alert.name}"`,
      `"${alert.categoryName}"`,
      alert.available,
      alert.onHand,
      alert.minStockAlert,
      `${Math.round(alert.urgencyRatio * 100)}%`,
      alert.stockStatus === 'OUT_OF_STOCK' ? '"HẾT HÀNG"' : '"SẮP HẾT"',
    ]);
    const csv = [headers.join(','), ...rows.map((r: (string | number)[]) => r.join(','))].join('\n');
    downloadCsv(`ACM_Canh_Bao_Ton_Kho_${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  const filteredInventory = inventoryData.filter(
    (item) =>
      item.name.toLowerCase().includes(inventorySearch.toLowerCase()) ||
      item.code.toLowerCase().includes(inventorySearch.toLowerCase()) ||
      item.categoryName.toLowerCase().includes(inventorySearch.toLowerCase())
  );

  const totalOnHandSum = inventoryData.reduce((acc, i) => acc + i.onHand, 0);
  const totalAvailableSum = inventoryData.reduce((acc, i) => acc + i.available, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between space-y-4 sm:flex-row sm:items-center sm:space-y-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Báo cáo & Thống kê Vận hành (Reports & Analytics)
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Dữ liệu kiểm toán tồn kho, chỉ số luân chuyển thiết bị và theo dõi quá hạn thời gian thực
          </p>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => fetchReportData()}
            className="inline-flex items-center space-x-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
            <span>Làm mới</span>
          </button>
          {activeTab === 'inventory' && (
            <button
              onClick={exportInventoryCsv}
              className="inline-flex items-center space-x-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Xuất Excel / CSV</span>
            </button>
          )}
          {activeTab === 'borrowReturn' && (
            <button
              onClick={exportOverdueCsv}
              disabled={!borrowReport || borrowReport.overdueList.length === 0}
              className="inline-flex items-center space-x-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Xuất danh sách quá hạn</span>
            </button>
          )}
          {activeTab === 'lowStock' && (
            <button
              onClick={exportLowStockCsv}
              disabled={lowStockAlerts.length === 0}
              className="inline-flex items-center space-x-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Xuất danh sách bổ sung</span>
            </button>
          )}
        </div>
      </div>

      <DemoDataNotice moduleName="Reports & Analytics" />

      {/* Navigation Tabs */}
      <div className="border-b border-slate-200 bg-white rounded-t-xl px-4 pt-3 flex space-x-4">
        <button
          onClick={() => setActiveTab('inventory')}
          className={`flex items-center space-x-2 border-b-2 pb-3 text-xs font-semibold transition-all ${
            activeTab === 'inventory'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          <span>Kiểm kê Tồn kho ({inventoryData.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('borrowReturn')}
          className={`flex items-center space-x-2 border-b-2 pb-3 text-xs font-semibold transition-all ${
            activeTab === 'borrowReturn'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <TrendingUp className="h-4 w-4" />
          <span>Mượn - Trả & Quá hạn {borrowReport?.overdueList?.length ? `(${borrowReport.overdueList.length} trễ)` : ''}</span>
        </button>

        <button
          onClick={() => setActiveTab('lowStock')}
          className={`flex items-center space-x-2 border-b-2 pb-3 text-xs font-semibold transition-all ${
            activeTab === 'lowStock'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <AlertTriangle className="h-4 w-4" />
          <span>Cảnh báo Hết hàng ({lowStockAlerts.length})</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
          {error}
        </div>
      )}

      {/* TAB 1: INVENTORY REPORT */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Tổng chủng loại
              </span>
              <div className="mt-1 text-2xl font-bold text-slate-900">{inventoryData.length}</div>
              <p className="mt-0.5 text-xs text-slate-500">Mã linh kiện trong hệ thống</p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Tổng tồn vật lý (OnHand)
              </span>
              <div className="mt-1 text-2xl font-bold text-slate-900">{totalOnHandSum}</div>
              <p className="mt-0.5 text-xs text-slate-500">Tổng linh kiện đang lưu kho</p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Tổng khả dụng (Available)
              </span>
              <div className="mt-1 text-2xl font-bold text-emerald-600">{totalAvailableSum}</div>
              <p className="mt-0.5 text-xs text-slate-500">Sẵn sàng xuất hoặc phân bổ</p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Tỷ lệ sẵn sàng
              </span>
              <div className="mt-1 text-2xl font-bold text-blue-600">
                {totalOnHandSum > 0 ? Math.round((totalAvailableSum / totalOnHandSum) * 100) : 0}%
              </div>
              <p className="mt-0.5 text-xs text-slate-500">Tỷ lệ linh kiện khả dụng / onHand</p>
            </div>
          </div>

          {/* Search bar */}
          <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm kiếm theo mã linh kiện, tên, danh mục..."
                value={inventorySearch}
                onChange={(e) => setInventorySearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 pl-9 pr-4 py-2 text-xs focus:border-blue-500 focus:outline-none"
              />
            </div>
            <span className="text-xs text-slate-500">
              Hiển thị {filteredInventory.length} / {inventoryData.length} bản ghi
            </span>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/70 font-semibold text-slate-600">
                  <tr>
                    <th className="py-3 px-4">Mã linh kiện</th>
                    <th className="py-3 px-4">Tên linh kiện</th>
                    <th className="py-3 px-4">Danh mục</th>
                    <th className="py-3 px-4 text-center">ĐVT</th>
                    <th className="py-3 px-4 text-right">OnHand</th>
                    <th className="py-3 px-4 text-right">Khả dụng</th>
                    <th className="py-3 px-4 text-right">Giữ chỗ</th>
                    <th className="py-3 px-4 text-right">Đang mượn</th>
                    <th className="py-3 px-4 text-right">Gán Kit</th>
                    <th className="py-3 px-4 text-right">Cách ly</th>
                    <th className="py-3 px-4 text-center">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {filteredInventory.length > 0 ? (
                    filteredInventory.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-4 font-mono font-medium text-blue-600">{item.code}</td>
                        <td className="py-3 px-4 font-medium text-slate-900">{item.name}</td>
                        <td className="py-3 px-4 text-slate-500">{item.categoryName}</td>
                        <td className="py-3 px-4 text-center text-slate-500">{item.unit}</td>
                        <td className="py-3 px-4 text-right font-semibold text-slate-900">{item.onHand}</td>
                        <td className="py-3 px-4 text-right font-bold text-emerald-600">{item.available}</td>
                        <td className="py-3 px-4 text-right text-amber-600">{item.reserved}</td>
                        <td className="py-3 px-4 text-right text-indigo-600">{item.borrowed}</td>
                        <td className="py-3 px-4 text-right text-teal-600">{item.kitAllocated}</td>
                        <td className="py-3 px-4 text-right text-rose-600">{item.quarantined}</td>
                        <td className="py-3 px-4 text-center">
                          <StatusBadge status={item.stockStatus} variant="stockStatus" />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-xs text-slate-400">
                        {loading ? 'Đang tải dữ liệu kiểm kê...' : 'Không tìm thấy linh kiện nào phù hợp.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BORROW & RETURN REPORT */}
      {activeTab === 'borrowReturn' && borrowReport && (
        <div className="space-y-6">
          {/* Top Metrics Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Tổng lượt mượn
              </span>
              <div className="mt-1 text-2xl font-bold text-slate-900">{borrowReport.summary.totalRequests}</div>
              <p className="mt-0.5 text-xs text-slate-500">Tất cả phiếu đã lập</p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Đang lưu hành
              </span>
              <div className="mt-1 text-2xl font-bold text-indigo-600">{borrowReport.summary.handedOverCount}</div>
              <p className="mt-0.5 text-xs text-slate-500">Đã bàn giao cho người mượn</p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Đã hoàn trả
              </span>
              <div className="mt-1 text-2xl font-bold text-emerald-600">{borrowReport.summary.returnedCount}</div>
              <p className="mt-0.5 text-xs text-slate-500">Nhập lại kho thành công</p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Tỷ lệ hoàn trả
              </span>
              <div className="mt-1 text-2xl font-bold text-blue-600">
                {borrowReport.summary.returnRatePercent}%
              </div>
              <p className="mt-0.5 text-xs text-slate-500">Tỷ lệ hoàn trả đúng quy trình</p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Hư hỏng / Mất
              </span>
              <div className="mt-1 text-2xl font-bold text-rose-600">
                {borrowReport.summary.damagedOrLostCount}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">Linh kiện cần cách ly/đền bù</p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Số phiếu quá hạn
              </span>
              <div className={`mt-1 text-2xl font-bold ${borrowReport.summary.overdueCount > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                {borrowReport.summary.overdueCount}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">Cần gửi thông báo nhắc nhở</p>
            </div>
          </div>

          {/* Overdue Loans Table */}
          <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200/80 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Clock className="h-5 w-5 text-rose-500" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Danh sách Phiếu mượn Quá hạn (Overdue Loans)</h3>
                  <p className="text-xs text-slate-500">Các phiếu mượn đã vượt quá thời hạn cam kết hoàn trả</p>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/70 font-semibold text-slate-600">
                  <tr>
                    <th className="py-3 px-4">Mã phiếu</th>
                    <th className="py-3 px-4">Người mượn</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Ngày mượn</th>
                    <th className="py-3 px-4">Hạn trả</th>
                    <th className="py-3 px-4 text-center">Số ngày trễ</th>
                    <th className="py-3 px-4 text-right">Linh kiện mượn</th>
                    <th className="py-3 px-4 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {borrowReport.overdueList.length > 0 ? (
                    borrowReport.overdueList.map((loan) => (
                      <tr key={loan.id} className="hover:bg-rose-50/30">
                        <td className="py-3 px-4 font-mono font-medium text-rose-600">{loan.requestNumber}</td>
                        <td className="py-3 px-4 font-medium text-slate-900">{loan.borrowerName || 'Không tên'}</td>
                        <td className="py-3 px-4 text-slate-500">{loan.borrowerEmail || '-'}</td>
                        <td className="py-3 px-4 text-slate-500">
                          {new Date(loan.expectedBorrowDate).toLocaleDateString('vi-VN')}
                        </td>
                        <td className="py-3 px-4 text-slate-500">
                          {new Date(loan.expectedReturnDate).toLocaleDateString('vi-VN')}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">
                            +{loan.daysOverdue} ngày
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-slate-900">
                          {loan.items.reduce((s, it) => s + it.quantity, 0)} cái
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => navigate('/borrow-return')}
                            className="inline-flex items-center space-x-1 rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
                          >
                            <span>Xử lý thu hồi</span>
                            <ArrowUpRight className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-xs text-slate-400">
                        Tuyệt vời! Không có phiếu mượn nào bị quá hạn.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: LOW STOCK & CRITICAL ALERTS */}
      {activeTab === 'lowStock' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-900">
            <div className="flex items-start space-x-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Cảnh báo Tồn kho Khẩn cấp (Critical Stock Alerts):</span>
                <p className="mt-1 leading-relaxed">
                  Danh sách dưới đây liệt kê các linh kiện có mức tồn khả dụng chạm ngưỡng cảnh báo tối thiểu (<code className="font-mono font-semibold">available &le; minStockAlert</code>) hoặc đã hoàn toàn cạn kiệt (<code className="font-mono font-semibold">available = 0</code>). Hãy lên kế hoạch nhập hàng hoặc điều chuyển kịp thời.
                </p>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/70 font-semibold text-slate-600">
                  <tr>
                    <th className="py-3 px-4">Mức độ ưu tiên</th>
                    <th className="py-3 px-4">Mã linh kiện</th>
                    <th className="py-3 px-4">Tên linh kiện</th>
                    <th className="py-3 px-4">Danh mục</th>
                    <th className="py-3 px-4 text-right">Khả dụng</th>
                    <th className="py-3 px-4 text-right">Tồn vật lý</th>
                    <th className="py-3 px-4 text-right">Ngưỡng tối thiểu</th>
                    <th className="py-3 px-4 text-center">Tỷ lệ đáp ứng</th>
                    <th className="py-3 px-4 text-center">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {lowStockAlerts.length > 0 ? (
                    lowStockAlerts.map((alert) => (
                      <tr key={alert.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-4">
                          {alert.stockStatus === 'OUT_OF_STOCK' ? (
                            <span className="inline-flex items-center rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 border border-rose-200">
                              HẾT HÀNG
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 border border-amber-200">
                              SẮP HẾT
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono font-medium text-blue-600">{alert.code}</td>
                        <td className="py-3 px-4 font-medium text-slate-900">{alert.name}</td>
                        <td className="py-3 px-4 text-slate-500">{alert.categoryName}</td>
                        <td className="py-3 px-4 text-right font-bold text-slate-900">{alert.available}</td>
                        <td className="py-3 px-4 text-right text-slate-600">{alert.onHand}</td>
                        <td className="py-3 px-4 text-right text-slate-600">{alert.minStockAlert}</td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center space-x-2">
                            <div className="w-16 bg-slate-100 rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-2 rounded-full ${alert.stockStatus === 'OUT_OF_STOCK' ? 'bg-rose-500' : 'bg-amber-500'}`}
                                style={{ width: `${Math.min(100, Math.round(alert.urgencyRatio * 100))}%` }}
                              />
                            </div>
                            <span className="text-[11px] font-medium text-slate-500">
                              {Math.round(alert.urgencyRatio * 100)}%
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => navigate('/transactions')}
                            className="inline-flex items-center space-x-1 rounded bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 border border-blue-200 hover:bg-blue-100"
                          >
                            <ArrowLeftRight className="h-3 w-3" />
                            <span>Nhập thêm hàng</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-xs text-slate-400">
                        {loading ? 'Đang kiểm tra ngưỡng tồn kho...' : 'Tất cả linh kiện đều đang ở mức an toàn trên ngưỡng tối thiểu.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
