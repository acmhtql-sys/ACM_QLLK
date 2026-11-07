import { test, expect } from '@playwright/test';
import {
  setupModeANetworkGuard,
  injectAuthSession,
  registerCustomMockHandler,
  clearCustomMockHandlers,
  clearIsolationViolations,
  assertZeroUnexpectedViolations,
} from '../support/network-guard';
import { SYNTHETIC_USERS } from '../fixtures/synthetic-data';

test.describe('Phân hệ 6: Stock Transactions & Validation Guards (TX)', () => {
  test.beforeEach(async ({ page }) => {
    clearIsolationViolations();
    clearCustomMockHandlers();
    await setupModeANetworkGuard(page);
    await injectAuthSession(page, SYNTHETIC_USERS.admin);
  });

  test('E2E-TX-01: Bảng danh sách chứng từ kết xuất an toàn dòng lịch sử 0 dòng (itemCount=0, NaN=false)', async ({
    page,
  }) => {
    await page.goto('/transactions');

    // Wait for table to load
    const table = page.locator('[data-testid="stock-transactions-table"]');
    await expect(table).toBeVisible();

    // Locate row for historical fixture tx-orphan-9021
    const orphanRow = page.locator('[data-testid="tx-row-tx-orphan-9021"]');
    await expect(orphanRow).toBeVisible();

    // Verify itemCount displays 0 and totalQuantity displays 0
    await expect(orphanRow).toContainText('IMP-20261013-9021');
    await expect(orphanRow).toContainText('0');

    // Ensure no NaN displayed anywhere in table
    const tableContent = await table.textContent();
    expect(tableContent).not.toContain('NaN');
  });

  test('E2E-TX-02: Modal chi tiết chứng từ lịch sử hiển thị Empty State an toàn (orphan-empty-notice)', async ({
    page,
  }) => {
    await page.goto('/transactions');

    // Click "Xem chi tiết" for orphan tx-orphan-9021
    const detailBtn = page.locator('[data-testid="btn-view-detail-tx-orphan-9021"]');
    await expect(detailBtn).toBeVisible();
    await detailBtn.click();

    // Detail modal opens
    const modal = page.locator('[data-testid="transaction-detail-modal"]');
    await expect(modal).toBeVisible();

    // Verify empty orphan notice is displayed safely without crash
    const orphanNotice = page.locator('[data-testid="detail-empty-orphan-notice"]');
    await expect(orphanNotice).toBeVisible();
    await expect(orphanNotice).toContainText('Chứng từ lịch sử không có chi tiết dòng mặt hàng (0 dòng)');

    // Close modal
    await page.click('button[aria-label="Đóng"]');
    await expect(modal).not.toBeVisible();
  });

  test('E2E-TX-03: Modal chi tiết chứng từ thông thường nạp và hiển thị bảng dòng linh kiện', async ({
    page,
  }) => {
    await page.goto('/transactions');

    // Click "Xem chi tiết" for normal tx-mock-01
    const detailBtn = page.locator('[data-testid="btn-view-detail-tx-mock-01"]');
    await expect(detailBtn).toBeVisible();
    await detailBtn.click();

    // Detail modal opens
    const modal = page.locator('[data-testid="transaction-detail-modal"]');
    await expect(modal).toBeVisible();

    // Verify tx number and type
    await expect(page.locator('[data-testid="detail-tx-number"]')).toHaveText('IMP-20261013-0001');
    await expect(page.locator('[data-testid="detail-tx-type"]')).toHaveText('IMPORT');

    // Verify lines table rendered with details
    const linesTable = modal.locator('table');
    await expect(linesTable).toBeVisible();
    await expect(linesTable).toContainText('Arduino Uno R3');
    await expect(linesTable).toContainText('Module Wifi ESP32 Wroom-32');

    // Close modal
    await page.click('button[aria-label="Đóng"]');
    await expect(modal).not.toBeVisible();
  });

  test('E2E-TX-04: Form Nhập kho kiểm tra chặn trùng lặp mặt hàng tại cùng một vị trí', async ({
    page,
  }) => {
    await page.goto('/transactions');

    // Open Import Modal
    await page.click('[data-testid="btn-open-import"]');
    const modal = page.locator('[data-testid="stock-import-modal"]');
    await expect(modal).toBeVisible();

    // Line 0: Select Item 1 (ARD-UNO-R3) and Location 1 (BIN-A1-01)
    await page.selectOption('[data-testid="select-item-0"]', '10000000-0000-4000-8000-000000000001');
    await page.selectOption('[data-testid="select-location-0"]', '20000000-0000-4000-8000-000000000004');
    await page.fill('[data-testid="input-qty-0"]', '5');

    // Add Line 1
    await page.click('[data-testid="btn-add-line"]');

    // Line 1: Select same Item 1 (ARD-UNO-R3) and same Location 1 (BIN-A1-01)
    await page.selectOption('[data-testid="select-item-1"]', '10000000-0000-4000-8000-000000000001');
    await page.selectOption('[data-testid="select-location-1"]', '20000000-0000-4000-8000-000000000004');
    await page.fill('[data-testid="input-qty-1"]', '3');

    // Submit form
    await page.click('[data-testid="btn-review-import"]');

    // Expect client validation error to appear
    const errorContainer = page.locator('[data-testid="client-validation-errors"]');
    await expect(errorContainer).toBeVisible();
    await expect(errorContainer).toContainText('Trùng lặp linh kiện tại cùng vị trí đã chọn ở dòng trước');
  });

  test('E2E-TX-05: Form Xuất kho kiểm tra chặn số lượng xuất vượt quá tồn khả dụng (Available)', async ({
    page,
  }) => {
    await page.goto('/transactions');

    // Open Export Modal
    await page.click('[data-testid="btn-open-export"]');
    const modal = page.locator('[data-testid="stock-export-modal"]');
    await expect(modal).toBeVisible();

    // Fill valid export reason
    await page.fill('[data-testid="export-reason-input"]', 'Xuất linh kiện phục vụ đề tài nghiên cứu Robot');

    // Line 0: Select Item 1 (ARD-UNO-R3) with Available = 18 at 20000000-0000-4000-8000-000000000004
    await page.selectOption('[data-testid="select-item-0"]', '10000000-0000-4000-8000-000000000001');
    await page.selectOption('[data-testid="select-location-0"]', '20000000-0000-4000-8000-000000000004');

    // Enter quantity = 25 (exceeds available 18)
    await page.fill('[data-testid="input-qty-0"]', '25');

    // Submit form
    await page.click('[data-testid="btn-review-export"]');

    // Expect client validation error
    const errorContainer = page.locator('[data-testid="client-validation-errors"]');
    await expect(errorContainer).toBeVisible();
    await expect(errorContainer).toContainText('vượt quá tồn kho khả dụng');
  });

  test('E2E-TX-06: Form Điều chuyển kiểm tra chặn vị trí nguồn trùng vị trí đích', async ({
    page,
  }) => {
    await page.goto('/transactions');

    // Open Transfer Modal
    await page.click('[data-testid="btn-open-transfer"]');
    const modal = page.locator('[data-testid="stock-transfer-modal"]');
    await expect(modal).toBeVisible();

    // Fill valid reason
    await page.fill('[data-testid="transfer-reason-input"]', 'Điều chuyển linh kiện sang trạm thực hành 2');

    // Line 0: Select Item 1, Source = BIN-A1-01, Target = BIN-A1-01 (identical)
    await page.selectOption('[data-testid="select-item-0"]', '10000000-0000-4000-8000-000000000001');
    await page.selectOption('[data-testid="select-from-location-0"]', '20000000-0000-4000-8000-000000000004');
    await page.selectOption('[data-testid="select-to-location-0"]', '20000000-0000-4000-8000-000000000004');
    await page.fill('[data-testid="input-qty-0"]', '2');

    // Submit
    await page.click('[data-testid="btn-review-transfer"]');

    // Expect client validation error
    const errorContainer = page.locator('[data-testid="client-validation-errors"]');
    await expect(errorContainer).toBeVisible();
    await expect(errorContainer).toContainText('Vị trí nguồn và vị trí đích không được trùng nhau');
  });

  test('E2E-TX-07: Form Điều chuyển kiểm tra Transfer Aggregate Guard (tổng chuyển vượt tồn khả dụng nguồn)', async ({
    page,
  }) => {
    await page.goto('/transactions');

    // Open Transfer Modal
    await page.click('[data-testid="btn-open-transfer"]');
    const modal = page.locator('[data-testid="stock-transfer-modal"]');
    await expect(modal).toBeVisible();

    await page.fill('[data-testid="transfer-reason-input"]', 'Điều chuyển linh kiện sang hai vị trí khác nhau');

    // Line 0: Transfer 12 units of 10000000-0000-4000-8000-000000000001 from BIN-A1-01 to BIN-A1-02 (Available = 18)
    await page.selectOption('[data-testid="select-item-0"]', '10000000-0000-4000-8000-000000000001');
    await page.selectOption('[data-testid="select-from-location-0"]', '20000000-0000-4000-8000-000000000004');
    await page.selectOption('[data-testid="select-to-location-0"]', '20000000-0000-4000-8000-000000000005');
    await page.fill('[data-testid="input-qty-0"]', '12');

    // Add Line 1: Transfer 10 units of SAME 10000000-0000-4000-8000-000000000001 from SAME BIN-A1-01 to another location
    // Total transfer = 12 + 10 = 22 > 18 available!
    await page.click('[data-testid="btn-add-line"]');
    await page.selectOption('[data-testid="select-item-1"]', '10000000-0000-4000-8000-000000000001');
    await page.selectOption('[data-testid="select-from-location-1"]', '20000000-0000-4000-8000-000000000004');
    await page.selectOption('[data-testid="select-to-location-1"]', '20000000-0000-4000-8000-000000000003');
    await page.fill('[data-testid="input-qty-1"]', '10');

    // Submit
    await page.click('[data-testid="btn-review-transfer"]');

    // Expect Transfer Aggregate Guard error
    const errorContainer = page.locator('[data-testid="client-validation-errors"]');
    await expect(errorContainer).toBeVisible();
    await expect(errorContainer).toContainText('vượt quá tồn khả dụng');
  });

  test('E2E-TX-08: Form Kiểm kê kiểm tra Non-Zero Delta Rule (delta = 0 bị chặn)', async ({
    page,
  }) => {
    await page.goto('/transactions');

    // Open Adjustment Modal
    await page.click('[data-testid="btn-open-adjustment"]');
    const modal = page.locator('[data-testid="stock-adjustment-modal"]');
    await expect(modal).toBeVisible();

    // Fill valid reason
    await page.fill('[data-testid="adjustment-reason-input"]', 'Kiểm kê kho định kỳ cuối tuần');

    // Line 0: Select 10000000-0000-4000-8000-000000000001 at 20000000-0000-4000-8000-000000000004 (onHand = 25)
    await page.selectOption('[data-testid="select-item-0"]', '10000000-0000-4000-8000-000000000001');
    await page.selectOption('[data-testid="select-location-0"]', '20000000-0000-4000-8000-000000000004');

    // Enter actual onHand = 25 (delta = 0)
    await page.fill('[data-testid="input-actual-onhand-0"]', '25');

    // Submit
    await page.click('[data-testid="btn-submit-adjustment"]');

    // Expect Non-Zero Delta error
    const errorContainer = page.locator('[data-testid="client-validation-errors"]');
    await expect(errorContainer).toBeVisible();
    await expect(errorContainer).toContainText('delta = 0');
  });

  test('E2E-TX-09: Form Kiểm kê kiểm tra Committed Stock Guard (tồn thực tế < hàng cam kết bị chặn)', async ({
    page,
  }) => {
    await page.goto('/transactions');

    // Open Adjustment Modal
    await page.click('[data-testid="btn-open-adjustment"]');
    const modal = page.locator('[data-testid="stock-adjustment-modal"]');
    await expect(modal).toBeVisible();

    await page.fill('[data-testid="adjustment-reason-input"]', 'Kiểm kê xử lý chênh lệch tồn kho');

    // Line 0: Select 10000000-0000-4000-8000-000000000001 at 20000000-0000-4000-8000-000000000004
    // Committed = Reserved (3) + KitAllocated (2) + Quarantined (2) = 7
    await page.selectOption('[data-testid="select-item-0"]', '10000000-0000-4000-8000-000000000001');
    await page.selectOption('[data-testid="select-location-0"]', '20000000-0000-4000-8000-000000000004');

    // Enter actual onHand = 3 (less than committed 7)
    await page.fill('[data-testid="input-actual-onhand-0"]', '3');

    // Submit
    await page.click('[data-testid="btn-submit-adjustment"]');

    // Expect Committed Stock Guard error
    const errorContainer = page.locator('[data-testid="client-validation-errors"]');
    await expect(errorContainer).toBeVisible();
    await expect(errorContainer).toContainText('nhỏ hơn số lượng đã cam kết');
  });

  // --- POSITIVE FSM SUBMISSION TESTS (STEP 4B.4B+ ISOLATED MOCK ONLY) ---

  test('E2E-TX-10: HTTP 504 giữ nguyên Idempotency-Key, chỉ cho GET status, tuyệt đối không POST lần hai', async ({
    page,
  }) => {
    interface CapturedReq {
      method: string;
      url: string;
      idempotencyKey: string | null;
      authorization: string | null;
      body: any;
    }
    const capturedRequests: CapturedReq[] = [];

    // Register mock handler for /api/v1/stock-transactions/import
    registerCustomMockHandler('/api/v1/stock-transactions/import', async (route, req) => {
      if (req.method() === 'POST') {
        const captured: CapturedReq = {
          method: req.method(),
          url: req.url(),
          idempotencyKey: req.headers()['idempotency-key'] || null,
          authorization: req.headers()['authorization'] || null,
          body: req.postDataJSON(),
        };
        capturedRequests.push(captured);

        // Attempt 1: Simulate HTTP 504 Gateway Timeout
        if (capturedRequests.length === 1) {
          await route.fulfill({
            status: 504,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Gateway Timeout (504): Mạng bị gián đoạn' }),
          });
          return true;
        }

        // Attempt 2 (Retry): Return synthetic HTTP 201 Created
        if (capturedRequests.length === 2) {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: 'tx-syn-import-success-01',
                transactionNumber: 'IMP-20261013-0001',
                type: 'IMPORT',
                status: 'COMPLETED',
                notes: 'Nhập linh kiện thí nghiệm đợt 1',
                itemCount: 1,
                totalQuantity: 5,
              },
            }),
          });
          return true;
        }
      }
      return false;
    });

    // GET-only status lookup: a second stock POST is never authorized by a 504.
    let statusGetCount = 0;
    registerCustomMockHandler('/api/v1/stock-transactions/idempotency/', async (route, req) => {
      if (req.method() !== 'GET') return false;
      statusGetCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { status: 'IN_PROGRESS' },
        }),
      });
      return true;
    });

    await page.goto('/transactions');

    // 1. Open Import Modal
    await page.click('[data-testid="btn-open-import"]');
    const modal = page.locator('[data-testid="stock-import-modal"]');
    await expect(modal).toBeVisible();

    // Capture initial Idempotency-Key displayed on form
    const initialKeyInput = page.locator('[data-testid="idempotency-key-display"]');
    const initialKey = await initialKeyInput.inputValue();
    expect(initialKey).toBeTruthy();
    expect(initialKey.length).toBeGreaterThan(10);

    // Fill valid form inputs
    await page.fill('[data-testid="import-notes-input"]', 'Nhập linh kiện thí nghiệm đợt 1');
    await page.selectOption('[data-testid="select-item-0"]', '10000000-0000-4000-8000-000000000001');
    await page.selectOption('[data-testid="select-location-0"]', '20000000-0000-4000-8000-000000000004');
    await page.fill('[data-testid="input-qty-0"]', '5');
    await page.fill('[data-testid="input-cost-0"]', '10000');

    // 2. Submit Form
    await page.click('[data-testid="btn-review-import"]');
    await expect(page.locator('[data-testid="import-confirmation-step"]')).toBeVisible();
    await page.click('[data-testid="btn-confirm-submit-import"]');

    // 3. Confirm transition to AMBIGUOUS_OUTCOME upon HTTP 504
    const ambiguousBanner = page.locator('[data-testid="ambiguous-state-banner"]');
    await expect(ambiguousBanner).toBeVisible();
    await expect(ambiguousBanner).toContainText('KẾT QUẢ CHƯA XÁC NHẬN');

    const errorDetail = page.locator('[data-testid="ambiguous-error-detail"]');
    await expect(errorDetail).toBeVisible();
    await expect(errorDetail).toContainText('Gateway Timeout (504)');

    // 4. Verify inputs are strictly locked (disabled)
    await expect(page.locator('[data-testid="import-notes-input"]')).toBeDisabled();
    await expect(page.locator('[data-testid="select-item-0"]')).toBeDisabled();
    await expect(page.locator('[data-testid="select-location-0"]')).toBeDisabled();
    await expect(page.locator('[data-testid="input-qty-0"]')).toBeDisabled();
    await expect(page.locator('[data-testid="btn-confirm-submit-import"]')).toBeDisabled();

    // 5. Verify Idempotency-Key is preserved (NOT rotated)
    const currentKey = await initialKeyInput.inputValue();
    expect(currentKey).toBe(initialKey);

    // 6. Verify NO automatic retry (exactly 1 request was sent)
    expect(capturedRequests.length).toBe(1);
    expect(capturedRequests[0].idempotencyKey).toBe(initialKey);

    // 7. User can only query status via GET, never repeat the stock POST.
    const statusCheckBtn = page.locator('[data-testid="btn-retry-ambiguous"]');
    await expect(statusCheckBtn).toBeVisible();
    await statusCheckBtn.click();

    // Backend is still processing: stay ambiguous and preserve the original key.
    await expect(ambiguousBanner).toBeVisible();
    await expect(page.locator('[data-testid="ambiguous-error-detail"]')).toContainText('IN_PROGRESS');
    expect(statusGetCount).toBe(1);
    expect(capturedRequests).toHaveLength(1);
    expect(await initialKeyInput.inputValue()).toBe(initialKey);
    await expect(page.locator('[data-testid="btn-confirm-submit-import"]')).toBeDisabled();

    // No client-side reissue and no successful dismissal without server proof.
    await expect(modal).toBeVisible();
    assertZeroUnexpectedViolations();
  });

  test('E2E-TX-11: 409 PAYLOAD_MISMATCH khóa form và không cho phép client tự giải phóng đối soát', async ({
    page,
  }) => {
    let callCount = 0;
    let simulatedConflictType: 'PAYLOAD_MISMATCH' | 'IN_PROGRESS' = 'PAYLOAD_MISMATCH';

    registerCustomMockHandler('/api/v1/stock-transactions/import', async (route, req) => {
      if (req.method() === 'POST') {
        callCount++;
        if (simulatedConflictType === 'PAYLOAD_MISMATCH') {
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              message:
                'Phát hiện xung đột Idempotency: Cùng khóa Idempotency-Key nhưng nội dung yêu cầu (payload) đã bị thay đổi.',
            }),
          });
          return true;
        }
        if (simulatedConflictType === 'IN_PROGRESS') {
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              message:
                'Yêu cầu với Idempotency-Key này đang được xử lý trên máy chủ. Vui lòng chờ.',
            }),
          });
          return true;
        }
      }
      return false;
    });

    await page.goto('/transactions');

    // --- PHẦN A: 409 PAYLOAD MISMATCH -> RECONCILIATION_REQUIRED ---
    simulatedConflictType = 'PAYLOAD_MISMATCH';

    await page.click('[data-testid="btn-open-import"]');
    const modal = page.locator('[data-testid="stock-import-modal"]');
    await expect(modal).toBeVisible();

    const keyInput = page.locator('[data-testid="idempotency-key-display"]');
    const initialKey = await keyInput.inputValue();

    // Fill form and submit
    await page.fill('[data-testid="import-notes-input"]', 'Phiếu nhập đối soát xung đột');
    await page.selectOption('[data-testid="select-item-0"]', '10000000-0000-4000-8000-000000000002');
    await page.selectOption('[data-testid="select-location-0"]', '20000000-0000-4000-8000-000000000004');
    await page.fill('[data-testid="input-qty-0"]', '3');

    await page.click('[data-testid="btn-review-import"]');
    await expect(page.locator('[data-testid="import-confirmation-step"]')).toBeVisible();
    await page.click('[data-testid="btn-confirm-submit-import"]');

    // Confirm transition to RECONCILIATION_REQUIRED
    const reconcileBanner = page.locator('[data-testid="reconciliation-banner"]');
    await expect(reconcileBanner).toBeVisible();
    await expect(reconcileBanner).toContainText(
      'CẢNH BÁO BẮT BUỘC ĐỐI CHIẾU (RECONCILIATION REQUIRED)'
    );

    const errorDetail = page.locator('[data-testid="reconciliation-error-detail"]');
    await expect(errorDetail).toBeVisible();
    await expect(errorDetail).toContainText('Không được tái sử dụng khóa cho ý định nghiệp vụ mới');

    // Form submission must remain strictly disabled
    await expect(page.locator('[data-testid="btn-confirm-submit-import"]')).toBeDisabled();

    // Key must NOT be auto-rotated
    expect(await keyInput.inputValue()).toBe(initialKey);

    // Exactly 1 POST request dispatched (no auto retry)
    expect(callCount).toBe(1);

    // Attempt to resolve reconciliation with EMPTY note -> Rejected
    const resolveBtn = page.locator('[data-testid="btn-resolve-reconciliation"]');
    await resolveBtn.click();

    const errorMsg = page.locator('[data-testid="reconcile-error-msg"]');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText('đã bị vô hiệu hóa vì lý do an toàn');
    await expect(reconcileBanner).toBeVisible(); // Still in reconciliation state!

    // Attempt with note of length < 5 (e.g. "abc") -> Rejected
    await page.fill('[data-testid="input-reconcile-evidence"]', 'abc');
    await resolveBtn.click();
    await expect(errorMsg).toBeVisible();
    await expect(reconcileBanner).toBeVisible(); // Still in reconciliation state!

    // Even a short user-entered note cannot serve as backend authority.
    expect(callCount).toBe(1);
    await expect(page.locator('[data-testid="btn-confirm-submit-import"]')).toBeDisabled();
    assertZeroUnexpectedViolations();
  });

  test('E2E-TX-11B: 409 IN_PROGRESS remains ambiguous without duplicate POST', async ({ page }) => {
    let postCount = 0;
    registerCustomMockHandler('/api/v1/stock-transactions/import', async (route, req) => {
      if (req.method() !== 'POST') return false;
      postCount++;
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          message: 'Yêu cầu với Idempotency-Key này đang được xử lý trên máy chủ. Vui lòng chờ.',
        }),
      });
      return true;
    });
    await page.goto('/transactions');
    await page.click('[data-testid="btn-open-import"]');
    await page.fill('[data-testid="import-notes-input"]', 'Phiếu nhập đang xử lý concurrent');
    await page.selectOption('[data-testid="select-item-0"]', '10000000-0000-4000-8000-000000000001');
    await page.selectOption('[data-testid="select-location-0"]', '20000000-0000-4000-8000-000000000004');
    await page.fill('[data-testid="input-qty-0"]', '2');
    await page.click('[data-testid="btn-review-import"]');
    await expect(page.locator('[data-testid="import-confirmation-step"]')).toBeVisible();
    await page.click('[data-testid="btn-confirm-submit-import"]');

    await expect(page.locator('[data-testid="ambiguous-state-banner"]')).toBeVisible();
    await expect(page.locator('[data-testid="ambiguous-error-detail"]')).toContainText('đang được xử lý trên máy chủ');
    await expect(page.locator('[data-testid="import-error-banner"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="btn-confirm-submit-import"]')).toBeDisabled();
    expect(postCount).toBe(1);
    assertZeroUnexpectedViolations();
  });

  test('E2E-TX-12: Client evidence cannot unlock reconciliation or rotate Idempotency-Key', async ({
    page,
  }) => {
    // Client-provided evidence is not authoritative. The safe state must remain locked.
    // No real backend or database operation is performed in this browser test.
    registerCustomMockHandler('/api/v1/stock-transactions/import', async (route, req) => {
      if (req.method() === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message:
              'Phát hiện xung đột Idempotency: Cùng khóa Idempotency-Key nhưng nội dung yêu cầu đã bị thay đổi.',
          }),
        });
        return true;
      }
      return false;
    });

    await page.goto('/transactions');

    // 1. Open Import Modal
    await page.click('[data-testid="btn-open-import"]');
    const modal = page.locator('[data-testid="stock-import-modal"]');
    await expect(modal).toBeVisible();

    const keyInput = page.locator('[data-testid="idempotency-key-display"]');
    const oldKey = await keyInput.inputValue();

    // 2. Submit form to trigger 409 Conflict
    await page.fill('[data-testid="import-notes-input"]', 'Kiểm thử thoát đối soát');
    await page.selectOption('[data-testid="select-item-0"]', '10000000-0000-4000-8000-000000000003');
    await page.selectOption('[data-testid="select-location-0"]', '20000000-0000-4000-8000-000000000005');
    await page.fill('[data-testid="input-qty-0"]', '1');
    await page.click('[data-testid="btn-review-import"]');
    await expect(page.locator('[data-testid="import-confirmation-step"]')).toBeVisible();
    await page.click('[data-testid="btn-confirm-submit-import"]');

    // 3. Confirm in RECONCILIATION_REQUIRED
    const reconcileBanner = page.locator('[data-testid="reconciliation-banner"]');
    await expect(reconcileBanner).toBeVisible();

    // 4. Select radio: TRANSACTION_CONFIRMED_UNEXECUTED
    const radioUnexecuted = page.locator('[data-testid="radio-reconcile-unexecuted"]');
    await expect(radioUnexecuted).toBeChecked(); // Checked by default

    // 5. Input valid evidence note (>= 5 chars)
    await page.fill(
      '[data-testid="input-reconcile-evidence"]',
      'Đã kiểm tra log DB: Chưa có record chứng từ nào được ghi nhận'
    );

    // 6. Click "Xác nhận kết quả đối chiếu"
    await page.click('[data-testid="btn-resolve-reconciliation"]');

    // 7. Fail closed: do not trust unverified client-provided evidence.
    await expect(reconcileBanner).toBeVisible();
    await expect(page.locator('[data-testid="reconcile-error-msg"]')).toContainText('đã bị vô hiệu hóa vì lý do an toàn');
    expect(await keyInput.inputValue()).toBe(oldKey);
    await expect(page.locator('[data-testid="btn-confirm-submit-import"]')).toBeDisabled();
    await expect(page.locator('[data-testid="btn-review-import"]')).toBeDisabled();
    await expect(modal).toBeVisible();

    assertZeroUnexpectedViolations();
  });
});
