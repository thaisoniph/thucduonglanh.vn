# Website Thực Dưỡng Lành – Hướng dẫn kỹ thuật

Web: https://thucduonglanh.vn · Quản trị: https://thucduonglanh.vn/admin/ · Kho mã: https://github.com/thaisoniph/thucduonglanh.vn

## Cách hệ thống hoạt động

```
Nhân sự sửa ở /admin  →  lưu vào GitHub (content/, data/)  →  GitHub Actions chạy build.py  →  đăng lên Cloudflare Pages  →  web cập nhật sau ~1 phút
```

Hướng dẫn cho nhân sự: Google Docs "Hướng dẫn cập nhật website thucduonglanh.vn (dành cho nhân sự)".

## Cấu trúc

```
website/
├── admin/                 ← trang quản trị (Sveltia CMS): index.html + config.yml
├── content/
│   ├── products/*.json    ← mỗi sản phẩm 1 file (tên file = đường link)
│   ├── posts/*.md         ← bài viết Góc Sống Lành
│   └── pages/*.md         ← trang chính sách
├── data/
│   ├── site.json          ← liên hệ, mạng xã hội, ngân hàng, kênh cộng đồng
│   ├── home.json          ← slider trang chủ
│   ├── categories.json    ← danh mục sản phẩm
│   ├── post-categories.json
│   └── config.json        ← kỹ thuật: tên miền, link nhận đơn (không có trong trang quản trị)
├── assets/                ← CSS, JS, ảnh, video; ảnh tải lên từ /admin nằm ở assets/uploads/
├── build.py               ← sinh web vào dist/ (tự nén ảnh sang WebP)
├── .github/workflows/deploy.yml  ← tự build + đăng khi có thay đổi
└── backend/google-apps-script.gs ← code nhận đơn (CHỈ Ở MÁY, không đưa lên GitHub vì có mã Telegram)
```

## Cấp quyền cho nhân sự

1. Nhân sự tạo tài khoản GitHub và gửi tên đăng nhập.
2. Vào https://github.com/thaisoniph/thucduonglanh.vn/settings/access → **Add people**, nhập tên đăng nhập, chọn quyền **Write**.
3. Nhân sự chấp nhận lời mời trong email, tạo token (quyền `public_repo`) theo hướng dẫn và đăng nhập /admin.
4. Nghỉ việc: vào lại trang trên, bấm **Remove** để thu hồi quyền.

## Xem thử trên máy & sửa giao diện

```bash
cd website
python3 -m pip install --user -r requirements.txt   # lần đầu
python3 build.py && (cd dist && python3 -m http.server 8000)   # mở http://localhost:8000
```

Đẩy thay đổi giao diện lên (cần token quyền `repo` + `workflow`):
`GH_TOKEN=ghp_xxx ./deploy-github.sh "ghi chú"` — script tự lấy các thay đổi nhân sự đã làm trước khi đẩy.

## Nhận đơn hàng

- Web gửi đơn tới Google Apps Script (link trong `data/config.json` → `order_endpoint`).
- Apps Script ghi vào Google Sheet "Đơn hàng website Thực Dưỡng Lành", gửi email tới vitagreennutrition@gmail.com và báo vào nhóm Telegram "Đơn hàng Thực Dưỡng Lành" (bot @thucduonglanh_donhang_bot).
- Thêm/bớt người nhận báo đơn: thêm/xoá thành viên trong nhóm Telegram.
- Sửa code Apps Script xong phải: Triển khai → Quản lý các bản triển khai → ✏️ → Phiên bản mới → Triển khai.

## Đo lường & remarketing

- Mã đo lường khai báo trong `data/config.json`: `ga4_id` (Google Analytics 4, dạng G-XXXX), `clarity_id` (Microsoft Clarity), `meta_pixel`, `tiktok_pixel`. Để trống = không bật.
- Công cụ chỉ chạy **sau khi khách bấm "Đồng ý"** ở thông báo cookie (Nghị định 13/2023).
- Sự kiện gửi đi: `view_item`, `add_to_cart`, `begin_checkout`, `purchase` (kèm doanh thu), `upsell_add`, `paste_fill`, `click_call`, `click_zalo`, `view_brochure`, `video_play`, `search`, `generate_lead`.
- Nguồn khách (UTM / fbclid / ttclid / gclid / trang giới thiệu) lưu 30 ngày và ghi vào cột **Nguồn** của đơn hàng.
- Tạo link theo dõi cho bài đăng/quảng cáo: **https://thucduonglanh.vn/admin/utm.html**

## CRM chăm sóc khách hàng (Google Sheet)

- Trang **Khách hàng**: tự cập nhật theo SĐT mỗi khi có đơn – số đơn, tổng chi, đơn gần nhất, sản phẩm đã mua, **Dự kiến hết hàng**, **Nhóm** (Mới / Quay lại / VIP / Sắp mất), đồng ý nhận tin, nguồn đầu tiên. Nhân viên điền: Phụ trách, Lần CSKH gần nhất, Kết quả CSKH, Ghi chú CSKH.
- Trang **Chu kỳ dùng**: số ngày dùng hết 1 đơn vị sản phẩm – chỉnh để ngày "Dự kiến hết hàng" chính xác hơn.
- Trang **Mẫu tin nhắn CSKH**: mẫu Zalo theo từng thời điểm.
- **8h sáng mỗi ngày** nhóm Telegram nhận danh sách: hỏi nhận hàng (D+1), sắp hết sản phẩm, xin cảm nhận (D+14), giới thiệu sản phẩm (D+30), mời quay lại (60 ngày).
- Đơn bị huỷ: ghi "Huỷ" ở cột Trạng thái rồi chạy hàm `rebuildCustomers` để tính lại.

## Tên miền & hosting

- Hosting: **Cloudflare Pages**, dự án `thucduonglanh` (địa chỉ dự phòng https://thucduonglanh.pages.dev). Miễn phí, được phép dùng cho kinh doanh.
- Tên miền vẫn đăng ký/gia hạn ở **Tenten** (hết hạn 22/04/2027), nhưng DNS do **Cloudflare** quản lý (nameserver `liberty.ns.cloudflare.com`, `randy.ns.cloudflare.com`). Mọi thay đổi bản ghi DNS làm trên dash.cloudflare.com, không làm ở Tenten.
- Link phụ (shop, story, family, mkt…) là **Redirect Rules** trong Cloudflare: dash.cloudflare.com → thucduonglanh.vn → Rules → Redirect Rules. Gói miễn phí tối đa 10 quy tắc (đang dùng đủ 10; muốn thêm link phải xoá bớt hoặc chuyển sang Bulk Redirects). Bản sao cấu hình: `backend/cloudflare-redirect-rules.json`.
- Mã Cloudflare cho GitHub Actions lưu ở GitHub → Settings → Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## Việc nên làm

- Khai báo website với Bộ Công Thương (online.gov.vn), sau đó điền link vào `bo_cong_thuong_url` trong `data/config.json` và đặt logo tại `assets/img/brand/bo-cong-thuong.png`.
- Gửi sitemap `https://thucduonglanh.vn/sitemap.xml` lên Google Search Console.
