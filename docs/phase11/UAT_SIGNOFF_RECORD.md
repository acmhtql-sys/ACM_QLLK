# Phase 11D — Mẫu biên bản nghiệm thu UAT thủ công

**Dự án:** ACM – Hệ thống Quản lý Linh kiện & Thiết bị  
**Phạm vi:** Chỉ hoàn trả đúng kho nguồn (MVP)  
**Kết quả hiện tại:** **CHƯA THỰC HIỆN UAT THỦ CÔNG — NO-GO**.

## 1. Thông tin đợt chạy

| Trường | Giá trị |
|---|---|
| Đợt nghiệm thu / ngày | Chưa điền |
| Môi trường | PostgreSQL `acm_inventory_test` local, **chưa xác nhận bởi QA** |
| DB host và identity query (không secret) | Chưa điền |
| Commit của build / PR | Chưa điền (mốc CI tham chiếu: `50a8d7c`, PR #7) |
| GitHub Actions run kiểm tra trên commit đó | Chưa điền |
| QA / đại diện người dùng thực tế | Chưa chỉ định |
| Người vận hành test DB / người review độc lập | Chưa chỉ định |
| Browser + OS + viewport desktop/mobile | Chưa điền |
| Fixture prefix / mã phiếu / mã vị trí | Chưa điền |
| Thời gian bắt đầu / kết thúc | Chưa điền |
| Xác nhận đã dọn fixture, khôi phục số dư test | Chưa điền |

## 2. Nhật ký từng kịch bản

Tham chiếu [hướng dẫn thao tác](./MANUAL_UAT_RUNBOOK.md) và [18 UAT-ID nghiệp vụ](./UAT_CHECKLIST.md). Từng dòng phải do người thực sự chạy điền, không sao chép PASS của CI sang.

| Test ID | Vai trò | Kết quả thực tế / số dư trước-sau | Evidence ID/link đã làm sạch | Kết quả | Bug/owner |
|---|---|---|---|---|---|
| WEB-01..WEB-16 | — | Chưa chạy | — | **NOT RUN** | — |
| UAT-01..UAT-18 | — | Chưa chạy | — | **NOT RUN** | — |

**Giá trị hợp lệ:** `PASS`, `FAIL`, `BLOCKED`, `NOT RUN`, `API-ONLY`. Không dùng `PASS` cho kịch bản chỉ có mock/chỉ có API khi yêu cầu chứng minh UI.

## 3. Defect log / ngoại lệ

| Issue | Mức P0/P1/P2/P3 | Tình huống | Trạng thái & commit sửa | Người xác nhận chạy lại | Quyết định Owner |
|---|---|---|---|---|---|
| Chưa có | — | — | — | — | — |

- **Gate dữ liệu:** [ ] Không có sai lệch OnHand/Reserved/Borrowed/Quarantined/Available; mọi return đúng kho nguồn.
- **Gate phân quyền:** [ ] Lựa chọn người dùng ngày 17/10/2026 đã ghi nhận (giữ phân quyền hiện tại, Reports/Audit Logs ADMIN-only); [phiếu RBAC](./RBAC_APPROVAL_FORM.md) **vẫn cần Owner xác minh/ký duyệt**.
- **Gate chức năng:** [ ] Tất cả case MVP có manual evidence / ngoại lệ được ký; không P0/P1 đang mở.
- **Gate bảo mật giao diện:** [ ] Không lộ mật khẩu, JWT hoặc thông tin người khác trong HTML/ảnh/console/response.
- **Gate môi trường:** [ ] Đã xác minh DB test local và không thay đổi Cloud.
- **Gate kỹ thuật:** [ ] CI xanh trên đúng commit xét nghiệm thu, PR review độc lập.

## 4. Ý kiến ký xác nhận (do người có thẩm quyền tự điền)

- **QA lead:** ______  Kết quả: □ PASS □ FAIL □ BLOCKED · Ngày ______ · Link ký ______
- **Đại diện nghiệp vụ/Owner:** ______  Kết quả: □ APPROVED □ REJECTED □ PENDING · Ngày ______ · Link ký ______
- **Bảo mật / vận hành:** ______  Kết quả: □ APPROVED □ REJECTED □ PENDING · Ngày ______ · Link ký ______
- **Release decision:** **NO-GO (mặc định)** · Thay đổi trạng thái chỉ khi đáp ứng đầy đủ gates và có phê duyệt rõ ràng.

**Kể cả khi UAT manual PASS, merge `main`, Supabase migrations, Render/Vercel deployment và Production release cần phê duyệt riêng, không được tự động suy ra từ biểu mẫu này.**
