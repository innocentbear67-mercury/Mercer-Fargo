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
  const r = series(2000, .0005, .01, 3), bm = series(2000, .0003, .01, 4).map((x, i) => x + .6 * r[i]), s = QN.riskStats(r, bm, 0);
  assert.ok(s.cvar95 > s.var95 && s.var95 > 0);
  near(s.var95, s.varNormal95, .4);                        // near-normal data: historical and normal VaR agree
  assert.ok(s.omega > 1 && s.gainToPain > 0);
  assert.ok(QN.riskStats(series(2000, -.0005, .01, 5), null, 0).omega < 1);
  assert.equal(QN.riskStats(r, series(2000, 0, .01, 99), 0).treynor, null);   // beta about 0: Treynor is undefined, not a huge number
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

// ---- stress-test regressions
test('risk parity is equal-risk on CORRELATED assets and does not depend on listing order', () => {
  const g = gauss(rnd(77)), n = 750, f1 = Array.from({ length: n }, g), f2 = Array.from({ length: n }, g);
  const X = Array.from({ length: 6 }, (_, i) => Array.from({ length: n }, (_, k) => .0003 * (1 + i % 3) + (.007 + .003 * i) * ((i < 3 ? .7 : .2) * f1[k] + (i >= 3 ? .7 : .2) * f2[k] + .5 * g())));
  QN.riskShare(QN.weights('risk_parity', X), X).share.forEach((v) => near(v, 100 / 6, 1.2));
  for (const m of ['equal', 'inverse_vol', 'risk_parity', 'min_variance', 'max_sharpe', 'hrp']) {
    const ref = QN.weights(m, X), pm = [5, 3, 0, 4, 1, 2], w = QN.weights(m, pm.map((i) => X[i]));
    pm.forEach((i, k) => near(w[k], ref[i], 1e-6));
  }
});

test('min-variance and max-Sharpe match a brute-force search of the simplex', () => {
  const g = gauss(rnd(2024)), n = 750, p = 4, f = Array.from({ length: n }, g);
  const X = [0, 1, 2, 3].map((i) => Array.from({ length: n }, (_, k) => .0003 * (i + 1) + (.008 + .004 * i) * (.6 * f[k] * (i % 2 ? 1 : .8) + .8 * g())));
  const { S, mu } = QN.shrink(X), q = (w) => w.reduce((a, wi, i) => a + wi * w.reduce((b, wj, j) => b + wj * S[i][j], 0), 0), gm = mu.reduce((a, b) => a + b) / p, mus = mu.map((m) => .5 * m + .5 * gm);
  let bv = Infinity, bs = -Infinity;
  for (let a = 0; a <= 30; a++) for (let b = 0; a + b <= 30; b++) for (let c = 0; a + b + c <= 30; c++) { const w = [a, b, c, 30 - a - b - c].map((x) => x / 30); bv = Math.min(bv, q(w)); bs = Math.max(bs, w.reduce((s, wi, i) => s + wi * mus[i], 0) / Math.sqrt(q(w))); }
  assert.ok(q(QN.weights('min_variance', X)) <= bv * 1.002);
  const ms = QN.weights('max_sharpe', X); assert.ok(ms.reduce((s, wi, i) => s + wi * mus[i], 0) / Math.sqrt(q(ms)) >= bs * .998);
});

test('degenerate inputs: flat series, bad settings and unknown names do not break or short the book', () => {
  assert.equal(QN.garch(new Array(500).fill(0)), null);
  assert.equal(QN.garch(new Array(500).fill(.001)), null);
  const spec = (x) => ({ type: 'allocation', assets: [{ sym: 'SPY', weight: 1 }, { sym: 'TLT', weight: 1 }], rebalance: 'monthly', benchmark: 'SPY', cost_bps: 0, start: '2016-01-01', ...x });
  const al = QN.align(data, 'SPY', ['SPY', 'TLT']);
  assert.ok(QN.backtest(spec({ vol_target: -5 }), al).alloc.exposure > 0);                       // negative target is ignored, never a short
  assert.ok(QN.backtest(spec({ vol_target: 100, max_leverage: 50 }), al).alloc.exposure <= 300 + 1e-9);   // leverage capped at 3x
  near(QN.backtest(spec({ method: 'nonsense' }), al).alloc.weights[0], .5, 1e-9);                // unknown method = written weights
  assert.equal(QN.backtest(spec({ method: 'hrp', lookback: 1 }), al).alloc.lookback, 60);        // too-short window is raised, not silently ignored
  const r = QN.riskStats(new Array(300).fill(0), new Array(300).fill(0), 0); assert.equal(r.omega, null);
  assert.equal(QN.psr(new Array(300).fill(0), 0), null);
});

test('range volatility ignores a close/open price-basis offset (adjusted closes vs raw open/high/low)', () => {
  const sg = .01, sub = 60, gg = gauss(rnd(22)), bars = { o: [], h: [], l: [], c: [] }; let px = 100;
  for (let d = 0; d < 400; d++) { const o = px; let hi = px, lo = px; for (let k = 0; k < sub; k++) { px *= Math.exp(sg / Math.sqrt(sub) * gg()); hi = Math.max(hi, px); lo = Math.min(lo, px); } bars.o.push(o); bars.h.push(hi); bars.l.push(lo); bars.c.push(px); }
  const clean = QN.rangeVol(bars, 300), off = QN.rangeVol({ ...bars, c: bars.c.map((x) => x * .97) }, 300), drift = QN.rangeVol({ ...bars, c: bars.c.map((x, i) => x * (1 - .0001 * i)) }, 300), step = QN.rangeVol({ ...bars, c: bars.c.map((x, i) => x * (i < 200 ? .90 : .97)) }, 300);
  for (const k of ['parkinson', 'garmanKlass', 'yangZhang']) { near(off[k] / clean[k], 1, .03); near(drift[k] / clean[k], 1, .12); near(step[k] / clean[k], 1, .1); }
});

test('the engine reads the way a model writes the spec: method aliases, "10%", "252 days"', () => {
  for (const [name, id] of [['Risk Parity', 'risk_parity'], ['ERC', 'risk_parity'], ['min-var', 'min_variance'], ['Hierarchical Risk Parity', 'hrp'], ['equal weight', 'equal'], ['Inverse Volatility', 'inverse_vol'], ['tangency', 'max_sharpe'], ['???', 'fixed'], [undefined, 'fixed']]) assert.equal(QN.method(name), id);
  const al = QN.align(data, 'SPY', ['SPY', 'TLT']), spec = { type: 'allocation', assets: [{ sym: 'SPY', weight: 1 }, { sym: 'TLT', weight: 1 }], rebalance: 'monthly', benchmark: 'SPY', cost_bps: 0, start: '2016-01-01' };
  const a = QN.backtest({ ...spec, method: 'Risk Parity', lookback: '252 days', vol_target: '1%' }, al), b = QN.backtest({ ...spec, method: 'risk_parity', lookback: 252, vol_target: 1 }, al);
  assert.equal(a.eq.at(-1), b.eq.at(-1));
  assert.ok(a.alloc.volTarget === 1 && a.alloc.exposure < 100);   // the string target really bit (not silently ignored)
  assert.equal(a.alloc.method, 'risk_parity');
});

test('rebase puts raw open/high/low on the adjusted-close basis, only when the offset is clear', () => {
  const g = gauss(rnd(41)), sub = 40; let px = 100;
  const rows = Array.from({ length: 600 }, (_, d) => { const o = px; let hi = px, lo = px; for (let k = 0; k < sub; k++) { px *= Math.exp(.01 / Math.sqrt(sub) * g()); hi = Math.max(hi, px); lo = Math.min(lo, px); } return { d: new Date(Date.UTC(2020, 0, 1) + d * 864e5).toISOString().slice(0, 10), o, h: hi, l: lo, c: px, v: 1 }; });
  const medCO = (r) => { const x = r.map((q) => Math.log(q.c / q.o)).sort((a, b) => a - b); return x[x.length >> 1]; };
  // dividend-style: the adjusted close sits 10% below the raw open, then 3% below after an ex-date
  const adj = rows.map((r, i) => ({ ...r, c: r.c * (i < 300 ? .9 : .97) })), fixed = QN.rebase(adj);
  assert.ok(Math.abs(medCO(adj.slice(0, 280))) > .08 && Math.abs(medCO(fixed.slice(0, 280))) < .003);          // first regime repaired
  assert.ok(Math.abs(medCO(fixed.slice(330))) < .003);                                                         // second regime repaired
  near(fixed[100].h / fixed[100].l, rows[100].h / rows[100].l, 1e-9);                                          // a day's range keeps its shape
  assert.equal(adj[100].o, rows[100].o);                                                                       // input not mutated
  // already consistent data: untouched (same array back)
  assert.equal(QN.rebase(rows), rows);
  // a stock that just trends intraday (+0.5%/day open to close, +0.45% overnight gap down is NOT a dividend pattern) is left alone
  const trend = rows.map((r) => ({ ...r, c: r.o * 1.006 })).map((r, i, a) => ({ ...r, o: i ? a[i - 1].c * 1.0005 : r.o }));
  assert.equal(QN.rebase(trend), trend);
  // and the repaired bars feed align() so ATR reads the same as on the clean data
  const clean = { A: rows }, dirty = { A: adj };
  const a1 = QN.align(clean, 'A', ['A']), a2 = QN.align(dirty, 'A', ['A']);
  near(a2.bars.A.o[400] / a2.bars.A.c[400], a1.bars.A.o[400] / a1.bars.A.c[400], .004);
});

test('weight cap: nobody above the cap, still sums to 1, and a cap below equal split is raised to it', () => {
  const w = QN.cap([.7, .2, .06, .04], .4); near(w.reduce((a, b) => a + b), 1, 1e-12); assert.ok(w.every((x) => x <= .4 + 1e-9)); assert.ok(w[0] >= w[1] - 1e-12 && w[1] > w[2] && w[2] > w[3]);
  QN.cap([.5, .3, .2], .1).forEach((x) => near(x, 1 / 3, 1e-9));     // infeasible cap -> equal weight
  assert.deepEqual(QN.cap([.25, .25, .5], 1), [.25, .25, .5]);        // no binding cap: unchanged
  const al = QN.align(data, 'SPY', ['SPY', 'TLT']), spec = { type: 'allocation', assets: [{ sym: 'SPY', weight: 1 }, { sym: 'TLT', weight: 1 }], rebalance: 'monthly', benchmark: 'SPY', cost_bps: 0, start: '2016-01-01', method: 'inverse_vol' };
  const free = QN.backtest(spec, al), capped = QN.backtest({ ...spec, max_weight: '55%' }, al);
  assert.ok(Math.max(...capped.alloc.weights) <= .55 + 1e-9 && Math.abs(capped.alloc.maxWeight - 55) < 1e-9 && Math.max(...free.alloc.weights) > .55);
});

// ---- batch 2: pairs, cointegration, momentum, regimes, stress, factors, style
const dayStr = (i, y0 = 2015) => new Date(Date.UTC(y0, 0, 1) + i * 864e5).toISOString().slice(0, 10);
const rowsOf = (closes, y0 = 2015) => closes.map((c, i) => ({ d: dayStr(i, y0), o: c, h: c * 1.005, l: c * .995, c, v: 1 }));
const cointPair = (n, phi, seed, beta = 1.2) => {   // ln B random walk, ln A = a + beta ln B + OU spread
  const g = gauss(rnd(seed)); let lb = Math.log(100), e = 0; const A = [], B = [];
  for (let i = 0; i < n; i++) { lb += .0003 + .01 * g(); e = phi * e + .01 * g(); B.push(Math.exp(lb)); A.push(Math.exp(.4 + beta * lb + e)); }
  return { A, B };
};

test('Engle-Granger: finds a planted cointegrated pair, rejects independent walks, recovers hedge ratio and half-life', () => {
  const { A, B } = cointPair(1500, .94, 51), c = QN.coint(A, B);
  assert.ok(/^Cointegrated/.test(c.verdict) && c.tau < -3.34); near(c.beta, 1.2, .05); near(c.halfLife, Math.log(.5) / Math.log(.94), 4);
  let rej = 0; for (let s = 0; s < 12; s++) { const g1 = gauss(rnd(100 + s)), g2 = gauss(rnd(200 + s)); let x = 0, y = 0; const a = [], b = []; for (let i = 0; i < 1500; i++) { x += .01 * g1(); y += .01 * g2(); a.push(Math.exp(x)); b.push(Math.exp(y)); } if (/^Cointegrated/.test(QN.coint(a, b).verdict)) rej++; }
  assert.ok(rej <= 2, `false positives ${rej}/12`);              // 5% test: a couple of misses is normal, not half of them
  const rw = QN.adf(Array.from({ length: 1500 }, (() => { const g = gauss(rnd(7)); let v = 0; return () => (v += g()); })())), st = QN.adf(series(1500, 0, 1, 8));
  assert.ok(st.tau < -10 && rw.tau > -3.5);                          // stationary vs unit root
});

test('pairs backtest: trades the spread, market-neutral, makes money on a mean-reverting pair', () => {
  const { A, B } = cointPair(2200, .93, 61), data2 = { KO: rowsOf(A), PEP: rowsOf(B), SPY: rowsOf(B.map((x, i) => x * (1 + .1 * Math.sin(i / 90)))) };
  const spec = { type: 'pairs', a: 'KO', b: 'PEP', lookback: 60, entry_z: 2, exit_z: .5, stop_z: 4, benchmark: 'SPY', cost_bps: 2, start: '2016-06-01' };
  const al = QN.align(data2, 'KO', QN.symbols(spec)), r = QN.backtest(spec, al);
  assert.deepEqual(QN.symbols(spec).slice(0, 2), ['KO', 'PEP']);
  assert.ok(r.trades.length > 10 && r.metrics.s.total > 0 && r.metrics.exposure > 5 && r.metrics.exposure < 95);
  assert.ok(Math.abs(r.metrics.beta) < .35);                         // long one leg, short the other: little market exposure
  assert.ok(r.pair.coint && r.pair.z.length === r.dates.length && r.pair.entryZ === 2);
  assert.ok(r.trades.filter((t) => !t.open).every((t) => ['reverted', 'stop', 'time'].includes(t.why)));
  assert.ok(QN.backtest(spec, al, { cost_bps: 40 }).eq.at(-1) < r.eq.at(-1));
  const wider = QN.backtest({ ...spec, entry_z: 3 }, al); assert.ok(wider.trades.length < r.trades.length);
});

test('momentum method: holds the top-N winners over the window, skipping the last month', () => {
  const g = gauss(rnd(71)), mkAsset = (mu) => { let p = 100; return rowsOf(Array.from({ length: 1800 }, () => (p *= 1 + mu + .01 * g()))); };
  const dm = { W1: mkAsset(.0012), W2: mkAsset(.0008), M1: mkAsset(.0002), L1: mkAsset(-.0004), L2: mkAsset(-.0008) };
  const spec = { type: 'allocation', assets: Object.keys(dm).map((s) => ({ sym: s, weight: 1 })), rebalance: 'monthly', method: 'momentum', top_n: 2, lookback: 252, skip: 21, benchmark: 'W1', cost_bps: 0, start: '2017-01-01' };
  const al = QN.align(dm, 'W1', Object.keys(dm)), r = QN.backtest(spec, al);
  assert.deepEqual(r.alloc.weights.map((w) => +w.toFixed(2)), [.5, .5, 0, 0, 0]);
  assert.ok(r.metrics.s.cagr > QN.backtest({ ...spec, method: 'equal' }, al).metrics.s.cagr);
  assert.equal(QN.method('Cross-Sectional Momentum'), 'momentum');
  const w = QN.weights('momentum', [[.01, .01, -.5], [-.01, -.01, .5]], 0, { topN: 1, skip: 0 }); near(w[0], .5, 1e-12);   // tiny sample falls back to equal weight, no crash
});

test('regimes: trend and volatility buckets partition the days and carry the right sign', () => {
  const g = gauss(rnd(81)); let p = 100;
  const spy = rowsOf(Array.from({ length: 2400 }, (_, i) => (p *= 1 + (i < 1500 ? .0008 : -.0007) + (i % 300 < 60 ? .02 : .006) * g())));
  const spec = { type: 'allocation', assets: [{ sym: 'SPY', weight: 1 }], rebalance: 'none', benchmark: 'SPY', cost_bps: 0, start: '2016-01-01' };
  const al = QN.align({ SPY: spy }, 'SPY', ['SPY']), bt = QN.backtest(spec, al), rg = QN.regimes(bt, al);
  near(rg.trend.reduce((a, x) => a + x.share, 0), 100, 1e-6); near(rg.vol.reduce((a, x) => a + x.share, 0), 100, 1e-6);
  assert.ok(rg.trend[0].s.ann > rg.trend[1].s.ann);                  // uptrend days beat downtrend days
  assert.ok(rg.vol[2].s.vol > rg.vol[0].s.vol * 1.5);                // stormy tercile is more volatile than calm
  assert.ok(rg.volCuts[0] < rg.volCuts[1]);
});

test('stress: replays a covered crash window exactly, marks uncovered ones, beta shocks scale with downside beta', () => {
  const g = gauss(rnd(91)); let p = 100; const days = 1500, start = '2019-06-03';
  const px = Array.from({ length: days }, (_, i) => { const d = dayStr(i + 154, 2019); p *= 1 + (d >= '2020-02-20' && d <= '2020-03-23' ? -.012 : .0006) + .004 * g(); return p; });
  const rows = px.map((c, i) => ({ d: dayStr(i + 154, 2019), o: c, h: c * 1.003, l: c * .997, c, v: 1 })).filter((r) => ![0, 6].includes(new Date(r.d).getUTCDay()));
  const spec = { type: 'allocation', assets: [{ sym: 'SPY', weight: 1 }], rebalance: 'none', benchmark: 'SPY', cost_bps: 0, start };
  const al = QN.align({ SPY: rows }, 'SPY', ['SPY']), bt = QN.backtest(spec, al), st = QN.stress(bt), cv = st.rows.find((x) => x.id === 'covid'), gfc = st.rows.find((x) => x.id === 'gfc');
  assert.ok(cv.s && cv.s.ret < -20 && cv.s.maxdd <= cv.s.ret + 1e-9); near(cv.s.ret, cv.b.ret, 1e-6);
  assert.ok(!gfc.s && /history starts/.test(gfc.why));
  near(st.downBeta, 1, .02); near(st.shocks[1].est, -20, .5); near(st.reverse, -20, .5);
});

test('factor model recovers planted betas and alpha; style analysis recovers a planted mix', () => {
  const g = gauss(rnd(95)), n = 1300, mk = (mu, sg) => Array.from({ length: n }, () => mu + sg * g());
  const raw = { SPY: mk(.0004, .01), IWM: mk(.0004, .012), IVE: mk(.0003, .01), IVW: mk(.0004, .011), MTUM: mk(.0004, .011), USMV: mk(.0003, .007), AGG: mk(.0001, .003), TLT: mk(.0001, .008), EFA: mk(.0003, .011), EEM: mk(.0003, .013), GLD: mk(.0002, .009), DBC: mk(.0001, .01), VNQ: mk(.0003, .012) };
  const hist = {}; Object.entries(raw).forEach(([k, r]) => { let p = 100; hist[k] = [{ d: dayStr(0), c: p }].concat(r.map((x, i) => ({ d: dayStr(i + 1), c: (p *= 1 + x) }))); });
  const dates = Array.from({ length: n }, (_, i) => dayStr(i + 1));
  const strat = raw.SPY.map((x, i) => .0002 + .8 * x + .4 * (raw.IWM[i] - raw.SPY[i]) - .3 * (raw.IVE[i] - raw.IVW[i]) + .002 * g());
  const fm = QN.factorModel(strat, dates, hist), by = Object.fromEntries(fm.factors.map((f) => [f.id, f]));
  near(by.MKT.beta, .8 + .4 * 0 + 0 - 0, .08 + .4); near(by.SIZE.beta, .4, .08); near(by.VALUE.beta, -.3, .08); assert.ok(Math.abs(by.MOM.beta) < .15 && Math.abs(by.LOWVOL.beta) < .15);
  near(by.MKT.beta, .8, .02 + 0); assert.ok(fm.r2 > .9); near(fm.alpha, .0002 * 252 * 100, 2.5); assert.ok(Math.abs(by.SIZE.t) > 5 && Math.abs(by.MOM.t) < 3.5);
  const mix = raw.SPY.map((x, i) => .6 * x + .3 * raw.TLT[i] + .1 * raw.GLD[i] + .0005 * g()), st = QN.style(mix, dates, hist), w = Object.fromEntries(st.weights.map((x) => [x.sym, x.w]));
  near(w.SPY, 60, 4); near(w.TLT, 30, 4); near(w.GLD, 10, 4); assert.ok(st.r2 > .99); near(st.weights.reduce((a, x) => a + x.w, 0), 100, 1e-6);
  const short = QN.factorModel(strat.slice(0, 200), dates.slice(0, 200), hist); assert.equal(short, null);   // under a year of shared data: refuses
});

test('batch-2 edge cases: degenerate prices, caps, momentum skip', () => {
  assert.equal(QN.coint(new Array(300).fill(100), series(300, 0, .01, 5).map((x, i) => 100 + i)), null);                // flat leg
  assert.equal(QN.coint(series(300, 0, .01, 6).map((x, i) => (i === 5 ? 0 : 100 + x)), series(300, 0, .01, 7).map((x) => 100 + x)), null);   // zero price
  assert.equal(QN.adf(series(15, 0, 1, 4)), null); assert.equal(QN.adf(new Array(200).fill(1)), null);
  const z = QN.pairZ(Array.from({ length: 200 }, (_, i) => 100 + i % 7), Array.from({ length: 200 }, (_, i) => 2 * (100 + i % 7)), 60);   // exact scaled copy: zero spread
  assert.ok(z.z.filter((v) => v != null).every((v) => v === 0));
  const c = QN.cap([.5, .5, 0, 0], .4); near(c.reduce((a, b) => a + b), 1, 1e-12); assert.ok(c.every((x) => x <= .4 + 1e-9) && c[0] === .4 && c[2] > 0);
  assert.deepEqual(QN.cap([.4, .4, .2], .4).map((x) => +x.toFixed(6)), [.4, .4, .2]);
  const X = [series(300, .002, .01, 1), series(300, .001, .01, 2), series(300, -.001, .01, 3), series(300, -.002, .01, 4)];
  const w = QN.weights('momentum', X, 0, { topN: 2, skip: 99999 }); near(w.reduce((a, b) => a + b), 1, 1e-12); assert.equal(w.filter((x) => x > 0).length, 2);   // oversized skip is cut back, not ignored
  const al = QN.align(data, 'SPY', ['SPY', 'TLT']), spec = { type: 'allocation', assets: [{ sym: 'SPY', weight: 1 }, { sym: 'TLT', weight: 1 }], rebalance: 'monthly', method: 'momentum', top_n: 1, max_weight: 40, benchmark: 'SPY', cost_bps: 0, start: '2016-01-01' };
  assert.ok(Math.max(...QN.backtest(spec, al).alloc.weights) > .99);                                                  // max_weight does not dilute a momentum pick
  const s2 = QN.style(series(400, 0, .01, 9), Array.from({ length: 400 }, (_, i) => dayStr(i)), Object.fromEntries(['SPY', 'IWM', 'EFA'].map((k, j) => [k, (() => { let p = 100; return [{ d: dayStr(-1), c: p }].concat(series(400, 0, .01, 20 + j).map((x, i) => ({ d: dayStr(i), c: (p *= 1 + x) }))); })()])));
  assert.ok(s2.r2 >= 0 && s2.r2 < .2);                                                                                // unrelated strategy: R-squared floors at 0
});
