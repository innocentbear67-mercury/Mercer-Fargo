// node --test worker/  — parsers and the public-URL guard behind /api/search and /api/read.
import { test } from 'node:test';
import assert from 'node:assert';
import { ddgParse, bingParse, htmlText, publicUrl, yahooEvents, normalizeYahoo, liveQuote, fetchFeed, bingNewsRss } from './opencode-proxy.js';

test('ddgParse unwraps redirect links and skips ads', () => {
  const html = '<a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a>' +
    '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x">Ex <b>A</b></a><a class="result__snippet" href="x">Snip &amp; more</a>';
  assert.deepEqual(ddgParse(html), [{ title: 'Ex A', url: 'https://example.com/a', snippet: 'Snip & more' }]);
  assert.deepEqual(ddgParse('<div class="anomaly-modal">bots</div>'), []);
});

test('bingParse decodes base64url targets', () => {
  const target = Buffer.from('https://en.wikipedia.org/wiki/TSMC').toString('base64url');
  const html = '<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;u=a1' + target + '&amp;ntb=1">TSMC - Wikipedia</a></h2><div class="b_caption"><p class="x">Taiwan&#39;s foundry</p></div></li>';
  assert.deepEqual(bingParse(html), [{ title: 'TSMC - Wikipedia', url: 'https://en.wikipedia.org/wiki/TSMC', snippet: "Taiwan's foundry" }]);
});

test('htmlText drops scripts and keeps the title', () => {
  const t = htmlText('<title>T &amp; Co</title><script>evil()</script><p>Hello</p><p>World</p>');
  assert.equal(t.title, 'T & Co');
  assert.ok(!t.text.includes('evil') && t.text.includes('Hello\nWorld'));
});

test('publicUrl refuses anything that is not a public http(s) host', () => {
  for (const bad of ['http://localhost/x', 'http://127.0.0.1/', 'http://10.0.0.1', 'http://[::1]/', 'file:///etc/passwd',
    'http://169.254.169.254/latest', 'http://intranet/', 'https://u:p@example.com/', 'http://0x7f000001/', 'http://printer.local/']) {
    assert.equal(publicUrl(bad), null, bad);
  }
  assert.ok(publicUrl('https://investor.tsmc.com/english'));
});

test('yahooEvents keeps splits and dividends in date order', () => {
  const j = { chart: { result: [{ events: { splits: { b: { date: 1598832000, numerator: 4, denominator: 1 } },
    dividends: { y: { date: 1700000000, amount: 0.24 }, x: { date: 1600000000, amount: 0.2 } } } }] } };
  const e = yahooEvents(j);
  assert.deepEqual(e.splits, [{ t: 1598832000, d: '2020-08-31', num: 4, den: 1 }]);
  assert.deepEqual(e.dividends.map((d) => d.amt), [0.2, 0.24]);
  assert.deepEqual(yahooEvents({}), { splits: [], dividends: [] });
});

test('normalizeYahoo puts open/high/low on the same dividend-adjusted basis as the close', () => {
  const j = { chart: { result: [{ timestamp: [1700000000, 1700086400], indicators: { quote: [{ open: [100, 101], high: [102, 103], low: [99, 100], close: [101, 102], volume: [1, 2] }], adjclose: [{ adjclose: [90.9, 102] }] } }] } };
  const b = normalizeYahoo(j, 'X', 'X', '5Y', '1d').bars;
  assert.ok(Math.abs(b[0].o - 90) < 1e-9 && Math.abs(b[0].h - 91.8) < 1e-9 && Math.abs(b[0].l - 89.1) < 1e-9 && b[0].c === 90.9);   // factor 0.9
  assert.deepEqual([b[1].o, b[1].h, b[1].l, b[1].c], [101, 103, 100, 102]);                                                          // no adjustment on the latest day
  const intra = normalizeYahoo({ chart: { result: [{ timestamp: [1700000000], indicators: { quote: [{ open: [5], high: [6], low: [4], close: [5.5], volume: [1] }] } }] } }, 'X', 'X', '1D', '5m').bars[0];
  assert.deepEqual([intra.o, intra.h, intra.l, intra.c], [5, 6, 4, 5.5]);                                                           // intraday has no adjclose: untouched
});

test('fetchFeed retries a 503 and stops at the first good answer', async () => {
  const seq = [{ ok: false, status: 503 }, { ok: false, status: 503 }, { ok: true, status: 200 }, { ok: true, status: 200 }];
  let n = 0;
  const res = await fetchFeed('https://x', {}, { tries: 4, ttl: 1 }, async () => seq[n++]);
  assert.equal(res.status, 200); assert.equal(n, 3);
  n = 0;
  const bad = await fetchFeed('https://x', {}, { ttl: 1 }, async () => { n++; return { ok: false, status: 503 }; });
  assert.equal(bad.status, 503); assert.equal(n, 1);   // feeds without `tries` are fetched once
  const gone = await fetchFeed('https://x', {}, { tries: 2, ttl: 1 }, async () => { throw new Error('timeout'); });
  assert.equal(gone, null);
});

test('bingNewsRss renames the publisher tag so the page shows the real source', () => {
  assert.equal(bingNewsRss('<item><title>T</title><News:Source>Reuters</News:Source></item>'), '<item><title>T</title><source>Reuters</source></item>');
});

// ---- Google sign-in + cloud sync (sync.js) ----
import { verifyGoogle, signSession, readSession, syncResponse, sealData, openData } from './sync.js';

const b64u = (b) => Buffer.from(b).toString('base64url');
async function googleFixture(claims = {}) {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k' + Math.random() };
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: jwk.kid }));
  const p = b64u(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'cid', sub: '123', email: 'A@x.com', email_verified: true, name: 'A', exp: Date.now() / 1000 + 600, ...claims }));
  const sig = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(h + '.' + p)));
  return { token: h + '.' + p + '.' + sig, fetchFn: async () => new Response(JSON.stringify({ keys: [jwk] })) };
}

test('verifyGoogle accepts a good token and rejects wrong audience, expiry, bad signature', async () => {
  const g = await googleFixture();
  assert.deepEqual(await verifyGoogle(g.token, 'cid', g.fetchFn), { sub: '123', email: 'a@x.com', name: 'A', picture: '' });
  await assert.rejects(verifyGoogle(g.token, 'other', g.fetchFn), /audience/);
  const old = await googleFixture({ exp: 1 });
  await assert.rejects(verifyGoogle(old.token, 'cid', old.fetchFn), /expired/);
  const [h, p] = g.token.split('.');
  await assert.rejects(verifyGoogle(h + '.' + p + '.' + b64u('x'.repeat(256)), 'cid', g.fetchFn), /signature/);
  const unv = await googleFixture({ email_verified: false });
  await assert.rejects(verifyGoogle(unv.token, 'cid', unv.fetchFn), /unverified/);
});

test('session tokens round-trip, expire and cannot be forged', async () => {
  const t = await signSession({ sub: '1', email: 'a@x.com' }, 'secret', 1000);
  assert.equal((await readSession(t, 'secret', 2000)).sub, '1');
  assert.equal(await readSession(t, 'other', 2000), null);
  assert.equal(await readSession(t, 'secret', 1000 + 31 * 864e5), null);
  const [b, s] = t.split('.');
  assert.equal(await readSession(b64u(JSON.stringify({ sub: '2', exp: 9e15 })) + '.' + s, 'secret'), null);
});

test('sync: sign in, store per account, optimistic revisions, isolation, delete', async () => {
  const kv = new Map(), env = { SESSION_SECRET: 's', GOOGLE_CLIENT_ID: 'cid', USERS: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => kv.set(k, v), delete: async (k) => kv.delete(k) } };
  const call = async (path, method, token, body, fetchFn) => { const r = await syncResponse(new Request('https://w' + path, { method, headers: token ? { authorization: 'Bearer ' + token } : {}, body: body && JSON.stringify(body) }), new URL('https://w' + path), env, fetchFn); return [r.status, await r.json()]; };
  const g = await googleFixture(), g2 = await googleFixture({ sub: '999', email: 'b@x.com' });
  const [s1, a] = await call('/api/auth/google', 'POST', '', { credential: g.token }, g.fetchFn);
  const [, b] = await call('/api/auth/google', 'POST', '', { credential: g2.token }, g2.fetchFn);
  assert.equal(s1, 200);
  assert.equal((await call('/api/sync', 'GET', ''))[0], 401);
  assert.deepEqual((await call('/api/sync', 'GET', a.token))[1], { rev: 0, data: {}, keysSealed: true });
  assert.equal((await call('/api/sync', 'PUT', a.token, { baseRev: 0, data: { fh3_pf: { v: [1], t: 5 } } }))[1].rev, 1);
  const [c, conflict] = await call('/api/sync', 'PUT', a.token, { baseRev: 0, data: {} });   // stale writer
  assert.equal(c, 409); assert.deepEqual(conflict.data.fh3_pf, { v: [1], t: 5 });
  assert.deepEqual((await call('/api/sync', 'GET', b.token))[1].data, {});                     // another account sees nothing
  assert.equal((await call('/api/sync', 'PUT', a.token, { baseRev: 1, data: [] }))[0], 400);
  await call('/api/sync', 'DELETE', a.token);
  assert.equal((await call('/api/sync', 'GET', a.token))[1].rev, 0);
});

test('sync: AI keys are sealed in KV and opened only for their own account', async () => {
  const kv = new Map(), env = { SESSION_SECRET: 's', GOOGLE_CLIENT_ID: 'cid', USERS: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => kv.set(k, v), delete: async (k) => kv.delete(k) } };
  const call = async (path, method, token, body, fetchFn) => { const r = await syncResponse(new Request('https://w' + path, { method, headers: token ? { authorization: 'Bearer ' + token } : {}, body: body && JSON.stringify(body) }), new URL('https://w' + path), env, fetchFn); return [r.status, await r.json()]; };
  const g = await googleFixture();
  const [, a] = await call('/api/auth/google', 'POST', '', { credential: g.token }, g.fetchFn);
  const keys = { v: JSON.stringify({ provider: 'openrouter', key: 'sk-secret-123' }), t: 7 };
  await call('/api/sync', 'PUT', a.token, { baseRev: 0, data: { fh3_keys: keys, fh3_pf: { v: '[]', t: 1 } } });
  const raw = [...kv.values()].join('');
  assert.ok(!raw.includes('sk-secret-123'));                                   // never in clear at rest
  assert.deepEqual((await call('/api/sync', 'GET', a.token))[1].data.fh3_keys, keys);
  const sealed = await sealData({ fh3_keys: keys }, 's', 'u1');
  assert.equal((await openData(sealed, 's', 'u2')).fh3_keys, undefined);       // another account's key cannot open it
  assert.deepEqual((await openData(sealed, 's', 'u1')).fh3_keys, keys);
});

test('liveQuote takes the regular price in session and the newest extended-hours bar outside it', () => {
  const meta = { regularMarketPrice: 100, regularMarketTime: 1000, chartPreviousClose: 98, currency: 'USD', currentTradingPeriod: { regular: { start: 500, end: 1000 } } };
  const mk = (ts, close, m) => ({ chart: { result: [{ meta: Object.assign({}, meta, m), timestamp: ts, indicators: { quote: [{ close }] } }] } });
  const reg = liveQuote(mk([900, 960], [99.5, 99.9], { regularMarketTime: 990 }), 'AAPL');
  assert.equal(reg.price, 100); assert.equal(reg.state, 'regular'); assert.equal(reg.delay, 0);
  const post = liveQuote(mk([960, 1200, 1260], [99.9, 101, null]), 'AAPL');
  assert.equal(post.price, 101); assert.equal(post.state, 'post'); assert.equal(post.regPrice, 100);
  const pre = liveQuote(mk([300], [97], { regularMarketTime: 200, currentTradingPeriod: { pre: { start: 250, end: 500 }, regular: { start: 500, end: 1000 } } }), 'AAPL');
  assert.equal(pre.state, 'pre'); assert.equal(pre.price, 97);
  const night = liveQuote(mk([240], [96], { regularMarketTime: 200, currentTradingPeriod: { pre: { start: 250, end: 500 }, regular: { start: 500, end: 1000 } } }), 'AAPL');
  assert.equal(night.state, 'post');   // last night's after-hours bar, seen after midnight
  assert.equal(liveQuote(mk([], [], { exchangeDataDelayedBy: 20 }), 'D05.SI').delay, 20);
  assert.equal(liveQuote({ chart: { result: [] } }, 'X'), null);
});
