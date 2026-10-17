# Phase 11D — Bàn giao vòng UAT sau khi chốt chính sách RBAC

**Ngày ghi nhận:** 17/10/2026 · **Trạng thái:** READY FOR QA ASSIGNMENT · **Release gate: NO-GO**

## Quyết định nghiệp vụ đã nhận được

Người dùng trong cuộc trò chuyện dự án xác nhận **giữ chính sách phân quyền MVP hiện tại**, đặc biệt **Reports và Audit Logs chỉ ADMIN**; vẫn chỉ trả linh kiện đúng kho nguồn. Không phát sinh yêu cầu cấp thêm quyền cho LAB_MANAGER, TECHNICIAN hay STUDENT. Mọi thay đổi khác cần change request.

[Phiếu RBAC](./RBAC_APPROVAL_FORM.md) ghi nhận lựa chọn theo nguồn này. **Chưa có chữ ký Owner được xác minh**, chưa có phân công QA trên [Issue #8](https://github.com/acmhtql-sys/ACM_QLLK/issues/8) và chưa có kết quả UAT thực tế; [Issue #9](https://github.com/acmhtql-sys/ACM_QLLK/issues/9) vẫn mở.

## Hành động trước khi UAT thủ công

1. **Owner/đại diện nghiệp vụ**: kiểm tra RBAC-01…07, xác nhận vai trò/quyền tương ứng và ghi chữ ký hoặc liên kết đến phê duyệt hợp lệ ở Issue #9.
2. **QA lead**: nhận Issue #8, chốt người chạy, trình duyệt, bản build/commit, bộ fixture và thời điểm; không gửi credentials trong issue.
3. **Kỹ sư kiểm thử**: xác minh chỉ dùng PostgreSQL `acm_inventory_test` trên loopback, kiểm tra query `SELECT current_database()`, kiểm tra backup/cleanup và cấm sử dụng bất cứ DSN Supabase nào trước migration/seed.
4. **QA**: thực hiện [16 bước UAT Web](./MANUAL_UAT_RUNBOOK.md) và [18 bài nghiệp vụ](./UAT_CHECKLIST.md) theo đúng vai trò; gắn bằng chứng đã che token và số dư trước/sau, ghi vào [biên bản nghiệm thu](./UAT_SIGNOFF_RECORD.md).
5. **Release reviewer**: kiểm tra CI trên **commit PR mới nhất**; xác nhận không P0/P1, các mục BLOCKED được xử lý; xin phê duyệt **riêng** trước merge `main` hoặc mọi hành động Cloud.

## Mốc kỹ thuật và trạng thái chứng thực

- Mốc CI của hồ sơ trước cập nhật lựa chọn: [run 39018304496](https://github.com/acmhtql-sys/ACM_QLLK/actions/runs/39018304496), commit `7ecff3c`, xanh (353/353 API/DB/unit, 19/19 Chromium mock, 4/4 Chromium full-stack, 16/16 static preflight).
- Cập nhật ghi nhận RBAC chỉ là **tài liệu**; cần xác minh lại CI trên commit hiện tại, không tái sử dụng trạng thái cũ làm trạng thái mới.
- **UAT thủ công: NOT RUN** · **Owner formal sign-off: PENDING** · **Staging Cloud: NOT TOUCHED** · **Merge: NOT PERMITTED**.

**Tuyệt đối không** triển khai Supabase, Render, Vercel hoặc sửa `main` từ bước bàn giao này.
