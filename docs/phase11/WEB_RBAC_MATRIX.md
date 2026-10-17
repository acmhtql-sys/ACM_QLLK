# ACM Phase 11C — Ma trận phân quyền Web và API

**17/10/2026** · **Bản kiểm tra:** Draft PR #7 · **Trạng thái:** người dùng **đã xác nhận giữ ma trận MVP hiện tại (Reports/Audit Logs ADMIN-only)** trong cuộc trò chuyện ngày 17/10/2026; vẫn **chờ chữ ký/xác minh thẩm quyền Owner và UAT thủ công**.

| Chức năng | ADMIN | LAB_MANAGER | TECHNICIAN | STUDENT |
|---|---|---|---|---|
| Dashboard quản trị / Reports / Audit Logs | Xem | Không | Không | Không |
| Tra cứu Items, Categories, Kits | Xem | Xem | Xem | Xem |
| Inventory và Stock Transactions (đọc) | Xem | Xem | Xem | Không |
| Nhập, xuất, điều chỉnh kho | Có | Có | Không | Không |
| Tạo phiếu mượn, xem phiếu thuộc quyền | Có | Có | Có | Có |
| Phê duyệt / từ chối phiếu mượn | Có | Có | Không | Không |
| Bàn giao / tiếp nhận hoàn trả | Có | Có | Có | Không |
| Hủy phiếu APPROVED | Có | Có | Không | Không |
| Trang quản lý Users có chỉnh sửa | Có | Không | Không | Không |

**Đối chiếu API:** Backend cho LAB_MANAGER xem danh sách Users qua GET, nhưng Web hiện là trang quản trị có POST/PATCH chỉ ADMIN được làm. Để tránh hiện nút không được phép, Phase 11C ẩn toàn bộ trang Users với LAB_MANAGER. Nếu cần giao diện chỉ đọc, phải thiết kế riêng.

**Đã bổ sung trong UI:** STUDENT có nút hủy phiếu PENDING của chính mình (kiểm tra `borrowerId` ở Web; API vẫn kiểm tra quyền độc lập). Form phiếu mượn đã được điều chỉnh đọc đúng mảng `data` từ GET `/items`. Các mục Kits, Settings và danh mục cần QA đối chiếu nút chỉnh sửa so với quyền Backend.

**Đã có lựa chọn người dùng:** Reports và Audit Logs chỉ ADMIN; giữ mã hiện tại cho LAB_MANAGER, STUDENT, TECHNICIAN, không mở rộng quyền mới. **Còn kiểm chứng:** quyền đọc Users của LAB_MANAGER (Backend cho GET nhưng UI chưa có), các nút chỉnh sửa Kits/Categories/Settings, và chữ ký Owner đối với toàn bộ ma trận. Xem [phiếu xác nhận](./RBAC_APPROVAL_FORM.md).

## Kiểm chứng trình duyệt

Playwright chạy ở hai chế độ: **19/19 UI smoke bằng API mock** (Sidebar, route, hành động, trường hợp lỗi) và **4/4 login Web + Express API thật** trên PostgreSQL CI `acm_inventory_test` riêng, đều được xác minh trong [run 39017683030](https://github.com/acmhtql-sys/ACM_QLLK/actions/runs/39017683030). Cả hai chế độ **không sử dụng Cloud**, không thay thế QA thực hiện UAT thủ công. Lựa chọn giữ quyền hiện tại đã được ghi nhận, nhưng **chưa có chứng từ Owner ký duyệt**; xem [RBAC_APPROVAL_FORM.md](./RBAC_APPROVAL_FORM.md).
