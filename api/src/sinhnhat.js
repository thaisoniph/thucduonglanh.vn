/* ================================================================ 🎂 Sinh nhật nhân sự theo tháng (15/11/2026, anh Sơn: "để quản lý hay trưởng ban ăn chơi lo đời sống tinh thần biết mà tổ chức sinh nhật")
 * kv hr_life = { emails: [] } – 🎉 Trưởng ban đời sống, Quản trị chọn ở hr. → 🗂 Hồ sơ nhân sự → tab Sinh nhật.
 * Lệnh snh {op: list} cho Trưởng ban đời sống + Quản lý + Quản trị: chỉ tên + ngày/tháng sinh (không năm sinh, không số điện thoại – Luật 91/2025).
 * snh {op: life, emails} Quản trị lưu danh sách trưởng ban. snhTick (cron): sau 8h, ngày 25 báo danh sách sinh nhật tháng sau, mỗi ngày báo trước 3 ngày. */
import { esc, kvJson, kvSet, kvGet, fmtDate, DAY } from './lib.js';
import { telegramTo } from './google.js';
import { crmUsers } from './crm.js';

const dmOf = dob => { const m = String(dob || '').match(/^(\d{2})\/(\d{2})/); return m ? m[1] + '/' + m[2] : ''; };
export async function lifeList(db) { const v = await kvJson(db, 'hr_life', null); return v && Array.isArray(v.emails) ? v.emails : []; }
const canSee = (u, life) => u.level >= 2 || life.indexOf(u.email) >= 0;

export async function crmSnh(x, u, d) {
  const op = String(d.op || 'list'), life = await lifeList(x.db), users = (await crmUsers(x)).filter(z => z.active && z.email);
  if (op === 'life') {
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị chọn được Trưởng ban đời sống.' };
    const ok = new Set(users.map(z => z.email)), L = (Array.isArray(d.emails) ? d.emails : []).map(e => String(e || '').toLowerCase().trim()).filter(e => ok.has(e)).slice(0, 5);
    await kvSet(x.db, 'hr_life', JSON.stringify({ emails: L, at: Date.now(), by: u.name }));
    return { ok: true, life: L };
  }
  if (!canSee(u, life)) return { ok: true, show: false };
  return { ok: true, show: true, me: life.indexOf(u.email) >= 0, qt: u.level >= 3, life,
    staff: users.map(z => ({ email: z.email, name: z.name, full: z.full || '', dm: dmOf(z.dob) })), today: fmtDate(Date.now(), 'yyyy-MM-dd') };
}

/** [{ z, dm, n }] sinh nhật tháng `ym` ('yyyy-MM'), sắp theo ngày. */
function inMonth(users, ym) { return users.map(z => ({ z, dm: dmOf(z.dob) })).filter(o => o.dm && o.dm.slice(3) === ym.slice(5)).sort((a, b) => a.dm.localeCompare(b.dm)); }
const nm = z => esc(z.full && z.full !== z.name ? z.name + ' (' + z.full + ')' : z.name);

export async function snhTick(x, force) {
  const now = Date.now(); if (!force && Number(fmtDate(now, 'HH')) < 8) return;
  const dk = 'snh_tg_' + fmtDate(now, 'yyyyMMdd'); if (await kvGet(x.db, dk)) return; await kvSet(x.db, dk, '1', 2 * DAY);
  const all = (await crmUsers(x)).filter(z => z.active && z.email), life = await lifeList(x.db);
  const to = all.filter(z => z.tg && (life.indexOf(z.email) >= 0 || z.level >= 2));
  if (!to.length) return;
  const msgs = [];
  if (fmtDate(now, 'dd') === '25') { // danh sách tháng sau
    const nx = new Date(now + 7 * 36e5); nx.setUTCDate(1); nx.setUTCMonth(nx.getUTCMonth() + 1);
    const ym = nx.toISOString().slice(0, 7), L = inMonth(all, ym), miss = all.filter(z => !dmOf(z.dob));
    msgs.push('🎂 <b>Sinh nhật tháng ' + (+ym.slice(5)) + '</b> ' + (L.length ? '(' + L.length + ' người)' + L.map(o => '\n• ' + o.dm + ' – ' + nm(o.z)).join('') + '\n\n🎉 Ban đời sống lên kế hoạch tổ chức (gộp 1 buổi cuối tháng hoặc đúng ngày từng người).' : ': không có ai.') +
      (miss.length ? '\n\nℹ️ Chưa có ngày sinh: ' + miss.map(z => esc(z.name)).join(', ') + '. Nhờ Quản lý bổ sung ở hr.thucduonglanh.vn.' : ''));
  }
  const d3 = fmtDate(now + 3 * DAY, 'dd/MM'), S3 = all.filter(z => dmOf(z.dob) === d3);
  if (S3.length) msgs.push('🎂 <b>Còn 3 ngày nữa (' + d3 + ') sinh nhật ' + S3.map(nm).join(', ') + '</b>\n👉 Chuẩn bị bánh, thiệp hoặc lời chúc của cả nhà nhé.');
  for (const m of msgs) for (const u of to) await telegramTo(x.env, u.tg, m + '\n\nhttps://crm.thucduonglanh.vn');
}
