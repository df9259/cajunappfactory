// Before: no admin existed. After: every page and API fails closed unless a valid Access JWT for df9259@gmail.com is present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { _resetCache } from '../src/access.js';
import { makeDB, keys, sign, good, fetcherFor, TEAM, AUD } from './helpers.js';
const H = 'https://admin.cajunappfactory.com';
const { kp, jwks } = await keys(); const other = await keys();
const env = { DB: makeDB(), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_USER_ID: 'admin1' };
const call = (path, jwt, e = env, init = {}) => { _resetCache(); return handle(new Request(H + path, { ...init, headers: { ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}), ...(init.headers || {}) } }), e, { fetcher: fetcherFor(jwks) }); };
const PATHS = ['/', '/admin.js', '/apps/stopscope', '/api/me', '/api/apps/stopscope/overview', '/api/apps/stopscope/stats', '/api/apps/stopscope/users', '/api/apps/stopscope/user?kind=app&id=x', '/nope'];

test('valid JWT for df9259@gmail.com passes', async () => {
  const j = await sign(kp, good());
  assert.equal((await call('/api/me', j)).status, 200);
  assert.equal((await call('/', j)).status, 200);
  assert.equal((await call('/api/apps/stopscope/overview', j)).status, 200);
});
test('no JWT -> 403 everywhere', async () => { for (const p of PATHS) assert.equal((await call(p)).status, 403, p);
  assert.equal((await call('/api/apps/stopscope/toggle', null, env, { method: 'POST' })).status, 403); });
test('bad JWTs -> 403', async () => {
  const bad = [ 'garbage', 'a.b.c', await sign(other.kp, good()), await sign(kp, good(), 'nokid'),
    await sign(kp, good({ exp: Math.floor(Date.now() / 1000) - 3600 })), await sign(kp, good({ aud: ['b'.repeat(64)] })),
    await sign(kp, good({ iss: 'https://evil.cloudflareaccess.com' })), await sign(kp, good({ nbf: Math.floor(Date.now() / 1000) + 3600 })) ];
  const t = (await sign(kp, good())).split('.'); bad.push(t[0] + '.' + Buffer.from(JSON.stringify(good({ email: 'x@y.com' }))).toString('base64url') + '.' + t[2]);
  const nh = Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url'); bad.push(nh + '.' + t[1] + '.');
  for (const j of bad) for (const p of PATHS) assert.equal((await call(p, j)).status, 403, p);
});
test('wrong email -> 403 (incl. case/lookalikes and missing)', async () => {
  for (const email of ['someone@gmail.com', 'df9259@gmail.com.evil.com', 'xdf9259@gmail.com', '', undefined])
    for (const p of PATHS) assert.equal((await call(p, await sign(kp, good({ email })))).status, 403, `${email} ${p}`);
});
test('Access not configured (empty vars) -> 403 even with a token', async () => {
  const j = await sign(kp, good());
  for (const e of [{ ...env, ACCESS_AUD: '' }, { ...env, ACCESS_TEAM_DOMAIN: '' }, { ...env, ACCESS_TEAM_DOMAIN: 'evil.com' }, { DB: env.DB }])
    for (const p of PATHS) assert.equal((await call(p, j, e)).status, 403, p);
});
test('toggle needs same-origin header even with a valid JWT', async () => {
  const j = await sign(kp, good());
  const r = await call('/api/apps/stopscope/toggle', j, env, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  assert.equal(r.status, 403);
});
