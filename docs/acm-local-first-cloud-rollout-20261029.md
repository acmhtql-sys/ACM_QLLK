# ACM — Quyết định LOCAL-FIRST trước khi triển khai Cloud

**Ngày 2026-10-29; chủ dự án chọn:** Hoàn thiện và nghiệm thu toàn bộ ACM trên local trước; sau đó Frontend → Vercel, Backend → Render, Database → Supabase PostgreSQL, Storage → Cloudinary.

**Trạng thái:** PLAN APPROVED / LOCAL NOT VERIFIED / CLOUD NO-GO. Lựa chọn kiến trúc không phải lệnh tạo cloud service, chạy migration, merge hoặc chuyển dữ liệu thật.

## Mô hình cần giữ nguyên

| Thành phần | Local | Cloud sau nghiệm thu |
|---|---|---|
| Frontend | React 18, Vite 5, localhost:5173 | Vercel, Vite SPA |
| Backend | Express, TypeScript, Prisma 5, localhost:5000 | Render persistent Node |
| Database | PostgreSQL 17 cô lập, synthetic fixtures | Supabase Cloud PostgreSQL, truy cập từ Backend bằng Prisma |
| File/ảnh | StorageProvider + local/test adapter, dùng dữ liệu giả | Cloudinary, upload xác thực qua Backend, database chỉ chứa metadata |

**Cloudinary live không thể kiểm chứng hoàn toàn khi offline**: local test xác nhận hợp đồng adapter, xử lý file và mock lỗi; cloud staging có quyền riêng phải test provider thật sau LOCAL GO.

## Phát hiện từ mã nguồn thực tại UAT HEAD 0847a73088b98d8b00fb6ac06f02b2f56d288b78

- `apps/web/package.json`: React/Vite và `apps/web/src/services/api.ts` dùng `VITE_API_BASE_URL`.
- `apps/api/package.json`: Express/Prisma. `apps/api/src/config/database.ts` đọc `DATABASE_URL`.
- `apps/api/src/app.ts` có auth, inventory, borrow, kits, reports và audit; không đăng ký upload router trong file này. `apps/api/package.json` chưa khai báo Cloudinary SDK. Chưa thể khẳng định các chức năng Storage đã hoàn thiện.
- `apps/api/src/config/env.ts` chặn profile production và chỉ cho phép `cloud_staging` khi `NODE_ENV=production`. `cloud_staging` yêu cầu `STAGING_READ_ONLY=true`; không được lách cơ chế này để deploy write.
- `docs/DEPLOYMENT_READINESS.md` tự cảnh báo là tài liệu lịch sử; phải kiểm chứng lại build/network/config trước triển khai.
- Stage4C: BIZ-01…05 owner-approved; 32/32 logic offline tests và 18/18 design checks PASS trên GitHub Actions; **không phải Return Writer chạy thật**, Prisma/migration chưa DBA duyệt và chưa có E2E đầy đủ.
- 9 UAT WIP file được giữ bằng SHA; GitHub review branches không tự cập nhật thư mục Windows `D:\ACM_QLLK_UAT`.

## LOCAL — các cổng bắt buộc trước bất kỳ cloud deployment nào

### L0 — Baseline và môi trường an toàn
- [ ] Đối chiếu Git SHA, 9 WIP source hashes; dùng clone/worktree mới, giữ UAT nguyên trạng.
- [ ] Kiểm tra backup, `.env` không vào Git, chính sách secrets và bản đồ database.
- [ ] Review các Draft PR #22–25; chưa merge/rebase vào release khi chưa có signoff.

### L1 — Frontend đầy đủ
- [ ] Auth/login/logout, dashboard, danh mục/items, tồn kho, mượn/trả, kits, reports, audit, admin và phân quyền thực hoạt động với API local.
- [ ] Typecheck/lint/build + Vitest + Playwright E2E; responsive; lỗi 401/403/500, reconnect, pagination, search, upload UI nếu thuộc phạm vi.
- [ ] React Router deep-link và API base URL; không đưa secrets vào biến `VITE_`.

### L2 — Backend hoàn thiện
- [ ] BIZ-01…05: ACM code issuance; actor RECEIVE và VERIFY độc lập; GOOD/DAMAGED cách ly trước QC; LOST incident; RBAC; một unresolved return/borrow; atomic COMMIT; partial return/idempotency >=365 ngày.
- [ ] Khép hai câu hỏi nghiệp vụ còn mở: unique evidence global hay per-borrow; custody xử lý CANCEL sau RECEIVE thực tế.
- [ ] Điều chỉnh router/service/DTO theo source đã review; unit/typecheck/lint/security tests. Giữ route return-operations 503 và `ACM_RETURN_OPERATIONS_ENABLED` false tới khi schema, writer, concurrency, UAT và release được duyệt.
- [ ] Bảo đảm legacy/new lock order; reject replay/over-return; audit; failure rollback. Không coi 32/32 pure tests là DB proof.

### L3 — PostgreSQL 17 cô lập (CHỈ KHI ĐƯỢC DUYỆT)
- [ ] Reviewer PostgreSQL/Prisma độc lập ký #11; #12 có hai phê duyệt thật cho việc tạo isolated cluster; #13 phê duyệt SQL/migration cụ thể.
- [ ] Sau phê duyệt: schema + migration duy nhất/guarded rollback có SHA, Prisma client đúng phiên bản, test CHECK/UNIQUE/FK, concurrent 2 sessions, serialization retry, fault injection và backup/restore, chỉ synthetic data.
- [ ] Không chạy hai file Stage4C2A/2B nối tiếp; không trỏ integration test local hard-coded `127.0.0.1:55432` sang Supabase.

### L4 — Storage chạy local, Cloudinary adapter chưa gọi cloud
- [ ] Xác định ảnh linh kiện, tài sản, chứng từ có thuộc phạm vi; phân biệt public và private evidence.
- [ ] Thiết kế StorageProvider: mock/filesystem local cô lập + adapter Cloudinary chỉ dùng ở cloud staging khi được duyệt.
- [ ] File types thực, magic-byte/MIME, size cap, upload/retry/delete ownership, path traversal, audit, cleanup thất bại, không expose secret.
- [ ] Vì DB và Cloudinary không cùng transaction, phải có cơ chế state/outbox/compensation khi upload hoặc DB commit lỗi; không hứa atomic cross-provider.
- [ ] Local E2E file/image + restore metadata; dùng file giả, không thực hiện live upload.

### L5 — LOCAL GO
- [ ] Full builds/frontend/backend, lint/typecheck, unit/integration/E2E trên đúng commit; proof RBAC, quarantine/QC, stock invariants và backup/restore.
- [ ] Không còn P0/P1; P2 phải được owner chấp nhận bằng văn bản; xác thực database/actor/issuer/audit.
- [ ] Owner và reviewer có thẩm quyền ký LOCAL GO cùng commit SHA và test logs. Nếu thiếu, trạng thái **LOCAL NO-GO → CLOUD NO-GO**.

## CLOUD — chỉ sau L0…L5 PASS và các approval độc lập

### C1 — Cloud staging với dữ liệu tổng hợp
1. Phê duyệt riêng cho provisioning, SQL/data writes và credentials của bốn nhà cung cấp; GitHub CI không tự deploy khi chưa được chấp thuận.
2. Supabase: xét kết nối Prisma từ Render qua **direct** nếu hỗ trợ mạng; **session pooler 5432** cho backend persistent IPv4. Không mặc định transaction pooler 6543. Migrations/backup dùng direct theo docs và năng lực mạng. TLS, role/grants/Data API/RLS, backup/restore.
3. Cloudinary: cấu hình cloud/folder staging riêng, Backend signed upload; lưu public_id/secure_url + ownership, private/authenticated delivery với biên bản nhạy cảm.
4. Render: monorepo build từ root workspaces, chạy API và health route `/api/v1/health`, cấu hình PORT/CORS/JWT/DB URL từ secret store; **production profile hiện fail-closed, phải sửa và kiểm thử bằng PR có duyệt**.
5. Vercel: build web và shared workspace, đúng root/output của monorepo, SPA fallback, `VITE_API_BASE_URL` chỉ tới Render staging; Browser không giữ DATABASE_URL/Cloudinary secret.
6. Smoke + E2E thực trên cloud staging: auth/stock/return/upload, network faults, rollback, restore, logs. Hiện staging read-only nên mọi test ghi cloud phải có quyết định và thay đổi được review riêng; **không lách guard**.

### C2 — Production GO
- Chuẩn bị bảo mật, giám sát, alerting, rate limits, backups, RPO/RTO, quotas và chi phí, rollback và release tags.
- Quyết định riêng cho migrate/release/data transfer; triển khai tuần tự với smoke/rollback. Không chuyển dữ liệu thật khi chưa có lệnh cụ thể.

## Công việc ưu tiên tiếp theo

1. Audit đầy đủ frontend/backend/storage trên source branch; pin Git SHA và gói UAT.
2. Hoàn thiện Return Writer fail-closed, Prisma schema và testcase; mời DBA độc lập.
3. Tạo local storage mock/provider và tests.
4. Chạy full local tests, PG17 isolated sau approval, bảo mật/backup/restore/E2E.
5. Ký LOCAL GO; sau đó mới cloud staging rồi production theo authorization riêng.

## Chú ý quyền truy cập

Hiện ChatGPT có thể xem/tạo tài liệu trên GitHub, **không được phép coi GitHub là ổ đĩa local Windows**. Không tự động sửa `D:\ACM_QLLK_UAT`, không SQL/migration/cloud writes, không chuyển data, không merge/deploy.

## Tài liệu tham khảo hiện hành
- Vercel Vite: https://vercel.com/docs/frameworks/frontend/vite
- Render monorepos: https://render.com/docs/monorepo-support
- Supabase PostgreSQL connection: https://supabase.com/docs/guides/database/connecting-to-postgres
- Cloudinary server uploads: https://cloudinary.com/documentation/image_upload_api_reference
