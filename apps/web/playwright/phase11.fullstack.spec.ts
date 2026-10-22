/**
 * Phase 11C: REAL local Web+API+PostgreSQL browser smoke, never Cloud.
 * CI bootstraps API against disposable acm_inventory_test. Login exercises
 * real API session issuance. No seed/reset/migration is performed here.
 */
import { test, expect } from '@playwright/test';

test.describe('Phase11C localhost full stack role login', () => {
  test.skip(process.env.ACM_UI_LIVE !== 'true', 'requires isolated CI PostgreSQL + local API');
  for (const [role, email] of [
    ['ADMIN', 'admin@acm.local'],
    ['LAB_MANAGER', 'manager@acm.local'],
    ['TECHNICIAN', 'tech@acm.local'],
    ['STUDENT', 'student@acm.local'],
  ] as const) {
    test(role + ' can login with seeded test account; Web and API enforce matching role', async ({ page }) => {
      await page.goto('/login');
      await page.getByPlaceholder('ten.nguoidung@acm.local').fill(email);
      await page.getByPlaceholder('••••••••••••').fill('ACM@dev2026!');
      await page.getByRole('button', { name: 'Đăng nhập vào hệ thống' }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      const token = await page.evaluate(() => localStorage.getItem('acm_token'));
      const user = await page.evaluate(() => JSON.parse(localStorage.getItem('acm_user') || '{}'));
      expect(token).toBeTruthy();
      expect(user.role).toBe(role);
      await page.goto('/borrow-return');
      await expect(page.getByText('Quản lý Mượn & Trả (Borrow & Return)')).toBeVisible();
      const read = await page.request.get('http://127.0.0.1:5000/api/v1/reports/summary', {
        headers: { Authorization: 'Bearer ' + token },
      });
      expect(read.status()).toBe(role === 'ADMIN' ? 200 : 403);
      if (role === 'STUDENT') {
        await page.getByRole('button', { name: 'Tạo phiếu mượn mới' }).first().click();
        await expect(page.getByRole('option', { name: /ARD-UNO-R3/ })).toBeAttached();
      }
      if (role !== 'ADMIN') {
        await page.goto('/reports');
        await expect(page.getByRole('alert')).toContainText('Không có quyền truy cập trang này');
      }
    });
  }
});
