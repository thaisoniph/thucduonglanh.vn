# Dựng assets/img/ban-do-34-tinh.svg (bản đồ hành trình, build.py journey_map) – chỉ chạy lại khi đổi địa giới.
# Nguồn ranh giới: github.com/nguyenduy1133/Free-GIS-Data
#   - "Vietnam Administrative Divisions (Post-2025)/Provinces.geojson" (34 tỉnh; ô Ma=31 ghi nhầm "Lạng Sơn" → sửa thành Đồng Tháp; "TP. Hồ Chí Minh" → "Hồ Chí Minh")
#     lưu thành p34f.geojson với properties {"n": tên tỉnh}
#   - "Vietnam Administrative Divisions (Pre-2025)/Provinces_included_Paracel_SpratlyIslands.geojson": lấy 2 feature có Note (Hoàng Sa, Trường Sa) → isl.geojson {"n": ...}
# Rút gọn (npx mapshaper@0.6.102):
#   mapshaper p34f.geojson -simplify 0.6% keep-shapes weighted -filter-slivers min-area=30km2 -clean -o precision=0.001 p34s.geojson
#   mapshaper p34s.geojson -points inner -o pts.geojson        (chỗ cắm ghim mỗi tỉnh)
#   mapshaper isl.geojson -simplify 5% keep-shapes -o isls.geojson
# Rồi: python3 scripts/ban-do-34-tinh.py <thư mục chứa 3 file trên> assets/img/ban-do-34-tinh.svg
import json, math, sys
D = sys.argv[1]; OUT = sys.argv[2]
prov = json.load(open(D + '/p34s.geojson'))['features']
pts = {f['properties']['n']: f['geometry']['coordinates'] for f in json.load(open(D + '/pts.geojson'))['features']}
isl = json.load(open(D + '/isls.geojson'))['features']

def rings(g):
    return [r for poly in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]) for r in poly]

allpts = [p for f in prov + isl for r in rings(f['geometry']) for p in r]
lo0, lo1 = min(p[0] for p in allpts), max(p[0] for p in allpts)
la0, la1 = min(p[1] for p in allpts), max(p[1] for p in allpts)
C = math.cos(math.radians(16))
PAD = 12
H = 1000
k = (H - 2 * PAD) / (la1 - la0)
W = round((lo1 - lo0) * C * k + 2 * PAD)
P = lambda lo, la: ((lo - lo0) * C * k + PAD, (la1 - la) * k + PAD)
f1 = lambda v: ('%.1f' % v).rstrip('0').rstrip('.')

def path(g, minlen=0):
    out = []
    for r in rings(g):
        xy = [P(*p) for p in r]
        if len(xy) < 3 or (minlen and xy[0][0] > 450):  # đảo Trường Sa trong ranh giới Khánh Hòa: đã vẽ riêng ở nhóm quần đảo
            continue
        s = 'M' + f1(xy[0][0]) + ' ' + f1(xy[0][1])
        px, py = round(xy[0][0], 1), round(xy[0][1], 1)
        for x, y in xy[1:-1]:
            x, y = round(x, 1), round(y, 1)
            dx, dy = round(x - px, 1), round(y - py, 1)
            if dx == 0 and dy == 0:
                continue
            s += 'l' + f1(dx) + ('' if dy < 0 else ' ') + f1(dy) if True else ''
            px, py = x, y
        out.append(s + 'z')
    return ''.join(out)

# đảo: kéo lại gần đất liền + thu nhỏ Trường Sa cho bản đồ gọn (kiểu bản đồ in)
MOVE = {'Hoàng Sa': lambda x, y: (x - 578 + 500, y),
        'Trường Sa': lambda x, y: ((x - 750) * .55 + 560, (y - 852) * .55 + 830)}
W = 710
print('bbox', lo0, lo1, la0, la1, 'W', W)
body = []
for f in sorted(prov, key=lambda f: f['properties']['n']):
    n = f['properties']['n']; x, y = P(*pts[n])
    body.append(f'<path class="jm-p" data-p="{n}" data-x="{f1(x)}" data-y="{f1(y)}" d="{path(f["geometry"], 1)}"/>')
isl_out = []
for f in isl:
    n = f['properties']['n']
    cs = []
    for r in rings(f['geometry']):
        xs = [P(*p) for p in r]
        cx = sum(a for a, b in xs) / len(xs); cy = sum(b for a, b in xs) / len(xs)
        cs.append(MOVE[n](cx, cy))
    dots = ''.join(f'<circle cx="{f1(a)}" cy="{f1(b)}" r="2.6"/>' for a, b in cs)
    ax = sum(a for a, b in cs) / len(cs); ay = sum(b for a, b in cs) / len(cs)
    isl_out.append((n, dots, ax, ay, min(b for a, b in cs), max(b for a, b in cs), min(a for a, b in cs), max(a for a, b in cs)))
    print(n, 'center', ax, ay)
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-label="Bản đồ Việt Nam 34 tỉnh, thành phố, gồm quần đảo Hoàng Sa và Trường Sa">',
       '<g class="jm-land">' + ''.join(body) + '</g><g class="jm-isl">']
for n, dots, ax, ay, y0, y1, x0, x1 in isl_out:
    lbl = 'Quần đảo Hoàng Sa' if n == 'Hoàng Sa' else 'Quần đảo Trường Sa'
    sub = '(Đà Nẵng)' if n == 'Hoàng Sa' else '(Khánh Hòa)'
    ty = y0 - 44
    svg.append(f'<g data-isl="{n}">{dots}<text x="{f1(ax)}" y="{f1(ty)}" text-anchor="middle">{lbl}</text><text class="jm-sub" x="{f1(ax)}" y="{f1(ty + 24)}" text-anchor="middle">{sub}</text></g>')
svg.append('</g><g class="jm-pins"></g></svg>')
open(OUT, 'w').write(''.join(svg))
