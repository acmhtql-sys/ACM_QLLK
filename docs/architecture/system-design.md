# ACM System Architecture & Technical Design

> **Tài liệu Thiết kế Kiến trúc Hệ thống ACM (System Architecture & Technical Design)**  
> **Dự án:** ACM – Hệ thống Quản lý Linh kiện & Thiết bị  
> **Repository:** `acmhtql-sys/ACM_QLLK`

---

## 1. Monorepo Overview & Package Boundaries

Dự án được tổ chức dưới mô hình **npm Workspaces Monorepo**, đảm bảo tính mô-đun hóa, tái sử dụng mã nguồn và kiểm soát phụ thuộc chặt chẽ:

```
┌────────────────────────────────────────────────────────┐
│                    packages/shared                     │
│  - TypeScript Interfaces, Types, Enums                 │
│  - Zod Validation Schemas                              │
│  - Invariant Stock Math Formulas & Pure Functions      │
└───────────────▲────────────────────────▲───────────────┘
                │                        │
       import   │                        │   import
┌───────────────┴────────┐      ┌────────┴───────────────┐
│        apps/api        │      │        apps/web        │
│  - Express REST API    │      │  - React 18 SPA (Vite) │
│  - Prisma ORM 5        │      │  - Tailwind CSS        │
│  - PostgreSQL 15+      │      │  - TanStack Query v5   │
│  - RBAC & Security     │      │  - Lucide & Recharts   │
└────────────────────────┘      └────────────────────────┘
```

1. **`packages/shared`**:
   - Thư viện chia sẻ giữa Frontend và Backend.
   - Định nghĩa kiểu dữ liệu thống nhất, công thức tồn kho bất biến (`calculateAvailableStock`), và các Zod schema xác thực đầu vào.
2. **`apps/api`**:
   - Ứng dụng Backend RESTful API xây dựng trên Node.js 20+, Express, TypeScript và Prisma ORM.
   - Đảm nhiệm nghiệp vụ cốt lõi, bảo mật token JWT, RBAC phân quyền 4 cấp, xác thực dữ liệu, tính toán giao dịch tồn kho bằng database transaction, và ghi vết kiểm toán (Audit Trail).
3. **`apps/web`**:
   - Ứng dụng Frontend Single Page Application (SPA) xây dựng trên React 18, Vite, TypeScript và Tailwind CSS.
   - Giao diện người dùng responsive, xử lý trạng thái tải (loading), dữ liệu rỗng (empty), thông báo lỗi (error toast), dialog xác nhận xóa/thao tác quan trọng, và phiên làm việc hết hạn.

---

## 2. Cloud Architecture & Target Platforms

```
┌─────────────────────────────────────────────────────────────────┐
│                          USER BROWSER                           │
└────────────────┬───────────────────────────────▲────────────────┘
                 │ HTTPS                         │ React SPA Assets
                 ▼                               │
┌─────────────────────────────────┐   ┌──────────┴────────────────┐
│             Vercel              │   │      GitHub / Actions     │
│  - Static Asset CDN             │   │  - Source Control (Git)   │
│  - Single Page App Rewrites     │   │  - Automated CI Pipeline  │
└────────────────┬────────────────┘   └───────────────────────────┘
                 │ REST API Calls (JSON)
                 ▼
┌─────────────────────────────────┐
│             Render              │
│  - Express REST API Service     │
│  - Health Check /api/v1/health  │
│  - Fail-Closed Read-Only Guard  │
└────────────────┬────────────────┘
                 │ Session Pooler (5432) / Transaction Pooler (6543)
                 ▼
┌─────────────────────────────────┐
│            Supabase             │
│  - Managed PostgreSQL 15+       │
│  - Foreign Keys & Constraints   │
│  - Check Constraints & Indexes  │
└─────────────────────────────────┘
```

- **Frontend Hosting**: Vercel (kết nối trực tiếp từ repository GitHub, tự động build nhánh `main`).
- **Backend Hosting**: Render (Web Service chạy Node.js containerized).
- **Database**: Supabase (PostgreSQL 15+ quản trị có connection pooler PgBouncer).
- **CI/CD**: GitHub Actions (tự động linting, typecheck, prisma validation, build, unit test và integration test trên PostgreSQL 16 container).

---

## 3. Database Entity Model (Prisma ORM)

Mô hình dữ liệu bao gồm **18 thực thể (Models)** và **10 kiểu liệt kê (Enums)**, được bảo vệ bằng các chỉ mục hiệu năng cao và ràng buộc kiểm tra toàn vẹn (Database Check Constraints):

### 3.1. Danh mục Thực thể Cốt lõi (Entities)
1. **User**: Tài khoản người dùng, email duy nhất, password hash (bcrypt), trạng thái `isActive`, `isLocked`.
2. **Role**: Vai trò hệ thống (`ADMIN`, `LAB_MANAGER`, `TECHNICIAN`, `STUDENT`).
3. **Category**: Danh mục linh kiện đa cấp (hỗ trợ phân cấp cha - con qua `parentId`).
4. **Item**: Mặt hàng gốc (SKU/Code duy nhất, tên, đơn vị tính, phân loại Item Type, ngưỡng cảnh báo `minStockAlert`).
5. **Asset**: Các cá thể thiết bị đơn lẻ có mã vạch / số serial riêng biệt.
6. **Location**: Vị trí lưu trữ trong kho (phân cấp `Warehouse -> Rack -> Shelf -> Bin`).
7. **StockBalance**: Số dư tồn kho thời gian thực theo từng cặp `(itemId, locationId)`:
   - `onHand`: Tồn kho vật lý.
   - `reserved`: Số lượng giữ chỗ cho phiếu mượn đã duyệt.
   - `quarantined`: Hàng hỏng, lỗi cách ly.
   - `kitAllocated`: Hàng cấp cố định vào hộp kit.
   - `borrowed`: Hàng đã bàn giao đang mượn ngoài lab.
8. **StockMovement**: Vết dịch chuyển số lượng theo thời gian (kèm số dư trước/sau, nguyên nhân).
9. **StockReservation**: Bản ghi chi tiết các yêu cầu giữ chỗ gắn với phiếu mượn.
10. **StockTransaction & StockTransactionDetail**: Phiếu xuất, nhập, điều chỉnh kho (Import/Export/Adjustment/Transfer).
11. **BorrowRequest & BorrowDetail**: Phiếu mượn và danh sách chi tiết mặt hàng mượn.
12. **ReturnTransaction & ReturnDetail**: Phiếu nhận trả và phân loại tình trạng (Good/Damaged/Lost).
13. **Kit & KitItem**: Quản lý hộp kit thực hành và danh sách linh kiện thành phần kèm số lượng.
14. **IdempotencyRecord**: Quản lý tính lũy quyền (idempotency) cho các giao dịch kho, chống ghi trùng lặp.
15. **AuditLog**: Nhật ký kiểm toán toàn hệ thống (User, Action, Entity, OldValue, NewValue, IP, Timestamp).

### 3.2. Ràng buộc Toàn vẹn Dữ liệu (Integrity Check Constraints)
- `check_stock_balances_on_hand_non_negative`: `onHand >= 0`
- `check_stock_balances_reserved_non_negative`: `reserved >= 0`
- `check_stock_balances_quarantined_non_negative`: `quarantined >= 0`
- `check_stock_balances_kit_allocated_non_negative`: `kitAllocated >= 0`
- `check_stock_balances_borrowed_non_negative`: `borrowed >= 0`
- `check_stock_balances_allocation_limit`: `reserved + quarantined + kitAllocated <= onHand`
- `check_borrow_details_quantity_positive`: `quantity > 0`
- `check_borrow_details_returned_quantity_valid`: `returnedQuantity >= 0 AND returnedQuantity <= quantity`
- `check_return_details_quantity_positive`: `quantity > 0`
- `check_kit_item_quantity_positive`: `quantity > 0`

---

## 4. Danh mục API Endpoints Chuẩn hóa (Prefix: `/api/v1`)

### 4.1. Authentication & Users
- `POST   /api/v1/auth/login`: Đăng nhập, kiểm tra trạng thái hoạt động và cấp JWT.
- `GET    /api/v1/auth/me`: Lấy thông tin người dùng hiện tại và vai trò thực tế.
- `GET    /api/v1/users`: Danh sách người dùng kèm bộ lọc (Admin).
- `POST   /api/v1/users`: Tạo tài khoản người dùng mới (Admin).
- `PATCH  /api/v1/users/:id/status`: Khóa / Mở khóa / Kích hoạt tài khoản (Admin).
- `PATCH  /api/v1/users/:id/role`: Cập nhật vai trò người dùng (Admin).

### 4.2. Categories & Items
- `GET    /api/v1/categories`: Lấy cây danh mục phân cấp.
- `POST   /api/v1/categories`: Thêm mới danh mục linh kiện.
- `PUT    /api/v1/categories/:id`: Sửa thông tin danh mục.
- `DELETE /api/v1/categories/:id`: Xóa danh mục (chặn nếu còn linh kiện phụ thuộc).
- `GET    /api/v1/items`: Danh sách linh kiện có tìm kiếm, lọc theo loại, danh mục, phân trang.
- `POST   /api/v1/items`: Tạo mới linh kiện kèm mã SKU duy nhất.
- `PUT    /api/v1/items/:id`: Cập nhật linh kiện.
- `DELETE /api/v1/items/:id`: Vô hiệu hóa linh kiện.

### 4.3. Inventory & Stock Balances
- `GET    /api/v1/inventory/balance`: Số dư tồn kho thời gian thực theo vị trí và linh kiện.
- `POST   /api/v1/inventory/calculate-available`: Tính toán tồn khả dụng theo công thức chuẩn.
- `GET    /api/v1/stock-transactions`: Lịch sử giao dịch nhập, xuất, điều chỉnh kho.
- `POST   /api/v1/stock-transactions`: Thực hiện giao dịch kho (có hỗ trợ Idempotency-Key).

### 4.4. Borrow & Return
- `GET    /api/v1/borrow-requests`: Danh sách phiếu mượn có lọc trạng thái, tìm kiếm, phân trang.
- `POST   /api/v1/borrow-requests`: Tạo yêu cầu mượn linh kiện mới (Student/Borrower).
- `PATCH  /api/v1/borrow-requests/:id/approve`: Duyệt phiếu mượn (chuyển trạng thái sang `APPROVED`, tăng `Reserved`).
- `PATCH  /api/v1/borrow-requests/:id/reject`: Từ chối phiếu mượn.
- `POST   /api/v1/borrow-requests/:id/handover`: Bàn giao linh kiện (giảm `OnHand` & `Reserved`, tăng `Borrowed`).
- `POST   /api/v1/borrow-requests/:id/return`: Nhận trả linh kiện (hỗ trợ trả một phần, hàng hỏng/mất).

### 4.5. Kits Management
- `GET    /api/v1/kits`: Danh sách hộp kit kèm linh kiện thành phần.
- `POST   /api/v1/kits`: Tạo mới hộp kit và cấp phát linh kiện.
- `GET    /api/v1/kits/:id`: Xem chi tiết hộp kit.
- `PUT    /api/v1/kits/:id`: Cập nhật hộp kit.

### 4.6. Dashboard, Reports & Audit Log
- `GET    /api/v1/reports/summary`: Báo cáo KPI tổng quan (Tổng linh kiện, tồn khả dụng, đang mượn, cảnh báo sắp hết).
- `GET    /api/v1/reports/inventory`: Báo cáo chi tiết tồn kho theo danh mục và vị trí.
- `GET    /api/v1/audit-logs`: Nhật ký kiểm toán hệ thống (đã che giấu mật khẩu, token và thông tin nhạy cảm).
