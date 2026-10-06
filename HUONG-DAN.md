# Website Thực Dưỡng Lành – Hướng dẫn kỹ thuật & vận hành

Cập nhật: 27/09/2026 · Web: https://thucduonglanh.vn · Quản trị: https://thucduonglanh.vn/admin/ · Kho mã: https://github.com/thaisoniph/thucduonglanh.vn

> Tài liệu dành cho chủ web / người phụ trách kỹ thuật. Hướng dẫn cho nhân sự (CRM + sửa website) nằm tại **https://crm.thucduonglanh.vn/huong-dan/**, nguồn ở thư mục `guide/`. Google Doc cũ không dùng nữa.

---

## 1. Tổng quan hệ thống

```
Nhân sự sửa ở /admin ─► lưu vào GitHub (content/, data/) ─► GitHub Actions chạy build.py ─► Cloudflare Pages ─► thucduonglanh.vn (~1 phút)

Khách đặt hàng ─► Google Apps Script ─► Google Sheet "Đơn hàng website Thực Dưỡng Lành"
                                        ├─ cập nhật trang "Khách hàng" (CRM)
                                        ├─ email vitagreennutrition@gmail.com
                                        └─ nhóm Telegram "Đơn hàng Thực Dưỡng Lành"
8h sáng mỗi ngày ─► Apps Script gửi danh sách "CSKH hôm nay" vào nhóm Telegram
```

| Thành phần | Nơi quản lý | Chi phí |
|---|---|---|
| Tên miền thucduonglanh.vn | Tenten (đăng ký, gia hạn – hết hạn 22/04/2027) | theo Tenten |
| DNS + link chuyển hướng | Cloudflare (dash.cloudflare.com) | miễn phí |
| Hosting | Cloudflare Pages – dự án `thucduonglanh` (dự phòng: thucduonglanh.pages.dev) | miễn phí |
| Mã nguồn + lịch sử sửa | GitHub `thaisoniph/thucduonglanh.vn` | miễn phí |
| Trang quản trị | Sveltia CMS tại /admin | miễn phí |
| Đơn hàng + CRM | Google Sheet + Apps Script | miễn phí |
| Báo đơn | Email + Telegram bot `@thucduonglanh_donhang_bot` | miễn phí |
| Đo lường | Google Analytics 4 `G-X40P3S7FZ8`, Microsoft Clarity `yoto1kqbmx` | miễn phí |

---

## 2. Cấu trúc mã nguồn

```
website/
├── admin/                 trang quản trị (index.html, config.yml) + utm.html (tạo link theo dõi)
├── content/
│   ├── products/*.json    mỗi sản phẩm 1 file (tên file = đường link /san-pham/<tên>/)
│   ├── posts/*.md         bài viết Góc Sống Lành
│   └── pages/*.md         trang chính sách
├── data/
│   (content/combos/*.json = gói giải pháp: items[product, variant, qty, icon, benefit, title, note, detail, quote]; có headline → thẻ trang chủ combo_card_v2; có hero → trang gói combo_hero_*/combo_landing (pains, solution, journey #cach-trai-nghiem, receive, final; roadmap_link rỗng = ẩn quyền lợi lộ trình), price, free_ship, days; build.py nạp như sản phẩm category "goi-giai-phap", tự tính parts_base/parts_web; JS hasFS() miễn ship; đơn gửi items[].days → Apps Script comboCycles() tự thêm tab Chu kỳ dùng)
│   ├── site.json          liên hệ, hotline/Zalo, mạng xã hội, ngân hàng, phí ship, kênh cộng đồng, video thương hiệu (brand_video), ebook (url `/ebook/` = trang nhận ebook trên web, flipbook = link Heyzine mở sau khi khách điền form; khung mời gắn `?tu=home|post|menu|float`, không dùng UTM để không ghi đè nguồn khách; form gửi `type: 'contact', kind: 'ebook'` → Apps Script ≥ 2026-10-04c tạo khách hỏi kênh "Ebook – quà tặng (Website)", Telegram 🎁 ĐĂNG KÝ EBOOK, không gửi email; bản cũ hơn vẫn nhận như form Liên hệ), nhóm Zalo (zalo_group), ưu đãi web (web_offer: mức chung; ghi đè theo sản phẩm/quy cách bằng web_discount trong content/products, 0 = không giảm; build.py apply_web_offer() giảm giá lúc build, giá gốc giữ cho CRM; placeholder {uu_dai_web} trong trang nội dung); icon sàn TMĐT (shopee/lazada/tiktok_shop) không hiện, chỉ còn trong sameAs
│   ├── home.json          slider trang chủ
│   ├── categories.json    danh mục sản phẩm
│   ├── post-categories.json
│   ├── brochure.json      trang Hồ sơ thương hiệu
│   ├── vn-units.json      34 tỉnh/thành + 3.321 phường/xã (sau 1/7/2025) – dùng nhận diện địa chỉ
│   └── config.json        kỹ thuật: tên miền, link nhận đơn, mã GA4/Clarity/Pixel (không có trong /admin)
├── assets/                CSS, JS, ảnh, video, PDF; ảnh tải từ /admin nằm ở assets/uploads/
├── crm/                   CRM cho nhân sự (index.html, app.js, app.css) → build ra dist-crm/ → crm.thucduonglanh.vn
├── guide/                 Hướng dẫn nhân sự: index.md (Bắt đầu), crm.md, website.md, guide.css, img/ → dist-crm/huong-dan/
├── build.py               sinh web vào dist/ (tự nén ảnh sang WebP) + CRM vào dist-crm/
├── .github/workflows/deploy.yml   tự build + đăng lên Cloudflare mỗi khi có thay đổi
└── backend/               CHỈ Ở MÁY (không đưa lên GitHub – có mã Telegram)
    ├── google-apps-script.gs            code nhận đơn + CRM
    └── cloudflare-redirect-rules.json   bản sao 10 quy tắc chuyển hướng
```

---

## 3. Tính năng chính của website

**Bán hàng**
- Trang chủ theo bố cục thuanchay.vn; danh mục; trang sản phẩm nhiều quy cách/giá; giỏ hàng; tìm kiếm (gõ không dấu được); yêu thích.
- **"Mua ngay"** mở khung Đặt hàng nhanh ngay trên trang sản phẩm (không qua giỏ).
- **Form đặt hàng**: Họ tên, SĐT (chấp nhận dấu cách, +84), địa chỉ 1 ô – **tự nhận diện Tỉnh/Phường** (hiểu viết tắt, không dấu, tên tỉnh cũ → tỉnh mới), Nhà riêng/Văn phòng, bảng chọn khu vực kiểu Shopee, **Dán và nhập nhanh**, ghi chú nhanh (Giao giờ hành chính / Gọi trước khi giao / Địa chỉ cũ), lưu thông tin cho lần sau (thẻ "Giao đến"), ô đồng ý nhận tư vấn.
- **Phí vận chuyển**: đơn < 300.000đ cộng 30.000đ; từ 300.000đ miễn phí (sửa trong /admin → Cài đặt → Thông tin liên hệ…). Thanh tiến độ "Mua thêm … để được miễn phí vận chuyển".
- **Gợi ý mua kèm**: tối đa 3 món, ưu tiên món giúp đơn đạt 300.000đ và cặp khai báo ở ô "Gợi ý mua kèm" của từng sản phẩm.
- **Thanh toán**: Chuyển khoản (chọn sẵn, hiện mã VietQR Vietcombank đúng số tiền + mã đơn) hoặc COD.

**Trang nhận ebook** `/ebook/` (thay LadiPage ebook.thucduonglanh.vn): họ tên + SĐT → mở ebook Heyzine + mời nhóm Zalo; nhớ trên máy khách (`tdl_ebook`) nên lần sau mở thẳng ebook.

**Nội dung**: Góc Sống Lành, Giới thiệu, **Hồ sơ thương hiệu** (/ho-so-thuong-hieu/ – sách lật Heyzine + PDF), trang chính sách, Liên hệ (form gửi về Sheet/Telegram).

**Liên hệ nhanh**: nút Gọi / Zalo nổi (điện thoại: 2 nút), hotline **0966 326 522**, Zalo OA ở chân trang.

---

## 4. Đơn hàng & CRM (Google Sheet)

Sheet **Đơn hàng website Thực Dưỡng Lành**: https://docs.google.com/spreadsheets/d/1RlDE9iFVtRaOwOfg2p_X_vpV9Q5MTrKquBEcv6gMIIM/edit

| Trang tính | Nội dung |
|---|---|
| Đơn hàng | Mỗi đơn 1 dòng: khách, SĐT, địa chỉ ([Nhà riêng]/[Văn phòng]), sản phẩm, tạm tính, phí ship, tổng, thanh toán, ghi chú, **Trạng thái**, **Nguồn**, **Đồng ý nhận tin**. Nhân viên cập nhật Trạng thái: Mới → Đã xác nhận → Đã giao / Huỷ. |
| Khách hàng | Tự gộp theo SĐT: số đơn, tổng chi, đơn đầu/gần nhất, sản phẩm đã mua, **Dự kiến hết hàng**, **Nhóm** (Mới / Quay lại / VIP ≥3 đơn hoặc ≥2 triệu / Sắp mất >60 ngày). Nhân viên điền: Phụ trách, Lần CSKH gần nhất, Kết quả CSKH, Ghi chú CSKH. |
| Chu kỳ dùng | Số ngày dùng hết 1 đơn vị sản phẩm → tính "Dự kiến hết hàng". Chỉnh theo thực tế. |
| Mẫu tin nhắn CSKH | Mẫu Zalo cho từng thời điểm chăm sóc. |
| Liên hệ | Lời nhắn từ form Liên hệ. |
| Nhân sự CRM | Email · Tên · Quyền (Quản trị / Quản lý / Nhân viên) · Đang dùng (Có/Không). Sửa được trên web ở mục Cài đặt (chỉ Quản trị). thaisoniph@gmail.com luôn là Quản trị. |
| Nhật ký CSKH | Mỗi thao tác trên CRM web: ai làm, lúc nào, việc gì, kết quả, ghi chú. Là nguồn số liệu của tab Báo cáo. |
| Khách tiềm năng | Người hỏi mua nhưng chưa mua: Mã · Kênh · Quan tâm · Trạng thái (Mới hỏi → Đang tư vấn → Đã chốt / Không mua) · Phụ trách · Lần liên hệ · Hẹn liên hệ lại · Lý do không mua · Mã đơn. Form Liên hệ trên web tự thêm vào đây (vẫn ghi cả trang Liên hệ). Cùng 1 số đang mở thì ghi nối, không tạo trùng. Lần đầu tạo trang, các lời nhắn cũ ở Liên hệ được chuyển sang. |

**Việc chăm sóc mỗi ngày** (hàm `careTask`, dùng chung cho tin Telegram 8h và tab Hôm nay trên CRM web): hẹn gọi lại (cột "Hẹn gọi lại" đến ngày) · hỏi nhận hàng (D+1 đến D+3) · sắp hết / đã hết sản phẩm (–7 đến +2 ngày) · xin cảm nhận (D+14 đến D+17) · giới thiệu sản phẩm (D+30 đến D+33) · mời quay lại (D+60 đến D+67). Khách đã được chăm sóc sau mốc đó thì không nhắc nữa. **Khách quen sản phẩm** (bản 2026-10-05a): `shipMap` gắn `fam` cho đơn gần nhất khi `famOf` thấy mọi sản phẩm (khoá `prodKeys`: bỏ 🎁, số lượng, quy cách) khách đã nhận ≥ `rules_cfg.famMin` lần trước (mặc định 1, 0 = tắt), lần gần nhất ≤ 180 ngày (`FAM_GAP`), đơn liền trước không hoàn → `careTask` bỏ mốc d1/d7/d14 (`FAM_SKIP`); vẫn nhắc runout/d30/winback/callback. `custObj` gửi `fam` → nhãn 🌟 Khách quen SP trong hồ sơ + hộp chăm sóc; ô chỉnh ở Cài đặt → Nhóm khách. Chưa port sang api/ (Cloudflare).

### CRM web – https://crm.thucduonglanh.vn

- Trang tĩnh trong `crm/`, build ra `dist-crm/`, đăng lên Cloudflare Pages project **thucduonglanh-crm** (bước riêng trong `deploy.yml`, tự tạo project + gắn tên miền + bản ghi DNS `crm` lần đầu).
- Dữ liệu vẫn nằm trong Google Sheet. Trang gọi thẳng link Apps Script (`order_endpoint`) với `type: 'crm'` (hàm `crmApi`). Không có máy chủ riêng.
- **Đăng nhập**: nhập email → Apps Script gửi mã 6 số (10 phút, sai 5 lần phải xin mã mới, tối đa 5 lần xin mã / 15 phút) → phiên 30 ngày lưu trong Script Properties (`crm_s_…`). Chỉ email có trong trang **Nhân sự CRM** và "Đang dùng = Có" mới vào được. Bỏ tích "Đang dùng" là khoá ngay.
- **Quyền**: Nhân viên = Hôm nay, Khách hàng, Đơn hàng (đổi trạng thái, tạo đơn nhập tay), Liên hệ. Quản lý = thêm doanh thu, sửa Chu kỳ dùng và Mẫu tin nhắn. Quản trị = thêm quản lý nhân sự.
- **Tạo đơn nhập tay** (Zalo, điện thoại…): ghi vào Đơn hàng với Nguồn "Nhập tay – …", cập nhật Khách hàng, báo Telegram (không gửi email).
- **Số ngày chưa chăm sóc** (nhãn màu trên mỗi thẻ khách + ô lớn trong trang chi tiết): đếm từ lần gần nhất khách *có phản hồi* (mọi kết quả trừ "Không nghe máy"), lấy từ Nhật ký CSKH + cột Lần CSKH/Kết quả CSKH. Chưa chăm sóc lần nào thì đếm từ ngày mua đầu tiên. Xanh ≤ 7 ngày, cam 8–30, đỏ > 30. Có bộ lọc "Quá 30 ngày chưa chăm sóc" và cách sắp xếp "Lâu chưa chăm sóc nhất". Tính trên trình duyệt, không cần sửa Apps Script.
- **Khách tiềm năng** (tab Tiềm năng): cần liên hệ khi Mới hỏi chưa liên hệ, đến ngày hẹn, hoặc Đang tư vấn mà 3 ngày chưa liên hệ lại. Nút Tư vấn → kết quả; "Khách chốt mua" mở form tạo đơn (`order_create` với `leadId` → lead thành Đã chốt + Mã đơn, Nguồn đơn = "Tiềm năng – <kênh>"); "Khách không mua" bắt buộc lý do. Mẫu tin "Khách mới hỏi" được thêm 1 lần vào Mẫu tin nhắn CSKH (cờ `tpl_lead_added` trong Script Properties).
- **Hiệu quả** (tab `#bao-cao`, ai cũng xem): nhân viên thấy của mình, quản lý thấy thêm "Cả nhóm" (có biểu đồ **So sánh nhân viên** theo chỉ số chọn được, vạch trung bình nhóm) và bấm từng người. Quản lý có ô **Người phụ trách** dùng chung cho 5 tab (`S.who`, lưu `localStorage crm_who`: rỗng = tất cả, `-` = chưa ai, hoặc tên); đơn lọc theo `seller`, thiếu thì lấy người phụ trách khách. Theo tháng (tháng này / trước / 2 tháng trước). Khối **Mục tiêu tháng**: thanh tiến độ + vạch "hôm nay", trạng thái (đúng tiến độ nếu % đạt ≥ % số ngày đã qua; hơi chậm ≥ 80% mức đó; còn lại là chậm), còn thiếu / mỗi ngày cần, dự báo cả tháng. Chỉ số: doanh số, giá trị TB/đơn, tỷ lệ chốt (chốt / (chốt + không mua) của khách tiềm năng mình phụ trách), % doanh thu từ khách cũ, lượt chăm sóc & % khách trả lời, khách đặt lại, khách quá 30 ngày. Mỗi chỉ số so với tháng trước.
- **Đồng bộ file sale** (Cài đặt, chỉ Quản trị; trang Sheet "Nguồn dữ liệu sale"): mỗi file gồm sale + link + cấu hình từng sheet (vai trò `orders` / `care` / `reject` / `skip`, dòng tiêu đề, cột → trường). `src_inspect` đọc file (`SpreadsheetApp.openById`, tài khoản chạy Apps Script cần quyền xem file) và đoán cột (`detectMap`). `src_sync` từng sheet, `dry` để xem trước. Đơn: khoá theo mã đơn, không có mã thì `NK` + hash(ngày, SĐT, tiền, sản phẩm); ghi thẳng vào trang Đơn hàng (Nguồn "File <sale> – <sheet>", NV bán = sale) rồi `rebuildCustomers({owners})`. Chăm sóc: ghép nhật ký vào "Ghi chú CSKH" (dưới dòng "— Nhật ký cũ (sheet) —"), người chưa mua → tiềm năng (≤30 ngày: Đang tư vấn, cũ hơn: Không mua – dữ liệu cũ); nhớ số dòng đã xử lý (`cfg.done`). Từ chối: cột "Nhãn" của khách (Bom hàng / Từ chối).
- **File số quảng cáo** (Script Property `ads_cfg`): mỗi sheet sản phẩm một cấu hình cột. Chế độ `staff` (nhân sự chia, CRM đọc cột Sale theo "Tên trong file QC" ở Nhân sự) hoặc `crm` (CRM chia lượt theo từng sheet, số trùng → sale cũ, ghi tên vào cột Sale/Trùng sale). Chỉ lấy số từ ngày `since`. Tự đồng bộ: trigger `adsTick` 10 phút. Khoá tiềm năng `QC` + hash(sheet, SĐT, ngày).
- **Đơn hàng**: thêm cột Ca (Ngày / Tối/CN / Lễ; cài giờ ca tối + ngày lễ trong `ca_cfg`), Dòng SP (Fucoidan Pro / Curcumin / BADD / Khác, cho BCDT), Lên đơn. Trạng thái thêm Hoàn, Đổi hàng (`isVoid`: Huỷ/Hoàn không tính doanh thu). Quà tặng lưu dòng `🎁 … = 0 ₫`. "Số tiền thu khách" (`total`) chia lại tiền cho các dòng (`applyTotal`). Mã đơn sale: `<Tiền tố><ddMMyy>-NN` (`nextCode`, tiền tố ở Nhân sự).
- `rebuildCustomers` chạy hoàn toàn trong bộ nhớ (chịu được hàng chục nghìn đơn). `crmLoad` chỉ gửi đơn 13 tháng + đơn đang xử lý; đơn cũ xem qua `cust_orders`.
- **Phân quyền dữ liệu**: `crmLoad` chỉ gửi cho Nhân viên khách có Phụ trách = mình (chế độ Kho chung: cộng khách chưa ai phụ trách), đơn của các khách đó hoặc đơn mình bán, tiềm năng của mình, nhật ký liên quan. Mọi thao tác ghi đều qua `guardPhone` / `guardLead` / `orderGuard` (Kho chung: thao tác trên khách chưa ai phụ trách = nhận luôn). `check_phone` cho biết số đang do ai phụ trách (không lộ thông tin khách). Nhân viên không đổi được người phụ trách.
- **Chia khách mới** (Script Property `assign_mode`: `auto` / `manager` / `pool`, mặc định `pool`): đơn web của khách chưa ai phụ trách và form liên hệ → `autoOwner` chia lần lượt (`rr_last`) cho người có "Nhận khách mới = Có" ở trang Nhân sự CRM. Quản lý: `assign`, `bulk` (chia đều / chuyển A→B), `recv`.
- **Telegram riêng**: cột "Telegram" ở Nhân sự CRM (mã chat). Kết nối: `tg_link` tạo link `t.me/thucduonglanh_donhang_bot?start=<mã>`, `tg_check` đọc `getUpdates` tìm `/start <mã>` (bot không được đặt webhook). Đơn web → nhóm + người phụ trách; form liên hệ → nhóm + người được giao; 8h sáng → nhóm (toàn bộ, có tên người phụ trách) + từng người (việc của mình). Nhóm chung nên chỉ để quản lý.
- **Màu & nhóm khách**: `rules_cfg` (Script Property `{vipOrders, vipSpent, atRisk}`, mặc định 3 / 2.000.000 / 60; `groupOf` + `careTask` mời quay lại dùng chung; quản lý sửa qua action `settings` với `rules`). Màu riêng mỗi người ở `prefs_<email>` (`colors` new/old/void/off, `tags` [{name,color}], action `prefs`). Cột "Nhãn màu" ở Khách hàng (action `customer` với `tag`). `crmLoad` gửi thêm `lastStatus`, `lastCa` để tô màu: nhãn riêng > hoàn/bom (xám) > ngoài giờ (tím) > khách cũ (vàng) > khách mới (trắng).
- **Mục tiêu**: trang Sheet "Mục tiêu" (Tháng yyyy-MM · Nhân viên · Mục tiêu doanh số · Người đặt · Cập nhật lúc). Nhân viên tự đặt cho mình, Quản lý sửa được cho mọi người (action `target`, có ghi Nhật ký).
- **Nhân viên bán** (cột "NV bán" cuối trang Đơn hàng) là căn cứ tính doanh số: đơn nhập tay / chốt từ tiềm năng = người nhập; đơn web = người đang phụ trách khách lúc đặt (trống nếu chưa có). Quản lý đổi được trong chi tiết đơn. Lần đầu tải, đơn cũ được điền tự động (`backfillSellers`, cờ `seller_backfilled`).
- **Đơn hàng**: 3 cột mới ở trang Đơn hàng: Đã nhận tiền ("Có – người – thời gian"), Đơn vị vận chuyển, Mã vận đơn. Nhập mã vận đơn → đơn Mới/Đã xác nhận tự thành Đang giao. Link tra cứu theo hãng nằm ở `CARRIERS` trong `crm/app.js`. Sửa đơn (`order_edit`) ghi lại khách/sản phẩm/ship/thanh toán rồi chạy `rebuildCustomers`.
- Chạy thử trên máy với dữ liệu giả: `backend/crm-test/sync.sh` rồi `backend/crm-test/shot.sh <kịch bản> <ảnh.png>` (kịch bản trong `flow.js`, ảnh ở `crm-test/out/`). Bộ giả lập Apps Script: `mock.js`.
- Đổi trạng thái sang/khỏi **Huỷ** trên web sẽ tự chạy `rebuildCustomers`. Lưu Chu kỳ dùng cũng vậy.
- Chạy thử trên máy: `python3 build.py` rồi serve `dist-crm/` (gọi Apps Script thật), hoặc dùng `backend/crm-test/` (dữ liệu giả).

**Hàm trong Apps Script** (chọn hàm → ▶ Chạy):

| Hàm | Khi nào dùng |
|---|---|
| `setupCRM` | Lần đầu cài CRM, hoặc cài lại lịch 8h |
| `dailyCare` | Xem thử tin CSKH ngay |
| `rebuildCustomers` | Sau khi sửa/huỷ đơn cũ – tính lại trang Khách hàng (giữ cột CSKH) |
| `tidySheet` | Tạo trang "📖 Hướng dẫn" (chỉ sang CRM), xoá trang "✅ Việc hôm nay" cũ nếu còn, tô màu (xanh = máy điền, cam = nhân viên điền), ô chọn Trạng thái / Kết quả CSKH, định dạng tiền-ngày, khoá mềm cột tự động, thu gọn cột ít dùng. Chạy lại bất cứ lúc nào, không mất dữ liệu. Có trong menu 🌿 Thực Dưỡng Lành trên Sheet |
| `testTelegram` | Kiểm tra bot Telegram |

**Sửa code Apps Script**: (phần CRM web nằm trong `doPost` → mọi thay đổi `crm…` đều phải Deploy phiên bản mới) dán đè toàn bộ `backend/google-apps-script.gs` → Lưu. Nếu sửa phần nhận đơn (`doPost`) thì thêm: Triển khai → Quản lý các bản triển khai → ✏️ → **Phiên bản mới** → Triển khai (link nhận đơn giữ nguyên). Lịch 8h luôn dùng bản đã lưu mới nhất.

**Người nhận báo đơn**: thêm/xoá thành viên trong nhóm Telegram "Đơn hàng Thực Dưỡng Lành" – không cần sửa code.

---

- **Tốc độ tải CRM** (Apps Script 2026-10-02c):
  - CRM tải 2 đợt: `load` `part=core` (khách, việc, đơn 100 ngày + đơn đang xử lý, nhật ký 60 ngày), rồi `part=rest` tải ngầm phần cũ. Dữ liệu lưu trên máy (IndexedDB), lần sau mở hiện ngay.
  - Bản nhớ tạm trên máy chủ (CacheService, 10 phút, tối đa ~3 MB). Từ bản 2026-10-05d, `cachePatch()` sửa đúng các dòng liên quan trong bản nhớ cho: chăm sóc (kể cả "đã nhận hàng"), sửa khách (trừ đổi người phụ trách), tư vấn / thêm khách hỏi, **tạo đơn, đổi trạng thái / ghi chú / vận đơn / đã nhận tiền của đơn, nhận khách**. Nó đọc lại dòng đơn, các đơn cùng SĐT, dòng khách, tab Khách tiềm năng và dòng nhật ký mới. Nếu dòng đơn bị xê dịch (mã không khớp) hoặc có hơn 20 dòng đơn mới lạ thì bỏ bản nhớ. Huỷ / hoàn đơn, sửa đơn, chia khách, nhập file vẫn gọi `rebuildCustomers` / `dataChanged()`, làm bản nhớ đổi khoá nên tự bỏ. Trước đây Sale (lên đơn, đổi trạng thái nhiều) làm bản nhớ bị bỏ liên tục, nên lần tải sau phải đọc cả Sheet. Kịch bản thử `backend/crm-test` `?patch` so bản nhớ đã sửa với `readBase` sau mỗi thao tác.
  - `readBase` chỉ đọc 6000 dòng cuối của tab Nhật ký CSKH (không đọc cả tab).
  - Đo tốc độ: CRM ghi thời gian mỗi lần tải / lưu (tổng, máy chủ `sms`, dữ liệu lấy từ bản đọc sẵn hay đọc Sheet, KB, thiết bị / mạng). Cứ 2 phút (hoặc khi ẩn tab) CRM gửi gộp bằng lệnh `perf` vào tab **"Đo tốc độ CRM"**, giữ khoảng 6000 dòng. Tổng trừ Máy chủ ra thời gian đi đường (mạng).
  - Lịch `docSanCRM` mỗi 5 phút (6h–22h) đọc sẵn Sheet khi bản nhớ hết. Lịch này tự cài khi Quản trị mở CRM; có thể chạy tay `caiDocSan`.
  - Đơn hàng có cột **Ngày gửi** (Apps Script 2026-10-02d): tự ghi khi đơn chuyển Đang giao / nhập mã vận đơn; "Giao lâu chưa tới" tính từ ngày gửi, chưa có thì từ ngày đặt.
  - **Viettel Post tự cập nhật (Apps Script 2026-10-06a)**: Viettel Post gửi tin mỗi lần đơn đổi trạng thái (webhook, cài ở partner.viettelpost.vn → Cài đặt tài khoản → Cấu hình webhook, URL `https://crm.thucduonglanh.vn/vtp-webhook`, Secret tự đặt, chờ Viettel Post duyệt). Cổng `crm/functions/vtp-webhook.js` (Pages Function của project CRM; workflow deploy CRM chạy trong thư mục `crm/` để Cloudflare thấy `functions/`) trả 200 ngay và chuyển tin sang Apps Script `{type:'vtp', payload}` vì Apps Script luôn trả 302. `vtpWebhook()` kiểm tra `TOKEN` = Script Property `VTP_SECRET`, tìm đơn theo Mã vận đơn (hoặc ORDER_REFERENCE = Mã đơn), ghi 3 cột `Hành trình VC` / `Cập nhật VC` / `Mã TT VC`, bỏ tin cũ hơn tin đã có. 501 → Đã giao, 504 → Hoàn, mã ≥ 200 khi đơn còn Mới/Đã xác nhận → Đang giao (đều qua `crmOrderStatus` với người làm "Viettel Post (tự động)"). Mã 502/503/505/506/507/515 → báo Telegram nhóm + NV bán; CRM (`VTP_WARN`) đưa đơn vào nhóm "📵 Giao chưa được". Thử tay: hàm `testVTP` (sửa mã vận đơn thật trước khi chạy). Trang tra cứu công khai của Viettel Post / BEST đều có captcha nên không đọc tự động được; BEST cần API key do BEST cấp.
  - Tự nhập file sale (srcAutoTick, Apps Script 2026-10-04b): 30 phút/lần trong 7h–21h; mỗi lần ghi 1 dòng vào tab "Tự nhập file sale" (giây chạy, đơn mới, cập nhật, ghi chú, lỗi); không có gì mới thì không tính lại khách / không ghi nhật ký; Telegram cho quản trị lần đầu trong ngày + khi lỗi. Lịch cũ 7h tự đổi (docSanCRM → wbTrigger).
  - Mỗi lần tự nhập: ngoài dòng mới, `syncOldNotes()` so ghi chú trên DÒNG CŨ của sheet chăm sóc sale (60 ngày gần đây, theo ngày + nội dung), bỏ dòng do CRM ghi ngược (tab "Ghi ngược file sale"), thêm lên đầu "Ghi chú CSKH".
  - Tab "✅ Việc hôm nay" (trang việc cũ trên Sheet) tự ẩn 1 lần (docSanCRM); CRM đã thay. Từ 05/10/2026 hàm `suaHuongDanSheet` (chạy tay 1 lần) xoá hẳn tab này, viết lại "📖 Hướng dẫn" chỉ sang CRM và đổi tên mẫu tin "… sau khi đặt" → "… sau khi nhận hàng".
  - Ghi ngược file sale (Apps Script 2026-10-04a): ngoài ghi chú chăm sóc, còn `@order` (đơn tạo trên CRM → thêm dòng vào sheet đơn hàng sale đang dùng: `cfg.orderSheet` nếu đặt, không thì sheet có ngày đơn mới nhất – Phương: VTG_lendon), `@ost` (đổi trạng thái → cột Trạng thái của đúng sheet đơn được nhập từ, tìm theo mã đơn rồi SĐT+ngày+tiền), tư vấn khách hỏi → sheet chăm sóc. Lúc nhập file: `wbKeys` bỏ dòng CRM đã ghi, `crmOrderDays` bỏ đơn CRM/web đã ghi ngược, không tạo khách hỏi trùng SĐT.
  - Quản trị thấy thời gian tải ở dòng cuối trang ("tải …s, máy chủ …s, bản đọc sẵn/đọc Sheet, … KB").

## 5. Đo lường & remarketing

- Mã trong `data/config.json`: `ga4_id` = **G-X40P3S7FZ8**, `clarity_id` = **yoto1kqbmx**, `meta_pixel` = **1342001937266392** (lấy từ trang Ladi ebook cũ, bật 2026-10-04), `tiktok_pixel` (để trống = chưa bật). Form ebook bắn `generate_lead` → Meta `Lead`.
- Công cụ chỉ chạy **sau khi khách bấm "Đồng ý"** ở thông báo cookie (Nghị định 13/2023/NĐ-CP).
- Sự kiện: `view_item`, `add_to_cart`, `begin_checkout`, `purchase` (doanh thu), `upsell_add`, `paste_fill`, `click_call`, `click_zalo`, `view_brochure`, `video_play`, `search`, `generate_lead`.
- Nguồn khách (UTM / fbclid / ttclid / gclid / trang giới thiệu) lưu 30 ngày → cột **Nguồn** của đơn.
- **Tạo link theo dõi**: https://thucduonglanh.vn/admin/utm – dùng cho mọi bài đăng/quảng cáo.
- Báo cáo: analytics.google.com (Thời gian thực, Thu nạp người dùng, Kiếm tiền) · clarity.microsoft.com (Bản ghi, Bản đồ nhiệt).
- Nên làm trong GA4: đánh dấu sự kiện chính `purchase`, `click_call`, `click_zalo`, `generate_lead`; lưu dữ liệu 14 tháng; liên kết Search Console.

---

## 6. Trang quản trị & nhân sự

- Cấp quyền: https://github.com/thaisoniph/thucduonglanh.vn/settings/access → **Add people** → quyền **Write**. Nghỉ việc → **Remove**.
- Nhân sự đăng nhập /admin bằng **mã truy cập GitHub** (quyền `public_repo`), chọn "Đăng nhập bằng mã truy cập".
- Trong /admin: Bài viết · Sản phẩm (giá, quy cách, ảnh, mô tả, **Gợi ý mua kèm**, ẩn/hiện) · Trang chính sách · Cài đặt (liên hệ, mạng xã hội, ngân hàng, **phí ship**, kênh cộng đồng, **video thương hiệu**, **mời ebook**, **nhóm Zalo**, slider, danh mục, **Hồ sơ thương hiệu**).
- Mọi lần lưu có lịch sử trên GitHub → khôi phục được.

### Trang hướng dẫn nhân sự – https://crm.thucduonglanh.vn/huong-dan/

- Nguồn: `guide/*.md` (frontmatter: title, nav = tên trên menu, order, updated, description). Mỗi file là 1 tab; mỗi tiêu đề `##` tự thành 1 mục ở "Trong trang này". `index.md` → /huong-dan/, `crm.md` → /huong-dan/crm/.
- `build_guide()` trong build.py sinh trang vào `dist-crm/huong-dan/`, deploy cùng CRM. Không cần đăng nhập (để người mới đọc được cách đăng nhập) nhưng có noindex + robots chặn; không đưa dữ liệu khách thật hay mã bí mật vào đây.
- Sửa được trong /admin → **Hướng dẫn nội bộ** (ảnh tải lên vào `guide/img/`).
- Ảnh chụp CRM dùng dữ liệu giả: `backend/crm-test/sync.sh` rồi `SCALE=2 ./shot.sh "g-care&as=sondmt.bsm@gmail.com" g-care.png 500 1900` (các kịch bản `g-…` trong flow.js), cắt và lưu WebP rộng 640px vào `guide/img/`.
- **Khi thêm/đổi tính năng CRM hay /admin, sửa luôn `guide/` trong cùng lần đẩy code.**

---

## 7. Tên miền, DNS, chuyển hướng

- Nameserver: `liberty.ns.cloudflare.com`, `randy.ns.cloudflare.com`. **Mọi thay đổi DNS làm trên Cloudflare**, không làm ở Tenten.
- `www` và `http://` tự chuyển về `https://thucduonglanh.vn`.
- Link phụ = **Redirect Rules** (Cloudflare → thucduonglanh.vn → Rules → Redirect Rules), dùng đủ 10/10 quy tắc gói miễn phí: story, ld, shop, shopee, family, **cauchuyen → /ho-so-thuong-hieu/**, sotay, mkt, quacmadiamond + quy tắc HTTPS/www. `quatang` là CNAME tới LadiPage.
- GitHub Actions dùng secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (GitHub → Settings → Secrets).

---

## 8. Sửa giao diện / chạy thử trên máy

```bash
cd website
python3 -m pip install --user -r requirements.txt               # lần đầu
python3 build.py && (cd dist && python3 -m http.server 8000)    # xem http://localhost:8000
GH_TOKEN=ghp_xxx ./deploy-github.sh "ghi chú thay đổi"           # đẩy lên (token quyền repo + workflow)
```
Script tự lấy các thay đổi nhân sự đã làm ở /admin trước khi đẩy.

---

## 9. Việc nên làm tiếp

- Khai báo website với Bộ Công Thương (online.gov.vn) → điền `bo_cong_thuong_url` trong `data/config.json`, đặt logo tại `assets/img/brand/bo-cong-thuong.png`.
- Gửi mã Meta Pixel / TikTok Pixel khi có tài khoản quảng cáo.
- Brochure PDF/Heyzine còn hotline cũ 0896 869 333 (trang 32) và câu công dụng DILVANG (trang 19) – sửa ở bản thiết kế mới.
- Bổ sung ảnh + thông tin 4 sản phẩm: Trà Mâm Xôi, Bột Đậu Xanh Rau Má, Gafo Fucoidan, Fucoidan Progomax.

## Logo & màu thương hiệu (2026-10-02)
- Theo bộ nhận diện Branu (`../03_Logo & Thương hiệu/`): xanh #24805B, xanh đậm #0C5233, kem #F3E0BD, nâu vàng #C79666, nâu đậm #906540 (biến CSS --primary, --primary-2, --cream, --gold, --brown).
- Đầu trang: logo phẳng xanh (`assets/img/brand/logo*.png|webp`, tạo từ `0905…/logo TDL_004.png`). Chân trang nền #0C5233: `logo-cream.*`. Trang Giới thiệu: logo vàng 3D `logo-gold.webp`.
- Favicon / icon điện thoại / avatar: chỉ biểu tượng búp lá + vòng vô cực (`icon-32/180/512.png`, `emblem.png`); bản 1024px cho Zalo OA, Facebook ở `../03_Logo & Thương hiệu/Avatar & icon cho web - Zalo - Facebook/`.

**Form lên đơn (05/10/2026, bản máy chủ 2026-10-05b)**: `openOrderForm` có ô dán tin Zalo (`parseMsg` tách SĐT / tên / địa chỉ), nút 🔁 đặt lại như đơn gần nhất (`ordersOf`), nút sản phẩm (sản phẩm khách hay mua + `soldNames`), quà ẩn tới khi bấm, mục ⚙️ gom ca / phí ship / nguồn (nhớ `localStorage crm_osrc`) / trạng thái / đồng ý nhận tin, nút "Lưu & copy lên đơn" (copy ngay lúc bấm). **Ca** chỉ quản lý (level ≥ 2) chọn được: `crmOrderCreate` bỏ `d.ca` của nhân viên và dùng `caOf(now)`, `crmOrderEdit` chỉ đổi Ca khi level ≥ 2.

**Loại đơn (bản máy chủ 2026-10-05c)**: tab Đơn hàng thêm cột `Loại đơn` (Khách mới / Khách cũ / Ngoài giờ / Ngày lễ) và `Kiểm tra loại đơn`. `otypeSuggest` (máy chủ) và `otypeSug` (CRM) gợi ý: Lễ → Ngoài giờ (`caOf`) → khách hỏi kênh Quảng cáo/Ebook/Form website trong 30 ngày = Khách mới → có `Đơn đầu` trước đó = Khách cũ → Khách mới. Nhân viên chọn khác gợi ý → `otypeFlag` ghi lý do vào `Kiểm tra loại đơn`; quản lý xử lý qua `order_status` (`otypeOk` / `otype`). Cột `Ca` suy ra từ loại đơn (`otypeCa`). Đơn web tự lấy gợi ý; đơn nhập file lấy từ cột phân loại (`otypeFromFile`). % hoa hồng: Script Property `commission_cfg` (action `settings` với `commission`), CRM `rules.commission`; BCDT mục *Theo loại đơn*. Đơn cũ chưa có cột: CRM suy ra (`otypeOf`).
