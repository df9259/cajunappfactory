// 10-29 step 2: device-key unlock for the Android app (port of StopScope's AdminKey flow).
// Desktop browsers: Access alone. Requests with the app's User-Agent marker also need a caf_unlock cookie.
import { randomToken, sha256, rateOk } from './mail.js';
export const APP_UA = 'CajunAppFactoryAdmin/', ENROL_WINDOW = 15 * 60e3, NONCE_TTL = 60e3, IDLE = 10 * 60e3, MAX = 60 * 60e3, PREFIX = 'caf-admin-v1:';
export const fromApp = (req) => (req.headers.get('User-Agent') || '').includes(APP_UA);
const ub = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const importKey = (spkiB64) => crypto.subtle.importKey('spki', ub(spkiB64), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
/** Android's SHA256withECDSA gives DER; WebCrypto wants raw r||s (64 bytes). */
export function derToRaw(d) {
  if (d.length === 64) return d;
  if (d[0] !== 0x30) throw new Error('sig');
  let i = 2; const out = new Uint8Array(64);
  for (const off of [0, 32]) {
    if (d[i++] !== 0x02) throw new Error('sig');
    let n = d[i++], v = d.slice(i, i + n); i += n;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error('sig');
    out.set(v, off + 32 - v.length);
  }
  return out;
}
const cookieOf = (req) => (/(?:^|;\s*)caf_unlock=([\w-]{20,100})/.exec(req.headers.get('Cookie') || '') || [])[1] || (/^[\w-]{20,100}$/.exec(req.headers.get('X-Unlock') || '') || [])[0];          // 0.2.0: native app sends X-Unlock
const setCookie = (v, age) => `caf_unlock=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;

export async function enrol(db, who, b, now = Date.now()) {
  if (!who.iat || now - who.iat * 1000 > ENROL_WINDOW) return [403, { error: 'login_too_old' }];          // sign in again, then enrol within 15 min
  const device_id = String(b.device_id || ''), pk = String(b.public_key || ''), label = String(b.label || '').slice(0, 60) || null;
  if (!/^[\w-]{8,64}$/.test(device_id) || pk.length > 300) return [400, { error: 'bad_request' }];
  try { await importKey(pk); } catch { return [400, { error: 'bad_key' }]; }
  if (!(await rateOk(db, 'cafenrol:' + who.email, 10, 86400e3, now))) return [429, { error: 'rate_limited' }];
  const id = randomToken(12);
  await db.batch([db.prepare('UPDATE caf_admin_keys SET revoked_at=? WHERE email=? AND device_id=? AND revoked_at IS NULL').bind(now, who.email, device_id),          // re-enrol replaces this phone's old key
    db.prepare('INSERT INTO caf_admin_keys (id,email,device_id,label,public_key,created_at) VALUES (?,?,?,?,?,?)').bind(id, who.email, device_id, label, pk, now)]);
  return [200, { ok: true, key_id: id }];
}
export async function challenge(db, email, now = Date.now()) {
  if (!(await rateOk(db, 'cafchal:' + email, 30, 60 * 60e3, now))) return [429, { error: 'rate_limited' }];
  const nonce = PREFIX + randomToken(24);
  await db.batch([db.prepare('DELETE FROM caf_nonces WHERE expires_at<?').bind(now), db.prepare('INSERT INTO caf_nonces VALUES (?,?,?)').bind(nonce, email, now + NONCE_TTL)]);
  return [200, { nonce }];
}
/** Single-use nonce, signature by one of this admin's live keys -> caf_unlock cookie. */
export async function verify(db, email, b, now = Date.now(), extra = []) {          // extra: statements written with the unlock (the app's audit row)
  const nonce = String(b.nonce || ''), key_id = String(b.key_id || '');
  const [n, k] = await Promise.all([db.prepare('DELETE FROM caf_nonces WHERE nonce=? AND email=? RETURNING expires_at').bind(nonce, email).first(),          // 10-29: in parallel; the nonce is still burnt first-use
    db.prepare('SELECT public_key FROM caf_admin_keys WHERE id=? AND email=? AND revoked_at IS NULL').bind(key_id, email).first()]);
  if (!n || n.expires_at < now) return [403, { error: 'bad_nonce' }];
  if (!k) return [403, { error: 'no_key' }];
  let ok = false;
  try { ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await importKey(k.public_key), derToRaw(ub(String(b.signature || ''))), new TextEncoder().encode(nonce)); } catch {}
  if (!ok) return [403, { error: 'bad_signature' }];
  const tok = randomToken(32);
  await db.batch([db.prepare('INSERT INTO caf_unlocks VALUES (?,?,?,?,?)').bind(await sha256(tok), email, key_id, now, now),
    db.prepare('UPDATE caf_admin_keys SET last_used_at=? WHERE id=?').bind(now, key_id),
    db.prepare('DELETE FROM caf_unlocks WHERE created_at<?').bind(now - MAX), ...extra]);
  return [200, { ok: true }, setCookie(tok, MAX / 1000)];
}
/** True if the cookie is a live unlock for this admin from a non-revoked key; slides the idle timer. */
export async function unlocked(db, req, email, now = Date.now()) {
  const c = cookieOf(req); if (!c) return false;
  const r = await db.prepare(`UPDATE caf_unlocks SET last_at=? WHERE token_hash=? AND email=? AND last_at>? AND created_at>?
     AND key_id IN (SELECT id FROM caf_admin_keys WHERE revoked_at IS NULL) RETURNING 1 AS ok`).bind(now, await sha256(c), email, now - IDLE, now - MAX).first();
  return !!r;
}
export const list = async (db) => (await db.prepare('SELECT id, email, label, created_at, last_used_at FROM caf_admin_keys WHERE revoked_at IS NULL ORDER BY email, created_at').all()).results || [];
export async function revoke(db, id, now = Date.now()) {
  const r = await db.prepare('UPDATE caf_admin_keys SET revoked_at=? WHERE id=? AND revoked_at IS NULL RETURNING email').bind(now, String(id || '')).first();
  if (!r) return [404, { error: 'not_found' }];
  await db.prepare('DELETE FROM caf_unlocks WHERE key_id=?').bind(id).run();
  return [200, { ok: true }];
}
export const revokeAllFor = (db, email, now = Date.now()) => db.batch([db.prepare('UPDATE caf_admin_keys SET revoked_at=? WHERE email=? AND revoked_at IS NULL').bind(now, email), db.prepare('DELETE FROM caf_unlocks WHERE email=?').bind(email)]);
