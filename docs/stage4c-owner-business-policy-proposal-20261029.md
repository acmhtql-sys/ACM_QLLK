# ACM — Đăng ký quyết định nghiệp vụ Stage4C

**Trạng thái 2026-10-29:** BIZ-01, BIZ-02 và BIZ-03 **OWNER APPROVED — BUSINESS ONLY**; BIZ-04…05 **AWAITING OWNER DECISION**. Không phải phê duyệt DBA, migration, ghi Supabase hoặc release GO.

Nguồn mã kiểm tra: UAT Stage4C 9-file ZIP SHA-256 `938479d53afa7f16b2923bbf9611b4480957c19ce24d835b84d19c59d5fc332a`. Hồ sơ DBA: `docs/stage4c-business-dba-signoff-draft-20261029.md`.

## BIZ-01 — Đã phê duyệt

**Owner nói trực tiếp ngày 2026-10-29:** “Tôi phê duyệt BIZ-01: mã chứng từ ASCII 1–128 ký tự theo regex đã đề xuất, không phân biệt chữ hoa/thường.”

- Regex: `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`.
- Case-insensitive: `ACM-001` và `acm-001` được xem là cùng mã.
- Chưa chốt triển khai: canonicalization và lưu mã gốc, phạm vi uniqueness, PostgreSQL collation/index, collision của dữ liệu cũ. Reviewer kỹ thuật phải bảo đảm cùng quy tắc ở API/Prisma/PostgreSQL.
- Kết quả: **APPROVED_BY_PROJECT_OWNER — BUSINESS ONLY**.

## BIZ-02 — Đã phê duyệt phương án A

**Owner nói trực tiếp ngày 2026-10-29:** “Tôi chọn và phê duyệt phương án A cho BIZ-02: ACM phát hành mã chứng từ điện tử, nhân viên tiếp nhận xác nhận bàn giao thực tế, và người khác có thẩm quyền kiểm chứng độc lập trước COMMIT.”

- Hệ thống **ACM cấp mã chứng từ điện tử** theo BIZ-01. Mã được tạo ra **không đồng nghĩa** chứng minh thiết bị đã bàn giao.
- **Nhân viên tiếp nhận xác nhận nhận thiết bị thực tế** bằng thao tác có ghi chứng cứ, người thực hiện và thời điểm.
- **Một người khác, có thẩm quyền, xác minh độc lập** chứng từ và xác nhận tiếp nhận **trước COMMIT**; không cho người tiếp nhận tự làm người xác minh của cùng lần bàn giao.
- Các yêu cầu triển khai *suy ra cần review*: lưu mã, nguồn do ACM cấp, phiếu mượn liên quan, danh tính/role của hai người, dấu thời gian, chứng cứ và nhật ký audit; authorization phải kiểm tra từ server, không tin cờ xác nhận do frontend tự gửi.
- Vai trò cụ thể ADMIN / LAB_MANAGER / TECHNICIAN và quy tắc COMMIT/CANCEL sẽ chốt ở **BIZ-04**, chưa mặc định phê duyệt.
- Kết quả: **APPROVED_BY_PROJECT_OWNER — BUSINESS ONLY**.

## BIZ-03 — Đã phê duyệt phương án B (cách ly trước, kiểm tra sau)

**Chủ dự án phê duyệt ngày 2026-10-29:** “Tôi chọn và phê duyệt BIZ-03 phương án B: mọi thiết bị thực nhận phải được cách ly chờ kiểm tra, chỉ GOOD được duyệt mới trở lại khả dụng; DAMAGED tiếp tục cách ly; LOST lập biên bản riêng, không ghi nhận nhận vật lý hoặc hoàn nhập tồn khả dụng.”

- **Thiết bị thực nhận:** luôn đi vào trạng thái chờ kiểm tra/cách ly trước; không tăng khả dụng chỉ vì nhân viên đã nhận hoặc đã tạo mã chứng từ.
- **GOOD:** chỉ chuyển từ cách ly/chờ kiểm tra sang khả dụng sau khi được người có quyền phê duyệt kiểm tra chất lượng, cùng bằng chứng bàn giao BIZ-02 hợp lệ.
- **DAMAGED:** tiếp tục cách ly và không tăng tồn khả dụng, chờ xử lý/bảo trì/loại bỏ theo chính sách chưa chốt.
- **LOST:** ghi biên bản thất lạc riêng; không giả lập việc nhận thiết bị vật lý, không tăng tồn khả dụng; cơ chế điều chỉnh borrowed/onHand/Asset và bồi thường cần quy tắc nghiệp vụ, kế toán và review kỹ thuật riêng.
- **Điều kiện phối hợp BIZ-02:** tiếp nhận thực tế và người khác xác minh độc lập trước COMMIT; với LOST, không thể thực hiện xác nhận “đã nhận vật lý” cho vật bị mất — cần luồng sự cố riêng, không dùng COMMIT nhận hàng giả.
- **Phần chưa chốt:** ai kiểm tra/duyệt chất lượng (BIZ-04), ai phê duyệt xử lý hỏng/mất, số học StockBalance (onHand/quarantined/borrowed/available) và chuyển trạng thái serial/Asset. Không tự áp đặt SQL hoặc cập nhật stock trước kiểm thử DB được duyệt.
- **Kết quả:** **APPROVED_BY_PROJECT_OWNER — BUSINESS ONLY**.

## BIZ-04 — Chờ quyết định

Ai được PREPARE, CONFIRM_RECEIPT, VERIFY, COMMIT, CANCEL; ma trận role và separation of duties phải thống nhất BIZ-02. Cần lưu actor/timestamp/audit. Chưa phê duyệt.

## BIZ-05 — Chờ quyết định

Trả một phần, chống over-return, chỉ COMMIT một lần, idempotency replay/conflict, không double-post receipt/stock/asset/audit, cancel trước commit không làm biến động tồn. Cần chốt phạm vi và thời gian giữ idempotency key. Chưa phê duyệt.

## Giới hạn phê duyệt và cổng tiếp theo

- BIZ-01, BIZ-02, BIZ-03 được chủ dự án phê duyệt qua hội thoại, **không phải quyết định DBA** hoặc phê duyệt thực thi SQL; chưa kiểm tra danh tính bằng kênh xác thực độc lập ngoài hội thoại.
- BIZ-04…05 cần phê duyệt tường minh, không dựa vào câu “đồng ý” chung.
- Người rà soát PostgreSQL/Prisma độc lập phải ký thiết kế theo issue #11. Phê duyệt tạo cluster #12, chạy migration/test DB #13, Supabase staging #21 và release #15 là các cổng riêng.
- Tiếp tục chỉ tài liệu và kiểm thử offline. Không bật `ACM_RETURN_OPERATIONS_ENABLED=true`, không mở endpoint 503, không chạy SQL/migration, không chỉnh UAT hoặc merge/deploy.
