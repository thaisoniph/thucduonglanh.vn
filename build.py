#!/usr/bin/env python3
"""Sinh website tĩnh Thực Dưỡng Lành vào thư mục dist/.

Cách dùng:  python3 build.py
Dữ liệu nằm trong data/*.json, giao diện trong assets/.

Đa ngôn ngữ (xem HUONG-DAN.md mục "Đa ngôn ngữ"): tiếng Việt là bản chính ở gốc web (/...).
Mỗi ngôn ngữ khác trong LANGS được dựng bằng chính file này chạy lại với `--lang <mã>` → dist/<mã>/...
- Chữ cố định trong code: bọc bằng t("…") / tf("…{x}…", x=…), bản dịch ở data/i18n/<mã>.json (khoá = câu tiếng Việt).
  Thêm/đổi câu: chạy `python3 scripts/i18n-keys.py` để cập nhật danh sách câu cần dịch.
- Nội dung soạn ở /admin: bản dịch nằm cạnh file gốc, đuôi .<mã>.json / .<mã>.md (vd content/products/abc.en.json).
"""
import json, os, shutil, html, re, datetime, sys, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
DATA = ROOT / "data"

import hashlib
import markdown as _md
import yaml

CONTENT = ROOT / "content"

# ---------------------------------------------------------------- ngôn ngữ
DEFAULT_LANG = "vi"
LANGS = {  # thêm ngôn ngữ: thêm 1 dòng ở đây + data/i18n/<mã>.json + locales trong admin/config.yml
    "vi": {"name": "Tiếng Việt", "short": "VI", "locale": "vi_VN"},
    "en": {"name": "English", "short": "EN", "locale": "en_US"},
}
LANG = sys.argv[sys.argv.index("--lang") + 1] if "--lang" in sys.argv else DEFAULT_LANG
if LANG not in LANGS:
    raise SystemExit(f"❌ Không có ngôn ngữ '{LANG}' trong LANGS")
IS_VI = LANG == DEFAULT_LANG
I18N = {} if IS_VI else json.loads((DATA / "i18n" / f"{LANG}.json").read_text("utf-8"))
I18N_MISSING = set()


def t(s):
    """Dịch 1 câu cố định trong code. Tiếng Việt: giữ nguyên. Chưa có bản dịch: tạm dùng tiếng Việt."""
    base = s.split("||")[0]  # "Thanh toán||payment": cùng chữ tiếng Việt nhưng nghĩa khác → khoá riêng
    if IS_VI or not s:
        return base
    v = I18N.get(s)
    if not v:
        I18N_MISSING.add(s)
        return base
    return v


def tf(s, **kw):
    """t() + thay {tên} bằng giá trị (không dùng str.format để khỏi vướng dấu ngoặc nhọn trong HTML)."""
    s = t(s)
    for k, v in kw.items():
        s = s.replace("{" + k + "}", str(v))
    return s


# Đường dẫn: bản tiếng Việt ở gốc; ngôn ngữ khác ở /<mã>/ + tên mục dịch theo SEGMENTS. Tên sản phẩm/bài viết (slug) giữ nguyên.
SEGMENTS = {"en": {"san-pham": "products", "danh-muc": "category", "nhu-cau": "needs", "khuyen-mai": "sale", "gioi-thieu": "about",
                   "lien-he": "contact", "gio-hang": "cart", "thanh-toan": "checkout", "dat-hang-thanh-cong": "order-success",
                   "yeu-thich": "wishlist", "tim-kiem": "search", "goc-song-lanh": "blog", "chuyen-muc": "category"}}
PAGE_SLUGS = {}  # trang chính sách có ô "Đường dẫn" riêng trong bản dịch: slug tiếng Việt → slug ngôn ngữ này


def lp(path, lang=None):
    """Đường dẫn tiếng Việt → đường dẫn của ngôn ngữ đang dựng (giữ ?… và #…)."""
    lang = lang or LANG
    if lang == DEFAULT_LANG or not path.startswith("/") or path.startswith(("/assets/", "/admin")):
        return path
    m = re.match(r"([^?#]*)(.*)", path)
    p, rest = m.group(1), m.group(2)
    if p.endswith(".html"):
        return f"/{lang}{p}{rest}"
    segs = [s for s in p.split("/") if s]
    seg_map = SEGMENTS.get(lang, {})
    if segs:
        segs[0] = PAGE_SLUGS.get(segs[0]) or seg_map.get(segs[0], segs[0])
        if len(segs) > 1 and segs[0] == seg_map.get("goc-song-lanh") and segs[1] == "chuyen-muc":
            segs[1] = seg_map.get("chuyen-muc", segs[1])
    return f"/{lang}/" + "".join(s + "/" for s in segs) + rest


TRANSLATABLE_SKIP = {"price", "regular_price", "web_discount", "images", "image", "category", "sku", "order", "published", "featured",
                     "upsell", "needs", "slug", "free_ship", "days", "product", "qty", "variant", "url", "file", "roadmap_link",
                     "servings", "rating", "img", "video", "style", "icon", "test_cert_img", "label_imgs", "youtube"}


def overlay(base, tr):
    """Phủ bản dịch lên bản tiếng Việt: chỉ thay ô chữ có nội dung; giá, ảnh, mã… luôn lấy từ bản tiếng Việt."""
    if isinstance(base, dict) and isinstance(tr, dict):
        out = dict(base)
        for k, v in tr.items():
            if v in (None, "", [], {}) or (k in TRANSLATABLE_SKIP and not (isinstance(v, list) and isinstance(v[0], dict))):
                continue  # "needs" của sản phẩm (danh sách mã) bỏ qua; "needs" trong data/needs.json (danh sách thẻ) thì dịch
            out[k] = overlay(base.get(k), v)
        return out
    if isinstance(tr, list) and isinstance(base, list) and base and all(isinstance(x, dict) for x in base + tr):
        n = len(base) if not tr or len(tr) <= len(base) else len(tr)
        return [overlay(base[i] if i < len(base) else {}, tr[i] if i < len(tr) else {}) for i in range(n)]
    return tr if tr not in (None, "", [], {}) else base


def tr_path(path):
    """File bản dịch cạnh file gốc: abc.json → abc.en.json, abc.md → abc.en.md."""
    return path.with_name(f"{path.stem}.{LANG}{path.suffix}")


def is_tr_file(path):
    """abc.en.json là file bản dịch (không phải nội dung riêng)."""
    return len(path.suffixes) >= 2 and path.suffixes[-2].lstrip(".") in LANGS


def load_json(path):
    """Đọc file dữ liệu; ngôn ngữ khác: phủ bản dịch nếu có. Trả về (dữ liệu, có bản dịch không)."""
    d = json.loads(path.read_text("utf-8"))
    if IS_VI:
        return d, True
    tp = tr_path(path)
    if not tp.exists():
        return d, False
    return overlay(d, json.loads(tp.read_text("utf-8"))), True


def load_front(path):
    """Như load_json cho bài viết / trang .md: ngôn ngữ khác chỉ lấy bài đã có bản dịch (None = chưa dịch)."""
    if IS_VI:
        return read_front(path)
    tp = tr_path(path)
    if not tp.exists():
        return None
    meta, body = read_front(path)
    m2, b2 = read_front(tp)
    return overlay(meta, m2), (b2 or body)


_A_TAG = re.compile(r"<a\b[^>]*>", re.I)
_A_HREF = re.compile(r'\bhref="([^"]*)"', re.I)


def new_tab(html_text, internal=False):
    """Thêm target="_blank" cho link: luôn với link ra trang ngoài; internal=True thì cả link nội bộ
    (dùng cho nội dung bài viết / mô tả). Bỏ qua link #neo, tel:, mailto:, link đã có target."""
    def fix(m):
        tag = m.group(0)
        h = _A_HREF.search(tag)
        if not h or re.search(r"\b(target|data-lightbox)=", tag, re.I):
            return tag
        href = h.group(1)
        if not href or href.startswith(("#", "tel:", "mailto:", "sms:", "javascript:")):
            return tag
        external = href.startswith(("http://", "https://", "//")) and not href.split("//", 1)[1].startswith(globals().get("DOMAIN", "https://thucduonglanh.vn").split("//", 1)[-1])
        if not (external or internal):
            return tag
        extra = ' target="_blank"' + ("" if re.search(r"\brel=", tag, re.I) else ' rel="noopener"')
        return tag[:-1] + extra + ">"
    return _A_TAG.sub(fix, html_text)


def md(text):
    """Markdown -> HTML (dùng cho nội dung soạn trong trang quản trị). Link trong nội dung mở tab mới."""
    out = _md.markdown(text or "", extensions=["extra", "sane_lists"])
    return new_tab(out.replace("<img ", '<img loading="lazy" '), internal=True)


def md_inline(text):
    out = md(text).strip()
    if out.startswith("<p>") and out.endswith("</p>") and out.count("<p>") == 1:
        out = out[3:-4]
    return out


def read_front(path):
    raw = path.read_text("utf-8")
    meta, body = {}, raw
    if raw.startswith("---"):
        _, fm, body = raw.split("---", 2)
        meta = yaml.safe_load(fm) or {}
    return meta, body.strip()


def num(v):
    try:
        v = int(float(v))
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def _git_dates():
    """Ngày sửa gần nhất của từng file theo lịch sử git (đường dẫn tương đối → "YYYY-MM-DD"), dùng cho lastmod trong sitemap
    và ngày cập nhật bài viết. Bản sao git rút gọn (shallow, chỉ 1 commit) không biết ngày thật → trả {} (bỏ lastmod)."""
    try:
        if subprocess.run(["git", "rev-parse", "--is-shallow-repository"], cwd=ROOT, capture_output=True, text=True, timeout=10).stdout.strip() != "false":
            return {}
        out = subprocess.run(["git", "log", "--format=@%cs", "--name-only", "--no-renames"], cwd=ROOT, capture_output=True, text=True, timeout=60).stdout
    except Exception:
        return {}
    dates, cur = {}, None
    for line in out.splitlines():
        if line.startswith("@"):
            cur = line[1:]
        elif line and cur and line not in dates:
            dates[line] = cur
    return dates


GIT_DATES = _git_dates()


def src_date(*paths):
    """Ngày sửa mới nhất trong các file nguồn (Path hoặc đường dẫn tương đối); không biết thì None."""
    ds = [GIT_DATES.get(str(Path(x).resolve().relative_to(ROOT)) if Path(x).is_absolute() else str(x)) for x in paths]
    return max([d for d in ds if d], default=None)


SITE = {**json.loads((DATA / "config.json").read_text("utf-8")), **load_json(DATA / "site.json")[0]}
HOME = load_json(DATA / "home.json")[0]
_bf = DATA / "brochure.json"
BROCHURE = json.loads(_bf.read_text("utf-8")) if _bf.exists() and IS_VI else {}  # hồ sơ thương hiệu chỉ có bản tiếng Việt
BR_PATH = "/ho-so-thuong-hieu/"
CATS = load_json(DATA / "categories.json")[0]["categories"]
if not IS_VI:
    # Phần chỉ có tiếng Việt (nhóm Zalo, cộng đồng, ebook, cẩm nang): ẩn ở ngôn ngữ khác
    SITE.update(zalo_group="", community=[], community_group="", ebook={}, camnang={})
    SITE["web_offer"] = {**(SITE.get("web_offer") or {}), "gift_enabled": False}

PRODUCTS = []
for f in sorted((CONTENT / "products").glob("*.json")):
    if is_tr_file(f):
        continue
    p0 = json.loads(f.read_text("utf-8"))
    p, has_tr = load_json(f)
    if p.get("published") is False:
        continue
    p["slug"], p["_tr"], p["name_vi"], p["unit_vi"], p["short_vi"] = f.stem, has_tr, p0.get("name", ""), p0.get("unit", ""), p0.get("short_name") or p0.get("name", "")
    p["price"], p["regular_price"] = num(p.get("price")), num(p.get("regular_price"))
    vi_names = [v.get("name") for v in (p0.get("variants") or [])]
    p["variants"] = [{**v, "name_vi": vi_names[i] if i < len(vi_names) else v.get("name"), "price": num(v.get("price")), "regular_price": num(v.get("regular_price")), "servings": num(v.get("servings"))}
                     for i, v in enumerate((p.get("variants") or [])[:len(vi_names)]) if v.get("name")]
    p["servings"] = num(p.get("servings"))  # số gói/phần trong 1 hộp → dòng "≈ …đ/gói" (để trống = không hiện)
    if p["variants"] and p["price"] is None:
        p["price"], p["regular_price"] = p["variants"][0]["price"], p["variants"][0]["regular_price"]
    p["images"] = [i for i in (p.get("images") or []) if i] or ["/assets/img/brand/og-image.jpg"]
    p["summary_md"] = p.get("summary") or ""
    p["summary"] = md_inline(p["summary_md"])
    p["highlights"] = [h for h in (p.get("highlights") or []) if h]
    PRODUCTS.append(p)
# Gói giải pháp / combo (/admin → Gói giải pháp): bán như 1 sản phẩm, gồm nhiều sản phẩm lẻ
for f in sorted((CONTENT / "combos").glob("*.json")) if (CONTENT / "combos").exists() else []:
    if is_tr_file(f):
        continue
    p, has_tr = load_json(f)
    if p.get("published") is False or not [i for i in (p.get("items") or []) if i.get("product")]:
        continue
    p.update(slug=f.stem, _tr=has_tr, name_vi=json.loads(f.read_text("utf-8")).get("name", ""), category="goi-giai-phap", combo=True, variants=[], regular_price=None, price=num(p.get("price")))
    p.setdefault("sku", "COMBO-" + f.stem.upper()[:20])
    p["images"] = [i for i in (p.get("images") or []) if i] or ["/assets/img/brand/og-image.jpg"]
    p["summary_md"] = p.get("summary") or ""
    p["summary"] = md_inline(p["summary_md"])
    p["highlights"] = [h for h in (p.get("highlights") or []) if h]
    PRODUCTS.append(p)
PRODUCTS.sort(key=lambda p: (p.get("order") or 999, p["name"]))

# Ưu đãi chỉ có trên web (Cài đặt → Ưu đãi website): giá nhập trong /admin là giá gốc, web tự giảm X% và gạch giá gốc.
WEB_OFFER = (lambda o: {**o, "enabled_pct": bool(o.get("enabled")), "percent": (num(o.get("percent")) or 0) if o.get("enabled") else 0})(SITE.get("web_offer") or {})


def web_price(x, pct):
    return max(1000, int(x * (100 - pct) // 100000) * 1000)  # làm tròn xuống nghìn: khách luôn được giảm ít nhất X%


def pct_of(raw, default):
    """Ô "Giảm trên web (%)" của sản phẩm / quy cách: để trống = theo mức chung, 0 = không giảm."""
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return max(0, min(90, int(float(raw))))
    except (TypeError, ValueError):
        return default


def apply_web_offer(it, pct):
    """it có price / regular_price. Sản phẩm đang giảm giá riêng: chỉ cộng dồn khi bật stack_sale."""
    it["web_off"] = 0
    if not WEB_OFFER["enabled_pct"] or not pct or not it.get("price"):
        return
    on_sale = it.get("regular_price") and it["regular_price"] > it["price"]
    if on_sale and not WEB_OFFER.get("stack_sale"):
        return
    it["regular_price"] = it["regular_price"] if on_sale else it["price"]
    it["price"] = web_price(it["price"], pct)
    it["web_off"] = 0 if on_sale else pct  # nhãn hiện đúng X% dù giá đã làm tròn xuống


for p in PRODUCTS:
    p["base_price"], p["base_variants"] = p["price"], [dict(v) for v in p["variants"]]
    p["on_sale"] = bool(p.get("regular_price") and p["price"] and p["regular_price"] > p["price"])
    pp = pct_of(p.get("web_discount"), 0 if p.get("combo") else WEB_OFFER["percent"])  # gói: giá gói đã là giá ưu đãi
    apply_web_offer(p, pp)
    for v in p["variants"]:
        apply_web_offer(v, pct_of(v.get("web_discount"), pp))
    p["web_off_max"] = max([p["web_off"]] + [v["web_off"] for v in p["variants"]])


def variant_units(p):
    """Số đơn vị (hộp/lon…) trong từng quy cách, so với quy cách ĐẦU TIÊN (= hộp lẻ, luôn để đầu danh sách):
    "Mua 3 tặng 1" → 4, "Combo 3 hộp" → 3; không đọc được tên thì so số gói (servings) với hộp lẻ; vẫn không ra số nguyên → None.
    Dùng cho nhãn "≈ giá/hộp · Lợi nhất" trên nút quy cách và gợi ý "nâng lên combo" trong giỏ (main.js comboNudge)."""
    import unicodedata
    vs = p.get("variants") or []
    s0 = num(vs[0].get("servings")) if vs else None
    for i, v in enumerate(vs):
        n = unicodedata.normalize("NFC", v.get("name_vi") or v.get("name") or "").lower()
        m, c, u = re.search(r"mua\s*(\d+)\s*tặng\s*(\d+)", n), re.search(r"combo\s*(\d+)", n), None
        if i == 0:
            u = 1
        elif m:
            u = int(m.group(1)) + int(m.group(2))
        elif c:
            u = int(c.group(1))
        elif s0 and num(v.get("servings")) and num(v["servings"]) % s0 == 0:
            u = int(num(v["servings"]) // s0)
        v["units"] = u


for p in PRODUCTS:
    variant_units(p)
_BY_SLUG = {p["slug"]: p for p in PRODUCTS}
for p in PRODUCTS:
    if not p.get("combo"):
        continue
    parts = []
    for it in p.get("items") or []:
        q, qty = _BY_SLUG.get(it.get("product")), max(1, num(it.get("qty")) or 1)
        if not q or q.get("combo"):
            continue
        vi = next((k for k, v in enumerate(q["variants"]) if it.get("variant") and v["name_vi"].strip().lower() == str(it["variant"]).strip().lower()), 0 if q["variants"] else -1)
        base = q["base_variants"][vi]["price"] if vi >= 0 else q["base_price"]
        web = q["variants"][vi]["price"] if vi >= 0 else q["price"]
        unit = q["variants"][vi]["name"] if vi >= 0 else q.get("unit", "")
        unit_vi = q["variants"][vi]["name_vi"] if vi >= 0 else ""
        parts.append({"p": q, "it": it, "qty": qty, "unit": unit, "label_vi": f'{qty} {q["short_vi"]}' + (f' {unit_vi.split("(")[0].strip()}' if vi >= 0 else ""), "base": (base or 0) * qty, "web": (web or 0) * qty, "label": f'{qty} {q.get("short_name") or q["name"]}' + (f' {unit.split("(")[0].strip()}' if vi >= 0 else "")})
    p["parts"] = parts
    p["parts_base"], p["parts_web"] = sum(x["base"] for x in parts), sum(x["web"] for x in parts)
    p["unit"] = t("Gồm ") + " + ".join(x["label"] for x in parts)
    p["unit_vi"] = "Gồm " + " + ".join(x["label_vi"] for x in parts)  # đơn hàng gửi về CRM luôn tiếng Việt
    p["on_sale"] = False
    if p.get("price") and p["parts_base"] > p["price"] and not p["web_off"]:
        p["regular_price"] = p["parts_base"]  # gạch giá gốc mua lẻ
    p["base_price"] = p["price"]
WEB_OFF_MAX = max([p["web_off_max"] for p in PRODUCTS] or [0])
WEB_OFF_SAME = len({p["web_off_max"] for p in PRODUCTS if p["web_off_max"]}) <= 1 and all(p["web_off_max"] for p in PRODUCTS if not p.get("combo"))


def upto(pct):
    return f"{pct}%" if WEB_OFF_SAME else tf("đến {pct}%", pct=pct)
CATS = [c for c in CATS if c.get("slug")]
_cat_slugs = {c["slug"] for c in CATS}
for p in PRODUCTS:
    if p.get("category") not in _cat_slugs:
        p["category"] = CATS[0]["slug"]
# Ngôn ngữ khác: chỉ hiện sản phẩm đã có bản dịch (PRODUCTS). PRODUCTS_ALL vẫn đủ để giỏ hàng / gói không mất món chưa dịch.
PRODUCTS_ALL = PRODUCTS
PRODUCTS = [p for p in PRODUCTS_ALL if p["_tr"]]

_posts = []
for f in sorted((CONTENT / "posts").glob("*.md")):
    if is_tr_file(f) or not (fr := load_front(f)):
        continue
    meta, body = fr
    if meta.get("published") is False:
        continue
    d = meta.get("date") or datetime.date.today()
    d = d.date() if isinstance(d, datetime.datetime) else d
    d = d.isoformat() if isinstance(d, datetime.date) else str(d)[:10]
    _posts.append({"slug": f.stem, "title": meta.get("title", f.stem), "date": d, "category": meta.get("category", ""), "modified": max(d, src_date(f, tr_path(f)) or d),
                   "image": meta.get("image") or "/assets/img/brand/og-image.jpg", "excerpt": meta.get("excerpt", ""), "content": md(body)})
POSTS = {"categories": load_json(DATA / "post-categories.json")[0]["categories"], "posts": _posts}

PAGES = []
for f in (CONTENT / "pages").glob("*.md"):
    if is_tr_file(f) or not (fr := load_front(f)):
        continue
    meta, body = fr
    if not IS_VI and meta.get("url_slug"):
        PAGE_SLUGS[f.stem] = re.sub(r"[^a-z0-9-]+", "-", str(meta["url_slug"]).lower()).strip("-")
    PAGES.append({"slug": f.stem, "title": meta.get("title", f.stem), "order": meta.get("order", 99), "content": md(body)})
PAGES.sort(key=lambda x: (x["order"], x["title"]))

_nf = DATA / "needs.json"  # "Chọn theo nhu cầu" (Cài đặt → Chọn theo nhu cầu); sản phẩm gắn ở ô "Nhu cầu"
NEEDS = [n for n in (load_json(_nf)[0].get("needs") or [] if _nf.exists() else []) if n.get("slug") and n.get("name")]
for n in NEEDS:
    n["items"] = [p for p in PRODUCTS if n["slug"] in (p.get("needs") or [])]
    n["url"] = f'/san-pham/{n["items"][0]["slug"]}/' if len(n["items"]) == 1 else f'/nhu-cau/{n["slug"]}/'  # 1 sản phẩm → vào thẳng trang sản phẩm
NEEDS = [n for n in NEEDS if n["items"]]
CAT_BY = {c["slug"]: c for c in CATS}
PROD_BY = {p["slug"]: p for p in PRODUCTS_ALL}
PCATS = {c["slug"]: c for c in POSTS["categories"]}
VERSION = datetime.datetime.now().strftime("%Y%m%d%H%M")
DOMAIN = SITE["domain"].rstrip("/")
BRAND = SITE["brand"]

_IMG_CACHE = {}


def img_url(src, width=1000):
    """Trả về ảnh WebP đã tối ưu (tự tạo nếu ảnh gốc lớn hoặc không phải WebP)."""
    if not src or src.startswith("http"):
        return src or ""
    key = (src, width)
    if key in _IMG_CACHE:
        return _IMG_CACHE[key]
    path = ROOT / src.lstrip("/")
    result = src
    if path.exists():
        stem = path.with_suffix("")
        sm = Path(str(stem) + "-sm.webp")
        if width <= 600 and sm.exists():
            result = "/" + sm.relative_to(ROOT).as_posix()
        else:
            try:
                from PIL import Image
                with Image.open(path) as im:
                    ok = path.suffix.lower() == ".webp" and im.width <= width * 1.25 and path.stat().st_size < 400_000
                    if not ok:
                        h = hashlib.md5((src + str(path.stat().st_mtime)).encode()).hexdigest()[:8]
                        name = re.sub(r"[^a-z0-9-]+", "-", stem.name.lower()).strip("-")[:50] or "img"
                        out = DIST / "assets/img/auto" / f"{name}-{h}-{width}.webp"
                        if not out.exists():
                            out.parent.mkdir(parents=True, exist_ok=True)
                            im2 = im.convert("RGBA")
                            bg = Image.new("RGB", im2.size, "#ffffff")
                            bg.paste(im2, mask=im2.getchannel("A"))
                            bg.thumbnail((width, width), Image.LANCZOS)
                            bg.save(out, "WEBP", quality=82, method=6)
                        result = "/" + out.relative_to(DIST).as_posix()
            except Exception as e:
                print("  ! Không xử lý được ảnh", src, e)
    else:
        print("  ! Thiếu ảnh:", src)
    _IMG_CACHE[key] = result
    return result


def esc(s):
    return html.escape(str(s or ""), quote=True)


def strip_tags(s):
    return re.sub(r"<[^>]+>", "", s or "")


def money(n):
    if n is None:
        return t("Liên hệ")
    return f"{int(n):,}".replace(",", "." if IS_VI else ",") + " ₫"  # tiếng Anh: 189,000 ₫ (dấu chấm dễ đọc nhầm thành số lẻ)


def pimg(src, small=False):
    return img_url(src, 480 if small else 1000)


def tel(s):
    return re.sub(r"\D", "", s or "")


def fill(s):
    return (s.replace("{brand}", BRAND).replace("{company}", SITE["company"])
             .replace("{hotline}", SITE["hotline"]).replace("{email}", SITE["email"])
             .replace("{address}", SITE["address"]).replace("{domain}", DOMAIN)
             .replace("<p>{uu_dai_web}</p>", uu_dai_html()).replace("{uu_dai_web}", uu_dai_html()))


def uu_dai_html():
    """Danh sách ưu đãi web cho trang nội dung (chèn bằng {uu_dai_web} trong bài / trang chính sách)."""
    w, out = WEB_OFFER, []
    if w.get("headline"):
        out.append(f"<li><strong>{esc(w['headline'])}.</strong></li>")
    if WEB_OFF_MAX:
        out.append(f"<li><strong>{t('Một số sản phẩm giảm thêm ') if w.get('headline') else t('Giảm ')}{upto(WEB_OFF_MAX)}</strong>{t(' khi đặt trên website (mức giảm ghi ở từng sản phẩm, đã trừ trực tiếp vào giá).')}</li>")
    if w.get("gift_enabled") and w.get("gift_title"):
        link = f' – <a href="{ZALO_GATE}?tu=uu_dai">{t("tham gia tại đây")}</a>' if SITE.get("zalo_group") and w.get("gift_how") else ""
        out.append(f"<li><strong>{t('Tặng')} {esc(w['gift_title'])}</strong>" + (f" {t('trị giá')} {esc(w['gift_value'])}" if w.get("gift_value") else "") + (f" {esc(w['gift_how'])}" if w.get("gift_how") else "") + link + ".</li>")
    return f'<ul class="uu-dai">{"".join(out)}</ul>' if out else ""


def discount(p):
    if p.get("web_off"):
        return p["web_off"]
    if p.get("price") and p.get("regular_price") and p["regular_price"] > p["price"]:
        return round((1 - p["price"] / p["regular_price"]) * 100)
    return 0


def zalo_link(text=""):
    return f"https://zalo.me/{tel(SITE['zalo'])}"


# ---------------------------------------------------------------- icons
I = {
    "phone": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>',
    "search": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    "cart": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"/><circle cx="10" cy="20.5" r="1.3"/><circle cx="17" cy="20.5" r="1.3"/></svg>',
    "heart": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.6 4.5 7.1 4.5c2 0 3.5 1.1 4.9 2.8 1.4-1.7 2.9-2.8 4.9-2.8 3.5 0 5.6 3.5 4.4 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>',
    "menu": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    "close": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    "down": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    "right": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    "left": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
    "globe": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/></svg>',
    "check": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    "bolt": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
    "truck": '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M4 12h24v20H4zM28 19h8l6 7v6H28z"/><circle cx="13" cy="35" r="4" fill="#fff"/><circle cx="35" cy="35" r="4" fill="#fff"/></svg>',
    "leaf": '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M40 8C18 8 8 18 8 32c0 3 1 6 2 8 2-10 9-17 18-20-8 5-13 12-15 21 20 2 27-13 27-33z"/></svg>',
    "shield": '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M24 4 8 10v12c0 10 7 18 16 22 9-4 16-12 16-22V10z"/><path d="m16 24 6 6 10-12" stroke-linecap="round"/></svg>',
    "chat": '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M8 10h32v22H22l-9 7v-7H8z"/><path d="M16 20h16M16 26h10" stroke-linecap="round"/></svg>',
    "return": '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18H34a8 8 0 0 1 0 16H18"/><path d="m20 11-7 7 7 7"/></svg>',
    "wallet": '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><rect x="6" y="12" width="36" height="26" rx="4"/><path d="M32 22h10v8H32a4 4 0 0 1 0-8zM10 12l20-6 3 6"/></svg>',
    "pin": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
    "mail": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    "clock": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" stroke-linecap="round"/></svg>',
    "play": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    "zoom": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/></svg>',
    "up": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
    "trash": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    "facebook": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 21v-7.5H16l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.5V4.4a20 20 0 0 0-2.3-.1c-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.4V21z"/></svg>',
    "tiktok": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 3c.3 2.2 1.6 3.6 3.9 3.8v2.6c-1.4.1-2.6-.3-3.9-1.1v5.9c0 7.4-8.1 9.7-11.3 4.4-2.1-3.4-.8-9.4 5.9-9.6v2.8c-.5.1-1 .2-1.5.4-1.5.5-2.3 1.4-2.1 3 .5 3.1 6.2 4 5.7-2V3z"/></svg>',
    "youtube": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.3 5 12 5 12 5s-6.3 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.7 19 12 19 12 19s6.3 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z"/></svg>',
    "shopee": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5a4 4 0 0 0-4 4H4.3l1.1 13a2 2 0 0 0 2 1.8h9.2a2 2 0 0 0 2-1.8l1.1-13H16a4 4 0 0 0-4-4zm0 1.6a2.4 2.4 0 0 1 2.4 2.4H9.6A2.4 2.4 0 0 1 12 4.1zm.1 5.4c1.4 0 2.4.6 2.8 1l-.7 1c-.5-.4-1.2-.7-2-.7-.9 0-1.4.4-1.4.9 0 1.5 4.4.8 4.4 3.8 0 1.4-1.2 2.5-3.1 2.5-1.3 0-2.4-.5-3.2-1.1l.7-1.1c.7.5 1.6.9 2.5.9 1 0 1.6-.4 1.6-1.1 0-1.6-4.4-.9-4.4-3.8 0-1.3 1.2-2.3 2.8-2.3z"/></svg>',
    "zalo": '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#0068ff"/><text x="24" y="30" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="15" fill="#fff">Zalo</text></svg>',
    "lazada": '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 3 7v10l9 5 9-5V7zm0 2.3L18.8 8 12 11.7 5.2 8z"/></svg>',
}


def ic(name, cls="ic"):
    return f'<span class="{cls}" aria-hidden="true">{I[name]}</span>'


# ---------------------------------------------------------------- layout
HAS_SALE = any(p["on_sale"] for p in PRODUCTS)  # chỉ khuyến mãi riêng, không tính ưu đãi web
SALE_NAV = [(t("Khuyến Mãi"), "/khuyen-mai/", [])] if HAS_SALE else []
NAV = [
    (t("Trang Chủ"), "/", []),
    (t("Giới Thiệu"), "/gioi-thieu/", [(t("Câu chuyện thương hiệu"), "/gioi-thieu/", []), (t("Hồ sơ thương hiệu"), BR_PATH, [])] if BROCHURE else []),
    (t("Sản Phẩm"), "/san-pham/", [(c["name"], f"/danh-muc/{c['slug']}/", []) for c in CATS] + SALE_NAV),
    (t("Góc Sống Lành"), "/goc-song-lanh/", [(c["name"], f"/goc-song-lanh/chuyen-muc/{c['slug']}/", []) for c in POSTS["categories"] if any(p["category"] == c["slug"] for p in POSTS["posts"]) or IS_VI]),
    (t("Liên Hệ"), "/lien-he/", []),
]
if not POSTS["posts"] and not IS_VI:
    NAV = [x for x in NAV if x[1] != "/goc-song-lanh/"]  # ngôn ngữ khác chưa có bài viết nào thì ẩn mục
if (SITE.get("camnang") or {}).get("url") or (SITE.get("ebook") or {}).get("url"):
    NAV.insert(-1, ("Quà Tặng", "/qua-tang/", [("🎁 Tất cả quà tặng", "/qua-tang/", [])] + ([("📖 Cẩm nang sống khỏe", SITE["camnang"]["url"], [])] if (SITE.get("camnang") or {}).get("url") else []) + ([("🦴 Ebook cơ xương khớp", SITE["ebook"]["url"], [])] if (SITE.get("ebook") or {}).get("url") else [])
                    + ([("🖐 Trò chơi: Bạn còn mấy ngón tay?", "/ngon-tay-song-lanh/", []), ("🌱 Tôi chọn sống lành", "/toi-chon-song-lanh/", [])] if IS_VI else [])))  # trang gom quà tặng + trò chơi + lời cam kết (17/10/2026)


def nav_html(active, cls):
    out = [f'<ul class="{cls}">']
    for label, href, children in NAV:
        is_active = (active == href) or (href != "/" and active.startswith(href)) or (
            href == "/san-pham/" and (active.startswith("/danh-muc/") or active.startswith("/khuyen-mai/")))
        a_cls = ' class="' + " ".join(c for c in ("active" if is_active else "", "nav-gift" if href == "/qua-tang/" else "") if c) + '"' if is_active or href == "/qua-tang/" else ""
        if children:
            out.append(f'<li class="has-sub"><a href="{href}"{a_cls}>{label}{ic("down","caret")}</a>'
                       f'<button class="sub-toggle" aria-label="{t("Mở menu con")}">{I["down"]}</button><ul class="sub">')
            for cl, ch, _ in children:
                out.append(f'<li><a href="{ch}">{esc(cl)}</a></li>')
            out.append("</ul></li>")
        else:
            out.append(f'<li><a href="{href}"{a_cls}>{"🎁 " if href == "/qua-tang/" else ""}{label}</a></li>')
    out.append("</ul>")
    return "".join(out)


def header(active):
    hot2 = f' - <a href="tel:{tel(SITE["hotline2"])}">{esc(SITE["hotline2"])}</a>' if SITE.get("hotline2") else ""
    offer = ""
    if WEB_OFFER.get("headline"):
        offer = f'<span class="tb-offer">🎁 <span class="tb-long">{esc(WEB_OFFER["headline"])}</span><span class="tb-short">{esc(WEB_OFFER.get("headline_short") or WEB_OFFER["headline"])}</span></span><span>&nbsp;·&nbsp;</span>'
    elif WEB_OFF_MAX:
        offer = f'<span class="tb-offer">🎁 {t("Giảm")} {upto(WEB_OFF_MAX)} <span class="tb-long">{t("khi đặt trên website")}</span><span class="tb-short">{t("khi đặt trên web")}</span></span><span>&nbsp;·&nbsp;</span>'
    free = ""
    if SITE.get('free_ship_threshold') and SITE.get('shipping_fee'):
        free = f'<span class="tb-free">🚚 <span class="tb-long">{t("Miễn phí vận chuyển đơn")}</span><span class="tb-short">Freeship</span> {t("từ")} ' + money(SITE['free_ship_threshold']).replace(' ₫', 'đ') + '</span><span class="tb-hot">&nbsp;·&nbsp;</span>'
    blank = ' target="_blank" rel="noopener"' if SITE.get("community_group") else ""
    community = f'<a href="{esc(SITE.get("community_group") or "/goc-song-lanh/")}"{blank}>{t("Cộng Đồng Sống Khỏe")} {ic("globe","ic ic-sm")}</a>' if IS_VI or SITE.get("community_group") else ""
    return f'''
<div class="topbar"><div class="container topbar-in">
  <div class="tb-left">{offer}{free}<span class="tb-hot">Hotline {BRAND}: {ic("phone","ic ic-sm")} <a href="tel:{tel(SITE["hotline"])}">{esc(SITE["hotline"])}</a>{hot2}</span></div>
  <div class="tb-right">{community}</div>
</div></div>
<header class="site-header" id="siteHeader"><div class="container header-in">
  <button class="icon-btn burger" id="burger" aria-label="{t("Mở menu")}" aria-expanded="false" aria-controls="offcanvas">{I["menu"]}</button>
  <a class="logo" href="/" aria-label="{BRAND} – {t("Trang chủ")}"><img src="/assets/img/brand/logo.webp" srcset="/assets/img/brand/logo.webp 1x, /assets/img/brand/logo@2x.webp 2x" width="{LOGO_W}" height="180" alt="Logo {BRAND}"></a>
  <nav class="main-nav" aria-label="{t("Menu chính")}">{nav_html(active, "menu")}</nav>
  <div class="header-icons">
    {music_btn()}<button class="icon-btn" id="searchOpen" aria-label="{t("Tìm kiếm")}" aria-expanded="false" aria-controls="searchLayer">{I["search"]}</button>
    <a class="icon-btn" href="/gio-hang/" id="cartOpen" aria-label="{t("Giỏ hàng")}">{I["cart"]}<span class="count" data-cart-count>0</span></a>
    <a class="icon-btn hide-sm" href="/yeu-thich/" aria-label="{t("Sản phẩm yêu thích")}">{I["heart"]}<span class="count" data-wish-count>0</span></a>
    <!--ALT-SW-->
  </div>
</div></header>
<div class="offcanvas" id="offcanvas" aria-hidden="true"><div class="oc-panel">
  <div class="oc-head"><img src="/assets/img/brand/logo.webp" alt="{BRAND}" height="56"><button class="icon-btn" data-oc-close aria-label="{t("Đóng")}">{I["close"]}</button></div>
  {nav_html(active, "oc-menu")}
  {f'<a class="oc-zalo" href="{ZALO_GATE}?tu=menu" data-cta="zalo_group_menu">{I["zalo"]}<span><b>Nhóm Zalo Sống khỏe</b>{(esc(WEB_OFFER["gift_title"]) + (" – trị giá " + esc(WEB_OFFER["gift_value"]) if WEB_OFFER.get("gift_value") else "") + " 🎁 tặng thành viên") if WEB_OFFER.get("gift_enabled") and WEB_OFFER.get("gift_title") else "Tham gia miễn phí – chia sẻ món lành, ưu đãi thành viên"}</span></a>' if SITE.get("zalo_group") else ""}
  <div class="oc-foot">{f'<a href="/qua-tang/?tu=menu" data-cta="gift_menu">🎁 Nhận quà tặng miễn phí</a>' if gift_list() else ""}<a href="/yeu-thich/">{ic("heart")} {t("Sản phẩm yêu thích")}</a><a href="tel:{tel(SITE["hotline"])}">{ic("phone")} {esc(SITE["hotline"])}</a><!--ALT-OC--></div>
</div></div>
<div class="search-layer" id="searchLayer" aria-hidden="true"><div class="search-box">
  <form action="/tim-kiem/" method="get" role="search"><span class="s-ic">{I["search"]}</span><input type="search" name="q" id="searchInput" placeholder="{t("Tìm sản phẩm...")}" autocomplete="off" aria-label="{t("Tìm sản phẩm")}"><button type="button" class="icon-btn" data-search-close aria-label="{t("Đóng")}">{I["close"]}</button></form>
  <div class="search-results" id="searchResults"></div>
</div></div>'''


def social_links(cls="socials"):
    items = []
    names = {"shopee": "Shopee", "lazada": "Lazada", "tiktok_shop": "TikTok Shop", "facebook": "Facebook", "tiktok": "TikTok", "youtube": "YouTube"}
    icons = {"tiktok_shop": "tiktok"}
    for k, url in SITE["socials"].items():
        if url and k not in ("shopee", "lazada", "tiktok_shop"):  # sàn TMĐT: không dẫn khách khỏi web (phí sàn cao)
            items.append(f'<a class="s-{k}" href="{esc(url)}" target="_blank" rel="noopener" aria-label="{names.get(k,k)}" title="{names.get(k,k)}">{I[icons.get(k,k)]}</a>')
    items.append(f'<a class="s-zalo" href="{esc(SITE.get("zalo_oa") or zalo_link())}" target="_blank" rel="noopener" aria-label="Zalo OA" title="Zalo OA">{I["zalo"]}</a>')
    return f'<div class="{cls}">' + "".join(items) + "</div>"


def slogan_html():
    """Slogan chân trang: mỗi cụm không bị ngắt giữa chừng khi xuống dòng."""
    return " · ".join(f"<span>{esc(x.strip())}</span>" for x in re.split(r"\s*[–-]\s*", SITE["slogan"]) if x.strip())


def footer():
    support = "".join(f'<li><a href="/{p["slug"]}/">{esc(p["title"])}</a></li>' for p in PAGES)
    about = "".join(f'<li><a href="{h}">{l}</a></li>' for l, h, _ in NAV)
    if BROCHURE:
        about = about.replace('<li><a href="/gioi-thieu/">Giới Thiệu</a></li>', f'<li><a href="/gioi-thieu/">Giới Thiệu</a></li><li><a href="{BR_PATH}">Hồ sơ thương hiệu</a></li>')
    bct = f'<a href="{esc(SITE["bo_cong_thuong_url"])}" target="_blank" rel="noopener" class="bct"><img src="/assets/img/brand/bo-cong-thuong.png" alt="{t("Đã thông báo Bộ Công Thương")}" width="150" loading="lazy"></a>' if SITE.get("bo_cong_thuong_url") else ""
    if IS_VI:
        about += '<li><a href="https://congsu.thucduonglanh.vn/" target="_blank" rel="noopener">Tuyển dụng</a></li>'
    year = datetime.date.today().year
    return f'''
<footer class="site-footer">
  <div class="container footer-grid">
    <div class="f-col f-brand">
      <a href="/" class="f-logo"><img src="/assets/img/brand/logo-gold-footer.webp" alt="{BRAND}" width="220" height="160" loading="lazy"></a>
      <p class="f-slogan">{slogan_html()}</p>
      <p class="f-company">{esc(SITE["company"])}</p>
      <p>{tf("Giấy chứng nhận đăng ký doanh nghiệp số {code} đăng ký lần đầu ngày {date}", code=esc(SITE["tax_code"]), date=esc(SITE["tax_date"]))}</p>
      {bct}
    </div>
    <div class="f-col"><h4>{t("Về chúng tôi")}</h4><ul>{about}</ul></div>
    <div class="f-col f-contact"><h4>{t("Văn phòng")}</h4>
      <p><b>{tf("Địa chỉ {brand}:", brand=BRAND)}</b><br>{esc(SITE["address"])}</p>
      <p><b>Email:</b><br><a href="mailto:{esc(SITE["email"])}">{esc(SITE["email"])}</a></p>
      <p><b>{t("Số điện thoại:")}</b><br><a href="tel:{tel(SITE["hotline"])}">{esc(SITE["hotline"])}</a></p>
      <p><b>{t("Giờ làm việc:")}</b><br>{esc(SITE["opening_hours"])}</p>
    </div>
    <div class="f-col"><h4>{t("Hỗ trợ")}</h4><ul>{support}</ul></div>
  </div>
  <div class="container f-social"><h4>{t("Kết nối với chúng tôi")}</h4>{social_links()}</div>
  <div class="f-bottom"><div class="container">© Copyright {year} {BRAND} | {t("Đã đăng ký bản quyền")}</div></div>
</footer>
{float_widget()}
{gift_popup()}
<div class="minicart" id="minicart" aria-hidden="true"><div class="mc-panel">
  <div class="mc-head"><h3>{t("Giỏ hàng")}</h3><button class="icon-btn" data-mc-close aria-label="{t("Đóng")}">{I["close"]}</button></div>
  <div class="mc-body" id="mcBody"></div>
  <div class="mc-foot"><div id="mcHint"></div><div class="mc-total"><span>{t("Tạm tính")}</span><b id="mcTotal">0 ₫</b></div>
  <a href="/gio-hang/" class="btn btn-outline btn-block">{t("Xem giỏ hàng")}</a><a href="/thanh-toan/" class="btn btn-block">{t("Thanh toán")}</a></div>
</div></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<div class="cookie-bar" id="cookieBar" hidden role="dialog" aria-label="{t("Thông báo cookie")}"><p><span class="cb-long">{t('🍪 Anh/chị cho phép dùng cookie nhé? Nhờ đó Thực Dưỡng Lành gợi ý sản phẩm, ưu đãi hợp với anh/chị (cả trên Facebook, Google) và làm website tốt hơn. <a href="/chinh-sach-bao-mat/">Chi tiết</a>')}</span><span class="cb-short">{t('🍪 Cho phép cookie để gợi ý sản phẩm, ưu đãi hợp với anh/chị (cả trên Facebook, Google)? <a href="/chinh-sach-bao-mat/">Chi tiết</a>')}</span></p><div><button type="button" class="btn btn-sm cb-yes" data-consent="yes">{t("Đồng ý")}</button><button type="button" class="cb-no" data-consent="no">{t("Không, cảm ơn")}</button></div></div>
<button class="to-top" id="toTop" aria-label="{t("Lên đầu trang")}">{I["up"]}</button>{gift_dock()}'''


def music_tracks():
    """Nhạc nền (data/site.json → music, /admin → Cài đặt): các bài đang bật, theo thứ tự trong danh sách. Tắt cả mục → rỗng."""
    m = SITE.get("music") or {}
    if not m.get("enabled"):
        return []
    out = []
    for x in m.get("tracks") or []:
        f = (x.get("file") or "").strip()
        if not f or x.get("on", True) is False:
            continue
        if re.search(r"drive\.google\.com|docs\.google\.com", f):  # Drive không cho web khác phát thẳng → bỏ qua để khỏi mất nhạc
            print(f"⚠️ Nhạc nền: bỏ qua bài '{x.get('title')}' vì là link Google Drive (phải tải file lên /admin)")
            continue
        out.append({"t": x.get("title") or "", "src": f})
    return out


def music_btn():
    """Nút ♪ bật/tắt nhạc nền trên đầu trang (main.js initMusic). Không có bài → không có nút."""
    if not music_tracks():
        return ""
    note = '<svg class="mu-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M3 3l18 18"/></svg>'
    eq = '<span class="mu-on" aria-hidden="true"><i></i><i></i><i></i><i></i></span>'
    return f'<button class="icon-btn mu-btn" id="muBtn" type="button" aria-pressed="false" aria-label="{t("Bật nhạc nền")}" title="{t("Nhạc nền")}">{note}{eq}</button>'


def float_widget():
    # Hộp tư vấn góc phải (23/10/2026): ít lựa chọn cho khách dễ chọn. Câu chào tự đổi + các nút sửa ở /admin → Cài đặt website → Hộp tư vấn nổi (data/site.json float_chat).
    fc = (SITE.get("float_chat") or {}) if IS_VI else {}  # bản dịch chưa có câu chào riêng → giữ 1 câu dịch sẵn + sản phẩm nổi bật
    links = [x for x in (fc.get("links") or []) if x.get("label") and x.get("url")]
    if links:
        chips = "".join(f'<a class="fw-chip" href="{esc(x["url"])}" data-cta="float_chip">{esc(x["label"])}</a>' for x in links)
    else:
        chips = "".join(f'<a class="fw-chip" href="/san-pham/{p["slug"]}/">{esc(p.get("short_name") or p["name"])}</a>' for p in PRODUCTS if p.get("featured"))
    msgs = [m.strip() for m in (fc.get("messages") or []) if m and m.strip()] or [t("Anh/chị đang tìm hiểu sản phẩm nào ạ? Em sẵn sàng tư vấn ngay cho anh/chị nhé!")]
    rot = f' data-fw-msgs="{esc(json.dumps(msgs, ensure_ascii=False))}" data-fw-sec="{max(3, int(fc.get("seconds") or 7))}"' if len(msgs) > 1 else ""
    return f'''
<div class="float-widget" id="floatWidget">
  <div class="fw-pop" id="fwPop">
    <button class="fw-x" id="fwClose" aria-label="{t("Ẩn")}">{I["close"]}</button>
    <div class="fw-msg"><div class="fw-name"><img src="/assets/img/brand/emblem.png" alt="" width="22" height="22">{BRAND}</div>
    <p class="fw-say" aria-live="polite"{rot}>{esc(msgs[0])}</p></div>
    <div class="fw-chips">{f'<a class="fw-chip fw-gift" href="{esc(CN_PATH)}?tu=float" data-cta="camnang_float">🎁 Nhận cẩm nang sống khỏe</a>' if CN_PATH else f'<a class="fw-chip fw-gift" href="{esc(ebook_href("float"))}"{ebook_target()} data-cta="ebook_float">🎁 Nhận ebook miễn phí</a>' if ebook_href("float") else ""}{chips}<a class="fw-chip" href="{zalo_link()}" target="_blank" rel="noopener">{t("Liên hệ tư vấn")}</a></div>
  </div>
  <a class="fw-btn fw-phone" href="tel:{tel(SITE["hotline"])}" aria-label="{t("Gọi")} {esc(SITE["hotline"])}">{I["phone"]}<span class="fw-tx">{t("Gọi")} {esc(SITE["hotline"])}</span></a>
  <a class="fw-btn fw-zalo" href="{zalo_link()}" target="_blank" rel="noopener" aria-label="Chat Zalo">{I["zalo"]}<span class="fw-tx">{t("Nhắn Zalo")}</span></a>
  <button type="button" class="fw-dial" id="fwDial" aria-expanded="false"><span class="fw-d-on">💬 {t("Tư vấn")}</span><span class="fw-d-off">✕ {t("Đóng")}</span></button>
  <button class="fw-btn fw-main" id="fwToggle" aria-label="{t("Mở hộp tư vấn")}"><img src="/assets/img/brand/icon-180.png" alt="" width="56" height="56"></button>
</div>'''


def layout(path, title, desc, body, og=None, jsonld=None, body_class="", noindex=False, preload="", og_type="website", extra_head=""):
    full_title = title if BRAND in title else f"{title} | {BRAND}"
    url = DOMAIN + path
    og_img = DOMAIN + (og or "/assets/img/brand/og-image.jpg")
    ld = ""
    for block in (jsonld or []):
        ld += '<script type="application/ld+json">' + json.dumps(block, ensure_ascii=False) + "</script>"
    robots = '<meta name="robots" content="noindex,follow">' if noindex else ""
    alt_links = "" if noindex else alt_head(path) if IS_VI else "<!--ALT-HEAD-->"
    page = f'''<!doctype html>
<html lang="{LANG}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(full_title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{url}">{alt_links}{robots}{f'<link rel="preload" as="image" href="{preload}" fetchpriority="high">' if preload else ""}
<meta property="og:type" content="{og_type}"><meta property="og:site_name" content="{BRAND}">{extra_head}
<meta property="og:title" content="{esc(full_title)}"><meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{url}"><meta property="og:image" content="{og_img}"><meta property="og:locale" content="{LANGS[LANG]["locale"]}">
{f'<meta name="google-site-verification" content="{esc(SITE["google_site_verification"])}">' if SITE.get("google_site_verification") and path == "/" else ""}{f'<meta name="msvalidate.01" content="{esc(SITE["bing_site_verification"])}">' if SITE.get("bing_site_verification") and path == "/" else ""}
<meta name="theme-color" content="#24805B">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/img/brand/icon-32.png">
<link rel="apple-touch-icon" href="/assets/img/brand/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,600;1,500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/style.css?v={VERSION}">
{ld}
</head>
<body class="{body_class}">
<a class="skip" href="#main">{t("Bỏ qua đến nội dung")}</a>
{header(path)}
<main id="main">
{body}
</main>
{footer()}
<script src="/assets/js/{DATA_JS}?v={VERSION}"></script>
<script src="/assets/js/main.js?v={VERSION}" defer></script>
</body>
</html>'''
    if IS_VI:
        page = page.replace("<!--ALT-SW-->", alt_switch(path, "sw")).replace("<!--ALT-OC-->", alt_switch(path, "oc"))
    return page


# ---------------------------------------------------------------- liên kết giữa các ngôn ngữ
DATA_JS = "data.js" if IS_VI else f"data-{LANG}.js"
ALT_ROUTES = {}  # {mã ngôn ngữ: {đường dẫn tiếng Việt: đường dẫn ngôn ngữ đó}} – bản tiếng Việt đọc từ kết quả dựng các ngôn ngữ khác


def alt_url(lang, vi_path):
    """Trang tương ứng ở ngôn ngữ khác; chưa có bản dịch → trang chủ ngôn ngữ đó."""
    if lang == DEFAULT_LANG:
        return vi_path
    if lang == LANG:
        return lp(vi_path)
    return ALT_ROUTES.get(lang, {}).get(vi_path) or lp("/", lang)


def has_alt(lang, vi_path):
    return lang == DEFAULT_LANG or lang == LANG or vi_path in ALT_ROUTES.get(lang, {})


def alt_head(vi_path):
    """<link hreflang> cho Google: mỗi trang khai báo các bản ngôn ngữ đang có."""
    langs = [l for l in LANGS if has_alt(l, vi_path)]
    if len(langs) < 2:
        return ""
    out = "".join(f'<link rel="alternate" hreflang="{l}" href="{DOMAIN}{alt_url(l, vi_path)}">' for l in langs)
    return out + f'<link rel="alternate" hreflang="x-default" href="{DOMAIN}{vi_path}">'


def alt_switch(vi_path, where):
    """Nút đổi ngôn ngữ: "sw" = nút nhỏ trên thanh đầu trang (VI / EN), "oc" = dòng trong menu điện thoại."""
    out = ""
    for l, meta in LANGS.items():
        if l == LANG:
            continue
        href = esc(alt_url(l, vi_path))
        if where == "sw":
            out += f'<a class="icon-btn lang-btn" href="{href}" hreflang="{l}" lang="{l}" title="{esc(meta["name"])}" data-cta="lang_{l}">{meta["short"]}</a>'
        else:
            out += f'<a href="{href}" hreflang="{l}" lang="{l}" data-cta="lang_{l}">{ic("globe")} {esc(meta["name"])}</a>'
    return out


# ---------------------------------------------------------------- components
def card_item(p):
    """Giá hiện trên thẻ: quy cách rẻ nhất (thẻ ghi "Từ …") hoặc chính sản phẩm."""
    vs = [v for v in p.get("variants", []) if v.get("price") is not None]
    return min(vs, key=lambda v: v["price"]) if len(vs) > 1 else p


def per_serving(it, p=None):
    """Dòng neo giá "≈ 22.500đ/gói" khi biết số gói/phần trong hộp (làm tròn 500đ)."""
    n, price = it.get("servings"), it.get("price")
    if not n or not price:
        return ""
    unit = it.get("serving_unit") or (p or it).get("serving_unit") or t("phần")
    return f'≈ {money(round(price / n / 500) * 500).replace(" ₫", "đ")}/{esc(unit)}'


def price_html(p, cls="price", from_=False, off=False):
    if from_ and len([v for v in p.get("variants", []) if v.get("price") is not None]) > 1:
        v = card_item(p)
        old = f'<del>{money(v["regular_price"])}</del>' if discount(v) else ""
        return f'<div class="{cls}"><span class="from">{t("Từ")}</span>{old}<ins>{money(v["price"])}</ins></div>'
    if p.get("price") is None:
        return f'<div class="{cls}"><ins class="contact">{t("Liên hệ")}</ins></div>'
    d = discount(p)
    old = f'<del>{money(p["regular_price"])}</del>' if d else ""
    tag = f'<span class="p-off">-{d}%</span>' if d and off else ""
    return f'<div class="{cls}">{old}<ins>{money(p["price"])}</ins>{tag}</div>'


CHIP_RE = re.compile(r"^(không |thuần chay|đường cỏ ngọt|ít đường|no |non-|free |vegan|plant-based|stevia|low sugar|less sugar)", re.I)


def card_chips(p):
    """Chip thuộc tính trên thẻ sản phẩm: chỉ lấy từ "Huy hiệu chứng nhận" đã nhập trong /admin (vd Thuần chay, Không đường tinh luyện), tối đa 2."""
    out = []
    for b in p.get("badges") or []:
        c = re.split(r"\s*[(,–]", (b or "").strip())[0].strip()  # chip ngắn: bỏ phần giải thích sau ( , –
        if c and CHIP_RE.match(c) and not c.lower().startswith(("không phát hiện", "not detected", "no detect")) and len(c) <= 28:
            out.append(c)
    return out[:2]


def product_card(p, lazy=True):
    d = discount(card_item(p))
    badge = f'<span class="badge-sale">-{d}%</span>' if d else (f'<span class="badge-tag">{esc(p["badge"])}</span>' if p.get("badge") else "")
    loading = ' loading="lazy"' if lazy else ""
    img2 = p["images"][1] if len(p["images"]) > 1 else p["images"][0]
    if p.get("price") is not None and not p.get("variants"):
        action = f'<button class="pc-add" data-add="{p["slug"]}" aria-label="{tf("Thêm {name} vào giỏ", name=esc(p["name"]))}">{I["cart"]}<span>{t("Thêm vào giỏ")}</span></button>'
    else:
        label = t("Chọn loại") if p.get("variants") and p.get("price") is not None else t("Xem chi tiết")
        pick = f' data-pick="{p["slug"]}"' if p.get("variants") and p.get("price") is not None else ""  # main.js: mở khung chọn loại + thêm vào giỏ ngay tại chỗ
        action = f'<a class="pc-add" href="/san-pham/{p["slug"]}/"{pick}>{I["right"]}<span>{label}</span></a>'
    return f'''<article class="p-card">
  <a class="pc-media" href="/san-pham/{p["slug"]}/" aria-label="{esc(p["name"])}">
    {badge}
    <img class="pc-img" src="{pimg(p["images"][0], True)}" alt="{esc(p["name"])}" width="480" height="480"{loading}>
    <img class="pc-img2" src="{pimg(img2, True)}" alt="" width="480" height="480" loading="lazy">
  </a>
  <button class="pc-wish" data-wish="{p["slug"]}" aria-label="{t("Yêu thích")}">{I["heart"]}</button>
  <div class="pc-body">
    <h3 class="pc-title"><a href="/san-pham/{p["slug"]}/">{esc(p["name"])}</a></h3>{stars_html(p, "stars pc-stars")}{"<p class=pc-chips>" + "".join(f"<span>{esc(c)}</span>" for c in card_chips(p)) + "</p>" if card_chips(p) else ""}
    {price_html(p, "price pc-price", from_=True)}
  </div>
  {action}
</article>'''


def grid(products, cls="p-grid"):
    if not products:
        return f'<p class="empty">{t("Chưa có sản phẩm trong mục này.")}</p>'
    return f'<div class="{cls}">' + "".join(product_card(p) for p in products) + "</div>"


def breadcrumb(items):
    parts = [f'<a href="/">{t("Trang chủ")}</a>']
    ld = [{"@type": "ListItem", "position": 1, "name": t("Trang chủ"), "item": DOMAIN + "/"}]
    for i, (label, href) in enumerate(items, 2):
        if href:
            parts.append(f'<a href="{href}">{esc(label)}</a>')
        else:
            parts.append(f'<span aria-current="page">{esc(label)}</span>')
        ld.append({"@type": "ListItem", "position": i, "name": label, **({"item": DOMAIN + href} if href else {})})
    return (f'<nav class="breadcrumb" aria-label="Breadcrumb">' + '<span class="sep">/</span>'.join(parts) + "</nav>",
            {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": ld})


def page_hero(title, sub=""):
    s = f"<p>{sub}</p>" if sub else ""
    return f'<section class="page-hero"><div class="container"><h1>{esc(title)}</h1>{s}</div></section>'


def ebook_href(medium):
    """Link trang tặng ebook kèm vị trí bấm trên web. Trang trong web (/ebook/) dùng ?tu= thay cho UTM
    để không ghi đè nguồn khách thật (Facebook, TikTok…) đang lưu cho đơn hàng."""
    eb = SITE.get("ebook") or {}
    if not eb.get("url"):
        return ""
    sep = "&" if "?" in eb["url"] else "?"
    if eb["url"].startswith("/"):
        return f'{eb["url"]}{sep}tu={medium}'
    return f'{eb["url"]}{sep}utm_source=website&utm_medium={medium}&utm_campaign=ebook'


def ebook_target():
    eb = SITE.get("ebook") or {}
    return "" if str(eb.get("url", "")).startswith("/") else ' target="_blank" rel="noopener"'


def ebook_cta(medium):
    """Khung mời nhận ebook: cả khung bấm được, một chạm sang trang ebook."""
    eb, href = SITE.get("ebook") or {}, ebook_href(medium)
    if not href:
        return ""
    img = f'<img src="{esc(eb["image"])}" alt="" width="300" height="497" loading="lazy">' if eb.get("image") else ""
    return f'''<a class="eb-cta" href="{esc(href)}"{ebook_target()} data-cta="ebook_{medium}">
  <span class="eb-img">{img}</span>
  <span class="eb-text"><span class="eb-tag">🎁 Quà tặng miễn phí</span><b>{esc(eb.get("title", "Nhận ebook miễn phí"))}</b><span class="eb-sub">{esc(eb.get("sub", ""))}</span></span>
  <span class="btn eb-btn">{esc(eb.get("button") or "Nhận ebook miễn phí")}</span>
</a>'''


EBOOK_PATH = "/ebook/"


def page_ebook():
    """Trang nhận ebook: khách để lại tên + SĐT → mở ngay ebook (Heyzine) + mời vào nhóm Zalo. Dữ liệu về Sheet/CRM như form Liên hệ."""
    eb = SITE.get("ebook") or {}
    gift = WEB_OFFER.get("gift_title", "") if WEB_OFFER.get("gift_enabled") else ""
    gift_val = f' (trị giá {esc(WEB_OFFER["gift_value"])})' if gift and WEB_OFFER.get("gift_value") else ""
    group = SITE.get("zalo_group", "")
    stats = [c for c in (SITE.get("community") or []) if re.search(r"\d", c.get("stat", ""))]
    proof = " · ".join(f'<b>{esc(c["stat"].split(" ")[0])}</b> {esc(" ".join(c["stat"].split(" ")[1:]))}' for c in stats[:2])
    topics = [("🦴", "Thoái hóa khớp"), ("💪", "Đau mỏi cơ – cứng cơ"), ("🦶", "Gout cấp và mạn"), ("🥛", "Loãng xương"), ("🤲", "Viêm khớp dạng thấp"), ("🦵", "Đau thần kinh tọa")]
    topic_html = "".join(f'<li><span>{i}</span>{esc(t)}</li>' for i, t in topics)
    pages = [("an-gi-khop", "Nên ăn gì, nên tránh gì cho từng vấn đề"), ("mon-an", "Món ăn có định lượng và cách làm từng bước"), ("gout", "Giải thích dễ hiểu theo Tây y và Đông y")]
    page_html = "".join(f'<figure><img src="/assets/img/brand/ebook-trang-{k}.webp" alt="Trang ebook: {esc(c)}" width="560" height="800" loading="lazy"><figcaption>{esc(c)}</figcaption></figure>' for k, c in pages)
    gift_li = f'<li><span>🎁</span><div><b>{esc(gift)}{gift_val}</b>Quà tặng thành viên nhóm.</div></li>' if gift else ""
    body = f'''<section class="ebh" id="nhan-ebook"><div class="container ebh-in">
  <div class="ebh-head">
    <span class="eyebrow">🎁 Quà tặng miễn phí</span>
    <h1>Ăn gì để cơ xương khớp khỏe hơn mỗi ngày?</h1>
    <p class="ebh-sub">Nhận ngay ebook <b>“Dinh Dưỡng cho Cơ Xương Khớp”</b> kèm <b>video thực đơn 7 ngày</b>. Xem trực tiếp trên điện thoại, không cần tải về.</p>
  </div>
  <div class="ebh-cover"><img src="{esc(eb.get("image") or "/assets/img/brand/ebook-co-xuong-khop.webp")}" alt="Bìa ebook Dinh Dưỡng cho Cơ Xương Khớp" width="720" height="900" fetchpriority="high"></div>
  <ul class="ebh-list">
    <li>Hiểu đúng <b>6 vấn đề cơ xương khớp</b> thường gặp, giải thích theo cả Tây y và Đông y</li>
    <li><b>Nên ăn gì, nên tránh gì</b> cho từng vấn đề</li>
    <li><b>Hơn 20 món</b> cháo, canh, trà, sinh tố dễ nấu, có định lượng và cách làm</li>
    <li><b>Video thực đơn 7 ngày</b> để làm theo ngay</li>
  </ul>
  {gift_form("ebook")}
</div></section>

<section class="section"><div class="container">
  <h2 class="sec-title">Trong ebook có gì?</h2>
  <ul class="eb-topics">{topic_html}</ul>
  <div class="eb-pages">{page_html}</div>
</div></section>

{f"""<section class="section bg-soft"><div class="container narrow">
  <h2 class="sec-title">Vào nhóm Zalo <span class="accent">Sống khỏe cùng {BRAND}</span></h2>
  <ul class="eb-why">
    {gift_li}
    <li><span>🥗</span><div><b>Thực đơn và món lành mỗi ngày</b>Gợi ý dễ làm, phù hợp bữa cơm gia đình.</div></li>
    <li><span>💬</span><div><b>Hỏi đáp trực tiếp</b>Đội ngũ {BRAND} giải đáp thắc mắc về dinh dưỡng.</div></li>
    <li><span>🏷️</span><div><b>Ưu đãi riêng cho thành viên</b>Thông báo chương trình sớm nhất.</div></li>
  </ul>
  {f'<p class="eb-proof">Cộng đồng {BRAND}: {proof}</p>' if proof else ""}
</div></section>""" if group else ""}

<section class="section center"><div class="container narrow">
  <h2 class="sec-title">Bắt đầu ăn lành cho khớp khỏe từ hôm nay</h2>
  <a class="btn btn-lg btn-buy" href="#nhan-ebook" data-cta="ebook_bottom">📖 Nhận ebook miễn phí</a>
  <p class="eb-disc">Ebook là tài liệu tham khảo về dinh dưỡng và chế độ ăn, không thay thế chẩn đoán hay tư vấn của bác sĩ. Người đang có bệnh lý nên hỏi ý kiến bác sĩ trước khi thay đổi chế độ ăn.</p>
</div></section>'''
    desc = "Tặng miễn phí ebook Dinh Dưỡng cho Cơ Xương Khớp: nên ăn gì, nên tránh gì, hơn 20 món dễ nấu tại nhà và video thực đơn 7 ngày."
    return layout(EBOOK_PATH, "Tặng ebook Dinh Dưỡng cho Cơ Xương Khớp + video thực đơn 7 ngày", desc, body, og="/assets/img/brand/og-ebook.jpg", body_class="page-ebook")


# ---------------------------------------------------------------- quà tặng: cẩm nang sống khỏe + trang /qua-tang/
CN = SITE.get("camnang") or {}
CN_PATH = CN["url"] if str(CN.get("url", "")).startswith("/") and CN.get("reader") else ""
CN_READ = CN["reader"] if CN_PATH else ""  # trang sách: ai cũng đọc thử 5 trang đầu, sang trang 6 mới xin tên + số Zalo (18/10/2026). Link có data-cn-read: khách đã để số → main.js thêm ?ma= để mở trọn bộ
GIFT_PATH = "/qua-tang/"
CN_IMG = "/assets/img/brand/cam-nang"
CN_CONCERNS = ["Ăn uống lành mạnh cho cả nhà", "Đường huyết", "Huyết áp – tim mạch", "Cơ xương khớp", "Tiêu hóa – dạ dày", "Giấc ngủ – căng thẳng",
               "Cân nặng – vóc dáng", "Chăm sóc cha mẹ lớn tuổi", "Ăn chay – thực dưỡng", "Vấn đề khác"]


def gift_list():
    """Các món quà đang bật, cẩm nang (mới) đứng trước."""
    out = []
    if CN_PATH:
        out.append({"key": "camnang", "href": CN_READ, "title": CN.get("title") or "Cẩm nang sống khỏe", "sub": CN.get("sub", ""), "button": "Đọc thử 5 trang miễn phí",
                    "image": CN.get("image") or f"{CN_IMG}/cover-art.webp", "tag": "Mới · 32 trang · có sách nói", "for": "Ăn uống & sống khỏe cho cả nhà, nhất là từ tuổi 45"})
    eb = SITE.get("ebook") or {}
    if ebook_href("x"):
        out.append({"key": "ebook", "href": eb["url"], "title": eb.get("title", "Ebook miễn phí"), "sub": eb.get("sub", ""), "button": eb.get("button") or "Nhận ebook miễn phí",
                    "image": eb.get("image", ""), "tag": "Ebook + video thực đơn 7 ngày", "for": "Người quan tâm cơ xương khớp, gout, loãng xương"})
    return out


def gift_href(g, medium):
    return f'{g["href"]}{"&" if "?" in g["href"] else "?"}tu={medium}'


def gift_cards(medium, skip=""):
    cards = ""
    for g in gift_list():
        if g["key"] == skip:
            continue
        cards += f'''<a class="gf-card gf-{g["key"]}" href="{esc(gift_href(g, medium))}" data-cta="gift_{g["key"]}_{medium}"{" data-cn-read" if g["key"] == "camnang" else ""}>
  <span class="gf-img"><img src="{esc(g["image"])}" alt="Bìa {esc(g["title"])}" width="240" height="360" loading="lazy"></span>
  <span class="gf-body"><span class="gf-tag">{esc(g["tag"])}</span><b>{esc(g["title"])}</b><span class="gf-sub">{esc(g["sub"])}</span>
  <span class="gf-for">👤 Phù hợp: {esc(g["for"])}</span><span class="btn gf-btn">{esc(g["button"])} →</span></span>
</a>'''
    return cards


def gifts_block(medium):
    """Khối quà tặng trang chủ: 2 món quà cạnh nhau, khách chọn món cần."""
    gl = gift_list()
    if not gl:
        return ""
    if len(gl) == 1 and gl[0]["key"] == "ebook":
        return ebook_cta(medium)
    return f'''<div class="gifts" id="qua-tang">
  <div class="gifts-head"><span class="gifts-eye">🎁 Quà tặng sức khỏe miễn phí</span><h2>Chọn tài liệu anh/chị cần, đọc ngay trên điện thoại</h2></div>
  <div class="gf-grid gf-n{len(gl)}">{gift_cards(medium)}</div>
</div>'''


def cn_cta(medium):
    """Khung mời đọc cẩm nang (cuối bài viết)."""
    if not CN_PATH:
        return ebook_cta(medium)
    return f'''<a class="eb-cta" href="{esc(CN_READ)}?tu={medium}" data-cta="camnang_{medium}" data-cn-read>
  <span class="eb-img"><img src="{esc(CN.get("image") or f"{CN_IMG}/cover-art.webp")}" alt="" width="240" height="360" loading="lazy"></span>
  <span class="eb-text"><span class="eb-tag">🎁 Quà tặng miễn phí</span><b>{esc(CN.get("title", ""))}</b><span class="eb-sub">{esc(CN.get("sub", ""))}</span></span>
  <span class="btn eb-btn">{esc(CN.get("button") or "Đọc cẩm nang miễn phí")}</span>
</a>'''


def gift_popup():
    """Popup tặng cẩm nang khi khách sắp rời web mà chưa mua (JS initGiftPop quyết định có hiện hay không)."""
    if not CN_PATH or CN.get("popup") is False:
        return ""
    return f'''<div class="gp" id="giftPop" hidden role="dialog" aria-modal="true" aria-labelledby="gpTitle" data-href="{esc(CN_PATH)}">
  <div class="gp-box">
    <button type="button" class="gp-x" data-gp-close aria-label="Đóng">{I["close"]}</button>
    <div class="gp-img"><img src="{CN_IMG}/bia-3d.webp" alt="Bìa cẩm nang Thực Dưỡng Lành" width="320" height="360" loading="lazy"></div>
    <div class="gp-body">
      <span class="gp-eye">🎁 Khoan đã, có quà cho anh/chị</span>
      <h2 id="gpTitle">Tặng miễn phí cẩm nang “Sống khỏe chủ động”</h2>
      <ul><li>Mâm cơm Việt cân bằng: ăn đủ, đa dạng, không ăn kiêng cực đoan</li><li>Gạo lứt, ngũ cốc nguyên hạt và cách chuyển đổi từng bước</li><li>Vận động, giữ cơ sau tuổi 45 + nhật ký 7 ngày</li></ul>
      <p class="gp-meta">32 trang có minh họa · nghe sách nói · tải PDF in cho cha mẹ</p>
      <a class="btn btn-lg btn-buy gp-go" href="{esc(CN_READ)}?tu=popup" data-cta="camnang_popup" data-cn-read>📖 Đọc thử 5 trang miễn phí →</a>
      {f'<a class="gp-quiz" href="{QUIZ_PATH}?tu=popup" data-cta="quiz_popup">Hoặc chơi thử 1 phút: 🖐 Bạn còn mấy ngón tay? →</a>' if QUIZ.get("questions") else ""}
      <button type="button" class="gp-no" data-gp-close>Để sau</button>
    </div>
  </div>
</div>'''


EB_CONCERNS = ["Thoái hóa khớp", "Đau mỏi cơ – cứng cơ", "Gout", "Loãng xương", "Viêm khớp dạng thấp", "Đau thần kinh tọa", "Chăm sóc cha mẹ lớn tuổi", "Vấn đề khác"]


def wvc_box():
    """Mã ưu đãi chào mừng (data/site.json → welcome_voucher, mã tạo ở CRM → 🎟 Mã ưu đãi): hiện trong màn hình đã nhận quà / đã vào nhóm Zalo.
    JS grantWvc() lưu mã vào tdl_vc_code (tự áp dụng khi đặt hàng) và bỏ ẩn khung."""
    wv = SITE.get("welcome_voucher") or {}
    if not (IS_VI and wv.get("enabled") and wv.get("code")):
        return ""
    fs = f' Đơn từ {money(SITE["free_ship_threshold"])} vẫn được miễn phí ship.' if SITE.get("free_ship_threshold") else ""
    return f'''<div class="wvc" data-wvc="{esc(wv["code"])}" hidden>
  <b>🎟 Quà thêm: mã <span class="wvc-code">{esc(wv["code"])}</span> {esc(wv.get("label") or "")} khi mua trên web</b>
  <p>Mã đã tự lưu, tự trừ tiền lúc đặt hàng (mỗi số điện thoại dùng 1 lần).{fs}</p>
  <a class="btn btn-buy" href="/san-pham/" data-cta="wvc_shop">Xem sản phẩm →</a>
</div>'''


def gift_form(key, ctx=""):
    """Form nhận quà dùng chung (/cam-nang-song-khoe/, /ebook/): họ tên, SĐT, vấn đề quan tâm, câu hỏi thêm.
    Khách đã nhận 1 quà (localStorage tdl_lead) → hiện ô "nhận ngay 1 chạm", không phải điền lại. Xong → mở quà + mời nhóm Zalo + gợi ý quà còn lại."""
    if key == "camnang":
        title, book, opener, concerns = CN.get("title", "Cẩm nang sống khỏe"), "Cẩm nang sống khỏe", CN.get("reader", ""), CN_CONCERNS
        h2, sub, btn, open_lbl, done_note = "Nhận cẩm nang miễn phí", "Điền thông tin dưới đây để mở sách ngay. Không mất phí.", "📖 Mở cẩm nang miễn phí", "📖 Mở cẩm nang ngay", "Bước 1: bấm nút để mở sách. Bấm “Mở sách”, rồi bật 🎧 Sách nói nếu muốn nghe."
        ph = "Ví dụ: Bố tôi 70 tuổi, đường huyết cao, nên ăn gạo lứt thế nào?"
    else:
        eb = SITE.get("ebook") or {}
        title, book, opener, concerns = eb.get("title", "Ebook"), "Ebook Dinh Dưỡng cho Cơ Xương Khớp", eb.get("flipbook", ""), EB_CONCERNS
        h2, sub, btn, open_lbl, done_note = "Nhận ebook ngay", "Điền thông tin dưới đây để mở ebook. Hoàn toàn miễn phí.", "📖 Nhận ebook miễn phí", "📖 Mở ebook & video 7 ngày", "Bước 1: bấm nút bên dưới để đọc ebook và xem video thực đơn 7 ngày."
        ph = "Ví dụ: Mẹ tôi bị thoái hóa gối, nên ăn gì và tránh gì?"
    if ctx == "quiz":  # dưới kết quả trò chơi: quà = cẩm nang + nhắc thử thách 7 ngày qua nhóm Zalo
        h2, sub = "🎁 Nhận quà để dựng lại từng ngón tay", f"Để lại tên và số Zalo: nhận ngay cẩm nang “Sống khỏe chủ động” (32 trang, có sách nói, nhật ký 7 ngày) và lời mời vào nhóm Zalo để được nhắc thử thách mỗi ngày."
        btn = "🎁 Nhận quà miễn phí"
    elif ctx == "pledge":
        h2, sub = "🎁 Quà cho người chọn sống lành", "Để lựa chọn sống lành thành thói quen: nhận cẩm nang “Sống khỏe chủ động” (32 trang, có sách nói, nhật ký 7 ngày thay đổi nhỏ) và vào nhóm Zalo cùng mọi người sống lành mỗi ngày."
        btn = "🎁 Nhận quà miễn phí"
    chips = "".join(f'<label class="cn-chip"><input type="checkbox" name="concern" value="{esc(c)}"><span>{esc(c)}</span></label>' for c in concerns)
    group = SITE.get("zalo_group", "")
    zg = WEB_OFFER.get("gift_title", "") if WEB_OFFER.get("gift_enabled") else ""
    zg_val = f' (trị giá {esc(WEB_OFFER["gift_value"])})' if zg and WEB_OFFER.get("gift_value") else ""
    zalo_box = f'''<div class="ebz">
  <b>👥 Bước 2: Vào nhóm Zalo “Sống khỏe cùng {BRAND}”</b>
  <p>{f"Nhận quà <strong>{esc(zg)}</strong>{zg_val}, " if zg else ""}thực đơn lành, ưu đãi riêng cho thành viên và hỏi đáp trực tiếp với đội ngũ {BRAND}.</p>
  <a class="btn btn-lg btn-zalo" href="{esc(group)}" target="_blank" rel="noopener" data-cta="zalo_group_{key}">Vào nhóm Zalo miễn phí →</a>
</div>''' if group else ""
    nxt = [g for g in gift_list() if g["key"] != key]
    fun = "".join(f'<a class="gnext gfun" href="{h}?tu=gift_{key}" data-cta="gift_next_{k}"><span class="gfun-ic">{i}</span><span><small>{sm}</small><b>{b}</b><em>{e} →</em></span></a>' for k, h, i, sm, b, e in [
        ("quiz", QUIZ_PATH, "🖐", "Trò chơi 1 phút", "Bạn còn mấy ngón tay?", "Kiểm tra lối sống, nhận thử thách 7 ngày"),
        ("pledge", PLEDGE_PATH, "🌱", "Hành trình 10 triệu người", "Tôi chọn sống lành", "Nhận ảnh chứng nhận để chia sẻ")] if k != ctx and IS_VI)
    next_box = fun + "".join(f'''<a class="gnext" href="{esc(gift_href(g, "next"))}" data-cta="gift_next_{g["key"]}">
  <img src="{esc(g["image"])}" alt="" width="64" height="96" loading="lazy"><span><small>🎁 Anh/chị còn 1 quà nữa</small><b>{esc(g["title"])}</b><em>Nhận ngay 1 chạm, không cần điền lại →</em></span></a>''' for g in nxt)
    return f'''<div class="ebf card cnf{" gift-" + ctx if ctx else ""}" id="giftBox" data-key="{key}" data-open="{esc(opener)}" data-title="{esc(title)}" data-book="{esc(book)}"{f' data-pos="{ctx}"' if ctx else ""}>
    <div class="gq" hidden>
      <h2>👋 Chào <span data-gq-name></span>!</h2>
      <p class="ebf-note">Anh/chị đã đăng ký nhận quà của {BRAND} với số <b data-gq-phone></b>. Bấm nút dưới đây để nhận luôn, không cần điền lại.</p>
      <button type="button" class="btn btn-lg btn-buy" data-gq-go>{esc(btn)}</button>
      <button type="button" class="ebf-again" data-gq-other>Không phải tôi / dùng số khác</button>
    </div>
    <form id="giftForm" novalidate>
      <h2>{esc(h2)}</h2>
      <p class="ebf-note">{esc(sub)}</p>
      <label>Họ và tên *<input name="name" required autocomplete="name" placeholder="Ví dụ: Nguyễn Thị Lan"></label>
      <label>Số điện thoại (Zalo) *<input name="phone" type="tel" required autocomplete="tel" inputmode="tel" placeholder="Ví dụ: 0912 345 678"></label>
      <fieldset class="cn-chips"><legend>Anh/chị đang quan tâm điều gì?{" <small>(không bắt buộc)</small>" if ctx else " * <small>(chọn 1 hoặc nhiều)</small>"}</legend>{chips}</fieldset>
      <label class="cn-ask">Điều anh/chị muốn hỏi thêm <small>(không bắt buộc)</small><textarea name="ask" rows="2" maxlength="400" placeholder="{esc(ph)}"></textarea></label>
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="btn btn-lg btn-buy" type="submit">{esc(btn)}</button>
      <p class="form-msg" role="status"></p>
      <p class="ebf-legal">Khi bấm nhận quà, anh/chị đồng ý để {BRAND} liên hệ qua điện thoại/Zalo để gửi tài liệu và tư vấn dinh dưỡng, theo <a href="/chinh-sach-bao-mat/" target="_blank">Chính sách bảo mật</a>. Không chia sẻ thông tin cho bên thứ ba.</p>
    </form>
    <div class="ebf-done" hidden>
      <h2>✅ Quà đã sẵn sàng!</h2>
      <p class="ebf-note">{esc(done_note)}</p>
      <a class="btn btn-lg btn-buy" data-gift-open href="{esc(opener)}" target="_blank" rel="noopener" data-cta="{key}_open">{esc(open_lbl)}</a>
      {zalo_box}
      {wvc_box()}
      {next_box}
      <button type="button" class="ebf-again" data-gift-again>Đăng ký cho người thân</button>
    </div>
  </div>'''


def page_camnang():
    """Trang giới thiệu cẩm nang: nội dung đáng giá để khách muốn nhận → điền tên, SĐT, vấn đề quan tâm → mở sách (camnangsongkhoe.thucduonglanh.vn)."""
    chapters = [
        ("grains", "Chương 1 · Hiểu đúng", "Bốn nguyên tắc của một chế độ ăn lành", ["Đủ, cân đối, điều độ, đa dạng theo WHO", "Gạo lứt giữ lại cám và mầm: hiểu đúng, không thần thánh hóa", "Luân phiên yến mạch, kê, ngô… để bữa ăn phong phú"]),
        ("family-meal", "Chương 2 · Mâm cơm Việt", "Một mâm cơm, nhiều phần bổ trợ cho nhau", ["Rau quả nhiều màu, đậu và hạt, nguồn đạm phối hợp", "Giảm dần muối, đường, món chiên mà vẫn ngon", "Đọc nhãn thực phẩm trong 60 giây, an toàn thực phẩm tại nhà"]),
        ("activity", "Chương 3 · Sống lành sau tuổi 45", "Giữ cơ, giữ sức, không chỉ nhìn cân nặng", ["Vì sao người không gầy vẫn có thể thiếu cơ", "Uống nước đủ và hợp với từng người", "Đi bộ, tập sức mạnh, giữ thăng bằng, dưỡng sinh an toàn"]),
        ("cooking", "Chương 4 · Thực hành an toàn", "Chuyển sang gạo lứt từng bước", ["Ngâm, phối trộn, nấu mềm cho dễ ăn", "Lưu ý riêng khi có đường huyết cao, bệnh thận, khó nhai nuốt", "Những dấu hiệu cần đi khám, không tự xử trí bằng thực đơn"]),
    ]
    ch_html = "".join(f'''<article class="cn-ch"><img src="{CN_IMG}/{img}.webp" alt="Minh họa {esc(t)}" width="480" height="720" loading="lazy">
  <div><span class="cn-ch-k">{esc(k)}</span><h3>{esc(t)}</h3><ul>{"".join(f"<li>{esc(b)}</li>" for b in bl)}</ul></div></article>''' for img, k, t, bl in chapters)
    facts = [("🧂", "Dưới 5 gam", "muối mỗi ngày là khuyến nghị của WHO cho người trưởng thành. Cẩm nang chỉ cách nêm nhạt dần mà cả nhà vẫn ăn ngon."),
             ("🥬", "Ít nhất 400 gam", "rau và quả mỗi ngày. Mẹo “chọn theo màu” giúp nhớ ăn đa dạng mà không phải đếm."),
             ("🚶", "150–300 phút", "vận động vừa mỗi tuần, kèm 2 buổi tập sức mạnh. Từ 65 tuổi nên thêm bài giữ thăng bằng."),
             ("🍚", "Nửa gạo lứt, nửa gạo trắng", "là cách chú Minh bắt đầu, thay vì đổi hết trong một ngày, để cơ thể kịp làm quen."),
             ("🏷️", "60 giây", "đọc nhãn: thành phần, khẩu phần, đường, natri. Đủ để chọn đúng hơn nhiều phút nghe quảng cáo."),
             ("💪", "Không chỉ cân nặng", "Sau 45 tuổi, giữ khối cơ và sức nắm quan trọng không kém con số trên bàn cân.")]
    fact_html = "".join(f'<li><span class="cn-f-i">{i}</span><b>{esc(a)}</b><p>{esc(b)}</p></li>' for i, a, b in facts)
    feats = [("📖", "Sách lật trên điện thoại", "Lật từng trang như sách thật, chữ phóng to được (A+)."),
             ("🎧", "Nghe sách nói", "Giọng nữ hoặc nam đọc từng trang, tự lật trang. Tiện cho người lớn tuổi."),
             ("🖨️", "Tải PDF để in", "In ra tặng cha mẹ, đặt trong bếp làm sổ tay."),
             ("📚", "20 nguồn tham khảo rõ ràng", "WHO, Bộ Y tế, Viện Dinh dưỡng Quốc gia… ghi ở từng trang.")]
    feat_html = "".join(f'<li><span>{i}</span><div><b>{esc(a)}</b>{esc(b)}</div></li>' for i, a, b in feats)
    who = [("👵", "Anh chị từ 45 tuổi", "muốn giữ sức để đi lại, ăn ngon, ngủ yên, tự lập lâu dài."),
           ("👨‍👩‍👧", "Con cái chăm cha mẹ", "cần một tài liệu dễ đọc, có sách nói để gửi ông bà."),
           ("🥗", "Người muốn ăn lành hơn", "nhưng không muốn ăn kiêng khắt khe hay bỏ hẳn món quen."),
           ("🩺", "Người có bệnh nền", "muốn hiểu cần lưu ý gì và chuẩn bị câu hỏi khi gặp bác sĩ.")]
    who_html = "".join(f'<li><span>{i}</span><div><b>{esc(a)}</b>{esc(b)}</div></li>' for i, a, b in who)
    peeks = [("family-meal", "“Thêm một đôi đũa” – bữa cơm là nơi dinh dưỡng gặp tình thân"),
             ("consult", "Tự nhiên không có nghĩa là không tương tác – khi nào cần hỏi bác sĩ"),
             ("evening", "Nhật ký 7 ngày: mỗi ngày một thay đổi nhỏ, đều đặn hơn hoàn hảo")]
    peek_html = "".join(f'<figure><img src="{CN_IMG}/{k}.webp" alt="Trang cẩm nang: {esc(c)}" width="480" height="720" loading="lazy"><figcaption>{esc(c)}</figcaption></figure>' for k, c in peeks)
    faqs = [("Cẩm nang có mất phí không?", "Hoàn toàn miễn phí. Anh/chị đọc thử ngay 5 trang đầu, không cần đăng ký. Muốn đọc tiếp trọn bộ 32 trang, nghe sách nói và tải PDF thì để lại tên và số Zalo."),
            ("Đọc bằng gì? Có cần cài ứng dụng không?", "Không cần cài gì. Sách mở ngay trên trình duyệt điện thoại hoặc máy tính, có nút nghe sách nói và tải PDF."),
            ("Thông tin của tôi được dùng để làm gì?", f"Để {BRAND} gửi lại link sách khi cần và tư vấn dinh dưỡng đúng vấn đề anh/chị quan tâm qua điện thoại/Zalo. Không chia sẻ cho bên thứ ba."),
            ("Đây có phải tài liệu bán hàng?", f"Cẩm nang chủ yếu là kiến thức sống khỏe có nguồn rõ ràng. Chỉ có 1 trang cuối giới thiệu Gói Khởi Động 10 Ngày Sống Lành của {BRAND} như một gợi ý, anh/chị không cần mua gì."),
            ("Tôi đang dùng thuốc, có áp dụng được không?", "Cẩm nang có riêng phần lưu ý cho người có đường huyết cao, bệnh thận, khó nhai nuốt và người đang dùng thuốc. Nội dung không thay thế tư vấn của bác sĩ; anh/chị giữ nguyên thuốc theo chỉ định.")]
    faq_html = "".join(f'<details class="cn-q"><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in faqs)
    other_html = f'''<section class="section pt-0"><div class="container narrow"><h2 class="sec-title">Quà tặng khác cho anh/chị</h2><div class="gf-grid gf-n1">{gift_cards("camnang", skip="camnang")}</div></div></section>''' if len(gift_list()) > 1 else ""
    body = f'''<section class="ebh cnh" id="nhan-cam-nang"><div class="container ebh-in">
  <div class="ebh-head">
    <span class="eyebrow">🎁 Quà tặng miễn phí · 32 trang · có sách nói</span>
    <h1>Sống khỏe chủ động sau tuổi 45, bắt đầu từ mâm cơm mỗi ngày</h1>
    <a class="btn btn-lg cn-try" href="{esc(CN_READ)}?tu=landing" data-cta="camnang_try" data-cn-read>📖 Đọc thử 5 trang đầu, không cần đăng ký →</a>
    <p class="ebh-sub">Cẩm nang <b>“Thực Dưỡng Lành – Từ hạt gạo Việt đến nếp sống khỏe và an yên”</b>: ăn đủ, cân đối, đa dạng theo khuyến nghị của <b>WHO và Bộ Y tế</b>, kể qua câu chuyện gần gũi của cô An và chú Minh.</p>
  </div>
  <div class="ebh-cover"><img src="{CN_IMG}/bia-3d.webp" alt="Bìa cẩm nang Thực Dưỡng Lành – Sống khỏe chủ động" width="640" height="721" fetchpriority="high"></div>
  <ul class="ebh-list">
    <li><b>4 chương</b> đi từ hiểu đúng đến làm được, không ăn kiêng cực đoan</li>
    <li>Cách <b>chuyển sang gạo lứt từng bước</b> và luân phiên ngũ cốc trong tuần</li>
    <li><b>Giữ cơ, giữ sức</b> sau tuổi 45: ăn đủ đạm, vận động, giữ thăng bằng</li>
    <li>Lưu ý riêng khi có <b>đường huyết cao, bệnh thận</b>, đang dùng thuốc</li>
    <li><b>Nhật ký 7 ngày</b>: mỗi ngày một thay đổi nhỏ, dễ duy trì</li>
  </ul>
  {gift_form("camnang")}
</div></section>

<section class="cn-stats"><div class="container"><ul>
  <li><b>32</b>trang có minh họa</li><li><b>4</b>chương thực hành</li><li><b>20</b>nguồn WHO, Bộ Y tế…</li><li><b>2</b>giọng đọc sách nói</li>
</ul></div></section>

<section class="section"><div class="container">
  <h2 class="sec-title">Trong cẩm nang có gì?</h2>
  <p class="sec-note cn-lead">Mỗi trang tách rõ đâu là khuyến nghị khoa học, đâu là giá trị văn hóa, đâu là thực hành truyền thống. Nguồn rõ ràng quan trọng hơn một lời hứa hấp dẫn.</p>
  <div class="cn-chs">{ch_html}</div>
  <p class="center"><a class="btn btn-lg btn-buy" href="#nhan-cam-nang" data-cta="camnang_mid">📖 Nhận cẩm nang miễn phí</a></p>
</div></section>

<section class="section bg-soft"><div class="container">
  <h2 class="sec-title">6 điều anh/chị áp dụng được ngay</h2>
  <ul class="cn-facts">{fact_html}</ul>
</div></section>

<section class="section"><div class="container">
  <div class="cn-two">
    <div><h2 class="sec-title">Đọc theo cách anh/chị thích</h2><ul class="eb-why cn-why">{feat_html}</ul></div>
    <div><h2 class="sec-title">Cẩm nang dành cho ai?</h2><ul class="eb-why cn-why">{who_html}</ul></div>
  </div>
</div></section>

<section class="section bg-soft"><div class="container">
  <h2 class="sec-title">Xem trước vài trang</h2>
  <div class="eb-pages cn-peek">{peek_html}</div>
  <blockquote class="cn-quote">“Mình không cần sống hoàn hảo. Mình chỉ cần chăm nhau đều đặn hơn.”<cite>Cô An, trong cẩm nang</cite></blockquote>
</div></section>

<section class="section"><div class="container narrow">
  <h2 class="sec-title">Câu hỏi thường gặp</h2>
  <div class="cn-faq">{faq_html}</div>
</div></section>

<section class="section center cn-final"><div class="container narrow">
  <h2 class="sec-title">Món quà nhỏ cho mình và người thân</h2>
  <p>Đọc 10 phút mỗi ngày, chọn một thay đổi nhỏ, rồi cùng cả nhà duy trì.</p>
  <a class="btn btn-lg btn-buy" href="#nhan-cam-nang" data-cta="camnang_bottom">📖 Nhận cẩm nang miễn phí</a>
  <p class="eb-disc">Cẩm nang là tài liệu giáo dục lối sống, không phải là thuốc và không thay thế chẩn đoán hay tư vấn của bác sĩ. Người có bệnh nền nên hỏi ý kiến bác sĩ trước khi thay đổi chế độ ăn hoặc vận động.</p>
</div></section>
{other_html}'''
    desc = "Tặng miễn phí cẩm nang Thực Dưỡng Lành 32 trang có sách nói: mâm cơm Việt cân bằng, gạo lứt và ngũ cốc nguyên hạt, giữ cơ giữ sức sau tuổi 45, nhật ký 7 ngày. Nguồn WHO, Bộ Y tế."
    return layout(CN_PATH, "Tặng cẩm nang Sống khỏe chủ động – Thực Dưỡng Lành", desc, body, og=f"{CN_IMG}/og.jpg", body_class="page-ebook page-camnang", preload=f"{CN_IMG}/bia-3d.webp")


def hub_items():
    """3 cách bắt đầu miễn phí: quà cẩm nang, trò chơi 1 phút, ký cam kết (dải dưới hero trang chủ + /qua-tang/)."""
    if not IS_VI:
        return []
    out = []
    if CN_PATH:
        out.append({"k": "gift", "ic": "🎁", "eye": "Quà tặng miễn phí", "t": "Cẩm nang Sống khỏe chủ động", "s": "32 trang có sách nói: mâm cơm cân bằng, gạo lứt, vận động sau 45 tuổi. Đọc thử ngay, không cần đăng ký.", "href": CN_READ, "btn": "Đọc thử miễn phí"})
    if QUIZ.get("questions"):
        out.append({"k": "quiz", "ic": "🖐", "eye": "Trò chơi 1 phút", "t": "Bạn còn mấy ngón tay?", "s": "10 câu về thói quen hằng ngày. Xem lối sống của bạn được mấy điểm.", "href": QUIZ_PATH, "btn": "Chơi ngay"})
    out.append({"k": "pledge", "ic": "🌱", "eye": "Hành trình 10 triệu người", "t": "Tôi chọn sống lành", "s": "Một lựa chọn nhỏ cho chính mình, nhận ảnh chứng nhận để chia sẻ.", "href": PLEDGE_PATH, "btn": "Tôi chọn sống lành"})
    return out


def gift_dock():
    """Nút nổi "🎁 Quà & Trò chơi" góc trái dưới (mọi trang, nhất là điện thoại) → bảng chọn từ dưới lên: cẩm nang, ebook, trò chơi, cam kết, nhóm Zalo.
    JS initGiftDock: đánh dấu món đã nhận / đã chơi / đã ký (localStorage), số trên nút = món chưa thử; ẩn ở giỏ hàng / thanh toán. (17/10/2026)"""
    if not IS_VI:
        return ""
    its = [(x["k"], x["ic"], x["t"], x["s"], x["href"]) for x in hub_items()]
    eb = SITE.get("ebook") or {}
    if ebook_href("x"):
        its.insert(1, ("ebook", "🦴", eb.get("title", "Ebook miễn phí").replace("Tặng ebook ", "Ebook "), "Ăn gì cho cơ xương khớp + video thực đơn 7 ngày.", eb["url"]))
    if not its:
        return ""
    rows = "".join(f'''<a class="gd-it" data-gd="{k}" href="{esc(h)}{"&" if "?" in h else "?"}tu=dock" data-cta="dock_{k}"{" data-cn-read" if k == "gift" else ""}><span class="gd-iic">{ic}</span><span class="gd-itx"><b>{esc(tt)}</b><small data-gd-sub>{esc(sub)}</small></span><em data-gd-st>{"Chơi" if k == "quiz" else "Ký" if k == "pledge" else "Đọc thử" if k == "gift" else "Nhận"} →</em></a>''' for k, ic, tt, sub, h in its)
    zg = f'<a class="gd-it gd-zalo" href="{ZALO_GATE}?tu=dock" data-cta="dock_zalo"><span class="gd-iic">👥</span><span class="gd-itx"><b>Nhóm Zalo “Sống khỏe cùng {BRAND}”</b><small>Thực đơn lành, ưu đãi thành viên, hỏi đáp mỗi ngày.</small></span><em>Vào →</em></a>' if SITE.get("zalo_group") else ""
    return f'''
<button class="gd-btn" id="gdBtn" type="button" aria-expanded="false" aria-controls="gdSheet" hidden><span class="gd-ic" aria-hidden="true">🎁</span><span class="gd-tx">Quà & Trò chơi</span><span class="gd-badge" data-gd-n hidden></span></button>
<div class="gd-sheet" id="gdSheet" hidden role="dialog" aria-modal="true" aria-labelledby="gdTitle"><div class="gd-box">
  <div class="gd-head"><div><b id="gdTitle">🎁 Miễn phí cho bạn</b><small>Quà tặng, trò chơi và hành trình sống lành</small></div><button type="button" class="gd-x" data-gd-close aria-label="Đóng">{I["close"]}</button></div>
  <div class="gd-list">{rows}{zg}</div>
</div></div>'''


ZALO_GATE = "/nhom-zalo/"


def page_zalo_gate():
    """Cổng vào nhóm Zalo (/nhom-zalo/, link cố định trên QR, sách, web): khách để tên + số Zalo → CRM khách hỏi kênh "Nhóm Zalo (Website)" → mới hiện nút vào nhóm.
    Khách đã để số trước đó (tdl_lead) → 1 chạm vào nhóm. Quà chào mừng: cẩm nang. main.js initZaloGate. Nhóm đầy → đổi link ở /admin, link cổng giữ nguyên."""
    group = SITE.get("zalo_group", "")
    chips = "".join(f'<label class="cn-chip"><input type="checkbox" name="concern" value="{esc(c)}"><span>{esc(c)}</span></label>' for c in CN_CONCERNS)
    stat = next((c.get("stat") for c in SITE.get("community") or [] if c.get("url") == group and re.search(r"\d", c.get("stat", ""))), "")
    gift = f'<a class="btn btn-lg btn-ghost zg-gift" data-zg-gift href="{esc(CN.get("reader", ""))}" target="_blank" rel="noopener" data-cta="zalo_gate_gift">🎁 Mở quà chào mừng: cẩm nang Sống khỏe chủ động</a>' if CN_PATH else ""
    body = f'''<section class="section zg-page"><div class="container zg-in">
  <div class="zg-intro">
    <p class="join-eye">👥 Cộng đồng miễn phí{f" · {esc(stat)}" if stat else ""}</p>
    <h1 class="plg-h">Nhóm Zalo <span class="nw">Sống khỏe</span> <span class="nw">cùng {BRAND}</span></h1>
    <ul class="zg-ben"><li>🥗 Thực đơn lành, mẹo sống khỏe mỗi tuần</li><li>💬 Hỏi đáp trực tiếp với đội ngũ {BRAND}</li><li>🎯 Được nhắc thử thách 7 ngày sống lành</li><li>🎁 Ưu đãi riêng cho thành viên{f" + {esc(WEB_OFFER['gift_title'])}" if WEB_OFFER.get("gift_enabled") and WEB_OFFER.get("gift_title") else ""}</li>{"<li>📖 Quà chào mừng: cẩm nang “Sống khỏe chủ động” 32 trang, có sách nói</li>" if CN_PATH else ""}</ul>
  </div>
  <div class="ebf card cnf zg-card" id="zgBox" data-g="{esc(group)}">
    <div class="zg-quick" hidden>
      <h2>👋 Chào <span data-zg-name></span>!</h2>
      <p class="ebf-note">Anh/chị đã để số <b data-zg-phone></b> với {BRAND}. Bấm nút dưới đây để vào nhóm luôn.</p>
      <a class="btn btn-lg btn-zalo" data-zg-quick href="{esc(group)}" target="_blank" rel="noopener">👥 Vào nhóm Zalo ngay →</a>
      <button type="button" class="ebf-again" data-zg-other>Không phải tôi / dùng số khác</button>
    </div>
    <form id="zgForm" novalidate>
      <h2>Nhận link vào nhóm</h2>
      <p class="ebf-note">Để giữ nhóm toàn người thật, cùng quan tâm sống khỏe, anh/chị để lại tên và số Zalo nhé. Bấm xong là vào nhóm ngay.</p>
      <label>Họ và tên *<input name="name" required autocomplete="name" placeholder="Ví dụ: Nguyễn Thị Lan"></label>
      <label>Số điện thoại (Zalo) *<input name="phone" type="tel" required autocomplete="tel" inputmode="tel" placeholder="Ví dụ: 0912 345 678"></label>
      <fieldset class="cn-chips"><legend>Anh/chị quan tâm điều gì? <small>(không bắt buộc)</small></legend>{chips}</fieldset>
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="btn btn-lg btn-zalo" type="submit">👥 Nhận link vào nhóm</button>
      <p class="form-msg" role="status"></p>
      <p class="ebf-legal">Khi bấm, anh/chị đồng ý để {BRAND} liên hệ qua điện thoại/Zalo để chào mừng, gửi tài liệu và tư vấn dinh dưỡng, theo <a href="/chinh-sach-bao-mat/" target="_blank">Chính sách bảo mật</a>. Không chia sẻ thông tin cho bên thứ ba.</p>
    </form>
    <div class="ebf-done" hidden>
      <h2>✅ Xong rồi, mời anh/chị vào nhóm!</h2>
      <p class="ebf-note">Bấm nút để mở nhóm trong Zalo. Nhóm có bật duyệt thì đội ngũ {BRAND} sẽ duyệt trong ngày.</p>
      <a class="btn btn-lg btn-zalo" data-zg-join href="{esc(group)}" target="_blank" rel="noopener" data-cta="zalo_gate_join">👥 Vào nhóm Zalo ngay →</a>
      {wvc_box()}
      {gift}
    </div>
  </div>
</div></section>'''
    return layout(ZALO_GATE, f"Nhóm Zalo Sống khỏe cùng {BRAND}", f"Tham gia miễn phí nhóm Zalo Sống khỏe cùng {BRAND}: thực đơn lành, hỏi đáp với đội ngũ, ưu đãi thành viên và quà chào mừng.", body, body_class="page-zalo", noindex=True)


def hub_cards(medium):
    sep = lambda h: "&" if "?" in h else "?"
    return "".join(f'''<a class="hub-card hub-{x["k"]}" href="{esc(x["href"])}{sep(x["href"])}tu={medium}" data-cta="hub_{x["k"]}_{medium}"{" data-cn-read" if x["k"] == "gift" else ""}><span class="hub-ic" aria-hidden="true">{x["ic"]}</span>
<span class="hub-tx"><small>{esc(x["eye"])}</small><b>{esc(x["t"])}</b><span>{esc(x["s"])}</span></span><span class="hub-btn">{esc(x["btn"])} →</span></a>''' for x in hub_items())


def hub_strip(medium):
    """Dải nổi bật ngay dưới hero trang chủ: khách thấy ngay quà, trò chơi, lời cam kết."""
    if len(hub_items()) < 2:
        return ""
    return f'''<section class="section section-tight hub-sec"><div class="container">
  <p class="hub-head"><b>Bắt đầu sống lành từ hôm nay</b><span>3 món miễn phí dành cho bạn</span></p>
  <div class="hub-grid">{hub_cards(medium)}</div>
</div></section>'''


def page_gifts():
    """Trang /qua-tang/: gom các quà tặng để khách chọn."""
    body = f'''<section class="section pt-2 gifts-page"><div class="container">
  <div class="gifts-head center"><span class="gifts-eye">🎁 Quà tặng sức khỏe miễn phí</span><h1>Chọn món quà anh/chị cần</h1>
  <p>Tài liệu do {BRAND} biên soạn, đọc ngay trên điện thoại. Chỉ cần để lại tên và số điện thoại.</p></div>
  <div class="gf-grid gf-n{len(gift_list())}">{gift_cards("qua_tang")}</div>
  {f'<div class="gifts-head center hub-more"><span class="gifts-eye">🎲 Thêm niềm vui sống lành</span><h2>Chơi thử, cùng mọi người chọn sống lành</h2></div><div class="hub-grid hub-n2">{hub_cards("qua_tang").split("</a>", 1)[1] if CN_PATH else hub_cards("qua_tang")}</div>' if IS_VI else ""}
  <p class="eb-disc center">Tài liệu tham khảo về dinh dưỡng và lối sống, không thay thế chẩn đoán hay tư vấn của bác sĩ.</p>
</div></section>'''
    return layout(GIFT_PATH, "Quà tặng sức khỏe miễn phí", f"Nhận miễn phí cẩm nang Sống khỏe chủ động và ebook Dinh Dưỡng cho Cơ Xương Khớp từ {BRAND}.", body, og=f"{CN_IMG}/og.jpg", body_class="page-gifts")


def benefits_banner():
    items = [("truck", t("Miễn phí ship"), tf("đơn từ {amount}", amount=money(SITE.get('free_ship_threshold')).replace(' ₫', 'đ')) if SITE.get("free_ship_threshold") else t("toàn quốc")), ("return", t("Đổi trả 7 ngày"), t("nếu lỗi NSX")), ("chat", t("Tư vấn"), t("tận tâm")), ("wallet", t("Thanh toán||banner"), t("tiện lợi"))]
    feats = "".join(f'<div class="bb-feat">{ic(i,"bb-ic")}<span>{a}<br><b>{b}</b></span></div>' for i, a, b in items)
    pills = "".join(f'<div class="bb-pill">{ic(i,"bb-pic")}<span>{a}<b>{b}</b></span></div>' for i, a, b in [
        ("leaf", t("Sản phẩm"), t("thuần tự nhiên")), ("shield", t("Nguồn gốc"), t("rõ ràng")), ("check", t("Kiểm nghiệm"), t("đầy đủ"))])
    return f'''<a class="benefit-banner" href="/san-pham/">
  <div class="bb-left">
    <img src="/assets/img/brand/logo.webp" alt="" class="bb-logo" width="{LOGO_W}" height="180" loading="lazy">
    <div class="bb-title"><span>{t("Sống lành")}</span><span>{t("để sống đáng")}</span></div>
    <p class="bb-sub">{t("Hệ sinh thái sản phẩm thực dưỡng chất lượng – lành mạnh – bền vững cho gia đình Việt")}</p>
    <div class="bb-pills">{pills}</div>
  </div>
  <div class="bb-mid">{"".join(f'<img src="{pimg(p["images"][0], True)}" alt="" width="480" height="480" loading="lazy">' for p in (PRODUCTS[2:3] + PRODUCTS[1:2] + PRODUCTS[3:4] or PRODUCTS[:3]))}</div>
  <div class="bb-right">{feats}</div>
</a>'''


# ---------------------------------------------------------------- pages
def yt_id(url):
    m = re.search(r"(?:youtu\.be/|v=|embed/|shorts/)([\w-]{11})", url or "")
    return m.group(1) if m else ""


def bv_info():
    """Video thương hiệu (data/site.json → brand_video, /admin → Cài đặt): id YouTube, chữ, ảnh bìa, thời lượng "2:09" (từ PT2M9S)."""
    bv = SITE.get("brand_video") or {}
    vid = yt_id(bv.get("youtube"))
    if not vid:
        return None
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", bv.get("duration") or "")
    dur = ""
    if m and any(m.groups()):
        h, mi, se = (int(x or 0) for x in m.groups())
        dur = f"{h}:{mi:02d}:{se:02d}" if h else f"{mi}:{se:02d}"
    return {"vid": vid, "title": bv.get("title", ""), "cap": bv.get("caption", ""), "hook": bv.get("hook", ""), "dur": dur,
            "img": bv.get("image") or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg", "bubble": bv.get("bubble", True) is not False, "hero": bv.get("hero_button", True) is not False}


def bv_nw(text):
    """Câu gợi tò mò: giữ các cụm có nghĩa trên cùng 1 dòng (không ngắt "đồng / hành", "Thực Dưỡng / Lành")."""
    h = esc(text)
    for x in ("Thực Dưỡng Lành", "đồng hành", "lâu dài", "khắt khe", "nghệ sĩ", "Vì sao"):
        h = h.replace(x, f'<span class="nw">{x}</span>')
    return h


def bv_frame(v, where, lazy=True):
    """Khung video dọc (ảnh bìa + nút ▶ + nhãn thời lượng). data-from = vị trí trên trang, để đo khách bấm xem ở chỗ nào (main.js → sự kiện bv_<vị trí>)."""
    lz = ' loading="lazy"' if lazy else ""
    return (f'<div class="v-frame bv-frame" data-yt="{v["vid"]}" data-from="{where}" data-title="{esc(v["title"])}"><img src="{esc(v["img"])}" alt="{esc(v["title"])}"{lz} width="540" height="960">'
            f'<button class="v-play bv-play" aria-label="{t("Phát video:")} {esc(v["title"])}">{I["play"]}</button>'
            + (f'<span class="bv-dur">{I["play"]}{v["dur"]}</span>' if v["dur"] else "") + "</div>")


def brand_video(where="bottom"):
    """Video thương hiệu (YouTube): chỉ hiện ảnh bìa, bấm mới tải YouTube (nhẹ trang, không cookie trước khi xem)."""
    v = bv_info()
    if not v:
        return "", None
    vid, title, cap = v["vid"], v["title"], v["cap"]
    dd = " · " + v["dur"] if v["dur"] else ""
    head = f'<b class="bv-hook">{bv_nw(v["hook"])}</b><span class="bv-sub">{esc(title)}</span>' if v["hook"] else f"<b>{esc(title)}</b>"
    html = f'''<figure class="bv">
  {bv_frame(v, where)}
  <figcaption class="bv-text"><span class="bv-kicker">{t("Câu chuyện đồng hành")}{dd}</span>{head}{f"<p>{esc(cap)}</p>" if cap else ""}<a class="bv-yt" href="https://www.youtube.com/watch?v={vid}" target="_blank" rel="noopener">{t("Xem trên YouTube ↗")}</a></figcaption>
</figure>'''
    img = v["img"]
    ld = {"@context": "https://schema.org", "@type": "VideoObject", "name": title, "description": cap or title,
          "thumbnailUrl": [(DOMAIN + img) if img.startswith("/") else img], "uploadDate": (SITE.get("brand_video") or {}).get("upload_date") or "2026-08-18",
          "embedUrl": f"https://www.youtube-nocookie.com/embed/{vid}", "contentUrl": f"https://www.youtube.com/watch?v={vid}"}
    if (SITE.get("brand_video") or {}).get("duration"):
        ld["duration"] = SITE["brand_video"]["duration"]
    return html, ld


def bv_hero_btn():
    """Nút "▶ Xem câu chuyện" ở khối đầu trang chủ ("Chúng tôi có một ước mơ"): bấm mở video giữa màn hình (khung #bvModal)."""
    v = bv_info()
    if not v or not v["hero"]:
        return ""
    dd = " · " + v["dur"] if v["dur"] else ""
    return (f'<button type="button" class="hero-vid" data-bv-open="hero"><span class="hv-th"><img src="{esc(v["img"])}" alt="" width="54" height="54">{I["play"]}</span>'
            f'<span class="hv-tx"><b>{t("Xem câu chuyện đồng hành")}</b><small>{"Video " + v["dur"] + " · " if v["dur"] else ""}{esc(v["title"].split(":")[0])}</small></span></button>')


def bv_float():
    """Khung xem video giữa màn hình + bong bóng video tròn góc trái dưới (trang chủ, Giới thiệu, bài viết).
    main.js initBrandVideo: bong bóng hiện sau vài giây, ẩn khi thông báo cookie đang mở hoặc khung video trên trang đang trong màn hình;
    khách bấm × → ẩn 3 ngày; đã xem video → ẩn 30 ngày. (18/10/2026)"""
    v = bv_info()
    if not v:
        return ""
    dd = " · " + v["dur"] if v["dur"] else ""
    bub = (f'<div class="bvb" id="bvBubble" hidden><button type="button" class="bvb-main" data-bv-open="bubble" aria-label="{t("Xem video:")} {esc(v["title"])}">'
           f'<span class="bvb-ring"><img src="{esc(v["img"])}" alt="" width="80" height="80" loading="lazy"></span><span class="bvb-tag">{I["play"]}{v["dur"] or t("Xem")}</span>'
           f'<span class="bvb-tx"><b>{t("Câu chuyện đồng hành")}</b><small>{t("Bấm để xem")}{dd}</small></span></button>'
           f'<button type="button" class="bvb-x" data-bv-hide aria-label="{t("Ẩn video")}">{I["close"]}</button></div>') if v["bubble"] else ""
    return f'''<div class="bvm" id="bvModal" hidden role="dialog" aria-modal="true" aria-label="{esc(v["title"])}"><div class="bvm-box">
  <button type="button" class="bvm-x" data-bv-close aria-label="{t("Đóng video")}">{I["close"]}</button>
  {bv_frame(v, "modal")}
  <p class="bvm-cap"><b>{bv_nw(v["hook"] or v["title"])}</b></p>
</div></div>{bub}'''


def page_home():
    # Hero tĩnh: 1 thông điệp + lời mời bắt đầu (Cài đặt → Trang chủ). Các slide cũ thành băng chuyền sản phẩm bên dưới.
    hh = HOME.get("hero") or {}
    hp = PROD_BY.get(hh.get("product") or "")
    h_url = f'/san-pham/{hp["slug"]}/' if hp else "/san-pham/"
    h_buy = f' data-buy-now="{hp["slug"]}"' if hp and hp.get("price") is not None else ""  # bấm là mở Đặt hàng nhanh, không phải sang trang sản phẩm
    h_img = img_url(hh.get("image") or (hp["images"][0] if hp else "/assets/img/brand/og-image.jpg"), 1000)
    h_title = md_inline(esc(hh.get("title") or BRAND).replace("&#x27;", "'"))
    h_cta = esc(hh.get("cta") or t("Mua ngay")) + (f' – {money(hp["price"]).replace(" ₫", "đ")}' if hp and hp.get("price") else "")
    # dòng tin cậy dưới nút (Cài đặt → Trang chủ → Dòng tin cậy): mỗi ý ghi rõ áp dụng cho sản phẩm nào và dẫn tới bằng chứng
    h_trust = "".join(f'<li>{ic("check", "ht-ic")}' + (f'<a href="{esc(x["url"])}" data-cta="hero_trust">{esc(x["text"])}</a>' if x.get("url") else esc(x["text"])) + "</li>" for x in (hh.get("trust") or []) if x.get("text"))
    h_trust = f'<ul class="hero-trust" aria-label="{t("Cam kết chất lượng")}">{h_trust}</ul>' if h_trust else ""
    hero = f'''<section class="hero hero-static">
  <div class="hero-deco" aria-hidden="true"></div>
  <div class="container slide-in">
    <div class="slide-text">{f'<span class="eyebrow">{esc(hh["eyebrow"])}</span>' if hh.get("eyebrow") else ""}<h1 class="slide-title">{h_title}</h1>{f'<p>{esc(hh["sub"])}</p>' if hh.get("sub") else ""}
      <div class="slide-cta hero-cta"><a class="btn btn-lg" href="{h_url}"{h_buy} data-cta="hero_main">{h_cta}</a><a class="btn btn-lg btn-ghost hero-all" href="/san-pham/" data-cta="hero_all">{t("Xem tất cả sản phẩm")}</a></div>{h_trust}</div>
    <div class="slide-media"><a href="{h_url}" tabindex="-1"><img src="{h_img}" alt="{esc(hp["name"] if hp else BRAND)}" width="1000" height="1000" fetchpriority="high"></a></div>
  </div>
</section>'''
    rail = ""
    for sd in HOME.get("slides", []):
        slug = sd.get("product") or ""
        href = f"/san-pham/{slug}/" if slug in PROD_BY else "/san-pham/"
        st = md_inline(esc(sd.get("title", "")).replace("&#x27;", "'"))
        rail += f'''<article class="rl-card"><a class="rl-media" href="{href}"><img src="{img_url(sd.get("image"), 600)}" alt="{esc(strip_tags(st))}" width="600" height="600" loading="lazy"></a>
<div class="rl-body">{f'<span class="rl-eye">{esc(sd["eyebrow"])}</span>' if sd.get("eyebrow") else ""}<h3><a href="{href}">{st}</a></h3><p>{esc(sd.get("subtitle", ""))}</p><a class="btn btn-sm" href="{href}">{t("Xem sản phẩm")}</a></div></article>'''
    rail_html = f'''<section class="section pt-0"><div class="container">
  <div class="rl-head"><h2 class="sec-title">{tf("Nổi bật tại {brand}", brand=BRAND)}</h2><div class="rl-nav"><button type="button" data-rail="-1" aria-label="{t("Xem trước")}">{I["left"]}</button><button type="button" data-rail="1" aria-label="{t("Xem tiếp")}">{I["right"]}</button></div></div>
  <div class="rail" data-rail-box>{rail}</div>
</div></section>''' if rail else ""

    cats = [(t("Toàn bộ sản phẩm"), "/san-pham/", None)] + ([(t("Khuyến Mãi"), "/khuyen-mai/", "sale")] if HAS_SALE else []) + [(c["name"], f"/danh-muc/{c['slug']}/", c["image"]) for c in CATS]
    cat_html = ""
    for name, href, image in cats:
        if image is None:
            media = '<div class="cat-stack">' + "".join(f'<img src="{pimg(p["images"][0], True)}" alt="" width="480" height="480" loading="lazy">' for p in PRODUCTS[:3]) + "</div>"
        elif image == "sale":
            media = f'<div class="cat-sale"><span>%</span></div>'
        else:
            media = f'<img src="{pimg(image, True)}" alt="" width="480" height="480" loading="lazy">'
        cat_html += f'<a class="cat-card" href="{href}"><div class="cat-media">{media}</div><span>{esc(name)}</span></a>'

    featured = [p for p in PRODUCTS if p.get("featured")][:8]

    posts = sorted(POSTS["posts"], key=lambda x: x["date"], reverse=True)[:3]
    post_cards = "".join(post_card(p) for p in posts)

    videos = [("feedback-le-sy-phuc", t("Anh Lê Sỹ Phúc"), t("GĐ Chi nhánh VPBank Kim Mã, Hà Nội")),
              ("feedback-vu-tan", t("Anh Vũ Tân"), t("Giám đốc văn phòng bảo hiểm – Khâm Thiên, Hà Nội")),
              ("feedback-khach-hang-3", t("Khách hàng tin dùng"), t("Chia sẻ trải nghiệm sản phẩm"))]
    vid = "".join(f'''<figure class="v-card"><div class="v-frame" data-video="/assets/video/{v}.mp4"><img src="/assets/img/brand/{v}.webp" alt="{tf("Video cảm nhận của {name}", name=esc(n))}" loading="lazy" width="480" height="854"><button class="v-play" aria-label="{t("Phát video")}">{I["play"]}</button></div><figcaption><b>{esc(n)}</b><span>{esc(r)}</span></figcaption></figure>''' for v, n, r in videos)
    bv_ld = brand_video()[1]  # trang chủ: video câu chuyện đã ở khối Câu chuyện (giữa trang) → bỏ bản lặp ở "Khách hàng nói gì" (18/10/2026), giữ dữ liệu VideoObject cho Google
    bvi = bv_info()  # khối Câu chuyện thương hiệu: có video thì thay ảnh tách trà bằng video (khách đang đọc câu chuyện → bấm xem ngay)
    story_media = (f'<div class="story-media story-vid">{bv_frame(bvi, "story")}<p class="sv-cap"><b>{bv_nw(bvi["hook"] or bvi["title"])}</b></p></div>' if bvi else
                   f'<div class="story-media"><img src="/assets/img/brand/story-tea.webp" alt="{t("Tách trà thảo mộc Thực Dưỡng Lành")}" loading="lazy" width="1200" height="1200"></div>')
    fb = "".join(f'<a class="fb-item" href="/assets/img/brand/feedback-{i}.webp" data-lightbox="fb"><img src="{img_url(f"/assets/img/brand/feedback-{i}.webp", 480)}" alt="{tf("Ảnh chụp tin nhắn phản hồi của khách hàng {i}", i=i)}" loading="lazy" decoding="async" width="480" height="480"></a>' for i in range(1, 6))  # ảnh nhỏ (~25KB) để kịp hiện khi cuộn tới

    tags = ["Dinh dưỡng từ hạt", "Sữa hạt Curcumin", "Fucoidan", "Bữa ăn dinh dưỡng", "Trà chè vằng", "Đinh lăng", "Trà thảo mộc hòa tan", "Ruốc chay", "Rong biển", "Xì dầu lên men", "Ngưu bàng", "Thực dưỡng", "Thuần chay", "Đạm thực vật", "Không đường tinh luyện"]
    from urllib.parse import quote
    tag_html = "".join(f'<a href="/tim-kiem/?q={quote(x)}">{esc(x)}</a>' for x in tags) if IS_VI else ""  # từ khoá tìm kiếm tiếng Việt

    story_h = tf('Câu chuyện {brand}<br>Hành trình <span class="hl">10 triệu</span> người Việt sống lành', brand=BRAND)
    fb_h = tf('Khách hàng nói gì<br><span class="accent">về {brand}</span>', brand=BRAND)
    blog_html = f'''<section class="section bg-soft"><div class="container">
  <h2 class="sec-title big">{t("Góc Sống Lành")}<br><span class="accent">{BRAND}</span></h2>
  <div class="post-grid">{post_cards}</div>
  <div class="center mt-2"><a class="btn btn-outline" href="/goc-song-lanh/">{t("Xem tất cả bài viết")}</a></div>
</div></section>''' if post_cards else ""
    seo_p2 = tf('Mỗi sản phẩm tại {brand} đều được sản xuất tại nhà máy đạt chuẩn (GMP, ISO 22000, HACCP tùy dòng sản phẩm), có kiểm nghiệm chất lượng và thông tin thành phần công khai: từ <a href="/san-pham/bua-an-dinh-duong-vitagreen/">Bữa Ăn Dinh Dưỡng VitaGreen</a>, <a href="/san-pham/dinh-duong-tu-hat-va-curcumin/">Dinh Dưỡng Từ Hạt Và Curcumin</a>, <a href="/san-pham/tra-hoa-tan-dilvang-dinh-lang-che-vang/">Trà Hòa Tan DILVANG</a> đến <a href="/san-pham/ruoc-rong-bien-vi-suon-non/">Ruốc Rong Biển Vị Sườn Non</a> và <a href="/san-pham/xi-dau-2s-do-den-nguu-bang/">Xì Dầu 2S Đỗ Đen Ngưu Bàng</a>.', brand=BRAND)
    seo_p4 = tf('Đặt hàng dễ dàng ngay trên website, giao hàng toàn quốc, kiểm tra hàng trước khi thanh toán. Đội ngũ tư vấn luôn sẵn sàng hỗ trợ qua hotline <a href="tel:{tel}">{hotline}</a> và Zalo. Thông tin khách hàng được bảo mật theo <a href="/chinh-sach-bao-mat/">chính sách bảo mật</a>.', tel=tel(SITE["hotline"]), hotline=esc(SITE["hotline"]))
    brochure_btn = f'<a class="btn btn-lg btn-ghost" href="{BR_PATH}">📖 Đọc hồ sơ thương hiệu</a>' if BROCHURE else ""
    tag_box = f'<div class="tag-cloud">{tag_html}</div>' if tag_html else ""
    # Khối niềm tin đứng đầu trang: trả lời "vì sao" trước khi nói đến sản phẩm (câu treo ở văn phòng) + lời mời đồng hành
    join_btn = f'<a class="blf-btn blf-btn2" href="#dong-hanh" data-cta="belief_join">{t("Cùng đồng hành")} ↓</a>' if SITE.get("community") else ""  # bản EN chưa có khối cộng đồng
    def nw(s, *parts):
        """Giữ các cụm có nghĩa trên cùng 1 dòng (không ngắt "cách / ăn", "Thực Dưỡng / Lành"). Cụm không có trong câu (bản dịch) thì bỏ qua."""
        for x in parts:
            s = s.replace(x, f'<span class="nw">{x}</span>', 1)
        return s
    blf_q = nw(tf("Chúng tôi mơ một ngày {brand} không chỉ là cách ăn — mà là cách sống.", brand=BRAND), "Chúng tôi mơ một ngày", BRAND, "không chỉ là cách ăn —", "mà là cách sống.")
    blf_em = nw(t("Đủ sâu, đủ chậm và đủ thương."), "Đủ sâu,", "đủ chậm", "và đủ thương.")
    blf_join = nw(t("Mời bạn cùng chúng tôi trên hành trình giúp <b>10 triệu người Việt</b> sống khỏe hơn."), "Mời bạn", "cùng chúng tôi", "trên hành trình", "<b>10 triệu người Việt</b>", "sống khỏe hơn.")
    belief = f'''<section class="blf"><div class="container blf-in">
  <h2 class="blf-eye">{t("Chúng tôi có một ước mơ")}</h2>
  <blockquote class="blf-q"><p>{blf_q}<em>{blf_em}</em></p></blockquote>
  <p class="blf-join">{blf_join}</p>
  <div class="blf-acts"><a class="blf-btn" href="{lp("/san-pham/")}" data-cta="belief_shop">{t("Xem sản phẩm")} →</a>{join_btn}<a class="blf-link" href="/gioi-thieu/" data-cta="belief_story">{t("Đọc câu chuyện của chúng tôi")} →</a></div>{bv_hero_btn()}
</div></section>'''
    body = f'''{belief}
{hero}{bv_float()}
{hub_strip("home_top")}
{needs_html()}
<section class="section section-tight"><div class="container">{benefits_banner()}{gifts_block("home")}</div></section>

<section class="section"><div class="container">
  <h2 class="sec-title">{t("Danh mục sản phẩm")}</h2>
  <div class="cat-grid">{cat_html}</div>
</div></section>
{rail_html}

{combos_home()}
<section class="section pt-0"><div class="container">
  <h2 class="sec-title">{t("Sản phẩm được yêu thích nhất")}</h2>
  {grid([x for x in featured if not x.get("combo")], "p-grid p-grid-feature")}
  <p class="sec-note">{tf("Các dòng sản phẩm được nhiều khách hàng của {brand} tin dùng.", brand=BRAND)}</p>
</div></section>

<section class="section bg-soft center-intro"><div class="container narrow">
  <h2 class="brand-title">{BRAND}</h2>
  <h3 class="brand-sub">{esc(SITE["slogan"])}</h3>
  <p>{tf("Ra đời từ câu hỏi chưa kịp có lời đáp: <i>“Giá như mình chăm sóc tốt hơn…”</i>, {brand} – thương hiệu của Công ty VitaGreen Nutrition – được xây dựng trên triết lý <b>Sống xanh – sống lành – sống có giá trị</b>. Chúng tôi mang đến những sản phẩm dinh dưỡng từ hạt, thảo mộc và thực vật Việt Nam với nguồn gốc rõ ràng, giúp người Việt sống khỏe từ <b>THÂN</b> đến <b>TÂM</b>.", brand=BRAND)}</p>
</div></section>

<section class="section"><div class="container story">
  <div class="story-text">
    <h2 class="story-title">{story_h}</h2>
    <p>{t("Sau khi một người thân ra đi đột ngột, không kịp lời tạm biệt, cùng lúc hàng loạt vụ thực phẩm kém chất lượng vỡ lở, những người sáng lập nhận ra: <i>“Ai rồi cũng sẽ đến lúc rời khỏi cuộc đời này. Và nếu ngày mai là ngày cuối, mình đã sống xứng đáng và trọn vẹn chưa?”</i>")}</p>
    <p>{tf("{brand} ra đời không chỉ để bán sản phẩm – mà là lời xin lỗi muộn với những người ta không kịp chăm sóc, lời hứa sớm với những người ta vẫn còn được đồng hành, và lời cam kết với chính mình: <b>“Tôi chọn sống lành – để sống đáng.”</b>", brand=BRAND)}</p>
    <div class="slide-cta"><a class="btn btn-lg" href="/gioi-thieu/">{t("Xem thêm")}</a>{brochure_btn}</div>
  </div>
  {story_media}
</div></section>
{home_origin()}
<section class="parallax" style="background-image:url('/assets/img/brand/parallax-tea.webp')"><div class="container"><h2>{t("Dưỡng Thân – Tâm An<br>Bền Sức Khoẻ")}</h2></div></section>

<section class="section"><div class="container">
  <h2 class="sec-title big">{fb_h}</h2>
  <div class="v-grid">{vid}</div>
  <div class="fb-strip">{fb}</div>
</div></section>

{community_html(h_url, h_buy)}
{blog_html}

<section class="section seo-block"><div class="container">
  <h2 class="seo-h">{tf("{brand} – Dinh Dưỡng Thuần Tự Nhiên", brand=BRAND)}</h2>
  <div class="readmore" data-readmore>
    <p>{tf("<b>Thucduonglanh.vn</b> là website chính thức của thương hiệu {brand} thuộc {company}, nơi cung cấp các sản phẩm dinh dưỡng từ hạt, trà thảo mộc và thực phẩm thuần chay có nguồn gốc rõ ràng, hồ sơ công bố đầy đủ.", brand=BRAND, company=esc(SITE["company"].title()) if IS_VI else "VitaGreen Nutrition")}</p>
    <h3>{t("SẢN PHẨM CHÍNH HÃNG, NGUỒN GỐC MINH BẠCH")}</h3>
    <p>{seo_p2}</p>
    <h3>{t("SỐNG LÀNH TỪ TRONG GỐC")}</h3>
    <p>{tf("Với triết lý <i>“Sống xanh – sống lành – sống có giá trị”</i>, {brand} không chỉ mang đến sản phẩm mà còn lan tỏa lối sống lành mạnh – tỉnh thức – đầy yêu thương: ăn thuận tự nhiên, sống chậm, biết ơn và gieo điều lành mỗi ngày.", brand=BRAND)}</p>
    <h3>{t("MUA SẮM ONLINE AN TOÀN, TIỆN LỢI")}</h3>
    <p>{seo_p4}</p>
  </div>
  <button class="btn btn-sm btn-outline readmore-btn" data-readmore-btn>{t("Xem thêm")}</button>
  {tag_box}
</div></section>'''
    org = org_ld()
    web = {"@context": "https://schema.org", "@type": "WebSite", "name": BRAND, "url": DOMAIN,
           "potentialAction": {"@type": "SearchAction", "target": DOMAIN + "/tim-kiem/?q={search_term_string}", "query-input": "required name=search_term_string"}}
    return layout("/", f"{BRAND} – {SITE['tagline']}", t("Thực Dưỡng Lành – dinh dưỡng từ hạt, trà thảo mộc và thực phẩm thuần chay chính hãng, nguồn gốc rõ ràng. Giao hàng toàn quốc. Hotline ") + SITE["hotline"],
                  body, jsonld=[org, web] + ([bv_ld] if bv_ld else []), body_class="home", preload=h_img)


def org_ld():
    """Thông tin doanh nghiệp cho Google / công cụ AI: tên, tên khác, pháp nhân, MST, liên hệ, mạng xã hội – lấy từ data/site.json."""
    d = (SITE.get("tax_date") or "").split("/")
    org = {"@context": "https://schema.org", "@type": "Organization", "@id": DOMAIN + "/#org", "name": BRAND,
           "alternateName": ["Thuc Duong Lanh", "VitaGreen Nutrition"], "legalName": SITE["company"], "url": DOMAIN,
           "logo": DOMAIN + "/assets/img/brand/logo@2x.png", "image": DOMAIN + "/assets/img/brand/og-image.jpg",
           "description": t("Thực Dưỡng Lành (VitaGreen Nutrition) – thương hiệu dinh dưỡng từ hạt, trà thảo mộc và thực phẩm thuần chay có hồ sơ công bố rõ ràng, giao hàng toàn quốc."),
           "slogan": SITE.get("slogan") or None, "email": SITE["email"], "telephone": SITE["hotline"],
           "taxID": SITE.get("tax_code") or None, "foundingDate": f"{d[2]}-{d[1]}-{d[0]}" if len(d) == 3 else None,
           "address": {"@type": "PostalAddress", "streetAddress": SITE["address"], "addressLocality": "Gia Lâm", "addressRegion": "Hà Nội", "addressCountry": "VN"},
           "contactPoint": {"@type": "ContactPoint", "telephone": SITE["hotline"], "contactType": "customer service", "areaServed": "VN", "availableLanguage": ["vi"]},
           "sameAs": [u for u in SITE["socials"].values() if u]}
    return {k: v for k, v in org.items() if v}


def community_html(start_url="/san-pham/", buy=""):
    """Lời mời đồng hành (#dong-hanh, nút ở khối Chúng tôi có một ước mơ dẫn tới): các kênh cộng đồng + bắt đầu 10 ngày."""
    items = [dict(c, url=f"{ZALO_GATE}?tu=dong_hanh") if SITE.get("zalo_group") and c.get("url") == SITE["zalo_group"] else c for c in (SITE.get("community") or [])]  # nhóm Zalo: qua cổng để lại số trước
    if not items:
        return ""
    cards = "".join(f'''<article class="cm-card"><a class="cm-media" href="{esc(c["url"])}" target="_blank" rel="noopener" data-cta="join_{i}"><img src="{esc(img_url(c["image"], 600))}" alt="{esc(c["name"])}" loading="lazy" width="600" height="600"><span class="cm-stat">{esc(c.get("stat",""))}</span></a>
<h3><a href="{esc(c["url"])}" target="_blank" rel="noopener">{esc(c["name"])}</a></h3><p>{esc(c.get("desc",""))}</p><a class="more" href="{esc(c["url"])}" target="_blank" rel="noopener">{t("Tham gia ngay")} {I["right"]}</a></article>''' for i, c in enumerate(items))
    # tổng số người theo dõi lấy từ ô "stat" (98.000+ …), làm tròn xuống chục nghìn để không nói quá
    total = sum(int(re.sub(r"\D", "", m)) for c in items for m in re.findall(r"\d[\d.]*", c.get("stat", "")[:12]))
    total = total // 10000 * 10000
    sub = tf("Hơn <b>{n}</b> người đang theo dõi {brand} trên các kênh. Chọn một nơi để cùng sống lành mỗi ngày, hoàn toàn miễn phí.", n=f"{total:,}".replace(",", "."), brand=BRAND) if total >= 10000 else t("Chọn một nơi để cùng sống lành mỗi ngày, hoàn toàn miễn phí.")
    quiz_btn = f'<a class="btn btn-lg btn-ghost" href="{QUIZ_PATH}" data-cta="join_quiz">🖐 Chơi thử: Bạn còn mấy ngón tay?</a>' if IS_VI and QUIZ.get("questions") else ""
    pledge_btn = f'<a class="btn btn-lg" href="{PLEDGE_PATH}" data-cta="join_pledge">🌱 {t("Tôi chọn sống lành")}</a>' if IS_VI else ""
    return f'''<section class="section join" id="dong-hanh"><div class="container">
  <p class="join-eye">{t("Lời mời đồng hành")}</p>
  <h2 class="sec-title big">{t("Cùng chúng tôi đi hành trình")}<br><span class="accent">{t("10 triệu người Việt sống khỏe hơn")}</span></h2>
  <p class="join-sub">{sub}</p>
  {journey_counter()}
  {wall_strip()}
  {journey_map()}
  <div class="cm-grid">{cards}</div>
  <div class="join-self"><p>{t("Hoặc bắt đầu từ chính mình, từ hôm nay:")}</p><div class="join-btns">{pledge_btn}{quiz_btn}<a class="btn btn-lg{" btn-ghost" if pledge_btn else ""}" href="{start_url}"{buy} data-cta="join_start">{t("Bắt đầu 10 ngày sống lành")}</a></div></div>
</div></section>'''


PLEDGE_PATH = "/toi-chon-song-lanh/"  # trước 23/10/2026 là /cam-ket-song-lanh/ (_redirects chuyển 301 sang đây)
PLEDGE_ITEMS = ["Ăn chậm hơn, chọn bữa ăn lành hơn cho mình và gia đình.",
                "Lắng nghe cơ thể: ngủ đủ, uống đủ nước, vận động mỗi ngày.",
                "Chăm sóc sớm hơn những người mình thương."]


_JR = None
def journey_now():
    """Số hành trình lúc build (api /api/journey), để ghi sẵn vào HTML: bot tìm kiếm và khách mạng chậm thấy số thật thay vì 0.
    Lỗi mạng / chưa có api thì trả {} → giữ như cũ (khối ẩn tới khi main.js lấy được số)."""
    global _JR
    if _JR is None:
        _JR = {}
        api = SITE.get("api_endpoint") or ""
        if api.endswith("/api"):
            try:
                from urllib.request import urlopen, Request
                req = Request(api + "/journey", headers={"User-Agent": "Mozilla/5.0 (tdl-build)", "Origin": "https://thucduonglanh.vn"})
                j = json.loads(urlopen(req, timeout=6).read().decode("utf-8"))
                if j.get("ok") and j.get("total"):
                    _JR = j
            except Exception as e:
                print("  (bỏ qua số hành trình lúc build:", e, ")")
    return _JR


def journey_counter():
    """Bộ đếm hành trình 10 triệu người: số thật lấy từ api /api/journey (khách đã mua + lời cam kết).
    Lúc build ghi sẵn số làm tròn xuống trăm (vd 8.000) → main.js đếm tiếp lên số mới nhất; build không lấy được số thì khối ẩn như cũ."""
    if not IS_VI:
        return ""
    j = journey_now()
    vn = lambda n: f"{int(n):,}".replace(",", ".")
    tot = j.get("total", 0) // 100 * 100
    buy = j.get("buyers", 0) // 100 * 100
    return f'''<div class="jr" data-jr{"" if tot else " hidden"}><p class="jr-num"><b data-jr-total{f' data-from="{tot}"' if tot else ""}>{vn(tot) + "+" if tot else "0"}</b><span>người đã cùng Thực Dưỡng Lành sống lành</span></p>
<p class="jr-meta"><span data-jr-buyers>{vn(buy) + "+" if buy else ""}</span> khách hàng tin dùng<span data-jr-pl hidden> · <span data-jr-pledges></span> người chọn sống lành</span> · Mục tiêu <b>10.000.000</b> người Việt</p></div>'''


def journey_map(on_pledge=False):
    """Bản đồ hành trình (23/10/2026): 34 tỉnh mới + Hoàng Sa, Trường Sa (assets/img/ban-do-34-tinh.svg, dựng từ ranh giới hành chính 2025).
    Tỉnh có người đồng hành (khách đã mua + người bấm "Tôi chọn sống lành") được tô xanh đậm dần theo số người và cắm ghim; số lấy từ api /api/journey (ô prov).
    main.js initJourneyMap: chỉ tải hình khi khách cuộn gần tới; lỗi mạng thì khối tự ẩn."""
    if not IS_VI:
        return ""
    legend = "".join(f'<li><i class="jm-l{i}"></i>{t}</li>' for i, t in enumerate(["Chưa có", "1–9", "10–49", "50–199", "200–999", "1.000+"]))
    return f'''<div class="jm" id="ban-do" data-jm data-src="/assets/img/ban-do-34-tinh.svg?v={VERSION}" hidden>
  <div class="jm-map"><div class="jm-svg" data-jm-svg></div><div class="jm-tip" data-jm-tip hidden></div></div>
  <div class="jm-head">
    <p class="jm-eye">Bản đồ hành trình</p>
    <p class="jm-big">Đã có mặt ở <b data-jm-n>{min(34, len([v for v in (journey_now().get("prov") or {}).values() if v]))}</b><span>/34 tỉnh, thành phố</span></p>
    <div class="jm-bar"><i data-jm-bar></i></div>
    <p class="jm-me" data-jm-me hidden></p>
  </div>
  <div class="jm-side">
    <p class="jm-h">Nơi có nhiều người đồng hành nhất</p>
    <ol class="jm-top" data-jm-top></ol>
    <p class="jm-wait" data-jm-wait hidden></p>
    <div class="jm-cta"><a class="btn btn-lg" href="{"#chon-song-lanh" if on_pledge else PLEDGE_PATH}" data-cta="map_pledge">🌱 Tôi chọn sống lành</a><p>Cùng đồng hành với {BRAND} và thắp sáng tỉnh của bạn <span class="nw">trên bản đồ</span></p></div>
    <ul class="jm-legend" aria-label="Chú thích màu: số người đồng hành">{legend}</ul>
    <p class="jm-note">Người đồng hành = khách hàng đã tin dùng + người đã chọn sống lành trên website. Chạm vào một tỉnh để xem số người. Bản đồ 34 tỉnh, thành phố theo địa giới hành chính mới.</p>
  </div>
</div>'''


def page_pledge():
    """Trang /toi-chon-song-lanh/ (23/10/2026 đổi từ "lời cam kết" sang "Tôi chọn sống lành" cho nhẹ nhàng, dễ tham gia) → ảnh chứng nhận để chia sẻ (main.js initPledge, api journey.js)."""
    items = "".join(f"<li>{esc(x)}</li>" for x in PLEDGE_ITEMS)
    # ô gõ tìm tỉnh (main.js initProvPick): [tên mới, tên gọi khác]. Gõ tên tỉnh cũ (Nam Định, Bình Dương…) vẫn ra tỉnh mới sau sáp nhập 07/2025
    # [tên mới, tên khác, 1 = tỉnh cũ (hiện "gồm … cũ")]
    pv_list = [[u["n"], "", 0] for u in sorted(json.loads((DATA / "vn-units.json").read_text(encoding="utf-8")), key=lambda u: u["n"].replace("Đ", "D~"))]
    pv_list += [[e[2], e[0], 1] for e in json.loads((DATA / "vn-units-old.json").read_text(encoding="utf-8")) if e[0] != e[2]]
    pv_list += [["Huế", "Thừa Thiên Huế", 0], ["Hồ Chí Minh", "Sài Gòn", 0], ["Hồ Chí Minh", "TP HCM", 0], ["Hồ Chí Minh", "Vũng Tàu", 1], ["Ở nước ngoài", "", 0]]
    hh = HOME.get("hero") or {}
    hp = PROD_BY.get(hh.get("product") or "")
    start = f'/san-pham/{hp["slug"]}/' if hp else "/san-pham/"
    body = f'''<section class="section plg-page"><div class="container plg-in">
  <p class="join-eye">Hành trình 10 triệu người Việt sống khỏe hơn</p>
  <h1 class="plg-h">Tôi chọn sống lành</h1>
  <p class="plg-lead">Hành trình nào cũng bắt đầu từ một lựa chọn nhỏ. Chọn sống lành để đồng hành cùng {BRAND} trên hành trình lan tỏa và truyền cảm hứng đến 10 triệu người Việt sống khỏe hơn mỗi ngày, rồi nhận ảnh chứng nhận để chia sẻ với người thân.</p>
  {journey_counter()}
  <div class="plg-card" id="chon-song-lanh">
    <form class="plg-form" data-pledge novalidate>
      <h2>Lựa chọn của tôi</h2>
      <p class="plg-intro">Tôi chọn sống lành, để sống đáng. Từ hôm nay, mỗi ngày một chút:</p>
      <ol class="plg-list">{items}</ol>
      <label class="plg-f"><span>Tên của bạn *</span><input name="name" maxlength="40" autocomplete="name" placeholder="Ví dụ: Nguyễn Thu Hà" required></label>
      <div class="plg-f pv" data-pv='{esc(json.dumps(pv_list, ensure_ascii=False))}'><label for="plgProv"><span>Tỉnh / thành phố (không bắt buộc)</span></label>
        <input id="plgProv" name="province" autocomplete="off" placeholder="Gõ tên tỉnh, ví dụ: nghe an" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="plgProvList">
        <ul class="pv-list" id="plgProvList" role="listbox" hidden></ul></div>
      <input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
      <button class="btn btn-lg plg-submit" type="submit" value="1" data-cta="pledge_show">🌱 Tôi chọn sống lành và hiện tên trên Bức tường</button>
      <p class="plg-prev" data-plg-prev>Tên được che bớt để chỉ bạn nhận ra mình: Nguyễn Thu Hà sẽ hiện là <b>N.T. Hà</b>. <a href="{WALL_PATH}" target="_blank" rel="noopener">Xem Bức tường Sống Lành</a></p>
      <p class="plg-nopub"><button class="link-btn" type="submit" value="0" data-cta="pledge_nopub">Chọn sống lành, không hiện tên</button></p>
      <p class="form-msg" data-plg-msg role="status"></p>
      <p class="plg-note">Tên đầy đủ của bạn chỉ dùng để in lên ảnh chứng nhận ngay trên máy bạn, website không lưu. Nếu bạn bấm nút “và hiện tên”, website chỉ lưu tên đã che bớt (kèm tỉnh/thành nếu bạn chọn) để hiện trên Bức tường. Muốn gỡ tên, bạn nhắn Zalo {esc(SITE["hotline"])}. Xem <a href="/chinh-sach-bao-mat/">chính sách bảo mật</a>.</p>
    </form>
    <div class="plg-done" data-plg-done hidden>
      <p class="plg-thanks">Cảm ơn <b data-plg-name></b>! Bạn là người thứ <b data-plg-no></b> trên hành trình 10 triệu người Việt sống khỏe hơn.</p>
      <p class="plg-lit" data-plg-lit hidden></p>
      <img class="plg-img" data-plg-img alt="Ảnh chứng nhận Tôi chọn sống lành" width="1080" height="1350">
      <div class="plg-acts"><a class="btn" data-plg-dl download="toi-chon-song-lanh.png" href="#">⬇️ Tải ảnh</a><button class="btn btn-ghost" type="button" data-plg-share>📤 Chia sẻ</button><button class="btn btn-ghost" type="button" data-plg-invite>💌 Mời người thân cùng chọn</button></div>
      <p class="plg-wall" data-plg-wall hidden></p>
      <p class="plg-again"><button type="button" class="link-btn" data-plg-again>Thêm một người thân cùng chọn sống lành</button></p>
      {f'<div class="plg-gift">{gift_form("camnang", "pledge")}</div>' if CN_PATH else ""}
    </div>
  </div>
  {wall_strip()}
  {journey_map(on_pledge=True)}
  <div class="plg-next"><p>Lời hứa nhỏ, bắt đầu từ bữa ăn hôm nay:</p><a class="btn btn-lg btn-ghost" href="{start}" data-cta="pledge_start">Bắt đầu 10 ngày sống lành</a>{f'<p class="plg-quiz">Hoặc chơi thử trò 1 phút: <a href="{QUIZ_PATH}" data-cta="pledge_quiz">🖐 Bạn còn mấy ngón tay?</a></p>' if QUIZ.get("questions") else ""}</div>
</div></section>'''
    return layout(PLEDGE_PATH, "Tôi chọn sống lành – Hành trình 10 triệu người Việt sống khỏe hơn", f"Chọn sống lành cùng {BRAND} trên hành trình lan tỏa và truyền cảm hứng đến 10 triệu người Việt sống khỏe hơn mỗi ngày, rồi nhận ảnh chứng nhận để chia sẻ.", body, body_class="page-pledge")


WALL_PATH = "/buc-tuong-song-lanh/"


def wall_strip():
    """Dải "Những người vừa chọn sống lành" (trang chủ #dong-hanh, trang Tôi chọn sống lành): tên đã che mới nhất chạy chậm, bấm sang Bức tường.
    main.js initWallStrip lấy từ api /api/wall; chưa có ai hiện tên hoặc lỗi mạng thì giữ ẩn."""
    if not IS_VI:
        return ""
    return f'''<div class="wst" data-wst hidden><a class="wst-in" href="{WALL_PATH}" data-cta="wall_strip"><span class="wst-h">🌱 Vừa chọn sống lành</span><span class="wst-run"><span class="wst-track" data-wst-track></span></span><span class="wst-go">Tìm tên bạn →</span></a></div>'''


def page_wall():
    """Bức tường Sống Lành /buc-tuong-song-lanh/ (23/10/2026): danh sách người chọn sống lành, tìm theo tên không dấu / số thứ tự, lọc tỉnh.
    Chỉ có tên đã che (Đ.M.T. Sơn) của người bấm nút "…và hiện tên"; còn lại hiện "Một người bạn". main.js initWall, api journey.js wall."""
    provs = sorted([u["n"] for u in json.loads((DATA / "vn-units.json").read_text(encoding="utf-8"))], key=lambda n: n.replace("Đ", "D~"))
    opts = "".join(f'<option value="{esc(n)}">{esc("TP. Hồ Chí Minh" if n == "Hồ Chí Minh" else n)}</option>' for n in provs)
    body = f'''<section class="section wl-page"><div class="container wl-in">
  <p class="join-eye">Hành trình 10 triệu người Việt sống khỏe hơn</p>
  <h1 class="plg-h">Bức tường <span class="nw">Sống Lành</span></h1>
  <p class="plg-lead">Mỗi cái tên ở đây là một người đã chọn sống lành, cùng {BRAND} lan tỏa đến 10 triệu người Việt. Gõ tên hoặc số thứ tự trên ảnh chứng nhận để tìm lại chính mình.</p>
  {journey_counter()}
  <form class="wl-find" data-wl-form role="search">
    <label class="wl-q"><span class="wl-sr">Tìm tên hoặc số thứ tự</span><input name="q" type="search" placeholder="Gõ tên (không cần dấu) hoặc số, ví dụ: thu ha" autocomplete="off" enterkeyhint="search"></label>
    <label class="wl-p"><span class="wl-sr">Tỉnh / thành phố</span><select name="p"><option value="">Tất cả tỉnh, thành</option>{opts}</select></label>
    <button class="btn" type="submit">🔎 Tìm</button>
  </form>
  <p class="wl-hint">Tên được che bớt để giữ riêng tư: Nguyễn Thu Hà hiện là <b>N.T. Hà</b>. Gõ “ha”, “thu ha” hoặc “nguyen thu ha” đều tìm được.</p>
  <p class="wl-sum" data-wl-sum role="status"></p>
  <ul class="wl-grid" data-wl-list></ul>
  <p class="center"><button class="btn btn-ghost" type="button" data-wl-more hidden>Xem thêm</button></p>
  <div class="wl-cta"><p>Bạn chưa có tên trên Bức tường?</p><a class="btn btn-lg" href="{PLEDGE_PATH}#chon-song-lanh" data-cta="wall_pledge">🌱 Tôi chọn sống lành</a>
  <p class="wl-note">Chỉ hiện tên của người chọn “hiện tên trên Bức tường”, những người khác hiện là “Một người bạn”. Muốn gỡ tên khỏi Bức tường, bạn nhắn Zalo {esc(SITE["hotline"])} kèm số thứ tự trên ảnh chứng nhận.</p></div>
</div></section>'''
    return layout(WALL_PATH, "Bức tường Sống Lành – Những người chọn sống lành cùng Thực Dưỡng Lành", f"Danh sách những người đã chọn sống lành cùng {BRAND} trên hành trình 10 triệu người Việt sống khỏe hơn. Tìm lại tên của bạn.", body, body_class="page-wall")


QUIZ_PATH = "/ngon-tay-song-lanh/"
_qf = DATA / "quiz.json"
QUIZ = json.loads(_qf.read_text("utf-8")) if _qf.exists() else {}


def hands_html(cls="qz-hands"):
    """2 bàn tay xòe 10 ngón (CSS .qz-…); ngón bị hạ: main.js thêm class .down vào [data-qz-f]."""
    hand = lambda side, base: f'<div class="qz-hand qz-{side}">' + "".join(f'<span class="qz-f qz-f{i}" data-qz-f="{base + i}"></span>' for i in range(5)) + '<span class="qz-palm"></span></div>'
    return f'<div class="{cls}" aria-hidden="true">{hand("l", 0)}{hand("r", 5)}</div>'


def page_quiz():
    """Trò chơi "Bạn còn mấy ngón tay?" (data/quiz.json, sửa ở /admin): 10 câu thói quen → điểm + gợi ý + thử thách 7 ngày + ảnh chia sẻ.
    main.js initQuiz; gửi điểm (không tên/SĐT) về api journey.js → thống kê CRM 📣 Marketing."""
    qs = [q for q in QUIZ.get("questions") or [] if q.get("q")]
    prods = {}
    for q in qs:
        p = PROD_BY.get(q.get("product") or "")
        if p:
            prods[p["slug"]] = {"name": p.get("short_name") or p["name"], "pitch": p.get("pitch") or "", "url": f'/san-pham/{p["slug"]}/', "img": img_url(p["images"][0], 200) if p.get("images") else ""}
    data = {"questions": qs, "results": sorted(QUIZ.get("results") or [], key=lambda r: -int(r.get("min") or 0)), "products": prods}
    n = len(qs)
    data_js = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    body = f'''<section class="section qz-page"><div class="container qz-in">
  <p class="join-eye">Trò chơi 1 phút · Hành trình 10 triệu người Việt sống khỏe hơn</p>
  <h1 class="plg-h">{esc(QUIZ.get("title") or "Bạn còn mấy ngón tay?")}</h1>
  <div class="qz-card" data-quiz>
    {hands_html()}
    <div class="qz-start" data-qz-start>
      <p class="qz-lead">{esc(QUIZ.get("lead") or "")}</p>
      <ul class="qz-rules"><li>✋ Thói quen tốt: <b>giữ ngón tay</b></li><li>👇 Chưa làm được: <b>hạ một ngón</b></li></ul>
      <button class="btn btn-lg qz-go" type="button" data-qz-go>Bắt đầu chơi</button>
      <p class="qz-note">{n} câu · khoảng 1 phút · không cần đăng ký</p>
      <p class="qz-last" data-qz-last hidden></p>
    </div>
    <div class="qz-play" data-qz-play hidden>
      <div class="qz-prog"><span data-qz-step></span><span class="qz-bar"><i data-qz-bar></i></span><span class="qz-left">Còn <b data-qz-left>10</b> ngón</span></div>
      <p class="qz-ic" data-qz-ic></p>
      <h2 class="qz-q" data-qz-q tabindex="-1"></h2>
      <p class="qz-fun" data-qz-fun></p>
      <div class="qz-btns"><button class="btn btn-lg qz-yes" type="button" data-qz-a="1">✋ Có, giữ ngón tay</button><button class="btn btn-lg btn-ghost qz-no" type="button" data-qz-a="0">👇 Chưa, hạ một ngón</button></div>
      <p class="qz-back"><button type="button" class="link-btn" data-qz-back>← Câu trước</button></p>
    </div>
    <div class="qz-done" data-qz-done hidden>
      <p class="qz-score">Bạn còn <b data-qz-score></b><span>/{n} ngón tay</span></p>
      <p class="qz-tier"><span data-qz-tic></span> <b data-qz-title></b></p>
      <p class="qz-msg" data-qz-msg></p>
      <p class="qz-cmp" data-qz-cmp hidden></p>
      <div class="plg-acts"><button class="btn" type="button" data-qz-share>📤 Khoe kết quả</button><button class="btn btn-ghost" type="button" data-qz-invite>🤝 Thách bạn bè chơi</button><a class="btn btn-ghost" data-qz-dl download="ngon-tay-song-lanh.png" href="#">⬇️ Tải ảnh</a></div>
      <img class="qz-img" data-qz-img alt="Ảnh kết quả trò chơi Bạn còn mấy ngón tay" width="1080" height="1080" hidden>
    </div>
  </div>
  <div class="qz-more" data-qz-more hidden>
    <div class="qz-box" data-qz-tips-box><h2>Việc nhỏ để dựng lại từng ngón tay</h2><p class="qz-sub">Không cần đổi hết một lần. Mỗi thói quen chỉ cần một việc nhỏ làm được ngay hôm nay:</p><ul class="qz-tips" data-qz-tips></ul></div>
    {f'<div class="qz-gift" data-qz-gift>{gift_form("camnang", "quiz")}</div>' if CN_PATH else ""}
    <div class="qz-box qz-ch" data-qz-ch><h2>Thử thách 7 ngày: dựng lại 1 ngón tay</h2>
      <div data-qz-ch-pick><p class="qz-sub">Chọn <b>một</b> thói quen bạn muốn sửa trước. Mỗi ngày làm được thì vào đây tích ✓. Sau 7 ngày, chơi lại để xem mình còn mấy ngón nhé!</p><div class="qz-picks" data-qz-picks></div></div>
      <div data-qz-ch-run hidden><p class="qz-sub">Thói quen của bạn: <b data-qz-ch-name></b></p><div class="qz-days" data-qz-days></div><p class="qz-ch-msg" data-qz-ch-msg></p><p class="qz-ch-acts"><button type="button" class="link-btn" data-qz-ch-reset>Đổi thói quen khác</button></p></div>
      {f'<a class="qz-zalo" href="{ZALO_GATE}?tu=quiz" target="_blank" rel="noopener" data-cta="quiz_zalo">👥 Vào nhóm Zalo để được nhắc thử thách mỗi ngày →</a>' if SITE.get("zalo_group") else ""}
      <p class="qz-note">Bảng tích ✓ chỉ lưu trên máy của bạn, không gửi đi đâu.</p>
    </div>
    <div class="qz-box qz-prods" data-qz-prods hidden><h2>Gợi ý nhỏ từ {BRAND}</h2><div data-qz-prod-list></div><p class="qz-disc">Sản phẩm là thực phẩm, không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh.</p></div>
    <div class="qz-next"><p>Muốn đi xa hơn? Chọn một điều nhỏ cho chính mình:</p><a class="btn btn-lg" href="{PLEDGE_PATH}" data-cta="quiz_pledge">🌱 Tôi chọn sống lành</a>
      <p class="qz-again"><button type="button" class="link-btn" data-qz-again>🔁 Chơi lại từ đầu</button></p></div>
  </div>
  <p class="qz-foot">Trò chơi chỉ để tham khảo vui, không thay thế lời khuyên của bác sĩ hay chuyên gia y tế. Website chỉ đếm số điểm chung, không lưu tên hay số điện thoại của bạn.</p>
</div></section>
<script type="application/json" id="qz-data">{data_js}</script>'''
    return layout(QUIZ_PATH, f'{QUIZ.get("title") or "Bạn còn mấy ngón tay?"} – Trò chơi lối sống lành', f"Trò chơi 1 phút: trả lời {n} câu về thói quen hằng ngày, xem bạn còn mấy ngón tay, nhận gợi ý nhỏ và thử thách 7 ngày sống lành cùng {BRAND}.", body, og="/assets/img/og-ngon-tay.jpg" if (ROOT / "assets/img/og-ngon-tay.jpg").exists() else None, body_class="page-quiz")


QUIZ_GROUP_PATH = QUIZ_PATH + "nhom/"


OCX_PATH = "/bo-o-cu/"  # landing quảng cáo "Bộ Ở Cữ Thảnh Thơi 21 Ngày" (Trà DILVANG, mẹ ở cữ cùng bà) – offer: Google Doc Offer_Bo_O_Cu_Thanh_Thoi_DILVANG
OCX = {  # số liệu offer: sửa ở đây. Giá trị quà, cam kết là ĐỀ XUẤT trong offer 23/10/2026, chờ anh Sơn chốt (hạn 27/10)
    "product": "tra-hoa-tan-dilvang-dinh-lang-che-vang", "boxes": 3, "price": 369000,
    "up_boxes": 6, "up_price": 699000,
    "until": "",  # hạn quà tặng đợt này "YYYY-MM-DD" (để trống = không hiện; quá hạn trình duyệt tự ẩn dòng hạn). Chỉ ghi khi đợt quà thật sự kết thúc ngày đó
    "bonus": [("Cốc giữ nhiệt có vạch 300–400ml", "", "Pha đúng lượng nước, đêm không nguội nhanh", 89000),
              ("“Thư gửi Bà”", "Tờ in chữ to kể nguồn gốc: chè vằng Quảng Trị có chỉ dẫn địa lý, nhà máy đạt GMP", "Bà đọc, bà yên tâm", 49000),
              ("Sổ tay “21 ngày ở cữ nhẹ nhàng”", "Giờ uống nước, thực đơn gợi ý, mẹ và bà cùng đọc", "Biết làm đúng, đỡ tranh luận", 99000),
              ("Zalo hỏi đáp với chuyên viên VitaGreen 30 ngày", "", "Có người để hỏi khi băn khoăn", 150000),
              ("Thẻ “Việc của Bố” + thiệp để bố tự viết", "", "Bố viết vài dòng cho vợ, tối tự tay pha một cốc", 29000)],
}


def page_ocx():
    """Landing quảng cáo Bộ Ở Cữ Thảnh Thơi (23/10/2026): Hook → Kết quả → Chuyện nhà → Nguồn gốc → Cách pha → Nhận gì → Bảo đảm → 2 bước.
    Form giữ bộ → api {type:'contact'} (khách hỏi kênh "Form website" + Telegram LIÊN HỆ MỚI), không cần sửa api. JS main.js initOcx, CSS .ocx-… cuối style.css.
    Không bán "lợi sữa": DILVANG là thực phẩm tự công bố, chỉ nói tiện lợi + nguồn gốc. noindex, không vào sitemap."""
    p = next((x for x in PRODUCTS if x["slug"] == OCX["product"]), None)
    if not p or not p.get("price"):
        return None
    hot, zl, n = SITE["hotline"], zalo_link(), OCX["boxes"]
    retail, up_retail = p["price"] * n, p["price"] * OCX["up_boxes"]
    bonus = OCX["bonus"]
    total = retail + sum(b[3] for b in bonus)
    vnd = lambda x: f"{int(x):,}".replace(",", ".") + "đ"
    rows = f'<tr><td><span class="ocx-tag">Chính</span>{n} hộp Trà hòa tan DILVANG<small>{n * 15} gói, đủ khoảng {n * 15 // 3}–{n * 15 // 2} ngày theo nhãn (2–3 gói/ngày)</small></td><td>Cốc chè vằng ấm mỗi ngày</td><td class="v">{vnd(retail)}</td></tr>'
    rows += "".join(f'<tr><td><span class="ocx-tag">Tặng</span>{esc(a)}{f"<small>{esc(s)}</small>" if s else ""}</td><td>{esc(w)}</td><td class="v">{vnd(v)}</td></tr>' for a, s, w, v in bonus)
    img = lambda src, w, alt, cls="", extra="": f'<img src="{img_url(src, w)}" alt="{esc(alt)}" class="{cls}" loading="lazy" decoding="async"{extra}>'
    pk1, pk2 = f"Bộ Ở Cữ Thảnh Thơi 21 Ngày ({n} hộp) – {vnd(OCX['price'])}", f"Trọn 6 Tuần Ở Cữ ({OCX['up_boxes']} hộp, giao 2 lần) – {vnd(OCX['up_price'])}"
    until = f'<p class="ocx-until" data-until="{esc(OCX["until"])}">🎁 Quà tặng kèm bộ áp dụng đến hết ngày {"/".join(reversed(OCX["until"].split("-")))}.</p>' if OCX.get("until") else ""
    disc = "Sản phẩm này là thực phẩm, không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh."
    body = f'''<div class="ocx">
<section class="ocx-hero"><div class="ocx-wrap">
  <div class="ocx-hero-g">
    <div class="ocx-stack">
      <span class="ocx-eye">Dành cho mẹ đang ở cữ</span>
      <h1>Cốc chè vằng ấm sau 10 giây, <span class="nw">kể cả lúc 2 giờ sáng</span></h1>
      <p class="ocx-lead">Dành cho mẹ đang ở cữ cùng bà. Không cần đun nồi, không phải lọc bã, không cãi nhau với bà chuyện kiêng cữ.</p>
      <div class="ocx-cta"><a class="ocx-btn" href="#dat" data-cta="ocx_hero">Giữ 1 bộ, shop gọi lại</a><a class="ocx-btn ghost" href="#nhan" data-cta="ocx_hero_stack">Xem bộ gồm những gì</a></div>
      <p class="ocx-mini">Trà hòa tan DILVANG · chè vằng – đinh lăng Quảng Trị · {vnd(OCX["price"])} cả bộ, miễn phí giao hàng</p>
    </div>
    {img("/assets/img/products/tra-dilvang-5.webp", 1000, "Xé gói Trà DILVANG, pha nước ấm vào cốc", "ocx-hero-img", ' fetchpriority="high" width="1000" height="1000"').replace(' loading="lazy"', "")}
  </div>
  <div class="ocx-facts">
    <div><b>10 giây</b><span>xé gói, khuấy đều là uống</span></div>
    <div><b>40–50°C</b><span>pha nước ấm, không cần đun sôi</span></div>
    <div><b>300–400ml</b><span>mỗi gói một cốc đầy</span></div>
    <div><b>{n * 15} gói</b><span>{n} hộp trong một bộ</span></div>
  </div>
</div></section>

<section class="ocx-band"><div class="ocx-wrap">
  <div class="ocx-head"><h2>21 ngày tới, trong nhà <span class="nw">sẽ khác thế này</span></h2></div>
  <div class="ocx-g4">
    <div class="ocx-card"><i>1</i><h3>Bà được nghỉ tay</h3><p>Không phải đứng bếp đun nồi chè vằng to mỗi sáng.</p></div>
    <div class="ocx-card"><i>2</i><h3>Không còn chè nguội</h3><p>Mẹ không phải uống cốc chè đã để từ trưa.</p></div>
    <div class="ocx-card"><i>3</i><h3>Đêm vẫn có cốc ấm</h3><p>Một tay bế con, một tay xé gói, khuấy 10 giây là xong.</p></div>
    <div class="ocx-card"><i>4</i><h3>Bà gật đầu</h3><p>Bà đọc “Thư gửi Bà” in chữ to: chè vằng Quảng Trị có chỉ dẫn địa lý, làm ở nhà máy đạt GMP.</p></div>
  </div>
</div></section>

<section><div class="ocx-wrap">
  <div class="ocx-head"><span class="ocx-eye">Chuyện nhà nào có bà chăm cũng gặp</span><h2>Bà bảo phải uống chè vằng. <span class="nw">Mẹ bảo không ai đun.</span></h2></div>
  <div class="ocx-ten">
    <div class="ocx-col"><span class="ocx-lbl">Trước đây</span><h3>Ai cũng mệt</h3><ul><li>Bà đi chợ mua lá, đun nồi to, lọc bã</li><li>Mẹ tự tìm hiểu uống thế nào cho đúng</li><li>Cả nhà tranh luận chuyện kiêng cữ</li><li>Chồng không biết giúp gì</li></ul></div>
    <div class="ocx-col after"><span class="ocx-lbl">Với Bộ Ở Cữ Thảnh Thơi</span><h3>Ai cũng có việc vừa sức</h3><ul><li>Xé gói, pha nước ấm, khuấy đều</li><li>Lịch uống in sẵn trên thẻ: 2–3 gói mỗi ngày theo nhãn</li><li>“Thư gửi Bà” in chữ to, kể rõ nguồn gốc</li><li>Thẻ “Việc của Bố”: tối pha cho vợ một cốc</li></ul></div>
  </div>
  <p class="ocx-quote">Bà vẫn đúng, mẹ vẫn được nghỉ. Chỉ cần đổi nồi chè thành một gói pha 10 giây.</p>
</div></section>

<section class="ocx-band" id="nguon-goc"><div class="ocx-wrap">
  <div class="ocx-proof">
    <div>
      {img("/assets/uploads/cau-chuyen/dilvang-doi-che-vang.webp", 1000, "Đồi chè vằng ở Quảng Trị", "ocx-proof-img", ' width="1200" height="900"')}
      <div class="ocx-thumbs">
        {img("/assets/uploads/cau-chuyen/dilvang-la-che-vang.webp", 480, "Lá chè vằng sẻ")}
        {img("/assets/uploads/cau-chuyen/dilvang-tdl-tham-phong-sach.webp", 480, "Đội ngũ Thực Dưỡng Lành thăm phòng sạch nhà máy Gold Herbal")}
        {img("/assets/img/products/tra-dilvang-2.webp", 480, "Hộp Trà hòa tan DILVANG")}
      </div>
    </div>
    <div>
      <div class="ocx-head"><span class="ocx-eye">Giấy tờ bà đọc được</span><h2>Vì sao bà yên tâm</h2></div>
      <dl class="ocx-pl">
        <div><dt>Chỉ dẫn địa lý</dt><dd>Chè vằng Quảng Trị được Nhà nước bảo hộ Chỉ dẫn địa lý, do Sở Khoa học và Công nghệ tỉnh Quảng Trị quản lý.</dd></div>
        <div><dt>Nhà máy GMP</dt><dd>Nhà máy Gold Herbal (Đông Hà, Quảng Trị) được Cục An toàn thực phẩm, Bộ Y tế cấp chứng nhận GMP (Giấy 09/2025/ATTP-CNGMP).</dd></div>
        <div><dt>Kiểm nghiệm</dt><dd>Viện Kiểm nghiệm An toàn vệ sinh thực phẩm Quốc gia (NIFC) xác nhận đúng chè vằng, đinh lăng; không phát hiện Aflatoxin, Salmonella.</dd></div>
        <div><dt>Công nghệ EECV</dt><dd>Chiết xuất và cô đặc trong chân không ở nhiệt độ thấp, giữ màu và mùi gần với lá tươi.</dd></div>
        <div><dt>4 không</dt><dd>Không chất bảo quản, không chất chống đông vón, không hương liệu tổng hợp, không phẩm màu nhân tạo.</dd></div>
        <div><dt>Hồ sơ</dt><dd>Bản tự công bố số 14.1/GOLDHERBAL/2025. <a href="/san-pham/{p["slug"]}/#kiem-nghiem" target="_blank" rel="noopener" data-cta="ocx_proof">Xem ảnh giấy tờ</a></dd></div>
      </dl>
    </div>
  </div>
</div></section>

<section><div class="ocx-wrap">
  <div class="ocx-head"><h2>Pha trong <span class="nw">3 bước,</span> <span class="nw">đúng theo nhãn</span></h2></div>
  <div class="ocx-steps">
    <div class="ocx-card"><b>1</b><h3>Cho 1 gói vào cốc</h3><p>Dùng cốc giữ nhiệt có vạch đi kèm bộ.</p></div>
    <div class="ocx-card"><b>2</b><h3>Thêm nước ấm</h3><p>300–400ml nước ấm 40–50°C. Không cần đun sôi.</p></div>
    <div class="ocx-card"><b>3</b><h3>Khuấy đều và thưởng thức</h3><p>Khuyến nghị 2–3 gói mỗi ngày.</p></div>
  </div>
  <p class="ocx-note">Không cần cắt cao, không cần hãm, không có bã.</p>
</div></section>

<section class="ocx-band" id="nhan"><div class="ocx-wrap">
  <div class="ocx-head"><span class="ocx-eye">Bộ Ở Cữ Thảnh Thơi 21 Ngày</span><h2>Mẹ nhận được gì</h2></div>
  <div class="ocx-tbl"><table>
    <thead><tr><th>Thành phần</th><th>Để làm gì</th><th class="v">Giá trị</th></tr></thead>
    <tbody>{rows}
      <tr class="ocx-tot"><td>Tổng giá trị</td><td></td><td class="v">{vnd(total)}</td></tr>
      <tr class="ocx-pr"><td><b>Giá cả bộ hôm nay</b><small>Rẻ hơn mua lẻ {n} hộp ({vnd(retail)}), kèm toàn bộ quà tặng, miễn phí giao hàng</small></td><td></td><td class="v">{vnd(OCX["price"])}</td></tr>
    </tbody></table></div>
  <div class="ocx-upg"><span><b>Trọn 6 Tuần Ở Cữ:</b> {OCX["up_boxes"]} hộp ({OCX["up_boxes"] * 15} gói), giao làm 2 lần, kèm toàn bộ quà tặng</span><span><s>{vnd(up_retail)}</s> <b>{vnd(OCX["up_price"])}</b></span></div>
  <p class="ocx-note">Giá trị quà tặng là giá tham khảo để mẹ dễ hình dung. {disc}</p>
</div></section>

<section><div class="ocx-wrap">
  <div class="ocx-guar">
    <div class="ocx-seal">Thử 3 gói<br>Hoàn tiền<br>7 ngày</div>
    <div class="ocx-stack"><h2>Bảo đảm: <span class="nw">rủi ro</span> <span class="nw">thuộc về chúng tôi</span></h2>
    <p class="ocx-lead">Uống thử 3 gói đầu. Mẹ hoặc bà không ưng vị, nhắn shop trong 7 ngày: VitaGreen hoàn tiền 2 hộp chưa bóc. Không hỏi lý do.</p></div>
  </div>
</div></section>

<section class="ocx-scar" id="dat"><div class="ocx-wrap">
  <div class="ocx-head"><span class="ocx-eye">Ở cữ chỉ có 21–42 ngày</span><h2>Giữ bộ cho mẹ <span class="nw">trong 1 phút</span></h2>
  <p class="ocx-lead">Mỗi ngày chờ là thêm một ngày bà đứng bếp đun nồi chè. Mẹ để lại số, shop gọi xác nhận và giao ngay: Hà Nội 1–2 ngày, tỉnh khác 2–5 ngày. Chưa phải trả tiền lúc này.</p>{until}</div>
  <div class="ocx-two">
    <div class="ocx-box" id="ocxBox">
      <form id="ocxForm" novalidate>
        <span class="ocx-n">Cách 1 · Để lại số</span>
        <label>Họ và tên *<input name="name" required autocomplete="name" placeholder="Ví dụ: Nguyễn Thị Lan"></label>
        <label>Số điện thoại (Zalo) *<input name="phone" type="tel" required autocomplete="tel" inputmode="tel" placeholder="Ví dụ: 0912 345 678"></label>
        <fieldset class="ocx-packs"><legend>Chọn bộ</legend>
          <label><input type="radio" name="pack" value="{esc(pk1)}" checked><span><b>Bộ 21 Ngày</b> · {n} hộp<em>{vnd(OCX["price"])}</em></span></label>
          <label><input type="radio" name="pack" value="{esc(pk2)}"><span><b>Trọn 6 Tuần</b> · {OCX["up_boxes"]} hộp, giao 2 lần<em>{vnd(OCX["up_price"])}</em></span></label>
        </fieldset>
        <label>Giao tới đâu? <small>(không bắt buộc, ví dụ: nhà ngoại ở Thanh Hóa)</small><input name="where" autocomplete="off" placeholder="Tỉnh/thành, hoặc ghi chú cho shop"></label>
        <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        <button class="ocx-btn" type="submit">Giữ 1 bộ cho mẹ</button>
        <p class="form-msg" role="status"></p>
        <p class="ocx-legal">Khi bấm, mẹ đồng ý để {BRAND} gọi/nhắn Zalo xác nhận đơn và tư vấn, theo <a href="/chinh-sach-bao-mat/" target="_blank">Chính sách bảo mật</a>. Không chia sẻ thông tin cho bên thứ ba.</p>
      </form>
      <div class="ocx-done" hidden>
        <h3>🌿 Shop đã giữ bộ cho mẹ <span data-ocx-name></span></h3>
        <p>Trong giờ làm việc, shop gọi số <b data-ocx-phone></b> trong khoảng 30 phút để xác nhận địa chỉ và giờ giao. Ngoài giờ, shop gọi vào sáng hôm sau.</p>
        <p>Cần gấp? Nhắn Zalo cho shop luôn nhé.</p>
        <a class="ocx-btn zalo" href="{zl}" target="_blank" rel="noopener" data-cta="ocx_done_zalo">💬 Nhắn Zalo {esc(hot)}</a>
      </div>
    </div>
    <div class="ocx-box">
      <span class="ocx-n">Cách 2 · Nhắn tin hoặc gọi</span>
      <p>Nhắn mã dưới đây qua Zalo, shop trả lời ngay:</p>
      <span class="ocx-code">Ở CỮ</span>
      <a class="ocx-btn zalo" href="{zl}" target="_blank" rel="noopener" data-cta="ocx_zalo">💬 Nhắn Zalo “Ở CỮ”</a>
      <a class="ocx-btn ghost" href="tel:{tel(hot)}" data-cta="ocx_call">📞 Gọi {esc(hot)}</a>
      <p class="ocx-note">Giao toàn quốc, nhận hàng rồi mới trả tiền (COD) hoặc chuyển khoản. Giao thẳng tới nhà nội hoặc nhà ngoại nơi mẹ đang ở cữ.</p>
    </div>
  </div>
</div></section>

<section id="hoi-dap"><div class="ocx-wrap ocx-faq">
  <div class="ocx-head"><h2>Câu hỏi thường gặp</h2></div>
  <details><summary>Trà hòa tan DILVANG gồm những gì?</summary><p>Cao khô chè vằng 820mg và cao khô đinh lăng 180mg mỗi gói, phụ liệu maltodextrin. Hộp 15 gói x 5g, hạn dùng 24 tháng. Sản xuất tại Công ty Cổ phần Dược liệu Gold Herbal, Quảng Trị.</p></details>
  <details><summary>Mẹ đang cho con bú có dùng được không?</summary><p>Sản phẩm là thực phẩm, không phải thuốc. Mỗi người có thể trạng khác nhau, mẹ nên hỏi ý kiến bác sĩ đang theo dõi mình nếu có băn khoăn. Chuyên viên VitaGreen trên Zalo sẽ gửi mẹ đầy đủ thành phần và hồ sơ sản phẩm.</p></details>
  <details><summary>Pha thế nào cho đúng?</summary><p>1 gói với 300–400ml nước ấm 40–50°C, khuấy đều. Khuyến nghị 2–3 gói mỗi ngày.</p></details>
  <details><summary>Một bộ dùng được bao lâu?</summary><p>Bộ 21 Ngày có {n * 15} gói. Uống 2 gói mỗi ngày thì đủ khoảng 3 tuần, 3 gói mỗi ngày thì khoảng 2 tuần. Ở cữ 6 tuần thì gói Trọn 6 Tuần tiện hơn: shop giao 2 lần để trà luôn mới.</p></details>
  <details><summary>Giao hàng và thanh toán thế nào?</summary><p>Shop gọi xác nhận trước khi giao, có thể giao thẳng tới nhà nội hoặc nhà ngoại nơi mẹ đang ở cữ. Miễn phí giao hàng, mẹ nhận hàng rồi trả tiền hoặc chuyển khoản.</p></details>
  <details><summary>Chỉ muốn mua lẻ 1 hộp?</summary><p>Mẹ xem và đặt ở <a href="/san-pham/{p["slug"]}/" data-cta="ocx_single">trang Trà DILVANG</a>. Mua lẻ không kèm quà tặng của bộ.</p></details>
  <p class="ocx-disc">{disc}</p>
</div></section>
</div>
<div class="ocx-bar"><span><b>{vnd(OCX["price"])}</b> cả bộ · miễn phí giao</span><a class="ocx-btn" href="#dat" data-cta="ocx_bar">Giữ 1 bộ</a></div>'''
    return layout(OCX_PATH, "Bộ Ở Cữ Thảnh Thơi 21 Ngày – Trà DILVANG chè vằng Quảng Trị",
                  "Dành cho mẹ ở cữ cùng bà: cốc chè vằng ấm sau 10 giây, kể cả lúc 2 giờ sáng. Chè vằng Quảng Trị có chỉ dẫn địa lý, nhà máy GMP. Bộ 3 hộp kèm quà, miễn phí giao.",
                  body, og=img_url("/assets/img/products/tra-dilvang-5.webp", 1000), body_class="page-ocx", noindex=True)


def page_quiz_group():
    """Màn hình lớn chơi nhóm (trà đàm, hội thảo, sự kiện): người dẫn chiếu lên TV/máy chiếu, bấm → / Space / bút trình chiếu để sang câu.
    Cuối buổi hiện mã QR: nhận quà cẩm nang, chơi lại trên điện thoại (thử thách 7 ngày), vào nhóm Zalo; link gắn utm_campaign = tên buổi để CRM đếm khách từ sự kiện.
    JS riêng assets/js/quiz-nhom.js (+ qrcode.js), không tải main.js / đo lường. noindex."""
    qs = [q for q in QUIZ.get("questions") or [] if q.get("q")]
    data = {"questions": qs, "results": sorted(QUIZ.get("results") or [], key=lambda r: -int(r.get("min") or 0)), "title": QUIZ.get("title") or "Bạn còn mấy ngón tay?",
            "gift": {"url": CN_PATH, "title": CN.get("title", "")} if CN_PATH else None, "zalo": "/nhom-zalo/" if SITE.get("zalo_group") else "", "quiz": QUIZ_PATH, "domain": DOMAIN}
    data_js = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    return f'''<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Chơi nhóm – {esc(data["title"])} | {BRAND}</title>
<link rel="icon" href="/favicon.ico">
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700&family=Playfair+Display:wght@600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/style.css?v={VERSION}">
</head><body class="gm-body">
<main class="gm" id="gm">
  <header class="gm-top"><img src="/assets/img/brand/logo.webp" alt="{BRAND}" height="56"><span class="gm-step" data-gm-step></span>
    <span class="gm-tools"><button type="button" data-gm-fs title="Toàn màn hình (phím F)">⛶</button></span></header>
  <section class="gm-stage" data-gm-stage></section>
  <footer class="gm-nav"><button type="button" class="gm-btn gm-prev" data-gm-prev>◀ Quay lại</button><span class="gm-hint">Phím → hoặc Space để sang tiếp · F: toàn màn hình</span><button type="button" class="gm-btn gm-next" data-gm-next>Tiếp ▶</button></footer>
</main>
<script type="application/json" id="gm-data">{data_js}</script>
<script src="/assets/js/qrcode.js?v={VERSION}" defer></script>
<script src="/assets/js/quiz-nhom.js?v={VERSION}" defer></script>
</body></html>'''


def post_card(p):
    cat = PCATS.get(p["category"], {}).get("name", "")
    d = datetime.date.fromisoformat(p["date"]).strftime("%d/%m/%Y")
    return f'''<article class="post-card"><a class="post-media" href="/goc-song-lanh/{p["slug"]}/"><img src="{img_url(p["image"], 800)}" alt="{esc(p["title"])}" loading="lazy" width="600" height="600"></a>
<div class="post-body"><div class="post-meta"><span>{esc(cat)}</span> · <time datetime="{p["date"]}">{d}</time></div><h3><a href="/goc-song-lanh/{p["slug"]}/">{esc(p["title"])}</a></h3><p>{esc(p["excerpt"])}</p><a class="more" href="/goc-song-lanh/{p["slug"]}/">{t("Đọc tiếp")} {I["right"]}</a></div></article>'''


def needs_html(active="", compact=False):
    """Khối "Chọn theo nhu cầu": trang chủ (thẻ lớn) và trang danh sách sản phẩm (gọn)."""
    if not NEEDS:
        return ""
    cards = "".join(f'''<a class="nd-card{" active" if n["url"] == active else ""}" href="{n["url"]}" data-cta="need_{n["slug"]}"><span class="nd-ic" aria-hidden="true">{esc(n.get("icon") or "🌿")}</span><span class="nd-tx"><b>{esc(n["name"])}</b>{"" if compact else f'<small>{esc(n.get("desc") or "")}</small>'}</span></a>''' for n in NEEDS)
    if compact:
        return f'<div class="nd-row" aria-label="{t("Chọn theo nhu cầu")}"><span class="nd-lbl">{t("Theo nhu cầu:")}</span>{cards}</div>'
    return f'''<section class="section section-tight nd-sec"><div class="container">
  <h2 class="sec-title">{t("Chọn theo nhu cầu")}</h2>
  <div class="nd-grid">{cards}</div>
</div></section>'''


def page_listing(path, title, products, intro="", crumbs=None, about=""):
    bc, bld = breadcrumb(crumbs or [(title, None)])
    chips = '<a href="/san-pham/" class="chip{}">{}</a>'.format(" active" if path == "/san-pham/" else "", t("Tất cả"))
    for c in CATS:
        href = f"/danh-muc/{c['slug']}/"
        chips += f'<a href="{href}" class="chip{" active" if path == href else ""}">{esc(c["name"])}</a>'
    if HAS_SALE:
        chips += f'<a href="/khuyen-mai/" class="chip{" active" if path == "/khuyen-mai/" else ""}">{t("Khuyến Mãi")}</a>'
    body = f'''<section class="section pt-2"><div class="container">
  <div class="shop-banner">{benefits_banner()}</div>
  {bc}
  <div class="shop-head"><h1 class="shop-title">{esc(title)}</h1>
    <div class="shop-tools"><span class="muted">{tf("{n} sản phẩm", n=len(products))}</span>
    <label class="sort">{t("Sắp xếp")} <select data-sort><option value="default">{t("Mặc định")}</option><option value="price-asc">{t("Giá tăng dần")}</option><option value="price-desc">{t("Giá giảm dần")}</option><option value="name">{t("Tên A–Z")}</option></select></label></div></div>
  {f'<p class="shop-intro">{esc(intro)}</p>' if intro else ''}
  <div class="chips">{chips}</div>
  {needs_html(path, compact=True)}
  {grid(products, "p-grid shop-grid")}
  {f'<div class="cat-about prose">{md(about)}</div>' if about else ""}
</div></section>'''
    desc = intro or tf("{title} chính hãng tại {brand}. Nguồn gốc rõ ràng, giao hàng toàn quốc.", title=title, brand=BRAND)
    return layout(path, title, desc, body, jsonld=[bld])


def section_html(i, s, anchor=None):
    style = s.get("style") or "box"
    if style == "list":
        inner = "<ul>" + "".join(f"<li>{md_inline(x)}</li>" for x in (s.get("items") or []) if x) + "</ul>"
    elif style == "table":
        inner = '<table class="nutri">' + "".join(f"<tr><th>{esc(r.get('label'))}</th><td>{esc(r.get('value'))}</td></tr>" for r in (s.get("rows") or [])) + "</table>"
    else:
        inner = md(s.get("text"))
    anchor = ' id="kiem-nghiem"' if (anchor if anchor is not None else TEST_RE.search(s.get("title") or "")) else ""
    return f'<div class="d-sec d-type-{style}"{anchor}><h3>{i}. {esc(s.get("title"))}</h3><div class="d-box">{inner}</div></div>'


def gift_text():
    w = WEB_OFFER
    if not (w.get("gift_enabled") and w.get("gift_title")):
        return ""
    return f'Tặng <b>{esc(w["gift_title"])}</b>' + (f' (trị giá {esc(w["gift_value"])})' if w.get("gift_value") else "") + (f' {esc(w["gift_how"])}' if w.get("gift_how") else "")


def offer_box(p=None):
    """Khung "Ưu đãi chỉ có khi đặt tại website": trang sản phẩm (p) và trang thanh toán (p=None, gọn)."""
    w, items, compact = WEB_OFFER, [], p is None
    if w.get("headline"):
        items.append(f'<li>{ic("check","wo-ic")}<span><b>{esc(w["headline"])}</b></span></li>')
    if p is not None and p.get("web_off_max"):
        vs = {v["web_off"] for v in p["variants"]} or {p["web_off"]}
        txt = f'<b>{p["web_off_max"]}%</b>' if len(vs) == 1 else tf('đến <b>{pct}%</b>', pct=p["web_off_max"])
        items.append(f'<li>{ic("check","wo-ic")}<span>{tf("Giảm {txt} cho sản phẩm này – đã trừ trực tiếp vào giá", txt=txt)}</span></li>')
    elif p is None and WEB_OFF_MAX and not w.get("headline"):
        items.append(f'<li>{ic("check","wo-ic")}<span>{tf("Giá trên web đã giảm <b>{pct}</b> – trừ trực tiếp vào giá", pct=upto(WEB_OFF_MAX))}</span></li>')
    if gift_text():
        join = f' <a href="{ZALO_GATE}?tu=uu_dai_sp" data-cta="zalo_group_offer">Tham gia nhóm →</a>' if SITE.get("zalo_group") and not compact else ""
        items.append(f'<li>{ic("check","wo-ic")}<span>{gift_text()}{join}</span></li>')
    if not items:
        return ""
    return f'<div class="wo-box{" wo-compact" if compact else ""}"><b class="wo-head">🎁 {esc(w.get("label") or t("Ưu đãi chỉ có khi đặt tại website"))}</b><ul>{"".join(items)}</ul></div>'


def combo_parts_html(p):
    """Trang gói: danh sách sản phẩm trong gói + tiết kiệm + miễn phí ship."""
    rows = "".join(f'<li><a href="/san-pham/{x["p"]["slug"]}/"><img src="{pimg(x["p"]["images"][0], True)}" alt="" width="56" height="56" loading="lazy"><span><b>{x["qty"]} × {esc(x["p"]["name"])}</b><small>{esc(x["unit"])}</small></span></a><s>{money(x["base"])}</s></li>' for x in p["parts"])
    save = []  # chỉ 1 mức "tiết kiệm" (so với giá gốc, khớp nhãn Tiết kiệm / -X%); giá mua lẻ trên web chỉ nêu để so sánh
    if p.get("price") and p["parts_base"] > p["price"]:
        save.append(tf('Mua lẻ {a} → <b>Gói chỉ {b}, tiết kiệm {c}</b>', a=money(p["parts_base"]), b=money(p["price"]), c=money(p["parts_base"] - p["price"])))
        if p["parts_web"] > p["price"] and p["parts_web"] != p["parts_base"]:
            save.append(tf('Rẻ hơn cả khi mua lẻ trên web ({a})', a=money(p["parts_web"])))
    ship = f'<span class="cb-ship">🚚 {t("Miễn phí vận chuyển")}</span>' if p.get("free_ship") else ""
    days = f'<span class="cb-ship">📅 {tf("Dùng trong {n} ngày", n=num(p.get("days")))}</span>' if num(p.get("days")) else ""
    return f'''<div class="cb-box"><b class="cb-head">{tf("Gói gồm {n} sản phẩm", n=len(p["parts"]))}</b><ul class="cb-parts">{rows}</ul>
{f'<p class="cb-save">💰 {". ".join(save)}.</p>' if save else ""}<div class="cb-tags">{ship}{days}</div></div>'''


def in_combos_html(p):
    """Trang sản phẩm lẻ: gợi ý các gói có chứa sản phẩm này."""
    cs = [c for c in PRODUCTS if c.get("combo") and c.get("price") and any(x["p"]["slug"] == p["slug"] for x in c.get("parts", []))]  # PRODUCTS = gói đã có bản dịch
    if not cs:
        return ""
    li = "".join(f'<a class="ic-item" href="/san-pham/{c["slug"]}/"><img src="{pimg(c["images"][0], True)}" alt="" width="52" height="52" loading="lazy"><span><b>{esc(c["name"])}</b><small>{tf("{n} sản phẩm · chỉ {price}", n=len(c["parts"]), price=money(c["price"]))}{t(" · miễn phí ship") if c.get("free_ship") else ""}</small></span><i>{t("Xem gói →")}</i></a>' for c in cs)
    return f'<div class="ic-box"><b class="ic-head">💡 {t("Tiết kiệm hơn khi mua theo gói")}</b>{li}</div>'


def nl(t):
    """Chữ nhiều dòng từ /admin → xuống dòng bằng <br>."""
    return "<br>".join(esc(x.strip()) for x in str(t or "").split("\n") if x.strip())


def combo_save_tags(c, cls=""):
    """Nhãn Tiết kiệm / Miễn phí ship / Lộ trình – chỉ hiện quyền lợi khách thật sự nhận được."""
    tags = []
    if c.get("price") and c["parts_base"] > c["price"]:
        tags.append(f'<span class="{cls}save">{tf("Tiết kiệm {amount}", amount=money(c["parts_base"] - c["price"]))}</span>')
    if c.get("free_ship"):
        tags.append(f"<span>🚚 {t('Miễn phí vận chuyển')}</span>")
    if c.get("roadmap_link"):
        tags.append(f'<span>🎁 {tf("Lộ trình đồng hành {n} ngày", n=num(c.get("days")) or "")}</span>')
    return "".join(tags)


def combo_bens(c):
    """Lợi ích của gói (Ăn lành hơn – Bữa phụ tốt hơn – Uống lành hơn), lấy từ ô Lợi ích của từng sản phẩm trong gói."""
    return [x for x in c.get("parts", []) if x["it"].get("benefit")]


def combo_card_v2(c):
    """Thẻ gói "khởi động" ở trang chủ: tên gói → thông điệp → ảnh → lợi ích → giá → nút (thứ tự trên điện thoại)."""
    url = f'/san-pham/{c["slug"]}/'
    bens = ""
    for x in combo_bens(c):
        it = x["it"]
        note = f'<p>{esc(it["note"])}</p>' if it.get("note") else ""
        bens += f'<li><span class="cbh-ic" aria-hidden="true">{esc(it.get("icon") or "✓")}</span><div><b>{esc(it["benefit"])}</b><small>{esc(it.get("title") or x["p"]["name"])}</small>{note}</div></li>'
    eye = f'<span class="cbh-eye">{esc(c["eyebrow"])}</span>' if c.get("eyebrow") else ""
    tagline = f'<p class="cbh-tagline">{esc(c["tagline"])}</p>' if c.get("tagline") else ""
    sub = f'<p class="cbh-sub">{esc(c["subline"])}</p>' if c.get("subline") else ""
    if c.get("journey"):
        more = f'<a class="btn btn-lg btn-ghost" href="{url}#cach-trai-nghiem" data-cta="combo_how_home">{t("Xem cách trải nghiệm")}</a>'
    else:
        more = f'<a class="btn btn-lg btn-ghost" href="{url}">{t("Xem chi tiết")}</a>'
    return f'''<article class="cbh-card cbh-v2">
<div class="cbh-head">{eye}<h3><a href="{url}">{esc(c["headline"])}</a></h3>{tagline}{sub}</div>
<a class="cbh-media" href="{url}"><img src="{pimg(c["images"][0])}" alt="{esc(c["name"])}" width="1000" height="1000" loading="lazy"></a>
<div class="cbh-body">{f'<ul class="cbh-bens">{bens}</ul>' if bens else ""}
<div class="cbh-buy">{price_html(c, "price big")}<div class="cbh-tags">{combo_save_tags(c, "cbh-")}</div></div>
<div class="cbh-btns"><button class="btn btn-lg btn-buy cbh-cta" data-buy-now="{c["slug"]}" data-cta="combo_start_home">{esc(c.get("cta") or t("Mua ngay"))}</button>{more}</div></div></article>'''


def combos_home():
    cs = [c for c in PRODUCTS if c.get("combo") and c.get("price")]
    if not cs:
        return ""
    cards = ""
    for c in cs:
        if c.get("headline"):
            cards += combo_card_v2(c)
            continue
        save = f'<span class="cbh-save">{tf("Tiết kiệm {amount}", amount=money(c["parts_base"] - c["price"]))}</span>' if c["parts_base"] > c["price"] else ""
        parts = "".join(f"<li>{esc(x['label'])}</li>" for x in c["parts"])
        fs_tag = f'<span>🚚 {t("Miễn phí ship")}</span>'
        cards += f'''<article class="cbh-card"><a class="cbh-media" href="/san-pham/{c["slug"]}/"><img src="{pimg(c["images"][0])}" alt="{esc(c["name"])}" width="1000" height="1000" loading="lazy"></a>
<div class="cbh-body"><h3><a href="/san-pham/{c["slug"]}/">{esc(c["name"])}</a></h3><ul class="cbh-parts">{parts}</ul>
{price_html(c)}<div class="cbh-tags">{save}{fs_tag if c.get("free_ship") else ""}</div>
<div class="cbh-btns"><button class="btn" data-buy-now="{c["slug"]}">{ic("bolt")} {t("Mua ngay")}</button><a class="btn btn-outline" href="/san-pham/{c["slug"]}/">{t("Xem chi tiết")}</a></div></div></article>'''
    return f'''<section class="section pt-0"><div class="container">
  <h2 class="sec-title">{t("Gói Giải Pháp Sống Lành")}</h2>
  <div class="cbh-grid">{cards}</div>
</div></section>'''


def combo_cta(p, where):
    return f'<button class="btn btn-lg btn-buy cbl-cta" data-buy-now="{p["slug"]}" data-cta="combo_start_{where}">{esc(p.get("cta") or t("Mua ngay"))}</button>'


def combo_hero_head(p):
    """Trang gói: eyebrow + tiêu đề + câu dẫn (trên điện thoại đứng trước ảnh)."""
    h = p["hero"]
    eye = f'<span class="cbl-eye">{esc(h["eyebrow"])}</span>' if h.get("eyebrow") else ""
    sub = f'<p class="cbl-sub">{nl(h["sub"])}</p>' if h.get("sub") else ""
    return f'<div class="cbl-head">{eye}<h1 class="p-title cbl-title">{nl(h.get("title") or p["name"])}</h1>{sub}</div>'


def combo_hero_info(p):
    """Trang gói: mô tả → 3 lợi ích → giá → nút chính → câu nhỏ dưới nút."""
    h = p["hero"]
    desc = f'<p class="cbl-desc">{nl(h["desc"])}</p>' if h.get("desc") else ""
    bens = "".join(f'<li><span aria-hidden="true">{esc(x["it"].get("icon") or "✓")}</span>{esc(x["it"]["benefit"])}</li>' for x in combo_bens(p))
    note = f'<p class="cbl-micro">{esc(p["cta_note"])}</p>' if p.get("cta_note") else ""
    return f'''{desc}{f'<ul class="cbl-bens">{bens}</ul>' if bens else ""}
<div class="cbl-price" id="pPrice">{price_html(p, "price big")}<div class="cbh-tags">{combo_save_tags(p, "cbh-")}</div></div>
<div class="cbl-main">{combo_cta(p, "hero")}{note}</div>'''


def combo_landing(p):
    """Trang gói: các phần dưới hero – vấn đề → giải pháp → 10 ngày → nhận được gì → giá & nút cuối trang."""
    out = []
    pa = p.get("pains") or {}
    if [x for x in pa.get("items") or [] if x]:
        li = "".join(f"<li>{ic('check', 'cbl-ck')}<span>{esc(x)}</span></li>" for x in pa["items"] if x)
        callout = f'<p class="cbl-callout">{nl(pa["callout"])}</p>' if pa.get("callout") else ""
        out.append(f'<section class="cbl-sec cbl-pains"><h2 class="cbl-h2">{nl(pa.get("title"))}</h2><ul class="cbl-checks">{li}</ul>{callout}</section>')
    so, bens = p.get("solution") or {}, combo_bens(p)
    if bens:
        cards = ""
        for i, x in enumerate(bens, 1):
            it, q = x["it"], x["p"]
            quote = f'<blockquote>“{esc(it["quote"])}”</blockquote>' if it.get("quote") else ""
            cards += f'''<article class="cbl-card"><a class="cbl-card-img" href="/san-pham/{q["slug"]}/"><img src="{pimg(q["images"][0], True)}" alt="{esc(q["name"])}" width="480" height="480" loading="lazy"><span class="cbl-no">{i:02d}</span></a>
<b class="cbl-ben">{esc(it.get("icon") or "")} {esc(it["benefit"])}</b><h3><a href="/san-pham/{q["slug"]}/">{esc(it.get("title") or q["name"])}</a></h3>
<p>{esc(it.get("detail") or it.get("note") or "")}</p>{quote}</article>'''
        intro = f'<p class="cbl-lead">{nl(so["intro"])}</p>' if so.get("intro") else ""
        out.append(f'<section class="cbl-sec"><h2 class="cbl-h2 center">{nl(so.get("title") or t("3 thay đổi nhỏ"))}</h2>{intro}<div class="cbl-cards">{cards}</div></section>')
    jo = p.get("journey") or {}
    steps = [x for x in jo.get("steps") or [] if x.get("text")]
    if steps:
        st = "".join(f'<li><b>{esc(x.get("label"))}</b><span>{esc(x["text"])}</span></li>' for x in steps)
        sub = f'<p class="cbl-lead center"><b>{nl(jo["sub"])}</b></p>' if jo.get("sub") else ""
        quote = f'<blockquote class="cbl-quote">“{nl(jo["quote"])}”</blockquote>' if jo.get("quote") else ""
        road = f'<p class="center"><a class="btn btn-lg btn-outline" href="{esc(p["roadmap_link"])}" target="_blank" rel="noopener" data-cta="combo_roadmap">{tf("Xem lộ trình {n} ngày", n=num(p.get("days")) or "")}</a></p>' if p.get("roadmap_link") else ""
        out.append(f'<section class="cbl-sec cbl-journey" id="cach-trai-nghiem"><h2 class="cbl-h2 center">{nl(jo.get("title"))}</h2>{sub}<ol class="cbl-steps">{st}</ol>{quote}{road}</section>')
    rc = p.get("receive") or {}
    if rc.get("title"):
        li = [f'{x["qty"]:02d} {x["it"].get("title") or x["p"]["name"]}' + (f' · {x["unit"]}' if x["unit"] else "") for x in p["parts"]]
        li += [t("Miễn phí vận chuyển")] if p.get("free_ship") else []
        li += [tf('Lộ trình trải nghiệm Sống Lành {n} ngày', n=num(p.get("days")) or "")] if p.get("roadmap_link") else []
        li += [x for x in rc.get("extras") or [] if x]
        rows = "".join(f"<li>{ic('check', 'cbl-ck')}<span>{esc(x)}</span></li>" for x in li)
        out.append(f'<section class="cbl-sec cbl-receive"><h2 class="cbl-h2">{nl(rc["title"])}</h2><ul class="cbl-checks">{rows}</ul></section>')
    fi = p.get("final") or {}
    if fi.get("title"):
        sub = f'<p class="cbl-final-sub">{nl(fi["sub"])}</p>' if fi.get("sub") else ""
        note = f'<p class="cbl-micro">{esc(fi["note"])}</p>' if fi.get("note") else ""
        out.append(f'<section class="cbl-final"><h2>{nl(fi["title"])}</h2>{sub}{price_html(p, "price big")}<div class="cbh-tags">{combo_save_tags(p, "cbh-")}</div>{combo_cta(p, "final")}{note}</section>')
    return f'<div class="cbl" data-product="{p["slug"]}">{"".join(out)}</div>' if out else ""


def page_product(p):
    path = f"/san-pham/{p['slug']}/"
    cat = CAT_BY.get(p["category"])
    bc, bld = breadcrumb([(t("Sản phẩm"), "/san-pham/"), (cat["name"], f"/danh-muc/{cat['slug']}/"), (p["name"], None)])
    d = discount(p)
    main_imgs = "".join(f'<a class="g-slide{" is-active" if i == 0 else ""}" href="{pimg(im)}" data-lightbox="product" data-index="{i}"><img src="{pimg(im)}" alt="{esc(p["name"])} – {t("ảnh")} {i+1}" width="1000" height="1000"{" fetchpriority=high" if i == 0 else " loading=lazy"}></a>' for i, im in enumerate(p["images"]))
    thumbs = "".join(f'<button class="g-thumb{" is-active" if i == 0 else ""}" data-thumb="{i}" aria-label="{t("Ảnh")} {i+1}"><img src="{pimg(im, True)}" alt="" width="120" height="120" loading="lazy"></button>' for i, im in enumerate(p["images"]))
    badge = f'<span class="badge-sale">-{d}%</span>' if d else ""
    variants = ""
    if p.get("variants"):
        best = max(((discount(v), i) for i, v in enumerate(p["variants"]) if (v.get("units") or 0) >= 2 and v.get("price")), default=(0, -1))
        opts = "".join(v_opt(i, v, p, i == best[1] and best[0] > 0) for i, v in enumerate(p["variants"]))
        variants = f'<div class="variants"><span class="lbl">{t("Chọn quy cách:")}</span><div class="v-opts">{opts}</div></div>'
    unit = f'<p class="unit"><span class="lbl">{t("Quy cách:")}</span> {esc(p["unit"])}</p>' if p.get("unit") else ""
    _bset = {(b or "").strip().lower() for b in (p.get("badges") or [])}  # ý đã có trong khung "Vì sao nên chọn" thì không lặp lại
    highlights = "".join(f"<li>{ic('check','hl-ic')}{esc(h)}</li>" for h in p.get("highlights", []) if h and h.strip().lower() not in _bset)
    purchasable = p.get("price") is not None or any(v.get("price") is not None for v in p.get("variants", []))
    if purchasable:
        buy = f'''<div class="buy-box">
  <div class="qty-line"><span class="lbl" id="qtyLbl">{t("Số lượng")}</span><div class="qty" data-qty role="group" aria-labelledby="qtyLbl"><button type="button" data-qminus aria-label="{t("Giảm số lượng")}">−</button><input type="number" inputmode="numeric" min="1" max="99" value="1" aria-label="{t("Số lượng")}" id="qtyInput"><button type="button" data-qplus aria-label="{t("Tăng số lượng")}">+</button></div></div>
  <div class="buy-btns"><button class="btn btn-lg btn-buy" data-buy-now="{p["slug"]}">{ic("bolt")} {t("Mua ngay")}</button>
  <button class="btn btn-outline btn-lg" data-add-detail="{p["slug"]}">{ic("cart")} {t("Thêm vào giỏ hàng")}</button></div>
  <a class="btn btn-lg btn-zalo buy-zalo" href="{zalo_link()}" target="_blank" rel="noopener">{ic("zalo")} {t("Hỏi tư vấn qua Zalo")}</a>
</div>'''
    else:
        buy = f'''<div class="contact-price"><p>{t("Sản phẩm đang cập nhật giá trên website. Anh/chị vui lòng liên hệ để được báo giá và ưu đãi tốt nhất.")}</p></div>
  <div class="buy-row"><a class="btn btn-lg btn-buy" href="tel:{tel(SITE["hotline"])}">{ic("phone")} {t("Gọi")} {esc(SITE["hotline"])}</a>
  <a class="btn btn-lg btn-zalo" href="{zalo_link()}" target="_blank" rel="noopener">{ic("zalo")} {t("Tư vấn qua Zalo")}</a></div>'''
    landing = bool(p.get("combo") and p.get("hero"))  # gói "khởi động": hero + các phần thuyết phục, nút chính là lời mời bắt đầu
    if landing and purchasable:
        buy = f'''<div class="qty-row"><div class="qty" data-qty><button type="button" data-qminus aria-label="{t("Giảm số lượng")}">−</button><input type="number" inputmode="numeric" min="1" max="99" value="1" aria-label="{t("Số lượng")}" id="qtyInput"><button type="button" data-qplus aria-label="{t("Tăng số lượng")}">+</button></div>
  <button class="btn btn-outline" data-add-detail="{p["slug"]}">{t("Thêm vào giỏ hàng")}</button></div>
  <div class="buy-row"><a class="btn btn-zalo" href="{zalo_link()}" target="_blank" rel="noopener">{ic("zalo")} {t("Tư vấn qua Zalo")}</a></div>'''
    has_cert = any(TEST_RE.search(s.get("title") or "") for s in p.get("sections", []))
    cert_img = f' data-cert-img="{esc(pimg(p["test_cert_img"]))}"' if p.get("test_cert_img") else ""
    badges = "".join((f'<a class="p-badge" href="#kiem-nghiem" data-cert{cert_img}>✓ {esc(b)}</a>' if has_cert and (TEST_RE.search(b) or "nifc" in b.lower()) else f'<span class="p-badge">✓ {esc(b)}</span>')
                     for b in (p.get("badges") or []) if b)
    v0 = p["variants"][0] if p.get("variants") else p
    proof_cta, proof_box = proof_drawer(p)
    unit_line = f'<p class="p-unit">{t("Quy cách:")} <b>{esc(p["unit"])}</b></p>' if p.get("unit") and not p.get("variants") and not p.get("combo") else ""
    why = "".join(f"<li>{ic('check', 'ic why-ic')}<span>{esc(b)}</span></li>" for b in (p.get("badges") or []) if b)
    why_box = f'<div class="p-why"><b class="p-why-h">{tf("Vì sao nên chọn {name}?", name=esc(p.get("short_name") or p["name"]))}</b><ul>{why}</ul>{proof_cta}</div>' if (why or proof_cta) and not landing else ""
    if landing:
        info_top = combo_hero_info(p)
    else:
        info_top = f'''<h1 class="p-title">{esc(p["name"])}</h1>{f'<a class="p-rating" href="#danh-gia">{stars_html(p)}</a>' if rating_of(p) else ""}
      <div class="p-summary">{p["summary"]}</div>
      <div class="p-price" id="pPrice">{price_html(p, "price big", off=True)}<div class="p-save" id="pSave">{save_text(v0)}</div><div class="p-per" id="pPer">{per_serving(v0, p)}</div>{unit_line}{f'<p class="p-ship" id="pShip">{ship_hint(p, v0)}</p>' if purchasable else ""}</div>'''
    share_url = DOMAIN + path
    proof_i = next((i for i, s in enumerate(p.get("sections", []), 1) if PROOF_ANCHOR_RE.search(s.get("title") or "")), 0)
    sections = "".join(section_html(i, s, i == proof_i) for i, s in enumerate(p.get("sections", []), 1))
    disc = f'<p class="disclaimer">{esc(p["disclaimer"])}</p>' if p.get("disclaimer") else ""
    related = [x for x in PRODUCTS if x["slug"] != p["slug"] and x["category"] == p["category"]]
    related += [x for x in PRODUCTS if x["slug"] != p["slug"] and x not in related]
    faqs = product_faqs(p, purchasable)
    faq_box = f'<section class="pfaq-wrap" id="hoi-dap"><h2 class="sec-title left">{t("Câu hỏi thường gặp")}</h2>' + "".join(
        f'<details class="pfaq-q"><summary>{esc(q)}</summary><div class="pfaq-a">{md(a)}</div></details>' for q, a in faqs) + "</section>" if faqs else ""
    body = f'''<section class="section pt-2"><div class="container">
  {bc}
  <div class="product{" product-cbl" if landing else ""}" data-product="{p["slug"]}">
    {combo_hero_head(p) if landing else ""}<div class="gallery" id="gallery">
      <div class="g-main">{badge}{main_imgs}<span class="g-zoom">{I["zoom"]}</span>
      <button class="g-nav prev" data-gprev aria-label="Ảnh trước">{I["left"]}</button><button class="g-nav next" data-gnext aria-label="Ảnh sau">{I["right"]}</button></div>
      <div class="g-thumbs">{thumbs}</div>
    </div>
    <div class="p-info">
      {info_top}
      {"" if landing else (combo_parts_html(p) if p.get("combo") else "")}{variants}
      {buy}
      {trust_line(p) if purchasable else ""}
      {why_box}
      {combo_parts_html(p) if landing else ""}
      {offer_box(p) if purchasable else ""}
      {"" if p.get("combo") else in_combos_html(p)}
      {f'<ul class="p-highlights">{highlights}</ul>' if highlights else ""}
      <div class="p-meta"><p><b>SKU:</b> {esc(p["sku"])}</p><p><b>{t("Danh mục:")}</b> <a href="/danh-muc/{cat["slug"]}/">{esc(cat["name"])}</a>, <a href="/san-pham/">{t("Toàn bộ sản phẩm")}</a></p></div>
      <div class="share"><b>{t("Chia sẻ")}</b>
        <a href="https://www.facebook.com/sharer/sharer.php?u={share_url}" target="_blank" rel="noopener" aria-label="{t("Chia sẻ Facebook")}">{I["facebook"]}</a>
        <a href="https://zalo.me/share?url={share_url}" target="_blank" rel="noopener" aria-label="{t("Chia sẻ Zalo")}" class="z">Z</a>
        <button data-copy="{share_url}" aria-label="{t("Sao chép liên kết")}">🔗</button>
        <button class="wish-lg" data-wish="{p["slug"]}" aria-label="{t("Yêu thích")}">{I["heart"]}<span>{t("Yêu thích")}</span></button>
      </div>
    </div>
  </div>
  {origin_story(p)}
  {reviews_html(p)}
  {combo_landing(p) if landing else ""}

  <div class="tabs" data-tabs>
    <div class="tab-nav" role="tablist"><button role="tab" class="is-active" data-tab="desc">{t("Mô tả")}</button><button role="tab" data-tab="ship">{t("Giao hàng & đổi trả")}</button></div>
    <div class="tab-panel is-active" data-panel="desc">
      <div class="desc-intro">{p["summary"]}</div>
      {sections}
      {disc}
    </div>
    <div class="tab-panel" data-panel="ship">
      <div class="d-sec"><div class="d-box"><ul>
        <li>{t("Giao hàng toàn quốc; nội thành Hà Nội 1–2 ngày, tỉnh thành khác 2–5 ngày làm việc.")}</li>
        <li>{t("Được kiểm tra hàng trước khi thanh toán.")}</li>
        <li>{t("Đổi trả trong 7 ngày nếu sản phẩm lỗi do nhà sản xuất hoặc hư hỏng khi vận chuyển.")}</li>
        <li>{t('Chi tiết: <a href="/chinh-sach-giao-hang/">Chính sách giao hàng</a> · <a href="/chinh-sach-doi-tra/">Chính sách đổi trả</a>')}</li>
      </ul></div></div>
    </div>
  </div>

  {faq_box}
  <h2 class="sec-title left">{t("Sản phẩm tương tự")}</h2>
  {grid(related[:4], "p-grid related-grid")}
</div></section>
{satc_html(p) if purchasable else ""}{proof_box}'''
    ld = {"@context": "https://schema.org", "@type": "Product", "name": p["name"], "sku": p["sku"], "url": DOMAIN + path,
          "image": [DOMAIN + pimg(i) for i in p["images"]], "description": strip_tags(md_inline(p["summary"])),
          "brand": {"@type": "Brand", "name": BRAND}, "category": cat["name"]}
    if p.get("manufacturer"):
        ld["manufacturer"] = {"@type": "Organization", "name": p["manufacturer"]}
    prices = [v["price"] for v in p.get("variants", []) if v.get("price") is not None] or ([p["price"]] if p.get("price") is not None else [])
    if prices:
        ld["offers"] = [offer_ld(p, v.get("price"), DOMAIN + path, v.get("name")) for v in p["variants"] if v.get("price") is not None] \
            if len(prices) > 1 else offer_ld(p, prices[0], DOMAIN + path)
    if rating_of(p):  # chỉ khi có ≥ 3 đánh giá thật
        ld["aggregateRating"] = {"@type": "AggregateRating", "ratingValue": rating_of(p)[0], "reviewCount": rating_of(p)[1], "bestRating": 5, "worstRating": 1}
    desc = strip_tags(p["summary"])[:158]
    lds = [ld, bld]
    if faqs:  # Google ít khi hiện khung hỏi đáp cho web bán hàng, nhưng ChatGPT / Gemini / Perplexity đọc dạng này rất tốt
        lds.append({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": strip_tags(md(a)).strip()}} for q, a in faqs]})
    sv = (p.get("story") or {}).get("video") or {}
    if yt_id(sv.get("youtube")):  # video câu chuyện → VideoObject cho Google
        vid = yt_id(sv["youtube"])
        thumb = (DOMAIN + img_url(sv["image"], 1200)) if sv.get("image") else f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
        lds.append({"@context": "https://schema.org", "@type": "VideoObject", "name": sv.get("title") or p["name"],
                    "description": sv.get("caption") or sv.get("title") or p["name"], "thumbnailUrl": [thumb],
                    "uploadDate": sv.get("upload_date") or "2026-10-16", "embedUrl": f"https://www.youtube-nocookie.com/embed/{vid}",
                    "contentUrl": f"https://www.youtube.com/watch?v={vid}"})
    return layout(path, p["name"], desc, body, og=pimg(p["images"][0]), jsonld=lds, body_class="page-product", preload=pimg(p["images"][0]))


def ship_fee_for(price, p=None):
    """Phí ship khi mua 1 món giá price (theo cài đặt chung ở /admin)."""
    th, fee = SITE.get("free_ship_threshold") or 0, SITE.get("shipping_fee") or 0
    return 0 if (p and p.get("free_ship")) or (th and price >= th) else fee


def offer_ld(p, price, url, name=None):
    """Offer cho Google (giá, còn hàng, phí ship, đổi trả 7 ngày khi lỗi NSX – theo /chinh-sach-doi-tra/)."""
    o = {"@type": "Offer", "priceCurrency": "VND", "price": price, "availability": "https://schema.org/InStock", "url": url,
         "itemCondition": "https://schema.org/NewCondition", "seller": {"@type": "Organization", "name": BRAND},
         "shippingDetails": {"@type": "OfferShippingDetails",
                             "shippingRate": {"@type": "MonetaryAmount", "value": ship_fee_for(price, p), "currency": "VND"},
                             "shippingDestination": {"@type": "DefinedRegion", "addressCountry": "VN"},
                             "deliveryTime": {"@type": "ShippingDeliveryTime",
                                              "handlingTime": {"@type": "QuantitativeValue", "minValue": 0, "maxValue": 1, "unitCode": "DAY"},
                                              "transitTime": {"@type": "QuantitativeValue", "minValue": 1, "maxValue": 5, "unitCode": "DAY"}}},
         "hasMerchantReturnPolicy": {"@type": "MerchantReturnPolicy", "applicableCountry": "VN",
                                     "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow", "merchantReturnDays": 7,
                                     "returnMethod": "https://schema.org/ReturnByMail", "itemDefectReturnFees": "https://schema.org/FreeReturn",
                                     "merchantReturnLink": DOMAIN + lp("/chinh-sach-doi-tra/")}}
    if name:
        o["name"] = name
    return o


def product_faqs(p, purchasable=True):
    """Hỏi đáp của sản phẩm: các câu soạn ở /admin (ô "Hỏi đáp") + 1 câu "mua ở đâu, phí ship" tự tạo từ cài đặt chung (luôn đúng số mới nhất)."""
    out = [((x.get("q") or "").strip(), (x.get("a") or "").strip()) for x in (p.get("faq") or []) if isinstance(x, dict)]
    out = [(q, a) for q, a in out if q and a]
    if purchasable and not p.get("combo"):
        th, fee = SITE.get("free_ship_threshold") or 0, SITE.get("shipping_fee") or 0
        ship = t("miễn phí vận chuyển") if p.get("free_ship") else (tf("phí giao hàng {fee}, miễn phí cho đơn từ {th}", fee=money(fee), th=money(th)) if th and fee else "")
        out.append((tf("Mua {name} chính hãng ở đâu? Phí giao hàng bao nhiêu?", name=p.get("short_name") or p["name"]),
                    tf("Anh/chị đặt trực tiếp trên website {site} (bấm **Mua ngay** hoặc **Thêm vào giỏ hàng**), hoặc nhắn Zalo / gọi hotline **{hotline}**. "
                       "Giao hàng toàn quốc{ship}. Được kiểm tra hàng trước khi thanh toán; đổi trả trong 7 ngày nếu sản phẩm lỗi do nhà sản xuất.",
                       site=DOMAIN.split("//")[-1], hotline=SITE["hotline"], ship=(", " + ship) if ship else "")))
    return out


PROOF_ANCHOR_RE = re.compile(r"kiểm nghiệm|chứng nhận|pháp lý|testing|tested|certif|legal", re.I)
LEGAL_RE = re.compile(r"pháp lý|legal", re.I)
PROOF_RE = re.compile(r"kiểm nghiệm|chứng nhận|pháp lý|tiêu chuẩn|xuất xứ|testing|tested|certif|legal|standard|origin", re.I)
TEST_RE = re.compile(r"kiểm nghiệm|testing|tested|lab test", re.I)  # mục / huy hiệu "Kiểm nghiệm" (bản dịch: "Lab testing"…)


def proof_drawer(p):
    """Nút "Xem hồ sơ chất lượng" + khung trượt: CHỈ hiện tài liệu có thật trong dữ liệu sản phẩm –
    hồ sơ có cấu trúc (proofs: đơn vị, ngày, phạm vi, ảnh/PDF), ảnh phiếu kiểm nghiệm, ảnh nhãn thật, và các mục mô tả về tiêu chuẩn/kiểm nghiệm/pháp lý/xuất xứ.
    Không có gì thì không hiện nút. Logic mở/đóng trong main.js (initProof)."""
    if p.get("combo"):
        return "", ""
    secs = [s for s in p.get("sections", []) if PROOF_RE.search(s.get("title") or "")]
    proofs = [x for x in (p.get("proofs") or []) if x.get("title") and (x.get("org") or x.get("file"))]
    if proofs:  # đã có danh sách giấy tờ (kèm ảnh) thì bỏ mục "Hồ sơ pháp lý" của phần mô tả để không lặp giấy/ảnh
        secs = [s for s in secs if not LEGAL_RE.search(s.get("title") or "")]
    labels = [x for x in (p.get("label_imgs") or []) if x]
    cert = p.get("test_cert_img")
    if not (secs or proofs or labels or cert):
        return "", ""
    def doc(url, alt):
        u = pimg(url) if not str(url).lower().endswith(".pdf") else url
        if str(url).lower().endswith(".pdf"):
            return f'<a class="pf-pdf" href="{esc(u)}" target="_blank" rel="noopener">📄 {t("Mở tài liệu PDF:")} {esc(alt)}</a>'
        return f'<a class="pf-img" href="{esc(u)}" target="_blank" rel="noopener"><img src="{esc(u)}" alt="{esc(alt)}" loading="lazy"></a>'
    parts = []
    for x in proofs:
        meta = "".join(f"<li><b>{k}:</b> {esc(x[n])}</li>" for k, n in ((t("Đơn vị"), "org"), (t("Ngày"), "date"), (t("Phạm vi"), "scope"), (t("Số hiệu"), "number")) if x.get(n))
        parts.append(f'<div class="pf-doc"><h3>{esc(x["title"])}</h3>{f"<ul>{meta}</ul>" if meta else ""}{doc(x["file"], x["title"]) if x.get("file") else ""}</div>')
    if cert:
        parts.append(f'<div class="pf-doc"><h3>{t("Phiếu kiểm nghiệm")}</h3>{doc(cert, t("Phiếu kiểm nghiệm") + " " + p["name"])}</div>')
    if labels:
        parts.append(f'<div class="pf-doc"><h3>{t("Ảnh nhãn thật trên bao bì")}</h3>' + "".join(doc(u, tf("Nhãn thật {name} – ảnh {i}", name=p["name"], i=i)) for i, u in enumerate(labels, 1)) + "</div>")
    for s in secs:
        style = s.get("style") or "box"
        inner = ("<ul>" + "".join(f"<li>{md_inline(x)}</li>" for x in (s.get("items") or []) if x) + "</ul>") if style == "list" else md(s.get("text"))
        inner = re.sub(r'<p class="hs-grid">.*?</p>', "", inner, flags=re.S)  # lưới ảnh giấy tờ đã có ở danh sách giấy tờ
        inner = inner.replace('data-lightbox="', 'data-lightbox="pd-')  # ảnh còn lại: nhóm riêng, không lặp với ảnh ở trang
        parts.append(f'<div class="pf-doc pf-sec"><h3>{esc(s.get("title"))}</h3>{inner}</div>')
    has_docs = bool(cert or labels or any(x.get("file") for x in proofs))
    label = t("Xem phiếu kiểm nghiệm & nhãn thật" if (cert or any(x.get("file") for x in proofs)) and labels else
              "Xem phiếu kiểm nghiệm" if cert or any(x.get("file") for x in proofs) else
              "Xem nhãn thật & hồ sơ chất lượng" if labels else "Xem hồ sơ chất lượng")
    cta = f'<button type="button" class="pf-open" data-proof aria-haspopup="dialog" aria-controls="proofBox"><span class="pf-ic" aria-hidden="true">📄</span><span>{label}</span><i aria-hidden="true">›</i></button>'
    disc = f'<p class="pf-note">{esc(p["disclaimer"])}</p>' if p.get("disclaimer") else ""
    box = f'''<div class="pf" id="proofBox" hidden><div class="pf-box" role="dialog" aria-modal="true" aria-labelledby="pfTitle">
  <div class="pf-head"><h2 id="pfTitle">{t("Hồ sơ chất lượng")}</h2><button type="button" class="icon-btn pf-x" data-proof-close aria-label="{t("Đóng")}">{I["close"]}</button></div>
  <div class="pf-body"><p class="pf-lead">{esc(p["name"])}{"" if has_docs else t(" · Thông tin dưới đây lấy từ hồ sơ công bố của sản phẩm.")}</p>{"".join(parts)}{disc}</div>
</div></div>'''
    return cta, box


UNIT_WORDS = ("hộp", "hũ", "chai", "gói", "túi", "lọ", "bịch")


def unit_word(p, v):
    if not IS_VI:
        return t("sản phẩm")  # tiếng Anh: "items" (tên quy cách đã dịch không tách được chữ đơn vị)
    w = ((v.get("name") if v is not p else p.get("unit")) or "").strip().split(" ")[0].lower()
    return w if w in UNIT_WORDS else "sản phẩm"


def ship_hint(p, v):
    """Dòng ship trong khung giá – tính theo giá quy cách: "Mua từ 2 chai được miễn phí vận chuyển". JS (shipHint) cập nhật theo số lượng."""
    th, fee, price = SITE.get("free_ship_threshold") or 0, SITE.get("shipping_fee") or 0, v.get("price")
    if p.get("free_ship"):
        return t("🚚 Được <b>miễn phí vận chuyển</b>")
    if not th or not fee or not price:
        return t("🚚 Giao hàng toàn quốc")
    n = -(-th // price)
    if n <= 1:
        return t("🚚 Được <b>miễn phí vận chuyển</b>")
    if n <= 5:
        return tf("🚚 Mua từ <b>{n} {unit}</b> được miễn phí vận chuyển", n=n, unit=unit_word(p, v))
    return tf("🚚 Đơn từ <b>{amount}</b> được miễn phí vận chuyển", amount=money(th).replace(' ₫', 'đ'))


def save_text(v):
    d = discount(v)
    return tf('Tiết kiệm <b>{amount}</b> so với giá gốc', amount=money(v["regular_price"] - v["price"])) if d else ""


def v_opt(i, v, p=None, best=False):
    """Nút chọn quy cách: tên + giá (người lớn tuổi không phải bấm thử mới biết giá).
    Quy cách nhiều hộp: thêm "≈ giá/hộp", "-X%" (so với giá gốc, khớp nhãn giảm giá) và nhãn "Lợi nhất" cho combo tiết kiệm nhiều nhất."""
    price = f"<small>{money(v['price'])}</small>" if v.get("price") is not None else ""
    extra, u, d = [], v.get("units") or 0, discount(v)
    if u >= 2 and v.get("price") and p:
        uw = unit_word(p, p["variants"][0]) if IS_VI else "unit"
        uw = uw if uw != "sản phẩm" else "hộp"
        extra.append(f'≈ {money(round(v["price"] / u / 1000) * 1000).replace(" ₫", "đ")}/{uw}')
    if d and u >= 2:
        extra.append(f'<b>-{d}%</b>')
    more = f'<i class="v-per">{" · ".join(extra)}</i>' if extra else ""
    tag = f'<em class="v-best">{t("Lợi nhất")}</em>' if best else ""
    on = "true" if i == 0 else "false"
    return f'<button type="button" class="v-opt{" is-active" if i == 0 else ""}{" v-has-best" if best else ""}" data-variant="{i}" aria-pressed="{on}">{tag}<span>{esc(v["name"])}</span>{price}{more}</button>'


def satc_html(p):
    """Thanh mua nhanh dính đáy (chỉ điện thoại < 768px): tên + quy cách, tổng tiền theo số lượng, − số lượng +, Thêm vào giỏ.
    Chỉ hiện sau khi khách đã cuộn qua hẳn nút Mua ngay. Logic trong main.js (initSatc) – mọi thao tác dùng lại ô số lượng và nút Thêm vào giỏ gốc."""
    v0 = (p.get("variants") or [p])[0]
    return f'''<div class="satc" id="satc" role="region" aria-label="{t("Thanh mua nhanh")}" aria-hidden="true" inert>
  <div class="satc-row"><div class="satc-txt"><div class="satc-name">{esc(p.get("short_name") or p["name"])}</div><div class="satc-var" id="satcVar">{esc(v0.get("name") or p.get("unit") or "")}</div></div>
  <div class="satc-sum" aria-live="polite" aria-atomic="true"><b class="satc-price" id="satcPrice">{money(v0.get("price"))}</b><small id="satcEach"></small></div></div>
  <div class="satc-row satc-actions"><div class="satc-qty" role="group" aria-label="{t("Số lượng")}"><button type="button" data-satc-q="-1" aria-label="{t("Giảm số lượng")}">−</button><input id="satcQty" type="number" inputmode="numeric" min="1" max="99" value="1" aria-label="{t("Số lượng")}"><button type="button" data-satc-q="1" aria-label="{t("Tăng số lượng")}">+</button></div>
  <button type="button" class="satc-add" id="satcAdd">{t("Thêm vào giỏ")}</button></div>
</div>'''


def reviews_of(p):
    """Đánh giá thật của khách (ô "Đánh giá khách hàng" trong /admin). Không có thì không hiện gì."""
    return [r for r in (p.get("reviews") or []) if r.get("name") and (r.get("text") or r.get("video") or r.get("img"))]


def rating_of(p):
    """Sao trung bình + số đánh giá: chỉ khi có từ 3 đánh giá thật có chấm sao."""
    rs = [min(5, num(r.get("rating"))) for r in reviews_of(p) if num(r.get("rating"))]
    return (round(sum(rs) / len(rs), 1), len(rs)) if len(rs) >= 3 else None


def stars_html(p, cls="stars"):
    r = rating_of(p)
    if not r:
        return ""
    avg, n = r
    return f'<span class="{cls}" aria-label="{tf("{avg} trên 5 sao, {n} đánh giá", avg=avg, n=n)}"><span class="st" style="--r:{avg / 5 * 100:.0f}%" aria-hidden="true"></span><b>{str(avg).replace(".", "," if IS_VI else ".")}</b><small>({n}{"" if "pc-" in cls else t(" đánh giá")})</small></span>'


def origin_story(p):
    """Khối "Câu chuyện sản phẩm" trên trang sản phẩm (ô `story`): hành trình từ vùng nguyên liệu tới tách trà,
    con số thật, báo chí đưa tin. Không có chặng nào thì không hiện."""
    s = p.get("story") or {}
    steps = [x for x in (s.get("steps") or []) if x.get("title")]
    if not steps:
        return ""
    items = "".join(f'''<li class="ogs-step">{f'<figure class="ogs-fig"><img src="{img_url(x["image"], 700)}" alt="{esc(x.get("alt") or x["title"])}" width="700" height="525" loading="lazy" decoding="async"></figure>' if x.get("image") else ""}
<div class="ogs-body"><span class="ogs-n">{i:02d}</span><h3>{esc(x["title"])}</h3>{md(x.get("text"))}</div></li>''' for i, x in enumerate(steps, 1))
    facts = "".join(f'<li><b>{esc(f["value"])}</b><span>{esc(f.get("label"))}</span></li>' for f in (s.get("facts") or []) if f.get("value"))
    facts = f'<ul class="ogs-facts">{facts}</ul>' if facts else ""
    press = "".join(f'''<a class="ogs-press-card" href="{esc(x["url"])}" target="_blank" rel="noopener"><span class="ogs-press-org">{esc(x.get("org"))}{f' · {esc(x["date"])}' if x.get("date") else ""}</span>
<b>{esc(x.get("title"))}</b>{f'<span class="ogs-press-sum">{esc(x["summary"])}</span>' if x.get("summary") else ""}<span class="ogs-press-go">{t("Xem bài gốc")} ›</span></a>''' for x in (s.get("press") or []) if x.get("url"))
    press = f'<div class="ogs-press"><h3 class="ogs-press-h">{t("Báo chí nói về nơi làm ra sản phẩm")}</h3>{press}</div>' if press else ""
    n_press = len([x for x in (s.get("press") or []) if x.get("url")])
    if n_press > 1:
        press = press.replace('<div class="ogs-press">', '<div class="ogs-press ogs-press-2">', 1)
    more = f'<p class="ogs-more"><a class="btn btn-outline" href="{esc(s["link"])}">{esc(s.get("link_text") or t("Đọc trọn câu chuyện"))}</a></p>' if s.get("link") else ""
    q = s.get("quote") or {}
    cite = f'<cite>{esc(q["by"])}</cite>' if q.get("by") else ""
    quote = f'<blockquote class="ogs-quote"><p>{esc(q["text"])}</p>{cite}</blockquote>' if q.get("text") else ""
    v = s.get("video") or {}
    vid = yt_id(v.get("youtube"))
    video = ""
    if vid:  # ảnh bìa, bấm mới tải YouTube (dùng chung xử lý .v-frame[data-yt] trong main.js)
        vt = esc(v.get("title") or "")
        vimg = img_url(v["image"], 1200) if v.get("image") else f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
        vcap = f'<span>{esc(v["caption"])}</span>' if v.get("caption") else ""
        vfig = f'<figcaption><b>{vt}</b>{vcap}</figcaption>' if vt else ""
        video = f'''<figure class="ogs-video"><div class="v-frame" data-yt="{vid}" data-title="{vt}"><img src="{esc(vimg)}" alt="{vt}" loading="lazy" width="1200" height="675"><button class="v-play" aria-label="{t("Phát video:")} {vt}">{I["play"]}</button></div>{vfig}</figure>'''
    pl = s.get("pledge") or {}
    pl_h = f'<h3>{esc(pl["title"])}</h3>' if pl.get("title") else ""
    pl_s = f'<p class="ogs-sign">{esc(pl["sign"])}</p>' if pl.get("sign") else ""
    def pl_fig(x):
        cap = esc(x.get("caption") or "")
        fc = f"<figcaption>{cap}</figcaption>" if cap else ""
        return f'<figure><a href="{esc(x["image"])}" data-lightbox="ogs-pledge"><img src="{img_url(x["image"], 800)}" alt="{cap}" width="800" height="600" loading="lazy" decoding="async"></a>{fc}</figure>'
    pl_imgs = "".join(pl_fig(x) for x in (pl.get("images") or []) if x.get("image"))
    pl_imgs = f'<div class="ogs-pledge-imgs">{pl_imgs}</div>' if pl_imgs else ""
    pledge = f'<div class="ogs-pledge">{pl_h}{pl_imgs}{md(pl.get("text"))}{pl_s}</div>' if pl.get("text") else ""
    return f'''<section class="ogs" id="cau-chuyen" aria-labelledby="ogsTitle">
  <div class="ogs-head">{f'<span class="ogs-eye">{esc(s["eyebrow"])}</span>' if s.get("eyebrow") else ""}<h2 class="ogs-title" id="ogsTitle">{esc(s.get("title") or t("Câu chuyện sản phẩm"))}</h2>{f'<div class="ogs-intro">{md(s["intro"])}</div>' if s.get("intro") else ""}</div>
  {video}
  <ol class="ogs-steps">{items}</ol>
  {quote}{facts}{press}{pledge}{more}
</section>'''


def home_origin():
    """Trang chủ: khối "Từ vùng nguyên liệu" lấy từ câu chuyện của sản phẩm có bật `story.home`."""
    p = next((x for x in PRODUCTS if (x.get("story") or {}).get("home") and (x["story"].get("steps"))), None)
    if not p:
        return ""
    s = p["story"]
    imgs = [x for x in s["steps"] if x.get("image")][:3]
    pics = "".join(f'<img src="{img_url(x["image"], 600)}" alt="{esc(x.get("alt") or x["title"])}" width="600" height="450" loading="lazy" decoding="async">' for x in imgs)
    href = s.get("link") or f'/san-pham/{p["slug"]}/#cau-chuyen'
    return f'''<section class="section ogs-home"><div class="container">
  <div class="ogs-home-grid">
    <div class="ogs-home-pics">{pics}</div>
    <div class="ogs-home-text">{f'<span class="ogs-eye">{esc(s["eyebrow"])}</span>' if s.get("eyebrow") else ""}<h2 class="story-title">{esc(s.get("home_title") or s.get("title") or "")}</h2>
      {md(s.get("home_text") or s.get("intro") or "")}
      <div class="slide-cta"><a class="btn btn-lg" href="{esc(href)}">{esc(s.get("link_text") or t("Đọc trọn câu chuyện"))}</a><a class="btn btn-lg btn-ghost" href="/san-pham/{p["slug"]}/">{t("Xem sản phẩm")}</a></div>
    </div>
  </div>
</div></section>'''


def reviews_html(p):
    """Khối "Khách hàng nói gì" trên trang sản phẩm – dùng lại thẻ video cảm nhận của trang chủ."""
    rv = reviews_of(p)
    if not rv:
        return ""
    cards = ""
    for i, r in enumerate(rv):
        who = f'<b>{esc(r["name"])}</b>' + (f'<span>{esc(r["location"])}</span>' if r.get("location") else "")
        star = num(r.get("rating"))
        star = f'<span class="st" style="--r:{min(5, star) * 20}%" aria-label="{tf("{n} sao", n=min(5, star))}"></span>' if star else ""
        vid, yt = r.get("video") or "", yt_id(r.get("video"))
        if vid:
            cover = r.get("img") or (f"https://i.ytimg.com/vi/{yt}/hqdefault.jpg" if yt else "")
            frame = f'data-yt="{yt}" data-title="{esc(r["name"])}"' if yt else f'data-video="{esc(vid)}"'
            cards += f'''<figure class="v-card rv-card"><div class="v-frame" {frame}>{f'<img src="{esc(img_url(cover, 480) if cover.startswith("/") else cover)}" alt="{tf("Video cảm nhận của {name}", name=esc(r["name"]))}" loading="lazy" width="480" height="854">' if cover else ""}<button class="v-play" aria-label="{t("Phát video")}">{I["play"]}</button></div><figcaption>{who}{star}{f"<p>{esc(r['text'])}</p>" if r.get("text") else ""}</figcaption></figure>'''
        else:
            pic = f'<a class="rv-img" href="{esc(img_url(r["img"], 1000))}" data-lightbox="rv"><img src="{esc(img_url(r["img"], 480))}" alt="{tf("Ảnh khách {name} gửi", name=esc(r["name"]))}" loading="lazy" width="120" height="120"></a>' if r.get("img") else ""
            cards += f'<figure class="rv-q">{star}<blockquote>“{esc(r.get("text", ""))}”</blockquote>{pic}<figcaption>{who}</figcaption></figure>'
    return f'''<section class="rv-sec" id="danh-gia"><h2 class="sec-title left">{t("Khách hàng nói gì")} {stars_html(p, "stars rv-sum")}</h2><div class="rv-grid">{cards}</div></section>'''


def trust_line(p):
    """Cam kết ngay dưới nút mua (khớp chính sách giao hàng / kiểm hàng). Ý miễn phí ship nằm trong khung giá (ship_hint)."""
    return f'<ul class="p-trust"><li>✅ {t("Được kiểm tra hàng rồi mới trả tiền")}</li><li>📦 {t("Giao Hà Nội 1–2 ngày, tỉnh khác 2–5 ngày")}</li><li>📞 {t("Nhân viên gọi xác nhận trước khi giao")}</li></ul>'


def brochure_promo():
    b = BROCHURE
    if not b:
        return ""
    return f"""<section class="section"><div class="container"><a class="br-promo" href="{BR_PATH}">
  <img src="{img_url(b.get("cover"), 480)}" alt="Bìa {esc(b.get("title"))}" width="400" height="566" loading="lazy">
  <div><span class="eyebrow">Hồ sơ thương hiệu · {esc(b.get("pages", ""))} trang</span>
  <h2>Hiểu sâu hơn về {BRAND}</h2><p>{esc(b.get("intro"))}</p>
  <span class="btn btn-lg">📖 Đọc hồ sơ thương hiệu</span></div></a></div></section>"""


def page_brochure():
    b = BROCHURE
    bc, bld = breadcrumb([("Giới thiệu", "/gioi-thieu/"), ("Hồ sơ thương hiệu", None)])
    pdf = b.get("pdf")
    size = ""
    if pdf and (ROOT / pdf.lstrip("/")).exists():
        size = f" ({(ROOT / pdf.lstrip('/')).stat().st_size / 1048576:.1f} MB)".replace(".", ",")
    pdf_btn = f'<a class="btn btn-lg btn-outline" href="{esc(pdf)}" download>⬇ Tải bản PDF{size}</a>' if pdf else ""
    chapters = "".join(f'<li><span class="ch-no">{esc(c.get("no"))}</span><div><b>{esc(c.get("title"))}</b><span>{esc(c.get("desc"))}</span></div></li>' for c in b.get("chapters", []))
    stats = "".join(f'<div class="br-stat"><b>{esc(x.get("value"))}</b><span>{esc(x.get("label"))}</span></div>' for x in b.get("stats", []))
    award = f'<div class="br-award"><span class="br-award-ic">🏆</span><div><b>{esc(b["award"])}</b><small>{esc(b.get("award_note", ""))}</small></div></div>' if b.get("award") else ""
    fb = esc(b.get("flipbook_url"))
    body = f"""<section class="br-hero"><div class="container br-hero-in">
  <div class="br-hero-text">{bc}
    <span class="eyebrow">Công ty VitaGreen Nutrition</span>
    <h1>{esc(b.get("title"))}</h1>
    <blockquote>“{esc(b.get("quote"))}”</blockquote>
    <p>{esc(b.get("intro"))}</p>
    <div class="slide-cta"><a class="btn btn-lg" href="{fb}" target="_blank" rel="noopener">⛶ Đọc toàn màn hình</a>{pdf_btn}</div>
  </div>
  <div class="br-hero-cover"><img src="{img_url(b.get("cover"), 800)}" alt="Bìa {esc(b.get("title"))}" width="800" height="1132"></div>
</div></section>

<section class="section"><div class="container">
  <h2 class="sec-title">Đọc trực tiếp <span class="accent">{esc(b.get("pages", ""))} trang</span></h2>
  <div class="br-viewer" data-flipbook="{fb}">
    <img src="{img_url(b.get("cover"), 800)}" alt="" loading="lazy">
    <button class="br-play" type="button">📖 Bấm để mở hồ sơ thương hiệu</button>
  </div>
  <p class="sec-note">Trên điện thoại, nên bấm <a href="{fb}" target="_blank" rel="noopener">Đọc toàn màn hình</a> để xem rõ hơn.</p>
</div></section>

<section class="section bg-soft"><div class="container">
  <h2 class="sec-title">Trong hồ sơ có gì?</h2>
  <ol class="br-chapters">{chapters}</ol>
</div></section>

<section class="section"><div class="container">
  <h2 class="sec-title">Cộng đồng {BRAND} hôm nay</h2>
  <div class="br-stats">{stats}</div>
  <p class="sec-note">{esc(b.get("stats_note", ""))}</p>
  {award}
</div></section>

<section class="section bg-soft center"><div class="container narrow">
  <h2 class="sec-title">Bắt đầu từ một điều lành</h2>
  <div class="slide-cta center"><a class="btn btn-lg" href="/san-pham/">Khám phá sản phẩm</a><a class="btn btn-lg btn-outline" href="{zalo_link()}" target="_blank" rel="noopener">Tư vấn & hợp tác qua Zalo</a><a class="btn btn-lg btn-ghost" href="/lien-he/">Liên hệ</a></div>
</div></section>"""
    return layout(BR_PATH, b.get("title", "Hồ sơ thương hiệu"), strip_tags(b.get("intro", ""))[:158], body, og=img_url(b.get("cover"), 800), jsonld=[bld])


def page_about():
    values = [(t("Tử tế & Chính trực"), t("Minh bạch – sản phẩm thật, giá trị thật")), (t("Thân – Tâm – Trí"), t("Chăm sóc con người toàn diện, từ dinh dưỡng đến tinh thần và nhận thức")),
              (t("Sống tỉnh thức"), t("Nuôi dưỡng lòng biết ơn, yêu thương cuộc sống")), (t("Lan tỏa cộng đồng"), t("Gắn kết – chia sẻ – đồng hành")), (t("Phát triển bền vững"), t("Dẫn đầu bằng sự kiên định và chất lượng"))]
    vals = "".join(f'<div class="val-card"><span class="val-no">0{i}</span><h3>{esc(a)}</h3><p>{esc(b)}</p></div>' for i, (a, b) in enumerate(values, 1))
    bc, bld = breadcrumb([(t("Giới thiệu"), None)])
    bv_html, bv_ld = brand_video("about")
    story3 = tf("Từ đó, VitaGreen được xây dựng trên triết lý: <b>Sống xanh – sống lành – sống có giá trị</b>. Thương hiệu con <b>{brand}</b> ra đời không chỉ để bán sản phẩm, mà là lời xin lỗi muộn với những người ta không kịp chăm sóc, lời hứa sớm với những người ta vẫn còn được đồng hành, và lời cam kết với chính mình: <b>“Tôi chọn sống lành – để sống đáng.”</b>", brand=BRAND)
    # Tuyên ngôn theo khung "eat happy" của Candylicious: mỗi nhóm là 1 khổ, mỗi phần tử là 1 dòng
    stanzas = [[tf("Ở {brand}, sứ mệnh của chúng tôi rất giản dị: <b>sống lành, để sống đáng.</b>", brand=BRAND),
                t("Qua từng bữa ăn lành, chúng tôi mong mỗi ngày của người Việt là một ngày đáng sống.")],
               [t("Pha một ly sữa hạt cho mình, bạn có một buổi sáng nhẹ nhàng."),
                t("Pha thêm một ly cho mẹ, mẹ sẽ mỉm cười thật dịu dàng."),
                t("Suy cho cùng, sống lành cũng như yêu thương: trao đi là lan khắp mọi nẻo đường.")],
               [t("<b>Sống lành, để sống đáng.</b> Chúng tôi giữ điều đó trong mọi việc mình làm."),
                t("Mỗi ngày, không ngoại lệ, chúng tôi chọn từng sản phẩm như chọn cho chính bố mẹ mình,"),
                t("để mỗi người khách ghé qua, khi về mang theo chút an lòng, chút nghĩa tình.")],
               [t("Và trong mọi việc, chúng tôi luôn nhắc nhau: điều giản dị nhất thường là điều quý nhất."),
                t("Mà điều giản dị nhất, chính là một bữa cơm lành, ăn thật chậm, bên người mình thương.")]]
    manifesto = "".join("<p>" + "<br>".join(s) + "</p>" for s in stanzas)
    body = f'''{page_hero(tf("Giới thiệu {brand}", brand=BRAND), esc(SITE["slogan"]))}
<section class="section"><div class="container">{bc}
  {f'<div class="bv-about">{bv_html}</div>' if bv_html else ""}
  <div class="story about-story">
    <div class="story-text">
      <h2 class="story-title">{t("Câu chuyện thương hiệu")}</h2>
      <p>{t("Công ty VitaGreen Nutrition ra đời không phải từ một bản kế hoạch kinh doanh, mà từ một câu hỏi chưa kịp có lời đáp: <i>“Giá như mình chăm sóc tốt hơn…”</i>")}</p>
      <p>{t("Sau khi một người thân ra đi đột ngột, không kịp lời tạm biệt, cùng lúc đó hàng loạt vụ thực phẩm kém chất lượng vỡ lở, những người sáng lập nhận ra: <i>“Ai rồi cũng sẽ đến lúc phải rời khỏi cuộc đời này. Và nếu ngày mai là ngày cuối, thì mình đã sống xứng đáng và trọn vẹn chưa?”</i>")}</p>
      <p>{story3}</p>
    </div>
    <div class="story-media"><img src="/assets/img/brand/logo-gold.webp" alt="{BRAND} – {esc(SITE["slogan"])}" class="about-logo about-logo-gold" width="900" height="900" loading="lazy"></div>
  </div>
</div></section>
<section class="section manifesto"><div class="container narrow">
  <h2 class="sec-title">{t("Điều chúng tôi tin")}</h2>
  <div class="mf-lines">{manifesto}</div>
</div></section>
<section class="section bg-soft"><div class="container vm-grid">
  <div class="vm-card"><h3>{t("Tầm nhìn")}</h3><p>{t("Trở thành hệ sinh thái sản phẩm thực dưỡng uy tín hàng đầu Việt Nam — một biểu tượng uy tín được tin chọn trong từng gia đình. Không ngừng kiến tạo hệ sinh thái sản phẩm chất lượng – lành mạnh – bền vững, giúp người Việt sống khỏe từ THÂN đến TÂM, để mỗi ngày sống là một ngày thật sự đáng sống.")}</p></div>
  <div class="vm-card"><h3>{t("Sứ mệnh")}</h3><p>{t("Truyền cảm hứng về một lối sống lành mạnh – tỉnh thức – đầy yêu thương. Hướng tới hành trình giúp <b>10 triệu người Việt</b> sống khỏe mạnh từ THÂN đến TÂM, để mỗi bữa ăn là một lần trở về với chính mình, và mỗi ngày sống là một ngày thật sự đáng sống.")}</p></div>
</div></section>
{brochure_promo()}
<section class="section"><div class="container">
  <h2 class="sec-title">{t("Giá trị cốt lõi")}</h2>
  <div class="val-grid">{vals}</div>
</div></section>
<section class="parallax" style="background-image:url('/assets/img/brand/parallax-tea.webp')"><div class="container"><h2>{t("Sống lành<br>từ trong gốc")}</h2></div></section>
<section class="section"><div class="container narrow culture">
  <h2 class="sec-title">{tf("Văn hóa {brand}", brand=BRAND)}</h2>
  <p class="center">{t("Văn hóa của chúng tôi không phải là khẩu hiệu, mà là hành động nhỏ, đều đặn, chân thành, được gieo mỗi ngày:")}</p>
  <ul class="culture-list">
    <li>{ic("leaf","cl-ic")}<div><b>{t("Ăn chay – đi chùa vào mùng 1 và rằm")}</b><span>{t("Cách nhắc mình sống chậm – sống biết ơn – sống tỉnh thức.")}</span></div></li>
    <li>{ic("heart","cl-ic")}<div><b>{t("Hoạt động thiện nguyện cộng đồng")}</b><span>{t("Gieo điều lành ngay từ bây giờ, không đợi thành công rồi mới cho đi.")}</span></div></li>
    <li>{ic("check","cl-ic")}<div><b>{t("Thực hành sống lành trong từng việc nhỏ")}</b><span>{t("Uống nước ấm, ăn thuận tự nhiên, viết lời biết ơn mỗi sáng, giúp nhau sống chậm giữa đời nhanh.")}</span></div></li>
  </ul>
  <div class="center mt-2"><a class="btn btn-lg" href="/san-pham/">{t("Khám phá sản phẩm")}</a></div>
</div></section>'''
    about_ld = {"@context": "https://schema.org", "@type": "AboutPage", "url": DOMAIN + "/gioi-thieu/", "inLanguage": LANG,
                "about": {k: v for k, v in org_ld().items() if k != "@context"}}
    return layout("/gioi-thieu/", tf("Giới thiệu {brand}", brand=BRAND), tf("Câu chuyện thương hiệu {brand} – Sống xanh, sống lành, sống có giá trị. Tầm nhìn, sứ mệnh và giá trị cốt lõi của VitaGreen Nutrition.", brand=BRAND), body + bv_float(), jsonld=[about_ld, bld] + ([bv_ld] if bv_ld else []))


def page_contact():
    bc, bld = breadcrumb([(t("Liên hệ"), None)])
    body = f'''{page_hero(tf("Liên hệ {brand}", brand=BRAND), t("Chúng tôi luôn sẵn sàng lắng nghe và hỗ trợ anh/chị"))}
<section class="section"><div class="container">{bc}
<div class="contact-grid">
  <div class="contact-info">
    <h2>{t("Thông tin liên hệ")}</h2>
    <p class="muted">{esc(SITE["company"])}</p>
    <ul class="ci-list">
      <li>{ic("pin","ci-ic")}<div><b>{t("Địa chỉ")}</b><span>{esc(SITE["address"])}</span></div></li>
      <li>{ic("phone","ci-ic")}<div><b>Hotline / Zalo</b><a href="tel:{tel(SITE["hotline"])}">{esc(SITE["hotline"])}</a></div></li>
      <li>{ic("mail","ci-ic")}<div><b>Email</b><a href="mailto:{esc(SITE["email"])}">{esc(SITE["email"])}</a></div></li>
      <li>{ic("clock","ci-ic")}<div><b>{t("Giờ làm việc")}</b><span>{esc(SITE["opening_hours"])}</span></div></li>
    </ul>
    {social_links("socials socials-lg")}
  </div>
  <form class="contact-form card" id="contactForm" novalidate>
    <h2>{t("Gửi lời nhắn cho chúng tôi")}</h2>
    <div class="f-row"><label>{t("Họ và tên *")}<input name="name" required autocomplete="name"></label><label>{t("Số điện thoại *")}<input name="phone" type="tel" required autocomplete="tel" inputmode="tel"></label></div>
    <label>Email<input name="email" type="email" autocomplete="email"></label>
    <label>{t("Nội dung *")}<textarea name="message" rows="5" required></textarea></label>
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn btn-lg" type="submit">{t("Gửi liên hệ")}</button>
    <p class="form-msg" role="status"></p>
  </form>
</div>
<div class="map"><iframe src="{esc(SITE["map_embed"])}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="{t("Bản đồ")} {BRAND}" allowfullscreen></iframe></div>
</div></section>'''
    return layout("/lien-he/", tf("Liên hệ {brand}", brand=BRAND), tf("Liên hệ {brand}: hotline {hotline}, email {email}, địa chỉ {address}.", brand=BRAND, hotline=SITE['hotline'], email=SITE['email'], address=SITE['address']), body, jsonld=[bld])


def page_simple(slug, title, content):
    bc, bld = breadcrumb([(title, None)])
    body = f'''{page_hero(title)}<section class="section"><div class="container narrow">{bc}<article class="prose">{fill(content)}</article></div></section>'''
    return layout(f"/{slug}/", title, strip_tags(fill(content))[:155], body, jsonld=[bld])


def page_blog(path, title, posts, crumbs):
    bc, bld = breadcrumb(crumbs)
    chips = f'<a class="chip{" active" if path == "/goc-song-lanh/" else ""}" href="/goc-song-lanh/">{t("Tất cả")}</a>' + "".join(
        f'<a class="chip{" active" if path.endswith(c["slug"] + "/") else ""}" href="/goc-song-lanh/chuyen-muc/{c["slug"]}/">{esc(c["name"])}</a>' for c in POSTS["categories"] if IS_VI or any(p["category"] == c["slug"] for p in POSTS["posts"]))
    cards = "".join(post_card(p) for p in posts) or f'<p class="empty">{t("Chưa có bài viết trong chuyên mục này.")}</p>'
    body = f'''{page_hero(title, t("Kiến thức dinh dưỡng, lối sống lành và câu chuyện sản phẩm"))}
<section class="section"><div class="container">{bc}<div class="chips">{chips}</div><div class="post-grid">{cards}</div></div></section>'''
    return layout(path, title, tf("{title} – kiến thức dinh dưỡng, lối sống lành mạnh và câu chuyện sản phẩm từ {brand}.", title=title, brand=BRAND), body, jsonld=[bld])


def post_products(p):
    """Sản phẩm gợi ý trong bài viết (23/10/2026): ô `products` của bài (danh sách slug) nếu có, không thì lấy các sản phẩm bài đã nhắc tới (link /san-pham/…), theo thứ tự xuất hiện."""
    slugs = p.get("products") or re.findall(r'/san-pham/([a-z0-9-]+)/', p["content"])
    out = []
    for s in slugs:
        q = PROD_BY.get(s)
        if q and q.get("price") is not None and q not in out:
            out.append(q)
    return out


def post_pbox(items, where):
    """Khung mua nhanh trong bài viết: where = mid (giữa bài, 1 sản phẩm) | end (cuối bài, tối đa 2)."""
    if not items:
        return ""
    rows = ""
    for q in items:
        url = f'/san-pham/{q["slug"]}/'
        if not q.get("variants"):
            act = f'<button class="btn btn-buy pbx-btn" data-add="{q["slug"]}">{I["cart"]}<span>{t("Thêm vào giỏ")}</span></button>'
        else:
            act = f'<a class="btn btn-buy pbx-btn" href="{url}" data-pick="{q["slug"]}" data-cta="post_pbox_{where}">{t("Chọn loại")} →</a>'
        rows += f'''<div class="pbx-item"><a class="pbx-img" href="{url}" data-cta="post_pbox_{where}"><img src="{pimg(q["images"][0], True)}" alt="{esc(q["name"])}" width="96" height="96" loading="lazy"></a>
<div class="pbx-tx"><a class="pbx-name" href="{url}" data-cta="post_pbox_{where}">{esc(q["name"])}</a>{f'<small>{esc(q["pitch"])}</small>' if q.get("pitch") else ""}{price_html(q, "price pbx-price", from_=True)}</div>{act}</div>'''
    return f'''<aside class="pbx pbx-{where}"><p class="pbx-eye">🌿 {t("Gợi ý cho bữa ăn hằng ngày")}</p>{rows}
<p class="pbx-note">{t("Sản phẩm là thực phẩm, không phải là thuốc, không có tác dụng thay thế thuốc chữa bệnh.")}</p></aside>'''


def post_with_pbox(p):
    """Chèn khung sản phẩm vào giữa bài (trước tiêu đề mục ở khoảng giữa, bài có ≥ 3 mục) và cuối bài."""
    items, html = post_products(p), p["content"]
    if not items:
        return html, ""
    cuts = [m.start() for m in re.finditer(r"<h2[ >]", html)]
    if len(cuts) >= 3:
        i = cuts[len(cuts) // 2]
        html = html[:i] + post_pbox(items[:1], "mid") + html[i:]
    return html, post_pbox(items[:2], "end")


def page_post(p):
    path = f"/goc-song-lanh/{p['slug']}/"
    post_html, pbox_end = post_with_pbox(p)
    cat = PCATS.get(p["category"], {"name": "", "slug": ""})
    bc, bld = breadcrumb([(t("Góc Sống Lành"), "/goc-song-lanh/"), (cat["name"], f"/goc-song-lanh/chuyen-muc/{cat['slug']}/"), (p["title"], None)])
    d = datetime.date.fromisoformat(p["date"]).strftime("%d/%m/%Y")
    others = sorted([x for x in POSTS["posts"] if x["slug"] != p["slug"]], key=lambda x: x["date"], reverse=True)[:3]
    body = f'''<section class="section pt-2"><div class="container narrow">{bc}
<article class="prose post">
  <div class="post-meta"><a href="/goc-song-lanh/chuyen-muc/{cat["slug"]}/">{esc(cat["name"])}</a> · <time datetime="{p["date"]}">{d}</time></div>
  <h1>{esc(p["title"])}</h1>
  <img class="post-cover" src="{img_url(p["image"], 1400)}" alt="{esc(p["title"])}" width="1200" height="1200">
  {post_html}
</article>
{pbox_end}{cn_cta("post")}{f'<p class="post-quiz">🖐 Bạn sống lành tới đâu? <a href="{QUIZ_PATH}?tu=post" data-cta="post_quiz">Chơi thử 1 phút: Bạn còn mấy ngón tay? →</a></p>' if IS_VI and QUIZ.get("questions") else ""}</div></section>
<section class="section bg-soft"><div class="container"><h2 class="sec-title">{t("Bài viết khác")}</h2><div class="post-grid">{"".join(post_card(x) for x in others)}</div></div></section>'''
    org = {"@type": "Organization", "name": BRAND, "url": DOMAIN + "/", "logo": {"@type": "ImageObject", "url": DOMAIN + "/assets/img/brand/logo@2x.png"}}
    ld = {"@context": "https://schema.org", "@type": "Article", "headline": p["title"], "description": p["excerpt"], "inLanguage": LANG,
          "datePublished": p["date"], "dateModified": p["modified"], "image": DOMAIN + img_url(p["image"], 1200),
          "mainEntityOfPage": DOMAIN + path, "articleSection": cat["name"] or None, "author": org, "publisher": org}
    ld = {k: v for k, v in ld.items() if v}
    meta = f'<meta property="article:published_time" content="{p["date"]}"><meta property="article:modified_time" content="{p["modified"]}">'
    return layout(path, p["title"], p["excerpt"], body + bv_float(), og=img_url(p["image"], 1200), jsonld=[ld, bld], og_type="article", extra_head=meta)


def page_cart():
    bc, _ = breadcrumb([(t("Giỏ hàng"), None)])
    body = f'''<section class="section pt-2"><div class="container">{bc}
<div class="steps"><span class="is-active">{t("1. Giỏ hàng")}</span><span>{t("2. Thanh toán")}</span><span>{t("3. Hoàn tất")}</span></div>
<div id="cartPage" class="cart-page"><div class="loading">{t("Đang tải giỏ hàng…")}</div></div>
</div></section>'''
    return layout("/gio-hang/", t("Giỏ hàng"), t("Giỏ hàng của bạn tại ") + BRAND, body, noindex=True, body_class="page-cart")


def page_checkout():
    bc, _ = breadcrumb([(t("Giỏ hàng"), "/gio-hang/"), (t("Thanh toán"), None)])
    agree = tf('Bằng việc đặt hàng, bạn đồng ý với <a href="/chinh-sach-bao-mat/">chính sách bảo mật</a> và <a href="/chinh-sach-doi-tra/">chính sách đổi trả</a> của {brand}.', brand=BRAND)
    body = f'''<section class="section pt-2"><div class="container">{bc}
<div class="steps"><span class="done">{t("1. Giỏ hàng")}</span><span class="is-active">{t("2. Thanh toán")}</span><span>{t("3. Hoàn tất")}</span></div>
<form id="checkoutForm" class="checkout" novalidate>
  <div class="co-left card">
    <h2>{t("Thông tin nhận hàng")}</h2>
    <div data-order-fields><div class="loading">{t("Đang tải…")}</div></div>
  </div>
  <aside class="co-right card">
    <h2>{t("Đơn hàng của bạn")}</h2>
    <div id="coItems"></div>
    <div id="coUpsell"></div>
    {offer_box()}
    <button class="btn btn-lg btn-block btn-order" type="submit" id="placeOrder">✅ {t("Đặt hàng")}</button>
    <p class="form-msg" role="status"></p>
    <p class="qo-note">{t("Nhân viên sẽ gọi xác nhận trước khi giao hàng.")}</p>
    <div class="qo-alt"><a class="btn btn-outline" href="tel:{tel(SITE["hotline"])}">📞 {t("Gọi đặt hàng")}</a><a class="btn btn-zalo" href="{zalo_link()}" target="_blank" rel="noopener">💬 {t("Đặt qua Zalo")}</a></div>
    <p class="small muted">{agree}</p>
  </aside>
</form>
</div></section>'''
    return layout("/thanh-toan/", t("Thanh toán"), t("Thanh toán đơn hàng tại ") + BRAND, body, noindex=True, body_class="page-checkout")


def page_thanks():
    body = f'''<section class="section pt-2"><div class="container narrow">
<div class="steps"><span class="done">{t("1. Giỏ hàng")}</span><span class="done">{t("2. Thanh toán")}</span><span class="is-active">{t("3. Hoàn tất")}</span></div>
<div id="thanksPage" class="card thanks"><div class="loading">{t("Đang tải…")}</div></div>
</div></section>'''
    return layout("/dat-hang-thanh-cong/", t("Đặt hàng thành công"), t("Cảm ơn bạn đã đặt hàng tại ") + BRAND, body, noindex=True)


def page_wish():
    body = f'''{page_hero(t("Sản phẩm yêu thích"))}<section class="section"><div class="container"><div id="wishPage"></div></div></section>'''
    return layout("/yeu-thich/", t("Sản phẩm yêu thích"), t("Danh sách sản phẩm yêu thích"), body, noindex=True)


def page_search():
    body = f'''{page_hero(t("Tìm kiếm sản phẩm"))}<section class="section"><div class="container">
<form class="search-page-form" action="/tim-kiem/" method="get"><input type="search" name="q" id="spq" placeholder="{t("Nhập tên sản phẩm, thành phần…")}" aria-label="{t("Từ khóa")}"><button class="btn">{t("Tìm kiếm")}</button></form>
<p id="searchSummary" class="muted"></p><div id="searchPage" class="p-grid shop-grid"></div></div></section>'''
    return layout("/tim-kiem/", t("Tìm kiếm"), t("Tìm kiếm sản phẩm tại ") + BRAND, body, noindex=True)


def page_404():
    body = f'''<section class="section"><div class="container narrow center nf">
<p class="nf-code">404</p><h1>{t("Không tìm thấy trang")}</h1><p>{t("Trang bạn tìm có thể đã được di chuyển hoặc không còn tồn tại.")}</p>
<div class="slide-cta center"><a class="btn btn-lg" href="/">{t("Về trang chủ")}</a><a class="btn btn-lg btn-outline" href="/san-pham/">{t("Xem sản phẩm")}</a></div></div></section>'''
    return layout("/404.html", t("Không tìm thấy trang"), t("Không tìm thấy trang"), body, noindex=True)


# ---------------------------------------------------------------- write
PENDING = {}  # ngôn ngữ khác: giữ trang trong bộ nhớ, đổi đường dẫn xong mới ghi (biết trang nào đã có bản dịch)


def write(rel, content):
    if rel.endswith("/") or rel.endswith(".html"):
        content = new_tab(content)  # link ra trang ngoài luôn mở tab mới
    if not IS_VI:
        PENDING[rel] = content
        return rel
    p = DIST / rel.lstrip("/")
    if rel.endswith("/"):
        p = p / "index.html"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, "utf-8")
    return rel


def finish_lang(public):
    """Ngôn ngữ khác: đổi mọi link nội bộ sang bản dịch (nếu trang đó đã có), link tới trang chưa dịch giữ bản tiếng Việt; rồi ghi ra dist/<mã>/."""
    routes = {r: lp(r) for r in PENDING}
    have = {lp(r).split("?")[0].split("#")[0] for r in PENDING}

    def conv(path):
        if path.startswith(("/assets/", "/admin", f"/{LANG}/")) or path == f"/{LANG}":
            return path
        new = lp(path)
        return new if re.match(r"[^?#]*", new).group(0) in have else path

    attr = re.compile(r'(?<![\w-])(href|action|data-href)="(/[^"]*)"')
    absu = re.compile(re.escape(DOMAIN) + r'(/[^"\'\s<>]*)')
    for rel, html_ in PENDING.items():
        out = attr.sub(lambda m: f'{m.group(1)}="{conv(m.group(2))}"', html_)
        out = absu.sub(lambda m: DOMAIN + conv(m.group(1)), out)
        if rel != "/404.html":
            out = out.replace("<!--ALT-HEAD-->", alt_head(rel))
        out = out.replace("<!--ALT-HEAD-->", "").replace("<!--ALT-SW-->", alt_switch(rel, "sw")).replace("<!--ALT-OC-->", alt_switch(rel, "oc"))
        p = DIST / routes[rel].lstrip("/")
        if routes[rel].endswith("/"):
            p = p / "index.html"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(out, "utf-8")
    (DIST / f"_routes_{LANG}.json").write_text(json.dumps({"routes": {r: routes[r] for r in routes if r != "/404.html"}, "public": public}, ensure_ascii=False), "utf-8")
    if I18N_MISSING:
        miss = ROOT / "output" / f"i18n-missing-{LANG}.txt"
        miss.parent.mkdir(exist_ok=True)
        miss.write_text("\n".join(sorted(I18N_MISSING)) + "\n", "utf-8")
        print(f"  ⚠️ {LANGS[LANG]['name']}: {len(I18N_MISSING)} câu chưa dịch (đang hiện tiếng Việt) – xem output/i18n-missing-{LANG}.txt")
    print(f"Đã tạo {len(public)} trang công khai {LANGS[LANG]['name']} vào {DIST}/{LANG}/")


def js_keys():
    """Các câu main.js cần dịch: T('…') và TF('…', …) trong assets/js/main.js."""
    src = (ROOT / "assets/js/main.js").read_text("utf-8")
    return {m.replace("\\'", "'") for m in re.findall(r"\bTF?\('((?:[^'\\]|\\.)*)'", src)}


def logo_width():
    try:
        from PIL import Image
        with Image.open(ROOT / "assets/img/brand/logo.png") as im:
            return im.width
    except Exception:
        return 247


LOGO_W = logo_width()


def main():
    if IS_VI:
        if DIST.exists():
            shutil.rmtree(DIST)
        shutil.copytree(ROOT / "assets", DIST / "assets")
        if (ROOT / "admin").exists():
            shutil.copytree(ROOT / "admin", DIST / "admin")
        # dựng các ngôn ngữ khác trước (mỗi ngôn ngữ 1 lượt chạy riêng của chính file này) để bản tiếng Việt biết trang nào đã có bản dịch
        alt_public = {}
        for lang in LANGS:
            if lang == DEFAULT_LANG:
                continue
            subprocess.run([sys.executable, str(Path(__file__).resolve()), "--lang", lang], check=True)
            rf = DIST / f"_routes_{lang}.json"
            info = json.loads(rf.read_text("utf-8"))
            rf.unlink()
            ALT_ROUTES[lang], alt_public[lang] = info["routes"], info["public"]
    routes = []
    routes.append(write("/", page_home()))
    routes.append(write("/gioi-thieu/", page_about()))
    if BROCHURE:
        routes.append(write(BR_PATH, page_brochure()))
    routes.append(write("/lien-he/", page_contact()))
    if (SITE.get("ebook") or {}).get("flipbook"):
        routes.append(write(EBOOK_PATH, page_ebook()))
    if CN_PATH:
        routes.append(write(CN_PATH, page_camnang()))
    if gift_list():
        routes.append(write(GIFT_PATH, page_gifts()))
    if IS_VI:
        routes.append(write(PLEDGE_PATH, page_pledge()))
        routes.append(write(WALL_PATH, page_wall()))
        if QUIZ.get("questions"):
            routes.append(write(QUIZ_PATH, page_quiz()))
            write(QUIZ_GROUP_PATH, page_quiz_group())  # màn hình chơi nhóm: không vào sitemap
    if SITE.get("zalo_group"):  # link cố định cho QR, sách, bài đăng: luôn chuyển tới nhóm Zalo đang cài ở /admin (nhóm đầy → đổi link ở /admin là xong)
        write(ZALO_GATE, page_zalo_gate())  # 17/10/2026: cổng để lại tên + số Zalo rồi mới vào nhóm (không vào sitemap)
    if IS_VI and (ocx := page_ocx()):
        write(OCX_PATH, ocx)  # landing quảng cáo Bộ Ở Cữ (không vào sitemap)
    routes.append(write("/san-pham/", page_listing("/san-pham/", t("Toàn bộ sản phẩm"), PRODUCTS, "", [(t("Toàn bộ sản phẩm"), None)])))
    sale =[p for p in PRODUCTS if p["on_sale"]]
    if HAS_SALE and sale: routes.append(write("/khuyen-mai/", page_listing("/khuyen-mai/", t("Khuyến Mãi"), sale, t("Các sản phẩm đang có chương trình ưu đãi tại ") + BRAND + ".", [(t("Sản phẩm"), "/san-pham/"), (t("Khuyến Mãi"), None)])))
    for c in CATS:
        items = [p for p in PRODUCTS if p["category"] == c["slug"]]
        if items or IS_VI:
            routes.append(write(f"/danh-muc/{c['slug']}/", page_listing(f"/danh-muc/{c['slug']}/", c["name"], items, c.get("desc", ""), [(t("Sản phẩm"), "/san-pham/"), (c["name"], None)], c.get("about", ""))))
    for n in NEEDS:
        if n["url"].startswith("/nhu-cau/"):
            routes.append(write(n["url"], page_listing(n["url"], n["name"], n["items"], n.get("desc", ""), [(t("Sản phẩm"), "/san-pham/"), (n["name"], None)])))
    for p in PRODUCTS:
        routes.append(write(f"/san-pham/{p['slug']}/", page_product(p)))
    posts = sorted(POSTS["posts"], key=lambda x: x["date"], reverse=True)
    if posts or IS_VI:
        routes.append(write("/goc-song-lanh/", page_blog("/goc-song-lanh/", t("Góc Sống Lành"), posts, [(t("Góc Sống Lành"), None)])))
        for c in POSTS["categories"]:
            path = f"/goc-song-lanh/chuyen-muc/{c['slug']}/"
            cp = [p for p in posts if p["category"] == c["slug"]]
            if cp or IS_VI:
                routes.append(write(path, page_blog(path, c["name"], cp, [(t("Góc Sống Lành"), "/goc-song-lanh/"), (c["name"], None)])))
    for p in posts:
        routes.append(write(f"/goc-song-lanh/{p['slug']}/", page_post(p)))
    for pg in PAGES:
        routes.append(write(f"/{pg['slug']}/", page_simple(pg["slug"], pg["title"], pg["content"])))
    write("/gio-hang/", page_cart())
    write("/thanh-toan/", page_checkout())
    write("/dat-hang-thanh-cong/", page_thanks())
    write("/yeu-thich/", page_wish())
    write("/tim-kiem/", page_search())
    write("/404.html", page_404())

    # dữ liệu cho JavaScript (ngôn ngữ khác: assets/js/data-<mã>.js, có thêm tên tiếng Việt để đơn hàng về CRM vẫn đúng tên)
    shown = {p["slug"] for p in PRODUCTS}
    js_products = []
    for p in PRODUCTS_ALL:
        jp = {
            "slug": p["slug"], "name": p["name"], "short": p.get("short_name") or p["name"], "price": p.get("price"),
            "regular": p.get("regular_price"), "off": p.get("web_off") or 0, "fs": bool(p.get("free_ship")), "days": num(p.get("days")) or 0, "servings": p.get("servings"), "serving_unit": p.get("serving_unit") or "", "unit": p.get("unit", ""),
            "variants": [{k: v for k, v in x.items() if IS_VI is False or k != "name_vi"} for x in p.get("variants", [])],
            "img": pimg(p["images"][0], True), "url": lp(f"/san-pham/{p['slug']}/") if p["slug"] in shown else f"/san-pham/{p['slug']}/", "cat": CAT_BY[p["category"]]["name"],
            "text": strip_tags(p["name"] + " " + p["summary"] + " " + " ".join(p.get("highlights", []))),
            "featured": bool(p.get("featured")), "upsell": [x for x in (p.get("upsell") or []) if x], "combo": bool(p.get("combo")),
            "kw": [k for k in (p.get("keywords") or []) if k],  # từ khóa tìm kiếm nội bộ (không hiển thị)
            "ing": strip_tags(" ".join((x.get("text") or "") + " " + " ".join(x.get("items") or []) for x in p.get("sections", []) if (x.get("title") or "").lower().startswith(("thành phần", "ingredient"))))[:600],  # thành phần: tìm kiếm ưu tiên thấp
            "needs": [x for x in (p.get("needs") or []) if x], "parts": [x["p"]["slug"] for x in p.get("parts") or []],
            "chips": card_chips(p), "pitch": p.get("pitch") or "",
        }
        if not IS_VI:
            jp.update(name_vi=p["name_vi"], unit_vi=p.get("unit_vi") or "", hide=p["slug"] not in shown)
        js_products.append(jp)
    if IS_VI:  # bản tiếng Việt giữ đúng thứ tự cũ
        js_products = [x for x in js_products if x["slug"] in shown]
    cfg = {"brand": BRAND, "hotline": SITE["hotline"], "zalo": tel(SITE["zalo"]), "email": SITE["email"], "zalo_oa": SITE.get("zalo_oa", "") if IS_VI else "", "zalo_group": SITE.get("zalo_group", ""), "gift": (WEB_OFFER.get("gift_title", "") + (" (trị giá " + WEB_OFFER["gift_value"] + ")" if WEB_OFFER.get("gift_value") else "")) if WEB_OFFER.get("gift_enabled") else "",
           "ga4_id": SITE.get("ga4_id", ""), "clarity_id": SITE.get("clarity_id", ""), "meta_pixel": SITE.get("meta_pixel", ""), "tiktok_pixel": SITE.get("tiktok_pixel", ""),
           "endpoint": (SITE.get("api_endpoint") or SITE.get("order_endpoint", "")), "bank": SITE["bank"] if SITE["bank"].get("enabled") else None,
           "shipping_fee": SITE.get("shipping_fee", 0), "free_ship_threshold": SITE.get("free_ship_threshold", 0),
           "aov_milestone": SITE.get("aov_milestone") or {},
           "music": {"tracks": music_tracks(), "auto": (SITE.get("music") or {}).get("autoplay", True) is not False, "vol": max(5, min(100, num((SITE.get("music") or {}).get("volume")) or 25)) / 100} if music_tracks() else None,
           "needs": [{"slug": n["slug"], "name": n["name"], "icon": n.get("icon") or "", "url": lp(n["url"])} for n in NEEDS]}
    js = "window.TDL_PRODUCTS=" + json.dumps(js_products, ensure_ascii=False) + ";\nwindow.TDL_CONFIG=" + json.dumps(cfg, ensure_ascii=False) + ";\n"
    if not IS_VI:
        cfg.update(lang=LANG, paths={r: lp(r) for r in ("/", "/san-pham/", "/gio-hang/", "/thanh-toan/", "/dat-hang-thanh-cong/", "/tim-kiem/")})
        keys = js_keys()
        i18n_js = {k: I18N[k] for k in sorted(keys) if I18N.get(k)}
        I18N_MISSING.update(k for k in keys if not I18N.get(k))
        js = ("window.TDL_PRODUCTS=" + json.dumps(js_products, ensure_ascii=False) + ";\nwindow.TDL_CONFIG=" + json.dumps(cfg, ensure_ascii=False) +
              ";\nwindow.TDL_I18N=" + json.dumps(i18n_js, ensure_ascii=False) + ";\n")
    (DIST / "assets/js" / DATA_JS).write_text(js, "utf-8")
    if not IS_VI:
        finish_lang(routes)
        return
    (DIST / "assets/data").mkdir(parents=True, exist_ok=True)
    shutil.copy(DATA / "vn-units.json", DIST / "assets/data/vn-units.json")

    # lastmod = ngày nội dung trang đó thật sự đổi (theo git). Trước đây ghi "hôm nay" cho mọi trang → Google bỏ qua tín hiệu này.
    def sm_url(loc, r, lang=None):
        d = route_date(r, lang)
        return f"<url><loc>{DOMAIN}{loc}</loc>" + (f"<lastmod>{d}</lastmod>" if d else "") + "</url>"
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    sm += [sm_url(r, r) for r in routes]
    for lang, pub in alt_public.items():
        sm += [sm_url(ALT_ROUTES[lang][r], r, lang) for r in pub]
    sm.append("</urlset>")
    (DIST / "sitemap.xml").write_text("\n".join(sm), "utf-8")
    private = ["/gio-hang/", "/thanh-toan/", "/dat-hang-thanh-cong/"]
    private += [ALT_ROUTES[lang][r] for lang in ALT_ROUTES for r in private if r in ALT_ROUTES[lang]]
    (DIST / "robots.txt").write_text("User-agent: *\nAllow: /\n" + "".join(f"Disallow: {r}\n" for r in private) + f"Disallow: /admin/\n\nSitemap: {DOMAIN}/sitemap.xml\n", "utf-8")
    (DIST / "llms.txt").write_text(llms_txt(), "utf-8")
    if SITE.get("indexnow_key"):  # file xác minh IndexNow (Bing, Yandex…): workflow deploy.yml báo các trang mới sửa sau mỗi lần đăng
        (DIST / f'{SITE["indexnow_key"]}.txt').write_text(SITE["indexnow_key"], "utf-8")
    (DIST / "CNAME").write_text(DOMAIN.replace("https://", "").replace("http://", "") + "\n", "utf-8")
    (DIST / ".nojekyll").write_text("", "utf-8")
    # 📍 mã QR / link ngắn /q/<mã>/: máy chủ api đếm lượt quét rồi chuyển tới trang đích kèm UTM (link quản lý ở CRM → 📍 Link & QR, api/src/links.js)
    (DIST / "_redirects").write_text("/cam-ket-song-lanh/*  /toi-chon-song-lanh/  301\n/cam-ket-song-lanh  /toi-chon-song-lanh/  301\n/q/*  https://api.thucduonglanh.vn/q/:splat  302\n/admin/qr  https://crm.thucduonglanh.vn/#link-qr  302\n/admin/qr/  https://crm.thucduonglanh.vn/#link-qr  302\n", "utf-8")
    (DIST / "_headers").write_text(
        "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n"
        "/assets/css/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        "/assets/js/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        "/assets/img/*\n  Cache-Control: public, max-age=604800\n"
        "/assets/video/*\n  Cache-Control: public, max-age=604800\n", "utf-8")
    print(f"Đã tạo {len(routes)} trang công khai + 6 trang chức năng vào {DIST}")
    build_crm()
    if IS_VI:
        from build_congsu import build_congsu  # trang tuyển dụng congsu.thucduonglanh.vn → dist-congsu/
        build_congsu()


def route_date(r, lang=None):
    """Ngày sửa gần nhất (git) của file nội dung làm ra trang r (đường dẫn tiếng Việt). Trang tổng hợp: ngày mới nhất của các file con."""
    def files(folder, stem):
        base = [CONTENT / folder / f"{stem}{ext}" for ext in (".json", ".md")]
        return [f for b in base for f in (b, b.with_name(f"{b.stem}.{lang}{b.suffix}") if lang else b) if f.exists()]
    segs = [x for x in r.split("/") if x]
    if not segs:
        return src_date(*[k for k in GIT_DATES if k.startswith(("content/", "data/home", "data/site"))])  # trang chủ: lần sửa nội dung mới nhất
    if segs[0] == "san-pham" and len(segs) == 2:
        return src_date(*(files("products", segs[1]) + files("combos", segs[1])))
    if segs[0] == "goc-song-lanh" and len(segs) == 2:
        return src_date(*files("posts", segs[1]))
    if len(segs) == 1 and (CONTENT / "pages" / f"{segs[0]}.md").exists():
        return src_date(*files("pages", segs[0]))
    if segs[0] in ("san-pham", "danh-muc", "nhu-cau"):
        return src_date(*[k for k in GIT_DATES if k.startswith(("content/products/", "content/combos/", "data/categories", "data/needs"))])
    if segs[0] == "goc-song-lanh":
        return src_date(*[k for k in GIT_DATES if k.startswith(("content/posts/", "data/post-categories"))])
    return None


def llms_txt():
    """/llms.txt: bản tóm tắt dạng chữ cho ChatGPT, Claude, Gemini, Perplexity… (thương hiệu, sản phẩm, giá, chính sách, bài viết).
    Tự sinh từ dữ liệu web nên luôn khớp với trang. Chuẩn đề xuất tại llmstxt.org."""
    def price_of(p):
        ps = [v["price"] for v in p.get("variants", []) if v.get("price") is not None] or ([p["price"]] if p.get("price") is not None else [])
        return ("giá từ " if len(ps) > 1 else "giá ") + money(min(ps)) if ps else "liên hệ báo giá"
    def line(p):
        x = f'- [{p["name"]}]({DOMAIN}/san-pham/{p["slug"]}/): {strip_tags(md_inline(p["summary"])).strip()} ('
        vs = [v for v in p.get("variants", []) if v.get("price") is not None]
        x += "; ".join(f'{v["name"]}: {money(v["price"])}' for v in vs) if len(vs) > 1 else price_of(p)
        x += f', {p["unit"]}' if p.get("unit") and not p.get("combo") and len(vs) <= 1 else ""
        x += f'; nhà sản xuất: {p["manufacturer"]}' if p.get("manufacturer") else ""
        return x + ")"
    th, fee = SITE.get("free_ship_threshold") or 0, SITE.get("shipping_fee") or 0
    out = [f"# {BRAND} (VitaGreen Nutrition)", "",
           f"> {BRAND} là thương hiệu dinh dưỡng từ hạt, trà thảo mộc và thực phẩm thuần chay của Công ty TNHH Tập đoàn VitaGreen Nutrition (MST {SITE.get('tax_code', '')}), "
           f"trụ sở {SITE['address']}. Website chính thức: {DOMAIN.split('//')[-1]}. Bán online, giao hàng toàn quốc.", "",
           f"Khẩu hiệu: {SITE.get('slogan', '')}. Triết lý: Sống xanh – sống lành – sống có giá trị.",
           "Các sản phẩm là thực phẩm hoặc thực phẩm bổ sung, không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh. Công dụng chỉ theo hồ sơ công bố ghi trên từng trang sản phẩm.", "",
           "## Liên hệ & mua hàng", "",
           f"- Hotline / Zalo: {SITE['hotline']} ({SITE.get('opening_hours', '')})", f"- Email: {SITE['email']}",
           f"- Đặt hàng: trên từng trang sản phẩm (Mua ngay / Thêm vào giỏ hàng), thanh toán khi nhận hàng (COD) hoặc chuyển khoản QR.",
           f"- Phí giao hàng {money(fee)}, miễn phí cho đơn từ {money(th)}. Được kiểm tra hàng trước khi thanh toán; đổi trả 7 ngày nếu lỗi do nhà sản xuất." if th and fee else "",
           f"- [Giới thiệu thương hiệu]({DOMAIN}/gioi-thieu/) · [Liên hệ]({DOMAIN}/lien-he/)", "",
           "## Sản phẩm", ""]
    out += [line(p) for p in PRODUCTS if not p.get("combo")]
    combos = [p for p in PRODUCTS if p.get("combo")]
    if combos:
        out += ["", "## Gói giải pháp (combo)", ""] + [line(p) for p in combos]
    out += ["", "## Danh mục", ""] + [f'- [{c["name"]}]({DOMAIN}/danh-muc/{c["slug"]}/): {c.get("desc", "")}' for c in CATS]
    posts = sorted(POSTS["posts"], key=lambda x: x["date"], reverse=True)
    if posts:
        out += ["", "## Bài viết (Góc Sống Lành)", ""] + [f'- [{x["title"]}]({DOMAIN}/goc-song-lanh/{x["slug"]}/): {x["excerpt"]}' for x in posts]
    out += ["", "## Chính sách", ""] + [f'- [{pg["title"]}]({DOMAIN}/{pg["slug"]}/)' for pg in PAGES]
    out += ["", "## English", "", f"- [English version]({DOMAIN}/en/)", ""]
    return "\n".join(x for x in out if x is not None)


def crm_gifts():
    """Quà tặng cho nhân sự gửi khách trong CRM: link đọc thẳng (khách đã có trong CRM, không bắt điền form lại)."""
    out = []
    if CN_PATH:
        r = CN["reader"]
        out.append({"key": "camnang", "title": "Cẩm nang Sống khỏe chủ động", "link": r + ("&" if "?" in r else "?") + "ma=crm", "landing": DOMAIN + CN_PATH,
                    "image": DOMAIN + (CN.get("image") or f"{CN_IMG}/cover-art.webp"), "desc": "32 trang có sách nói: mâm cơm cân bằng, gạo lứt, giữ sức sau tuổi 45, nhật ký 7 ngày. Hợp với mọi khách."})
    eb = SITE.get("ebook") or {}
    if eb.get("flipbook"):
        out.append({"key": "ebook", "title": "Ebook Dinh Dưỡng cho Cơ Xương Khớp", "link": eb["flipbook"], "landing": DOMAIN + eb.get("url", "/ebook/"),
                    "image": DOMAIN + (eb.get("image") or ""), "desc": "Nên ăn gì, tránh gì cho 6 vấn đề cơ xương khớp, 20+ món dễ nấu, video thực đơn 7 ngày. Hợp khách lớn tuổi, đau mỏi, gout."})
    return out


def build_crm():
    """CRM cho nhân sự tại crm.thucduonglanh.vn: trang tĩnh trong crm/, dữ liệu lấy qua Apps Script. Ra thư mục dist-crm/."""
    src, out = ROOT / "crm", ROOT / "dist-crm"
    if not src.exists():
        return
    # Trùng tên hàm trong app.js → hàm sau đè hàm trước, cả tab hỏng (10/10/2026: webSrc làm tab Đơn hàng không mở được)
    names = re.findall(r"^  function ([A-Za-z0-9_$]+)\(", (src / "app.js").read_text("utf-8"), re.M)
    dup = sorted({n for n in names if names.count(n) > 1})
    if dup:
        raise SystemExit("❌ crm/app.js có hàm trùng tên: " + ", ".join(dup) + " – đổi tên hàm mới rồi build lại.")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir()
    import hashlib
    # Nén CSS
    css_raw = (src / "app.css").read_text("utf-8")
    css_min = re.sub(r'/\*[\s\S]*?\*/', '', css_raw)
    css_min = re.sub(r'\s+', ' ', css_min)
    css_min = re.sub(r'\s*([\{\};,>~])\s*', r'\1', css_min)  # không gộp quanh + và : – calc(a + b) bắt buộc có dấu cách, bỏ đi là trình duyệt bỏ cả dòng (lề trang CRM = 0)
    css_min = re.sub(r';}', '}', css_min).strip()
    (out / "app.css").write_text(css_min, "utf-8")

    # Nén JS
    js_raw = (src / "app.js").read_text("utf-8")
    try:
        import rjsmin
        js_min = rjsmin.jsmin(js_raw)
    except Exception:
        js_min = js_raw
    (out / "app.js").write_text(js_min, "utf-8")
    if (src / "qrcode.js").exists():  # thư viện vẽ mã QR (qrcode-generator, MIT) cho tab 📍 Link & QR, chỉ tải khi mở tab
        q = (src / "qrcode.js").read_text("utf-8")
        try:
            import rjsmin
            q = rjsmin.jsmin(q, keep_bang_comments=True)
        except Exception:
            pass
        (out / "qrcode.js").write_text("/* qrcode-generator 1.4.4 · (c) Kazuhiko Arase · MIT */\n" + q, "utf-8")

    ver = hashlib.md5((js_min + css_min).encode("utf-8")).hexdigest()[:8]
    (out / "index.html").write_text((src / "index.html").read_text("utf-8").replace("__V__", ver), "utf-8")
    brand = ROOT / "assets/img/brand"
    for f in ("logo.webp", "icon-32.png", "icon-180.png", "icon-512.png"):
        shutil.copy(brand / f, out / f)
    shutil.copy(DATA / "vn-units.json", out / "vn-units.json")
    shutil.copy(DATA / "vn-units-old.json", out / "vn-units-old.json")  # địa chỉ cũ 63 tỉnh + xã mới tương ứng (scripts/vn-units-old.py)
    products = [{"name": p["name"], "slug": p["slug"], "price": p.get("base_price"), "unit": p.get("unit", ""),
                 "variants": [{"name": v["name"], "price": v["price"]} for v in p.get("base_variants", [])]} for p in PRODUCTS]
    cfg = {"endpoint": (SITE.get("api_endpoint") or SITE.get("order_endpoint", "")), "shipping_fee": SITE.get("shipping_fee", 0),
           "free_ship_threshold": SITE.get("free_ship_threshold", 0), "products": products,
           "zalo_group": SITE.get("zalo_group", ""), "gifts": crm_gifts(),
           "web_gift": (WEB_OFFER.get("gift_title", "") + (" (trị giá " + WEB_OFFER["gift_value"] + ")" if WEB_OFFER.get("gift_value") else "")) if WEB_OFFER.get("gift_enabled") else ""}
    (out / "crm-data.js").write_text("window.CRM_CONFIG=" + json.dumps(cfg, ensure_ascii=False) + ";\n", "utf-8")
    (out / "manifest.webmanifest").write_text(json.dumps({
        "name": "CRM Thực Dưỡng Lành", "short_name": "CRM TDL", "start_url": "/", "display": "standalone",
        "background_color": "#f5f4ef", "theme_color": "#24805B",
        "icons": [{"src": "/icon-180.png", "sizes": "180x180", "type": "image/png"}, {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"}]}, ensure_ascii=False), "utf-8")
    # mkt.thucduonglanh.vn dùng chung CRM; app.js đổi sang manifest này để lưu ra màn hình mang tên Marketing
    (out / "manifest-mkt.webmanifest").write_text(json.dumps({
        "name": "Marketing Thực Dưỡng Lành", "short_name": "Marketing TDL", "start_url": "/", "display": "standalone",
        "background_color": "#f5f4ef", "theme_color": "#24805B",
        "icons": [{"src": "/icon-180.png", "sizes": "180x180", "type": "image/png"}, {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"}]}, ensure_ascii=False), "utf-8")
    (out / "robots.txt").write_text("User-agent: *\nDisallow: /\n", "utf-8")
    (out / "_headers").write_text(
        "/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n"
        "  Content-Security-Policy: default-src 'self'; connect-src 'self' https://api.thucduonglanh.vn https://script.google.com https://script.googleusercontent.com; img-src 'self' data: https://thucduonglanh.vn; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\n"
        "/\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n/crm-data.js\n  Cache-Control: no-cache\n"
        "/qrcode.js\n  Cache-Control: public, max-age=86400\n"
        "/app.js\n  Cache-Control: public, max-age=31536000, immutable\n/app.css\n  Cache-Control: public, max-age=31536000, immutable\n", "utf-8")
    build_guide(out / "huong-dan")
    print(f"Đã tạo CRM vào {out}")


def _slug_vi(value, separator="-"):
    """Tiêu đề tiếng Việt -> id không dấu, dùng làm neo #... trong trang hướng dẫn."""
    import unicodedata
    s = unicodedata.normalize("NFD", value.replace("Đ", "D").replace("đ", "d"))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", separator, s).strip(separator)


def build_guide(out):
    """Hướng dẫn nội bộ cho nhân sự: guide/*.md (sửa được ở trang quản trị) -> crm.thucduonglanh.vn/huong-dan/."""
    src = ROOT / "guide"
    if not src.exists():
        return
    from PIL import Image
    out.mkdir(parents=True)
    if (src / "img").exists():
        shutil.copytree(src / "img", out / "img")
    shutil.copy(src / "guide.css", out / "guide.css")
    ver = hashlib.md5((src / "guide.css").read_bytes()).hexdigest()[:8]
    pages = []
    for f in src.glob("*.md"):
        meta, body = read_front(f)
        slug = "" if f.stem == "index" else f.stem
        pages.append({"slug": slug, "meta": meta, "body": body, "order": meta.get("order", 50)})
    pages.sort(key=lambda p: p["order"])

    def figure(m):
        alt, url = html.unescape(m.group(1)), m.group(2)
        size = ""
        p = src / "img" / url.rsplit("/", 1)[-1]
        if url.startswith("/huong-dan/img/") and p.exists():
            with Image.open(p) as im:
                size = f' width="{im.width}" height="{im.height}"'
        return (f'<figure><img src="{html.escape(url)}" alt="{html.escape(alt)}"{size} loading="lazy">'
                f'<figcaption>{html.escape(alt)}</figcaption></figure>')

    for pg in pages:
        conv = _md.Markdown(extensions=["extra", "sane_lists", "toc"], extension_configs={"toc": {"slugify": _slug_vi, "toc_depth": "2"}})
        # trang quản trị có thể lưu danh sách con thụt 2–3 dấu cách; Markdown cần 4
        body = conv.convert(re.sub(r"^ {2,3}(?=(?:[-*+]|\d+\.) )", "    ", pg["body"], flags=re.M))
        body = re.sub(r'<p><img alt="([^"]*)" src="([^"]+)"\s*/?></p>', figure, body)
        body = body.replace("<table>", '<div class="tbl"><table>').replace("</table>", "</table></div>")
        body = re.sub(r'<a href="(https?://[^"]+)"', r'<a href="\1" target="_blank" rel="noopener"', body)
        toc = "".join(f'<li><a href="#{t["id"]}">{t["name"]}</a></li>' for t in conv.toc_tokens)
        meta, here = pg["meta"], pg["slug"]
        tabs = "".join(
            f'<a href="/huong-dan/{p["slug"] + "/" if p["slug"] else ""}"{" class=on aria-current=page" if p["slug"] == here else ""}>'
            f'{html.escape(p["meta"].get("nav", p["meta"].get("title", "")))}</a>' for p in pages if not p["meta"].get("hidden") or p["slug"] == here)  # trang ẩn (hidden: true): chỉ ai có link mới thấy
        upd = meta.get("updated")
        upd = upd.strftime("%d/%m/%Y") if hasattr(upd, "strftime") else (str(upd) if upd else "")
        title = html.escape(meta.get("title", "Hướng dẫn"))
        page = f"""<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#24805B">
<title>{title} – Thực Dưỡng Lành</title>
<link rel="icon" href="/icon-32.png" sizes="32x32">
<link rel="stylesheet" href="/huong-dan/guide.css?v={ver}">
</head>
<body>
<header class="g-top"><div class="g-in">
<a class="g-brand" href="/huong-dan/"><img src="/icon-180.png" alt="" width="32" height="32">Hướng dẫn nội bộ</a>
<a class="g-crm" href="/">Mở CRM →</a>
</div>
<nav class="g-tabs g-in" aria-label="Các phần hướng dẫn">{tabs}</nav>
</header>
<div class="g-wrap g-in">
<aside class="g-toc"><details open><summary>Trong trang này</summary><ol>{toc}</ol></details></aside>
<main>
<h1>{title}</h1>
{f'<p class="g-lead">{html.escape(meta["description"])}</p>' if meta.get("description") else ""}
{body}
<footer class="g-foot">{f"Cập nhật {upd} · " if upd else ""}Tài liệu nội bộ Thực Dưỡng Lành, không chia sẻ ra ngoài.</footer>
</main>
</div>
</body>
</html>
"""
        d = out / here if here else out
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page, "utf-8")


if __name__ == "__main__":
    main()
