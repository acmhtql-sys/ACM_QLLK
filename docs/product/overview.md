# ACM – Components & Equipment Management System
## Product Overview & Scope (Phase 1 Foundation)

### 1. Vision & Purpose
ACM (Air Components Manager) là hệ thống toàn diện quản lý linh kiện điện tử, vi điều khiển, cảm biến, linh kiện tiêu hao và thiết bị máy móc phục vụ cho:
- **Phòng thí nghiệm nghiên cứu (Labs)**.
- **Trung tâm AI & Robotics**.
- **Cơ sở đào tạo kỹ thuật, trường đại học & cao đẳng**.

Hệ thống giải quyết bài toán cốt lõi:
1. Thất thoát linh kiện, không rõ ai mượn - ai giữ.
2. Thiếu số liệu tồn kho khả dụng thời gian thực khi sinh viên/kỹ thuật viên đăng ký mượn làm đồ án/dự án.
3. Không phân định rõ ràng giữa hàng trong kho (On-hand), hàng đã đặt trước (Reserved), hàng đang mượn ngoài kho (Borrowed), hàng hỏng cách ly (Quarantined) và hàng đóng gói theo Kit (KitAllocated).
4. Thiếu vết kiểm toán (Audit Trail) khi xuất nhập và điều chỉnh số lượng.

---

### 2. Core Functional Modules (Phase 1 Scope)
1. **Authentication & RBAC**:
   - Đăng nhập, đăng xuất, cấp phát JWT, xác thực phiên làm việc.
   - 4 vai trò chính: System Administrator, Lab Manager, Technician/Instructor, Student/Borrower.
2. **User Management**:
   - Quản lý hồ sơ người dùng, phân quyền vai trò, kích hoạt/vô hiệu hóa tài khoản.
3. **Category & Item Management**:
   - Phân loại danh mục đa cấp (Vi điều khiển, Cảm biến, Động cơ, Linh kiện tiêu hao,...).
   - Quản lý thông tin linh kiện: Mã linh kiện (SKU/Code), Tên, Mô tả, Đơn vị tính (Unit), Phân loại Item Type (Consumable vs Tracked Asset vs Equipment).
4. **Inventory & Location Management**:
   - Quản lý vị trí lưu trữ đa cấp: Kho (Warehouse) -> Kệ (Rack) -> Hộp/Ngăn (Bin).
   - Tính toán tồn kho chính xác theo công thức không cho phép số âm.
5. **Stock Transactions (Import/Export/Adjustment)**:
   - Ghi nhận lịch sử giao dịch kho với Transaction Type và chi tiết từng dòng mặt hàng.
6. **Borrow & Return Management**:
   - Sinh viên tạo phiếu mượn (Borrow Request).
   - Giữ chỗ tồn kho (Stock Reservation) khi phiếu được phê duyệt.
   - Bàn giao linh kiện (Handover) và cập nhật số lượng mượn.
   - Trả linh kiện (Return) phân loại theo tình trạng (Good / Damaged / Missing).
7. **Dashboard & Reporting**:
   - Tổng quan KPI: Tổng số mặt hàng, Tồn kho khả dụng, Phiếu mượn đang xử lý, Cảnh báo sắp hết hàng.
   - Biểu đồ phân bố tồn kho và trạng thái mượn trả.
8. **Audit Log**:
   - Ghi lại mọi biến động dữ liệu nhạy cảm (Ai làm gì, vào thời điểm nào, dữ liệu trước và sau thay đổi).

*Lưu ý: Kit Management đã được hoàn thiện trong Phase 5 với mô hình dữ liệu Kit & KitItem chuyên biệt và công thức phân bổ tồn kho kitAllocated.*
