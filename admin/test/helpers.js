import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
export function makeDB() {
  const sql = new Database(':memory:'); sql.pragma('foreign_keys = ON');
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    first: async () => { const s = sql.prepare(q); return (s.reader ? s.get(...args) : (s.run(...args), null)) ?? null; },
    run: async () => { const s = sql.prepare(q); return s.reader ? { results: s.all(...args) } : s.run(...args); },
    all: async () => ({ results: sql.prepare(q).all(...args) }),
  });
  return { prepare: (q) => stmt(q), _sql: sql };
}
export const TEAM = 'cajun.cloudflareaccess.com', AUD = 'a'.repeat(64);
const b64u = (b) => Buffer.from(b).toString('base64url');
export async function keys() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  return { kp, jwks: { keys: [{ ...pub, kid: 'k1', alg: 'RS256' }] } };
}
export async function sign(kp, claims, kid = 'k1') {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })), p = b64u(JSON.stringify(claims));
  const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(new Uint8Array(s));
}
export const good = (o = {}) => ({ aud: [AUD], iss: 'https://' + TEAM, email: 'df9259@gmail.com', exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), ...o });
export const fetcherFor = (jwks) => async (url) => url === `https://${TEAM}/cdn-cgi/access/certs` ? new Response(JSON.stringify(jwks)) : new Response('no', { status: 404 });
