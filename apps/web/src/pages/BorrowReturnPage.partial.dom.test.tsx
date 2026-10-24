// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BorrowReturnPage } from './BorrowReturnPage';

const mocks = vi.hoisted(() => ({
  role: 'TECHNICIAN',
  userId: 'tech-1',
  get: vi.fn(),
  post: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('../services/api', () => ({
  apiClient: { get: mocks.get, post: mocks.post },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: mocks.userId, role: mocks.role } }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({
    error: mocks.error,
    success: mocks.success,
    warning: mocks.warning,
    info: vi.fn(),
  }),
}));

const borrow = {
  id: 'borrow-test-1',
  borrowerId: 'student-1',
  borrowerName: 'Demo Student',
  requestNumber: 'BR-UAT-PARTIAL-01',
  status: 'HANDED_OVER',
  purpose: 'Kiem thu tra linh kien tung phan',
  expectedBorrowDate: '2026-10-22T00:00:00Z',
  expectedReturnDate: '2026-10-29T00:00:00Z',
  itemCount: 2,
  details: [
    {
      id: 'detail-led',
      itemId: 'item-led',
      item: {
        id: 'item-led',
        code: 'LED-5MM-RGB',
        name: 'LED RGB',
        unit: 'pcs',
      },
      quantity: 4,
      returnedQuantity: 1,
    },
    {
      id: 'detail-dht',
      itemId: 'item-dht',
      item: {
        id: 'item-dht',
        code: 'DHT22-AM2302',
        name: 'DHT22',
        unit: 'pcs',
      },
      quantity: 2,
      returnedQuantity: 1,
    },
  ],
};

async function openDialog() {
  fireEvent.click(
    await screen.findByRole('button', { name: 'Nhận hoàn trả' })
  );

  await screen.findByRole('button', { name: 'Xác nhận nhận trả' });
}

function submitReturn() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Xác nhận nhận trả' })
  );
}

describe('BorrowReturnPage partial return DOM', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    mocks.role = 'TECHNICIAN';
    mocks.userId = 'tech-1';

    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.error.mockReset();
    mocks.success.mockReset();
    mocks.warning.mockReset();

    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/borrow-requests') {
        return { data: { success: true, data: [borrow] } };
      }

      if (path === '/items') {
        return { data: { success: true, data: [] } };
      }

      throw new Error(`Unexpected GET: ${path}`);
    });

    mocks.post.mockResolvedValue({
      data: {
        success: true,
        data: { returnNumber: 'RT-UAT-MOCK', borrowRequest: { id: 'borrow-test-1' } },
      },
    });
  });

  afterEach(() => cleanup());

  it('DOM-01: defaults to zero and prevents empty return', async () => {
    render(<BorrowReturnPage />);
    await openDialog();

    const input = screen.getByRole('spinbutton', {
      name: 'Số lượng trả LED-5MM-RGB',
    }) as HTMLInputElement;

    expect(input.value).toBe('0');

    submitReturn();

    await waitFor(() => {
      expect(mocks.error).toHaveBeenCalled();
    });

    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('DOM-02: submits only the selected GOOD quantity', async () => {
    render(<BorrowReturnPage />);
    await openDialog();

    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'Số lượng trả LED-5MM-RGB',
      }),
      { target: { value: '2' } }
    );

    submitReturn();

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith(
        '/borrow-requests/borrow-test-1/return',
        {
          items: [{
            borrowDetailId: 'detail-led',
            returnedQuantity: 2,
            condition: 'GOOD',
            notes: undefined,
          }],
          notes: 'Hoàn trả linh kiện tại phòng Lab',
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            'Idempotency-Key': expect.stringMatching(/^return_[0-9a-f]{32}$/),
          }),
        })
      );
    });

    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('DOM-03: supports different conditions for different items', async () => {
    render(<BorrowReturnPage />);
    await openDialog();

    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'Số lượng trả LED-5MM-RGB',
      }),
      { target: { value: '1' } }
    );

    fireEvent.change(
      screen.getByRole('combobox', {
        name: 'Tình trạng trả LED-5MM-RGB',
      }),
      { target: { value: 'LOST' } }
    );

    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'Số lượng trả DHT22-AM2302',
      }),
      { target: { value: '1' } }
    );

    fireEvent.change(
      screen.getByRole('combobox', {
        name: 'Tình trạng trả DHT22-AM2302',
      }),
      { target: { value: 'DAMAGED' } }
    );

    submitReturn();

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith(
        '/borrow-requests/borrow-test-1/return',
        expect.objectContaining({
          items: [
            expect.objectContaining({
              borrowDetailId: 'detail-led',
              returnedQuantity: 1,
              condition: 'LOST',
            }),
            expect.objectContaining({
              borrowDetailId: 'detail-dht',
              returnedQuantity: 1,
              condition: 'DAMAGED',
            }),
          ],
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Idempotency-Key': expect.stringMatching(/^return_[0-9a-f]{32}$/),
          }),
        })
      );
    });
  });

  it('DOM-04: rejects quantity above remaining', async () => {
    render(<BorrowReturnPage />);
    await openDialog();

    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'Số lượng trả LED-5MM-RGB',
      }),
      { target: { value: '4' } }
    );

    submitReturn();

    await waitFor(() => {
      expect(mocks.error).toHaveBeenCalled();
    });

    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('DOM-05: STUDENT cannot access return action', async () => {
    mocks.role = 'STUDENT';

    render(<BorrowReturnPage />);

    await screen.findByText('BR-UAT-PARTIAL-01', { selector: 'td' });

    expect(
      screen.queryByRole('button', { name: 'Nhận hoàn trả' })
    ).toBeNull();

    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('DOM-06: blocks repeated submission while API is pending', async () => {
    let resolveRequest!: (value: unknown) => void;

    mocks.post.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    render(<BorrowReturnPage />);
    await openDialog();

    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'Số lượng trả LED-5MM-RGB',
      }),
      { target: { value: '1' } }
    );

    submitReturn();

    const button = screen.getByRole('button', {
      name: 'Đang ghi nhận...',
    }) as HTMLButtonElement;

    await waitFor(() => {
      expect(button.disabled).toBe(true);
      expect(mocks.post).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(button);

    expect(mocks.post).toHaveBeenCalledTimes(1);

    resolveRequest({
      data: {
        success: true,
        data: { returnNumber: 'RT-UAT-MOCK', borrowRequest: { id: 'borrow-test-1' } },
      },
    });

    await waitFor(() => {
      expect(mocks.success).toHaveBeenCalledTimes(1);
    });
  });

  it('DOM-07: keeps the return form after API failure', async () => {
    mocks.post.mockRejectedValueOnce({
      response: {
        data: {
          message: 'Giao dịch bị từ chối, cần tải lại dữ liệu',
        },
      },
    });

    render(<BorrowReturnPage />);
    await openDialog();

    const input = screen.getByRole('spinbutton', {
      name: 'Số lượng trả LED-5MM-RGB',
    }) as HTMLInputElement;

    fireEvent.change(input, {
      target: { value: '1' },
    });

    submitReturn();

    await waitFor(() => {
      expect(mocks.error).toHaveBeenCalledWith(
        'Giao dịch chưa xác nhận',
        'Giao dịch bị từ chối, cần tải lại dữ liệu'
      );
    });

    expect(input.value).toBe('1');
    expect(screen.getByRole('button', {
      name: 'Xác nhận nhận trả',
    })).toBeDefined();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('DOM-08: does not claim success when API success flag is false', async () => {
    mocks.post.mockResolvedValueOnce({
      data: { success: false },
    });

    render(<BorrowReturnPage />);
    await openDialog();

    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'Số lượng trả LED-5MM-RGB',
      }),
      { target: { value: '1' } }
    );

    submitReturn();

    await waitFor(() => {
      expect(mocks.error).toHaveBeenCalledWith(
        'Giao dịch chưa xác nhận',
        'API không xác nhận giao dịch hoàn trả thành công'
      );
    });

    expect(mocks.success).not.toHaveBeenCalled();
  });
  it('DOM-09: retries an API failure using the original Idempotency-Key', async () => {
    mocks.post.mockRejectedValueOnce({ response: { data: { message: 'Mạng gián đoạn' } } });

    render(<BorrowReturnPage />);
    await openDialog();
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Số lượng trả LED-5MM-RGB' }),
      { target: { value: '1' } }
    );
    submitReturn();

    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByRole('button', {
      name: 'Xác nhận nhận trả',
    }) as HTMLButtonElement).disabled).toBe(false));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    const firstKey = mocks.post.mock.calls[0][2]?.headers?.['Idempotency-Key'];
    expect(firstKey).toMatch(/^return_[0-9a-f]{32}$/);

    submitReturn();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    const secondKey = mocks.post.mock.calls[1][2]?.headers?.['Idempotency-Key'];
    expect(secondKey).toBe(firstKey);
    expect(mocks.post.mock.calls[1][1]).toEqual(mocks.post.mock.calls[0][1]);
  });

  it('DOM-10: confirmed success allows a new return key on next operation', async () => {
    render(<BorrowReturnPage />);
    await openDialog();
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Số lượng trả LED-5MM-RGB' }),
      { target: { value: '1' } }
    );
    submitReturn();
    await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('button', {
      name: 'Xác nhận nhận trả',
    })).toBeNull());
    const firstKey = mocks.post.mock.calls[0][2]?.headers?.['Idempotency-Key'];

    // Mock GET intentionally still returns the same fixture after refresh.
    await waitFor(() => expect((screen.getByRole('button', {
      name: 'Nhận hoàn trả',
    }) as HTMLButtonElement).disabled).toBe(false));
    await openDialog();
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Số lượng trả LED-5MM-RGB' }),
      { target: { value: '1' } }
    );
    submitReturn();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    const secondKey = mocks.post.mock.calls[1][2]?.headers?.['Idempotency-Key'];
    expect(secondKey).toMatch(/^return_[0-9a-f]{32}$/);
    expect(secondKey).not.toBe(firstKey);
  });

  it('DOM-11: freezes the form and preserves the original request after API uncertainty', async () => {
    mocks.post.mockRejectedValueOnce(new Error('network interrupted'));
    render(<BorrowReturnPage />);
    await openDialog();
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Số lượng trả LED-5MM-RGB' }),
      { target: { value: '1' } }
    );
    submitReturn();
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    const input = screen.getByRole('spinbutton', { name: 'Số lượng trả LED-5MM-RGB' }) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect((screen.getByPlaceholderText(/Ghi chú chi tiết/) as HTMLTextAreaElement).disabled).toBe(true);
    const firstPayload = mocks.post.mock.calls[0][1];
    const firstKey = mocks.post.mock.calls[0][2].headers['Idempotency-Key'];
    submitReturn();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    expect(mocks.post.mock.calls[1][1]).toEqual(firstPayload);
    expect(mocks.post.mock.calls[1][2].headers['Idempotency-Key']).toBe(firstKey);
  });

  it('DOM-12: after remount explicitly recovers the exact saved request and key', async () => {
    mocks.post.mockRejectedValueOnce(new Error('network interrupted'));
    const view = render(<BorrowReturnPage />);
    await openDialog();
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Số lượng trả LED-5MM-RGB' }),
      { target: { value: '1' } }
    );
    submitReturn();
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    const originalPayload = mocks.post.mock.calls[0][1];
    const originalKey = mocks.post.mock.calls[0][2].headers['Idempotency-Key'];
    view.unmount();
    render(<BorrowReturnPage />);
    const resume = await screen.findByRole('button', { name: /Gửi lại giao dịch đã lưu/ });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    fireEvent.click(resume);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    expect(mocks.post.mock.calls[1][1]).toEqual(originalPayload);
    expect(mocks.post.mock.calls[1][2].headers['Idempotency-Key']).toBe(originalKey);
  });

  it('DOM-13: does not discard pending on successful HTTP response with missing or mismatched receipt', async () => {
    mocks.post.mockResolvedValueOnce({ data: { success: true, data: { returnNumber: 'RT-INCOMPLETE' } } });
    render(<BorrowReturnPage />);
    await openDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Số lượng trả LED-5MM-RGB' }),
      { target: { value: '1' } });
    submitReturn();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(
      'Giao dịch chưa xác nhận', expect.stringContaining('Biên nhận hoàn trả thiếu mã giao dịch')));
    expect(window.sessionStorage.length).toBe(1);
    const key = mocks.post.mock.calls[0][2].headers['Idempotency-Key'];
    submitReturn();
    await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls[1][2].headers['Idempotency-Key']).toBe(key);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('DOM-14: structured HTTP 422 rejection requires explicit operator confirmation before clearing', async () => {
    mocks.post.mockRejectedValueOnce({
      response: { status: 422, data: { success: false, message: 'Dữ liệu hoàn trả không hợp lệ' } },
    });
    render(<BorrowReturnPage />);
    await openDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Số lượng trả LED-5MM-RGB' }),
      { target: { value: '1' } });
    submitReturn();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(
      'Yêu cầu hoàn trả bị từ chối', expect.stringContaining('HTTP 422')));
    expect(window.sessionStorage.length).toBe(1);
    const release = screen.getByRole('button', { name: /Xóa yêu cầu đã bị từ chối sau khi đối soát/ });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    try {
      fireEvent.click(release);
      expect(window.sessionStorage.length).toBe(1);
      fireEvent.click(release);
      await waitFor(() => expect(window.sessionStorage.length).toBe(0));
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(mocks.post).toHaveBeenCalledTimes(1);
    } finally { confirm.mockRestore(); }
  });

  it('DOM-15: HTTP 409 preserves pending and never offers confirmed-rejection release', async () => {
    mocks.post.mockRejectedValueOnce({
      response: { status: 409, data: { success: false, message: 'Yêu cầu đang xử lý' } },
    });
    render(<BorrowReturnPage />);
    await openDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Số lượng trả LED-5MM-RGB' }),
      { target: { value: '1' } });
    submitReturn();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(
      'Giao dịch chưa xác nhận', 'Yêu cầu đang xử lý'));
    expect(window.sessionStorage.length).toBe(1);
    expect(screen.queryByRole('button', { name: /Xóa yêu cầu đã bị từ chối sau khi đối soát/ })).toBeNull();
    const originalKey = mocks.post.mock.calls[0][2].headers['Idempotency-Key'];
    submitReturn();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    expect(mocks.post.mock.calls[1][2].headers['Idempotency-Key']).toBe(originalKey);
  });

  const lostGuardKey = `acm:borrow-return-guard:v1:tech-1:${borrow.id}`;
  const lostReturnKey = `return_${'a'.repeat(32)}`;
  const seedLostGuard = () => window.localStorage.setItem(lostGuardKey, JSON.stringify({
    version: 1, userId: 'tech-1', borrowId: borrow.id,
    key: lostReturnKey, createdAt: Date.now(),
  }));
  const mockStatus = (data: unknown, asError = false) => {
    const prior = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (url: string) => {
      if (url === `/borrow-requests/${borrow.id}/return-status/${lostReturnKey}`) {
        if (asError) throw { response: { status: 403, data: { success: false, message: 'Forbidden' } } };
        return { data };
      }
      return prior(url);
    });
  };

  it('DOM-16: lost-session guard is visible, verified GET receipt releases it without POST', async () => {
    seedLostGuard();
    mockStatus({ success: true, data: {
      state: 'COMPLETED', requiresReconciliation: false,
      receipt: { borrowRequestId: borrow.id, returnNumber: 'RT-RECOVERED' },
    } });
    render(<BorrowReturnPage />);
    const check = await screen.findByRole('button', { name: /Kiểm tra trạng thái giao dịch/ });
    expect(window.sessionStorage.length).toBe(0);
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(check);
    await waitFor(() => expect(window.localStorage.getItem(lostGuardKey)).toBeNull());
    expect(mocks.success).toHaveBeenCalledWith('Đã đối soát hoàn trả', expect.stringContaining('RT-RECOVERED'));
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('DOM-17: NOT_FOUND keeps the lost-session guard and blocks automatic release', async () => {
    seedLostGuard();
    mockStatus({ success: true, data: { state: 'NOT_FOUND', requiresReconciliation: true } });
    render(<BorrowReturnPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Kiểm tra trạng thái giao dịch/ }));
    await screen.findByText(/không phải bằng chứng chưa ghi kho/);
    expect(window.localStorage.getItem(lostGuardKey)).not.toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('DOM-18: mismatched COMPLETED receipt never clears a lost guard', async () => {
    seedLostGuard();
    mockStatus({ success: true, data: {
      state: 'COMPLETED', requiresReconciliation: false,
      receipt: { borrowRequestId: 'other-borrow', returnNumber: 'RT-WRONG' },
    } });
    render(<BorrowReturnPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Kiểm tra trạng thái giao dịch/ }));
    await screen.findByText(/Biên nhận hoàn trả không hợp lệ hoặc không khớp phiếu/);
    expect(window.localStorage.getItem(lostGuardKey)).not.toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('DOM-19: API 403 or network failure retains guard, never POSTs', async () => {
    seedLostGuard();
    mockStatus({}, true);
    render(<BorrowReturnPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Kiểm tra trạng thái giao dịch/ }));
    await screen.findByText(/Không thể tra cứu trạng thái: Forbidden/);
    expect(window.localStorage.getItem(lostGuardKey)).not.toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('DOM-20: another user durable guard does not appear on the active account', async () => {
    window.localStorage.setItem('acm:borrow-return-guard:v1:tech-2:borrow-other', JSON.stringify({
      version: 1, userId: 'tech-2', borrowId: 'borrow-other',
      key: lostReturnKey, createdAt: Date.now(),
    }));
    render(<BorrowReturnPage />);
    await screen.findByText('BR-UAT-PARTIAL-01', { selector: 'td' });
    expect(screen.queryByRole('button', { name: /Kiểm tra trạng thái giao dịch/ })).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });


  it('DOM-21: late K1 receipt cannot clear K2 guard started in another tab', async () => {
    let completePost: ((response: unknown) => void) | undefined;
    mocks.post.mockImplementationOnce(() => new Promise((resolve) => { completePost = resolve; }));
    render(<BorrowReturnPage />);
    await openDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Số lượng trả LED-5MM-RGB' }),
      { target: { value: '1' } });
    submitReturn();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const oldKey = mocks.post.mock.calls[0][2].headers['Idempotency-Key'];
    const durableKey = `acm:borrow-return-guard:v1:tech-1:${borrow.id}`;
    const sessionKey = `acm:borrow-return-pending:v1:tech-1:${borrow.id}`;
    const original = JSON.parse(window.localStorage.getItem(durableKey)!);
    expect(original.key).toBe(oldKey);
    // Tab B (separate sessionStorage, same localStorage) already reconciled K1
    // and has begun a new K2 transaction, while tab A is still awaiting its K1 receipt.
    const newerKey = `return_${'b'.repeat(32)}`;
    window.localStorage.setItem(durableKey, JSON.stringify({
      ...original, key: newerKey, createdAt: original.createdAt + 1,
    }));
    completePost!({ data: { success: true, data: {
      returnNumber: 'RT-OLD-K1', borrowRequest: { id: borrow.id },
    } } });
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(
      'Giao dịch chưa xác nhận', expect.stringContaining('Dấu chặn hoàn trả đã thay đổi')));
    expect(JSON.parse(window.localStorage.getItem(durableKey)!).key).toBe(newerKey);
    expect(JSON.parse(window.sessionStorage.getItem(sessionKey)!).key).toBe(oldKey);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });


  it('DOM-22: late successful POST for the old actor cannot clear saved key or toast on new actor', async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.post.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const view = render(<BorrowReturnPage />);
    await openDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Số lượng trả LED-5MM-RGB' }),
      { target: { value: '1' } });
    submitReturn();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const key = mocks.post.mock.calls[0][2].headers['Idempotency-Key'];
    mocks.userId = 'tech-2';
    view.rerender(<BorrowReturnPage />);
    await act(async () => {
      resolveOld({ data: { success: true, data: {
        returnNumber: 'RT-OLD-ACCOUNT', borrowRequest: { id: borrow.id },
      } } });
    });
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(`acm:borrow-return-pending:v1:tech-1:${borrow.id}`)).toContain(key);
    expect(window.localStorage.getItem(`acm:borrow-return-guard:v1:tech-1:${borrow.id}`)).toContain(key);
    expect(screen.queryByRole('button', { name: /Gửi lại giao dịch đã lưu/ })).toBeNull();
  });

  it('DOM-23: late failed POST for the old actor does not show an error or change new actor state', async () => {
    let rejectOld!: (reason: unknown) => void;
    mocks.post.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    const view = render(<BorrowReturnPage />);
    await openDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Số lượng trả LED-5MM-RGB' }),
      { target: { value: '1' } });
    submitReturn();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const key = mocks.post.mock.calls[0][2].headers['Idempotency-Key'];
    mocks.userId = 'tech-2';
    view.rerender(<BorrowReturnPage />);
    await act(async () => {
      rejectOld({ response: { status: 422, data: { success: false, message: 'Old actor rejected' } } });
    });
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(`acm:borrow-return-pending:v1:tech-1:${borrow.id}`)).toContain(key);
    expect(window.localStorage.getItem(`acm:borrow-return-guard:v1:tech-1:${borrow.id}`)).toContain(key);
    expect(screen.queryByRole('button', { name: /Xóa yêu cầu đã bị từ chối sau khi đối soát/ })).toBeNull();
  });
  it('DOM-24: a delayed GET from the old actor cannot overwrite the new actor borrow list', async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.get.mockImplementation((url: string) => {
      if (url === '/items') return Promise.resolve({ data: { success: true, data: [] } });
      if (url === '/borrow-requests') {
        if (mocks.userId === 'tech-1') {
          return new Promise((resolve) => { resolveOld = resolve; });
        }
        return Promise.resolve({ data: { success: true, data: [
          { ...borrow, requestNumber: 'BR-NEW-ACTOR' },
        ] } });
      }
      throw new Error(`Unexpected GET: ${url}`);
    });
    const view = render(<BorrowReturnPage />);
    mocks.userId = 'tech-2';
    view.rerender(<BorrowReturnPage />);
    await screen.findByText('BR-NEW-ACTOR', { selector: 'td' });
    await act(async () => {
      resolveOld({ data: { success: true, data: [borrow] } });
    });
    expect(screen.getByText('BR-NEW-ACTOR', { selector: 'td' })).toBeDefined();
    expect(screen.queryByText('BR-UAT-PARTIAL-01')).toBeNull();
  });

  it('DOM-25: shows verified server history without POST or clearing storage', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/borrow-requests') return { data: { success: true, data: [borrow] } };
      if (path === '/items') return { data: { success: true, data: [] } };
      if (path === `/borrow-requests/${borrow.id}`) return { data: { success: true, data: {
        id: borrow.id, returnTransactions: [{
          id: 'rt-1', returnNumber: 'RT-HISTORY-001', borrowRequestId: borrow.id,
          createdAt: '2026-10-24T08:00:00Z', receiver: {fullName: 'Kỹ thuật viên'},
          details: [{itemId: 'item-led', item: {code: 'LED-5MM-RGB'}, quantity: 1, condition: 'GOOD'}],
        }],
      } } };
      throw new Error(`Unexpected GET: ${path}`);
    });
    render(<BorrowReturnPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Đối soát lịch sử' }));
    expect(await screen.findByText('RT-HISTORY-001')).toBeDefined();
    expect(screen.getByText(/không chứng minh một yêu cầu/)).toBeDefined();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('DOM-26: mismatched borrow history is rejected, never authorizes a new POST', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/borrow-requests') return { data: { success: true, data: [borrow] } };
      if (path === '/items') return { data: { success: true, data: [] } };
      if (path === `/borrow-requests/${borrow.id}`) return { data: {success: true, data: {
        id: 'wrong-borrow', returnTransactions: [],
      } } };
      throw new Error(`Unexpected GET: ${path}`);
    });
    render(<BorrowReturnPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Đối soát lịch sử' }));
    expect(await screen.findByText(/Không xác minh được lịch sử:/)).toBeDefined();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('DOM-27: delayed history GET from old account never appears on new account', async () => {
    let resolveOld!: (v: unknown) => void;
    mocks.get.mockImplementation((path: string) => {
      if (path === '/borrow-requests') return Promise.resolve({ data: { success: true, data: [borrow] } });
      if (path === '/items') return Promise.resolve({ data: { success: true, data: [] } });
      if (path === `/borrow-requests/${borrow.id}`) return new Promise((resolve) => { resolveOld = resolve; });
      throw new Error(`Unexpected GET: ${path}`);
    });
    const view = render(<BorrowReturnPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Đối soát lịch sử' }));
    await screen.findByRole('dialog', { name: 'Đối soát lịch sử hoàn trả' });
    mocks.userId = 'tech-2';
    view.rerender(<BorrowReturnPage />);
    await act(async () => { resolveOld({ data: { success: true, data: {id: borrow.id, returnTransactions: [] } } }); });
    expect(screen.queryByRole('dialog', { name: 'Đối soát lịch sử hoàn trả' })).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });


});
