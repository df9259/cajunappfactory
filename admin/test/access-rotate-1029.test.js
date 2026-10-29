// Claude Code audit 10-29 (cajunappfactory #1): after Access rotates its signing key, a token with the new key id is accepted at once
// (the cached key list is refreshed for an unknown kid, at most every 30 s). Before: refused for up to 10 minutes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccess, _resetCache } from '../src/access.js';
import { keys, sign, good, fetcherFor, TEAM, AUD } from './helpers.js';
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const rq = (j) => new Request('https://admin.cajunappfactory.com/', { headers: { 'Cf-Access-Jwt-Assertion': j } });
test('a rotated Access key works without waiting for the cache', async () => {
  _resetCache();
  const a = await keys(), b = await keys();
  const jb = { keys: b.jwks.keys.map((k) => ({ ...k, kid: 'k2' })) };
  const t0 = Date.now();
  assert.ok(await verifyAccess(rq(await sign(a.kp, good())), env, { fetcher: fetcherFor(a.jwks), now: t0 }));
  assert.ok(await verifyAccess(rq(await sign(b.kp, good(), 'k2')), env, { fetcher: fetcherFor(jb), now: t0 + 60e3 }), 'new kid accepted after refresh');
  let calls = 0; const f = async (u) => { calls++; return fetcherFor(jb)(u); };
  assert.equal(await verifyAccess(rq(await sign(b.kp, good(), 'k9')), env, { fetcher: f, now: t0 + 61e3 }), null);
  assert.equal(calls, 0, 'an unknown kid does not refetch more than every 30 s');
});
