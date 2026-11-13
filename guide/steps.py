"""Hướng dẫn từng bước bằng hình (15/11/2026, port từ trang Trà Đỉnh): mỗi bước = 1 hình màn hình điện thoại vẽ bằng SVG, ô đỏ 👆 = chỗ cần bấm, kèm 1 câu chữ.
Nội dung các việc nằm ở guide/steps.yml; trong file .md gọi bằng 1 dòng riêng:  [[steps:ten-viec]]
Phần tử trong hình (els): [h, chữ] [card, tiêu đề, phụ, màu y|r|g] [btn, nhãn, màu g|d|''] [btn2, nhãn 1, nhãn 2, màu g|d|''] [in, nhãn, giá trị]
[chips, [nhãn…], chọn] [note, chữ] [bar, chữ].  hi = chỉ số phần tử cần bấm (hoặc "tab:N" = tab thứ N ở thanh dưới)."""
import html as _h

TABSETS = {
    "sale": ["Hôm nay", "Khách hỏi", "Đơn hàng", "Hiệu quả", "••• Thêm"],
}
HH = {"card": 34, "btn": 20, "btn2": 20, "row": 14, "in": 25, "chips": 18, "h": 16, "note": 14, "bar": 16}


def _e(s):
    return _h.escape(str(s), quote=True)


def _clip(s, n):
    s = str(s)
    return s if len(s) <= n else s[: n - 1] + "…"


def _t(x, y, s, size=10, w=400, c="#1c2a20", anchor=None):
    a = f' text-anchor="{anchor}"' if anchor else ""
    return f'<text x="{x}" y="{y}"{a} font-size="{size}" font-weight="{w}" fill="{c}" font-family="system-ui,sans-serif">{_e(s)}</text>'


def _r(x, y, w, h, c, r=4, stroke=None):
    st = f' stroke="{stroke}"' if stroke else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{c}"{st}/>'


def _phone(inner, hl, label):
    out = (f'<svg class="ph" viewBox="0 0 180 320" role="img" aria-label="{_e(label)}">'
           '<rect x="4" y="4" width="172" height="312" rx="26" fill="#1c2a20"/><rect x="12" y="12" width="156" height="296" rx="19" fill="#fff"/>'
           '<rect x="66" y="16" width="48" height="10" rx="5" fill="#1c2a20"/>' + inner)
    if hl:
        out += (f'<rect x="{hl[0]}" y="{hl[1]}" width="{hl[2]}" height="{hl[3]}" rx="8" fill="none" stroke="#e11d2e" stroke-width="3.5"/>'
                f'<text x="{hl[0] + hl[2] - 4}" y="{hl[1] + hl[3] + 22}" font-size="22">👆</text>')
    return out + "</svg>"


def mock(title, els, tabs, act, hi, label=""):
    y = 58
    out = _r(12, 30, 156, 224 + (0 if tabs else 54), "#f6f8f3", 0) + _r(12, 30, 156, 22, "#24805B", 0)
    out += '<circle cx="25" cy="41" r="7" fill="#fff"/>' + _t(25, 44, "T", 8, 800, "#24805B", "middle") + _t(36, 45, _clip(title, 22), 8.5, 700, "#fff")
    hl = None
    x, w = 18, 144
    for i, e in enumerate(els):
        k = e[0]
        h = HH[k]
        if k == "h":
            out += _t(x, y + 11, _clip(e[1], 30), 10.5, 800)
        elif k == "card":
            bc = {"y": "#e0c46c", "r": "#e11d2e", "g": "#2e7d32"}.get(e[3] if len(e) > 3 else "", "#dfe6da")
            out += _r(x, y, w, h, "#fff", 6, bc) + _t(x + 8, y + 14, _clip(e[1], 29), 8, 700) + _t(x + 8, y + 26, _clip(e[2] if len(e) > 2 else "", 38), 6.5, 400, "#666")
        elif k in ("btn", "btn2"):
            col = e[-1] if len(e) > (2 if k == "btn" else 3) else ""
            labels = [e[1]] if k == "btn" else [e[1], e[2]]
            bw = w / len(labels)
            for j, lb in enumerate(labels):
                g, d = col == "g", col == "d"
                bx = x + j * bw
                out += _r(bx + (1 if j else 0), y, bw - (1 if len(labels) > 1 else 0), h, "#2e7d32" if g else "#0f4a2c" if d else "#fff", 10, None if g or d else "#24805B")
                out += _t(bx + bw / 2, y + 13, _clip(lb, int(bw / 4.4)), 8, 700, "#fff" if g or d else "#0f4a2c", "middle")
        elif k == "in":
            out += _t(x, y + 8, _clip(e[1], 40), 6.2, 400, "#666") + _r(x, y + 11, w, 14, "#fff", 4, "#b9c4b4") + _t(x + 6, y + 21, _clip(e[2] if len(e) > 2 else "", 30), 8, 600)
        elif k == "chips":
            n = len(e[1])
            cw = w / n
            for j, c in enumerate(e[1]):
                on = j == (e[2] if len(e) > 2 else -1)
                out += _r(x + j * cw + 1, y, cw - 2, h, "#0f4a2c" if on else "#fff", 9, None if on else "#b9c4b4") + _t(x + j * cw + cw / 2, y + 12, _clip(c, int(cw / 3.5)), 6.5, 700, "#fff" if on else "#0f4a2c", "middle")
        elif k == "note":
            out += _t(x, y + 10, _clip(e[1], 42), 6.5, 400, "#52624f")
        elif k == "bar":
            out += _r(x, y, w, h, "#fff3c4", 5) + _t(x + 6, y + 11, _clip(e[1], 40), 6.5, 700, "#5c4400")
        if i == hi:
            hl = [x - 2, y - 2, w + 4, h + 4]
        y += h + 6
    if tabs:
        out += _r(12, 276, 156, 32, "#fff", 0) + '<line x1="12" y1="276" x2="168" y2="276" stroke="#dfe6da"/>'
        tw = 156 / len(tabs)
        for j, t in enumerate(tabs):
            out += _t(12 + j * tw + tw / 2, 296, _clip(t, 12), 5.6, 700 if j == act else 400, "#24805B" if j == act else "#888", "middle")
        if isinstance(hi, str) and hi.startswith("tab:"):
            hl = [12 + int(hi[4:]) * tw + 1, 278, tw - 2, 28]
    return _phone(out, hl, label)


def render(name, data, text_only=False):
    """data = nội dung 1 việc trong steps.yml. text_only: danh sách chữ cho tìm kiếm / trợ lý AI (không có hình)."""
    steps = data.get("steps") or []
    title = data.get("title") or "Từng bước bằng hình"
    if text_only:
        return "<p><strong>" + _e(title) + " (từng bước có hình):</strong></p><ol>" + "".join(f"<li>{s.get('text', '')}</li>" for s in steps) + "</ol>"
    out = f'<details class="g-pics" open><summary>🖼 {_e(title)} <small>· {len(steps)} bước có hình</small></summary><div class="g-steps">'
    for k, s in enumerate(steps, 1):
        tabs = TABSETS.get(s.get("tabs")) if s.get("tabs") else None
        svg = mock(s.get("title", "CRM Thực Dưỡng Lành"), s.get("els") or [], tabs, int(s.get("act", 0)), s.get("hi"), f"Bước {k}: " + html_to_plain(s.get("text", "")))
        out += f'<div class="g-stp"><div class="g-art">{svg}</div><div class="g-txt"><span class="g-num">{k}</span><p>{s.get("text", "")}</p></div></div>'
    return out + "</div></details>"


def html_to_plain(s):
    import re
    return _h.unescape(re.sub(r"<[^>]+>", "", str(s)))
