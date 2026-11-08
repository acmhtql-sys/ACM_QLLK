# ACM Stage4C — G03/G05/G06: Evidence Registry & Immutable Return Receipt RFC

**Ngày:** 08/11/2026 · **Loại:** DBA/AppSec design proposal, **REVIEW ONLY** · **Trạng thái:** `NEEDS-DESIGN / RELEASE_NO_GO`.

> **KHÔNG PHẢI SQL, PRISMA MIGRATION, PERMISSION, DBA APPROVAL HAY DEPLOYMENT.**
> Không tự chạy CREATE, ALTER, backfill, migration, restore, kết nối PG17, dùng dữ liệu thật, hoặc bật API Stage4C từ tài liệu này. Thiết kế phải được DBA và AppSec độc lập duyệt trên đúng commit, sau đó chủ dự án phê duyệt cổng PostgreSQL 17 #12 và SQL #13 riêng.

## 1. Nguồn được đối chiếu và vấn đề gốc

- **RC5 hiện tại** (`apps/api/prisma/schema.prisma`, nguồn tại PR #89): `ReturnTransaction` có `returnNumber @unique` **phân biệt hoa/thường tùy collation**, `borrowRequestId`, `receiverId` và các `ReturnDetail`; **không có BorrowReturnOperation**. `IdempotencyRecord.key @unique` toàn cục, `expiresAt` của legacy return là **24 giờ**; `transactionId` liên kết `StockTransaction`, **không liên kết ReturnTransaction**. `ReturnDetail.returnTransaction` hiện có `onDelete: Cascade`.
- **Stage4C inert skeleton**, branch `review/d8-wr7e-stage4c-inert-20261029`: `BorrowReturnOperation` chỉ có `physicalEvidenceRef` với `@@unique([borrowRequestId,physicalEvidenceRef])` và FK composite nullable tới receipt. Không có đủ custody RECEIVE/VERIFY, durable scoped key, global case-insensitive uniqueness, pending partial unique, QC/LOST ledger, hoặc retention.
- **Quyết định owner G03 tại [#11](https://github.com/acmhtql-sys/ACM_QLLK/issues/11):** mã do ACM cấp **duy nhất toàn ACM, không phân biệt hoa/thường**; code đã phát cho `CANCELLED` **không dùng lại**; **mỗi lần trả có một mã riêng**; replay cùng operation/key/payload/actor hợp lệ phải lấy lại kết quả cũ, không ghi tồn lần nữa.
- **Format BIZ-01:** ASCII `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`; giữ nguyên mã hiển thị, so sánh theo mã canonical. `ACM-001` và `acm-001` va chạm.
- **G05/G06 chưa khép:** kiểm tra RC5 bằng `borrowRequestId + returnNumber + receiverId` trong [PR #87](https://github.com/acmhtql-sys/ACM_QLLK/pull/87) là biện pháp tạm giảm rủi ro, **không chứng minh key A đã tạo receipt A**. Một receipt cũ cùng borrow + cùng receiver vẫn có thể bị gắn nhầm sang key B. Kiểm thử PG16/Chromium giả lập không chứng minh PG17, human approval hoặc durable once-only.

### Phát hiện thiết kế phải xử lý trước khi chọn UNIQUE

Nếu có **hai nguồn cấp mã**: `ReturnTransaction.returnNumber` của RC5 và `BorrowReturnOperation.physicalEvidenceRef` của Stage4C, đặt UNIQUE chỉ trên một bảng **không bảo đảm** một namespace mã toàn ACM. Đặc biệt `CANCELLED` không có receipt nhưng phải giữ mã vĩnh viễn. Phải thống nhất **namespace phát hành mã** trên cả hai thế hệ, hoặc DBA/owner xác nhận rõ mã legacy có thuộc cùng namespace hay không bằng chứng cứ nghiệp vụ (không suy đoán chỉ từ định dạng `RT-...`).

## 2. Phương án đề nghị thẩm định: một Evidence Code Registry làm điểm cấp mã

**Proposal A — ưu tiên để DBA thẩm định, chưa được phê duyệt.** Thêm model/bảng `evidence_code_registry` dùng để **giữ chỗ mã một lần và không xóa**, tách khỏi việc COMMIT thực tế. **Issuer phải là dịch vụ ACM được ủy quyền; PREPARE không được tự nhập một mã bất kỳ để chiếm giữ namespace vĩnh viễn.** Phương án cụ thể (server tự phát mã hoặc chỉ nhận mã có trong inventory ACM đã phát) còn cần DBA/owner/AppSec duyệt:

| Trường khái niệm | Mục đích/ràng buộc đề nghị |
|---|---|
| `id UUID PRIMARY KEY` | Định danh mã cấp duy nhất, do server phát |
| `original_ref TEXT NOT NULL` | Mã gốc để hiển thị; CHECK regex BIZ-01 theo ASCII; không ghi raw vào log |
| `canonical_ref TEXT NOT NULL` | `lower(original_ref)` được **database bảo đảm**, global `UNIQUE`; DBA chọn DB-generated column hoặc `CHECK (canonical_ref = lower(original_ref))` sau khi kiểm chứng collation và Prisma drift |
| `issued_at`, `issued_by_id`, `issuer_source` | Phân biệt `RC5_LEGACY` và `STAGE4C_OPERATION` khi nguồn mã đã được xác minh; FK/role/time provenance |
| `retired_at / cancellation evidence` (nếu có) | Chỉ ghi trạng thái lịch sử; **KHÔNG nhả UNIQUE**, `DELETE`/reuse mã không được phép |
| `operation_id` (không đặt FK ở registry trong phương án khuyến nghị) | Đề xuất **chỉ một chiều FK**: `BorrowReturnOperation.evidence_registry_id NOT NULL UNIQUE` → `evidence_code_registry.id` `ON DELETE RESTRICT`. Không tạo FK ngược registry → operation tránh vòng; legacy ownership là luồng xử lý riêng theo quyết định DBA/owner |

**Tại sao registry?** Code đã cấp trong PREPARED hoặc CANCELLED phải còn được giữ dù chưa có `ReturnTransaction`. Một unique `lower(return_transactions.returnNumber)` không bao phủ mã này. Một unique `lower(borrow_return_operations.physicalEvidenceRef)` không bao phủ legacy receipts. Registry thống nhất namespace trong DB thay vì giả định application-side `findFirst` có khả năng chặn race.

**AppSec — chống chiếm mã và oracle:** Mã chứng từ phải **được ACM cấp**, không phải client tự chọn rồi PREPARE sẽ chiếm mã vĩnh viễn. Thiết kế ưu tiên server cấp mã sau xác thực/phân quyền/kiểm tra rate limit; hoặc chỉ claim mã từ danh sách đã được issuer ACM cấp riêng và đã xác minh. Cần audit mọi nỗ lực claim bị từ chối, hạn chế tần suất theo user/operation và ngăn bulk reservation. 409 chung chỉ che lab/borrow sở hữu, không ngăn oracle “mã đã tồn tại”; đối với mã chưa cấp và mã đã chiếm, phản hồi/timing nên được thiết kế tránh phân biệt khi không có quyền đọc, không tiết lộ trạng thái mã, không phản chiếu raw ref. **Chưa có issuer/claim API được duyệt hay mở**; mọi kiểm tra trên snapshot thuần chỉ là kiểm tra chính sách.

**Phương án thay thế DBA có thể đánh giá:** dùng một bảng phát hành duy nhất hiện có nếu DBA chứng minh (a) có thể reserve trước COMMIT, (b) không mất mã sau CANCELLED, (c) bao phủ RC5 legacy đã phát, (d) uniqueness toàn hệ thống case-insensitive ngay cả khi 2 session/2 node. Phương án expression unique trên riêng operations **không đủ** nếu RC5 và Stage4C chia sẻ namespace.

### Cẩn trọng với lựa chọn canonical

- `CHECK(canonical_ref = lower(canonical_ref))` **SAI mục tiêu**, vì không ràng buộc canonical với `original_ref`: `'ACM-001'→'acm-999'` vẫn qua CHECK yếu.
- Nếu ứng dụng tính `lower`, DB phải **xác thực lại** `canonical_ref = lower(original_ref)` hoặc tự tạo cột generated. **Quan trọng: PostgreSQL `lower()` có thể chịu ảnh hưởng LC_CTYPE/collation**; `ACM-I` so với `acm-i` có rủi ro trong locale khác ASCII như Turkish. DBA cần kiểm chứng lựa chọn `COLLATE "C"` hoặc một cơ chế ASCII deterministic tương đương cho biểu thức/cột canonical và constraint; format của `original_ref` vẫn phải CHECK ASCII BIZ-01. Cần thẩm định Prisma migration drift trước khi chốt phương án.
- `UNIQUE` phải bao phủ **mọi trạng thái** (kể cả CANCELLED), không dùng partial unique `WHERE state <> 'CANCELLED'`. **Giữ mã vĩnh viễn không được dựa duy nhất vào FK RESTRICT**: DBA cần đánh giá quyền hạn ứng dụng (INSERT-ONLY), cơ chế chống UPDATE/DELETE (`BEFORE UPDATE/DELETE` trigger hoặc policy tương đương), audit append-only; không cho phép sửa `original_ref`/`canonical_ref`/identity để tái sử dụng. Một bản restore cũ có thể bỏ sót các mã cấp sau backup, vì vậy cần quy trình reconciliation sổ mã trước khi mở cấp mã sau restore.
- Nếu hai bảng có dữ liệu legacy, **không tự động đoán mapping** dựa theo timestamp, ghi chú, người nhận hoặc định dạng số. Cần kiểm toán nguồn mã và quyết định owner/DBA trước backfill có kiểm soát.

## 3. G05/G06 — durable exact-once claim, 365 ngày và chứng từ bất biến

Đề nghị mở rộng `BorrowReturnOperation` (hoặc một bảng durable claim 1:1):

| Trường/quan hệ | Quy tắc đề nghị để DBA quyết định |
|---|---|
| `borrow_request_id UUID`, `created_by_id UUID`, `idempotency_key` / scoped hash | `UNIQUE(borrow_request_id, idempotency_key)` theo BIZ-05. Cần xem xét chính sách key raw/digest và va chạm hash; actor, payload canonical và endpoint phải được ràng buộc, không cho khác actor/key/scope trở thành replay hợp lệ |
| `canonical_request_hash`, payload immutable | Payload gửi lại khác → 409; snapshot server-authoritative, không tin hash từ client |
| `evidence_registry_id UUID NOT NULL UNIQUE` | FK `ON DELETE RESTRICT` tới mã ACM đã cấp, 1 code / 1 operation; ID này giữ nguyên từ PREPARED qua CANCELLED/COMPLETED |
| `state` | `PREPARED / RECONCILIATION_REQUIRED / COMPLETED / CANCELLED`; một pending / borrow bằng partial unique predicate **chỉ** trạng thái PREPARED và RECONCILIATION_REQUIRED, không trộn `PENDING` của `IdempotencyRecord` |
| `received_by_id/at`, `verified_by_id/at` | Người RECEIVER khác VERIFY; VERIFY chỉ ADMIN/LAB_MANAGER hợp lệ, phải đối chiếu role DB và custody event thật |
| `return_transaction_id UUID NULL UNIQUE` | Khi COMPLETED phải có, và `(return_transaction_id, borrow_request_id)` phải FK tới `ReturnTransaction(id,borrowRequestId)`. Một receipt không thuộc 2 operation và không trỏ receipt của phiếu khác |
| `committed_by_id/at`, cancel actor/reason/time | Các trạng thái terminal phải kiểm tra consistency và bất biến; không cho re-COMMIT hoặc chuyển trạng thái sau COMPLETED |
| `retention_until` / non-purge policy | Durable claim và code registry phải tồn tại tối thiểu **365 ngày**; registry code *không được tái sử dụng vĩnh viễn*. Generic RC5 `IdempotencyRecord.expiresAt` 24h không phải cơ sở bảo đảm retention mới |

**FK chain cần DBA vẽ/duyệt:** một code registry → một operation → tối đa một receipt; một receipt → nhiều ReturnDetail thuộc đúng borrow; movement/audit và stock tham chiếu đúng receipt/operation; deletion policy `RESTRICT` và immutable append-only, đặc biệt phải xử lý `ReturnDetail.onDelete: Cascade` legacy. Có thể cần audit/trigger/permission chống sửa, không coi relation Prisma `@unique` là bằng chứng immutable.

### Tính nguyên tử

Trong **một Prisma serializable/PG17 transaction**, theo thứ tự lock được DBA duyệt, phải đọc lại operation, source BorrowDetail/StockBalance, custody events và unique claim; xác nhận receipt/operation chưa COMMIT, mã đã cấp; tạo ReturnTransaction + ReturnDetail, cập nhật returnedQuantity và ledger/kho **quarantine-first**, ghi AuditLog, rồi chuyển operation thành COMPLETED và gắn đúng `return_transaction_id`. Nếu fail trước COMMIT, toàn bộ receipt/stock/audit/claim phải rollback; sau timeout có thể đã COMMIT thì **chỉ GET trạng thái/đối soát, không tự phát thêm mã hoặc POST lại bằng key mới**.

**G07–G10 còn độc lập:** GOOD/DAMAGED vật lý vào quarantine; GOOD chỉ release sau QC độc lập; LOST phải có incident riêng và không chứng nhận RECEIVE giả; 2 session/lock-order cùng RC5; không có feature cutover cho đến khi chứng minh.

## 4. Cổng kiểm toán trước bất kỳ migration nào (CHƯA THỰC HIỆN)

1. **Owner + DBA phân loại RC5 legacy `ReturnTransaction.returnNumber`:** có phải cùng một namespace mã ACM chính thức không? Nếu có, inventory từng số đã cấp ở từng lab, mã khác chữ hoa/thường, receipt đã xóa hoặc hậu kiểm; xác định nguồn chuẩn để nhập registry. Không dùng `notes`/timestamp/receiver để tự suy diễn operation/key.
2. **DBA chọn thiết kế canonical:** generated column hoặc trực tiếp `CHECK(canonical=lower(original_ref))` + `UNIQUE`; kiểm tra ASCII regex, collation, forward DDL, Prisma drift, index online/locking, quyền migration và rollback có điều kiện.
3. **Reviewer chốt G05/G06:** UUID/FK composite, scope key, auth, retention, receipt immutable, `CANCELLED` reserve forever; mô tả chi tiết delete/update policies và mapping old records.
4. **DBA duyệt source+hash DDL trên #11**; owner + reviewer khác người duyệt PG17 CREATE #12; SQL/backup/restore phải được duyệt **riêng** tại #13. Không gộp “đồng ý tiếp tục dự án” thành các phê duyệt này.
5. **Chỉ sau đủ gate:** tạo PG17 cô lập mới, inventory/collision **read-only**, khôi phục nguồn synthetic theo chứng cứ, migration + guarded rollback, E2E/race/backup-restore và bốn vai trò UAT theo #26. Không đụng cloud/staging/Windows PostgreSQL đang chạy.
   **Restore-code safety G11:** không bật chức năng phát mã ngay sau khi restore từ bản sao cũ. So sánh issuance registry ở bản phục hồi với audit/ledger nguồn độc lập được lưu an toàn ngoài thời điểm backup, truy tìm mọi mã đã phát sau thời điểm backup, đối soát/khóa tái cấp từng mã trước khi trả lại quyền cấp mã; nếu không chứng minh đủ thì giữ hệ thống ở `RELEASE_NO_GO`.
6. **AppSec:** review oracle 409 chung, 23505/P2002/40001/P2034 và trạng thái transaction (không gộp nhầm commit-unknown thành retry), role/IDOR, rate limit, raw code/PII log, tài liệu rollback/cutover.

## 5. Ma trận acceptance có thể kiểm chứng

| ID | Kịch bản bắt buộc | Kết quả mong đợi |
|---|---|---|
| REG-01 | 2 lab, 2 borrow, mã `ACM-001` vs `acm-001` | DB có đúng 1 issuance; bên kia 409 chung, không lộ borrow/lab |
| REG-02 | PREPARED rồi CANCELLED, mã cũ được đề nghị phát lại | DB từ chối mã, kể cả khác lab / actor / borrow |
| REG-03 | Cùng một borrow, 2 đợt trả hợp lệ | 2 operation, 2 mã riêng, stock posting tương ứng không lặp |
| REG-04 | Replay cùng operation/key/actor/payload | Trả về *đúng mã cũ + receipt cũ*, không tạo transaction/stock/audit mới |
| REG-05 | Cùng borrow/receiver nhưng key B lấy receipt đã COMMIT của key A | **Không** báo COMPLETED cho key B; yêu cầu đối soát, no side effect |
| REG-06 | Cùng key khác actor, borrow hoặc canonical payload | Fail closed 409, không lộ định danh/nguồn collision |
| REG-07 | Replay sau 24h và tới ≥365 ngày | Persistent scoped claim vẫn chứng minh COMMIT 1 lần, không phụ thuộc generic RC5 TTL |
| REG-08 | 2 session PREPARE cùng borrow, 2 session COMMIT cùng operation | 1 pending; 1 immutable receipt/posting; kẻ thua rollback/an toàn |
| REG-09 | Operation cross-borrow receipt, foreign receiver, receipt bị xóa | FK/role/replay guard từ chối; không dùng cache để giả COMMIT |
| REG-10 | Dữ liệu legacy trùng case / trùng registry / missing provenance | Báo cáo collision, HOLD migration; không backfill hoặc sửa dữ liệu tự động |
| REG-11 | RECEIVE==VERIFY, role không hợp lệ, missing custody | COMMIT 403/409 không side effect, audit từ chối theo thiết kế |
| REG-12 | GOOD/DAMAGED chưa QC; LOST không có vật lý | Quarantine-first, available không tăng; LOST cần incident riêng |
| REG-13 | Lỗi giữa receipt, stock, detail, audit hoặc network 504/commit-unknown | Atomic rollback hoặc read-only reconciliation; không phát thêm mã |
| REG-14 | Unauthorized GET/POST, duplicate oracle, rate limiting | JWT/RBAC/IDOR pass, 409 chung, không log raw code hoặc metadata |
| REG-15 | PG17 forward/guarded rollback/backup-restore và Windows 4-role UAT | Artifact catalog, source SHA, restore hash, QA/owner signoff rõ ràng |

## 6. Các quyết định cần DBA/owner/QA ghi trực tiếp

| Quyết định | Người chịu trách nhiệm | Trạng thái |
|---|---|---|
| Dùng registry chung hay giải pháp chứng minh tương đương; legacy returnNumber có thuộc namespace ACM không | DBA + owner xác nhận nghiệp vụ | **OPEN** |
| Canonical source-of-truth, collations/UNIQUE, giải pháp cho Prisma drift, collision cũ | DBA độc lập | **OPEN** |
| FK operation–registry–receipt, pending uniqueness, immortal cancellation, 365d claim, immutable receipt | DBA độc lập + AppSec | **OPEN** |
| Transaction locking, QC/LOST/asset ledger và non-destructive rollback | DBA + QA + owner | **OPEN** |
| Review đúng SHA, P0/P1 đã xử lý, PG17 CREATE #12, SQL #13, UAT #26, GO #15 | Người có thẩm quyền tương ứng | **PENDING/HOLD** |

**Kết luận:** Đây là **một phương án để DBA chọn/đề nghị sửa**, không phải sự chấp thuận cho schema nào. Global `UNIQUE` chưa có trong DB vận hành. Stage4C phải tiếp tục **hard-503**, RC5 legacy không được nâng thành Stage4C hay coi đạt PG17. **`RELEASE_NO_GO`**.
