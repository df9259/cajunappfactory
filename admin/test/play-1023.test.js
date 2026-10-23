// 10-23 Play data feed. Before: Installs/Rating/Crash/ANR/Version tiles were static "Not connected yet"/"Coming soon".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as PL from '../src/play.js';
import worker, { handle } from '../src/index.js';
import { PAGE } from '../src/ui.js';
import { makeDB } from './helpers.js';

async function fakeSa() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  return JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\n' + der + '\n-----END PRIVATE KEY-----\n' });
}
const FR = { freshnessInfo: { freshnesses: [{ aggregationPeriod: 'DAILY', latestEndTime: { year: 2026, month: 10, day: 17 } }] } };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
function utf16(s) { const b = Buffer.from(s, 'utf16le'); return Buffer.concat([Buffer.from([0xff, 0xfe]), b]); }
const CSV = 'Date,Package Name,Daily Device Installs,Daily Device Uninstalls,Daily Device Upgrades,Total User Installs,Daily User Installs,Daily User Uninstalls,Active Device Installs\n2026-10-20,p,1,0,0,40,2,1,30\n2026-10-21,p,1,0,0,43,3,0,32\n';

function fetcher({ storage403 = false } = {}) {
  const calls = [];
  const f = async (url, init = {}) => { url = String(url); calls.push(url);
    if (url.includes('oauth2.googleapis.com/token')) { assert.match(init.body, /assertion=[\w-]+\.[\w-]+\.[\w-]+/); return J({ access_token: 'AT' }); }
    assert.equal(init.headers.Authorization, 'Bearer AT');
    if (url.includes('storage.googleapis.com')) { if (storage403) return J({}, 403);
      if (url.includes('alt=media')) return new Response(utf16(CSV));
      return J({ items: [{ name: 'stats/installs/installs_com.cajunappfactory.stopscope_202609_overview.csv' }, { name: 'stats/installs/installs_com.cajunappfactory.stopscope_202610_overview.csv' }, { name: 'stats/installs/installs_com.cajunappfactory.stopscope_202610_country.csv' }] }); }
    if (url.includes('/reviews')) return J({ reviews: [{ comments: [{ userComment: { starRating: 5 } }] }, { comments: [{ userComment: { starRating: 4 } }] }] });
    if (url.endsWith('MetricSet')) return J(FR);
    const q = JSON.parse(init.body);
    if (q.dimensions) return J({ rows: [{ dimensions: [{ dimension: 'versionCode', stringValue: '114' }], metrics: [{ metric: 'distinctUsers', decimalValue: { value: '30' } }] }, { dimensions: [{ dimension: 'versionCode', stringValue: '113' }], metrics: [{ metric: 'distinctUsers', decimalValue: { value: '10' } }] }] });
    const m = q.metrics[0];
    return J({ rows: [{ metrics: [{ metric: m, decimalValue: { value: m.includes('Crash') ? '0.02' : '0' } }, { metric: 'distinctUsers', decimalValue: { value: '50' } }] }, { metrics: [{ metric: m, decimalValue: { value: '0' } }, { metric: 'distinctUsers', decimalValue: { value: '50' } }] }] });
  };
  f.calls = calls; return f;
}

test('installs CSV (UTF-16LE) parsed: latest total, 30-day sums', () => {
  assert.deepEqual(PL.parseInstallsCsv(utf16(CSV)), { as_of: '2026-10-21', total_user_installs: 43, active_devices: 32, installs_30d: 5, uninstalls_30d: 1 });
});

test('refresh caches every source; latest monthly overview file is read', async () => {
  const db = makeDB(), f = fetcher();
  const r = await PL.refresh({ DB: db, PLAY_SA_JSON: await fakeSa() }, { fetcher: f, now: 1000 });
  assert.deepEqual(r, { crash: 'ok', anr: 'ok', versions: 'ok', rating: 'ok', installs: 'ok' });
  const c = await PL.cached(db);
  assert.equal(c.crash.data.rate_pct, 1); assert.equal(c.crash.data.users, 100); assert.equal(c.anr.data.rate_pct, 0);
  assert.deepEqual(c.versions.data.versions, [{ version_code: '114', pct: 75 }, { version_code: '113', pct: 25 }]);
  assert.deepEqual([c.rating.data.avg, c.rating.data.count], [4.5, 2]);
  assert.equal(c.installs.data.total_user_installs, 43);
  assert.ok(f.calls.some((u) => u.includes('202610_overview.csv')));
});

test('installs 403 is isolated: others cached, installs keeps error and last good value', async () => {
  const db = makeDB(), sa = await fakeSa();
  await PL.refresh({ DB: db, PLAY_SA_JSON: sa }, { fetcher: fetcher(), now: 1000 });
  const r = await PL.refresh({ DB: db, PLAY_SA_JSON: sa }, { fetcher: fetcher({ storage403: true }), now: 2000 });
  assert.equal(r.crash, 'ok'); assert.equal(r.installs, 'HTTP 403');
  const c = await PL.cached(db);
  assert.equal(c.installs.error, 'HTTP 403'); assert.equal(c.installs.data.total_user_installs, 43); assert.equal(c.installs.ok_at, 1000);
});

test('no credential: nothing fetched; empty metrics -> no_data', async () => {
  const db = makeDB();
  assert.deepEqual(await PL.refresh({ DB: db }, { fetcher: () => { throw new Error('no'); } }), { error: 'no_credential' });
  const f = async (u) => String(u).endsWith('MetricSet') ? J(FR) : J({});
  assert.deepEqual(await PL.rateMetric(f, 'AT', 'crashRateMetricSet', 'userPerceivedCrashRate'), { no_data: true, as_of: '2026-10-17' });
});

test('worker exports scheduled; play API is behind Access; UI has no static Not connected tiles', async () => {
  assert.equal(typeof worker.scheduled, 'function');
  const r = await handle(new Request('https://admin.cajunappfactory.com/api/apps/stopscope/play'), { DB: makeDB() });
  assert.equal(r.status, 403);
  assert.ok(PAGE.js.includes('playSec') && !PAGE.js.includes("tile('Installs','Not connected yet'"));
});
