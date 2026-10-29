// 10-29 step 2: phone device-key unlock. Before: no /api/device/*, and app requests weren't gated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nc from 'node:crypto';
import { handle } from '../src/index.js';
import { _resetCache } from '../src/access.js';
import { derToRaw } from '../src/device.js';
import { PAGE } from '../src/ui.js';
import { makeDB, keys, sign, good, fetcherFor, TEAM, AUD } from './helpers.js';
const H = 'https://admin.cajunappfactory.com', { kp, jwks } = await keys(), APP = 'Mozilla/5.0 (Linux; Android 15) CajunAppFactoryAdmin/1.0';
const phone = () => { const k = nc.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { pub: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), sig: (n) => nc.sign('sha256', Buffer.from(n), { key: k.privateKey, dsaEncoding: 'der' }).toString('base64') }; };
const mk = () => ({ DB: makeDB(), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_USER_ID: 'admin1' });
async function req(env, path, { body, ua = 'Mozilla/5.0 Chrome', cookie, iat, email = 'df9259@gmail.com' } = {}) {
  _resetCache();
  const h = { 'Cf-Access-Jwt-Assertion': await sign(kp, good({ email, ...(iat ? { iat } : {}) })), 'User-Agent': ua, ...(cookie ? { Cookie: cookie } : {}) };
  const init = body ? { method: 'POST', headers: { ...h, 'Content-Type': 'application/json', 'X-Admin': '1', Origin: H }, body: JSON.stringify(body) } : { headers: h };
  return handle(new Request(H + path, init), env, { fetcher: fetcherFor(jwks) });
}
async function unlock(env, p, key_id, sigOf = p.sig) {
  const { nonce } = await (await req(env, '/api/device/challenge', { ua: APP, body: {} })).json();
  const r = await req(env, '/api/device/verify', { ua: APP, body: { nonce, key_id, signature: sigOf(nonce) } });
  return { r, nonce, cookie: (r.headers.get('Set-Cookie') || '').split(';')[0] };
}

test('enrol only within 15 min of Access login; app is locked until fingerprint verify; desktop never needs it', async () => {
  const env = mk(), p = phone();
  assert.equal((await req(env, '/api/device/enrol', { body: { device_id: 'pixel-0001', public_key: p.pub }, iat: Math.floor(Date.now() / 1000) - 16 * 60 })).status, 403);
  const e = await (await req(env, '/api/device/enrol', { body: { device_id: 'pixel-0001', public_key: p.pub, label: 'Pixel 9' } })).json();
  assert.ok(e.key_id);
  assert.equal((await req(env, '/api/apps/stopscope/overview')).status, 200);                    // desktop: Access alone
  assert.equal((await req(env, '/api/apps/stopscope/overview', { ua: APP })).status, 403);         // app: locked
  const { r, nonce, cookie } = await unlock(env, p, e.key_id);
  assert.equal(r.status, 200); assert.ok(nonce.startsWith('caf-admin-v1:'));
  assert.match(r.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Strict; Max-Age=3600/);
  assert.equal((await req(env, '/api/apps/stopscope/overview', { ua: APP, cookie })).status, 200);
  assert.equal((await req(env, '/api/apps/stopscope/overview', { ua: APP, cookie, email: 'kim@x.com' })).status, 403);       // cookie is tied to the admin
  // nonce single use
  assert.equal((await req(env, '/api/device/verify', { ua: APP, body: { nonce, key_id: e.key_id, signature: p.sig(nonce) } })).status, 403);
});

test('bad signature / other key refused; idle 10 min and 1 h max; revoke kills unlock', async () => {
  const env = mk(), p = phone(), other = phone();
  const { key_id } = await (await req(env, '/api/device/enrol', { body: { device_id: 'pixel-0001', public_key: p.pub } })).json();
  assert.equal((await unlock(env, p, key_id, other.sig)).r.status, 403);
  const { cookie } = await unlock(env, p, key_id); const s = env.DB._sql;
  s.prepare('UPDATE caf_unlocks SET last_at=?').run(Date.now() - 11 * 60e3);
  assert.equal((await req(env, '/api/apps/stopscope/overview', { ua: APP, cookie })).status, 403);
  const c2 = (await unlock(env, p, key_id)).cookie;
  s.prepare('UPDATE caf_unlocks SET created_at=?').run(Date.now() - 61 * 60e3);
  assert.equal((await req(env, '/api/apps/stopscope/overview', { ua: APP, cookie: c2 })).status, 403);
  const c3 = (await unlock(env, p, key_id)).cookie;
  // two devices; Admins page lists both; revoke one from desktop
  const p2 = phone(); await req(env, '/api/device/enrol', { body: { device_id: 'tablet-0002', public_key: p2.pub } });
  const j = await (await req(env, '/api/admins')).json(); assert.equal(j.devices.length, 2);
  assert.equal((await req(env, '/api/admins/device-revoke', { body: { id: key_id } })).status, 200);
  assert.equal((await req(env, '/api/apps/stopscope/overview', { ua: APP, cookie: c3 })).status, 403);
  assert.equal((await unlock(env, p, key_id)).r.status, 403);
  assert.equal((await (await req(env, '/api/admins')).json()).devices.length, 1);
});

test('DER and raw signatures, garbage key rejected, UI shows devices', async () => {
  assert.equal(derToRaw(new Uint8Array(64)).length, 64);
  assert.throws(() => derToRaw(new Uint8Array([1, 2, 3])));
  const env = mk();
  assert.equal((await req(env, '/api/device/enrol', { body: { device_id: 'pixel-0001', public_key: 'AAAA' } })).status, 400);
  assert.ok(PAGE.js.includes('Revoke device') && PAGE.js.includes('/api/admins/device-revoke'));
});
