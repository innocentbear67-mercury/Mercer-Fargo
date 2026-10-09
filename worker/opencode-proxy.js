// Cloudflare Worker: adds CORS to OpenCode Zen/Go so the static site can call them.
// Relays the request as-is and stores nothing. Only opencode.ai/zen/* is reachable.
const ALLOW = /^https:\/\/opencode\.ai\/zen\//;
const PASS = ['authorization', 'content-type', 'x-api-key', 'anthropic-version', 'x-opencode-session'];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': PASS.join(','), 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-max-age': '86400' };

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const target = new URL(req.url).searchParams.get('u') || '';
    const okGet = req.method === 'GET' && /\/models$/.test(target);   // the public model list
    if ((req.method !== 'POST' && !okGet) || !ALLOW.test(target)) return new Response('Not allowed', { status: 403, headers: cors });
    const headers = new Headers();
    for (const h of PASS) if (req.headers.has(h)) headers.set(h, req.headers.get(h));
    const res = await fetch(target, okGet ? { method: 'GET', headers } : { method: 'POST', headers, body: await req.arrayBuffer() });
    const out = new Headers(res.headers);
    for (const k in cors) out.set(k, cors[k]);
    return new Response(res.body, { status: res.status, headers: out });
  },
};
