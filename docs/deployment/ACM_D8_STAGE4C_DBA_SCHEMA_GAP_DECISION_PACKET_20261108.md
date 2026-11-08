# ACM D8 — Stage4C ↔ RC5: DBA schema-gap decision packet

**Ngày kiểm tra:** 2026-11-08 · **Mục đích:** REVIEW ONLY · **Kết luận:** `RELEASE_NO_GO`

**Tài liệu này KHÔNG phải SQL, migration, lệnh tạo PostgreSQL, bằng chứng khảo sát database thật, hoặc phê duyệt DBA.** Không chạy `prisma migrate`, `initdb`, seed, rollback, lệnh SQL, thay đổi Render/Supabase hay mở writer từ tài liệu này. Mọi chữ ký ở cuối cố ý để trống.

## 1. Các nguồn cố định và độ tin cậy

| Nguồn | Mã commit/định danh | Nội dung đã kiểm tra |
|---|---|---|
| Ứng viên tổng hợp RC5+Zod4/L1/L2/L4 | [Draft PR #56](https://github.com/acmhtql-sys/ACM_QLLK/pull/56) @ `1c138de18ed9b8d28955169b9f56e447e6ddf522` | Prisma `apps/api/prisma/schema.prisma`: **19 model**; Git blob SHA-1 `ec969e68f00e17fe2b037dc4c5b58fcff6744983` |
| Mô hình Stage4C review-inert | [Draft PR #16](https://github.com/acmhtql-sys/ACM_QLLK/pull/16), `review/d8-wr7e-stage4c-inert-20261029` | Prisma **20 model**; Git blob SHA-1 `fbf12e51a53c2ecd128dd24d438c100b71ea850e` |
| Chính sách chủ dự án | [Draft PR #22](https://github.com/acmhtql-sys/ACM_QLLK/pull/22) `875df3aab4947bb50e45f1fee952ce7f4b45b9f4`, `docs/stage4c-owner-business-policy-proposal-20261029.md` | BIZ-01…05 được chấp thuận **nghiệp vụ** ngày 2026-10-29; **không phải DBA/DDL** |
| PG17 Create gate | [Issue #12](https://github.com/acmhtql-sys/ACM_QLLK/issues/12) | Chưa có 2 phê duyệt từ 2 người thật khác nhau |
| PG17 SQL/concurrency gate | [Issue #13](https://github.com/acmhtql-sys/ACM_QLLK/issues/13) | Chưa có phê duyệt SQL/identity/restore |
| DBA+quyết định thiết kế | [Issue #11](https://github.com/acmhtql-sys/ACM_QLLK/issues/11) | Chưa có chữ ký DBA độc lập |

**Lưu ý:** Git blob SHA-1 **không phải** SHA-256 của bản ZIP UAT hoặc của file Windows. Issue #11 yêu cầu xác minh schema SHA-256 `ab5bbdc7f6f1de397740fadb4d5522a59bbb9a819e23dfd658218cc144032fac` từ artifact gốc; so sánh hash khác loại không chứng minh bằng nhau. Chưa đọc trực tiếp môi trường Windows hoặc PostgreSQL 17 thật trong lần này.

## 2. Gap matrix có thể dùng để thẩm định

| Mã | Thực trạng trong Prisma/source đã xem | Quy tắc nghiệp vụ / kết luận cho DBA |
|---|---|---|
| G01 — Model mới | RC5 không có `BorrowReturnOperation`; review Stage4C có model + quan hệ BorrowRequest, ReturnTransaction, User | Không cherry-pick schema 20 model; cần bản hợp nhất với RC5 và migration duy nhất, cùng diff SQL/Prisma, forward và rollback có bảo vệ |
| G02 — Receipt provenance | Stage4C model có `physicalEvidenceRef`, `createdById`, `committedById` nhưng **không có** `receivedById/receivedAt/verifiedById/verifiedAt` | **BIZ-02/04:** ghi người RECEIVER, người VERIFY khác nhau, thời điểm và bằng chứng server-authoritative trước COMMIT; xác định FK, NOT NULL theo trạng thái, audit và chống giả |
| G03 — Mã chứng từ | Stage4C `@@unique([borrowRequestId, physicalEvidenceRef])` là scope theo phiếu mượn, không bảo đảm SQL case-insensitive; BIZ-01 quy định `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$` và mã hoa/thường tương đương | DBA chọn phạm vi uniqueness, giá trị gốc vs canonical key, collation/expression index, kiểm tra collisions/backfill; **chưa chốt mặc định uniqueness toàn hệ thống** |
| G04 — Pending operation | Review schema chỉ có `@@index([borrowRequestId, createdAt])`, không có partial unique constraint cho PREPARED/RECONCILIATION_REQUIRED | **BIZ-05:** tối đa một pending per borrow kể cả 2 session. Xét partial unique index SQL + transaction lock order/unique conflict response |
| G05 — Idempotency | RC5 `IdempotencyRecord.key @unique` toàn cục, có `expiresAt`, và return writer đặt TTL 24 giờ. Stage4C `BorrowReturnOperation` có `requestHash` nhưng **không có** idempotency key hoặc ngày giữ khóa | **BIZ-05:** scope borrow+key; chống replay ≥365 ngày, khác payload/actor phải từ chối; COMMIT receipt phải bất biến lâu dài, **không** dựa duy nhất vào TTL |
| G06 — Durable COMMIT | Stage4C có nullable `returnTransactionId @unique` và composite relation `[returnTransactionId, borrowRequestId]` đến `ReturnTransaction(id,borrowRequestId)` | Review FK thực tế, index trùng/dư, điều kiện terminal-only, bảo vệ against cross-borrow, xóa cascade và rollback khi đã có receipt; receipt chỉ được COMMIT một lần |
| G07 — QC / LOST | Stage4C `BorrowReturnOperation` không có dấu vết per-line QC/approval hoặc loss-incident model được xác minh | **BIZ-03:** GOOD/DAMAGED vật lý vào quarantine trước; GOOD chỉ khả dụng sau QC độc lập; LOST chỉ biên bản sự cố, không giả RECEIVE. Chốt lưu sổ sự kiện, serial/Asset, xử lý bồi thường |
| G08 — Kế toán tồn | RC5 `StockBalance.onHand` là tồn vật lý tại lab, `quarantined` là lượng bị cách ly; API hiện tính `available = max(0, onHand - reserved - quarantined - kitAllocated)`. Legacy GOOD return tăng `onHand` ngay; DAMAGED tăng `onHand` + `quarantined` | Không chuyển BIZ-03 vào legacy GOOD trực tiếp. Thiết kế atomic receipt: `borrowed -= q`, `onHand += q`, `quarantined += q` ban đầu, available không tăng; khi GOOD QC pass `quarantined -= q`, **không cộng onHand lần hai**. Đây chỉ là mô hình đề xuất để DBA/owner xác minh constraints/history, không phải SQL được duyệt |
| G09 — LOST ledger | Legacy LOST giảm `borrowed`, không tăng `onHand`, ghi movement delta 0 | Chốt định nghĩa “mất”, phiếu sự cố, Asset state và cân đối tổng nguồn lịch sử; không tái dùng RECEIVED của món LOST |
| G10 — Coexistence/lock order | RC5 legacy return dùng Serializable, khóa `borrow_requests` rồi `stock_balances`; có idempotency receipt + GET status read-only. Stage4C review code có hard-503, chưa có writer | Ngăn hai writer ghi song song khi cutover; thống nhất lock order và khóa trên từng BorrowDetail, kiểm chứng commit visibility 409/40001/40P01 và hồi phục 504 không double-post |
| G11 — Migration/restore | Mới có tập kiểm thử PostgreSQL **16** CI-local với dữ liệu tổng hợp; không phải PG17 local có mã định danh cluster, migration và restore | Chỉ sau #11 + 2 phê duyệt #12 + SQL authority #13 mới thực hiện PG17 hai session/backup/restore, lưu catalog/Prisma diff, snapshot/hash artifact chính xác |

## 3. Cần DBA trả lời bằng quyết định ghi được vào issue #11

1. Xác nhận mô hình lưu **người nhận / người xác minh / QC / LOST incident** và ràng buộc trạng thái, mức audit/retention; đánh giá ảnh hưởng nguồn dữ liệu cũ.
2. Chốt **evidence uniqueness scope** (theo borrow, lab hay toàn hệ thống), canonical key case-insensitive, xử lý ký tự ngoài ASCII và collision trước migration.
3. Chốt **idempotency key scope + actor authorization** và trường giữ receipt/posting claim không bị xóa khi hết hạn TTL ≥365 ngày.
4. Trình bày ràng buộc **pending single operation**, composite FK, check constraints, lock order của cả hai writer và serializable retry.
5. Chốt mô hình kế toán **onHand/quarantined/borrowed/available**, QC release, DAMAGED, LOST, serial/asset và migration dữ liệu lịch sử.
6. Gửi bản **Prisma schema/DDL forward và rollback đã xác nhận hash**, kể cả hướng không cho rollback khi đã có operation/receipt; không ghép SQL review-only 2A/2B.

**Nếu thiếu bất kỳ quyết định nào, trả lời BLOCK / NEEDS-DESIGN thay vì phê duyệt chung chung.**

## 4. Kịch bản chứng minh sau khi được duyệt (CHƯA CHẠY)

| Kịch bản | Kết quả phải chứng minh trên PG17 cô lập |
|---|---|
| 2 phiên PREPARE đồng thời cùng borrow | Chỉ 1 pending, session thua nhận 409 hoặc transaction rollback an toàn |
| 2 phiên COMMIT cùng operation + replay sau TTL | 1 receipt + 1 posting, phiên thua không có side effect, chứng từ tồn lâu dài |
| `ACM-001` và `acm-001` | Theo đúng scope DBA chốt: DB từ chối trùng không phân biệt hoa/thường |
| Operation tham chiếu receipt của borrow khác | Composite FK từ chối, không tạo posting |
| RECEIVE == VERIFY; STUDENT/TECHNICIAN VERIFY | Không COMMIT, có audit từ chối theo chính sách |
| GOOD trước QC; DAMAGED; LOST | GOOD/DAMAGED không khả dụng trước QC; LOST không ghi nhận đã nhận vật lý |
| Lỗi giữa stock, detail, audit, receipt | Rollback toàn transaction, không partial posting |
| Rollback khi còn operation; backup→restore | Bị từ chối an toàn hoặc restore trên DB rỗng tách biệt, có snapshot catalog và ledger đối soát |
| Legacy và Stage4C tranh cùng phiếu | Lock order bảo vệ cùng BorrowDetail/StockBalance; không double-return |

**Không có lệnh SQL hoặc chương trình tự chạy trong packet này.** Việc diễn tập sau phê duyệt phải đúng `127.0.0.1:55433` và cơ sở dữ liệu mới được xác minh, không động tới dịch vụ Windows `postgresql-x64-17` hiện hữu, UAT hoặc cloud.

## 5. Nhật ký phê duyệt (chưa có chữ ký)

| Cổng | Người có thẩm quyền | SHA thiết kế đã kiểm tra | Quyết định/điều kiện | Tham chiếu xác minh & UTC |
|---|---|---|---|---|
| #11 — Chủ dự án xác thực phạm vi BIZ-01…05 cuối cùng | — | — | **PENDING** | — |
| #11 — DBA độc lập duyệt schema/DDL/rollback | — | — | **PENDING** | — |
| #12 — Chủ dự án duyệt **PG17 Create riêng** | — | — | **PENDING** | — |
| #12 — Reviewer độc lập khác người trên duyệt PG17 Create | — | — | **PENDING** | — |
| #13 — Operator được ủy quyền chạy SQL/restore | — | — | **PENDING** | — |
| #15 — QA + Security + Owner LOCAL GO | — | — | **PENDING** | — |

**Kết luận:** có đủ dữ liệu để reviewer bắt đầu thẩm định **tĩnh**, chưa có quyền CREATE/SQL/migration hoặc release. `RELEASE_NO_GO`.
