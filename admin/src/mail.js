// 10-29: email from the caf admin through Cloudflare Email Service (send_email binding EMAIL).
// Shares stopscope-web's monthly cap (rate key mail:<YYYY-MM>, 2,500 < 3,000 included with Workers Paid): no overage.
const enc = new TextEncoder(), b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomToken = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
export const sha256 = async (s) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s)));          // same format as stopscope-web crypto.js
export const MONTHLY_CAP = 2500, REPLY_TO = 'support@cajunappfactory.com';
export async function rateOk(db, key, limit, windowMs, now = Date.now()) {          // stopscope-web d1RateLimit
  const row = await db.prepare(`INSERT INTO rate_counters (key,window_start,count) VALUES (?,?,1)
     ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END, window_start = excluded.window_start
     RETURNING count`).bind(key, now - (now % windowMs)).first();
  return row.count <= limit;
}
/** 'sent' | 'cap' | 'off' | 'error'. Plain text + simple HTML, real Reply-To, List-Unsubscribe, no images or tracking. */
export async function sendMail(env, { to, from, subject, text, html }, now = Date.now()) {
  if (!env.EMAIL) return 'off';
  if (!(await rateOk(env.DB, 'mail:' + new Date(now).toISOString().slice(0, 7), MONTHLY_CAP, 1e15, now))) return 'cap';
  try {
    await env.EMAIL.send({ to, from, replyTo: REPLY_TO, subject, text, html,
      headers: { 'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=unsubscribe>` } });
    return 'sent';
  } catch (e) { console.error('mail', String(e?.code || e?.message || e).slice(0, 80)); return 'error'; }
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const htmlOf = (title, paras, link, label) => `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#222;line-height:1.5"><p><b>${esc(title)}</b></p>${paras.map((p) => `<p>${esc(p)}</p>`).join('')}<p><a href="${esc(link)}">${esc(label)}</a></p><p style="color:#777;font-size:12px">If you weren’t expecting this, ignore it and nothing changes. Questions: reply to this email.</p></body></html>`;
// Reset: same text and link as stopscope-web (the account lives on stopscope.com, so the sender and link stay there).
export const resetMail = (link) => ({ from: { email: 'no-reply@stopscope.com', name: 'StopScope' }, subject: 'Reset your StopScope password',
  text: `Use this link to choose a new StopScope password:\n\n${link}\n\nIt works once and expires in 30 minutes. If you didn’t ask for this, your password hasn’t changed.\n\n— StopScope Dispatch\nIf you didn’t expect this email, you can ignore it.`,
  html: htmlOf('Reset your StopScope password', ['Use the link below to choose a new StopScope password. It works once and expires in 30 minutes.', 'If you didn’t ask for this, your password hasn’t changed.'], link, 'Choose a new password') });
export const inviteMail = (link) => ({ from: { email: 'no-reply@cajunappfactory.com', name: 'Cajun App Factory' }, subject: 'You’re invited to Cajun App Factory Admin',
  text: `Dominic Fontenot invited you to help run Cajun App Factory apps.\n\nAccept the invite:\n${link}\n\nSign in with this email address (Google or an email code). Then install the Cajun App Factory Admin app and set up your fingerprint.\n\nThis link works once and expires in 7 days. If you weren’t expecting it, ignore this email and nothing happens.\n\n— Cajun App Factory`,
  html: htmlOf('You’re invited to Cajun App Factory Admin', ['Dominic Fontenot invited you to help run Cajun App Factory apps.', 'Sign in with this email address (Google or an email code). Then install the Cajun App Factory Admin app and set up your fingerprint.', 'This link works once and expires in 7 days.'], link, 'Accept invite') });
