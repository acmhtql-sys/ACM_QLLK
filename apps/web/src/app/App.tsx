import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
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
          <Route path="kits" element={<KitsPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="transactions" element={<StockTransactionsPage />} />
          <Route path="borrow-return" element={<BorrowReturnPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="audit-logs" element={<AuditLogsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
