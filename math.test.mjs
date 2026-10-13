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
