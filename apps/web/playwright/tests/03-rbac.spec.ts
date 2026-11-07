import { test, expect } from '@playwright/test';
import {
  setupModeANetworkGuard,
  injectAuthSession,
  clearAuthSession,
} from '../support/network-guard';
import { SYNTHETIC_USERS } from '../fixtures/synthetic-data';

test.describe('Phân hệ 3: Role-Based Access Control (RBAC)', () => {
  test.beforeEach(async ({ page }) => {
    await setupModeANetworkGuard(page);
  });

  test('E2E-RBAC-01: Tài khoản STUDENT truy cập /transactions bị chặn màn hình 403 Forbidden', async ({
    page,
  }) => {
    let txRequestCount = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/stock-transactions')) {
        txRequestCount++;
      }
    });

    // Inject Student session
    await injectAuthSession(page, SYNTHETIC_USERS.student);
    await page.goto('/transactions');

    // RC5 renders a fail-closed role alert, not the retired 403-screen component.
    // Assert denied UX and zero transaction requests rather than an obsolete test ID.
    const forbiddenAlert = page.getByRole('alert');
    await expect(forbiddenAlert).toBeVisible();
    await expect(forbiddenAlert).toContainText('Không có quyền truy cập trang này.');

    // Verify 0 transaction queries dispatched by client
    expect(txRequestCount).toBe(0);
  });

  test('E2E-RBAC-02: Tài khoản TECHNICIAN truy cập /inventory xem cây vị trí ở chế độ Read-Only', async ({
    page,
  }) => {
    // Inject Technician session
    await injectAuthSession(page, SYNTHETIC_USERS.tech);
    await page.goto('/inventory?tab=locations');

    // Location tree header is visible
    const treeHeader = page.locator('h2:has-text("Cây Phân cấp Vị trí Kho")');
    await expect(treeHeader).toBeVisible();

    // Technician does not have permission to add locations (button hidden)
    const addLocBtn = page.locator('button:has-text("Thêm vị trí mới")');
    await expect(addLocBtn).toHaveCount(0);
  });

  test('E2E-RBAC-03: Khách vãng lai chưa đăng nhập bị chặn và chuyển hướng về /login', async ({
    page,
  }) => {
    // Ensure clean state (no token)
    await page.goto('/login');
    await clearAuthSession(page);

    // Attempt to navigate to protected routes
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/inventory');
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/transactions');
    await expect(page).toHaveURL(/\/login/);
  });
});
