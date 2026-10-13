// node --test genui.test.mjs — checks Marvell's Intelligent UI (genui.js): parsing, formulas, escaping and limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const G = createRequire(import.meta.url)('./genui.js');

const fence = (o) => '```ui\n' + (typeof o === 'string' ? o : JSON.stringify(o)) + '\n```';

test('parse splits text and ui blocks, keeps order, survives bad JSON and unclosed fences', () => {
  const t = 'Intro.\n\n' + fence({ type: 'buttons', items: [{ label: 'Go' }] }) + '\n\nOutro.';
  const p = G.parse(t);
  assert.deepEqual(p.map((x) => x.t), ['md', 'ui', 'md']);
  assert.equal(p[1].b.type, 'buttons');
  assert.equal(G.parse(fence('{nope')).find((x) => x.t === 'ui').b, null);
  assert.deepEqual(G.parse('hello\n```ui\n{"type":"chart"').map((x) => x.t), ['md']);   // still streaming: stays text
  assert.equal(G.plain(t), 'Intro.\n\nOutro.');
  assert.equal(G.hasUi(t), true);
  assert.equal(G.hasUi('plain ```ui``` inline'), false);
});

test('two blocks back to back both parse', () => {
  const t = fence({ type: 'buttons', items: ['a'] }) + '\n' + fence({ type: 'steps', steps: [{ title: 'a' }, { title: 'b' }] });
  assert.equal(G.parse(t).filter((x) => x.t === 'ui').length, 2);
});

test('formulas follow precedence and never run code', () => {
  const E = G.evalExpr;
  assert.equal(E('2 + 3 * 4'), 14);
  assert.equal(E('(2 + 3) * 4'), 20);
  assert.equal(E('2 ^ 3 ^ 2'), 512);
  assert.equal(E('-2 ^ 2'), -4);
  assert.ok(Math.abs(E('principal * (1 + rate/100) ^ years', { principal: 1000, rate: 10, years: 2 }) - 1210) < 1e-9);
  assert.equal(E('max(1, 5, 3) + min(2, 9)'), 7);
  assert.equal(E('round(sqrt(16)) + abs(-1)'), 5);
  for (const bad of ['', '1 +', '1 / 0', 'foo', 'constructor', 'alert(1)', 'process.exit()', '1; 2', '"a"', '__proto__', 'x.y', 'toString()', '((((1)']) assert.ok(Number.isNaN(G.evalExpr(bad, { x: 1 })), bad);
  assert.ok(Number.isNaN(G.evalExpr('1+'.repeat(200) + '1')));
});

test('numbers format with units and survive non-finite values', () => {
  assert.equal(G.fmtNum(1234.5, { prefix: '$', decimals: 1 }), '$1,234.5');
  assert.equal(G.fmtNum(1500000, { compact: true, prefix: '$' }), '$1.5M');
  assert.equal(G.fmtNum(NaN), '—');
  assert.equal(G.fmtNum(0.256, { suffix: '%' }), '0.256%');
});

test('every model-supplied string is escaped', () => {
  const evil = '<img src=x onerror=alert(1)>"\'';
  const specs = [
    { type: 'chart', title: evil, x: [evil], series: [{ name: evil, data: [1, 2] }], unit: evil },
    { type: 'table', title: evil, columns: [evil], rows: [[evil]] },
    { type: 'compare', title: evil, items: [{ name: evil, tag: evil, stats: { [evil]: evil }, points: [evil] }, { name: 'b' }] },
    { type: 'diagram', title: evil, nodes: [{ id: 'a', label: evil, detail: evil }, { id: 'b', label: 'b' }], edges: [['a', 'b', evil]] },
    { type: 'buttons', title: evil, items: [{ label: evil, ask: evil }] },
    { type: 'form', title: evil, fields: [{ id: 'q', label: evil, kind: 'select', options: [evil], default: evil }, { id: 't', label: evil, kind: 'text', default: evil }] },
    { type: 'explorer', title: evil, note: evil, inputs: [{ id: 'a', label: evil, prefix: evil }], outputs: [{ label: evil, expr: 'a', prefix: evil }] },
    { type: 'steps', title: evil, steps: [{ title: evil, body: evil }, { title: 'x' }] },
    { type: 'graphic', title: evil, shapes: [{ shape: 'text', x: 1, y: 1, text: evil }, { shape: 'rect', x: 1, y: 1, w: 5, h: 5, tone: evil }] },
    { type: 'columns', items: [{ type: 'steps', steps: [{ title: evil }, { title: 'b' }] }, { type: 'buttons', items: [evil] }] },
  ];
  specs.forEach((s, i) => {
    const html = G.render(s, 'k' + i);
    assert.ok(!/<img |<script|onerror=alert\(1\)>/.test(html.replace(/&lt;img[^]*?&gt;/g, '')), 'spec ' + i + ': ' + html.slice(0, 200));
    assert.ok(!html.includes(evil), 'raw string leaked in spec ' + i);
  });
});

test('images only load from allow-listed https hosts or local assets', () => {
  assert.ok(G.safeImg('https://upload.wikimedia.org/a/b.png'));
  assert.ok(G.safeImg('assets/logo.png'));
  for (const u of ['http://upload.wikimedia.org/a.png', 'https://evil.com/?q=memory', 'https://upload.wikimedia.org.evil.com/a.png', 'https://user:pw@upload.wikimedia.org/a.png',
    'javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'assets/../secret.png', '//evil.com/a.png', 'https://upload.wikimedia.org:8443/a.png']) assert.equal(G.safeImg(u), '', u);
  assert.match(G.render({ type: 'image', url: 'https://evil.com/x.png' }, 'k'), /could not be drawn/);
});

test('invalid or empty specs draw the quiet note, valid ones draw a block', () => {
  for (const s of [null, 5, {}, { type: 'nope' }, { type: 'chart', series: [] }, { type: 'table', columns: [], rows: [] }, { type: 'compare', items: [{ name: 'only one' }] },
    { type: 'diagram', nodes: [{ id: 'a', label: 'a' }], edges: [] }, { type: 'steps', steps: [{ title: 'one' }] }, { type: 'columns', items: [{ type: 'buttons', items: ['a'] }] },
    { type: 'columns', items: [{ type: 'columns', items: [] }, { type: 'columns', items: [] }] }, { type: 'explorer', inputs: [], outputs: [] }]) assert.match(G.render(s, 'k'), /could not be drawn/, JSON.stringify(s));
  assert.match(G.render({ type: 'chart', kind: 'bar', x: ['a', 'b'], series: [{ name: 's', data: [1, -2] }] }, 'k'), /<svg[\s\S]*<rect/);
  assert.match(G.render({ type: 'chart', x: ['a', 'b', 'c'], series: [{ data: [1, null, 3] }] }, 'k'), /<path/);
});

test('columns do not nest, and are capped at three', () => {
  const b = (n) => ({ type: 'buttons', items: ['x' + n] });
  assert.equal(G.clean({ type: 'columns', items: [b(1), b(2), b(3), b(4)] }).items.length, 3);
  assert.equal(G.clean({ type: 'columns', items: [{ type: 'columns', items: [b(1), b(2)] }, b(3)] }), null);
});

test('limits: big inputs are trimmed instead of rendered whole', () => {
  const rows = Array.from({ length: 500 }, (_, i) => ['r' + i, 'v']);
  assert.equal(G.clean({ type: 'table', columns: ['a', 'b'], rows }).rows.length, 60);
  const nodes = Array.from({ length: 40 }, (_, i) => ({ id: 'n' + i, label: 'n' + i }));
  assert.equal(G.clean({ type: 'diagram', nodes, edges: [] }).nodes.length, 12);
  assert.equal(G.clean({ type: 'chart', x: [], series: [{ data: Array.from({ length: 999 }, (_, i) => i) }] }).series[0].data.length, 120);
});

test('diagram layout handles chains, branches and cycles', () => {
  const d = G.clean({ type: 'diagram', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }], edges: [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'], ['d', 'a']] });
  const L = G.layout(d);
  assert.ok(L.pos.a.y < L.pos.b.y && L.pos.b.y < L.pos.d.y);
  assert.equal(L.pos.b.y, L.pos.c.y);
  assert.ok(Object.values(L.pos).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.match(G.render(d, 'k'), /data-iu="node"/);
  const edgeToUnknown = G.clean({ type: 'diagram', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [['a', 'zzz'], ['a', 'a'], ['a', 'b']] });
  assert.equal(edgeToUnknown.edges.length, 1);
});

test('explorer draws outputs from the starting values and plots the chosen output', () => {
  const spec = { type: 'explorer', inputs: [{ id: 'amt', label: 'Amount', min: 0, max: 10000, step: 100, value: 1000, prefix: '$' }, { id: 'yrs', label: 'Years', min: 1, max: 30, value: 10 }],
    outputs: [{ label: 'Value', expr: 'amt * 1.07 ^ yrs', prefix: '$', decimals: 0 }], plot: { over: 'yrs', output: 0 } };
  const html = G.render(spec, 'ex1');
  assert.match(html, /\$1,967/);
  assert.match(html, /iu-cur/);
  assert.equal(G.clean({ ...spec, plot: { over: 'nope', output: 0 } }).plot, null);
  const bad = G.render({ ...spec, outputs: [{ label: 'Oops', expr: 'amt / 0' }] }, 'ex2');
  assert.match(bad, /—/);
});

test('forms fill the ask template and fall back to label: value', () => {
  const fields = [{ id: 'amt', label: 'Amount' }, { id: 'risk', label: 'Risk' }];
  assert.equal(G.fillAsk('Plan for {amt} at {risk} risk', fields, { amt: 500, risk: 'low' }), 'Plan for 500 at low risk');
  assert.equal(G.fillAsk('', fields, { amt: 500, risk: 'low' }), 'Amount: 500, Risk: low');
  assert.equal(G.fillAsk('x {amt}', fields, { amt: '{risk}' }), 'x risk');
});

test('prompt: off forbids blocks, less limits them, auto lists every type', () => {
  assert.match(G.promptFor('off'), /never write a ui block/);
  assert.match(G.promptFor('less'), /fewer visuals/);
  const auto = G.promptFor('auto');
  G.TYPES.forEach((t) => assert.ok(auto.includes(t), t));
});
