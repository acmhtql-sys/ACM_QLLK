// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LoginPage } from './LoginPage';

const { postMock, loginMock, navigateMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  loginMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../services/api', () => ({
  apiClient: { post: postMock },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ login: loginMock }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

function enterCredentials() {
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'tester@example.test' },
  });
  const passwordInput = document.querySelector('input[type="password"]');
  if (!passwordInput) throw new Error('Password field not found');
  fireEvent.change(passwordInput, { target: { value: 'a-test-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập vào hệ thống' }));
}

describe('LoginPage fail-closed authentication', () => {
  beforeEach(() => {
    cleanup();
    vi.resetAllMocks();
    localStorage.clear();
  });

  it('never creates a mock session when the API is unavailable', async () => {
    postMock.mockRejectedValue(new Error('Network Error'));

    render(<LoginPage />);
    enterCredentials();

    expect(await screen.findByText('Không thể kết nối máy chủ xác thực. Vui lòng thử lại sau.')).toBeTruthy();
    expect(postMock).toHaveBeenCalledWith('/auth/login', {
      email: 'tester@example.test',
      password: 'a-test-password',
    });
    expect(loginMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(localStorage.getItem('acm_token')).toBeNull();
  });

  it('fails closed on slow API timeout without creating a session', async () => {
    postMock.mockRejectedValue({ code: 'ECONNABORTED' });

    render(<LoginPage />);
    enterCredentials();

    expect(await screen.findByText('Máy chủ phản hồi quá chậm (có thể đang khởi động). Vui lòng thử lại sau.')).toBeTruthy();
    expect(loginMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('creates an authenticated session only after an API success response', async () => {
    const user = { id: 'synthetic-user-id', email: 'tester@example.test', fullName: 'Test User', role: 'STUDENT' };
    postMock.mockResolvedValue({ data: { success: true, data: { token: 'synthetic-api-token', user } } });

    render(<LoginPage />);
    enterCredentials();

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('synthetic-api-token', user);
      expect(navigateMock).toHaveBeenCalledWith('/dashboard');
    });
  });
});
