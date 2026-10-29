// 10-29: reset-email + invite admins by email. Before: no reset action (400 bad_action), no /api/admins or /invite (404/403), only df9259 could ever sign in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { _resetCache } from '../src/access.js';
import { PAGE } from '../src/ui.js';
import { makeDB, keys, sign, good, fetcherFor, TEAM, AUD } from './helpers.js';
const H = 'https://admin.cajunappfactory.com', { kp, jwks } = await keys(), D = 86400e3;
function mkEnv(over = {}) {
  const db = makeDB(), s = db._sql, sent = [];
  s.prepare("INSERT INTO users (id,email,name,pw_hash,created_at) VALUES ('w1','pw@x.com','P','h',1),('w2','g@x.com','G',NULL,1)").run();
  const policy = { name: 'Dominic only', decision: 'allow', include: [{ email: { email: 'df9259@gmail.com' } }] }, calls = [];
  const access = { fetcher: async (url, o = {}) => { calls.push(o.method || 'GET'); if (o.method === 'PUT') { if (over.putFails) return new Response('{}', { status: 500 }); Object.assign(policy, JSON.parse(o.body)); }
    return new Response(JSON.stringify({ success: true, result: policy })); } };
  const env = { DB: db, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_USER_ID: 'admin1', CF_ACCESS_TOKEN: 'x', CF_ACCOUNT_ID: 'acc', ACCESS_APP_ID: 'app', ACCESS_POLICY_ID: 'pol',
    EMAIL: { send: async (m) => { sent.push(m); return { messageId: 'm' }; } }, ...over.env };
  return { env, db, sent, policy, calls, access };
}
const req = async (E, path, { email = 'df9259@gmail.com', body, origin = H } = {}) => { _resetCache();
  const init = body ? { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': await sign(kp, good({ email })), 'Content-Type': 'application/json', 'X-Admin': '1', Origin: origin }, body: JSON.stringify(body) }
    : { headers: { 'Cf-Access-Jwt-Assertion': await sign(kp, good({ email })) } };
  return handle(new Request(H + path, init), E.env, { fetcher: fetcherFor(jwks), access: E.access }); };
const tokenOf = (m) => m.text.match(/invite\?t=([\w-]+)/)[1];
const emails = (p) => p.include.map((x) => x.email.email);

test('reset-email: token stored as hash, mail has text+html, Reply-To, List-Unsubscribe, stopscope.com link only, no images; capped 3/h', async () => {
  const E = mkEnv();
  const r = await req(E, '/api/apps/stopscope/action', { body: { kind: 'web', id: 'w1', what: 'reset-email' } });
  assert.equal(r.status, 200);
  const m = E.sent[0], tok = m.text.match(/reset\?t=([\w-]+)/)[1];
  assert.equal(m.to, 'pw@x.com'); assert.equal(m.replyTo, 'support@cajunappfactory.com'); assert.ok(m.headers['List-Unsubscribe']);
  assert.ok(m.text && m.html && !/<img/i.test(m.html)); assert.equal(m.subject, 'Reset your StopScope password');
  for (const u of (m.html + m.text).match(/https?:\/\/[^\s"<]+/g)) assert.ok(u.startsWith('https://stopscope.com/reset?t='), u);
  assert.equal(E.db._sql.prepare("SELECT COUNT(*) n FROM email_tokens WHERE user_id='w1' AND purpose='reset'").get().n, 1);
  assert.ok(!JSON.stringify(E.db._sql.prepare('SELECT * FROM email_tokens').all()).includes(tok), 'raw token never stored');
  assert.equal((await req(E, '/api/apps/stopscope/action', { body: { kind: 'web', id: 'w2', what: 'reset-email' } })).status, 409);          // Google-only
  for (let i = 0; i < 2; i++) await req(E, '/api/apps/stopscope/action', { body: { kind: 'web', id: 'w1', what: 'reset-email' } });
  assert.equal((await req(E, '/api/apps/stopscope/action', { body: { kind: 'web', id: 'w1', what: 'reset-email' } })).status, 429);
});

test('invite -> accept once -> admin can use the API but not manage admins; second click and other emails refused', async () => {
  const E = mkEnv();
  assert.equal((await req(E, '/api/me', { email: 'kim@x.com' })).status, 403);          // before: not an admin
  let r = await req(E, '/api/admins/invite', { body: { email: ' Kim@X.com ' } }); assert.equal(r.status, 200);
  assert.deepEqual(emails(E.policy), ['df9259@gmail.com', 'kim@x.com']);
  const m = E.sent[0]; assert.equal(m.from.email, 'no-reply@cajunappfactory.com'); assert.equal(m.subject, 'You’re invited to Cajun App Factory Admin');
  for (const u of (m.html + m.text).match(/https?:\/\/[^\s"<]+/g)) assert.ok(u.startsWith(H + '/'), u);
  assert.ok(!/<img/i.test(m.html) && m.replyTo === 'support@cajunappfactory.com');
  assert.equal((await req(E, '/api/me', { email: 'kim@x.com' })).status, 403);          // invited, not accepted yet
  const t = tokenOf(m);
  assert.equal((await req(E, '/invite?t=' + t, { email: 'eve@x.com' })).status, 403);          // someone else's login
  assert.equal((await req(E, '/invite?t=' + t, { email: 'kim@x.com' })).status, 200);
  assert.equal((await req(E, '/invite?t=' + t, { email: 'kim@x.com' })).status, 410);          // single use
  const me = await (await req(E, '/api/me', { email: 'kim@x.com' })).json(); assert.equal(me.role, 'admin');
  assert.equal((await req(E, '/api/apps/stopscope/overview', { email: 'kim@x.com' })).status, 200);
  assert.equal((await req(E, '/api/admins', { email: 'kim@x.com' })).status, 403);
  assert.equal((await req(E, '/api/admins/invite', { email: 'kim@x.com', body: { email: 'z@x.com' } })).status, 403);
  // remove: off the policy and locked out at once
  assert.equal((await req(E, '/api/admins/remove', { body: { email: 'kim@x.com' } })).status, 200);
  assert.deepEqual(emails(E.policy), ['df9259@gmail.com']);
  assert.equal((await req(E, '/api/apps/stopscope/overview', { email: 'kim@x.com' })).status, 403);
  assert.equal((await req(E, '/api/admins/remove', { body: { email: 'df9259@gmail.com' } })).status, 400);          // owner can't be removed
});

test('expiry (7 days), revoke, re-invite kills old link', async () => {
  const E = mkEnv();
  await req(E, '/api/admins/invite', { body: { email: 'a@x.com' } }); const t1 = tokenOf(E.sent[0]);
  await req(E, '/api/admins/invite', { body: { email: 'a@x.com' } }); const t2 = tokenOf(E.sent[1]);
  assert.equal((await req(E, '/invite?t=' + t1, { email: 'a@x.com' })).status, 410);
  E.db._sql.prepare("UPDATE caf_invites SET expires_at=1 WHERE email='a@x.com' AND revoked_at IS NULL").run();
  assert.equal((await req(E, '/invite?t=' + t2, { email: 'a@x.com' })).status, 410);
  const row = E.db._sql.prepare("SELECT created_at, expires_at FROM caf_invites WHERE email='a@x.com' ORDER BY rowid LIMIT 1").get();
  assert.equal(row.expires_at - row.created_at, 7 * D);
  await req(E, '/api/admins/invite', { body: { email: 'b@x.com' } }); const t3 = tokenOf(E.sent[2]);
  const id = (await (await req(E, '/api/admins')).json()).invites.find((i) => i.email === 'b@x.com').id;
  assert.equal((await req(E, '/api/admins/revoke', { body: { id } })).status, 200);
  assert.ok(!emails(E.policy).includes('b@x.com'));
  assert.equal((await req(E, '/invite?t=' + t3, { email: 'b@x.com' })).status, 410);
});

test('safety: invites off without token, CSRF, bad email, Access API failure writes nothing, owner never dropped', async () => {
  let E = mkEnv({ env: { CF_ACCESS_TOKEN: '' } });
  assert.equal((await req(E, '/api/admins/invite', { body: { email: 'a@x.com' } })).status, 503);
  assert.equal((await (await req(E, '/api/admins')).json()).invites_on, false);
  E = mkEnv();
  assert.equal((await req(E, '/api/admins/invite', { body: { email: 'a@x.com' }, origin: 'https://evil.com' })).status, 403);
  assert.equal((await req(E, '/api/admins/invite', { body: { email: 'not an email' } })).status, 400);
  E = mkEnv({ putFails: true });
  assert.equal((await req(E, '/api/admins/invite', { body: { email: 'a@x.com' } })).status, 502);
  assert.equal(E.db._sql.prepare('SELECT COUNT(*) n FROM caf_invites').get().n, 0); assert.equal(E.sent.length, 0);
});

test('UI: Admins page and reset button exist and the script parses', () => {
  for (const s of ['/api/admins/invite', 'Pending invites', 'Send password reset email', 'expires in 7 days']) assert.ok(PAGE.js.includes(s), s);
  new Function(PAGE.js.replace(/^route\(\);$/m, ''));
});
