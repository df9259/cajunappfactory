// 10-24 optimization audit: the dashboard overview reads D1 in one round trip (db.batch), not 16 sequential queries; same numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDB } from './helpers.js';
import * as SS from '../src/stopscope.js';
test('overview: one D1 round trip', async () => {
  const db = makeDB(); let trips = 0;
  const wrap = (st) => ({ bind: (...a) => wrap(st.bind(...a)), first: () => { trips++; return st.first(); }, all: () => { trips++; return st.all(); }, run: () => { trips++; return st.run(); }, _st: st });
  const spy = { prepare: (q) => wrap(db.prepare(q)), batch: (l) => { trips++; return db.batch(l.map((s) => s._st)); } };
  const o = await SS.overview(spy, Date.now());
  assert.equal(o.signups.length, 30);
  assert.equal(trips, 1, 'round trips: ' + trips);
});
