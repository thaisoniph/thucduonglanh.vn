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
├── .github/workflows/          tự đăng lên Cloudflare, mỗi phần một luồng riêng, chỉ chạy khi phần đó đổi:
│   ├── deploy.yml        Website thucduonglanh.vn (bỏ qua khi chỉ đổi crm/, guide/, api/, backend/, scripts/, output/, file .md)
│   ├── deploy-crm.yml    CRM + Hướng dẫn nội bộ: crm/, guide/, và dữ liệu CRM dùng chung (content/products, content/combos, data/, assets/img/brand, build.py)
│   ├── deploy-api.yml    Máy chủ api (Worker + D1): chỉ khi api/ đổi; không huỷ giữa chừng để D1 không bị dở dang
│   └── apps-script.yml   Apps Script: chỉ khi backend/google-apps-script.gs đổi
├── api/                   máy chủ CRM + nhận đơn: api.thucduonglanh.vn (Cloudflare Workers + D1)
│   ├── schema.sql         cấu trúc bảng D1 (orders, customers, leads, logs, perf, usage, feedback...)
│   ├── src/               code xử lý API, CRM, nhận đơn, webhook VTP, cron, đồng bộ Sheet
│   └── wrangler.toml      cấu hình Cloudflare Worker
└── backend/               cầu nối Google (Google Apps Script)
    ├── google-apps-script.gs            cầu nối gửi email, cấp quyền đọc Sheet, dọn trigger cũ
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

**Quà tặng & cẩm nang sống khỏe (10/10/2026)**
- `data/site.json` → `camnang` (url `/cam-nang-song-khoe/`, reader = https://camnangsongkhoe.thucduonglanh.vn/, title, sub, button, image, popup). `build.py`: `page_camnang()`, `page_gifts()` (`/qua-tang/`, mục 🎁 Quà Tặng trong NAV), `gifts_block("home")` (thay khung ebook ở trang chủ), `cn_cta("post")` cuối bài viết, `gift_popup()` trong footer. Ảnh ở `assets/img/brand/cam-nang/`.
- Form (`initCamNang`): tên + SĐT + chip "vấn đề quan tâm" (bắt buộc ≥ 1) + câu hỏi thêm → `{type:'contact', kind:'ebook', book:'cam-nang', book_title, concern, ask}`. api/ (bản 2026-10-10a) với `kind:'ebook'`: lead kênh "Ebook – quà tặng (Website)", interest = "<book_title> · Quan tâm: …", Telegram 🎁 ĐĂNG KÝ EBOOK, không gửi email. Xong mở sách ở tab mới với `?ma=<mã>`; localStorage `tdl_camnang`. GA4 `generate_lead` (form: camnang).
- Khoá trang sách: index.html của camnangsongkhoe có script đầu trang: có `?ma=` → lưu localStorage `tdl_cn`; chưa có → chuyển về `/cam-nang-song-khoe/?tu=link_sach`. Trang sách là Cloudflare Pages project `camnang-song-khoe-thuc-duong-lanh` (Direct Upload, không nối GitHub), nguồn ở máy Mac `Website TDL/cam-nang-song-khoe-ban-co-khoa/` (bản gốc trong thư mục Codex 2026-10-09). Đăng lại: `npx wrangler@4 pages deploy . --project-name camnang-song-khoe-thuc-duong-lanh --branch main` trong thư mục đó (khoá đã lên 10/10/2026). Sửa sách thì giữ đoạn script khoá ở đầu `index.html`. Khoá mềm (chặn người xem thường, không chặn người rành kỹ thuật); PDF `downloads/` vẫn mở trực tiếp được.
- **Form quà dùng chung (bản 10/10/2026 chiều)**: `gift_form(key)` (key `camnang` | `ebook`) cho cả `/cam-nang-song-khoe/` và `/ebook/`: tên, SĐT, chip vấn đề quan tâm (`CN_CONCERNS`, `EB_CONCERNS`), câu hỏi thêm. JS `initGiftForm`: lưu `tdl_lead` {name, phone, concern, gifts}; khách đã có `tdl_lead` sang quà kia → ô "Chào …, nhận ngay 1 chạm" (gửi `again: true`, Telegram "NHẬN THÊM EBOOK", api ghi nối Quan tâm bằng ` | ` qua `addInterest` thay vì ghi đè). Xong → mở quà + mời nhóm Zalo + thẻ "Anh/chị còn 1 quà nữa". `initGiftStatus`: thẻ quà ở trang chủ / `/qua-tang/` hiện "✓ Đã nhận · Đọc lại" hoặc "Nhận ngay 1 chạm".
- **CRM tặng quà** (api 2026-10-10e): `build.py crm_gifts()` → `CRM_CONFIG.gifts` (key, title, link đọc thẳng: cẩm nang `reader?ma=crm`, ebook = flipbook; image, desc). `crm/app.js`: `giftBox(p, ctx)` trong hộp chăm sóc (`openCare`), hồ sơ khách (`openCustomer`), `openConsult`, `openLead`; `giftOrder` gợi ý theo từ khoá khớp/xương/gout trong sản phẩm, quan tâm, ghi chú; `giftGot` = nhật ký "Gửi quà tặng" hoặc lead kênh Ebook có tên quà. Mẫu: `GIFT_TPL` hoặc Mẫu tin có "Quà tặng" + "cẩm nang"/"ebook", chỗ trống [Tên], [Link quà], [Tên quà], [Link nhóm]. Gửi → `sendOp('gift')` → api `crmGift` ghi log.
- **Link nhóm Zalo cố định** `/nhom-zalo/`: trang chuyển hướng tới `zalo_group` (sửa ở /admin → Cài đặt). Dùng cho QR, sách cẩm nang, bài đăng; nhóm đầy chỉ cần đổi link ở /admin. Sách cẩm nang (nút Zalo + ảnh `qr/ma-qr-nhom-zalo-song-khoe.png`) đã trỏ vào link này từ 10/10/2026; tạo lại ảnh QR: `Website TDL/cam-nang-song-khoe-tao-qr-zalo.py <đường dẫn ảnh>` (cần thư viện `qrcode[pil]`).
- Popup (`initGiftPop`): máy tính = chuột ra mép trên; điện thoại = vuốt ngược nhanh sau khi cuộn > 1 màn hình, hoặc rời app rồi quay lại (sau 30 giây). Chỉ sau 12 giây trên trang; 1 lần/phiên; bấm đóng → không hiện 7 ngày (`tdl_gp_off`). Không hiện khi có giỏ hàng, có `tdl_last_order`, `tdl_camnang`, `tdl_ebook`, hoặc ở trang giỏ/thanh toán/cảm ơn/quà tặng. Sự kiện GA4: `gift_popup_view` (`trigger`), `gift_popup_click`, `gift_popup_close`.

**Nội dung**: Góc Sống Lành, Giới thiệu, **Hồ sơ thương hiệu** (/ho-so-thuong-hieu/ – sách lật Heyzine + PDF), trang chính sách, Liên hệ (form gửi về Sheet/Telegram).

**Liên hệ nhanh**: nút Gọi / Zalo nổi (điện thoại: 2 nút), hotline **0966 326 522**, Zalo OA ở chân trang. Bong bóng lời chào của hộp tư vấn ẩn sẵn; tự bung 1 lần/phiên khi khách ở trang ≥ 25 giây hoặc cuộn ≥ 60% (`initFloat`, sessionStorage `tdl_fw_auto`; bấm × → `tdl_fw`, không bung lại; không bung khi đang hiện thanh mua nhanh).

**Tối ưu chuyển đổi (CRO, 10/2026)**
- Trang chủ: hero tĩnh (`data/home.json` → `hero`; preload ảnh, H1 duy nhất), khối **Chọn theo nhu cầu** (`data/needs.json` + ô `needs` của sản phẩm/gói; nhu cầu ≥ 2 sản phẩm có trang `/nhu-cau/<slug>/`, 1 sản phẩm thì dẫn thẳng PDP), băng chuyền từ `slides` (không tự chạy, `initRail`).
- Trang sản phẩm: giá gạch + nhãn −X% + "≈ …đ/gói" theo quy cách (`servings`, `serving_unit` ở sản phẩm/quy cách; JS `renderPrice` → sự kiện `tdl:variant`), hàng huy hiệu `badges` (huy hiệu có chữ "kiểm nghiệm" → `#kiem-nghiem`, mở `test_cert_img` nếu có), dòng cam kết `trust_line`, khối đánh giá `reviews` (sao + `aggregateRating` chỉ khi ≥ 3 đánh giá có sao: `rating_of`).
- Thanh mua nhanh dính đáy `#satc` (**< 768px**, `initSatc`, bản 10/10/2026): tên + quy cách, tổng tiền = đơn giá × số lượng, − số lượng + (1–99, đồng bộ 2 chiều với `#qtyInput` qua `setQty` → sự kiện `tdl:qty`), nút "Thêm vào giỏ" bấm hộ `[data-add-detail]` (không có giỏ thứ hai, `add_to_cart` chỉ 1 lần). Chỉ hiện khi đáy nút `[data-buy-now]` đã lên khỏi mép trên màn hình (đo bằng sự kiện cuộn + rAF, không dùng IntersectionObserver vì vuốt nhanh qua nút thì IO không báo); ẩn khi chân trang hiện; lúc ẩn có `inert` + `aria-hidden`; lúc hiện `body.satc-on` có padding-bottom = chiều cao thanh. Bỏ nút "Mua ngay" và chọn quy cách trên thanh cũ.
- **Hồ sơ chất lượng** (`proof_drawer` trong build.py, `initProof` trong main.js): nút dưới huy hiệu mở khung (dialog, giữ focus, Esc/nền/× đóng, trả focus). Nguồn: `proofs` (title, org, number, date, scope, file), `test_cert_img`, `label_imgs`, và các mục `sections` có tiêu đề chứa kiểm nghiệm/chứng nhận/pháp lý/tiêu chuẩn/xuất xứ. Không có dữ liệu → không hiện nút. Mục đầu tiên chứa kiểm nghiệm/chứng nhận/pháp lý có `id="kiem-nghiem"`.
- Hero: `hero.trust` (text, url) → dòng tin cậy dưới nút; điện thoại: nút chính full-width, "Xem tất cả sản phẩm" thành link phụ.
- Thanh toán: COD đứng đầu, mặc định COD; chỉ khi khách **tự bấm** chọn phương thức mới lưu `tdl_pay` và lần sau giữ lựa chọn đó (`payPref`). Chuyển khoản có 3 bước + câu "không có phí ẩn". Ô đồng ý nhận tư vấn vẫn không chọn sẵn.
- Giỏ mini: thanh tiến độ freeship `shipProgressHTML` (vẽ lại trong `renderMini`, không dùng MutationObserver). Mốc 2 `site.json → aov_milestone` (enabled/amount/label/reward), **mặc định tắt**; bật mà không có `reward` thì chỉ ghi nhãn trung tính.
- Sự kiện đo lường mới (qua `track`, chỉ khi khách đồng ý cookie): `payment_method_view`, `payment_method_change`, `cro_sticky_view`, `cro_sticky_qty_change`, `cro_sticky_add_to_cart`, `shipping_progress_view`, `shipping_milestone_reached`, `upsell_impression`, `upsell_add` (thay `cart_upsell_add`; có `location` minicart/gio_hang/thanh_toan/mua_ngay + `reason`), `view_quality_docs`, `search` có thêm `search_corrected`. Không gửi tên/SĐT/địa chỉ. Bỏ `sticky_atc_click`.
- Thẻ sản phẩm "Từ …": giá gạch + nhãn theo đúng quy cách rẻ nhất (`card_item`).
- Tìm kiếm: `keywords` (nội bộ, không hiển thị) + tên + mô tả + thành phần (`ing`, ưu tiên thấp), không dấu, khớp đầu từ; khớp cả cụm ở tên/từ khóa thì chỉ lấy các sản phẩm đó. `smartSearch`: kết quả đúng luôn đứng trước; sau đó mới tới từ đồng nghĩa/gõ sai trong `SYN` (curcmin → curcumin, nuoc tuong → xi dau…); vẫn không có thì sửa chữ sai (Levenshtein ≤ 1 cho từ ≥ 5 chữ cái, ≤ 2 cho từ ≥ 8) theo từ vựng tên + từ khóa. Kết quả gần đúng có dòng báo. Không có kết quả → chip nhu cầu + gói khởi động + nút Zalo.
- Thẻ sản phẩm: chip thuộc tính lấy từ `badges` khớp `CHIP_RE` (Không…, Thuần chay, Đường cỏ ngọt), tối đa 2.
- Giỏ hàng / minicart: `cartUpsell` (chưa đủ freeship: món giá ≤ phần thiếu + 100k, ưu tiên `UP_FIRST` = Ruốc, DILVANG; đủ: món trong `upsell` của sản phẩm trong giỏ). Minicart tối đa **1** gợi ý, trang Giỏ hàng tối đa 2, Thanh toán/Mua ngay tối đa 3. Mọi gợi ý có lý do (`upWhy`: đủ/gần freeship, "Hay dùng cùng …", "Cùng nhu cầu …"); không có lý do thì không gợi ý. Không gợi ý gói combo khi giỏ đã có sản phẩm nằm trong gói (`comboClash`).

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

**Việc chăm sóc mỗi ngày** (hàm `careTask`, dùng chung cho tin Telegram 8h và tab Hôm nay trên CRM web): hẹn gọi lại (cột "Hẹn gọi lại" đến ngày) · hỏi nhận hàng (D+1 đến D+3) · sắp hết / đã hết sản phẩm (–7 đến +2 ngày) · xin cảm nhận (D+14 đến D+17) · giới thiệu sản phẩm (D+30 đến D+33) · mời quay lại (D+60 đến D+67). Khách đã được chăm sóc sau mốc đó thì không nhắc nữa. **Khách quen sản phẩm** (bản 2026-10-05a): `shipMap` gắn `fam` cho đơn gần nhất khi `famOf` thấy mọi sản phẩm (khoá `prodKeys`: bỏ 🎁, số lượng, quy cách) khách đã nhận ≥ `rules_cfg.famMin` lần trước (mặc định 1, 0 = tắt), lần gần nhất ≤ 180 ngày (`FAM_GAP`), đơn liền trước không hoàn → `careTask` bỏ mốc d1/d7/d14 (`FAM_SKIP`); vẫn nhắc runout/d30/winback/callback. `custObj` gửi `fam` → nhãn 🌟 Khách quen SP trong hồ sơ + hộp chăm sóc; ô chỉnh ở Cài đặt → Nhóm khách. Chưa port sang api/ (Cloudflare). **api/ (bản 2026-10-09):** `careTask` có thêm **giãn cách chăm sóc** `rules_cfg.coolDays` (mặc định 14, `COOL_DAYS`, 0 = tắt; ô ở Cài đặt → Nhóm khách): khách có `care_at` trong coolDays ngày và `care_result` ≠ "Không nghe máy" → bỏ runout/d14/d30/winback (vẫn callback, d1). d1: đơn gần nhất còn Mới/Đã xác nhận/Đang giao (`last_status`) thì chờ 3 ngày sau ngày đặt, đã giao thì từ D+1; khung đến D+6; có chăm sóc sau ngày đặt thì coi như đã hỏi. CRM web `oldDueAll` bỏ khách có đơn trong 30 ngày.

### CRM web – https://crm.thucduonglanh.vn & Máy chủ API – https://api.thucduonglanh.vn

- Trang tĩnh trong `crm/`, build ra `dist-crm/`, đăng lên Cloudflare Pages project **thucduonglanh-crm**.
- Từ 10/2026 (bản `2026-10-07d`), toàn bộ dữ liệu đơn hàng và CRM chạy trên máy chủ **Cloudflare Workers + D1** tại `https://api.thucduonglanh.vn/api`. Dữ liệu được sao lưu sang các tab "CRM · …" của Google Sheet chính 6 tiếng/lần (`mirror` trong `api/src/cron.js`). Apps Script cũ đóng vai trò cầu nối Google (gửi email, cấp quyền đọc Sheet) và đã được tắt các trigger chạy ngầm cũ (`tatTriggerCu`).
- Toàn bộ tính năng CRM đã được port đầy đủ sang Worker: tab Hiệu quả (`perf`), Mức dùng CRM (`usage`, `usage_report`), Góp ý (`feedback`, `fb_list`, `fb_img`, `fb_update`), Webhook Viettel Post (`vtp`), nhắc nhở không vào CRM (`usageAlert`), tự nhập file sale 30 phút/lần (`srcAutoTick`).
- **Đăng nhập**: nhập email → máy chủ gửi mã 6 số qua email (10 phút, phiên 30 ngày lưu trong D1 `sessions`). Chỉ email có trong bảng `users` và đang kích hoạt mới vào được. Bỏ tích "Đang dùng" là khoá ngay.
- **Quyền**: Nhân viên = Hôm nay, Khách hàng, Đơn hàng (đổi trạng thái, tạo đơn nhập tay), Liên hệ. Quản lý = thêm doanh thu, sửa Chu kỳ dùng và Mẫu tin nhắn. Quản trị = thêm quản lý nhân sự.
- **Tạo đơn nhập tay** (Zalo, điện thoại…): ghi vào Đơn hàng với Nguồn "Nhập tay – …", cập nhật Khách hàng, báo Telegram (không gửi email).
- **Số ngày chưa chăm sóc** (nhãn màu trên mỗi thẻ khách + ô lớn trong trang chi tiết): đếm từ lần gần nhất khách *có phản hồi* (mọi kết quả trừ "Không nghe máy"), lấy từ Nhật ký CSKH + cột Lần CSKH/Kết quả CSKH. Chưa chăm sóc lần nào thì đếm từ ngày mua đầu tiên. Xanh ≤ 7 ngày, cam 8–30, đỏ > 30. Có bộ lọc "Quá 30 ngày chưa chăm sóc" và cách sắp xếp "Lâu chưa chăm sóc nhất". Tính trên trình duyệt, không cần sửa Apps Script.
- **Khách tiềm năng** (tab Tiềm năng): cần liên hệ khi Mới hỏi chưa liên hệ, đến ngày hẹn, hoặc Đang tư vấn mà 3 ngày chưa liên hệ lại. Nút Tư vấn → kết quả; "Khách chốt mua" mở form tạo đơn (`order_create` với `leadId` → lead thành Đã chốt + Mã đơn, Nguồn đơn = "Tiềm năng – <kênh>"); "Khách không mua" bắt buộc lý do. Mẫu tin "Khách mới hỏi" được thêm 1 lần vào Mẫu tin nhắn CSKH (cờ `tpl_lead_added` trong Script Properties).
- **Hôm nay** (`viewToday`): thứ tự Đơn mới → 🔥 Khách vừa hỏi (`isHotLead`: khách hỏi chưa liên hệ lần nào, hỏi trong 24 giờ) → Chăm sóc (nhóm đầu tiên tự mở, mỗi dòng có `lastTouch` = lần liên hệ gần nhất từ `recentHist`) → Khách hỏi còn lại. Quản lý xem Tất cả nhân sự có `teamBlock` (tiến độ từng người: đã xong/cần làm theo `dayLimit`, trễ, KNM, khách hỏi chờ, đơn Mới, chốt hôm nay theo `seller`). Số đỏ tab Hôm nay = đơn mới + `dayQueue` + `hotLeads`. Tên sản phẩm hiển thị qua `prettyProd` (viết hoa chữ đầu và tên thương hiệu). Nhóm ảo `viplate` (`vipLate`: VIP, trễ ≥ 2 ngày, trừ callback/runout; `prioOf` = 0.5) đứng sau Hẹn gọi lại. `bdayChip` (`bdaySoon` ≤ 7 ngày, cần cột Ngày sinh). `sugLine`/`suggestFor`: sản phẩm hay mua kèm, đếm cặp từ `products` của mọi khách đã tải (`coBuyMap`, khoá `pkey` bỏ quy cách, cần ≥ 2 lượt), chỉ hiện ở runout/d30/winback/old.
- **Hiệu quả** (tab `#bao-cao`, ai cũng xem): nhân viên thấy của mình, quản lý thấy thêm "Cả nhóm" (có biểu đồ **So sánh nhân viên** theo chỉ số chọn được, vạch trung bình nhóm) và bấm từng người. Quản lý có ô **Người phụ trách** dùng chung cho 5 tab (`S.who`, lưu `localStorage crm_who`: rỗng = tất cả, `-` = chưa ai, hoặc tên); đơn lọc theo `seller`, thiếu thì lấy người phụ trách khách. Theo tháng (tháng này / trước / 2 tháng trước). Khối **Mục tiêu tháng**: thanh tiến độ + vạch "hôm nay", trạng thái (đúng tiến độ nếu % đạt ≥ % số ngày đã qua; hơi chậm ≥ 80% mức đó; còn lại là chậm), còn thiếu / mỗi ngày cần, dự báo cả tháng. Chỉ số: doanh số, giá trị TB/đơn, tỷ lệ chốt (`closeStats`: data = các dòng `S.d.adRows` có ngày trong kỳ, sale = người đó, mỗi SĐT 1 lần; ra đơn = SĐT có đơn không huỷ/hoàn từ đầu ngày có số (`buyMap`) hoặc khách hỏi của số đó "Đã chốt"; không mua / số rác theo khách hỏi; tỷ lệ = ra đơn ÷ data, đang tư vấn / không mua / số rác nằm trong mẫu số; BCDT dùng chung cho cột Data quảng cáo / Data ra đơn / Tỷ lệ chốt và cột Data mới theo dòng SP (dòng SP theo cột Nguồn / tên sheet)), % doanh thu từ khách cũ, lượt chăm sóc & % khách trả lời, khách đặt lại, khách quá 30 ngày. Mỗi chỉ số so với tháng trước.
- **Đồng bộ file sale** (Cài đặt, chỉ Quản trị; trang Sheet "Nguồn dữ liệu sale"): mỗi file gồm sale + link + cấu hình từng sheet (vai trò `orders` / `care` / `reject` / `skip`, dòng tiêu đề, cột → trường). `src_inspect` đọc file (`SpreadsheetApp.openById`, tài khoản chạy Apps Script cần quyền xem file) và đoán cột (`detectMap`). `src_sync` từng sheet, `dry` để xem trước. Đơn: khoá theo mã đơn, không có mã thì `NK` + hash(ngày, SĐT, tiền, sản phẩm); ghi thẳng vào trang Đơn hàng (Nguồn "File <sale> – <sheet>", NV bán = sale) rồi `rebuildCustomers({owners})`. Chăm sóc: ghép nhật ký vào "Ghi chú CSKH" (dưới dòng "— Nhật ký cũ (sheet) —"), người chưa mua → tiềm năng (≤30 ngày: Đang tư vấn, cũ hơn: Không mua – dữ liệu cũ); nhớ số dòng đã xử lý (`cfg.done`). Từ chối: cột "Nhãn" của khách (Bom hàng / Từ chối).
- **File số quảng cáo** (Script Property `ads_cfg`): mỗi sheet sản phẩm một cấu hình cột. Chế độ `staff` (nhân sự chia, CRM đọc cột Sale theo "Tên trong file QC" ở Nhân sự) hoặc `crm` (CRM chia lượt theo từng sheet, số trùng → sale cũ, ghi tên vào cột Sale/Trùng sale). Chỉ lấy số từ ngày `since`. Tự đồng bộ: trigger `adsTick` 10 phút. Khoá tiềm năng `QC` + hash(sheet, SĐT, ngày). Ngày từng dòng (`adsDays`, 10/10/2026): ngày ghi ở 1 dòng áp dụng cho các dòng bên dưới tới khi gặp ngày mới (nhân sự quên ghi ngày); ngày tương lai hoặc gõ đảo (bên dưới có ≥ 5 dòng sớm hơn nó trên 2 ngày, vd dữ liệu cũ 10/2 gõ thành 2/10) coi như ô trống. Mỗi lần đọc, máy chủ ghi mọi dòng có SĐT trong 100 ngày (không phụ thuộc `since`, trùng số, sale chưa có trong CRM) vào kv `ads_rows` = [[đầu ngày VN, SĐT, sale (tên CRM theo alias, không khớp thì giữ chữ trong file), nguồn]] + `ads_rows_v` (hash); `loadSmall` gửi kèm `adRows`/`adV` (nhân viên chỉ số của mình; máy gửi `adV` khi tự làm mới, trùng thì không gửi lại). Đếm thử file Data_VitaGreen ngày 10/10/2026: 17 số hôm nay, 140 số từ 1/10.
- **Đơn hàng**: thêm cột Ca (Ngày / Tối/CN / Lễ; cài giờ ca tối + ngày lễ trong `ca_cfg`), Dòng SP (Fucoidan Pro / Curcumin / BADD / Khác, cho BCDT), Lên đơn. Trạng thái thêm Hoàn, Đổi hàng (`isVoid`: Huỷ/Hoàn không tính doanh thu). Quà tặng lưu dòng `🎁 … = 0 ₫`. "Số tiền thu khách" (`total`) chia lại tiền cho các dòng (`applyTotal`). Mã đơn sale: `<Tiền tố><ddMMyy>-NN` (`nextCode`, tiền tố ở Nhân sự).
- `rebuildCustomers` chạy hoàn toàn trong bộ nhớ (chịu được hàng chục nghìn đơn). `crmLoad` chỉ gửi đơn 13 tháng + đơn đang xử lý; đơn cũ xem qua `cust_orders`.
- **Phân quyền dữ liệu**: `crmLoad` chỉ gửi cho Nhân viên khách có Phụ trách = mình (chế độ Kho chung: cộng khách chưa ai phụ trách), đơn của các khách đó hoặc đơn mình bán, tiềm năng của mình, nhật ký liên quan. Mọi thao tác ghi đều qua `guardPhone` / `guardLead` / `orderGuard` (Kho chung: thao tác trên khách chưa ai phụ trách = nhận luôn). `check_phone` cho biết số đang do ai phụ trách (không lộ thông tin khách). Nhân viên không đổi được người phụ trách.
- **Khách trùng sale** (api/, bản 2026-10-08a; Cài đặt → 🔀, Quản lý trở lên): mỗi lần đồng bộ sheet `orders` / `care`, `notePhones` ghi các SĐT trong sheet vào bảng D1 `sale_phones` (khoá phone + src + sheet; chỉ ghi phần thay đổi, chữ ký ở kv `sp_<hash>` để bỏ qua sheet không đổi). `dups` liệt kê khách (bảng customers) có trong file của ≥ 2 sale, hoặc trong file 1 sale nhưng đang do người khác phụ trách; kèm đơn theo `seller`. `dup_set` đặt owner + chuyển khách hỏi đang mở, ghi `dup_done` (owner, danh sách sale lúc chốt), ghi Nhật ký "Giao khách", nhắn Telegram người nhận. Khách coi là đã chốt khi `dup_done.owner` = owner hiện tại và mọi sale có file đều nằm trong danh sách lúc chốt. Nhập file sale (`importOrders` / `importCare`) không báo xung đột cho khách đã chốt (`settledOf`). `dup_scan` đọc lại cột SĐT mọi file (không nhập), xoá dữ liệu của sheet/file không còn dùng. Cũng sửa `srcAutoTick`: gọi `srcSync` theo tên sheet (trước truyền chỉ số trong danh sách đã lọc nên lệch khi có sheet "skip").
- **Gộp tên nhân sự gõ khác dấu** (api/, bản 2026-10-08b): `nameKey` so tên không phân biệt vị trí dấu thanh (Thuỷ = Thủy, vẫn Thủy ≠ Thúy). `unifyNames` đổi các tên lệch về đúng tên tài khoản ở bảng users trong customers.owner/last_seller, orders.seller, leads.owner, sources.sale, sale_phones.sale, dup_done, logs.by_name, targets. Hai tài khoản cùng khoá thì không tự gộp. Chạy sau mỗi lần tự nhập file sale (~30 phút), khi lưu Nhân sự và khi mở màn hình Khách trùng sale. Nguyên nhân: dữ liệu chuyển từ Sheet có cột Phụ trách gõ "Thu Thủy" trong khi tài khoản là "Thu Thuỷ" → khách bị tách sang "người" khác, nhân viên không thấy khách của mình.
- **Tốc độ máy chủ api/ (bản 2026-10-09e)**: D1 đặt ở Tây Bắc Mỹ (WNAM), người dùng vào qua Tokyo → mỗi lần hỏi D1 mất 0,15–0,3 giây. Đo 09/10: lệnh rỗng mất 3–5 giây vì `ensureSchema` chạy ~25 lệnh nối tiếp mỗi khi Cloudflare bật máy mới. Đã sửa: (1) `ensureSchema` chỉ hỏi kv `schema_v` = `SCHEMA_V` (thêm bảng/cột/chỉ mục trong hàm này thì **tăng `SCHEMA_V`**); (2) `[placement] mode = "smart"` trong `wrangler.toml` để máy chủ chạy gần D1; (3) `crmSession` đọc phiên + nhân sự trong 1 batch, `loadSmall` chạy song song với lượt đọc chính (`crmLoad`, `crmDelta`). Máy chủ trả `sms` (ms xử lý) cho mọi lệnh `crm` → CRM ghi vào bảng `perf` (cột Dữ liệu: tải đầu / đợt 2 / làm mới / tải đủ), xem ở tab Sheet "CRM · Đo tốc độ CRM".
- **Sao lưu Sheet (`mirror`, sửa 09/10/2026)**: trước đây xoá sạch các tab "CRM · …" rồi mới ghi, và Google từ chối ghi từ dòng nằm ngoài khung tab → chỉ chép được 2.000 đơn đầu, các tab khác trống. Nay nới số dòng/cột tab trước (`sheetBatch` updateSheetProperties), ghi đè, rồi mới xoá dòng thừa. Lỗi lần sao lưu gần nhất lưu ở kv `mirror_err`, xem ở `/api/status`.
- `/api/status`, `/api/test-google` chỉ dành cho Quản trị: thêm `?token=<mã phiên CRM>` (localStorage `crm_token`). `/api/bridge-check` vẫn công khai (Apps Script gọi).
- **Tiết kiệm lượt đọc D1** (10/2026): lịch tự động (`api/wrangler.toml` crons `*/10 0-14 * * *`) chỉ chạy 7h–21h59 giờ VN, ban đêm nghỉ (đơn web, webhook Viettel Post vẫn nhận 24/7). CRM web tự làm mới 15 phút/lần, chỉ tải phần thay đổi (cột `upd` + trigger), 22h–6h không tự làm mới. Tải đủ chỉ khi sang ngày mới hoặc quá 6 tiếng từ lần tải đủ trước (`FULL_EVERY`, trước đây 1 tiếng); mở lại CRM cùng ngày từ dữ liệu lưu trên máy (IndexedDB, lưu kèm `fa` = lúc tải đủ) cũng chỉ tải phần thay đổi. Lý do: 09/10/2026 hết hạn mức đọc miễn phí D1 (5 triệu dòng/ngày; mỗi lần tải đủ đọc ~15–25 nghìn dòng). Bản sao sang Sheet 6 tiếng/lần; tự nhập file sale bỏ qua sheet không đổi.
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

**Token Telegram** (từ 06/10/2026): không còn ghi trong code, mà nằm ở Apps Script → ⚙️ Cài đặt dự án → Thuộc tính tập lệnh → `TELEGRAM_TOKEN`. Nhờ vậy `backend/google-apps-script.gs` được đưa lên GitHub. Các bản `backend/*.backup-*.gs` cũ vẫn còn token nên chỉ để ở máy.

**Tự triển khai Apps Script** (GitHub Actions `.github/workflows/apps-script.yml` → `scripts/apps-script-deploy.sh`, dùng `@google/clasp@2.4.2`): mỗi lần `backend/google-apps-script.gs` đổi trên `main`, GitHub kiểm tra cú pháp + không có token Telegram, `clasp pull` dự án hiện tại (giữ `appsscript.json`, file khác), ghi đè file có `function doPost`, `clasp push` (= Lưu), `clasp version`, `clasp deploy -i <mã trong order_endpoint>` (link nhận đơn giữ nguyên), rồi gọi `doGet` kiểm tra `v` = `CRM_VERSION`. Chưa có secrets thì bỏ qua (cảnh báo vàng). Chạy tay: GitHub → Actions → "Apps Script – tự dán code và triển khai" → Run workflow. Lỗi → GitHub báo đỏ + email; muốn quay lại bản cũ: revert commit trên `main`.
Cài 1 lần (trên Mac, tài khoản Google sở hữu Apps Script – thaisoniph@gmail.com):
1. script.google.com/home/usersettings → bật **Google Apps Script API**.
2. Terminal: `npx -y @google/clasp@2.4.2 login` → trình duyệt mở → chọn tài khoản → Cho phép. (Báo "npx: command not found" thì cài Node từ nodejs.org trước.)
3. `pbcopy < ~/.clasprc.json` → GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**: tên `CLASPRC_JSON`, dán.
4. Apps Script → ⚙️ Cài đặt dự án → **Mã tập lệnh** → copy → secret `APPS_SCRIPT_ID`.
5. Actions → chạy tay workflow lần đầu, xem có ✅.
Apps Script giới hạn 200 phiên bản/dự án: báo lỗi "Không tạo được phiên bản mới" thì xoá bớt phiên bản cũ. Đăng xuất / đổi mật khẩu Google có thể làm hết hạn mã đăng nhập → làm lại bước 2–3.

**Sửa code Apps Script (làm tay, khi chưa cài tự triển khai)**: (phần CRM web nằm trong `doPost` → mọi thay đổi `crm…` đều phải Deploy phiên bản mới) dán đè toàn bộ `backend/google-apps-script.gs` → Lưu. Nếu sửa phần nhận đơn (`doPost`) thì thêm: Triển khai → Quản lý các bản triển khai → ✏️ → **Phiên bản mới** → Triển khai (link nhận đơn giữ nguyên). Lịch 8h luôn dùng bản đã lưu mới nhất.

**Người nhận báo đơn**: thêm/xoá thành viên trong nhóm Telegram "Đơn hàng Thực Dưỡng Lành" – không cần sửa code.

---

- **Tốc độ tải CRM** (Apps Script 2026-10-02c):
  - CRM tải 2 đợt: `load` `part=core` (khách, việc, đơn 100 ngày + đơn đang xử lý, nhật ký 60 ngày), rồi `part=rest` tải ngầm phần cũ. Dữ liệu lưu trên máy (IndexedDB), lần sau mở hiện ngay.
  - Bản nhớ tạm trên máy chủ (CacheService, 10 phút). Từ bản 2026-10-07c, bản nhớ được **nén** (gzip → base64, ô 90 KB, tối đa 5 MB sau nén). Trước đó, khoảng 6.000 đơn đã vượt 3 MB nên bản nhớ không được lưu và lần tải nào cũng đọc cả Sheet (11–12 giây). Nếu sau nén vẫn quá lớn thì Script Properties `cache_skip` ghi lại kích thước. Mở hồ sơ khách (`crmCustOrders`) dùng bản nhớ để biết các dòng đơn của khách và chỉ đọc mấy dòng đó; nếu mã không khớp thì đọc cả tab. Từ bản 2026-10-05d, `cachePatch()` sửa đúng các dòng liên quan trong bản nhớ cho: chăm sóc (kể cả "đã nhận hàng"), sửa khách (trừ đổi người phụ trách), tư vấn / thêm khách hỏi, **tạo đơn, đổi trạng thái / ghi chú / vận đơn / đã nhận tiền của đơn, nhận khách**. Nó đọc lại dòng đơn, các đơn cùng SĐT, dòng khách, tab Khách tiềm năng và dòng nhật ký mới. Nếu dòng đơn bị xê dịch (mã không khớp) hoặc có hơn 20 dòng đơn mới lạ thì bỏ bản nhớ. Huỷ / hoàn đơn, sửa đơn, chia khách, nhập file vẫn gọi `rebuildCustomers` / `dataChanged()`, làm bản nhớ đổi khoá nên tự bỏ. Trước đây Sale (lên đơn, đổi trạng thái nhiều) làm bản nhớ bị bỏ liên tục, nên lần tải sau phải đọc cả Sheet. Kịch bản thử `backend/crm-test` `?patch` so bản nhớ đã sửa với `readBase` sau mỗi thao tác.
  - `readBase` chỉ đọc 6000 dòng cuối của tab Nhật ký CSKH (không đọc cả tab).
  - Đo tốc độ: CRM ghi thời gian mỗi lần tải / lưu (tổng, máy chủ `sms`, dữ liệu lấy từ bản đọc sẵn hay đọc Sheet, KB, thiết bị / mạng). Cứ 2 phút (hoặc khi ẩn tab) CRM gửi gộp bằng lệnh `perf` vào tab **"Đo tốc độ CRM"**, giữ khoảng 6000 dòng. Tổng trừ Máy chủ ra thời gian đi đường (mạng).
  - **Mức dùng CRM** (Apps Script 2026-10-07b): CRM đếm lượt mở (mở trang hoặc quay lại sau ≥30 phút), phút dùng (tab đang hiện + có click/gõ/cuộn/chạm trong 2 phút), màn hình đã xem; gửi lệnh `usage` 5 phút/lần hoặc khi ẩn tab (chỉ khi máy chủ ≥ 2026-10-07b) → tab **"Hoạt động CRM"**, 1 dòng / email / ngày (`crmUsage`, cộng dồn). `usage_report` (chỉ Quản trị, nút Hiệu quả → 📈 Mức dùng CRM) gộp tab này + "Đo tốc độ CRM" (ngày có vào trước 07/10) + toàn bộ Nhật ký CSKH (thao tác, mốc lần đầu: chăm sóc = `TASK_LABEL` + Tư vấn + Trả lời liên hệ, đơn = Tạo/Sửa đơn, Đơn hàng, Loại đơn, ưu đãi = Gửi ưu đãi). "Chăm sóc hôm nay" tính ở máy (`teamStats`, dùng chung bảng Tiến độ nhân sự). `usageAlert` chạy cuối `dailyCare` (8h): gửi Quản trị (Telegram riêng, không có thì email) ai ≥ `USE_IDLE_DAYS` (2) ngày chưa vào; thứ Hai thêm tóm tắt tuần. Thử tay: hàm `thuMucDung`. Kịch bản thử: `backend/crm-test` `?usage`, `?usage&who`.
  - Lịch `docSanCRM` mỗi 5 phút (6h–22h) đọc sẵn Sheet khi bản nhớ hết. Lịch này tự cài khi Quản trị mở CRM; có thể chạy tay `caiDocSan`.
  - Đơn hàng có cột **Ngày gửi** (Apps Script 2026-10-02d): tự ghi khi đơn chuyển Đang giao / nhập mã vận đơn; "Giao lâu chưa tới" tính từ ngày gửi, chưa có thì từ ngày đặt.
  - **Viettel Post tự cập nhật (Apps Script 2026-10-06a)**: Viettel Post gửi tin mỗi lần đơn đổi trạng thái (webhook, cài ở partner.viettelpost.vn → Cài đặt tài khoản → Cấu hình webhook, URL `https://crm.thucduonglanh.vn/vtp-webhook`, Secret tự đặt, chờ Viettel Post duyệt). Cổng `crm/functions/vtp-webhook.js` (Pages Function của project CRM; workflow deploy CRM chạy trong thư mục `crm/` để Cloudflare thấy `functions/`) trả 200 ngay (Viettel Post chỉ chờ vài giây) rồi chuyển tin sang Apps Script `{type:'vtp', payload}` chạy nền bằng `waitUntil`, vì Apps Script luôn trả 302 và mất ~6 giây. `vtpWebhook()` kiểm tra `TOKEN` = Script Property `VTP_SECRET`, tìm đơn theo Mã vận đơn (hoặc ORDER_REFERENCE = Mã đơn), ghi 3 cột `Hành trình VC` / `Cập nhật VC` / `Mã TT VC`, bỏ tin cũ hơn tin đã có. 501 → Đã giao, 504 → Hoàn, mã ≥ 200 khi đơn còn Mới/Đã xác nhận → Đang giao (đều qua `crmOrderStatus` với người làm "Viettel Post (tự động)"). Mã 502/503/505/506/507/515 → báo Telegram nhóm + NV bán; CRM (`VTP_WARN`) đưa đơn vào nhóm "📵 Giao chưa được". Thử tay: hàm `testVTP` (sửa mã vận đơn thật trước khi chạy). Trang tra cứu công khai của Viettel Post / BEST đều có captcha nên không đọc tự động được; BEST cần API key do BEST cấp.
  - **Đơn vị vận chuyển từ file sale (Apps Script 2026-10-06b)**: file sale không có cột mã vận đơn, chỉ có MÃ ĐƠN. `shipFromCode()` đoán hãng: `V`+chữ → Viettel Post, `xe ôm` → Xe ôm, tự giao / tại kho → Tự giao, `VP`+15–20 số → Viettel Post (kèm mã vận đơn), `GHTK…` → GHTK, 10–15 chữ số → BEST (kèm mã), mã sale thường → BEST Express. `importOrders` ghi luôn khi nhập (dòng nhập phải đủ `ORDER_HEADERS.length` cột); `ganVanChuyenTuFile()` điền cho đơn cũ (Nguồn "File …", ô hãng trống; đơn mã NK… lấy chữ trong Ghi chú qua `noteShip`), chạy cuối mỗi `srcAutoTick`. `vtpWebhook` tìm đơn theo mã vận đơn hoặc Mã đơn = ORDER_NUMBER / ORDER_REFERENCE (không phân biệt hoa thường; ưu tiên đơn đang xử lý rồi đơn mới nhất vì mã sale lặp qua các năm) và tự điền mã vận đơn thật khi tìm theo mã đơn. Chưa rõ: mã "ThủyVP…" (VP sau tên) đang coi là BEST.
  - Tự nhập file sale (srcAutoTick, Apps Script 2026-10-04b): 30 phút/lần trong 7h–21h; mỗi lần ghi 1 dòng vào tab "Tự nhập file sale" (giây chạy, đơn mới, cập nhật, ghi chú, lỗi); không có gì mới thì không tính lại khách / không ghi nhật ký; Telegram cho quản trị lần đầu trong ngày + khi lỗi. Lịch cũ 7h tự đổi (docSanCRM → wbTrigger). Từ 2026-10-07c: nếu giờ sửa cuối của file trên Drive không đổi so với lần nhập trọn vẹn trước (Script Properties `auto_mod_<mã nguồn>`) thì bỏ qua, không ghi dòng đo. Sửa cấu hình nguồn sẽ xoá mốc này. Chạy tay (`srcAutoTick(true)`) thì luôn đọc file.
  - Mỗi lần tự nhập: ngoài dòng mới, `syncOldNotes()` so ghi chú trên DÒNG CŨ của sheet chăm sóc sale (60 ngày gần đây, theo ngày + nội dung), bỏ dòng do CRM ghi ngược (tab "Ghi ngược file sale"), thêm lên đầu "Ghi chú CSKH".
  - Tab "✅ Việc hôm nay" (trang việc cũ trên Sheet) tự ẩn 1 lần (docSanCRM); CRM đã thay. Từ 05/10/2026 hàm `suaHuongDanSheet` (chạy tay 1 lần) xoá hẳn tab này, viết lại "📖 Hướng dẫn" chỉ sang CRM và đổi tên mẫu tin "… sau khi đặt" → "… sau khi nhận hàng".
  - Ghi ngược file sale (Apps Script 2026-10-04a): ngoài ghi chú chăm sóc, còn `@order` (đơn tạo trên CRM → thêm dòng vào sheet đơn hàng sale đang dùng: `cfg.orderSheet` nếu đặt, không thì sheet có ngày đơn mới nhất – Phương: VTG_lendon), `@ost` (đổi trạng thái → cột Trạng thái của đúng sheet đơn được nhập từ, tìm theo mã đơn rồi SĐT+ngày+tiền), tư vấn khách hỏi → sheet chăm sóc. Lúc nhập file: `wbKeys` bỏ dòng CRM đã ghi, `crmOrderDays` bỏ đơn CRM/web đã ghi ngược, không tạo khách hỏi trùng SĐT.
  - Quản trị thấy thời gian tải ở dòng cuối trang ("tải …s, máy chủ …s, bản đọc sẵn/đọc Sheet, … KB").

## 5. Đo lường & remarketing

- Mã trong `data/config.json`: `ga4_id` = **G-X40P3S7FZ8**, `clarity_id` = **yoto1kqbmx**, `meta_pixel` = **1342001937266392** (lấy từ trang Ladi ebook cũ, bật 2026-10-04), `tiktok_pixel` (để trống = chưa bật). Form ebook bắn `generate_lead` → Meta `Lead`.
- Công cụ chỉ chạy **sau khi khách bấm "Đồng ý"** ở thông báo cookie (Nghị định 13/2023/NĐ-CP).
- Sự kiện: `view_item`, `add_to_cart`, `begin_checkout`, `purchase` (doanh thu), `upsell_add`, `paste_fill`, `click_call`, `click_zalo`, `view_brochure`, `video_play`, `search`, `generate_lead`.
- Sự kiện CRO (10/2026, nhánh `feat/cro-quickwins`): `chat_widget_open` (`trigger`: auto_time / auto_scroll / click), `sticky_atc_click` (`action`: add_to_cart / buy_now), `search` (`search_term`, gõ ở ô tìm nhanh: gửi sau 1,2 giây ngừng gõ, mỗi từ 1 lần), `search_no_result`, `cart_upsell_add` (`item_id`, `location`: minicart / gio_hang). Muốn xem trong báo cáo GA4 thì đăng ký tham số `trigger`, `action`, `location` làm chiều tuỳ chỉnh (Quản trị → Định nghĩa tuỳ chỉnh).
- Nguồn khách (UTM / fbclid / ttclid / gclid / trang giới thiệu) lưu 30 ngày → cột **Nguồn** của đơn.
- **Tạo link theo dõi**: https://thucduonglanh.vn/admin/utm – dùng cho mọi bài đăng/quảng cáo.
- Báo cáo: analytics.google.com (Thời gian thực, Thu nạp người dùng, Kiếm tiền) · clarity.microsoft.com (Bản ghi, Bản đồ nhiệt).
- Nên làm trong GA4: đánh dấu sự kiện chính `purchase`, `click_call`, `click_zalo`, `generate_lead`; lưu dữ liệu 14 tháng; liên kết Search Console.
- **Chi phí marketing** (tab Tổng quan → 📣 Marketing, 10/10/2026): bảng D1 `ad_spend` (ngày × kênh × tài khoản × chiến dịch: spend, impressions, clicks, msgs, leads, purchases, src auto/file/manual, batch), code `api/src/mkt.js`, lệnh `mkt` (đọc theo kỳ), `mkt_fb` (token / chọn tài khoản / đồng bộ / ngắt), `mkt_import`, `mkt_add`, `mkt_list`, `mkt_del` – chỉ Quản trị. Facebook: Meta Marketing API `v23.0` (`FB_API`, đổi khi Meta ngừng bản này), insights level campaign theo ngày; mã truy cập (System User, quyền ads_read) lưu ở kv `mkt_cfg`, không bao giờ gửi về trình duyệt; cron `mktTick` 3 tiếng/lần lấy lại 3 ngày gần nhất; lần đầu kết nối lấy 90 ngày. Tài khoản không dùng VND bị bỏ qua (báo lỗi). Tìm tài khoản (`fbAccounts`): me/adaccounts ∪ me/assigned_ad_accounts ∪ tài khoản owned/client của các Business Manager (me/businesses, cần quyền business_management) ∪ mã nhập tay (`fb.manual`). `fbRefresh` chạy mỗi ngày trong `mktTick` + nút "Tìm tài khoản mới" / "Thêm mã tài khoản" (`mkt_fb` refresh / addAcc): tài khoản mới đang hoạt động tự thêm vào `fb.accounts` và lấy 90 ngày. Tài khoản chưa gán cho người dùng hệ thống → `fb.err` ghi tên tài khoản, các tài khoản khác vẫn lấy số. File CSV đọc trên trình duyệt (`parseAdsCsv`: Facebook/TikTok/Google, VN/EN, phẩy/chấm phẩy/tab, UTF-8/UTF-16; không có cột ngày thì chia đều theo khoảng ngày chọn). **Thêm kênh quảng cáo**: thêm 1 dòng vào `MKT_CH` trong `crm/app.js` (tên, biểu tượng, `kw` = từ khoá không dấu nhận ra đơn / khách hỏi của kênh để tính thu về). Nối API tự động kênh mới: viết hàm như `fbSync` ghi vào `ad_spend` với `src: 'auto'`, gọi trong `mktTick`.
- **Tab Tổng quan trong CRM** (`#tong-quan`, chỉ Quản trị, 10/10/2026): `viewDash` trong `crm/app.js`. Phần kinh doanh tính trên máy từ `S.d.orders` / `S.d.leads` (không gọi thêm máy chủ); kênh đơn theo `chanOf` (nguồn bắt đầu "File " = Sale file, "Nhập tay – …" = Sale, "Tiềm năng – …" = Khách hỏi, còn lại = Website, chi tiết theo `webSrc`). Phần website gọi lệnh `ga` (`api/src/ga.js`): GA4 Data API `batchRunReports` (tổng, theo ngày, nhóm kênh, sự kiện phễu, nguồn/kênh, trang, trang vào đầu, thiết bị), lưu tạm kv `gac_<khoảng>` 30 phút (có hôm nay) / 12 tiếng. Mã thuộc tính ở kv `ga_prop`, tự tìm qua Admin API theo `MEASUREMENT_ID`, hoặc Quản trị nhập tay (lệnh `ga_prop`). Mã truy cập là của Apps Script (`gInfo`), nên Apps Script cần quyền `analytics.readonly`: 2 dịch vụ **Google Analytics Data API** + **Admin API** do CI tự thêm vào `appsscript.json` theo `backend/appsscript-services.json`. Khi file này có `authorized: false`, `scripts/apps-script-deploy.sh` chỉ Lưu (clasp push), **không** triển khai, vì web app chạy bản cần quyền chưa cấp sẽ ngừng (mất cầu nối Google: mã đăng nhập, Sheet). Chủ tài khoản mở Apps Script (https://script.google.com/d/1xylCUALC-ny2iltgPPqiCSo2JaPqAGq5nSAYdePR2z1YmruWNK_1PNMP/edit), hàm đầu file là `ketNoiGA4` → ▶ Chạy → Cho phép; xong đổi `authorized: true` và push để CI triển khai. Trong lúc `authorized: false`, mọi lần sửa `.gs` cũng chỉ được Lưu, chưa triển khai.

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
- Muốn đăng lại một phần mà không sửa code: GitHub → Actions → chọn "Website – dựng và đăng" / "CRM – dựng và đăng" / "Máy chủ api – triển khai" → **Run workflow**. Thêm thư mục mới mà CRM hay web cần dùng thì nhớ thêm vào `paths` / `paths-ignore` của file workflow tương ứng.

---

## 8. Sửa giao diện / chạy thử trên máy

```bash
cd website
python3 -m pip install --user -r requirements.txt               # lần đầu
python3 build.py && (cd dist && python3 -m http.server 8000)    # xem http://localhost:8000
GH_TOKEN=ghp_xxx ./deploy-github.sh "ghi chú thay đổi"           # đẩy lên (token quyền repo + workflow)
```
Script tự lấy các thay đổi nhân sự đã làm ở /admin trước khi đẩy.

### 8a. Cập nhật từ máy tính (Antigravity) và từ điện thoại (app Claude)

Hai cách đều đổ về nhánh `main` trên GitHub → GitHub tự đăng phần nào đổi (web / CRM / api, Cloudflare) và tự triển khai Apps Script (nếu `backend/google-apps-script.gs` đổi). Dùng được cả hai.

| | Máy tính (Antigravity) | Điện thoại (app Claude) |
|---|---|---|
| Đường đi | Sửa thư mục trên Mac → `deploy-github.sh` đẩy **thẳng vào `main`** | Claude làm trên máy chủ đám mây → nhánh `claude/...` → Pull Request → Merge |
| Ưu | Chạy thử trên máy trước; thấy ảnh/PDF gốc trên Mac | Có bước duyệt (PR); mỗi lần đăng có trang PR ghi rõ đổi gì, dễ Revert |
| Nhược | Không có bước duyệt, đẩy là live | Không thấy file trên Mac; không bấm thử giao diện thật được |

**Lưu ý khi dùng cả hai**
1. **Lấy bản mới nhất trước khi sửa.** `main` đổi liên tục (phiên điện thoại, nhân sự sửa /admin); sửa trên bản cũ dễ xung đột hoặc ghi đè mất thay đổi người khác. Script `scripts/sync-latest.sh` tải `main` từ GitHub: máy không có file sửa dở thì tự cập nhật (✅); có file dở hoặc commit chưa đẩy thì chỉ cảnh báo (⚠️), không đụng file. Script tự chạy khi mở phiên Claude Code (hook SessionStart trong `.claude/settings.json`; thư mục cha `Website TDL/.claude/settings.json` ở máy cũng có hook này). Gemini/Antigravity chạy theo quy tắc trong `GEMINI.md` và `.agent/rules/`.
2. **Không sửa cùng một tính năng ở hai nơi cùng lúc.** Xong và đăng ở một nơi rồi mới sang nơi kia.
3. Antigravity dùng AI khác (không phải Claude), có thể không tự đọc `CLAUDE.md`. Đầu mỗi phiên dặn: *"Đọc CLAUDE.md và HUONG-DAN.md trước khi sửa"* (repo công khai, không ghi token / dữ liệu khách, không dùng từ "chữa/điều trị"…).
4. **Không sửa code trực tiếp trong trình soạn Apps Script nữa.** Lần merge sau có đổi `backend/google-apps-script.gs`, GitHub sẽ ghi đè và phần sửa tay bị mất. Mọi sửa đổi đi qua file trong repo. (Thuộc tính tập lệnh như `TELEGRAM_TOKEN`, `VTP_SECRET` và lịch chạy không bị ảnh hưởng.)
5. `GH_TOKEN` trên Mac cần quyền **repo + workflow**. Không lưu token vào file trong thư mục dự án. Các file `backend/*.backup-*.gs` (còn token) đã nằm trong `.gitignore`, đừng đổi tên chúng.

### 8b. Cập nhật làm hệ thống lỗi → quay lại bản trước

**Cách chính (quay lại hẳn, cả web + CRM + Apps Script):**
- Nhắn Claude *"quay lại bản trước"* (hoặc nêu thay đổi cần bỏ). Claude `git revert` trên GitHub → ~2 phút sau tự về bản cũ. Dùng được cho thay đổi từ Mac lẫn điện thoại.
- Hoặc tự làm với thay đổi có Pull Request: mở trang PR → **Revert** → GitHub tạo PR mới → **Merge pull request**.
- Thay đổi đẩy thẳng từ Mac (không có PR): nhờ Claude, hoặc trên Mac `git revert <mã commit>` rồi chạy `deploy-github.sh`.

**Cấp cứu tức thì (vài giây), khi chưa kịp revert:**
- *Web / CRM lỗi giao diện:* Cloudflare → Workers & Pages → `thucduonglanh` (web) hoặc `thucduonglanh-crm` (CRM) → Deployments → bản cũ chạy tốt → **Rollback to this deployment**.
- *Nhận đơn / CRM báo lỗi máy chủ:* Apps Script → Triển khai → Quản lý các bản triển khai → ✏️ → chọn **phiên bản cũ** (số phiên bản + mô tả commit hiện trong danh sách; vd 45 = bản sinh nhật 06/10/2026) → Triển khai.
- Đây chỉ là tạm: lần đăng sau sẽ đưa code lỗi lên lại, và **lịch chạy (tin 8h, tự nhập file sale…) luôn chạy code mới nhất**, không theo phiên bản triển khai. Sau khi cấp cứu vẫn phải revert trên GitHub.

**Dữ liệu trong Sheet bị hỏng** (quay code không khôi phục dữ liệu): mở Sheet → Tệp → Lịch sử phiên bản → Xem lịch sử phiên bản → chọn thời điểm trước lỗi → **Khôi phục phiên bản này**. Cột mới do bản cập nhật thêm vào (vd "Ngày sinh") để nguyên không sao.

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

**Kênh đơn & hoa hồng đơn web (api/ + CRM, 09/10/2026)**: CRM `isWebOrder` = mã `TDL…` và Nguồn không bắt đầu bằng Nhập tay / Tiềm năng / File; `webSrc` lấy phần đầu cột Nguồn (Facebook / Google / TikTok / Zalo / Vào thẳng web…). Đơn hàng → Tất cả đơn có chip kênh (`f.ch`: web / sale). BCDT: mục *Theo kênh đơn*; đơn web không vào 4 loại đơn mà tính theo `commission['Đơn web']`. api/ lưu `commission_cfg` trong kv (action `settings` với `commission`, khoá `COMM_KEYS`, để trống = ''), `crmLoad` gửi `rules.commission`. Trước bản này api/ chưa port phần lưu % hoa hồng (bấm Lưu không giữ được).
