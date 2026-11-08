import { test, expect } from '@playwright/test';
import {
  setupModeANetworkGuard,
  injectAuthSession,
  clearAuthSession,
} from '../support/network-guard';
import { SYNTHETIC_USERS } from '../fixtures/synthetic-data';

/** Browser-only responsive verification. Network guard blocks live APIs.
 * This does NOT assert native Android/iOS support or live stock mutations.
 */
test.describe('MOBILE Web — menu và phân quyền an toàn (mock only)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupModeANetworkGuard(page);
  });

  test('MOBILE-01: drawer hidden on phone, opens, respects STUDENT RBAC, Escape closes', async ({ page }) => {
    await injectAuthSession(page, SYNTHETIC_USERS.student);
    await page.goto('/dashboard');

    const open = page.getByRole('button', { name: 'Mở menu điều hướng' });
    const drawer = page.locator('#acm-mobile-sidebar');

    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await expect(drawer).toBeHidden();

    await open.click();
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('a[href="/borrow-return"]')).toHaveCount(1);
    await expect(drawer.locator('a[href="/items"]')).toHaveCount(1);
    await expect(drawer.locator('a[href="/transactions"]')).toHaveCount(0);
    await expect(drawer.locator('a[href="/users"]')).toHaveCount(0);
    await expect(drawer.locator('a[href="/audit-logs"]')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await expect(drawer).toBeHidden();
  });

  test('MOBILE-02: selecting an authorized link closes the phone drawer', async ({ page }) => {
    await injectAuthSession(page, SYNTHETIC_USERS.student);
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Mở menu điều hướng' }).click();
    const drawer = page.locator('#acm-mobile-sidebar');
    await expect(drawer).toBeVisible();
    await drawer.locator('a[href="/items"]').click();
    await expect(page).toHaveURL(/\/items$/);
    await expect(drawer).toBeHidden();
  });

  test('MOBILE-03: anonymous direct navigation to protected borrow page fails closed', async ({ page }) => {
    await page.goto('/login');
    await clearAuthSession(page);
    await page.goto('/borrow-return');
    await expect(page).toHaveURL(/\/login/);
  });

  test('MOBILE-04: closed drawer on desktop remains visible, hamburger hidden', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await injectAuthSession(page, SYNTHETIC_USERS.student);
    await page.goto('/dashboard');
    await expect(page.locator('#acm-mobile-sidebar')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mở menu điều hướng' })).toBeHidden();
  });
});
