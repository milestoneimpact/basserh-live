// The visitors' report by mail, once after each day of a stations event, to the owners of the organisation.
// No schedule is needed (the account has none): the first visit of a new day, sent by a station, sends the day before.
import { visits } from './data.js';
import { visRead } from '../web/engine/report.js';
import { mail } from './mail.js';

const esc = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const n = x => Number(x || 0).toLocaleString('ar');
const mmss = ms => { const t = Math.round((ms || 0) / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

// is the mail on for this event (on unless the organisation turned it off)
export const mailOn = async (T, evId) => !(await T.prepare("SELECT 1 FROM report_mail WHERE event_id = ? AND day = 'off'").bind(evId).first());

// called after a station's visits are kept: the hall's own date (tz from the station), the day before it, sent once
export async function dayMail(env, T, ev, doc, tz, origin) {
  if (!Number.isFinite(tz) || !(await mailOn(T, ev.id))) return 0;
  const today = new Date(Date.now() - tz * 6e4).toISOString().slice(0, 10), all = await visits(T, ev.id, doc, false, tz), past = all.days.filter(d => d.day < today).pop();
  if (!past || await T.prepare('SELECT 1 FROM report_mail WHERE event_id = ? AND day = ?').bind(ev.id, past.day).first()) return 0;
  await T.prepare('INSERT OR IGNORE INTO report_mail (event_id, day, at) VALUES (?,?,?)').bind(ev.id, past.day, new Date().toISOString()).run();
  const org = await env.DB.prepare('SELECT name, slug FROM orgs WHERE id = ?').bind(ev.org_id).first();
  const { results: to } = await env.DB.prepare("SELECT u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? AND m.role = 'owner'").bind(ev.org_id).all();
  if (!org || !to.length) return 0;
  const v = await visits(T, ev.id, doc, false, tz, past.day), m = dayHtml(v, doc, org, past.day, `${origin}/${org.slug}#e=${ev.id}&t=run`);
  let sent = 0; for (const r of to) sent += await mail(env, { to: r.email, subject: m.subject, text: m.text, html: m.html }); return sent;
}

export function dayHtml(v, doc, org, day, link) {
  const R = visRead(v, esc), when = new Date(day + 'T12:00:00').toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), col = { bad: '#A8402F', warn: '#D08A2A', good: '#2E7D5B', info: '#3C6E8F' };
  const k = [['الزيارات', n(v.total)], ['متوسط الزيارة', mmss(v.ms / Math.max(1, v.total))], ['أكثر المحطات زوارًا', R.top ? esc(R.top.name || R.top.station) : '·'], ['ساعة الذروة', R.peak >= 0 ? `${n(R.peak)}:00` : '·']];
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;color:#1F2A2E;max-width:620px;margin:auto;background:#FBF7EE;border:1px solid #E4DAC6;border-radius:14px;overflow:hidden">
<div style="background:#1F2A2E;color:#F6F2E8;padding:20px 22px;border-bottom:3px solid #B88A3D"><div style="color:#D9B878;font-size:12px">تقرير الزوار · ${esc(org.name)}</div><div style="font-size:22px;font-weight:700;margin:4px 0">${esc(doc.name)}</div><div style="color:#E8D9BD;font-size:14px">${when}</div></div>
<div style="padding:18px 22px"><table style="width:100%;border-collapse:separate;border-spacing:6px"><tr>${k.map(([a, b]) => `<td style="background:#fff;border:1px solid #E4DAC6;border-radius:10px;padding:10px;vertical-align:top"><div style="color:#6F7578;font-size:12px">${a}</div><div style="font-size:20px;font-weight:700">${b}</div></td>`).join('')}</tr></table>
<h3 style="font-size:16px;margin:18px 0 8px">ما يستحق انتباهك</h3>${R.notes.map(x => `<div style="padding:8px 0;border-top:1px solid #F0E8D8"><b style="color:${col[x.k]}">●</b> <b>${x.t}</b>${x.d ? `<div style="color:#6F7578;font-size:13px;margin-right:16px">${x.d}</div>` : ''}</div>`).join('')}
${R.files.filter(F => F.watch.length).map(F => `<h3 style="font-size:16px;margin:18px 0 8px">${esc(F.f.name)}: الصفحات التي تستحق المتابعة</h3>${F.watch.map(w => `<div style="padding:6px 0;font-size:14px"><b>الصفحة ${n(w.p)}</b> · ${w.label}: <span style="color:#6F7578">${w.why}</span></div>`).join('')}`).join('')}
<p style="margin:22px 0 4px"><a href="${link}" style="background:#B88A3D;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700">التقرير الكامل في الاستوديو</a></p>
<p style="color:#999;font-size:11px;margin-top:18px">يصلكم هذا بعد كل يوم فيه زوار، ويمكن إيقافه من تقرير الزوار في الاستوديو. لا يُحفظ شيء عن الزائر نفسه.</p></div></div>`;
  const strip = s => s.replace(/<[^>]+>/g, '');
  const text = `تقرير الزوار: ${doc.name}\n${when}\n\n${k.map(([a, b]) => `${a}: ${strip(b)}`).join('\n')}\n\nما يستحق انتباهك:\n${R.notes.map(x => `• ${strip(x.t)}${x.d ? ': ' + strip(x.d) : ''}`).join('\n')}\n\nالتقرير الكامل: ${link}`;
  return { subject: `تقرير الزوار · ${doc.name} · ${when}`, html, text };
}
