import { test, expect } from '@playwright/test';
import {
  setupModeANetworkGuard,
  injectAuthSession,
} from '../support/network-guard';
import { SYNTHETIC_USERS } from '../fixtures/synthetic-data';

test.describe('Phân hệ 4: Inventory Balances & Formulas (INV)', () => {
  test.beforeEach(async ({ page }) => {
    await setupModeANetworkGuard(page);
  });

  test('E2E-INV-01: Đối chiếu số liệu tồn kho và công thức tính Khả dụng (Available)', async ({
    page,
  }) => {
    await injectAuthSession(page, SYNTHETIC_USERS.manager);
    await page.goto('/inventory?tab=balances');

    // Wait for table to load
    const balanceTable = page.locator('table');
    await expect(balanceTable).toBeVisible();

    // Find row for Arduino Uno R3 (10000000-0000-4000-8000-000000000001)
    const arduinoRow = page.locator('tr:has-text("Arduino Uno R3")');
    await expect(arduinoRow).toBeVisible();

    // Verify stock values:
    // OnHand: 25, Reserved: 3, Quarantined: 2, Kit: 2, Borrowed: 5
    // Available = 25 - 3 - 2 - 2 = 18 (Borrowed is not subtracted)
    await expect(arduinoRow).toContainText('25');
    await expect(arduinoRow).toContainText('3');
    await expect(arduinoRow).toContainText('2');
    await expect(arduinoRow).toContainText('5');
    await expect(arduinoRow).toContainText('18');

    // Locate the available cell specifically
    const availableCell = arduinoRow.locator('td.text-emerald-700');
    await expect(availableCell).toContainText('18');
  });

  test('E2E-INV-02: Tìm kiếm số dư tồn kho với debounce 300ms và lọc bảng dữ liệu', async ({
    page,
  }) => {
    await injectAuthSession(page, SYNTHETIC_USERS.admin);
    await page.goto('/inventory?tab=balances');

    const searchInput = page.locator('input[placeholder*="Tìm kiếm theo mã, tên linh kiện"]');
    await expect(searchInput).toBeVisible();

    // Search for "Arduino"
    await searchInput.fill('Arduino');

    // Wait for debounce and network fulfillment
    await page.waitForTimeout(400);

    // Verify Arduino Uno is displayed
    const arduinoRow = page.locator('tr:has-text("Arduino Uno R3")');
    await expect(arduinoRow).toBeVisible();

    // Verify other items (ESP32) are filtered out
    const espRow = page.locator('tr:has-text("ESP32-WROOM")');
    await expect(espRow).toHaveCount(0);
  });
});
