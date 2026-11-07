import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { canAccessPage } from '../config/access';
import { DashboardLayout } from '../layouts/DashboardLayout';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { ItemsPage } from '../pages/ItemsPage';
import { CategoriesPage } from '../pages/CategoriesPage';
import { KitsPage } from '../pages/KitsPage';
import { InventoryPage } from '../pages/InventoryPage';
import { StockTransactionsPage } from '../pages/StockTransactionsPage';
import { BorrowReturnPage } from '../pages/BorrowReturnPage';
import { UsersPage } from '../pages/UsersPage';
import { ReportsPage } from '../pages/ReportsPage';
import { AuditLogsPage } from '../pages/AuditLogsPage';
import { SettingsPage } from '../pages/SettingsPage';

// Protected Route wrapper
const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

const RoleProtectedPage: React.FC<{ path: string; children: React.ReactElement }> = ({ path, children }) => {
  const { user } = useAuth();
  if (!canAccessPage(user?.role, path)) {
    return (
      <div
        role="alert"
        data-testid="rbac-forbidden-screen"
        className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
      >
        <p className="font-semibold">403 - Quyền Truy Cập Bị Từ Chối</p>
        <p>Không có quyền truy cập trang này.</p>
      </div>
    );
  }
  return children;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* Dashboard routes wrapped in DashboardLayout */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="items" element={<ItemsPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="kits" element={<RoleProtectedPage path="/kits"><KitsPage /></RoleProtectedPage>} />
          <Route path="inventory" element={<RoleProtectedPage path="/inventory"><InventoryPage /></RoleProtectedPage>} />
          <Route path="transactions" element={<RoleProtectedPage path="/transactions"><StockTransactionsPage /></RoleProtectedPage>} />
          <Route path="borrow-return" element={<BorrowReturnPage />} />
          <Route path="users" element={<RoleProtectedPage path="/users"><UsersPage /></RoleProtectedPage>} />
          <Route path="reports" element={<RoleProtectedPage path="/reports"><ReportsPage /></RoleProtectedPage>} />
          <Route path="audit-logs" element={<RoleProtectedPage path="/audit-logs"><AuditLogsPage /></RoleProtectedPage>} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
