import React, { useState, useEffect } from 'react';
import { X, Barcode, AlertTriangle, MapPin, Calendar, Clock, Layers, Package, ShieldCheck } from 'lucide-react';
import { apiClient } from '../../services/api';
import { ItemResponse } from '@acm/shared';
import { StatusBadge } from '../StatusBadge';

interface ItemDetailModalProps {
  isOpen: boolean;
  itemId: string | null;
  onClose: () => void;
}

export const ItemDetailModal: React.FC<ItemDetailModalProps> = ({
  isOpen,
  itemId,
  onClose,
}) => {
  const [item, setItem] = useState<ItemResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && itemId) {
      const fetchDetail = async () => {
        setLoading(true);
        setError(null);
        try {
          const res = await apiClient.get(`/items/${itemId}`);
          if (res.data?.success) {
            setItem(res.data.data);
          }
        } catch (err: any) {
          if (err.response?.status === 403) {
            setError('Bạn không có quyền xem thông tin chi tiết linh kiện này (linh kiện đã ngưng hoạt động).');
          } else if (err.response?.status === 404) {
            setError('Không tìm thấy linh kiện yêu cầu trong hệ thống.');
          } else {
            setError(err.response?.data?.message || 'Không thể tải thông tin chi tiết linh kiện.');
          }
        } finally {
          setLoading(false);
        }
      };

      fetchDetail();
    } else {
      setItem(null);
    }
  }, [isOpen, itemId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in">
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/50">
          <div className="flex items-center space-x-2">
            <Barcode className="h-5 w-5 text-blue-600" />
            <div>
              <h3 className="text-base font-bold text-slate-900">Chi tiết Linh kiện & Tồn kho</h3>
              <p className="text-xs text-slate-500">Mã định danh hệ thống và số lượng khả dụng theo vị trí</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[80vh] overflow-y-auto space-y-5">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              <p className="text-xs text-slate-400">Đang tải dữ liệu tồn kho từ cơ sở dữ liệu...</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-center space-y-2">
              <AlertTriangle className="h-6 w-6 text-rose-500 mx-auto" />
              <p className="text-xs font-semibold text-rose-800">{error}</p>
            </div>
          ) : item ? (
            <>
              {/* Item Info Banner */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 p-4 rounded-xl border border-slate-100 bg-slate-50/60">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded">
                      {item.code}
                    </span>
                    <StatusBadge status={item.type} variant="itemType" />
                    <StatusBadge status={item.stockStatus} variant="stockStatus" />
                    <StatusBadge
                      status={item.isActive ? 'ACTIVE' : 'INACTIVE'}
                      variant="activeStatus"
                    />
                  </div>
                  <h2 className="text-base font-bold text-slate-900 mt-1">{item.name}</h2>
                  <p className="text-xs text-slate-500">
                    {item.description || 'Chưa có thông tin mô tả chi tiết'}
                  </p>
                  <div className="pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                    <span className="flex items-center space-x-1">
                      <Layers className="h-3 w-3" />
                      <span>Danh mục: {item.category?.name || 'Chưa gán'}</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <Package className="h-3 w-3" />
                      <span>Đơn vị: {item.unit}</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <Calendar className="h-3 w-3" />
                      <span>
                        Tạo ngày: {new Date(item.createdAt).toLocaleDateString('vi-VN')}
                      </span>
                    </span>
                  </div>
                </div>

                {item.imageUrl && (
                  <div className="shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-slate-200 bg-white">
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
              </div>

              {/* Low Stock Warning */}
              {item.isLowStock && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 flex items-start space-x-3 text-xs text-amber-900">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h5 className="font-bold">Cảnh báo tồn kho an toàn</h5>
                    <p className="mt-0.5 text-amber-800">
                      Số lượng khả dụng ({item.available}) đang thấp hơn ngưỡng cảnh báo tối thiểu (
                      {item.minStockAlert} {item.unit}). Cần lập kế hoạch nhập thêm linh kiện.
                    </p>
                  </div>
                </div>
              )}

              {/* Stock KPI Metrics */}
              <div>
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2.5">
                  Tổng quan số lượng tồn kho
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-xs">
                    <span className="text-[11px] font-medium text-slate-500">Tồn vật lý (On-hand)</span>
                    <p className="mt-1 text-lg font-bold text-slate-900">
                      {item.totalOnHand} <span className="text-xs font-normal text-slate-400">{item.unit}</span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 shadow-xs">
                    <span className="text-[11px] font-bold text-emerald-700">Khả dụng (Available)</span>
                    <p className="mt-1 text-lg font-extrabold text-emerald-700">
                      {item.available} <span className="text-xs font-normal text-emerald-600">{item.unit}</span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-xs">
                    <span className="text-[11px] font-medium text-slate-500">Đã duyệt giữ (Reserved)</span>
                    <p className="mt-1 text-lg font-bold text-blue-600">
                      {item.totalReserved} <span className="text-xs font-normal text-slate-400">{item.unit}</span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-xs">
                    <span className="text-[11px] font-medium text-slate-500">Cách ly / Lỗi (Quarantined)</span>
                    <p className="mt-1 text-lg font-bold text-rose-600">
                      {item.totalQuarantined} <span className="text-xs font-normal text-slate-400">{item.unit}</span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-xs">
                    <span className="text-[11px] font-medium text-slate-500">Gắn trong Kit (Allocated)</span>
                    <p className="mt-1 text-lg font-bold text-purple-600">
                      {item.totalKitAllocated} <span className="text-xs font-normal text-slate-400">{item.unit}</span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-xs">
                    <span className="text-[11px] font-medium text-slate-500">Đang mượn ngoài (Borrowed)</span>
                    <p className="mt-1 text-lg font-bold text-amber-600">
                      {item.totalBorrowed} <span className="text-xs font-normal text-slate-400">{item.unit}</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Location Balances Breakdown */}
              <div>
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2.5">
                  Phân bổ tồn kho theo vị trí lưu trữ
                </h4>
                {item.stockBalances && item.stockBalances.length > 0 ? (
                  <div className="rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                        <tr>
                          <th className="py-2.5 px-3">Vị trí lưu kho</th>
                          <th className="py-2.5 px-3 text-right">Vật lý</th>
                          <th className="py-2.5 px-3 text-right">Khả dụng</th>
                          <th className="py-2.5 px-3 text-right">Giữ chỗ</th>
                          <th className="py-2.5 px-3 text-right">Cách ly</th>
                          <th className="py-2.5 px-3 text-right">Kit</th>
                          <th className="py-2.5 px-3 text-right">Mượn</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {item.stockBalances.map((b) => (
                          <tr key={b.id} className="hover:bg-slate-50/50">
                            <td className="py-2.5 px-3">
                              <div className="flex items-center space-x-1.5">
                                <MapPin className="h-3 w-3 text-slate-400" />
                                <span className="font-mono font-medium text-blue-600">
                                  {b.location?.code}
                                </span>
                                <span className="text-slate-500">- {b.location?.name}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-medium text-slate-800">{b.onHand}</td>
                            <td className="py-2.5 px-3 text-right font-bold text-emerald-600">
                              {b.available}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-500">{b.reserved}</td>
                            <td className="py-2.5 px-3 text-right text-slate-500">{b.quarantined}</td>
                            <td className="py-2.5 px-3 text-right text-slate-500">{b.kitAllocated}</td>
                            <td className="py-2.5 px-3 text-right text-slate-500">{b.borrowed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                    Chưa có số lượng tồn kho nào được ghi nhận tại các vị trí lưu trữ.
                  </div>
                )}
              </div>

              {/* Invariant Rule Reminder */}
              <div className="border-t border-slate-100 pt-3 flex items-center justify-between text-[11px] text-slate-400">
                <span className="flex items-center space-x-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-blue-500" />
                  <span>Quy tắc: Khả dụng = Tồn vật lý - Đã giữ - Cách ly - Gắn Kit</span>
                </span>
                <span>Ngưỡng an toàn: &gt;= {item.minStockAlert} {item.unit}</span>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-slate-100 px-6 py-3 bg-slate-50/50">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-300 transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
