# ACM — Đăng ký quyết định nghiệp vụ Stage4C

**Trạng thái 2026-10-29:** BIZ-01 và BIZ-02 **OWNER APPROVED — BUSINESS ONLY**; BIZ-03…05 **AWAITING OWNER DECISION**. Không phải phê duyệt DBA, migration, ghi Supabase hoặc release GO.

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

## BIZ-03 — Chờ quyết định riêng: thiết bị GOOD / DAMAGED / LOST

**Đề xuất A — Kiểm tra trước, hoàn nhập ngay:** Thiết bị GOOD chỉ vào kho khả dụng sau khi nhân viên nhận đánh giá tốt và quy trình BIZ-02 được xác minh; DAMAGED chuyển cách ly, không đưa vào khả dụng; LOST lập biên bản thất lạc, không tính là nhận vật lý, không hoàn tồn khả dụng.

**Đề xuất B — Cách ly trước, kiểm tra sau:** Mọi thiết bị đã nhận, kể cả GOOD, ban đầu ở trạng thái chờ kiểm tra/cách ly. Chỉ sau khi người được phân quyền duyệt kiểm tra chất lượng thì GOOD mới vào khả dụng; DAMAGED tiếp tục cách ly, LOST chỉ lập biên bản sự cố và không hoàn tồn khả dụng.

Cần chủ dự án quyết định cách xử lý GOOD, vai trò kiểm tra chất lượng, xử lý hỏng/mất/chi phí; DBA phải đối chiếu ý nghĩa `onHand`, `quarantined`, `borrowed` và trạng thái Asset trước khi thiết kế cập nhật tồn kho. Không tự suy đoán số học stock.

## BIZ-04 — Chờ quyết định

Ai được PREPARE, CONFIRM_RECEIPT, VERIFY, COMMIT, CANCEL; ma trận role và separation of duties phải thống nhất BIZ-02. Cần lưu actor/timestamp/audit. Chưa phê duyệt.

## BIZ-05 — Chờ quyết định

Trả một phần, chống over-return, chỉ COMMIT một lần, idempotency replay/conflict, không double-post receipt/stock/asset/audit, cancel trước commit không làm biến động tồn. Cần chốt phạm vi và thời gian giữ idempotency key. Chưa phê duyệt.

## Giới hạn phê duyệt và cổng tiếp theo

- BIZ-01, BIZ-02 được chủ dự án phê duyệt qua hội thoại, **không phải quyết định DBA** hoặc phê duyệt thực thi SQL; chưa kiểm tra danh tính bằng kênh xác thực độc lập ngoài hội thoại.
- BIZ-03…05 cần phê duyệt tường minh, không dựa vào câu “đồng ý” chung.
- Người rà soát PostgreSQL/Prisma độc lập phải ký thiết kế theo issue #11. Phê duyệt tạo cluster #12, chạy migration/test DB #13, Supabase staging #21 và release #15 là các cổng riêng.
- Tiếp tục chỉ tài liệu và kiểm thử offline. Không bật `ACM_RETURN_OPERATIONS_ENABLED=true`, không mở endpoint 503, không chạy SQL/migration, không chỉnh UAT hoặc merge/deploy.
