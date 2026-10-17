# Phase 11 — Biên bản UAT API/DB tự động (không thay thế UAT thủ công)

**Ngày:** 17/10/2026 · **Dự án:** ACM – Hệ thống Quản lý Linh kiện & Thiết bị

## 1. Môi trường và bằng chứng

- **Loại xác minh:** Automated API + PostgreSQL database acceptance rehearsal. **Không phải kiểm thử thủ công giao diện**.
- **Commit đã kiểm chứng:** `593ee81` trong [GitHub Actions run 38997088740](https://github.com/acmhtql-sys/ACM_QLLK/actions/runs/38997088740).
- **Kết quả tại run được ghi nhận:** Shared 135, API 171, Web 11, Integration/E2E 29, UAT ledger 1: **347/347 bài PASS**; static staging preflight **16/16 PASS**.
- **Chứng cứ xuất ra:** artifact `phase11-ledger-evidence` tại mục **Artifacts** của GitHub Actions run; file JSON chỉ có các ID kịch bản, số dư và số bản ghi tổng hợp, không có thông tin đăng nhập/secret.
- **Cổng an toàn:** `NODE_ENV=test`, URL PostgreSQL trỏ `127.0.0.1/localhost` và tên DB đúng `acm_inventory_test`, kiểm chứng thêm qua `SELECT current_database()`. CI sử dụng container PostgreSQL 16 có migration và seed kiểm thử, không truy cập Cloud.
- **Lưu ý:** Các thay đổi tài liệu/test tiếp theo phải có **CI mới đạt** trước khi xem nhánh hiện tại là đã xác minh.

## 2. Sổ đối soát từng nghiệp vụ

Cột trạng thái theo thứ tự **(OnHand, Reserved, Borrowed, Quarantined, KitAllocated, Available)**. Đây là các giá trị đã được test đối chiếu bằng truy vấn vào DB trên run thành công, không phải số liệu Production.

| UAT ID | Giao dịch API | Số dư trước | Số dư sau | HTTP | Kết quả |
|---|---|---|---|---:|---|
| 01 | Tạo item và nhập 10 | (0,0,0,0,0,0)* | (10,0,0,0,0,10) | 201 | PASS |
| 02 | STUDENT tạo phiếu mượn 4 | (10,0,0,0,0,10) | (10,0,0,0,0,10) | 201 | PASS |
| 03 | LAB_MANAGER duyệt | (10,0,0,0,0,10) | (10,4,0,0,0,6) | 200 | PASS |
| 04 | TECHNICIAN bàn giao | (10,4,0,0,0,6) | (6,0,4,0,0,6) | 200 | PASS |
| 11 | Thử trả khác kho nguồn | (6,0,4,0,0,6) | Không thay đổi | 409 | PASS |
| 10 | Thử hoàn trả trùng dòng | (6,0,4,0,0,6) | Không thay đổi | 422 | PASS |
| 05 | Trả 2 GOOD đúng kho | (6,0,4,0,0,6) | (8,0,2,0,0,8) | 200 | PASS |
| 06 | Trả 1 DAMAGED đúng kho | (8,0,2,0,0,8) | (9,0,1,1,0,8) | 200 | PASS |
| 07 | Báo LOST 1 đúng kho | (9,0,1,1,0,8) | (9,0,0,1,0,8) | 200 | PASS |

\* Số dư 0 ở bước 01 là điểm xuất phát của item thử nghiệm mới chưa có tồn, được xác minh thêm ở phiên bản test mới. Sổ bằng chứng của run `593ee81` ghi `before=null` vì bản test đó chưa lưu trạng thái khởi tạo. Không diễn giải `null` thành số dư Production.

**Đối chiếu cuối:** 3 ReturnTransaction, 5 StockMovement (1 nhập + 1 bàn giao + 3 trả), Audit Log của BorrowRequest tối thiểu 6 mục; `returnedQuantity=4`; tổng `quantityDelta=9` khớp `onHand=9`.

## 3. Những gì chưa nghiệm thu

- [ ] QA/người dùng chạy bộ 18 kịch bản UAT thủ công trên môi trường test cô lập (UAT-08,09,12–18 chưa được bộ ledger chuyên biệt kiểm chứng; một số có coverage E2E khác).
- [ ] Xác nhận mô hình phân quyền Reports/Audit Logs ADMIN-only của MVP.
- [ ] Kiểm tra chất lượng giao diện, lỗi mạng, truy cập qua trình duyệt, trải nghiệm người dùng thực.
- [ ] Cloud read-only smoke sau khi có phê duyệt độc lập; chưa triển khai Supabase/Render/Vercel.
- [ ] Ký nghiệm thu và phê duyệt merge PR #7 vào `main`.

**Kết luận hiện tại:** bộ kiểm tra API và tồn kho tự động đã đạt trên DB test; **chưa đủ điều kiện ký nghiệm thu hoặc phát hành**.
