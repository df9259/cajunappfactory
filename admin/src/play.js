// Play data feed (daily cron): crash/ANR (Play Developer Reporting), rating (recent reviews), version spread, installs (Play GCS bucket).
// Uses PLAY_SA_JSON (Worker secret). Results cached in D1 play_stats_cache; each source fails independently (error kept, last good value kept).
export const PKG = 'com.cajunappfactory.stopscope', BUCKET = 'pubsite_prod_7847036704169665650';
const SCOPES = 'https://www.googleapis.com/auth/playdeveloperreporting https://www.googleapis.com/auth/androidpublisher https://www.googleapis.com/auth/devstorage.read_only';
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));

export async function accessToken(sa, fetcher = fetch, now = Date.now()) {
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const iat = Math.floor(now / 1000), unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({ iss: sa.client_email, scope: SCOPES, aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const r = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + unsigned + '.' + b64u(sig) });
  if (!r.ok) throw new Error('token ' + r.status);
  return (await r.json()).access_token;
}

const day = (t) => { const d = new Date(t); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), timeZone: { id: 'America/Los_Angeles' } }; };
const ymd = (o) => `${o.year}-${String(o.month).padStart(2, '0')}-${String(o.day).padStart(2, '0')}`;
const num = (m) => m == null ? null : Number(m.decimalValue?.value ?? m.decimalValue ?? m.value ?? m);

async function g(fetcher, tok, url, body) {
  const r = await fetcher(url, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + tok, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r;
}

// Rate metric over the last 28 days of fresh data. Returns {rate_pct, users, days, as_of} or {no_data}.
export async function rateMetric(fetcher, tok, set, metric) {
  const base = `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${PKG}/${set}`;
  const meta = await (await g(fetcher, tok, base)).json();
  const f = (meta.freshnessInfo?.freshnesses || []).find((x) => x.aggregationPeriod === 'DAILY');
  if (!f) return { no_data: true };
  const end = Date.UTC(f.latestEndTime.year, f.latestEndTime.month - 1, f.latestEndTime.day);
  const q = { timelineSpec: { aggregationPeriod: 'DAILY', startTime: day(end - 28 * 864e5), endTime: day(end) }, metrics: [metric, 'distinctUsers'] };
  const rows = (await (await g(fetcher, tok, base + ':query', q)).json()).rows || [];
  let users = 0, affected = 0;
  for (const r of rows) { const m = Object.fromEntries((r.metrics || []).map((x) => [x.metric, num(x)])); const u = m.distinctUsers || 0; users += u; affected += (m[metric] || 0) * u; }
  const as_of = ymd(f.latestEndTime);
  if (!users) return { no_data: true, as_of };
  return { rate_pct: Math.round(affected / users * 10000) / 100, users: Math.round(users), days: rows.length, as_of };
}

export async function versionSpread(fetcher, tok) {
  const base = `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${PKG}/crashRateMetricSet`;
  const meta = await (await g(fetcher, tok, base)).json();
  const f = (meta.freshnessInfo?.freshnesses || []).find((x) => x.aggregationPeriod === 'DAILY');
  if (!f) return { no_data: true };
  const end = Date.UTC(f.latestEndTime.year, f.latestEndTime.month - 1, f.latestEndTime.day);
  const q = { timelineSpec: { aggregationPeriod: 'DAILY', startTime: day(end - 7 * 864e5), endTime: day(end) }, dimensions: ['versionCode'], metrics: ['distinctUsers'] };
  const rows = (await (await g(fetcher, tok, base + ':query', q)).json()).rows || [];
  const by = {};
  for (const r of rows) { const v = (r.dimensions || []).find((d) => d.dimension === 'versionCode'); const k = v ? String(v.stringValue ?? v.int64Value) : '?'; by[k] = (by[k] || 0) + (num((r.metrics || []).find((x) => x.metric === 'distinctUsers')) || 0); }
  const tot = Object.values(by).reduce((a, b) => a + b, 0);
  if (!tot) return { no_data: true, as_of: ymd(f.latestEndTime) };
  return { as_of: ymd(f.latestEndTime), versions: Object.entries(by).sort((a, b) => b[1] - a[1]).map(([v, u]) => ({ version_code: v, pct: Math.round(u / tot * 1000) / 10 })) };
}

export async function rating(fetcher, tok) {
  const j = await (await g(fetcher, tok, `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}/reviews?maxResults=100`)).json();
  const stars = (j.reviews || []).map((r) => r.comments?.find((c) => c.userComment)?.userComment.starRating).filter((s) => s >= 1);
  if (!stars.length) return { no_data: true, note: 'No reviews in the last 7 days (Play API window)' };
  return { avg: Math.round(stars.reduce((a, b) => a + b, 0) / stars.length * 10) / 10, count: stars.length, note: 'Reviews from the last 7 days' };
}

// Play installs CSV is UTF-16LE with BOM.
export function parseInstallsCsv(buf) {
  const u8 = new Uint8Array(buf); let text;
  if (u8[0] === 0xff && u8[1] === 0xfe) text = new TextDecoder('utf-16le').decode(u8.subarray(2)); else text = new TextDecoder().decode(u8).replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const h = lines[0].split(','), ix = (n) => h.indexOf(n);
  const rows = lines.slice(1).map((l) => l.split(','));
  const last = rows[rows.length - 1]; if (!last) return null;
  const get = (r, n) => ix(n) < 0 ? null : Number(r[ix(n)]) || 0;
  const sum = (n) => rows.slice(-30).reduce((a, r) => a + (get(r, n) || 0), 0);
  return { as_of: last[ix('Date')], total_user_installs: get(last, 'Total User Installs'), active_devices: get(last, 'Active Device Installs'), installs_30d: sum('Daily User Installs'), uninstalls_30d: sum('Daily User Uninstalls') };
}

export async function installs(fetcher, tok) {
  const pre = `stats/installs/installs_${PKG}_`;
  const list = await (await g(fetcher, tok, `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?prefix=${encodeURIComponent(pre)}`)).json();
  const files = (list.items || []).map((i) => i.name).filter((n) => n.endsWith('_overview.csv')).sort();
  if (!files.length) return { no_data: true };
  const r = await g(fetcher, tok, `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(files[files.length - 1])}?alt=media`);
  return parseInstallsCsv(await r.arrayBuffer()) || { no_data: true };
}

const DDL = 'CREATE TABLE IF NOT EXISTS play_stats_cache (key TEXT PRIMARY KEY, value TEXT, error TEXT, fetched_at INTEGER, ok_at INTEGER)';
export async function refresh(env, { fetcher = fetch, now = Date.now() } = {}) {
  await env.DB.prepare(DDL).run();
  if (!env.PLAY_SA_JSON) return { error: 'no_credential' };
  const tok = await accessToken(JSON.parse(env.PLAY_SA_JSON), fetcher, now);
  const jobs = { crash: () => rateMetric(fetcher, tok, 'crashRateMetricSet', 'userPerceivedCrashRate'), anr: () => rateMetric(fetcher, tok, 'anrRateMetricSet', 'userPerceivedAnrRate'),
    versions: () => versionSpread(fetcher, tok), rating: () => rating(fetcher, tok), installs: () => installs(fetcher, tok) };
  const out = {};
  for (const [k, f] of Object.entries(jobs)) {
    try { const v = await f(); out[k] = 'ok';
      await env.DB.prepare('INSERT INTO play_stats_cache (key,value,error,fetched_at,ok_at) VALUES (?,?,NULL,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,error=NULL,fetched_at=excluded.fetched_at,ok_at=excluded.ok_at').bind(k, JSON.stringify(v), now, now).run();
    } catch (e) { out[k] = String(e.message || e);
      await env.DB.prepare('INSERT INTO play_stats_cache (key,value,error,fetched_at,ok_at) VALUES (?,NULL,?,?,NULL) ON CONFLICT(key) DO UPDATE SET error=excluded.error,fetched_at=excluded.fetched_at').bind(k, out[k], now).run(); }
  }
  return out;
}

export async function cached(db) {
  await db.prepare(DDL).run();
  const rows = (await db.prepare('SELECT key,value,error,fetched_at,ok_at FROM play_stats_cache').all()).results || [];
  const o = {};
  for (const r of rows) o[r.key] = { data: r.value ? JSON.parse(r.value) : null, error: r.error, fetched_at: r.fetched_at, ok_at: r.ok_at };
  return o;
}
