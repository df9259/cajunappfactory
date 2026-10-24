// 10-23: one row per person. Before: app_users and website users listed separately (a person with both = 2 rows).
// After: matched by web_user_id first, then same email (case-insensitive, trimmed); Pro if either; last seen = latest of both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SS from '../src/stopscope.js';
import { makeDB } from './helpers.js';
const T = Date.parse('2026-10-20T12:00:00Z');
function seed() {
  const db = makeDB(), s = db._sql;
  s.prepare("INSERT INTO users (id,email,name,pw_hash,created_at,pro_comp) VALUES ('w1','linked-web@x.com','L','h',?,0),('w2','  Same@X.com ','S','h',?,1),('w3','webonly@x.com','W','h',?,0)").run(T, T, T);
  s.prepare("INSERT INTO app_users (id,email,name,email_verified,created_at,last_sign_in_at,web_user_id,app_version,app_version_code) VALUES ('a1','linked-app@x.com','L',1,?,?,'w1','0.3.31',116),('a2','same@x.com','S',1,?,?,NULL,NULL,NULL),('a3','apponly@x.com','A',1,?,?,NULL,NULL,NULL)").run(T, T, T, T, T, T);
  s.prepare("INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES ('t1','w2',?,?)").run(T + 5000, T + 9e9);
  return db;
}
const rawCount = (db) => db._sql.prepare('SELECT (SELECT COUNT(*) FROM app_users)+(SELECT COUNT(*) FROM users) n').get().n;
test('linked and same-email accounts collapse to one row each', async () => {
  const db = seed(), l = await SS.listUsers(db, {});
  assert.equal(rawCount(db), 6);            // before: 6 rows (one per account)
  assert.equal(l.total, 4);                 // after: 4 people
  const by = (id) => l.users.find((u) => u.id === id);
  assert.deepEqual(by('a1').accounts, ['app', 'web']);
  assert.deepEqual(by('a2').accounts, ['app', 'web']);
  assert.deepEqual(by('a3').accounts, ['app']);
  assert.deepEqual(by('w3').accounts, ['web']);
  assert.equal(by('w1'), undefined); assert.equal(by('w2'), undefined);
  assert.equal(by('a2').pro_comp, true);                 // Pro from the web account
  assert.equal(by('a2').last_seen, T + 5000);            // latest of both
  assert.equal(by('a1').app_version, '0.3.31 (116)'); assert.equal(by('a2').app_version, 'older than 0.3.31');
  assert.equal((await SS.listUsers(db, { type: 'pro' })).total, 1);
});
test('free-Pro toggle sets both matched accounts', async () => {
  const db = seed();
  const t = await SS.target(db, 'app', 'a2'); assert.equal(t.webId, 'w2');
  const t2 = await SS.target(db, 'web', 'w1'); assert.equal(t2.appId, 'a1');
  await SS.setProComp(db, await SS.target(db, 'app', 'a1'), true);
  assert.equal(db._sql.prepare("SELECT pro_comp p FROM app_users WHERE id='a1'").get().p, 1);
  assert.equal(db._sql.prepare("SELECT pro_comp p FROM users WHERE id='w1'").get().p, 1);
});
