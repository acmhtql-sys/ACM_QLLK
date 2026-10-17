# Phase 11D — Phiếu quyết định và phê duyệt phân quyền MVP ACM

**Trạng thái:** **PENDING OWNER APPROVAL** · **Lập ngày:** 17/10/2026  
**Đối tượng:** Chủ nghiệp vụ ACM / người có thẩm quyền chốt RBAC.  
**Bằng chứng kỹ thuật:** [Draft PR #7](https://github.com/acmhtql-sys/ACM_QLLK/pull/7), [ma trận mã hiện tại](./WEB_RBAC_MATRIX.md), [CI thành công ở 50a8d7c](https://github.com/acmhtql-sys/ACM_QLLK/actions/runs/39017683030).

> **Lưu ý:** Đây là phiếu lấy quyết định, **không phải chính sách được duyệt**. Mục `Đề xuất kỹ thuật` mô tả behavior hiện hành; ô `Quyết định Owner` chưa chọn. Người dùng đồng ý tiếp tục chuẩn bị nghiệm thu không đồng nghĩa với việc chấp thuận từng quyền.

## 1. Các quyết định cần chốt

| ID | Chủ đề | Đề xuất kỹ thuật (Web/API hiện tại) | Lựa chọn Owner (chọn và ký) | Trạng thái |
|---|---|---|---|---|
| RBAC-01 | Ai xem **Reports**? | Chỉ ADMIN; mọi vai trò khác bị 403 và Web chặn route | □ Giữ ADMIN-only □ Đổi, ghi vai trò/lý do: ______ | **PENDING** |
| RBAC-02 | Ai xem **Audit Logs**? | Chỉ ADMIN; router, service và Web cùng bảo vệ | □ Giữ ADMIN-only □ Đổi, ghi vai trò/lý do: ______ | **PENDING** |
| RBAC-03 | LAB_MANAGER xem **Users**? | API cho LAB_MANAGER GET danh sách, nhưng Web `/users` bị ẩn vì có thao tác chỉnh sửa ADMIN-only | □ Không cần UI □ Làm Users read-only cho MANAGER □ Khác: ______ | **PENDING** |
| RBAC-04 | STUDENT tự hủy phiếu? | Được hủy `PENDING` **của mình**; Web chỉ hiện nút cho chủ phiếu; người khác bị API từ chối | □ Chấp nhận □ Chỉnh điều kiện: ______ | **PENDING** |
| RBAC-05 | TECHNICIAN xử lý mượn/trả? | Có bàn giao + nhận trả, không được duyệt/từ chối/hủy APPROVED | □ Chấp nhận □ Chỉnh phạm vi: ______ | **PENDING** |
| RBAC-06 | Quyền quản lý Kits / Categories / Settings | Các màn hình cần QA đối chiếu hành động cụ thể với router API; chưa coi là duyệt | □ Giữ theo backend sau rà soát □ Yêu cầu chỉnh: ______ | **PENDING** |
| RBAC-07 | Giới hạn trả kho nguồn | **Đã chốt phạm vi MVP:** chỉ trả đúng kho nguồn; trường hợp nhiều nguồn không xác định bị từ chối 409 | □ Xác nhận thể hiện trong biên bản nghiệm thu □ Nêu ngoại lệ (cần change request): ______ | **PENDING ghi nhận** |

## 2. Quy tắc triển khai khi người duyệt chọn phương án khác

1. **Chưa cấp quyền mới** hoặc mở route chỉ dựa trên nội dung biểu mẫu. Nếu Owner chọn `Đổi`, cần thay đổi mã trong PR có review và kiểm thử cả API lẫn Web, không chỉ chỉnh Sidebar.
2. `LAB_MANAGER GET /users` là điểm bất đối xứng đã nhận diện; chọn giao diện read-only cần có thiết kế/kiểm thử riêng, tránh nút tạo/sửa/reset bị 403.
3. Frontend role guard chỉ giúp UI; Backend luôn là ranh giới bảo mật. Không bỏ guard server-side để làm test xanh.
4. Không đưa thông tin danh tính, token, mật khẩu/secret hoặc dữ liệu Cloud vào phiếu. Nếu có chính sách nhạy cảm, lưu quyết định trong quy trình quản trị được phép và dẫn mã tham chiếu.

## 3. Mẫu ghi quyết định

- **Tài liệu/version xét duyệt:** commit ______  / PR #7 / ngày ______
- **Người quyết định nghiệp vụ, chức danh:** ______
- **Quyết định RBAC-01:** ______  **RBAC-02:** ______  **RBAC-03:** ______
- **Quyết định RBAC-04:** ______  **RBAC-05:** ______  **RBAC-06:** ______  **RBAC-07:** ______
- **Những thay đổi mã được yêu cầu:** ______
- **Mã issue / change request:** ______
- **Trạng thái chung:** □ APPROVED □ APPROVED WITH CHANGES □ REJECTED □ DEFERRED
- **Bằng chứng chấp thuận của Owner:** ______ (link review/biên bản ngoài; không giả mạo chữ ký)
- **Ngày xác nhận:** ______

## 4. Trạng thái nghiệm thu phụ thuộc

Chỉ khi có quyết định **APPROVED** và mọi `APPROVED WITH CHANGES` đã được thực hiện/kiểm thử mới chuyển gate **RBAC = PASS**. Nếu `PENDING`/ `DEFERRED`, gate **RBAC = BLOCKED**; không đổi trạng thái PR thành ready hoặc merge.
