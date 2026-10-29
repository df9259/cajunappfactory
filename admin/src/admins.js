// 10-29 (Dominic): invite admins by email. Owner = ALLOWED_EMAIL only; invited admins get everything except managing admins.
import { ALLOWED_EMAIL } from './access.js';
import { randomToken, sha256, sendMail, inviteMail, rateOk } from './mail.js';
export const INVITE_TTL = 7 * 86400e3, ORIGIN = 'https://admin.cajunappfactory.com';
export const validEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@<>"',;]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(e);
export async function roleOf(db, email) {
  if (email === ALLOWED_EMAIL) return 'owner';
  const r = await db.prepare('SELECT role FROM caf_admins WHERE email=? AND removed_at IS NULL').bind(email).first();
  return r ? r.role : null;
}
export const invitesOn = (env) => !!(env.CF_ACCESS_TOKEN && env.CF_ACCOUNT_ID && env.ACCESS_APP_ID && env.ACCESS_POLICY_ID && env.EMAIL);
/** Add or remove one email on the Access allow policy. Throws on any API failure (callers then change nothing). */
export async function accessPolicy(env, email, add, fetcher = fetch) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/access/apps/${env.ACCESS_APP_ID}/policies/${env.ACCESS_POLICY_ID}`;
  const h = { Authorization: 'Bearer ' + env.CF_ACCESS_TOKEN, 'Content-Type': 'application/json' };
  const g = await fetcher(url, { headers: h }); const j = await g.json().catch(() => ({}));
  if (!g.ok || !j.success) throw new Error('access_get');
  const p = j.result, inc = (p.include || []).filter((x) => !(x.email && x.email.email.toLowerCase() === email));
  if (add) inc.push({ email: { email } });
  if (!inc.some((x) => x.email && x.email.email === ALLOWED_EMAIL)) throw new Error('owner_missing');          // never lock the owner out
  const body = { name: p.name, decision: p.decision, include: inc, exclude: p.exclude || [], require: p.require || [] };
  if (p.session_duration) body.session_duration = p.session_duration;
  if (p.precedence) body.precedence = p.precedence;
  const u = await fetcher(url, { method: 'PUT', headers: h, body: JSON.stringify(body) }); const k = await u.json().catch(() => ({}));
  if (!u.ok || !k.success) throw new Error('access_put');
}
export async function list(db, now = Date.now()) {
  const admins = (await db.prepare('SELECT email, role, added_at FROM caf_admins WHERE removed_at IS NULL ORDER BY added_at').all()).results || [];
  const invites = ((await db.prepare('SELECT id, email, created_at, expires_at FROM caf_invites WHERE used_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 50').all()).results || [])
    .map((i) => ({ ...i, expired: i.expires_at <= now }));
  return { owner: ALLOWED_EMAIL, admins, invites };
}
export async function invite(env, by, email, { now = Date.now(), fetcher = fetch } = {}) {
  email = String(email || '').trim().toLowerCase();
  if (!validEmail(email)) return [400, { error: 'bad_email' }];
  if (await roleOf(env.DB, email)) return [409, { error: 'already_admin' }];
  if (!(await rateOk(env.DB, 'cafinv:' + by, 10, 86400e3, now))) return [429, { error: 'rate_limited' }];
  await accessPolicy(env, email, true, fetcher);          // Access lets them reach /invite; the Worker still refuses them until they accept
  const token = randomToken(32), id = randomToken(12);
  await env.DB.batch([
    env.DB.prepare('UPDATE caf_invites SET revoked_at=? WHERE email=? AND used_at IS NULL AND revoked_at IS NULL').bind(now, email),          // re-invite kills the old link
    env.DB.prepare('INSERT INTO caf_invites (id,email,token_hash,invited_by,created_at,expires_at) VALUES (?,?,?,?,?,?)').bind(id, email, await sha256(token), by, now, now + INVITE_TTL),
  ]);
  const sent = await sendMail(env, { to: email, ...inviteMail(`${ORIGIN}/invite?t=${token}`) }, now);
  return sent === 'sent' ? [200, { ok: true, id }] : [503, { error: 'mail_' + sent, id }];
}
/** Single use: one UPDATE claims the invite only if unused, unrevoked, unexpired and for this signed-in email. */
export async function accept(db, email, token, now = Date.now()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return [410, 'gone'];
  const row = await db.prepare('SELECT email FROM caf_invites WHERE token_hash=?').bind(await sha256(token)).first();
  if (!row) return [410, 'gone'];
  if (row.email !== email) return [403, 'wrong_email'];
  const r = await db.prepare('UPDATE caf_invites SET used_at=? WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>? RETURNING email, role, invited_by').bind(now, await sha256(token), now).first();
  if (!r) return [410, 'gone'];
  await db.prepare('INSERT INTO caf_admins (email,role,added_by,added_at) VALUES (?,?,?,?) ON CONFLICT(email) DO UPDATE SET role=excluded.role, added_by=excluded.added_by, added_at=excluded.added_at, removed_at=NULL')
    .bind(r.email, r.role, r.invited_by, now).run();
  return [200, 'ok'];
}
export async function revokeInvite(env, id, { now = Date.now(), fetcher = fetch } = {}) {
  const i = await env.DB.prepare('SELECT email FROM caf_invites WHERE id=? AND used_at IS NULL AND revoked_at IS NULL').bind(String(id || '')).first();
  if (!i) return [404, { error: 'not_found' }];
  if (!(await roleOf(env.DB, i.email))) await accessPolicy(env, i.email, false, fetcher);
  await env.DB.prepare('UPDATE caf_invites SET revoked_at=? WHERE id=?').bind(now, id).run();
  return [200, { ok: true }];
}
export async function remove(env, email, { now = Date.now(), fetcher = fetch } = {}) {
  email = String(email || '').trim().toLowerCase();
  if (email === ALLOWED_EMAIL) return [400, { error: 'owner' }];
  if ((await roleOf(env.DB, email)) == null) return [404, { error: 'not_found' }];
  await accessPolicy(env, email, false, fetcher);
  await env.DB.batch([env.DB.prepare('UPDATE caf_admins SET removed_at=? WHERE email=?').bind(now, email),
    env.DB.prepare('UPDATE caf_invites SET revoked_at=? WHERE email=? AND used_at IS NULL AND revoked_at IS NULL').bind(now, email)]);
  return [200, { ok: true }];
}
