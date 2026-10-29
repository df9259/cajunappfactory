// 10-29 stopscope.com admin parity. Before: the caf admin had no tutorial or sign-out action (404). After: both work, audited, CSRF-checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { _resetCache } from '../src/access.js';
import { PAGE } from '../src/ui.js';
import { makeDB, keys, sign, good, fetcherFor, TEAM, AUD } from './helpers.js';
const H = 'https://admin.cajunappfactory.com', { kp, jwks } = await keys();
function seed() {
  const db = makeDB(), s = db._sql;
  s.prepare("INSERT INTO users (id,email,name,pw_hash,created_at) VALUES ('w1','p@x.com','P','h',1)").run();
  s.prepare("INSERT INTO app_users (id,email,name,email_verified,created_at,last_sign_in_at,web_user_id,tutorial_version) VALUES ('a1','p@x.com','P',1,1,1,'w1',NULL)").run();
  s.prepare("INSERT INTO app_settings (key,value,updated_at) VALUES ('tutorial_version','3',1)").run();
  s.prepare("INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES ('t1','w1',1,9e12)").run();
  s.prepare("INSERT INTO app_sessions (token_hash,app_user_id,created_at,expires_at,last_used_at) VALUES ('t2','a1',1,9e12,1)").run();
  return db;
}
const post = async (env, body, h = { 'X-Admin': '1', Origin: H }) => { _resetCache();
  return handle(new Request(H + '/api/apps/stopscope/action', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': await sign(kp, good()), 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) }), env, { fetcher: fetcherFor(jwks) }); };
const envOf = (db) => ({ DB: db, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_USER_ID: 'admin1' });
const n = (db, q) => db._sql.prepare(q).get().n;

test('tutorial: max(global, user) + 1, audited; again bumps once more', async () => {
  const db = seed(), env = envOf(db);
  let r = await post(env, { kind: 'web', id: 'w1', what: 'tutorial' });
  assert.equal(r.status, 200); assert.equal((await r.json()).tutorial, 4);
  r = await post(env, { kind: 'app', id: 'a1', what: 'tutorial' }); assert.equal((await r.json()).tutorial, 5);
  assert.equal(n(db, "SELECT COUNT(*) n FROM admin_audit WHERE action='tutorial' AND admin_user_id='admin1'"), 2);
});
test('signout: deletes app and web sessions of the person, audited', async () => {
  const db = seed(), env = envOf(db);
  assert.equal(n(db, 'SELECT (SELECT COUNT(*) FROM sessions)+(SELECT COUNT(*) FROM app_sessions) n'), 2);          // before
  assert.equal((await post(env, { kind: 'app', id: 'a1', what: 'signout' })).status, 200);
  assert.equal(n(db, 'SELECT (SELECT COUNT(*) FROM sessions)+(SELECT COUNT(*) FROM app_sessions) n'), 0);          // after
  assert.equal(n(db, "SELECT COUNT(*) n FROM admin_audit WHERE action='signout'"), 1);
});
test('csrf, bad action, unknown user, web-only tutorial', async () => {
  const db = seed(), env = envOf(db);
  assert.equal((await post(env, { kind: 'app', id: 'a1', what: 'signout' }, { 'X-Admin': '1', Origin: 'https://evil.com' })).status, 403);
  assert.equal((await post(env, { kind: 'app', id: 'a1', what: 'signout' }, { Origin: H })).status, 403);
  assert.equal((await post(env, { kind: 'app', id: 'a1', what: 'drop' })).status, 400);
  assert.equal((await post(env, { kind: 'app', id: 'zz', what: 'signout' })).status, 404);
  db._sql.prepare("INSERT INTO users (id,email,name,pw_hash,created_at) VALUES ('w2','solo@x.com','S','h',1)").run();
  assert.equal((await post(env, { kind: 'web', id: 'w2', what: 'tutorial' })).status, 409);
  assert.equal(n(db, 'SELECT (SELECT COUNT(*) FROM sessions)+(SELECT COUNT(*) FROM app_sessions) n'), 2, 'nothing changed');
});
test('UI has both buttons wired to the action endpoint', () => {
  for (const s of ['Show tutorial again', 'Sign out all devices', '/api/apps/stopscope/action']) assert.ok(PAGE.js.includes(s), s);
  new Function(PAGE.js.replace(/^route\(\);$/m, ''));          // still parses
});
