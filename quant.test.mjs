// node --test quant.test.mjs — checks the Quant engine on made-up prices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const QN = createRequire(import.meta.url)('./qengine.js');

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

// ---- batch 1: risk stats, robustness checks, allocation methods, volatility models
const rnd = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const gauss = (r) => () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const series = (n, mu, sg, seed) => { const g = gauss(rnd(seed)); return Array.from({ length: n }, () => mu + sg * g()); };
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (±${tol})`);

test('normal cdf and inverse match textbook values', () => {
  near(QN.ncdf(1.96), .975, 1e-4); near(QN.ncdf(-1), .158655, 1e-4); near(QN.ninv(.975), 1.959964, 1e-5); near(QN.ninv(.05), -1.644854, 1e-5);
});

test('tail stats: CVaR is worse than VaR, omega and gain-to-pain follow the mean', () => {
  const r = series(2000, .0005, .01, 3), s = QN.riskStats(r, series(2000, .0003, .01, 4), 0);
  assert.ok(s.cvar95 > s.var95 && s.var95 > 0);
  near(s.var95, s.varNormal95, .4);                        // near-normal data: historical and normal VaR agree
  assert.ok(s.omega > 1 && s.gainToPain > 0);
  assert.ok(QN.riskStats(series(2000, -.0005, .01, 5), null, 0).omega < 1);
  assert.ok(Number.isFinite(s.ir) && Number.isFinite(s.treynor) && s.te > 0);
});

test('PSR, DSR, bootstrap and hold-out behave', () => {
  const good = series(1500, .0008, .01, 6), noise = series(1500, 0, .01, 7);
  assert.ok(QN.psr(good, 0) > .95);
  assert.ok(Math.abs(QN.psr(noise, 0) - .5) < .35);
  assert.ok(QN.dsr(good, 25, .5) < QN.psr(good, 0));      // more tries, less credit
  const b = QN.bootstrap(good); assert.ok(b.sharpe[0] < b.sharpe[1] && b.sharpe[1] < b.sharpe[2]); assert.ok(b.probSharpePositive > 90);
  assert.deepEqual(QN.bootstrap(good).sharpe, b.sharpe);   // seeded
  const h = QN.holdout([...series(1000, .001, .01, 8), ...series(500, -.003, .01, 9)]); assert.equal(h.verdict, 'Fails out of sample');
  assert.equal(QN.holdout(series(1500, .0008, .01, 10)).outSample.days, 450);
});

test('allocation methods give the textbook weights', () => {
  const X = [series(1500, 0, .01, 11), series(1500, 0, .02, 12), series(1500, 0, .03, 13)];   // uncorrelated, vol 1:2:3
  const iv = QN.weights('inverse_vol', X); near(iv[0] / iv[1], 2, .15); near(iv[1] / iv[2], 1.5, .15);
  const mv = QN.weights('min_variance', X); assert.ok(mv[0] > mv[1] && mv[1] > mv[2]); near(mv.reduce((a, b) => a + b), 1, 1e-9);
  const rp = QN.weights('risk_parity', X), sh = QN.riskShare(rp, X).share; sh.forEach((v) => near(v, 100 / 3, 2));   // equal risk contributions
  const hr = QN.weights('hrp', X); near(hr.reduce((a, b) => a + b), 1, 1e-9); assert.ok(hr.every((w) => w > 0) && hr[0] > hr[2]);
  const up = [series(1500, .001, .01, 14), series(1500, .0002, .01, 15), series(1500, -.001, .01, 16)], ms = QN.weights('max_sharpe', up);
  assert.ok(ms[0] > ms[1] && ms[2] < .05); near(ms.reduce((a, b) => a + b), 1, 1e-9);        // the loser is dropped (long only)
  near(QN.weights('equal', X)[1], 1 / 3, 1e-12);
});

test('GARCH recovers persistence and the range estimators recover volatility', () => {
  const g = gauss(rnd(21)), n = 6000, r = []; let h = 1e-4;
  for (let i = 0; i < n; i++) { const e = Math.sqrt(h) * g(); r.push(e); h = 1e-4 * (1 - .98) + .08 * e * e + .9 * h; }
  const f = QN.garch(r); near(f.persistence, .98, .025); assert.ok(f.longRunVol > 0 && f.nextYearVol > 0);
  const sg = .01, sub = 60, gg = gauss(rnd(22)), bars = { o: [], h: [], l: [], c: [] }; let px = 100;
  for (let d = 0; d < 400; d++) { const o = px; let hi = px, lo = px; for (let k = 0; k < sub; k++) { px *= Math.exp(sg / Math.sqrt(sub) * gg()); hi = Math.max(hi, px); lo = Math.min(lo, px); } bars.o.push(o); bars.h.push(hi); bars.l.push(lo); bars.c.push(px); }
  const rv = QN.rangeVol(bars, 300), truth = sg * Math.sqrt(252) * 100;
  [rv.parkinson, rv.garmanKlass, rv.yangZhang].forEach((v) => near(v / truth, 1, .2));
});

test('allocation backtest: risk parity and volatility targeting change the book as asked', () => {
  const g = gauss(rnd(31)), px = (s, v) => { let p = 100; return mk((i) => (i === 0 ? p : (p *= 1 + s + v * g()))); };
  const d3 = { AAA: px(.0004, .01), BBB: px(.0003, .02), CCC: px(.0002, .04) };
  const base = { type: 'allocation', assets: [{ sym: 'AAA', weight: 1 }, { sym: 'BBB', weight: 1 }, { sym: 'CCC', weight: 1 }], rebalance: 'monthly', benchmark: 'AAA', cost_bps: 0, start: '2016-01-01' };
  const al = QN.align(d3, 'AAA', QN.symbols(base)), eq = QN.backtest(base, al), rp = QN.backtest({ ...base, method: 'risk_parity' }, al), vt = QN.backtest({ ...base, method: 'risk_parity', vol_target: 5 }, al);
  assert.ok(rp.metrics.s.vol < eq.metrics.s.vol);                                   // equal-risk beats equal-weight on risk
  assert.ok(rp.alloc.weights[0] > rp.alloc.weights[2]);
  rp.alloc.share.share.forEach((v) => near(v, 100 / 3, 6));
  assert.ok(vt.metrics.s.vol < rp.metrics.s.vol * .6 && vt.alloc.exposure < 100);   // 5% target, the rest in cash
  assert.ok(QN.backtest({ ...base, method: 'hrp' }, al).alloc.weights.every((w) => w > 0));
  assert.ok(eq.metrics.risk.cvar95 > 0 && eq.metrics.risk.omega > 0);
});

test('sensitivity grid and validate() on a rule with dials', () => {
  const spec = { type: 'signal', symbol: 'SPY', benchmark: 'SPY', entry: [{ a: { ind: 'rsi', len: 14 }, op: '<', b: '$buy' }], exit: [{ a: { ind: 'rsi', len: 14 }, op: '>', b: '$sell' }],
    params: [{ id: 'buy', label: 'Buy below', value: 35, min: 20, max: 45, step: 5 }, { id: 'sell', label: 'Sell above', value: 60, min: 55, max: 75, step: 5 }] };
  const al = QN.align(data, 'SPY', QN.symbols(spec)), bt = QN.backtest(spec, al), sens = QN.sensitivity(spec, al, {});
  assert.equal(sens.grid.length, sens.ys.length); assert.equal(sens.trials, sens.xs.length * sens.ys.length);
  const v = QN.validate(bt, sens, 0); assert.ok(v.psr >= 0 && v.psr <= 1 && v.dsr <= v.psr + 1e-9 && v.boot && v.hold);
});
