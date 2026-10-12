// node --test quant.test.mjs — checks the Quant engine on made-up prices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const QN = createRequire(import.meta.url)('./quant.js');

const days = 1500, mk = (f) => Array.from({ length: days }, (_, i) => { const d = new Date(Date.UTC(2015, 0, 1) + i * 864e5).toISOString().slice(0, 10), c = f(i); return { d, o: c, h: c * 1.01, l: c * .99, c, v: 1e6 }; });
const data = { SPY: mk((i) => 100 * Math.exp(i * .0003 + .05 * Math.sin(i / 15))), TLT: mk((i) => 100 + 5 * Math.sin(i / 40)) };

test('buy and hold the benchmark matches the benchmark', () => {
  const spec = { type: 'allocation', assets: [{ sym: 'SPY', weight: 1 }], rebalance: 'none', benchmark: 'SPY', cost_bps: 0, start: '2015-03-01' };
  const r = QN.backtest(spec, QN.align(data, 'SPY', QN.symbols(spec)));
  assert.ok(Math.abs(r.eq.at(-1) - r.bench.at(-1)) < 1e-9);
  assert.equal(r.dates[0] >= '2015-03-01', true);
});

test('an RSI rule trades, only after a signal, and costs reduce returns', () => {
  const spec = { type: 'signal', symbol: 'SPY', benchmark: 'SPY', entry: [{ a: { ind: 'rsi', len: '$n' }, op: '<', b: 35 }], exit: [{ a: { ind: 'rsi', len: '$n' }, op: '>', b: 60 }], params: [{ id: 'n', value: 14 }], cost_bps: 0 };
  const al = QN.align(data, 'SPY', QN.symbols(spec)), free = QN.backtest(spec, al), paid = QN.backtest(spec, al, { cost_bps: 20 });
  assert.ok(free.trades.length > 3);
  assert.ok(paid.eq.at(-1) < free.eq.at(-1));
  assert.ok(free.metrics.exposure > 0 && free.metrics.exposure < 100);
  assert.notEqual(QN.backtest(spec, al, { n: 5 }).eq.at(-1), free.eq.at(-1));   // a slider changes the result
});

test('60/40 rebalances and the projection fan is ordered', () => {
  const spec = { type: 'allocation', assets: [{ sym: 'SPY', weight: 60 }, { sym: 'TLT', weight: 40 }], rebalance: 'monthly', benchmark: 'SPY', cost_bps: 2 };
  const r = QN.backtest(spec, QN.align(data, 'SPY', QN.symbols(spec)));
  assert.ok(r.metrics.s.vol < r.metrics.b.vol);
  const p = QN.project(r.ret, { years: 5 });
  for (let i = 0; i < p.p5.length; i++) assert.ok(p.p5[i] <= p.p50[i] && p.p50[i] <= p.p95[i]);
  assert.deepEqual(QN.project(r.ret, { years: 5 }).end, p.end);   // same seed, same fan
  assert.ok(QN.project(r.ret, { years: 5, drift: 5 }).end[2] > p.end[2]);
});
