/* MercerFargo Quant: the backtest engine, the forward projection and the charts for Marvell's Quant mode.
   A strategy is a JSON spec the model writes from the user's description (see QN.SCHEMA in index.html):
     signal:     one symbol, entry conditions (all true) and exit conditions (any true), optional stop / take / trailing stop
     allocation: fixed weights across symbols, rebalanced on a calendar, optionally switched to cash or an alternative when a filter fails
   A condition is { a:expr, op:'<'|'>'|'<='|'>='|'cross_above'|'cross_below', b:expr }; an expr is a number, "$param" or
   { ind, len, sym, k, fast, slow, signal }. Any number can be "$param", so the sliders change the rules live.
   Method, in the spirit of an equity research report: daily adjusted closes; signals act at that day's close and earn from the next
   day (no look-ahead); costs per side on turnover; idle cash earns 0; metrics vs a buy-and-hold benchmark; the projection is a
   seeded block bootstrap of the strategy's own daily returns (21-day blocks keep streaks and fat tails), with drift and volatility dials. */
(function(root){
'use strict';
var QN = {};
var DAY = 252;

/* ------------------------------------------------------------------ indicators (all return arrays aligned to closes) */
function sma(x, n){ var o = [], s = 0; for(var i = 0; i < x.length; i++){ s += x[i]; if(i >= n) s -= x[i - n]; o.push(i >= n - 1 ? s / n : null); } return o; }
function ema(x, n){ var o = [], k = 2 / (n + 1), e = null; for(var i = 0; i < x.length; i++){ e = e == null ? x[i] : x[i] * k + e * (1 - k); o.push(i >= n - 1 ? e : null); } return o; }
function rsi(x, n){
  var o = [null], g = 0, l = 0;
  for(var i = 1; i < x.length; i++){
    var d = x[i] - x[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if(i <= n){ g += up / n; l += dn / n; o.push(i === n ? (l ? 100 - 100 / (1 + g / l) : 100) : null); }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o.push(l ? 100 - 100 / (1 + g / l) : 100); }
  }
  return o;
}
function stdev(x, n){ var o = []; for(var i = 0; i < x.length; i++){ if(i < n - 1){ o.push(null); continue; } var m = 0, j; for(j = i - n + 1; j <= i; j++) m += x[j]; m /= n; var v = 0; for(j = i - n + 1; j <= i; j++) v += (x[j] - m) * (x[j] - m); o.push(Math.sqrt(v / n)); } return o; }
function rollMax(x, n, prev){ var o = []; for(var i = 0; i < x.length; i++){ var a = prev ? i - n : i - n + 1, b = prev ? i - 1 : i; if(a < 0){ o.push(null); continue; } var m = -Infinity; for(var j = a; j <= b; j++) if(x[j] > m) m = x[j]; o.push(m); } return o; }
function rollMin(x, n, prev){ var o = []; for(var i = 0; i < x.length; i++){ var a = prev ? i - n : i - n + 1, b = prev ? i - 1 : i; if(a < 0){ o.push(null); continue; } var m = Infinity; for(var j = a; j <= b; j++) if(x[j] < m) m = x[j]; o.push(m); } return o; }
function rets(x){ var o = [0]; for(var i = 1; i < x.length; i++) o.push(x[i - 1] ? x[i] / x[i - 1] - 1 : 0); return o; }
QN.ind = { sma:sma, ema:ema, rsi:rsi, stdev:stdev };

/* One series for an expression. ctx: { bars:{sym:{c,h,l,o,v}}, main, P (params) } */
var IND_NAMES = ['close', 'open', 'high', 'low', 'volume', 'sma', 'ema', 'rsi', 'macd', 'macd_signal', 'macd_hist', 'bb_upper', 'bb_mid', 'bb_lower',
  'roc', 'ret', 'highest', 'lowest', 'atr', 'vol', 'drawdown', 'zscore', 'adx', 'cci', 'donchian_high', 'donchian_low'];
QN.IND_NAMES = IND_NAMES;
function val(v, P){ if(typeof v === 'string' && v.charAt(0) === '$'){ var p = P[v.slice(1)]; if(p == null) throw new Error('unknown parameter ' + v); return +p; } return v == null ? v : +v; }
function series(e, ctx){
  var n = ctx.bars[ctx.main].c.length;
  if(typeof e === 'number' || typeof e === 'string'){ var k = val(e, ctx.P); if(!isFinite(k)) throw new Error('bad number ' + e); var o = []; for(var i = 0; i < n; i++) o.push(k); return o; }
  if(!e || typeof e !== 'object') throw new Error('bad expression');
  var sym = e.sym ? String(e.sym).toUpperCase() : ctx.main, B = ctx.bars[sym];
  if(!B) throw new Error('no data for ' + sym);
  var len = Math.max(1, Math.round(val(e.len, ctx.P) || 14)), c = B.c, id = String(e.ind || 'close').toLowerCase();
  var key = sym + '|' + id + '|' + len + '|' + [e.k, e.fast, e.slow, e.signal].map(function(x){ return val(x, ctx.P); }).join(',');
  if(ctx.cache[key]) return ctx.cache[key];
  var out;
  switch(id){
    case 'close': case 'price': out = c.slice(); break;
    case 'open': out = B.o.slice(); break;
    case 'high': out = B.h.slice(); break;
    case 'low': out = B.l.slice(); break;
    case 'volume': out = B.v.slice(); break;
    case 'sma': out = sma(c, len); break;
    case 'ema': out = ema(c, len); break;
    case 'rsi': out = rsi(c, len); break;
    case 'macd': case 'macd_signal': case 'macd_hist': {
      var f = ema(c, Math.round(val(e.fast, ctx.P) || 12)), s = ema(c, Math.round(val(e.slow, ctx.P) || 26));
      var m = f.map(function(v, i){ return v == null || s[i] == null ? null : v - s[i]; });
      var sg = ema(m.map(function(v){ return v == null ? 0 : v; }), Math.round(val(e.signal, ctx.P) || 9)).map(function(v, i){ return m[i] == null ? null : v; });
      out = id === 'macd' ? m : id === 'macd_signal' ? sg : m.map(function(v, i){ return v == null || sg[i] == null ? null : v - sg[i]; });
      break;
    }
    case 'bb_upper': case 'bb_mid': case 'bb_lower': {
      var mid = sma(c, len), sd = stdev(c, len), kk = val(e.k, ctx.P) || 2, sgn = id === 'bb_upper' ? 1 : id === 'bb_lower' ? -1 : 0;
      out = mid.map(function(v, i){ return v == null ? null : v + sgn * kk * sd[i]; });
      break;
    }
    case 'roc': case 'ret': out = c.map(function(v, i){ return i >= len && c[i - len] ? (v / c[i - len] - 1) * 100 : null; }); break;
    case 'highest': out = rollMax(c, len, true); break;   // of the previous len closes, so "close > highest(20)" is a breakout
    case 'lowest': out = rollMin(c, len, true); break;
    case 'atr': {
      var tr = c.map(function(v, i){ var h = B.h[i] != null ? B.h[i] : v, l = B.l[i] != null ? B.l[i] : v, pc = i ? c[i - 1] : v; return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)); });
      out = sma(tr, len); break;
    }
    case 'adx': {   // Wilder's average directional index: trend strength 0-100 whatever the direction
      var m0 = c.length, trs = [], pdm = [], mdm = [], k0;
      for(k0 = 0; k0 < m0; k0++){
        var h1 = B.h[k0] != null ? B.h[k0] : c[k0], l1 = B.l[k0] != null ? B.l[k0] : c[k0], pc1 = k0 ? c[k0 - 1] : c[k0], ph = k0 ? (B.h[k0 - 1] != null ? B.h[k0 - 1] : c[k0 - 1]) : h1, pl = k0 ? (B.l[k0 - 1] != null ? B.l[k0 - 1] : c[k0 - 1]) : l1;
        var up = h1 - ph, dn = pl - l1; trs.push(Math.max(h1 - l1, Math.abs(h1 - pc1), Math.abs(l1 - pc1))); pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0);
      }
      out = new Array(m0).fill(null);
      if(m0 > 2 * len){
        var sT = 0, sP = 0, sM = 0, dx = [], ax = null;
        for(k0 = 1; k0 <= len; k0++){ sT += trs[k0]; sP += pdm[k0]; sM += mdm[k0]; }
        var di = function(){ var pi = sT ? 100 * sP / sT : 0, mi = sT ? 100 * sM / sT : 0; return pi + mi ? 100 * Math.abs(pi - mi) / (pi + mi) : 0; };
        dx.push(di());
        for(k0 = len + 1; k0 < m0; k0++){
          sT = sT - sT / len + trs[k0]; sP = sP - sP / len + pdm[k0]; sM = sM - sM / len + mdm[k0]; var d0 = di(); dx.push(d0);
          if(dx.length === len) ax = dx.reduce(function(a, b){ return a + b; }, 0) / len; else if(dx.length > len) ax = (ax * (len - 1) + d0) / len;
          if(ax != null) out[k0] = ax;
        }
      }
      break;
    }
    case 'cci': {   // commodity channel index on the typical price
      var tp = c.map(function(v, i){ var h2 = B.h[i] != null ? B.h[i] : v, l2 = B.l[i] != null ? B.l[i] : v; return (h2 + l2 + v) / 3; }), mt = sma(tp, len);
      out = tp.map(function(v, i){ if(mt[i] == null) return null; var md = 0, j; for(j = i - len + 1; j <= i; j++) md += Math.abs(tp[j] - mt[i]); md /= len; return md ? (v - mt[i]) / (.015 * md) : 0; });
      break;
    }
    case 'donchian_high': out = rollMax(B.h.map(function(v, i){ return v != null ? v : c[i]; }), len, true); break;   // of the previous len highs: "close > donchian_high(20)" is the classic breakout
    case 'donchian_low': out = rollMin(B.l.map(function(v, i){ return v != null ? v : c[i]; }), len, true); break;
    case 'vol': { var r = rets(c), sd2 = stdev(r, len); out = sd2.map(function(v){ return v == null ? null : v * Math.sqrt(DAY) * 100; }); break; }
    case 'drawdown': { var pk = rollMax(c, len, false); out = c.map(function(v, i){ return pk[i] ? (v / pk[i] - 1) * 100 : null; }); break; }
    case 'zscore': { var mu = sma(c, len), sd3 = stdev(c, len); out = c.map(function(v, i){ return mu[i] == null || !sd3[i] ? null : (v - mu[i]) / sd3[i]; }); break; }
    default: throw new Error('unknown indicator "' + id + '" (use one of: ' + IND_NAMES.join(', ') + ')');
  }
  return (ctx.cache[key] = out);
}
function condFn(cd, ctx){
  if(!cd || typeof cd !== 'object') throw new Error('bad condition');
  var a = series(cd.a, ctx), b = series(cd.b, ctx), op = String(cd.op || '>');
  return function(i){
    var x = a[i], y = b[i]; if(x == null || y == null) return false;
    if(op === '>') return x > y; if(op === '<') return x < y; if(op === '>=') return x >= y; if(op === '<=') return x <= y;
    var px = a[i - 1], py = b[i - 1]; if(px == null || py == null) return false;
    if(op === 'cross_above') return px <= py && x > y;
    if(op === 'cross_below') return px >= py && x < y;
    throw new Error('unknown operator ' + op);
  };
}

/* ------------------------------------------------------------------ data alignment */
/* data: { SYM:[{d,o,h,l,c,v}] } -> one date axis (the main symbol's, from the first day every needed symbol has a close), forward-filled. */
/* Yahoo bars carry dividend-adjusted closes but raw open/high/low (the server now fixes that; older cached or deployed copies may not). A dividend factor k shows up as ln(close/open) = ln k and
   ln(open/prev close) = -ln k together, in steps. Where that offset is clear (over 0.4% and cancelling close to close), open/high/low are scaled by it so ATR, high/low and open rules
   read on the same basis as the close. A stock that merely trends intraday has no such cancelling pattern and is left alone. Returns new rows; the input is not changed. */
QN.rebase = function(rows){
  var n = rows.length, co = [], ov = [], i;
  for(i = 0; i < n; i++){ var r = rows[i], pc = i ? rows[i - 1].c : null; co.push(r.o > 0 && r.c > 0 ? Math.log(r.c / r.o) : NaN); ov.push(r.o > 0 && pc > 0 ? Math.log(r.o / pc) : NaN); }
  var med = function(x, t){ var w = x.slice(Math.max(0, t - 10), t + 11).filter(isFinite).sort(function(u, q){ return u - q; }); return w.length ? w[Math.floor((w.length - 1) / 2)] / 2 + w[Math.ceil((w.length - 1) / 2)] / 2 : 0; };
  var out = null;
  for(i = 0; i < n; i++){
    var a = med(co, i), b = med(ov, i);
    if(Math.abs(a) > .004 && Math.abs(a + b) < .5 * Math.abs(a)){
      var f = Math.exp(a), r2 = rows[i]; out = out || rows.map(function(x){ return Object.assign({}, x); });
      out[i].o = r2.o * f; out[i].h = r2.h * f; out[i].l = r2.l * f;
    }
  }
  return out || rows;
};
QN.align = function(data, main, syms){
  var idx = {}, out = { dates:[], bars:{} };
  syms.forEach(function(s){ var rows = QN.rebase(data[s] || []); if(rows.length < 30) throw new Error('not enough price history for ' + s); var m = {}; rows.forEach(function(r){ m[r.d] = r; }); idx[s] = { m:m, first:rows[0].d }; });
  var first = syms.reduce(function(a, s){ return idx[s].first > a ? idx[s].first : a; }, '');
  var days = data[main].filter(function(r){ return r.d >= first && r.c != null; });
  syms.forEach(function(s){ out.bars[s] = { c:[], o:[], h:[], l:[], v:[] }; });
  days.forEach(function(r){
    out.dates.push(r.d);
    syms.forEach(function(s){
      var b = idx[s].m[r.d], B = out.bars[s], k = B.c.length, last = k ? B.c[k - 1] : null;
      var c = b && b.c != null ? b.c : last;
      B.c.push(c); B.o.push(b && b.o != null ? b.o : c); B.h.push(b && b.h != null ? b.h : c); B.l.push(b && b.l != null ? b.l : c); B.v.push(b && b.v != null ? b.v : 0);
    });
  });
  return out;
};
/* Every symbol a spec needs (main first). */
QN.symbols = function(spec){
  var set = [], add = function(s){ s = String(s || '').toUpperCase().trim(); if(s && set.indexOf(s) < 0) set.push(s); };
  if(spec.type === 'allocation') (spec.assets || []).forEach(function(a){ add(a.sym); }); else if(spec.type === 'pairs'){ add(spec.a); add(spec.b); } else add(spec.symbol);
  add(spec.alt); add(spec.benchmark || 'SPY');
  var walk = function(e){ if(e && typeof e === 'object'){ if(e.sym) add(e.sym); walk(e.a); walk(e.b); } };
  ['entry', 'exit', 'filter'].forEach(function(k){ (spec[k] || []).forEach(walk); });
  return set;
};

/* ------------------------------------------------------------------ the backtest */
QN.params = function(spec, over){ var P = {}; (spec.params || []).forEach(function(p){ P[p.id] = p.value; }); return Object.assign(P, over || {}); };
QN.backtest = function(spec, al, over){
  var P = QN.params(spec, over), main = spec.type === 'allocation' ? String(spec.assets[0].sym).toUpperCase() : spec.type === 'pairs' ? String(spec.a).toUpperCase() : String(spec.symbol).toUpperCase();
  var ctx = { bars:al.bars, main:main, P:P, cache:{} }, n = al.dates.length;
  var start = String((over && over.start != null ? over.start : spec.start) || ''), i0 = 1;
  while(i0 < n - 1 && al.dates[i0] < start) i0++;
  var cost = (val(over && over.cost_bps != null ? over.cost_bps : spec.cost_bps, P) || 0) / 1e4;
  var size = Math.max(0, Math.min(1, val(over && over.size != null ? over.size : (spec.size == null ? 1 : spec.size), P)));
  var bsym = String(spec.benchmark || 'SPY').toUpperCase(), alt = spec.alt ? String(spec.alt).toUpperCase() : null;
  var R = {}; Object.keys(al.bars).forEach(function(s){ R[s] = rets(al.bars[s].c); });
  var eq = [1], bq = [1], dr = [], w = {}, inPos = [], trades = [], open = null;
  var entry = (spec.entry || []).map(function(c){ return condFn(c, ctx); }), exit = (spec.exit || []).map(function(c){ return condFn(c, ctx); });
  var filter = (spec.filter || []).map(function(c){ return condFn(c, ctx); });
  var stop = val(spec.stop_pct, P), take = val(spec.take_pct, P), trail = val(spec.trail_pct, P), maxHold = val(spec.max_hold_days, P);
  var side = spec.side === 'short' ? -1 : 1, mc = al.bars[main].c, lastReb = '';
  /* weighting method (allocation) and volatility targeting (both types): weights come from the trailing `lookback` days and are refreshed on the rebalance dates only */
  var method = QN.method((over && over.method) || spec.method);   // unknown names fall back to the written weights
  var pnum = function(v){ var x = parseFloat(typeof v === 'string' && v.charAt(0) !== '$' ? v : val(v, P)); return isFinite(x) ? x : 0; };   // "10%" and "252 days" are read as numbers
  var rfp = val(spec.rf, P) || 0, curKey = '', memoK = null, memoW = null, aSyms = [];
  var lb = Math.max(60, Math.round(pnum(over && over.lookback != null ? over.lookback : (spec.lookback || 252)) || 252));
  var mw = pnum(over && over.max_weight != null ? over.max_weight : spec.max_weight) / 100, vt = Math.max(0, pnum(over && over.vol_target != null ? over.vol_target : spec.vol_target)), maxLev = Math.min(3, Math.max(.1, pnum(spec.max_leverage) || 1));   // ponytail: leverage is capped at 3x and borrowing is not charged
  if(spec.type === 'allocation') spec.assets.forEach(function(a){ var s = String(a.sym).toUpperCase(); if(aSyms.indexOf(s) < 0) aSyms.push(s); });
  var topN = pnum(over && over.top_n != null ? over.top_n : spec.top_n), mskip = over && over.skip != null ? pnum(over.skip) : (spec.skip != null ? pnum(spec.skip) : 21);
  /* pairs: long one leg and short the other when the spread between them is stretched, out when it has mostly closed. Hedge ratio and z-score come from the previous `lookback` days. */
  var pairs = spec.type === 'pairs', pa = pairs ? String(spec.a).toUpperCase() : '', pb = pairs ? String(spec.b).toUpperCase() : '';
  var pL = Math.max(20, Math.round(pnum(spec.lookback || 60) || 60)), entryZ = pnum(spec.entry_z) || 2, exitZ = spec.exit_z == null ? .5 : pnum(spec.exit_z), stopZ = pnum(spec.stop_z);
  if(!(exitZ >= 0) || exitZ >= entryZ) exitZ = Math.min(.5, entryZ / 4);
  var pz = pairs ? QN.pairZ(al.bars[pa].c, al.bars[pb].c, pL) : null;
  var winX = function(syms, i){ var a = Math.max(1, i - lb + 1); return syms.map(function(s){ return R[s].slice(a, i + 1); }); };
  var volScale = function(t, i){
    if(!vt) return 1; var syms = Object.keys(t), a = Math.max(1, i - lb + 1), pr = [];
    for(var k = a; k <= i; k++){ var x = 0; syms.forEach(function(s){ x += t[s] * R[s][k]; }); pr.push(x); }
    var v = pr.length >= 20 ? sd(pr) * Math.sqrt(DAY) : 0; return v ? Math.min(maxLev, vt / 100 / v) : 1;
  };
  var target = function(i){   // weights to hold from the close of day i
    if(spec.type === 'allocation'){
      var ok = filter.every(function(f){ return f(i); }), t = {};
      if(!ok){ if(alt) t[alt] = 1; return t; }
      if(memoK !== curKey || !memoW){
        var tot = spec.assets.reduce(function(s, a){ return s + (+val(a.weight, P) || 0); }, 0) || 1;
        spec.assets.forEach(function(a){ var s = String(a.sym).toUpperCase(); t[s] = (t[s] || 0) + (+val(a.weight, P) || 0) / tot; });
        if(method !== 'fixed' && aSyms.length > 1){ var X = winX(aSyms, i); if(X[0].length >= 60){ var wv = QN.weights(method, X, rfp, { topN:topN, skip:mskip }); if(mw > 0 && mw < 1 && method !== 'momentum') wv = QN.cap(wv, mw); /* a cap on a concentrated momentum book would buy the losers */ t = {}; aSyms.forEach(function(s, k){ t[s] = wv[k]; }); } }
        var sc = volScale(t, i); if(sc !== 1) Object.keys(t).forEach(function(s){ t[s] *= sc; });
        memoW = t; memoK = curKey;
      }
      return memoW;
    }
    if(pairs){
      var z = pz.z[i];
      if(open){
        var why2 = ''; if(z == null) why2 = 'data'; else if(open.dir < 0 ? z <= exitZ : z >= -exitZ) why2 = 'reverted';   // the spread has come back to within exit_z of its mean else if(stopZ && Math.abs(z) > stopZ) why2 = 'stop'; else if(maxHold && i - open.i >= maxHold) why2 = 'time';
        if(why2){ trades.push({ in:al.dates[open.i], out:al.dates[i], pxIn:open.z, pxOut:z, ret:(open.acc - 1) * 100, days:i - open.i, why:why2 }); open = null; }
      } else if(z != null && Math.abs(z) > entryZ && (!stopZ || Math.abs(z) < stopZ)) open = { i:i, z:z, dir:z > 0 ? -1 : 1, beta:pz.beta[i], acc:1 };
      var t3 = {}; if(open){ var wa = open.dir * size / (1 + Math.abs(open.beta)); t3[pa] = wa; t3[pb] = -wa * open.beta; }   // dollar-neutral when beta > 0
      return t3;
    }
    var px = mc[i];
    if(open){
      open.peak = side > 0 ? Math.max(open.peak, px) : Math.min(open.peak, px);
      var r = side * (px / open.px - 1), why = '';
      if(stop && r <= -stop / 100) why = 'stop';
      else if(take && r >= take / 100) why = 'target';
      else if(trail && side * (px / open.peak - 1) <= -trail / 100) why = 'trailing stop';
      else if(maxHold && i - open.i >= maxHold) why = 'time';
      else if(exit.length && exit.some(function(f){ return f(i); })) why = 'signal';
      if(why){ trades.push({ in:al.dates[open.i], out:al.dates[i], pxIn:open.px, pxOut:px, ret:r * 100, days:i - open.i, why:why }); open = null; }
    } else if(entry.length && entry.every(function(f){ return f(i); })) open = { i:i, px:px, peak:px, sc:(function(){ var t0 = {}; t0[main] = 1; return volScale(t0, i); })() };
    var t2 = {};
    if(open) t2[main] = side * size * (open.sc || 1); else if(alt) t2[alt] = size;
    return t2;
  };
  for(var i = i0; i < n; i++){
    var r = 0, bret = R[bsym] ? R[bsym][i] : 0;
    if(i > i0) Object.keys(w).forEach(function(s){ r += w[s] * R[s][i]; });
    if(pairs && open && i > i0) open.acc *= 1 + r;
    // drift the weights with the day's moves (allocation), then decide today's target
    var nw = w, base = w;
    if(spec.type === 'allocation'){
      var tot = 1 + r, dw = {}; Object.keys(w).forEach(function(s){ dw[s] = w[s] * (1 + (i > i0 ? R[s][i] : 0)) / (tot || 1); }); nw = base = dw;   // weights drift with prices between rebalances
      var reb = spec.rebalance || 'monthly', key = reb === 'none' ? (i === i0 ? 'x' : lastReb) : reb === 'yearly' ? al.dates[i].slice(0, 4) : reb === 'quarterly' ? al.dates[i].slice(0, 4) + Math.floor((+al.dates[i].slice(5, 7) - 1) / 3) : al.dates[i].slice(0, 7);
      curKey = key; var t = target(i), flip = Object.keys(t).join() !== Object.keys(w).join();
      if(key !== lastReb || flip || i === i0){ nw = t; lastReb = key; }
    } else nw = target(i);
    var turn = 0, keys = {}; Object.keys(w).concat(Object.keys(nw)).forEach(function(s){ keys[s] = 1; });
    Object.keys(keys).forEach(function(s){ turn += Math.abs((nw[s] || 0) - (base[s] || 0)); });
    var day = (1 + r) * (1 - turn * cost) - 1;
    if(i > i0){ eq.push(eq[eq.length - 1] * (1 + day)); bq.push(bq[bq.length - 1] * (1 + bret)); dr.push(day); }
    else if(turn) { eq[0] = 1 - turn * cost; }
    w = nw; inPos.push(Object.keys(w).some(function(s){ return w[s] && s !== alt; }) ? 1 : 0);
  }
  if(open && pairs) trades.push({ in:al.dates[open.i], out:al.dates[n - 1], pxIn:open.z, pxOut:pz.z[n - 1], ret:(open.acc - 1) * 100, days:n - 1 - open.i, why:'open', open:true });
  else if(open) trades.push({ in:al.dates[open.i], out:al.dates[n - 1], pxIn:open.px, pxOut:mc[n - 1], ret:side * (mc[n - 1] / open.px - 1) * 100, days:n - 1 - open.i, why:'open', open:true });
  var alloc = null;
  if(spec.type === 'allocation' && memoW){ var X2 = winX(aSyms, n - 1), ws = aSyms.map(function(s){ return memoW[s] || 0; }), sw = ws.reduce(function(a, b){ return a + b; }, 0) || 1;
    alloc = { method:method, lookback:lb, volTarget:vt, maxWeight:mw > 0 && mw < 1 ? mw * 100 : 0, syms:aSyms, weights:ws, exposure:sw * 100, share:aSyms.length > 1 && X2[0].length > 30 ? QN.riskShare(ws.map(function(x){ return x / sw; }), X2) : null }; }
  var pair = null;
  if(pairs){ var ca = al.bars[pa].c.slice(i0), cb = al.bars[pb].c.slice(i0); pair = { a:pa, b:pb, lookback:pL, entryZ:entryZ, exitZ:exitZ, stopZ:stopZ, z:pz.z.slice(i0), beta:pz.beta.slice(i0), coint:QN.coint(ca, cb) }; }
  var dates = al.dates.slice(i0);
  return { pair:pair, alloc:alloc, dates:dates, eq:eq, bench:bq, ret:dr, bret:bq.map(function(v, k){ return k ? v / bq[k - 1] - 1 : 0; }).slice(1), inPos:inPos, trades:trades, metrics:QN.metrics(dates, eq, bq, trades, inPos, val(spec.rf, P) || 0), P:P, main:main, bsym:bsym };
};

/* ------------------------------------------------------------------ metrics */
function mean(a){ var s = 0; for(var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
function sd(a){ var m = mean(a), s = 0; for(var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return a.length > 1 ? Math.sqrt(s / (a.length - 1)) : 0; }
function stats(dates, q, rf){
  var r = q.map(function(v, k){ return k ? v / q[k - 1] - 1 : 0; }).slice(1), yrs = Math.max(1 / DAY, r.length / DAY);
  var cagr = Math.pow(q[q.length - 1] / q[0], 1 / yrs) - 1, vol = sd(r) * Math.sqrt(DAY);
  var dvol = Math.sqrt(mean(r.map(function(x){ return x < 0 ? x * x : 0; }))) * Math.sqrt(DAY);   // downside deviation: every day counts, gains as zero
  var pk = q[0], mdd = 0, ddStart = 0, longest = 0, cur = 0, dd = [];
  q.forEach(function(v, k){ if(v >= pk){ pk = v; cur = 0; } else cur++; longest = Math.max(longest, cur); var d = v / pk - 1; dd.push(d); if(d < mdd){ mdd = d; ddStart = k; } });
  var years = {}; q.forEach(function(v, k){ if(!k) return; var y = dates[k].slice(0, 4); if(!years[y]) years[y] = { a:q[k - 1] }; years[y].b = v; });
  var yr = Object.keys(years).map(function(y){ return [y, (years[y].b / years[y].a - 1) * 100]; });
  return { total:(q[q.length - 1] / q[0] - 1) * 100, cagr:cagr * 100, vol:vol * 100, sharpe:vol ? (mean(r) * DAY - rf / 100) / vol : 0, sortino:dvol ? (mean(r) * DAY - rf / 100) / dvol : 0,
    maxdd:mdd * 100, longestDD:longest, calmar:mdd ? cagr / -mdd : 0, years:yr, dd:dd, r:r,
    best:yr.length ? Math.max.apply(null, yr.map(function(x){ return x[1]; })) : 0, worst:yr.length ? Math.min.apply(null, yr.map(function(x){ return x[1]; })) : 0 };
}
QN.metrics = function(dates, eq, bq, trades, inPos, rf){
  var s = stats(dates, eq, rf), b = stats(dates, bq, rf), rs = s.r, rb = b.r;
  var mb = mean(rb), ms = mean(rs), cov = 0, vb = 0; for(var i = 0; i < rs.length; i++){ cov += (rs[i] - ms) * (rb[i] - mb); vb += (rb[i] - mb) * (rb[i] - mb); }
  var beta = vb ? cov / vb : 0, corr = vb && sd(rs) ? cov / (rs.length - 1) / (sd(rs) * sd(rb)) : 0;
  var closed = trades.filter(function(t){ return !t.open; }), wins = closed.filter(function(t){ return t.ret > 0; });
  var by = {}; b.years.forEach(function(x){ by[x[0]] = x[1]; });
  var beat = s.years.filter(function(x){ return by[x[0]] != null && x[1] > by[x[0]]; }).length;
  var months = {}; eq.forEach(function(v, k){ if(!k) return; var m = dates[k].slice(0, 7); if(!months[m]) months[m] = { a:eq[k - 1] }; months[m].b = v; });
  return { s:s, b:b, beta:beta, alpha:(ms - beta * mb) * DAY * 100, corr:corr, trades:trades.length, closed:closed.length, winRate:closed.length ? wins.length / closed.length * 100 : null,
    avgTrade:closed.length ? mean(closed.map(function(t){ return t.ret; })) : null, avgDays:closed.length ? mean(closed.map(function(t){ return t.days; })) : null,
    exposure:inPos.length ? mean(inPos) * 100 : 0, risk:QN.riskStats(rs, rb, rf), profitFactor:QN.profitFactor(trades), beatYears:beat, nYears:s.years.length, from:dates[0], to:dates[dates.length - 1],
    monthly:Object.keys(months).map(function(m){ return [m, (months[m].b / months[m].a - 1) * 100]; }) };
};
/* The report's three judgements, rule-based so they are the same every time.
   Rating (1-5 stars): Sharpe edge over the benchmark. Edge (None / Narrow / Wide): share of calendar years it beat the benchmark.
   Uncertainty: width of the 1-year projection's 5th-95th percentile range. */
QN.rating = function(m){ var d = m.s.sharpe - m.b.sharpe; return d > .4 ? 5 : d > .15 ? 4 : d > -.15 ? 3 : d > -.4 ? 2 : 1; };
QN.edge = function(m){ var p = m.nYears ? m.beatYears / m.nYears : 0; return m.nYears < 3 ? 'Too short' : p >= .7 ? 'Wide' : p >= .55 ? 'Narrow' : 'None'; };
QN.uncertainty = function(spread){ return spread < 30 ? 'Low' : spread < 50 ? 'Medium' : spread < 80 ? 'High' : 'Very High'; };


/* ------------------------------------------------------------------ risk & quality statistics */
function ncdf(x){ var z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + .3275911 * z), e = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-z * z); return x >= 0 ? .5 * (1 + e) : .5 * (1 - e); }   // Abramowitz-Stegun 7.1.26, error under 1e-7
function ninv(p){   // inverse normal CDF (Acklam)
  var a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239], b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1],
    c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783], d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416], q, r;
  if(p <= 0) return -Infinity; if(p >= 1) return Infinity;
  if(p < .02425){ q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if(p > 1 - .02425){ q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - .5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
QN.ncdf = ncdf; QN.ninv = ninv;
function moments(r){ var m = mean(r), s2 = 0, s3 = 0, s4 = 0, n = r.length; for(var i = 0; i < n; i++){ var d = r[i] - m; s2 += d * d; s3 += d * d * d; s4 += d * d * d * d; } s2 /= n; var sg = Math.sqrt(s2); return { m:m, sd:sg, skew:sg ? s3 / n / (sg * sg * sg) : 0, kurt:s2 ? s4 / n / (s2 * s2) : 3 }; }
function qtile(a, q){ var x = a.slice().sort(function(u, w){ return u - w; }), i = (x.length - 1) * q, lo = Math.floor(i); return x[lo] + (x[Math.min(lo + 1, x.length - 1)] - x[lo]) * (i - lo); }
/* Tail and quality measures of daily returns r (fractions). b = benchmark daily returns of the same length (optional), rf = annual % */
QN.riskStats = function(r, b, rf){
  var n = r.length, o = {}; if(n < 20) return null;
  var q95 = qtile(r, .05), tail = r.filter(function(x){ return x <= q95; }), mo = moments(r), gain = 0, loss = 0;
  r.forEach(function(x){ if(x > 0) gain += x; else loss -= x; });
  o.var95 = -q95 * 100; o.cvar95 = -mean(tail) * 100; o.varNormal95 = -(mo.m + ninv(.05) * mo.sd) * 100;
  o.worstDay = Math.min.apply(null, r) * 100; o.skew = mo.skew; o.kurt = mo.kurt;
  o.omega = loss ? gain / loss : null; o.gainToPain = loss ? (gain - loss) / loss : null;   // Omega(0) = gains / losses; gain-to-pain = net return / total losses
  if(b && b.length === n){
    var act = r.map(function(x, i){ return x - b[i]; }), te = sd(act) * Math.sqrt(DAY), mb = mean(b), vb = 0, cv = 0, ms = mean(r);
    for(var i = 0; i < n; i++){ vb += (b[i] - mb) * (b[i] - mb); cv += (r[i] - ms) * (b[i] - mb); }
    var beta = vb ? cv / vb : 0;
    o.te = te * 100; o.ir = te ? mean(act) * DAY / te : null;
    o.treynor = Math.abs(beta) >= .1 ? (ms * DAY - (rf || 0) / 100) / beta * 100 : null;   // % of excess return per unit of beta; undefined when beta is about 0
    o.jensen = (ms - beta * mb) * DAY * 100;
  }
  return o;
};
QN.profitFactor = function(trades){
  var w = 0, l = 0; trades.forEach(function(t){ if(t.open) return; if(t.ret > 0) w += t.ret; else l -= t.ret; });
  return l ? w / l : (w ? null : null);
};

/* ------------------------------------------------------------------ is the result real? (overfitting checks) */
function sharpeOf(r, rf){ var v = sd(r) * Math.sqrt(DAY); return v ? (mean(r) * DAY - (rf || 0) / 100) / v : 0; }
/* Probabilistic Sharpe Ratio (Bailey & Lopez de Prado): the chance the true Sharpe beats `bench` (annual units), given skew and fat tails. */
QN.psr = function(r, bench, rf){
  var n = r.length, mo = moments(r); if(n < 30 || !mo.sd) return null;
  var sr = (mo.m - (rf || 0) / 100 / DAY) / mo.sd, b = (bench || 0) / Math.sqrt(DAY), den = Math.sqrt(Math.max(1e-12, 1 - mo.skew * sr + (mo.kurt - 1) / 4 * sr * sr));
  return ncdf((sr - b) * Math.sqrt(n - 1) / den);
};
/* Deflated Sharpe: PSR against the Sharpe you would expect from the best of `trials` tries of pure noise (trialSd = stdev of the tried Sharpes, annual units). */
QN.dsr = function(r, trials, trialSd, rf){
  if(!(trials > 1)) return QN.psr(r, 0, rf);
  var g = .5772156649, sr0 = trialSd * ((1 - g) * ninv(1 - 1 / trials) + g * ninv(1 - 1 / (trials * Math.E)));
  return QN.psr(r, Math.max(0, sr0), rf);
};
/* Block bootstrap of the daily returns: how wide the Sharpe and CAGR could be by luck of the draw. */
QN.bootstrap = function(r, o){
  o = o || {}; var n = r.length, B = o.block || 21, paths = o.paths || 500, rand = rng(o.seed || 11), sh = [], cg = [];
  if(n < 60) return null;
  for(var p = 0; p < paths; p++){
    var x = [], v = 1;
    while(x.length < n){ var st = Math.floor(rand() * (n - B)); for(var j = 0; j < B && x.length < n; j++) x.push(r[st + j]); }
    x.forEach(function(d){ v *= 1 + d; });
    sh.push(sharpeOf(x, o.rf)); cg.push((Math.pow(v, DAY / n) - 1) * 100);
  }
  return { sharpe:[qtile(sh, .05), qtile(sh, .5), qtile(sh, .95)], cagr:[qtile(cg, .05), qtile(cg, .5), qtile(cg, .95)], probSharpePositive:sh.filter(function(x){ return x > 0; }).length / paths * 100, paths:paths };
};
/* Hold-out view: the first `split` share of the days against the rest, with the same fixed rules. */
QN.holdout = function(r, split, rf){
  var k = Math.floor(r.length * (split || .7)), a = r.slice(0, k), b = r.slice(k); if(a.length < 60 || b.length < 60) return null;
  var f = function(x){ var q = 1, pk = 1, mdd = 0; x.forEach(function(d){ q *= 1 + d; if(q > pk) pk = q; mdd = Math.min(mdd, q / pk - 1); }); return { sharpe:sharpeOf(x, rf), cagr:(Math.pow(q, DAY / x.length) - 1) * 100, maxdd:mdd * 100, days:x.length }; };
  var i = f(a), o = f(b), ratio = i.sharpe > 0 ? o.sharpe / i.sharpe : null;
  return { inSample:i, outSample:o, ratio:ratio, verdict:o.sharpe <= 0 ? 'Fails out of sample' : ratio == null ? 'Holds up' : ratio >= .7 ? 'Holds up' : ratio >= .35 ? 'Fades' : 'Mostly in-sample' };
};
/* Re-run the strategy over a grid of its own dials (up to two) and record the Sharpe: a robust rule has a plateau, not a spike. */
QN.sensitivity = function(spec, al, over, ids, npts){
  var ps = (spec.params || []).filter(function(p){ return (!ids || ids.indexOf(p.id) >= 0) && +p.max > +p.min; }).slice(0, 2); if(!ps.length) return null;
  npts = npts || (ps.length === 1 ? 7 : 5);
  var axis = function(p){ var out = [], lo = +p.min, hi = +p.max, st = +p.step || 1; for(var i = 0; i < npts; i++){ var v = lo + (hi - lo) * i / (npts - 1); v = Math.round(v / st) * st; v = +v.toFixed(6); if(out.indexOf(v) < 0) out.push(v); } return out; };
  var xs = axis(ps[0]), ys = ps[1] ? axis(ps[1]) : [null], grid = [], all = [];
  ys.forEach(function(y){ var row = []; xs.forEach(function(x){ var ov = Object.assign({}, over || {}); ov[ps[0].id] = x; if(ps[1]) ov[ps[1].id] = y; var sh = null; try{ sh = QN.backtest(spec, al, ov).metrics.s.sharpe; }catch(e){} row.push(sh); if(sh != null) all.push(sh); }); grid.push(row); });
  if(all.length < 3) return null;
  var base = QN.backtest(spec, al, over).metrics.s.sharpe, m = mean(all);
  return { ids:ps.map(function(p){ return p.id; }), labels:ps.map(function(p){ return p.label || p.id; }), xs:xs, ys:ys, grid:grid, base:base, trials:all.length, trialSd:sd(all), positivePct:all.filter(function(v){ return v > 0; }).length / all.length * 100,
    min:Math.min.apply(null, all), max:Math.max.apply(null, all), verdict:all.filter(function(v){ return v > 0; }).length / all.length >= .8 && m > base * .5 ? 'Stable across the dials' : all.filter(function(v){ return v > 0; }).length / all.length >= .5 ? 'Sensitive to the dials' : 'Fragile: works only in a corner' };
};
/* Everything above on one result, ready to show. `sens` is optional (it costs a grid of backtests). */
QN.validate = function(bt, sens, rf){
  var r = bt.ret, out = { psr:QN.psr(r, 0, rf), boot:QN.bootstrap(r, { rf:rf }), hold:QN.holdout(r, .7, rf), sens:sens || null };
  if(sens) out.dsr = QN.dsr(r, sens.trials, sens.trialSd, rf);
  return out;
};

/* ------------------------------------------------------------------ allocation methods (long-only weights from a window of daily returns) */
function covOf(X){   // X: assets x days
  var p = X.length, n = X[0].length, mu = X.map(mean), S = [];
  for(var i = 0; i < p; i++){ S.push([]); for(var j = 0; j <= i; j++){ var c = 0; for(var k = 0; k < n; k++) c += (X[i][k] - mu[i]) * (X[j][k] - mu[j]); c /= (n - 1); S[i][j] = c; if(j < i) S[j][i] = c; } }
  return S;
}
/* Ledoit-Wolf (2004) shrinkage toward a scaled identity: keeps the matrix well-conditioned when assets are few days apart or highly correlated. */
QN.shrink = function(X){
  var p = X.length, n = X[0].length, S = covOf(X), mu = X.map(mean), m = 0, d2 = 0, b2 = 0, i, j, k;
  for(i = 0; i < p; i++) m += S[i][i]; m /= p;
  for(i = 0; i < p; i++) for(j = 0; j < p; j++) d2 += Math.pow(S[i][j] - (i === j ? m : 0), 2);
  for(k = 0; k < n; k++){ var f = 0; for(i = 0; i < p; i++) for(j = 0; j < p; j++) f += Math.pow((X[i][k] - mu[i]) * (X[j][k] - mu[j]) - S[i][j], 2); b2 += f; }
  b2 = Math.min(b2 / (n * n), d2); var a = d2 ? b2 / d2 : 0;
  return { S:S.map(function(row, i){ return row.map(function(v, j){ return (1 - a) * v + (i === j ? a * m : 0); }); }), mu:mu, intensity:a };
};
function solve(A, b){   // Gaussian elimination with partial pivoting
  var n = b.length, M = A.map(function(r, i){ return r.concat([b[i]]); }), i, j, k;
  for(i = 0; i < n; i++){ var pv = i; for(j = i + 1; j < n; j++) if(Math.abs(M[j][i]) > Math.abs(M[pv][i])) pv = j; var t = M[i]; M[i] = M[pv]; M[pv] = t; if(Math.abs(M[i][i]) < 1e-14) return null;
    for(j = i + 1; j < n; j++){ var f = M[j][i] / M[i][i]; for(k = i; k <= n; k++) M[j][k] -= f * M[i][k]; } }
  var x = new Array(n); for(i = n - 1; i >= 0; i--){ var s2 = M[i][n]; for(j = i + 1; j < n; j++) s2 -= M[i][j] * x[j]; x[i] = s2 / M[i][i]; } return x;
}
/* w proportional to S^-1 v with negative weights dropped and re-solved: v = 1 gives minimum variance, v = mu gives the maximum-Sharpe (tangency) portfolio. */
function longOnly(S, v){
  var p = S.length, act = []; for(var i = 0; i < p; i++) act.push(i);
  for(var it = 0; it < p; it++){
    var A = act.map(function(a){ return act.map(function(b){ return S[a][b]; }); }), x = solve(A, act.map(function(a){ return v[a]; }));
    if(!x) return null;
    var tot = x.reduce(function(s, y){ return s + y; }, 0); if(!tot) return null; x = x.map(function(y){ return y / tot; });
    var bad = x.some(function(y){ return y < -1e-12; });
    if(!bad){ var w = new Array(p).fill(0); act.forEach(function(a, k){ w[a] = Math.max(0, x[k]); }); return w; }
    act = act.filter(function(a, k){ return x[k] >= 0; }); if(!act.length) return null;
  }
  return null;
}
function ercW(S){
  var p = S.length, b = S.reduce(function(a, r, i){ return a + r[i]; }, 0) / p / p, w = S.map(function(r, i){ return Math.sqrt(b / r[i]); }), i, j, it, tot;   // b: the same risk target for every asset
  for(it = 0; it < 500; it++){
    var move = 0;
    for(i = 0; i < p; i++){ var c = 0; for(j = 0; j < p; j++) if(j !== i) c += w[j] * S[i][j]; var nw = (-c + Math.sqrt(c * c + 4 * S[i][i] * b)) / (2 * S[i][i]); move = Math.max(move, Math.abs(nw - w[i]) / nw); w[i] = nw; }   // solves w_i * (S w)_i = b; not normalised while iterating (the target b fixes the scale)
    if(move < 1e-12) break;
  }
  tot = w.reduce(function(a, x){ return a + x; }, 0); return w.map(function(x){ return x / tot; });
}
function hrpW(S){   // Hierarchical Risk Parity (Lopez de Prado 2016): cluster by correlation, then split risk down the tree
  var p = S.length; if(p === 1) return [1]; if(p === 2){ var a = 1 / S[0][0], b = 1 / S[1][1]; return [a / (a + b), b / (a + b)]; }
  var i, j, k, D = S.map(function(r, a){ return r.map(function(v, b){ return Math.sqrt(Math.max(0, (1 - v / Math.sqrt(S[a][a] * S[b][b])) / 2)); }); });
  var D2 = D.map(function(r, a){ return r.map(function(v, b){ var t = 0; for(k = 0; k < p; k++) t += Math.pow(D[a][k] - D[b][k], 2); return Math.sqrt(t); }); });
  var cl = []; for(i = 0; i < p; i++) cl.push([i]);
  var order = (function(){   // single-linkage merges; the dendrogram's leaf order puts similar assets side by side
    var cs = cl.map(function(c){ return { leaves:c }; });
    while(cs.length > 1){ var bi = 0, bj = 1, bd = Infinity;
      for(i = 0; i < cs.length; i++) for(j = i + 1; j < cs.length; j++){ var dm = Infinity; cs[i].leaves.forEach(function(x){ cs[j].leaves.forEach(function(y){ if(D2[x][y] < dm) dm = D2[x][y]; }); }); if(dm < bd){ bd = dm; bi = i; bj = j; } }
      var m = { leaves:cs[bi].leaves.concat(cs[bj].leaves) }; cs = cs.filter(function(x, q){ return q !== bi && q !== bj; }); cs.push(m); }
    return cs[0].leaves;
  })();
  var cv = function(items){ var iv = items.map(function(x){ return 1 / S[x][x]; }), t = iv.reduce(function(a, b){ return a + b; }, 0), v = 0; items.forEach(function(x, a){ items.forEach(function(y, b){ v += iv[a] / t * iv[b] / t * S[x][y]; }); }); return v; };
  var w = new Array(p).fill(1), groups = [order];
  while(groups.length){ var g = groups.pop(); if(g.length < 2) continue; var h = Math.floor(g.length / 2), l = g.slice(0, h), r = g.slice(h), vl = cv(l), vr = cv(r), al = 1 - vl / (vl + vr);
    l.forEach(function(x){ w[x] *= al; }); r.forEach(function(x){ w[x] *= 1 - al; }); groups.push(l, r); }
  return w;
}
/* The model may write "Risk Parity", "ERC" or "min-var": map the usual names onto the engine's. */
var ALIAS = { erc:'risk_parity', equal_risk:'risk_parity', equal_risk_contribution:'risk_parity', riskparity:'risk_parity', inverse_volatility:'inverse_vol', inverse_variance:'inverse_vol', invvol:'inverse_vol', ivp:'inverse_vol',
  minimum_variance:'min_variance', min_var:'min_variance', minvar:'min_variance', gmv:'min_variance', global_minimum_variance:'min_variance', maximum_sharpe:'max_sharpe', tangency:'max_sharpe', max_sharpe_ratio:'max_sharpe',
  hierarchical_risk_parity:'hrp', relative_strength:'momentum', cross_sectional_momentum:'momentum', xsmom:'momentum', top_n:'momentum', winners:'momentum', equal_weight:'equal', equal_weighted:'equal', equally_weighted:'equal', fixed_weights:'fixed', none:'fixed', static:'fixed' };
QN.method = function(m){ var k = String(m == null ? '' : m).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); return QN.METHODS[k] ? k : (ALIAS[k] || 'fixed'); };
QN.METHODS = { fixed:'Fixed weights', momentum:'Momentum (top N winners)', equal:'Equal weight', inverse_vol:'Inverse volatility', risk_parity:'Risk parity (equal risk)', min_variance:'Minimum variance', max_sharpe:'Maximum Sharpe', hrp:'Hierarchical risk parity' };
/* Weights for `method` from X (assets x days of daily returns). Falls back to equal weight if the maths cannot be solved. */
QN.weights = function(method, X, rf, opts){
  var p = X.length, eq = new Array(p).fill(1 / p);
  if(p < 2 || method === 'equal' || !QN.METHODS[method]) return eq;
  if(method === 'momentum'){   // rank by return over the window, skipping the most recent `skip` days (the 12-1 convention: last month tends to reverse), hold the top N equally
    var skip = Math.max(0, Math.min(Math.round(opts && opts.skip != null ? opts.skip : 21), X[0].length - 40)), nn = X[0].length - skip, tn = Math.max(1, Math.min(p, Math.round(opts && opts.topN ? opts.topN : Math.ceil(p / 3))));
    if(nn < 20) return eq;
    var sc = X.map(function(r){ var q = 1; for(var k = 0; k < nn; k++) q *= 1 + r[k]; return q; }), ord = sc.map(function(v, i){ return i; }).sort(function(a, b){ return sc[b] - sc[a] || a - b; }), w0 = new Array(p).fill(0);
    ord.slice(0, tn).forEach(function(i){ w0[i] = 1 / tn; }); return w0;
  }
  var sh = QN.shrink(X), S = sh.S, w = null;
  if(method === 'inverse_vol'){ var iv = S.map(function(r, i){ return 1 / Math.sqrt(r[i]); }), t = iv.reduce(function(a, b){ return a + b; }, 0); w = iv.map(function(x){ return x / t; }); }
  else if(method === 'risk_parity') w = ercW(S);
  else if(method === 'min_variance') w = longOnly(S, new Array(p).fill(1));
  else if(method === 'hrp') w = hrpW(S);
  else if(method === 'max_sharpe'){
    var g = mean(sh.mu), mu = sh.mu.map(function(m){ return .5 * m + .5 * g - (rf || 0) / 100 / DAY; });   // trailing means are noisy: pull each halfway to the group average
    w = longOnly(S, mu); if(!w || !mu.some(function(m){ return m > 0; })) w = longOnly(S, new Array(p).fill(1));
  }
  return w && w.every(isFinite) ? w : eq;
};
/* Cap every weight at `cap` (a fraction) and hand the excess to the others in proportion; the cap is never below an equal split, so it is always feasible. */
QN.cap = function(w, cap){
  var p = w.length; cap = Math.max(cap, 1 / p); w = w.slice();
  for(var it = 0; it <= p; it++){
    var over = 0, free = 0, open = 0; w.forEach(function(x){ if(x > cap + 1e-12) over += x - cap; else if(x < cap - 1e-12){ free += x; open++; } });   // assets already at the cap are full: they take none of the excess
    if(over < 1e-12 || !open) break;
    w = w.map(function(x){ return x > cap - 1e-12 ? cap : x + (free > 1e-12 ? x / free * over : over / open); });
  }
  return w;
};
/* Risk each asset contributes to a portfolio, as % of total, from the same window. */
QN.riskShare = function(w, X){
  var S = covOf(X), p = w.length, tot = 0, c = [];
  for(var i = 0; i < p; i++){ var m = 0; for(var j = 0; j < p; j++) m += S[i][j] * w[j]; c.push(w[i] * m); tot += w[i] * m; }
  return { share:c.map(function(v){ return tot ? v / tot * 100 : 0; }), vol:Math.sqrt(tot * DAY) * 100 };
};

/* ------------------------------------------------------------------ volatility estimators and forecasts */
function annual(v){ return Math.sqrt(Math.max(0, v) * DAY) * 100; }
/* Garch(1,1) by Gaussian likelihood with variance targeting (long-run variance = sample variance), a coarse grid then a finer one. */
QN.garch = function(r){
  var n = r.length; if(n < 500) return null;   // under about two years the fit hugs the edge of the search and means nothing
  var m = mean(r), e = r.map(function(x){ return x - m; }), V = e.reduce(function(s, x){ return s + x * x; }, 0) / n;
  if(!(V > 1e-12)) return null;   // flat series (a strategy that never trades): nothing to model
  var ll = function(al, be){ var h = V, s = 0; for(var t = 0; t < n; t++){ s += Math.log(h) + e[t] * e[t] / h; h = V * (1 - al - be) + al * e[t] * e[t] + be * h; } return -s / 2; };
  var best = null;
  var scan = function(a0, a1, b0, b1, k){ for(var i = 0; i <= k; i++) for(var j = 0; j <= k; j++){ var al = a0 + (a1 - a0) * i / k, be = b0 + (b1 - b0) * j / k; if(al <= 0 || be < 0 || al + be >= .9995) continue; var l = ll(al, be); if(!best || l > best.l) best = { al:al, be:be, l:l }; } };
  scan(.01, .25, .5, .98, 24); var a = best.al, b = best.be; scan(Math.max(.002, a - .02), a + .02, Math.max(0, b - .03), Math.min(.998, b + .03), 12);
  var al = best.al, be = best.be, h = V; for(var t = 0; t < n; t++) h = V * (1 - al - be) + al * e[t] * e[t] + be * h;   // h is now tomorrow's variance
  var per = al + be, avg = 0, hh = h; for(var d = 0; d < DAY; d++){ avg += hh; hh = V + per * (hh - V); }
  return { reliable:!(be < .52 || al > .245 || al < .012 || per > .998), alpha:al, beta:be, persistence:per, halfLife:per < 1 ? Math.log(.5) / Math.log(per) : null, longRunVol:annual(V), nowVol:annual(h), nextYearVol:annual(avg / DAY) };
};
/* bars: { o, h, l, c } arrays. Annualised % over the last `win` days.
   Yahoo bars carry dividend-adjusted closes but raw open/high/low, so ln(close/open) has a constant offset (a fraction of a % for SPY, several % for a high yielder over a long window).
   That offset (and its steps as dividends go ex) is taken out before the Garman-Klass and Yang-Zhang terms; Parkinson uses high/low only and needs no repair. */
QN.rangeVol = function(bars, win){
  var n = bars.c.length, a = Math.max(1, n - (win || 63)), ln = Math.log, ok = true, P = 0, G = 0, RS = 0, ov = [], co = [], k = 0, i;
  for(i = a; i < n; i++){
    var o = bars.o[i], h = bars.h[i], l = bars.l[i], c = bars.c[i], pc = bars.c[i - 1]; if(!(o > 0 && h > 0 && l > 0 && c > 0 && pc > 0)){ ok = false; break; }
    co.push(ln(c / o)); ov.push(ln(o / pc)); k++;
  }
  if(!ok || k < 10) return null;
  var detrend = function(x){   // rolling median over +-10 days: follows the step each time a dividend goes ex, while one odd day cannot move it
    return x.map(function(v, t){ var w = x.slice(Math.max(0, t - 10), t + 11).sort(function(u, q){ return u - q; }); return v - w[Math.floor((w.length - 1) / 2)] / 2 - w[Math.ceil((w.length - 1) / 2)] / 2; });
  };   // offset and its steps (adjusted close vs raw open), out
  var cd = detrend(co); ov = detrend(ov);
  for(i = 0; i < k; i++){
    var j = a + i, hi = bars.h[j], lo = bars.l[j], op = bars.o[j], d = cd[i], hl = ln(hi / lo), cp = op * Math.exp(d);   // cp: the close on the same price basis as the open
    P += hl * hl; G += .5 * hl * hl - (2 * Math.LN2 - 1) * d * d; RS += ln(hi / cp) * ln(hi / op) + ln(lo / cp) * ln(lo / op);
  }
  if(P === 0) return null;
  var kk = .34 / (1.34 + (k + 1) / (k - 1)), vo = Math.pow(sd(ov), 2), vc = Math.pow(sd(cd), 2);
  return { parkinson:annual(P / k / (4 * Math.LN2)), garmanKlass:annual(G / k), yangZhang:annual(vo + kk * vc + (1 - kk) * RS / k), days:k };
};
/* Every estimate for one return series (and the OHLC bars when there are any). */
QN.volReport = function(r, bars){
  var n = r.length, ew = 0, i; if(n < 30) return null;
  var m = mean(r); ew = r.slice(0, 30).reduce(function(s, x){ return s + (x - m) * (x - m); }, 0) / 30; for(i = 0; i < n; i++) ew = .94 * ew + .06 * (r[i] - m) * (r[i] - m);
  var last = r.slice(-21), g = QN.garch(r), full = sd(r) * Math.sqrt(DAY) * 100;
  return { realized21:sd(last) * Math.sqrt(DAY) * 100, realized63:sd(r.slice(-63)) * Math.sqrt(DAY) * 100, full:full, ewma:annual(ew), garch:g, range:bars ? QN.rangeVol(bars, 63) : null };
};


/* ------------------------------------------------------------------ batch 2: regression toolkit, pairs, regimes, stress tests, factors and style */
function inv(A){   // Gauss-Jordan inverse of a small symmetric matrix; null if singular
  var n = A.length, M = A.map(function(r, i){ return r.concat(r.map(function(_, j){ return i === j ? 1 : 0; })); }), i, j, k;
  for(i = 0; i < n; i++){ var pv = i; for(j = i + 1; j < n; j++) if(Math.abs(M[j][i]) > Math.abs(M[pv][i])) pv = j; if(Math.abs(M[pv][i]) < 1e-14) return null; var t = M[i]; M[i] = M[pv]; M[pv] = t;
    var d = M[i][i]; for(k = 0; k < 2 * n; k++) M[i][k] /= d;
    for(j = 0; j < n; j++) if(j !== i){ var f = M[j][i]; if(f) for(k = 0; k < 2 * n; k++) M[j][k] -= f * M[i][k]; } }
  return M.map(function(r){ return r.slice(n); });
}
/* Ordinary least squares of y on the columns `cols` (an intercept is added first unless o.noIntercept). t-statistics use Newey-West (HAC, o.lags) errors,
   which is what you want for strategy returns that are serially correlated; o.plain gives the textbook errors. */
QN.ols = function(y, cols, o){
  o = o || {}; var n = y.length, X = [], i, j, k;
  if(!o.noIntercept) X.push(new Array(n).fill(1)); cols.forEach(function(c){ X.push(c); });
  var p = X.length; if(n <= p + 2) return null;
  var G = [], b = []; for(i = 0; i < p; i++){ G.push([]); var bi = 0; for(j = 0; j <= i; j++){ var g = 0; for(k = 0; k < n; k++) g += X[i][k] * X[j][k]; G[i][j] = g; if(j < i) G[j][i] = g; } for(k = 0; k < n; k++) bi += X[i][k] * y[k]; b.push(bi); }
  var Gi = inv(G); if(!Gi) return null;
  var beta = Gi.map(function(row){ return row.reduce(function(a, v, j){ return a + v * b[j]; }, 0); });
  var res = new Array(n), rss = 0, my = mean(y), tss = 0;
  for(k = 0; k < n; k++){ var f = 0; for(i = 0; i < p; i++) f += beta[i] * X[i][k]; res[k] = y[k] - f; rss += res[k] * res[k]; tss += (y[k] - my) * (y[k] - my); }
  var cov;
  if(o.plain){ var s2 = rss / (n - p); cov = Gi.map(function(r){ return r.map(function(v){ return v * s2; }); }); }
  else {
    var L = o.lags != null ? o.lags : Math.max(1, Math.round(4 * Math.pow(n / 100, 2 / 9))), S = []; for(i = 0; i < p; i++){ S.push(new Array(p).fill(0)); }
    for(var lag = 0; lag <= L; lag++){
      var w = lag ? 1 - lag / (L + 1) : 1;
      for(i = 0; i < p; i++) for(j = 0; j < p; j++){ var acc = 0; for(k = lag; k < n; k++) acc += X[i][k] * res[k] * X[j][k - lag] * res[k - lag]; S[i][j] += w * acc; if(lag && i !== j) { var acc2 = 0; for(k = lag; k < n; k++) acc2 += X[j][k] * res[k] * X[i][k - lag] * res[k - lag]; S[i][j] += w * acc2; } else if(lag) S[i][j] += w * acc; }
    }
    var A = Gi.map(function(row){ return S[0].map(function(_, j){ return row.reduce(function(a, v, m){ return a + v * S[m][j]; }, 0); }); });
    cov = A.map(function(row){ return Gi[0].map(function(_, j){ return row.reduce(function(a, v, m){ return a + v * Gi[m][j]; }, 0); }); });
  }
  var se = cov.map(function(r, i){ return Math.sqrt(Math.max(0, r[i])); });
  return { coef:beta, se:se, t:beta.map(function(v, i){ return se[i] ? v / se[i] : 0; }), r2:tss ? 1 - rss / tss : 0, n:n, resid:res, intercept:!o.noIntercept, sigma:Math.sqrt(rss / (n - p)) };
};
/* Augmented Dickey-Fuller (constant, lag by AIC up to maxLag) on x: returns the tau statistic. */
QN.adf = function(x, maxLag){
  if(x.length < 30 || !x.every(isFinite) || sd(x) < 1e-12) return null;
  var n = x.length, K = Math.min(maxLag == null ? 8 : maxLag, Math.floor(n / 10)), best = null, d = [], k;
  for(k = 1; k < n; k++) d.push(x[k] - x[k - 1]);
  for(var lag = 0; lag <= K; lag++){
    var y = [], cols = [[]]; for(var j = 0; j < lag; j++) cols.push([]);
    for(k = K; k < d.length; k++){ y.push(d[k]); cols[0].push(x[k]); for(var m = 1; m <= lag; m++) cols[m].push(d[k - m]); }   // same sample for every lag so the AIC compares like with like
    var fit = QN.ols(y, cols, { plain:true }); if(!fit) continue;
    var rss = fit.resid.reduce(function(a, v){ return a + v * v; }, 0), aic = y.length * Math.log(rss / y.length) + 2 * (lag + 2);
    if(!best || aic < best.aic) best = { aic:aic, lag:lag, tau:fit.t[1], gamma:fit.coef[1], n:y.length };
  }
  return best;
};
/* Engle-Granger on two price series: regress ln A on ln B, test the residual for a unit root (MacKinnon critical values for two variables with a constant:
   -3.90 / -3.34 / -3.04 at 1 / 5 / 10%), and report the mean-reversion half-life of the spread. */
QN.coint = function(a, b){
  var la = a.map(Math.log), lb = b.map(Math.log);
  if(la.length < 120 || la.length !== lb.length || !la.every(isFinite) || !lb.every(isFinite) || sd(la) < 1e-9 || sd(lb) < 1e-9) return null;   // flat, non-positive or mismatched prices: nothing to test
  var fit = QN.ols(la, [lb], { plain:true }); if(!fit) return null;
  var e = fit.resid, adf = QN.adf(e), phi = null, ar = QN.ols(e.slice(1), [e.slice(0, -1)], { plain:true });
  if(ar) phi = ar.coef[1];
  var sdE = sd(e), hl = phi != null && phi > 0 && phi < 1 ? Math.log(.5) / Math.log(phi) : null;
  return { alpha:fit.coef[0], beta:fit.coef[1], r2:fit.r2, tau:adf ? adf.tau : null, lags:adf ? adf.lag : null, crit:{ p1:-3.90, p5:-3.34, p10:-3.04 }, halfLife:hl, spreadSd:sdE, zNow:sdE ? e[e.length - 1] / sdE : 0,
    verdict:!adf ? 'n/a' : adf.tau < -3.90 ? 'Cointegrated (1%)' : adf.tau < -3.34 ? 'Cointegrated (5%)' : adf.tau < -3.04 ? 'Weak evidence (10%)' : 'Not cointegrated' };
};
/* Rolling hedge ratio and z-score of the spread ln A - beta ln B - alpha, each day from the previous L days only. */
QN.pairZ = function(ca, cb, L){
  var la = ca.map(Math.log), lb = cb.map(Math.log), n = la.length, beta = new Array(n).fill(null), z = new Array(n).fill(null);
  for(var i = L - 1; i < n; i++){
    var ma = 0, mb = 0, j; for(j = i - L + 1; j <= i; j++){ ma += la[j]; mb += lb[j]; } ma /= L; mb /= L;
    var cv = 0, vb = 0; for(j = i - L + 1; j <= i; j++){ cv += (la[j] - ma) * (lb[j] - mb); vb += (lb[j] - mb) * (lb[j] - mb); }
    var bt = vb ? cv / vb : 0, al = ma - bt * mb, ss = 0; for(j = i - L + 1; j <= i; j++){ var r = la[j] - al - bt * lb[j]; ss += r * r; }
    var sg = Math.sqrt(ss / (L - 2)); beta[i] = bt; z[i] = sg > 1e-9 ? (la[i] - al - bt * lb[i]) / sg : 0;   // a spread that never moves has no z-score
  }
  return { beta:beta, z:z };
};

/* ---- market regimes: how the strategy behaved when the benchmark was in an uptrend or downtrend, and in calm or stormy markets */
function perf(r){ if(r.length < 5) return null; var m = mean(r), v = sd(r) * Math.sqrt(DAY), q = 1; r.forEach(function(x){ q *= 1 + x; }); return { days:r.length, ann:m * DAY * 100, vol:v * 100, sharpe:v ? m * DAY / v : 0, hit:r.filter(function(x){ return x > 0; }).length / r.length * 100, total:(q - 1) * 100 }; }
QN.regimes = function(bt, al){
  var bc = al.bars[bt.bsym] && al.bars[bt.bsym].c, i0 = al.dates.indexOf(bt.dates[0]); if(!bc || i0 < 1) return null;
  var ma = sma(bc, 200), br = rets(bc), rv = stdev(br, 21).map(function(v){ return v == null ? null : v * Math.sqrt(DAY) * 100; }), n = bt.ret.length;
  var vols = []; for(var k = 0; k < n; k++){ var x = rv[i0 + k]; if(x != null) vols.push(x); }
  if(vols.length < 60) return null;
  var t1 = qtile(vols, 1 / 3), t2 = qtile(vols, 2 / 3), groups = { trend:{ up:[[], []], down:[[], []] }, vol:{ calm:[[], []], normal:[[], []], stormy:[[], []] } };
  for(k = 0; k < n; k++){   // the regime is read at the previous close: no look-ahead
    var j = i0 + k, m = ma[j], v = rv[j]; if(m == null || v == null) continue;
    var tr = bc[j] > m ? 'up' : 'down', vr = v < t1 ? 'calm' : v < t2 ? 'normal' : 'stormy';
    groups.trend[tr][0].push(bt.ret[k]); groups.trend[tr][1].push(bt.bret[k]); groups.vol[vr][0].push(bt.ret[k]); groups.vol[vr][1].push(bt.bret[k]);
  }
  var tot = 0; Object.keys(groups.trend).forEach(function(g){ tot += groups.trend[g][0].length; });
  var out = function(def, names){ return names.map(function(g){ var d = def[g]; return { id:g, share:tot ? d[0].length / tot * 100 : 0, s:perf(d[0]), b:perf(d[1]) }; }); };
  return { bench:bt.bsym, trend:out(groups.trend, ['up', 'down']), vol:out(groups.vol, ['calm', 'normal', 'stormy']), volCuts:[t1, t2] };
};

/* ---- stress tests: replay famous drawdowns on the strategy's own history, plus a beta-based shock for what the history cannot cover */
QN.SCENARIOS = [
  { id:'dotcom', name:'Dot-com bust', from:'2000-03-24', to:'2002-10-09' }, { id:'gfc', name:'Global financial crisis', from:'2007-10-09', to:'2009-03-09' },
  { id:'euro', name:'2011 euro-debt scare', from:'2011-07-22', to:'2011-10-03' }, { id:'china', name:'2015-16 China slowdown', from:'2015-07-20', to:'2016-02-11' },
  { id:'q418', name:'Q4 2018 selloff', from:'2018-09-20', to:'2018-12-24' }, { id:'covid', name:'COVID crash', from:'2020-02-19', to:'2020-03-23' },
  { id:'rates', name:'2022 rate shock', from:'2022-01-03', to:'2022-10-12' }, { id:'tariff', name:'2025 tariff shock', from:'2025-02-19', to:'2025-04-08' }
];
function window_(dates, q, from, to){   // equity q over [from, to] on the strategy's dates: total return and the worst peak-to-trough inside
  var a = -1, b = -1, i; for(i = 0; i < dates.length; i++){ if(a < 0 && dates[i] >= from) a = i; if(dates[i] <= to) b = i; }
  if(a < 0 || b <= a) return null;
  var pk = q[a], mdd = 0; for(i = a; i <= b; i++){ if(q[i] > pk) pk = q[i]; mdd = Math.min(mdd, q[i] / pk - 1); }
  return { ret:(q[b] / q[a] - 1) * 100, maxdd:mdd * 100, days:b - a };
}
QN.stress = function(bt){
  var d = bt.dates, first = d[0], last = d[d.length - 1], day = function(s, k){ return new Date(Date.parse(s) + k * 864e5).toISOString().slice(0, 10); };
  var rows = QN.SCENARIOS.map(function(sc){
    var covered = first <= day(sc.from, 7) && last >= sc.to;   // a week of slack at the start
    var s = covered ? window_(d, bt.eq, sc.from, sc.to) : null, b = covered ? window_(d, bt.bench, sc.from, sc.to) : null;
    return { id:sc.id, name:sc.name, from:sc.from, to:sc.to, s:s, b:b, why:covered ? null : (first > day(sc.from, 7) ? 'history starts ' + first : 'ends before it') };
  });
  var down = [[], []]; for(var k = 0; k < bt.ret.length; k++) if(bt.bret[k] < 0){ down[0].push(bt.ret[k]); down[1].push(bt.bret[k]); }
  var vb = sd(down[1]) * sd(down[1]), mb = mean(down[1]), ms = mean(down[0]), cv = 0; for(k = 0; k < down[0].length; k++) cv += (down[0][k] - ms) * (down[1][k] - mb);
  var beta = down[0].length > 30 && vb ? cv / (down[0].length - 1) / vb : null;   // downside beta: only the benchmark's down days
  var shocks = beta == null ? [] : [-10, -20, -30].map(function(x){ return { bench:x, est:beta * x }; });
  return { rows:rows, downBeta:beta, shocks:shocks, bsym:bt.bsym, reverse:beta && beta > .05 ? -20 / beta : null };
};

/* ---- what drives it: factor exposure from ETF proxies, and returns-based style analysis */
QN.FACTORS = [
  { id:'MKT', name:'Market', legs:[['SPY', 1]] }, { id:'SIZE', name:'Size (small minus large)', legs:[['IWM', 1], ['SPY', -1]] }, { id:'VALUE', name:'Value (value minus growth)', legs:[['IVE', 1], ['IVW', -1]] },
  { id:'MOM', name:'Momentum (MTUM minus market)', legs:[['MTUM', 1], ['SPY', -1]] }, { id:'LOWVOL', name:'Low volatility (USMV minus market)', legs:[['USMV', 1], ['SPY', -1]] }
];
QN.STYLE_ASSETS = [['SPY', 'US large stocks'], ['IWM', 'US small stocks'], ['EFA', 'Developed ex-US'], ['EEM', 'Emerging markets'], ['AGG', 'US bonds'], ['TLT', 'Long treasuries'], ['GLD', 'Gold'], ['DBC', 'Commodities'], ['VNQ', 'Real estate']];
QN.FACTOR_SYMS = ['SPY', 'IWM', 'IVE', 'IVW', 'MTUM', 'USMV'];
function retMap(rows){ var m = {}; for(var i = 1; i < rows.length; i++) if(rows[i].c > 0 && rows[i - 1].c > 0) m[rows[i].d] = rows[i].c / rows[i - 1].c - 1; return m; }
/* ret: strategy daily returns, dates: the date of each return, hist: { SYM: [{d,c}] } */
QN.factorModel = function(ret, dates, hist){
  var maps = {}, dropped = [], used = [], j;
  QN.FACTOR_SYMS.forEach(function(sy){ if(hist[sy]) maps[sy] = retMap(hist[sy]); });
  var fr = {};   // factor id -> {date: return}
  QN.FACTORS.forEach(function(f){
    var m = {}, ok = f.legs.every(function(l){ return maps[l[0]]; }); if(!ok){ dropped.push(f.name + ': no data'); return; }
    Object.keys(maps[f.legs[0][0]]).forEach(function(d){ var v = 0, good = true; f.legs.forEach(function(l){ var x = maps[l[0]][d]; if(x == null) good = false; else v += l[1] * x; }); if(good) m[d] = v; });
    fr[f.id] = m;
  });
  var sdates = {}; dates.forEach(function(d, i){ sdates[d] = ret[i]; });
  var ids = QN.FACTORS.map(function(f){ return f.id; }).filter(function(id){ return fr[id]; });
  var overlap = function(list){ var c = 0; Object.keys(sdates).forEach(function(d){ if(list.every(function(id){ return fr[id][d] != null; })) c++; }); return c; };
  // keep the market, then add factors from the longest-history down while at least 500 shared days remain
  var order = ids.slice().sort(function(a, b){ return overlap([b]) - overlap([a]); }), keep = [];
  order.forEach(function(id){ var t = keep.concat([id]); if(overlap(t) >= 500) keep.push(id); else dropped.push(QN.FACTORS.filter(function(f){ return f.id === id; })[0].name + ': under 2 years shared with this strategy'); });
  if(!keep.length || keep.indexOf('MKT') < 0) return null;
  keep = QN.FACTORS.map(function(f){ return f.id; }).filter(function(id){ return keep.indexOf(id) >= 0; });
  var dd = Object.keys(sdates).filter(function(d){ return keep.every(function(id){ return fr[id][d] != null; }); }).sort();
  var y = dd.map(function(d){ return sdates[d]; }), cols = keep.map(function(id){ return dd.map(function(d){ return fr[id][d]; }); });
  var fit = QN.ols(y, cols); if(!fit) return null;
  var fm = cols.map(mean);
  return { n:dd.length, from:dd[0], to:dd[dd.length - 1], r2:fit.r2, alpha:fit.coef[0] * DAY * 100, alphaT:fit.t[0], resSd:fit.sigma * Math.sqrt(DAY) * 100, dropped:dropped,
    factors:keep.map(function(id, i){ var f = QN.FACTORS.filter(function(q){ return q.id === id; })[0]; return { id:id, name:f.name, beta:fit.coef[i + 1], t:fit.t[i + 1], contrib:fit.coef[i + 1] * fm[i] * DAY * 100 }; }) };
};
function projSimplex(v){   // Euclidean projection onto {w >= 0, sum w = 1}
  var u = v.slice().sort(function(a, b){ return b - a; }), css = 0, rho = 0, i; for(i = 0; i < u.length; i++){ css += u[i]; if(u[i] - (css - 1) / (i + 1) > 0) rho = i + 1; }
  var th = (u.slice(0, rho).reduce(function(a, b){ return a + b; }, 0) - 1) / rho; return v.map(function(x){ return Math.max(0, x - th); });
}
/* Sharpe (1992) returns-based style analysis: the mix of asset-class ETFs (weights >= 0, summing to 1) whose returns track the strategy's best. */
QN.style = function(ret, dates, hist){
  var names = [], maps = [], sdates = {}; dates.forEach(function(d, i){ sdates[d] = ret[i]; });
  QN.STYLE_ASSETS.forEach(function(a){ if(hist[a[0]]){ names.push(a); maps.push(retMap(hist[a[0]])); } });
  if(names.length < 3) return null;
  var dd = Object.keys(sdates).filter(function(d){ return maps.every(function(m){ return m[d] != null; }); }).sort();
  if(dd.length < 250) return null;
  var y = dd.map(function(d){ return sdates[d]; }), X = maps.map(function(m){ return dd.map(function(d){ return m[d]; }); }), p = X.length, n = y.length, i, j, k;
  var G = [], b = []; for(i = 0; i < p; i++){ G.push([]); var bi = 0; for(j = 0; j < p; j++){ var g = 0; for(k = 0; k < n; k++) g += X[i][k] * X[j][k]; G[i].push(g); } for(k = 0; k < n; k++) bi += X[i][k] * y[k]; b.push(bi); }
  var L = 2 * G.reduce(function(a, r, q){ return a + r[q]; }, 0), w = new Array(p).fill(1 / p);   // L: a safe step bound (trace)
  for(var it = 0; it < 6000; it++){ var gr = w.map(function(_, a){ var s2 = 0; for(var c = 0; c < p; c++) s2 += G[a][c] * w[c]; return 2 * (s2 - b[a]); }); var nw = projSimplex(w.map(function(x, a){ return x - gr[a] / L; })), mv = 0; for(i = 0; i < p; i++) mv = Math.max(mv, Math.abs(nw[i] - w[i])); w = nw; if(mv < 1e-10) break; }
  var res = y.map(function(v, t){ var f = 0; for(var a = 0; a < p; a++) f += w[a] * X[a][t]; return v - f; }), my = mean(y), ssr = res.reduce(function(a, v){ return a + v * v; }, 0), sst = y.reduce(function(a, v){ return a + (v - my) * (v - my); }, 0);
  return { n:n, from:dd[0], to:dd[n - 1], r2:sst ? Math.max(0, 1 - ssr / sst) : 0, trackingErr:sd(res) * Math.sqrt(DAY) * 100, alpha:mean(res) * DAY * 100, weights:names.map(function(a, q){ return { sym:a[0], name:a[1], w:w[q] * 100 }; }).sort(function(u, v){ return v.w - u.w; }) };
};

/* ------------------------------------------------------------------ the projection */
function rng(seed){ return function(){ seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
/* Monthly percentiles of the value of `capital` over `years`. Same seed every time, so moving a dial changes the fan, not the luck. */
QN.project = function(r, o){
  o = o || {};
  var years = Math.max(1, Math.min(30, o.years || 5)), paths = o.paths || 400, B = 21, N = years * DAY, cap = o.capital || 10000;
  if(!r || r.length < 20) throw new Error('not enough history to project');
  var m = mean(r), shift = (o.drift || 0) / 100 / DAY, k = o.volMult == null ? 1 : o.volMult, rand = rng(o.seed || 7);
  var src = r.length > B ? r : r.concat(r, r, r);
  var steps = years * 12, at = [], ends = [], one = [];
  for(var s = 0; s <= steps; s++) at.push([]);
  for(var p = 0; p < paths; p++){
    var v = cap, d = 0, step = 1, yr1 = null; at[0].push(v);
    while(d < N){
      var st = Math.floor(rand() * (src.length - B));
      for(var j = 0; j < B && d < N; j++, d++){
        v *= 1 + m + (src[st + j] - m) * k + shift;
        if(v < 0) v = 0;
        if(d + 1 === DAY) yr1 = v;
        if((d + 1) % 21 === 0 && step <= steps){ at[step].push(v); step++; }
      }
    }
    while(step <= steps){ at[step].push(v); step++; }
    ends.push(v); one.push(yr1 == null ? v : yr1);
  }
  var pct = function(a, q){ var x = a.slice().sort(function(u, w){ return u - w; }), i = (x.length - 1) * q, lo = Math.floor(i); return x[lo] + (x[Math.min(lo + 1, x.length - 1)] - x[lo]) * (i - lo); };
  var Q = [.05, .25, .5, .75, .95], bands = Q.map(function(q){ return at.map(function(a){ return pct(a, q); }); });
  var c = function(v){ return (Math.pow(v / cap, 1 / years) - 1) * 100; };
  return { years:years, capital:cap, months:steps, p5:bands[0], p25:bands[1], p50:bands[2], p75:bands[3], p95:bands[4],
    end:Q.map(function(q){ return pct(ends, q); }), cagr:Q.map(function(q){ return c(pct(ends, q)); }),
    lossProb:ends.filter(function(v){ return v < cap; }).length / paths * 100,
    spread1y:(pct(one, .95) - pct(one, .05)) / cap * 100 };
};

/* ------------------------------------------------------------------ charts (SVG strings with explicit colours, so the same chart goes into the PDF) */
QN.THEMES = {
  dark:{ fg:'#e8e6e3', mut:'#9aa0a6', grid:'rgba(255,255,255,.09)', s:'#ef4444', b:'#9aa0a6', up:'#1f9d55', dn:'#e0353b', band1:'rgba(239,68,68,.14)', band2:'rgba(239,68,68,.28)', bg:'transparent' },
  light:{ fg:'#1d1d1f', mut:'#6b7280', grid:'#e5e7eb', s:'#c81e2a', b:'#6b7280', up:'#15803d', dn:'#c81e2a', band1:'rgba(200,30,42,.12)', band2:'rgba(200,30,42,.26)', bg:'#ffffff' }
};
function nice(lo, hi, n){ var span = hi - lo || Math.abs(hi) || 1, raw = span / (n || 5), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p, st = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, out = []; for(var v = Math.ceil(lo / st) * st; v <= hi + st * 1e-9; v += st) out.push(+v.toFixed(10)); return out; }
function money(v){ var a = Math.abs(v); return (v < 0 ? '−$' : '$') + (a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e4 ? Math.round(a / 1e3) + 'k' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'k' : a.toFixed(0)); }
QN.money = money;
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
var FONT = 'font-family="Helvetica, Arial, sans-serif"';
/* Lines over a shared x axis. o: { W, H, x:[labels], series:[{name, v:[], col, dash, area}], log, fmt, yfmt, zero, hover } -> { svg, geo } */
QN.lines = function(o){
  var T = o.T || QN.THEMES.dark, W = o.W || 640, H = o.H || 240, L = 54, Rt = 12, Tp = 12, Bt = 24, pw = W - L - Rt, ph = H - Tp - Bt, n = o.x.length;
  var all = []; o.series.forEach(function(s){ s.v.forEach(function(v){ if(v != null && isFinite(v)) all.push(v); }); }); (o.extra || []).forEach(function(v){ all.push(v); }); (o.bands || []).forEach(function(bd){ bd.lo.concat(bd.hi).forEach(function(v){ if(v != null && isFinite(v)) all.push(v); }); });
  if(o.zero) all.push(0);
  var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), log = o.log && lo > 0;
  var tf = log ? Math.log : function(v){ return v; }, a = tf(lo), b = tf(hi); if(a === b){ a -= 1; b += 1; } var pad = (b - a) * .06; a -= o.zero && lo >= 0 ? 0 : pad; b += pad;
  var X = function(i){ return L + (n > 1 ? i / (n - 1) : .5) * pw; }, Y = function(v){ return Tp + ph - (tf(v) - a) / (b - a) * ph; };
  var g = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" ' + FONT + '>' + (T.bg !== 'transparent' ? '<rect width="' + W + '" height="' + H + '" fill="' + T.bg + '"/>' : '');
  var ticks = log ? (function(){ var t = []; for(var e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) [1, 2, 5].forEach(function(k){ var v = k * Math.pow(10, e); if(v >= lo * .9 && v <= hi * 1.1) t.push(v); }); return t.length > 8 ? t.filter(function(v){ return /^1/.test(String(v)); }) : t; })() : nice(lo, hi, 5);   // 1-2-5 steps read naturally on a log axis
  ticks.forEach(function(v){ var y = Y(v); if(y < Tp - 1 || y > Tp + ph + 1) return; g += '<line x1="' + L + '" x2="' + (L + pw) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + T.grid + '"/><text x="' + (L - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="' + T.mut + '">' + esc((o.yfmt || money)(v)) + '</text>'; });
  if(o.zero && lo < 0) g += '<line x1="' + L + '" x2="' + (L + pw) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="' + T.mut + '" stroke-width=".8"/>';
  var lastLab = -1e9, step = o.xfmt ? 1 : Math.max(1, Math.floor(n / 6));   // custom labels: try every point and keep the non-empty ones
  for(var i = 0; i < n; i += step){ var x = X(i), lab = o.xfmt ? o.xfmt(o.x[i], i) : ''; if(x - lastLab < 60 || (o.xfmt && !lab)) continue; lastLab = x; g += '<text x="' + x.toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle" font-size="10" fill="' + T.mut + '">' + esc(o.xfmt ? lab : String(o.x[i]).slice(0, 4)) + '</text>'; }
  (o.bands || []).forEach(function(bd){
    var top = [], bot = []; for(var i = 0; i < n; i++){ top.push(X(i).toFixed(1) + ',' + Y(bd.hi[i]).toFixed(1)); bot.unshift(X(i).toFixed(1) + ',' + Y(bd.lo[i]).toFixed(1)); }
    g += '<polygon points="' + top.concat(bot).join(' ') + '" fill="' + bd.col + '"/>';
  });
  var every = Math.max(1, Math.floor(n / Math.max(200, pw)));   // ponytail: about one point per pixel is enough for 5,000 days
  o.series.forEach(function(s){
    var d = '', pen = false;
    for(var i = 0; i < n; i++){ if(i % every && i !== n - 1) continue; var v = s.v[i]; if(v == null || !isFinite(v) || (log && v <= 0)){ pen = false; continue; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; }
    if(s.area){ g += '<path d="' + d + 'L' + X(n - 1).toFixed(1) + ' ' + Y(o.zero ? 0 : lo).toFixed(1) + 'L' + L + ' ' + Y(o.zero ? 0 : lo).toFixed(1) + 'Z" fill="' + s.area + '"/>'; }
    g += '<path d="' + d + '" fill="none" stroke="' + s.col + '" stroke-width="' + (s.w || 1.6) + '"' + (s.dash ? ' stroke-dasharray="4 3"' : '') + ' stroke-linejoin="round"/>';
  });
  g += '<line class="qx" x1="0" x2="0" y1="' + Tp + '" y2="' + (Tp + ph) + '" stroke="' + T.mut + '" stroke-dasharray="3 3" opacity="0"/></svg>';
  return { svg:g, geo:{ L:L, pw:pw, n:n, W:W } };
};
/* Grouped yearly bars: strategy vs benchmark. */
QN.bars = function(o){
  var T = o.T || QN.THEMES.dark, W = o.W || 640, H = o.H || 200, L = 40, Rt = 8, Tp = 10, Bt = 22, pw = W - L - Rt, ph = H - Tp - Bt, rows = o.rows;
  var all = [0]; rows.forEach(function(r){ all.push(r[1]); if(r[2] != null) all.push(r[2]); });
  var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pad = (hi - lo || 1) * .08; lo = Math.min(0, lo - pad); hi += pad;
  var Y = function(v){ return Tp + ph - (v - lo) / (hi - lo) * ph; }, bw = pw / Math.max(1, rows.length);
  var g = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" ' + FONT + '>' + (T.bg !== 'transparent' ? '<rect width="' + W + '" height="' + H + '" fill="' + T.bg + '"/>' : '');
  nice(lo, hi, 4).forEach(function(v){ var y = Y(v); g += '<line x1="' + L + '" x2="' + (L + pw) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + (v === 0 ? T.mut : T.grid) + '"/><text x="' + (L - 5) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="' + T.mut + '">' + v.toFixed(0) + '%</text>'; });
  rows.forEach(function(r, i){
    var x = L + i * bw, w2 = Math.max(1.5, bw * .36), y0 = Y(0);
    [[r[1], T.s, 0], [r[2], T.b, 1]].forEach(function(c){ if(c[0] == null) return; var y = Y(c[0]); g += '<rect x="' + (x + bw * .12 + c[2] * w2).toFixed(1) + '" y="' + Math.min(y, y0).toFixed(1) + '" width="' + w2.toFixed(1) + '" height="' + Math.max(.5, Math.abs(y0 - y)).toFixed(1) + '" fill="' + c[1] + '"><title>' + esc(r[0] + ': ' + c[0].toFixed(1) + '%') + '</title></rect>'; });
    if(rows.length <= 14 || i % Math.ceil(rows.length / 12) === 0) g += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="' + T.mut + '">' + esc(rows.length > 14 ? "'" + String(r[0]).slice(2) : r[0]) + '</text>';
  });
  return g + '</svg>';
};
/* SVG -> JPEG data URL on white, for the PDF (PNG made the report about 18 MB). */
QN.png = function(svg, W, H, scale){
  return new Promise(function(res, rej){
    var img = new Image(), k = scale || 2;
    img.onload = function(){ var c = document.createElement('canvas'); c.width = W * k; c.height = H * k; var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .9)); };
    img.onerror = function(){ rej(new Error('chart image failed')); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
};

root.QN = QN;
if(typeof module !== 'undefined' && module.exports) module.exports = QN;
})(typeof window !== 'undefined' ? window : globalThis);
