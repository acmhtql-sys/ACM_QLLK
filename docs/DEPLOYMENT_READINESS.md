# ACM Cloud Deployment Readiness & Infrastructure Audit

> **LƯU Ý PHASE 11 — 17/10/2026:** Đây là tài liệu lịch sử, một số thông tin đã lỗi thời hoặc chưa được xác minh trên Cloud. Khi chuẩn bị triển khai, dùng [Phase 11 Staging Readiness](./phase11/STAGING_READINESS.md) và [UAT Checklist](./phase11/UAT_CHECKLIST.md) làm cơ sở kiểm tra mới nhất. Cloud Staging vẫn **chỉ đọc**, đăng nhập có ghi DB và không được bật mặc định, không chạy UAT ghi trên Cloud. Không thay đổi Cloud nếu chưa phê duyệt. 


> **Tài liệu Thẩm định Sẵn sàng Triển khai Đám mây (Cloud Deployment Readiness)**  
> **Dự án:** ACM – Hệ thống Quản lý Linh kiện & Thiết bị  
> **Repository:** `acmhtql-sys/ACM_QLLK`  
> **Phiên bản:** Phase 9 (Documentation & Deployment Readiness)  
> **Trạng thái:** BẢO MẬT & KIỂM SOÁT THAY ĐỔI NGHIÊM NGẶT  

---

## 1. Ma trận Trạng thái Nền tảng Đám mây (Cloud Platform Status Matrix)

Nhằm đảm bảo tính minh bạch và an toàn tuyệt đối theo nguyên tắc kỹ thuật hệ thống, bảng ma trận dưới đây phân định rõ ràng 3 trạng thái độc lập cho từng dịch vụ:
- **ĐÃ CẤU HÌNH (Configured):** Mã nguồn, cấu hình, file mẫu biến môi trường, workflow hoặc tài nguyên đã được thiết kế và khai báo.
- **ĐÃ KIỂM THỬ (Tested):** Đã được chạy thử nghiệm, build, typecheck, hoặc mô phỏng kết nối trong môi trường kiểm thử.
- **ĐÃ TRIỂN KHAI THẬT (Deployed):** Tài nguyên đám mây đang chạy thực tế trên hạ tầng nhà cung cấp.

| Nền tảng (Platform) | Thành phần (Component) | ĐÃ CẤU HÌNH | ĐÃ KIỂM THỬ | ĐÃ TRIỂN KHAI THẬT | Định danh / Ghi chú kỹ thuật |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **GitHub** | Source Code & Monorepo | ✅ | ✅ | ✅ | Repo: `acmhtql-sys/ACM_QLLK.git`<br>Tracked branches: `main`, `codex/**` |
| **GitHub Actions** | CI Pipeline (`ci.yml`) | ✅ | ✅ | ✅ | PostgreSQL 16 container, lint, typecheck, prisma, 576 unit & integration tests |
| **Supabase** | Cloud Database (PostgreSQL 15+) | ✅ | ✅ | ⚠️ **CHƯA TRIỂN KHAI** | Project: `acm-qllk-staging` (`dqctxaoaxhtqtgmtsysk`), Region: `ap-southeast-1`. Đã cấp project, **0 migration applied, 0 seed data**, chờ duyệt Gate C2B-2 |
| **Render** | Backend API (Node.js/Express) | ✅ | ✅ | ⚠️ **CHƯA TRIỂN KHAI** | Build: `npm run build:api`, Start: `npm run start --workspace=@acm/api`, Dockerfile `infra/Dockerfile.api`. Đang khóa chờ DB |
| **Vercel** | Frontend SPA (React + Vite) | ✅ | ✅ | ⚠️ **CHƯA TRIỂN KHAI** | `vercel.json` SPA rewrite, Build: `npm run build:web`, Output: `apps/web/dist`. Đang khóa chờ Backend |

---

## 2. Chi tiết Tình trạng Từng Nền tảng

### 2.1. GitHub & GitHub Actions
- **Hiện trạng:**
  - Remote repository `https://github.com/acmhtql-sys/ACM_QLLK.git` hoạt động ổn định.
  - Quy trình phân nhánh: Nhánh `main` được bảo vệ nghiêm ngặt (không commit trực tiếp, không force push). Mọi tính năng phát triển trên branch riêng `codex/*` và tạo Pull Request.
  - **CI Workflow (`.github/workflows/ci.yml`):**
    - Kích hoạt khi có push/PR vào `main`, `develop`, hoặc push nhánh `codex/**`.
    - Tự động khởi tạo dịch vụ container `postgres:16-alpine`.
    - Chạy tuần tự: `npm ci` $\rightarrow$ `prisma:validate` $\rightarrow$ `prisma:generate` $\rightarrow$ `typecheck` $\rightarrow$ `lint` $\rightarrow$ `build` $\rightarrow$ `test:unit` $\rightarrow$ `prisma migrate deploy` $\rightarrow$ `test:integration`.

### 2.2. Supabase Staging Database
- **Thông tin Dự án:**
  - Project Name: `acm-qllk-staging`
  - Reference ID: `dqctxaoaxhtqtgmtsysk`
  - Region: `ap-southeast-1` (Singapore)
  - Plan: Free Tier (Zero Cost - không phát sinh chi phí)
- **Kiến trúc Kết nối:**
  - **Session Pooler (Port 5432):** Dành riêng cho DDL migration (`prisma migrate deploy`).
  - **Transaction Pooler (Port 6543):** Dành cho ứng dụng Express Backend qua PgBouncer connection pooling.
- **Rào chắn An toàn (Security Safeguards):**
  - Hiện tại database ở trạng thái **trắng hoàn toàn (Clean Slate)**: Chưa áp dụng migration, chưa seed dữ liệu demo.
  - Tuyệt đối không chạy `prisma migrate reset` hoặc `prisma db push`.
  - Phải có sự phê duyệt chính thức bằng văn bản của Quản trị viên trước khi chạy `npx prisma migrate deploy` lên Supabase.

### 2.3. Render Web Service (Backend Express)
- **Thông số Dịch vụ:**
  - Environment: `Node 20`
  - Root Directory: `.` (Monorepo root)
  - Build Command: `npm run build:shared && npm run build:api`
  - Start Command: `node apps/api/dist/server.js`
  - Health Check Path: `/api/v1/health`
- **Biến môi trường cần thiết lập trên Render Dashboard:**
  ```ini
  NODE_ENV=production
  PORT=10000
  API_PREFIX=/api/v1
  DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?schema=public&pgbouncer=true
  DIRECT_URL=postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?schema=public
  JWT_SECRET=<chuoi-ngau-nhien-toi-thieu-32-ky-tu-entropy-cao>
  JWT_EXPIRES_IN=1d
  BCRYPT_SALT_ROUNDS=10
  CORS_ORIGIN=https://<your-acm-app>.vercel.app
  LOG_LEVEL=info
  ACM_DEPLOYMENT_PROFILE=cloud_staging
  STAGING_READ_ONLY=true
  ALLOW_STAGING_AUTH_LOGIN=true
  ```
- **Rào chắn An toàn:**
  - Chế độ `cloud_staging` kích hoạt middleware `cloudStagingReadOnlyMiddleware`: chặn toàn bộ request thay đổi dữ liệu (`POST`, `PUT`, `PATCH`, `DELETE`) ngoại trừ luồng xác thực đăng nhập nếu `ALLOW_STAGING_AUTH_LOGIN=true`.

### 2.4. Vercel Hosting (Frontend React)
- **Thông số Dự án:**
  - Framework Preset: `Vite`
  - Root Directory: `.` (hoặc cấu hình build workspace `apps/web`)
  - Build Command: `npm run build:web`
  - Output Directory: `apps/web/dist`
  - File điều hướng SPA: `vercel.json` (đảm bảo chuyển hướng tất cả URL về `/index.html` để React Router xử lý client-side routing).
- **Biến môi trường cần thiết lập trên Vercel Dashboard:**
  ```ini
  VITE_API_BASE_URL=https://<your-render-backend>.onrender.com/api/v1
  VITE_APP_TITLE="ACM – Components & Equipment Management System"
  ```

---

## 3. Quy trình Triển khai Chuẩn (Deployment Checklist & Runbook)

Chỉ thực hiện quy trình này khi có lệnh phê duyệt triển khai chính thức.

```
               [CHUẨN BỊ MÔI TRƯỜNG]
                         │
                         ▼
        [1. SAO LƯU DỰ PHÒNG (pg_dump)]
                         │
                         ▼
     [2. CHẠY PRISMA MIGRATION (Session: 5432)]
                         │
                         ▼
       [3. XÁC MINH SCHEMA TRÊN SUPABASE]
                         │
                         ▼
       [4. TRIỂN KHAI BACKEND LÊN RENDER]
                         │
                         ▼
       [5. KIỂM TRA HEALTH CHECK /api/v1/health]
                         │
                         ▼
       [6. TRIỂN KHAI FRONTEND LÊN VERCEL]
                         │
                         ▼
          [7. SMOKE TEST TOÀN HỆ THỐNG]
```

### Bước 1: Sao lưu Dự phòng (Database Backup)
Trước bất kỳ đợt release hoặc áp dụng migration nào, luôn tạo snapshot sao lưu:
```bash
# Sao lưu schema & data sang file nhị phân nén (.dump)
pg_dump -h <supabase-host> -U postgres -d postgres -F c -b -v -f "database/backups/acm_backup_$(date +%Y%m%d_%H%M%S).dump"

# Sao lưu cấu trúc SQL văn bản (Schema only)
pg_dump -h <supabase-host> -U postgres -d postgres -s -f "database/backups/acm_schema_$(date +%Y%m%d_%H%M%S).sql"
```

### Bước 2: Áp dụng Migration lên Supabase
Sử dụng cổng Session Pooler (port 5432) để thực thi migration DDL có quản lý:
```bash
# Chạy migration có quản lý (KHÔNG chạy migrate reset hoặc db push)
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?schema=public" npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
```

### Bước 3: Kiểm tra Trạng thái Migration
```bash
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?schema=public" npx prisma migrate status --schema=apps/api/prisma/schema.prisma
```
Đảm bảo kết quả trả về `Database is up to date`.

### Bước 4: Triển khai Backend Web Service trên Render
1. Kết nối Render với repository GitHub `acmhtql-sys/ACM_QLLK`.
2. Chọn branch cần release (ví dụ `main` hoặc release tag).
3. Cấu hình biến môi trường production theo mục 2.3.
4. Kích hoạt manual deploy và theo dõi build logs.

### Bước 5: Kiểm tra Health Check của Backend
Sử dụng `curl` hoặc trình duyệt truy cập:
```bash
curl -I https://<your-render-backend>.onrender.com/api/v1/health
```
Kết quả mong đợi: `HTTP/1.1 200 OK` kèm JSON:
```json
{
  "status": "ok",
  "environment": "production",
  "timestamp": "2026-10-16T..."
}
```

### Bước 6: Triển khai Frontend trên Vercel
1. Import repository vào Vercel.
2. Cấu hình Root Directory và biến `VITE_API_BASE_URL` trỏ tới URL Backend trên Render.
3. Chạy Deployment.

### Bước 7: Xác minh Smoke Test Sau Triển khai
- [ ] Màn hình Login tải nhanh, không có lỗi console.
- [ ] Đăng nhập thành công với tài khoản quản trị viên.
- [ ] Dashboard hiển thị đúng các thẻ KPI tổng linh kiện, tồn kho, đang mượn, cảnh báo sắp hết.
- [ ] Danh sách linh kiện, danh mục tải dữ liệu mượt mà, phân trang và tìm kiếm hoạt động.
- [ ] Trạng thái Read-only trên Staging ngăn chặn thao tác sửa/xóa trái phép đúng như thiết kế bảo mật.

---

## 4. Kế hoạch Khôi phục Thảm họa & Rollback (Disaster Recovery & Rollback)

### 4.1. Rollback Ứng dụng Frontend (Vercel)
- Vercel hỗ trợ Instant Rollback:
  1. Vào Dashboard dự án trên Vercel $\rightarrow$ Mục **Deployments**.
  2. Chọn bản build trước đó đã được kiểm chứng hoạt động tốt.
  3. Chọn **Promote to Production**. Toàn bộ traffic sẽ lập tức chuyển về phiên bản cũ trong vòng vài giây mà không cần build lại.

### 4.2. Rollback Ứng dụng Backend (Render)
- Render cho phép redeploy commit cũ:
  1. Vào Render Dashboard $\rightarrow$ Web Service $\rightarrow$ **Events**.
  2. Tìm commit trước khi phát sinh sự cố.
  3. Chọn **Rollback to this deploy**.

### 4.3. Rollback Database (Supabase PostgreSQL)
Trường hợp migration gặp sự cố hoặc dữ liệu có bất thường:
1. **Dừng Backend Service:** Chuyển backend về trạng thái Maintenance để tạm dừng các kết nối ghi.
2. **Khôi phục từ bản Backup:**
   ```bash
   # Khôi phục từ file backup dạng nén (.dump)
   pg_restore -h <supabase-host> -U postgres -d postgres -c -v "database/backups/<file_backup>.dump"
   ```
3. **Đồng bộ lại lịch sử Prisma Migration:**
   Nếu cần hạ migration (down-migration), tạo migration điều chỉnh (compensating migration) hoặc giải quyết bảng `_prisma_migrations` theo quy trình có giám sát của DBA:
   ```bash
   npx prisma migrate resolve --rolled-back <migration_name> --schema=apps/api/prisma/schema.prisma
   ```

---

## 5. Danh mục Tài khoản Thử nghiệm (Staging Test Credentials)

| Vai trò (Role) | Email | Mật khẩu mặc định | Quyền hạn chính |
| :--- | :--- | :--- | :--- |
| **System Admin** | `admin@acm.local` | `ACM@dev2026!` | Quản trị toàn hệ thống, cấu hình, quản lý user, xem audit log |
| **Lab Manager** | `manager@acm.local` | `ACM@dev2026!` | Quản lý kho, nhập/xuất, duyệt mượn trả, kiểm kê tồn kho |
| **Technician** | `tech@acm.local` | `ACM@dev2026!` | Kiểm tra kỹ thuật, kiểm kê, báo hỏng, duyệt mượn theo phân công |
| **Student** | `student@acm.local` | `ACM@dev2026!` | Tra cứu danh mục, kiểm tra tồn khả dụng, tạo yêu cầu mượn |

> [!CAUTION]
> Mật khẩu mặc định trên chỉ sử dụng trong môi trường thử nghiệm nội bộ (Local Dev / Staging Test). Khi triển khai lên môi trường Production thực tế, bắt buộc phải thay đổi toàn bộ mật khẩu quản trị và bật xác thực đa yếu tố (2FA) nếu áp dụng.
