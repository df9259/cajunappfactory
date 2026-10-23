// Overview, users list/search, detail, toggles + admin_audit; and the extra growth/cost/Dispatch stats. Before: none of these existed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { _resetCache } from '../src/access.js';
import * as SS from '../src/stopscope.js';
import * as ST from '../src/stats.js';
import { makeDB, keys, sign, good, fetcherFor, TEAM, AUD } from './helpers.js';
const D = 86400e3, NOW = Date.parse('2026-10-23T12:00:00Z'), ymd = (t) => new Date(t).toISOString().slice(0, 10);
function seed() {
  const db = makeDB(), s = db._sql;
  s.prepare("INSERT INTO users (id,email,name,google_sub,email_verified_at,created_at,sign_in_count) VALUES ('w1','owner@x.com','Owner','g1',1,?,3)").run(NOW - 20 * D);
  s.prepare("INSERT INTO users (id,email,name,pw_hash,created_at) VALUES ('w2','bot@x.com','zzz','h',?)").run(NOW - 2 * D);
  s.prepare("INSERT INTO companies (id,name,created_at,billing_status,billing_interval,seats_billed,stripe_subscription_id) VALUES ('c1','Acme',?,'active','month',2,'sub_1')").run(NOW - 20 * D);
  s.prepare("INSERT INTO companies (id,name,created_at,billing_status,billing_ended_at) VALUES ('c2','Gone',?,'canceled',?)").run(NOW - 20 * D, NOW - D);
  s.prepare("INSERT INTO memberships VALUES ('w1','c1','owner',?)").run(NOW);
  s.prepare("INSERT INTO drivers (id,company_id,email,name,status,created_at) VALUES ('d1','c1','drv@x.com','Drv','active',?),('d2','c1','inv@x.com','Inv','invited',?)").run(NOW, NOW);
  s.prepare("INSERT INTO app_users (id,email,name,google_sub,email_verified,created_at,last_sign_in_at,last_seen_at,tutorial_version) VALUES ('a1','drv@x.com','Drv','g2',1,?,?,?,1)").run(NOW - 10 * D, NOW - 10 * D, NOW - 3600e3);
  s.prepare("INSERT INTO app_users (id,email,name,email_verified,created_at,last_sign_in_at) VALUES ('a2','solo@x.com','Solo',0,?,?)").run(NOW - 30 * D, NOW - 30 * D);
  s.prepare("INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES ('t','w1',?,?)").run(NOW - D, NOW + D);
  s.prepare("INSERT INTO routes (id,company_id,name,driver_id,status,created_at,updated_at,started_at,finished_at,start_lat,start_lng) VALUES ('r1','c1','R','d1','completed',?,?,?,?,30.1,-91.1),('r2','c1','R2','d1','in_progress',?,?,?,NULL,30,-91)").run(NOW, NOW, NOW - 90 * 60e3, NOW, NOW, NOW, NOW);
  s.prepare("INSERT INTO route_stops (id,route_id,company_id,position,address,status,lat,lng) VALUES ('s1','r1','c1',1,'A','done',1,1),('s2','r1','c1',2,'B','done',1,1),('s3','r1','c1',3,'C','skipped',1,1),('s4','r2','c1',1,'D','pending',1,1)").run();
  s.prepare("INSERT INTO stop_proofs (id,company_id,route_id,stop_id,driver_id,kind,r2_key,content_type,bytes,client_id,created_at) VALUES ('p1','c1','r1','s1','d1','photo','k1','image/jpeg',1048576,'x',?),('p2','c1','r1','s1','d1','signature','k2','image/png',524288,'y',?)").run(NOW, NOW);
  const today = ymd(NOW);
  s.prepare("INSERT INTO user_usage (day,kind,user_id,api,count) VALUES (?,'app','a1','geocode',40),(?,'web','w1','routes',5),(?,'web','w1','geocode',3)").run(today, ymd(NOW - 5 * D), ymd(NOW - 19 * D));
  s.prepare("INSERT INTO api_usage (day,scope,api,count) VALUES (?,'global','geocode',500),(?,'global','routes',20),(?,'global','geocode',100)").run(today, today, ymd(NOW - D));
  return db;
}

test('overview stats are real counts', async () => {
  const o = await SS.overview(seed(), NOW);
  assert.equal(o.app_users, 2); assert.equal(o.website_users, 2); assert.equal(o.personal, 1); assert.equal(o.companies, 2); assert.equal(o.drivers, 2);
  assert.equal(o.signups.length, 30); assert.equal(o.methods.google, 2); assert.equal(o.not_connected.rating, 'Not connected yet');
});
test('users list: search, filter, paging; never returns hashes', async () => {
  const db = seed();
  const all = await SS.listUsers(db, {}); assert.equal(all.total, 4);
  assert.ok(!JSON.stringify(all).includes('pw_hash') && !JSON.stringify(all).includes('"h"'));
  assert.equal((await SS.listUsers(db, { q: 'acme' })).total, 2);
  assert.equal((await SS.listUsers(db, { q: '%' })).total, 0, 'LIKE wildcards escaped');
  assert.equal((await SS.listUsers(db, { type: 'personal' })).total, 1);
  assert.equal((await SS.listUsers(db, { page: 99 })).users.length, 0);
});
test('toggles via API write the rows and an admin_audit row each', async () => {
  const db = seed(); const { kp, jwks } = await keys(); const j = await sign(kp, good());
  const env = { DB: db, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_USER_ID: 'admin1' }, H = 'https://admin.cajunappfactory.com';
  const post = (body) => { _resetCache(); return handle(new Request(H + '/api/apps/stopscope/toggle', { method: 'POST', body: JSON.stringify(body),
    headers: { 'Cf-Access-Jwt-Assertion': j, 'X-Admin': '1', Origin: H, 'Content-Type': 'application/json' } }), env, { fetcher: fetcherFor(jwks) }); };
  const q = (sql) => db._sql.prepare(sql).get();
  assert.equal((await post({ kind: 'app', id: 'a2', what: 'pro_comp', on: true })).status, 200);
  assert.equal(q("SELECT pro_comp v FROM app_users WHERE id='a2'").v, 1);
  assert.equal((await post({ kind: 'web', id: 'w1', what: 'pro_comp', on: true })).status, 200);
  assert.equal(q("SELECT pro_comp v FROM users WHERE id='w1'").v, 1);
  assert.equal((await post({ kind: 'web', id: 'w1', what: 'dispatch_license', on: true })).status, 200);
  assert.equal(q("SELECT free_license v FROM companies WHERE id='c1'").v, 1);
  assert.equal((await post({ kind: 'web', id: 'w1', what: 'dispatch_license', on: false })).status, 200);
  assert.equal(q("SELECT free_license v FROM companies WHERE id='c1'").v, 0);
  assert.equal((await post({ kind: 'app', id: 'a2', what: 'dispatch_license', on: true })).status, 409, 'no owned company');
  assert.equal((await post({ kind: 'app', id: 'nope', what: 'pro_comp', on: true })).status, 404);
  assert.equal((await post({ kind: 'app', id: 'a2', what: 'drop', on: true })).status, 400);
  const rows = db._sql.prepare('SELECT admin_user_id, action, target_kind, target_id, target_email FROM admin_audit ORDER BY id').all();
  assert.deepEqual(rows.map((r) => r.action), ['pro-comp-on', 'pro-comp-on', 'license-on', 'license-off']);
  assert.ok(rows.every((r) => r.admin_user_id === 'admin1' && r.target_email));
  const d = await SS.userDetail(db, 'web', 'w1', NOW);
  assert.equal(d.pro_comp, true); assert.equal(d.license_toggle, true); assert.equal(d.audit.length, 3); assert.equal(d.routes, 2);
});
test('engagement DAU/WAU/MAU + stickiness', async () => {
  const e = await ST.engagement(seed(), NOW);
  assert.equal(e.dau, 1); assert.equal(e.wau, 2); assert.equal(e.mau, 2); assert.equal(e.stickiness, 50);
});
test('activation, cohorts, weekly sign-ups, gone quiet', async () => {
  const db = seed();
  const a = await ST.activation(db, NOW); assert.equal(a.eligible, 3); assert.equal(a.activated, 2);          // a1 tutorial, w1 usage day 1; a2 none
  const c = await ST.cohorts(db, NOW); assert.equal(c.reduce((x, k) => x + k.size, 0), 4);
  const w1c = c.find((k) => k.retained_pct[0] === 100 && k.size === 1); assert.ok(w1c);
  const sw = await ST.signupsWeekly(db, NOW); assert.equal(sw.reduce((x, r) => x + r.google, 0), 2); assert.equal(sw.reduce((x, r) => x + r.unverified, 0), 2);
  const gq = await ST.goneQuiet(db, NOW); assert.deepEqual(gq.map((x) => x.email), ['solo@x.com']);
});
test('API cost watch, Dispatch business, route ops; no coordinates leak', async () => {
  const db = seed();
  const c = await ST.apiCost(db, NOW);
  assert.equal(c.free.geocode.month_to_date, 600); assert.equal(c.capped_days.length, 1); assert.equal(c.top_users_7d[0].email, 'drv@x.com');
  const d = await ST.dispatchBiz(db, NOW);
  assert.equal(d.mrr_usd, 60); assert.equal(d.billed_seats, 2); assert.equal(d.churned_companies, 1); assert.equal(d.status_mix.active, 1);
  const r = await ST.routesOps(db);
  assert.equal(r.completion_pct, 50); assert.equal(r.stops_done, 2); assert.equal(r.stops_skipped, 1); assert.equal(r.median_route_minutes, 90);
  assert.equal(r.invite_accept_pct, 50); assert.equal(r.proof_photo_pct, 50); assert.equal(r.proof_signature_pct, 50); assert.equal(r.proof_storage_mb, 1.5);
  const s = JSON.stringify(await ST.all_(db, NOW));
  assert.ok(!/lat|lng|30\.1|-91/.test(s), 'no locations in stats');
  assert.match(s, /Coming soon \(Play reporting\)/);
});
