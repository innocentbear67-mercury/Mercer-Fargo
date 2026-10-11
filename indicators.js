/* MercerFargo indicators: the maths and the SVG drawing.
   No DOM and no app globals in here: everything arrives as an argument, so the maths can be tested in Node.
   A series is an array with one value per bar, null where a value does not exist yet.
   Every indicator returns a "spec" (lines, histogram, levels, dots, marks...) and draw() turns a spec into SVG. */
(function(root){
'use strict';
var IND = {};

/* ------------------------------------------------------------------ series helpers */
function ok(x){ return x != null && isFinite(x); }
function fill(n, v){ var o = new Array(n); for(var i = 0; i < n; i++) o[i] = v; return o; }
function map2(a, b, f){ var n = a.length, o = new Array(n); for(var i = 0; i < n; i++) o[i] = ok(a[i]) && ok(b[i]) ? f(a[i], b[i]) : null; return o; }
function sma(v, p){
  var n = v.length, o = new Array(n), s = 0, bad = 0;
  for(var i = 0; i < n; i++){
    if(ok(v[i])) s += v[i]; else bad++;
    if(i >= p){ if(ok(v[i - p])) s -= v[i - p]; else bad--; }
    o[i] = i >= p - 1 && !bad ? s / p : null;
  }
  return o;
}
function ema(v, p, alpha){
  var n = v.length, o = fill(n, null), seed = sma(v, p), prev = null, al = alpha || 2 / (p + 1);
  for(var i = 0; i < n; i++){
    if(prev == null){ if(seed[i] != null){ prev = seed[i]; o[i] = prev; } }
    else if(ok(v[i])){ prev = al * v[i] + (1 - al) * prev; o[i] = prev; }
  }
  return o;
}
function rma(v, p){ return ema(v, p, 1 / p); }   // Wilder's smoothing, what RSI, ATR and ADX use
function wma(v, p){
  var n = v.length, o = fill(n, null), den = p * (p + 1) / 2;
  for(var i = p - 1; i < n; i++){
    var s = 0, good = true;
    for(var j = 0; j < p; j++){ var x = v[i - j]; if(!ok(x)){ good = false; break; } s += x * (p - j); }
    if(good) o[i] = s / den;
  }
  return o;
}
function stdev(v, p){
  var n = v.length, o = fill(n, null);
  for(var i = p - 1; i < n; i++){
    var s = 0, good = true;
    for(var j = 0; j < p; j++){ if(!ok(v[i - j])){ good = false; break; } s += v[i - j]; }
    if(!good) continue;
    var m = s / p, q = 0; for(var k = 0; k < p; k++) q += (v[i - k] - m) * (v[i - k] - m);
    o[i] = Math.sqrt(q / p);
  }
  return o;
}
function highest(v, p){ var n = v.length, o = fill(n, null); for(var i = p - 1; i < n; i++){ var m = -Infinity, good = true; for(var j = 0; j < p; j++){ var x = v[i - j]; if(!ok(x)){ good = false; break; } if(x > m) m = x; } if(good) o[i] = m; } return o; }
function lowest(v, p){ var n = v.length, o = fill(n, null); for(var i = p - 1; i < n; i++){ var m = Infinity, good = true; for(var j = 0; j < p; j++){ var x = v[i - j]; if(!ok(x)){ good = false; break; } if(x < m) m = x; } if(good) o[i] = m; } return o; }
function sumN(v, p){ var n = v.length, o = fill(n, null); for(var i = p - 1; i < n; i++){ var s = 0, good = true; for(var j = 0; j < p; j++){ if(!ok(v[i - j])){ good = false; break; } s += v[i - j]; } if(good) o[i] = s; } return o; }
function shiftF(v, k, n){   // displace forward by k bars: the result is longer than the input so the future part can be drawn
  var o = fill(n + k, null); for(var i = 0; i < v.length; i++) if(i + k < o.length) o[i + k] = v[i]; return o;
}
function lag(v, k){ var o = fill(v.length, null); for(var i = k; i < v.length; i++) o[i] = v[i - k]; return o; }
function cum(v){ var s = 0, o = new Array(v.length); for(var i = 0; i < v.length; i++){ if(ok(v[i])) s += v[i]; o[i] = s; } return o; }
function trueRange(H, L, C){ return H.map(function(h, i){ return i ? Math.max(h - L[i], Math.abs(h - C[i - 1]), Math.abs(L[i] - C[i - 1])) : h - L[i]; }); }
function atrOf(H, L, C, p){ return rma(trueRange(H, L, C), p); }
function rsiOf(C, p){
  var up = C.map(function(c, i){ return i ? Math.max(c - C[i - 1], 0) : null; }), dn = C.map(function(c, i){ return i ? Math.max(C[i - 1] - c, 0) : null; });
  var au = rma(up, p), ad = rma(dn, p);
  return C.map(function(_, i){ return au[i] == null || ad[i] == null ? null : ad[i] === 0 ? 100 : 100 - 100 / (1 + au[i] / ad[i]); });
}
function stochOf(src, H, L, p){   // where src sits inside its p-bar high-low range, 0 to 100
  var hh = highest(H, p), ll = lowest(L, p);
  return src.map(function(c, i){ return !ok(hh[i]) || !ok(ll[i]) || !ok(c) ? null : hh[i] === ll[i] ? 50 : 100 * (c - ll[i]) / (hh[i] - ll[i]); });
}
function crossMarks(fast, slow, H, L){   // an arrow where the fast line crosses the slow one
  var m = [];
  for(var i = 1; i < fast.length; i++){
    if(!ok(fast[i]) || !ok(slow[i]) || !ok(fast[i - 1]) || !ok(slow[i - 1])) continue;
    if(fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) m.push({ i:i, y:L[i], up:true, col:'#1f9d55' });
    else if(fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) m.push({ i:i, y:H[i], up:false, col:'#e0353b' });
  }
  return m;
}

/* ------------------------------------------------------------------ catalog */
var CAT = ['Moving Averages', 'Momentum', 'Volatility & Bands', 'Trend', 'Volume', 'Volume Profile', 'Levels & Patterns', 'Statistics'];
var defs = [], byId = {};
var C1 = '#2962ff', C2 = '#ff6d00', C3 = '#e91e63', C4 = '#00a38c', C5 = '#9c27b0', C6 = '#f5a623', C7 = '#6b7280', GOLD = '#c1a578', UP = '#1f9d55', DN = '#e0353b';
/* kind: ov = drawn on the price chart, pn = its own pane under it, band = the volume band, prof = volume profile */
function def(id, name, cat, kind, p, f, col){
  var d = { id:id, name:name, cat:cat, kind:kind, p:p, f:f, col:col || C1 };
  var m = name.match(/\(([^)]+)\)\s*$/); d.short = m ? m[1] : name;
  defs.push(d); byId[id] = d;
}
function line(v, col, w, dash){ return { v:v, col:col, w:w || 1.5, dash:dash || '' }; }

/* ---- moving averages */
def('sma', 'Simple Moving Average (SMA)', CAT[0], 'ov', { len:20 }, function(x){ return { lines:[line(sma(x.C, x.p.len), C1)] }; }, C1);
def('ema', 'Exponential Moving Average (EMA)', CAT[0], 'ov', { len:20 }, function(x){ return { lines:[line(ema(x.C, x.p.len), C2)] }; }, C2);
def('wma', 'Weighted Moving Average (WMA)', CAT[0], 'ov', { len:20 }, function(x){ return { lines:[line(wma(x.C, x.p.len), C3)] }; }, C3);
def('hma', 'Hull Moving Average (HMA)', CAT[0], 'ov', { len:21 }, function(x){
  var p = x.p.len, w1 = wma(x.C, Math.max(1, Math.floor(p / 2))), w2 = wma(x.C, p);
  return { lines:[line(wma(map2(w1, w2, function(a, b){ return 2 * a - b; }), Math.max(1, Math.round(Math.sqrt(p)))), C4)] };
}, C4);
def('vwma', 'Volume Weighted Moving Average (VWMA)', CAT[0], 'ov', { len:20 }, function(x){
  var pv = sma(x.C.map(function(c, i){ return c * x.V[i]; }), x.p.len), vv = sma(x.V, x.p.len);
  return { lines:[line(map2(pv, vv, function(a, b){ return b ? a / b : null; }), C5)] };
}, C5);
def('smma', 'Smoothed Moving Average (SMMA)', CAT[0], 'ov', { len:20 }, function(x){ return { lines:[line(rma(x.C, x.p.len), C6)] }; }, C6);
def('dema', 'Double Exponential Moving Average (DEMA)', CAT[0], 'ov', { len:20 }, function(x){
  var e1 = ema(x.C, x.p.len), e2 = ema(e1, x.p.len);
  return { lines:[line(map2(e1, e2, function(a, b){ return 2 * a - b; }), C2)] };
}, C2);
def('tema', 'Triple Exponential Moving Average (TEMA)', CAT[0], 'ov', { len:20 }, function(x){
  var e1 = ema(x.C, x.p.len), e2 = ema(e1, x.p.len), e3 = ema(e2, x.p.len);
  return { lines:[line(e1.map(function(a, i){ return ok(a) && ok(e2[i]) && ok(e3[i]) ? 3 * a - 3 * e2[i] + e3[i] : null; }), C3)] };
}, C3);
def('emacross', 'EMA Cross', CAT[0], 'ov', { fast:9, slow:21 }, function(x){
  var f = ema(x.C, x.p.fast), s = ema(x.C, x.p.slow);
  return { lines:[line(f, C1), line(s, C2)], marks:crossMarks(f, s, x.H, x.L) };
}, C1);
def('macross', 'MA Cross', CAT[0], 'ov', { fast:50, slow:200 }, function(x){
  var f = sma(x.C, x.p.fast), s = sma(x.C, x.p.slow);
  return { lines:[line(f, C4), line(s, C3)], marks:crossMarks(f, s, x.H, x.L) };
}, C4);

/* ---- momentum */
def('rsi', 'Relative Strength Index (RSI)', CAT[1], 'pn', { len:14 }, function(x){
  return { lines:[line(rsiOf(x.C, x.p.len), C5)], levels:[{ y:70, dash:'4 4' }, { y:50, dash:'2 4', faint:1 }, { y:30, dash:'4 4' }], band:[30, 70], range:[0, 100] };
}, C5);
def('stochrsi', 'Stochastic RSI', CAT[1], 'pn', { rsi:14, stoch:14, k:3, d:3 }, function(x){
  var r = rsiOf(x.C, x.p.rsi), raw = stochOf(r, r, r, x.p.stoch), k = sma(raw, x.p.k);
  return { lines:[line(k, C1), line(sma(k, x.p.d), C2)], levels:[{ y:80, dash:'4 4' }, { y:20, dash:'4 4' }], band:[20, 80], range:[0, 100] };
}, C1);
def('stoch', 'Stochastic Oscillator', CAT[1], 'pn', { k:14, smooth:1, d:3 }, function(x){
  var k = sma(stochOf(x.C, x.H, x.L, x.p.k), x.p.smooth);
  return { lines:[line(k, C1), line(sma(k, x.p.d), C2)], levels:[{ y:80, dash:'4 4' }, { y:20, dash:'4 4' }], band:[20, 80], range:[0, 100] };
}, C1);
def('macd', 'MACD', CAT[1], 'pn', { fast:12, slow:26, sig:9 }, function(x){
  var m = map2(ema(x.C, x.p.fast), ema(x.C, x.p.slow), function(a, b){ return a - b; }), s = ema(m, x.p.sig);
  return { hist:{ v:map2(m, s, function(a, b){ return a - b; }), up:UP, dn:DN }, lines:[line(m, C1), line(s, C2)], levels:[{ y:0, dash:'2 4' }] };
}, C1);
def('williamsr', 'Williams %R', CAT[1], 'pn', { len:14 }, function(x){
  return { lines:[line(stochOf(x.C, x.H, x.L, x.p.len).map(function(v){ return ok(v) ? v - 100 : null; }), C5)], levels:[{ y:-20, dash:'4 4' }, { y:-80, dash:'4 4' }], band:[-80, -20], range:[-100, 0] };
}, C5);
def('cci', 'Commodity Channel Index (CCI)', CAT[1], 'pn', { len:20 }, function(x){
  var tp = x.C.map(function(c, i){ return (x.H[i] + x.L[i] + c) / 3; }), m = sma(tp, x.p.len), p = x.p.len;
  var o = tp.map(function(t, i){
    if(!ok(m[i])) return null;
    var d = 0; for(var j = 0; j < p; j++) d += Math.abs(tp[i - j] - m[i]);
    d /= p; return d ? (t - m[i]) / (0.015 * d) : 0;
  });
  return { lines:[line(o, C1)], levels:[{ y:100, dash:'4 4' }, { y:0, dash:'2 4', faint:1 }, { y:-100, dash:'4 4' }], band:[-100, 100] };
}, C1);
def('mfi', 'Money Flow Index (MFI)', CAT[1], 'pn', { len:14 }, function(x){
  var n = x.n, tp = x.C.map(function(c, i){ return (x.H[i] + x.L[i] + c) / 3; });
  var pos = fill(n, null), neg = fill(n, null);
  for(var i = 1; i < n; i++){ var f = tp[i] * x.V[i]; pos[i] = tp[i] > tp[i - 1] ? f : 0; neg[i] = tp[i] < tp[i - 1] ? f : 0; }
  var ps = sumN(pos, x.p.len), ns = sumN(neg, x.p.len);
  return { lines:[line(ps.map(function(a, i){ return ok(a) && ok(ns[i]) ? (ns[i] === 0 ? 100 : 100 - 100 / (1 + a / ns[i])) : null; }), C4)], levels:[{ y:80, dash:'4 4' }, { y:20, dash:'4 4' }], band:[20, 80], range:[0, 100] };
}, C4);
def('aroon', 'Aroon', CAT[1], 'pn', { len:25 }, function(x){
  var p = x.p.len, n = x.n, up = fill(n, null), dn = fill(n, null);
  for(var i = p; i < n; i++){
    var hi = i, lo = i;
    for(var j = i - p; j <= i; j++){ if(x.H[j] >= x.H[hi]) hi = j; if(x.L[j] <= x.L[lo]) lo = j; }
    up[i] = 100 * (p - (i - hi)) / p; dn[i] = 100 * (p - (i - lo)) / p;
  }
  return { lines:[line(up, UP), line(dn, DN)], levels:[{ y:70, dash:'4 4', faint:1 }, { y:30, dash:'4 4', faint:1 }], range:[0, 100] };
}, UP);
def('ao', 'Awesome Oscillator', CAT[1], 'pn', { fast:5, slow:34 }, function(x){
  var m = x.C.map(function(_, i){ return (x.H[i] + x.L[i]) / 2; }), v = map2(sma(m, x.p.fast), sma(m, x.p.slow), function(a, b){ return a - b; });
  return { hist:{ v:v, up:UP, dn:DN, byChange:true }, levels:[{ y:0, dash:'2 4' }] };
}, UP);
def('mom', 'Momentum', CAT[1], 'pn', { len:10 }, function(x){
  return { lines:[line(x.C.map(function(c, i){ return i >= x.p.len ? c - x.C[i - x.p.len] : null; }), C1)], levels:[{ y:0, dash:'2 4' }] };
}, C1);
def('roc', 'Rate of Change (ROC)', CAT[1], 'pn', { len:9 }, function(x){
  return { lines:[line(x.C.map(function(c, i){ return i >= x.p.len && x.C[i - x.p.len] ? 100 * (c / x.C[i - x.p.len] - 1) : null; }), C1)], levels:[{ y:0, dash:'2 4' }] };
}, C1);
def('tsi', 'True Strength Index (TSI)', CAT[1], 'pn', { long:25, short:13, sig:13 }, function(x){
  var mo = x.C.map(function(c, i){ return i ? c - x.C[i - 1] : null; }), ab = mo.map(function(m){ return ok(m) ? Math.abs(m) : null; });
  var num = ema(ema(mo, x.p.long), x.p.short), den = ema(ema(ab, x.p.long), x.p.short);
  var t = map2(num, den, function(a, b){ return b ? 100 * a / b : 0; });
  return { lines:[line(t, C1), line(ema(t, x.p.sig), C2)], levels:[{ y:0, dash:'2 4' }] };
}, C1);
def('uo', 'Ultimate Oscillator', CAT[1], 'pn', { a:7, b:14, c:28 }, function(x){
  var n = x.n, bp = fill(n, null), tr = fill(n, null);
  for(var i = 1; i < n; i++){ var lo = Math.min(x.L[i], x.C[i - 1]), hi = Math.max(x.H[i], x.C[i - 1]); bp[i] = x.C[i] - lo; tr[i] = hi - lo; }
  var av = function(p){ var b = sumN(bp, p), t = sumN(tr, p); return map2(b, t, function(u, w){ return w ? u / w : 0; }); };
  var a1 = av(x.p.a), a2 = av(x.p.b), a3 = av(x.p.c);
  return { lines:[line(a1.map(function(v, i){ return ok(v) && ok(a2[i]) && ok(a3[i]) ? 100 * (4 * v + 2 * a2[i] + a3[i]) / 7 : null; }), C5)], levels:[{ y:70, dash:'4 4' }, { y:30, dash:'4 4' }], band:[30, 70], range:[0, 100] };
}, C5);
def('cmo', 'Chande Momentum Oscillator (CMO)', CAT[1], 'pn', { len:9 }, function(x){
  var up = x.C.map(function(c, i){ return i ? Math.max(c - x.C[i - 1], 0) : null; }), dn = x.C.map(function(c, i){ return i ? Math.max(x.C[i - 1] - c, 0) : null; });
  var su = sumN(up, x.p.len), sd = sumN(dn, x.p.len);
  return { lines:[line(map2(su, sd, function(a, b){ return a + b ? 100 * (a - b) / (a + b) : 0; }), C4)], levels:[{ y:50, dash:'4 4' }, { y:0, dash:'2 4', faint:1 }, { y:-50, dash:'4 4' }], range:[-100, 100] };
}, C4);

/* ---- volatility and bands */
function bandsOf(x, basis, off){ var u = map2(basis, off, function(a, b){ return a + b; }), l = map2(basis, off, function(a, b){ return a - b; }); return { u:u, l:l }; }
def('bb', 'Bollinger Bands', CAT[2], 'ov', { len:20, mult:2 }, function(x){
  var m = sma(x.C, x.p.len), sd = stdev(x.C, x.p.len), b = bandsOf(x, m, sd.map(function(s){ return ok(s) ? s * x.p.mult : null; }));
  return { lines:[line(b.u, C1, 1.3), line(m, C2, 1.3), line(b.l, C1, 1.3)], fills:[{ a:0, b:2, col:C1, op:.08 }] };
}, C1);
def('bbpb', 'Bollinger Bands %B', CAT[2], 'pn', { len:20, mult:2 }, function(x){
  var m = sma(x.C, x.p.len), sd = stdev(x.C, x.p.len);
  return { lines:[line(x.C.map(function(c, i){ return ok(m[i]) && sd[i] ? (c - (m[i] - x.p.mult * sd[i])) / (2 * x.p.mult * sd[i]) : null; }), C1)], levels:[{ y:1, dash:'4 4' }, { y:0.5, dash:'2 4', faint:1 }, { y:0, dash:'4 4' }], band:[0, 1] };
}, C1);
def('bbw', 'Bollinger Bands Width', CAT[2], 'pn', { len:20, mult:2 }, function(x){
  var m = sma(x.C, x.p.len), sd = stdev(x.C, x.p.len);
  return { lines:[line(m.map(function(b, i){ return ok(b) && b && ok(sd[i]) ? 2 * x.p.mult * sd[i] / b : null; }), C2)] };
}, C2);
def('atr', 'Average True Range (ATR)', CAT[2], 'pn', { len:14 }, function(x){ return { lines:[line(atrOf(x.H, x.L, x.C, x.p.len), C3)] }; }, C3);
def('keltner', 'Keltner Channels', CAT[2], 'ov', { len:20, mult:2, atr:10 }, function(x){
  var m = ema(x.C, x.p.len), a = atrOf(x.H, x.L, x.C, x.p.atr), b = bandsOf(x, m, a.map(function(v){ return ok(v) ? v * x.p.mult : null; }));
  return { lines:[line(b.u, C4, 1.3), line(m, C4, 1.3, '4 3'), line(b.l, C4, 1.3)], fills:[{ a:0, b:2, col:C4, op:.07 }] };
}, C4);
def('donchian', 'Donchian Channels', CAT[2], 'ov', { len:20 }, function(x){
  var u = highest(x.H, x.p.len), l = lowest(x.L, x.p.len);
  return { lines:[line(u, C1, 1.3), line(map2(u, l, function(a, b){ return (a + b) / 2; }), C2, 1.3, '4 3'), line(l, C1, 1.3)], fills:[{ a:0, b:2, col:C1, op:.07 }] };
}, C1);
def('pchannel', 'Price Channel', CAT[2], 'ov', { len:20 }, function(x){
  var u = lag(highest(x.H, x.p.len), 1), l = lag(lowest(x.L, x.p.len), 1);   // the previous N bars, so today's bar can break out
  return { lines:[line(u, C5, 1.3), line(l, C5, 1.3)], fills:[{ a:0, b:1, col:C5, op:.07 }] };
}, C5);
def('maenv', 'Moving Average Envelope', CAT[2], 'ov', { len:20, pct:2.5 }, function(x){
  var m = sma(x.C, x.p.len), k = x.p.pct / 100;
  return { lines:[line(m.map(function(v){ return ok(v) ? v * (1 + k) : null; }), C6, 1.3), line(m, C6, 1.3, '4 3'), line(m.map(function(v){ return ok(v) ? v * (1 - k) : null; }), C6, 1.3)], fills:[{ a:0, b:2, col:C6, op:.07 }] };
}, C6);
def('hv', 'Historical Volatility', CAT[2], 'pn', { len:10 }, function(x){
  var r = x.C.map(function(c, i){ return i && x.C[i - 1] > 0 && c > 0 ? Math.log(c / x.C[i - 1]) : null; });
  return { lines:[line(stdev(r, x.p.len).map(function(s){ return ok(s) ? s * Math.sqrt(252) * 100 : null; }), C5)] };
}, C5);
def('stdev', 'Standard Deviation', CAT[2], 'pn', { len:20 }, function(x){ return { lines:[line(stdev(x.C, x.p.len), C2)] }; }, C2);
def('chop', 'Choppiness Index', CAT[2], 'pn', { len:14 }, function(x){
  var tr = trueRange(x.H, x.L, x.C), s = sumN(tr, x.p.len), hh = highest(x.H, x.p.len), ll = lowest(x.L, x.p.len), lg = Math.log10(x.p.len);
  return { lines:[line(s.map(function(v, i){ return ok(v) && ok(hh[i]) && hh[i] > ll[i] ? 100 * Math.log10(v / (hh[i] - ll[i])) / lg : null; }), C1)], levels:[{ y:61.8, dash:'4 4' }, { y:38.2, dash:'4 4' }], band:[38.2, 61.8], range:[0, 100] };
}, C1);

/* ---- trend */
def('supertrend', 'Supertrend', CAT[3], 'ov', { len:10, mult:3 }, function(x){
  var n = x.n, a = atrOf(x.H, x.L, x.C, x.p.len), up = fill(n, null), dn = fill(n, null), fu = null, fl = null, dir = 1;
  for(var i = 0; i < n; i++){
    if(!ok(a[i])) continue;
    var hl2 = (x.H[i] + x.L[i]) / 2, bu = hl2 + x.p.mult * a[i], bl = hl2 - x.p.mult * a[i], pc = i ? x.C[i - 1] : x.C[i];
    fu = fu == null || bu < fu || pc > fu ? bu : fu;
    fl = fl == null || bl > fl || pc < fl ? bl : fl;
    var prevDir = dir;
    if(dir === 1 && x.C[i] < fl) dir = -1; else if(dir === -1 && x.C[i] > fu) dir = 1;
    if(dir === 1){ up[i] = fl; if(prevDir === -1 && i) up[i - 1] = up[i - 1] == null ? fl : up[i - 1]; } else { dn[i] = fu; }
  }
  return { lines:[line(up, UP, 1.8), line(dn, DN, 1.8)] };
}, UP);
function dmi(x, len){
  var n = x.n, pdm = fill(n, null), mdm = fill(n, null);
  for(var i = 1; i < n; i++){
    var u = x.H[i] - x.H[i - 1], d = x.L[i - 1] - x.L[i];
    pdm[i] = u > d && u > 0 ? u : 0; mdm[i] = d > u && d > 0 ? d : 0;
  }
  var tr = rma(trueRange(x.H, x.L, x.C), len), pi = rma(pdm, len), mi = rma(mdm, len);
  var pd = map2(pi, tr, function(a, t){ return t ? 100 * a / t : 0; }), md = map2(mi, tr, function(a, t){ return t ? 100 * a / t : 0; });
  var dx = map2(pd, md, function(a, b){ return a + b ? 100 * Math.abs(a - b) / (a + b) : 0; });
  return { pd:pd, md:md, adx:rma(dx, len) };
}
def('adx', 'Average Directional Index (ADX)', CAT[3], 'pn', { len:14 }, function(x){
  return { lines:[line(dmi(x, x.p.len).adx, C3)], levels:[{ y:25, dash:'4 4' }], range:[0, 60] };
}, C3);
def('dmi', 'Directional Movement Index (DMI)', CAT[3], 'pn', { len:14 }, function(x){
  var d = dmi(x, x.p.len);
  return { lines:[line(d.pd, UP), line(d.md, DN), line(d.adx, C2, 1.2)], levels:[{ y:25, dash:'4 4', faint:1 }], range:[0, 60] };
}, UP);
def('psar', 'Parabolic SAR', CAT[3], 'ov', { step:0.02, max:0.2 }, function(x){
  var n = x.n, o = fill(n, null);
  if(n < 3) return { dots:[{ v:o, col:C1 }] };
  var up = x.C[1] >= x.C[0], af = x.p.step, ep = up ? x.H[1] : x.L[1], sar = up ? x.L[0] : x.H[0];
  o[1] = sar;
  for(var i = 2; i < n; i++){
    sar = sar + af * (ep - sar);
    if(up){
      sar = Math.min(sar, x.L[i - 1], x.L[i - 2]);
      if(x.L[i] < sar){ up = false; sar = ep; ep = x.L[i]; af = x.p.step; }
      else if(x.H[i] > ep){ ep = x.H[i]; af = Math.min(af + x.p.step, x.p.max); }
    } else {
      sar = Math.max(sar, x.H[i - 1], x.H[i - 2]);
      if(x.H[i] > sar){ up = true; sar = ep; ep = x.H[i]; af = x.p.step; }
      else if(x.L[i] < ep){ ep = x.L[i]; af = Math.min(af + x.p.step, x.p.max); }
    }
    o[i] = sar;
  }
  return { dots:[{ v:o, col:C1 }] };
}, C1);
def('ichimoku', 'Ichimoku Cloud', CAT[3], 'ov', { tenkan:9, kijun:26, senkou:52, shift:26 }, function(x){
  var mid = function(p){ return map2(highest(x.H, p), lowest(x.L, p), function(a, b){ return (a + b) / 2; }); };
  var t = mid(x.p.tenkan), k = mid(x.p.kijun), sa = map2(t, k, function(a, b){ return (a + b) / 2; }), sb = mid(x.p.senkou), s = x.p.shift;
  var chikou = x.C.map(function(_, i){ return i + s < x.n ? x.C[i + s] : null; });
  return { lines:[line(shiftF(sa, s, x.n), UP, 1), line(shiftF(sb, s, x.n), DN, 1), line(t, C1, 1.2), line(k, C3, 1.2), line(chikou, C7, 1)], fills:[{ a:0, b:1, split:true, up:UP, dn:DN, op:.14 }] };
}, C1);
def('alligator', 'Williams Alligator', CAT[3], 'ov', { jaw:13, teeth:8, lips:5 }, function(x){
  var m = x.C.map(function(_, i){ return (x.H[i] + x.L[i]) / 2; });
  return { lines:[line(shiftF(rma(m, x.p.jaw), 8, x.n), C1, 1.4), line(shiftF(rma(m, x.p.teeth), 5, x.n), DN, 1.4), line(shiftF(rma(m, x.p.lips), 3, x.n), UP, 1.4)] };
}, C1);
def('vortex', 'Vortex Indicator', CAT[3], 'pn', { len:14 }, function(x){
  var n = x.n, vp = fill(n, null), vm = fill(n, null), tr = trueRange(x.H, x.L, x.C);
  for(var i = 1; i < n; i++){ vp[i] = Math.abs(x.H[i] - x.L[i - 1]); vm[i] = Math.abs(x.L[i] - x.H[i - 1]); }
  var st = sumN(tr, x.p.len);
  return { lines:[line(map2(sumN(vp, x.p.len), st, function(a, b){ return b ? a / b : null; }), UP), line(map2(sumN(vm, x.p.len), st, function(a, b){ return b ? a / b : null; }), DN)], levels:[{ y:1, dash:'2 4', faint:1 }] };
}, UP);
def('linregcurve', 'Linear Regression Curve', CAT[3], 'ov', { len:100 }, function(x){
  return { lines:[line(linreg(x.C, x.p.len).end, C2, 1.6)] };
}, C2);
def('linregslope', 'Linear Regression Slope', CAT[3], 'pn', { len:100 }, function(x){
  return { lines:[line(linreg(x.C, x.p.len).slope, C1)], levels:[{ y:0, dash:'2 4' }] };
}, C1);
function linreg(v, p){   // least-squares line through the last p values: where it ends, and its slope per bar
  var n = v.length, end = fill(n, null), slope = fill(n, null), sx = p * (p - 1) / 2, sxx = (p - 1) * p * (2 * p - 1) / 6;
  for(var i = p - 1; i < n; i++){
    var sy = 0, sxy = 0, good = true;
    for(var j = 0; j < p; j++){ var y = v[i - p + 1 + j]; if(!ok(y)){ good = false; break; } sy += y; sxy += j * y; }
    if(!good) continue;
    var den = p * sxx - sx * sx, m = den ? (p * sxy - sx * sy) / den : 0, b = (sy - m * sx) / p;
    slope[i] = m; end[i] = b + m * (p - 1);
  }
  return { end:end, slope:slope };
}
def('zigzag', 'Zig Zag', CAT[3], 'ov', { pct:5 }, function(x){
  var n = x.n, th = x.p.pct / 100, pts = [], dir = 0, hi = 0, lo = 0;
  for(var i = 1; i < n; i++){
    if(x.H[i] > x.H[hi]) hi = i;
    if(x.L[i] < x.L[lo]) lo = i;
    if(dir >= 0 && x.L[i] < x.H[hi] * (1 - th) && hi !== i){ pts.push([hi, x.H[hi]]); dir = -1; lo = i; hi = i; }
    else if(dir <= 0 && x.H[i] > x.L[lo] * (1 + th) && lo !== i){ pts.push([lo, x.L[lo]]); dir = 1; hi = i; lo = i; }
  }
  if(dir > 0) pts.push([hi, x.H[hi]]); else if(dir < 0) pts.push([lo, x.L[lo]]);   // the leg still being drawn
  return { poly:[{ pts:pts, col:C6, w:1.6 }] };
}, C6);

/* ---- volume */
def('vol', 'Volume', CAT[4], 'band', {}, function(){ return {}; }, C7);
function sessKey(x, i){   // VWAP and profiles restart each session: a day on intraday bars, a month on daily bars, a year on weekly and monthly
  var d = x.D[i];
  return x.intra ? d : x.lv === 'd' ? d.slice(0, 7) : d.slice(0, 4);
}
def('vwap', 'Volume Weighted Average Price (VWAP)', CAT[4], 'ov', {}, function(x){
  var o = fill(x.n, null), pv = 0, vv = 0, key = null;
  for(var i = 0; i < x.n; i++){
    var k = sessKey(x, i); if(k !== key){ key = k; pv = 0; vv = 0; }
    var tp = (x.H[i] + x.L[i] + x.C[i]) / 3, v = x.V[i] || 0;
    pv += tp * v; vv += v; o[i] = vv ? pv / vv : tp;
  }
  return { lines:[line(o, GOLD, 1.7)] };
}, GOLD);
def('avwap', 'Anchored VWAP', CAT[4], 'ov', {}, function(x){
  var o = fill(x.n, null), pv = 0, vv = 0;
  for(var i = 0; i < x.n; i++){
    if(x.T[i] < x.at) continue;
    var tp = (x.H[i] + x.L[i] + x.C[i]) / 3, v = x.V[i] || 0;
    pv += tp * v; vv += v; o[i] = vv ? pv / vv : tp;
  }
  return { lines:[line(o, C5, 1.7)], anchor:x.at };
}, C5);
def('obv', 'On Balance Volume (OBV)', CAT[4], 'pn', {}, function(x){
  return { lines:[line(cum(x.C.map(function(c, i){ return i ? (c > x.C[i - 1] ? x.V[i] : c < x.C[i - 1] ? -x.V[i] : 0) : 0; })), C1)] };
}, C1);
function adLine(x){ return cum(x.C.map(function(c, i){ var r = x.H[i] - x.L[i]; return r ? ((c - x.L[i]) - (x.H[i] - c)) / r * x.V[i] : 0; })); }
def('ad', 'Accumulation/Distribution', CAT[4], 'pn', {}, function(x){ return { lines:[line(adLine(x), C4)] }; }, C4);
def('cmf', 'Chaikin Money Flow (CMF)', CAT[4], 'pn', { len:20 }, function(x){
  var mfv = x.C.map(function(c, i){ var r = x.H[i] - x.L[i]; return r ? ((c - x.L[i]) - (x.H[i] - c)) / r * x.V[i] : 0; });
  return { lines:[line(map2(sumN(mfv, x.p.len), sumN(x.V, x.p.len), function(a, b){ return b ? a / b : 0; }), C4)], levels:[{ y:0, dash:'2 4' }] };
}, C4);
def('chaikinosc', 'Chaikin Oscillator', CAT[4], 'pn', { fast:3, slow:10 }, function(x){
  var ad = adLine(x);
  return { lines:[line(map2(ema(ad, x.p.fast), ema(ad, x.p.slow), function(a, b){ return a - b; }), C2)], levels:[{ y:0, dash:'2 4' }] };
}, C2);
def('volosc', 'Volume Oscillator', CAT[4], 'pn', { fast:5, slow:10 }, function(x){
  var f = ema(x.V, x.p.fast), s = ema(x.V, x.p.slow);
  return { hist:{ v:map2(f, s, function(a, b){ return b ? 100 * (a - b) / b : 0; }), up:UP, dn:DN }, levels:[{ y:0, dash:'2 4' }] };
}, C1);
def('force', "Elder's Force Index", CAT[4], 'pn', { len:13 }, function(x){
  return { lines:[line(ema(x.C.map(function(c, i){ return i ? (c - x.C[i - 1]) * x.V[i] : null; }), x.p.len), C3)], levels:[{ y:0, dash:'2 4' }] };
}, C3);
def('eom', 'Ease of Movement (EOM)', CAT[4], 'pn', { len:14, div:10000 }, function(x){
  var raw = x.C.map(function(_, i){
    if(!i) return null;
    var r = x.H[i] - x.L[i], box = x.V[i] / x.p.div / (r || 1e-9);
    return box ? ((x.H[i] + x.L[i]) / 2 - (x.H[i - 1] + x.L[i - 1]) / 2) / box : 0;
  });
  return { lines:[line(sma(raw, x.p.len), C4)], levels:[{ y:0, dash:'2 4' }] };
}, C4);
def('pvt', 'Price Volume Trend (PVT)', CAT[4], 'pn', {}, function(x){
  return { lines:[line(cum(x.C.map(function(c, i){ return i && x.C[i - 1] ? (c - x.C[i - 1]) / x.C[i - 1] * x.V[i] : 0; })), C5)] };
}, C5);
def('netvol', 'Net Volume', CAT[4], 'pn', {}, function(x){
  return { hist:{ v:x.C.map(function(c, i){ return i ? (c > x.C[i - 1] ? x.V[i] : c < x.C[i - 1] ? -x.V[i] : 0) : 0; }), up:UP, dn:DN }, levels:[{ y:0, dash:'2 4' }] };
}, C1);

/* ---- volume profile: drawn by profile(), the spec only says which kind */
def('vrvp', 'Visible Range Volume Profile (VRVP)', CAT[5], 'prof', { rows:24 }, function(){ return { prof:'vr' }; }, C1);
def('frvp', 'Fixed Range Volume Profile (FRVP)', CAT[5], 'prof', { rows:24 }, function(x){ return { prof:'fr', anchor:x.at }; }, C5);
def('svp', 'Session Volume Profile', CAT[5], 'prof', { rows:24 }, function(){ return { prof:'sess' }; }, C4);

/* ---- levels and patterns */
function periodKey(x, i){   // pivots come from the period before: yesterday on intraday bars, last week on daily, last month on weekly, last year on monthly
  var d = x.D[i];
  if(x.intra) return d;
  if(x.lv === 'd'){ var t = Date.parse(d + 'T00:00:00Z') / 864e5; return 'w' + Math.floor((t + 3) / 7); }
  if(x.lv === 'w') return d.slice(0, 7);
  return d.slice(0, 4);
}
function pivots(x, fib){
  var segs = [], groups = [], key = null;
  for(var i = 0; i < x.n; i++){
    var k = periodKey(x, i);
    if(k !== key){ key = k; groups.push({ from:i, to:i, h:x.H[i], l:x.L[i], c:x.C[i] }); }
    var g = groups[groups.length - 1]; g.to = i; g.h = Math.max(g.h, x.H[i]); g.l = Math.min(g.l, x.L[i]); g.c = x.C[i];
  }
  for(var j = 1; j < groups.length; j++){
    var pr = groups[j - 1], p = (pr.h + pr.l + pr.c) / 3, rg = pr.h - pr.l, lv;
    if(fib) lv = [['R3', p + rg], ['R2', p + .618 * rg], ['R1', p + .382 * rg], ['P', p], ['S1', p - .382 * rg], ['S2', p - .618 * rg], ['S3', p - rg]];
    else lv = [['R3', pr.h + 2 * (p - pr.l)], ['R2', p + rg], ['R1', 2 * p - pr.l], ['P', p], ['S1', 2 * p - pr.h], ['S2', p - rg], ['S3', pr.l - 2 * (pr.h - p)]];
    segs.push({ from:groups[j].from, to:groups[j].to, levels:lv.map(function(q){ return { label:q[0], y:q[1], col:q[0] === 'P' ? GOLD : q[0][0] === 'R' ? DN : UP }; }) });
  }
  return { segs:segs };
}
def('pivots', 'Pivot Points Standard', CAT[6], 'ov', {}, function(x){ return pivots(x, false); }, GOLD);
def('fibpivots', 'Fibonacci Pivot Points', CAT[6], 'ov', {}, function(x){ return pivots(x, true); }, GOLD);
def('fractals', 'Williams Fractals', CAT[6], 'ov', {}, function(x){
  var m = [];
  for(var i = 2; i < x.n - 2; i++){
    if(x.H[i] > x.H[i - 1] && x.H[i] > x.H[i - 2] && x.H[i] > x.H[i + 1] && x.H[i] > x.H[i + 2]) m.push({ i:i, y:x.H[i], up:false, col:DN });
    if(x.L[i] < x.L[i - 1] && x.L[i] < x.L[i - 2] && x.L[i] < x.L[i + 1] && x.L[i] < x.L[i + 2]) m.push({ i:i, y:x.L[i], up:true, col:UP });
  }
  return { marks:m };
}, C7);
def('hilo52', '52-Week High/Low', CAT[6], 'ov', {}, function(x){
  var hl = [];
  if(ok(x.hi52)) hl.push({ y:x.hi52, label:'52W High ' + fmt(x.hi52), col:UP });
  if(ok(x.lo52)) hl.push({ y:x.lo52, label:'52W Low ' + fmt(x.lo52), col:DN });
  return { hl:hl };
}, UP);

/* ---- statistics */
def('corr', 'Correlation Coefficient', CAT[7], 'pn', { len:20 }, function(x){
  var n = x.n, p = x.p.len, o = fill(n, null);
  if(!x.spy) return { lines:[line(o, C1)], levels:[{ y:0, dash:'2 4' }], range:[-1, 1], note:'vs SPY (loading)' };
  for(var i = p - 1; i < n; i++){
    var sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0, good = true;
    for(var j = i - p + 1; j <= i; j++){ var a = x.C[j], b = x.spy[j]; if(!ok(a) || !ok(b)){ good = false; break; } sx += a; sy += b; sxy += a * b; sxx += a * a; syy += b * b; }
    if(!good) continue;
    var den = Math.sqrt((p * sxx - sx * sx) * (p * syy - sy * sy));
    o[i] = den ? (p * sxy - sx * sy) / den : null;
  }
  return { lines:[line(o, C1)], levels:[{ y:0, dash:'2 4' }], range:[-1, 1], note:'vs SPY' };
}, C1);

IND.defs = defs; IND.byId = byId; IND.cats = CAT;
IND.top10 = ['sma', 'ema', 'rsi', 'macd', 'bb', 'vol', 'vwap', 'stochrsi', 'atr', 'supertrend'];
IND.lib = { sma:sma, ema:ema, rma:rma, wma:wma, stdev:stdev, highest:highest, lowest:lowest, rsiOf:rsiOf, atrOf:atrOf, linreg:linreg };

/* rows: [{t, d, o, h, l, c, v}] -> everything an indicator needs */
IND.context = function(rows, extra, p){
  var x = { r:rows, n:rows.length, p:p };
  x.O = rows.map(function(r){ return r.o; }); x.H = rows.map(function(r){ return r.h; }); x.L = rows.map(function(r){ return r.l; });
  x.C = rows.map(function(r){ return r.c; }); x.V = rows.map(function(r){ return r.v || 0; }); x.T = rows.map(function(r){ return r.t; }); x.D = rows.map(function(r){ return r.d; });
  for(var k in extra) x[k] = extra[k];
  return x;
};
IND.defaults = function(id){ var d = byId[id]; return d ? JSON.parse(JSON.stringify(d.p)) : {}; };
IND.compute = function(id, rows, p, extra){
  var d = byId[id]; if(!d || !rows.length) return {};
  var x = IND.context(rows, extra || {}, Object.assign({}, d.p, p || {}));
  return d.f(x);
};
IND.label = function(id, p){
  var d = byId[id], vals = Object.keys(d.p).map(function(k){ return (p && p[k] != null ? p[k] : d.p[k]); });
  return d.short + (vals.length ? ' ' + vals.join(', ') : '');
};

/* ------------------------------------------------------------------ drawing */
function fmt(v){
  if(!ok(v)) return '';
  var a = Math.abs(v);
  if(Number.isInteger(v) && a < 1e4) return String(v);
  if(a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
  if(a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if(a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if(a >= 1e4) return (v / 1e3).toFixed(1) + 'K';
  return a >= 100 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(4);
}
IND.fmt = fmt;
function pathOf(v, g, i0, i1, X, Y){
  var d = '', on = false, hi = Math.min(v.length - 1, i1);
  for(var i = Math.max(0, i0); i <= hi; i++){
    if(!ok(v[i])){ on = false; continue; }
    d += (on ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v[i]).toFixed(1); on = true;
  }
  return d;
}
function fillPath(a, b, i0, i1, X, Y){   // area between two lines
  var up = [], dn = [], hi = Math.min(a.length - 1, b.length - 1, i1);
  for(var i = Math.max(0, i0); i <= hi; i++) if(ok(a[i]) && ok(b[i])){ up.push(X(i).toFixed(1) + ' ' + Y(a[i]).toFixed(1)); dn.push(X(i).toFixed(1) + ' ' + Y(b[i]).toFixed(1)); }
  return up.length > 1 ? 'M' + up.join('L') + 'L' + dn.reverse().join('L') + 'Z' : '';
}
function splitFill(sp, a, b, i0, i1, X, Y){   // the cloud: one colour where a is above b, the other where it is below
  var out = '', hi = Math.min(a.length - 1, b.length - 1, i1), up = '', dn = '';
  for(var i = Math.max(1, i0); i <= hi; i++){
    if(![a[i], b[i], a[i - 1], b[i - 1]].every(ok)) continue;
    var q = 'M' + X(i - 1).toFixed(1) + ' ' + Y(a[i - 1]).toFixed(1) + 'L' + X(i).toFixed(1) + ' ' + Y(a[i]).toFixed(1) + 'L' + X(i).toFixed(1) + ' ' + Y(b[i]).toFixed(1) + 'L' + X(i - 1).toFixed(1) + ' ' + Y(b[i - 1]).toFixed(1) + 'Z';
    if(a[i] + a[i - 1] >= b[i] + b[i - 1]) up += q; else dn += q;
  }
  if(up) out += '<path d="' + up + '" fill="' + sp.up + '" opacity="' + sp.op + '"/>';
  if(dn) out += '<path d="' + dn + '" fill="' + sp.dn + '" opacity="' + sp.op + '"/>';
  return out;
}
function marksSvg(marks, i0, i1, X, Y){
  var s = '';
  marks.forEach(function(m){
    if(m.i < i0 - 1 || m.i > i1 + 1) return;
    var x = X(m.i), y = Y(m.y) + (m.up ? 9 : -9);
    s += '<path d="' + (m.up ? 'M' + x.toFixed(1) + ' ' + (y - 4).toFixed(1) + 'l4.5 8h-9z' : 'M' + x.toFixed(1) + ' ' + (y + 4).toFixed(1) + 'l4.5 -8h-9z') + '" fill="' + m.col + '"/>';
  });
  return s;
}

/* Everything an overlay spec adds to the price range: the line values on screen. */
IND.reach = function(spec, a, b, see){
  (spec.lines || []).forEach(function(l){ for(var i = Math.max(0, a); i <= Math.min(l.v.length - 1, b); i++) see(l.v[i]); });
  (spec.dots || []).forEach(function(l){ for(var i = Math.max(0, a); i <= Math.min(l.v.length - 1, b); i++) see(l.v[i]); });
  (spec.poly || []).forEach(function(pl){ pl.pts.forEach(function(q){ if(q[0] >= a && q[0] <= b) see(q[1]); }); });
};

/* An overlay on the price chart. g: { X, Y, i0, i1, padL, plotW, padT, plotH, lo, hi }. Returns SVG. */
IND.overlay = function(spec, g){
  var s = '', a = Math.max(0, Math.floor(g.i0) - 1), b = Math.ceil(g.i1) + 1;
  (spec.fills || []).forEach(function(f){
    var la = spec.lines[f.a].v, lb = spec.lines[f.b].v;
    if(f.split) s += splitFill(f, la, lb, a, b, g.X, g.Y);
    else { var d = fillPath(la, lb, a, b, g.X, g.Y); if(d) s += '<path d="' + d + '" fill="' + f.col + '" opacity="' + f.op + '"/>'; }
  });
  (spec.lines || []).forEach(function(l){
    var d = pathOf(l.v, g, a, b, g.X, g.Y);
    if(d) s += '<path d="' + d + '" fill="none" stroke="' + l.col + '" stroke-width="' + l.w + '" stroke-linejoin="round"' + (l.dash ? ' stroke-dasharray="' + l.dash + '"' : '') + '/>';
  });
  (spec.dots || []).forEach(function(l){
    for(var i = a; i <= Math.min(l.v.length - 1, b); i++) if(ok(l.v[i])) s += '<circle cx="' + g.X(i).toFixed(1) + '" cy="' + g.Y(l.v[i]).toFixed(1) + '" r="2" fill="' + l.col + '"/>';
  });
  (spec.poly || []).forEach(function(pl){
    var d = ''; pl.pts.forEach(function(q, k){ d += (k ? 'L' : 'M') + g.X(q[0]).toFixed(1) + ' ' + g.Y(q[1]).toFixed(1); });
    if(d) s += '<path d="' + d + '" fill="none" stroke="' + pl.col + '" stroke-width="' + pl.w + '" stroke-linejoin="round"/>';
  });
  (spec.segs || []).forEach(function(sg, k, all){
    if(sg.to < a || sg.from > b) return;
    var x0 = g.X(sg.from - .5), x1 = g.X(sg.to + .5);
    sg.levels.forEach(function(lv){
      if(lv.y < g.lo || lv.y > g.hi) return;
      var y = g.Y(lv.y).toFixed(1);
      s += '<line x1="' + x0.toFixed(1) + '" x2="' + x1.toFixed(1) + '" y1="' + y + '" y2="' + y + '" stroke="' + lv.col + '" stroke-width="1.1" stroke-dasharray="5 3"/>';
      if(k === all.length - 1 || sg.to >= b) s += '<text class="ch-hl-t" x="' + (x1 - 4).toFixed(1) + '" y="' + (g.Y(lv.y) - 3).toFixed(1) + '" text-anchor="end" style="fill:' + lv.col + '">' + lv.label + ' ' + fmt(lv.y) + '</text>';
    });
  });
  (spec.hl || []).forEach(function(h){
    if(h.y < g.lo || h.y > g.hi) return;
    var y = g.Y(h.y).toFixed(1);
    s += '<line x1="' + g.padL + '" x2="' + (g.padL + g.plotW) + '" y1="' + y + '" y2="' + y + '" stroke="' + h.col + '" stroke-width="1.2" stroke-dasharray="7 4"/>' +
      '<text class="ch-hl-t" x="' + (g.padL + 8) + '" y="' + (g.Y(h.y) - 4).toFixed(1) + '" style="fill:' + h.col + '">' + h.label + '</text>';
  });
  if(spec.marks) s += marksSvg(spec.marks, a, b, g.X, g.Y);
  if(spec.anchor != null && g.rows){   // a thin tick where the anchor sits
    for(var i = 0; i < g.rows.length; i++) if(g.rows[i].t >= spec.anchor){ if(i >= a && i <= b) s += '<line x1="' + g.X(i).toFixed(1) + '" x2="' + g.X(i).toFixed(1) + '" y1="' + g.padT + '" y2="' + (g.padT + g.plotH) + '" stroke="' + (spec.lines[0] ? spec.lines[0].col : C5) + '" stroke-width="1" stroke-dasharray="2 3" opacity=".6"/>'; break; }
  }
  return s;
};

/* Volume profile: volume traded at each price, as horizontal bars. */
function bins(rows, from, to, nb){
  var lo = Infinity, hi = -Infinity, i;
  for(i = from; i <= to; i++){ if(rows[i].l < lo) lo = rows[i].l; if(rows[i].h > hi) hi = rows[i].h; }
  if(!isFinite(lo) || hi <= lo) return null;
  var step = (hi - lo) / nb, v = fill(nb, 0);
  for(i = from; i <= to; i++){
    var r = rows[i], k0 = Math.min(nb - 1, Math.floor((r.l - lo) / step)), k1 = Math.min(nb - 1, Math.floor((r.h - lo) / step)), share = (r.v || 0) / (k1 - k0 + 1);
    for(var k = k0; k <= k1; k++) v[k] += share;
  }
  return { lo:lo, step:step, v:v };
}
IND.bins = bins;
function profileSvg(bn, g, x0, maxW, dir, col){   // dir 1 grows right from x0, -1 grows left
  var mx = Math.max.apply(null, bn.v), poc = bn.v.indexOf(mx), tot = bn.v.reduce(function(a, c){ return a + c; }, 0), s = '';
  if(!mx) return '';
  var inVA = fill(bn.v.length, false), acc = bn.v[poc], lo = poc, hi = poc; inVA[poc] = true;
  while(acc < tot * .7 && (lo > 0 || hi < bn.v.length - 1)){   // the value area: the 70% of volume around the busiest price
    var dn = lo > 0 ? bn.v[lo - 1] : -1, up = hi < bn.v.length - 1 ? bn.v[hi + 1] : -1;
    if(up >= dn){ hi++; acc += bn.v[hi]; inVA[hi] = true; } else { lo--; acc += bn.v[lo]; inVA[lo] = true; }
  }
  bn.v.forEach(function(v, k){
    var yTop = g.Y(bn.lo + (k + 1) * bn.step), yBot = g.Y(bn.lo + k * bn.step), w = v / mx * maxW;
    if(w < .5) return;
    s += '<rect x="' + (dir > 0 ? x0 : x0 - w).toFixed(1) + '" y="' + yTop.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, yBot - yTop - 1).toFixed(1) + '" fill="' + (k === poc ? GOLD : col) + '" opacity="' + (k === poc ? .8 : inVA[k] ? .42 : .22) + '"/>';
  });
  var py = g.Y(bn.lo + (poc + .5) * bn.step).toFixed(1);
  return s + '<line x1="' + g.padL + '" x2="' + (g.padL + g.plotW) + '" y1="' + py + '" y2="' + py + '" stroke="' + GOLD + '" stroke-width="1" stroke-dasharray="3 3" opacity=".7"/>';
}
IND.profile = function(spec, g, d, p, extra){
  var rows = g.rows, nb = (p && p.rows) || 24, a = Math.max(0, Math.ceil(g.i0)), b = Math.min(rows.length - 1, Math.floor(g.i1)), col = d.col, s = '';
  if(b <= a) return '';
  if(spec.prof === 'vr'){ var bn = bins(rows, a, b, nb); if(bn) s += profileSvg(bn, g, g.padL + g.plotW, g.plotW * .3, -1, col); }
  else if(spec.prof === 'fr'){
    var f = 0; while(f < rows.length && rows[f].t < spec.anchor) f++;
    if(f < rows.length - 1){ var bn2 = bins(rows, f, rows.length - 1, nb); if(bn2) s += profileSvg(bn2, g, Math.max(g.padL, g.X(f)), g.plotW * .3, 1, col); }
  } else {
    var from = 0, key = null;
    for(var i = 0; i <= rows.length; i++){
      var k = i < rows.length ? (extra.key(i)) : null;
      if(k !== key){
        if(key !== null && i - 1 >= from && i - 1 >= a && from <= b && i - from > 1){
          var bn3 = bins(rows, from, i - 1, nb), w = Math.max(18, (g.X(i - 1) - g.X(from)) * .9);
          if(bn3) s += profileSvg(bn3, g, g.X(from), w, 1, col);
        }
        key = k; from = i;
      }
    }
  }
  return s;
};

/* An oscillator pane. g: { W, H, padL, plotW, padT, plotH, X, i0, i1, n }. Returns { svg, head } where head is the value read-out. */
function niceTicks(lo, hi){
  var span = hi - lo || 1, raw = span / 3, mag = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / mag, step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * mag, out = [];
  for(var t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(t);
  return out;
}
IND.pane = function(spec, g){
  var a = Math.max(0, Math.floor(g.i0) - 1), b = Math.min(g.n - 1, Math.ceil(g.i1)), lo = Infinity, hi = -Infinity;
  var see = function(v){ if(ok(v)){ if(v < lo) lo = v; if(v > hi) hi = v; } };
  (spec.lines || []).forEach(function(l){ for(var i = a; i <= Math.min(b, l.v.length - 1); i++) see(l.v[i]); });
  if(spec.hist){ see(0); for(var i = a; i <= b; i++) see(spec.hist.v[i]); }
  if(spec.range){ lo = spec.range[0]; hi = spec.range[1]; }
  else (spec.levels || []).forEach(function(l){ if(isFinite(lo) && l.y >= lo - (hi - lo) * .5 && l.y <= hi + (hi - lo) * .5) see(l.y); });
  if(!isFinite(lo)){ lo = 0; hi = 1; }
  if(hi === lo){ hi += 1; lo -= 1; }
  var pad = spec.range ? 0 : (hi - lo) * .1; lo -= pad; hi += pad;
  var Y = function(v){ return g.padT + g.plotH - (v - lo) / (hi - lo) * g.plotH; }, s = '', right = g.padL + g.plotW + 8;
  niceTicks(lo, hi).forEach(function(t){
    s += '<line class="gridline" x1="' + g.padL + '" x2="' + (g.padL + g.plotW) + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '"/>' +
      '<text class="axis" x="' + right + '" y="' + (Y(t) + 4).toFixed(1) + '">' + fmt(t) + '</text>';
  });
  if(spec.band) s += '<rect x="' + g.padL + '" y="' + Y(spec.band[1]).toFixed(1) + '" width="' + g.plotW + '" height="' + Math.abs(Y(spec.band[0]) - Y(spec.band[1])).toFixed(1) + '" fill="' + C5 + '" opacity=".06"/>';
  (spec.levels || []).forEach(function(l){
    if(l.y < lo || l.y > hi) return;
    s += '<line x1="' + g.padL + '" x2="' + (g.padL + g.plotW) + '" y1="' + Y(l.y).toFixed(1) + '" y2="' + Y(l.y).toFixed(1) + '" stroke="var(--fh-foreground-on-surface-de-emphasis)" stroke-width="1" stroke-dasharray="' + l.dash + '" opacity="' + (l.faint ? .4 : .7) + '"/>';
  });
  s += '<g clip-path="url(#' + g.clip + ')">';
  if(spec.hist){
    var bw = Math.max(1, Math.min(g.plotW / (g.i1 - g.i0) * .7, 14)), y0 = Y(0), d1 = '', d2 = '', d3 = '', d4 = '', v = spec.hist.v;
    for(var j = a; j <= b; j++){
      if(!ok(v[j])) continue;
      var y = Y(v[j]), rect = 'M' + (g.X(j) - bw / 2).toFixed(1) + ' ' + y0.toFixed(1) + 'V' + y.toFixed(1) + 'h' + bw.toFixed(1) + 'V' + y0.toFixed(1) + 'Z';
      var rising = spec.hist.byChange ? (j && ok(v[j - 1]) ? v[j] >= v[j - 1] : v[j] >= 0) : v[j] >= 0;
      if(rising) d1 += rect; else d2 += rect;
    }
    if(d1) s += '<path d="' + d1 + '" fill="' + spec.hist.up + '" opacity=".75"/>';
    if(d2) s += '<path d="' + d2 + '" fill="' + spec.hist.dn + '" opacity=".75"/>';
  }
  (spec.lines || []).forEach(function(l){
    var d = pathOf(l.v, g, a, b, g.X, Y);
    if(d) s += '<path d="' + d + '" fill="none" stroke="' + l.col + '" stroke-width="' + l.w + '" stroke-linejoin="round"/>';
  });
  s += '</g>';
  var head = [], at = Math.min(b, g.n - 1);
  (spec.lines || []).forEach(function(l){ if(ok(l.v[at])) head.push({ t:fmt(l.v[at]), col:l.col }); });
  if(spec.hist && ok(spec.hist.v[at])) head.unshift({ t:fmt(spec.hist.v[at]), col:spec.hist.v[at] >= 0 ? spec.hist.up : spec.hist.dn });
  return { svg:s, head:head };
};

if(typeof module !== 'undefined' && module.exports) module.exports = IND;
root.IND = IND;
})(typeof window !== 'undefined' ? window : globalThis);
