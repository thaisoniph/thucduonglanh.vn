#!/usr/bin/env python3
"""Cập nhật danh sách câu cần dịch cho các ngôn ngữ của website.

Quét build.py (t("…"), tf("…")) và assets/js/main.js (T('…'), TF('…')), rồi ghi vào data/i18n/<mã>.json:
- câu mới → thêm với bản dịch rỗng "" (web tạm hiện tiếng Việt cho tới khi dịch);
- câu không còn dùng → chuyển sang khoá "_unused" để xem lại rồi xoá.
Cách dùng:  python3 scripts/i18n-keys.py           (mọi ngôn ngữ có file trong data/i18n/)
            python3 scripts/i18n-keys.py --check   (chỉ báo số câu chưa dịch, không ghi file)
"""
import ast, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def py_keys():
    keys = set()

    def consts(node):  # "a" hoặc ("a" if x else "b")
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            yield node.value
        elif isinstance(node, ast.IfExp):
            yield from consts(node.body)
            yield from consts(node.orelse)

    for node in ast.walk(ast.parse((ROOT / "build.py").read_text("utf-8"))):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ("t", "tf") and node.args:
            keys.update(k for k in consts(node.args[0]) if k.strip())
    return keys


def js_keys():
    src = (ROOT / "assets/js/main.js").read_text("utf-8")
    return {m.replace("\\'", "'") for m in re.findall(r"\bTF?\('((?:[^'\\]|\\.)*)'", src)}


def main():
    check = "--check" in sys.argv
    keys = py_keys() | js_keys()
    for f in sorted((ROOT / "data/i18n").glob("*.json")):
        d = json.loads(f.read_text("utf-8"))
        unused = d.pop("_unused", {}) or {}
        out = {k: d.get(k) or unused.get(k) or "" for k in sorted(keys)}
        gone = {k: v for k, v in {**unused, **d}.items() if k not in keys and v}
        missing = [k for k, v in out.items() if not v]
        print(f"{f.name}: {len(keys)} câu, chưa dịch {len(missing)}" + (f", không còn dùng {len(gone)}" if gone else ""))
        if not check:
            if gone:
                out["_unused"] = gone
            f.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")


if __name__ == "__main__":
    main()
