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
_bf = DATA / "brochure.json"
BROCHURE = json.loads(_bf.read_text("utf-8")) if _bf.exists() else {}
BR_PATH = "/ho-so-thuong-hieu/"
CATS = json.loads((DATA / "categories.json").read_text("utf-8"))["categories"]

PRODUCTS = []
for f in sorted((CONTENT / "products").glob("*.json")):
    p = json.loads(f.read_text("utf-8"))
    if p.get("published") is False:
        continue
    p["slug"] = f.stem
    p["price"], p["regular_price"] = num(p.get("price")), num(p.get("regular_price"))
    p["variants"] = [{**v, "price": num(v.get("price")), "regular_price": num(v.get("regular_price")), "servings": num(v.get("servings"))} for v in (p.get("variants") or []) if v.get("name")]
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
    p = json.loads(f.read_text("utf-8"))
    if p.get("published") is False or not [i for i in (p.get("items") or []) if i.get("product")]:
        continue
    p.update(slug=f.stem, category="goi-giai-phap", combo=True, variants=[], regular_price=None, price=num(p.get("price")))
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
_BY_SLUG = {p["slug"]: p for p in PRODUCTS}
for p in PRODUCTS:
    if not p.get("combo"):
        continue
    parts = []
    for it in p.get("items") or []:
        q, qty = _BY_SLUG.get(it.get("product")), max(1, num(it.get("qty")) or 1)
        if not q or q.get("combo"):
            continue
        vi = next((k for k, v in enumerate(q["variants"]) if it.get("variant") and v["name"].strip().lower() == str(it["variant"]).strip().lower()), 0 if q["variants"] else -1)
        base = q["base_variants"][vi]["price"] if vi >= 0 else q["base_price"]
        web = q["variants"][vi]["price"] if vi >= 0 else q["price"]
        unit = q["variants"][vi]["name"] if vi >= 0 else q.get("unit", "")
        parts.append({"p": q, "it": it, "qty": qty, "unit": unit, "base": (base or 0) * qty, "web": (web or 0) * qty, "label": f'{qty} {q.get("short_name") or q["name"]}' + (f' {unit.split("(")[0].strip()}' if vi >= 0 else "")})
    p["parts"] = parts
    p["parts_base"], p["parts_web"] = sum(x["base"] for x in parts), sum(x["web"] for x in parts)
    p["unit"] = "Gồm " + " + ".join(x["label"] for x in parts)
    p["on_sale"] = False
    if p.get("price") and p["parts_base"] > p["price"] and not p["web_off"]:
        p["regular_price"] = p["parts_base"]  # gạch giá gốc mua lẻ
    p["base_price"] = p["price"]
WEB_OFF_MAX = max([p["web_off_max"] for p in PRODUCTS] or [0])
WEB_OFF_SAME = len({p["web_off_max"] for p in PRODUCTS if p["web_off_max"]}) <= 1 and all(p["web_off_max"] for p in PRODUCTS if not p.get("combo"))


def upto(pct):
    return f"{pct}%" if WEB_OFF_SAME else f"đến {pct}%"
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

_nf = DATA / "needs.json"  # "Chọn theo nhu cầu" (Cài đặt → Chọn theo nhu cầu); sản phẩm gắn ở ô "Nhu cầu"
NEEDS = [n for n in (json.loads(_nf.read_text("utf-8")).get("needs") or [] if _nf.exists() else []) if n.get("slug") and n.get("name")]
for n in NEEDS:
    n["items"] = [p for p in PRODUCTS if n["slug"] in (p.get("needs") or [])]
    n["url"] = f'/san-pham/{n["items"][0]["slug"]}/' if len(n["items"]) == 1 else f'/nhu-cau/{n["slug"]}/'  # 1 sản phẩm → vào thẳng trang sản phẩm
NEEDS = [n for n in NEEDS if n["items"]]
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
             .replace("{address}", SITE["address"]).replace("{domain}", DOMAIN)
             .replace("<p>{uu_dai_web}</p>", uu_dai_html()).replace("{uu_dai_web}", uu_dai_html()))


def uu_dai_html():
    """Danh sách ưu đãi web cho trang nội dung (chèn bằng {uu_dai_web} trong bài / trang chính sách)."""
    w, out = WEB_OFFER, []
    if w.get("headline"):
        out.append(f"<li><strong>{esc(w['headline'])}.</strong></li>")
    if WEB_OFF_MAX:
        out.append(f"<li><strong>{'Một số sản phẩm giảm thêm ' if w.get('headline') else 'Giảm '}{upto(WEB_OFF_MAX)}</strong> khi đặt trên website (mức giảm ghi ở từng sản phẩm, đã trừ trực tiếp vào giá).</li>")
    if w.get("gift_enabled") and w.get("gift_title"):
        link = f' – <a href="{esc(SITE["zalo_group"])}" target="_blank" rel="noopener">tham gia tại đây</a>' if SITE.get("zalo_group") and w.get("gift_how") else ""
        out.append(f"<li><strong>Tặng {esc(w['gift_title'])}</strong>" + (f" trị giá {esc(w['gift_value'])}" if w.get("gift_value") else "") + (f" {esc(w['gift_how'])}" if w.get("gift_how") else "") + link + ".</li>")
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
SALE_NAV = [("Khuyến Mãi", "/khuyen-mai/", [])] if HAS_SALE else []
NAV = [
    ("Trang Chủ", "/", []),
    ("Giới Thiệu", "/gioi-thieu/", [("Câu chuyện thương hiệu", "/gioi-thieu/", []), ("Hồ sơ thương hiệu", BR_PATH, [])] if BROCHURE else []),
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
  <div class="tb-left">{(f'<span class="tb-offer">🎁 <span class="tb-long">{esc(WEB_OFFER["headline"])}</span><span class="tb-short">{esc(WEB_OFFER.get("headline_short") or WEB_OFFER["headline"])}</span></span><span>&nbsp;·&nbsp;</span>' if WEB_OFFER.get("headline") else f'<span class="tb-offer">🎁 Giảm {upto(WEB_OFF_MAX)} <span class="tb-long">khi đặt trên website</span><span class="tb-short">khi đặt trên web</span></span><span>&nbsp;·&nbsp;</span>' if WEB_OFF_MAX else '')}{('<span class="tb-free">🚚 <span class="tb-long">Miễn phí vận chuyển đơn</span><span class="tb-short">Freeship</span> từ ' + money(SITE['free_ship_threshold']).replace(' ₫', 'đ') + '</span><span class="tb-hot">&nbsp;·&nbsp;</span>') if SITE.get('free_ship_threshold') and SITE.get('shipping_fee') else ''}<span class="tb-hot">Hotline {BRAND}: {ic("phone","ic ic-sm")} <a href="tel:{tel(SITE["hotline"])}">{esc(SITE["hotline"])}</a>{hot2}</span></div>
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
  {f'<a class="oc-zalo" href="{esc(SITE["zalo_group"])}" target="_blank" rel="noopener" data-cta="zalo_group_menu">{I["zalo"]}<span><b>Nhóm Zalo Sống khỏe</b>{(esc(WEB_OFFER["gift_title"]) + (" – trị giá " + esc(WEB_OFFER["gift_value"]) if WEB_OFFER.get("gift_value") else "") + " 🎁 tặng thành viên") if WEB_OFFER.get("gift_enabled") and WEB_OFFER.get("gift_title") else "Tham gia miễn phí – chia sẻ món lành, ưu đãi thành viên"}</span></a>' if SITE.get("zalo_group") else ""}
  <div class="oc-foot">{f'<a href="{esc(ebook_href("menu"))}"{ebook_target()} data-cta="ebook_menu">🎁 Nhận ebook miễn phí</a>' if ebook_href("menu") else ""}<a href="/yeu-thich/">{ic("heart")} Sản phẩm yêu thích</a><a href="tel:{tel(SITE["hotline"])}">{ic("phone")} {esc(SITE["hotline"])}</a></div>
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
    bct = f'<a href="{esc(SITE["bo_cong_thuong_url"])}" target="_blank" rel="noopener" class="bct"><img src="/assets/img/brand/bo-cong-thuong.png" alt="Đã thông báo Bộ Công Thương" width="150" loading="lazy"></a>' if SITE.get("bo_cong_thuong_url") else ""
    year = datetime.date.today().year
    return f'''
<footer class="site-footer">
  <div class="container footer-grid">
    <div class="f-col f-brand">
      <a href="/" class="f-logo"><img src="/assets/img/brand/logo-cream.webp" alt="{BRAND}" width="200" height="142" loading="lazy"></a>
      <p class="f-slogan">{slogan_html()}</p>
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
  <div class="mc-foot"><div id="mcHint"></div><div class="mc-total"><span>Tạm tính</span><b id="mcTotal">0 ₫</b></div>
  <a href="/gio-hang/" class="btn btn-outline btn-block">Xem giỏ hàng</a><a href="/thanh-toan/" class="btn btn-block">Thanh toán</a></div>
</div></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<div class="cookie-bar" id="cookieBar" hidden role="dialog" aria-label="Thông báo cookie"><p>🍪 Website dùng cookie để đo lường lượt truy cập và cải thiện trải nghiệm mua hàng. Xem <a href="/chinh-sach-bao-mat/">chính sách bảo mật</a>.</p><div><button type="button" class="btn btn-sm" data-consent="yes">Đồng ý</button><button type="button" class="btn btn-sm btn-ghost" data-consent="no">Chỉ cookie cần thiết</button></div></div>
<button class="to-top" id="toTop" aria-label="Lên đầu trang">{I["up"]}</button>'''


def float_widget():
    chips = "".join(f'<a class="fw-chip" href="/san-pham/{p["slug"]}/">{esc(p.get("short_name") or p["name"])}</a>' for p in PRODUCTS if p.get("featured"))
    return f'''
<div class="float-widget" id="floatWidget">
  <div class="fw-pop" id="fwPop">
    <button class="fw-x" id="fwClose" aria-label="Ẩn">{I["close"]}</button>
    <div class="fw-msg"><div class="fw-name"><img src="/assets/img/brand/emblem.png" alt="" width="22" height="22">{BRAND}</div>
    <p>Anh/chị đang tìm hiểu sản phẩm nào ạ? Em sẵn sàng tư vấn ngay cho anh/chị nhé!</p></div>
    <div class="fw-chips">{f'<a class="fw-chip fw-gift" href="{esc(ebook_href("float"))}"{ebook_target()} data-cta="ebook_float">🎁 Nhận ebook miễn phí</a>' if ebook_href("float") else ""}{chips}<a class="fw-chip" href="{zalo_link()}" target="_blank" rel="noopener">Liên hệ tư vấn</a></div>
  </div>
  <a class="fw-btn fw-phone" href="tel:{tel(SITE["hotline"])}" aria-label="Gọi {esc(SITE["hotline"])}">{I["phone"]}</a>
  <a class="fw-btn fw-zalo" href="{zalo_link()}" target="_blank" rel="noopener" aria-label="Chat Zalo">{I["zalo"]}</a>
  <button class="fw-btn fw-main" id="fwToggle" aria-label="Mở hộp tư vấn"><img src="/assets/img/brand/icon-180.png" alt="" width="56" height="56"></button>
</div>'''


def layout(path, title, desc, body, og=None, jsonld=None, body_class="", noindex=False, preload=""):
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
<link rel="canonical" href="{url}">{robots}{f'<link rel="preload" as="image" href="{preload}" fetchpriority="high">' if preload else ""}
<meta property="og:type" content="website"><meta property="og:site_name" content="{BRAND}">
<meta property="og:title" content="{esc(full_title)}"><meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{url}"><meta property="og:image" content="{og_img}"><meta property="og:locale" content="vi_VN">
<meta name="theme-color" content="#24805B">
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
def card_item(p):
    """Giá hiện trên thẻ: quy cách rẻ nhất (thẻ ghi "Từ …") hoặc chính sản phẩm."""
    vs = [v for v in p.get("variants", []) if v.get("price") is not None]
    return min(vs, key=lambda v: v["price"]) if len(vs) > 1 else p


def per_serving(it, p=None):
    """Dòng neo giá "≈ 22.500đ/gói" khi biết số gói/phần trong hộp (làm tròn 500đ)."""
    n, price = it.get("servings"), it.get("price")
    if not n or not price:
        return ""
    unit = it.get("serving_unit") or (p or it).get("serving_unit") or "phần"
    return f'≈ {money(round(price / n / 500) * 500).replace(" ₫", "đ")}/{esc(unit)}'


def price_html(p, cls="price", from_=False, off=False):
    if from_ and len([v for v in p.get("variants", []) if v.get("price") is not None]) > 1:
        v = card_item(p)
        old = f'<del>{money(v["regular_price"])}</del>' if discount(v) else ""
        return f'<div class="{cls}"><span class="from">Từ</span>{old}<ins>{money(v["price"])}</ins></div>'
    if p.get("price") is None:
        return f'<div class="{cls}"><ins class="contact">Liên hệ</ins></div>'
    d = discount(p)
    old = f'<del>{money(p["regular_price"])}</del>' if d else ""
    tag = f'<span class="p-off">-{d}%</span>' if d and off else ""
    return f'<div class="{cls}">{old}<ins>{money(p["price"])}</ins>{tag}</div>'


def product_card(p, lazy=True):
    d = discount(card_item(p))
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
    <h3 class="pc-title"><a href="/san-pham/{p["slug"]}/">{esc(p["name"])}</a></h3>{stars_html(p, "stars pc-stars")}
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
    zalo_box = f'''<div class="ebz">
  <b>👥 Bước 2: Vào nhóm Zalo “Sống khỏe cùng {BRAND}”</b>
  <p>{f"Nhận quà <strong>{esc(gift)}</strong>{gift_val}, " if gift else ""}thực đơn lành, ưu đãi riêng cho thành viên và được tư vấn trực tiếp.</p>
  <a class="btn btn-lg btn-zalo" href="{esc(group)}" target="_blank" rel="noopener" data-cta="zalo_group_ebook">Vào nhóm Zalo miễn phí →</a>
</div>''' if group else ""
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
  <div class="ebf card" id="ebookBox" data-flip="{esc(eb.get("flipbook", ""))}">
    <form id="ebookForm" novalidate>
      <h2>Nhận ebook ngay</h2>
      <p class="ebf-note">Điền thông tin để mở ebook. Hoàn toàn miễn phí.</p>
      <label>Họ và tên *<input name="name" required autocomplete="name" placeholder="Ví dụ: Nguyễn Thị Lan"></label>
      <label>Số điện thoại (Zalo) *<input name="phone" type="tel" required autocomplete="tel" inputmode="tel" placeholder="Ví dụ: 0912 345 678"></label>
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="btn btn-lg btn-buy" type="submit">📖 Nhận ebook miễn phí</button>
      <p class="form-msg" role="status"></p>
      <p class="ebf-legal">Khi bấm nhận ebook, anh/chị đồng ý để {BRAND} liên hệ qua điện thoại/Zalo để gửi tài liệu và tư vấn dinh dưỡng, theo <a href="/chinh-sach-bao-mat/" target="_blank">Chính sách bảo mật</a>. Không chia sẻ thông tin cho bên thứ ba.</p>
    </form>
    <div class="ebf-done" hidden>
      <h2>✅ Ebook đã sẵn sàng!</h2>
      <p class="ebf-note">Bước 1: bấm nút bên dưới để đọc ebook và xem video thực đơn 7 ngày.</p>
      <a class="btn btn-lg btn-buy" href="{esc(eb.get("flipbook", ""))}" target="_blank" rel="noopener" data-cta="ebook_open">📖 Mở ebook & video 7 ngày</a>
      {zalo_box}
      <button type="button" class="ebf-again" id="ebookAgain">Đăng ký cho người thân</button>
    </div>
  </div>
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


def benefits_banner():
    items = [("truck", "Miễn phí ship", f"đơn từ {money(SITE.get('free_ship_threshold')).replace(' ₫', 'đ')}" if SITE.get("free_ship_threshold") else "toàn quốc"), ("return", "Đổi trả 7 ngày", "nếu lỗi NSX"), ("chat", "Tư vấn", "tận tâm"), ("wallet", "Thanh toán", "tiện lợi")]
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
  <div class="bb-mid">{"".join(f'<img src="{pimg(p["images"][0], True)}" alt="" width="480" height="480" loading="lazy">' for p in (PRODUCTS[2:3] + PRODUCTS[1:2] + PRODUCTS[3:4] or PRODUCTS[:3]))}</div>
  <div class="bb-right">{feats}</div>
</a>'''


# ---------------------------------------------------------------- pages
def yt_id(url):
    m = re.search(r"(?:youtu\.be/|v=|embed/|shorts/)([\w-]{11})", url or "")
    return m.group(1) if m else ""


def brand_video():
    """Video thương hiệu (YouTube): chỉ hiện ảnh bìa, bấm mới tải YouTube (nhẹ trang, không cookie trước khi xem)."""
    bv = SITE.get("brand_video") or {}
    vid = yt_id(bv.get("youtube"))
    if not vid:
        return "", None
    title, cap = bv.get("title", ""), bv.get("caption", "")
    img = bv.get("image") or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
    html = f'''<figure class="bv">
  <div class="v-frame bv-frame" data-yt="{vid}" data-title="{esc(title)}"><img src="{esc(img)}" alt="{esc(title)}" loading="lazy" width="540" height="960"><button class="v-play" aria-label="Phát video: {esc(title)}">{I["play"]}</button></div>
  <figcaption class="bv-text"><span class="bv-kicker">Câu chuyện đồng hành</span><b>{esc(title)}</b>{f"<p>{esc(cap)}</p>" if cap else ""}<a class="bv-yt" href="https://www.youtube.com/watch?v={vid}" target="_blank" rel="noopener">Xem trên YouTube ↗</a></figcaption>
</figure>'''
    ld = {"@context": "https://schema.org", "@type": "VideoObject", "name": title, "description": cap or title,
          "thumbnailUrl": [(DOMAIN + img) if img.startswith("/") else img], "uploadDate": bv.get("upload_date") or "2026-08-18",
          "embedUrl": f"https://www.youtube-nocookie.com/embed/{vid}", "contentUrl": f"https://www.youtube.com/watch?v={vid}"}
    if bv.get("duration"):
        ld["duration"] = bv["duration"]
    return html, ld


def page_home():
    # Hero tĩnh: 1 thông điệp + lời mời bắt đầu (Cài đặt → Trang chủ). Các slide cũ thành băng chuyền sản phẩm bên dưới.
    hh = HOME.get("hero") or {}
    hp = PROD_BY.get(hh.get("product") or "")
    h_url = f'/san-pham/{hp["slug"]}/' if hp else "/san-pham/"
    h_img = img_url(hh.get("image") or (hp["images"][0] if hp else "/assets/img/brand/og-image.jpg"), 1000)
    h_title = md_inline(esc(hh.get("title") or BRAND).replace("&#x27;", "'"))
    h_cta = esc(hh.get("cta") or "Mua ngay") + (f' – {money(hp["price"]).replace(" ₫", "đ")}' if hp and hp.get("price") else "")
    hero = f'''<section class="hero hero-static">
  <div class="hero-deco" aria-hidden="true"></div>
  <div class="container slide-in">
    <div class="slide-text">{f'<span class="eyebrow">{esc(hh["eyebrow"])}</span>' if hh.get("eyebrow") else ""}<h1 class="slide-title">{h_title}</h1>{f'<p>{esc(hh["sub"])}</p>' if hh.get("sub") else ""}
      <div class="slide-cta"><a class="btn btn-lg" href="{h_url}" data-cta="hero_main">{h_cta}</a><a class="btn btn-lg btn-ghost" href="/san-pham/" data-cta="hero_all">Xem tất cả sản phẩm</a></div></div>
    <div class="slide-media"><a href="{h_url}" tabindex="-1"><img src="{h_img}" alt="{esc(hp["name"] if hp else BRAND)}" width="1000" height="1000" fetchpriority="high"></a></div>
  </div>
</section>'''
    rail = ""
    for sd in HOME.get("slides", []):
        slug = sd.get("product") or ""
        href = f"/san-pham/{slug}/" if slug in PROD_BY else "/san-pham/"
        t = md_inline(esc(sd.get("title", "")).replace("&#x27;", "'"))
        rail += f'''<article class="rl-card"><a class="rl-media" href="{href}"><img src="{img_url(sd.get("image"), 600)}" alt="{esc(strip_tags(t))}" width="600" height="600" loading="lazy"></a>
<div class="rl-body">{f'<span class="rl-eye">{esc(sd["eyebrow"])}</span>' if sd.get("eyebrow") else ""}<h3><a href="{href}">{t}</a></h3><p>{esc(sd.get("subtitle", ""))}</p><a class="btn btn-sm" href="{href}">Xem sản phẩm</a></div></article>'''
    rail_html = f'''<section class="section pt-0"><div class="container">
  <div class="rl-head"><h2 class="sec-title">Nổi bật tại {BRAND}</h2><div class="rl-nav"><button type="button" data-rail="-1" aria-label="Xem trước">{I["left"]}</button><button type="button" data-rail="1" aria-label="Xem tiếp">{I["right"]}</button></div></div>
  <div class="rail" data-rail-box>{rail}</div>
</div></section>''' if rail else ""

    cats = [("Toàn bộ sản phẩm", "/san-pham/", None)] + ([("Khuyến Mãi", "/khuyen-mai/", "sale")] if HAS_SALE else []) + [(c["name"], f"/danh-muc/{c['slug']}/", c["image"]) for c in CATS]
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

    videos = [("feedback-le-sy-phuc", "Anh Lê Sỹ Phúc", "GĐ Chi nhánh VPBank Kim Mã, Hà Nội"),
              ("feedback-vu-tan", "Anh Vũ Tân", "Giám đốc văn phòng bảo hiểm – Khâm Thiên, Hà Nội"),
              ("feedback-khach-hang-3", "Khách hàng tin dùng", "Chia sẻ trải nghiệm sản phẩm")]
    vid = "".join(f'''<figure class="v-card"><div class="v-frame" data-video="/assets/video/{v}.mp4"><img src="/assets/img/brand/{v}.webp" alt="Video cảm nhận của {esc(n)}" loading="lazy" width="480" height="854"><button class="v-play" aria-label="Phát video">{I["play"]}</button></div><figcaption><b>{esc(n)}</b><span>{esc(r)}</span></figcaption></figure>''' for v, n, r in videos)
    bv_html, bv_ld = brand_video()
    fb = "".join(f'<a class="fb-item" href="/assets/img/brand/feedback-{i}.webp" data-lightbox="fb"><img src="{img_url(f"/assets/img/brand/feedback-{i}.webp", 480)}" alt="Ảnh chụp tin nhắn phản hồi của khách hàng {i}" loading="lazy" decoding="async" width="480" height="480"></a>' for i in range(1, 6))  # ảnh nhỏ (~25KB) để kịp hiện khi cuộn tới

    tags = ["Dinh dưỡng từ hạt", "Sữa hạt Curcumin", "Fucoidan", "Bữa ăn dinh dưỡng", "Trà chè vằng", "Đinh lăng", "Trà thảo mộc hòa tan", "Ruốc chay", "Rong biển", "Xì dầu lên men", "Ngưu bàng", "Thực dưỡng", "Thuần chay", "Đạm thực vật", "Không đường tinh luyện"]
    from urllib.parse import quote
    tag_html = "".join(f'<a href="/tim-kiem/?q={quote(t)}">{esc(t)}</a>' for t in tags)

    body = f'''{hero}
{needs_html()}
<section class="section section-tight"><div class="container">{benefits_banner()}{ebook_cta("home")}</div></section>

<section class="section"><div class="container">
  <h2 class="sec-title">Danh mục sản phẩm</h2>
  <div class="cat-grid">{cat_html}</div>
</div></section>
{rail_html}

{combos_home()}
<section class="section pt-0"><div class="container">
  <h2 class="sec-title">Sản phẩm được yêu thích nhất</h2>
  {grid([x for x in featured if not x.get("combo")], "p-grid p-grid-feature")}
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
    <div class="slide-cta"><a class="btn btn-lg" href="/gioi-thieu/">Xem thêm</a>{f'<a class="btn btn-lg btn-ghost" href="{BR_PATH}">📖 Đọc hồ sơ thương hiệu</a>' if BROCHURE else ""}</div>
  </div>
  <div class="story-media"><img src="/assets/img/brand/story-tea.webp" alt="Tách trà thảo mộc Thực Dưỡng Lành" loading="lazy" width="1200" height="1200"></div>
</div></section>

<section class="parallax" style="background-image:url('/assets/img/brand/parallax-tea.webp')"><div class="container"><h2>Dưỡng Thân – Tâm An<br>Bền Sức Khoẻ</h2></div></section>

<section class="section"><div class="container">
  <h2 class="sec-title big">Khách hàng nói gì<br><span class="accent">về {BRAND}</span></h2>
  {bv_html}
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
  <h2 class="seo-h">{BRAND} – Dinh Dưỡng Thuần Tự Nhiên</h2>
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
                  body, jsonld=[org, web] + ([bv_ld] if bv_ld else []), body_class="home", preload=h_img)


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


def needs_html(active="", compact=False):
    """Khối "Chọn theo nhu cầu": trang chủ (thẻ lớn) và trang danh sách sản phẩm (gọn)."""
    if not NEEDS:
        return ""
    cards = "".join(f'''<a class="nd-card{" active" if n["url"] == active else ""}" href="{n["url"]}" data-cta="need_{n["slug"]}"><span class="nd-ic" aria-hidden="true">{esc(n.get("icon") or "🌿")}</span><span class="nd-tx"><b>{esc(n["name"])}</b>{"" if compact else f'<small>{esc(n.get("desc") or "")}</small>'}</span></a>''' for n in NEEDS)
    if compact:
        return f'<div class="nd-row" aria-label="Chọn theo nhu cầu"><span class="nd-lbl">Theo nhu cầu:</span>{cards}</div>'
    return f'''<section class="section section-tight nd-sec"><div class="container">
  <h2 class="sec-title">Chọn theo nhu cầu</h2>
  <div class="nd-grid">{cards}</div>
</div></section>'''


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
  {needs_html(path, compact=True)}
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
    anchor = ' id="kiem-nghiem"' if "kiểm nghiệm" in (s.get("title") or "").lower() else ""
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
        txt = f'<b>{p["web_off_max"]}%</b>' if len(vs) == 1 else f'đến <b>{p["web_off_max"]}%</b>'
        items.append(f'<li>{ic("check","wo-ic")}<span>Giảm {txt} cho sản phẩm này – đã trừ trực tiếp vào giá</span></li>')
    elif p is None and WEB_OFF_MAX and not w.get("headline"):
        items.append(f'<li>{ic("check","wo-ic")}<span>Giá trên web đã giảm <b>{upto(WEB_OFF_MAX)}</b> – trừ trực tiếp vào giá</span></li>')
    if gift_text():
        join = f' <a href="{esc(SITE["zalo_group"])}" target="_blank" rel="noopener" data-cta="zalo_group_offer">Tham gia nhóm →</a>' if SITE.get("zalo_group") and not compact else ""
        items.append(f'<li>{ic("check","wo-ic")}<span>{gift_text()}{join}</span></li>')
    if not items:
        return ""
    return f'<div class="wo-box{" wo-compact" if compact else ""}"><b class="wo-head">🎁 {esc(w.get("label") or "Ưu đãi chỉ có khi đặt tại website")}</b><ul>{"".join(items)}</ul></div>'


def combo_parts_html(p):
    """Trang gói: danh sách sản phẩm trong gói + tiết kiệm + miễn phí ship."""
    rows = "".join(f'<li><a href="/san-pham/{x["p"]["slug"]}/"><img src="{pimg(x["p"]["images"][0], True)}" alt="" width="56" height="56" loading="lazy"><span><b>{x["qty"]} × {esc(x["p"]["name"])}</b><small>{esc(x["unit"])}</small></span></a><s>{money(x["base"])}</s></li>' for x in p["parts"])
    save = []  # chỉ 1 mức "tiết kiệm" (so với giá gốc, khớp nhãn Tiết kiệm / -X%); giá mua lẻ trên web chỉ nêu để so sánh
    if p.get("price") and p["parts_base"] > p["price"]:
        save.append(f'Mua lẻ {money(p["parts_base"])} → <b>Gói chỉ {money(p["price"])}, tiết kiệm {money(p["parts_base"] - p["price"])}</b>')
        if p["parts_web"] > p["price"] and p["parts_web"] != p["parts_base"]:
            save.append(f'Rẻ hơn cả khi mua lẻ trên web ({money(p["parts_web"])})')
    ship = '<span class="cb-ship">🚚 Miễn phí vận chuyển</span>' if p.get("free_ship") else ""
    days = f'<span class="cb-ship">📅 Dùng trong {num(p.get("days"))} ngày</span>' if num(p.get("days")) else ""
    return f'''<div class="cb-box"><b class="cb-head">Gói gồm {len(p["parts"])} sản phẩm</b><ul class="cb-parts">{rows}</ul>
{f'<p class="cb-save">💰 {". ".join(save)}.</p>' if save else ""}<div class="cb-tags">{ship}{days}</div></div>'''


def in_combos_html(p):
    """Trang sản phẩm lẻ: gợi ý các gói có chứa sản phẩm này."""
    cs = [c for c in PRODUCTS if c.get("combo") and c.get("price") and any(x["p"]["slug"] == p["slug"] for x in c.get("parts", []))]
    if not cs:
        return ""
    li = "".join(f'<a class="ic-item" href="/san-pham/{c["slug"]}/"><img src="{pimg(c["images"][0], True)}" alt="" width="52" height="52" loading="lazy"><span><b>{esc(c["name"])}</b><small>{len(c["parts"])} sản phẩm · chỉ {money(c["price"])}{" · miễn phí ship" if c.get("free_ship") else ""}</small></span><i>Xem gói →</i></a>' for c in cs)
    return f'<div class="ic-box"><b class="ic-head">💡 Tiết kiệm hơn khi mua theo gói</b>{li}</div>'


def nl(t):
    """Chữ nhiều dòng từ /admin → xuống dòng bằng <br>."""
    return "<br>".join(esc(x.strip()) for x in str(t or "").split("\n") if x.strip())


def combo_save_tags(c, cls=""):
    """Nhãn Tiết kiệm / Miễn phí ship / Lộ trình – chỉ hiện quyền lợi khách thật sự nhận được."""
    tags = []
    if c.get("price") and c["parts_base"] > c["price"]:
        tags.append(f'<span class="{cls}save">Tiết kiệm {money(c["parts_base"] - c["price"])}</span>')
    if c.get("free_ship"):
        tags.append("<span>🚚 Miễn phí vận chuyển</span>")
    if c.get("roadmap_link"):
        tags.append(f'<span>🎁 Lộ trình đồng hành {num(c.get("days")) or ""} ngày</span>')
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
        more = f'<a class="btn btn-lg btn-ghost" href="{url}#cach-trai-nghiem" data-cta="combo_how_home">Xem cách trải nghiệm</a>'
    else:
        more = f'<a class="btn btn-lg btn-ghost" href="{url}">Xem chi tiết</a>'
    return f'''<article class="cbh-card cbh-v2">
<div class="cbh-head">{eye}<h3><a href="{url}">{esc(c["headline"])}</a></h3>{tagline}{sub}</div>
<a class="cbh-media" href="{url}"><img src="{pimg(c["images"][0])}" alt="{esc(c["name"])}" width="1000" height="1000" loading="lazy"></a>
<div class="cbh-body">{f'<ul class="cbh-bens">{bens}</ul>' if bens else ""}
<div class="cbh-buy">{price_html(c, "price big")}<div class="cbh-tags">{combo_save_tags(c, "cbh-")}</div></div>
<div class="cbh-btns"><button class="btn btn-lg btn-buy cbh-cta" data-buy-now="{c["slug"]}" data-cta="combo_start_home">{esc(c.get("cta") or "Mua ngay")}</button>{more}</div></div></article>'''


def combos_home():
    cs = [c for c in PRODUCTS if c.get("combo") and c.get("price")]
    if not cs:
        return ""
    cards = ""
    for c in cs:
        if c.get("headline"):
            cards += combo_card_v2(c)
            continue
        save = f'<span class="cbh-save">Tiết kiệm {money(c["parts_base"] - c["price"])}</span>' if c["parts_base"] > c["price"] else ""
        parts = "".join(f"<li>{esc(x['label'])}</li>" for x in c["parts"])
        cards += f'''<article class="cbh-card"><a class="cbh-media" href="/san-pham/{c["slug"]}/"><img src="{pimg(c["images"][0])}" alt="{esc(c["name"])}" width="1000" height="1000" loading="lazy"></a>
<div class="cbh-body"><h3><a href="/san-pham/{c["slug"]}/">{esc(c["name"])}</a></h3><ul class="cbh-parts">{parts}</ul>
{price_html(c)}<div class="cbh-tags">{save}{'<span>🚚 Miễn phí ship</span>' if c.get("free_ship") else ""}</div>
<div class="cbh-btns"><button class="btn" data-buy-now="{c["slug"]}">{ic("bolt")} Mua ngay</button><a class="btn btn-outline" href="/san-pham/{c["slug"]}/">Xem chi tiết</a></div></div></article>'''
    return f'''<section class="section pt-0"><div class="container">
  <h2 class="sec-title">Gói Giải Pháp Sống Lành</h2>
  <div class="cbh-grid">{cards}</div>
</div></section>'''


def combo_cta(p, where):
    return f'<button class="btn btn-lg btn-buy cbl-cta" data-buy-now="{p["slug"]}" data-cta="combo_start_{where}">{esc(p.get("cta") or "Mua ngay")}</button>'


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
        out.append(f'<section class="cbl-sec"><h2 class="cbl-h2 center">{nl(so.get("title") or "3 thay đổi nhỏ")}</h2>{intro}<div class="cbl-cards">{cards}</div></section>')
    jo = p.get("journey") or {}
    steps = [x for x in jo.get("steps") or [] if x.get("text")]
    if steps:
        st = "".join(f'<li><b>{esc(x.get("label"))}</b><span>{esc(x["text"])}</span></li>' for x in steps)
        sub = f'<p class="cbl-lead center"><b>{nl(jo["sub"])}</b></p>' if jo.get("sub") else ""
        quote = f'<blockquote class="cbl-quote">“{nl(jo["quote"])}”</blockquote>' if jo.get("quote") else ""
        road = f'<p class="center"><a class="btn btn-lg btn-outline" href="{esc(p["roadmap_link"])}" target="_blank" rel="noopener" data-cta="combo_roadmap">Xem lộ trình {num(p.get("days")) or ""} ngày</a></p>' if p.get("roadmap_link") else ""
        out.append(f'<section class="cbl-sec cbl-journey" id="cach-trai-nghiem"><h2 class="cbl-h2 center">{nl(jo.get("title"))}</h2>{sub}<ol class="cbl-steps">{st}</ol>{quote}{road}</section>')
    rc = p.get("receive") or {}
    if rc.get("title"):
        li = [f'{x["qty"]:02d} {x["it"].get("title") or x["p"]["name"]}' + (f' · {x["unit"]}' if x["unit"] else "") for x in p["parts"]]
        li += ["Miễn phí vận chuyển"] if p.get("free_ship") else []
        li += [f'Lộ trình trải nghiệm Sống Lành {num(p.get("days")) or ""} ngày'] if p.get("roadmap_link") else []
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
    bc, bld = breadcrumb([("Sản phẩm", "/san-pham/"), (cat["name"], f"/danh-muc/{cat['slug']}/"), (p["name"], None)])
    d = discount(p)
    main_imgs = "".join(f'<a class="g-slide{" is-active" if i == 0 else ""}" href="{pimg(im)}" data-lightbox="product" data-index="{i}"><img src="{pimg(im)}" alt="{esc(p["name"])} – ảnh {i+1}" width="1000" height="1000"{" fetchpriority=high" if i == 0 else " loading=lazy"}></a>' for i, im in enumerate(p["images"]))
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
    landing = bool(p.get("combo") and p.get("hero"))  # gói "khởi động": hero + các phần thuyết phục, nút chính là lời mời bắt đầu
    if landing and purchasable:
        buy = f'''<div class="qty-row"><div class="qty" data-qty><button type="button" data-qminus aria-label="Giảm">−</button><input type="number" min="1" value="1" aria-label="Số lượng" id="qtyInput"><button type="button" data-qplus aria-label="Tăng">+</button></div>
  <button class="btn btn-outline" data-add-detail="{p["slug"]}">Thêm vào giỏ hàng</button></div>
  <div class="buy-row"><a class="btn btn-zalo" href="{zalo_link()}" target="_blank" rel="noopener">{ic("zalo")} Tư vấn qua Zalo</a></div>'''
    has_cert = any("kiểm nghiệm" in (s.get("title") or "").lower() for s in p.get("sections", []))
    cert_img = f' data-cert-img="{esc(pimg(p["test_cert_img"]))}"' if p.get("test_cert_img") else ""
    badges = "".join((f'<a class="p-badge" href="#kiem-nghiem" data-cert{cert_img}>✓ {esc(b)}</a>' if has_cert and ("kiểm nghiệm" in b.lower() or "nifc" in b.lower()) else f'<span class="p-badge">✓ {esc(b)}</span>')
                     for b in (p.get("badges") or []) if b)
    v0 = p["variants"][0] if p.get("variants") else p
    if landing:
        info_top = combo_hero_info(p)
    else:
        info_top = f'''<h1 class="p-title">{esc(p["name"])}</h1>{f'<a class="p-rating" href="#danh-gia">{stars_html(p)}</a>' if rating_of(p) else ""}
      <div class="p-summary">{p["summary"]}</div>
      {f'<div class="p-badges">{badges}</div>' if badges else ""}
      <div class="p-price" id="pPrice">{price_html(p, "price big", off=True)}<div class="p-per" id="pPer">{per_serving(v0, p)}</div></div>'''
    share_url = DOMAIN + path
    sections = "".join(section_html(i, s) for i, s in enumerate(p.get("sections", []), 1))
    disc = f'<p class="disclaimer">{esc(p["disclaimer"])}</p>' if p.get("disclaimer") else ""
    related = [x for x in PRODUCTS if x["slug"] != p["slug"] and x["category"] == p["category"]]
    related += [x for x in PRODUCTS if x["slug"] != p["slug"] and x not in related]
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
      {"" if landing else (combo_parts_html(p) if p.get("combo") else unit)}{variants}
      {buy}
      {trust_line(p) if purchasable else ""}
      {combo_parts_html(p) if landing else ""}
      {offer_box(p) if purchasable else ""}
      {"" if p.get("combo") else in_combos_html(p)}
      {f'<ul class="p-highlights">{highlights}</ul>' if highlights else ""}
      <div class="p-meta"><p><b>SKU:</b> {esc(p["sku"])}</p><p><b>Danh mục:</b> <a href="/danh-muc/{cat["slug"]}/">{esc(cat["name"])}</a>, <a href="/san-pham/">Toàn bộ sản phẩm</a></p></div>
      <div class="share"><b>Chia sẻ</b>
        <a href="https://www.facebook.com/sharer/sharer.php?u={share_url}" target="_blank" rel="noopener" aria-label="Chia sẻ Facebook">{I["facebook"]}</a>
        <a href="https://zalo.me/share?url={share_url}" target="_blank" rel="noopener" aria-label="Chia sẻ Zalo" class="z">Z</a>
        <button data-copy="{share_url}" aria-label="Sao chép liên kết">🔗</button>
        <button class="wish-lg" data-wish="{p["slug"]}" aria-label="Yêu thích">{I["heart"]}<span>Yêu thích</span></button>
      </div>
    </div>
  </div>
  {reviews_html(p)}
  {combo_landing(p) if landing else ""}

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
{satc_html(p) if purchasable else ""}'''
    ld = {"@context": "https://schema.org", "@type": "Product", "name": p["name"], "sku": p["sku"],
          "image": [DOMAIN + pimg(i) for i in p["images"]], "description": strip_tags(p["summary"]),
          "brand": {"@type": "Brand", "name": BRAND}}
    if p.get("price") is not None:
        ld["offers"] = {"@type": "Offer", "priceCurrency": "VND", "price": p["price"], "availability": "https://schema.org/InStock", "url": DOMAIN + path}
    if rating_of(p):  # chỉ khi có ≥ 3 đánh giá thật
        ld["aggregateRating"] = {"@type": "AggregateRating", "ratingValue": rating_of(p)[0], "reviewCount": rating_of(p)[1], "bestRating": 5, "worstRating": 1}
    desc = strip_tags(p["summary"])[:158]
    return layout(path, p["name"], desc, body, og=pimg(p["images"][0]), jsonld=[ld, bld], body_class="page-product", preload=pimg(p["images"][0]))


def satc_html(p):
    """Thanh mua nhanh dính đáy (điện thoại/máy tính bảng ≤ 960px): chọn quy cách + Thêm vào giỏ + Mua ngay. Logic trong main.js (initSatc)."""
    vs = "".join(f'<button type="button" data-satc-v="{i}" aria-pressed="{"true" if i == 0 else "false"}">{esc(v["name"])}</button>' for i, v in enumerate(p.get("variants") or []))
    return f'''<div class="satc" id="satc" role="region" aria-label="Thanh mua nhanh">
  <div class="satc-top"><img src="{pimg(p["images"][0], True)}" alt="" width="44" height="44" loading="lazy"><div class="satc-txt"><div class="satc-name">{esc(p.get("short_name") or p["name"])}</div><div><span class="satc-price" id="satcPrice">{money(p["price"])}</span><span class="satc-trust" id="satcTrust"></span></div></div></div>
  {f'<div class="satc-variants">{vs}</div>' if len(p.get("variants") or []) > 1 else ""}
  <div class="satc-actions"><button type="button" class="satc-add" id="satcAdd">Thêm vào giỏ</button><button type="button" class="satc-buy" id="satcBuy">{esc(p.get("cta_short") or "Mua ngay")}</button></div>
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
    return f'<span class="{cls}" aria-label="{avg} trên 5 sao, {n} đánh giá"><span class="st" style="--r:{avg / 5 * 100:.0f}%" aria-hidden="true"></span><b>{str(avg).replace(".", ",")}</b><small>({n}{"" if "pc-" in cls else " đánh giá"})</small></span>'


def reviews_html(p):
    """Khối "Khách hàng nói gì" trên trang sản phẩm – dùng lại thẻ video cảm nhận của trang chủ."""
    rv = reviews_of(p)
    if not rv:
        return ""
    cards = ""
    for i, r in enumerate(rv):
        who = f'<b>{esc(r["name"])}</b>' + (f'<span>{esc(r["location"])}</span>' if r.get("location") else "")
        star = num(r.get("rating"))
        star = f'<span class="st" style="--r:{min(5, star) * 20}%" aria-label="{min(5, star)} sao"></span>' if star else ""
        vid, yt = r.get("video") or "", yt_id(r.get("video"))
        if vid:
            cover = r.get("img") or (f"https://i.ytimg.com/vi/{yt}/hqdefault.jpg" if yt else "")
            frame = f'data-yt="{yt}" data-title="{esc(r["name"])}"' if yt else f'data-video="{esc(vid)}"'
            cards += f'''<figure class="v-card rv-card"><div class="v-frame" {frame}>{f'<img src="{esc(img_url(cover, 480) if cover.startswith("/") else cover)}" alt="Video cảm nhận của {esc(r["name"])}" loading="lazy" width="480" height="854">' if cover else ""}<button class="v-play" aria-label="Phát video">{I["play"]}</button></div><figcaption>{who}{star}{f"<p>{esc(r['text'])}</p>" if r.get("text") else ""}</figcaption></figure>'''
        else:
            pic = f'<a class="rv-img" href="{esc(img_url(r["img"], 1000))}" data-lightbox="rv"><img src="{esc(img_url(r["img"], 480))}" alt="Ảnh khách {esc(r["name"])} gửi" loading="lazy" width="120" height="120"></a>' if r.get("img") else ""
            cards += f'<figure class="rv-q">{star}<blockquote>“{esc(r.get("text", ""))}”</blockquote>{pic}<figcaption>{who}</figcaption></figure>'
    return f'''<section class="rv-sec" id="danh-gia"><h2 class="sec-title left">Khách hàng nói gì {stars_html(p, "stars rv-sum")}</h2><div class="rv-grid">{cards}</div></section>'''


def trust_line(p):
    """Dòng cam kết nhỏ ngay dưới nút mua (khớp chính sách giao hàng / kiểm hàng)."""
    th = SITE.get("free_ship_threshold")
    ship = "🚚 Miễn phí vận chuyển" if p.get("free_ship") else (f"🚚 Freeship đơn từ {th // 1000}k" if th and SITE.get("shipping_fee") else "🚚 Giao toàn quốc")
    return f'<p class="p-trust"><span>{ship}</span><span>📦 Giao Hà Nội 1–2 ngày</span><span>✅ Kiểm tra hàng trước khi trả tiền</span></p>'


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
    values = [("Tử tế & Chính trực", "Minh bạch – sản phẩm thật, giá trị thật"), ("Thân – Tâm – Trí", "Chăm sóc con người toàn diện, từ dinh dưỡng đến tinh thần và nhận thức"),
              ("Sống tỉnh thức", "Nuôi dưỡng lòng biết ơn, yêu thương cuộc sống"), ("Lan tỏa cộng đồng", "Gắn kết – chia sẻ – đồng hành"), ("Phát triển bền vững", "Dẫn đầu bằng sự kiên định và chất lượng")]
    vals = "".join(f'<div class="val-card"><span class="val-no">0{i}</span><h3>{esc(a)}</h3><p>{esc(b)}</p></div>' for i, (a, b) in enumerate(values, 1))
    bc, bld = breadcrumb([("Giới thiệu", None)])
    bv_html, bv_ld = brand_video()
    body = f'''{page_hero("Giới thiệu " + BRAND, esc(SITE["slogan"]))}
<section class="section"><div class="container">{bc}
  {f'<div class="bv-about">{bv_html}</div>' if bv_html else ""}
  <div class="story about-story">
    <div class="story-text">
      <h2 class="story-title">Câu chuyện thương hiệu</h2>
      <p>Công ty VitaGreen Nutrition ra đời không phải từ một bản kế hoạch kinh doanh, mà từ một câu hỏi chưa kịp có lời đáp: <i>“Giá như mình chăm sóc tốt hơn…”</i></p>
      <p>Sau khi một người thân ra đi đột ngột, không kịp lời tạm biệt, cùng lúc đó hàng loạt vụ thực phẩm kém chất lượng vỡ lở, những người sáng lập nhận ra: <i>“Ai rồi cũng sẽ đến lúc phải rời khỏi cuộc đời này. Và nếu ngày mai là ngày cuối, thì mình đã sống xứng đáng và trọn vẹn chưa?”</i></p>
      <p>Từ đó, VitaGreen được xây dựng trên triết lý: <b>Sống xanh – sống lành – sống có giá trị</b>. Thương hiệu con <b>{BRAND}</b> ra đời không chỉ để bán sản phẩm, mà là lời xin lỗi muộn với những người ta không kịp chăm sóc, lời hứa sớm với những người ta vẫn còn được đồng hành, và lời cam kết với chính mình: <b>“Tôi chọn sống lành – để sống đáng.”</b></p>
    </div>
    <div class="story-media"><img src="/assets/img/brand/logo-gold.webp" alt="{BRAND} – {esc(SITE["slogan"])}" class="about-logo about-logo-gold" width="900" height="900" loading="lazy"></div>
  </div>
</div></section>
<section class="section bg-soft"><div class="container vm-grid">
  <div class="vm-card"><h3>Tầm nhìn</h3><p>Trở thành hệ sinh thái sản phẩm thực dưỡng uy tín hàng đầu Việt Nam — một biểu tượng uy tín được tin chọn trong từng gia đình. Không ngừng kiến tạo hệ sinh thái sản phẩm chất lượng – lành mạnh – bền vững, giúp người Việt sống khỏe từ THÂN đến TÂM, để mỗi ngày sống là một ngày thật sự đáng sống.</p></div>
  <div class="vm-card"><h3>Sứ mệnh</h3><p>Truyền cảm hứng về một lối sống lành mạnh – tỉnh thức – đầy yêu thương. Hướng tới hành trình giúp <b>10 triệu người Việt</b> sống khỏe mạnh từ THÂN đến TÂM, để mỗi bữa ăn là một lần trở về với chính mình, và mỗi ngày sống là một ngày thật sự đáng sống.</p></div>
</div></section>
{brochure_promo()}
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
    return layout("/gioi-thieu/", f"Giới thiệu {BRAND}", f"Câu chuyện thương hiệu {BRAND} – Sống xanh, sống lành, sống có giá trị. Tầm nhìn, sứ mệnh và giá trị cốt lõi của VitaGreen Nutrition.", body, jsonld=[bld] + ([bv_ld] if bv_ld else []))


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
</article>
{ebook_cta("post")}</div></section>
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
    body = f'''<section class="section pt-2"><div class="container">{bc}
<div class="steps"><span class="done">1. Giỏ hàng</span><span class="is-active">2. Thanh toán</span><span>3. Hoàn tất</span></div>
<form id="checkoutForm" class="checkout" novalidate>
  <div class="co-left card">
    <h2>Thông tin nhận hàng</h2>
    <div data-order-fields><div class="loading">Đang tải…</div></div>
  </div>
  <aside class="co-right card">
    <h2>Đơn hàng của bạn</h2>
    <div id="coItems"></div>
    <div id="coUpsell"></div>
    {offer_box()}
    <button class="btn btn-lg btn-block btn-order" type="submit" id="placeOrder">✅ Đặt hàng</button>
    <p class="form-msg" role="status"></p>
    <p class="qo-note">Nhân viên sẽ gọi xác nhận trước khi giao hàng.</p>
    <div class="qo-alt"><a class="btn btn-outline" href="tel:{tel(SITE["hotline"])}">📞 Gọi đặt hàng</a><a class="btn btn-zalo" href="{zalo_link()}" target="_blank" rel="noopener">💬 Đặt qua Zalo</a></div>
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
    if BROCHURE:
        routes.append(write(BR_PATH, page_brochure()))
    routes.append(write("/lien-he/", page_contact()))
    if (SITE.get("ebook") or {}).get("flipbook"):
        routes.append(write(EBOOK_PATH, page_ebook()))
    routes.append(write("/san-pham/", page_listing("/san-pham/", "Toàn bộ sản phẩm", PRODUCTS, "", [("Toàn bộ sản phẩm", None)])))
    sale = [p for p in PRODUCTS if p["on_sale"]]
    if HAS_SALE: routes.append(write("/khuyen-mai/", page_listing("/khuyen-mai/", "Khuyến Mãi", sale, "Các sản phẩm đang có chương trình ưu đãi tại " + BRAND + ".", [("Sản phẩm", "/san-pham/"), ("Khuyến Mãi", None)])))
    for c in CATS:
        items = [p for p in PRODUCTS if p["category"] == c["slug"]]
        routes.append(write(f"/danh-muc/{c['slug']}/", page_listing(f"/danh-muc/{c['slug']}/", c["name"], items, c.get("desc", ""), [("Sản phẩm", "/san-pham/"), (c["name"], None)])))
    for n in NEEDS:
        if n["url"].startswith("/nhu-cau/"):
            routes.append(write(n["url"], page_listing(n["url"], n["name"], n["items"], n.get("desc", ""), [("Sản phẩm", "/san-pham/"), (n["name"], None)])))
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
        "regular": p.get("regular_price"), "off": p.get("web_off") or 0, "fs": bool(p.get("free_ship")), "days": num(p.get("days")) or 0, "servings": p.get("servings"), "serving_unit": p.get("serving_unit") or "", "unit": p.get("unit", ""), "variants": p.get("variants", []),
        "img": pimg(p["images"][0], True), "url": f"/san-pham/{p['slug']}/", "cat": CAT_BY[p["category"]]["name"],
        "text": strip_tags(p["name"] + " " + p["summary"] + " " + " ".join(p.get("highlights", []))),
        "featured": bool(p.get("featured")), "upsell": [x for x in (p.get("upsell") or []) if x], "combo": bool(p.get("combo")),
        "kw": [k for k in (p.get("keywords") or []) if k],  # từ khóa tìm kiếm nội bộ (không hiển thị)
    } for p in PRODUCTS]
    cfg = {"brand": BRAND, "hotline": SITE["hotline"], "zalo": tel(SITE["zalo"]), "email": SITE["email"], "zalo_oa": SITE.get("zalo_oa", ""), "zalo_group": SITE.get("zalo_group", ""), "gift": (WEB_OFFER.get("gift_title", "") + (" (trị giá " + WEB_OFFER["gift_value"] + ")" if WEB_OFFER.get("gift_value") else "")) if WEB_OFFER.get("gift_enabled") else "",
           "ga4_id": SITE.get("ga4_id", ""), "clarity_id": SITE.get("clarity_id", ""), "meta_pixel": SITE.get("meta_pixel", ""), "tiktok_pixel": SITE.get("tiktok_pixel", ""),
           "endpoint": (SITE.get("api_endpoint") or SITE.get("order_endpoint", "")), "bank": SITE["bank"] if SITE["bank"].get("enabled") else None,
           "shipping_fee": SITE.get("shipping_fee", 0), "free_ship_threshold": SITE.get("free_ship_threshold", 0),
           "needs": [{"name": n["name"], "icon": n.get("icon") or "", "url": n["url"]} for n in NEEDS]}
    (DIST / "assets/data").mkdir(parents=True, exist_ok=True)
    shutil.copy(DATA / "vn-units.json", DIST / "assets/data/vn-units.json")
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
    build_crm()


def build_crm():
    """CRM cho nhân sự tại crm.thucduonglanh.vn: trang tĩnh trong crm/, dữ liệu lấy qua Apps Script. Ra thư mục dist-crm/."""
    src, out = ROOT / "crm", ROOT / "dist-crm"
    if not src.exists():
        return
    if out.exists():
        shutil.rmtree(out)
    out.mkdir()
    import hashlib
    # Nén CSS
    css_raw = (src / "app.css").read_text("utf-8")
    css_min = re.sub(r'/\*[\s\S]*?\*/', '', css_raw)
    css_min = re.sub(r'\s+', ' ', css_min)
    css_min = re.sub(r'\s*([\{\}:;,>~+])\s*', r'\1', css_min)
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

    ver = hashlib.md5((js_min + css_min).encode("utf-8")).hexdigest()[:8]
    (out / "index.html").write_text((src / "index.html").read_text("utf-8").replace("__V__", ver), "utf-8")
    brand = ROOT / "assets/img/brand"
    for f in ("logo.webp", "icon-32.png", "icon-180.png", "icon-512.png"):
        shutil.copy(brand / f, out / f)
    shutil.copy(DATA / "vn-units.json", out / "vn-units.json")
    products = [{"name": p["name"], "price": p.get("base_price"), "unit": p.get("unit", ""),
                 "variants": [{"name": v["name"], "price": v["price"]} for v in p.get("base_variants", [])]} for p in PRODUCTS]
    cfg = {"endpoint": (SITE.get("api_endpoint") or SITE.get("order_endpoint", "")), "shipping_fee": SITE.get("shipping_fee", 0),
           "free_ship_threshold": SITE.get("free_ship_threshold", 0), "products": products,
           "zalo_group": SITE.get("zalo_group", "")}
    (out / "crm-data.js").write_text("window.CRM_CONFIG=" + json.dumps(cfg, ensure_ascii=False) + ";\n", "utf-8")
    (out / "manifest.webmanifest").write_text(json.dumps({
        "name": "CRM Thực Dưỡng Lành", "short_name": "CRM TDL", "start_url": "/", "display": "standalone",
        "background_color": "#f5f4ef", "theme_color": "#24805B",
        "icons": [{"src": "/icon-180.png", "sizes": "180x180", "type": "image/png"}, {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"}]}, ensure_ascii=False), "utf-8")
    (out / "robots.txt").write_text("User-agent: *\nDisallow: /\n", "utf-8")
    (out / "_headers").write_text(
        "/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n"
        "  Content-Security-Policy: default-src 'self'; connect-src 'self' https://api.thucduonglanh.vn https://script.google.com https://script.googleusercontent.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\n"
        "/\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n/crm-data.js\n  Cache-Control: no-cache\n"
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
