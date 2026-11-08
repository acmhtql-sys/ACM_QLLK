# ACM — Kế hoạch khắc phục 5 cổng chặn: DBA, AppSec, PostgreSQL 17, Return Writer, UAT

**Ngày:** 2026-11-08. **Cấp tài liệu:** kỹ thuật, REVIEW ONLY. **Trạng thái:** `RELEASE_NO_GO`.
**Cơ sở mã nguồn:** Draft PR #70, `94e4cb2bf8613ede811b5c65f81143364eb904a2`, cộng nhánh Stage4C batch preflight đang review. Các thay đổi trong tài liệu **không phải** phê duyệt con người và không cấp quyền ghi DB, tạo cluster, merge/deploy hay truy cập dữ liệu thật.

## 1. Các việc kỹ thuật đã có bằng chứng

- RC5/Zod 4: Draft PR #48; không xóa/phá tuyến mượn/trả legacy hay idempotent receipt.
- Review hub L1/L2/L4: Draft PR #67, 1.144 kiểm thử CI + Chromium mock 40 PASS/1 SKIP trên commit `c316f246...`.
- L4 file-handle: Draft PR #69 và #70. CI trên #70: shared 128 + API 503 + Web 409 + CI-local PG16 115 = **1.155 PASS**; Chromium mock trên cùng commit 40 PASS/1 SKIP; **chưa phải kiểm thử Windows/PG17**.
- Nhánh tài liệu này bổ sung **pure multi-line shared-stock batch preflight**: một kho bị ảnh hưởng bởi hai dòng trả phải kiểm toán theo tổng, không được lập hai kế hoạch độc lập từ cùng một số dư cũ. Đây chỉ là phương án mô phỏng; không import vào HTTP/Prisma writer.

## 2. Cổng DBA (#11) — người ký độc lập chưa có

| Hồ sơ | Đầu ra bắt buộc |
| --- | --- |
| [11 vấn đề G01–G11](./ACM_D8_STAGE4C_DBA_SCHEMA_GAP_DECISION_PACKET_20261108.md) | DBA trả lời từng vấn đề, không chỉ APPROVE chung |
| G01/G02/G06 | Mô hình operation, RECEIVER/VERIFY, FK, receipt độc nhất và trạng thái cuối |
| G03/G05 | Phạm vi uniqueness không phân biệt hoa/thường của evidence; idempotency scope/actor/TTL và lưu receipt >=365 ngày |
| G04/G10 | Partial unique pending, lock-order hai writer, xử lý 40001/40P01, 409 và retry |
| G07/G08/G09 | Quarantine-first GOOD/DAMAGED, QC claim once-only, LOST incident riêng và bất biến kế toán |
| G11 | Signed forward DDL/Prisma diff, rollback fail-closed, backup/restore và lịch sử migration |

**Tiêu chí đóng:** xác minh danh tính, chuyên môn và tính độc lập; ghi mỗi quyết định, SHA đã review, ngày UTC, minh chứng trên issue #11. Bất kỳ điều kiện chưa đạt => CHANGES_REQUESTED/BLOCK. Không lấy CI hoặc báo cáo AI làm chữ ký DBA.

## 3. Cổng AppSec (#42) — kỹ thuật có thể sửa nhưng không tự duyệt

Đánh giá độc lập exact current stack #48→#67→#69→#70 và nhánh này. Đặc biệt: JWT thực, role từ server, IDOR tại item/borrow/report/audit; 504 ambiguous/idempotency; 409 cross-source; payload validator; storage root-ancestor và delete-path TOCTOU; NTFS reparse/ACL; audit immutable/outbox và backup. Bản #70 chỉ giảm rủi ro FIFO và unbounded reads trên adapter **unmounted**, không giải quyết tất cả rủi ro L4. Không mở upload route vì mock test đạt.

**Tiêu chí đóng:** chuyên gia AppSec độc lập ghi phát hiện theo mức độ, exact source SHA, file/line, khai thác và kết quả tái kiểm; QA/security xác nhận không còn P0/P1 chưa được xử lý; không có signoff nào được tạo tự động.

## 4. Cổng PostgreSQL 17 (#12, #13) — hai quyền khác nhau

**Gate A: Cluster Create #12:** chủ dự án phê duyệt cụ thể phạm vi mới `%LOCALAPPDATA%\\ACM_D8_PG17_55433_NEW_ONLY`, `127.0.0.1:55433`; reviewer kỹ thuật **một con người khác** phê duyệt cùng bản script/hash. Sau khi xác thực ngoài chat: operator thực hiện PG0C baseline & PG1C Review; sau đó mới có thể Create cluster cô lập. Tuyệt đối không đụng service hiện có `postgresql-x64-17`.

**Gate B: SQL #13:** là phê duyệt riêng sau #11 + identity PG1D; pin schema/SQL hash, backup/restore, 2-session duplicate PREPARE/COMMIT, negative FK/UNIQUE/CHECK, serializable conflict, cancel/retry/rollback. Cho đến khi đủ cổng, **không `initdb`, Prisma migrate, SQL, import, seed hoặc cleanup tự động**.

**Tiêu chí đóng:** identity + catalog trước/sau, session logs đã ẩn thông tin, chứng từ immutable và thử restore trên DB độc lập, operator và người ký thật.

## 5. Return Writer (#14) — chưa có operational implementation

Hiện tại RC5 legacy return vẫn hoạt động theo source hiện hành, và tuyến Stage4C bị chặn 503 theo thiết kế. Các hàm BIZ-01..05, preflight, QC claim, conservation và batch preflight là **pure/unwired**, không được thay thế bằng mã giả DB.

Khi có quyết định DBA, cần triển khai giao dịch thật: authenticated RECEIVE + independent VERIFY + COMMIT với source-of-truth, shared lock ordering và Serializable transaction; one-time receipt/claim, idempotency lâu dài, atomic stock/detail/asset/audit, partial return và recovery 504, quarantine-first rồi QC mới tăng available. LOST sử dụng incident riêng. Hai phiên đồng thời, lỗi giữa transaction và legacy+new competition phải chứng minh không double-post. Giữ 503 đến khi #11–#14 PASS.

**Tiêu chí đóng:** pull request mã nguồn writer + migration được duyệt; CI/PG17 thật; test REST/E2E với JWT/RBAC, 2-session race, replays và rollback atomic. Fake/mocked transaction PASS không đủ.

## 6. UAT / phục hồi (#15, #26) — theo dữ liệu tổng hợp

| ID | Kịch bản người kiểm thử phải chứng minh |
| --- | --- |
| UAT-01 | 4 role ADMIN, LAB_MANAGER, TECHNICIAN, STUDENT: login/logout, JWT expired/invalid, chặn truy cập trực tiếp và RBAC |
| UAT-02 | Danh mục/search/CRUD/kit, tồn kho, báo cáo ADMIN-only, audit ADMIN-only, quá hạn |
| UAT-03 | Yêu cầu mượn và trả FULL/PARTIAL tại đúng kho nguồn; khác kho 409, duplicate idempotency không double-post |
| UAT-04 | Mất kết nối/HTTP 504 rồi GET return-status; không tự POST lại; hai session tranh khóa một nguồn |
| UAT-05 | Stage4C RECEIVE ≠ VERIFY, GOOD vào quarantine, QC mới tăng available, DAMAGED/LOST xử lý riêng (chỉ khi writer được duyệt) |
| UAT-06 | Lưu ảnh local/HTTP thực nếu được phê duyệt: JWT, IDOR, file ownership, audit, Windows ACL/reparse và orphan reconciliation |
| UAT-07 | Backup → restore **trên môi trường riêng**, reconcile số dư/chứng từ, RPO/RTO, rollback fail closed |
| UAT-08 | Mobile: chủ dự án quyết định PWA hay native Android/iOS tại issue #49; kiểm trên thiết bị/emulator thật theo phạm vi đã duyệt |

**Tiêu chí đóng:** QA có test matrix, expected/actual, browser/API/DB evidence link, reviewer và UTC; tất cả P0/P1=0; owner ký `LOCAL_GO` trên exact SHA. Mock Playwright Chromium không phải UAT bốn vai trò.

## 7. Luồng thực hiện nhanh nhất mà không vượt quyền

1. Hoàn tất tất cả review-only CI / unit / negative tests trên nhánh cách ly; không chạm `main`.
2. Tìm DBA và AppSec tình nguyện độc lập; ghi CHANGES_REQUESTED/BLOCK nếu chưa quyết.
3. Owner đưa phê duyệt **riêng** cho PG17 Create và chốt scope Web/PWA/native; reviewer kỹ thuật độc lập phê duyệt Create.
4. Operator có thẩm quyền kiểm tra hash, identity mới, rồi xin quyết định riêng cho SQL; thực hiện migration/restore/races trên DB cô lập.
5. Hoàn thành writer và khoá/claim/audit được DBA thẩm định; chạy UAT synthetic 4 role và restore.
6. Owner quyết định LOCAL GO; sau đó mới xem xét staging/cloud theo quyết định riêng. Không dùng tài khoản trả phí.

### Nhãn kết luận

- DBA: **PENDING HUMAN SIGNOFF**
- AppSec: **PENDING HUMAN SIGNOFF**
- PostgreSQL17 Create/SQL: **HOLD**
- Stage4C operational writer: **NOT YET WIRED / HOLD**
- Four-role physical UAT + restore: **NOT YET VERIFIED**
- Release: **RELEASE_NO_GO**
