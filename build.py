#!/usr/bin/env python3
"""Sinh website tĩnh Thực Dưỡng Lành vào thư mục dist/.

Cách dùng:  python3 build.py
Dữ liệu nằm trong data/*.json, giao diện trong assets/.
"""
import json, os, shutil, html, re, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
DATA = ROOT / "data"

import hashlib
import markdown as _md
import yaml

CONTENT = ROOT / "content"


def md(text):
    """Markdown -> HTML (dùng cho nội dung soạn trong trang quản trị)."""
    out = _md.markdown(text or "", extensions=["extra", "sane_lists"])
    return out.replace("<img ", '<img loading="lazy" ')


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


SITE = {**json.loads((DATA / "config.json").read_text("utf-8")), **json.loads((DATA / "site.json").read_text("utf-8"))}
HOME = json.loads((DATA / "home.json").read_text("utf-8"))
CATS = json.loads((DATA / "categories.json").read_text("utf-8"))["categories"]

PRODUCTS = []
for f in sorted((CONTENT / "products").glob("*.json")):
    p = json.loads(f.read_text("utf-8"))
    if p.get("published") is False:
        continue
    p["slug"] = f.stem
    p["price"], p["regular_price"] = num(p.get("price")), num(p.get("regular_price"))
    p["variants"] = [{**v, "price": num(v.get("price")), "regular_price": num(v.get("regular_price"))} for v in (p.get("variants") or []) if v.get("name")]
    if p["variants"] and p["price"] is None:
        p["price"], p["regular_price"] = p["variants"][0]["price"], p["variants"][0]["regular_price"]
    p["images"] = [i for i in (p.get("images") or []) if i] or ["/assets/img/brand/og-image.jpg"]
    p["summary_md"] = p.get("summary") or ""
    p["summary"] = md_inline(p["summary_md"])
    p["highlights"] = [h for h in (p.get("highlights") or []) if h]
    PRODUCTS.append(p)
PRODUCTS.sort(key=lambda p: (p.get("order") or 999, p["name"]))
CATS = [c for c in CATS if c.get("slug")]
_cat_slugs = {c["slug"] for c in CATS}
for p in PRODUCTS:
    if p.get("category") not in _cat_slugs:
        p["category"] = CATS[0]["slug"]

_posts = []
for f in sorted((CONTENT / "posts").glob("*.md")):
    meta, body = read_front(f)
    if meta.get("published") is False:
        continue
    d = meta.get("date") or datetime.date.today()
    d = d.date() if isinstance(d, datetime.datetime) else d
    d = d.isoformat() if isinstance(d, datetime.date) else str(d)[:10]
    _posts.append({"slug": f.stem, "title": meta.get("title", f.stem), "date": d, "category": meta.get("category", ""),
                   "image": meta.get("image") or "/assets/img/brand/og-image.jpg", "excerpt": meta.get("excerpt", ""), "content": md(body)})
POSTS = {"categories": json.loads((DATA / "post-categories.json").read_text("utf-8"))["categories"], "posts": _posts}

PAGES = []
for f in (CONTENT / "pages").glob("*.md"):
    meta, body = read_front(f)
    PAGES.append({"slug": f.stem, "title": meta.get("title", f.stem), "order": meta.get("order", 99), "content": md(body)})
PAGES.sort(key=lambda x: (x["order"], x["title"]))

CAT_BY = {c["slug"]: c for c in CATS}
PROD_BY = {p["slug"]: p for p in PRODUCTS}
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
        return "Liên hệ"
    return f"{int(n):,}".replace(",", ".") + " ₫"


def pimg(src, small=False):
    return img_url(src, 480 if small else 1000)


def tel(s):
    return re.sub(r"\D", "", s or "")


def fill(s):
    return (s.replace("{brand}", BRAND).replace("{company}", SITE["company"])
             .replace("{hotline}", SITE["hotline"]).replace("{email}", SITE["email"])
             .replace("{address}", SITE["address"]).replace("{domain}", DOMAIN))


def discount(p):
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
HAS_SALE = any(discount(p) for p in PRODUCTS)
SALE_NAV = [("Khuyến Mãi", "/khuyen-mai/", [])] if HAS_SALE else []
NAV = [
    ("Trang Chủ", "/", []),
    ("Giới Thiệu", "/gioi-thieu/", []),
    ("Sản Phẩm", "/san-pham/", [(c["name"], f"/danh-muc/{c['slug']}/", []) for c in CATS] + SALE_NAV),
    ("Góc Sống Lành", "/goc-song-lanh/", [(c["name"], f"/goc-song-lanh/chuyen-muc/{c['slug']}/", []) for c in POSTS["categories"]]),
    ("Liên Hệ", "/lien-he/", []),
]


def nav_html(active, cls):
    out = [f'<ul class="{cls}">']
    for label, href, children in NAV:
        is_active = (active == href) or (href != "/" and active.startswith(href)) or (
            href == "/san-pham/" and (active.startswith("/danh-muc/") or active.startswith("/khuyen-mai/")))
        a_cls = ' class="active"' if is_active else ""
        if children:
            out.append(f'<li class="has-sub"><a href="{href}"{a_cls}>{label}{ic("down","caret")}</a>'
                       f'<button class="sub-toggle" aria-label="Mở menu con">{I["down"]}</button><ul class="sub">')
            for cl, ch, _ in children:
                out.append(f'<li><a href="{ch}">{esc(cl)}</a></li>')
            out.append("</ul></li>")
        else:
            out.append(f'<li><a href="{href}"{a_cls}>{label}</a></li>')
    out.append("</ul>")
    return "".join(out)


def header(active):
    hot2 = f' - <a href="tel:{tel(SITE["hotline2"])}">{esc(SITE["hotline2"])}</a>' if SITE.get("hotline2") else ""
    return f'''
<div class="topbar"><div class="container topbar-in">
  <div class="tb-left">Hotline {BRAND}: {ic("phone","ic ic-sm")} <a href="tel:{tel(SITE["hotline"])}">{esc(SITE["hotline"])}</a>{hot2}</div>
  <div class="tb-right"><a href="{esc(SITE.get("community_group") or "/goc-song-lanh/")}"{' target="_blank" rel="noopener"' if SITE.get("community_group") else ""}>Cộng Đồng Sống Khỏe {ic("globe","ic ic-sm")}</a></div>
</div></div>
<header class="site-header" id="siteHeader"><div class="container header-in">
  <button class="icon-btn burger" id="burger" aria-label="Mở menu">{I["menu"]}</button>
  <a class="logo" href="/" aria-label="{BRAND} – Trang chủ"><img src="/assets/img/brand/logo.webp" srcset="/assets/img/brand/logo.webp 1x, /assets/img/brand/logo@2x.webp 2x" width="{LOGO_W}" height="180" alt="Logo {BRAND}"></a>
  <nav class="main-nav" aria-label="Menu chính">{nav_html(active, "menu")}</nav>
  <div class="header-icons">
    <button class="icon-btn" id="searchOpen" aria-label="Tìm kiếm">{I["search"]}</button>
    <a class="icon-btn" href="/gio-hang/" id="cartOpen" aria-label="Giỏ hàng">{I["cart"]}<span class="count" data-cart-count>0</span></a>
    <a class="icon-btn hide-sm" href="/yeu-thich/" aria-label="Sản phẩm yêu thích">{I["heart"]}<span class="count" data-wish-count>0</span></a>
  </div>
</div></header>
<div class="offcanvas" id="offcanvas" aria-hidden="true"><div class="oc-panel">
  <div class="oc-head"><img src="/assets/img/brand/logo.webp" alt="{BRAND}" height="56"><button class="icon-btn" data-oc-close aria-label="Đóng">{I["close"]}</button></div>
  {nav_html(active, "oc-menu")}
  <div class="oc-foot"><a href="/yeu-thich/">{ic("heart")} Sản phẩm yêu thích</a><a href="tel:{tel(SITE["hotline"])}">{ic("phone")} {esc(SITE["hotline"])}</a></div>
</div></div>
<div class="search-layer" id="searchLayer" aria-hidden="true"><div class="search-box">
  <form action="/tim-kiem/" method="get" role="search"><span class="s-ic">{I["search"]}</span><input type="search" name="q" id="searchInput" placeholder="Tìm sản phẩm..." autocomplete="off" aria-label="Tìm sản phẩm"><button type="button" class="icon-btn" data-search-close aria-label="Đóng">{I["close"]}</button></form>
  <div class="search-results" id="searchResults"></div>
</div></div>'''


def social_links(cls="socials"):
    items = []
    names = {"shopee": "Shopee", "lazada": "Lazada", "tiktok_shop": "TikTok Shop", "facebook": "Facebook", "tiktok": "TikTok", "youtube": "YouTube"}
    icons = {"tiktok_shop": "tiktok"}
    for k, url in SITE["socials"].items():
        if url:
            items.append(f'<a class="s-{k}" href="{esc(url)}" target="_blank" rel="noopener" aria-label="{names.get(k,k)}" title="{names.get(k,k)}">{I[icons.get(k,k)]}</a>')
    items.append(f'<a class="s-zalo" href="{esc(SITE.get("zalo_oa") or zalo_link())}" target="_blank" rel="noopener" aria-label="Zalo OA" title="Zalo OA">{I["zalo"]}</a>')
    return f'<div class="{cls}">' + "".join(items) + "</div>"


def footer():
    support = "".join(f'<li><a href="/{p["slug"]}/">{esc(p["title"])}</a></li>' for p in PAGES)
    about = "".join(f'<li><a href="{h}">{l}</a></li>' for l, h, _ in NAV)
    bct = f'<a href="{esc(SITE["bo_cong_thuong_url"])}" target="_blank" rel="noopener" class="bct"><img src="/assets/img/brand/bo-cong-thuong.png" alt="Đã thông báo Bộ Công Thương" width="150" loading="lazy"></a>' if SITE.get("bo_cong_thuong_url") else ""
    year = datetime.date.today().year
    return f'''
<footer class="site-footer">
  <div class="container footer-grid">
    <div class="f-col f-brand">
      <a href="/" class="f-logo"><img src="/assets/img/brand/logo-slogan.webp" alt="{BRAND}" width="220" loading="lazy"></a>
      <p class="f-company">{esc(SITE["company"])}</p>
      <p>Giấy chứng nhận đăng ký doanh nghiệp số {esc(SITE["tax_code"])} đăng ký lần đầu ngày {esc(SITE["tax_date"])}</p>
      {bct}
    </div>
    <div class="f-col"><h4>Về chúng tôi</h4><ul>{about}</ul></div>
    <div class="f-col f-contact"><h4>Văn phòng</h4>
      <p><b>Địa chỉ {BRAND}:</b><br>{esc(SITE["address"])}</p>
      <p><b>Email:</b><br><a href="mailto:{esc(SITE["email"])}">{esc(SITE["email"])}</a></p>
      <p><b>Số điện thoại:</b><br><a href="tel:{tel(SITE["hotline"])}">{esc(SITE["hotline"])}</a></p>
      <p><b>Giờ làm việc:</b><br>{esc(SITE["opening_hours"])}</p>
    </div>
    <div class="f-col"><h4>Hỗ trợ</h4><ul>{support}</ul></div>
  </div>
  <div class="container f-social"><h4>Kết nối với chúng tôi</h4>{social_links()}</div>
  <div class="f-bottom"><div class="container">© Copyright {year} {BRAND} | Đã đăng ký bản quyền</div></div>
</footer>
{float_widget()}
<div class="minicart" id="minicart" aria-hidden="true"><div class="mc-panel">
  <div class="mc-head"><h3>Giỏ hàng</h3><button class="icon-btn" data-mc-close aria-label="Đóng">{I["close"]}</button></div>
  <div class="mc-body" id="mcBody"></div>
  <div class="mc-foot"><div class="mc-total"><span>Tạm tính</span><b id="mcTotal">0 ₫</b></div>
  <a href="/gio-hang/" class="btn btn-outline btn-block">Xem giỏ hàng</a><a href="/thanh-toan/" class="btn btn-block">Thanh toán</a></div>
</div></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<button class="to-top" id="toTop" aria-label="Lên đầu trang">{I["up"]}</button>'''


def float_widget():
    chips = "".join(f'<a class="fw-chip" href="/san-pham/{p["slug"]}/">{esc(p.get("short_name") or p["name"])}</a>' for p in PRODUCTS if p.get("featured"))
    return f'''
<div class="float-widget" id="floatWidget">
  <div class="fw-pop" id="fwPop">
    <button class="fw-x" id="fwClose" aria-label="Ẩn">{I["close"]}</button>
    <div class="fw-msg"><div class="fw-name"><img src="/assets/img/brand/emblem.png" alt="" width="22" height="22">{BRAND}</div>
    <p>Anh/chị đang tìm hiểu sản phẩm nào ạ? Em sẵn sàng tư vấn ngay cho anh/chị nhé!</p></div>
    <div class="fw-chips">{chips}<a class="fw-chip" href="{zalo_link()}" target="_blank" rel="noopener">Liên hệ tư vấn</a></div>
  </div>
  <a class="fw-btn fw-phone" href="tel:{tel(SITE["hotline"])}" aria-label="Gọi {esc(SITE["hotline"])}">{I["phone"]}</a>
  <a class="fw-btn fw-zalo" href="{zalo_link()}" target="_blank" rel="noopener" aria-label="Chat Zalo">{I["zalo"]}</a>
  <button class="fw-btn fw-main" id="fwToggle" aria-label="Mở hộp tư vấn"><img src="/assets/img/brand/icon-180.png" alt="" width="56" height="56"></button>
</div>'''


def layout(path, title, desc, body, og=None, jsonld=None, body_class="", noindex=False):
    full_title = title if BRAND in title else f"{title} | {BRAND}"
    url = DOMAIN + path
    og_img = DOMAIN + (og or "/assets/img/brand/og-image.jpg")
    ld = ""
    for block in (jsonld or []):
        ld += '<script type="application/ld+json">' + json.dumps(block, ensure_ascii=False) + "</script>"
    robots = '<meta name="robots" content="noindex,follow">' if noindex else ""
    return f'''<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(full_title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{url}">{robots}
<meta property="og:type" content="website"><meta property="og:site_name" content="{BRAND}">
<meta property="og:title" content="{esc(full_title)}"><meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{url}"><meta property="og:image" content="{og_img}"><meta property="og:locale" content="vi_VN">
<meta name="theme-color" content="#1f5f3a">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/img/brand/icon-32.png">
<link rel="apple-touch-icon" href="/assets/img/brand/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,600;1,500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/style.css?v={VERSION}">
{ld}
</head>
<body class="{body_class}">
<a class="skip" href="#main">Bỏ qua đến nội dung</a>
{header(path)}
<main id="main">
{body}
</main>
{footer()}
<script src="/assets/js/data.js?v={VERSION}"></script>
<script src="/assets/js/main.js?v={VERSION}" defer></script>
</body>
</html>'''


# ---------------------------------------------------------------- components
def price_html(p, cls="price", from_=False):
    vs = [v["price"] for v in p.get("variants", []) if v.get("price") is not None]
    if from_ and len(vs) > 1:
        return f'<div class="{cls}"><span class="from">Từ</span><ins>{money(min(vs))}</ins></div>'
    if p.get("price") is None:
        return f'<div class="{cls}"><ins class="contact">Liên hệ</ins></div>'
    old = f'<del>{money(p["regular_price"])}</del>' if discount(p) else ""
    return f'<div class="{cls}">{old}<ins>{money(p["price"])}</ins></div>'


def product_card(p, lazy=True):
    d = discount(p)
    badge = f'<span class="badge-sale">-{d}%</span>' if d else (f'<span class="badge-tag">{esc(p["badge"])}</span>' if p.get("badge") else "")
    loading = ' loading="lazy"' if lazy else ""
    img2 = p["images"][1] if len(p["images"]) > 1 else p["images"][0]
    if p.get("price") is not None and not p.get("variants"):
        action = f'<button class="pc-add" data-add="{p["slug"]}" aria-label="Thêm {esc(p["name"])} vào giỏ">{I["cart"]}<span>Thêm vào giỏ</span></button>'
    else:
        label = "Chọn loại" if p.get("variants") and p.get("price") is not None else "Xem chi tiết"
        action = f'<a class="pc-add" href="/san-pham/{p["slug"]}/">{I["right"]}<span>{label}</span></a>'
    return f'''<article class="p-card">
  <a class="pc-media" href="/san-pham/{p["slug"]}/" aria-label="{esc(p["name"])}">
    {badge}
    <img class="pc-img" src="{pimg(p["images"][0], True)}" alt="{esc(p["name"])}" width="480" height="480"{loading}>
    <img class="pc-img2" src="{pimg(img2, True)}" alt="" width="480" height="480" loading="lazy">
  </a>
  <button class="pc-wish" data-wish="{p["slug"]}" aria-label="Yêu thích">{I["heart"]}</button>
  <div class="pc-body">
    <h3 class="pc-title"><a href="/san-pham/{p["slug"]}/">{esc(p["name"])}</a></h3>
    {price_html(p, "price pc-price", from_=True)}
  </div>
  {action}
</article>'''


def grid(products, cls="p-grid"):
    if not products:
        return '<p class="empty">Chưa có sản phẩm trong mục này.</p>'
    return f'<div class="{cls}">' + "".join(product_card(p) for p in products) + "</div>"


def breadcrumb(items):
    parts = ['<a href="/">Trang chủ</a>']
    ld = [{"@type": "ListItem", "position": 1, "name": "Trang chủ", "item": DOMAIN + "/"}]
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


def benefits_banner():
    items = [("truck", "Giao hàng", "toàn quốc"), ("return", "Đổi trả", "dễ dàng"), ("chat", "Tư vấn", "tận tâm"), ("wallet", "Thanh toán", "tiện lợi")]
    feats = "".join(f'<div class="bb-feat">{ic(i,"bb-ic")}<span>{a}<br><b>{b}</b></span></div>' for i, a, b in items)
    pills = "".join(f'<div class="bb-pill">{ic(i,"bb-pic")}<span>{a}<b>{b}</b></span></div>' for i, a, b in [
        ("leaf", "Sản phẩm", "thuần tự nhiên"), ("shield", "Nguồn gốc", "rõ ràng"), ("check", "Kiểm nghiệm", "đầy đủ")])
    return f'''<a class="benefit-banner" href="/san-pham/">
  <div class="bb-left">
    <img src="/assets/img/brand/logo.webp" alt="" class="bb-logo" width="{LOGO_W}" height="180" loading="lazy">
    <div class="bb-title"><span>Sống lành</span><span>để sống đáng</span></div>
    <p class="bb-sub">Hệ sinh thái sản phẩm thực dưỡng chất lượng – lành mạnh – bền vững cho gia đình Việt</p>
    <div class="bb-pills">{pills}</div>
  </div>
  <div class="bb-mid">{"".join(f'<img src="{pimg(p["images"][0], True)}" alt="" loading="lazy">' for p in (PRODUCTS[2:3] + PRODUCTS[1:2] + PRODUCTS[3:4] or PRODUCTS[:3]))}</div>
  <div class="bb-right">{feats}</div>
</a>'''


# ---------------------------------------------------------------- pages
def page_home():
    slides = []
    for sd in HOME.get("slides", []):
        title = md_inline(esc(sd.get("title", "")).replace("&#x27;", "'"))
        slides.append((sd.get("product") or "", sd.get("eyebrow", ""), title, sd.get("subtitle", ""), img_url(sd.get("image"), 1024)))
    sl = []
    for i, (slug, eb, h, sub, img) in enumerate(slides):
        tag = "h2"
        lazy = "" if i == 0 else ' loading="lazy"'
        sl.append(f'''<div class="slide{' is-active' if i == 0 else ''}" data-slide="{i}">
  <div class="container slide-in">
    <div class="slide-text"><span class="eyebrow">{eb}</span><{tag} class="slide-title">{h}</{tag}><p>{sub}</p>
      <div class="slide-cta"><a class="btn btn-lg" href="{("/san-pham/" + slug + "/") if slug in PROD_BY else "/san-pham/"}">Mua ngay</a><a class="btn btn-lg btn-ghost" href="/san-pham/">Xem tất cả</a></div></div>
    <div class="slide-media"><img src="{img}" alt="{esc(strip_tags(h))}" width="1024" height="1024"{lazy}></div>
  </div></div>''')
    dots = "".join(f'<button class="dot{" is-active" if i == 0 else ""}" data-go="{i}" aria-label="Slide {i+1}"></button>' for i in range(len(slides)))
    hero = f'''<section class="hero" id="hero" aria-roledescription="carousel">
  <div class="hero-deco" aria-hidden="true"></div>
  {''.join(sl)}
  <button class="hero-nav prev" data-prev aria-label="Slide trước">{I["left"]}</button><button class="hero-nav next" data-next aria-label="Slide sau">{I["right"]}</button>
  <div class="hero-dots">{dots}</div>
</section>'''

    cats = [("Toàn bộ sản phẩm", "/san-pham/", None)] + ([("Khuyến Mãi", "/khuyen-mai/", "sale")] if HAS_SALE else []) + [(c["name"], f"/danh-muc/{c['slug']}/", c["image"]) for c in CATS]
    cat_html = ""
    for name, href, image in cats:
        if image is None:
            media = '<div class="cat-stack">' + "".join(f'<img src="{pimg(p["images"][0], True)}" alt="" loading="lazy">' for p in PRODUCTS[:3]) + "</div>"
        elif image == "sale":
            media = f'<div class="cat-sale"><span>%</span></div>'
        else:
            media = f'<img src="{pimg(image, True)}" alt="" loading="lazy">'
        cat_html += f'<a class="cat-card" href="{href}"><div class="cat-media">{media}</div><span>{esc(name)}</span></a>'

    featured = [p for p in PRODUCTS if p.get("featured")][:8]

    posts = sorted(POSTS["posts"], key=lambda x: x["date"], reverse=True)[:3]
    post_cards = "".join(post_card(p) for p in posts)

    videos = [("feedback-le-sy-phuc", "Anh Lê Sỹ Phúc", "GĐ Chi nhánh VPBank Kim Mã, Hà Nội"),
              ("feedback-vu-tan", "Anh Vũ Tân", "Giám đốc văn phòng bảo hiểm – Khâm Thiên, Hà Nội"),
              ("feedback-khach-hang-3", "Khách hàng tin dùng", "Chia sẻ trải nghiệm sản phẩm")]
    vid = "".join(f'''<figure class="v-card"><div class="v-frame" data-video="/assets/video/{v}.mp4"><img src="/assets/img/brand/{v}.webp" alt="Video cảm nhận của {esc(n)}" loading="lazy" width="480" height="854"><button class="v-play" aria-label="Phát video">{I["play"]}</button></div><figcaption><b>{esc(n)}</b><span>{esc(r)}</span></figcaption></figure>''' for v, n, r in videos)
    fb = "".join(f'<a class="fb-item" href="/assets/img/brand/feedback-{i}.webp" data-lightbox="fb"><img src="/assets/img/brand/feedback-{i}.webp" alt="Phản hồi khách hàng {i}" loading="lazy" width="900" height="900"></a>' for i in range(1, 6))

    tags = ["Dinh dưỡng từ hạt", "Sữa hạt Curcumin", "Fucoidan", "Bữa ăn dinh dưỡng", "Trà chè vằng", "Đinh lăng", "Trà thảo mộc hòa tan", "Ruốc chay", "Rong biển", "Xì dầu lên men", "Ngưu bàng", "Thực dưỡng", "Thuần chay", "Đạm thực vật", "Không đường tinh luyện"]
    tag_html = "".join(f'<a href="/tim-kiem/?q={esc(t)}">{esc(t)}</a>' for t in tags)

    body = f'''{hero}
<section class="section section-tight"><div class="container">{benefits_banner()}</div></section>

<section class="section"><div class="container">
  <h2 class="sec-title">Danh mục sản phẩm</h2>
  <div class="cat-grid">{cat_html}</div>
</div></section>

<section class="section pt-0"><div class="container">
  <h2 class="sec-title">Sản phẩm được yêu thích nhất</h2>
  {grid(featured, "p-grid p-grid-feature")}
  <p class="sec-note">Các dòng sản phẩm được nhiều khách hàng của {BRAND} tin dùng.</p>
</div></section>

<section class="section bg-soft center-intro"><div class="container narrow">
  <h2 class="brand-title">{BRAND}</h2>
  <h3 class="brand-sub">{esc(SITE["slogan"])}</h3>
  <p>Ra đời từ câu hỏi chưa kịp có lời đáp: <i>“Giá như mình chăm sóc tốt hơn…”</i>, {BRAND} – thương hiệu của Công ty VitaGreen Nutrition – được xây dựng trên triết lý <b>Sống xanh – sống lành – sống có giá trị</b>. Chúng tôi mang đến những sản phẩm dinh dưỡng từ hạt, thảo mộc và thực vật Việt Nam với nguồn gốc rõ ràng, giúp người Việt sống khỏe từ <b>THÂN</b> đến <b>TÂM</b>.</p>
</div></section>

<section class="section"><div class="container story">
  <div class="story-text">
    <h2 class="story-title">Câu chuyện {BRAND}<br>Hành trình <span class="hl">10 triệu</span> người Việt sống lành</h2>
    <p>Sau khi một người thân ra đi đột ngột, không kịp lời tạm biệt, cùng lúc hàng loạt vụ thực phẩm kém chất lượng vỡ lở, những người sáng lập nhận ra: <i>“Ai rồi cũng sẽ đến lúc rời khỏi cuộc đời này. Và nếu ngày mai là ngày cuối, mình đã sống xứng đáng và trọn vẹn chưa?”</i></p>
    <p>{BRAND} ra đời không chỉ để bán sản phẩm – mà là lời xin lỗi muộn với những người ta không kịp chăm sóc, lời hứa sớm với những người ta vẫn còn được đồng hành, và lời cam kết với chính mình: <b>“Tôi chọn sống lành – để sống đáng.”</b></p>
    <a class="btn btn-lg" href="/gioi-thieu/">Xem thêm</a>
  </div>
  <div class="story-media"><img src="/assets/img/brand/story-tea.webp" alt="Tách trà thảo mộc Thực Dưỡng Lành" loading="lazy" width="1200" height="1200"></div>
</div></section>

<section class="parallax" style="background-image:url('/assets/img/brand/parallax-tea.webp')"><div class="container"><h2>Dưỡng Thân – Tâm An<br>Bền Sức Khoẻ</h2></div></section>

<section class="section"><div class="container">
  <h2 class="sec-title big">Khách hàng nói gì<br><span class="accent">về {BRAND}</span></h2>
  <div class="v-grid">{vid}</div>
  <div class="fb-strip">{fb}</div>
</div></section>

{community_html()}
<section class="section bg-soft"><div class="container">
  <h2 class="sec-title big">Góc Sống Lành<br><span class="accent">{BRAND}</span></h2>
  <div class="post-grid">{post_cards}</div>
  <div class="center mt-2"><a class="btn btn-outline" href="/goc-song-lanh/">Xem tất cả bài viết</a></div>
</div></section>

<section class="section seo-block"><div class="container">
  <h1>{BRAND} – Dinh Dưỡng Thuần Tự Nhiên</h1>
  <div class="readmore" data-readmore>
    <p><b>Thucduonglanh.vn</b> là website chính thức của thương hiệu {BRAND} thuộc {esc(SITE["company"].title())}, nơi cung cấp các sản phẩm dinh dưỡng từ hạt, trà thảo mộc và thực phẩm thuần chay có nguồn gốc rõ ràng, hồ sơ công bố đầy đủ.</p>
    <h3>SẢN PHẨM CHÍNH HÃNG, NGUỒN GỐC MINH BẠCH</h3>
    <p>Mỗi sản phẩm tại {BRAND} đều được sản xuất tại nhà máy đạt chuẩn (GMP, ISO 22000, HACCP tùy dòng sản phẩm), có kiểm nghiệm chất lượng và thông tin thành phần công khai: từ <a href="/san-pham/bua-an-dinh-duong-vitagreen/">Bữa Ăn Dinh Dưỡng VitaGreen</a>, <a href="/san-pham/dinh-duong-tu-hat-va-curcumin/">Dinh Dưỡng Từ Hạt Và Curcumin</a>, <a href="/san-pham/tra-hoa-tan-dilvang-dinh-lang-che-vang/">Trà Hòa Tan DILVANG</a> đến <a href="/san-pham/ruoc-rong-bien-vi-suon-non/">Ruốc Rong Biển Vị Sườn Non</a> và <a href="/san-pham/xi-dau-2s-do-den-nguu-bang/">Xì Dầu 2S Đỗ Đen Ngưu Bàng</a>.</p>
    <h3>SỐNG LÀNH TỪ TRONG GỐC</h3>
    <p>Với triết lý <i>“Sống xanh – sống lành – sống có giá trị”</i>, {BRAND} không chỉ mang đến sản phẩm mà còn lan tỏa lối sống lành mạnh – tỉnh thức – đầy yêu thương: ăn thuận tự nhiên, sống chậm, biết ơn và gieo điều lành mỗi ngày.</p>
    <h3>MUA SẮM ONLINE AN TOÀN, TIỆN LỢI</h3>
    <p>Đặt hàng dễ dàng ngay trên website, giao hàng toàn quốc, kiểm tra hàng trước khi thanh toán. Đội ngũ tư vấn luôn sẵn sàng hỗ trợ qua hotline <a href="tel:{tel(SITE["hotline"])}">{esc(SITE["hotline"])}</a> và Zalo. Thông tin khách hàng được bảo mật theo <a href="/chinh-sach-bao-mat/">chính sách bảo mật</a>.</p>
  </div>
  <button class="btn btn-sm btn-outline readmore-btn" data-readmore-btn>Xem thêm</button>
  <div class="tag-cloud">{tag_html}</div>
</div></section>'''
    org = {"@context": "https://schema.org", "@type": "Organization", "name": BRAND, "legalName": SITE["company"], "url": DOMAIN,
           "logo": DOMAIN + "/assets/img/brand/logo@2x.png", "email": SITE["email"], "telephone": SITE["hotline"],
           "address": {"@type": "PostalAddress", "streetAddress": SITE["address"], "addressCountry": "VN"},
           "sameAs": [u for u in SITE["socials"].values() if u]}
    web = {"@context": "https://schema.org", "@type": "WebSite", "name": BRAND, "url": DOMAIN,
           "potentialAction": {"@type": "SearchAction", "target": DOMAIN + "/tim-kiem/?q={search_term_string}", "query-input": "required name=search_term_string"}}
    return layout("/", f"{BRAND} – {SITE['tagline']}", "Thực Dưỡng Lành – dinh dưỡng từ hạt, trà thảo mộc và thực phẩm thuần chay chính hãng, nguồn gốc rõ ràng. Giao hàng toàn quốc. Hotline " + SITE["hotline"],
                  body, jsonld=[org, web], body_class="home")


def community_html():
    items = SITE.get("community") or []
    if not items:
        return ""
    cards = "".join(f'''<article class="cm-card"><a class="cm-media" href="{esc(c["url"])}" target="_blank" rel="noopener"><img src="{esc(img_url(c["image"], 600))}" alt="{esc(c["name"])}" loading="lazy" width="600" height="600"><span class="cm-stat">{esc(c.get("stat",""))}</span></a>
<h3><a href="{esc(c["url"])}" target="_blank" rel="noopener">{esc(c["name"])}</a></h3><p>{esc(c.get("desc",""))}</p><a class="more" href="{esc(c["url"])}" target="_blank" rel="noopener">Tham gia ngay {I["right"]}</a></article>''' for c in items)
    return f'''<section class="section"><div class="container">
  <h2 class="sec-title big">Các Kênh Cộng Đồng<br><span class="accent">{BRAND}</span></h2>
  <div class="cm-grid">{cards}</div>
</div></section>'''


def post_card(p):
    cat = PCATS.get(p["category"], {}).get("name", "")
    d = datetime.date.fromisoformat(p["date"]).strftime("%d/%m/%Y")
    return f'''<article class="post-card"><a class="post-media" href="/goc-song-lanh/{p["slug"]}/"><img src="{img_url(p["image"], 800)}" alt="{esc(p["title"])}" loading="lazy" width="600" height="600"></a>
<div class="post-body"><div class="post-meta"><span>{esc(cat)}</span> · <time datetime="{p["date"]}">{d}</time></div><h3><a href="/goc-song-lanh/{p["slug"]}/">{esc(p["title"])}</a></h3><p>{esc(p["excerpt"])}</p><a class="more" href="/goc-song-lanh/{p["slug"]}/">Đọc tiếp {I["right"]}</a></div></article>'''


def page_listing(path, title, products, intro="", crumbs=None):
    bc, bld = breadcrumb(crumbs or [(title, None)])
    chips = '<a href="/san-pham/" class="chip{}">Tất cả</a>'.format(" active" if path == "/san-pham/" else "")
    for c in CATS:
        href = f"/danh-muc/{c['slug']}/"
        chips += f'<a href="{href}" class="chip{" active" if path == href else ""}">{esc(c["name"])}</a>'
    if HAS_SALE:
        chips += f'<a href="/khuyen-mai/" class="chip{" active" if path == "/khuyen-mai/" else ""}">Khuyến Mãi</a>'
    body = f'''<section class="section pt-2"><div class="container">
  <div class="shop-banner">{benefits_banner()}</div>
  {bc}
  <div class="shop-head"><h1 class="shop-title">{esc(title)}</h1>
    <div class="shop-tools"><span class="muted">{len(products)} sản phẩm</span>
    <label class="sort">Sắp xếp <select data-sort><option value="default">Mặc định</option><option value="price-asc">Giá tăng dần</option><option value="price-desc">Giá giảm dần</option><option value="name">Tên A–Z</option></select></label></div></div>
  {f'<p class="shop-intro">{esc(intro)}</p>' if intro else ''}
  <div class="chips">{chips}</div>
  {grid(products, "p-grid shop-grid")}
</div></section>'''
    desc = intro or f"{title} chính hãng tại {BRAND}. Nguồn gốc rõ ràng, giao hàng toàn quốc."
    return layout(path, title, desc, body, jsonld=[bld])


def section_html(i, s):
    style = s.get("style") or "box"
    if style == "list":
        inner = "<ul>" + "".join(f"<li>{md_inline(x)}</li>" for x in (s.get("items") or []) if x) + "</ul>"
    elif style == "table":
        inner = '<table class="nutri">' + "".join(f"<tr><th>{esc(r.get('label'))}</th><td>{esc(r.get('value'))}</td></tr>" for r in (s.get("rows") or [])) + "</table>"
    else:
        inner = md(s.get("text"))
    return f'<div class="d-sec d-type-{style}"><h3>{i}. {esc(s.get("title"))}</h3><div class="d-box">{inner}</div></div>'


def page_product(p):
    path = f"/san-pham/{p['slug']}/"
    cat = CAT_BY.get(p["category"])
    bc, bld = breadcrumb([("Sản phẩm", "/san-pham/"), (cat["name"], f"/danh-muc/{cat['slug']}/"), (p["name"], None)])
    d = discount(p)
    main_imgs = "".join(f'<a class="g-slide{" is-active" if i == 0 else ""}" href="{pimg(im)}" data-lightbox="product" data-index="{i}"><img src="{pimg(im)}" alt="{esc(p["name"])} – ảnh {i+1}" width="1000" height="1000"{"" if i == 0 else " loading=lazy"}></a>' for i, im in enumerate(p["images"]))
    thumbs = "".join(f'<button class="g-thumb{" is-active" if i == 0 else ""}" data-thumb="{i}" aria-label="Ảnh {i+1}"><img src="{pimg(im, True)}" alt="" width="120" height="120" loading="lazy"></button>' for i, im in enumerate(p["images"]))
    badge = f'<span class="badge-sale">-{d}%</span>' if d else ""
    variants = ""
    if p.get("variants"):
        opts = "".join(f'<button type="button" class="v-opt{" is-active" if i == 0 else ""}" data-variant="{i}">{esc(v["name"])}</button>' for i, v in enumerate(p["variants"]))
        variants = f'<div class="variants"><span class="lbl">Quy cách:</span><div class="v-opts">{opts}</div></div>'
    unit = f'<p class="unit"><span class="lbl">Quy cách:</span> {esc(p["unit"])}</p>' if p.get("unit") else ""
    highlights = "".join(f"<li>{ic('check','hl-ic')}{esc(h)}</li>" for h in p.get("highlights", []))
    purchasable = p.get("price") is not None or any(v.get("price") is not None for v in p.get("variants", []))
    if purchasable:
        buy = f'''<div class="qty-row"><div class="qty" data-qty><button type="button" data-qminus aria-label="Giảm">−</button><input type="number" min="1" value="1" aria-label="Số lượng" id="qtyInput"><button type="button" data-qplus aria-label="Tăng">+</button></div>
  <button class="btn btn-outline btn-lg" data-add-detail="{p["slug"]}">Thêm vào giỏ hàng</button></div>
  <div class="buy-row"><button class="btn btn-lg btn-buy" data-buy-now="{p["slug"]}">{ic("bolt")} Mua ngay</button>
  <a class="btn btn-lg btn-zalo" href="{zalo_link()}" target="_blank" rel="noopener">{ic("zalo")} Tư vấn qua Zalo</a></div>'''
    else:
        buy = f'''<div class="contact-price"><p>Sản phẩm đang cập nhật giá trên website. Anh/chị vui lòng liên hệ để được báo giá và ưu đãi tốt nhất.</p></div>
  <div class="buy-row"><a class="btn btn-lg btn-buy" href="tel:{tel(SITE["hotline"])}">{ic("phone")} Gọi {esc(SITE["hotline"])}</a>
  <a class="btn btn-lg btn-zalo" href="{zalo_link()}" target="_blank" rel="noopener">{ic("zalo")} Tư vấn qua Zalo</a></div>'''
    share_url = DOMAIN + path
    sections = "".join(section_html(i, s) for i, s in enumerate(p.get("sections", []), 1))
    disc = f'<p class="disclaimer">{esc(p["disclaimer"])}</p>' if p.get("disclaimer") else ""
    related = [x for x in PRODUCTS if x["slug"] != p["slug"] and x["category"] == p["category"]]
    related += [x for x in PRODUCTS if x["slug"] != p["slug"] and x not in related]
    body = f'''<section class="section pt-2"><div class="container">
  {bc}
  <div class="product" data-product="{p["slug"]}">
    <div class="gallery" id="gallery">
      <div class="g-main">{badge}{main_imgs}<span class="g-zoom">{I["zoom"]}</span>
      <button class="g-nav prev" data-gprev aria-label="Ảnh trước">{I["left"]}</button><button class="g-nav next" data-gnext aria-label="Ảnh sau">{I["right"]}</button></div>
      <div class="g-thumbs">{thumbs}</div>
    </div>
    <div class="p-info">
      <h1 class="p-title">{esc(p["name"])}</h1>
      <div class="p-summary">{p["summary"]}</div>
      <div class="p-price" id="pPrice">{price_html(p, "price big")}</div>
      {unit}{variants}
      {buy}
      <ul class="p-highlights">{highlights}</ul>
      <div class="p-meta"><p><b>SKU:</b> {esc(p["sku"])}</p><p><b>Danh mục:</b> <a href="/danh-muc/{cat["slug"]}/">{esc(cat["name"])}</a>, <a href="/san-pham/">Toàn bộ sản phẩm</a></p></div>
      <div class="share"><b>Chia sẻ</b>
        <a href="https://www.facebook.com/sharer/sharer.php?u={share_url}" target="_blank" rel="noopener" aria-label="Chia sẻ Facebook">{I["facebook"]}</a>
        <a href="https://zalo.me/share?url={share_url}" target="_blank" rel="noopener" aria-label="Chia sẻ Zalo" class="z">Z</a>
        <button data-copy="{share_url}" aria-label="Sao chép liên kết">🔗</button>
        <button class="wish-lg" data-wish="{p["slug"]}" aria-label="Yêu thích">{I["heart"]}<span>Yêu thích</span></button>
      </div>
    </div>
  </div>

  <div class="tabs" data-tabs>
    <div class="tab-nav" role="tablist"><button role="tab" class="is-active" data-tab="desc">Mô tả</button><button role="tab" data-tab="ship">Giao hàng & đổi trả</button></div>
    <div class="tab-panel is-active" data-panel="desc">
      <div class="desc-intro">{p["summary"]}</div>
      {sections}
      {disc}
    </div>
    <div class="tab-panel" data-panel="ship">
      <div class="d-sec"><div class="d-box"><ul>
        <li>Giao hàng toàn quốc; nội thành Hà Nội 1–2 ngày, tỉnh thành khác 2–5 ngày làm việc.</li>
        <li>Được kiểm tra hàng trước khi thanh toán.</li>
        <li>Đổi trả trong 7 ngày nếu sản phẩm lỗi do nhà sản xuất hoặc hư hỏng khi vận chuyển.</li>
        <li>Chi tiết: <a href="/chinh-sach-giao-hang/">Chính sách giao hàng</a> · <a href="/chinh-sach-doi-tra/">Chính sách đổi trả</a></li>
      </ul></div></div>
    </div>
  </div>

  <h2 class="sec-title left">Sản phẩm tương tự</h2>
  {grid(related[:4], "p-grid related-grid")}
</div></section>
<div class="sticky-buy" id="stickyBuy"><div class="sb-info"><img src="{pimg(p["images"][0], True)}" alt="" width="44" height="44"><div><b>{esc(p.get("short_name") or p["name"])}</b>{price_html(p, "price")}</div></div>
{('<button class="btn" data-buy-now="' + p["slug"] + '">Mua ngay</button>') if purchasable else f'<a class="btn" href="{zalo_link()}" target="_blank" rel="noopener">Tư vấn</a>'}</div>'''
    ld = {"@context": "https://schema.org", "@type": "Product", "name": p["name"], "sku": p["sku"],
          "image": [DOMAIN + pimg(i) for i in p["images"]], "description": strip_tags(p["summary"]),
          "brand": {"@type": "Brand", "name": BRAND}}
    if p.get("price") is not None:
        ld["offers"] = {"@type": "Offer", "priceCurrency": "VND", "price": p["price"], "availability": "https://schema.org/InStock", "url": DOMAIN + path}
    desc = strip_tags(p["summary"])[:158]
    return layout(path, p["name"], desc, body, og=pimg(p["images"][0]), jsonld=[ld, bld], body_class="page-product")


def page_about():
    values = [("Tử tế & Chính trực", "Minh bạch – sản phẩm thật, giá trị thật"), ("Thân – Tâm – Trí", "Chăm sóc con người toàn diện, từ dinh dưỡng đến tinh thần và nhận thức"),
              ("Sống tỉnh thức", "Nuôi dưỡng lòng biết ơn, yêu thương cuộc sống"), ("Lan tỏa cộng đồng", "Gắn kết – chia sẻ – đồng hành"), ("Phát triển bền vững", "Dẫn đầu bằng sự kiên định và chất lượng")]
    vals = "".join(f'<div class="val-card"><span class="val-no">0{i}</span><h3>{esc(a)}</h3><p>{esc(b)}</p></div>' for i, (a, b) in enumerate(values, 1))
    bc, bld = breadcrumb([("Giới thiệu", None)])
    body = f'''{page_hero("Giới thiệu " + BRAND, esc(SITE["slogan"]))}
<section class="section"><div class="container">{bc}
  <div class="story about-story">
    <div class="story-text">
      <h2 class="story-title">Câu chuyện thương hiệu</h2>
      <p>Công ty VitaGreen Nutrition ra đời không phải từ một bản kế hoạch kinh doanh, mà từ một câu hỏi chưa kịp có lời đáp: <i>“Giá như mình chăm sóc tốt hơn…”</i></p>
      <p>Sau khi một người thân ra đi đột ngột, không kịp lời tạm biệt, cùng lúc đó hàng loạt vụ thực phẩm kém chất lượng vỡ lở, những người sáng lập nhận ra: <i>“Ai rồi cũng sẽ đến lúc phải rời khỏi cuộc đời này. Và nếu ngày mai là ngày cuối, thì mình đã sống xứng đáng và trọn vẹn chưa?”</i></p>
      <p>Từ đó, VitaGreen được xây dựng trên triết lý: <b>Sống xanh – sống lành – sống có giá trị</b>. Thương hiệu con <b>{BRAND}</b> ra đời không chỉ để bán sản phẩm, mà là lời xin lỗi muộn với những người ta không kịp chăm sóc, lời hứa sớm với những người ta vẫn còn được đồng hành, và lời cam kết với chính mình: <b>“Tôi chọn sống lành – để sống đáng.”</b></p>
    </div>
    <div class="story-media"><img src="/assets/img/brand/logo-slogan.webp" alt="{BRAND}" class="about-logo" loading="lazy"></div>
  </div>
</div></section>
<section class="section bg-soft"><div class="container vm-grid">
  <div class="vm-card"><h3>Tầm nhìn</h3><p>Trở thành hệ sinh thái sản phẩm thực dưỡng uy tín hàng đầu Việt Nam — một biểu tượng uy tín được tin chọn trong từng gia đình. Không ngừng kiến tạo hệ sinh thái sản phẩm chất lượng – lành mạnh – bền vững, giúp người Việt sống khỏe từ THÂN đến TÂM, để mỗi ngày sống là một ngày thật sự đáng sống.</p></div>
  <div class="vm-card"><h3>Sứ mệnh</h3><p>Truyền cảm hứng về một lối sống lành mạnh – tỉnh thức – đầy yêu thương. Hướng tới hành trình giúp <b>10 triệu người Việt</b> sống khỏe mạnh từ THÂN đến TÂM, để mỗi bữa ăn là một lần trở về với chính mình, và mỗi ngày sống là một ngày thật sự đáng sống.</p></div>
</div></section>
<section class="section"><div class="container">
  <h2 class="sec-title">Giá trị cốt lõi</h2>
  <div class="val-grid">{vals}</div>
</div></section>
<section class="parallax" style="background-image:url('/assets/img/brand/parallax-tea.webp')"><div class="container"><h2>Sống lành<br>từ trong gốc</h2></div></section>
<section class="section"><div class="container narrow culture">
  <h2 class="sec-title">Văn hóa {BRAND}</h2>
  <p class="center">Văn hóa của chúng tôi không phải là khẩu hiệu, mà là hành động nhỏ, đều đặn, chân thành, được gieo mỗi ngày:</p>
  <ul class="culture-list">
    <li>{ic("leaf","cl-ic")}<div><b>Ăn chay – đi chùa vào mùng 1 và rằm</b><span>Cách nhắc mình sống chậm – sống biết ơn – sống tỉnh thức.</span></div></li>
    <li>{ic("heart","cl-ic")}<div><b>Hoạt động thiện nguyện cộng đồng</b><span>Gieo điều lành ngay từ bây giờ, không đợi thành công rồi mới cho đi.</span></div></li>
    <li>{ic("check","cl-ic")}<div><b>Thực hành sống lành trong từng việc nhỏ</b><span>Uống nước ấm, ăn thuận tự nhiên, viết lời biết ơn mỗi sáng, giúp nhau sống chậm giữa đời nhanh.</span></div></li>
  </ul>
  <div class="center mt-2"><a class="btn btn-lg" href="/san-pham/">Khám phá sản phẩm</a></div>
</div></section>'''
    return layout("/gioi-thieu/", f"Giới thiệu {BRAND}", f"Câu chuyện thương hiệu {BRAND} – Sống xanh, sống lành, sống có giá trị. Tầm nhìn, sứ mệnh và giá trị cốt lõi của VitaGreen Nutrition.", body, jsonld=[bld])


def page_contact():
    bc, bld = breadcrumb([("Liên hệ", None)])
    body = f'''{page_hero("Liên hệ " + BRAND, "Chúng tôi luôn sẵn sàng lắng nghe và hỗ trợ anh/chị")}
<section class="section"><div class="container">{bc}
<div class="contact-grid">
  <div class="contact-info">
    <h2>Thông tin liên hệ</h2>
    <p class="muted">{esc(SITE["company"])}</p>
    <ul class="ci-list">
      <li>{ic("pin","ci-ic")}<div><b>Địa chỉ</b><span>{esc(SITE["address"])}</span></div></li>
      <li>{ic("phone","ci-ic")}<div><b>Hotline / Zalo</b><a href="tel:{tel(SITE["hotline"])}">{esc(SITE["hotline"])}</a></div></li>
      <li>{ic("mail","ci-ic")}<div><b>Email</b><a href="mailto:{esc(SITE["email"])}">{esc(SITE["email"])}</a></div></li>
      <li>{ic("clock","ci-ic")}<div><b>Giờ làm việc</b><span>{esc(SITE["opening_hours"])}</span></div></li>
    </ul>
    {social_links("socials socials-lg")}
  </div>
  <form class="contact-form card" id="contactForm" novalidate>
    <h2>Gửi lời nhắn cho chúng tôi</h2>
    <div class="f-row"><label>Họ và tên *<input name="name" required autocomplete="name"></label><label>Số điện thoại *<input name="phone" type="tel" required autocomplete="tel" inputmode="tel"></label></div>
    <label>Email<input name="email" type="email" autocomplete="email"></label>
    <label>Nội dung *<textarea name="message" rows="5" required></textarea></label>
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn btn-lg" type="submit">Gửi liên hệ</button>
    <p class="form-msg" role="status"></p>
  </form>
</div>
<div class="map"><iframe src="{esc(SITE["map_embed"])}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Bản đồ {BRAND}" allowfullscreen></iframe></div>
</div></section>'''
    return layout("/lien-he/", f"Liên hệ {BRAND}", f"Liên hệ {BRAND}: hotline {SITE['hotline']}, email {SITE['email']}, địa chỉ {SITE['address']}.", body, jsonld=[bld])


def page_simple(slug, title, content):
    bc, bld = breadcrumb([(title, None)])
    body = f'''{page_hero(title)}<section class="section"><div class="container narrow">{bc}<article class="prose">{fill(content)}</article></div></section>'''
    return layout(f"/{slug}/", title, strip_tags(fill(content))[:155], body, jsonld=[bld])


def page_blog(path, title, posts, crumbs):
    bc, bld = breadcrumb(crumbs)
    chips = f'<a class="chip{" active" if path == "/goc-song-lanh/" else ""}" href="/goc-song-lanh/">Tất cả</a>' + "".join(
        f'<a class="chip{" active" if path.endswith(c["slug"] + "/") else ""}" href="/goc-song-lanh/chuyen-muc/{c["slug"]}/">{esc(c["name"])}</a>' for c in POSTS["categories"])
    cards = "".join(post_card(p) for p in posts) or '<p class="empty">Chưa có bài viết trong chuyên mục này.</p>'
    body = f'''{page_hero(title, "Kiến thức dinh dưỡng, lối sống lành và câu chuyện sản phẩm")}
<section class="section"><div class="container">{bc}<div class="chips">{chips}</div><div class="post-grid">{cards}</div></div></section>'''
    return layout(path, title, f"{title} – kiến thức dinh dưỡng, lối sống lành mạnh và câu chuyện sản phẩm từ {BRAND}.", body, jsonld=[bld])


def page_post(p):
    path = f"/goc-song-lanh/{p['slug']}/"
    cat = PCATS.get(p["category"], {"name": "", "slug": ""})
    bc, bld = breadcrumb([("Góc Sống Lành", "/goc-song-lanh/"), (cat["name"], f"/goc-song-lanh/chuyen-muc/{cat['slug']}/"), (p["title"], None)])
    d = datetime.date.fromisoformat(p["date"]).strftime("%d/%m/%Y")
    others = sorted([x for x in POSTS["posts"] if x["slug"] != p["slug"]], key=lambda x: x["date"], reverse=True)[:3]
    body = f'''<section class="section pt-2"><div class="container narrow">{bc}
<article class="prose post">
  <div class="post-meta"><a href="/goc-song-lanh/chuyen-muc/{cat["slug"]}/">{esc(cat["name"])}</a> · <time datetime="{p["date"]}">{d}</time></div>
  <h1>{esc(p["title"])}</h1>
  <img class="post-cover" src="{img_url(p["image"], 1400)}" alt="{esc(p["title"])}" width="1200" height="1200">
  {p["content"]}
</article></div></section>
<section class="section bg-soft"><div class="container"><h2 class="sec-title">Bài viết khác</h2><div class="post-grid">{"".join(post_card(x) for x in others)}</div></div></section>'''
    ld = {"@context": "https://schema.org", "@type": "Article", "headline": p["title"], "datePublished": p["date"], "image": DOMAIN + p["image"],
          "author": {"@type": "Organization", "name": BRAND}, "publisher": {"@type": "Organization", "name": BRAND, "logo": {"@type": "ImageObject", "url": DOMAIN + "/assets/img/brand/logo@2x.png"}}}
    return layout(path, p["title"], p["excerpt"], body, og=img_url(p["image"], 1200), jsonld=[ld, bld])


def page_cart():
    bc, _ = breadcrumb([("Giỏ hàng", None)])
    body = f'''<section class="section pt-2"><div class="container">{bc}
<div class="steps"><span class="is-active">1. Giỏ hàng</span><span>2. Thanh toán</span><span>3. Hoàn tất</span></div>
<div id="cartPage" class="cart-page"><div class="loading">Đang tải giỏ hàng…</div></div>
</div></section>'''
    return layout("/gio-hang/", "Giỏ hàng", "Giỏ hàng của bạn tại " + BRAND, body, noindex=True, body_class="page-cart")


def page_checkout():
    bc, _ = breadcrumb([("Giỏ hàng", "/gio-hang/"), ("Thanh toán", None)])
    bank = SITE["bank"]
    bank_opt = ""
    if bank.get("enabled"):
        bank_opt = f'''<label class="pay-opt"><input type="radio" name="payment" value="bank"><span><b>Chuyển khoản ngân hàng</b><small>Quét mã QR sau khi đặt hàng – {esc(bank["bank_name"])}</small></span></label>'''
    body = f'''<section class="section pt-2"><div class="container">{bc}
<div class="steps"><span class="done">1. Giỏ hàng</span><span class="is-active">2. Thanh toán</span><span>3. Hoàn tất</span></div>
<form id="checkoutForm" class="checkout" novalidate>
  <div class="co-left card">
    <h2>Thông tin nhận hàng</h2>
    <div class="f-row"><label>Họ và tên *<input name="name" required autocomplete="name"></label><label>Số điện thoại *<input name="phone" type="tel" required autocomplete="tel" inputmode="tel" pattern="[0-9 +.]{{9,15}}"></label></div>
    <label>Email (không bắt buộc)<input name="email" type="email" autocomplete="email"></label>
    <div class="f-row"><label>Tỉnh / Thành phố *<input name="province" required list="provinces" autocomplete="address-level1"></label><label>Phường / Xã *<input name="district" required autocomplete="address-level2"></label></div>
    <datalist id="provinces"></datalist>
    <label>Địa chỉ cụ thể (số nhà, đường…) *<input name="address" required autocomplete="street-address"></label>
    <label>Ghi chú đơn hàng<textarea name="note" rows="3" placeholder="Ví dụ: giao giờ hành chính, gọi trước khi giao…"></textarea></label>
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <h2 class="mt-2">Phương thức thanh toán</h2>
    <div class="pay-opts">
      <label class="pay-opt"><input type="radio" name="payment" value="cod" checked><span><b>Thanh toán khi nhận hàng (COD)</b><small>Kiểm tra hàng rồi thanh toán cho nhân viên giao hàng</small></span></label>
      {bank_opt}
    </div>
  </div>
  <aside class="co-right card">
    <h2>Đơn hàng của bạn</h2>
    <div id="coItems"></div>
    <div class="co-sum"><div><span>Tạm tính</span><b id="coSub">0 ₫</b></div><div><span>Phí giao hàng</span><b id="coShip">Liên hệ</b></div><div class="co-total"><span>Tổng cộng</span><b id="coTotal">0 ₫</b></div></div>
    <button class="btn btn-lg btn-block" type="submit" id="placeOrder">Đặt hàng</button>
    <p class="form-msg" role="status"></p>
    <p class="small muted">Bằng việc đặt hàng, bạn đồng ý với <a href="/chinh-sach-bao-mat/">chính sách bảo mật</a> và <a href="/chinh-sach-doi-tra/">chính sách đổi trả</a> của {BRAND}.</p>
  </aside>
</form>
</div></section>'''
    return layout("/thanh-toan/", "Thanh toán", "Thanh toán đơn hàng tại " + BRAND, body, noindex=True, body_class="page-checkout")


def page_thanks():
    body = f'''<section class="section pt-2"><div class="container narrow">
<div class="steps"><span class="done">1. Giỏ hàng</span><span class="done">2. Thanh toán</span><span class="is-active">3. Hoàn tất</span></div>
<div id="thanksPage" class="card thanks"><div class="loading">Đang tải…</div></div>
</div></section>'''
    return layout("/dat-hang-thanh-cong/", "Đặt hàng thành công", "Cảm ơn bạn đã đặt hàng tại " + BRAND, body, noindex=True)


def page_wish():
    body = f'''{page_hero("Sản phẩm yêu thích")}<section class="section"><div class="container"><div id="wishPage"></div></div></section>'''
    return layout("/yeu-thich/", "Sản phẩm yêu thích", "Danh sách sản phẩm yêu thích", body, noindex=True)


def page_search():
    body = f'''{page_hero("Tìm kiếm sản phẩm")}<section class="section"><div class="container">
<form class="search-page-form" action="/tim-kiem/" method="get"><input type="search" name="q" id="spq" placeholder="Nhập tên sản phẩm, thành phần…" aria-label="Từ khóa"><button class="btn">Tìm kiếm</button></form>
<p id="searchSummary" class="muted"></p><div id="searchPage" class="p-grid shop-grid"></div></div></section>'''
    return layout("/tim-kiem/", "Tìm kiếm", "Tìm kiếm sản phẩm tại " + BRAND, body, noindex=True)


def page_404():
    body = f'''<section class="section"><div class="container narrow center nf">
<p class="nf-code">404</p><h1>Không tìm thấy trang</h1><p>Trang bạn tìm có thể đã được di chuyển hoặc không còn tồn tại.</p>
<div class="slide-cta center"><a class="btn btn-lg" href="/">Về trang chủ</a><a class="btn btn-lg btn-outline" href="/san-pham/">Xem sản phẩm</a></div></div></section>'''
    return layout("/404.html", "Không tìm thấy trang", "Không tìm thấy trang", body, noindex=True)


# ---------------------------------------------------------------- write
def write(rel, content):
    p = DIST / rel.lstrip("/")
    if rel.endswith("/"):
        p = p / "index.html"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, "utf-8")
    return rel


def logo_width():
    try:
        from PIL import Image
        with Image.open(ROOT / "assets/img/brand/logo.png") as im:
            return im.width
    except Exception:
        return 247


LOGO_W = logo_width()


def main():
    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(ROOT / "assets", DIST / "assets")
    if (ROOT / "admin").exists():
        shutil.copytree(ROOT / "admin", DIST / "admin")
    routes = []
    routes.append(write("/", page_home()))
    routes.append(write("/gioi-thieu/", page_about()))
    routes.append(write("/lien-he/", page_contact()))
    routes.append(write("/san-pham/", page_listing("/san-pham/", "Toàn bộ sản phẩm", PRODUCTS, "", [("Toàn bộ sản phẩm", None)])))
    sale = [p for p in PRODUCTS if discount(p)]
    if HAS_SALE: routes.append(write("/khuyen-mai/", page_listing("/khuyen-mai/", "Khuyến Mãi", sale, "Các sản phẩm đang có chương trình ưu đãi tại " + BRAND + ".", [("Sản phẩm", "/san-pham/"), ("Khuyến Mãi", None)])))
    for c in CATS:
        items = [p for p in PRODUCTS if p["category"] == c["slug"]]
        routes.append(write(f"/danh-muc/{c['slug']}/", page_listing(f"/danh-muc/{c['slug']}/", c["name"], items, c.get("desc", ""), [("Sản phẩm", "/san-pham/"), (c["name"], None)])))
    for p in PRODUCTS:
        routes.append(write(f"/san-pham/{p['slug']}/", page_product(p)))
    posts = sorted(POSTS["posts"], key=lambda x: x["date"], reverse=True)
    routes.append(write("/goc-song-lanh/", page_blog("/goc-song-lanh/", "Góc Sống Lành", posts, [("Góc Sống Lành", None)])))
    for c in POSTS["categories"]:
        path = f"/goc-song-lanh/chuyen-muc/{c['slug']}/"
        routes.append(write(path, page_blog(path, c["name"], [p for p in posts if p["category"] == c["slug"]], [("Góc Sống Lành", "/goc-song-lanh/"), (c["name"], None)])))
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

    # dữ liệu cho JavaScript
    js_products = [{
        "slug": p["slug"], "name": p["name"], "short": p.get("short_name") or p["name"], "price": p.get("price"),
        "regular": p.get("regular_price"), "unit": p.get("unit", ""), "variants": p.get("variants", []),
        "img": pimg(p["images"][0], True), "url": f"/san-pham/{p['slug']}/", "cat": CAT_BY[p["category"]]["name"],
        "text": strip_tags(p["name"] + " " + p["summary"] + " " + " ".join(p.get("highlights", []))),
        "featured": bool(p.get("featured")),
    } for p in PRODUCTS]
    cfg = {"brand": BRAND, "hotline": SITE["hotline"], "zalo": tel(SITE["zalo"]), "email": SITE["email"],
           "endpoint": SITE.get("order_endpoint", ""), "bank": SITE["bank"] if SITE["bank"].get("enabled") else None,
           "shipping_fee": SITE.get("shipping_fee", 0), "free_ship_threshold": SITE.get("free_ship_threshold", 0)}
    (DIST / "assets/js/data.js").write_text(
        "window.TDL_PRODUCTS=" + json.dumps(js_products, ensure_ascii=False) + ";\nwindow.TDL_CONFIG=" + json.dumps(cfg, ensure_ascii=False) + ";\n", "utf-8")

    today = datetime.date.today().isoformat()
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for r in routes:
        sm.append(f"<url><loc>{DOMAIN}{r}</loc><lastmod>{today}</lastmod></url>")
    sm.append("</urlset>")
    (DIST / "sitemap.xml").write_text("\n".join(sm), "utf-8")
    (DIST / "robots.txt").write_text(f"User-agent: *\nAllow: /\nDisallow: /gio-hang/\nDisallow: /thanh-toan/\nDisallow: /dat-hang-thanh-cong/\nDisallow: /admin/\n\nSitemap: {DOMAIN}/sitemap.xml\n", "utf-8")
    (DIST / "CNAME").write_text(DOMAIN.replace("https://", "").replace("http://", "") + "\n", "utf-8")
    (DIST / ".nojekyll").write_text("", "utf-8")
    (DIST / "_headers").write_text(
        "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n"
        "/assets/css/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        "/assets/js/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        "/assets/img/*\n  Cache-Control: public, max-age=604800\n"
        "/assets/video/*\n  Cache-Control: public, max-age=604800\n", "utf-8")
    print(f"Đã tạo {len(routes)} trang công khai + 6 trang chức năng vào {DIST}")


if __name__ == "__main__":
    main()
