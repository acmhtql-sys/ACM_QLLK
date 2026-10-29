/**
 * Phase 11C browser UI role smoke: local Vite preview + intercepted API only.
 * Fake user claims validate UX, not identity or API authorization.
 */
import { expect, test, type Page } from '@playwright/test';

type Role = 'ADMIN' | 'LAB_MANAGER' | 'TECHNICIAN' | 'STUDENT';
const rows = [
  { id: '00000000-0000-4000-8000-000000000011', requestNumber: 'UAT-BR-PENDING',
    borrowerId: '00000000-0000-4000-8000-000000000101', borrowerName: 'Sinh viên Test',
    status: 'PENDING', purpose: 'Thực hành robot', expectedBorrowDate: '2026-10-17',
    expectedReturnDate: '2026-10-24', itemCount: 1, details: [] },
  { id: '00000000-0000-4000-8000-000000000012', requestNumber: 'UAT-BR-APPROVED',
    borrowerId: '00000000-0000-4000-8000-000000000101', borrowerName: 'Sinh viên Test',
    status: 'APPROVED', purpose: 'Thực hành robot', expectedBorrowDate: '2026-10-17',
    expectedReturnDate: '2026-10-24', itemCount: 1, details: [] },
  { id: '00000000-0000-4000-8000-000000000013', requestNumber: 'UAT-BR-HANDED',
    borrowerId: '00000000-0000-4000-8000-000000000101', borrowerName: 'Sinh viên Test',
    status: 'HANDED_OVER', purpose: 'Thực hành robot', expectedBorrowDate: '2026-10-17',
    expectedReturnDate: '2026-10-24', itemCount: 1, details: [] },
];

async function mockApi(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
      'access-control-allow-headers': 'Authorization, Content-Type',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers, body: '' });
      return;
    }
    const data = path.endsWith('/borrow-requests') ? rows
      : path.endsWith('/items') ? [{ id: '00000000-0000-4000-8000-000000000201', code: 'UI-TEST-ITEM', name: 'Linh kiện UAT', unit: 'pcs', available: 10 }] : path.endsWith('/users') ? { items: [] } : [];
    await route.fulfill({ status: 200, headers, contentType: 'application/json',
      body: JSON.stringify({ success: true, data,
        meta: { totalItems: 0, page: 1, totalPages: 1 } }) });
  });
}

async function signInFixture(page: Page, role: Role, path = '/borrow-return') {
  await page.addInitScript((value: Role) => {
    localStorage.setItem('acm_token', 'ui-only-fake-token');
    localStorage.setItem('acm_user', JSON.stringify({
      id: value === 'STUDENT' ? '00000000-0000-4000-8000-000000000101'
        : '00000000-0000-4000-8000-000000000102',
      email: value.toLowerCase() + '@acm.local', fullName: 'Fixture user', role: value,
    }));
  }, role);
  await mockApi(page);
  await page.goto(path);
}

test('production preview login has no prefilled demo secrets or demo account chooser', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByPlaceholder('ten.nguoidung@acm.local')).toHaveValue('');
  await expect(page.getByPlaceholder('••••••••••••')).toHaveValue('');
  await expect(page.getByText('Tài khoản mẫu theo vai trò (Click để chọn nhanh)')).toHaveCount(0);
});

test('Unauthenticated direct URL redirects to login', async ({ page }) => {
  await mockApi(page);
  await page.goto('/users');
  await expect(page).toHaveURL(/\/login$/);
});

for (const role of ['ADMIN','LAB_MANAGER','TECHNICIAN','STUDENT'] as const) {
  test(role + ' sees expected sidebar and borrow controls', async ({ page }) => {
    await signInFixture(page, role);
    // Desktop table and mobile card both render the same ID; target its desktop cell.
    await expect(page.getByRole('cell', { name: 'UAT-BR-PENDING', exact: true })).toBeVisible();
    const menu = page.locator('aside');
    for (const [name, allowed] of [
      [/Báo cáo & Thống kê/, role === 'ADMIN'],
      [/Nhật ký kiểm toán/, role === 'ADMIN'],
      [/Người dùng \(Users\)/, role === 'ADMIN'],
      [/Kho & Tồn kho/, role !== 'STUDENT'],
      [/Giao dịch kho/, role !== 'STUDENT'],
    ] as const) {
      if (allowed) await expect(menu.getByRole('link',{name})).toBeVisible();
      else await expect(menu.getByRole('link',{name})).toHaveCount(0);
    }
    const manager = role === 'ADMIN' || role === 'LAB_MANAGER';
    const handler = role !== 'STUDENT';
    const approve = page.getByRole('button',{name:'Duyệt',exact:true});
    const handover = page.getByRole('button',{name:'Bàn giao kho'});
    const receive = page.getByRole('button',{name:'Nhận hoàn trả'});
    if (manager) await expect(approve).toBeVisible();
    else await expect(approve).toHaveCount(0);
    if (handler) {
      await expect(handover).toBeVisible();
      await expect(receive).toBeVisible();
    } else {
      await expect(handover).toHaveCount(0);
      await expect(receive).toHaveCount(0);
    }
    if (manager) await expect(page.getByRole('button',{name:'Hủy phiếu',exact:true})).toHaveCount(1);
    else await expect(page.getByRole('button',{name:'Hủy phiếu',exact:true})).toHaveCount(0);
    if (role === 'STUDENT') {
      await expect(page.getByRole('button',{name:'Hủy phiếu của tôi'})).toHaveCount(1);
    } else {
      await expect(page.getByRole('button',{name:'Hủy phiếu của tôi'})).toHaveCount(0);
    }
  });
}
for (const role of ['LAB_MANAGER','TECHNICIAN','STUDENT'] as const) {
  for (const path of ['/users','/reports','/audit-logs']) {
    test(role + ' direct navigation to ' + path + ' denies access', async ({ page }) => {
      await signInFixture(page, role, path);
      await expect(page.getByRole('alert')).toContainText('Không có quyền truy cập trang này');
    });
  }
}
test('ADMIN opens Reports, Users and Audit Logs via direct routes', async ({ page }) => {
  await signInFixture(page, 'ADMIN', '/reports');
  await expect(page.getByText(/Báo cáo & Thống kê Vận hành/)).toBeVisible();
  await page.goto('/users');
  await expect(page.getByText(/Quản trị Người dùng/)).toBeVisible();
  await page.goto('/audit-logs');
  await expect(page.getByText(/Nhật ký Hoạt động & Kiểm toán/)).toBeVisible();
});
test('STUDENT dashboard does not request restricted reports or audit logs', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', req => {
    if (/\/api\/v1\/(reports|audit-logs)/.test(req.url())) requests.push(req.url());
  });
  await signInFixture(page, 'STUDENT', '/dashboard');
  await expect(page.getByText(/Số liệu Dashboard quản trị và Audit Log chỉ dành cho ADMIN/)).toBeVisible();
  expect(requests).toHaveLength(0);
});

test('STUDENT borrow creation modal loads item list from real API data-array contract', async ({ page }) => {
  await signInFixture(page, 'STUDENT');
  await page.getByRole('button', { name: 'Tạo phiếu mượn mới' }).first().click();
  const modal = page.getByText('Đăng ký Phiếu mượn Linh kiện mới');
  await expect(modal).toBeVisible();
  await expect(page.getByRole('option', { name: /UI-TEST-ITEM/ })).toBeAttached();
});

test('ADMIN dashboard shows a real error rather than fabricated KPIs when API rejects report', async ({ page }) => {
  await signInFixture(page, 'ADMIN', '/dashboard');
  // API fixture above deliberately supplies invalid summary data to exercise error UX.
  await expect(page.getByRole('alert')).toContainText('Không thể tải Dashboard từ máy chủ');
  await expect(page.getByText('570')).toHaveCount(0);
});
