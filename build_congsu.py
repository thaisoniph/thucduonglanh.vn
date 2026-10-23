"""Trang tuyển dụng congsu.thucduonglanh.vn (22/10/2026), gộp điểm hay của tranvietquan.com/congsu và bke.edu.vn/nskt2026.

Trang chính kể như một câu chuyện, chia chương: câu chuyện ra đời → lời tâm sự → chúng tôi là ai (cây Thân – Tâm – Trí)
→ giá trị cốt lõi → một tuần ở VitaGreen → làm thật → nói thật trước khi quyết định → ai phù hợp / chưa phù hợp
→ 10 quy tắc + 5 lời hứa → vị trí → quy trình → form ứng tuyển nhiều bước có bộ câu hỏi lọc (api/src/apply-quiz.js, máy chủ chấm điểm).

Nguồn: congsu/ (style.css, app.js, img/) + content/jobs/*.md (mỗi vị trí 1 file, sửa ở /admin → Tuyển dụng)
+ data/site.json (tên công ty, hotline, email, địa chỉ) + api/src/apply-quiz.js. Ra thư mục dist-congsu/ (project Cloudflare Pages
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


def load_quiz():
    s = (ROOT / "api/src/apply-quiz.js").read_text("utf-8")
    return json.loads(s[s.index("export default ") + 15:].rstrip().rstrip(";"))


def nw(s):
    """Cụm từ không được ngắt dòng giữa chừng."""
    return f'<span class="nw">{s}</span>'


def eyebrow(n, t):
    return f'<p class="cs-eyebrow"><span>Chương {n}</span>{t}</p>'


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
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&family=Playfair+Display:ital,wght@1,500;1,600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css?v=__V__">
<script>document.documentElement.classList.add('js')</script>
{extra}</head>
<body>
<div class="cs-progress" aria-hidden="true"><i></i></div>
<header class="cs-top"><div class="cs-wrap cs-top-in">
<a class="cs-logo" href="/" aria-label="Tuyển dụng Thực Dưỡng Lành"><img src="/logo.webp" alt="Thực Dưỡng Lành" width="85" height="60"></a>
<nav class="cs-nav"><a href="/#cau-chuyen">Câu chuyện</a><a href="/#van-hoa">Văn hóa</a><a href="/#phu-hop">Ai phù hợp</a><a href="/#vi-tri">Vị trí tuyển</a><a href="/#quy-trinh">Quy trình</a></nav>
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


# ---------------------------------------------------------------- cây Thân – Tâm – Trí
def tree_svg():
    """Tán lá = các giá trị sống, thân cây nối xuống đất, 3 rễ mọc từ gốc tới 3 bảng THÂN – TÂM – TRÍ (cân với tán ở trên)."""
    cx = 280
    leaves = [(0, 75, "Tử tế"), (-95, 135, "Chính trực"), (100, 135, "Tỉnh thức"), (0, 195, "Yêu thương"), (-160, 215, "Biết ơn"),
              (160, 215, "Lan tỏa"), (0, 255, "Thân – Tâm – Trí"), (-100, 305, "Kỷ luật"), (100, 305, "Bền vững"), (0, 350, "Học tập")]
    blobs = [(0, 160, 150), (-110, 200, 105), (110, 200, 105), (-50, 105, 85), (60, 105, 85), (0, 260, 110), (-155, 260, 70), (155, 260, 70)]
    g = "".join(f'<circle cx="{cx + x}" cy="{y}" r="{r}"/>' for x, y, r in blobs)
    pills = ""
    for i, (x, y, t) in enumerate(leaves):
        w = 22 + len(t) * 8.6
        cls = "t-p g" if i % 3 == 1 else "t-p"
        pills += f'<g class="{cls}"><rect x="{cx + x - w / 2:.0f}" y="{y - 15}" width="{w:.0f}" height="30" rx="15"/><text x="{cx + x}" y="{y + 5}">{t}</text></g>'
    roots = [("THÂN", "Dinh dưỡng", 120, 590), ("TÂM", "Tinh thần", 280, 612), ("TRÍ", "Nhận thức", 440, 590)]
    badges = "".join(f'<g class="t-b"><rect x="{x - 62}" y="{y - 34}" width="124" height="68" rx="16"/><text class="t-b1" x="{x}" y="{y + 2}">{t}</text>'
                     f'<text class="t-b2" x="{x}" y="{y + 22}">{s.upper()}</text></g>' for t, s, x, y in roots)
    return f"""<svg class="cs-tree" viewBox="0 0 560 660" role="img" aria-label="Cây giá trị VitaGreen: tán lá là các giá trị sống, ba rễ là Thân – Tâm – Trí">
<defs><linearGradient id="soil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8A5A33"/><stop offset="1" stop-color="#C7925A"/></linearGradient></defs>
<path class="t-trunk" d="M245 470 C250 410 248 365 232 322 L262 332 C266 300 262 290 258 270 L302 270 C296 290 293 300 298 332 L328 322 C312 365 310 410 315 470 Z"/>
<g class="t-leaf">{g}</g>{pills}
<path class="t-soil" d="M14 462 C110 448 200 466 280 456 C360 446 450 466 546 452 L546 632 Q546 656 522 656 L38 656 Q14 656 14 632 Z" fill="url(#soil)"/>
<path class="t-grass" d="M40 458 l6-14 4 13 M96 452 l5-12 5 12 M180 460 l4-12 5 12 M372 452 l5-13 4 12 M452 460 l6-13 4 12 M506 455 l5-12 5 12"/>
<g class="t-root"><path d="M262 462 C246 500 190 520 130 556"/><path d="M280 462 C281 500 279 540 280 578"/><path d="M298 462 C314 500 370 520 430 556"/></g>
<g class="t-root2"><path d="M214 512 C200 530 196 548 186 566"/><path d="M346 512 C360 530 364 548 374 566"/><path d="M280 520 C262 536 252 548 240 558"/><path d="M280 528 C298 542 306 552 318 562"/></g>
{badges}
</svg>"""


ICONS = {
    "heart": '<path d="M12 21s-7.5-4.6-9.6-9.2C.8 8.2 3 4.5 6.7 4.5c2.1 0 3.5 1.1 4.3 2.4.8-1.3 2.2-2.4 4.3-2.4 3.7 0 5.9 3.7 4.3 7.3C19.5 16.4 12 21 12 21z"/>',
    "leaf": '<path d="M5 19c8 0 14-6 14-15C10 4 5 9 5 15v4zm0 0c3-5 6-7 10-9"/>',
    "sun": '<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    "people": '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c.6-3.6 2.8-5.5 5.5-5.5s4.9 1.9 5.5 5.5M14 15.2c.9-.5 1.9-.7 3-.7 2.4 0 4.2 1.7 4.6 5"/>',
    "tower": '<path d="M4 21h16M6 21V10l6-6 6 6v11M10 21v-5h4v5"/>',
    "check": '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    "x": '<path d="M6 6l12 12M18 6 6 18"/>',
}


def ic(name, cls="cs-ic"):
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>'


def values_html():
    vals = [
        ("heart", "TỬ TẾ & CHÍNH TRỰC", "Sản phẩm thật, giá trị thật",
         "Chúng tôi chỉ nói điều sản phẩm thật sự làm được, đúng như hồ sơ công bố. Với khách hàng, với đối tác và với nhau, minh bạch là cách duy nhất để đi đường dài."),
        ("leaf", "THÂN – TÂM – TRÍ", "Chăm sóc " + nw("con người toàn diện"),
         "Một người khỏe thật sự cần cơ thể được nuôi dưỡng, tâm được an và trí được mở. Chúng tôi chăm khách hàng như vậy, và chăm chính đội ngũ của mình cũng như vậy."),
        ("sun", "SỐNG TỈNH THỨC", "Biết ơn " + nw("từng ngày bình thường"),
         "Sống chậm lại để thấy, biết ơn để thương. Ăn chay, lễ chùa mùng 1 và rằm, viết lời biết ơn mỗi sáng là những việc nhỏ nhắc chúng tôi nhớ điều gì quan trọng."),
        ("people", "LAN TỎA CỘNG ĐỒNG", nw("Gắn kết") + " " + nw("– chia sẻ") + " " + nw("– đồng hành"),
         "Chúng tôi không đợi thành công rồi mới cho đi. Từ chuyến thiện nguyện tới buổi Zoom chia sẻ sức khỏe miễn phí, điều lành được gieo ngay từ hôm nay."),
        ("tower", "PHÁT TRIỂN BỀN VỮNG", "Kiên định với chất lượng",
         "Không chạy theo trào lưu sức khỏe. Chúng tôi chọn nhà máy đạt chuẩn GMP, nguyên liệu rõ nguồn gốc, và lớn lên bằng niềm tin của khách hàng."),
    ]
    return "".join(f"""<article class="cs-val cs-rv"><span class="cs-val-ic">{ic(i)}</span>
<span class="cs-tag">{tag}</span><h3>{t}</h3><p>{d}</p></article>""" for i, tag, t, d in vals)


WEEK = [
    ("Mỗi sáng", "Viết lời biết ơn, uống một ly nước ấm, rồi mới mở máy làm việc."),
    ("Thứ Hai", "Chốt mục tiêu tuần. Ai cũng biết tuần này mình cần tạo ra kết quả gì."),
    ("Thứ Năm", "Cập nhật giữa tuần. Buổi tối, cả đội cùng chuyên gia chia sẻ kiến thức sức khỏe miễn phí qua Zoom cho cộng đồng."),
    ("Thứ Bảy", "Trà đàm “Máu chảy về tim”: nói thật, nghe thật, cùng nhìn lại một tuần đã qua."),
    ("Mùng 1 & Rằm", "Cả đội ăn chay, lễ chùa, nghe pháp thoại. Không phải nghi lễ, mà để nhắc mình sống chậm và biết ơn."),
    ("Những dịp đặc biệt", "Thiện nguyện, du xuân đầu năm, sinh nhật đồng đội. Quỹ Văn hóa nội bộ lo trà bánh và những buổi gắn kết."),
]

PROOF = [
    ("nha-may-gmp", "Tận mắt nhà máy", "Đội ngũ đến tận nhà máy đạt chuẩn GMP, đi qua từng phòng sạch trước khi đưa sản phẩm tới tay khách."),
    ("nha-may-hop", "Ngồi cùng nhà sản xuất", "Làm việc trực tiếp với đối tác sản xuất để hiểu rõ nguyên liệu, quy trình và giấy tờ của từng sản phẩm."),
    ("giai-thuong", "Được ghi nhận", "Tháng 7/2025, VitaGreen nhận chứng nhận Thương hiệu Phát triển Bền vững Quốc gia 2025. Giải thưởng không phải đích đến, mà là lời nhắc làm tốt hơn mỗi ngày."),
]

HONEST = [
    ("Công ty đang lớn nhanh", "Nhiều việc chưa có quy trình sẵn. Bạn sẽ là người cùng xây, không phải người vào chạy theo một guồng có sẵn."),
    ("Mục tiêu cao, số liệu rõ ràng", "Kết quả được đo bằng con số mỗi tuần, không đo bằng việc bạn bận đến đâu."),
    ("Góp ý thẳng thắn", "Ở đây ai cũng được nhắc và có quyền nhắc, kể cả lãnh đạo. Nếu bạn dễ tự ái, những tháng đầu sẽ không dễ."),
    ("Kỷ luật từ việc nhỏ", "Làm tại văn phòng, Thứ 2 – Thứ 7. Đi muộn thì góp Quỹ Văn hóa. Chuyện nhỏ, nhưng chúng tôi giữ nghiêm."),
    ("Sống chậm, làm nhanh", "Chúng tôi ăn chay, đi chùa, uống trà. Nhưng trong giờ làm thì tập trung, nhanh và ra kết quả."),
]

FIT_YES = [
    ("Chủ động", "thấy việc là làm, không đợi nhắc."),
    ("Ham học", "chưa biết thì hỏi, học xong áp dụng và chia sẻ lại."),
    ("Cầu tiến", "chỉ so mình với chính mình hôm qua."),
    ("Chịu trách nhiệm 100%", "hỏi “phần của mình là gì?” trước khi hỏi “lỗi của ai?”."),
    ("Trung thực", "nói thẳng với thiện chí, sai thì nhận."),
    ("Thương sức khỏe", "thật lòng quan tâm tới sống lành, cho mình và người thân."),
]
FIT_NO = [
    ("Chỉ cần chỗ nhận lương", "đi làm cho hết giờ, hết tháng."),
    ("Chờ giao việc", "bảo gì làm nấy, không bảo thì thôi."),
    ("Mắc bệnh “tôi biết rồi”", "ngại học điều mới, ngại thay đổi."),
    ("Tìm lý do", "gặp khó thì đổ lỗi, than phiền."),
    ("Nói sau lưng", "không góp ý trực tiếp, kéo bè kéo nhóm."),
    ("Không tin sản phẩm", "giới thiệu điều mình không tin là thật."),
]

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

PROMISES = [
    ("TRUNG THỰC " + nw("ĐẾN TẬN CÙNG"), "Không gian dối – Không che giấu – Không nói sau lưng", "Báo cáo đúng sự thật, sai thì nói sớm, góp ý trực tiếp với người cần nghe."),
    ("ĐÃ HỨA " + nw("LÀ LÀM"), "Không trì hoãn – Không viện cớ – Không bỏ ngang", "Nhận việc là làm đến nơi đến chốn. Có nguy cơ trễ thì báo trước, không đợi đến hạn."),
    ("CHỊU TRÁCH NHIỆM " + nw("100%"), "Không đổ lỗi – Không đùn đẩy – Không im lặng", "Nhận trách nhiệm trước, giải thích sau. Tập trung vào giải pháp."),
    ("SÁT CÁNH " + nw("CÙNG ĐỒNG ĐỘI"), "Không bỏ mặc – Không nể nang – Không chỉ trích", "Giúp nhau lúc khó, dám nhắc nhau khi đi lệch, khen thật lòng khi bạn làm tốt."),
    ("TỐT HƠN " + nw("MỖI NGÀY"), "Không tự mãn – Không ngại học – Không ngừng cải tiến", "Mỗi ngày học một điều, mỗi tháng có ít nhất một đề xuất làm tốt hơn."),
]

STEPS = [
    ("Đọc kỹ và tự hỏi mình", "Đọc hết trang này. Nếu thấy mình đồng điệu, hãy trả lời bộ câu hỏi “Thấu hiểu chính mình” ở cuối trang."),
    ("Tiếp nhận hồ sơ", "Chúng tôi đọc kỹ từng câu trả lời, chọn những bạn phù hợp cả về tâm thế lẫn chuyên môn."),
    ("Kết nối ban đầu", "Gọi điện hoặc nhắn Zalo 15–20 phút, để bạn hiểu VitaGreen và chúng tôi hiểu bạn hơn."),
    ("Kết nối chuyên môn", "Phỏng vấn trực tiếp tại văn phòng với Ban điều hành, có thể kèm một bài kiểm tra ngắn."),
    ("Phản hồi kết quả", "Kết quả được báo trong vòng 5 ngày làm việc sau buổi phỏng vấn."),
    ("Hội nhập & đồng hành", "Bạn nhận Sổ tay Cộng sự, có người kèm cặp trong những tuần đầu để hòa nhập văn hóa và công việc."),
]


def job_rows(jobs):
    return "".join(f"""<article class="cs-job cs-rv">
<div class="cs-job-t"><h3><a href="/{j["slug"]}/">{esc(j["title"])}</a></h3>{f'<p>{esc(j["headline"])}</p>' if j.get("headline") else ""}</div>
<div class="cs-job-m"><span>Số lượng</span><b>{esc(j.get("quantity", 1))}</b></div>
<div class="cs-job-m"><span>Địa điểm làm việc</span><b>{esc(j.get("location", "Hà Nội"))}</b></div>
<a class="cs-btn cs-btn-sm cs-btn-gold" href="/{j["slug"]}/">Xem chi tiết</a>
</article>""" for j in jobs)


# ---------------------------------------------------------------- form ứng tuyển nhiều bước
def form_html(jobs, site, quiz):
    opts = "".join(f'<option value="{esc(j["title"])}" data-slug="{j["slug"]}">{esc(j["title"])}</option>' for j in jobs)
    ta = lambda n, q, hint, req=False: f'<label class="cs-f cs-f-full"><span>{q}{" *" if req else ""}</span><small>{hint}</small><textarea name="{n}" rows="3"{" required" if req else ""} maxlength="2000"></textarea></label>'

    def choice(it, n):
        o = "".join(f'<label class="cs-opt"><input type="radio" name="q_{it["id"]}" value="{v}" required><span>{esc(t)}</span></label>' for v, t, *_ in it["opts"])
        return f'<div class="cs-q" role="radiogroup" aria-label="{esc(it["q"])}"><p class="cs-q-t"><b>{n}.</b> {esc(it["q"])}</p><div class="cs-opts">{o}</div></div>'

    def scale(it, n):
        o = "".join(f'<label><input type="radio" name="q_{it["id"]}" value="{v}" required><span>{v}</span></label>' for v in range(1, 6))
        return f'<div class="cs-q cs-q-scale" role="radiogroup" aria-label="{esc(it["q"])}"><p class="cs-q-t"><b>{n}.</b> {esc(it["q"])}</p><div class="cs-scale">{o}</div></div>'

    steps = [
        ("Vị trí & liên hệ", "Bắt đầu thật nhẹ nhàng: bạn là ai, ứng tuyển vị trí nào.", f"""<div class="cs-fg">
<label class="cs-f cs-f-full"><span>Vị trí ứng tuyển *</span><select name="job" required><option value="">– Chọn vị trí –</option>{opts}</select></label>
<label class="cs-f"><span>Họ và tên *</span><input name="name" required maxlength="80" autocomplete="name"></label>
<label class="cs-f"><span>Năm sinh</span><input name="birth" inputmode="numeric" maxlength="4" placeholder="VD: 1994"></label>
<label class="cs-f"><span>Số điện thoại (Zalo) *</span><input name="phone" type="tel" required inputmode="tel" autocomplete="tel" placeholder="VD: 0912 345 678"></label>
<label class="cs-f"><span>Email *</span><input name="email" type="email" required autocomplete="email"></label>
<label class="cs-f cs-f-full"><span>Nơi ở hiện tại</span><input name="area" maxlength="120" placeholder="VD: Gia Lâm, Hà Nội"></label>
</div>"""),
        ("Bạn đã đọc kỹ chưa?", "Hai câu hỏi nhỏ. Ai đọc hết trang sẽ trả lời được ngay.", "".join(choice(it, i) for i, it in enumerate(quiz["read"], 1))),
        ("Nếu là bạn, bạn sẽ làm gì?", "Chọn cách bạn thật sự sẽ làm, không phải cách nghe hay nhất.", "".join(choice(it, i) for i, it in enumerate(quiz["cases"], 1))),
        ("Bạn là người thế nào?", "Mỗi câu chọn 1 mức: <b>1</b> = không giống tôi, <b>5</b> = rất giống tôi.", "".join(scale(it, i) for i, it in enumerate(quiz["self"], 1))),
        ("Thấu hiểu chính mình", "Không có câu trả lời đúng hay sai, chỉ có câu trả lời thật. Vài dòng là đủ.", f"""<div class="cs-fg">
{ta("why", "Điều gì khiến bạn muốn đồng hành cùng VitaGreen – Thực Dưỡng Lành?", "Điều bạn thấy đồng điệu trong câu chuyện này, hoặc lý do riêng của bạn.", True)}
{ta("hard", "Kể một việc khó nhất bạn từng theo đến cùng. Bạn đã làm gì?", "Công việc hay chuyện đời sống đều được.", True)}
{ta("rules", "Trong 10 Quy tắc Danh dự, quy tắc nào bạn làm tốt nhất, quy tắc nào bạn cần rèn thêm?", "Xem lại ở chương 8.")}
{ta("ai", "Bạn đang dùng AI hoặc công cụ số nào trong công việc?", "VD: ChatGPT, Claude, Canva, Excel, phần mềm kế toán…")}
{ta("life", "Lối sống lành của bạn hiện nay thế nào?", "Ăn uống, vận động, nghỉ ngơi. Không bắt buộc.")}
</div>"""),
        ("Điều kiện & CV", "Bước cuối. Gửi xong là chúng tôi nhận được ngay.", "".join(choice(it, i) for i, it in enumerate(quiz["must"], 1)) + f"""<div class="cs-fg">
<label class="cs-f"><span>Kinh nghiệm ở vị trí này</span><select name="exp"><option value="">– Chọn –</option><option>Chưa có</option><option>Dưới 1 năm</option><option>1 – 2 năm</option><option>3 – 5 năm</option><option>Trên 5 năm</option></select></label>
<label class="cs-f"><span>Thu nhập mong muốn</span><input name="salary" maxlength="80" placeholder="VD: 15 – 20 triệu/tháng"></label>
<label class="cs-f"><span>Có thể bắt đầu đi làm từ</span><input name="start" maxlength="80" placeholder="VD: 01/12/2026 hoặc sau 2 tuần"></label>
<label class="cs-f"><span>Bạn biết tin tuyển dụng từ đâu?</span><select name="heard"><option value="">– Chọn –</option><option>Facebook</option><option>TikTok</option><option>Website Thực Dưỡng Lành</option><option>Bạn bè / người quen giới thiệu</option><option>Trang tuyển dụng (TopCV, VietnamWorks…)</option><option>Khác</option></select></label>
<label class="cs-f cs-file"><span>Tải file CV</span><small>PDF, Word hoặc ảnh, tối đa 5 MB</small><input name="cv_file" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"></label>
<label class="cs-f"><span>Hoặc dán link CV</span><small>Google Drive, TopCV, LinkedIn… (nhớ mở quyền xem)</small><input name="cv_link" type="url" maxlength="500" placeholder="https://"></label>
</div>
<label class="cs-consent"><input type="checkbox" name="consent" required> <span>Tôi đồng ý để {esc(site.get("company", "").title().replace("Tnhh", "TNHH"))} lưu và dùng thông tin trên cho việc tuyển dụng, trong tối đa 12 tháng. Tôi có thể yêu cầu xoá bất cứ lúc nào qua email {esc(site.get("email"))}.</span></label>"""),
    ]
    n = len(steps)
    body = "".join(f"""<fieldset class="cs-step" data-step="{i}"{' hidden' if i > 1 else ''}><legend><span>Bước {i}/{n}</span>{t}</legend><p class="cs-fnote">{sub}</p>{inner}
<div class="cs-step-nav">{'<button type="button" class="cs-btn cs-btn-ghost" data-prev>‹ Quay lại</button>' if i > 1 else '<span></span>'}{f'<button type="button" class="cs-btn" data-next>Tiếp tục ›</button>' if i < n else '<button class="cs-btn cs-btn-lg" type="submit">GỬI HỒ SƠ ỨNG TUYỂN</button>'}</div>
</fieldset>""" for i, (t, sub, inner) in enumerate(steps, 1))
    dots = "".join(f'<li{" class=on" if i == 1 else ""}><span>{i}</span><small>{t}</small></li>' for i, (t, _, _) in enumerate(steps, 1))
    return f"""<form class="cs-form" id="cs-form" novalidate data-endpoint="https://api.thucduonglanh.vn/api">
<ol class="cs-stepbar" aria-hidden="true">{dots}</ol>
{body}
<input class="cs-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<p class="cs-fmsg" role="status" aria-live="polite"></p>
<p class="cs-fsave">Câu trả lời được tự lưu trên máy bạn. Lỡ tắt trang, lần sau mở lại vẫn còn.</p>
</form>
<div class="cs-done" id="cs-done" hidden><b>🌱 Cảm ơn bạn đã dành thời gian thật lòng!</b>
<p>Chúng tôi sẽ đọc kỹ từng câu trả lời và liên hệ với bạn qua điện thoại hoặc Zalo trong vòng 5 ngày làm việc.</p>
<p class="cs-done-q">“Nếu bạn là người chúng tôi đang tìm, thì kể từ hôm nay, bạn không chỉ gia nhập VitaGreen. Bạn đang cùng chúng tôi viết tiếp hành trình ấy.”</p></div>"""


def yt_id(url):
    m = re.search(r"(?:youtu\.be/|v=|embed/|shorts/)([\w-]{11})", url or "")
    return m.group(1) if m else ""


def page_home(jobs, site, quiz):
    vid = yt_id((site.get("brand_video") or {}).get("youtube", ""))
    video = f"""<button class="cs-video" type="button" data-yt="{vid}" aria-label="Xem video câu chuyện Thực Dưỡng Lành">
<img src="https://i.ytimg.com/vi/{vid}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360"><span class="cs-play" aria-hidden="true"></span>
<span class="cs-video-cap">Câu chuyện đồng hành cùng Thực Dưỡng Lành</span></button>""" if vid else ""
    rules = "".join(f'<li class="cs-rv"><b>{i}</b><h3>{t}</h3><p>“{q}”</p></li>' for i, (t, q) in enumerate(RULES, 1))
    steps = "".join(f'<li class="cs-rv"><b>Bước {i}</b><h3>{t}</h3><p>{d}</p></li>' for i, (t, d) in enumerate(STEPS, 1))
    promises = "".join(f'<article class="cs-rv"><span class="cs-pr-n">{i}</span><h3>{t}</h3><p class="cs-pr-no">{" – ".join(nw(x) for x in n.split(" – "))}</p><p>{d}</p></article>' for i, (t, n, d) in enumerate(PROMISES, 1))
    week = "".join(f'<li class="cs-rv"><b>{t}</b><p>{d}</p></li>' for t, d in WEEK)
    proof = "".join(f'<figure class="cs-rv"><img src="/img/{f}.webp" alt="{t}" loading="lazy" width="1200" height="900"><figcaption><b>{t}</b>{d}</figcaption></figure>' for f, t, d in PROOF)
    honest = "".join(f'<li class="cs-rv"><b>{i}</b><div><h3>{t}</h3><p>{d}</p></div></li>' for i, (t, d) in enumerate(HONEST, 1))
    fit_yes = "".join(f'<li>{ic("check")}<span><b>{t}:</b> {d}</span></li>' for t, d in FIT_YES)
    fit_no = "".join(f'<li>{ic("x")}<span><b>{t}:</b> {d}</span></li>' for t, d in FIT_NO)
    photos = [("doi-ngu", "Đội ngũ trước văn phòng Vinhomes Ocean Park"), ("le-chua", "Lễ chùa mùng 1 và rằm"), ("nghe-phap", "Nghe pháp thoại"),
              ("thien-nguyen", "Trao quà thiện nguyện tại văn phòng"), ("phong-tra", "Góc trà ở văn phòng Gia Lâm"), ("zoom-thu-5", "Zoom chia sẻ sức khỏe tối thứ Năm")]
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
<p class="cs-hero-chip">{nw("VitaGreen Nutrition – Thực Dưỡng Lành")} · {nw("Tuyển dụng 2026")}</p>
<h1>TÌM CỘNG SỰ <em>CÙNG CHÍ HƯỚNG</em></h1>
<p class="cs-hero-l1">{", ".join(nw(("Cùng" if i == 0 else "cùng") + " <b>" + w + "</b>") for i, w in enumerate(("sống lành", "làm thật", "rèn luyện", "cống hiến")))}</p>
<p class="cs-hero-l2">TRONG HẠNH PHÚC!</p>
<svg class="cs-swoosh" viewBox="0 0 120 10" aria-hidden="true"><path d="M2 7 C30 1 80 1 118 6"/></svg>
<p class="cs-hero-l3">Xây dựng <b>Thực Dưỡng Lành</b><br>Để {nw("<b>10 triệu người Việt</b>")} {nw("sống khỏe từ <b>THÂN</b> đến <b>TÂM</b>")}</p>
<div class="cs-hero-btns"><a class="cs-btn cs-btn-ghost" href="#cau-chuyen">Đọc câu chuyện</a><a class="cs-btn cs-btn-ghost" href="#van-hoa">Văn hóa VitaGreen</a><a class="cs-btn cs-btn-gold" href="#vi-tri">Các vị trí tìm cộng sự</a></div>
<p class="cs-hero-jobs">{" / ".join(esc(j["title"]) for j in jobs)}</p>
<div class="cs-collage">
<img class="c1" src="/img/le-chua.webp" alt="Cả đội lễ chùa" width="420" height="315"><img class="c2" src="/img/doi-ngu.webp" alt="Đội ngũ VitaGreen trước văn phòng Vinhomes Ocean Park" width="700" height="476" fetchpriority="high"><img class="c3" src="/img/thien-nguyen.webp" alt="Trao quà thiện nguyện" width="420" height="315">
<span class="cs-heart h1"></span><span class="cs-heart h2"></span><span class="cs-heart h3"></span>
</div>
</div>
</section>
<div class="cs-band"><p>Từ một bữa ăn lành, {nw("ta có thể hồi sinh cả một đời sống")}<br><small>Chúng tôi không tuyển nhân viên. {nw("Chúng tôi tìm những người cùng mơ.")}</small></p></div>

<div class="cs-wrap"><aside class="cs-slow cs-rv"><span aria-hidden="true">📖</span><p><b>Trang này được viết như một câu chuyện, đọc hết mất khoảng 8 phút.</b> Bạn hãy đọc chậm, đừng vội ứng tuyển. Sự điềm đạm cũng là một phẩm chất chúng tôi tìm. Cuối trang có vài câu hỏi nhỏ mà chỉ người đọc kỹ mới trả lời đúng.</p></aside></div>

<section class="cs-sec cs-origin" id="cau-chuyen">
<div class="cs-wrap cs-origin-in">
<div class="cs-origin-txt">
{eyebrow(1, "Câu chuyện bắt đầu từ một câu hỏi")}
<p class="cs-big-q cs-rv">“Giá như mình <br>chăm sóc tốt hơn…”</p>
<p>VitaGreen ra đời không phải từ một bản kế hoạch kinh doanh, mà từ một câu hỏi chưa kịp có lời đáp.</p>
<p>Chúng tôi từng nghĩ mình còn trẻ, còn nhiều thời gian, cho đến ngày một người thân ra đi đột ngột. Không kịp lời tạm biệt. Bữa ăn, điều tưởng chừng nhỏ bé, hóa ra lại là thứ khiến ta day dứt suốt đời nếu không trọn vẹn.</p>
<p>Cùng lúc ấy, hàng loạt vụ thực phẩm kém chất lượng vỡ lở. Thứ lẽ ra nâng đỡ sức khỏe lại trở thành vết dao phản bội niềm tin.</p>
<p><b>Chúng tôi biết mình phải làm điều gì đó. Không để đi nhanh, mà để đi đúng.</b></p>
</div>
<figure class="cs-origin-img cs-rv"><img src="/img/phong-tra.webp" alt="Góc trà ở văn phòng VitaGreen" loading="lazy" width="1200" height="900"><figcaption>Góc trà ở văn phòng VitaGreen, nơi nhiều quyết định quan trọng bắt đầu.</figcaption></figure>
</div>
<div class="cs-wrap"><p class="cs-origin-lead">Thực Dưỡng Lành ra đời, không phải để bán sản phẩm, mà là…</p>
<div class="cs-three">
<article class="cs-rv"><b>Lời xin lỗi muộn</b><p>với những người ta không kịp chăm sóc.</p></article>
<article class="cs-rv"><b>Lời hứa sớm</b><p>với những người ta vẫn còn được đồng hành.</p></article>
<article class="cs-rv"><b>Lời cam kết</b><p>với chính mình: <em>“{nw("Tôi chọn sống lành")} – {nw("để sống đáng.”")}</em></p></article>
</div></div>
</section>

<section class="cs-sec cs-letter-sec" id="ve-chung-toi">
<div class="cs-wrap"><div class="cs-believe">
<figure class="cs-believe-img cs-rv"><img src="/img/du-xuan.webp" alt="Đại gia đình VitaGreen du xuân đầu năm" loading="lazy" width="1600" height="1200"><figcaption>Đại gia đình VitaGreen du xuân đầu năm</figcaption><img class="cs-believe-2" src="/img/nghe-phap.webp" alt="Cả đội nghe pháp thoại" loading="lazy" width="1400" height="1050"><figcaption class="cs-believe-2">Cùng nhau nghe pháp thoại, học cách sống chậm lại</figcaption></figure>
<div class="cs-believe-txt">
{eyebrow(2, "Lời tâm sự gửi người cùng mơ")}
<h2>{nw("ĐIỀU CHÚNG TÔI")}<br><em>TIN TƯỞNG</em></h2>
<p class="cs-hi">Chào bạn,</p>
<p>Giữa một thời đại mà đồ ăn ngày càng nhanh, niềm tin ngày càng mỏng, chúng tôi chọn mơ một giấc mơ ngược dòng: một ngày nào đó, <em class="hl">10 triệu người Việt sẽ sống khỏe từ THÂN đến TÂM</em>, bắt đầu từ điều giản dị nhất là một bữa ăn lành.</p>
<p>Chúng tôi tin <em class="hl">thực phẩm không phải là hàng hóa, nó là một lời hứa</em>. Chúng tôi tin kinh doanh tử tế không phải là ngây thơ, đó là con đường duy nhất đáng đi đường dài. Một công ty đáng tự hào không đo bằng doanh thu, mà đo bằng <em class="hl">số cuộc đời nó chạm đến</em>.</p>
<p>Nếu bạn chỉ cần một chỗ làm để nhận lương mỗi tháng, nơi này có lẽ không dành cho bạn, và điều đó không sao cả. Nhưng nếu bạn từng xót xa khi người mình thương ăn không lành, sống không khỏe; nếu bạn tin những việc nhỏ làm tử tế mỗi ngày có thể thay đổi cả một cộng đồng, thì bạn đã ở đúng nơi rồi.</p>
<p>Giấc mơ này quá lớn để đi một mình. Đó là lý do chúng tôi cần bạn.</p>
<p class="cs-sign">Những người sáng lập VitaGreen<small>Thực Dưỡng Lành</small></p>
</div>
</div></div>
</section>

<section class="cs-sec cs-together">
<div class="cs-wrap">
{eyebrow(3, "Chúng tôi là ai")}
<h2 class="cs-h2">BẠN CÓ CÙNG ĐỒNG HÀNH?</h2>
<p class="cs-lead">Nếu bạn quyết định gia nhập, chúng ta là một <b>GIA ĐÌNH</b>. Chúng tôi muốn bạn nhìn thật rõ chân dung của chúng tôi, và thấy mình có những điểm chung nào trong đó:</p>
<svg class="cs-swoosh" viewBox="0 0 120 10" aria-hidden="true"><path d="M2 7 C30 1 80 1 118 6"/></svg>
<div class="cs-vm">
<div class="cs-vm-cards">
<article class="cs-rv"><h3>TẦM NHÌN</h3><p>Trở thành hệ sinh thái sản phẩm thực dưỡng uy tín hàng đầu Việt Nam, một biểu tượng được tin chọn trong từng gia đình, giúp người Việt sống khỏe từ THÂN đến TÂM.</p></article>
<article class="cs-rv"><h3>SỨ MỆNH</h3><p>Truyền cảm hứng về một lối sống lành mạnh, tỉnh thức, đầy yêu thương. Hướng tới hành trình giúp 10 triệu người Việt sống khỏe, để mỗi bữa ăn là một lần trở về với chính mình.</p></article>
<article class="cs-rv"><h3>TRIẾT LÝ</h3><p><b>Sống xanh – Sống lành – Sống có giá trị.</b> Thân được nuôi dưỡng, Tâm được an, Trí được mở là ba gốc rễ của một đời sống khỏe. Gốc vững thì cây mới bền và cho trái ngọt.</p></article>
</div>
{tree_svg()}
</div>
<div class="cs-journey cs-rv" data-journey>
<p><b data-jn>8.038</b> người Việt đã bắt đầu hành trình sống lành cùng Thực Dưỡng Lành.</p>
<div class="cs-jbar"><i data-jbar style="width:1%"></i></div>
<p class="cs-jsub">Còn <b data-jleft>9.991.962</b> người nữa mới tới mục tiêu 10 triệu. Chúng tôi cần thêm những người cùng mơ như bạn.</p>
</div>
</div>
</section>

<section class="cs-sec cs-values" id="van-hoa">
<div class="cs-wrap">
<div class="cs-values-head">
<div>{eyebrow(4, "Điều giữ chúng tôi đi cùng nhau")}<h2>HỆ GIÁ TRỊ<br>CỐT LÕI</h2><p>Khi bạn quyết định đồng hành cùng chúng tôi, bạn là một thành viên của ngôi nhà này. Hãy cùng nhau xây dựng và nuôi lớn những phẩm chất chung dưới đây nhé.</p></div>
{video}
</div>
<div class="cs-vals">{values_html()}</div>
</div>
</section>

<section class="cs-sec cs-lifesec">
<div class="cs-wrap">
{eyebrow(5, "Một tuần của người VitaGreen")}
<h2 class="cs-h2">SỐNG & LÀM VIỆC<br><em>HẠNH PHÚC – HIỆU QUẢ – Ý NGHĨA</em></h2>
<div class="cs-slider"><button class="cs-sl-btn prev" type="button" aria-label="Ảnh trước">‹</button><div class="cs-slides">{slides}</div><button class="cs-sl-btn next" type="button" aria-label="Ảnh tiếp">›</button></div>
<ol class="cs-week">{week}</ol>
<div class="cs-lifes">
<article class="cs-life cs-rv"><h3>HỌC MỖI NGÀY</h3><p>Đào tạo nội bộ về dinh dưỡng, kỹ năng và tư duy. Học xong có bài kiểm tra nhỏ, để chắc rằng mình hiểu đúng trước khi nói với khách.</p></article>
<article class="cs-life cs-rv"><h3>LÀM VIỆC CÙNG AI & CÔNG NGHỆ</h3><p>Website, CRM, báo cáo quảng cáo tự động đều do chính đội ngũ xây. Bạn được khuyến khích dùng AI để bớt việc lặp lại, dành thời gian cho việc tạo ra giá trị.</p></article>
</div>
</div>
</section>

<section class="cs-sec cs-proof">
<div class="cs-wrap">
{eyebrow(6, "Chúng tôi làm thật")}
<h2 class="cs-h2">NÓI ÍT, <em>LÀM THẬT</em></h2>
<p class="cs-lead">Niềm tin của khách hàng không đến từ quảng cáo. Nó đến từ những việc chúng tôi làm khi không ai nhìn thấy.</p>
<div class="cs-proof-g">{proof}</div>
<ul class="cs-stats">
<li class="cs-rv"><b>9</b><span>dòng sản phẩm thực dưỡng</span></li>
<li class="cs-rv"><b data-jn>8.038</b><span>người đã đồng hành</span></li>
<li class="cs-rv"><b>GMP</b><span>nhà máy đạt chuẩn</span></li>
<li class="cs-rv"><b>100%</b><span>hệ thống bán hàng tự xây</span></li>
</ul>
</div>
</section>

<section class="cs-sec cs-honest">
<div class="cs-wrap cs-honest-in">
<div>{eyebrow(7, "Nói thật trước khi bạn quyết định")}
<h2>KHÔNG PHẢI<br><em>{nw("BỨC TRANH")} {nw("MÀU HỒNG")}</em></h2>
<p>Chúng tôi không muốn bạn ứng tuyển vì một bức tranh đẹp. Đây là những điều bạn chắc chắn sẽ gặp:</p>
<p class="cs-honest-end">Nếu đọc đến đây bạn thấy <b>“hơi sợ”</b> nhưng lại <b>“hào hứng”</b>, có lẽ chúng ta hợp nhau.</p></div>
<ol>{honest}</ol>
</div>
</section>

<section class="cs-sec cs-fitsec" id="phu-hop">
<div class="cs-wrap">
{eyebrow(8, "Ai sẽ hợp với ngôi nhà này")}
<h2 class="cs-h2">CON NGƯỜI PHÙ HỢP<br><em>NGƯỜI VITAGREEN</em></h2>
<blockquote class="cs-collins cs-rv">“Tài sản quý giá nhất của một doanh nghiệp không phải là con người, mà là con người phù hợp.”<cite>Jim Collins, Từ tốt đến vĩ đại</cite></blockquote>
<p class="cs-lead">Ở VitaGreen, “phù hợp” không nằm ở bằng cấp hay số năm kinh nghiệm. Chúng tôi tin <b>thái độ quan trọng hơn trình độ</b>: trình độ có thể đào tạo, còn thái độ là lựa chọn mỗi ngày.</p>
<div class="cs-fit2">
<div class="cs-fit-yes cs-rv"><h3>{ic("check")} Bạn sẽ hợp nếu bạn…</h3><ul>{fit_yes}</ul></div>
<div class="cs-fit-no cs-rv"><h3>{ic("x")} Có lẽ chưa hợp nếu bạn…</h3><ul>{fit_no}</ul></div>
</div>
<p class="cs-fit-end">Người chưa hợp không phải vì họ kém, mà vì họ <b>ngồi nhầm xe</b>. Chúng tôi trân trọng thời gian của bạn, nên nói rõ từ đầu.</p>
</div>
</section>

<section class="cs-sec cs-rules">
<div class="cs-wrap">
<div class="cs-rules-head">{eyebrow(9, "Lời hứa thầm lặng trao cho nhau")}<h2>10 QUY TẮC DANH DỰ<br>NGƯỜI VITAGREEN</h2><p class="cs-chip">{" – ".join(nw(w) for w in ("Sống tử tế", "Làm thật", "Cùng nhau phát triển"))}</p></div>
<ol class="cs-rule-grid">{rules}</ol>
<details class="cs-poster"><summary>Xem bảng 10 Quy tắc Danh dự đầy đủ</summary><img src="/img/10-quy-tac.webp" alt="Bảng 10 Quy tắc Danh dự Người VitaGreen" loading="lazy" width="1448" height="1086"></details>
</div>
</section>

<section class="cs-promise">
<div class="cs-wrap"><h2>5 LỜI HỨA CỦA NGƯỜI VITAGREEN</h2>
<p class="cs-promise-sub">Không ai đứng trên lời hứa, kể cả người lãnh đạo.</p>
<div class="cs-pr-g">{promises}</div></div>
</section>

<section class="cs-sec cs-jobsec" id="vi-tri">
<div class="cs-wrap"><div class="cs-jobbox">
{eyebrow(10, "Chỗ ngồi đang chờ bạn")}
<h2>TRỞ THÀNH ĐỒNG ĐỘI CÙNG VITAGREEN</h2>
<p class="cs-lead">Chúng tôi đang tìm những cộng sự cùng chí hướng</p>
<div class="cs-jobs">{job_rows(jobs)}</div>
<div class="cs-jobs-cta"><a class="cs-btn cs-btn-lg" href="#ung-tuyen">ỨNG TUYỂN NGAY</a>
<p>Cần hỏi thêm: Hotline / Zalo <a href="tel:{hot}"><b>{esc(site.get("hotline"))}</b></a><br>Hoặc email <a href="mailto:{esc(site.get("email"))}">{esc(site.get("email"))}</a></p></div>
</div></div>
</section>

<section class="cs-sec cs-steps" id="quy-trinh">
<div class="cs-wrap">{eyebrow(11, "Từ hôm nay đến ngày đầu tiên")}<h2 class="cs-h2">QUY TRÌNH <em>TUYỂN DỤNG</em></h2><ol>{steps}</ol></div>
</section>

<div class="cs-band cs-band-2"><p>Điều khó nhất là quyết định <b>hành động</b>.<br><small>{nw("Phần còn lại chỉ là sự bền bỉ.")}</small></p></div>

<section class="cs-sec cs-apply" id="ung-tuyen">
<div class="cs-wrap cs-apply-in">
<div class="cs-apply-head">{eyebrow(12, "Đến lượt bạn kể câu chuyện của mình")}<h2>ỨNG TUYỂN VÀ ĐIỀN FORM<br><em>THẤU HIỂU CHÍNH MÌNH</em></h2>
<p>6 bước ngắn, khoảng 10 phút. Hãy trả lời thật lòng: chúng tôi đọc kỹ từng câu, và câu trả lời thật luôn đáng giá hơn câu trả lời hay.</p></div>
{form_html(jobs, site, quiz)}
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


def info_item(i, label, val):
    return f'<div class="cs-info-i"><svg viewBox="0 0 24 24" aria-hidden="true">{CARD_IC[i]}</svg><span>{label}</span><b>{esc(val)}</b></div>'


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
<aside class="cs-slow"><span aria-hidden="true">💡</span><p>Trước khi ứng tuyển, bạn nên đọc <a href="/#cau-chuyen">câu chuyện và văn hóa VitaGreen</a> ở trang chính. Bộ câu hỏi ứng tuyển có hỏi về những điều đó.</p></aside>
{f'<p class="cs-jd-hook">🧭 {esc(j["headline"]).upper()}</p>' if j.get("headline") else ""}
{f'<p class="cs-jd-quote">“{esc(j["quote"])}”</p>' if j.get("quote") else ""}
{body}
{place}
<div class="cs-jd-apply">
<div><h2>ỨNG TUYỂN VÀ ĐIỀN FORM<br>THẤU HIỂU {nw("CHÍNH MÌNH TẠI ĐÂY")}</h2>
<p>Bạn là người chủ động, trung thực, thích thử thách và muốn công việc của mình có ý nghĩa? Bấm nút bên dưới, vị trí {esc(title)} sẽ được chọn sẵn.</p>
<a class="cs-btn cs-btn-lg" href="/?vi-tri={j["slug"]}#ung-tuyen">ỨNG TUYỂN NGAY</a></div>
<img src="/img/doi-ngu.webp" alt="Đội ngũ VitaGreen" loading="lazy" width="1400" height="953">
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
    jobs, quiz = load_jobs(), load_quiz()
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
    # Ảnh gắn ?v=<mã nội dung>: thay ảnh cùng tên thì link đổi, Cloudflare / trình duyệt không giữ ảnh cũ (23/10/2026 ảnh đội ngũ bị giữ bản cũ 7 ngày)
    imgv = {f.name: hashlib.md5(f.read_bytes()).hexdigest()[:8] for f in (SRC / "img").iterdir() if f.is_file()}
    def bust(text):
        return re.sub(r'/img/([\w.-]+\.(?:webp|jpg|png))(?![?\w])', lambda m: f"/img/{m.group(1)}?v={imgv[m.group(1)]}" if m.group(1) in imgv else m.group(0), text)
    css = bust(css)
    (OUT / "style.css").write_text(css, "utf-8")
    (OUT / "app.js").write_text(js, "utf-8")
    ver = hashlib.md5((css + js).encode("utf-8")).hexdigest()[:8]
    brand = ROOT / "assets/img/brand"
    for f in ("logo.webp", "logo-cream.webp", "icon-32.png", "icon-180.png"):
        shutil.copy(brand / f, OUT / f)
    from PIL import Image  # ảnh chia sẻ Facebook / Zalo 1200×630 từ ảnh đội ngũ
    im = Image.open(SRC / "img/doi-ngu.webp").convert("RGB")
    h = round(im.width * 630 / 1200)
    top = max(0, round((im.height - h) * 0.55))
    im.crop((0, top, im.width, top + h)).resize((1200, 630)).save(OUT / "img/og.jpg", quality=82)

    pages = {"/": page_home(jobs, site, quiz)}
    for i, j in enumerate(jobs):
        pages[f"/{j['slug']}/"] = page_job(j, jobs[i - 1] if i else None, jobs[i + 1] if i + 1 < len(jobs) else None, site)
    for path, doc in pages.items():
        d = OUT / path.strip("/")
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(bust(doc.replace("__V__", ver)), "utf-8")
    today = datetime.date.today().isoformat()
    (OUT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                                     + "".join(f"<url><loc>{BASE}{p}</loc><lastmod>{today}</lastmod></url>" for p in pages) + "</urlset>\n", "utf-8")
    # Đổi tên vị trí (đổi đường link): link cũ ghi ở ô aliases tự chuyển sang link mới (23/10/2026: ke-toan-thue → ke-toan-tong-hop)
    (OUT / "_redirects").write_text("".join(f"/{a}/ /{j['slug']}/ 301\n/{a} /{j['slug']}/ 301\n" for j in jobs for a in (j.get("aliases") or [])), "utf-8")
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
