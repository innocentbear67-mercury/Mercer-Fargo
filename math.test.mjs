// node --test math.test.mjs — checks the math engine against textbook values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
globalThis.QN = req('./qengine.js');
const ME = req('./mathengine.js');
const near = (a, b, tol = 1e-4) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const run = (fn, a, env) => ME.run(fn, a, env);
const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// 300 days of made-up history: a steady 0.1% a day for UP, a wiggle for SPY
const days = (n, f) => { const r = Array.from({ length: n }, (_, i) => ({ d: new Date(Date.UTC(2024, 0, 1) + i * 864e5).toISOString().slice(0, 10), c: f(i) })); return r; };
const env = {
  history: (s) => ({ UP: days(300, (i) => 100 * Math.pow(1.001, i)), SPY: days(300, (i) => 100 + 10 * Math.sin(i / 9) + i * 0.05), TLT: days(300, (i) => 100 + 5 * Math.cos(i / 13)) }[s]),
  fx: (f, t) => ({ rate: f === 'USD' && t === 'SGD' ? 1.3 : null, date: '2026-10-12', src: 'ECB' }),
  portfolio: () => ({ name: 'Main', base: 'USD', total: 1100, cost: 1000, day: 10, ret: 100, retPct: 10, fxMissing: [], rows: [{ s: 'UP', q: 10, price: 110, cur: 'USD', bv: 1100, bc: 1000, retPct: 10, dayPct: 0.9 }] }),
};

test('expressions: precedence, functions, percent, no eval', () => {
  assert.equal(ME.evaluate('2 + 3 * 4 ^ 2'), 50);
  assert.equal(ME.evaluate('2^3^2'), 512);
  near(ME.evaluate('(229.33/176.5-1)*100'), 29.9320113);
  near(ME.evaluate('sqrt(16) + ln(e) + max(1, 7, 3)'), 12);
  near(ME.evaluate('15% * 1,200'), 180);
  near(ME.evaluate('x * 2', { x: 21 }), 42);
  assert.throws(() => ME.evaluate('alert(1)'), /unknown function/);
  assert.throws(() => ME.evaluate('1/0'), /finite/);
});

test('options: Black-Scholes, implied vol round trip, payoff', async () => {
  const c = await run('bs', { spot: 100, strike: 100, years: 1, vol_pct: 20, rate_pct: 5 });
  near(c.price, 10.4506, 1e-3);
  near(c.delta, 0.6368, 1e-3);
  const p = await run('bs', { spot: 100, strike: 100, years: 1, vol_pct: 20, rate_pct: 5, type: 'put' });
  near(c.price - p.price, 100 - 100 * Math.exp(-0.05), 1e-3);   // put-call parity
  const iv = await run('implied_vol', { price: c.price, spot: 100, strike: 100, years: 1, rate_pct: 5 });
  near(iv.impliedVolPct, 20, 1e-3);
  const spread = await run('payoff', { legs: [{ type: 'call', side: 'long', strike: 100, premium: 5 }, { type: 'call', side: 'short', strike: 110, premium: 2 }] });
  assert.deepEqual(spread.breakevens, [103]);
  assert.equal(spread.maxGain, 700); assert.equal(spread.maxLoss, -300);
  const call = await run('payoff', { legs: [{ type: 'call', strike: 100, premium: 5 }] });
  assert.equal(call.maxGain, 'unlimited');
});

test('time value of money', async () => {
  near((await run('pmt', { principal: 300000, rate_pct: 6, years: 30 })).payment, 1798.65, 0.01);
  near((await run('irr', { cashflows: [-100, 60, 60] })).irrPct, 13.0662, 1e-3);
  near((await run('npv', { rate_pct: 10, cashflows: [-100, 110] })).npv, 0, 1e-9);
  near((await run('xirr', { flows: [{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }] })).xirrPct, 10, 1e-3);
  near((await run('fv', { pv: 1000, rate_pct: 10, years: 2 })).futureValue, 1210);
  near((await run('rate', { pv: 1000, fv: 1210, years: 2 })).ratePct, 10, 1e-6);
  const am = await run('amortize', { principal: 300000, rate_pct: 6, years: 30, extra: 200 });
  assert.ok(am.yearsToPayoff < 30 && am.totalInterest < 1798.65 * 360 - 300000);
});

test('valuation: reverse DCF recovers the DCF growth', async () => {
  const d = await run('dcf', { fcf: 100, growth_pct: 8, discount_pct: 9, years: 10, shares: 10, net_debt: 50 });
  const r = await run('reverse_dcf', { price: d.perShare, shares: 10, fcf: 100, discount_pct: 9, years: 10, net_debt: 50 });
  near(r.impliedGrowthPct, 8, 1e-3);
  near((await run('wacc', { equity_value: 800, debt_value: 200, cost_equity_pct: 10, cost_debt_pct: 5, tax_pct: 20 })).waccPct, 8.8);
  near((await run('ddm', { dividend: 2, growth_pct: 3, required_pct: 8 })).value, 41.2);
  assert.throws(() => ME.fns.dcf.run({ fcf: 1, discount_pct: 2, terminal_growth_pct: 3 }), /exceed/);
});

test('stats and risk, with live history fetched by reference', async () => {
  const lr = await run('linreg', { y: [1, 3, 5, 7] });
  near(lr.r2, 1); near(lr.slope, 2);
  const r = await run('risk', { series: { history: 'UP' }, benchmark: { history: 'SPY' } }, env);
  near(r.volatilityPct, 0, 1e-6);
  near(r.maxDrawdownPct, 0);
  near(r.totalReturnPct, (Math.pow(1.001, 299) - 1) * 100, 1e-3);
  assert.ok('beta' in r && r.benchmark.volatilityPct > 0);
  const pv = await run('portfolio_vol', { assets: [{ symbol: 'SPY', weight: 50 }, { symbol: 'TLT', weight: 50 }] }, env);
  assert.ok(pv.volatilityPct <= pv.weightedAverageVolPct + 1e-9);
  const v = await run('var', { series: { history: 'SPY' }, value: 10000 }, env);
  assert.ok(v.historicalCvarPct >= v.historicalVarPct);
});

test('money: fx, portfolio, rebalance, avg cost', async () => {
  near((await run('fx', { amount: 100, from: 'usd', to: 'SGD' }, env)).converted, 130);
  assert.equal((await run('portfolio', {}, env)).holdings[0].weightPct, 100);
  const rb = await run('rebalance', { holdings: [{ symbol: 'A', value: 70 }, { symbol: 'B', value: 30 }], targets: { A: 50, B: 50 } });
  assert.equal(rb.trades[0].sell, 20); assert.equal(rb.trades[1].buy, 20);
  const ac = await run('avg_cost', { lots: [{ shares: 10, price: 100 }, { shares: 10, price: 200 }, { shares: -5, price: 300 }], price: 250 });
  assert.equal(ac.averageCost, 150); assert.equal(ac.realizedGain, 750); assert.equal(ac.unrealizedGain, 1500);
});

test('batch chains results by reference and keeps going past an error', async () => {
  const out = await ME.batch([
    { id: 'w', fn: 'wacc', args: { equity_value: 800, debt_value: 200, cost_equity_pct: 10, cost_debt_pct: 5, tax_pct: 20 } },
    { id: 'bad', fn: 'pct_change', args: { from: 0, to: 1 } },
    { id: 'v', fn: 'dcf', args: { fcf: 100, growth_pct: 5, discount_pct: '$w.waccPct' } },
  ]);
  assert.match(out[1].error, /cannot be 0/);
  const direct = await run('dcf', { fcf: 100, growth_pct: 5, discount_pct: 8.8 });
  near(out[2].result.enterpriseValue, direct.enterpriseValue);
});

test('answer check: wrong arithmetic is fixed, invented figures are flagged', () => {
  assert.equal(ME.fix('So 10 × 3 = 33 shares.').text, 'So 10 × 3 = 30 shares.');
  assert.equal(ME.fix('Revenue of $2.0B / 4 = $0.6B a quarter.').text, 'Revenue of $2.0B / 4 = $0.5B a quarter.');
  assert.equal(ME.fix('$30 / $200 = 15%').fixes.length, 0);
  assert.equal(ME.fix('It went from $100 to $120 (+25%).').text, 'It went from $100 to $120 (+20.0%).'.replace('20.0', '20'));
  assert.equal(ME.fix('fell from $50 to $40, down 25%').text, 'fell from $50 to $40, down 20%');
  assert.equal(ME.fix('From 2023 to 2025 the 25x multiple held.').fixes.length, 0);
  const led = ME.ledger(['{"price":229.33,"marketCap":"2.30T","returnPct":12.47}', 'r 0.1834']);
  assert.deepEqual(ME.untraced('Price $229.33, cap $2.3T, up 12.5% this year, margin 18.3% [2].', led), []);
  assert.deepEqual(ME.untraced('Shares could reach $310 (35% upside) by 2027.', led), ['$310', '35%']);
});

test('quant projection is reachable through the engine', async () => {
  const m = await run('monte_carlo', { series: { history: 'SPY' }, years: 2, expected_return_pct: 8 }, env);
  assert.ok(m.endP5 <= m.endMedian && m.endMedian <= m.endP95);
});

/* ---- found by stress testing ---- */
test('answer fixer leaves correct sums and years alone, still fixes the last link', () => {
  const same = (s) => assert.equal(ME.fix(s).text, s, s);
  ['Total: 10 + 20 + 30 = 60.', 'Net: 100 - 20 - 10 = 70.', 'So 2 × 3 × 4 = 24.', 'So 3 + 2 * 5 = 13.', '(1 + 2 * 3 = 7)', '100 / 4 * 2 = 50',
    'From 2023 to 2025, the shares were up 25% overall.', 'moved from 5 to 10 shares (25% of the portfolio).', 'revenue from $10B to $20B over 5 years (14.9% CAGR)',
    'from 20% to 25% (up 25% relative)', 'from $100 to $200, up 15% a year'].forEach(same);
  assert.equal(ME.fix('Revenue $4.2B × 3 = $9.9B').text, 'Revenue $4.2B × 3 = $12.6B');
  assert.equal(ME.fix('10 × 3 = 33').text, '10 × 3 = 30');
  assert.ok(Date.now() - (() => { const t = Date.now(); ME.fix('1'.repeat(20000)); return t; })() < 200, 'a 20,000-digit run must not stall the scan');
});

test('untraced: a percentage has to match a percentage, precise figures are not waved through', () => {
  const led = ME.ledger(['{"price":35,"pe":24.3,"changePct":3.5,"grossMargin":0.452,"cap":"2.3T"}']);
  assert.deepEqual(ME.untraced('up 3.5% on the day, margin 45.2%, 24.3x earnings, cap $2.3T', led), []);
  assert.deepEqual(ME.untraced('upside of 35.0%', led), ['35.0%']);     // 35 is a price in the sources, not a percentage
  assert.deepEqual(ME.untraced('target $35.4', led), ['$35.4']);        // no 0.5% slack on money
});

test('numbers: units are applied or refused, bad input is a plain error, never NaN or a crash', async () => {
  near((await run('pct_change', { from: '$2.5B', to: '3,000 M' })).changePct, 20, 1e-9);
  await assert.rejects(run('pct_change', { from: 'abc', to: 1 }), /must be a number/);
  await assert.rejects(run('pct_change', { from: '12 apples', to: 1 }), /must be a number/);
  await assert.rejects(run('bs', { spot: 0, strike: 100, days: 30, vol_pct: 20 }), /no valid answer/);
  await assert.rejects(run('percentile', { values: [1, 2, 3], p: -1 }), /no valid answer/);
  await assert.rejects(run('xirr', { flows: 'x' }), /flows must be a list/);
  await assert.rejects(run('avg_cost', { lots: 5 }), /lots must be a list/);
  assert.equal((await run('stats', { values: Array.from({ length: 200000 }, (_, i) => i) })).max, 199999);   // Math.max.apply breaks past ~120k
});

test('options precision: Black-Scholes is exact to the 6 decimals it reports', async () => {
  near((await run('bs', { spot: 100, strike: 100, years: 1, vol_pct: 20, rate_pct: 5 })).price, 10.450584, 1.5e-6);
  near((await run('bs', { spot: 100, strike: 150, years: 0.25, vol_pct: 20, rate_pct: 4 })).probItmPct, 0.003105, 1e-6);   // deep out of the money, exact value from Python's erfc
});

test('solvers: IRR with several roots, long-horizon rate, huge multiples', async () => {
  const two = await run('irr', { cashflows: [-100, 230, -132] });
  near(two.irrPct, 10, 1e-4); near(two.otherRatesPct[0], 20, 1e-4); assert.match(two.note, /more than one/);
  await assert.rejects(run('irr', { cashflows: [-785, 32, -8] }), /no IRR exists/);
  near((await run('irr', { cashflows: [-1, 1e6] })).irrPct, 99999900, 1);
  const rt = await run('rate', { pv: 1000, fv: 5000, years: 40, per_year: 12 });   // used to overflow the bracket
  near((await run('fv', { pv: 1000, rate_pct: rt.ratePct, years: 40, per_year: 12 })).futureValue, 5000, 1e-3);
});

test('risk reads the sampling rate from the dates: weekly, monthly and 7-day markets are not treated as 252 a year', async () => {
  const every = (n, gap, f) => Array.from({ length: n }, (_, i) => ({ d: new Date(Date.UTC(2020, 0, 6) + i * gap * 864e5).toISOString().slice(0, 10), c: f(i) }));
  const e2 = { history: (s) => ({ W: every(262, 7, (i) => 100 * Math.pow(1.01, i) * (1 + (i % 2 ? 0.01 : -0.01))), M: every(120, 30.4375, (i) => 100 * Math.pow(1.01, i)), C: every(365, 1, (i) => 100 * Math.pow(1.002, i)) }[s]) };
  const w = await run('risk', { series: { history: 'W' } }, e2), m = await run('risk', { series: { history: 'M' } }, e2), c = await run('risk', { series: { history: 'C' } }, e2);
  assert.equal(w.periodsPerYear, 52); assert.equal(m.periodsPerYear, 12); assert.equal(c.periodsPerYear, 365);
  near(w.years, 261 * 7 / 365.25, 1e-6); near(m.years, 119 * 30.4375 / 365.25, 1e-3);
  near(m.cagrPct, (Math.pow(1.01, 12) - 1) * 100, 0.01);   // a 252/yr reading would have claimed ~5x that
  await assert.rejects(run('monte_carlo', { series: { history: 'W' } }, e2), /needs daily prices/);
  await assert.rejects(run('var', { series: { history: 'W' } }, e2), /daily prices/);
  assert.ok((await run('monte_carlo', { series: { history: 'C' }, years: 2, expected_return_pct: 8 }, e2)).endMedian > 0);
});

test('batch: each symbol is fetched once however many items use it, and all up front', async () => {
  let calls = 0; const seen = [];
  const e3 = { history: async (s, r) => { calls++; seen.push(s + r); await new Promise((ok) => setTimeout(ok, 20)); return env.history(s); } };
  const t0 = Date.now();
  const out = await ME.batch([{ id: 'a', fn: 'risk', args: { series: { history: 'UP' }, benchmark: { history: 'SPY' } } }, { id: 'b', fn: 'var', args: { series: { history: 'SPY' } } },
    { id: 'c', fn: 'monte_carlo', args: { series: { history: 'SPY' }, years: 1, expected_return_pct: 8 } }, { id: 'd', fn: 'portfolio_vol', args: { assets: [{ symbol: 'UP', weight: 1 }, { symbol: 'SPY', weight: 1 }] } }], e3);
  assert.equal(calls, 2, seen.join()); assert.ok(out.every((x) => x.result), JSON.stringify(out.map((x) => x.error)));
  assert.ok(Date.now() - t0 < 120, 'the two fetches overlap');
});

test('monte_carlo: a short sample needs a stated return, and the return assumed is the one projected', async () => {
  const r = rng(5); const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
  let p = 100; const px = Array.from({ length: 1260 }, () => (p *= 1 + 0.0004 + 0.004 * gauss()));   // 5 years, low volatility so the median tracks the mean
  const longEnv = { history: () => px.map((c, i) => ({ d: new Date(Date.UTC(2020, 0, 1) + i * 864e5 * 365.25 / 252).toISOString().slice(0, 10), c })) };
  const own = await run('monte_carlo', { series: { history: 'X' }, years: 5 }, longEnv);          // 5 years of data: its own drift is used
  assert.equal(own.returnFrom, 'the series itself'); near(own.basedOnYears, 5, 0.05);
  const z = await run('monte_carlo', { series: { history: 'X' }, years: 5, expected_return_pct: 0 }, longEnv);
  const t = await run('monte_carlo', { series: { history: 'X' }, years: 5, expected_return_pct: 10 }, longEnv);
  near(z.cagrMedianPct, 0, 1.5); near(t.cagrMedianPct, 10, 1.5); assert.equal(t.returnFrom, 'assumption');   // volatility drag is small here
  const short = { history: () => px.slice(0, 252).map((c, i) => ({ d: new Date(Date.UTC(2020, 0, 1) + i * 864e5 * 365.25 / 252).toISOString().slice(0, 10), c })) };
  await assert.rejects(run('monte_carlo', { series: { history: 'X' } }, short), /mostly noise.*expected_return_pct/);
  assert.ok((await run('monte_carlo', { series: { history: 'X' }, expected_return_pct: 7 }, short)).endMedian > 0);
});

test('Sortino: the Quant tab and the engine use the same downside deviation', async () => {
  const S = Array.from({ length: 800 }, (_, i) => 100 * Math.exp(0.0003 * i + 0.02 * Math.sin(i * 1.7) * Math.cos(i * 0.3)));
  const dates = S.map((_, i) => new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10)), B = S.map((x, i) => 100 + i * 0.01);
  const q = QN.metrics(dates, S, B, [], [], 0), e = await run('risk', { series: S, per_year: 252 });
  near(e.sortino, q.s.sortino, 1e-5); near(e.sharpe, q.s.sharpe, 1e-5);
});

test('batch-1 tools: risk metrics, robustness, allocation, volatility, fractional Kelly', async () => {
  const g = (() => { const r = rng(5); return () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); })();
  let a = 100, b = 100;
  const noisy = { A: days(800, () => (a *= 1 + 0.0004 + 0.01 * g())), B: days(800, () => (b *= 1 + 0.0002 + 0.03 * g())) };
  const rows = (s) => noisy[s].map((x, i) => ({ ...x, o: x.c * 0.999, h: x.c * 1.01, l: x.c * 0.99 }));
  const e2 = { history: (s) => rows(s) };
  const A = noisy.A.map((x) => x.c); A.dates = noisy.A.map((x) => x.d);
  const B = noisy.B.map((x) => x.c); B.dates = noisy.B.map((x) => x.d);

  const rm = await run('risk_metrics', { series: A, benchmark: B });
  assert.ok(rm.cvar95Pct > rm.var95Pct && rm.var95Pct > 0 && Number.isFinite(rm.informationRatio) && rm.trackingErrorPct > 0);

  const ro = await run('robustness', { series: A, trials: 20, trial_sharpe_stdev: 0.4 });
  assert.ok(ro.deflatedSharpe <= ro.probabilisticSharpe && ro.sharpeRange5to95[0] < ro.sharpeRange5to95[2] && ro.holdout.inSample.days > ro.holdout.outSample.days);

  const al = await run('allocate', { assets: ['A', 'B'], method: 'risk_parity' }, e2);
  near(al.assets.reduce((s, x) => s + x.weightPct, 0), 100, 1e-6);
  assert.ok(al.assets[0].weightPct > al.assets[1].weightPct);                                  // the calmer asset gets more capital
  al.assets.forEach((x) => near(x.shareOfRiskPct, 50, 8));                                     // equal risk
  assert.ok(al.portfolioVolPct < al.equalWeightVolPct);
  await assert.rejects(run('allocate', { assets: ['A', 'B'], method: 'nonsense' }, e2));

  const vf = await run('vol_forecast', { symbol: 'A' }, e2);
  assert.ok(vf.garch.volNowPct > 0 && vf.ewmaPct > 0 && vf.garmanKlassPct > 0 && vf.yangZhangPct > 0 && vf.parkinsonPct > 0);

  const k = await run('kelly', { win_rate_pct: 55, win_loss_ratio: 1.5, fraction: 0.25 });
  near(k.fractionalKellyPct, k.kellyPct * 0.25, 1e-9);
});

test('batch-2 tools: cointegration, stress, regimes, factors and style on planted structure', async () => {
  const g = (() => { const r = rng(21); return () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); })(), n = 1500, y0 = Date.UTC(2019, 0, 1);
  const dstr = (i) => new Date(y0 + i * 864e5).toISOString().slice(0, 10);
  const walk = (mu, sg) => Array.from({ length: n }, () => mu + sg * g());
  const mkRows = (r) => { let p = 100; return [{ d: dstr(0), c: p }].concat(r.map((x, i) => ({ d: dstr(i + 1), c: (p *= 1 + x) }))); };
  const raw = { SPY: walk(.0004, .01), IWM: walk(.0004, .012), IVE: walk(.0003, .01), IVW: walk(.0004, .011), MTUM: walk(.0004, .011), USMV: walk(.0003, .007), AGG: walk(.0001, .003), TLT: walk(.0001, .008), EFA: walk(.0003, .011), EEM: walk(.0003, .013), GLD: walk(.0002, .009), DBC: walk(.0001, .01), VNQ: walk(.0003, .012) };
  const extra = {};
  const env3 = { history: (s) => (extra[s] || mkRows(raw[s])) };
  const toSeries = (rows) => { const a = rows.map((x) => x.c); a.dates = rows.map((x) => x.d); return a; };

  // planted cointegrated pair
  let lb = Math.log(100), e = 0; const A = [], B = [];
  for (let i = 0; i <= n; i++) { lb += .0003 + .01 * g(); e = .94 * e + .01 * g(); B.push(Math.exp(lb)); A.push(Math.exp(.4 + 1.2 * lb + e)); }
  extra.PA = A.map((c, i) => ({ d: dstr(i), c })); extra.PB = B.map((c, i) => ({ d: dstr(i), c }));
  const co = await run('cointegration', { a: { history: 'PA', range: '5Y' }, b: { history: 'PB', range: '5Y' } }, env3);
  assert.ok(/^Cointegrated/.test(co.verdict)); near(co.hedgeRatio, 1.2, .06); assert.ok(co.halfLifeDays > 5 && co.halfLifeDays < 30);
  await assert.rejects(run('cointegration', { a: [1, 2, 3, 4], b: [1, 2, 3, 4] }, env3));      // no dates / too short

  // a strategy that is 0.8 market + 0.4 size, 0.3 short value
  const strat = raw.SPY.map((x, i) => .0002 + .8 * x + .4 * (raw.IWM[i] - raw.SPY[i]) - .3 * (raw.IVE[i] - raw.IVW[i]) + .002 * g());
  extra.STRAT = mkRows(strat).slice(250); const ss = { history: 'STRAT', range: '5Y' };
  const fx = await run('factor_exposure', { series: ss }, env3), by = Object.fromEntries(fx.factors.map((f) => [f.factor, f]));
  near(by['Market'].beta, .8, .03); near(by['Size (small minus large)'].beta, .4, .08); near(by['Value (value minus growth)'].beta, -.3, .08); assert.ok(fx.rSquared > .9);

  extra.MIX = mkRows(raw.SPY.map((x, i) => .6 * x + .3 * raw.TLT[i] + .1 * raw.GLD[i] + .0005 * g()));
  const sty = await run('style_analysis', { series: { history: 'MIX', range: '5Y' } }, env3), w = Object.fromEntries(sty.mix.map((x) => [x.symbol, x.weightPct]));
  near(w.SPY, 60, 5); near(w.TLT, 30, 5); near(w.GLD, 10, 5);

  // regimes and stress against the SPY proxy as benchmark (its history stands in for the real one)
  const rg = await run('regime_stats', { series: ss, benchmark: 'SPY', range: 'MAX' }, env3);
  near(rg.trend.reduce((s, x) => s + x.sharePct, 0), 100, 1e-6); assert.equal(rg.volatility.length, 3);
  const stt = await run('stress_test', { series: ss, benchmark: 'SPY', range: 'MAX' }, env3);
  assert.ok(stt.scenarios.find((x) => x.name.includes('COVID')).returnPct != null && stt.scenarios.find((x) => x.name.includes('Dot-com')).notCovered);
  assert.ok(stt.downsideBeta > .3 && stt.benchmarkShocks.length === 3);

  const al = await run('allocate', { assets: ['SPY', 'IWM', 'EFA', 'EEM'], method: 'momentum', top_n: 2, skip_days: 21 }, env3);
  near(al.assets.filter((x) => x.weightPct > 0).length, 2, 0); near(al.assets.reduce((s, x) => s + x.weightPct, 0), 100, 1e-6);
});

// Stock Research Pro valuation: the expected numbers come from running the skill's own valuation.py on the same inputs.
test('research valuation matches the skill\'s valuation.py: forward, reverse, grid, reductio', async () => {
  const f = await run('forward_dcf', { base_fcf: 10000, g1_pct: 12, wacc_pct: 9, net_cash: 5000, shares: 1000, years: 5, terminal_growth_pct: 3, path: 'fade', exit_multiple: 18, price: 150 });
  near(f.gordon.perShare, 214.8120808, 1e-4); near(f.exitMultiple.perShare, 222.5705601, 1e-4);
  near(f.gordon.terminalPctOfEv, 76.1751536, 1e-4); near(f.methodDivergencePct, 3.5476851, 1e-4);
  near(f.sensitivityGrid[0]['g 2%'], 217.7320689, 1e-4); near(f.sensitivityGrid[4]['g 4%'], 211.9685950, 1e-4);
  assert.ok(f.warnings.some((w) => /terminal value is 76/.test(w)));
  const r = await run('reverse_dcf_full', { fcf: 42.3e9, wacc_pct: 10.25, ev: 2.10e12, shares: 5.186e9, net_cash: 75.5e9, terminal_growth_pct: 3, years: 10 });
  near(r.raw.impliedYear1GrowthPct.fade, 35.4443709, 1e-4); near(r.raw.impliedYear1GrowthPct.constant, 20.0217670, 1e-4);
  near(r.raw.waccSensitivity.constant[0].impliedGrowthPct, 16.2631590, 1e-4); near(r.raw.waccSensitivity.constant[4].impliedGrowthPct, 23.3860002, 1e-4);
  near(r.raw.reductio[1].fairValuePerShareFade, 168.3421412, 1e-3); near(r.raw.reductio[4].fairValuePerShareFade, 289.8180064, 1e-3);
  // price + shares + net cash gives the same EV as passing it directly
  const r2 = await run('reverse_dcf_full', { fcf: 42.3e9, wacc_pct: 10.25, price: (2.10e12 + 75.5e9) / 5.186e9, shares: 5.186e9, net_cash: 75.5e9, terminal_growth_pct: 3 });
  near(r2.raw.impliedYear1GrowthPct.fade, r.raw.impliedYear1GrowthPct.fade, 1e-6);
});

test('research valuation refuses what the skill refuses', async () => {
  await assert.rejects(run('forward_dcf', { base_fcf: 100, g1_pct: 10, wacc_pct: 4, terminal_growth_pct: 3, net_cash: 0, shares: 10 }), /below 1\.5/);
  await assert.rejects(run('forward_dcf', { base_fcf: -5, g1_pct: 10, wacc_pct: 9, net_cash: 0, shares: 10 }), /positive/);
  await assert.rejects(run('reverse_dcf_full', { fcf: 0, wacc_pct: 9, ev: 1000 }), /positive free cash flow/);
  await assert.rejects(run('reverse_dcf_full', { fcf: 10, wacc_pct: 9, ev: 1e9 }), /no growth rate/);
  await assert.rejects(run('dcf_scenarios', { scenarios: [{ name: 'a', prob: 0.5, per_share: 100 }, { name: 'b', prob: 0.4, per_share: 200 }] }), /not 1/);
  const w = await run('dcf_scenarios', { scenarios: [{ name: 'bear', prob: 25, per_share: 120 }, { name: 'base', prob: 50, per_share: 180 }, { name: 'bull', prob: 25, per_share: 240 }], price: 150 });
  near(w.weightedPerShare, 180); near(w.marginOfSafetyPct, 16.6666667, 1e-4);
});

test('quality_gate evidences the kill-gate flags', async () => {
  const q = await run('quality_gate', { years: ['2022', '2023', '2024', '2025'], operating_income: [100, 90, 80, 70], revenue: [1000, 1000, 1000, 1000], net_income: [100, 90, 80, 70], fcf: [50, 50, 40, 40],
    equity: [900, 900, 900, 900], debt: [300, 300, 300, 300], cash: [200, 200, 200, 200], shares: [100, 110, 121, 133.1], wacc_pct: 9, ebitda: [150, 140, 130, 120] });
  near(q.roicPct[0], 100 * 0.79 / 1000 * 100, 1e-6);   // NOPAT 79 over invested capital 1000
  near(q.shareCountCagrPct, 10, 1e-4); near(q.revenueCagrPct, 0, 1e-9);
  assert.equal(q.roicBelowWaccYears, 4);
  assert.ok(q.flags.some((x) => /HARD FAIL on dilution/.test(x)) && q.flags.some((x) => /ROIC has been below WACC/.test(x)) && q.flags.some((x) => /FCF conversion/.test(x)));
  near(q.netDebtToEbitda, 100 / 120, 1e-6);
});
