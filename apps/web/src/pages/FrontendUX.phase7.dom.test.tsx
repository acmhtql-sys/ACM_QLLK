// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { ToastProvider, useToast } from '../context/ToastContext';
import { EmptyState } from '../components/common/EmptyState';
import { CardSkeleton, TableSkeleton, LoadingSkeleton } from '../components/common/LoadingSkeleton';
import { LoginPage } from './LoginPage';
import { AuthProvider } from '../hooks/useAuth';
import { BrowserRouter } from 'react-router-dom';

describe('ACM Phase 7 – Frontend & UX Component DOM Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  // =========================================================================
  // GROUP 1: CONFIRMATION MODAL TESTS
  // =========================================================================
  describe('Group 1: ConfirmationModal Component', () => {
    it('TC-UX-MODAL-01: does not render anything when isOpen is false', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      const { container } = render(
        <ConfirmationModal
          isOpen={false}
          title="Xác nhận xóa"
          message="Bạn có chắc chắn muốn xóa không?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      expect(container.firstChild).toBeNull();
      expect(screen.queryByText('Xác nhận xóa')).toBeNull();
    });

    it('TC-UX-MODAL-02: renders title, message, and triggers onConfirm / onCancel', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmationModal
          isOpen={true}
          title="Xóa danh mục"
          message="Hành động này không thể hoàn tác"
          confirmText="Đồng ý xóa"
          cancelText="Quay lại"
          variant="danger"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      expect(screen.getByText('Xóa danh mục')).toBeDefined();
      expect(screen.getByText('Hành động này không thể hoàn tác')).toBeDefined();

      const confirmBtn = screen.getByText('Đồng ý xóa');
      fireEvent.click(confirmBtn);
      expect(onConfirm).toHaveBeenCalledTimes(1);

      const cancelBtn = screen.getByText('Quay lại');
      fireEvent.click(cancelBtn);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('TC-UX-MODAL-03: renders loading state with spinner and disables buttons', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      render(
        <ConfirmationModal
          isOpen={true}
          title="Đang khóa tài khoản"
          message="Vui lòng chờ..."
          isLoading={true}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      expect(screen.getByText('Đang xử lý...')).toBeDefined();
      const buttons = screen.getAllByRole('button');
      buttons.forEach((btn) => {
        expect((btn as HTMLButtonElement).disabled).toBe(true);
      });
    });

    it('TC-UX-MODAL-04: supports different alert variants (warning, info, success, danger)', () => {
      const variants = ['warning', 'info', 'success', 'danger'] as const;

      for (const variant of variants) {
        const { unmount } = render(
          <ConfirmationModal
            isOpen={true}
            title={`Variant ${variant}`}
            message="Test message"
            variant={variant}
            onConfirm={vi.fn()}
            onCancel={vi.fn()}
          />
        );
        expect(screen.getByText(`Variant ${variant}`)).toBeDefined();
        unmount();
      }
    });
  });

  // =========================================================================
  // GROUP 2: TOAST CONTEXT & NOTIFICATIONS
  // =========================================================================
  describe('Group 2: Toast Context & Feedback Provider', () => {
    const TestComponent: React.FC = () => {
      const toast = useToast();
      return (
        <div>
          <button onClick={() => toast.success('Thành công mỹ mãn')}>Show Success</button>
          <button onClick={() => toast.error('Đã xảy ra lỗi nghiêm trọng')}>Show Error</button>
          <button onClick={() => toast.warning('Cảnh báo tồn thấp')}>Show Warning</button>
          <button onClick={() => toast.info('Thông tin hệ thống')}>Show Info</button>
        </div>
      );
    };

    it('TC-UX-TOAST-01: dispatches and displays toasts of different types', () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      // Trigger success toast
      fireEvent.click(screen.getByText('Show Success'));
      expect(screen.getByText('Thành công mỹ mãn')).toBeDefined();

      // Trigger error toast
      fireEvent.click(screen.getByText('Show Error'));
      expect(screen.getByText('Đã xảy ra lỗi nghiêm trọng')).toBeDefined();

      // Trigger warning toast
      fireEvent.click(screen.getByText('Show Warning'));
      expect(screen.getByText('Cảnh báo tồn thấp')).toBeDefined();

      // Trigger info toast
      fireEvent.click(screen.getByText('Show Info'));
      expect(screen.getByText('Thông tin hệ thống')).toBeDefined();
    });

    it('TC-UX-TOAST-02: allows manual dismissal of a toast', () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByText('Show Success'));
      expect(screen.getByText('Thành công mỹ mãn')).toBeDefined();

      // Click close button on toast
      const closeButtons = screen.getAllByRole('button');
      const toastCloseBtn = closeButtons[closeButtons.length - 1];
      fireEvent.click(toastCloseBtn);

      expect(screen.queryByText('Thành công mỹ mãn')).toBeNull();
    });
  });

  // =========================================================================
  // GROUP 3: SKELETONS & EMPTY STATES
  // =========================================================================
  describe('Group 3: Loading Skeletons and Empty State UX', () => {
    it('TC-UX-STATE-01: renders CardSkeleton, TableSkeleton and generic LoadingSkeleton', () => {
      const { container: c1 } = render(<CardSkeleton count={3} />);
      expect(c1.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);

      const { container: c2 } = render(<TableSkeleton rows={4} columns={5} />);
      expect(c2.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);

      const { container: c3 } = render(<LoadingSkeleton rows={3} />);
      expect(c3.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    });

    it('TC-UX-STATE-02: renders EmptyState with title, message, and optional action', () => {
      const onAction = vi.fn();
      render(
        <EmptyState
          title="Chưa có dữ liệu danh mục"
          message="Vui lòng bấm nút thêm mới để bắt đầu"
          actionLabel="Tạo danh mục"
          onAction={onAction}
        />
      );

      expect(screen.getByText('Chưa có dữ liệu danh mục')).toBeDefined();
      expect(screen.getByText('Vui lòng bấm nút thêm mới để bắt đầu')).toBeDefined();

      const btn = screen.getByText('Tạo danh mục');
      fireEvent.click(btn);
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // GROUP 4: LOGIN PAGE UX & SESSION EXPIRATION
  // =========================================================================
  describe('Group 4: LoginPage UX & Session Expiration Handling', () => {
    it('TC-UX-LOGIN-01: renders session expiration alert when acm_session_expired is set in sessionStorage', () => {
      sessionStorage.setItem('acm_session_expired', 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.');

      render(
        <BrowserRouter>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </BrowserRouter>
      );

      expect(screen.getByText(/Phiên làm việc đã hết hạn/i)).toBeDefined();
      // Verifies that flag was consumed and cleared
      expect(sessionStorage.getItem('acm_session_expired')).toBeNull();
    });

    it('TC-UX-LOGIN-02: validates invalid email format before submission', () => {
      render(
        <BrowserRouter>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </BrowserRouter>
      );

      const emailInput = screen.getByPlaceholderText('ten.nguoidung@acm.local');
      const passwordInput = screen.getByPlaceholderText('••••••••••••');
      const form = emailInput.closest('form')!;

      // Enter invalid email
      fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
      fireEvent.change(passwordInput, { target: { value: 'secret123' } });
      fireEvent.submit(form);

      expect(screen.getByText(/Định dạng email không hợp lệ/i)).toBeDefined();
    });

    it('TC-UX-LOGIN-03: renders demo accounts helper guide for quick testing', () => {
      render(
        <BrowserRouter>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </BrowserRouter>
      );

      expect(screen.getByText('Tài khoản mẫu theo vai trò (Click để chọn nhanh)')).toBeDefined();
      expect(screen.getByText(/Quản trị viên \(Admin\)/)).toBeDefined();
      expect(screen.getByText(/Quản lý Lab \(Manager\)/)).toBeDefined();
      expect(screen.getByText(/Kỹ thuật viên \(Tech\)/)).toBeDefined();
      expect(screen.getByText(/Sinh viên \(Student\)/)).toBeDefined();
    });
  });
});
