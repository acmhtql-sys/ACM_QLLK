# Phase 11D → 11E — Tự kiểm định trước, sau đó người dùng trải nghiệm

**Ngày chốt hướng triển khai:** 17/10/2026  
**Lựa chọn người thực hiện:** Chủ dự án **trực tiếp tự kiểm định trước** (self-acceptance), sau đó **bàn giao nhóm người dùng thử để trải nghiệm/đánh giá** (pilot).  
**Trạng thái:** *PLANNED / NOT RUN*. **Không khẳng định đã có người dùng nghiệm thu.**

## Nguyên tắc và cổng an toàn

- Chỉ dùng mã nguồn Draft PR #7 và PostgreSQL thử nghiệm **cô lập tại localhost**, kiểm tra tên DB `acm_inventory_test` qua `SELECT current_database()`. Nếu sai hoặc chưa chắc chắn, **không** migration, seed, login thử hoặc thao tác ghi.
- **Giữ MVP**: chỉ trả linh kiện về đúng kho nguồn. Reports và Audit Logs **ADMIN-only**, không tự mở rộng quyền. Bản hồ sơ RBAC phản ánh lựa chọn này, nhưng chưa có Owner sign-off chính thức theo quy trình dự án.
- Không dùng Supabase, dữ liệu production, thông tin cá nhân thật hoặc bí mật của người dùng. Không công khai cổng local ra Internet. Chỉ cho người dùng thử tiếp cận một môi trường **thử nghiệm cô lập và được duyệt**, với tài khoản riêng, phân quyền phù hợp. Kịch bản dùng chung dữ liệu demo phải được thiết kế tránh ảnh hưởng lẫn nhau.
- Mọi bước phải ghi phiên bản commit, trình duyệt, người thực hiện, PASS/FAIL/BLOCKED, bằng chứng che thông tin nhạy cảm. CI xanh là tiền điều kiện kỹ thuật, không tự thay thế hai vòng kiểm định.
- **Không merge** `main`, không cập nhật Supabase/Render/Vercel hoặc deploy Cloud chỉ do bước tự kiểm định/pilot được lên kế hoạch. Nếu người dùng thử cần truy cập từ xa, lập đề xuất môi trường cô lập và xin phê duyệt **riêng** trước khi làm.

## Vòng 1 — Chủ dự án tự kiểm định (Phase 11D)

**Mục tiêu:** phát hiện lỗi trước khi đưa cho người dùng thật. Chủ dự án trực tiếp trải nghiệm với cả 4 vai trò. Tham chiếu chi tiết [runbook 16 kịch bản](./MANUAL_UAT_RUNBOOK.md).

| ID | Thao tác tối thiểu trên Web | Kết quả bắt buộc |
|---|---|---|
| SELF-01 | Cài/chạy Web + API với DB test; đăng nhập lần lượt ADMIN/LAB_MANAGER/TECHNICIAN/STUDENT rồi đăng xuất | Không nhầm session, vai trò đúng; không sử dụng credential production |
| SELF-02 | STUDENT tạo phiếu mượn 4 từ kho có 10 | Trạng thái PENDING, tồn chưa giảm |
| SELF-03 | LAB_MANAGER phê duyệt | Reserved=4, Available=6, OnHand=10 |
| SELF-04 | TECHNICIAN bàn giao | OnHand=6, Borrowed=4, Reserved=0 |
| SELF-05 | TECHNICIAN trả 2 GOOD, 1 DAMAGED, 1 LOST về đúng kho nguồn | OnHand=9, Borrowed=0, Quarantined=1, Available=8 |
| SELF-06 | Kiểm tra hủy phiếu PENDING của STUDENT; hủy APPROVED của MANAGER, vượt tồn và hoàn trả khác kho | Không sai quyền, released reservation, từ chối 409 khi sai kho, không biến động tồn khi request bị từ chối |
| SELF-07 | Truy cập thẳng `/reports`, `/audit-logs`, `/users` theo vai trò; ADMIN đối soát báo cáo & Audit Log | API không tiết lộ dữ liệu, Reports/Audit ADMIN-only, dữ liệu khớp |
| SELF-08 | Kiểm tra trường hợp API lỗi, form rỗng, thông báo, modal, giao diện điện thoại, bàn phím | Không số liệu giả, không mất dữ liệu, không che nút thiết yếu, mô tả lỗi dễ hiểu |
| SELF-09 | Xác minh đóng trình duyệt/đăng xuất, dọn fixture test, ghi defect/bằng chứng và tự đánh giá | Không token/secret trong bằng chứng, test DB nguyên vẹn, tất cả case quan trọng được ghi rõ |

### Mẫu nhật ký tự kiểm định

| SELF-ID | Ngày/commit | Người chạy | Kết quả | Số dư trước/sau hoặc mô tả lỗi | Chứng cứ sạch/issue |
|---|---|---|---|---|---|
| SELF-01..09 | Chưa chạy | Chủ dự án (chưa ghi danh tính) | NOT RUN | — | — |

**Cổng chuyển vòng 1 → vòng 2:** tất cả SELF-02...07 PASS và không còn lỗi P0/P1; SELF-01/08/09 được xử lý hoặc tồn đọng có quyết định rõ ràng; kiểm tra lại CI trên phiên bản sẽ giao dùng thử. Nếu chưa đạt: **chưa mời người dùng trải nghiệm**.

## Vòng 2 — Người dùng trải nghiệm và đánh giá (Phase 11E, chỉ sau self-check)

**Mục tiêu:** đánh giá luồng sử dụng, khả năng hiểu màn hình, thông báo lỗi và tính phù hợp nghiệp vụ — **không phải test production**.

1. **Chọn nhóm nhỏ** theo vai trò cần kiểm: gợi ý 1 LAB_MANAGER, 1 TECHNICIAN, 2–4 STUDENT, 1 ADMIN (nếu khả thi); số lượng chỉ là mục tiêu tổ chức, không phải yêu cầu kỹ thuật bắt buộc. Không dùng tài khoản cá nhân thật hoặc tài nguyên production.
2. **Giao bài theo vai trò** thay vì để thử ngẫu nhiên: STUDENT tra cứu, tạo/hủy phiếu; LAB_MANAGER duyệt và từ chối vượt tồn; TECHNICIAN bàn giao/trả đúng kho; ADMIN xem Reports/Audit. Người phụ trách quan sát, không tự làm hộ.
3. **Phỏng vấn ngắn sau thử** bằng [phiếu phản hồi](./PILOT_FEEDBACK_FORM.md): mức dễ dùng, lỗi vướng, số bước không hiểu, đề xuất thay đổi, mức sẵn sàng sử dụng. Thu thập dữ liệu tối thiểu, ẩn danh nếu có thể.
4. **Đo theo việc thực hiện được**: số người hoàn tất từng tác vụ không cần trợ giúp, số lỗi P0/P1, vấn đề phân quyền/sổ kho, và điểm đánh giá 1–5. Không thổi phồng số liệu khi mẫu nhỏ.
5. **Phân loại kết quả**: lỗi P0/P1 cần sửa và chạy lại; P2/P3 ghi backlog và Owner quyết định có chấp nhận hay không.
6. **Ký nghiệm thu** chỉ khi đủ bằng chứng manual, người có thẩm quyền duyệt và reviewer kiểm tra. Có thể yêu cầu chạy vòng pilot thứ hai sau khi sửa.

### Tiêu chí quyết định sau pilot

- [ ] Các tác vụ MVP cốt lõi được hoàn thành với chứng cứ thực tế; mọi sai lệch tồn kho/quyền đều được sửa.
- [ ] Không còn P0/P1 mở; P2/P3 có người nhận và quyết định.
- [ ] Chốt RBAC và xác nhận phạm vi trả kho nguồn; ghi nhận những đề xuất ngoài MVP là backlog.
- [ ] Người dùng thử đã gửi phản hồi, không lấy im lặng làm chấp thuận.
- [ ] QA/người có thẩm quyền xem xét biên bản; có review PR độc lập; CI xanh trên đúng build.
- [ ] **Phê duyệt riêng** trước khi chuyển PR từ Draft, merge `main` hay triển khai Cloud.

## Tình trạng thực tế tại thời điểm lập kế hoạch

**SELF: NOT RUN** · **PILOT: NOT STARTED** · **Manual UAT: NOT SIGNED** · **Release: NO-GO**. Các kết quả test tự động trong GitHub Actions không bị ghi đè hay tự đổi thành chữ ký kiểm định.
