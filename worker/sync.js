// Google sign-in + per-account cloud sync for the static site.
//   POST /api/auth/google {credential}  -> verifies the Google ID token, returns a 30-day session token
//   GET|PUT|DELETE /api/sync            -> one JSON document per Google account (KV), guarded by the session token
// Needs: KV binding USERS, var GOOGLE_CLIENT_ID (public), secret SESSION_SECRET.
// The AI keys entry (fh3_keys) is encrypted at rest (AES-GCM, a per-account key derived from SESSION_SECRET), so the KV store never holds them in clear.
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const SESSION_MS = 30 * 864e5;
const MAX_BYTES = 2_000_000;
const enc = new TextEncoder();
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const part = (s) => JSON.parse(new TextDecoder().decode(unb64u(s)));

let jwks = { at: 0, keys: [] };   // ponytail: per-isolate cache, Google rotates keys daily
async function googleKey(kid, fetchFn) {
  for (const fresh of [false, true]) {
    if (fresh || Date.now() - jwks.at > 36e5) jwks = { at: Date.now(), keys: (await (await fetchFn(JWKS_URL)).json()).keys || [] };
    const k = jwks.keys.find((x) => x.kid === kid);
    if (k) return crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  }
  return null;
}

// Throws on anything wrong; returns the verified identity.
export async function verifyGoogle(credential, clientId, fetchFn = fetch, now = Date.now()) {
  const [h, p, s] = String(credential || '').split('.');
  if (!h || !p || !s) throw new Error('malformed token');
  const head = part(h), c = part(p);
  if (head.alg !== 'RS256') throw new Error('bad alg');
  const key = await googleKey(head.kid, fetchFn);
  if (!key || !(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(s), enc.encode(h + '.' + p)))) throw new Error('bad signature');
  if (c.aud !== clientId) throw new Error('wrong audience');
  if (!/^(https:\/\/)?accounts\.google\.com$/.test(c.iss || '')) throw new Error('wrong issuer');
  if ((c.exp || 0) * 1000 < now) throw new Error('expired');
  if (!c.sub || !c.email || c.email_verified === false) throw new Error('unverified email');
  return { sub: String(c.sub), email: String(c.email).toLowerCase(), name: c.name || c.given_name || '', picture: c.picture || '' };
}

const hmac = (secret) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
export async function signSession(user, secret, now = Date.now()) {
  const body = b64u(enc.encode(JSON.stringify({ ...user, exp: now + SESSION_MS })));
  return body + '.' + b64u(await crypto.subtle.sign('HMAC', await hmac(secret), enc.encode(body)));
}
export async function readSession(token, secret, now = Date.now()) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !(await crypto.subtle.verify('HMAC', await hmac(secret), unb64u(sig), enc.encode(body)))) return null;
  const u = part(body);
  return u.exp > now && u.sub ? u : null;
}

const SECRET_KEYS = ['fh3_keys'];
async function vaultKey(secret, sub) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('mf-keys-v1'), info: enc.encode(sub) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// entry.v is the stored JSON string; sealed entries carry e:1 and v = base64url(iv + ciphertext)
export async function sealData(data, secret, sub) {
  const out = { ...data };
  for (const k of SECRET_KEYS) {
    const e = out[k];
    if (!e || e.e || typeof e.v !== 'string') continue;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await vaultKey(secret, sub), enc.encode(e.v)));
    const buf = new Uint8Array(12 + ct.length); buf.set(iv); buf.set(ct, 12);
    out[k] = { t: e.t, e: 1, v: b64u(buf) };
  }
  return out;
}
export async function openData(data, secret, sub) {
  const out = { ...data };
  for (const k of SECRET_KEYS) {
    const e = out[k];
    if (!e || !e.e) continue;
    try {
      const buf = unb64u(e.v);
      out[k] = { t: e.t, v: new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, await vaultKey(secret, sub), buf.slice(12))) };
    } catch (err) { delete out[k]; }   // a rotated secret: the device keeps its own copy and re-uploads it
  }
  return out;
}

export async function syncResponse(req, url, env, fetchFn = fetch) {
  if (!env.SESSION_SECRET || !env.USERS || !env.GOOGLE_CLIENT_ID) return json({ error: 'sync is not configured' }, 503);
  if (url.pathname === '/api/auth/google') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    let user;
    try { user = await verifyGoogle((await req.json()).credential, env.GOOGLE_CLIENT_ID, fetchFn); } catch (e) { return json({ error: 'invalid Google sign-in: ' + e.message }, 401); }
    return json({ token: await signSession(user, env.SESSION_SECRET), user, exp: Date.now() + SESSION_MS });
  }
  const user = await readSession((req.headers.get('authorization') || '').replace(/^Bearer /, ''), env.SESSION_SECRET);
  if (!user) return json({ error: 'sign in again' }, 401);
  const kvKey = 'u:' + user.sub;
  const cur = (await env.USERS.get(kvKey, 'json')) || { rev: 0, data: {} };
  const open = async (c) => ({ ...c, data: await openData(c.data || {}, env.SESSION_SECRET, user.sub), keysSealed: true });
  if (req.method === 'GET') return json(await open(cur));
  if (req.method === 'DELETE') { await env.USERS.delete(kvKey); return json({ ok: true }); }
  if (req.method !== 'PUT') return json({ error: 'method not allowed' }, 405);
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return json({ error: 'too large' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ error: 'bad json' }, 400); }
  if (!body || typeof body.data !== 'object' || Array.isArray(body.data)) return json({ error: 'bad body' }, 400);
  if (body.baseRev !== cur.rev) return json({ conflict: true, ...(await open(cur)) }, 409);   // someone else (another device) wrote since this client last pulled
  const next = { rev: cur.rev + 1, updated: Date.now(), data: await sealData(body.data, env.SESSION_SECRET, user.sub) };
  await env.USERS.put(kvKey, JSON.stringify(next));
  return json({ rev: next.rev, updated: next.updated });
}
