// 10-29 0.2.0: native app API (/api/app/*). Before: 403 for every /api/app path (Access JWT required).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nc from 'node:crypto';
import { handle } from '../src/index.js';
import { _resetGoogle } from '../src/app.js';
import { makeDB, keys, sign } from './helpers.js';
const H = 'https://admin.cajunappfactory.com', CID = 'web-client.apps.googleusercontent.com', { kp, jwks } = await keys(), other = await keys();
const gfetch = async (u) => u === 'https://www.googleapis.com/oauth2/v3/certs' ? new Response(JSON.stringify(jwks)) : new Response('no', { status: 404 });
const gtok = (o = {}) => sign(kp, { iss: 'https://accounts.google.com', aud: CID, email: 'df9259@gmail.com', email_verified: true, exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), ...o });
function mk() { const sent = []; return { sent, env: { DB: makeDB(), ADMIN_USER_ID: 'admin1', GOOGLE_WEB_CLIENT_ID: CID, ACCESS_TEAM_DOMAIN: 'curly-dream-ead0.cloudflareaccess.com', ACCESS_AUD: 'a'.repeat(64), EMAIL: { send: async (m) => { sent.push(m); } } } }; }
const call = (E, path, { body, session, unlock, method } = {}) => { _resetGoogle(); const h = {};
  if (session) h.Authorization = 'Bearer ' + session; if (unlock) h['X-Unlock'] = unlock; if (body) h['Content-Type'] = 'application/json';
  return handle(new Request(H + path, { method: method || (body ? 'POST' : 'GET'), headers: h, body: body ? JSON.stringify(body) : undefined }), E.env, { googleFetcher: gfetch, fetcher: async () => new Response('no', { status: 404 }) }); };
const phone = () => { const k = nc.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { pub: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), sig: (n) => nc.sign('sha256', Buffer.from(n), { key: k.privateKey, dsaEncoding: 'der' }).toString('base64') }; };
async function unlockFlow(E, session, p = phone()) {
  const { key_id } = await (await call(E, '/api/app/enrol', { session, body: { device_id: 'pixel-8-pro', public_key: p.pub, label: 'Pixel 8 Pro' } })).json();
  const { nonce } = await (await call(E, '/api/app/challenge', { session, body: {} })).json();
  return (await (await call(E, '/api/app/verify', { session, body: { nonce, key_id, signature: p.sig(nonce) } })).json()).unlock;
}

test('Google ID token -> session -> enrol/challenge/verify -> data with unlock only', async () => {
  const E = mk();
  const r = await call(E, '/api/app/login/google', { body: { id_token: await gtok() } }); assert.equal(r.status, 200);
  const { session } = await r.json(); assert.ok(session);
  assert.equal((await call(E, '/api/app/apps/stopscope/overview', { session })).status, 403);          // locked
  const unlock = await unlockFlow(E, session); assert.ok(unlock);
  assert.equal((await call(E, '/api/app/apps/stopscope/overview', { session, unlock })).status, 200);
  const me = await (await call(E, '/api/app/me', { session, unlock })).json(); assert.equal(me.role, 'owner');
  assert.equal((await call(E, '/api/app/admins', { session, unlock })).status, 200);
  assert.equal((await call(E, '/api/app/apps/stopscope/overview', { unlock })).status, 401);          // unlock alone is not enough
  assert.equal((await call(E, '/api/app/../invite', { session, unlock })).status, 403);
  assert.equal((await call(E, '/api/app/logout', { session, body: {} })).status, 200);
  assert.equal((await call(E, '/api/app/apps/stopscope/overview', { session, unlock })).status, 401);
});

test('Google token checks: wrong aud, bad signature, unverified email, expired, non-admin', async () => {
  const E = mk(), st = async (t) => (await call(E, '/api/app/login/google', { body: { id_token: t } })).status;
  assert.equal(await st(await gtok({ aud: 'other' })), 401);
  assert.equal(await st(await sign(other.kp, { iss: 'https://accounts.google.com', aud: CID, email: 'df9259@gmail.com', email_verified: true, exp: Math.floor(Date.now() / 1000) + 600 })), 401);
  assert.equal(await st(await gtok({ email_verified: false })), 401);
  assert.equal(await st(await gtok({ exp: 1 })), 401);
  assert.equal(await st(await gtok({ iss: 'https://evil.com' })), 401);
  assert.equal(await st(await gtok({ email: 'kim@x.com' })), 403);
  assert.equal(await st('garbage'), 401);
});

test('email code fallback: admin gets a code, single use, 5 tries; non-admin gets nothing but same answer', async () => {
  const E = mk();
  assert.equal((await call(E, '/api/app/login/code-send', { body: { email: 'kim@x.com' } })).status, 200); assert.equal(E.sent.length, 0);
  assert.equal((await call(E, '/api/app/login/code-send', { body: { email: 'DF9259@gmail.com' } })).status, 200);
  const m = E.sent[0], code = m.text.match(/\b(\d{6})\b/)[1];
  assert.ok(m.html && m.replyTo && !/https?:\/\//.test(m.text));
  assert.equal((await call(E, '/api/app/login/code', { body: { email: 'df9259@gmail.com', code: code === '000000' ? '000001' : '000000' } })).status, 401);
  const r = await call(E, '/api/app/login/code', { body: { email: 'df9259@gmail.com', code } }); assert.equal(r.status, 200); assert.ok((await r.json()).session);
  assert.equal((await call(E, '/api/app/login/code', { body: { email: 'df9259@gmail.com', code } })).status, 401);
  await call(E, '/api/app/login/code-send', { body: { email: 'df9259@gmail.com' } }); const c2 = E.sent[1].text.match(/\b(\d{6})\b/)[1];
  for (let i = 0; i < 5; i++) await call(E, '/api/app/login/code', { body: { email: 'df9259@gmail.com', code: c2 === '111111' ? '222222' : '111111' } });
  assert.equal((await call(E, '/api/app/login/code', { body: { email: 'df9259@gmail.com', code: c2 } })).status, 401);          // locked after 5 tries
});

test('enrol only within 15 min of app sign-in; removed admin loses the app session', async () => {
  const E = mk(), s = E.env.DB._sql;
  const { session } = await (await call(E, '/api/app/login/google', { body: { id_token: await gtok() } })).json();
  s.prepare('UPDATE caf_app_sessions SET created_at=?').run(Date.now() - 16 * 60e3);
  assert.equal((await call(E, '/api/app/enrol', { session, body: { device_id: 'pixel-8-pro', public_key: phone().pub } })).status, 403);
  s.prepare("INSERT INTO caf_admins (email,role,added_at) VALUES ('kim@x.com','admin',1)").run();
  const k = await (await call(E, '/api/app/login/google', { body: { id_token: await gtok({ email: 'kim@x.com' }) } })).json();
  const unlock = await unlockFlow(E, k.session);
  assert.equal((await call(E, '/api/app/apps/stopscope/users', { session: k.session, unlock })).status, 200);
  assert.equal((await call(E, '/api/app/admins', { session: k.session, unlock })).status, 403);          // admins can't manage admins
  s.prepare("UPDATE caf_admins SET removed_at=1 WHERE email='kim@x.com'").run();
  assert.equal((await call(E, '/api/app/apps/stopscope/users', { session: k.session, unlock })).status, 401);
});

test('app POST actions reach the same handlers (toggle) without Access or CSRF headers', async () => {
  const E = mk(), s = E.env.DB._sql;
  s.prepare("INSERT INTO users (id,email,name,pw_hash,created_at) VALUES ('w1','pw@x.com','P','h',1)").run();
  const { session } = await (await call(E, '/api/app/login/google', { body: { id_token: await gtok() } })).json();
  const unlock = await unlockFlow(E, session);
  const r = await call(E, '/api/app/apps/stopscope/toggle', { session, unlock, body: { kind: 'web', id: 'w1', what: 'pro_comp', on: true } });
  assert.equal(r.status, 200, await r.clone().text());
});

test('10-29 0.2.2: verify returns the role and writes the unlock audit row in the same batch', async () => {
  const E = mk();
  const { session } = await (await call(E, '/api/app/login/google', { body: { id_token: await gtok() } })).json();
  const p = phone();
  const { key_id } = await (await call(E, '/api/app/enrol', { session, body: { device_id: 'pixel-8-pro', public_key: p.pub, label: 'Pixel 8 Pro' } })).json();
  const { nonce } = await (await call(E, '/api/app/challenge', { session, body: {} })).json();
  const v = await (await call(E, '/api/app/verify', { session, body: { nonce, key_id, signature: p.sig(nonce) } })).json();
  assert.equal(v.role, 'owner'); assert.ok(v.unlock); assert.equal(v.ok, true);          // 0.2.1 only reads unlock: still there
  assert.equal(E.env.DB._sql.prepare("SELECT COUNT(*) n FROM admin_audit WHERE action='device-unlock' AND target_id=?").get(key_id).n, 1);
  const again = await call(E, '/api/app/verify', { session, body: { nonce, key_id, signature: p.sig(nonce) } });
  assert.equal(again.status, 403);          // nonce still single use
  assert.equal(E.env.DB._sql.prepare("SELECT COUNT(*) n FROM admin_audit WHERE action='device-unlock'").get().n, 1);          // no audit on failure
});
