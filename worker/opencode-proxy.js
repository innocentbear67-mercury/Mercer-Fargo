// Cloudflare Worker: (1) CORS relay for OpenCode Zen/Go (existing, untouched);
// (2) edge market-data chart endpoint so the static site gets fast, cached
// bars on any device without serve.py. Yahoo v8 is the upstream (sub-100ms
// server-side); only slim OHLCV bars travel to the browser.
const ALLOW = /^https:\/\/opencode\.ai\/zen\//;
const PASS = ['authorization', 'content-type', 'x-api-key', 'anthropic-version', 'x-opencode-session'];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': PASS.join(','), 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-max-age': '86400' };

// Mirrors serve.py OA_YMAP / OA_RANGE. Third RANGE element = edge cache seconds.
const YMAP = { '^SPX': '^GSPC', '^IQX': '^IXIC', '^DJI': '^DJI', '^RUT': '^RUT', '^UKX': '^FTSE', '^DAX': '^GDAXI', '^CAC': '^FCHI', '^NKX': '^N225', '^HSI': '^HSI', '^SHC': '000001.SS', '^NDQ': '^NDX', '^VIX': '^VIX', 'ES.F': 'ES=F', 'NQ.F': 'NQ=F', 'YM.F': 'YM=F', 'GC.F': 'GC=F', 'CL.F': 'CL=F' };
const RANGE = { '1D': ['1d', '5m', 120], '5D': ['5d', '15m', 120], '1M': ['1mo', '1d', 1800], '6M': ['6mo', '1d', 1800], 'YTD': ['ytd', '1d', 1800], '1Y': ['1y', '1d', 1800], '5Y': ['5y', '1wk', 3600], 'MAX': ['max', '1mo', 86400] };

function json(o, status, maxAge) {
  return new Response(JSON.stringify(o), { status, headers: Object.assign({ 'content-type': 'application/json', 'cache-control': 'public, max-age=' + maxAge }, cors) });
}

export function normalizeYahoo(j, symbol, ysym, r, i) {
  const res = ((j && j.chart) || {}).result || [];
  if (!res.length) throw new Error((((j && j.chart) || {}).error || {}).description || 'no result');
  const r0 = res[0], ts = r0.timestamp || [];
  const q = (((r0.indicators || {}).quote) || [{}])[0];
  const adj = (((r0.indicators || {}).adjclose) || [{}])[0].adjclose;
  const bars = [];
  for (let n = 0; n < ts.length; n++) {
    const c = (adj && n < adj.length && adj[n] != null) ? adj[n] : (q.close || [])[n];
    if (c == null) continue;
    bars.push({ t: ts[n], d: new Date(ts[n] * 1000).toISOString().slice(0, 10), o: (q.open || [])[n], h: (q.high || [])[n], l: (q.low || [])[n], c, v: (q.volume || [])[n] ?? null });
  }
  if (!bars.length) throw new Error('no bars');
  const meta = r0.meta || {};
  return { symbol, yahooSymbol: ysym, range: r, interval: i, currency: meta.currency, exchange: meta.fullExchangeName || meta.exchangeName, previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null, bars, _meta: { source: 'Yahoo Finance chart via edge worker' } };
}

async function chartResponse(symbol, rng) {
  const s = String(symbol || 'AAPL').toUpperCase();
  const ysym = YMAP[s] || s;
  const [r, i, ttl] = RANGE[String(rng || '1M').toUpperCase()] || RANGE['1M'];
  let lastErr = 'yahoo unavailable';
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    const url = 'https://' + host + '/v8/finance/chart/' + encodeURIComponent(ysym) + '?range=' + r + '&interval=' + i;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cf: { cacheTtl: ttl, cacheEverything: true } });
      if (res.status === 404) { lastErr = 'yahoo 404: unknown symbol'; continue; }
      if (!res.ok) { lastErr = 'yahoo HTTP ' + res.status; continue; }
      return json(normalizeYahoo(await res.json(), s, ysym, r, i), 200, Math.min(ttl, 900));
    } catch (e) { lastErr = String((e && e.message) || e).slice(0, 120); }
  }
  return json({ error: lastErr }, 502, 0);
}

// (3) Read-only relay for the feeds a browser can't reach: they send no CORS
// headers (Google News, OpenInsider, TraderHub) or refuse browsers outright
// (www.sec.gov wants a contactable User-Agent). Allow-listed by host and path,
// GET only, cached at the edge for `ttl` seconds.
export const FEEDS = [
  { re: /^https:\/\/news\.google\.com\/rss\/search\?/, ttl: 600 },
  { re: /^https:\/\/feeds\.finance\.yahoo\.com\/rss\/2\.0\/headline\?s=[\w^.,=%-]+&region=US&lang=en-US$/, ttl: 600 },  // Google News blocks Cloudflare's IPs
  { re: /^https?:\/\/openinsider\.com\/screener\?/, ttl: 1800, http: true },
  { re: /^https:\/\/traderhub\.openalice\.ai\/api\/reference\/[a-z-]+$/, ttl: 300 },
  { re: /^https:\/\/data\.sec\.gov\/submissions\/CIK\d{10}\.json$/, ttl: 900, sec: true },
  { re: /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d{18}\/[\w.\-]+$/, ttl: 86400 * 30, sec: true },  // accessioned: immutable
];

async function feedResponse(u, env) {
  const f = FEEDS.find((x) => x.re.test(u));
  if (!f) return new Response('Not allowed', { status: 403, headers: cors });
  if (f.http) u = u.replace(/^https:/, 'http:');   // openinsider's TLS port refuses connections
  const headers = { 'User-Agent': f.sec ? 'MercerFargo research ' + ((env && env.SEC_CONTACT) || 'contact@example.com') : 'Mozilla/5.0' };
  const res = await fetch(u, { headers, cf: { cacheTtl: f.ttl, cacheEverything: true } });
  const out = new Headers({ 'content-type': res.headers.get('content-type') || 'text/plain', 'cache-control': 'public, max-age=' + (res.ok ? Math.min(f.ttl, 3600) : 0) });
  for (const k in cors) out.set(k, cors[k]);
  return new Response(res.body, { status: res.status, headers: out });   // streamed: big 10-Ks pass straight through
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/api/chart' && req.method === 'GET') {
      return chartResponse(url.searchParams.get('symbol'), url.searchParams.get('range'));
    }
    if (url.pathname === '/api/fetch' && req.method === 'GET') {
      return feedResponse(url.searchParams.get('u') || '', env);
    }
    // Existing OpenCode relay, unchanged.
    const target = url.searchParams.get('u') || '';
    const okGet = req.method === 'GET' && /\/models$/.test(target);
    if ((req.method !== 'POST' && !okGet) || !ALLOW.test(target)) return new Response('Not allowed', { status: 403, headers: cors });
    const headers = new Headers();
    for (const h of PASS) if (req.headers.has(h)) headers.set(h, req.headers.get(h));
    const res = await fetch(target, okGet ? { method: 'GET', headers } : { method: 'POST', headers, body: await req.arrayBuffer() });
    const out = new Headers(res.headers);
    for (const k in cors) out.set(k, cors[k]);
    return new Response(res.body, { status: res.status, headers: out });
  },
};
