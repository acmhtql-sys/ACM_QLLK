# ACM Stage4C — Phương án khi chưa có người duyệt nghiệp vụ và DBA độc lập

**Trạng thái:** PREPARE / REVIEW ONLY / NO-GO. **Ngày:** 2026-10-29.

Nguồn: [Hồ sơ quyết định nghiệp vụ & DBA](stage4c-business-dba-signoff-draft-20261029.md), [review nguồn Stage4C](uat-stage4c-source-review-20261029.md), GitHub issues [#11](https://github.com/acmhtql-sys/ACM_QLLK/issues/11), [#12](https://github.com/acmhtql-sys/ACM_QLLK/issues/12), [#13](https://github.com/acmhtql-sys/ACM_QLLK/issues/13), [#14](https://github.com/acmhtql-sys/ACM_QLLK/issues/14), [#15](https://github.com/acmhtql-sys/ACM_QLLK/issues/15), [#21](https://github.com/acmhtql-sys/ACM_QLLK/issues/21).

## Kết luận điều hành

Chủ dự án cho biết **chưa có người được phân công** phê duyệt nghiệp vụ hoặc kiểm tra kỹ thuật/DBA. Không tạo danh tính giả, không tự gắn vai trò/phê duyệt, không dùng AI thay người reviewer độc lập. Đây là *blocker tổ chức*, không được giải quyết bằng test offline PASS.

### 1. Xác lập người chịu trách nhiệm nghiệp vụ

- Nếu chủ dự án thực sự có thẩm quyền quyết định nghiệp vụ, **có thể tự đảm nhiệm vai trò business owner**, nhưng cần đưa ra các quyết định cụ thể BIZ-01…BIZ-05 ở hồ sơ và giữ chứng cứ thật về vai trò, thời điểm, quyết định; **không mặc định người dùng đồng ý chung là chốt BIZ-01…05**.
- Nếu chưa có thẩm quyền, cần mời người chịu trách nhiệm tài sản/tồn kho/mượn-trả của đơn vị.
- Dự thảo tạm thời cho mục đích phát triển offline phải gắn `PROPOSED / NOT APPROVED`; không dùng làm quy tắc DB final.

### 2. Tuyển/mời một người rà soát kỹ thuật độc lập có năng lực

Có thể nhờ DBA PostgreSQL ngoài nhóm, kỹ sư backend giàu kinh nghiệm có năng lực PostgreSQL/Prisma, tư vấn database độc lập, hoặc người chuyên môn trong tổ chức; **không nhất thiết phải là nhân viên toàn thời gian**. Người này phải là **người thật khác người ký nghiệp vụ** và không chỉ chép nội dung AI làm chứng cứ độc lập.

**Phạm vi yêu cầu reviewer:**

1. Nhận gói **tài liệu đã loại bí mật**: hồ sơ Stage4C, review nguồn, schema hash, bản SQL review-only và diff; giữ nguyên chứng cứ hashes. Chỉ cấp quyền repo/tài liệu cần thiết.
2. So sánh `schema.prisma` với forward DDL + guarded rollback dự thảo: `physicalEvidenceRef NOT NULL`, composite FK receipt + parent UNIQUE, trạng thái/CHECK, partial UNIQUE, idempotency, các duplicate indexes.
3. Rà soát lock order giữa legacy/new writer, transaction Serializable, lỗi P2034/40001, audit, không double-post stock, Asset/serial.
4. Rà soát giả định bảo mật Supabase/Postgres: quyền role, connection URL trong server, Data API exposure/RLS, backup/restore, không dùng secret trong frontend.
5. Kết luận **APPROVE / REJECT / REQUEST CHANGES** cho **thiết kế (không phải quyền chạy SQL)**, ghi họ tên, vai trò, ngày giờ, các điều kiện tồn đọng, SHA tài liệu, link nhận xét hoặc chữ ký có thể kiểm chứng.

**Phải tách hai phê duyệt:** DBA review thiết kế #11 khác phê duyệt tạo cluster #12, khác ủy quyền migration #13. Bằng chứng của người ký không thể tự tạo chỉ bởi dự án ChatGPT.

### 3. Việc được phép triển khai ngay, dù chưa có người ký

- Viết và review **test offline** thuần hàm cho xử lý chứng từ, trạng thái operation, idempotency replay/conflict, over-return, RBAC; không khai báo PASS khi chưa chạy.
- Viết interface/adapters cho writer dạng **DRAFT, không kết nối DB**, test bằng mock có chú thích rõ; không mở 503 hoặc bật `ACM_RETURN_OPERATIONS_ENABLED`.
- Soạn một migration *review-only* dưới dạng thiết kế/DDL diff **không thực thi** khi đã chốt đề xuất; không chạy cả hai SQL 2A/2B.
- Chạy lint, typecheck, unit test offline trong workspace/runner cô lập được cho phép; **không chạy test tự động ghi DB**, không giả vờ đã kiểm chứng concurrency.
- Tiếp tục bảo quản 9 file Stage4C đã có SHA-256; không ghi đè `D:\ACM_QLLK_UAT`.

### 4. Điểm dừng không thể vượt qua nếu thiếu người thật

- Không đánh dấu #11 đạt (nghiệp vụ + DBA); không đánh dấu #12 đạt (2 người thật phân biệt và bằng chứng).
- Không tạo PostgreSQL staging mới, không chạy migration/SQL, test DB write, dữ liệu thật hoặc rollback trên DB thật.
- Không merge/deploy/cutover; không tuyên bố ACM production-ready, 100% không lỗi.

## Mẫu lời mời reviewer (không kèm bí mật)

> Chúng tôi đang chuẩn bị hệ thống ACM (Express, Prisma, PostgreSQL 17/Supabase). Cần một người review độc lập schema/DDL Stage4C và an toàn transaction mượn/trả. Phạm vi: đọc source + tài liệu đã lọc bí mật, đánh giá FK kép/NOT NULL/UNIQUE/CHECK, khóa và concurrency, rollback, quyền truy cập Supabase; cung cấp nhận xét và quyết định kỹ thuật có thể kiểm chứng. **Không yêu cầu chạy SQL, truy cập DB thật hoặc deploy.** Vui lòng cho biết kinh nghiệm PostgreSQL/Prisma và khả năng nhận nhiệm vụ review độc lập.

## Trạng thái sau cập nhật

- Source provenance/manifest/9-file integrity: **verified**.
- Static source review: **completed**, các blocker P0 đã ghi.
- BIZ-01…05: **awaiting business owner designation and decisions**.
- DBA-01…07: **awaiting independent reviewer and signoff**.
- Operation writer, DB-backed tests, Supabase migration, release: **HOLD**.

**Mốc tiếp theo:** chủ dự án xác nhận có thẩm quyền tự chốt nghiệp vụ hay không; song song chuẩn bị test offline và hồ sơ cho một reviewer độc lập.
