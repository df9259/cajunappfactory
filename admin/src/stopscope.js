// StopScope admin data (D1 stopscope-dispatch). Queries and semantics mirror stopscope-web src/admin.js.
// Never selects password hashes/salts, tokens or Stripe ids.
export const PER_PAGE = 50;
const likeEsc = (q) => '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
const ROWS = `WITH rows AS (
  SELECT 'app' AS kind, a.id, a.email, a.name, CASE WHEN a.google_sub IS NOT NULL THEN 'Google' ELSE 'Password' END AS method,
    a.created_at, a.last_sign_in_at AS last, d.id AS driver_id, d.account_deleted_at AS deleted_at,
    c.id AS company_id, c.name AS company, NULL AS role, c.free_license, COALESCE(a.pro_comp,0) AS comp,
    MAX(COALESCE(a.last_seen_at, 0), a.last_sign_in_at) AS seen, a.last_seen_at, a.sign_in_count, CASE WHEN d.id IS NULL THEN 'personal' ELSE 'dispatch' END AS aud
  FROM app_users a LEFT JOIN drivers d ON d.email = a.email COLLATE NOCASE LEFT JOIN companies c ON c.id = d.company_id
  UNION ALL
  SELECT 'web', u.id, u.email, u.name,
    CASE WHEN u.google_sub IS NOT NULL AND u.pw_hash IS NOT NULL THEN 'Google + password' WHEN u.google_sub IS NOT NULL THEN 'Google' ELSE 'Password' END,
    u.created_at, (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id), NULL, NULL,
    c.id, c.name, m.role, c.free_license, COALESCE(u.pro_comp,0),
    (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id), NULL, u.sign_in_count, 'dispatch'
  FROM users u LEFT JOIN memberships m ON m.user_id = u.id LEFT JOIN companies c ON c.id = m.company_id)
SELECT * FROM rows WHERE (? = '' OR aud = ?) AND (? = 0 OR comp = 1) AND (? = '' OR email LIKE ? ESCAPE '\\' OR COALESCE(name,'') LIKE ? ESCAPE '\\' OR COALESCE(company,'') LIKE ? ESCAPE '\\')`;

export async function listUsers(db, { q = '', page = 1, type = '' } = {}) {
  q = String(q || '').trim().slice(0, 100);
  const pro = type === 'pro' ? 1 : 0;
  const aud = type === 'personal' || type === 'dispatch' ? type : '';
  page = Math.max(1, Math.min(10000, Math.floor(Number(page)) || 1));
  const like = likeEsc(q.toLowerCase());
  const b = [aud, aud, pro, q, like, like, like];
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM (${ROWS})`).bind(...b).first())?.n || 0;
  const rs = (await db.prepare(`${ROWS} ORDER BY COALESCE(seen, 0) DESC, email LIMIT ? OFFSET ?`).bind(...b, PER_PAGE, (page - 1) * PER_PAGE).all()).results || [];
  const users = rs.map((r) => ({ kind: r.kind, id: r.id, email: r.email, name: r.name || null, method: r.method, created_at: r.created_at,
    last_sign_in_at: r.last || null, last_app_open: r.kind === 'app' ? (r.last_seen_at || null) : null, sign_ins: r.sign_in_count || 0,
    type: r.aud, driver: !!r.driver_id, deleted: !!r.deleted_at, company: r.company || null, role: r.role || null,
    free_license: !!(r.company && r.free_license), pro_comp: !!r.comp, pro_play: null }));
  return { q, type: pro ? 'pro' : aud, page, pages: Math.max(1, Math.ceil(total / PER_PAGE)), total, per_page: PER_PAGE, users };
}

export async function overview(db, now = Date.now()) {
  const wk = now - 7 * 86400e3;
  const n = async (sql, ...b) => (await db.prepare(sql).bind(...b).first())?.n || 0;
  const app = await n('SELECT COUNT(*) n FROM app_users'), web = await n('SELECT COUNT(*) n FROM users');
  const personal = await n('SELECT COUNT(*) n FROM app_users a WHERE NOT EXISTS (SELECT 1 FROM drivers d WHERE d.email = a.email COLLATE NOCASE)');
  const active = await n('SELECT COUNT(*) n FROM app_users WHERE MAX(COALESCE(last_seen_at,0), last_sign_in_at) >= ?', wk)
    + await n('SELECT COUNT(DISTINCT user_id) n FROM sessions WHERE created_at >= ?', wk);
  const pro_comp = await n('SELECT COUNT(*) n FROM (SELECT LOWER(email) e FROM app_users WHERE pro_comp=1 UNION SELECT LOWER(email) FROM users WHERE pro_comp=1)');
  const out = { app_users: app, website_users: web, personal, active_7d: active, pro_comp,
    companies: await n('SELECT COUNT(*) n FROM companies'), free_license_companies: await n('SELECT COUNT(*) n FROM companies WHERE free_license=1'),
    drivers: await n('SELECT COUNT(*) n FROM drivers WHERE account_deleted_at IS NULL'), dispatch_routes: await n('SELECT COUNT(*) n FROM routes'),
    not_connected: { installs: 'Not connected yet', rating: 'Not connected yet', crash_free: 'Not connected yet' } };
  // sign-ups per day, last 30 days (UTC), app + website
  const since = now - 30 * 86400e3;
  const rows = (await db.prepare(`SELECT d, COUNT(*) n FROM (SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') d FROM app_users WHERE created_at >= ?
    UNION ALL SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') FROM users WHERE created_at >= ?) GROUP BY d`).bind(since, since).all()).results || [];
  const m = Object.fromEntries(rows.map((r) => [r.d, r.n])); out.signups = [];
  for (let i = 29; i >= 0; i--) { const d = new Date(now - i * 86400e3).toISOString().slice(0, 10); out.signups.push({ day: d, n: m[d] || 0 }); }
  const g = await n('SELECT COUNT(*) n FROM app_users WHERE google_sub IS NOT NULL') + await n('SELECT COUNT(*) n FROM users WHERE google_sub IS NOT NULL');
  out.methods = { google: g, password: app + web - g };
  out.recent_actions = (await db.prepare('SELECT action, target_kind, target_email, created_at FROM admin_audit ORDER BY created_at DESC, id DESC LIMIT 10').all()).results || [];
  return out;
}

/** The person behind a row plus the same email in the other table (stopscope-web target()). */
export async function target(db, kind, id) {
  id = String(id || '').slice(0, 64);
  const t = kind === 'app' ? await db.prepare('SELECT id, email, web_user_id FROM app_users WHERE id=?').bind(id).first()
    : kind === 'web' ? await db.prepare('SELECT id, email FROM users WHERE id=?').bind(id).first() : null;
  if (!t) return null;
  const app = kind === 'app' ? t : await db.prepare('SELECT id FROM app_users WHERE email=? COLLATE NOCASE').bind(t.email).first();
  const web = kind === 'web' ? t : (t.web_user_id ? await db.prepare('SELECT id, email FROM users WHERE id=?').bind(t.web_user_id).first() : null)
    || await db.prepare('SELECT id, email FROM users WHERE email=? COLLATE NOCASE').bind(t.email).first();
  return { kind, id: t.id, email: t.email, appId: app ? app.id : null, webId: web ? web.id : null };
}
/** Company this person owns on the website (the one a Dispatch license applies to). */
const ownedCompany = (db, webId) => webId ? db.prepare("SELECT c.id, c.name, c.free_license FROM memberships m JOIN companies c ON c.id=m.company_id WHERE m.user_id=? AND m.role='owner'").bind(webId).first() : null;

const APIS = ['geocode', 'routes', 'optimize', 'matrix', 'points', 'proof'];
export async function userDetail(db, kind, id, now = Date.now()) {
  const t = await target(db, kind, id); if (!t) return null;
  const app = t.appId ? await db.prepare('SELECT id, name, created_at, last_sign_in_at, last_seen_at, sign_in_count, COALESCE(pro_comp,0) pc, google_sub IS NOT NULL g FROM app_users WHERE id=?').bind(t.appId).first() : null;
  const web = t.webId ? await db.prepare('SELECT id, name, created_at, sign_in_count, email_verified_at, COALESCE(pro_comp,0) pc, google_sub IS NOT NULL g, pw_hash IS NOT NULL p FROM users WHERE id=?').bind(t.webId).first() : null;
  const co = await ownedCompany(db, t.webId);
  const member = !co && t.webId ? await db.prepare('SELECT c.name, m.role FROM memberships m JOIN companies c ON c.id=m.company_id WHERE m.user_id=?').bind(t.webId).first() : null;
  const drv = await db.prepare('SELECT d.id, c.name FROM drivers d JOIN companies c ON c.id=d.company_id WHERE d.email=? COLLATE NOCASE AND d.account_deleted_at IS NULL').bind(t.email).first();
  const day = (x) => new Date(x).toISOString().slice(0, 10), wk = day(now - 6 * 86400e3);
  const usage = {}; for (const a of APIS) usage[a] = 0;
  for (const [k, uid] of [['app', t.appId], ['web', t.webId]]) if (uid) {
    const rs = (await db.prepare('SELECT api, SUM(count) c FROM user_usage WHERE kind=? AND user_id=? AND day>=? GROUP BY api').bind(k, uid, wk).all()).results || [];
    for (const r of rs) if (r.api in usage) usage[r.api] += r.c;
  }
  let routes = null, stops_done = null;
  const cid = co ? co.id : null;
  if (cid) {
    routes = (await db.prepare('SELECT COUNT(*) n FROM routes WHERE company_id=?').bind(cid).first())?.n || 0;
    stops_done = (await db.prepare("SELECT COUNT(*) n FROM route_stops WHERE company_id=? AND status='done'").bind(cid).first())?.n || 0;
  } else if (drv) {
    routes = (await db.prepare('SELECT COUNT(*) n FROM routes WHERE driver_id=?').bind(drv.id).first())?.n || 0;
    stops_done = (await db.prepare("SELECT COUNT(*) n FROM route_stops s JOIN routes r ON r.id=s.route_id WHERE r.driver_id=? AND s.status='done'").bind(drv.id).first())?.n || 0;
  }
  const methods = new Set(); for (const x of [app, web]) if (x) { if (x.g) methods.add('Google'); if (x.p) methods.add('Password'); }
  if (app && !app.g) methods.add('Password');
  return { kind: t.kind, id: t.id, email: t.email, name: (app && app.name) || (web && web.name) || null,
    app_account: !!app, website_account: !!web, sign_in: [...methods].join(' + ') || null,
    joined: Math.min(...[app && app.created_at, web && web.created_at].filter(Boolean)) || null,
    sign_ins: ((app && app.sign_in_count) || 0) + ((web && web.sign_in_count) || 0),
    last_app_open: app ? app.last_seen_at || null : null,
    company: co ? co.name : member ? member.name : drv ? drv.name : null, role: co ? 'owner' : member ? member.role : drv ? 'driver' : null,
    pro_comp: !!((app && app.pc) || (web && web.pc)), pro_play: null,
    dispatch_license: co ? !!co.free_license : null, license_toggle: !!co,
    routes, stops_done, usage_7d: usage,
    audit: (await db.prepare('SELECT action, created_at FROM admin_audit WHERE target_email=? COLLATE NOCASE ORDER BY created_at DESC, id DESC LIMIT 20').bind(t.email).all()).results || [] };
}

export async function audit(db, adminId, action, kind, id, email, now = Date.now()) {
  await db.prepare('INSERT INTO admin_audit (admin_user_id,action,target_kind,target_id,target_email,created_at) VALUES (?,?,?,?,?,?)').bind(adminId, action, kind, id, email || null, now).run();
}
/** stopscope-web setProComp: both linked accounts. */
export async function setProComp(db, t, on) {
  const v = on ? 1 : 0;
  if (t.appId) await db.prepare('UPDATE app_users SET pro_comp=? WHERE id=?').bind(v, t.appId).run();
  if (t.webId) await db.prepare('UPDATE users SET pro_comp=? WHERE id=?').bind(v, t.webId).run();
  return !!on;
}
/** Dispatch license = companies.free_license on the company this person owns (same write as stopscope-web claimGrants). */
export async function setLicense(db, t, on) {
  const co = await ownedCompany(db, t.webId); if (!co) return null;
  if (on) await db.prepare('UPDATE companies SET free_license=1, billing_ended_at=NULL WHERE id=?').bind(co.id).run();
  else await db.prepare('UPDATE companies SET free_license=0 WHERE id=?').bind(co.id).run();
  return { company_id: co.id, on: !!on };
}
