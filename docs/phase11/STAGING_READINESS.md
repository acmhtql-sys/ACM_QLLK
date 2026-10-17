# ACM Phase 11 – Staging Readiness & Configuration Audit

**Ngày lập:** 17/10/2026 · **Phạm vi:** mã nguồn của Draft PR #7 (`codex/integration-phase01-10-security-review`) · **Trạng thái:** PREPARED / CLOUD NOT EXECUTED

## 1. Quyết định MVP đã được chốt

- **Hoàn trả về đúng kho nguồn đã bàn giao.** Trả sang kho khác bị từ chối (HTTP 409), không tự chuyển hoặc ghi tăng `onHand` tại kho đích.
- Nếu một chi tiết mượn được bàn giao từ nhiều kho hoặc không thể xác định kho nguồn, hệ thống từ chối trả với 409 để tránh sai sổ kho. Đây là **giới hạn chức năng MVP**, không phải lỗi cần bỏ chặn.
- Nghiệm thu phải xác minh công thức `Available = OnHand - Reserved - Quarantined - KitAllocated` và không trừ `Borrowed` hai lần.

## 2. Hai môi trường, hai loại kiểm tra — không được đánh đồng

| Luồng | Cơ sở dữ liệu | Mục tiêu | Có được ghi? | Trạng thái |
|---|---|---|---|---|
| **A. CI / Local Isolated UAT** | PostgreSQL `acm_inventory_test` do người vận hành kiểm soát; test suite tự kiểm tra `current_database()` | Toàn bộ vòng đời mượn/trả, tồn kho, phân quyền, lỗi và cạnh tranh transaction | Chỉ trên DB test được phép | CI trên GitHub đã đạt; **UAT thủ công chưa thực hiện** |
| **B. Cloud Staging Read-Only** | Supabase staging riêng, khi có phê duyệt | Health, cấu hình, GET công khai, 403 cho các phương thức ghi, SPA, TLS/CORS | **Không** | **Chưa xác minh triển khai trên Cloud** |
| Production | Cơ sở dữ liệu production | Vận hành thật | Không được phép trong Phase 11 | KHÓA |

**Không bật `STAGING_READ_ONLY=false` để chạy UAT trên Cloud.** `env.ts` hiện từ chối `cloud_staging` nếu không phải read-only. Luồng UAT có ghi phải dùng database test cô lập, không dùng Supabase staging thật.

## 3. Audit các cấu hình theo mã nguồn (không phải xác minh tài nguyên Cloud)

| Thành phần | Cấu hình được kiểm chứng trong repo | Cần xác minh trước khi triển khai thật |
|---|---|---|
| GitHub | Workflow `.github/workflows/ci.yml`, Node **22**, PostgreSQL 16, build Shared trước Typecheck, kiểm thử UAT API bằng DB test | Branch protection / required checks, quyền reviewer, CI ref hợp nhất |
| Supabase | `schema.prisma` có `DATABASE_URL` và `SHADOW_DATABASE_URL`; có migration Prisma; tài liệu cũ đã phác thảo staging project | DB riêng, DB role chỉ đọc tối thiểu, SSL, chính xác hostname/port từ Dashboard, backup, trạng thái migration thực; **không giả định 0 migration** |
| Render API | Root `.`; lệnh dự kiến `npm ci && npm run prisma:generate && npm run build:shared && npm run build:api`; start `node apps/api/dist/server.js`; Node **22**; liveness `/api/v1/health/liveness`; readiness `/api/v1/health/readiness` | Runtime version thực, chế độ read-only, env được quản lý trong Dashboard, Render health check, TLS, origin của Web; **không tự chạy build/deploy** |
| Vercel Web | Root `.`; dự kiến `npm ci && npm run build:shared && npm run build:web`; output `apps/web/dist`; root `vercel.json` rewrite về `/index.html` | VITE_API_BASE_URL là HTTPS Render URL, CORS exact origin, cache/build env, domain thực, SPA deep link; **không triển khai** |

> Không có thư mục `infra/` hoặc `infra/Dockerfile.api` trên nhánh được audit. Ưu tiên Native Node Web Service theo build/start command, không dựa vào Dockerfile chưa tồn tại.

### Server-side env: Render (chỉ tên/giá trị mẫu vô hại)

| Tên | Kỳ vọng Staging read-only |
|---|---|
| `NODE_ENV` | `production` (Express chạy chế độ production trên staging) |
| `ACM_DEPLOYMENT_PROFILE` | `cloud_staging` |
| `STAGING_READ_ONLY` | `true` — bắt buộc |
| `ALLOW_STAGING_AUTH_LOGIN` | **`false`** — bắt buộc trong kế hoạch Phase 11 |
| `API_PREFIX` | `/api/v1` |
| `DATABASE_URL` | Secret kết nối DB staging với quyền tối thiểu, lấy trực tiếp từ provider; **không lưu trong Git** |
| `SHADOW_DATABASE_URL` | Prisma schema tham chiếu biến này; xác định rõ giá trị/nhu cầu cho lệnh migrate trong quy trình được duyệt, **không đoán** |
| `JWT_SECRET` | Chuỗi ngẫu nhiên entropy cao từ secret manager, không dùng dev/test/example |
| `CORS_ORIGIN` | Một HTTPS origin chính xác của Vercel, không wildcard/localhost/path |
| `PORT` | Render quản lý hoặc cấu hình theo môi trường thực, Express lắng nghe `env.PORT` |
| `JWT_EXPIRES_IN`, `LOG_LEVEL` | Chính sách staging, ví dụ `1d` / `info` |

**Vercel:** `VITE_API_BASE_URL` dùng URL HTTPS + `/api/v1`; `VITE_ENABLE_LOCATION_WRITES=false`, `VITE_ENABLE_STOCK_TRANSACTION_WRITES=false`, `VITE_ENABLE_STOCK_ADJUSTMENT=false` (code feature flags có mặc định khóa). `VITE_APP_TITLE` chỉ là chuỗi công khai. Tuyệt đối không tạo `DATABASE_URL`, `JWT_SECRET` hoặc bất cứ secret Backend nào trong Vercel.

### Cảnh báo về trạng thái hiện tại

1. **Login có ghi DB:** `auth.router.ts` cập nhật `failedLoginAttempts` và `isLocked`; đăng nhập thành công cũng reset bộ đếm bằng `updateMany`. Các mô tả cũ coi login read-only là **sai**. Giữ `ALLOW_STAGING_AUTH_LOGIN=false`; GET yêu cầu token sẽ chưa thể UAT qua login trên Cloud.
2. `GET /api/v1/health` có thể trả 200 ngay cả khi DB disconnected; dùng `/health/readiness` để kiểm tra DB và `/health/liveness` để kiểm tra process.
3. `apps/web/src/services/api.ts` có fallback `http://localhost:5000/api/v1`; do đó phải xác thực `VITE_API_BASE_URL` khi build cloud và kiểm tra bản bundle gọi đúng Backend. Không coi fallback là cấu hình staging.
4. Các tài liệu Phase 9/10 đề cập Node 20, Dockerfile, số migration/test và Cloud status khác nhau; **không dùng những số liệu đó làm bằng chứng triển khai hiện tại**.
5. `cloudStagingReadOnlyMiddleware` là rào chắn ứng dụng; cần **xác thực quyền SELECT-only thực tế của PostgreSQL role** riêng trước khi tuyên bố không thể ghi ở tầng DB. Supabase Data API/PostgREST và RLS phải được rà soát theo [thiết kế Supabase](../../ACM_CLOUD_SUPABASE_SECURITY_DESIGN.md).

## 4. Kiểm tra tiền triển khai không truy cập Cloud

Chạy từ root trên máy được kiểm soát:

```bash
npm run preflight:staging
```

Bước này chỉ kiểm tra file template, workflow và guard trong repo, **không đọc secrets, không kết nối DB/Render/Vercel/Supabase và không chứng nhận Cloud ready**. CI cũng chạy bước này. Sau đó kiểm tra kết quả CI đầy đủ của PR #7 trên merge ref.

## 5. Gates — phải có sự phê duyệt riêng cho từng hành động

- [x] Chốt MVP chỉ trả về kho nguồn.
- [x] Rà soát các file cấu hình và thiết kế hai luồng kiểm thử.
- [ ] Preflight + CI của commit Phase 11 mới nhất đều xanh.
- [ ] OWNER xác nhận phân quyền ADMIN-only đối với Reports/Audit Logs.
- [ ] Người có trách nhiệm đánh giá cuối cùng test/UAT có ghi trên local isolated DB và kiểm tra ledger.
- [ ] Người phụ trách xác minh Supabase DB role, Data API, backup và các biến môi trường qua Dashboard (không đưa secret vào chat).
- [ ] Phê duyệt riêng nếu muốn **chạy migrations trên Supabase staging**.
- [ ] Phê duyệt riêng nếu muốn **tạo/kích hoạt Render/Vercel**.
- [ ] Phê duyệt riêng trước **merge Draft PR #7 vào `main`** và trước production release.

Không chạy `prisma db push`, `prisma migrate reset`, remote seed, force-push, hay ghi vào Supabase/Production. Rollback mã ứng dụng và phục hồi database là hai quy trình khác nhau; cần kế hoạch sao lưu và phục hồi đã kiểm thử trước mọi thay đổi schema.

## 6. Kết quả giai đoạn chuẩn bị

**DELIVERABLES:** báo cáo này, [UAT_CHECKLIST.md](./UAT_CHECKLIST.md), preflight script và bước CI tự kiểm tra policy tĩnh. **CHƯA LÀM:** mọi hành động Cloud, manual UAT, phê duyệt triển khai và merge.
