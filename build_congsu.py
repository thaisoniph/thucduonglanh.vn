"""Trang tuyển dụng congsu.thucduonglanh.vn (22/10/2026), dựng theo mẫu tranvietquan.com/congsu.

Nguồn: congsu/ (style.css, app.js, img/) + content/jobs/*.md (mỗi vị trí 1 file, sửa ở /admin → Tuyển dụng)
+ data/site.json (tên công ty, hotline, email, địa chỉ). Ra thư mục dist-congsu/ (project Cloudflare Pages riêng
thucduonglanh-congsu, workflow deploy-congsu.yml). build.py gọi build_congsu() sau khi dựng CRM.
Hồ sơ ứng tuyển gửi về api.thucduonglanh.vn ({type:'apply'}, api/src/apply.js).
"""
import datetime, hashlib, html, json, re, shutil
from pathlib import Path

import markdown as _md
import yaml

ROOT = Path(__file__).resolve().parent
SRC, OUT = ROOT / "congsu", ROOT / "dist-congsu"
BASE = "https://congsu.thucduonglanh.vn"
HOURS = "Thứ 2 – Thứ 7: 8h00 – 16h45 (nghỉ trưa 12h00 – 13h30)"
esc = lambda s: html.escape(str(s if s is not None else ""), quote=True)


def load_jobs():
    jobs = []
    for f in sorted((ROOT / "content/jobs").glob("*.md")):
        raw = f.read_text("utf-8")
        m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", raw, re.S)
        meta, body = (yaml.safe_load(m.group(1)) or {}, m.group(2)) if m else ({}, raw)
        if meta.get("active") is False:
            continue
        meta["slug"], meta["body"] = f.stem, body
        jobs.append(meta)
    return sorted(jobs, key=lambda j: (j.get("order", 50), j.get("title", "")))


def nw(s):
    """Cụm từ không được ngắt dòng giữa chừng."""
    return f'<span class="nw">{s}</span>'


# ---------------------------------------------------------------- khung trang
def head(title, desc, path, extra=""):
    return f"""<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{BASE}{path}">
<meta property="og:type" content="website"><meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{BASE}{path}"><meta property="og:image" content="{BASE}/img/og.jpg"><meta property="og:locale" content="vi_VN">
<meta name="theme-color" content="#0C5233">
<link rel="icon" href="/icon-32.png" sizes="32x32"><link rel="apple-touch-icon" href="/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&family=Playfair+Display:ital,wght@1,600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css?v=__V__">
{extra}</head>
<body>
<header class="cs-top"><div class="cs-wrap cs-top-in">
<a class="cs-logo" href="/" aria-label="Tuyển dụng Thực Dưỡng Lành"><img src="/logo.webp" alt="Thực Dưỡng Lành" width="85" height="60"></a>
<nav class="cs-nav"><a href="/#ve-chung-toi">Về chúng tôi</a><a href="/#van-hoa">Văn hóa</a><a href="/#vi-tri">Vị trí tuyển</a><a href="/#quy-trinh">Quy trình</a></nav>
<a class="cs-btn cs-btn-sm" href="/#ung-tuyen">Ứng tuyển</a>
</div></header>
"""


def foot(site):
    s, hot = site.get("socials", {}), re.sub(r"\D", "", site.get("hotline", ""))
    links = "".join(f'<a href="{esc(u)}" target="_blank" rel="noopener">{n}</a>' for n, u in
                    [("Website", "https://thucduonglanh.vn"), ("Facebook", s.get("facebook")), ("YouTube", s.get("youtube")), ("TikTok", s.get("tiktok"))] if u)
    return f"""<footer class="cs-foot"><div class="cs-wrap cs-foot-in">
<div><img src="/logo-cream.webp" alt="Thực Dưỡng Lành" width="120" height="85" loading="lazy">
<p class="cs-foot-slogan">{" – ".join(nw(w) for w in ("Sống tử tế", "Làm thật", "Cùng nhau phát triển"))}</p></div>
<div><b>{esc(site.get("company"))}</b><br>Mã số doanh nghiệp: {esc(site.get("tax_code"))}<br>{esc(site.get("address"))}<br>
Hotline / Zalo: <a href="tel:{hot}">{esc(site.get("hotline"))}</a> · Email: <a href="mailto:{esc(site.get("email"))}">{esc(site.get("email"))}</a></div>
<div class="cs-foot-links">{links}</div>
</div><p class="cs-copy">© {datetime.date.today().year} VitaGreen Nutrition – Thực Dưỡng Lành</p></footer>
<script src="/app.js?v=__V__" defer></script>
</body>
</html>
"""


# ---------------------------------------------------------------- trang chính
def tree_svg():
    """Cây giá trị: tán lá = 5 giá trị cốt lõi, rễ = Thân – Tâm – Trí (giống cây nhân cách của trang mẫu)."""
    leaves = [(260, 75, "Tử tế"), (165, 135, "Chính trực"), (360, 135, "Tỉnh thức"), (260, 195, "Yêu thương"), (100, 215, "Biết ơn"),
              (420, 215, "Lan tỏa"), (260, 255, "Thân – Tâm – Trí"), (160, 305, "Kỷ luật"), (360, 305, "Bền vững"), (260, 350, "Học tập")]
    blobs = [(260, 160, 150), (150, 200, 105), (370, 200, 105), (210, 105, 85), (320, 105, 85), (260, 260, 110), (105, 260, 70), (415, 260, 70)]
    g = "".join(f'<circle cx="{x}" cy="{y}" r="{r}"/>' for x, y, r in blobs)
    pills = ""
    for i, (x, y, t) in enumerate(leaves):
        w = 22 + len(t) * 8.6
        cls = "t-p g" if i % 3 == 1 else "t-p"
        pills += f'<g class="{cls}"><rect x="{x - w / 2:.0f}" y="{y - 15}" width="{w:.0f}" height="30" rx="15"/><text x="{x}" y="{y + 5}">{t}</text></g>'
    return f"""<svg class="cs-tree" viewBox="0 0 520 470" role="img" aria-label="Cây giá trị VitaGreen: rễ là Thân – Tâm – Trí, tán là các giá trị sống">
<path class="t-trunk" d="M236 470 C240 410 238 370 222 330 L250 340 C255 300 250 290 245 270 L275 270 C268 300 266 320 272 338 L300 328 C284 372 282 410 286 470 Z"/>
<g class="t-leaf">{g}</g>{pills}
</svg>"""


ICONS = {
    "heart": '<path d="M12 21s-7.5-4.6-9.6-9.2C.8 8.2 3 4.5 6.7 4.5c2.1 0 3.5 1.1 4.3 2.4.8-1.3 2.2-2.4 4.3-2.4 3.7 0 5.9 3.7 4.3 7.3C19.5 16.4 12 21 12 21z"/>',
    "leaf": '<path d="M5 19c8 0 14-6 14-15C10 4 5 9 5 15v4zm0 0c3-5 6-7 10-9"/>',
    "sun": '<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    "people": '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c.6-3.6 2.8-5.5 5.5-5.5s4.9 1.9 5.5 5.5M14 15.2c.9-.5 1.9-.7 3-.7 2.4 0 4.2 1.7 4.6 5"/>',
    "tower": '<path d="M4 21h16M6 21V10l6-6 6 6v11M10 21v-5h4v5"/>',
}


def values_html():
    vals = [
        ("heart", "TỬ TẾ & CHÍNH TRỰC", "Sản phẩm thật, giá trị thật",
         "Chúng tôi chỉ nói điều sản phẩm thật sự làm được, đúng như hồ sơ công bố. Với khách hàng, với đối tác và với nhau, minh bạch là cách duy nhất để đi đường dài."),
        ("leaf", "THÂN – TÂM – TRÍ", "Chăm sóc " + nw("con người toàn diện"),
         "Một người khỏe thật sự cần cơ thể được nuôi dưỡng, tâm được an và trí được mở. Chúng tôi chăm khách hàng như vậy, và chăm chính đội ngũ của mình cũng như vậy."),
        ("sun", "SỐNG TỈNH THỨC", "Biết ơn " + nw("từng ngày bình thường"),
         "Sống chậm lại để thấy, biết ơn để thương. Ăn chay, lễ chùa mùng 1 và rằm, viết lời biết ơn mỗi sáng là những việc nhỏ nhắc chúng tôi nhớ điều gì quan trọng."),
        ("people", "LAN TỎA CỘNG ĐỒNG", " – ".join(nw(w) for w in ("Gắn kết", "chia sẻ", "đồng hành")),
         "Chúng tôi không đợi thành công rồi mới cho đi. Từ chuyến thiện nguyện tới buổi Zoom chia sẻ sức khỏe miễn phí, điều lành được gieo ngay từ hôm nay."),
        ("tower", "PHÁT TRIỂN BỀN VỮNG", "Kiên định với chất lượng",
         "Không chạy theo trào lưu sức khỏe. Chúng tôi chọn nhà máy đạt chuẩn GMP, nguyên liệu rõ nguồn gốc, và lớn lên bằng niềm tin của khách hàng."),
    ]
    return "".join(f"""<article class="cs-val"><span class="cs-val-ic"><svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[ic]}</svg></span>
<span class="cs-tag">{tag}</span><h3>{t}</h3><p>{d}</p></article>""" for ic, tag, t, d in vals)


def life_html():
    cards = [
        ("ĂN CHAY, LỄ CHÙA MÙNG 1 & RẰM", "Không phải nghi lễ, mà là cách nhắc mình sống chậm và biết ơn. Cả đội cùng ăn chay, cùng đi chùa, cùng nghe pháp thoại."),
        ("THIỆN NGUYỆN CÙNG NHAU", "Chúng tôi chọn gieo điều lành ngay từ bây giờ: quyên góp, trao quà và đồng hành cùng những hoàn cảnh khó khăn."),
        ("TRÀ ĐÀM “THỨ 7 MÁU CHẢY VỀ TIM”", "Những buổi trà đàm để cả đội nói thật, nghe thật, chia sẻ cách làm việc và cách sống. Quỹ Văn hóa nội bộ lo trà bánh, sinh nhật và các buổi gắn kết."),
        ("ZOOM SỨC KHỎE TỐI THỨ 5", "Mỗi tối thứ Năm, đội ngũ cùng chuyên gia chia sẻ kiến thức dinh dưỡng cho cộng đồng. Muốn nói đúng cho khách, trước hết mình phải hiểu đúng."),
        ("ÁP SUẤT TẠO KIM CƯƠNG", "Mục tiêu của chúng tôi là 10 triệu người Việt sống khỏe từ Thân đến Tâm. Mục tiêu lớn cần kỷ luật, tốc độ và tinh thần chịu trách nhiệm 100%. Nếu bạn thấy “hơi sợ” nhưng lại “hào hứng”, có lẽ chúng ta hợp nhau."),
        ("LÀM VIỆC CÙNG AI & CÔNG NGHỆ", "Website, CRM, báo cáo quảng cáo tự động đều do chính đội ngũ xây. Ở đây bạn được khuyến khích dùng AI để bớt việc lặp lại, dành thời gian cho việc tạo ra giá trị."),
    ]
    return "".join(f'<article class="cs-life"><h3>{t}</h3><p>{d}</p></article>' for t, d in cards)


RULES = [
    ("Luôn sát cánh cùng đồng đội", "Đi một mình có thể nhanh. Đi cùng đội ngũ mới có thể đi xa."),
    (nw("Đặt mục tiêu chung") + " " + nw("cao hơn cái tôi"), "Cái tôi nhỏ lại, đội ngũ lớn lên."),
    ("Minh bạch " + nw("trong công việc,") + " " + nw("bảo mật trong dữ liệu"), "Rõ ràng tạo ra niềm tin. Bảo mật gìn giữ niềm tin."),
    ("Tạo giá trị " + nw("nhiều hơn") + " mong đợi", "Việc nhỏ làm tử tế tạo nên con người đáng tin."),
    ("Liên tục cải tiến", "Mỗi ngày tốt hơn 1%, một năm sau ta gặp một phiên bản rất khác của chính mình."),
    ("Nhanh, tập trung và hiệu quả", "Đừng chỉ bận rộn. Hãy tạo ra kết quả."),
    ("Nói thẳng với trái tim rộng mở", "Nói thật với thiện chí là xây đội. Nói sau lưng là phá đội."),
    (nw("Chịu trách nhiệm 100%,") + " " + nw("không đổ lỗi"), "Đổ lỗi làm ta yếu đi. Nhận trách nhiệm làm ta lớn lên."),
    (nw("Đã hứa là làm,") + " " + nw("không chắc thì nói rõ"), "Một người giữ lời tạo nên niềm tin. Một đội ngũ giữ lời tạo nên thương hiệu."),
    ("Phát triển " + nw("bản thân") + " mỗi ngày", "Mỗi người tốt hơn, VitaGreen tốt hơn."),
]

STEPS = [
    ("Tìm hiểu sự phù hợp", "Bạn đọc thông tin tuyển dụng và điền bộ câu hỏi “Thấu hiểu chính mình” ở cuối trang."),
    ("Tiếp nhận hồ sơ", "Ban tuyển dụng đọc kỹ từng hồ sơ, chọn những bạn phù hợp cả về tâm thế lẫn yêu cầu công việc."),
    ("Kết nối ban đầu", "Chúng tôi gọi điện hoặc nhắn Zalo trao đổi 15–20 phút, để bạn hiểu VitaGreen và chúng tôi hiểu bạn hơn."),
    ("Kết nối chuyên môn", "Phỏng vấn trực tiếp tại văn phòng với Ban điều hành, có thể kèm một bài kiểm tra ngắn về chuyên môn."),
    ("Phản hồi kết quả", "Kết quả được báo cho bạn trong vòng 5 ngày làm việc sau buổi phỏng vấn."),
    ("Hội nhập & đồng hành", "Bạn nhận Sổ tay Cộng sự, có người kèm cặp trong những tuần đầu để hòa nhập văn hóa và công việc."),
]


def job_rows(jobs):
    return "".join(f"""<article class="cs-job">
<h3><a href="/{j["slug"]}/">{esc(j["title"])}</a></h3>
<div class="cs-job-m"><span>Số lượng</span><b>{esc(j.get("quantity", 1))}</b></div>
<div class="cs-job-m"><span>Địa điểm làm việc</span><b>{esc(j.get("location", "Hà Nội"))}</b></div>
<a class="cs-btn cs-btn-sm cs-btn-gold" href="/{j["slug"]}/">Xem chi tiết</a>
</article>""" for j in jobs)


def form_html(jobs, site):
    opts = "".join(f'<option value="{esc(j["title"])}" data-slug="{j["slug"]}">{esc(j["title"])}</option>' for j in jobs)
    ta = lambda n, q, hint, req=False: f'<label class="cs-f cs-f-full"><span>{q}{" *" if req else ""}</span><small>{hint}</small><textarea name="{n}" rows="3"{" required" if req else ""} maxlength="2000"></textarea></label>'
    return f"""<form class="cs-form" id="cs-form" novalidate data-endpoint="https://api.thucduonglanh.vn/api">
<fieldset><legend>1. Thông tin của bạn</legend><div class="cs-fg">
<label class="cs-f cs-f-full"><span>Vị trí ứng tuyển *</span><select name="job" required><option value="">– Chọn vị trí –</option>{opts}</select></label>
<label class="cs-f"><span>Họ và tên *</span><input name="name" required maxlength="80" autocomplete="name"></label>
<label class="cs-f"><span>Năm sinh</span><input name="birth" inputmode="numeric" maxlength="4" placeholder="VD: 1994"></label>
<label class="cs-f"><span>Số điện thoại (Zalo) *</span><input name="phone" type="tel" required inputmode="tel" autocomplete="tel" placeholder="VD: 0912 345 678"></label>
<label class="cs-f"><span>Email *</span><input name="email" type="email" required autocomplete="email"></label>
<label class="cs-f"><span>Nơi ở hiện tại</span><input name="area" maxlength="120" placeholder="VD: Gia Lâm, Hà Nội"></label>
<label class="cs-f"><span>Kinh nghiệm ở vị trí này</span><select name="exp"><option value="">– Chọn –</option><option>Chưa có</option><option>Dưới 1 năm</option><option>1 – 2 năm</option><option>3 – 5 năm</option><option>Trên 5 năm</option></select></label>
<label class="cs-f"><span>Thu nhập mong muốn</span><input name="salary" maxlength="80" placeholder="VD: 15 – 20 triệu/tháng"></label>
<label class="cs-f"><span>Có thể bắt đầu đi làm từ</span><input name="start" maxlength="80" placeholder="VD: 01/12/2026 hoặc sau 2 tuần"></label>
</div></fieldset>
<fieldset><legend>2. CV của bạn</legend><p class="cs-fnote">Gửi file hoặc dán link, chỉ cần một trong hai.</p><div class="cs-fg">
<label class="cs-f cs-file"><span>Tải file CV</span><small>PDF, Word hoặc ảnh, tối đa 5 MB</small><input name="cv_file" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"></label>
<label class="cs-f"><span>Hoặc link CV</span><small>Google Drive, TopCV, LinkedIn… (nhớ mở quyền xem)</small><input name="cv_link" type="url" maxlength="500" placeholder="https://"></label>
</div></fieldset>
<fieldset><legend>3. Thấu hiểu chính mình</legend><p class="cs-fnote">Không có câu trả lời đúng hay sai, chỉ có câu trả lời thật. Vài dòng là đủ.</p><div class="cs-fg">
{ta("why", "Điều gì khiến bạn muốn đồng hành cùng VitaGreen – Thực Dưỡng Lành?", "Điều bạn thấy đồng điệu trong trang này, hoặc lý do riêng của bạn.", True)}
{ta("hard", "Kể một việc khó nhất bạn từng theo đến cùng. Bạn đã làm gì?", "Công việc hay chuyện đời sống đều được.", True)}
{ta("rules", "Trong 10 Quy tắc Danh dự, quy tắc nào bạn làm tốt nhất, quy tắc nào bạn cần rèn thêm?", "Xem 10 quy tắc ở phần phía trên.")}
{ta("ai", "Bạn đang dùng AI hoặc công cụ số nào trong công việc?", "VD: ChatGPT, Claude, Canva, Excel, phần mềm kế toán…")}
{ta("life", "Lối sống lành của bạn hiện nay thế nào?", "Ăn uống, vận động, nghỉ ngơi. Không bắt buộc.")}
<label class="cs-f"><span>Bạn biết tin tuyển dụng từ đâu?</span><select name="heard"><option value="">– Chọn –</option><option>Facebook</option><option>TikTok</option><option>Website Thực Dưỡng Lành</option><option>Bạn bè / người quen giới thiệu</option><option>Trang tuyển dụng (TopCV, VietnamWorks…)</option><option>Khác</option></select></label>
</div></fieldset>
<label class="cs-consent"><input type="checkbox" name="consent" required> <span>Tôi đồng ý để {esc(site.get("company", "").title().replace("Tnhh", "TNHH"))} lưu và dùng thông tin trên cho việc tuyển dụng, trong tối đa 12 tháng. Tôi có thể yêu cầu xoá bất cứ lúc nào qua email {esc(site.get("email"))}.</span></label>
<input class="cs-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<button class="cs-btn cs-btn-lg" type="submit">GỬI HỒ SƠ ỨNG TUYỂN</button>
<p class="cs-fmsg" role="status" aria-live="polite"></p>
</form>
<div class="cs-done" id="cs-done" hidden><b>🌱 Cảm ơn bạn đã gửi hồ sơ!</b><p>Chúng tôi sẽ đọc kỹ và liên hệ với bạn qua điện thoại hoặc Zalo trong vòng 5 ngày làm việc. Trong lúc chờ, bạn có thể ghé <a href="https://thucduonglanh.vn" target="_blank" rel="noopener">thucduonglanh.vn</a> để hiểu thêm về sản phẩm của chúng tôi.</p></div>"""


def yt_id(url):
    m = re.search(r"(?:youtu\.be/|v=|embed/|shorts/)([\w-]{11})", url or "")
    return m.group(1) if m else ""


def page_home(jobs, site):
    vid = yt_id((site.get("brand_video") or {}).get("youtube", ""))
    video = f"""<button class="cs-video" type="button" data-yt="{vid}" aria-label="Xem video câu chuyện Thực Dưỡng Lành">
<img src="https://i.ytimg.com/vi/{vid}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360"><span class="cs-play" aria-hidden="true"></span>
<span class="cs-video-cap">Câu chuyện đồng hành cùng Thực Dưỡng Lành</span></button>""" if vid else ""
    rules = "".join(f'<li><b>{i}</b><h3>{t}</h3><p>“{q}”</p></li>' for i, (t, q) in enumerate(RULES, 1))
    steps = "".join(f'<li><b>Bước {i}</b><h3>{t}</h3><p>{d}</p></li>' for i, (t, d) in enumerate(STEPS, 1))
    pills = ["TÔI LUÔN SÁT CÁNH CÙNG ĐỒNG ĐỘI", "TÔI ĐÃ HỨA LÀ LÀM", "TÔI CHỊU TRÁCH NHIỆM 100%", "TÔI NÓI THẲNG " + nw("VỚI TRÁI TIM RỘNG MỞ"), "TÔI TỐT HƠN MỖI NGÀY"]
    photos = [("du-xuan", "Du xuân đầu năm cùng cả đội"), ("le-chua", "Lễ chùa mùng 1 và rằm"), ("nghe-phap", "Nghe pháp thoại"),
              ("thien-nguyen", "Trao quà thiện nguyện tại văn phòng"), ("zoom-thu-5", "Zoom chia sẻ sức khỏe tối thứ Năm")]
    slides = "".join(f'<figure><img src="/img/{f}.webp" alt="{c}" loading="lazy" width="560" height="420"><figcaption>{c}</figcaption></figure>' for f, c in photos)
    hot = re.sub(r"\D", "", site.get("hotline", ""))
    ld = {"@context": "https://schema.org", "@type": "Organization", "name": "VitaGreen Nutrition – Thực Dưỡng Lành", "legalName": site.get("company"),
          "url": "https://thucduonglanh.vn", "logo": "https://thucduonglanh.vn/assets/img/brand/icon-512.png", "email": site.get("email"), "telephone": site.get("hotline")}
    return head("Tuyển dụng – Tìm cộng sự cùng chí hướng | Thực Dưỡng Lành",
                "VitaGreen Nutrition – Thực Dưỡng Lành tìm cộng sự: " + ", ".join(j["title"] for j in jobs) + ". Cùng nhau giúp 10 triệu người Việt sống khỏe từ Thân đến Tâm.", "/",
                f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>\n') + f"""
<main>
<section class="cs-hero">
<div class="cs-wrap">
<h1>TÌM CỘNG SỰ <em>CÙNG CHÍ HƯỚNG</em></h1>
<p class="cs-hero-l1">{", ".join(nw("Cùng <b>" + w + "</b>" if i == 0 else "cùng <b>" + w + "</b>") for i, w in enumerate(("sống lành", "làm thật", "rèn luyện", "cống hiến")))}</p>
<p class="cs-hero-l2">TRONG HẠNH PHÚC!</p>
<svg class="cs-swoosh" viewBox="0 0 120 10" aria-hidden="true"><path d="M2 7 C30 1 80 1 118 6"/></svg>
<p class="cs-hero-l3">Xây dựng <b>Thực Dưỡng Lành</b><br>Để {nw("<b>10 triệu người Việt</b>")} {nw("sống khỏe từ <b>THÂN</b> đến <b>TÂM</b>")}</p>
<div class="cs-hero-btns"><a class="cs-btn cs-btn-ghost" href="#ve-chung-toi">Về chúng tôi</a><a class="cs-btn cs-btn-ghost" href="#van-hoa">Văn hóa VitaGreen</a><a class="cs-btn cs-btn-gold" href="#vi-tri">Các vị trí tìm cộng sự</a></div>
<p class="cs-hero-jobs">{" / ".join(esc(j["title"]) for j in jobs)}</p>
<div class="cs-collage" aria-hidden="true">
<img class="c1" src="/img/le-chua.webp" alt="" width="420" height="315"><img class="c2" src="/img/du-xuan.webp" alt="" width="560" height="420" fetchpriority="high"><img class="c3" src="/img/thien-nguyen.webp" alt="" width="420" height="315">
<span class="cs-heart h1"></span><span class="cs-heart h2"></span><span class="cs-heart h3"></span>
</div>
</div>
</section>
<div class="cs-band"><p>Từ một bữa ăn lành, {nw("ta có thể hồi sinh cả một đời sống")}<br><small>Chúng tôi không tuyển nhân viên. {nw("Chúng tôi tìm những người cùng mơ.")}</small></p></div>

<section class="cs-sec" id="ve-chung-toi">
<div class="cs-wrap"><div class="cs-believe">
<div class="cs-believe-txt">
<h2>ĐIỀU CHÚNG TÔI<br><em>TIN TƯỞNG</em></h2>
<p class="cs-hi">Chào bạn,</p>
<p>Giữa một thời đại mà đồ ăn ngày càng nhanh, niềm tin ngày càng mỏng, chúng tôi chọn mơ một giấc mơ ngược dòng: một ngày nào đó, <em class="hl">10 triệu người Việt sẽ sống khỏe từ THÂN đến TÂM</em>, bắt đầu từ điều giản dị nhất là một bữa ăn lành.</p>
<p>Chúng tôi tin <em class="hl">thực phẩm không phải là hàng hóa, nó là một lời hứa</em>. Chúng tôi tin kinh doanh tử tế không phải là ngây thơ, đó là con đường duy nhất đáng đi đường dài. Một công ty đáng tự hào không đo bằng doanh thu, mà đo bằng <em class="hl">số cuộc đời nó chạm đến</em>.</p>
<p>Nếu bạn chỉ cần một chỗ làm để nhận lương mỗi tháng, nơi này có lẽ không dành cho bạn, và điều đó không sao cả. Nhưng nếu bạn từng xót xa khi người mình thương ăn không lành, sống không khỏe; nếu bạn tin những việc nhỏ làm tử tế mỗi ngày có thể thay đổi cả một cộng đồng, thì bạn đã ở đúng nơi rồi.</p>
<p class="cs-sign">VITAGREEN – THỰC DƯỠNG LÀNH</p>
</div>
<figure class="cs-believe-img"><img src="/img/doi-ngu.webp" alt="Đội ngũ VitaGreen Nutrition – Thực Dưỡng Lành" loading="lazy" width="1100" height="849"></figure>
</div></div>
</section>

<section class="cs-sec cs-together">
<div class="cs-wrap">
<h2 class="cs-h2">BẠN CÓ CÙNG ĐỒNG HÀNH?</h2>
<p class="cs-lead">Nếu bạn quyết định gia nhập, chúng ta là một <b>GIA ĐÌNH</b>. Chúng tôi muốn bạn nhìn thật rõ chân dung của chúng tôi, và thấy mình có những điểm chung nào trong đó:</p>
<svg class="cs-swoosh" viewBox="0 0 120 10" aria-hidden="true"><path d="M2 7 C30 1 80 1 118 6"/></svg>
<div class="cs-vm">
<div class="cs-vm-cards">
<article><h3>TẦM NHÌN</h3><p>Trở thành hệ sinh thái sản phẩm thực dưỡng uy tín hàng đầu Việt Nam, một biểu tượng được tin chọn trong từng gia đình, giúp người Việt sống khỏe từ THÂN đến TÂM.</p></article>
<article><h3>SỨ MỆNH</h3><p>Truyền cảm hứng về một lối sống lành mạnh, tỉnh thức, đầy yêu thương. Hướng tới hành trình giúp 10 triệu người Việt sống khỏe, để mỗi bữa ăn là một lần trở về với chính mình.</p></article>
<article><h3>TRIẾT LÝ</h3><p><b>Sống xanh – Sống lành – Sống có giá trị.</b> Thân được nuôi dưỡng, Tâm được an, Trí được mở là gốc rễ của một đời sống khỏe. Gốc vững thì cây mới bền và cho trái ngọt.</p></article>
</div>
{tree_svg()}
</div>
</div>
<div class="cs-soil"><span>THÂN<small>Dinh dưỡng</small></span><span>TÂM<small>Tinh thần</small></span><span>TRÍ<small>Nhận thức</small></span></div>
</section>

<section class="cs-sec cs-values" id="van-hoa">
<div class="cs-wrap">
<div class="cs-values-head">
<div><h2>HỆ GIÁ TRỊ<br>CỐT LÕI</h2><p>Khi bạn quyết định đồng hành cùng chúng tôi, bạn là một thành viên của ngôi nhà này. Hãy cùng nhau xây dựng và nuôi lớn những phẩm chất chung dưới đây nhé.</p></div>
{video}
</div>
<div class="cs-vals">{values_html()}</div>
</div>
</section>

<section class="cs-sec cs-lifesec">
<div class="cs-wrap">
<h2 class="cs-h2">SỐNG & LÀM VIỆC<br><em>HẠNH PHÚC – HIỆU QUẢ – Ý NGHĨA</em></h2>
<div class="cs-slider"><button class="cs-sl-btn prev" type="button" aria-label="Ảnh trước">‹</button><div class="cs-slides">{slides}</div><button class="cs-sl-btn next" type="button" aria-label="Ảnh tiếp">›</button></div>
<div class="cs-lifes">{life_html()}</div>
</div>
</section>

<section class="cs-sec cs-home">
<div class="cs-wrap cs-home-in">
<div>
<h2>CON NGƯỜI PHÙ HỢP<br><em>NGƯỜI VITAGREEN</em></h2>
<blockquote>“Tài sản quý giá nhất của một doanh nghiệp không phải là con người, mà là con người phù hợp.”<cite>Jim Collins, Từ tốt đến vĩ đại</cite></blockquote>
<p>Ở VitaGreen, “phù hợp” không nằm ở bằng cấp hay số năm kinh nghiệm. Chúng tôi tin <b>thái độ quan trọng hơn trình độ</b>: trình độ có thể đào tạo, còn thái độ là lựa chọn mỗi người tự đưa ra mỗi ngày.</p>
</div>
<ul class="cs-fit">
<li><b>Chủ động</b>Thấy việc là làm, không đợi nhắc, không chờ giao.</li>
<li><b>Ham học hỏi</b>Chưa biết thì hỏi, học xong thì áp dụng và chia sẻ lại.</li>
<li><b>Cầu tiến</b>Không so mình với người khác, chỉ so với chính mình hôm qua.</li>
<li><b>Chịu trách nhiệm 100%</b>Hỏi “phần của mình trong việc này là gì?” trước khi hỏi “lỗi của ai?”.</li>
</ul>
</div>
</section>

<section class="cs-sec cs-rules">
<div class="cs-wrap">
<div class="cs-rules-head"><span class="cs-line"></span><h2>10 QUY TẮC DANH DỰ<br>NGƯỜI VITAGREEN</h2><p class="cs-chip">{" – ".join(nw(w) for w in ("Sống tử tế", "Làm thật", "Cùng nhau phát triển"))}</p></div>
<ol class="cs-rule-grid">{rules}</ol>
<details class="cs-poster"><summary>Xem bảng 10 Quy tắc Danh dự đầy đủ</summary><img src="/img/10-quy-tac.webp" alt="Bảng 10 Quy tắc Danh dự Người VitaGreen" loading="lazy" width="1448" height="1086"></details>
</div>
</section>

<section class="cs-promise">
<div class="cs-wrap"><h2>5 LỜI HỨA CỦA NGƯỜI VITAGREEN</h2>
<ul>{"".join(f"<li>{p}</li>" for p in pills)}</ul></div>
</section>

<section class="cs-sec cs-jobsec" id="vi-tri">
<div class="cs-wrap"><div class="cs-jobbox">
<h2>TRỞ THÀNH ĐỒNG ĐỘI CÙNG VITAGREEN</h2>
<p class="cs-lead">Chúng tôi đang tìm kiếm những cộng sự cùng chí hướng</p>
<div class="cs-jobs">{job_rows(jobs)}</div>
<div class="cs-jobs-cta"><a class="cs-btn cs-btn-lg" href="#ung-tuyen">ỨNG TUYỂN NGAY</a>
<p>Liên hệ hỗ trợ: Hotline / Zalo <a href="tel:{hot}"><b>{esc(site.get("hotline"))}</b></a><br>Hoặc email <a href="mailto:{esc(site.get("email"))}">{esc(site.get("email"))}</a></p></div>
</div></div>
</section>

<div class="cs-band cs-band-2"><p>Cùng nhau giúp <b>10 triệu người Việt</b><br><small>{nw("SỐNG KHỎE TỪ THÂN ĐẾN TÂM")}</small></p></div>

<section class="cs-sec cs-steps" id="quy-trinh">
<div class="cs-wrap"><h2 class="cs-h2">QUY TRÌNH <em>TUYỂN DỤNG</em></h2><ol>{steps}</ol></div>
</section>

<section class="cs-sec cs-apply" id="ung-tuyen">
<div class="cs-wrap cs-apply-in">
<div class="cs-apply-head"><h2>ỨNG TUYỂN VÀ ĐIỀN FORM<br><em>THẤU HIỂU CHÍNH MÌNH</em></h2>
<p>Bạn là người chủ động, trung thực, thích thử thách và muốn công việc của mình có ý nghĩa? Hãy dành khoảng 10 phút trả lời thật lòng những câu hỏi dưới đây.</p></div>
{form_html(jobs, site)}
</div>
</section>
</main>
""" + foot(site)


# ---------------------------------------------------------------- trang chi tiết vị trí
CARD_IC = {
    "salary": '<circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.6-1-1.7-1.5-3-1.5-1.8 0-3 .9-3 2.3 0 3.2 6 1.6 6 4.8 0 1.4-1.3 2.4-3 2.4-1.4 0-2.6-.6-3.2-1.6M12 5.5V7m0 10v1.5"/>',
    "qty": '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.5 16.5c.5-1.6 1.9-2.5 3.5-2.5s3 .9 3.5 2.5M14 10h4M14 13.5h4"/>',
    "type": '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4M8.5 14.5l2.3 2.3 4.7-4.6"/>',
    "deadline": '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/>',
    "loc": '<path d="M3 11 12 3l9 8M5 9.5V21h14V9.5"/>',
}


def info_item(ic, label, val):
    return f'<div class="cs-info-i"><svg viewBox="0 0 24 24" aria-hidden="true">{CARD_IC[ic]}</svg><span>{label}</span><b>{esc(val)}</b></div>'


def page_job(j, prev, nxt, site):
    body = _md.markdown(j["body"], extensions=["extra", "sane_lists"])
    hot = re.sub(r"\D", "", site.get("hotline", ""))
    place = f"""<h2>5. Địa điểm & thời gian làm việc</h2>
<h3>Địa điểm</h3><p>👉 {esc(site.get("address"))} <a href="https://www.google.com/maps/search/?api=1&query={esc(site.get("address"))}" target="_blank" rel="noopener">(Xem bản đồ)</a></p>
<h3>Thời gian làm việc</h3><ul><li>{HOURS}</li><li>Thứ 7 có thể về lúc 16h00 nếu đã xong việc</li></ul>
<h3>Thông tin liên hệ</h3><ul><li>Hotline / Zalo: <a href="tel:{hot}">{esc(site.get("hotline"))}</a></li><li>Email: <a href="mailto:{esc(site.get("email"))}">{esc(site.get("email"))}</a></li></ul>"""
    nav = (f'<a class="cs-pn" href="/{prev["slug"]}/">‹ {esc(prev["title"])}</a>' if prev else "<span></span>") + \
          (f'<a class="cs-pn" href="/{nxt["slug"]}/">{esc(nxt["title"])} ›</a>' if nxt else "<span></span>")
    date = str(j.get("date") or datetime.date.today().isoformat())
    ld = {"@context": "https://schema.org", "@type": "JobPosting", "title": j["title"], "datePosted": date,
          "description": (f'<p>{esc(j.get("headline", ""))}</p>' + body)[:8000], "employmentType": "FULL_TIME", "directApply": True,
          "hiringOrganization": {"@type": "Organization", "name": "VitaGreen Nutrition – Thực Dưỡng Lành", "sameAs": "https://thucduonglanh.vn", "logo": "https://thucduonglanh.vn/assets/img/brand/icon-512.png"},
          "jobLocation": {"@type": "Place", "address": {"@type": "PostalAddress", "streetAddress": "HA10-SP8A-15, Đường Hải Âu 8A, KĐT Vinhomes Ocean Park",
                                                         "addressLocality": "Gia Lâm", "addressRegion": "Hà Nội", "addressCountry": "VN"}},
          "totalJobOpenings": j.get("quantity", 1)}
    if re.match(r"\d{4}-\d{2}-\d{2}$", str(j.get("valid_through") or "")):
        ld["validThrough"] = str(j["valid_through"]) + "T23:59:59+07:00"
    title = j["title"]
    return head(f"Tuyển {title} | VitaGreen – Thực Dưỡng Lành", f"Tuyển {title} tại {j.get('location', 'Hà Nội')}. {j.get('headline', '')}", f"/{j['slug']}/",
                f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>\n') + f"""
<main class="cs-jd">
<section class="cs-jd-hero"><div class="cs-wrap">
<a class="cs-back" href="/#vi-tri">‹ Quay lại</a>
<div class="cs-info">
<span class="cs-info-k">Vị trí:</span><h1>{esc(title)}</h1>
<div class="cs-info-g">{info_item("salary", "Mức lương", j.get("salary", "Thỏa thuận"))}{info_item("qty", "Số lượng tuyển", j.get("quantity", 1))}
{info_item("type", "Hình thức làm việc", j.get("work_type", "Toàn thời gian"))}{info_item("deadline", "Hạn ứng tuyển", j.get("deadline", "Đến khi tuyển đủ"))}
{info_item("loc", "Địa điểm", j.get("location", "Hà Nội"))}</div>
</div>
</div></section>
<div class="cs-wrap cs-jd-body">
{f'<p class="cs-jd-hook">🧭 {esc(j["headline"]).upper()}</p>' if j.get("headline") else ""}
{f'<p class="cs-jd-quote">“{esc(j["quote"])}”</p>' if j.get("quote") else ""}
{body}
{place}
<div class="cs-jd-apply">
<div><h2>ỨNG TUYỂN VÀ ĐIỀN FORM<br>THẤU HIỂU {nw("CHÍNH MÌNH TẠI ĐÂY")}</h2>
<p>Bạn là người chủ động, trung thực, thích thử thách và muốn công việc của mình có ý nghĩa? Bấm nút bên dưới, chọn sẵn vị trí {esc(title)}.</p>
<a class="cs-btn cs-btn-lg" href="/?vi-tri={j["slug"]}#ung-tuyen">ỨNG TUYỂN NGAY</a></div>
<img src="/img/doi-ngu.webp" alt="" loading="lazy" width="1100" height="849">
</div>
</div>
<nav class="cs-pnav"><div class="cs-wrap">{nav}</div></nav>
</main>
""" + foot(site)


# ---------------------------------------------------------------- dựng
def build_congsu():
    if not SRC.exists():
        return
    site = json.loads((ROOT / "data/site.json").read_text("utf-8"))
    jobs = load_jobs()
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(SRC / "img", OUT / "img")
    css = (SRC / "style.css").read_text("utf-8")
    css = re.sub(r"/\*[\s\S]*?\*/", "", css)
    css = re.sub(r"\s+", " ", css)
    css = re.sub(r"\s*([\{\};,>~])\s*", r"\1", css).replace(";}", "}").strip()
    js = (SRC / "app.js").read_text("utf-8")
    try:
        import rjsmin
        js = rjsmin.jsmin(js)
    except Exception:
        pass
    (OUT / "style.css").write_text(css, "utf-8")
    (OUT / "app.js").write_text(js, "utf-8")
    ver = hashlib.md5((css + js).encode("utf-8")).hexdigest()[:8]
    brand = ROOT / "assets/img/brand"
    for f in ("logo.webp", "logo-cream.webp", "icon-32.png", "icon-180.png"):
        shutil.copy(brand / f, OUT / f)
    from PIL import Image  # ảnh chia sẻ Facebook / Zalo 1200×630 từ ảnh du xuân
    im = Image.open(SRC / "img/du-xuan.webp").convert("RGB")
    h = round(im.width * 630 / 1200)
    im.crop((0, (im.height - h) // 2, im.width, (im.height - h) // 2 + h)).resize((1200, 630)).save(OUT / "img/og.jpg", quality=82)

    pages = {"/": page_home(jobs, site)}
    for i, j in enumerate(jobs):
        pages[f"/{j['slug']}/"] = page_job(j, jobs[i - 1] if i else None, jobs[i + 1] if i + 1 < len(jobs) else None, site)
    for path, doc in pages.items():
        d = OUT / path.strip("/")
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(doc.replace("__V__", ver), "utf-8")
    today = datetime.date.today().isoformat()
    (OUT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                                     + "".join(f"<url><loc>{BASE}{p}</loc><lastmod>{today}</lastmod></url>" for p in pages) + "</urlset>\n", "utf-8")
    (OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {BASE}/sitemap.xml\n", "utf-8")
    (OUT / "_headers").write_text(
        "/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: SAMEORIGIN\n  Referrer-Policy: strict-origin-when-cross-origin\n"
        "  Content-Security-Policy: default-src 'self'; connect-src 'self' https://api.thucduonglanh.vn; img-src 'self' data: https://i.ytimg.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; "
        "frame-src https://www.youtube-nocookie.com; base-uri 'none'; form-action 'none'\n"
        "/style.css\n  Cache-Control: public, max-age=31536000, immutable\n/app.js\n  Cache-Control: public, max-age=31536000, immutable\n"
        "/img/*\n  Cache-Control: public, max-age=604800\n", "utf-8")
    (OUT / "404.html").write_text(head("Không tìm thấy trang | Tuyển dụng Thực Dưỡng Lành", "", "/404")
                                  .replace("__V__", ver) + '<main class="cs-wrap cs-404"><h1>Không tìm thấy trang</h1><p>Vị trí này có thể đã tuyển đủ.</p><a class="cs-btn" href="/#vi-tri">Xem các vị trí đang tuyển</a></main>'
                                  + foot(site).replace("__V__", ver), "utf-8")
    print(f"Đã tạo trang tuyển dụng vào {OUT} ({len(jobs)} vị trí)")


if __name__ == "__main__":
    build_congsu()
