#!/usr/bin/env python3
"""Tạo data/vn-units-old.json: địa chỉ CŨ (63 tỉnh – huyện – xã, trước 01/07/2025) + xã MỚI tương ứng.

CRM lên đơn dùng để sale chọn địa chỉ cũ (Misa vẫn theo địa chỉ cũ) và tự điền chéo cũ ↔ mới.
Nguồn: gói PyPI `vietnam-provinces` (bảng chuyển đổi chính thức "BangChuyendoiĐVHCmoi_cu").
  pip3 download --no-deps --python-version 3.12 --only-binary=:all: -d /tmp/vp vietnam-provinces
  cd /tmp/vp && unzip -oq *.whl -d x
  python3 scripts/vn-units-old.py /tmp/vp/x/vietnam_provinces

Định dạng: [[tỉnh cũ, tên đầy đủ, tỉnh mới, [[huyện, [[xã cũ, "xã mới|xã mới 2"], …]], …]], …]
Tên tỉnh / xã mới lấy đúng chữ trong data/vn-units.json.
"""
import ast, json, re, sys, unicodedata
from pathlib import Path

src = Path(sys.argv[1])
root = Path(__file__).resolve().parent.parent
units = json.loads((root / 'data/vn-units.json').read_text(encoding='utf-8'))

def rd(p): return (src / p).read_text(encoding='utf-8')
def key(s):  # bỏ dấu (Hoà = Hòa), giữ đ
    s = unicodedata.normalize('NFD', re.sub(r"['’`]", '', s.lower().replace('đ', 'dd')))
    return re.sub(r'\s+', ' ', ''.join(c for c in s if unicodedata.category(c) != 'Mn')).strip()
def short(n): return re.sub(r'^(Tỉnh|Thành phố)\s+', '', n)

def dicts(text):  # {tên biến: {mã: [đối số]}} – đọc bằng ast cho chắc (nhiều dòng bị xuống hàng)
    def val(a):
        if isinstance(a, ast.Constant): return a.value
        if isinstance(a, ast.Attribute): return int(re.sub(r'\D', '', a.attr) or 0) if re.match(r'[PDW]_\d+$', a.attr) else a.attr
        if isinstance(a, ast.Call): return [val(b) for b in a.args]
        if isinstance(a, ast.Tuple): return [val(b) for b in a.elts]
        return None
    out = {}
    for st in ast.parse(text).body:
        if isinstance(st, (ast.Assign, ast.AnnAssign)) and isinstance(st.value, ast.Dict):
            nm = (st.targets[0] if isinstance(st, ast.Assign) else st.target).id
            out[nm] = {val(k): val(v) for k, v in zip(st.value.keys, st.value.values) if isinstance(k, ast.Constant)}
    return out
L = dicts(rd('legacy/_lookup.py')); N = dicts(rd('_lookup.py')); C = dicts(rd('_ward_conversion_2025.py'))
print({k: len(v) for k, v in L.items()}, {k: len(v) for k, v in N.items()}, {k: len(v) for k, v in C.items()}, file=sys.stderr)
LP = {c: v[0] for c, v in L['PROVINCE_MAPPING'].items()}
LD = {c: (v[0], v[4]) for c, v in L['DISTRICT_MAPPING'].items()}
LW = {c: (v[0], v[4]) for c, v in L['WARD_MAPPING'].items()}
NP = {c: v[0] for c, v in N['PROVINCE_MAPPING'].items()}
NW = {c: (v[0], v[4]) for c, v in N['WARD_MAPPING'].items()}
O2N = {c: [r[0] for r in v[1]] for c, v in C['OLD_TO_NEW'].items()}
print('cũ:', len(LP), 'tỉnh', len(LD), 'huyện', len(LW), 'xã · mới:', len(NP), 'tỉnh', len(NW), 'xã · đối chiếu', len(O2N), file=sys.stderr)

# tên tỉnh / xã mới → đúng chữ trong vn-units.json
UP = {key(u['n']): u for u in units}
def unit_of(pcode):
    u = UP.get(key(short(NP[pcode])))
    if not u: sys.exit('Không khớp tỉnh mới: ' + NP[pcode])
    return u
miss = 0
def new_name(wc):
    global miss
    n, pc = NW[wc]; u = unit_of(pc)
    if n in u['w']: return n, u['n']
    hit = [w for w in u['w'] if key(w) == key(n)]
    if len(hit) == 1: return hit[0], u['n']
    miss += 1; return n, u['n']

out = []
for pc in sorted(LP):
    dists, pnew = [], {}
    for dc in sorted(d for d in LD if LD[d][1] == pc):
        ws = []
        for wc in sorted(w for w in LW if LW[w][1] == dc):
            nn = [new_name(c) for c in O2N.get(wc, []) if c in NW]
            for _, p in nn: pnew[p] = pnew.get(p, 0) + 1
            names = list(dict.fromkeys(n for n, _ in nn))
            ws.append([LW[wc][0], '|'.join(names)])
        dists.append([LD[dc][0], ws])
    pv = max(pnew, key=pnew.get) if pnew else ''
    if len(pnew) > 1: print('⚠️', LP[pc], 'sang nhiều tỉnh mới:', pnew, file=sys.stderr)
    out.append([short(LP[pc]), LP[pc], pv, dists])
(root / 'data/vn-units-old.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print('xã mới không khớp tên:', miss, '· ghi data/vn-units-old.json', file=sys.stderr)
