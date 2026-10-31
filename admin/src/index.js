// Cajun App Factory admin (admin.cajunappfactory.com). Every request passes the Cloudflare Access gate first; anything else is 403.
import { verifyAccess, ALLOWED_EMAIL } from './access.js';
import * as SS from './stopscope.js';
import { PAGE } from './ui.js';
import * as ST from './stats.js';
import * as PL from './play.js';
import * as AD from './admins.js';
import * as DV from './device.js';
import { handleApp } from './app.js';
import { sendMail, resetMail, randomToken, sha256, rateOk } from './mail.js';

const SEC = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...SEC, 'Content-Type': 'application/json; charset=utf-8' } });
const forbidden = () => new Response('Forbidden', { status: 403, headers: { ...SEC, 'Content-Type': 'text/plain' } });

export async function handle(req, env, opts = {}) {
  if (!opts.appWho && new URL(req.url).pathname.startsWith('/api/app/')) return handleApp(req, env, opts, handle);          // 0.2.0 native app (own auth)
  const who = opts.appWho || await verifyAccess(req, env, opts);
  if (!who) return forbidden();
  const url = new URL(req.url), path = url.pathname, m = req.method;
  if (opts.appWho && !path.startsWith('/api/')) return forbidden();
  if (m === 'GET' && path === '/invite') {          // 10-29: accept an invite (Access already checked the email is on the policy)
    if (!env.DB) return json({ error: 'no_db' }, 503);
    const [st, k] = await AD.accept(env.DB, who.email, url.searchParams.get('t'));
    const msg = { ok: 'You’re in. Install the Cajun App Factory Admin app and set up your fingerprint, or open admin.cajunappfactory.com.', gone: 'This invite link was already used, revoked or has expired. Ask for a new invite.', wrong_email: 'This invite is for a different email address. Sign out and sign in with the invited email.' }[k];
    return new Response(`<!doctype html><meta name="viewport" content="width=device-width"><title>Cajun App Factory Admin</title><link rel="stylesheet" href="/admin.css"><main class="wrap"><h1>Cajun App Factory Admin</h1><p>${msg}</p>${k === 'ok' ? '<p><a class="btn" href="/">Open Admin</a></p>' : ''}</main>`, { status: st, headers: { ...SEC, 'Content-Type': 'text/html; charset=utf-8' } });
  }
  const role = env.DB ? await AD.roleOf(env.DB, who.email).catch(() => null) : (who.email === ALLOWED_EMAIL ? 'owner' : null);
  if (!role) return forbidden();
  const actor = role === 'owner' ? env.ADMIN_USER_ID : who.email;          // admin_audit.admin_user_id: owner's user id, or the invited admin's email
  if (m === 'GET' && (path === '/' || path === '/apps/stopscope' || path === '/apps/stopscope/users' || path === '/admins')) return new Response(PAGE.html, { headers: { ...SEC, 'Content-Type': 'text/html; charset=utf-8' } });
  if (m === 'GET' && path === '/admin.js') return new Response(PAGE.js, { headers: { ...SEC, 'Content-Type': 'text/javascript; charset=utf-8' } });
  if (m === 'GET' && path === '/admin.css') return new Response(PAGE.css, { headers: { ...SEC, 'Content-Type': 'text/css; charset=utf-8' } });
  if (m === 'GET' && path === '/api/me') return json({ email: who.email, role, invites: AD.invitesOn(env) });
  if (m === 'POST' && path.startsWith('/api/device/')) {          // step 2: phone enrol / challenge / verify (no unlock needed for these)
    if (req.headers.get('X-Admin') !== '1' || req.headers.get('Origin') !== url.origin) return json({ error: 'csrf' }, 403);
    let b = {}; try { b = await req.json(); } catch {}
    const [st, r, cookie] = path === '/api/device/enrol' ? await DV.enrol(env.DB, who, b) : path === '/api/device/challenge' ? await DV.challenge(env.DB, who.email)
      : path === '/api/device/verify' ? await DV.verify(env.DB, who.email, b) : [404, { error: 'not_found' }];
    if (st === 200 && path !== '/api/device/challenge') await SS.audit(env.DB, actor, path.slice(12) === 'enrol' ? 'device-enrol' : 'device-unlock', 'admin', String(r.key_id || b.key_id || '').slice(0, 64), who.email);
    const res = json(r, st); if (cookie) res.headers.append('Set-Cookie', cookie); return res;
  }
  if (!opts.appWho && DV.fromApp(req) && path.startsWith('/api/') && !(await DV.unlocked(env.DB, req, who.email))) return json({ error: 'locked' }, 403);          // app requests need a fingerprint unlock; desktop doesn't
  if (path.startsWith('/api/admins')) {          // owner only: invite, revoke, remove
    if (role !== 'owner') return json({ error: 'owner_only' }, 403);
    if (m === 'GET' && path === '/api/admins') return json({ ...(await AD.list(env.DB)), devices: await DV.list(env.DB), invites_on: AD.invitesOn(env) });
    if (m === 'POST' && path === '/api/admins/device-revoke') {          // works even when invites are off
      if (req.headers.get('X-Admin') !== '1' || req.headers.get('Origin') !== url.origin) return json({ error: 'csrf' }, 403);
      let b = {}; try { b = await req.json(); } catch {}
      const [st, r] = await DV.revoke(env.DB, b.id);
      if (st === 200) await SS.audit(env.DB, actor, 'device-revoke', 'admin', String(b.id).slice(0, 64), null);
      return json(r, st);
    }
    if (m !== 'POST') return json({ error: 'not_found' }, 404);
    if (req.headers.get('X-Admin') !== '1' || req.headers.get('Origin') !== url.origin) return json({ error: 'csrf' }, 403);
    if (!AD.invitesOn(env)) return json({ error: 'invites_off' }, 503);
    let b; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
    const o = opts.access || {};
    try {
      const [st, r] = path === '/api/admins/invite' ? await AD.invite(env, who.email, b.email, o)
        : path === '/api/admins/revoke' ? await AD.revokeInvite(env, b.id, o)
        : path === '/api/admins/remove' ? await AD.remove(env, b.email, o) : [404, { error: 'not_found' }];
      if (st < 300 || r.id) await SS.audit(env.DB, actor, path.slice(12), 'admin', String(b.id || b.email || '').slice(0, 64), String(b.email || '').slice(0, 254) || null);
      return json(r, st);
    } catch (e) { return json({ error: 'access_api' }, 502); }          // Access API failed: nothing was written
  }
  if (!path.startsWith('/api/apps/stopscope/')) return json({ error: 'not_found' }, 404);
  if (!env.DB) return json({ error: 'no_db' }, 503);
  const sub = path.slice('/api/apps/stopscope/'.length);
  if (m === 'GET' && sub === 'overview') return json(await SS.overview(env.DB));
  if (m === 'GET' && sub === 'play') return json(await PL.cached(env.DB));
  if (m === 'GET' && sub === 'stats') return json(await ST.all_(env.DB));
  if (m === 'GET' && sub === 'users') return json(await SS.listUsers(env.DB, { q: url.searchParams.get('q'), page: url.searchParams.get('page'), type: url.searchParams.get('type') }));
  if (m === 'GET' && sub === 'user') {
    const d = await SS.userDetail(env.DB, url.searchParams.get('kind'), url.searchParams.get('id'));
    return d ? json(d) : json({ error: 'not_found' }, 404);
  }
  if (m === 'POST' && sub === 'toggle') {
    // CSRF: same-origin fetch only (custom header + Origin), on top of Access
    if (req.headers.get('X-Admin') !== '1' || req.headers.get('Origin') !== url.origin) return json({ error: 'csrf' }, 403);
    if (!env.ADMIN_USER_ID) return json({ error: 'no_admin_id' }, 503);
    let b; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
    const what = b && b.what, on = b && b.on;
    if (!['pro_comp', 'dispatch_license'].includes(what) || typeof on !== 'boolean') return json({ error: 'bad_action' }, 400);
    const t = await SS.target(env.DB, String(b.kind || ''), b.id);
    if (!t) return json({ error: 'not_found' }, 404);
    if (what === 'pro_comp') {
      await SS.setProComp(env.DB, t, on);
      // one audit line per account changed (app and/or web)
      for (const [k, id] of [['app', t.appId], ['web', t.webId]]) if (id) await SS.audit(env.DB, actor, on ? 'pro-comp-on' : 'pro-comp-off', k, id, t.email);
      return json({ ok: true, pro_comp: on });
    }
    const r = await SS.setLicense(env.DB, t, on);
    if (!r) return json({ error: 'no_owned_company' }, 409);
    await SS.audit(env.DB, actor, on ? 'license-on' : 'license-off', t.kind, t.id, t.email);
    return json({ ok: true, dispatch_license: on });
  }
  if (m === 'POST' && sub === 'action') {          // 10-29: stopscope.com admin parity (tutorial, sign out everywhere)
    if (req.headers.get('X-Admin') !== '1' || req.headers.get('Origin') !== url.origin) return json({ error: 'csrf' }, 403);
    if (!env.ADMIN_USER_ID) return json({ error: 'no_admin_id' }, 503);
    let b; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
    const what = b && b.what;
    if (!['tutorial', 'signout', 'reset-email'].includes(what)) return json({ error: 'bad_action' }, 400);
    const t = await SS.target(env.DB, String(b.kind || ''), b.id);
    if (!t) return json({ error: 'not_found' }, 404);
    if (what === 'tutorial') {
      if (!t.appId) return json({ error: 'no_app_account' }, 409);
      const v = await SS.resetTutorial(env.DB, t.appId);
      await SS.audit(env.DB, actor, 'tutorial', t.kind, t.id, t.email);
      return json({ ok: true, tutorial: v });
    }
    if (what === 'reset-email') {          // stopscope-web: the normal /forgot token + text, same 3/h per-email cap; the admin never sees a password
      const web = t.webId ? await env.DB.prepare('SELECT email FROM users WHERE id=? AND pw_hash IS NOT NULL').bind(t.webId).first() : null;
      if (!web) return json({ error: 'google_only' }, 409);
      if (!env.EMAIL) return json({ error: 'email_off' }, 503);
      if (!(await rateOk(env.DB, 'fg:' + web.email, 3, 60 * 60e3))) return json({ error: 'rate_limited' }, 429);
      const tok = randomToken(32);
      await env.DB.batch([env.DB.prepare("DELETE FROM email_tokens WHERE user_id=? AND purpose='reset'").bind(t.webId),
        env.DB.prepare("INSERT INTO email_tokens (token_hash,user_id,purpose,expires_at) VALUES (?,?,'reset',?)").bind(await sha256(tok), t.webId, Date.now() + 30 * 60e3)]);
      const sent = await sendMail(env, { to: web.email, ...resetMail('https://stopscope.com/reset?t=' + tok) });
      if (sent !== 'sent') return json({ error: 'mail_' + sent }, 503);
      await SS.audit(env.DB, actor, 'reset-email', t.kind, t.id, t.email);
      return json({ ok: true });
    }
    await SS.signOutAll(env.DB, t);
    await SS.audit(env.DB, actor, 'signout', t.kind, t.id, t.email);
    return json({ ok: true });
  }
  return json({ error: 'not_found' }, 404);
}
export default { fetch: (req, env) => handle(req, env), scheduled: (ev, env, ctx) => ctx.waitUntil(PL.refresh(env)) };
