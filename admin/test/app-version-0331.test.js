// 0.3.31: app version in the users list, user detail and a 'versions in use' breakdown. Before: no version anywhere in the admin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SS from '../src/stopscope.js';
import { PAGE } from '../src/ui.js';
import { makeDB } from './helpers.js';
const NOW = Date.parse('2026-10-23T12:00:00Z');
function seed() {
  const db = makeDB(), s = db._sql;
  s.prepare("INSERT INTO app_users (id,email,name,email_verified,created_at,last_sign_in_at,app_version,app_version_code,app_version_at) VALUES ('a1','new@x.com','New',1,?,?,'0.3.31',116,?),('a3','new2@x.com','New2',1,?,?,'0.3.31',116,?)").run(NOW, NOW, NOW, NOW, NOW, NOW);
  s.prepare("INSERT INTO app_users (id,email,name,email_verified,created_at,last_sign_in_at) VALUES ('a2','old@x.com','Old',1,?,?)").run(NOW, NOW);
  s.prepare("INSERT INTO users (id,email,name,pw_hash,created_at) VALUES ('w1','web@x.com','Web','h',?)").run(NOW);
  return db;
}
test('users list and detail carry the app version; old apps say older than 0.3.31; website rows none', async () => {
  const db = seed(), l = (await SS.listUsers(db, {})).users, by = (id) => l.find((u) => u.id === id);
  assert.equal(by('a1').app_version, '0.3.31 (116)'); assert.equal(by('a2').app_version, 'older than 0.3.31'); assert.equal(by('w1').app_version, null);
  assert.equal((await SS.userDetail(db, 'app', 'a1', NOW)).app_version, '0.3.31 (116)');
  assert.equal((await SS.userDetail(db, 'app', 'a2', NOW)).app_version, 'older than 0.3.31');
  assert.equal((await SS.userDetail(db, 'web', 'w1', NOW)).app_version, null);
});
test('overview: versions in use, newest first, old apps grouped', async () => {
  const o = await SS.overview(seed(), NOW);
  assert.deepEqual(o.versions_in_use, [{ version: '0.3.31 (116)', n: 2 }, { version: 'older than 0.3.31', n: 1 }]);
});
test('UI shows version column, detail row and the tile', () => {
  assert.ok(PAGE.js.includes("'App version'") && PAGE.js.includes('u.app_version') && PAGE.js.includes('d.app_version') && PAGE.js.includes('Versions in use'));
});
