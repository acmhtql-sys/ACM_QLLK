# Phase 11D — Hướng dẫn UAT thủ công Web MVP ACM

**Ngày soạn:** 17/10/2026 · **Trạng thái:** SẴN SÀNG PHÂN CÔNG, **CHƯA CHẠY UAT THỦ CÔNG**  
**Đối tượng:** QA/người dùng nghiệp vụ, chủ sản phẩm, kỹ sư phụ trách môi trường test.

## 1. Mốc kỹ thuật tham chiếu, không phải biên bản nghiệm thu

- [Draft PR #7](https://github.com/acmhtql-sys/ACM_QLLK/pull/7), mã nguồn tham chiếu `50a8d7c`. [CI thành công](https://github.com/acmhtql-sys/ACM_QLLK/actions/runs/39017683030): **353/353** Unit + API/DB/UAT, **19/19** Chromium API mock, **4/4** Chromium full-stack với local PostgreSQL, **16/16** static staging preflight.
- Những bài tự động trên **không thay thế** xác nhận thủ công, không xác nhận Cloud Staging, hiệu năng, mobile UX hay quyết định RBAC.
- Xem [UAT_CHECKLIST.md](./UAT_CHECKLIST.md), [WEB_RBAC_MATRIX.md](./WEB_RBAC_MATRIX.md) và [RBAC_APPROVAL_FORM.md](./RBAC_APPROVAL_FORM.md). Chỉ khi các vòng nghiệm thu thực tế được ký mới chuyển trạng thái Go/No-Go.
- Nếu mã nguồn đổi, QA phải ghi `commit`/CI run tương ứng và **kiểm lại trên build được chạy**, không kế thừa kết quả của phiên bản cũ.

## 2. Cổng an toàn trước khi cấp quyền ghi dữ liệu

- [ ] Người vận hành chứng thực đây là **PostgreSQL local riêng**, hostname `localhost`/`127.0.0.1`, database **chính xác** `acm_inventory_test`. Chạy truy vấn `SELECT current_database();` bằng quyền **chỉ đọc để xác minh** và ghi tên DB, không ghi DSN/secret.
- [ ] API sử dụng `NODE_ENV=test` và `apps/api/.env.test` riêng, kiểm tra `DATABASE_URL` trỏ đúng test DB. `.env.test` không commit và không gửi qua chat/issue.
- [ ] Tài khoản của 4 vai trò chỉ thuộc DB test và **không dùng lại** trên Supabase/Production; không ghi mật khẩu hoặc JWT vào ảnh chụp/log.
- [ ] Fixture có mã nhận diện riêng `UAT11D-...`, một kho nguồn, một kho đích khác và ít nhất một linh kiện thử nghiệm với tồn khả dụng 10; lưu số dư ban đầu.
- [ ] QA và kỹ sư đã xác nhận cách dọn fixture, sao lưu DB test phù hợp và danh sách ID chỉ thuộc đợt UAT này. **Không chạy reset DB** hoặc seed trên môi trường chung.
- [ ] Cổng Cloud vẫn khóa: không chạy lệnh ghi vào Supabase, không mở `STAGING_READ_ONLY=false`, không gọi login/migration/deploy trên Cloud, không thay đổi `main`.

### Chuẩn bị local chỉ sau khi đã xác minh DB

Kỹ sư vận hành dùng checkout PR #7 tại commit cần nghiệm thu, Node.js 22 và PostgreSQL 16 local. Cấu hình `apps/api/.env.test` từ một nguồn bí mật dành riêng cho test, không chép thông tin kết nối Cloud. Không tự động tạo file môi trường.

```bash
npm ci
npm run prisma:generate
npm run build:shared
# Chỉ người vận hành đã xác minh mục tiêu local test DB được chạy:
npm run prisma:migrate:test
npm run prisma:seed:test
```

Trong terminal API, đặt `NODE_ENV=test` trước `npm run dev:api`; terminal Web khác chạy `npm run dev:web`. Mở `http://localhost:5173`. Kiểm tra đúng port/origin và lỗi console. **Nếu có nghi ngờ cấu hình DB, dừng trước bước migrate/seed và thao tác ghi.** Muốn khảo sát giao diện mà không có DB test, có thể đọc [bằng chứng Chromium tự động](https://github.com/acmhtql-sys/ACM_QLLK/actions/runs/39017683030) nhưng không được đánh dấu kịch bản nghiệp vụ manual là PASS.

## 3. Kịch bản thao tác Web theo vai trò (QA ghi PASS/FAIL/BLOCKED)

| ID | Vai trò | Điều hướng/thao tác người kiểm thử phải làm | Kỳ vọng/chứng cứ |
|---|---|---|---|
| WEB-01 | Cả bốn | Đăng nhập từng tài khoản test, đăng xuất, đổi người dùng, thử sai mật khẩu **trong ngưỡng an toàn** | Đúng vai trò, không thấy dữ liệu người trước, sai mật khẩu có lỗi phù hợp; bản build không điền sẵn mật khẩu |
| WEB-02 | STUDENT | Mở Sidebar; truy cập trực tiếp `/users`, `/reports`, `/audit-logs`, `/inventory`, `/transactions` | Không có menu bị cấm; nhập URL trực tiếp báo không có quyền; API không tiết lộ dữ liệu |
| WEB-03 | LAB_MANAGER | Vào `/borrow-return`; thử `/reports`, `/audit-logs`, `/users` | Có quyền duyệt/nhận hàng; Reports/Audit/Users management UI bị chặn theo chính sách **chưa được owner phê duyệt** |
| WEB-04 | TECHNICIAN | Vào danh sách phiếu; tìm các nút `Duyệt`, `Bàn giao kho`, `Nhận hoàn trả` | Không có `Duyệt`; có bàn giao và nhận hoàn trả ở trạng thái hợp lệ; không được hủy phiếu APPROVED |
| WEB-05 | ADMIN | Vào Reports, Audit Logs, Users management; xem chi tiết và lọc | Truy cập được; thông tin đúng, không hiển thị token/password hash |
| WEB-06 | STUDENT | Tạo phiếu mượn của mình với fixture; kiểm tra dropdown linh kiện `/items` | Danh mục hiển thị, có thể chọn linh kiện; phiếu `PENDING`; tồn chưa thay đổi |
| WEB-07 | STUDENT | Tạo **phiếu PENDING riêng** rồi bấm `Hủy phiếu của tôi`; thử truy cập phiếu của STUDENT khác | Phiếu riêng trở thành `CANCELLED`; không thể hủy/xem phiếu của người khác; không ảnh hưởng tồn |
| WEB-08 | LAB_MANAGER | Phê duyệt yêu cầu 4 trên fixture `onHand=10` | `APPROVED`, `reserved=4`, `available=6`, `onHand=10` |
| WEB-09 | TECHNICIAN | Bàn giao 4 cho người mượn | `HANDED_OVER`, `onHand=6`, `reserved=0`, `borrowed=4`, `available=6` |
| WEB-10 | TECHNICIAN | Trả tuần tự **2 GOOD**, **1 DAMAGED**, **1 LOST**, về đúng kho nguồn | Cuối cùng `onHand=9`, `borrowed=0`, `quarantined=1`, `available=8`, phiếu `RETURNED`; xác minh từng bước |
| WEB-11 | LAB_MANAGER | Duyệt một yêu cầu khác vượt `available`; hủy một phiếu `APPROVED` khác chưa bàn giao | Vượt tồn bị từ chối và số dư không đổi; hủy giải phóng `reserved` |
| WEB-12 | ADMIN | Đối chiếu Reports/Inventory, Dashboard và Audit Logs với ledger fixture | Không trừ `borrowed` hai lần; log có actor/action/timestamp và đúng giao dịch; không có dữ liệu demo giả làm dữ liệu thật |
| WEB-13 | ADMIN/STUDENT | Ngắt kết nối API test tạm thời theo hướng dẫn kỹ sư rồi phục hồi, kiểm tra trạng thái rỗng/lỗi | Có thông báo phù hợp, không tự tạo KPI/nhật ký giả, không gửi lại giao dịch nguy hiểm ngoài ý muốn |
| WEB-14 | Cả bốn | Kiểm tra ở desktop và mobile (gợi ý 390×844), bàn phím Tab/Enter, focus, sidebar, modal xác nhận | Không bị tràn che nút thiết yếu; thông báo đọc được; modal không khiến người dùng nhầm thao tác |
| WEB-15 | TECHNICIAN | Thử hoàn trả sai kho nguồn hoặc nguồn không xác định qua **API test có kiểm soát**, nếu UI không hỗ trợ thao tác đó | HTTP 409 và số dư hai kho không đổi. **Không đánh dấu UI PASS** khi thao tác chỉ được kiểm qua API |
| WEB-16 | QA + kỹ sư | Thử đồng thời duyệt một đơn vị và trả một đơn vị theo `UAT-13/14` bằng harness kỹ thuật riêng | Chỉ một giao dịch ghi thành công, sổ kho không âm/nhân đôi; nếu chưa chạy hãy ghi **BLOCKED** thay vì suy luận từ CI |

**Phân loại:** WEB-01 đến WEB-14 là luồng người dùng/giao diện. WEB-15/16 phụ thuộc backend và phối hợp kỹ thuật; phần hỗ trợ UI không có phải ghi rõ `API-ONLY` hoặc `BLOCKED`, không tính là UAT giao diện đã qua.

## 4. Bản ghi số dư chuẩn để đối soát

Với fixture riêng ban đầu **10 tồn, chưa dự trữ, chưa mượn, chưa cách ly, chưa gán kit**:

| Mốc | OnHand | Reserved | Borrowed | Quarantined | KitAllocated | Available |
|---|---:|---:|---:|---:|---:|---:|
| Nhập 10 | 10 | 0 | 0 | 0 | 0 | 10 |
| Duyệt mượn 4 | 10 | 4 | 0 | 0 | 0 | 6 |
| Bàn giao 4 | 6 | 0 | 4 | 0 | 0 | 6 |
| Trả 2 GOOD | 8 | 0 | 2 | 0 | 0 | 8 |
| Trả 1 DAMAGED | 9 | 0 | 1 | 1 | 0 | 8 |
| Báo LOST 1 | 9 | 0 | 0 | 1 | 0 | 8 |

Công thức bắt buộc: `available = onHand - reserved - quarantined - kitAllocated`; **không trừ `borrowed` lần hai**. Bất cứ giao dịch bị từ chối phải giữ nguyên toàn bộ số dư.

## 5. Cách ghi bằng chứng và quản lý lỗi

Đối với **mỗi** WEB-ID, ghi vào [UAT_SIGNOFF_RECORD.md](./UAT_SIGNOFF_RECORD.md): người chạy; thời gian; commit / CI; role; hệ điều hành & trình duyệt; fixture/phiếu; số dư trước/sau (nếu có); PASS/FAIL/BLOCKED; issue lỗi; link ảnh/trace. **Không đưa** token, mật khẩu, email thật, thông tin cá nhân hay URL có credentials vào Git.

- **P0:** rủi ro mất/sai dữ liệu, lộ thông tin, ghi nhầm Cloud ⇒ dừng ngay, NO-GO.
- **P1:** sai quyền, sai ledger hoặc luồng mượn/trả cốt lõi ⇒ NO-GO cho đến khi sửa và test lại.
- **P2:** lỗi thao tác/UX có cách khắc phục tạm thời ⇒ Owner phải chấp nhận bằng văn bản mới được cân nhắc.
- **P3:** lỗi hiển thị nhỏ ⇒ đưa backlog và ghi rõ quyết định.

## 6. Quyết định Go / No-Go

**NO-GO mặc định** cho đến khi: 100% kịch bản MVP bắt buộc đã có bằng chứng QA manual `PASS` hoặc ngoại lệ được QA + Owner ký; không còn P0/P1; số dư/khóa kho nguồn khớp; RBAC có phiếu quyết định được ký; CI trên head PR mới nhất xanh; đã có người review độc lập. Nếu còn `BLOCKED` ở luồng bắt buộc, phải ghi **NO-GO**.

Không tự merge `main`, không áp migration Supabase, không thay đổi Render/Vercel, không triển khai Cloud chỉ vì hoàn thành tài liệu/CI.
