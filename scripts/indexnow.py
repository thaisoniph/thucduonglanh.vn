#!/usr/bin/env python3
"""Báo IndexNow (Bing, Yandex, Seznam…; ChatGPT tìm kiếm dùng nhiều dữ liệu của Bing) các trang vừa sửa.
Chạy trong workflow deploy.yml SAU khi đăng web: đọc dist/sitemap.xml, lấy trang có lastmod trong 2 ngày gần nhất
(lastmod = ngày git của file nội dung, xem route_date trong build.py) và gửi 1 lần. Không có trang mới thì thôi.
Mã nằm ở data/config.json → indexnow_key, file xác minh dist/<mã>.txt do build.py ghi."""
import datetime, json, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
cfg = json.loads((ROOT / "data/config.json").read_text("utf-8"))
key, domain = cfg.get("indexnow_key"), cfg["domain"].rstrip("/")
sm = ROOT / "dist/sitemap.xml"
if not key or not sm.exists():
    sys.exit("Bỏ qua IndexNow: chưa có indexnow_key hoặc chưa build.")
since = (datetime.date.today() - datetime.timedelta(days=2)).isoformat()
urls = [u for u, d in re.findall(r"<loc>([^<]+)</loc><lastmod>([^<]+)</lastmod>", sm.read_text("utf-8")) if d >= since]
if not urls:
    print("IndexNow: không có trang nào mới sửa.")
    sys.exit(0)
body = json.dumps({"host": domain.split("//")[-1], "key": key, "keyLocation": f"{domain}/{key}.txt", "urlList": urls[:10000]}).encode()
req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body, headers={"Content-Type": "application/json; charset=utf-8"})
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        print(f"IndexNow: đã báo {len(urls)} trang (HTTP {r.status}).")
except Exception as e:  # lỗi báo Bing không được làm hỏng lần đăng web
    print(f"IndexNow lỗi (bỏ qua): {e}")
