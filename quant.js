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
  'roc', 'ret', 'highest', 'lowest', 'atr', 'vol', 'drawdown', 'zscore'];
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
QN.align = function(data, main, syms){
  var idx = {}, out = { dates:[], bars:{} };
  syms.forEach(function(s){ var rows = data[s] || []; if(rows.length < 30) throw new Error('not enough price history for ' + s); var m = {}; rows.forEach(function(r){ m[r.d] = r; }); idx[s] = { m:m, first:rows[0].d }; });
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
  if(spec.type === 'allocation') (spec.assets || []).forEach(function(a){ add(a.sym); }); else add(spec.symbol);
  add(spec.alt); add(spec.benchmark || 'SPY');
  var walk = function(e){ if(e && typeof e === 'object'){ if(e.sym) add(e.sym); walk(e.a); walk(e.b); } };
  ['entry', 'exit', 'filter'].forEach(function(k){ (spec[k] || []).forEach(walk); });
  return set;
};

/* ------------------------------------------------------------------ the backtest */
QN.params = function(spec, over){ var P = {}; (spec.params || []).forEach(function(p){ P[p.id] = p.value; }); return Object.assign(P, over || {}); };
QN.backtest = function(spec, al, over){
  var P = QN.params(spec, over), main = spec.type === 'allocation' ? String(spec.assets[0].sym).toUpperCase() : String(spec.symbol).toUpperCase();
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
  var target = function(i){   // weights to hold from the close of day i
    if(spec.type === 'allocation'){
      var ok = filter.every(function(f){ return f(i); }), t = {};
      if(!ok){ if(alt) t[alt] = 1; return t; }
      var tot = spec.assets.reduce(function(s, a){ return s + (+val(a.weight, P) || 0); }, 0) || 1;
      spec.assets.forEach(function(a){ var s = String(a.sym).toUpperCase(); t[s] = (t[s] || 0) + (+val(a.weight, P) || 0) / tot; });
      return t;
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
    } else if(entry.length && entry.every(function(f){ return f(i); })) open = { i:i, px:px, peak:px };
    var t2 = {};
    if(open) t2[main] = side * size; else if(alt) t2[alt] = size;
    return t2;
  };
  for(var i = i0; i < n; i++){
    var r = 0, bret = R[bsym] ? R[bsym][i] : 0;
    if(i > i0) Object.keys(w).forEach(function(s){ r += w[s] * R[s][i]; });
    // drift the weights with the day's moves (allocation), then decide today's target
    var nw = w, base = w;
    if(spec.type === 'allocation'){
      var tot = 1 + r, dw = {}; Object.keys(w).forEach(function(s){ dw[s] = w[s] * (1 + (i > i0 ? R[s][i] : 0)) / (tot || 1); }); nw = base = dw;   // weights drift with prices between rebalances
      var reb = spec.rebalance || 'monthly', key = reb === 'none' ? (i === i0 ? 'x' : lastReb) : reb === 'yearly' ? al.dates[i].slice(0, 4) : reb === 'quarterly' ? al.dates[i].slice(0, 4) + Math.floor((+al.dates[i].slice(5, 7) - 1) / 3) : al.dates[i].slice(0, 7);
      var t = target(i), flip = Object.keys(t).join() !== Object.keys(w).join();
      if(key !== lastReb || flip || i === i0){ nw = t; lastReb = key; }
    } else nw = target(i);
    var turn = 0, keys = {}; Object.keys(w).concat(Object.keys(nw)).forEach(function(s){ keys[s] = 1; });
    Object.keys(keys).forEach(function(s){ turn += Math.abs((nw[s] || 0) - (base[s] || 0)); });
    var day = (1 + r) * (1 - turn * cost) - 1;
    if(i > i0){ eq.push(eq[eq.length - 1] * (1 + day)); bq.push(bq[bq.length - 1] * (1 + bret)); dr.push(day); }
    else if(turn) { eq[0] = 1 - turn * cost; }
    w = nw; inPos.push(Object.keys(w).some(function(s){ return w[s] && s !== alt; }) ? 1 : 0);
  }
  if(open) trades.push({ in:al.dates[open.i], out:al.dates[n - 1], pxIn:open.px, pxOut:mc[n - 1], ret:side * (mc[n - 1] / open.px - 1) * 100, days:n - 1 - open.i, why:'open', open:true });
  var dates = al.dates.slice(i0);
  return { dates:dates, eq:eq, bench:bq, ret:dr, bret:bq.map(function(v, k){ return k ? v / bq[k - 1] - 1 : 0; }).slice(1), inPos:inPos, trades:trades, metrics:QN.metrics(dates, eq, bq, trades, inPos, val(spec.rf, P) || 0), P:P, main:main, bsym:bsym };
};

/* ------------------------------------------------------------------ metrics */
function mean(a){ var s = 0; for(var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
function sd(a){ var m = mean(a), s = 0; for(var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return a.length > 1 ? Math.sqrt(s / (a.length - 1)) : 0; }
function stats(dates, q, rf){
  var r = q.map(function(v, k){ return k ? v / q[k - 1] - 1 : 0; }).slice(1), yrs = Math.max(1 / DAY, r.length / DAY);
  var cagr = Math.pow(q[q.length - 1] / q[0], 1 / yrs) - 1, vol = sd(r) * Math.sqrt(DAY);
  var dn = r.filter(function(x){ return x < 0; }), dvol = Math.sqrt(mean(dn.map(function(x){ return x * x; }))) * Math.sqrt(DAY);
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
    exposure:inPos.length ? mean(inPos) * 100 : 0, beatYears:beat, nYears:s.years.length, from:dates[0], to:dates[dates.length - 1],
    monthly:Object.keys(months).map(function(m){ return [m, (months[m].b / months[m].a - 1) * 100]; }) };
};
/* The report's three judgements, rule-based so they are the same every time.
   Rating (1-5 stars): Sharpe edge over the benchmark. Edge (None / Narrow / Wide): share of calendar years it beat the benchmark.
   Uncertainty: width of the 1-year projection's 5th-95th percentile range. */
QN.rating = function(m){ var d = m.s.sharpe - m.b.sharpe; return d > .4 ? 5 : d > .15 ? 4 : d > -.15 ? 3 : d > -.4 ? 2 : 1; };
QN.edge = function(m){ var p = m.nYears ? m.beatYears / m.nYears : 0; return m.nYears < 3 ? 'Too short' : p >= .7 ? 'Wide' : p >= .55 ? 'Narrow' : 'None'; };
QN.uncertainty = function(spread){ return spread < 30 ? 'Low' : spread < 50 ? 'Medium' : spread < 80 ? 'High' : 'Very High'; };

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
