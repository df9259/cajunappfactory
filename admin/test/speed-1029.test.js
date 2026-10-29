// 10-29 app speed: detail, users and stats run independent D1 reads in parallel. Fake D1 with 50 ms per query; results unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDB } from './helpers.js';
import * as SS from '../src/stopscope.js';
import * as ST from '../src/stats.js';
const NOW = Date.UTC(2026, 9, 29);
export function seed() {
  const db = makeDB(), s = db._sql;
  s.prepare("INSERT INTO app_users (id,email,name,email_verified,created_at,last_sign_in_at,web_user_id) VALUES ('a1','p@x.com','P',1,?,?,'w1')").run(NOW, NOW);
  s.prepare("INSERT INTO users (id,email,name,pw_hash,created_at) VALUES ('w1','p@x.com','P','h',1)").run();
  return db;
}
export const slow = (db, ms = 50) => {
  const w = (st) => ({ bind: (...a) => w(st.bind(...a)), _st: st,
    first: async () => { await new Promise((r) => setTimeout(r, ms)); return st.first(); },
    all: async () => { await new Promise((r) => setTimeout(r, ms)); return st.all(); },
    run: async () => { await new Promise((r) => setTimeout(r, ms)); return st.run(); } });
  return { prepare: (q) => w(db.prepare(q)), batch: async (l) => { await new Promise((r) => setTimeout(r, ms)); return db.batch(l.map((x) => x._st)); } };
};
export const time = async (f) => { const t = Date.now(); const r = await f(); return [r, Date.now() - t]; };
test('user detail, users list and stats: fast at 50 ms/query, same results', async () => {
  const db = seed(), sl = slow(db);
  const [d, td] = await time(() => SS.userDetail(sl, 'app', 'a1', NOW));
  assert.deepEqual(d, await SS.userDetail(db, 'app', 'a1', NOW));
  assert.ok(td < 300, 'detail ms ' + td);
  const [u, tu] = await time(() => SS.listUsers(sl, {}));
  assert.deepEqual(u, await SS.listUsers(db, {}));
  assert.ok(tu < 90, 'users ms ' + tu);
  const [s, ts] = await time(() => ST.all_(sl, NOW));
  assert.deepEqual(s, await ST.all_(db, NOW));
  assert.ok(ts < 600, 'stats ms ' + ts);
  console.log(`after: detail ${td} ms, users ${tu} ms, stats ${ts} ms`);
});
