// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BorrowReturnPage } from './BorrowReturnPage';
import {
  savePendingBorrowReturn,
  readPendingBorrowReturn,
  listDurableBorrowReturnGuards,
  createMockLockManager,
  type PendingBorrowReturn,
} from './borrowReturnPending';

const mocks = vi.hoisted(() => ({
  role: 'TECHNICIAN' as 'ADMIN' | 'LAB_MANAGER' | 'TECHNICIAN' | 'STUDENT',
  userId: 'tech-1',
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('../services/api', () => ({
  apiClient: {
    get: mocks.get,
    post: mocks.post,
    patch: mocks.patch,
  },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: mocks.userId,
      role: mocks.role,
      fullName: 'Kỹ thuật viên Test',
      email: 'tech@lhu.edu.vn',
    },
    token: 'mock-token',
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const mockBorrow = {
  id: 'borrow-test-1',
  requestNumber: 'BR-20261104-001',
  borrowerName: 'Nguyen Van A',
  borrowerEmail: 'vana@lhu.edu.vn',
  status: 'HANDED_OVER',
  purpose: 'Thực hành IoT Lab',
  expectedBorrowDate: '2026-11-01',
  expectedReturnDate: '2026-11-08',
  itemCount: 2,
  details: [
    {
      id: 'detail-led',
      itemId: 'item-led',
      item: { id: 'item-led', code: 'LED-RGB', name: 'LED RGB Module', unit: 'cái' },
      quantity: 5,
      returnedQuantity: 1,
    },
    {
      id: 'detail-esp',
      itemId: 'item-esp',
      item: { id: 'item-esp', code: 'ESP32-WROOM', name: 'ESP32 DevKit', unit: 'cái' },
      quantity: 2,
      returnedQuantity: 0,
    },
  ],
};

async function openReturnModal() {
  const returnBtn = await screen.findByRole('button', { name: /Nhận hoàn trả/i });
  fireEvent.click(returnBtn);
  await screen.findByRole('button', { name: /Xác nhận hoàn trả/i });
}

describe('BorrowReturnPage Frontend Idempotency & Lost-Response Suite (FE-RET-01..16)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    mocks.role = 'TECHNICIAN';
    mocks.userId = 'tech-1';

    // Mock navigator.locks using createMockLockManager
    const mockLockManager = createMockLockManager();
    Object.defineProperty(window.navigator, 'locks', {
      value: mockLockManager,
      configurable: true,
      writable: true,
    });

    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.patch.mockReset();

    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/borrow-requests') {
        return { data: { success: true, data: [mockBorrow] } };
      }
      throw new Error(`Unexpected GET: ${path}`);
    });

    mocks.post.mockResolvedValue({
      data: {
        success: true,
        data: {
          returnNumber: 'RT-20261104-001',
          borrowRequest: { id: 'borrow-test-1' },
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('FE-RET-01: Generates and attaches valid Idempotency-Key header on return POST', async () => {
    render(<BorrowReturnPage />);
    await openReturnModal();

    // Fill return quantity 2 for LED-RGB
    const ledInput = screen.getByLabelText('Số lượng trả LED-RGB');
    fireEvent.change(ledInput, { target: { value: '2' } });

    // Submit
    const submitBtn = screen.getByRole('button', { name: /Xác nhận hoàn trả/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledTimes(1);
    });

    const [url, payload, config] = mocks.post.mock.calls[0];
    expect(url).toBe('/borrow-requests/borrow-test-1/return');
    expect(payload.items).toEqual([
      {
        borrowDetailId: 'detail-led',
        returnedQuantity: 2,
        condition: 'GOOD',
        notes: undefined,
      },
    ]);
    expect(config?.headers?.['Idempotency-Key']).toBeDefined();
    expect(config.headers['Idempotency-Key']).toMatch(/^return_[0-9a-f]{32}$/);

    // After success, pending intent should be cleared from sessionStorage
    expect(readPendingBorrowReturn('tech-1', 'borrow-test-1')).toBeNull();
  });

  it('FE-RET-02: Synchronously blocks rapid double clicks to prevent multiple POSTs', async () => {
    mocks.post.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                data: {
                  success: true,
                  data: { returnNumber: 'RT-20261104-002' },
                },
              }),
            100
          )
        )
    );

    render(<BorrowReturnPage />);
    await openReturnModal();

    const ledInput = screen.getByLabelText('Số lượng trả LED-RGB');
    fireEvent.change(ledInput, { target: { value: '1' } });

    const submitBtn = screen.getByRole('button', { name: /Xác nhận hoàn trả/i });
    // Click twice rapidly
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledTimes(1);
    });
  });

  it('FE-RET-03: Fails closed and aborts POST if sessionStorage write throws', async () => {
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError: Storage quota exceeded');
    });

    render(<BorrowReturnPage />);
    await openReturnModal();

    const ledInput = screen.getByLabelText('Số lượng trả LED-RGB');
    fireEvent.change(ledInput, { target: { value: '1' } });

    const submitBtn = screen.getByRole('button', { name: /Xác nhận hoàn trả/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Không thể lưu an toàn ý định hoàn trả/i)
      ).toBeDefined();
    });

    // Crucial: API POST MUST NOT be called!
    expect(mocks.post).not.toHaveBeenCalled();

    storageSpy.mockRestore();
  });

  it('FE-RET-04: Network timeout / error preserves intent and durable guard in storage', async () => {
    mocks.post.mockRejectedValue(new Error('Network Error: Gateway Timeout (504)'));

    render(<BorrowReturnPage />);
    await openReturnModal();

    const ledInput = screen.getByLabelText('Số lượng trả LED-RGB');
    fireEvent.change(ledInput, { target: { value: '2' } });

    const submitBtn = screen.getByRole('button', { name: /Xác nhận hoàn trả/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Mất kết nối hoặc phản hồi không rõ ràng/i)
      ).toBeDefined();
    });

    // Verify session pending record is preserved
    const pending = readPendingBorrowReturn('tech-1', 'borrow-test-1');
    expect(pending).not.toBeNull();
    expect(pending?.payload.items[0].returnedQuantity).toBe(2);

    // Verify durable guard in localStorage survives
    const guards = listDurableBorrowReturnGuards('tech-1');
    expect(guards.length).toBe(1);
    expect(guards[0].borrowId).toBe('borrow-test-1');
  });

  it('FE-RET-05: Lost-Response Reconciliation resolves COMPLETED receipt on GET return-status', async () => {
    const key = 'return_0123456789abcdef0123456789abcdef';
    const pending: PendingBorrowReturn = {
      version: 1,
      userId: 'tech-1',
      borrowId: 'borrow-test-1',
      key,
      payload: {
        items: [{ borrowDetailId: 'detail-led', returnedQuantity: 1, condition: 'GOOD' }],
        notes: 'Test lost response',
      },
      createdAt: Date.now(),
    };
    savePendingBorrowReturn(pending);

    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/borrow-requests') {
        return { data: { success: true, data: [mockBorrow] } };
      }
      if (path === `/borrow-requests/borrow-test-1/return-status/${key}`) {
        return {
          data: {
            success: true,
            data: {
              state: 'COMPLETED',
              requiresReconciliation: false,
              receipt: {
                borrowRequestId: 'borrow-test-1',
                returnNumber: 'RT-RECON-SUCCESS-001',
              },
            },
          },
        };
      }
      throw new Error(`Unexpected GET: ${path}`);
    });

    render(<BorrowReturnPage />);

    const reconcileBtn = await screen.findByRole('button', { name: /Đối soát giao dịch/i });
    fireEvent.click(reconcileBtn);

    await waitFor(() => {
      expect(screen.getByText(/Đối soát thành công/i)).toBeDefined();
      expect(screen.getByText(/RT-RECON-SUCCESS-001/i)).toBeDefined();
    });

    // Storage guard must be cleanly cleared after verified receipt
    expect(readPendingBorrowReturn('tech-1', 'borrow-test-1')).toBeNull();
    expect(listDurableBorrowReturnGuards('tech-1').length).toBe(0);
  });

  it('FE-RET-06: Lost-Response Reconciliation on NOT_FOUND / PENDING keeps guard and never retries POST', async () => {
    const key = 'return_0123456789abcdef0123456789abcdef';
    const pending: PendingBorrowReturn = {
      version: 1,
      userId: 'tech-1',
      borrowId: 'borrow-test-1',
      key,
      payload: {
        items: [{ borrowDetailId: 'detail-led', returnedQuantity: 1, condition: 'GOOD' }],
        notes: 'Test unresolved',
      },
      createdAt: Date.now(),
    };
    savePendingBorrowReturn(pending);

    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/borrow-requests') {
        return { data: { success: true, data: [mockBorrow] } };
      }
      if (path === `/borrow-requests/borrow-test-1/return-status/${key}`) {
        return {
          data: {
            success: true,
            data: {
              state: 'NOT_FOUND',
              requiresReconciliation: true,
            },
          },
        };
      }
      throw new Error(`Unexpected GET: ${path}`);
    });

    render(<BorrowReturnPage />);

    const reconcileBtn = await screen.findByRole('button', { name: /Đối soát giao dịch/i });
    fireEvent.click(reconcileBtn);

    await waitFor(() => {
      expect(screen.getByText(/Không tìm thấy khóa trên máy chủ/i)).toBeDefined();
    });

    // Guard MUST remain intact and no POST retry should be triggered!
    expect(readPendingBorrowReturn('tech-1', 'borrow-test-1')).not.toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('FE-RET-07: STUDENT role is prohibited from triggering return (fail closed)', async () => {
    mocks.role = 'STUDENT';

    render(<BorrowReturnPage />);

    await waitFor(() => {
      expect(screen.getByText(/Bạn đang đăng nhập với vai trò/i)).toBeDefined();
      expect(screen.getByText(/STUDENT/i)).toBeDefined();
    });

    // Return button must not exist or be disabled
    expect(screen.queryByRole('button', { name: /Nhận hoàn trả/i })).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('FE-RET-08: Page remount / reload restores pending return reconciliation banner', async () => {
    const key = 'return_0123456789abcdef0123456789abcdef';
    const pending: PendingBorrowReturn = {
      version: 1,
      userId: 'tech-1',
      borrowId: 'borrow-test-1',
      key,
      payload: {
        items: [{ borrowDetailId: 'detail-led', returnedQuantity: 1, condition: 'GOOD' }],
        notes: 'Pre-existing pending',
      },
      createdAt: Date.now(),
    };
    savePendingBorrowReturn(pending);

    render(<BorrowReturnPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/Phát hiện 1 giao dịch hoàn trả đang chờ đối soát/i)
      ).toBeDefined();
      expect(screen.getByText(key)).toBeDefined();
    });
  });

  it('FE-RET-09: Definitive API rejection (HTTP 400) allows operator to clear failed intent to correct input', async () => {
    mocks.post.mockRejectedValue({
      response: {
        status: 400,
        data: {
          success: false,
          message: 'Số lượng hoàn trả vượt quá số lượng còn nợ',
        },
      },
    });

    render(<BorrowReturnPage />);
    await openReturnModal();

    const ledInput = screen.getByLabelText('Số lượng trả LED-RGB');
    fireEvent.change(ledInput, { target: { value: '4' } });

    const submitBtn = screen.getByRole('button', { name: /Xác nhận hoàn trả/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Yêu cầu được giữ lại cho đến khi bạn xác minh và gỡ chặn/i)
      ).toBeDefined();
      expect(
        screen.getByRole('button', { name: /Xác nhận gỡ bỏ yêu cầu bị từ chối/i })
      ).toBeDefined();
    });

    // Click release rejected intent
    const releaseBtn = screen.getByRole('button', {
      name: /Xác nhận gỡ bỏ yêu cầu bị từ chối/i,
    });
    fireEvent.click(releaseBtn);

    await waitFor(() => {
      expect(screen.getByText(/Đã gỡ bỏ yêu cầu bị từ chối/i)).toBeDefined();
    });

    // Pending record is removed so operator can re-enter corrected quantity
    expect(readPendingBorrowReturn('tech-1', 'borrow-test-1')).toBeNull();
  });

  it('FE-RET-10: POST returns success=true but data=null keeps guard and enters reconciliation', async () => {
    mocks.post.mockResolvedValue({
      data: {
        success: true,
        data: null,
      },
    });

    render(<BorrowReturnPage />);
    await openReturnModal();

    const ledInput = screen.getByLabelText('Số lượng trả LED-RGB');
    fireEvent.change(ledInput, { target: { value: '2' } });

    const submitBtn = screen.getByRole('button', { name: /Xác nhận hoàn trả/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Máy chủ trả về kết quả không xác định hoặc biên nhận không hợp lệ/i)
      ).toBeDefined();
    });

    // Guard and pending intent MUST be preserved for operator reconciliation
    expect(readPendingBorrowReturn('tech-1', 'borrow-test-1')).not.toBeNull();
    expect(listDurableBorrowReturnGuards('tech-1').length).toBe(1);
  });

  it('FE-RET-11: POST returns valid returnNumber but mismatched borrowRequest.id keeps guard and rejects clear', async () => {
    mocks.post.mockResolvedValue({
      data: {
        success: true,
        data: {
          returnNumber: 'RT-20261104-999',
          borrowRequest: { id: 'other-borrow-request-id' },
        },
      },
    });

    render(<BorrowReturnPage />);
    await openReturnModal();

    const ledInput = screen.getByLabelText('Số lượng trả LED-RGB');
    fireEvent.change(ledInput, { target: { value: '2' } });

    const submitBtn = screen.getByRole('button', { name: /Xác nhận hoàn trả/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Máy chủ trả về kết quả không xác định hoặc biên nhận không hợp lệ/i)
      ).toBeDefined();
    });

    // Guard of current borrow MUST NOT be cleared
    expect(readPendingBorrowReturn('tech-1', 'borrow-test-1')).not.toBeNull();
    expect(listDurableBorrowReturnGuards('tech-1').length).toBe(1);
  });

  it('FE-RET-12: Unavailability of Web Crypto API shows user-friendly error and aborts POST fail-closed', async () => {
    const cryptoSpy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('Trình duyệt không hỗ trợ tạo khóa giao dịch an toàn');
    });

    render(<BorrowReturnPage />);
    await openReturnModal();

    const ledInput = screen.getByLabelText('Số lượng trả LED-RGB');
    fireEvent.change(ledInput, { target: { value: '1' } });

    const submitBtn = screen.getByRole('button', { name: /Xác nhận hoàn trả/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Trình duyệt không hỗ trợ tạo khóa giao dịch an toàn/i)
      ).toBeDefined();
    });

    // API POST MUST NOT be called and storage remains empty
    expect(mocks.post).not.toHaveBeenCalled();
    expect(readPendingBorrowReturn('tech-1', 'borrow-test-1')).toBeNull();

    cryptoSpy.mockRestore();
  });

  it('FE-RET-13: Concurrent tab submission for same borrowRequestId is locked out and fails closed', async () => {
    // Simulate lock contention where another tab holds the lock
    Object.defineProperty(window.navigator, 'locks', {
      value: {
        request: vi.fn(async (_name, _opts, cb) => {
          return await cb(null); // lock unavailable
        }),
      },
      configurable: true,
      writable: true,
    });

    render(<BorrowReturnPage />);
    await openReturnModal();

    const ledInput = screen.getByLabelText('Số lượng trả LED-RGB');
    fireEvent.change(ledInput, { target: { value: '2' } });

    const submitBtn = screen.getByRole('button', { name: /Xác nhận hoàn trả/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Phiếu mượn đang được xử lý trong một tab khác/i)
      ).toBeDefined();
    });

    // API POST MUST NOT be called!
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('FE-RET-14: Network error / 500 Internal Server Error retains guard and strictly disallows automatic retry', async () => {
    mocks.post.mockRejectedValue({
      response: {
        status: 500,
        data: { success: false, message: 'Database Connection Error' },
      },
    });

    render(<BorrowReturnPage />);
    await openReturnModal();

    const ledInput = screen.getByLabelText('Số lượng trả LED-RGB');
    fireEvent.change(ledInput, { target: { value: '2' } });

    const submitBtn = screen.getByRole('button', { name: /Xác nhận hoàn trả/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Mất kết nối hoặc phản hồi không rõ ràng từ máy chủ/i)
      ).toBeDefined();
    });

    expect(readPendingBorrowReturn('tech-1', 'borrow-test-1')).not.toBeNull();
    expect(listDurableBorrowReturnGuards('tech-1').length).toBe(1);
  });

  it('FE-RET-15: Rapid double-click while awaiting Web Lock acquisition is blocked synchronously', async () => {
    let releaseLockCall: () => void = () => {};
    const lockDelayPromise = new Promise<void>((resolve) => {
      releaseLockCall = resolve;
    });

    Object.defineProperty(window.navigator, 'locks', {
      value: {
        request: vi.fn(async (name, _opts, cb) => {
          await lockDelayPromise;
          return await cb({ name, mode: 'exclusive' });
        }),
      },
      configurable: true,
      writable: true,
    });

    render(<BorrowReturnPage />);
    await openReturnModal();

    const ledInput = screen.getByLabelText('Số lượng trả LED-RGB');
    fireEvent.change(ledInput, { target: { value: '1' } });

    const submitBtn = screen.getByRole('button', { name: /Xác nhận hoàn trả/i });
    // Click twice rapidly before lock resolves
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    // Release lock delay
    releaseLockCall();

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledTimes(1);
    });
  });

  it('FE-RET-16: Browser without Web Locks API fails closed with UI notification', async () => {
    Object.defineProperty(window.navigator, 'locks', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    render(<BorrowReturnPage />);
    await openReturnModal();

    const ledInput = screen.getByLabelText('Số lượng trả LED-RGB');
    fireEvent.change(ledInput, { target: { value: '1' } });

    const submitBtn = screen.getByRole('button', { name: /Xác nhận hoàn trả/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Trình duyệt không hỗ trợ Web Locks API/i)
      ).toBeDefined();
    });

    expect(mocks.post).not.toHaveBeenCalled();
    expect(readPendingBorrowReturn('tech-1', 'borrow-test-1')).toBeNull();
  });
});
