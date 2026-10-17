# Phase 11D — Phiếu quyết định và phê duyệt phân quyền MVP ACM

**Trạng thái:** **CHÍNH SÁCH MVP ĐÃ ĐƯỢC NGƯỜI DÙNG XÁC NHẬN — CHỜ CHỮ KÝ / XÁC MINH CỦA OWNER VÀ QA UAT** · **Ngày ghi nhận:** 17/10/2026  
**Đối tượng:** Chủ nghiệp vụ ACM / người có thẩm quyền chốt RBAC.  
**Bằng chứng kỹ thuật:** [Draft PR #7](https://github.com/acmhtql-sys/ACM_QLLK/pull/7), [ma trận mã hiện tại](./WEB_RBAC_MATRIX.md), [CI thành công ở 50a8d7c](https://github.com/acmhtql-sys/ACM_QLLK/actions/runs/39017683030).

> **Nguồn quyết định:** Trong cuộc trò chuyện dự án ngày 17/10/2026, người dùng xác nhận: **"Tôi xác nhận chọn phương án giữ chính sách phân quyền MVP hiện tại, gồm Reports và Audit Logs ADMIN-only."** Đây là lựa chọn nghiệp vụ cụ thể, được đưa vào hồ sơ để QA đối chiếu; **chưa có chữ ký, chức danh hoặc bằng chứng xác minh thẩm quyền Owner**. Việc ghi nhận không tự tạo một biên bản phê duyệt chính thức và không thay thế UAT thủ công. Issue [#9](https://github.com/acmhtql-sys/ACM_QLLK/issues/9) vẫn mở cho bước xác minh/ký duyệt.

## 1. Các quyết định cần chốt

| ID | Chủ đề | Đề xuất kỹ thuật (Web/API hiện tại) | Lựa chọn Owner (chọn và ký) | Trạng thái |
|---|---|---|---|---|
| RBAC-01 | Ai xem **Reports**? | Chỉ ADMIN; mọi vai trò khác bị 403 và Web chặn route | ☑ Giữ ADMIN-only theo lựa chọn người dùng · □ Đổi | **USER CONFIRMED / OWNER SIGNOFF PENDING** |
| RBAC-02 | Ai xem **Audit Logs**? | Chỉ ADMIN; router, service và Web cùng bảo vệ | ☑ Giữ ADMIN-only theo lựa chọn người dùng · □ Đổi | **USER CONFIRMED / OWNER SIGNOFF PENDING** |
| RBAC-03 | LAB_MANAGER xem **Users**? | API cho LAB_MANAGER GET danh sách, nhưng Web `/users` bị ẩn vì có thao tác chỉnh sửa ADMIN-only | Giữ nguyên hiện trạng: **chưa bổ sung UI read-only**; Owner ghi ngoại lệ nếu muốn thay đổi | **GIỮ HIỆN TRẠNG / QA & SIGNOFF PENDING** |
| RBAC-04 | STUDENT tự hủy phiếu? | Được hủy `PENDING` **của mình**; Web chỉ hiện nút cho chủ phiếu; người khác bị API từ chối | Giữ nguyên theo chính sách MVP được chọn | **GIỮ HIỆN TRẠNG / QA & SIGNOFF PENDING** |
| RBAC-05 | TECHNICIAN xử lý mượn/trả? | Có bàn giao + nhận trả, không được duyệt/từ chối/hủy APPROVED | Giữ nguyên theo chính sách MVP được chọn | **GIỮ HIỆN TRẠNG / QA & SIGNOFF PENDING** |
| RBAC-06 | Quyền quản lý Kits / Categories / Settings | Các màn hình cần QA đối chiếu hành động cụ thể với router API; chưa coi là duyệt | Giữ API/Frontend hiện tại, **không tự cấp quyền mới**; chờ QA đối chiếu từng thao tác | **PENDING QA & OWNER SIGNOFF** |
| RBAC-07 | Giới hạn trả kho nguồn | **MVP đã chốt:** chỉ trả đúng kho nguồn; trường hợp nhiều nguồn không xác định bị từ chối 409 | ☑ Giữ kho nguồn theo quyết định MVP đã chốt; mọi ngoại lệ cần change request | **USER CONFIRMED / QA & SIGNOFF PENDING** |

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
- **Lựa chọn nghiệp vụ người dùng xác nhận:** giữ chính sách hiện tại; Reports/Audit Logs ADMIN-only, chỉ hoàn trả đúng kho nguồn (ngày 17/10/2026)
- **Trạng thái ký xác nhận Owner:** □ APPROVED □ APPROVED WITH CHANGES □ REJECTED □ DEFERRED — **CHƯA CÓ CHỮ KÝ**
- **Bằng chứng chấp thuận của Owner:** ______ (link review/biên bản ngoài; không giả mạo chữ ký)
- **Ngày xác nhận:** ______

## 4. Trạng thái nghiệm thu phụ thuộc

**Lựa chọn chính sách đã được xác nhận trong cuộc trò chuyện và được ghi nhận làm cơ sở kỹ thuật cho UAT**; chưa xác minh thẩm quyền ký thay Owner. Chỉ chuyển gate **RBAC = PASS** khi có xác nhận/phê duyệt chính thức của người có thẩm quyền và mọi `APPROVED WITH CHANGES` đã được thực hiện/kiểm thử. Nếu còn thiếu sign-off, gate **RBAC = BLOCKED**; không đổi trạng thái PR thành ready hoặc merge.
