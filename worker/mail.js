// Mail out: Cloudflare Email Service, or Resend when its key is set; never fails the request that sends it.


// one way out for every message: Cloudflare Email Service when the worker has the binding (EMAIL), else Resend (RESEND_KEY). 1 = sent
export async function mail(env, m) { const from = env.MAIL_FROM || 'noreply@basserh.com';
  try { if (env.EMAIL) { await env.EMAIL.send({ from: { email: from, name: 'بصيرة · استوديو اللقاءات' }, to: m.to, replyTo: m.replyTo, subject: m.subject, text: m.text, html: m.html }); return 1; }
    if (env.RESEND_KEY) return (await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.CONTACT_FROM || `Basserh Live <${from}>`, to: [m.to], reply_to: m.replyTo, subject: m.subject, text: m.text, html: m.html }) })).ok ? 1 : 0;
  } catch (x) { console.log('mail', x.message); } return 0; }
// the invitation by mail: the same one time link the page shows, so the owner need not copy it by hand
export const mailJoin = (env, origin, email, join, orgName) => mail(env, { to: email, subject: `دعوة إلى استوديو اللقاءات · ${orgName}`, text: `السلام عليكم،\n\nدُعيتم إلى ${orgName} في استوديو اللقاءات. الدخول من هذا الرابط، ويُستعمل مرة واحدة خلال 14 يوماً:\n${origin + join}\n\nبصيرة`,
  html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:16px;line-height:1.9;color:#1F2A2E;max-width:520px"><p>السلام عليكم،</p><p>دُعيتم إلى <b>${orgName.replace(/[<>&]/g, '')}</b> في استوديو اللقاءات.</p><p><a href="${origin + join}" style="display:inline-block;background:#B88A3D;color:#fff;text-decoration:none;padding:10px 26px;border-radius:8px">الدخول إلى الاستوديو</a></p><p style="font-size:13px;color:#777">الرابط يُستعمل مرة واحدة خلال 14 يوماً.</p><p>بصيرة</p></div>` });
