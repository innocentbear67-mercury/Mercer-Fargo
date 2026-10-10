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
  { re: /^https:\/\/data\.sec\.gov\/api\/xbrl\/companyfacts\/CIK\d{10}\.json$/, ttl: 3600, sec: true },
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

// (4) Web access for Marvell's harness: web search results and readable page text.
// read is a general fetcher, so it is GET-only, public http(s) hosts only, size-capped,
// returns text (never raw HTML), and rate-limited per IP.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decodeEnt(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const strip = (x) => decodeEnt(String(x || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
export function ddgParse(html) {
  const out = [];
  for (const b of String(html).split('class="result__a"').slice(1)) {
    const m = b.match(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!m) continue;
    let href = decodeEnt(m[1]);
    const u = href.match(/[?&]uddg=([^&]+)/);
    if (u) href = decodeURIComponent(u[1]);
    if (href.startsWith('//')) href = 'https:' + href;
    if (!/^https?:\/\//.test(href) || /duckduckgo\.com\/y\.js/.test(href)) continue;   // skip ads
    out.push({ title: strip(m[2]), url: href, snippet: strip((b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) || [])[1]) });
    if (out.length >= 10) break;
  }
  return out;
}
export function bingParse(html) {
  const out = [];
  for (const b of String(html).split('class="b_algo"').slice(1)) {
    const m = b.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!m) continue;
    let href = decodeEnt(m[1]);
    const u = href.match(/[?&]u=a1([^&]+)/);   // bing.com/ck/a redirect: the target is base64url after "a1"
    if (u) { try { href = atob(u[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(u[1].length / 4) * 4, '=')); } catch (e) { continue; } }
    if (!/^https?:\/\//.test(href)) continue;
    out.push({ title: strip(m[2]), url: href, snippet: strip((b.match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1]) });
    if (out.length >= 10) break;
  }
  return out;
}
export function htmlText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  let body = html.replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  body = body.replace(/<\/(p|div|h[1-6]|li|tr|br|section|article|table)>|<br\s*\/?>/gi, '\n').replace(/<(td|th)[^>]*>/gi, ' | ').replace(/<[^>]+>/g, ' ');
  body = decodeEnt(body).replace(/[ \t\f\v]+/g, ' ').replace(/\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title: decodeEnt(title).replace(/\s+/g, ' ').trim(), text: body };
}
export function publicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || h.startsWith('[')) return null;   // no literal IPs at all
  return u;
}
const HITS = new Map();   // ponytail: per-isolate counter, best effort; use a Rate Limiting binding if abused
function limited(req) {
  const ip = req.headers.get('cf-connecting-ip') || 'x', now = Date.now(), win = HITS.get(ip) || [];
  const recent = win.filter((t) => now - t < 60000);
  recent.push(now); HITS.set(ip, recent);
  if (HITS.size > 5000) HITS.clear();
  return recent.length > 40;
}
// Bing first (most reliable in testing); DuckDuckGo blocks bursts of automated queries, so it is the fallback.
const ENGINES = [
  ['Bing', (q) => 'https://www.bing.com/search?q=' + encodeURIComponent(q) + '&setlang=en&cc=US', bingParse],
  ['DuckDuckGo', (q) => 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), ddgParse],
];
async function searchResponse(q) {
  q = String(q || '').trim().slice(0, 300);
  if (!q) return json({ error: 'missing q' }, 400, 0);
  const tried = [];
  for (const [name, url, parse] of ENGINES) {
    try {
      const res = await fetch(url(q), { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' } });
      const results = res.ok ? parse(await res.text()) : [];
      if (results.length) return json({ query: q, results, _meta: { source: name } }, 200, 600);
      tried.push(name + (res.ok ? ': no results' : ': HTTP ' + res.status));
    } catch (e) { tried.push(name + ': ' + String((e && e.message) || e).slice(0, 80)); }
  }
  return json({ error: 'search unavailable (' + tried.join('; ') + ')' }, 502, 0);
}
async function readResponse(raw, env) {
  const u = publicUrl(raw);
  if (!u) return json({ error: 'only public http(s) pages can be read' }, 400, 0);
  const ua = /(^|\.)sec\.gov$/.test(u.hostname) ? 'MercerFargo research ' + ((env && env.SEC_CONTACT) || 'contact@example.com') : 'Mozilla/5.0';
  let res, hops = 0, cur = u;
  while (true) {   // follow redirects by hand so every hop passes publicUrl
    res = await fetch(cur.href, { redirect: 'manual', headers: { 'User-Agent': ua, Accept: 'text/html,text/plain,application/json,*/*' }, cf: { cacheTtl: 900, cacheEverything: true } });
    if (res.status < 300 || res.status > 399 || ++hops > 4) break;
    const next = publicUrl(new URL(res.headers.get('location') || '', cur).href);
    if (!next) return json({ error: 'redirected to a non-public address' }, 400, 0);
    cur = next;
  }
  if (!res.ok) return json({ error: 'page HTTP ' + res.status, url: cur.href }, 502, 0);
  const type = res.headers.get('content-type') || '';
  if (!/text\/|json|xml/.test(type)) return json({ error: 'not a text page (' + type.split(';')[0] + ')', url: cur.href }, 415, 0);
  const reader = res.body.getReader(), chunks = []; let size = 0;
  while (size < 3000000) { const c = await reader.read(); if (c.done) break; chunks.push(c.value); size += c.value.length; }
  reader.cancel().catch(() => {});
  const buf = new Uint8Array(size); let o = 0; for (const c of chunks) { buf.set(c.subarray(0, size - o), o); o += c.length; }
  const body = new TextDecoder().decode(buf);
  const page = /html/.test(type) ? htmlText(body) : { title: '', text: body };
  if (page.text.length < 400 && /just a moment|attention required|access denied|captcha|enable javascript/i.test(page.title + ' ' + page.text)) {
    return json({ error: 'this site blocks automated reading; try another source', url: cur.href }, 403, 0);
  }
  const max = 20000;
  return json({ url: cur.href, title: page.title, text: page.text.slice(0, max), truncated: page.text.length > max }, 200, 900);
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
    if ((url.pathname === '/api/search' || url.pathname === '/api/read') && req.method === 'GET') {
      if (limited(req)) return json({ error: 'too many requests, wait a minute' }, 429, 0);
      return url.pathname === '/api/search' ? searchResponse(url.searchParams.get('q')) : readResponse(url.searchParams.get('u') || '', env);
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
