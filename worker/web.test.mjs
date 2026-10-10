// node --test worker/  — parsers and the public-URL guard behind /api/search and /api/read.
import { test } from 'node:test';
import assert from 'node:assert';
import { ddgParse, bingParse, htmlText, publicUrl } from './opencode-proxy.js';

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
