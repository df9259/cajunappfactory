// Cajun App Factory admin (admin.cajunappfactory.com). Every request passes the Cloudflare Access gate first; anything else is 403.
import { verifyAccess } from './access.js';
import * as SS from './stopscope.js';
import { PAGE } from './ui.js';
import * as ST from './stats.js';

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
      await SS.audit(env.DB, env.ADMIN_USER_ID, on ? 'pro-comp-on' : 'pro-comp-off', t.kind, t.id, t.email);
      return json({ ok: true, pro_comp: on });
    }
    const r = await SS.setLicense(env.DB, t, on);
    if (!r) return json({ error: 'no_owned_company' }, 409);
    await SS.audit(env.DB, env.ADMIN_USER_ID, on ? 'license-on' : 'license-off', t.kind, t.id, t.email);
    return json({ ok: true, dispatch_license: on });
  }
  return json({ error: 'not_found' }, 404);
}
export default { fetch: (req, env) => handle(req, env) };
