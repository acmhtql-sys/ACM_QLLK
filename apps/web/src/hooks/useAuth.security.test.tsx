// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from './useAuth';

function AuthProbe() {
  const { isAuthenticated, token, user } = useAuth();
  return (
    <div>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="token">{token ?? 'none'}</span>
      <span data-testid="user">{user?.email ?? 'none'}</span>
    </div>
  );
}

describe('AuthProvider legacy offline-session cleanup', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('clears persisted mock credentials rather than treating them as authenticated', () => {
    localStorage.setItem('acm_token', 'mock-jwt-token-foundation-phase1');
    localStorage.setItem('acm_user', JSON.stringify({
      id: 'mock-user-id',
      email: 'legacy@example.test',
      fullName: 'Legacy Mock',
      role: 'ADMIN',
    }));

    render(<AuthProvider><AuthProbe /></AuthProvider>);

    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(screen.getByTestId('token').textContent).toBe('none');
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(localStorage.getItem('acm_token')).toBeNull();
    expect(localStorage.getItem('acm_user')).toBeNull();
  });
});
