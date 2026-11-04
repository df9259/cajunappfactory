// Admin responses that share SEC must send HSTS. preload is omitted: this header is on admin.cajunappfactory.com only, and not every host under cajunappfactory.com is known to be HTTPS-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { _resetCache } from '../src/access.js';
import { makeDB, keys, sign, good, fetcherFor, TEAM, AUD } from './helpers.js';
const H = 'https://admin.cajunappfactory.com';
const HSTS = 'max-age=31536000; includeSubDomains';
const { kp, jwks } = await keys();
const env = { DB: makeDB(), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_USER_ID: 'admin1' };
const call = (path, jwt) => { _resetCache(); return handle(new Request(H + path, { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} }), env, { fetcher: fetcherFor(jwks) }); };

test('Strict-Transport-Security on HTML, assets, JSON, and the 403 gate', async () => {
  const j = await sign(kp, good());
  for (const p of ['/', '/admin.js', '/admin.css', '/api/me', '/invite']) {
    const r = await call(p, j);
    assert.equal(r.headers.get('Strict-Transport-Security'), HSTS, p);
    assert.doesNotMatch(r.headers.get('Strict-Transport-Security'), /preload/, p);
  }
  const denied = await call('/');
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Strict-Transport-Security'), HSTS);
});
