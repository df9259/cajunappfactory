// 10-29 0.2.0: API for the native Android app under /api/app/* (Access bypasses this path; the Worker does every check).
// Sign in: Google ID token (Credential Manager, aud = the web OAuth client) or a 6-digit emailed code -> app session (Bearer).
// Then step 2's enrol / challenge / verify; every data call also needs the fingerprint unlock (X-Unlock). Email must be an admin.
import { roleOf } from './admins.js';
import * as DV from './device.js';
import { randomToken, sha256, rateOk, sendMail } from './mail.js';
import * as SS from './stopscope.js';
export const SESSION_MAX = 30 * 86400e3, SESSION_IDLE = 7 * 86400e3, CODE_TTL = 10 * 60e3;
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const ub = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const dec = (s) => JSON.parse(new TextDecoder().decode(ub(s)));
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: H });
let gcache = { at: 0, keys: [] };
export const _resetGoogle = () => { gcache = { at: 0, keys: [] }; };

/** Verified Google ID token -> { email } or null. RS256 with Google's keys, iss, aud = env.GOOGLE_WEB_CLIENT_ID, exp, email_verified. */
export async function verifyGoogle(tok, env, fetcher = fetch, now = Date.now()) {
  try {
    const parts = String(tok || '').split('.'); if (parts.length !== 3 || !env.GOOGLE_WEB_CLIENT_ID) return null;
    const h = dec(parts[0]), p = dec(parts[1]);
    if (h.alg !== 'RS256' || !h.kid) return null;
    if (!gcache.keys.some((k) => k.kid === h.kid) || now - gcache.at > 3600e3) {
      if (now - gcache.at > 30e3 || !gcache.keys.length) { const r = await fetcher(GOOGLE_CERTS); if (r.ok) gcache = { at: now, keys: ((await r.json()).keys || []).filter((k) => k.kty === 'RSA') }; }
    }
    const jwk = gcache.keys.find((k) => k.kid === h.kid); if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, ub(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1])))) return null;
    const t = now / 1000;
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(p.iss)) return null;
    if ((Array.isArray(p.aud) ? p.aud : [p.aud]).indexOf(env.GOOGLE_WEB_CLIENT_ID) < 0) return null;
    if (typeof p.exp !== 'number' || p.exp < t - 30 || (typeof p.iat === 'number' && p.iat > t + 300)) return null;
    if (p.email_verified !== true && p.email_verified !== 'true') return null;
    const email = String(p.email || '').toLowerCase();
    return email ? { email } : null;
  } catch { return null; }
}
async function newSession(db, email, method, now) {
  const tok = randomToken(32);
  await db.prepare('INSERT INTO caf_app_sessions (token_hash,email,method,created_at,last_at) VALUES (?,?,?,?,?)').bind(await sha256(tok), email, method, now, now).run();
  return tok;
}
async function session(db, req, now, unlockedFor) {
  const m = /^Bearer ([\w-]{20,100})$/.exec(req.headers.get('Authorization') || ''); if (!m) return null;
  const s = await db.prepare('UPDATE caf_app_sessions SET last_at=? WHERE token_hash=? AND revoked_at IS NULL AND created_at>? AND last_at>? RETURNING email, created_at')
    .bind(now, await sha256(m[1]), now - SESSION_MAX, now - SESSION_IDLE).first();
  if (!s) return null;
  const [role, unl] = await Promise.all([roleOf(db, s.email), unlockedFor ? unlockedFor(s.email) : false]);          // removed admins lose the app at once; 10-29: unlock check in parallel
  return role ? { email: s.email, iat: Math.floor(s.created_at / 1000), role, hash: await sha256(m[1]), unl } : null;
}
const codeMail = (code) => ({ from: { email: 'no-reply@cajunappfactory.com', name: 'Cajun App Factory' }, subject: 'Your Cajun App Factory Admin sign-in code',
  text: `Your sign-in code for the Cajun App Factory Admin app is:\n\n${code}\n\nIt expires in 10 minutes. If you didn’t ask for it, ignore this email.\n\n— Cajun App Factory`,
  html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#222;line-height:1.5"><p>Your sign-in code for the Cajun App Factory Admin app is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. If you didn’t ask for it, ignore this email.</p><p style="color:#777;font-size:12px">— Cajun App Factory</p></body></html>` });

/** All of /api/app/*. `inner` is the main handler, called with the app session as the identity for data routes. */
export async function handleApp(req, env, opts, inner) {
  const now = opts.now || Date.now(), url = new URL(req.url), sub = url.pathname.slice('/api/app/'.length), m = req.method, db = env.DB;
  if (!db) return json({ error: 'no_db' }, 503);
  let b = {}; if (m === 'POST') { try { b = await req.json(); } catch {} }
  const ip = req.headers.get('CF-Connecting-IP') || 'x';
  if (m === 'POST' && sub === 'login/google') {
    if (!(await rateOk(db, 'cafapplogin:' + ip, 30, 3600e3, now))) return json({ error: 'rate_limited' }, 429);
    const g = await verifyGoogle(b.id_token, env, opts.googleFetcher || fetch, now);
    if (!g) return json({ error: 'bad_token' }, 401);
    if (!(await roleOf(db, g.email))) return json({ error: 'not_admin' }, 403);
    await SS.audit(db, g.email, 'app-sign-in', 'admin', 'google', g.email);
    return json({ session: await newSession(db, g.email, 'google', now), email: g.email });
  }
  if (m === 'POST' && sub === 'login/code-send') {          // always "ok" (no admin-list probing); mails only admins
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: 'bad_email' }, 400);
    if (!(await rateOk(db, 'cafappcode:' + email, 5, 3600e3, now)) || !(await rateOk(db, 'cafappcodeip:' + ip, 20, 3600e3, now))) return json({ error: 'rate_limited' }, 429);
    if (await roleOf(db, email)) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0');
      await db.prepare('INSERT INTO caf_app_codes (email,code_hash,expires_at,tries) VALUES (?,?,?,0) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, tries=0')
        .bind(email, await sha256(email + ':' + code), now + CODE_TTL).run();
      await sendMail(env, { to: email, ...codeMail(code) }, now);
    }
    return json({ ok: true });
  }
  if (m === 'POST' && sub === 'login/code') {
    const email = String(b.email || '').trim().toLowerCase(), code = String(b.code || '');
    const r = await db.prepare('UPDATE caf_app_codes SET tries=tries+1 WHERE email=? AND expires_at>? AND tries<5 RETURNING code_hash').bind(email, now).first();
    if (!r || !/^\d{6}$/.test(code) || r.code_hash !== (await sha256(email + ':' + code))) return json({ error: 'bad_code' }, 401);
    await db.prepare('DELETE FROM caf_app_codes WHERE email=?').bind(email).run();          // single use
    if (!(await roleOf(db, email))) return json({ error: 'not_admin' }, 403);
    await SS.audit(db, email, 'app-sign-in', 'admin', 'code', email);
    return json({ session: await newSession(db, email, 'code', now), email });
  }
  const who = await session(db, req, now, (e) => DV.unlocked(db, req, e, now));
  if (!who) return json({ error: 'signed_out' }, 401);
  const actor = who.email;
  if (m === 'POST' && sub === 'logout') { await db.prepare('UPDATE caf_app_sessions SET revoked_at=? WHERE token_hash=?').bind(now, who.hash).run(); return json({ ok: true }); }
  if (m === 'POST' && ['enrol', 'challenge', 'verify'].includes(sub)) {          // step 2 flow; enrol only within 15 min of this app sign-in
    const aud = db.prepare('INSERT INTO admin_audit (admin_user_id,action,target_kind,target_id,target_email,created_at) VALUES (?,?,?,?,?,?)').bind(actor, 'device-unlock', 'admin', String(b.key_id || '').slice(0, 64), who.email, now);
    const [st, r, cookie] = sub === 'enrol' ? await DV.enrol(db, who, b, now) : sub === 'challenge' ? await DV.challenge(db, who.email, now) : await DV.verify(db, who.email, b, now, [aud]);          // 10-29: unlock audit in the same batch
    if (sub === 'verify' && st === 200) r.role = who.role;          // 0.2.2 skips GET me; older apps ignore it
    if (st === 200 && sub === 'enrol') await SS.audit(db, actor, 'device-enrol', 'admin', String(r.key_id || '').slice(0, 64), who.email);
    if (cookie) r.unlock = /^caf_unlock=([\w-]+)/.exec(cookie)[1];
    return json(r, st);
  }
  if (!who.unl) return json({ error: 'locked' }, 403);
  if (!(sub === 'me' || sub === 'admins' || sub.startsWith('admins/') || sub.startsWith('apps/stopscope/'))) return json({ error: 'not_found' }, 404);
  // Data: the same handlers as the web admin, with the app session as the identity (no Access cookie, no CSRF: Bearer token).
  const headers = new Headers({ 'X-Admin': '1', Origin: url.origin }); if (m === 'POST') headers.set('Content-Type', 'application/json');
  const r2 = new Request(url.origin + '/api/' + sub + url.search, { method: m, headers, body: m === 'POST' ? JSON.stringify(b) : undefined });
  return inner(r2, env, { ...opts, appWho: { email: who.email, iat: who.iat } });
}
