// Cloudflare Access gate. FAIL CLOSED: no team/AUD vars, no JWT, bad signature, wrong aud/iss, expired, or any email
// missing -> null (caller returns 403). The email must also be the owner or an active caf_admins row (index.js).
export const ALLOWED_EMAIL = 'df9259@gmail.com';
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const dec = (s) => JSON.parse(new TextDecoder().decode(b64u(s)));
let cache = { url: '', at: 0, keys: [] };
async function certs(team, fetcher, now, kid) {
  const url = `https://${team}/cdn-cgi/access/certs`;
  // Claude Code audit 10-29: an unknown key id (Access rotated its key) refreshes the list at once, at most every 30 s
  if (cache.url === url && now - cache.at < 10 * 60e3 && cache.keys.length && (cache.keys.some((k) => k.kid === kid) || now - cache.at < 30e3)) return cache.keys;
  const r = await fetcher(url); if (!r.ok) return [];
  const j = await r.json();
  cache = { url, at: now, keys: (j.keys || []).filter((k) => k.kty === 'RSA') };
  return cache.keys;
}
export const _resetCache = () => { cache = { url: '', at: 0, keys: [] }; };
export const teamHost = (env) => {
  const t = String(env.ACCESS_TEAM_DOMAIN || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(t) ? t : '';
};
export async function verifyAccess(req, env, { fetcher = fetch, now = Date.now() } = {}) {
  try {
    const team = teamHost(env), aud = String(env.ACCESS_AUD || '').trim();
    if (!team || !/^[0-9a-f]{64}$/.test(aud)) return null;
    const jwt = req.headers.get('Cf-Access-Jwt-Assertion') || '';
    const parts = jwt.split('.'); if (parts.length !== 3) return null;
    const h = dec(parts[0]), p = dec(parts[1]);
    if (h.alg !== 'RS256' || !h.kid) return null;
    const jwk = (await certs(team, fetcher, now, h.kid)).find((k) => k.kid === h.kid); if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!ok) return null;
    const t = now / 1000;
    if (typeof p.exp !== 'number' || p.exp < t - 30) return null;
    if (typeof p.nbf === 'number' && p.nbf > t + 30) return null;
    if (p.iss !== `https://${team}`) return null;
    const auds = Array.isArray(p.aud) ? p.aud : [p.aud]; if (!auds.includes(aud)) return null;
    const email = String(p.email || '').toLowerCase();
    if (!email) return null;
    return { email };          // 10-29: who may use the admin (owner or an accepted invite) is decided in index.js
  } catch { return null; }
}
