# ACM Phase 11C — Ma trận phân quyền Web và API

**17/10/2026** · **Bản kiểm tra:** Draft PR #7 · **Trạng thái:** ma trận kỹ thuật đề xuất, CHỜ CHỦ NGHIỆP VỤ PHÊ DUYỆT.

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

**Cần xác nhận:** Chính sách Reports và Audit Logs ADMIN-only, quyền xem danh sách Users của LAB_MANAGER, phạm vi tự hủy phiếu STUDENT, và các quyền chỉnh sửa của TECHNICIAN.

## Kiểm chứng trình duyệt

Playwright chạy ở hai chế độ: **19/19 UI smoke bằng API mock** (Sidebar, route, hành động, trường hợp lỗi) và **4/4 login Web + Express API thật** trên PostgreSQL CI `acm_inventory_test` riêng, đều được xác minh trong [run 39017683030](https://github.com/acmhtql-sys/ACM_QLLK/actions/runs/39017683030). Cả hai chế độ **không sử dụng Cloud**, không thay thế QA thực hiện UAT thủ công. Dự án vẫn chưa có quyết định cấp quyền nghiệp vụ được ký; xem [RBAC_APPROVAL_FORM.md](./RBAC_APPROVAL_FORM.md).
