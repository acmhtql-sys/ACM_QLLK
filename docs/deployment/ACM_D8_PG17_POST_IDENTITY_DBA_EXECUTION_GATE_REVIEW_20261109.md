# ACM D8 — PG17 post-identity / DBA Stage4C execution gate review

**Ngày tổng hợp:** 2026-11-09 (Asia/Ho_Chi_Minh)  
**Loại:** REVIEW-ONLY / NO SQL / NO DB WRITES  
**Nhánh nguồn cố định:** [Draft PR #89](https://github.com/acmhtql-sys/ACM_QLLK/pull/89), commit `a7fa15b805e965a0aa9cbb87f617ee5abcae092e`  
**Kết luận:** `PG1D_IDENTITY_PASS` · `STATIC_SECURITY_PASS_WITH_LIMITATIONS` · `DBA_FINAL_DDL_PENDING` · `PG3_EXECUTION_HOLD` · **`RELEASE_NO_GO`**

> Đây là tài liệu đối chiếu và checklist cần quyết định, **không phải** Prisma schema cuối, SQL migration, DDL, script chạy thử, DBA/AppSec execution approval hay chứng nhận môi trường đã cô lập hoàn toàn. Không chạy `prisma migrate`, `psql` writer, `initdb` lần hai, rollback/restore, hoặc can thiệp UAT/Windows PostgreSQL hiện hữu, GitHub `main`, Render, Supabase và dữ liệu thật. Không tự động mở Stage4C writer/503 gate.

## 1. Bằng chứng môi trường mới đã xác nhận, đúng phạm vi

| Cổng | Bằng chứng | Kết luận có giới hạn |
|---|---|---|
| PG0C/PG1C preflight | [Issue #12 preflight](https://github.com/acmhtql-sys/ACM_QLLK/issues/12#issuecomment-6724121184) | Branch/head/9 paths + 12 hashes, D7 Git EOL 4/4, fake transaction 20/20; không chứng minh writer PG17 |
| PG1C Create | [Issue #12 Create PASS](https://github.com/acmhtql-sys/ACM_QLLK/issues/12#issuecomment-6724168552) | Cluster **mới**, NEW-ONLY, PostgreSQL 17.11; không động tới service hiện hữu |
| PG1D FIX3 | [Issue #12 identity PASS](https://github.com/acmhtql-sys/ACM_QLLK/issues/12#issuecomment-6729354176) | SHA-verified FIX3 và hai phê duyệt riêng; `postgres` / `acm_d8_admin`, endpoint `127.0.0.1:55433`, PGDATA chính xác `%LOCALAPPDATA%\ACM_D8_PG17_55433_NEW_ONLY`, version `170011`, `transaction_read_only=on`, `pg_is_in_recovery()=f` |
| Static config & HBA | [Issue #12 security evidence](https://github.com/acmhtql-sys/ACM_QLLK/issues/12#issuecomment-6729480763) | `port=55433`, `listen_addresses='127.0.0.1'`; `postgresql.auto.conf` 0 active directives; six HBA entries use `scram-sha-256`; không chứng minh tất cả cấu hình runtime |
| Windows ACL & existing service | Cùng bằng chứng Issue #12 | PGDATA/`postgresql.conf`/`pg_hba.conf`: owner local `ACER`, SYSTEM/Administrators/ACER FullControl inherited; `AreAccessRulesProtected=False`; existing `postgresql-x64-17` Running |

**Trạng thái cổng bảo mật (kiểm tra tĩnh 09/11):** PGDATA, config/HBA và ACL có dấu hiệu phù hợp với cluster NEW-ONLY. Đã xác định được **hai quan sát bổ sung**: `max_connections` khai báo 100 (dòng 65) rồi 30 (dòng 853), theo thứ tự cấu hình **giá trị cuối trong tệp là 30**; một ACE `S-1-15-3-1024-...` trên **thư mục cha** chỉ cấp `ExecuteFile, Synchronize` với `InheritanceFlags=None`, không xuất hiện trong danh sách ACE của PGDATA/config/HBA. Hai điểm này không còn là sai lệch cấu hình tĩnh. **Không được suy ra runtime `max_connections` đã được xác minh qua máy chủ**; không có kiểm thử hệ thống mạng/firewall/toàn bộ cấu hình hiệu lực hoặc chứng nhận isolation AppSec. Các rule `::1/128` trong HBA không chứng minh IPv6 TCP listener.

## 1A. Bằng chứng cấu hình tĩnh & ACL chi tiết — cập nhật 2026-11-09

Người vận hành đã chạy các câu lệnh PowerShell **đọc tệp và ACL**, không sửa hệ thống, SQL hay service. Đây là báo cáo từ đầu ra người vận hành, không phải bài thử trực tiếp của GitHub trên máy Windows.

- **21 assignment lines active** trong `postgresql.conf`: `datestyle`, `default_text_search_config`, `dynamic_shared_memory_type`, `lc_messages`, `lc_monetary`, `lc_numeric`, `lc_time`, `listen_addresses`, `log_connections`, `log_directory`, `log_disconnections`, `log_file_mode`, `log_timezone`, `logging_collector`, `max_connections` (**2 lần**), `max_wal_size`, `min_wal_size`, `port`, `shared_buffers`, `timezone`. Không có directive include/config redirection được nhận diện trong tệp chính; `postgresql.auto.conf` trước đó có 0 directive active.
- **`max_connections` đã xác định thứ tự/giá trị:** dòng **65** là `max_connections = 100` (kèm comment `change requires restart`); dòng **853** là `max_connections = 30`. Theo PostgreSQL 17, khi tệp cấu hình chứa nhiều dòng cho cùng tham số, chỉ **dòng cuối cùng** được lấy làm thiết lập của tệp: [pg_file_settings](https://www.postgresql.org/docs/17/view-pg-file-settings.html). Giá trị **cấu hình cuối trong tệp = 30**; không suy diễn rằng giá trị runtime đã được kiểm tra, vì chưa chạy `SHOW` hoặc xác minh `pg_settings`, và tham số này cần restart nếu thay đổi sau startup. **Không tự edit/restart** để sửa dòng trùng chỉ vì trùng.
- **ACL thư mục cha** `%LOCALAPPDATA%`: owner `DESKTOP-T4JBFIE\\ACER`; một ACE `S-1-15-3-1024-132000074-4282653157-1538399343-3756252210-1772340707-3911835171-3004464742-3244162316` có `Rights=ExecuteFile, Synchronize`, `Type=Allow`, `InheritanceFlags=None`, `PropagationFlags=None`, `IsInherited=False`. ACE này **không được đánh dấu truyền quyền xuống con**, và không xuất hiện trong ACL cụ thể đã in của PGDATA hoặc hai tệp config.
- **ACL trên PGDATA**, `postgresql.conf`, `pg_hba.conf`: `AreAccessRulesProtected=False`, owner `DESKTOP-T4JBFIE\\ACER`, **chỉ 3 ACE Allow FullControl được kế thừa**, dành cho SYSTEM, Administrators, ACER. Trên PGDATA: `ContainerInherit,ObjectInherit`; trên hai tệp config: `InheritanceFlags=None`. Đây là danh sách ACE được hiển thị, không phải bài chứng minh hiệu quả mọi capability/tokens của Windows hoặc kiểm định toàn bộ cây tệp.
- **Windows service hiện hữu** `postgresql-x64-17` vẫn `Running`.
- **Verdict sau hai kiểm tra:** `STATIC_CONFIG_DUPLICATE_RESOLVED`, `PARENT_SID_NONINHERITING_BY_FLAGS`, `NEW_ONLY_ACL_REVIEW_CONSISTENT_WITH_SCOPE`; **`SECURITY_ISOLATION_END_TO_END_NOT_CERTIFIED`** và **`RELEASE_NO_GO`**.

**Hành động tiếp theo:** DBA/AppSec đọc bằng chứng, cân nhắc xác minh runtime security bằng giao thức chỉ đọc được phê duyệt rõ ràng nếu cần. Không đổi ACL, không restart PostgreSQL, không SQL/DDL/migration/restore và không dùng dữ liệu thật.

## 2. Baseline source — không đồng nhất với schema cuối

- **RC5/current on PR #89 head:** [`apps/api/prisma/schema.prisma`](https://github.com/acmhtql-sys/ACM_QLLK/blob/a7fa15b805e965a0aa9cbb87f617ee5abcae092e/apps/api/prisma/schema.prisma), Git blob SHA-1 `ec969e68f00e17fe2b037dc4c5b58fcff6744983`, **19 models**. `ReturnTransaction.returnNumber @unique` tồn tại; legacy `IdempotencyRecord` liên kết `StockTransaction` và TTL không đủ chứng minh G05/G06.
- **Stage4C inert snapshot:** [`apps/api/prisma/schema.prisma` trên nhánh review](https://github.com/acmhtql-sys/ACM_QLLK/blob/review/d8-wr7e-stage4c-inert-20261029/apps/api/prisma/schema.prisma), Git blob SHA-1 `fbf12e51a53c2ecd128dd24d438c100b71ea850e`, **20 models** gồm `BorrowReturnOperation`. **Chỉ là skeleton**: `@@unique([borrowRequestId, physicalEvidenceRef])` không chứng minh global case-insensitive; thiếu verified/received custody, code registry, durable scoped key, QC/LOST và immutability.
- **G03 proposal:** [RFC G03/G05/G06 tại PR #89](https://github.com/acmhtql-sys/ACM_QLLK/blob/a7fa15b805e965a0aa9cbb87f617ee5abcae092e/docs/deployment/ACM_STAGE4C_GLOBAL_EVIDENCE_REGISTRY_G03_G05_G06_RFC_20261108.md) yêu cầu **một registry cấp mã toàn ACM**, bao phủ RC5 legacy và Stage4C; code bị hủy không tái sử dụng, case-insensitive ASCII, per-operation code, durable 365-day claim.
- **DBA quyết định thiết kế:** [Issue #11: G01–G10 DESIGN-APPROVED, G11 BLOCK](https://github.com/acmhtql-sys/ACM_QLLK/issues/11#issuecomment-6723126432). [Đối chiếu giới hạn quyết định](https://github.com/acmhtql-sys/ACM_QLLK/issues/11#issuecomment-6723281735): đây **không phải** chữ ký byte-exact final DDL, và reviewer DBA từng khai báo tham gia PR #37/chưa xác minh độc lập.
- **PG3 plan:** [Issue #13](https://github.com/acmhtql-sys/ACM_QLLK/issues/13) được DBA + AppSec đồng ý **kế hoạch** [#6723211306](https://github.com/acmhtql-sys/ACM_QLLK/issues/13#issuecomment-6723211306) / [#6723215003](https://github.com/acmhtql-sys/ACM_QLLK/issues/13#issuecomment-6723215003), nhưng [entry-gate clarification](https://github.com/acmhtql-sys/ACM_QLLK/issues/13#issuecomment-6723280747) yêu cầu final SQL/Prisma SHA + authority cho **các file thực thi cụ thể**. Identity PG1D đã bổ sung ở [#13 update](https://github.com/acmhtql-sys/ACM_QLLK/issues/13#issuecomment-6729485594).

**Quan sát cần DBA quyết định:** G01 ghi **“19→20 model trong một migration”** tại quyết định thiết kế, nhưng G03 lại yêu cầu thêm `evidence_code_registry`, G07 model QC độc lập và G09 incident/state machine. Như vậy **không được mặc định 20 model là tổng số model cuối**; cần bảng liệt kê mọi model/tables, mô tả liệu QC/Incident/registry là model độc lập hay đã được hợp nhất, và xác nhận số model chính xác trước khi tạo DDL. Đây là **gap trong việc cụ thể hóa thiết kế**, không phải phê duyệt tự ý tăng model.

## 3. Ma trận G01–G11: điều kiện hoàn tất thực sự

| ID | Thiết kế tại #11 | Artifact/chứng cứ phải có trước SQL/PG3 |
|---|---|---|
| G01 | DESIGN-APPROVED | Canonical `schema.prisma` duy nhất từ RC5 hiện hành; inventory 19-model baseline, tất cả model mới + quan hệ; **số model cuối cần DBA chốt**, một forward migration, guarded rollback |
| G02 | DESIGN-APPROVED | Custody `receivedBy` / `verifiedBy`, timestamp timezone, role+FK+CHECK `verifiedBy <> receivedBy`, audit chứng từ; không gán VERIFY = RECEIVE |
| G03 | DESIGN-APPROVED (Proposal A) | Registry global ASCII-case-insensitive, canonical được DB bảo đảm với `COLLATE "C"`, UNIQUE toàn namespace bao phủ RC5+Stage4C và CANCELLED forever; nguồn legacy và collision/backfill thủ công cần owner+DBA chốt; chống UPDATE/DELETE/claim tùy ý |
| G04 | DESIGN-APPROVED | Partial UNIQUE đúng `PREPARED` + `RECONCILIATION_REQUIRED`, 2-session PREPARE, lỗi DB `23505/P2002` → 409 chung, không lộ constraint hay mã |
| G05 | DESIGN-APPROVED | Durable `borrow+key` và canonical payload/actor/endpoint; giữ ≥365 ngày, độc lập TTL 24h, replay đúng receipt; receipt/claim không bị nhầm với idempotency cache |
| G06 | DESIGN-APPROVED | Composite FK `(returnTransactionId,borrowRequestId)` → `(id,borrowRequestId)`, UNIQUE đích, immutable COMMITTED receipt, once-only posting, non-destructive rollback |
| G07 | DESIGN-APPROVED | QC model per `ReturnDetail`, người phê duyệt QC độc lập; LOST phải có sự cố hợp lệ, không tạo RECEIVE giả |
| G08 | DESIGN-APPROVED | Quarantine-first atomic ledger; CHECK `reserved + quarantined + kitAllocated <= onHand`, không cộng tồn 2 lần khi QC release |
| G09 | DESIGN-APPROVED | State machine `ReturnDetail` – Incident – Asset; xử lý LOST/serial và audit tồn kho |
| G10 | DESIGN-APPROVED | Lock order chung RC5/Stage4C, transaction SERIALIZABLE, xử lý `40001/40P01/P2034`; không retry mù trạng thái COMMIT unknown |
| G11 | **BLOCK** | Identity PG17 đã PASS nhưng **chưa có** approved migration, PG17 catalog/drift, negative checks, two-session race, backup/restore, artifact hash và independent signoff |

## 4. Những điểm phải có trong **một** final review packet DBA (chưa tồn tại)

1. `schema.prisma` canonical G01–G10, **Git commit + file SHA-256**, bản diff so với RC5; không dùng SQL 2A/2B review-only làm migration.
2. **Forward SQL** và **guarded rollback SQL** tách riêng, mỗi file có SHA-256. Chỉ review ngoại tuyến; SQL thực thi chưa được phép. Rollback phải fail-closed khi tồn tại operation/receipt/registry đã cấp, không DROP dữ liệu hợp lệ.
3. Contract các bảng/constraints: registry global; provenance; chuẩn hóa ASCII `COLLATE "C"` + CHECK khớp `original_ref`; unique, partial unique, composite FK; trạng thái, delete/restrict, bất biến/tamper proof; transaction/writer error mapping.
4. Quyết định OWNER+DBA về `ReturnTransaction.returnNumber` lịch sử: có cùng namespace mã ACM không, inventory nguồn nào tin cậy, collision `ACM-001`/`acm-001` và CANCELLED, quy trình xử lý mà **không backfill tự động**.
5. Kế hoạch PG17 **synthetic-only**: database mục tiêu khác real/UAT, nguồn backup/restore, operator, khung thời gian, mã SHA mỗi artifact, approval DBA/AppSec cho đúng bytes + owner permission cấp riêng để chạy SQL/rollback.
6. Verification matrix: PostgreSQL catalog + Prisma drift; constraint negative controls; race 2 sessions; COMMIT exactly once; 409 không rò rỉ; backup/restore và registry anti-reissue; mọi kết quả fail phải STOP, không tự xóa hay restart cluster.

## 5. Quyết định hiện tại và công việc an toàn có thể tiến hành

**Được phép trong nhánh review riêng:** phân tích source, xây dựng danh mục model/DDL và thiết kế offline, kiểm tra SHA/commit, chuẩn bị report, chạy test thuần không chạm DB nếu đã audit và được duyệt, review GitHub Draft PR. **Chưa được phép:** chạy bất kỳ schema migration/DDL/DML/seed/concurrency-writer/rollback/restore nào trên PG17 hoặc môi trường khác, merge `main`, bật Stage4C router 503, hoặc sửa Render/Supabase.

**Ưu tiên reviewer:**
- OWNER + DBA: chốt namespace RC5 legacy và **model/table inventory cuối**; kiểm tra G01 mâu thuẫn giữa “20 model” và các model registry/QC/Incident thực sự.
- DBA: thiết kế FK/constraints/guards và tạo một bộ final schema + forward/guarded rollback **chỉ dưới dạng ứng viên review**, ghi đúng commit/file hashes; không dùng `prisma migrate deploy`.
- AppSec: xác minh generic 409, registry immutable, issuer anti-oracle/rate limit, role/IDOR và lỗi serialization.
- QA/Owner: xác nhận backup+restore synthetic-only, negative matrix, bằng chứng PG17 và signed execution gate tại #13.

**Dứt khoát chưa GO**: `PG1D_IDENTITY_PASS` không thay thế `G11`; `DESIGN-APPROVED` không thay thế phê duyệt DDL. Giữ `RELEASE_NO_GO`, `PG3_EXECUTION_HOLD`.
