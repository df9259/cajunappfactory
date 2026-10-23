// 10-23 feature adoption + Pro funnel/MRR. Before: both were static "Coming soon" tiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ST from '../src/stats.js';
import { PAGE } from '../src/ui.js';
import { makeDB } from './helpers.js';
const D = 86400e3, NOW = Date.parse('2026-10-23T12:00:00Z'), ymd = (t) => new Date(t).toISOString().slice(0, 10);

test('features: No data yet until rows exist, then aggregates (7/30d %, per-day totals, stops/route, Maps vs Waze)', async () => {
  const db = makeDB(), s = db._sql;
  assert.deepEqual(await ST.features(db, NOW), { has_data: false });
  s.prepare("INSERT INTO app_users (id,email,name,email_verified,created_at,last_sign_in_at,last_seen_at) VALUES ('a1','a@x','A',1,?,?,?),('a2','b@x','B',1,?,?,?),('a3','c@x','C',1,?,?,?),('a4','d@x','D',1,?,?,?)")
    .run(NOW - 40 * D, NOW - 40 * D, NOW - D, NOW - 40 * D, NOW - 40 * D, NOW - 2 * D, NOW - 40 * D, NOW - 40 * D, NOW - 20 * D, NOW - 40 * D, NOW - 40 * D, NOW - 60 * D);
  const ins = s.prepare('INSERT INTO feature_counters (day,app_user_id,counter,value,updated_at) VALUES (?,?,?,?,0)');
  ins.run(ymd(NOW - D), 'a1', 'optimize_runs', 3); ins.run(ymd(NOW - D), 'a1', 'handoff_maps', 3); ins.run(ymd(NOW - D), 'a2', 'handoff_waze', 1);
  ins.run(ymd(NOW - 20 * D), 'a3', 'optimize_runs', 1); ins.run(ymd(NOW - D), 'a1', 'routes_started', 2); ins.run(ymd(NOW - D), 'a1', 'route_stops', 45);
  ins.run(ymd(NOW - 50 * D), 'a4', 'csv_imports', 9);          // outside 30 days
  const f = await ST.features(db, NOW);
  assert.equal(f.active_app_users_7d, 2); assert.equal(f.active_app_users_30d, 3);
  const opt = f.adoption.find((a) => a.counter === 'optimize_runs');
  assert.deepEqual([opt.users_7d, opt.pct_7d, opt.users_30d, opt.pct_30d, opt.total_30d], [1, 50, 2, 66.7, 4]);
  assert.equal(f.adoption.find((a) => a.counter === 'csv_imports').total_30d, 0);
  assert.equal(f.stops_per_route_30d, 22.5);
  assert.deepEqual(f.handoff_30d, { maps: 3, waze: 1, maps_pct: 75, waze_pct: 25 });
  assert.ok(f.daily.some((x) => x.day === ymd(NOW - D) && x.counter === 'optimize_runs' && x.total === 3));
  assert.ok(!JSON.stringify(f).includes('a1'), 'aggregates only: no user ids');
});

test('pro: Waiting for Play until events; trial starts, conversions, cancels, active paid, MRR at $7.99', async () => {
  const db = makeDB(), s = db._sql;
  let p = await ST.proSubs(db, NOW); assert.equal(p.has_data, false); assert.equal(p.test_notifications, 0);
  const ins = s.prepare("INSERT INTO subscription_events (message_id,received_at,event_time,kind,notification_type,purchase_token,verified,state,in_trial,raw) VALUES (?,?,?,?,?,?,?,?,?,'{}')");
  ins.run('t', NOW, NOW, 'test', null, null, 0, null, null);
  p = await ST.proSubs(db, NOW); assert.equal(p.has_data, false); assert.equal(p.test_notifications, 1);
  // A: trial (verified) -> renewed = conversion, active paid
  ins.run('1', NOW, NOW - 10 * D, 'subscription', 4, 'A', 1, 'SUBSCRIPTION_STATE_ACTIVE', 1);
  ins.run('2', NOW, NOW - 3 * D, 'subscription', 2, 'A', 1, 'SUBSCRIPTION_STATE_ACTIVE', 0);
  // B: trial then canceled
  ins.run('3', NOW, NOW - 5 * D, 'subscription', 4, 'B', 1, 'SUBSCRIPTION_STATE_ACTIVE', 1);
  ins.run('4', NOW, NOW - 4 * D, 'subscription', 3, 'B', 1, 'SUBSCRIPTION_STATE_CANCELED', 1);
  // C: unverified renewal = active paid; D: unverified purchase only = not counted as paid
  ins.run('5', NOW, NOW - 2 * D, 'subscription', 2, 'C', 0, null, null);
  ins.run('6', NOW, NOW - 2 * D, 'subscription', 4, 'D', 0, null, null);
  p = await ST.proSubs(db, NOW);
  assert.deepEqual([p.trial_starts, p.new_subscriptions, p.conversions, p.cancels, p.active_paid, p.mrr_usd, p.unverified_events],
    [2, 3, 2, 1, 2, 15.98, 2]);
  assert.ok(!JSON.stringify(p).includes('"A"'), 'no purchase tokens leave the Worker');
});

test('UI: Coming soon tiles replaced by No data yet / Waiting for Play states', () => {
  assert.ok(!PAGE.js.includes("soon('Feature adoption'") && !PAGE.js.includes("soon('Pro MRR'"));
  assert.ok(PAGE.js.includes('No data yet') && PAGE.js.includes('Waiting for Play') && PAGE.js.includes('Maps vs Waze') && PAGE.js.includes('Stops per route'));
  assert.ok(!('feature_adoption' in ST.COMING_SOON) && !('pro_mrr' in ST.COMING_SOON));
});
