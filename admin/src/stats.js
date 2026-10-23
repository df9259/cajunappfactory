// StopScope growth / cost / Dispatch stats from D1. Aggregates only: no locations, no per-user coordinates are ever selected.
// "Active" on a day = any user_usage row that day (app or web) OR app_users.last_seen_at on that day (last_seen only knows the latest day).
const DAY = 86400e3;
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
export const CAPS = { geocode: 500, routes: 500, optimize: 100, matrix: 8000 };          // stopscope-web src/geo.js global daily caps
export const FREE_MONTHLY = { geocode: 10000, routes: 10000 };          // Google Maps Platform Essentials free calls per SKU per month
export const PRICE = { base_month: 50, base_year: 450, seat_month: 5, seat_year: 45 };          // list prices (stopscope.com pricing)
const all = async (db, sql, ...b) => (await db.prepare(sql).bind(...b).all()).results || [];
const one = async (db, sql, ...b) => (await db.prepare(sql).bind(...b).first()) || {};

async function activeSets(db, fromDay) {
  const rows = await all(db, "SELECT DISTINCT day, kind || ':' || user_id AS u FROM user_usage WHERE day >= ?", fromDay);
  const seen = await all(db, "SELECT 'app:' || id AS u, strftime('%Y-%m-%d', last_seen_at/1000, 'unixepoch') AS day FROM app_users WHERE last_seen_at IS NOT NULL AND strftime('%Y-%m-%d', last_seen_at/1000, 'unixepoch') >= ?", fromDay);
  const by = new Map(); for (const r of [...rows, ...seen]) { if (!by.has(r.day)) by.set(r.day, new Set()); by.get(r.day).add(r.u); }
  return by;
}
const union = (by, days) => { const s = new Set(); for (const d of days) for (const u of by.get(d) || []) s.add(u); return s; };

export async function engagement(db, now = Date.now()) {
  const days = (n) => Array.from({ length: n }, (_, i) => ymd(now - i * DAY));
  const by = await activeSets(db, ymd(now - 29 * DAY));
  const dau = union(by, days(1)).size, wau = union(by, days(7)).size, mau = union(by, days(30)).size;
  return { dau, wau, mau, stickiness: mau ? Math.round((dau / mau) * 1000) / 10 : null, note: 'Active = any server API use or app open that day' };
}

/** Weekly cohorts by sign-up week (Mon, UTC); retention week k = active in days [7k, 7k+7) after their own sign-up day. */
export async function cohorts(db, now = Date.now(), weeks = 8) {
  const since = now - weeks * 7 * DAY;
  const users = await all(db, "SELECT 'app:' || id u, created_at c FROM app_users WHERE created_at >= ? UNION ALL SELECT 'web:' || id, created_at FROM users WHERE created_at >= ?", since, since);
  const act = await all(db, "SELECT DISTINCT kind || ':' || user_id u, day FROM user_usage WHERE day >= ?", ymd(since));
  const seen = await all(db, "SELECT 'app:' || id u, strftime('%Y-%m-%d', last_seen_at/1000, 'unixepoch') day FROM app_users WHERE last_seen_at >= ?", since);
  const days = new Map(); for (const r of [...act, ...seen]) { if (!days.has(r.u)) days.set(r.u, []); days.get(r.u).push(Date.parse(r.day + 'T00:00:00Z')); }
  const wk = (t) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return ymd(d); };
  const out = new Map();
  for (const x of users) {
    const k = wk(x.c); if (!out.has(k)) out.set(k, { week: k, size: 0, w: Array(weeks).fill(0) });
    const c = out.get(k); c.size++;
    const start = Date.parse(ymd(x.c) + 'T00:00:00Z'); const hit = new Set();
    for (const t of days.get(x.u) || []) { const i = Math.floor((t - start) / (7 * DAY)); if (i >= 0 && i < weeks) hit.add(i); }
    for (const i of hit) c.w[i]++;
  }
  return [...out.values()].sort((a, b) => a.week.localeCompare(b.week)).map((c) => {
    const elapsed = Math.floor((now - Date.parse(c.week + 'T00:00:00Z')) / (7 * DAY));
    return { week: c.week, size: c.size, retained_pct: c.w.slice(0, elapsed + 1).map((n) => Math.round((n / c.size) * 1000) / 10) };
  });
}

/** Activated = any user_usage within 7 days of sign-up, or (app) a tutorial_version set. Only users at least 7 days old count. */
export async function activation(db, now = Date.now()) {
  const cut = now - 7 * DAY;
  const r = await one(db, `SELECT COUNT(*) n, SUM(act) a FROM (
    SELECT CASE WHEN a.tutorial_version IS NOT NULL OR EXISTS (SELECT 1 FROM user_usage x WHERE x.kind='app' AND x.user_id=a.id AND x.day <= strftime('%Y-%m-%d', (a.created_at + ${7 * DAY})/1000, 'unixepoch')) THEN 1 ELSE 0 END act FROM app_users a WHERE a.created_at <= ?
    UNION ALL
    SELECT CASE WHEN EXISTS (SELECT 1 FROM user_usage x WHERE x.kind='web' AND x.user_id=u.id AND x.day <= strftime('%Y-%m-%d', (u.created_at + ${7 * DAY})/1000, 'unixepoch')) THEN 1 ELSE 0 END FROM users u WHERE u.created_at <= ?)`, cut, cut);
  const n = r.n || 0, a = r.a || 0;
  return { eligible: n, activated: a, rate_pct: n ? Math.round((a / n) * 1000) / 10 : null };
}

export async function signupsWeekly(db, now = Date.now(), weeks = 8) {
  const since = now - weeks * 7 * DAY;
  const rows = await all(db, `SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'weekday 0', '-6 days') wk,
      SUM(g) google, SUM(1-g) email, SUM(v) verified, SUM(1-v) unverified FROM (
    SELECT created_at, google_sub IS NOT NULL g, CASE WHEN email_verified=1 THEN 1 ELSE 0 END v FROM app_users WHERE created_at >= ?
    UNION ALL SELECT created_at, google_sub IS NOT NULL, email_verified_at IS NOT NULL FROM users WHERE created_at >= ?) GROUP BY wk ORDER BY wk`, since, since);
  return rows;
}

export async function goneQuiet(db, now = Date.now(), limit = 50) {
  const cut = now - 14 * DAY;
  return all(db, `SELECT 'app' kind, id, email, name, MAX(COALESCE(last_seen_at,0), last_sign_in_at) last FROM app_users WHERE MAX(COALESCE(last_seen_at,0), last_sign_in_at) < ?
    UNION ALL SELECT 'web', u.id, u.email, u.name, COALESCE((SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id=u.id), u.created_at) FROM users u
      WHERE COALESCE((SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id=u.id), u.created_at) < ?
    ORDER BY last DESC LIMIT ?`, cut, cut, limit);
}

export async function apiCost(db, now = Date.now()) {
  const from = ymd(now - 13 * DAY), month = ymd(now).slice(0, 7);
  const daily = await all(db, "SELECT day, api, count FROM api_usage WHERE scope='global' AND day >= ? AND api IN ('geocode','routes','optimize','matrix') ORDER BY day", from);
  const mtd = {}; for (const r of await all(db, "SELECT api, SUM(count) n FROM api_usage WHERE scope='global' AND substr(day,1,7)=? GROUP BY api", month)) mtd[r.api] = r.n;
  const free = Object.fromEntries(Object.entries(FREE_MONTHLY).map(([k, lim]) => [k, { month_to_date: mtd[k] || 0, free_monthly: lim, pct: Math.round(((mtd[k] || 0) / lim) * 1000) / 10 }]));
  const capped = daily.filter((r) => CAPS[r.api] && r.count >= CAPS[r.api]).map((r) => ({ day: r.day, api: r.api, count: r.count, cap: CAPS[r.api] }));
  const top = await all(db, `SELECT x.kind, x.user_id id, COALESCE(a.email, u.email) email, SUM(x.count) calls FROM user_usage x
    LEFT JOIN app_users a ON x.kind='app' AND a.id=x.user_id LEFT JOIN users u ON x.kind='web' AND u.id=x.user_id
    WHERE x.day >= ? AND x.api IN ('geocode','routes','optimize','matrix') GROUP BY x.kind, x.user_id ORDER BY calls DESC LIMIT 10`, ymd(now - 6 * DAY));
  return { daily, caps: CAPS, free, capped_days: capped, top_users_7d: top,
    note_429: 'Rejected (429) calls are not logged in D1; days that hit the daily cap are shown instead (every call past the cap got a 429).' };
}

export async function dispatchBiz(db, now = Date.now()) {
  const cos = await all(db, 'SELECT billing_status s, billing_interval i, seats_billed seats, free_license f, stripe_subscription_id sub, billing_ended_at ended FROM companies');
  const mix = {}; let mrr = 0, paying = 0, seats = 0;
  for (const c of cos) {
    const k = c.f ? 'free_license' : c.s || 'none'; mix[k] = (mix[k] || 0) + 1;
    if (!c.f && c.sub && ['active', 'past_due'].includes(c.s)) {
      paying++; seats += c.seats || 0;
      mrr += c.i === 'year' ? (PRICE.base_year + PRICE.seat_year * (c.seats || 0)) / 12 : PRICE.base_month + PRICE.seat_month * (c.seats || 0);
    }
  }
  const churned = (await one(db, "SELECT COUNT(*) n FROM companies WHERE free_license=0 AND (billing_ended_at IS NOT NULL OR billing_status IN ('canceled','unpaid','incomplete_expired'))")).n || 0;
  const deleted = (await one(db, 'SELECT COUNT(*) n FROM deleted_companies')).n || 0;
  const drivers = (await one(db, 'SELECT COUNT(*) n FROM drivers WHERE account_deleted_at IS NULL')).n || 0;
  return { mrr_usd: Math.round(mrr * 100) / 100, mrr_note: 'Estimated from list prices and billed seats (Stripe is in test mode)', paying_companies: paying,
    billed_seats: seats, drivers, status_mix: mix, churned_companies: churned, deleted_companies: deleted };
}

export async function routesOps(db) {
  const r = await one(db, "SELECT COUNT(*) n, SUM(status='completed') done, SUM(status IN ('in_progress','completed')) started FROM routes");
  const s = await one(db, "SELECT SUM(status='done') done, SUM(status='skipped') skipped, SUM(status='pending') pending FROM route_stops");
  const d = (await all(db, "SELECT finished_at - started_at ms FROM routes WHERE status='completed' AND started_at IS NOT NULL AND finished_at > started_at ORDER BY ms")).map((x) => x.ms);
  const med = d.length ? (d.length % 2 ? d[(d.length - 1) / 2] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2) : null;
  const inv = await one(db, "SELECT COUNT(*) n, SUM(status='active') accepted FROM drivers WHERE account_deleted_at IS NULL");
  const done = s.done || 0;
  const pr = await one(db, `SELECT SUM(EXISTS (SELECT 1 FROM stop_proofs p WHERE p.stop_id=s.id AND p.kind='photo')) photo,
    SUM(EXISTS (SELECT 1 FROM stop_proofs p WHERE p.stop_id=s.id AND p.kind='signature')) sig FROM route_stops s WHERE s.status='done'`);
  const bytes = (await one(db, 'SELECT COALESCE(SUM(bytes),0) b FROM stop_proofs')).b || 0;
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return { routes: r.n || 0, completed: r.done || 0, completion_pct: pct(r.done || 0, r.started || 0),
    stops_done: done, stops_skipped: s.skipped || 0, stops_pending: s.pending || 0, median_route_minutes: med == null ? null : Math.round(med / 60000),
    invites: inv.n || 0, invites_accepted: inv.accepted || 0, invite_accept_pct: pct(inv.accepted || 0, inv.n || 0),
    proof_photo_pct: pct(pr.photo || 0, done), proof_signature_pct: pct(pr.sig || 0, done), proof_storage_mb: Math.round((bytes / 1048576) * 100) / 100 };
}


// 10-23: feature adoption from feature_counters (stopscope-web migration 0027). Aggregates only: per-counter user counts and sums.
export const FEATURES = { optimize_runs: 'Optimize', csv_imports: 'Spreadsheet import', handoff_maps: 'Hand off to Maps', handoff_waze: 'Hand off to Waze',
  fuel_entries: 'Fuel log', mileage_sessions: 'Mileage tracking', routes_started: 'Routes started', route_stops: 'Route stops' };
const pct1 = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
export async function features(db, now = Date.now()) {
  const from30 = ymd(now - 29 * DAY), from7 = ymd(now - 6 * DAY);
  const n = (await one(db, 'SELECT COUNT(*) n FROM feature_counters WHERE day >= ? AND value > 0', from30)).n || 0;
  if (!n) return { has_data: false };
  const by = await activeSets(db, from30);
  const appActive = (from) => { const s = new Set(); for (const [d, set] of by) if (d >= from) for (const u of set) if (u.startsWith('app:')) s.add(u.slice(4)); return s; };
  const cu = async (from) => new Set((await all(db, 'SELECT DISTINCT app_user_id u FROM feature_counters WHERE day >= ? AND value > 0', from)).map((r) => r.u));
  const den = async (from) => { const s = appActive(from); for (const u of await cu(from)) s.add(u); return s.size; };          // counter senders were active too
  const a7 = await den(from7), a30 = await den(from30);
  const per = async (from) => Object.fromEntries((await all(db, 'SELECT counter, COUNT(DISTINCT app_user_id) users, SUM(value) total FROM feature_counters WHERE day >= ? AND value > 0 GROUP BY counter', from)).map((r) => [r.counter, r]));
  const p7 = await per(from7), p30 = await per(from30);
  const adoption = Object.entries(FEATURES).map(([k, label]) => ({ counter: k, label, users_7d: p7[k]?.users || 0, pct_7d: pct1(p7[k]?.users || 0, a7),
    users_30d: p30[k]?.users || 0, pct_30d: pct1(p30[k]?.users || 0, a30), total_30d: p30[k]?.total || 0 }));
  const daily = await all(db, 'SELECT day, counter, SUM(value) total FROM feature_counters WHERE day >= ? GROUP BY day, counter ORDER BY day', from30);
  const t = (k) => p30[k]?.total || 0, maps = t('handoff_maps'), waze = t('handoff_waze');
  return { has_data: true, active_app_users_7d: a7, active_app_users_30d: a30, adoption, daily,
    stops_per_route_30d: t('routes_started') ? Math.round((t('route_stops') / t('routes_started')) * 10) / 10 : null,
    handoff_30d: { maps, waze, maps_pct: pct1(maps, maps + waze), waze_pct: pct1(waze, maps + waze) } };
}

// 10-23: Pro trial funnel + MRR from subscription_events (Play RTDN, stopscope-web migration 0028). Pro = $7.99/month.
export const PRO_MONTHLY = 7.99;
const ACTIVE_STATES = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD']);
const PAID_TYPES = new Set([1, 2, 7]);          // RECOVERED, RENEWED, RESTARTED (type 4 PURCHASED may be a trial start)
export async function proSubs(db, now = Date.now()) {
  const tests = await one(db, "SELECT COUNT(*) n, MAX(received_at) last FROM subscription_events WHERE kind='test'");
  const ev = await all(db, "SELECT purchase_token tok, notification_type t, verified v, state, in_trial tr, expiry_time exp, COALESCE(event_time, received_at) at FROM subscription_events WHERE kind='subscription' AND purchase_token IS NOT NULL ORDER BY at, id");
  const base = { test_notifications: tests.n || 0, last_test_at: tests.last || null };
  if (!ev.length) return { has_data: false, ...base };
  const since = now - 30 * DAY, toks = new Map();
  for (const e of ev) { if (!toks.has(e.tok)) toks.set(e.tok, []); toks.get(e.tok).push(e); }
  let trials = 0, purchases = 0, conv = 0, cancels = 0, paid = 0;
  for (const list of toks.values()) {
    const inWin = list.filter((e) => e.at >= since);
    const buy = inWin.find((e) => e.t === 4);
    if (buy) { purchases++; if (buy.tr === 1) trials++; }
    const firstRenew = list.find((e) => e.t === 2);
    if (firstRenew && firstRenew.at >= since) conv++;
    if (inWin.some((e) => e.t === 3)) cancels++;
    const last = list[list.length - 1];
    const live = last.v ? ACTIVE_STATES.has(last.state) && last.tr !== 1 : PAID_TYPES.has(last.t) || (last.t === 4 && last.tr === 0);
    if (live && !(last.exp && last.exp < now)) paid++;
  }
  return { has_data: true, ...base, window_days: 30, trial_starts: trials, new_subscriptions: purchases, conversions: conv, cancels,
    active_paid: paid, mrr_usd: Math.round(paid * PRO_MONTHLY * 100) / 100, price: PRO_MONTHLY,
    unverified_events: ev.filter((e) => !e.v).length, total_events: ev.length,
    note: 'Conversions = first renewal (first paid charge after the trial). Unverified = raw Play notification, no Play API lookup.' };
}

export const COMING_SOON = {
  crash_free: 'Coming soon (Play reporting)', anr: 'Coming soon (Play reporting)', rating: 'Coming soon (Play reporting)',
  installs: 'Coming soon (Play reporting)', version_spread: 'Coming soon (Play reporting)' };

export async function all_(db, now = Date.now()) {
  return { engagement: await engagement(db, now), cohorts: await cohorts(db, now), activation: await activation(db, now),
    signups_weekly: await signupsWeekly(db, now), gone_quiet: await goneQuiet(db, now), api_cost: await apiCost(db, now),
    dispatch: await dispatchBiz(db, now), routes: await routesOps(db), features: await features(db, now), pro: await proSubs(db, now), coming_soon: COMING_SOON };
}
