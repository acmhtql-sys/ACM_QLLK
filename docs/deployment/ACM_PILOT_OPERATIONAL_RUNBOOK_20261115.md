\# SỔ TAY VẬN HÀNH PILOT VÀ QUY TRÌNH BÀN GIAO HỆ THỐNG ACM (15/11/2026)



\## 1. Kiến trúc hệ thống và Kiểm soát ngân sách ($0 chi phí phát sinh)

\- \*\*Frontend Web:\*\* Triển khai trên Vercel Preview/Hobby tier, kết nối API qua biến môi trường VITE\_API\_BASE\_URL.

\- \*\*Backend API:\*\* Triển khai trên Render Free Web Service (acm-api-staging-29fw), cấu hình VITE\_API\_TIMEOUT\_MS=90000 (xử lý cold-start 90 giây).

\- \*\*Cơ sở dữ liệu:\*\* PostgreSQL 17.11 trên Supabase Staging (acm-qllk-staging), kích hoạt RLS toàn bộ 20 bảng, duy trì cờ STAGING\_READ\_ONLY=true.



\## 2. Ma trận vận hành 4 vai trò (RBAC Operational Matrix)

\- \*\*ADMIN:\*\* Quản trị danh mục thiết bị, phê duyệt tài khoản, xem thống kê KPI chuyên sâu trên Dashboard.

\- \*\*LAB\_MANAGER:\*\* Tiếp nhận thông báo mượn linh kiện, phê duyệt/từ chối phiếu tại tab Chờ duyệt (Pending), gỡ cờ đối soát NEEDS\_RECONCILIATION.

\- \*\*TECHNICIAN:\*\* Bàn giao linh kiện vật lý tại kho, tiếp nhận hoàn trả và chuyển thiết bị hỏng vào kho cách ly kiểm định (Quarantine-First).

\- \*\*STUDENT:\*\* Tra cứu danh mục, kiểm tra tồn khả dụng, đăng ký tạo phiếu mượn linh kiện phục vụ môn học.



\## 3. Quy trình Sao lưu và Phục hồi thảm họa (Disaster Recovery \& Backup/Restore)

\- \*\*Lệnh sao lưu định kỳ trước mỗi phiên UAT:\*\*

&#x20; pg\_dump -h 127.0.0.1 -p 55433 -U acm\_d8\_admin -d acm\_stage4c\_isolated\_test -F c -b -v -f "backups/acm\_snapshot.dump"

\- \*\*Kịch bản hoàn nguyên sạch (Guarded Rollback):\*\*

&#x20; Thực thi tệp docs/stage4c\_guarded\_rollback.sql để làm sạch bảng thử nghiệm khi không còn bản ghi COMPLETED.



\## 4. Tiêu chí xét duyệt GO / NO-GO cho mốc Pilot 15/11/2026

\- \[x] Giao diện Web: Nút tạo phiếu có cơ chế bảo vệ chỉ đọc, không phát sinh POST đột biến (PR #95).

\- \[x] Cơ sở dữ liệu: Hoàn tất kiểm chứng PostgreSQL 17 cô lập với các mã lỗi SQLSTATE 23505, 23514, 23503 (PR #94).

\- \[x] Nghiệm thu người dùng: 4/4 vai trò đạt PASS trên môi trường Vercel Preview (Issue #15).

\- \[x] Tầng dịch vụ: 279/279 bài test tự động Vitest đạt 100% PASS.

