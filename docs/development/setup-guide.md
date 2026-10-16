# ACM Development Setup Guide

> **Hướng dẫn Cài đặt & Thiết lập Môi trường Phát triển ACM Monorepo**  
> Dành cho Kỹ sư Phát triển, QA và Quản trị viên Hệ thống.

---

## 1. Yêu cầu Môi trường (Prerequisites)

- **Node.js**: >= 20.x LTS (khuyến nghị Node 20 hoặc 22)
- **npm**: >= 10.x
- **PostgreSQL**: 15+ hoặc 16+ (Chạy local service, qua Docker Compose hoặc Cloud Supabase)
- **Git**: 2.x+

---

## 2. Quy trình Cài đặt & Khởi động Nhanh (Step-by-Step Setup)

### Bước 1: Clone Repository & Cài đặt Dependencies
```bash
git clone https://github.com/acmhtql-sys/ACM_QLLK.git
cd ACM_QLLK
npm install
```

### Bước 2: Cấu hình Biến Môi trường
Sao chép template cấu hình mẫu:
```bash
cp .env.example .env
```
Cấu hình các tham số cốt lõi trong `.env`:
- `DATABASE_URL`: Đường dẫn kết nối PostgreSQL của bạn (ví dụ: `postgresql://postgres:postgres@localhost:5432/acm_inventory?schema=public`).
- `JWT_SECRET`: Khóa bí mật cho JWT (trong môi trường local có thể dùng chuỗi bất kỳ tối thiểu 32 ký tự).
- `CORS_ORIGIN`: Mặc định `http://localhost:5173`.
- `VITE_API_BASE_URL`: Mặc định `http://localhost:5000/api/v1`.

### Bước 3: Khởi tạo Cơ sở Dữ liệu (PostgreSQL)
Bạn có thể sử dụng service PostgreSQL cài sẵn trên máy hoặc dùng Docker Compose:
```bash
# Khởi động PostgreSQL qua Docker Compose
docker-compose up -d postgres
```

### Bước 4: Generate Prisma Client & Kiểm tra Schema
```bash
npm run prisma:generate
npm run prisma:validate
```

### Bước 5: Build Toàn bộ Monorepo Packages
```bash
npm run build
```
Lệnh này sẽ tự động biên dịch tuần tự:
1. `packages/shared`: Shared types, Invariants, Zod schemas.
2. `apps/api`: Express backend application.
3. `apps/web`: React Vite frontend bundle.

### Bước 6: Khởi chạy Môi trường Phát triển (Development Mode)
```bash
# Khởi động Backend (Port 5000)
npm run dev:api

# Khởi động Frontend (Port 5173) trong terminal khác
npm run dev:web
```
Truy cập ứng dụng tại: `http://localhost:5173`

---

## 3. Quy trình Kiểm thử & Chất lượng Mã nguồn (Testing & Quality Gates)

Dự án thiết lập rào chắn kiểm thử nghiêm ngặt chia theo từng cấp độ:

### 3.1. Kiểm tra Kiểu dữ liệu & Linter
```bash
# Kiểm tra toàn bộ kiểu TypeScript trong monorepo
npm run typecheck

# Chạy linter kiểm tra cú pháp và quy chuẩn code
npm run lint
```

### 3.2. Chạy Unit Tests (Mock Database - Siêu tốc)
Chạy bộ kiểm thử đơn vị độc lập không cần database ngoài:
```bash
npm run test:unit
```
Bao gồm các test suites kiểm tra:
- Logic bảo vệ xác thực JWT, stale roles, inactive/locked users.
- Tính toán tồn kho khả dụng và bất biến tồn kho không âm.
- Vòng đời phiếu mượn/trả và xử lý quá hạn.
- Phân quyền RBAC cho người dùng và hộp kit.
- Độ chính xác số liệu Dashboard & tính năng xóa vết nhạy cảm trong Audit Log.

### 3.3. Chạy Integration & E2E Tests (Database Test Cô lập)
Để chạy các bài kiểm thử tích hợp thực tế với database:
```bash
# 1. Triển khai migrations vào database test acm_inventory_test
npm run prisma:migrate:test

# 2. Chạy bộ E2E integration test suite
npm run test:integration
```

> [!CAUTION]
> **Nguyên tắc Cô lập Database Test:**
> Bộ test integration bắt buộc chỉ được kết nối vào database có tên chứa `acm_inventory_test`. Nếu file cấu hình trỏ nhầm vào `acm_inventory` (dev) hoặc database staging/production, bộ test sẽ tự động ngắt kết nối (fail-closed) để bảo vệ toàn vẹn dữ liệu.

### 3.4. Chạy Toàn bộ Pipeline CI Tại Local
Trước khi tạo Pull Request, luôn chạy lệnh CI tổng hợp:
```bash
npm run ci
```
Lệnh này sẽ xác thực: `prisma:validate` $\rightarrow$ `typecheck` $\rightarrow$ `lint` $\rightarrow$ `build` $\rightarrow$ `test:unit`.

---

## 4. Danh mục Tài khoản Mẫu Kiểm thử (Test Credentials)

| Role | Email | Mật khẩu mặc định |
| :--- | :--- | :--- |
| **System Admin** | `admin@acm.local` | `ACM@dev2026!` |
| **Lab Manager** | `manager@acm.local` | `ACM@dev2026!` |
| **Technician** | `tech@acm.local` | `ACM@dev2026!` |
| **Student** | `student@acm.local` | `ACM@dev2026!` |
