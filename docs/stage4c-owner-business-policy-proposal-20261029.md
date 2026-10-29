# ACM — Đề xuất chính sách nghiệp vụ Stage4C để chủ dự án quyết định

**Trạng thái: DRAFT — AWAITING OWNER DECISIONS. KHÔNG PHẢI PHÊ DUYỆT SQL/MIGRATION/RELEASE.**  
Lập ngày: 2026-10-29. Dựa trên 9 tệp UAT Stage4C đã đối chiếu SHA-256 và hồ sơ `docs/stage4c-business-dba-signoff-draft-20261029.md`.  
**Tư cách người quyết định nghiệp vụ:** Trong hội thoại ngày 2026-10-29, người dùng tự xác nhận là chủ dự án và có quyền quyết định quy tắc nghiệp vụ của ACM. Xác nhận này chỉ xác lập đầu mối ra quyết định, **không tự động phê duyệt BIZ-01…05**, không thay thế reviewer kỹ thuật độc lập, không cấp quyền chạy SQL.

## Bộ quy tắc đề xuất — chờ trả lời APPROVE / REVISE / REJECT

| ID | Quy tắc đề xuất | Điều còn cần chủ dự án quyết định rõ |
|---|---|---|
| BIZ-01 — Mã chứng từ | Mỗi lần bàn giao vật lý dùng mã chứng từ bắt buộc, 1–128 ký tự ASCII, khớp regex `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`; không dùng tên/email/CCCD trong mã | Phê duyệt regex và chọn **phân biệt** hay **không phân biệt** chữ hoa/chữ thường; quy tắc chuẩn hóa và uniqueness |
| BIZ-02 — Nguồn chứng từ | Mã do nguồn nghiệp vụ được chỉ định cấp và xác minh bằng biên bản/hệ thống có truy vết; người nhập chuỗi không được coi là bằng chứng tự động; lưu issuer, verifier, actor, time, provenance khi chính sách cho phép | Ai có quyền phát hành và xác minh độc lập? Có dùng chứng từ bên ngoài hay mã từ hệ thống ACM? |
| BIZ-03 — Điều kiện thiết bị | GOOD: chỉ chuyển sang khả dụng sau khi được nhận và kiểm tra; DAMAGED: chuyển cách ly để xử lý, không tăng số khả dụng; LOST: không hoàn nhập tồn khả dụng, lập chứng từ/tình trạng mất. Mọi thay đổi vật tư/Asset phải nhất quán với định nghĩa tồn kho đã phê duyệt | Có yêu cầu phê duyệt riêng cho DAMAGED/LOST? Khi nào thiết bị GOOD được cộng vào số khả dụng? |
| BIZ-04 — Quyền và tách trách nhiệm | PREPARE cho nhân sự nghiệp vụ được cấp quyền; COMMIT chỉ cho người có quyền nhận/xác minh; CANCEL chỉ khi chưa COMMIT và có lý do/audit; mọi quyết định ghi actor + timestamp. Không tự động cho phép người tạo PREPARE tự COMMIT nếu cần bằng chứng độc lập | Chọn vai trò ADMIN/LAB_MANAGER/TECHNICIAN và có bắt buộc người PREPARE khác người COMMIT? |
| BIZ-05 — Quy tắc hoàn trả | Cho phép trả một phần; cấm vượt số lượng còn mượn; COMMIT chỉ ghi một lần; retry cùng idempotency key và cùng nội dung trả lại kết quả cũ; cùng key khác nội dung = conflict; mỗi phiếu mượn tối đa một operation chưa kết thúc; hủy PREPARE không ghi biến động tồn; COMMIT lưu biên nhận/audit/stock/asset nguyên tử | Xác nhận phạm vi khóa idempotency (actor/borrow/request) và thời hạn lưu dữ liệu chống replay |

## Tiêu chí nghiệm thu trước khi thay đổi Database

1. Chính chủ dự án trả lời rõ **APPROVE / REVISE / REJECT** đối với BIZ-01…05; xác nhận các mục còn để lựa chọn, không đoán khi chưa quyết.
2. Lưu nguồn quyết định có thể kiểm chứng trong hệ thống quản lý dự án (vai trò, ngày giờ, tham chiếu), tránh tên cá nhân/secret không cần thiết.
3. Người rà soát PostgreSQL/Prisma **độc lập, là người thật** review DBA-01…07 trong `docs/stage4c-business-dba-signoff-draft-20261029.md`; câu trả lời của AI **không thay thế** signoff.
4. Sau khi nghiệp vụ/DDL được duyệt, chỉ tiến hành chuẩn bị & test offline trên nhánh riêng. Việc tạo PostgreSQL cô lập cần 2 phê duyệt độc lập riêng (#12), việc chạy migration/SQL cần quyền riêng (#13). Supabase staging/production theo #21/#15.

## Trong khi chờ phê duyệt

Được phép: viết code giao diện/adapter fail-closed, unit tests mock/offline, review security/Prisma diff **không thực thi SQL**.  
Không được phép: bật `ACM_RETURN_OPERATIONS_ENABLED=true`, mở route 503, sửa UAT trực tiếp, chạy SQL/migration, chuyển dữ liệu thật, merge release PR, deploy/cutover.

**Mẫu phản hồi ngắn từ chủ dự án (chỉ là định hướng; chưa phải signoff được xác minh):**  
`BIZ-01 ...; BIZ-02 ...; BIZ-03 ...; BIZ-04 ...; BIZ-05 ...`.  
Nếu quyết định nhiều mục cùng lúc, yêu cầu mọi điều kiện lựa chọn phải được ghi rõ, không để ngầm định.
