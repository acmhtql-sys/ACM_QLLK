# ACM Functional Requirements Specification

Tài liệu này tổng hợp và liên kết với các tài liệu Use Case hiện có trong thư mục gốc của dự án:
- `Authentication_&_Authorization/`
- `User_Management/`
- `Category_&_Item_Management/`
- `Inventory_&_Location_Management/`
- `Import,_Export_&_Stock_Transactions/`
- `Borrow_&_Return_Management/`

---

## 1. Inventory Balancing & Stock Invariant Rule (Quy tắc Tồn kho Bất biến)

### 1.1. Công thức tính Tồn Khả dụng (Available Stock)
```text
Available = OnHand - Reserved - Quarantined - KitAllocated
```

### 1.2. Phân định rõ ranh giới các nhóm tồn kho (Non-overlapping Quantities)
- **OnHand (Tồn kho vật lý trong kho)**: Số lượng thực tế đang nằm trên kệ/ngăn trong kho của phòng lab.
- **Reserved (Đã giữ chỗ)**: Số lượng đã được phê duyệt trong phiếu mượn (Approved Borrow Requests) hoặc chuẩn bị đóng kit, đang nằm trong kho nhưng chờ bàn giao cho người mượn.
- **Quarantined (Cách ly / Hỏng hóc)**: Số lượng hàng lỗi, hỏng khi trả về hoặc chờ kiểm định, đang để trong kho nhưng không được phép xuất hay mượn.
- **KitAllocated (Đã cấp cho Kit)**: Số lượng linh kiện đã gộp cố định vào bộ kit học tập thực hành.
- **Borrowed (Đang mượn ngoài kho)**: Số lượng linh kiện **đã xuất kho bàn giao** cho sinh viên/giảng viên mang ra ngoài sử dụng.
  - **Quy tắc quan trọng (Không trừ hai lần)**:
    Khi bàn giao linh kiện (Handover):
    - `OnHand` giảm (vì linh kiện rời khỏi kho vật lý).
    - `Reserved` giảm (vì giải phóng trạng thái giữ chỗ).
    - `Borrowed` tăng (ghi nhận số lượng đang lưu hành bên ngoài).
    Do `OnHand` đã giảm tại thời điểm bàn giao, công thức `Available = OnHand - Reserved - Quarantined - KitAllocated` **tuyệt đối không trừ thêm `Borrowed` một lần nữa**. Nếu trừ thêm `Borrowed` thì linh kiện đang mượn sẽ bị trừ hai lần.

### 1.3. Ràng buộc Tồn kho Không Âm (Non-negative Constraints)
- `OnHand >= 0`
- `Reserved >= 0`
- `Quarantined >= 0`
- `KitAllocated >= 0`
- `Borrowed >= 0`
- `Available >= 0` (Hệ thống chặn duyệt phiếu mượn hoặc xuất kho nếu `RequestedQuantity > Available`)

---

## 2. Actors & Role-Based Access Control (RBAC)

| Vai trò (Role) | Mô tả | Quyền hạn chính trong Phase 1 |
| :--- | :--- | :--- |
| **ADMIN** | Quản trị viên hệ thống | Toàn quyền cấu hình, quản lý người dùng, xem audit log, giám sát hệ thống |
| **LAB_MANAGER** | Quản lý phòng Lab / Thủ kho | Nhập/xuất kho, duyệt phiếu mượn, bàn giao, nhận trả, kiểm kê tồn kho |
| **TECHNICIAN** | Kỹ thuật viên / Trợ giảng | Kiểm tra thiết bị, báo hỏng, hỗ trợ kiểm kê, phê duyệt phiếu mượn theo quyền |
| **STUDENT** | Sinh viên / Người mượn | Tra cứu danh mục, kiểm tra tồn khả dụng, tạo yêu cầu mượn, theo dõi phiếu mượn |

---

## 3. Quy trình Mượn & Trả (Borrow & Return Lifecycle)

```
[Student tạo phiếu] -> PENDING
         │
         ▼
[Lab Manager duyệt] -> APPROVED (Tăng Reserved, kiểm tra Available >= Requested)
         │
         ▼
[Bàn giao thực tế]  -> HANDED_OVER (Giảm OnHand & Reserved, Tăng Borrowed)
         │
         ▼
[Nhận lại tài sản]  -> RETURNED
                         ├── Hàng nguyên vẹn: Giảm Borrowed, Tăng OnHand
                         ├── Hàng hỏng: Giảm Borrowed, Tăng Quarantined
                         └── Hàng mất: Giảm Borrowed, Ghi nhận báo mất (không tăng OnHand)
```

---

## 4. Những phần đã hoàn thiện & Tiến độ Phát triển
1. **Quản lý đa cơ sở/đa phòng Lab**: Location thiết kế theo mô hình phân cấp `Warehouse -> Rack -> Shelf -> Bin` linh hoạt, đáp ứng 1 hoặc nhiều phòng lab.
2. **Barcode/QR Code scanner**: Cung cấp trường dữ liệu `barcode` và `serialNumber` trên từng `Asset` và `Item`, giao diện có sẵn ô tìm kiếm nhanh bằng barcode.
3. **Cảnh báo trễ hạn**: Tự động đánh dấu cờ `isOverdue` dựa trên hạn trả `expectedReturnDate` và hiển thị cảnh báo đỏ trên Dashboard.
4. **Quản lý Hộp Kit (Kit Management)**: Đã hoàn thiện trong Phase 5 gồm tạo/sửa/xem hộp kit, quản lý linh kiện thành phần, và đồng bộ với tồn kho qua `kitAllocated`.
