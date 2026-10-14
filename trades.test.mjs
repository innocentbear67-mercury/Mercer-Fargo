// node --test trades.test.mjs — brokerage CSV import on synthetic files shaped like real exports (no personal data).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const TRD = createRequire(import.meta.url)('./trades.js');
const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) <= t, `${a} != ${b}`);

const FUTU = '﻿"Side","Symbol","Name","Order Price","Order Qty","Order Amount","Status","Filled@Avg Price","Order Time","Order Type","Time-in-Force","Allow Pre-Market","Session","Trigger price","Position Opening","Markets","Currency","Order Source","Fill Qty","Fill Price","Fill Amount","Fill Time","Markets","Currency","Counterparty","Remarks","Total"\n' +
  '"Sell","SPGI","S&P Global","406.94","1","406.94","Filled","1@406.94","Oct 14, 2026 10:25:07 ET","Limit","Day","","RTH","","","US","USD","","1","406.94","406.94","Oct 14, 2026 10:25:07 ET","US","USD","","","1.09"\n' +
  '"Buy","IBKR","Interactive Brokers","86.50","1","86.50","Cancelled","0@0.00","Oct 7, 2026 11:44:57 ET","Limit","Day","","RTH","","","US","USD","","","","","","","","","","",""\n' +
  '"Sell","D05","DBS","70.37","15","1,055.55","Filled","15@70.37","Jul 10, 2026 16:42:15 SGT","Odd Lot","Day","","RTH","","","SG","SGD","","5","70.37","351.85","Jul 10, 2026 16:49:03 SGT","SG","SGD","","","1"\n' +
  '"","","","","","","","","","","","","","","","","","","10","70.37","703.70","Jul 10, 2026 16:50:00 SGT","SG","SGD"\n' +
  '"Buy","D05","DBS","50.00","15","750","Filled","15@50","Mar 3, 2026 10:00:00 SGT","Limit","Day","","RTH","","","SG","SGD","","15","50.00","750","Mar 3, 2026 10:01:00 SGT","SG","SGD","","","1"\n' +
  '"Buy","SPGI","S&P Global","410","1","410","Filled","1@410","Aug 11, 2026 10:00:00 ET","Limit","Day","","RTH","","","US","USD","","1","410.00","410.00","Aug 11, 2026 10:00:05 ET","US","USD","","","1"\n' +
  '"Buy","NVDA","NVIDIA","100","2","200","Filled","2@100","Sep 2, 2026 09:40:00 ET","Limit","Day","","RTH","","","US","USD","","2","100.00","200.00","Sep 2, 2026 09:40:05 ET","US","USD","","","1"\n' +
  '"Buy","NVDA","NVIDIA","110","1","110","Failed","","Sep 3, 2026 09:40:00 ET","Limit","Day","","RTH","","","US","USD","","","","","","","","","","",""\n';

test('Futu / moomoo export: fills only, extra-fill rows followed, markets mapped to Yahoo suffixes', () => {
  const p = TRD.parse(FUTU);
  assert.ok(!p.error, p.error);
  assert.deepEqual([p.skipped.cancelled, p.skipped.failed], [1, 1]);
  assert.equal(p.fills.length, 6);                                   // SPGI sell, D05 sell x2 fills, D05 buy, SPGI buy, NVDA buy
  assert.ok(p.fills.some((f) => f.s === 'D05.SI' && f.q === 10 && f.side === 'S'));
  const b = TRD.build(p.fills);
  const d = b.holdings.find((h) => h.s === 'D05.SI'); assert.equal(d, undefined);   // 15 bought, 5 + 10 sold: closed out
  assert.equal(b.sold.filter((s) => s.s === 'D05.SI').reduce((a, s) => a + s.q, 0), 15);
  const nv = b.holdings.find((h) => h.s === 'NVDA'); near(nv.q, 2); near(nv.px, 100); assert.equal(nv.d, '2026-09-02');
  const sp = b.sold.find((s) => s.s === 'SPGI'); near(sp.px, 410); near(sp.sp, 406.94); assert.equal(sp.d, '2026-08-11');
  near(b.stats.realized.SGD, 15 * 20.37); assert.equal(b.stats.unmatched, 0);
});

test('first in, first out across partial sells; a sell with no earlier buy is kept as a closed trade of unknown cost', () => {
  const csv = 'Date,Action,Symbol,Quantity,Price\n2026-01-05,Buy,AAA,10,10\n2026-02-05,Buy,AAA,10,20\n2026-03-05,Sell,AAA,15,30\n2026-03-06,Sell,ZZZ,2,5\n';
  const b = TRD.build(TRD.parse(csv).fills);
  assert.deepEqual(b.sold.filter((s) => s.s === 'AAA').map((s) => [s.q, s.px]).sort(), [[10, 10], [5, 20]]);
  const h = b.holdings[0]; near(h.q, 5); near(h.px, 20); assert.equal(h.lots.length, 1);
  const z = b.sold.find((s) => s.s === 'ZZZ'); assert.equal(z.px, 0); assert.equal(z.d, undefined); assert.equal(b.stats.unmatched, 1);
});

test('other layouts: signed quantities with no side column, American and day-first dates, cash and option rows skipped', () => {
  const ib = 'Symbol,Date/Time,Quantity,T. Price,Comm/Fee\nAAPL,"2026-03-04, 10:15:00",10,150,1\nAAPL,"2026-03-09, 11:00:00",-4,160,1\n';
  const a = TRD.parse(ib); assert.ok(!a.error, a.error); assert.deepEqual(a.fills.map((f) => f.side), ['B', 'S']);
  const rh = 'Activity Date,Instrument,Trans Code,Description,Quantity,Price,Amount\n3/14/2026,TSLA,Buy,Tesla,2,$200.50,($401.00)\n3/20/2026,TSLA,CDIV,Dividend,2,,$1.00\n3/21/2026,TSLA250321C00200000,BTO,Call,1,3.2,($320)\n3/22/2026,TSLA,Sell,Tesla,1,"$1,210.00",\n';
  const r = TRD.parse(rh); assert.ok(!r.error, r.error); assert.equal(r.fills.length, 2); near(r.fills[1].px, 1210); assert.equal(r.fills[0].d, '2026-03-14'); assert.ok(r.skipped.nonTrade + r.skipped.option >= 1);
  const eu = 'Time,Ticker,Buy/Sell,Shares,Price\n25/03/2026,SAP,Buy,3,120\n04/04/2026,SAP,Sell,1,130\n';
  const e = TRD.parse(eu); assert.equal(e.fills[0].d, '2026-03-25'); assert.equal(e.fills[1].d, '2026-04-04');   // 25/03 settles day-first for the whole file
});

test('unrecognised headers return what is missing; an explicit column map still works', () => {
  const odd = 'Col A,Col B,Col C,Col D,Col E\nBUY,KO,2026-05-01,3,60\nSELL,KO,2026-05-09,3,62\n';
  const p = TRD.parse(odd); assert.ok(p.error && p.missing.includes('symbol'));
  const m = TRD.parse(odd, { side: 'Col A', symbol: 'Col B', date: 'Col C', qty: 'Col D', price: 'Col E' });
  assert.ok(!m.error); assert.equal(m.fills.length, 2); near(TRD.build(m.fills).stats.realized['?'], 6);
  assert.ok(TRD.parse('Side,Symbol\n').error);
});
