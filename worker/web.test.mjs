// node --test worker/  — parsers and the public-URL guard behind /api/search and /api/read.
import { test } from 'node:test';
import assert from 'node:assert';
import { ddgParse, bingParse, htmlText, publicUrl, yahooEvents, normalizeYahoo, fetchFeed, bingNewsRss } from './opencode-proxy.js';

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
