#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""📣 Lành nhận việc từ CRM (Phòng Marketing AI, 16/11/2026 – anh Sơn chọn "Cách A: Lành trên Mac").

Chạy 5 phút / lần trên máy Mac (launchd, cài bằng scripts/cai-lanh-nhan-viec.sh):
  1. Hỏi máy chủ CRM có việc mới / việc bị trả sửa không (POST https://api.thucduonglanh.vn/pm/agent {op:'pull'}).
     Mỗi lần hỏi cũng là "Lành còn trực" → CRM hiện 🟢.
  2. Có việc → báo "Đang làm" → chạy `claude -p` trong thư mục Drive "09_Phòng Marketing AI" (đủ CLAUDE.md, 4 nhân sự, skill, tài liệu).
     Lành ghi kết quả vào 08_Kết quả công việc/<năm-tháng>/CRM-<số>_<người>_<tên>.md.
  3. Gửi kết quả về CRM → cột "Chờ anh duyệt" + Telegram báo anh.
Không đăng bài, không gửi tin, không sửa web / CRM / quảng cáo: claude chỉ được đọc / viết file trong thư mục phòng, tra web.
Khoá cổng ở Keychain: dịch vụ "tdl-pm-agent" (cùng giá trị với PM_AGENT_KEY của thucduonglanh-api).
Nhật ký: ~/Library/Logs/lanh-nhan-viec.log
"""
import fcntl, json, os, re, socket, subprocess, sys, threading, time, unicodedata, urllib.request

API = os.environ.get('TDL_PM_API') or 'https://api.thucduonglanh.vn/pm/agent'  # TDL_PM_* chỉ dùng khi chạy thử
ROOM = os.environ.get('TDL_PM_ROOM') or os.path.expanduser('~/Library/CloudStorage/GoogleDrive-thaisoniph@gmail.com/Drive của tôi/03_CÔNG VIỆC/02_VITAGREEN/09_Phòng Marketing AI')
CLAUDE = os.environ.get('TDL_PM_CLAUDE') or os.path.expanduser('~/.local/bin/claude')
LOCK = os.environ.get('TDL_PM_LOCK') or os.path.expanduser('~/Library/Caches/lanh-nhan-viec.lock')
TIMEOUT = 45 * 60  # 1 việc tối đa 45 phút
MAX_PER_RUN = 3
TOOLS = 'Read Write Edit Glob Grep Agent Task Skill WebSearch WebFetch TodoWrite'
NAMES = {'lanh': 'Lanh', 'tham': 'Tham', 'van': 'Van', 'chuan': 'Chuan', 'phat': 'Phat'}


def log(*a):
    print(time.strftime('%Y-%m-%d %H:%M:%S'), *a, flush=True)


def key():
    if os.environ.get('TDL_PM_KEY'): return os.environ['TDL_PM_KEY']
    try:
        return subprocess.check_output(['security', 'find-generic-password', '-s', 'tdl-pm-agent', '-w'], stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        return ''


def post(k, body):
    req = urllib.request.Request(API, data=json.dumps(body).encode(), method='POST',
                                 headers={'x-pm-key': k, 'Content-Type': 'application/json', 'User-Agent': 'tdl-lanh-mac/1'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode() or '{}')


def slug(s, n=40):
    s = unicodedata.normalize('NFD', str(s)).replace('đ', 'd').replace('Đ', 'D')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r'[^A-Za-z0-9 ]+', ' ', s).strip()
    return re.sub(r'\s+', ' ', s)[:n].strip() or 'viec'


def vn_time(ms):
    return time.strftime('%d/%m/%Y', time.gmtime(ms / 1000 + 7 * 3600)) if ms else ''


def prompt_for(t, team, rel):
    who = next((m for m in team if m['id'] == t['who']), None)
    giao = 'Để Lành tự chia việc cho đúng người' if t['who'] == 'lanh' else 'Anh giao thẳng cho %s (%s) – em vẫn là người gom, kiểm và gửi kết quả' % (who['name'], who['role'])
    p = ['Anh Sơn vừa giao việc cho Phòng Marketing AI qua CRM. Em là **Lành – Trưởng phòng**, làm đúng theo CLAUDE.md của phòng.', '',
         'Mã việc: %s' % t['code'], 'Giao cho: %s' % giao, 'Việc: %s' % t['title']]
    if t.get('body'):
        p += ['Chi tiết anh ghi:', t['body']]
    if t.get('due'):
        p.append('Hạn: %s' % vn_time(t['due']))
    p.append('Người giao: %s' % (t.get('by') or 'anh Sơn'))
    if t.get('status') == 'sua' and t.get('note'):
        p += ['', '⚠️ ĐÂY LÀ LẦN SỬA THỨ %s. Anh đã đọc kết quả lần trước và yêu cầu sửa:' % (t.get('rounds') or 1), t['note'],
              'Kết quả lần trước đang ở file %s – đọc lại, sửa đúng chỗ anh nói, giữ phần anh không chê.' % rel]
    p += ['', 'Cách làm:',
          '1. Chia việc cho đúng nhân sự trong `.claude/agents/` (Thám, Văn, Chuẩn, Phát). Mọi nội dung gửi ra ngoài phải qua Chuẩn chấm theo Phiếu kiểm duyệt trước khi gửi anh.',
          '2. Anh KHÔNG ngồi đây để trả lời câu hỏi. Thiếu thông tin thì tự tra trong phòng và Drive công ty; vẫn thiếu thì ghi rõ "THIẾU: …" trong kết quả và làm phần làm được.',
          '3. Không đăng bài, không gửi tin, không sửa website / CRM / quảng cáo / Notion. Chỉ soạn để anh duyệt.',
          '4. Ghi TOÀN BỘ kết quả cuối (đã qua Chuẩn) vào đúng file: `%s` (ghi đè nếu đã có). Đầu file là 3–5 dòng "Tóm tắt cho anh" đọc được trên điện thoại: việc gì, ai làm, kết quả chính, anh cần quyết gì. Sau đó mới là nội dung đầy đủ (dùng tiêu đề ##, gạch đầu dòng, bảng nếu cần). Tiếng Việt đời thường.' % rel,
          '5. Cập nhật `05_Bảng việc/Bảng việc.md`: 1 dòng cho mã %s, trạng thái "Chờ anh duyệt (CRM)".' % t['code'],
          '6. Dòng CUỐI CÙNG câu trả lời của em ghi đúng dạng `CHAM: <điểm Chuẩn chấm 0-100>` (việc không cần chấm thì `CHAM: -`). Nếu hoàn toàn không làm được thì dòng cuối ghi `KHONG_LAM_DUOC: <lý do ngắn>`.']
    return '\n'.join(p)


def ticker(k, tid, stop, t0):
    while not stop.wait(120):  # 2 phút báo CRM 1 lần: còn đang làm
        try:
            post(k, {'op': 'update', 'id': tid, 'status': 'buoc', 'step': 'Lành đang làm (%d phút)' % ((time.time() - t0) // 60), 'host': socket.gethostname()})
        except Exception as e:
            log('ticker', e)


def do_task(k, t, team):
    who = NAMES.get(t['who'], 'Lanh')
    month = time.strftime('%Y-%m', time.gmtime(time.time() + 7 * 3600))
    rel = t.get('file') or '08_Kết quả công việc/%s/%s_%s_%s.md' % (month, t['code'], who, slug(t['title']))
    path = os.path.join(ROOM, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    post(k, {'op': 'update', 'id': t['id'], 'status': 'dang', 'step': 'Lành đã nhận, đang chia việc' if t['status'] != 'sua' else 'Lành đang sửa theo lời anh'})
    before = os.path.getmtime(path) if os.path.exists(path) else 0
    stop, t0 = threading.Event(), time.time()
    th = threading.Thread(target=ticker, args=(k, t['id'], stop, t0), daemon=True); th.start()
    out, err = '', ''
    try:
        r = subprocess.run([CLAUDE, '-p', prompt_for(t, team, rel), '--output-format', 'json', '--permission-mode', 'acceptEdits', '--allowedTools', TOOLS],
                           cwd=ROOM, capture_output=True, text=True, timeout=TIMEOUT)
        try:
            j = json.loads(r.stdout or '{}'); out = j.get('result') or ''
            if j.get('is_error'): err = out or 'claude báo lỗi'
        except Exception:
            out = r.stdout or ''; err = '' if r.returncode == 0 else (r.stderr or 'claude dừng giữa chừng')[-500:]
    except subprocess.TimeoutExpired:
        err = 'Quá %d phút chưa xong, Lành dừng lại' % (TIMEOUT // 60)
    finally:
        stop.set()
    mins = int((time.time() - t0) // 60)
    last = out.strip().splitlines()[-1].strip() if out.strip() else ''
    m_no = re.match(r'`?KHONG_LAM_DUOC:\s*(.+?)`?$', last)
    m_sc = re.search(r'CHAM:\s*(\d{1,3})', out[-300:])
    res = ''
    if os.path.exists(path) and os.path.getmtime(path) > before:
        with open(path, encoding='utf-8') as f: res = f.read()
    if err or m_no or not res:
        why = (m_no.group(1) if m_no else err) or 'Lành không ghi được file kết quả'
        log('loi', t['code'], why)
        post(k, {'op': 'update', 'id': t['id'], 'status': 'loi', 'step': why[:300], 'result': res or out[-8000:] or why})
        return
    post(k, {'op': 'update', 'id': t['id'], 'status': 'duyet', 'result': res, 'file': rel, 'score': int(m_sc.group(1)) if m_sc else None,
             'step': 'Chờ anh duyệt · Lành làm %d phút' % max(mins, 1)})
    log('xong', t['code'], rel, '%d phút' % mins)


def main():
    k = key()
    if not k:
        log('Chưa có khoá trong Keychain (tdl-pm-agent)'); return
    os.makedirs(os.path.dirname(LOCK), exist_ok=True)
    lf = open(LOCK, 'w')
    try:
        fcntl.flock(lf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        try: post(k, {'op': 'ping', 'host': socket.gethostname()})  # lượt trước còn đang làm việc dài → vẫn báo còn trực
        except Exception: pass
        return
    if not os.path.isdir(ROOM):
        log('Không thấy thư mục phòng trên Drive (Google Drive chưa mở?)', ROOM); return
    for _ in range(MAX_PER_RUN):
        try:
            j = post(k, {'op': 'pull', 'host': socket.gethostname(), 'busy': 0})
        except Exception as e:
            log('pull', e); return
        tasks = j.get('tasks') or []
        if not tasks: return
        try:
            do_task(k, tasks[0], j.get('team') or [])
        except Exception as e:
            log('task', tasks[0].get('code'), repr(e))
            try: post(k, {'op': 'update', 'id': tasks[0]['id'], 'status': 'loi', 'step': 'Máy Mac gặp lỗi: %s' % str(e)[:200]})
            except Exception: pass
            return


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--test':  # thử kết nối: python3 lanh-nhan-viec.py --test
        print(post(key(), {'op': 'ping', 'host': socket.gethostname()})); sys.exit(0)
    main()
