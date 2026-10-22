// @vitest-environment jsdom
import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AuditLogsPage } from './AuditLogsPage';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../services/api', () => ({
  apiClient: { get: mocks.get },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { role: 'ADMIN' },
  }),
}));

const records = [
  {
    id: 'log-1',
    action: 'CREATE',
    entity: 'BorrowRequest',
    entityId: 'request-1',
    createdAt: '2026-10-22T09:00:00.000Z',
    user: {
      id: 'user-1',
      fullName: 'Demo Student',
      email: 'student@acm.local',
      role: 'STUDENT',
    },
    oldValue: null,
    newValue: { itemCount: 1 },
    ipAddress: '127.0.0.1',
    userAgent: 'Web Client',
  },
  {
    id: 'log-2',
    action: 'CREATE',
    entity: 'BorrowRequest',
    entityId: 'request-2',
    createdAt: '2026-10-22T09:01:00.000Z',
    user: null,
    oldValue: null,
    newValue: { itemCount: 2 },
    ipAddress: null,
    userAgent: null,
  },
  {
    id: 'log-3',
    action: 'RETURN',
    entity: 'BorrowRequest',
    entityId: 'request-1',
    createdAt: '2026-10-22T09:02:00.000Z',
    user: null,
    oldValue: null,
    newValue: { returned: 1 },
    ipAddress: null,
    userAgent: null,
  },
];

describe('Audit Logs frontend regression', () => {
  beforeEach(() => {
    mocks.get.mockReset();

    mocks.get.mockImplementation(
      async (_path: string, options?: {
        params?: { action?: string; entity?: string }
      }) => {
        const params = options?.params;

        const filtered = records.filter((record) =>
          (!params?.action || record.action === params.action) &&
          (!params?.entity || record.entity === params.entity)
        );

        return {
          data: {
            success: true,
            data: {
              items: filtered,
              meta: {
                page: 1,
                limit: 15,
                totalItems: filtered.length,
                totalPages: 1,
                hasNextPage: false,
                hasPrevPage: false,
              },
            },
          },
        };
      }
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('reads data.items and data.meta correctly', async () => {
    render(<AuditLogsPage />);

    await waitFor(() => {
      expect(
        within(screen.getByRole('table')).getAllByRole('row')
      ).toHaveLength(4);
    });

    expect(screen.getByText(/Tổng cộng/).textContent)
      .toMatch(/Tổng cộng\s+3\s+bản ghi/);
  });

  it('filters CREATE using the actual backend action code', async () => {
    render(<AuditLogsPage />);

    await waitFor(() => {
      expect(
        within(screen.getByRole('table')).getAllByRole('row')
      ).toHaveLength(4);
    });

    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'CREATE' },
    });

    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalledWith(
        '/audit-logs',
        { params: { page: 1, limit: 15, action: 'CREATE' } }
      );

      expect(
        within(screen.getByRole('table')).getAllByRole('row')
      ).toHaveLength(3);
    });
  });

  it('filters RETURN using the actual backend action code', async () => {
    render(<AuditLogsPage />);

    await waitFor(() => {
      expect(
        within(screen.getByRole('table')).getAllByRole('row')
      ).toHaveLength(4);
    });

    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'RETURN' },
    });

    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalledWith(
        '/audit-logs',
        { params: { page: 1, limit: 15, action: 'RETURN' } }
      );

      expect(
        within(screen.getByRole('table')).getAllByRole('row')
      ).toHaveLength(2);
    });
  });

  it('filters BorrowRequest using the actual entity code', async () => {
    render(<AuditLogsPage />);

    await waitFor(() => {
      expect(
        within(screen.getByRole('table')).getAllByRole('row')
      ).toHaveLength(4);
    });

    fireEvent.change(screen.getAllByRole('combobox')[1], {
      target: { value: 'BorrowRequest' },
    });

    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalledWith(
        '/audit-logs',
        { params: { page: 1, limit: 15, entity: 'BorrowRequest' } }
      );
    });
  });
});