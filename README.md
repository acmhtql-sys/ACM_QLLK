# ACM – Components & Equipment Management System

> **Hệ thống Quản lý Linh kiện & Thiết bị (Air Components Manager)** dành cho Phòng Lab Nghiên cứu, Trung tâm AI & Robotics, và Cơ sở Đào tạo Kỹ thuật.  
> Repository: `acmhtql-sys/ACM_QLLK`

---

## 1. Tổng quan Kiến trúc (Architecture Overview)

Hệ thống được thiết kế theo kiến trúc **Monorepo** sử dụng **npm Workspaces**, phân tách rõ ràng giữa các ứng dụng và thư viện dùng chung:

```text
ACM_QLLK/
├── apps/
│   ├── web/                     # Frontend: React 18 + Vite + TypeScript + Tailwind CSS
│   │   ├── public/              # Static assets
│   │   ├── src/
│   │   │   ├── app/             # Router & Root App Component
│   │   │   ├── pages/           # SaaS Dashboard, Inventory, Borrow, Users, Kits, Audit Logs
│   │   │   ├── layouts/         # Sidebar, Header, DashboardLayout
│   │   │   ├── components/      # UI Components, Modals, Badges, Toast notifications
│   │   │   ├── hooks/           # Custom React hooks (useAuth, useToast, ...)
│   │   │   ├── services/        # API Client (Axios) kết nối REST backend
│   │   │   └── styles/          # Tailwind CSS styles
│   │   ├── .env.example         # Frontend environment template
│   │   └── package.json
│   └── api/                     # Backend: Node.js 20+ Express + TypeScript + Prisma ORM
│       ├── src/
│       │   ├── config/          # Environment loader, Prisma client, Logger, Security policy
│       │   ├── modules/         # Modular Routers (auth, items, categories, inventory, borrow, kits, reports, audit)
│       │   ├── middleware/      # Error handler, JWT auth, RBAC, Validation, Audit logger
│       │   ├── shared/          # AppError, Response helpers, Invariant checkers
│       │   ├── app.ts           # Express Application Factory
│       │   └── server.ts        # Server HTTP Bootstrap
│       ├── prisma/
│       │   ├── schema.prisma    # PostgreSQL Schema (17 models, 10 enums, check constraints)
│       │   ├── migrations/      # Version-controlled SQL migrations
│       │   └── seed.ts          # Seed script demo an toàn cho local dev
│       ├── scripts/             # Scripts hỗ trợ test DB isolation & migration
│       ├── tests/               # Vitest Unit, Mock, Integration & E2E test suites
│       ├── .env.example         # Backend environment template
│       └── package.json
├── packages/
│   └── shared/                  # Common TypeScript types, Enums, Zod schemas, Invariant formulas
├── docs/                        # Toàn bộ tài liệu kiến trúc, đặc tả, cài đặt & deployment
│   ├── architecture/            # System Architecture & Technical Design
│   ├── development/             # Development Setup Guide
│   ├── product/                 # Product Overview & Scope
│   ├── requirements/            # Functional Requirements Specification
│   └── DEPLOYMENT_READINESS.md  # Cloud Deployment Readiness & Infrastructure Audit Matrix
├── database/                    # Database init scripts & SQL backups
├── infra/                       # Dockerfiles cho Web và API
├── .github/workflows/           # GitHub Actions CI pipeline với PostgreSQL 16 container
├── .env.example                 # Root configuration template
├── docker-compose.yml           # Local container orchestration
├── package.json                 # Monorepo npm workspaces config
└── README.md
```

---

## 2. Công nghệ Sử dụng (Technology Stack)

| Tầng hệ thống (Layer) | Công nghệ |
| :--- | :--- |
| **Frontend** | React 18, Vite 5, TypeScript 5, Tailwind CSS 3, React Router v6, TanStack Query v5, Axios, Lucide React, Recharts |
| **Backend** | Node.js 20+, Express 4, TypeScript 5, Prisma ORM 5, PostgreSQL 15+, Zod 3, JWT, bcryptjs, Helmet, Morgan |
| **Testing & CI** | Vitest 2, Supertest 7, Testing Library, GitHub Actions (Ubuntu + PostgreSQL 16 container) |
| **Hạ tầng Đám mây (Target)** | GitHub (VCS & CI), Supabase (PostgreSQL), Render (API Web Service), Vercel (Frontend SPA) |

---

## 3. Quy tắc Cốt lõi Quản lý Tồn kho (Inventory Invariant Rules)

### 3.1. Công thức Tồn khả dụng (Available Stock)
$$\text{Available} = \text{OnHand} - \text{Reserved} - \text{Quarantined} - \text{KitAllocated}$$

### 3.2. Định nghĩa các nhóm tồn kho (Non-overlapping Quantities)
- **OnHand**: Tồn kho vật lý đang nằm trên kệ/ngăn trong kho của phòng lab.
- **Reserved**: Số lượng đã được duyệt trong phiếu mượn (`APPROVED`), đang chờ người mượn đến nhận.
- **Quarantined**: Số lượng hàng lỗi, hỏng cách ly chờ thanh lý/sửa chữa (không được phép xuất).
- **KitAllocated**: Số lượng linh kiện đã gộp cố định vào các bộ Kit thực hành.
- **Borrowed (Đang mượn)**: Số lượng linh kiện **đã bàn giao thực tế** ra ngoài lab.

> [!IMPORTANT]
> **Quy tắc Bàn giao một chiều (Single Decrement):** Khi bàn giao tài sản cho người mượn:
> - `OnHand` giảm (linh kiện rời khỏi kho).
> - `Reserved` giảm (giải phóng trạng thái giữ chỗ).
> - `Borrowed` tăng (ghi nhận số lượng đang lưu hành bên ngoài).
> Do `OnHand` đã giảm trực tiếp khi xuất kho, công thức tính Tồn khả dụng **tuyệt đối không trừ thêm `Borrowed` lần thứ hai**.

### 3.3. Ràng buộc Tồn kho Không Âm (Database Check Constraints)
- `onHand >= 0`, `reserved >= 0`, `quarantined >= 0`, `kitAllocated >= 0`, `borrowed >= 0`
- `reserved + quarantined + kitAllocated <= onHand`
- `Available >= 0` (Hệ thống chặn duyệt phiếu mượn hoặc xuất kho nếu vượt quá `Available`)

---

## 4. Hướng dẫn Cài đặt & Khởi động Nhanh (Getting Started)

### 4.1. Yêu cầu Tiên quyết (Prerequisites)
- **Node.js**: >= 20.x LTS
- **npm**: >= 10.x
- **PostgreSQL**: 15+ (Local service, Docker Compose, hoặc Cloud database)
- **Git**

### 4.2. Cài đặt Dependencies toàn Monorepo
```bash
npm install
```

### 4.3. Cấu hình Biến môi trường (Environment Setup)
Sao chép template `.env.example` thành file `.env` tại thư mục gốc:
```bash
cp .env.example .env
```
Mở file `.env` và cập nhật chuỗi kết nối `DATABASE_URL` cùng `JWT_SECRET` phù hợp với máy của bạn.

### 4.4. Generate Prisma Client & Kiểm tra Schema
```bash
npm run prisma:generate
npm run prisma:validate
```

### 4.5. Build Toàn bộ Packages
```bash
npm run build
```
*(Lệnh này sẽ tự động build `packages/shared`, `apps/api`, và `apps/web` theo đúng thứ tự phụ thuộc).*

### 4.6. Khởi động Môi trường Phát triển (Development)
```bash
# Khởi động đồng thời cả API và Frontend:
npm run dev:api    # Backend chạy tại: http://localhost:5000
npm run dev:web    # Frontend chạy tại: http://localhost:5173
```

---

## 5. Danh mục Scripts Monorepo (Scripts Catalog)

Tất cả các scripts chuẩn hóa đều có thể chạy trực tiếp từ thư mục gốc:

| Lệnh (Command) | Chức năng (Purpose) |
| :--- | :--- |
| `npm run dev` | Khởi động frontend Web development server (Vite) |
| `npm run dev:api` | Khởi động backend API với hot-reload (`tsx watch`) |
| `npm run dev:web` | Khởi động frontend Web với Vite dev server |
| `npm run build` | Build tuần tự toàn bộ monorepo (`shared` $\rightarrow$ `api` $\rightarrow$ `web`) |
| `npm run build:shared` | Biên dịch TypeScript cho package `@acm/shared` |
| `npm run build:api` | Biên dịch TypeScript cho backend `@acm/api` |
| `npm run build:web` | Đóng gói production bundle cho frontend `@acm/web` qua Vite |
| `npm run typecheck` | Kiểm tra lỗi kiểu dữ liệu TypeScript trên toàn bộ workspaces |
| `npm run lint` | Chạy linter / compiler verification trên toàn bộ workspaces |
| `npm run prisma:generate` | Tạo Prisma Client từ schema |
| `npm run prisma:validate` | Kiểm tra tính hợp lệ của schema Prisma |
| `npm run test` | Chạy toàn bộ test suites trên các workspaces |
| `npm run test:unit` | Chạy bộ Unit Tests độc lập qua Vitest (mock database) |
| `npm run test:integration` | Chạy bộ Integration & E2E Tests trên database test cô lập |
| `npm run prisma:migrate:test`| Áp dụng migrations an toàn vào database `acm_inventory_test` |
| `npm run prisma:seed:test` | Nạp dữ liệu kiểm thử vào database `acm_inventory_test` |
| `npm run ci` | Chạy quy trình CI toàn diện (Validate + Typecheck + Lint + Build + Test) |

---

## 6. Quản trị Cơ sở Dữ liệu & Migrations (Database Workflow)

### 6.1. Quy tắc An toàn Tuyệt đối
1. **Không chạy `prisma db push`** trên bất kỳ môi trường nào có quản lý version. Mọi thay đổi phải thông qua Prisma Migrations.
2. **Không chạy `prisma migrate reset`** trên môi trường chia sẻ, staging hoặc production.
3. **Cô lập Môi trường Test:** Toàn bộ test integration chỉ được kết nối vào database có tên chứa hậu tố `acm_inventory_test`. Hệ thống tích hợp sẵn rào chắn fail-closed tự động ngắt nếu phát hiện kết nối nhầm sang database khác.

### 6.2. Tạo Migration Mới (Local Development)
```bash
cd apps/api
npx prisma migrate dev --name <ten_migration>
```

### 6.3. Triển khai Migration (Staging / Production)
Khi được phép triển khai, chạy lệnh migration có quản lý:
```bash
npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
```

---

## 7. Quy trình Sao lưu & Phục hồi (Backup & Disaster Recovery)

### 7.1. Sao lưu Cơ sở Dữ liệu (Backup via `pg_dump`)
```bash
# Tạo bản sao lưu nhị phân nén hoàn chỉnh (Schema + Data)
pg_dump -h localhost -U postgres -d acm_inventory -F c -b -v -f "database/backups/acm_backup_$(date +%Y%m%d_%H%M%S).dump"

# Tạo bản sao lưu cấu trúc DDL (Schema only)
pg_dump -h localhost -U postgres -d acm_inventory -s -f "database/backups/acm_schema_$(date +%Y%m%d_%H%M%S).sql"
```

### 7.2. Phục hồi Dữ liệu (Restore via `pg_restore`)
```bash
# Phục hồi từ bản sao lưu nén (.dump)
pg_restore -h localhost -U postgres -d acm_inventory -c -v "database/backups/<ten_file_backup>.dump"
```

### 7.3. Rollback Ứng dụng & Dịch vụ Đám mây
- **Vercel (Frontend):** Instant Rollback qua giao diện Dashboard $\rightarrow$ Deployments $\rightarrow$ Promote to Production bản build trước đó.
- **Render (Backend):** Redeploy commit trước đó qua giao diện Dashboard $\rightarrow$ Web Service $\rightarrow$ Events $\rightarrow$ Rollback.
- **Chi tiết xem tại:** [docs/DEPLOYMENT_READINESS.md](./docs/DEPLOYMENT_READINESS.md).

---

## 8. Tài khoản Thử nghiệm Mặc định (Demo Credentials)

| Vai trò (Role) | Email | Mật khẩu mặc định | Phạm vi quyền hạn |
| :--- | :--- | :--- | :--- |
| **System Admin** | `admin@acm.local` | `ACM@dev2026!` | Quản trị toàn hệ thống, quản lý tài khoản, xem audit log |
| **Lab Manager** | `manager@acm.local` | `ACM@dev2026!` | Quản lý kho, nhập/xuất, duyệt mượn trả, kiểm kê tồn kho |
| **Technician** | `tech@acm.local` | `ACM@dev2026!` | Kiểm tra kỹ thuật, kiểm kê, báo hỏng, duyệt mượn theo phân công |
| **Student** | `student@acm.local` | `ACM@dev2026!` | Tra cứu danh mục, kiểm tra tồn khả dụng, tạo yêu cầu mượn |

---

## 9. Ma trận Trạng thái Triển khai Đám mây (Cloud Deployment Readiness)

| Nền tảng | Thành phần | Đã Cấu hình | Đã Kiểm thử | Đã Triển khai thật | Ghi chú |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **GitHub** | Repository & CI/CD | ✅ | ✅ | ✅ | `acmhtql-sys/ACM_QLLK`, Actions CI workflow |
| **Supabase** | Cloud PostgreSQL | ✅ | ✅ | ⚠️ **Chưa triển khai** | Project `acm-qllk-staging` (`dqctxaoaxhtqtgmtsysk`), 0 migration applied |
| **Render** | API Web Service | ✅ | ✅ | ⚠️ **Chưa triển khai** | Express API, đã kiểm thử build và test, chờ DB migration |
| **Vercel** | Frontend SPA | ✅ | ✅ | ⚠️ **Chưa triển khai** | React Vite SPA, `vercel.json`, chờ backend deployment |

Chi tiết checklist và quy trình triển khai: Xem tài liệu **[Cloud Deployment Readiness Audit](./docs/DEPLOYMENT_READINESS.md)**.

---

## 10. Danh mục Tài liệu Kỹ thuật Chi tiết (Documentation Index)

- [Product Overview & Scope](./docs/product/overview.md)
- [Functional Requirements & Invariant Rules](./docs/requirements/specs.md)
- [System Architecture & Cloud Design](./docs/architecture/system-design.md)
- [Development Setup Guide](./docs/development/setup-guide.md)
- [Cloud Deployment Readiness & Infrastructure Audit](./docs/DEPLOYMENT_READINESS.md)
- [Phase 11 – Staging Readiness & Configuration Audit](./docs/phase11/STAGING_READINESS.md)
- [Phase 11 – UAT Checklist (isolated test + cloud read-only smoke)](./docs/phase11/UAT_CHECKLIST.md)
- [Authentication & Authorization Specifications](./Authentication_&_Authorization)
- [User Management Specifications](./User_Management)
- [Category & Item Management Specifications](./Category_&_Item_Management)
- [Inventory & Location Management Specifications](./Inventory_&_Location_Management)
- [Import, Export & Stock Transactions Specifications](./Import,_Export_&_Stock_Transactions)
- [Borrow & Return Management Specifications](./Borrow_&_Return_Management)
