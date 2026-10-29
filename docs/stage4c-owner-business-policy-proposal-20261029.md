# ACM — Đăng ký quyết định nghiệp vụ Stage4C

**Trạng thái 2026-10-29:** **BIZ-01…BIZ-05: 5/5 OWNER APPROVED — BUSINESS ONLY.** DBA/DDL, triển khai Backend, migration và release vẫn **NO-GO**. Không phải phê duyệt DBA, migration, ghi Supabase hoặc release GO.

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
- Vai trò cụ thể và quyền COMMIT/CANCEL đã được chốt tại **BIZ-04** bên dưới.
- Kết quả: **APPROVED_BY_PROJECT_OWNER — BUSINESS ONLY**.

## BIZ-03 — Đã phê duyệt phương án B (cách ly trước, kiểm tra sau)

**Chủ dự án phê duyệt ngày 2026-10-29:** “Tôi chọn và phê duyệt BIZ-03 phương án B: mọi thiết bị thực nhận phải được cách ly chờ kiểm tra, chỉ GOOD được duyệt mới trở lại khả dụng; DAMAGED tiếp tục cách ly; LOST lập biên bản riêng, không ghi nhận nhận vật lý hoặc hoàn nhập tồn khả dụng.”

- **Thiết bị thực nhận:** luôn đi vào trạng thái chờ kiểm tra/cách ly trước; không tăng khả dụng chỉ vì nhân viên đã nhận hoặc đã tạo mã chứng từ.
- **GOOD:** chỉ chuyển từ cách ly/chờ kiểm tra sang khả dụng sau khi được người có quyền phê duyệt kiểm tra chất lượng, cùng bằng chứng bàn giao BIZ-02 hợp lệ.
- **DAMAGED:** tiếp tục cách ly và không tăng tồn khả dụng, chờ xử lý/bảo trì/loại bỏ theo chính sách chưa chốt.
- **LOST:** ghi biên bản thất lạc riêng; không giả lập việc nhận thiết bị vật lý, không tăng tồn khả dụng; cơ chế điều chỉnh borrowed/onHand/Asset và bồi thường cần quy tắc nghiệp vụ, kế toán và review kỹ thuật riêng.
- **Điều kiện phối hợp BIZ-02:** tiếp nhận thực tế và người khác xác minh độc lập trước COMMIT; với LOST, không thể thực hiện xác nhận “đã nhận vật lý” cho vật bị mất — cần luồng sự cố riêng, không dùng COMMIT nhận hàng giả.
- **Phần chưa chốt:** quy trình phê duyệt xử lý hỏng/mất ngoài duyệt chất lượng thông thường, số học StockBalance (onHand/quarantined/borrowed/available) và chuyển trạng thái serial/Asset. Không tự áp đặt SQL hoặc cập nhật stock trước kiểm thử DB được duyệt.
- **Kết quả:** **APPROVED_BY_PROJECT_OWNER — BUSINESS ONLY**.

## BIZ-04 — Đã phê duyệt phương án A (phân nhiệm chặt chẽ)

**Chủ dự án phê duyệt ngày 2026-10-29:** “Tôi chọn và phê duyệt BIZ-04 phương án A: ADMIN, LAB_MANAGER, TECHNICIAN được PREPARE và xác nhận tiếp nhận; chỉ ADMIN hoặc LAB_MANAGER được VERIFY độc lập, COMMIT, duyệt kiểm tra chất lượng và CANCEL trước COMMIT có lý do. Người VERIFY phải khác người RECEIVE, ghi đầy đủ audit.”

| Hành động | ADMIN | LAB_MANAGER | TECHNICIAN | STUDENT |
|---|---|---|---|---|
| PREPARE | Cho phép | Cho phép | Cho phép | Không |
| CONFIRM_RECEIPT / RECEIVE (xác nhận đã nhận vật lý) | Cho phép | Cho phép | Cho phép | Không |
| VERIFY độc lập | Cho phép nếu khác người RECEIVE | Cho phép nếu khác người RECEIVE | Không | Không |
| COMMIT (chỉ sau VERIFY hợp lệ) | Cho phép | Cho phép | Không | Không |
| Duyệt kết quả kiểm tra chất lượng / đưa GOOD vào khả dụng | Cho phép | Cho phép | Không | Không |
| CANCEL trước COMMIT, có lý do bắt buộc | Cho phép | Cho phép | Không | Không |

- **Bắt buộc tách người:** tài khoản VERIFY phải khác tài khoản RECEIVE của cùng chứng từ; nếu thiếu xác nhận tiếp nhận hoặc xác minh độc lập, COMMIT phải bị từ chối. Không được chỉ kiểm tra role mà bỏ kiểm tra hai danh tính khác nhau.
- **Audit:** ghi tài khoản/role người thao tác, chứng từ/phiếu mượn liên quan, hành động, thời điểm, trạng thái trước/sau và lý do CANCEL. Không để frontend cung cấp danh tính được tin cậy thay cho server-authenticated actor.
- **BIZ-03 vẫn áp dụng:** COMMIT nhận hàng không tự chuyển tồn khả dụng; thiết bị thực nhận phải cách ly chờ kiểm tra, GOOD chỉ khả dụng sau khi ADMIN hoặc LAB_MANAGER duyệt chất lượng; DAMAGED vẫn cách ly, LOST là luồng biên bản sự cố, không giả làm nhận vật lý.
- **Yêu cầu kiểm thử:** deny TECHNICIAN/ STUDENT VERIFY/COMMIT/CANCEL/QC; deny cùng người RECEIVE+VERIFY kể cả ADMIN; deny COMMIT thiếu VERIFY; deny CANCEL sau COMMIT; ghi audit kể cả từ chối nghiệp vụ thích hợp.
- **Chưa chốt về kỹ thuật:** cách triển khai workflow và giới hạn concurrency, khóa/quyền cấp ở Backend, Prisma/DDL, migration, HTTP contract. Chưa chạy DB hoặc mở endpoint 503.
- **Kết quả:** **APPROVED_BY_PROJECT_OWNER — BUSINESS ONLY**.

## BIZ-05 — Đã phê duyệt phương án A: Trả một phần và chống ghi trùng

**Quyết định chủ dự án, 2026-10-29:** “Tôi phê duyệt BIZ-05 phương án A: cho phép trả một phần nhiều lần, tối đa một return operation chưa kết thúc cho mỗi phiếu mượn; cấm trả vượt, chống double COMMIT, idempotency theo phiếu mượn và khóa yêu cầu, từ chối khác nội dung hoặc người không hợp lệ, giữ khóa tối thiểu 365 ngày, bảo vệ chứng từ COMMIT lâu dài, CANCEL trước COMMIT không ghi tồn và COMMIT nguyên tử.”

- **Partial return:** được trả nhiều đợt nối tiếp; không được trả vượt số lượng chưa hoàn trả của mỗi dòng.
- **Single pending operation:** tối đa một return operation chưa kết thúc trên mỗi phiếu mượn tại một thời điểm, kể cả khi nhiều người gửi PREPARE đồng thời.
- **Idempotency:** phạm vi logic = `borrowRequestId` + `idempotencyKey`; sau khi kiểm tra danh tính và quyền actor trên server, cùng khóa + canonical payload giống nhau → trả lại kết quả đã lưu, **không ghi thêm**; khác payload hoặc actor không hợp lệ → từ chối, không tạo tác dụng phụ.
- **Lưu giữ:** thông tin chống replay tối thiểu **365 ngày**; bảo đảm tính duy nhất, bất biến và khả năng truy nguyên của chứng từ COMMIT **lâu dài**. Sau khi khóa hết hạn vẫn không được double-post một giao dịch đã COMMIT. Phạm vi retention, canonicalization và định danh actor trong schema cần reviewer xác nhận.
- **Atomic COMMIT:** biên nhận, chi tiết, stock/quarantine movement, serial/Asset, audit và terminal operation phải commit hoặc rollback **cùng một transaction**. Không được chuyển tồn một phần khi một bước khác thất bại.
- **CANCEL:** chỉ trước COMMIT, chỉ người có quyền theo BIZ-04, bắt buộc lý do và audit; **không làm biến động tồn**.
- **BIZ-02, BIZ-03, BIZ-04:** RECEIVE thực tế và VERIFY độc lập bởi hai người khác nhau; hàng thực nhận cách ly chờ QC; LOST lập biên bản riêng; chỉ ADMIN/LAB_MANAGER COMMIT. Không mở endpoint khi chưa hoàn tất kiểm chứng.
- **DBA/Backend phải review:** ràng buộc duy nhất cho scope idempotency và operation terminal, unresolved partial unique index, lock order legacy/new, xung đột Serializable, retry bounded, dữ liệu hash và actor, retention/durable receipt, invariant tồn kho. Quyết định nghiệp vụ này không phải phê duyệt SQL/DDL.
- **Trạng thái:** **APPROVED_BY_PROJECT_OWNER — BUSINESS ONLY**.

## Giới hạn phê duyệt và cổng tiếp theo

- BIZ-01, BIZ-02, BIZ-03, BIZ-04, BIZ-05 được chủ dự án phê duyệt qua hội thoại, **không phải quyết định DBA** hoặc phê duyệt thực thi SQL; chưa kiểm tra danh tính bằng kênh xác thực độc lập ngoài hội thoại.
- **Đã chốt 5/5 quy tắc nghiệp vụ trong hội thoại.** Các chi tiết thiết kế còn tồn đọng cần review độc lập, không được coi là DBA signoff hay quyền chạy SQL.
- Người rà soát PostgreSQL/Prisma độc lập phải ký thiết kế theo issue #11. Phê duyệt tạo cluster #12, chạy migration/test DB #13, Supabase staging #21 và release #15 là các cổng riêng.
- Tiếp tục chỉ tài liệu và kiểm thử offline. Không bật `ACM_RETURN_OPERATIONS_ENABLED=true`, không mở endpoint 503, không chạy SQL/migration, không chỉnh UAT hoặc merge/deploy.
