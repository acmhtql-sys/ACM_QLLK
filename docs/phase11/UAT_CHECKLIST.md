# ACM Phase 11 – UAT Checklist / Nghiệm thu MVP

**Ngày lập:** 17/10/2026 · **Phạm vi:** chỉ hoàn trả về đúng kho nguồn · **Tất cả mục dưới đây là kế hoạch, chưa phải kết quả kiểm thử thủ công.**

> **Bằng chứng UAT tự động:** CI chạy `npm run test:uat:ledger` trên PostgreSQL `acm_inventory_test` cô lập. Artifact `phase11-ledger-evidence` ghi số dư trước/sau từng kịch bản. Đây chỉ là **API/DB rehearsal**, không phải UAT giao diện hay ký nghiệm thu thủ công. Các ô manual bên dưới vẫn để trống.

> **Phase 11B API/DB gates đã xác minh:** [GitHub Actions run 38999290555](https://github.com/acmhtql-sys/ACM_QLLK/actions/runs/38999290555) đạt **353/353 bài**, gồm 6 kiểm thử Phase 11B. Artifact `phase11b-gates-evidence` có trạng thái từng case và xác nhận dọn dữ liệu thử. Bao phủ UAT-08,09,12,15,17 và một phần UAT-16/18. Các ô UAT thủ công vẫn giữ trống; xem [biên bản UAT tự động](./UAT_AUTOMATED_RESULTS.md).

## A. Tiền điều kiện và dữ liệu kiểm thử

- [ ] QA dùng đúng commit PR #7, có tên người kiểm thử, ngày, phiên bản và ID chạy CI.
- [ ] Chạy **chỉ trên PostgreSQL `acm_inventory_test` tách biệt**, xác minh bằng `SELECT current_database()` trước test. Không dùng Supabase, dev DB, staging read-only hay production để chạy kịch bản ghi.
- [ ] Tạo tài khoản kiểm thử 4 vai trò ADMIN / LAB_MANAGER / TECHNICIAN / STUDENT chỉ trên test DB, không tái sử dụng thông tin mật khẩu demo trên Cloud.
- [ ] Bộ fixture đơn giản có ít nhất hai linh kiện, hai vị trí kho và một vị trí không có tồn; ghi lại số dư `onHand/reserved/borrowed/quarantined/kitAllocated` trước mọi test.
- [ ] Chụp chứng cứ response, trace nếu được phép và ảnh UI (che token, mật khẩu và connection strings). Thiết lập quy trình dọn dữ liệu test.

## B. Kịch bản nghiệp vụ có ghi — LOCAL / ISOLATED ONLY

| ID | Vai trò | Hành động | Tiêu chí PASS | Trạng thái |
|---|---|---|---|---|
| UAT-01 | ADMIN / LAB_MANAGER | Tạo linh kiện, vị trí và nhập kho 10 | Tồn `onHand=10`, `available=10`, có lịch sử nhập | ☐ |
| UAT-02 | STUDENT | Tra cứu danh mục, tạo phiếu mượn 4 | Phiếu `PENDING`, tồn kho chưa giảm | ☐ |
| UAT-03 | LAB_MANAGER | Duyệt phiếu 4 | `APPROVED`, `reserved=4`, `onHand=10`, `available=6` | ☐ |
| UAT-04 | TECHNICIAN | Bàn giao 4 | `HANDED_OVER`, `onHand=6`, `reserved=0`, `borrowed=4`, `available=6` | ☐ |
| UAT-05 | TECHNICIAN | Trả 2 GOOD đúng kho | `PARTIALLY_RETURNED`, `onHand=8`, `borrowed=2`, `available=8`, stock movement đúng | ☐ |
| UAT-06 | TECHNICIAN | Trả 1 DAMAGED đúng kho | `onHand=9`, `quarantined=1`, `borrowed=1`, `available=8` | ☐ |
| UAT-07 | TECHNICIAN | Báo LOST 1 đúng kho | `RETURNED`, `onHand=9`, `quarantined=1`, `borrowed=0`, `available=8` | ☐ |
| UAT-08 | LAB_MANAGER | Hủy phiếu `APPROVED` mới có `reserved>0` | Hoàn toàn giải phóng `reserved`, `onHand` không bị giảm | ☐ |
| UAT-09 | LAB_MANAGER | Duyệt phiếu vượt `available` | Bị từ chối; không có `reserved` âm/giữ chỗ vượt quá | ☐ |
| UAT-10 | TECHNICIAN | Trả trùng `borrowDetailId` cùng payload | HTTP 422; không phát sinh ReturnTransaction / StockMovement | ☐ |
| UAT-11 | TECHNICIAN | Trả 1 linh kiện sang vị trí khác kho nguồn | HTTP 409; số dư nguồn và đích không đổi | ☐ |
| UAT-12 | TECHNICIAN | Trả từ phiếu có nhiều kho nguồn, thiếu phân bổ | HTTP 409; không tự chọn kho/ghi tăng sai | ☐ |
| UAT-13 | 2 LAB_MANAGER | Gửi đồng thời 2 lệnh duyệt khi còn 1 đơn vị | Chỉ 1 lệnh thành công; 1 lỗi 400/409; available không âm | ☐ |
| UAT-14 | 2 TECHNICIAN | Gửi đồng thời hai lệnh trả cùng 1 đơn vị | Chỉ 1 return thành công; `borrowed=0`, không tăng `onHand` 2 lần | ☐ |
| UAT-15 | STUDENT | Truy cập phiếu người khác hoặc duyệt/trả phiếu | 403/404 theo contract; không lộ dữ liệu | ☐ |
| UAT-16 | ADMIN | Kiểm tra Audit Logs sau tạo/duyệt/bàn giao/trả | Có actor, entity, timestamp, action; không lộ mật khẩu/JWT | ☐ |
| UAT-17 | ADMIN | So sánh Dashboard/Reports với stock ledger | Các KPI được đối chiếu với số dư DB, không trừ `borrowed` hai lần | ☐ |
| UAT-18 | LAB_MANAGER / TECHNICIAN | Truy cập Reports/Audit Logs nhạy cảm | 403 theo chính sách **tạm thời ADMIN-only**; cần Owner xác nhận | ☐ |

**Invariant bắt buộc sau từng bước:** `onHand >= 0`, `reserved >= 0`, `borrowed >= 0`, `quarantined >= 0`, `kitAllocated >= 0`, `available >= 0`, không đổi số dư nếu request bị reject. Với hàng hỏng, `onHand` tăng cùng `quarantined` nên `available` không tăng. Với hàng mất, `onHand` không tăng. Ghi lại số liệu trước/sau và ID StockMovement/ReturnTransaction để đối soát.

## C. Cloud Read-Only Smoke — CHỈ SAU KHI CÓ PHÊ DUYỆT TRIỂN KHAI RIÊNG

| ID | Kiểm tra | Tiêu chí PASS | Trạng thái |
|---|---|---|---|
| RO-01 | Liveness `GET /api/v1/health/liveness` | 200, process alive | ☐ |
| RO-02 | Readiness `GET /api/v1/health/readiness` | 200 nếu DB được phép kết nối; nếu lỗi thì 503 và BLOCKED | ☐ |
| RO-03 | GET public catalog `/api/v1/items` | 200 không yêu cầu login (theo mã nguồn hiện tại), phản hồi hợp lệ | ☐ |
| RO-04 | Mutation POST/PATCH/DELETE vào API | 403 với code `STAGING_READ_ONLY_BLOCKED`; dữ liệu không đổi | ☐ |
| RO-05 | Login `POST /api/v1/auth/login` | 403 `STAGING_READ_ONLY_BLOCKED`, kể cả với payload đúng | ☐ |
| RO-06 | Frontend Vercel SPA và deep link | HTML hiển thị; refresh deep link không 404; console không gọi localhost | ☐ |
| RO-07 | CORS/TLS/secret hygiene | HTTPS exact origin, không để lộ JWT/DB secrets trong bundle/logs | ☐ |
| RO-08 | DB role / Supabase Data API / RLS | Verify trực tiếp read-only privileges và Data API posture; không tuyên bố 0 DB write trước kiểm tra | ☐ |

**Giới hạn:** Cloud với login bị khóa sẽ không thể dùng tài khoản để kiểm thử trang quản trị hoặc quy trình nghiệp vụ. Không sửa guard hay bật login để qua bài test; chuyển sang môi trường UAT cô lập có ghi.

## D. Bảng ghi bằng chứng và kết quả nghiệm thu

| ID test | Người chạy | Thời điểm | Build/commit | Số dư trước | Số dư sau | Bằng chứng | PASS/FAIL/BLOCKED |
|---|---|---|---|---|---|---|---|
| (điền khi chạy) | | | | | | | |

**Điều kiện bàn giao:** Toàn bộ UAT liên quan MVP đạt trên DB test cô lập; Cloud smoke (khi được duyệt) đạt; Owner ký ma trận quyền; rủi ro bị chặn có giải pháp; review PR và chỉ sau đó mới phê duyệt merge/triển khai. CI tự động xanh không tự động hoàn tất UAT thủ công.
