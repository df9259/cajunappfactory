// Cajun App Factory admin (admin.cajunappfactory.com). Every request passes the Cloudflare Access gate first; anything else is 403.
import { verifyAccess } from './access.js';
import * as SS from './stopscope.js';
import { PAGE } from './ui.js';
import * as ST from './stats.js';
import * as PL from './play.js';

const SEC = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...SEC, 'Content-Type': 'application/json; charset=utf-8' } });
const forbidden = () => new Response('Forbidden', { status: 403, headers: { ...SEC, 'Content-Type': 'text/plain' } });

export async function handle(req, env, opts = {}) {
  const who = await verifyAccess(req, env, opts);
  if (!who) return forbidden();
  const url = new URL(req.url), path = url.pathname, m = req.method;
  if (m === 'GET' && (path === '/' || path === '/apps/stopscope' || path === '/apps/stopscope/users')) return new Response(PAGE.html, { headers: { ...SEC, 'Content-Type': 'text/html; charset=utf-8' } });
  if (m === 'GET' && path === '/admin.js') return new Response(PAGE.js, { headers: { ...SEC, 'Content-Type': 'text/javascript; charset=utf-8' } });
  if (m === 'GET' && path === '/admin.css') return new Response(PAGE.css, { headers: { ...SEC, 'Content-Type': 'text/css; charset=utf-8' } });
  if (m === 'GET' && path === '/api/me') return json({ email: who.email });
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
      for (const [k, id] of [['app', t.appId], ['web', t.webId]]) if (id) await SS.audit(env.DB, env.ADMIN_USER_ID, on ? 'pro-comp-on' : 'pro-comp-off', k, id, t.email);
      return json({ ok: true, pro_comp: on });
    }
    const r = await SS.setLicense(env.DB, t, on);
    if (!r) return json({ error: 'no_owned_company' }, 409);
    await SS.audit(env.DB, env.ADMIN_USER_ID, on ? 'license-on' : 'license-off', t.kind, t.id, t.email);
    return json({ ok: true, dispatch_license: on });
  }
  if (m === 'POST' && sub === 'action') {          // 10-29: stopscope.com admin parity (tutorial, sign out everywhere)
    if (req.headers.get('X-Admin') !== '1' || req.headers.get('Origin') !== url.origin) return json({ error: 'csrf' }, 403);
    if (!env.ADMIN_USER_ID) return json({ error: 'no_admin_id' }, 503);
    let b; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
    const what = b && b.what;
    if (!['tutorial', 'signout'].includes(what)) return json({ error: 'bad_action' }, 400);
    const t = await SS.target(env.DB, String(b.kind || ''), b.id);
    if (!t) return json({ error: 'not_found' }, 404);
    if (what === 'tutorial') {
      if (!t.appId) return json({ error: 'no_app_account' }, 409);
      const v = await SS.resetTutorial(env.DB, t.appId);
      await SS.audit(env.DB, env.ADMIN_USER_ID, 'tutorial', t.kind, t.id, t.email);
      return json({ ok: true, tutorial: v });
    }
    await SS.signOutAll(env.DB, t);
    await SS.audit(env.DB, env.ADMIN_USER_ID, 'signout', t.kind, t.id, t.email);
    return json({ ok: true });
  }
  return json({ error: 'not_found' }, 404);
}
export default { fetch: (req, env) => handle(req, env), scheduled: (ev, env, ctx) => ctx.waitUntil(PL.refresh(env)) };
