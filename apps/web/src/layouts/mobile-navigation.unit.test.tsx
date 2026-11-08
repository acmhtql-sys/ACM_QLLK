import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

// Zero-network SSR rendering. Use real canAccessPage RBAC policy in the drawer.
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { fullName: 'Sinh viên thử nghiệm', role: 'STUDENT' },
    logout: () => undefined,
  }),
}));

const render = (children: React.ReactNode): string =>
  renderToStaticMarkup(<MemoryRouter>{children}</MemoryRouter>);

describe('L1 mobile navigation - safe responsive Web candidate', () => {
  it('labels the hamburger toggle and exposes collapsed state', () => {
    const html = render(<Header onOpenSidebar={() => undefined} isSidebarOpen={false} />);
    expect(html).toContain('aria-label="Mở menu điều hướng"');
    expect(html).toContain('aria-controls="acm-mobile-sidebar"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('exposes expanded navigation state to assistive technology', () => {
    const html = render(<Header onOpenSidebar={() => undefined} isSidebarOpen={true} />);
    expect(html).toContain('aria-expanded="true"');
  });

  it('keeps unauthorized transactions, users and audit out of student drawer', () => {
    const html = render(<Sidebar isOpen={true} onClose={() => undefined} />);
    expect(html).toContain('href="/borrow-return"');
    expect(html).toContain('href="/items"');
    expect(html).not.toContain('href="/transactions"');
    expect(html).not.toContain('href="/users"');
    expect(html).not.toContain('href="/audit-logs"');
  });

  it('labels close control and hides collapsed mobile drawer offscreen', () => {
    const html = render(<Sidebar isOpen={false} onClose={() => undefined} />);
    expect(html).toContain('aria-label="Đóng menu điều hướng"');
    expect(html).toContain('id="acm-mobile-sidebar"');
    expect(html).toContain('-translate-x-full invisible lg:visible');
    // Tailwind visibility:hidden removes offscreen mobile links from tab order.
    // lg:visible preserves normal desktop navigation when the drawer is closed.
  });
});
