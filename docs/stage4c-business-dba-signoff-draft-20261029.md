# ACM Stage4C — Hồ sơ quyết định nghiệp vụ & DBA (DRAFT / NO-GO)

**Ngày lập:** 2026-10-29  
**Nguồn mã:** ZIP UAT `ACM_UAT_SourceReview_ONLY_20261029_204537.zip`, SHA-256 `938479d53afa7f16b2923bbf9611b4480957c19ce24d835b84d19c59d5fc332a`; `schema.prisma` SHA-256 `ab5bbdc7f6f1de397740fadb4d5522a59bbb9a819e23dfd658218cc144032fac`.  
**Gates:** #11 (business + DBA), #12 (separate PG-cluster approvals), #13 (SQL/migration-specific authorization), #14 (writer implementation), #15 (release), #21 (Supabase).  
**Trạng thái:** CHƯA CÓ PHÊ DUYỆT NGHIỆP VỤ / DBA. *Không suy ra quyết định chuyên môn từ câu trả lời “đồng ý” trong cuộc trò chuyện.*

## A. Các quyết định nghiệp vụ cần chủ quản lý ký

| ID | Nội dung phải chốt | Đề xuất kỹ thuật — chưa được duyệt | Mã nguồn / tác động |
|---|---|---|---|
| BIZ-01 | Định dạng mã chứng từ bàn giao | ASCII 1–128 ký tự; regex `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`. Xác định **phân biệt chữ hoa/chữ thường** và liệu có cho mã Unicode. | `borrow.return-operation-foundation.ts` chỉ chặn chuỗi trống, control chars và trim; SQL 2B chưa triển khai regex đề xuất |
| BIZ-02 | Ai **cấp** chứng từ, ai **kiểm chứng** và ai **nhận vật lý**? | Bắt buộc nguồn chứng từ có provenance độc lập; kiểm chứng không chỉ là regex/so khớp mã. Phân tách quyền cấp và quyền xác minh theo quy định tổ chức. | `physicalEvidenceRef` không chứng minh đã nhận vật lý |
| BIZ-03 | Trạng thái GOOD/DAMAGED/LOST và chuyển tồn kho/Asset | GOOD: chỉ đề xuất đưa về kho khả dụng sau kiểm tra; DAMAGED: đề xuất cách ly; LOST: không cộng vào onHand. Quyết định chính thức cho từng trạng thái, biên bản xử lý và người duyệt. | `StockBalance` có onHand/quarantined/borrowed; `Asset` có AVAILABLE/QUARANTINED/LOST |
| BIZ-04 | Ai có quyền PREPARE/COMMIT/CANCEL? | Đề xuất phân quyền ADMIN, LAB_MANAGER, TECHNICIAN theo nghiệp vụ; ghi ai thực hiện + thời điểm + phiếu và chứng từ; quy định người tạo có được tự commit hay không. | `borrow.router.ts`, `BorrowReturnOperation` |
| BIZ-05 | Trả một phần, trả vượt, hủy, trả trùng | Chặn overreturn; một operation unresolved/borrow; retry cùng payload chỉ trả lại kết quả cũ, khác payload phải conflict; không “hoàn trả” hai lần. | UNIQUE/partial UNIQUE + transaction + idempotency |

**Quyết định nghiệp vụ (chưa điền):**
- BIZ-01: APPROVE / REJECT / CHANGE REQUESTED: `[chưa quyết định]`
- BIZ-02: `[chưa quyết định]`
- BIZ-03: `[chưa quyết định]`
- BIZ-04: `[chưa quyết định]`
- BIZ-05: `[chưa quyết định]`
- Người có thẩm quyền, chức danh, thời điểm, nguồn quyết định có thể kiểm chứng: `[bắt buộc bổ sung ngoài hồ sơ dự thảo]`

## B. Các quyết định DBA độc lập cần ký

| ID | Thực trạng kiểm tra tĩnh | Cổng sửa và phê duyệt |
|---|---|---|
| DBA-01 | Prisma `physicalEvidenceRef String` (bắt buộc); SQL 2A `physical_evidence_ref text NULL` | Chỉ một migration chính thức có NOT NULL và CHECK khớp chính sách BIZ-01 |
| DBA-02 | Prisma FK kép `[returnTransactionId, borrowRequestId]`; SQL 2A chỉ FK `return_transactions(id)` | Xác minh UNIQUE bên parent `(id, borrowRequestId)` và composite FK thực |
| DBA-03 | 2A và 2B đều khai báo partial unique index `borrow_return_operations_one_unresolved_per_borrow` | Không chạy hai file nối tiếp; chỉ dùng một migration duy nhất từ Prisma diff + custom constraints có review |
| DBA-04 | SQL 2A/2B đều là `REVIEW ONLY / DO NOT RUN` | DDL final cần snapshot schema, pinned SHA, rollback có guard, DBA review |
| DBA-05 | Trạng thái, người tạo/commit/cancel, receipt, timestamps | DB CHECK kiểm soát row terminal consistency; negative tests cho NULL, wrong-parent, duplicate, overreturn |
| DBA-06 | Prisma client UAT từng được ghi nhận stale | Kiểm chứng Prisma generated client khớp schema/cam kết build độc lập; không generate trên UAT chưa duyệt |
| DBA-07 | Supabase staging PG17 chưa có migrations được duyệt | Chốt Data API exposure/RLS hoặc tắt Data API khi chỉ dùng Prisma; least-privilege DB roles, TLS, pooler/connection limit và backup/restore |

**Quyết định DBA (chưa điền):**
- DBA-01…07: `[chưa quyết định]`
- Họ tên/chức danh reviewer độc lập, thời gian, cơ sở review, SHA DDL cuối, quyết định: `[bắt buộc bổ sung]`

## C. Điều kiện được bắt đầu giai đoạn 2 (offline code review)

- Có quyết định nghiệp vụ có thể kiểm chứng cho BIZ-01…05.
- DBA review các điều kiện dữ liệu và DDL; SQL execution vẫn là **một quyết định khác**.
- Backend writer được phát triển trên nhánh riêng có review, không ghi UAT, không bật `ACM_RETURN_OPERATIONS_ENABLED`.
- Test offline bao phủ canonical payload, duplicate item/evidence, hash mismatch, RBAC, overreturn, terminal-state consistency, replay/conflict.

## D. Điều kiện mở cổng chạy PostgreSQL / Supabase thử nghiệm

**Không tự động mở khi ký mục A/B.** Cần phê duyệt riêng theo #12/#13 và #21, identity xác thực, môi trường cô lập, backup/rollback, dữ liệu giả lập, operator được ủy quyền. Trước đó, mọi câu lệnh SQL/Prisma migration, import, write, merge hoặc production deploy đều **NO-GO**.

## Phân biệt mức bằng chứng

- **Đã kiểm tra:** 9 tệp ZIP khớp hash; đối chiếu tĩnh schema và SQL; endpoint mới 503.
- **Chưa chứng minh:** code chạy được với generated Prisma client mới; transaction thật, receipt provenance, bảo mật endpoint, migration thực thi, rollback, backup/restore, E2E.
- **Không phải phê duyệt:** chính tài liệu này, PR Draft, “đồng ý” thông thường trong hội thoại, hoặc một bài test offline PASS.
