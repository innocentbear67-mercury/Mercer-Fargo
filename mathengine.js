/* MercerFargo math engine: every number Marvell derives (changes, ratios, growth, valuation, risk, money, options,
   projections) is computed here, so the model reasons and writes while the arithmetic is exact and repeatable.
     ME.run(fn, args, env)   one calculation; env supplies live data in the browser ({ history, portfolio, fx })
     ME.batch(items, env)    many at once; an arg "$id.field" uses an earlier item's result (no retyping numbers)
     ME.fix(text)            recomputes "a × b = c" and "from $X to $Y (+Z%)" claims in an answer and corrects them
     ME.untraced(text, src)  computed-looking figures in an answer that appear in none of the source texts
   Conventions: rates and returns are in percent (8 = 8%); a price series is an array of numbers or
   { history:"NVDA", range:"1Y" }, which the engine fetches itself (full daily closes). */
(function(root){
'use strict';
var ME = {};
var DAY = 252;

/* ------------------------------------------------------------------ helpers */
function bad(msg){ throw new Error(msg); }
var SCALE = { k:1e3, thousand:1e3, m:1e6, mm:1e6, million:1e6, b:1e9, bn:1e9, billion:1e9, t:1e12, tn:1e12, trillion:1e12 };
function num(v, name, opt){
  if(Array.isArray(v)) v = v[v.length - 1];   // a series where a number is wanted: its latest value
  if(v == null || v === ''){ if(opt !== undefined) return opt; bad(name + ' is required'); }
  var n = v;
  if(typeof v !== 'number'){   // "$2.5B", "1,234.5", "5%": the unit is applied or the text is refused, never half-read
    var m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s?(%|[a-z]+)?$/i.exec(String(v).trim().replace(/^([+-]?)\s?[$€£¥]\s?/, '$1').replace(/,/g, '').replace(/[−–]/g, '-'));
    if(!m || (m[2] && m[2] !== '%' && !SCALE[m[2].toLowerCase()])) bad(name + ' must be a number');
    n = parseFloat(m[1]) * (m[2] && m[2] !== '%' ? SCALE[m[2].toLowerCase()] : 1);
  }
  if(typeof n !== 'number' || !isFinite(n)) bad(name + ' must be a number');
  return n;
}
function list(v, name, min){   // a list argument: say so plainly instead of failing inside .map
  if(!Array.isArray(v) || v.length < (min || 1)) bad(name + ' must be a list' + (min > 1 ? ' of at least ' + min : '') + ' (see the signature)');
  return v;
}
function arr(v, name, min){
  if(!Array.isArray(v)) bad(name + ' must be a list of numbers');
  var a = v.map(function(x, i){ return num(x, name + '[' + i + ']'); });
  if(a.length < (min || 1)) bad(name + ' needs at least ' + (min || 1) + ' values');
  if(v.dates) a.dates = v.dates;
  return a;
}
function rd(v){   // 7 significant digits for big numbers, 6 decimals otherwise: no float noise, nothing that matters lost
  if(typeof v !== 'number') return v;
  return Math.abs(v) >= 1e5 ? +v.toPrecision(7) : Math.round(v * 1e6) / 1e6;
}
var NONFINITE = { nonfinite:1 };
function clean(o){
  if(Array.isArray(o)) return o.map(clean);
  if(o && typeof o === 'object'){ var r = {}; Object.keys(o).forEach(function(k){ if(o[k] !== undefined) r[k] = clean(o[k]); }); return r; }
  if(typeof o === 'number' && !isFinite(o)) throw NONFINITE;
  return rd(o);
}
function where(o, at){   // path of the first NaN / Infinity, found only when there is one to report
  if(typeof o === 'number') return isFinite(o) ? null : at;
  if(o && typeof o === 'object'){ var ks = Object.keys(o); for(var i = 0; i < ks.length; i++){ var w = where(o[ks[i]], (at ? at + (Array.isArray(o) ? '[' + ks[i] + ']' : '.' + ks[i]) : ks[i])); if(w) return w; } }
  return null;
}
function finish(r){
  try { return clean(r); } catch(e){ if(e === NONFINITE) bad('these inputs give no valid answer (' + (where(r) || 'result') + ' came out as not a number or infinite): check for zeros, negatives or out-of-range values'); throw e; }
}
function sum(a){ var s = 0; for(var i = 0; i < a.length; i++) s += a[i]; return s; }
function mean(a){ return a.length ? sum(a) / a.length : 0; }
function sd(a){ var m = mean(a), s = 0; for(var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return a.length > 1 ? Math.sqrt(s / (a.length - 1)) : 0; }
function sorted(a){ return Float64Array.from(a).sort(); }
function qAt(x, q){ var i = (x.length - 1) * q, lo = Math.floor(i); return x[lo] + (x[Math.min(lo + 1, x.length - 1)] - x[lo]) * (i - lo); }
function quant(a, q){ return qAt(sorted(a), q); }
function hi(a){ var m = -Infinity; for(var i = 0; i < a.length; i++) if(a[i] > m) m = a[i]; return m; }
function lo(a){ var m = Infinity; for(var i = 0; i < a.length; i++) if(a[i] < m) m = a[i]; return m; }
/* Observations per calendar year, read from the dates: daily stocks ~252, crypto ~365, weekly 52, monthly 12.
   History for 5Y / MAX comes back weekly / monthly, so a fixed 252 would overstate volatility and CAGR several times over. */
function span(d){ return (Date.parse(d[d.length - 1]) - Date.parse(d[0])) / 864e5 / 365.25; }
function perYear(d){
  if(!d || d.length < 3 || !(span(d) > 0.05)) return DAY;
  var n = (d.length - 1) / span(d), s = [365, 252, 52, 12, 4, 1].filter(function(c){ return Math.abs(n - c) / c < 0.07; })[0];
  return s || Math.max(1, Math.round(n));
}
function cov(a, b){ var ma = mean(a), mb = mean(b), s = 0; for(var i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb); return a.length > 1 ? s / (a.length - 1) : 0; }
function corr(a, b){ var d = sd(a) * sd(b); return d ? cov(a, b) / d : 0; }
function rets(p){ var o = []; for(var i = 1; i < p.length; i++) o.push(p[i - 1] ? p[i] / p[i - 1] - 1 : 0); return o; }
/* Two dated series on their common dates (undated ones by their last n values). */
function align(a, b){
  if(a.dates && b.dates){
    var m = {}; b.dates.forEach(function(d, i){ m[d] = b[i]; });
    var x = [], y = [], ds = []; a.dates.forEach(function(d, i){ if(m[d] != null){ x.push(a[i]); y.push(m[d]); ds.push(d); } });
    x.dates = ds; return [x, y];
  }
  var n = Math.min(a.length, b.length); return [a.slice(-n), b.slice(-n)];
}
/* Bisection: f must change sign between lo and hi. */
function solve(f, lo, hi, what){
  var flo = f(lo), fhi = f(hi);
  if(!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) bad('no ' + what + ' between ' + lo + ' and ' + hi + ' fits these inputs');
  for(var i = 0; i < 200; i++){ var mid = (lo + hi) / 2, fm = f(mid); if(fm === 0 || hi - lo < 1e-12) return mid; if(fm * flo < 0){ hi = mid; } else { lo = mid; flo = fm; } }
  return (lo + hi) / 2;
}
function ncdf(x){   // standard normal CDF, double precision (Hart 1968, as in West 2005)
  var a = Math.abs(x), c;
  if(a > 37) c = 0;
  else {
    var e = Math.exp(-a * a / 2), b;
    if(a < 7.07106781186547){
      b = 3.52624965998911e-2 * a + 0.700383064443688; b = b * a + 6.37396220353165; b = b * a + 33.912866078383; b = b * a + 112.079291497871; b = b * a + 221.213596169931; b = b * a + 220.206867912376;
      c = e * b;
      b = 8.83883476483184e-2 * a + 1.75566716318264; b = b * a + 16.064177579207; b = b * a + 86.7807322029461; b = b * a + 296.564248779674; b = b * a + 637.333633378831; b = b * a + 793.826512519948; b = b * a + 440.413735824752;
      c = c / b;
    } else { b = a + 1 / (a + 2 / (a + 3 / (a + 4 / (a + 0.65)))); c = e / (b * 2.506628274631); }
  }
  return x > 0 ? 1 - c : c;
}
function npdf(x){ return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI); }
function ninv(p){   // inverse normal CDF (Acklam), for parametric VaR
  var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239],
      b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572],
      c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783],
      d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416], q, r;
  if(p < 0.02425){ q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if(p > 1 - 0.02425){ q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/* ------------------------------------------------------------------ expressions: a small parser, no eval */
var FN1 = { sqrt:Math.sqrt, ln:Math.log, log:Math.log10, log10:Math.log10, exp:Math.exp, abs:Math.abs, floor:Math.floor, ceil:Math.ceil };
var FNN = { min:Math.min, max:Math.max, pow:Math.pow, round:function(x, d){ var p = Math.pow(10, d || 0); return Math.round(x * p) / p; }, avg:function(){ return mean([].slice.call(arguments)); }, sum:function(){ return sum([].slice.call(arguments)); } };
ME.evaluate = function(src, vars){
  vars = vars || {};
  var s = String(src).replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-'), i = 0;
  function ws(){ while(s[i] === ' ' || s[i] === '\t' || s[i] === '$') i++; }
  function peek(c){ ws(); return s[i] === c; }
  function eat(c){ if(peek(c)){ i++; return true; } return false; }
  function expr(){ var v = term(); for(;;){ if(eat('+')) v += term(); else if(eat('-')) v -= term(); else return v; } }
  function term(){ var v = unary(); for(;;){ if(eat('*')) v *= unary(); else if(eat('/')) v /= unary(); else return v; } }
  function unary(){ if(eat('-')) return -unary(); if(eat('+')) return unary(); return power(); }
  function power(){ var b = atom(); if(eat('^') || (s[i] === '*' && s[i + 1] === '*' && (i += 2))) return Math.pow(b, unary()); return b; }   // right-assoc
  function atom(){
    ws(); var v, m;
    if(eat('(')){ v = expr(); if(!eat(')')) bad('missing )'); }
    else if((m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i)))){ i += m[0].length; v = parseFloat(m[0]); }
    else if((m = /^[a-z_][a-z0-9_]*/i.exec(s.slice(i)))){
      var id = m[0]; i += id.length; var k = id.toLowerCase();
      if(eat('(')){
        var args = []; if(!eat(')')){ do args.push(expr()); while(eat(',')); if(!eat(')')) bad('missing ) after ' + id); }
        if(FN1[k]) v = FN1[k](args[0]); else if(FNN[k]) v = FNN[k].apply(null, args); else bad('unknown function ' + id);
      } else if(k === 'pi') v = Math.PI; else if(k === 'e') v = Math.E;
      else if(vars[id] != null) v = num(vars[id], id); else bad('unknown name ' + id);
    } else bad('unexpected "' + (s[i] || 'end') + '"');
    ws(); if(s[i] === '%'){ i++; v /= 100; }   // 15% -> 0.15
    return v;
  }
  var v = expr(); ws(); if(i < s.length) bad('unexpected "' + s[i] + '"');
  if(typeof v !== 'number' || !isFinite(v)) bad('result is not a finite number (division by zero?)');
  return v;
};

/* ------------------------------------------------------------------ risk on returns */
function riskOf(p, o){
  o = o || {};
  var per = num(o.per_year, 'per_year', perYear(p.dates)), rf = num(o.rf_pct, 'rf_pct', 0) / 100, r = rets(p);
  if(r.length < 2) bad('need at least 3 prices');
  var yrs = p.dates && !o.per_year && span(p.dates) > 0 ? span(p.dates) : r.length / per, cagr = Math.pow(p[p.length - 1] / p[0], 1 / yrs) - 1, vol = sd(r) * Math.sqrt(per);
  var dn = Math.sqrt(mean(r.map(function(x){ return x < 0 ? x * x : 0; }))) * Math.sqrt(per);
  var pk = p[0], mdd = 0, cur = 0, longest = 0, peakAt = 0, troughAt = 0, mddPeak = 0;
  p.forEach(function(v, k){ if(v >= pk){ pk = v; peakAt = k; cur = 0; } else cur++; longest = Math.max(longest, cur); var d = v / pk - 1; if(d < mdd){ mdd = d; troughAt = k; mddPeak = peakAt; } });
  var exc = mean(r) * per - rf;
  var out = { periods:r.length, periodsPerYear:per, years:yrs, totalReturnPct:(p[p.length - 1] / p[0] - 1) * 100, cagrPct:cagr * 100, volatilityPct:vol * 100,
    sharpe:vol ? exc / vol : 0, sortino:dn ? exc / dn : 0, maxDrawdownPct:mdd * 100, calmar:mdd ? cagr / -mdd : 0, longestDrawdownPeriods:longest,
    bestPeriodPct:hi(r) * 100, worstPeriodPct:lo(r) * 100, upPeriodsPct:r.filter(function(x){ return x > 0; }).length / r.length * 100 };
  if(p.dates){ out.from = p.dates[0]; out.to = p.dates[p.dates.length - 1]; out.maxDrawdownPeak = p.dates[mddPeak]; out.maxDrawdownTrough = p.dates[troughAt]; }
  return out;
}

/* ------------------------------------------------------------------ Black-Scholes (Merton, continuous dividend yield) */
function bsCore(type, S, K, T, v, r, q){
  if(T <= 0 || v <= 0){ var iv = type === 'put' ? Math.max(K - S, 0) : Math.max(S - K, 0); return { price:iv, delta:type === 'put' ? (S < K ? -1 : 0) : (S > K ? 1 : 0), gamma:0, vega:0, theta:0, rho:0, d1:0, d2:0 }; }
  var st = v * Math.sqrt(T), d1 = (Math.log(S / K) + (r - q + v * v / 2) * T) / st, d2 = d1 - st, dq = Math.exp(-q * T), dr = Math.exp(-r * T), call = type !== 'put';
  var price = call ? S * dq * ncdf(d1) - K * dr * ncdf(d2) : K * dr * ncdf(-d2) - S * dq * ncdf(-d1);
  var theta = -S * dq * npdf(d1) * v / (2 * Math.sqrt(T)) + (call ? q * S * dq * ncdf(d1) - r * K * dr * ncdf(d2) : -q * S * dq * ncdf(-d1) + r * K * dr * ncdf(-d2));
  return { price:price, delta:call ? dq * ncdf(d1) : dq * (ncdf(d1) - 1), gamma:dq * npdf(d1) / (S * st), vega:S * dq * npdf(d1) * Math.sqrt(T), theta:theta,
    rho:call ? K * T * dr * ncdf(d2) : -K * T * dr * ncdf(-d2), d1:d1, d2:d2 };
}
function optArgs(a){
  var T = a.days != null ? num(a.days, 'days') / 365 : num(a.years, 'years (or days)');
  var type = String(a.type || 'call').toLowerCase(); if(type !== 'call' && type !== 'put') bad('type must be call or put');
  return { type:type, S:num(a.spot, 'spot'), K:num(a.strike, 'strike'), T:T, r:num(a.rate_pct, 'rate_pct', 4) / 100, q:num(a.div_yield_pct, 'div_yield_pct', 0) / 100 };
}

/* ------------------------------------------------------------------ DCF core */
function dcfCore(fcf, g, r, tg, n, netDebt){
  if(!(r > tg)) bad('discount rate must exceed terminal growth');
  var f = fcf, pv = 0, flows = [];
  for(var t = 1; t <= n; t++){ f *= 1 + g; var d = f / Math.pow(1 + r, t); pv += d; flows.push({ year:t, fcf:f, pv:d }); }
  var tv = f * (1 + tg) / (r - tg), pvTv = tv / Math.pow(1 + r, n), ev = pv + pvTv;
  return { flows:flows, pv:pv, tv:tv, pvTv:pvTv, ev:ev, eq:ev - netDebt };
}
function dcfArgs(a){
  return { fcf:num(a.fcf, 'fcf'), g:num(a.growth_pct, 'growth_pct', 0) / 100, r:num(a.discount_pct, 'discount_pct') / 100, tg:num(a.terminal_growth_pct, 'terminal_growth_pct', 2.5) / 100,
    n:Math.max(1, Math.min(20, Math.round(num(a.years, 'years', 5)))), nd:num(a.net_debt, 'net_debt', 0), sh:a.shares == null ? null : num(a.shares, 'shares') };
}

/* ------------------------------------------------------------------ TVM: one period-rate core */
function tvmRate(a){ var py = num(a.per_year, 'per_year', 1); return { i:num(a.rate_pct, 'rate_pct') / 100 / py, n:num(a.years, 'years') * py, py:py }; }
function fvOf(pv, pmt, i, n, due){ var g = Math.pow(1 + i, n); return pv * g + (i ? pmt * (g - 1) / i : pmt * n) * (due ? 1 + i : 1); }
var GRID = [-0.999999999, -0.9999999, -0.9999, -0.999, -0.99, -0.95, -0.9, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, -0.1, -0.05, -0.02, -0.01, 0, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 30, 100, 1e3, 1e4, 1e5, 1e6, 1e8];
function roots(f, what){   // every rate where f changes sign: sensible ones (above -50%) first, nearest to 0% first
  var out = [], px = null, py = null;
  GRID.forEach(function(x){
    var y = f(x); if(!isFinite(y)){ px = null; return; }
    if(y === 0) out.push(x); else if(px !== null && py !== 0 && py * y < 0) out.push(solve(f, px, x, what));
    px = x; py = y;
  });
  if(!out.length) bad('no ' + what + ' exists for these cash flows');
  var rank = function(r){ return Math.abs(r) + (r < -0.5 ? 1e9 : 0); };
  return out.sort(function(u, w){ return rank(u) - rank(w); });
}
function npvOf(rate, cf){ var s = 0; for(var t = 0; t < cf.length; t++) s += cf[t] / Math.pow(1 + rate, t); return s; }
function irrOf(cf){
  if(!(cf.some(function(x){ return x < 0; }) && cf.some(function(x){ return x > 0; }))) bad('cash flows need at least one negative and one positive value');
  return roots(function(r){ return npvOf(r, cf); }, 'IRR');
}
function multi(rs){ return rs.length > 1 ? { otherRatesPct:rs.slice(1).map(function(r){ return r * 100; }), note:'The cash flows change sign more than once, so more than one rate solves it; this is the most plausible one (nearest 0%). Treat IRR with caution here.' } : {}; }

/* ------------------------------------------------------------------ the registry
   sig: argument list shown to the model (? = optional, defaults in brackets). run(args, env) -> object | Promise. */
var F = ME.fns = {};
function def(name, sig, run){ F[name] = { sig:sig, run:run }; }

/* core */
def('eval', 'expression, vars?{name:number}: arithmetic with + - * / ^ %, sqrt ln log exp abs min max pow round avg sum', function(a){
  return { result:ME.evaluate(a.expression, a.vars) };
});

/* change & growth */
def('pct_change', 'from, to', function(a){
  var x = num(a.from, 'from'), y = num(a.to, 'to'); if(!x) bad('from cannot be 0');
  return { changePct:(y / x - 1) * 100, difference:y - x, ratio:y / x };
});
def('cagr', 'start, end, years | series (prices), per_year?[read from the dates]', function(a){
  if(a.series){ var p = arr(a.series, 'series', 2), yrs = p.dates && !a.per_year && span(p.dates) > 0 ? span(p.dates) : (p.length - 1) / num(a.per_year, 'per_year', perYear(p.dates)); return { cagrPct:(Math.pow(p[p.length - 1] / p[0], 1 / yrs) - 1) * 100, totalReturnPct:(p[p.length - 1] / p[0] - 1) * 100, years:yrs }; }
  var s = num(a.start, 'start'), e = num(a.end, 'end'), y = num(a.years, 'years'); if(s <= 0 || y <= 0) bad('start and years must be positive');
  return { cagrPct:(Math.pow(e / s, 1 / y) - 1) * 100, totalReturnPct:(e / s - 1) * 100 };
});
def('annualize', 'return_pct, days|months|years (the period it was earned over)', function(a){
  var yrs = a.days != null ? num(a.days, 'days') / 365 : a.months != null ? num(a.months, 'months') / 12 : num(a.years, 'years');
  return { annualizedPct:(Math.pow(1 + num(a.return_pct, 'return_pct') / 100, 1 / yrs) - 1) * 100 };
});
def('growth', 'values (oldest first), labels?: period-over-period % changes, average, CAGR', function(a){
  var v = arr(a.values, 'values', 2), lb = a.labels || [], ch = [];
  for(var i = 1; i < v.length; i++) ch.push({ period:lb[i] != null ? lb[i] : i, value:v[i], changePct:v[i - 1] ? (v[i] / v[i - 1] - 1) * 100 : null });
  var ok = v[0] > 0 && v[v.length - 1] > 0;
  return { changes:ch, averageChangePct:mean(ch.filter(function(c){ return c.changePct != null; }).map(function(c){ return c.changePct; })), cagrPct:ok ? (Math.pow(v[v.length - 1] / v[0], 1 / (v.length - 1)) - 1) * 100 : null, totalChangePct:v[0] ? (v[v.length - 1] / v[0] - 1) * 100 : null };
});
def('margins', 'revenue, gross_profit?, operating_income?, ebitda?, net_income?, fcf?, rd?, sga?: each as % of revenue', function(a){
  var rev = num(a.revenue, 'revenue'), o = {}; if(!rev) bad('revenue cannot be 0');
  ['gross_profit', 'operating_income', 'ebitda', 'net_income', 'fcf', 'rd', 'sga'].forEach(function(k){ if(a[k] != null) o[k + 'MarginPct'] = num(a[k], k) / rev * 100; });
  return o;
});

/* stats */
def('stats', 'values: count, sum, mean, median, stdev (sample), min, max, percentiles', function(a){
  var v = arr(a.values, 'values'), x = sorted(v);
  return { count:v.length, sum:sum(v), mean:mean(v), median:qAt(x, .5), stdev:sd(v), min:x[0], max:x[x.length - 1], p5:qAt(x, .05), p25:qAt(x, .25), p75:qAt(x, .75), p95:qAt(x, .95) };
});
def('percentile', 'values, value? (its percentile rank) | p? (value at that percentile, 0-100)', function(a){
  var v = arr(a.values, 'values');
  if(a.value != null){ var x = num(a.value, 'value'); return { percentileRank:v.filter(function(y){ return y < x; }).length / v.length * 100 + v.filter(function(y){ return y === x; }).length / v.length * 50 }; }
  return { value:quant(v, num(a.p, 'p') / 100) };
});
def('zscore', 'value, values | mean+stdev', function(a){
  var x = num(a.value, 'value'), m = a.values ? mean(arr(a.values, 'values', 2)) : num(a.mean, 'mean'), s = a.values ? sd(arr(a.values, 'values', 2)) : num(a.stdev, 'stdev');
  if(!s) bad('stdev is 0'); return { z:(x - m) / s, mean:m, stdev:s };
});
def('linreg', 'y, x? [0..n-1]: slope, intercept, r2, and the fit at the last x', function(a){
  var y = arr(a.y, 'y', 2), x = a.x ? arr(a.x, 'x', 2) : y.map(function(_, i){ return i; });
  if(x.length !== y.length) bad('x and y need the same length');
  var vx = cov(x, x); if(!vx) bad('x has no spread');
  var b = cov(x, y) / vx, c = mean(y) - b * mean(x), r = corr(x, y), last = b * x[x.length - 1] + c;
  return { slope:b, intercept:c, r2:r * r, correlation:r, fitAtLast:last, slopePctOfLast:last ? b / last * 100 : null };
});
def('correlation', 'series:{name: prices}, returns?[true]: correlation matrix (of returns by default)', function(a){
  var names = Object.keys(a.series || {}); if(names.length < 2) bad('give at least 2 series');
  var s = names.map(function(n){ return arr(a.series[n], n, 3); }), m = {};
  names.forEach(function(n, i){ m[n] = {}; names.forEach(function(k, j){ var p = align(s[i], s[j]), x = a.returns === false ? p[0] : rets(p[0]), y = a.returns === false ? p[1] : rets(p[1]); m[n][k] = i === j ? 1 : corr(x, y); }); });
  return { matrix:m };
});

/* returns & risk */
def('risk', 'series (prices), benchmark? (prices), rf_pct?[0], per_year?[read from the dates]: return, CAGR, volatility, Sharpe, Sortino, max drawdown, Calmar, beta, alpha, correlation', function(a){
  var p = arr(a.series, 'series', 3), out;
  if(!a.benchmark) return riskOf(p, a);
  var al = align(p, arr(a.benchmark, 'benchmark', 3)), rs = rets(al[0]), rb = rets(al[1]), per = num(a.per_year, 'per_year', perYear(al[0].dates));
  out = riskOf(al[0], a); out.benchmark = riskOf(al[1], a);
  var vb = cov(rb, rb), beta = vb ? cov(rs, rb) / vb : 0;
  out.beta = beta; out.alphaPctPerYear = (mean(rs) - beta * mean(rb)) * per * 100; out.correlation = corr(rs, rb);
  out.excessReturnPct = out.totalReturnPct - out.benchmark.totalReturnPct;
  return out;
});
def('var', 'series (prices), confidence_pct?[95], horizon_days?[1], value? (position size, for amounts): historical and normal VaR / CVaR', function(a){
  var sr = arr(a.series, 'series', 30); if(perYear(sr.dates) < 150) bad('var works on daily prices: use a 1Y (or shorter) history range, not weekly or monthly');
  var r = rets(sr), c = num(a.confidence_pct, 'confidence_pct', 95) / 100, h = num(a.horizon_days, 'horizon_days', 1), val = a.value != null ? num(a.value, 'value') : null;
  var q = quant(r, 1 - c), tail = r.filter(function(x){ return x <= q; }), sc = Math.sqrt(h);
  var hv = -q * sc, hcv = -mean(tail) * sc, pv = -(mean(r) * h + ninv(1 - c) * sd(r) * sc);
  var o = { confidencePct:c * 100, horizonDays:h, historicalVarPct:hv * 100, historicalCvarPct:hcv * 100, normalVarPct:pv * 100, observations:r.length };
  if(val != null){ o.historicalVar = hv * val; o.historicalCvar = hcv * val; o.normalVar = pv * val; }
  return o;
});
def('position_size', 'account, risk_pct (of account), entry, stop: shares to buy so a stop-out loses risk_pct', function(a){
  var acct = num(a.account, 'account'), risk = acct * num(a.risk_pct, 'risk_pct') / 100, e = num(a.entry, 'entry'), s = num(a.stop, 'stop'), per = Math.abs(e - s);
  if(!per) bad('entry and stop cannot be equal');
  var sh = Math.floor(risk / per);
  return { shares:sh, positionValue:sh * e, positionPctOfAccount:sh * e / acct * 100, riskAmount:sh * per, riskPerShare:per, stopDistancePct:per / e * 100 };
});
def('kelly', 'win_rate_pct, win_loss_ratio (avg win / avg loss), fraction?[0.5] (of full Kelly to bet)', function(a){
  var p = num(a.win_rate_pct, 'win_rate_pct') / 100, b = num(a.win_loss_ratio, 'win_loss_ratio'); if(b <= 0) bad('win_loss_ratio must be positive');
  var k = p - (1 - p) / b, f = a.fraction != null ? num(a.fraction, 'fraction') : .5;
  if(f <= 0 || f > 1) bad('fraction must be above 0 and at most 1 (0.5 = half Kelly)');
  return { kellyPct:k * 100, halfKellyPct:k * 50, fraction:f, fractionalKellyPct:k * 100 * f, expectancyPerUnitRisked:p * b - (1 - p), note:k <= 0 ? 'No edge: Kelly says do not bet.' : undefined };
});
def('portfolio_vol', 'assets:[{symbol, weight}], range?[1Y]: annual volatility, each asset\'s share of risk, diversification', function(a, env){
  var as = list(a.assets, 'assets', 2);
  return Promise.all(as.map(function(x){ return getHist(env, x.symbol, a.range); })).then(function(ser){
    var w = as.map(function(x){ return num(x.weight, 'weight'); }), tw = sum(w); w = w.map(function(x){ return x / tw; });
    var base = ser[0], dates = ser.reduce(function(acc, s){ var m = {}; (s.dates || []).forEach(function(d){ m[d] = 1; }); return acc.filter(function(d){ return m[d]; }); }, base.dates || []);
    var R = ser.map(function(s){ var m = {}; s.dates.forEach(function(d, i){ m[d] = s[i]; }); return rets(dates.map(function(d){ return m[d]; })); });
    if(R[0].length < 20) bad('not enough shared history');
    var per = perYear(dates), C = R.map(function(x){ return R.map(function(y){ return cov(x, y) * per; }); }), pv = 0, mc = [];
    w.forEach(function(wi, i){ var row = 0; w.forEach(function(wj, j){ row += wj * C[i][j]; }); mc.push(wi * row); pv += wi * row; });
    var vol = Math.sqrt(pv), solo = sum(w.map(function(wi, i){ return wi * Math.sqrt(C[i][i]); }));
    return { volatilityPct:vol * 100, weightedAverageVolPct:solo * 100, diversificationBenefitPct:(solo - vol) * 100,
      assets:as.map(function(x, i){ return { symbol:x.symbol, weightPct:w[i] * 100, volatilityPct:Math.sqrt(C[i][i]) * 100, shareOfRiskPct:pv ? mc[i] / pv * 100 : 0 }; }), from:dates[0], to:dates[dates.length - 1] };
  });
});


/* risk quality, robustness, allocation and volatility (the Quant engine's batch-1 tools) */
function Q(){ var q = root.QN; if(!q || !q.riskStats) bad('the Quant engine is not loaded'); return q; }
function dailyOf(p, what){ if(perYear(p.dates) < 150) bad(what + ' works on daily prices: use a 1Y (or longer) daily history, not weekly or monthly'); return rets(p); }
def('risk_metrics', 'series (prices), benchmark? (prices), rf_pct?[0]: tail risk (historical and normal VaR, CVaR / expected shortfall at 95%), Omega, gain-to-pain, skew, kurtosis, and vs a benchmark: information ratio, tracking error, Treynor, Jensen alpha', function(a){
  var sr = arr(a.series, 'series', 60), rf = num(a.rf_pct, 'rf_pct', 0), b = null, r;
  if(a.benchmark){ var al = align(sr, arr(a.benchmark, 'benchmark', 60)); r = dailyOf(al[0], 'risk_metrics'); b = rets(al[1]); } else r = dailyOf(sr, 'risk_metrics');
  var o = Q().riskStats(r, b, rf); if(!o) bad('need at least 20 daily returns');
  return { observations:r.length, var95Pct:o.var95, cvar95Pct:o.cvar95, normalVar95Pct:o.varNormal95, worstDayPct:o.worstDay, skew:o.skew, kurtosis:o.kurt, omega:o.omega, gainToPain:o.gainToPain,
    trackingErrorPct:o.te, informationRatio:o.ir, treynorPct:o.treynor, jensenAlphaPctPerYear:o.jensen };
});
def('robustness', 'series (daily prices or a strategy equity curve), trials?[1] (how many variants you tried), trial_sharpe_stdev?[0.5] (spread of those Sharpes), split_pct?[70], rf_pct?[0]: Probabilistic and Deflated Sharpe, bootstrap range for Sharpe and CAGR, first-vs-last split', function(a){
  var sr = arr(a.series, 'series', 120), rf = num(a.rf_pct, 'rf_pct', 0), r = dailyOf(sr, 'robustness'), q = Q(), trials = num(a.trials, 'trials', 1), sp = num(a.split_pct, 'split_pct', 70) / 100;
  if(sp < .3 || sp > .9) bad('split_pct must be between 30 and 90');
  var boot = q.bootstrap(r, { rf:rf }), h = q.holdout(r, sp, rf);
  return { observations:r.length, probabilisticSharpe:q.psr(r, 0, rf), deflatedSharpe:trials > 1 ? q.dsr(r, trials, num(a.trial_sharpe_stdev, 'trial_sharpe_stdev', .5), rf) : undefined, trials:trials,
    sharpeRange5to95:boot && boot.sharpe, cagrRange5to95Pct:boot && boot.cagr, probSharpePositivePct:boot && boot.probSharpePositive, holdout:h, note:'Probabilistic Sharpe = chance the true Sharpe is above 0. Deflated Sharpe also charges for the number of variants tried.' };
});
function commonRets(ser){
  var dates = ser.reduce(function(acc, s){ var m = {}; (s.dates || []).forEach(function(d){ m[d] = 1; }); return acc.filter(function(d){ return m[d]; }); }, ser[0].dates || []);
  return { dates:dates, R:ser.map(function(s){ var m = {}; s.dates.forEach(function(d, i){ m[d] = s[i]; }); return rets(dates.map(function(d){ return m[d]; })); }) };
}
def('allocate', 'assets:[symbols or {symbol}], method? (equal | inverse_vol | risk_parity | min_variance | max_sharpe | hrp | momentum)[risk_parity], range?[5Y] (1Y, 5Y or MAX), lookback_days?[252], max_weight_pct? (cap per asset), top_n?, skip_days?[21] (momentum only), rf_pct?[0]: long-only weights from the latest lookback window, each asset\'s share of risk, and the volatility versus equal weight', function(a, env){
  var as = list(a.assets, 'assets', 2), q = Q(), method = q.method(a.method || 'risk_parity'); if(method === 'fixed') bad('method must be one of: equal, inverse_vol, risk_parity, min_variance, max_sharpe, hrp, momentum');
  var lb = Math.max(60, Math.round(num(a.lookback_days, 'lookback_days', 252))), rf = num(a.rf_pct, 'rf_pct', 0);
  return Promise.all(as.map(function(x){ return getHist(env, typeof x === 'string' ? x : x.symbol, a.range || '5Y'); })).then(function(ser){
    var c = commonRets(ser); if(c.R[0].length < 80) bad('not enough shared daily history (need about 4 months)');
    if(perYear(c.dates) < 150) bad('allocate works on daily prices');
    var X = c.R.map(function(r){ return r.slice(-lb); }), w = q.weights(method, X, rf, { topN:a.top_n != null ? num(a.top_n, 'top_n') : 0, skip:a.skip_days != null ? num(a.skip_days, 'skip_days') : 21 }), mwp = a.max_weight_pct != null ? num(a.max_weight_pct, 'max_weight_pct') : 0;
    if(mwp > 0 && mwp < 100 && method !== 'momentum') w = q.cap(w, mwp / 100);
    var eq = X.map(function(){ return 1 / X.length; }), rs = q.riskShare(w, X), re = q.riskShare(eq, X);
    return { method:method, windowDays:X[0].length, from:c.dates[c.dates.length - X[0].length - 1], to:c.dates[c.dates.length - 1],
      assets:as.map(function(x, i){ return { symbol:typeof x === 'string' ? x : x.symbol, weightPct:w[i] * 100, shareOfRiskPct:rs.share[i], equalWeightShareOfRiskPct:re.share[i] }; }),
      portfolioVolPct:rs.vol, equalWeightVolPct:re.vol, note:'Covariance is Ledoit-Wolf shrunk. Weights are estimated from past returns and are not a recommendation.' };
  });
});
def('vol_forecast', 'symbol, range?[5Y]: realized (21 and 63 day), EWMA, GARCH(1,1) now / long-run / next-year volatility, and Parkinson, Garman-Klass, Yang-Zhang from daily high-low-open-close (annualised %)', function(a, env){
  var q = Q(), sym = String(a.symbol || '').toUpperCase(); if(!sym) bad('symbol is required');
  if(!env || !env.history) bad('price history is not available here');
  return Promise.resolve(env.history(sym, a.range || '5Y')).then(function(rows){
    rows = (rows || []).filter(function(x){ return x && x.c != null; }); if(rows.length < 130) bad('need at least 130 daily bars for ' + sym);   // GARCH itself needs about 500 (use range 5Y); the other estimates work from 130
    var dates = rows.map(function(x){ return x.d; }); if(perYear(dates) < 150) bad('vol_forecast works on daily bars');
    var c = rows.map(function(x){ return x.c; }), r = rets(c), bars = { o:rows.map(function(x){ return x.o; }), h:rows.map(function(x){ return x.h; }), l:rows.map(function(x){ return x.l; }), c:c };
    var v = q.volReport(r, bars), g = v.garch;
    return { symbol:sym, bars:rows.length, from:dates[0], to:dates[dates.length - 1], realized21Pct:v.realized21, realized63Pct:v.realized63, fullPeriodPct:v.full, ewmaPct:v.ewma,
      garch:g && { reliable:g.reliable, alphaPct:g.alpha * 100, betaPct:g.beta * 100, persistence:g.persistence, halfLifeDays:g.halfLife, volNowPct:g.nowVol, longRunPct:g.longRunVol, nextYearAvgPct:g.nextYearVol },
      parkinsonPct:v.range && v.range.parkinson, garmanKlassPct:v.range && v.range.garmanKlass, yangZhangPct:v.range && v.range.yangZhang };
  });
});


/* pairs, regimes, stress tests, factors and style (the Quant engine's batch-2 tools) */
function dated(a, what){ if(!a.dates) bad(what + ' needs dated prices: pass { history:"SYMBOL", range:"5Y" } or a series that carries its dates'); return a; }
function rowsOfSeries(a){ return a.map(function(c, i){ return { d:a.dates[i], c:c }; }); }
function asBT(sr, bn, bsym){   // a strategy-like object from two dated price series, so the Quant engine's own analysis can run on them
  var al2 = align(sr, bn), x = al2[0], y = al2[1]; if(x.length < 260) bad('need at least a year of shared daily history');
  var d = x.dates, eqv = x.map(function(v){ return v / x[0]; }), bq = y.map(function(v){ return v / y[0]; });
  return { bt:{ dates:d, eq:eqv, bench:bq, ret:rets(x), bret:rets(y), bsym:bsym }, al:{ dates:bn.dates, bars:(function(){ var o = {}; o[bsym] = { c:bn.slice() }; return o; })() } };
}
def('cointegration', 'a, b (prices, or { history, range }): Engle-Granger cointegration test on the log prices: hedge ratio, ADF statistic against 1/5/10% critical values, verdict, mean-reversion half-life and the spread\'s current z-score (the basis of a pairs trade)', function(a){
  var x = dated(arr(a.a, 'a', 120), 'cointegration'), y = dated(arr(a.b, 'b', 120), 'cointegration'), al2 = align(x, y), r;
  if(al2[0].length < 250 || perYear(al2[0].dates) < 150) bad('cointegration needs about a year or more of shared daily prices');
  r = Q().coint(al2[0], al2[1]); if(!r) bad('could not fit the pair');
  return { observations:al2[0].length, from:al2[0].dates[0], to:al2[0].dates[al2[0].dates.length - 1], hedgeRatio:r.beta, intercept:r.alpha, r2:r.r2, adfTau:r.tau, criticalValues:r.crit, verdict:r.verdict, halfLifeDays:r.halfLife,
    spreadSdPct:r.spreadSd * 100, currentZ:r.zNow, note:'Hedge ratio is the slope of ln(a) on ln(b). Cointegration found in-sample can break; test it out of sample before trading it.' };
});
def('stress_test', 'series (daily prices), benchmark? ({ history, range }) [SPY], range?[MAX]: the series replayed through famous drawdowns it covers (2000, 2008, 2011, 2015-16, 2018, 2020, 2022, 2025) vs the benchmark, plus a downside-beta shock (-10, -20, -30% in the benchmark)', function(a, env){
  var sr = dated(arr(a.series, 'series', 260), 'stress_test'), bs = String((a.benchmark && a.benchmark.history) || a.benchmark || 'SPY').toUpperCase();
  return getHist(env, bs, a.range || 'MAX').then(function(bn){
    var m = asBT(sr, bn, bs), st = Q().stress(m.bt);
    return { benchmark:bs, from:m.bt.dates[0], to:m.bt.dates[m.bt.dates.length - 1], scenarios:st.rows.map(function(r){ return r.s ? { name:r.name, from:r.from, to:r.to, returnPct:r.s.ret, maxDrawdownPct:r.s.maxdd, benchmarkReturnPct:r.b.ret, benchmarkMaxDrawdownPct:r.b.maxdd } : { name:r.name, from:r.from, to:r.to, notCovered:r.why }; }),
      downsideBeta:st.downBeta, benchmarkShocks:st.shocks.map(function(x){ return { benchmarkPct:x.bench, estimatedPct:x.est }; }), benchmarkFallForMinus20Pct:st.reverse };
  });
});
def('regime_stats', 'series (daily prices), benchmark? ({ history, range }) [SPY], range?[MAX]: the series\' return, volatility and Sharpe when the benchmark was above/below its 200-day average and in calm/normal/stormy volatility terciles (regime read at the prior close)', function(a, env){
  var sr = dated(arr(a.series, 'series', 260), 'regime_stats'), bs = String((a.benchmark && a.benchmark.history) || a.benchmark || 'SPY').toUpperCase();
  return getHist(env, bs, a.range || 'MAX').then(function(bn){
    var m = asBT(sr, bn, bs), rg = Q().regimes(m.bt, m.al); if(!rg) bad('not enough history to build regimes (needs about 200 days before the series starts)');
    var one = function(x){ return { regime:x.id, sharePct:x.share, seriesAnnualReturnPct:x.s && x.s.ann, seriesVolPct:x.s && x.s.vol, seriesSharpe:x.s && x.s.sharpe, benchmarkAnnualReturnPct:x.b && x.b.ann, benchmarkSharpe:x.b && x.b.sharpe, days:x.s && x.s.days }; };
    return { benchmark:bs, trend:rg.trend.map(one), volatility:rg.vol.map(one), volatilityCutoffsPct:{ calmBelow:rg.volCuts[0], stormyAbove:rg.volCuts[1] }, note:'Terciles are of the benchmark\'s own 21-day volatility over this period.' };
  });
});
function fetchSet(env, syms, range){ return Promise.all(syms.map(function(sy){ return getHist(env, sy, range).then(function(h){ return [sy, rowsOfSeries(h)]; }, function(){ return [sy, null]; }); })).then(function(pairs){ var o = {}; pairs.forEach(function(p2){ if(p2[1]) o[p2[0]] = p2[1]; }); return o; }); }
def('factor_exposure', 'series (daily prices), range?[5Y]: regression of its daily returns on ETF-proxy factors (market SPY, size IWM-SPY, value IVE-IVW, momentum MTUM-SPY, low-vol USMV-SPY) with Newey-West t-statistics: betas, annual alpha, R-squared and each factor\'s contribution. Proxies, not the academic Fama-French factors', function(a, env){
  var sr = dated(arr(a.series, 'series', 260), 'factor_exposure'); if(perYear(sr.dates) < 150) bad('factor_exposure works on daily prices');
  return fetchSet(env, Q().FACTOR_SYMS, a.range || '5Y').then(function(h){
    var r = Q().factorModel(rets(sr), sr.dates.slice(1), h); if(!r) bad('not enough overlapping history with the factor ETFs (needs about 2 years and SPY)');
    return { observations:r.n, from:r.from, to:r.to, rSquared:r.r2, alphaPctPerYear:r.alpha, alphaT:r.alphaT, residualVolPct:r.resSd, factors:r.factors.map(function(f){ return { factor:f.name, beta:f.beta, t:f.t, contributionPctPerYear:f.contrib }; }), dropped:r.dropped,
      note:'ETF-proxy factors. |t| above about 2 is statistically meaningful; t-statistics use Newey-West errors.' };
  });
});
def('style_analysis', 'series (daily prices), range?[5Y]: Sharpe returns-based style analysis: the non-negative mix of asset-class ETFs (SPY, IWM, EFA, EEM, AGG, TLT, GLD, DBC, VNQ) whose returns best track the series, with R-squared and tracking error', function(a, env){
  var sr = dated(arr(a.series, 'series', 260), 'style_analysis'); if(perYear(sr.dates) < 150) bad('style_analysis works on daily prices');
  var syms = Q().STYLE_ASSETS.map(function(x){ return x[0]; });
  return fetchSet(env, syms, a.range || '5Y').then(function(h){
    var r = Q().style(rets(sr), sr.dates.slice(1), h); if(!r) bad('not enough overlapping history with the asset-class ETFs (needs about a year)');
    return { observations:r.n, from:r.from, to:r.to, rSquared:r.r2, trackingErrorPct:r.trackingErr, unexplainedAlphaPctPerYear:r.alpha, mix:r.weights.filter(function(x){ return x.w >= .5; }).map(function(x){ return { symbol:x.sym, assetClass:x.name, weightPct:x.w }; }),
      note:'Weights are the closest long-only mix of these ETFs, not the actual holdings.' };
  });
});

/* valuation */
def('dcf', 'fcf, growth_pct, discount_pct, years?[5], terminal_growth_pct?[2.5], net_debt?[0], shares?, price?: EV, equity, per-share value, upside', function(a){
  var d = dcfArgs(a), c = dcfCore(d.fcf, d.g, d.r, d.tg, d.n, d.nd), ps = d.sh ? c.eq / d.sh : null;
  return { years:d.n, flows:c.flows, pvOfFlows:c.pv, terminalValue:c.tv, pvOfTerminal:c.pvTv, terminalSharePct:c.pvTv / c.ev * 100, enterpriseValue:c.ev, equityValue:c.eq,
    perShare:ps, upsidePct:ps != null && a.price != null ? (ps / num(a.price, 'price') - 1) * 100 : undefined };
});
def('reverse_dcf', 'price, shares, fcf, discount_pct, years?[10], terminal_growth_pct?[2.5], net_debt?[0]: the FCF growth the price implies', function(a){
  var d = dcfArgs(Object.assign({ years:10 }, a)), target = num(a.price, 'price') * num(a.shares, 'shares');
  if(d.fcf <= 0) bad('reverse DCF needs positive free cash flow');
  var g = solve(function(g){ return dcfCore(d.fcf, g, d.r, d.tg, d.n, d.nd).eq - target; }, -0.5, 2, 'growth rate');
  return { impliedGrowthPct:g * 100, years:d.n, marketCap:target, enterpriseValue:target + d.nd, fcfYieldPct:d.fcf / target * 100, impliedFcfInFinalYear:d.fcf * Math.pow(1 + g, d.n) };
});
def('dcf_sensitivity', 'same as dcf plus growth_step_pct?[2], discount_step_pct?[1]: per-share (or equity) value grid', function(a){
  var d = dcfArgs(a), gs = num(a.growth_step_pct, 'growth_step_pct', 2) / 100, rs = num(a.discount_step_pct, 'discount_step_pct', 1) / 100, rows = [];
  [-2, -1, 0, 1, 2].forEach(function(i){
    var r = d.r + i * rs, row = { discountPct:r * 100 };
    [-2, -1, 0, 1, 2].forEach(function(j){ var g = d.g + j * gs, c = r > d.tg ? dcfCore(d.fcf, g, r, d.tg, d.n, d.nd) : null; row['growth ' + rd(g * 100) + '%'] = c ? (d.sh ? c.eq / d.sh : c.eq) : null; });
    rows.push(row);
  });
  return { unit:d.sh ? 'per share' : 'equity value', grid:rows };
});
/* ---- Stock Research Pro valuation: ports of the skill's valuation.py (FCFF / EV throughout, fade or constant growth, both terminal methods) ---- */
function proPath(base, n, g1, gt, path){
  var out = [], f = base;
  for(var t = 1; t <= n; t++){ var g = path === 'constant' ? g1 : g1 + (gt - g1) * (t - 1) / Math.max(n - 1, 1); f *= 1 + g; out.push(f); }
  return out;
}
function proFwd(base, n, g1, gt, w, netCash, sh, path, exitMx){
  var spread = w - gt;
  if(spread < 0.015) bad('WACC minus terminal growth is ' + rd(spread * 100) + ' points: below 1.5 the Gordon terminal value is unstable. Lower the terminal growth or say the model cannot be defended');
  var f = proPath(base, n, g1, gt, path), pvx = 0, last = f[f.length - 1];
  f.forEach(function(x, i){ pvx += x / Math.pow(1 + w, i + 1); });
  var tv = function(v){ var pv = v / Math.pow(1 + w, n), ev = pvx + pv; return { terminalValue:v, pvOfTerminal:pv, enterpriseValue:ev, equityValue:ev + netCash, perShare:(ev + netCash) / sh, terminalPctOfEv:pv / ev * 100 }; };
  var o = { fcfs:f, pvExplicit:pvx, gordon:tv(last * (1 + gt) / spread) };
  if(exitMx != null){ o.exitMultiple = tv(last * exitMx); var a = o.gordon.perShare, b = o.exitMultiple.perShare; o.methodDivergencePct = Math.abs(a - b) / ((a + b) / 2) * 100; }
  return o;
}
def('forward_dcf', 'base_fcf, g1_pct (year-1 growth), wacc_pct, net_cash (NEGATIVE if net debt), shares (fully diluted; ADR ratios checked), years?[5], terminal_growth_pct?[2.5], path?[fade] (fade | constant), exit_multiple? (FCF multiple of MATURE peers, never the stock\'s own), price?: FCFF DCF under the Gordon and exit-multiple terminal values, terminal share of EV, divergence, the WACC x terminal-growth grid and the discount-rate band, margin of safety; refuses a WACC minus terminal growth under 1.5 points', function(a){
  var base = num(a.base_fcf, 'base_fcf'), n = Math.round(num(a.years, 'years', 5)), g1 = num(a.g1_pct, 'g1_pct') / 100, gt = num(a.terminal_growth_pct, 'terminal_growth_pct', 2.5) / 100,
      w = num(a.wacc_pct, 'wacc_pct') / 100, nc = num(a.net_cash, 'net_cash', 0), sh = num(a.shares, 'shares'), path = a.path === 'constant' ? 'constant' : 'fade',
      mx = a.exit_multiple != null ? num(a.exit_multiple, 'exit_multiple') : null, price = a.price != null ? num(a.price, 'price') : null;
  if(n < 1 || n > 20) bad('years must be between 1 and 20');
  if(base <= 0) bad('base_fcf must be positive: a free-cash-flow DCF is the wrong tool for a company without positive free cash flow');
  var r = proFwd(base, n, g1, gt, w, nc, sh, path, mx), warn = [];
  if(gt > 0.03) warn.push('terminal growth above 3% is above long-run nominal GDP');
  if(r.gordon.terminalPctOfEv > 75) warn.push('the terminal value is ' + rd(r.gordon.terminalPctOfEv) + '% of EV: the model is mostly a terminal assumption');
  if(r.methodDivergencePct > 25) warn.push('the two terminal methods differ by ' + rd(r.methodDivergencePct) + '%: the assumptions are fighting, investigate before quoting either');
  var grid = [], lo = Infinity, hi = -Infinity;
  [-2, -1, 0, 1, 2].forEach(function(i){
    var wv = w + i * 0.005, row = { waccPct:wv * 100 };
    [-2, -1, 0, 1, 2].forEach(function(j){
      var gv = gt + j * 0.005, v = null;
      try{ v = proFwd(base, n, g1, gv, wv, nc, sh, path, null).gordon.perShare; }catch(e){}
      row['g ' + rd(gv * 100) + '%'] = v;
      if(j === 0 && v != null){ lo = Math.min(lo, v); hi = Math.max(hi, v); }
    });
    grid.push(row);
  });
  var out = { conventions:{ years:n, path:path, waccPct:w * 100, terminalGrowthPct:gt * 100, baseFcf:base }, gordon:r.gordon, exitMultiple:r.exitMultiple, methodDivergencePct:r.methodDivergencePct,
    discountRateBandPerShare:{ low:lo, high:hi, note:'Gordon value across WACC +/-1 point at the chosen terminal growth: quote this band, not one number' }, sensitivityGrid:grid, warnings:warn };
  if(price != null) out.marginOfSafetyPct = { gordon:(r.gordon.perShare - price) / r.gordon.perShare * 100, exitMultiple:r.exitMultiple ? (r.exitMultiple.perShare - price) / r.exitMultiple.perShare * 100 : undefined };
  return out;
});
def('dcf_scenarios', 'scenarios:[{name, prob (0-1 or percent; must total 1), per_share}], price?: probability-weighted value per share and margin of safety. Say in one line what each scenario assumes', function(a){
  var sc = list(a.scenarios, 'scenarios', 2).map(function(x, i){ var p = num(x.prob, 'scenarios[' + i + '].prob'); return { name:String(x.name || 'case ' + (i + 1)), prob:p > 1 ? p / 100 : p, perShare:num(x.per_share, 'scenarios[' + i + '].per_share') }; });
  var tot = sum(sc.map(function(x){ return x.prob; }));
  if(Math.abs(tot - 1) > 1e-6) bad('probabilities sum to ' + rd(tot) + ', not 1');
  var wv = sum(sc.map(function(x){ return x.prob * x.perShare; })), out = { weightedPerShare:wv, scenarios:sc };
  if(a.price != null) out.marginOfSafetyPct = (wv - num(a.price, 'price')) / wv * 100;
  return out;
});
function proPv(f0, g, w, tg, n, fade){
  if(w <= tg) bad('WACC must exceed terminal growth');
  var pv = 0, f = f0;
  for(var t = 1; t <= n; t++){ f *= 1 + (fade && n > 1 ? g + (tg - g) * (t - 1) / (n - 1) : g); pv += f / Math.pow(1 + w, t); }
  return pv + f * (1 + tg) / (w - tg) / Math.pow(1 + w, n);
}
function proImplied(f0, ev, w, tg, n, fade){
  var lo = -0.5, hi = 1, flo = proPv(f0, lo, w, tg, n, fade) - ev, fhi = proPv(f0, hi, w, tg, n, fade) - ev;
  if(flo * fhi > 0) bad('no growth rate between -50% and +100% reproduces this price: check the free cash flow, the price and the share count');
  for(var i = 0; i < 300; i++){
    var mid = (lo + hi) / 2, fm = proPv(f0, mid, w, tg, n, fade) - ev;
    if(Math.abs(fm) < 1e-9 || hi - lo < 1e-10) return mid;
    if((fm > 0) === (flo > 0)){ lo = mid; flo = fm; } else hi = mid;
  }
  return (lo + hi) / 2;
}
def('reverse_dcf_full', 'fcf (base free cash flow), wacc_pct, price + shares + net_cash (NEGATIVE if net debt) | ev, years?[10], terminal_growth_pct?[2.5], normalized_fcf? (a mid-cycle base to run alongside), growth_scenarios_pct?[5,10,15,20,25]: the year-1 growth the market price needs under BOTH conventions (fade to terminal, constant), the WACC sensitivity (+/-1.5 points), and the reductio table (fair value per share at each growth). Fix WACC first; always state the convention with the number', function(a){
  var fcf = num(a.fcf, 'fcf'), w = num(a.wacc_pct, 'wacc_pct') / 100, tg = num(a.terminal_growth_pct, 'terminal_growth_pct', 2.5) / 100, n = Math.round(num(a.years, 'years', 10)),
      nc = num(a.net_cash, 'net_cash', 0), sh = a.shares != null ? num(a.shares, 'shares') : null, price = a.price != null ? num(a.price, 'price') : null;
  var ev = a.ev != null ? num(a.ev, 'ev') : (price != null && sh != null ? price * sh - nc : bad('give ev, or price + shares (+ net_cash)'));
  if(fcf <= 0) bad('reverse DCF needs positive free cash flow: it is the wrong tool for banks, insurers, REITs, pre-profit and restructuring companies');
  if(n < 1 || n > 25) bad('years must be between 1 and 25');
  var scen = (Array.isArray(a.growth_scenarios_pct) && a.growth_scenarios_pct.length ? arr(a.growth_scenarios_pct, 'growth_scenarios_pct') : [5, 10, 15, 20, 25]);
  function block(f0){
    var res = { baseFcf:f0, fcfYieldOnEvPct:f0 / ev * 100, impliedYear1GrowthPct:{}, waccSensitivity:{}, reductio:[] };
    [['fade', true], ['constant', false]].forEach(function(c){
      res.impliedYear1GrowthPct[c[0]] = proImplied(f0, ev, w, tg, n, c[1]) * 100;
      res.waccSensitivity[c[0]] = [-0.015, -0.0075, 0, 0.0075, 0.015].map(function(d){ return { waccPct:(w + d) * 100, impliedGrowthPct:proImplied(f0, ev, w + d, tg, n, c[1]) * 100 }; });
    });
    if(sh != null) res.reductio = scen.map(function(g){ return { growthPct:g, fairValuePerShareFade:(proPv(f0, g / 100, w, tg, n, true) + nc) / sh, fairValuePerShareConstant:(proPv(f0, g / 100, w, tg, n, false) + nc) / sh }; });
    return res;
  }
  var out = { conventions:{ years:n, waccPct:w * 100, terminalGrowthPct:tg * 100 }, enterpriseValue:ev, raw:block(fcf) };
  if(price != null && sh != null) out.marketCap = price * sh;
  if(a.normalized_fcf != null) out.normalized = block(num(a.normalized_fcf, 'normalized_fcf'));
  out.note = 'Pass this to the plausibility judgment: compare the implied growth with realised 5-10 year FCF/revenue growth, consensus and sector base rates. The number is an input, not a verdict.';
  return out;
});
def('quality_gate', 'years? (labels, oldest first), operating_income, revenue, net_income, fcf, equity, debt, cash, shares (fully diluted) (each a list, oldest first), tax_rate_pct?[21], gross_profit?, ebitda?, wacc_pct?: ROIC by year (NOPAT over equity + debt - cash), FCF conversion, margin trend, share-count trend vs revenue growth, net debt / EBITDA, and the kill-gate flags it can evidence (ROIC below WACC 3+ years, dilution above revenue growth, FCF conversion under 70%)', function(a){
  var oi = arr(a.operating_income, 'operating_income', 2), n = oi.length, rev = arr(a.revenue, 'revenue', n), ni = arr(a.net_income, 'net_income', n), f = arr(a.fcf, 'fcf', n), eq = arr(a.equity, 'equity', n),
      dt = arr(a.debt, 'debt', n), cs = arr(a.cash, 'cash', n), shr = arr(a.shares, 'shares', n), tax = num(a.tax_rate_pct, 'tax_rate_pct', 21) / 100,
      yr = Array.isArray(a.years) && a.years.length === n ? a.years.map(String) : oi.map(function(_, i){ return 'Y' + (i + 1); });
  [rev, ni, f, eq, dt, cs, shr].forEach(function(x){ if(x.length !== n) bad('every list needs the same number of years (' + n + ')'); });
  var roic = oi.map(function(v, i){ var ic = eq[i] + dt[i] - cs[i]; return ic > 0 ? v * (1 - tax) / ic * 100 : null; });
  var conv = f.map(function(v, i){ return ni[i] > 0 ? v / ni[i] * 100 : null; });
  var om = oi.map(function(v, i){ return rev[i] ? v / rev[i] * 100 : null; });
  var gm = Array.isArray(a.gross_profit) ? arr(a.gross_profit, 'gross_profit', n).map(function(v, i){ return rev[i] ? v / rev[i] * 100 : null; }) : null;
  var yrs = n - 1, cg = function(x){ return x[0] > 0 && x[n - 1] > 0 ? (Math.pow(x[n - 1] / x[0], 1 / yrs) - 1) * 100 : null; };
  var shareG = cg(shr), revG = cg(rev), flags = [];
  var okc = conv.filter(function(x){ return x != null; }), avgConv = okc.length ? mean(okc) : null;
  if(avgConv != null && avgConv < 70) flags.push('FCF conversion averages ' + rd(avgConv) + '%, below 70%: reported profit is not turning into cash, find out why');
  if(shareG != null && revG != null && shareG > 0 && shareG > revG) flags.push('share count grows ' + rd(shareG) + '% a year, faster than revenue (' + rd(revG) + '%): HARD FAIL on dilution unless there is an acquisition rationale');
  var wc = a.wacc_pct != null ? num(a.wacc_pct, 'wacc_pct') : null, below = null;
  if(wc != null){
    var run = 0; roic.forEach(function(v){ run = v != null && v < wc ? run + 1 : 0; }); below = run;
    if(run >= 3) flags.push('ROIC has been below WACC (' + rd(wc) + '%) for the last ' + run + ' years: HARD FAIL unless a specific, evidenced inflection exists');
  }
  var out = { years:yr, roicPct:roic, fcfConversionPct:conv, fcfConversionAvgPct:avgConv, operatingMarginPct:om, grossMarginPct:gm, operatingMarginChangePts:om[n - 1] != null && om[0] != null ? om[n - 1] - om[0] : null,
    shareCountCagrPct:shareG, revenueCagrPct:revG, roicBelowWaccYears:below, flags:flags,
    note:'ROIC uses year-end invested capital and a flat tax rate. The debt maturity ladder is not computable here: read it from the 10-K debt note. If any figure here contradicts the narrative, the numbers win.' };
  if(Array.isArray(a.ebitda)){ var e = arr(a.ebitda, 'ebitda', n); out.netDebtToEbitda = e[n - 1] > 0 ? (dt[n - 1] - cs[n - 1]) / e[n - 1] : null; }
  return out;
});
def('wacc', 'equity_value, debt_value, cost_debt_pct, tax_pct?[21], cost_equity_pct | beta+rf_pct+mrp_pct?[5.5]', function(a){
  var E = num(a.equity_value, 'equity_value'), D = num(a.debt_value, 'debt_value', 0), V = E + D;
  var ke = a.cost_equity_pct != null ? num(a.cost_equity_pct, 'cost_equity_pct') : num(a.rf_pct, 'rf_pct') + num(a.beta, 'beta') * num(a.mrp_pct, 'mrp_pct', 5.5);
  var kd = num(a.cost_debt_pct, 'cost_debt_pct', 0) * (1 - num(a.tax_pct, 'tax_pct', 21) / 100);
  return { waccPct:E / V * ke + D / V * kd, costEquityPct:ke, afterTaxCostDebtPct:kd, equityWeightPct:E / V * 100, debtWeightPct:D / V * 100 };
});
def('capm', 'rf_pct, beta, mrp_pct?[5.5]', function(a){ return { expectedReturnPct:num(a.rf_pct, 'rf_pct') + num(a.beta, 'beta') * num(a.mrp_pct, 'mrp_pct', 5.5) }; });
def('ddm', 'dividend (last annual), growth_pct, required_pct, price?: Gordon growth value', function(a){
  var D = num(a.dividend, 'dividend'), g = num(a.growth_pct, 'growth_pct') / 100, k = num(a.required_pct, 'required_pct') / 100;
  if(!(k > g)) bad('required return must exceed growth');
  var v = D * (1 + g) / (k - g);
  return { value:v, nextDividend:D * (1 + g), upsidePct:a.price != null ? (v / num(a.price, 'price') - 1) * 100 : undefined, impliedRequiredPct:a.price != null ? (D * (1 + g) / num(a.price, 'price') + g) * 100 : undefined };
});
def('multiples', 'price, eps?, eps_growth_pct?, book_per_share?, sales_per_share?, dividend?, fcf_per_share?, market_cap?, ev?, ebitda?, revenue?, fcf?, target_multiple? (P/E for an implied price)', function(a){
  var P = num(a.price, 'price'), o = {}, g = function(k){ return a[k] == null ? null : num(a[k], k); };
  var eps = g('eps'), gr = g('eps_growth_pct'), bv = g('book_per_share'), sps = g('sales_per_share'), dv = g('dividend'), fps = g('fcf_per_share'), mc = g('market_cap'), ev = g('ev'), eb = g('ebitda'), rev = g('revenue'), fcf = g('fcf');
  if(eps){ o.pe = P / eps; o.earningsYieldPct = eps / P * 100; if(gr) o.peg = o.pe / gr; if(a.target_multiple != null) o.impliedPrice = eps * num(a.target_multiple, 'target_multiple'); }
  if(bv) o.pb = P / bv; if(sps) o.ps = P / sps; if(dv != null) o.dividendYieldPct = dv / P * 100; if(fps) o.fcfYieldPct = fps / P * 100;
  if(dv != null && eps) o.payoutRatioPct = dv / eps * 100;
  if(ev != null && eb) o.evToEbitda = ev / eb; if(ev != null && rev) o.evToSales = ev / rev; if(mc && fcf != null) o.fcfYieldPct = fcf / mc * 100; if(mc && rev) o.ps = mc / rev;
  return o;
});
def('graham', 'eps, book_per_share?, growth_pct?, bond_yield_pct?[4.4], price?: Graham number and growth formula value', function(a){
  var eps = num(a.eps, 'eps'), o = {}, P = a.price != null ? num(a.price, 'price') : null;
  if(a.book_per_share != null){ var b = num(a.book_per_share, 'book_per_share'); o.grahamNumber = eps > 0 && b > 0 ? Math.sqrt(22.5 * eps * b) : null; }
  if(a.growth_pct != null) o.growthFormulaValue = eps * (8.5 + 2 * num(a.growth_pct, 'growth_pct')) * 4.4 / num(a.bond_yield_pct, 'bond_yield_pct', 4.4);
  if(P) Object.keys(o).forEach(function(k){ if(o[k] != null) o[k + 'UpsidePct'] = (o[k] / P - 1) * 100; });
  return o;
});
def('margin_of_safety', 'intrinsic, price', function(a){
  var v = num(a.intrinsic, 'intrinsic'), p = num(a.price, 'price');
  return { marginOfSafetyPct:(1 - p / v) * 100, upsidePct:(v / p - 1) * 100 };
});

/* time value of money */
def('fv', 'pv?[0], rate_pct, years, pmt?[0] (added each period), per_year?[1] (compounding/payments per year), due?[false]: future value', function(a){
  var t = tvmRate(a), pv = num(a.pv, 'pv', 0), pmt = num(a.pmt, 'pmt', 0), fv = fvOf(pv, pmt, t.i, t.n, a.due), paid = pv + pmt * t.n;
  return { futureValue:fv, totalContributed:paid, growth:fv - paid, periods:t.n };
});
def('pv', 'fv?[0], rate_pct, years, pmt?[0], per_year?[1], due?[false]: present value', function(a){
  var t = tvmRate(a), fv = num(a.fv, 'fv', 0), pmt = num(a.pmt, 'pmt', 0), d = Math.pow(1 + t.i, t.n);
  return { presentValue:fv / d + (t.i ? pmt * (1 - 1 / d) / t.i : pmt * t.n) * (a.due ? 1 + t.i : 1) };
});
def('pmt', 'principal, rate_pct, years, per_year?[12], fv?[0]: loan or savings payment', function(a){
  var t = tvmRate(Object.assign({ per_year:12 }, a)), P = num(a.principal, 'principal'), fv = num(a.fv, 'fv', 0), d = Math.pow(1 + t.i, t.n);
  var p = t.i ? (P * d - fv) * t.i / (d - 1) : (P - fv) / t.n;
  return { payment:p, periods:t.n, totalPaid:p * t.n, totalInterest:p * t.n - P + fv };
});
def('nper', 'pv, pmt, rate_pct, fv?[0], per_year?[12]: how long to pay off (pv>0, pmt>0) or reach fv by saving (pv>=0, pmt>0)', function(a){
  var py = num(a.per_year, 'per_year', 12), i = num(a.rate_pct, 'rate_pct') / 100 / py, pv = num(a.pv, 'pv'), pmt = num(a.pmt, 'pmt'), fv = num(a.fv, 'fv', 0), n;
  if(fv){ n = i ? Math.log((fv * i + pmt) / (pv * i + pmt)) / Math.log(1 + i) : (fv - pv) / pmt; }
  else { if(pmt <= pv * i) bad('payment does not cover the interest; it never pays off'); n = i ? -Math.log(1 - pv * i / pmt) / Math.log(1 + i) : pv / pmt; }
  if(!isFinite(n)) bad('these inputs never get there');
  return { periods:n, years:n / py };
});
def('rate', 'pv, fv, years, pmt?[0], per_year?[1]: the annual return that turns pv (+ pmt each period) into fv', function(a){
  var py = num(a.per_year, 'per_year', 1), n = num(a.years, 'years') * py, pv = num(a.pv, 'pv'), fv = num(a.fv, 'fv'), pmt = num(a.pmt, 'pmt', 0);
  var g = function(i){ return fvOf(pv, pmt, i, n) - fv; }, top = 0.001;
  while(top < 5 && isFinite(g(top)) && g(top) < 0) top *= 2;
  var i = solve(g, -0.99, Math.min(top, 5), 'rate');
  return { ratePct:i * py * 100, effectiveAnnualPct:(Math.pow(1 + i, py) - 1) * 100 };
});
def('npv', 'rate_pct, cashflows (first is today)', function(a){ return { npv:npvOf(num(a.rate_pct, 'rate_pct') / 100, arr(a.cashflows, 'cashflows')) }; });
def('irr', 'cashflows (first is today, per period)', function(a){ var rs = irrOf(arr(a.cashflows, 'cashflows', 2)); return Object.assign({ irrPct:rs[0] * 100 }, multi(rs)); });
def('xirr', 'flows:[{date:"YYYY-MM-DD", amount}] (invest negative, receive positive)', function(a){
  var f = list(a.flows, 'flows', 2).map(function(x){ var t = Date.parse(x.date); if(!isFinite(t)) bad('bad date ' + x.date); return { t:t, v:num(x.amount, 'amount') }; });
  if(f.length < 2) bad('need at least 2 flows');
  var t0 = lo(f.map(function(x){ return x.t; }));
  if(!(f.some(function(x){ return x.v < 0; }) && f.some(function(x){ return x.v > 0; }))) bad('flows need at least one negative and one positive amount');
  var rs = roots(function(r){ return f.reduce(function(s, x){ return s + x.v / Math.pow(1 + r, (x.t - t0) / 864e5 / 365); }, 0); }, 'XIRR');
  return Object.assign({ xirrPct:rs[0] * 100 }, multi(rs));
});
def('amortize', 'principal, rate_pct, years, per_year?[12], extra?[0] (extra paid each period): payment, interest, payoff time, yearly balances', function(a){
  var t = tvmRate(Object.assign({ per_year:12 }, a)), P = num(a.principal, 'principal'), ex = num(a.extra, 'extra', 0), d = Math.pow(1 + t.i, t.n);
  var p = t.i ? P * t.i * d / (d - 1) : P / t.n, bal = P, int = 0, k = 0, yearly = [];
  while(bal > 1e-9 && k < t.n + 1){ var it = bal * t.i, pr = Math.min(bal, p + ex - it); int += it; bal -= pr; k++; if(k % t.py === 0 || bal <= 1e-9) yearly.push({ year:Math.ceil(k / t.py), balance:Math.max(bal, 0), interestToDate:int }); }
  return { payment:p, paymentWithExtra:p + ex, totalInterest:int, periodsToPayoff:k, yearsToPayoff:k / t.py, yearly:yearly.length > 40 ? yearly.filter(function(_, i){ return i % 5 === 4 || i === yearly.length - 1; }) : yearly };
});
def('real_return', 'nominal_pct, inflation_pct, amount?, years?: inflation-adjusted return and purchasing power', function(a){
  var n = num(a.nominal_pct, 'nominal_pct') / 100, f = num(a.inflation_pct, 'inflation_pct') / 100, o = { realReturnPct:((1 + n) / (1 + f) - 1) * 100 };
  if(a.amount != null && a.years != null){ var y = num(a.years, 'years'), x = num(a.amount, 'amount'); o.nominalValue = x * Math.pow(1 + n, y); o.inTodaysMoney = o.nominalValue / Math.pow(1 + f, y); o.purchasingPowerOfAmountToday = x / Math.pow(1 + f, y); }
  return o;
});
def('dca', 'prices (a series, oldest first), amount (per buy), every?[21] (periods between buys): shares, average cost, value, return vs lump sum', function(a){
  var p = arr(a.prices, 'prices', 2), amt = num(a.amount, 'amount'), ev = Math.max(1, Math.round(num(a.every, 'every', 21))), sh = 0, n = 0;
  for(var i = 0; i < p.length; i += ev){ sh += amt / p[i]; n++; }
  var inv = amt * n, val = sh * p[p.length - 1];
  return { buys:n, invested:inv, shares:sh, averageCost:inv / sh, value:val, returnPct:(val / inv - 1) * 100, lumpSumReturnPct:(p[p.length - 1] / p[0] - 1) * 100 };
});

/* portfolio & money */
def('portfolio', 'name? (the user\'s portfolio; default current): value, cost, P/L and weights in their base currency at live prices', function(a, env){
  if(!env || !env.portfolio) bad('portfolio data is not available here');
  return Promise.resolve(env.portfolio(a.name)).then(function(st){
    return { portfolio:st.name, currency:st.base, value:st.total, cost:st.cost, gain:st.ret, gainPct:st.retPct, dayChange:st.day, dayChangePct:st.total - st.day ? st.day / (st.total - st.day) * 100 : 0,
      holdings:st.rows.map(function(r){ return { symbol:r.s, shares:r.q, price:r.price, currency:r.cur, value:r.bv, gain:r.bv - r.bc, gainPct:r.retPct, weightPct:st.total ? r.bv / st.total * 100 : 0, dayChangePct:r.dayPct }; }),
      notConverted:st.fxMissing.length ? st.fxMissing : undefined };
  });
});
def('avg_cost', 'lots:[{shares, price}] (negative shares = sold), price? (current): shares, average cost, realized and unrealized P/L', function(a){
  var sh = 0, cost = 0, real = 0;
  list(a.lots, 'lots').forEach(function(l, i){
    var q = num(l.shares, 'lots[' + i + '].shares'), px = num(l.price, 'lots[' + i + '].price');
    if(q >= 0){ sh += q; cost += q * px; } else { var avg = sh ? cost / sh : 0, s = Math.min(-q, sh); real += s * (px - avg); cost -= s * avg; sh -= s; }
  });
  var o = { shares:sh, averageCost:sh ? cost / sh : 0, costBasis:cost, realizedGain:real };
  if(a.price != null){ var P = num(a.price, 'price'); o.marketValue = sh * P; o.unrealizedGain = sh * P - cost; o.unrealizedGainPct = cost ? (sh * P / cost - 1) * 100 : 0; }
  return o;
});
def('rebalance', 'holdings:[{symbol, value} | {symbol, shares, price}], targets:{symbol: weight_pct}, cash?[0] (to add): trades to reach the targets', function(a){
  var h = list(a.holdings, 'holdings').map(function(x){ return { s:x.symbol, v:x.value != null ? num(x.value, 'value') : num(x.shares, 'shares') * num(x.price, 'price'), px:x.price != null ? num(x.price, 'price') : null }; });
  var tg = a.targets || {}, tw = sum(Object.keys(tg).map(function(k){ return num(tg[k], k); })); if(!tw) bad('targets are required');
  Object.keys(tg).forEach(function(k){ if(!h.some(function(x){ return x.s === k; })) h.push({ s:k, v:0, px:null }); });
  var total = sum(h.map(function(x){ return x.v; })) + num(a.cash, 'cash', 0);
  return { total:total, trades:h.map(function(x){ var w = num(tg[x.s], x.s, 0) / tw, d = total * w - x.v;
    return { symbol:x.s, currentPct:total ? x.v / total * 100 : 0, targetPct:w * 100, buy:d > 0 ? d : 0, sell:d < 0 ? -d : 0, shares:x.px ? d / x.px : undefined }; }) };
});
/* experimental portfolios: positions come from the user's chosen weights, the portfolio size and live prices, never typed in */
var PER_YEAR = { none:0, weekly:52, monthly:12, quarterly:4, yearly:1 };
ME.PER_YEAR = PER_YEAR; ME.MAX_POSITIONS = 20;
def('build_portfolio', 'size (total money), positions:[{symbol, weight_pct}] (weights must total 100), prices:{SYMBOL: live price}, whole_shares?[false]: each position\'s value = size x weight, shares = value / price (whole shares leave the remainder as cash)', function(a){
  var size = num(a.size, 'size'); if(!(size > 0)) bad('size must be above zero');
  var pos = list(a.positions, 'positions'); if(pos.length > ME.MAX_POSITIONS) bad('at most ' + ME.MAX_POSITIONS + ' positions');
  var px = a.prices || {}, seen = {}, total = 0, missing = [], whole = a.whole_shares === true || a.whole_shares === 'true';
  var rows = pos.map(function(p, i){
    var s = String(p.symbol || '').trim().toUpperCase(); if(!s) bad('positions[' + i + '].symbol is required');
    if(seen[s]) bad(s + ' appears twice'); seen[s] = 1;
    var w = num(p.weight_pct, s + ' weight_pct'); if(!(w > 0) || w > 100) bad(s + ' weight must be between 0 and 100');
    var price = px[s] == null ? NaN : num(px[s], s + ' price'); if(!(price > 0)) missing.push(s);
    total += w; return { s:s, w:w, price:price };
  });
  if(missing.length) bad('no live price for ' + missing.join(', '));
  if(Math.abs(total - 100) > 0.01) bad('weights total ' + Math.round(total * 100) / 100 + '%, not 100%');
  var invested = 0, out = rows.map(function(r){
    var target = size * r.w / 100, shares = whole ? Math.floor(target / r.price) : target / r.price, value = shares * r.price; invested += value;
    return { symbol:r.s, weightPct:r.w, price:r.price, targetValue:target, shares:shares, value:value };
  });
  out.forEach(function(r){ r.actualWeightPct = size ? r.value / size * 100 : 0; });
  return { size:size, invested:invested, cash:size - invested, cashPct:(size - invested) / size * 100, positions:out };
});
function addMonths(y, m, d, k){ var t = m + k, yy = y + Math.floor(t / 12), mm = ((t % 12) + 12) % 12, last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate(); return Date.UTC(yy, mm, Math.min(d, last)); }
def('contribution_schedule', 'amount, freq (weekly | monthly | quarterly | yearly), start?[today] (YYYY-MM-DD), years?[1]: every deposit date, the count and the total contributed', function(a){
  var freq = String(a.freq || '').toLowerCase(); if(!PER_YEAR[freq]) bad('freq must be weekly, monthly, quarterly or yearly');
  var amt = num(a.amount, 'amount'); if(!(amt > 0)) bad('amount must be above zero');
  var yrs = Math.max(0.1, Math.min(50, num(a.years, 'years', 1)));
  var st = a.start ? Date.parse(a.start + 'T00:00:00Z') : Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()); if(!isFinite(st)) bad('start must be YYYY-MM-DD');
  var end = st + yrs * 365 * 864e5, s0 = new Date(st), dates = [], k = 1, t = st;
  while(dates.length < 2600){
    t = freq === 'weekly' ? st + 7 * 864e5 * k : addMonths(s0.getUTCFullYear(), s0.getUTCMonth(), s0.getUTCDate(), k * (freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : 12));
    if(t > end) break; dates.push(new Date(t).toISOString().slice(0, 10)); k++;
  }
  return { freq:freq, amount:amt, perYear:PER_YEAR[freq], perYearAmount:amt * PER_YEAR[freq], count:dates.length, total:amt * dates.length, first:dates[0] || null, last:dates[dates.length - 1] || null, dates:dates.slice(0, 60) };
});
def('dividend_income', 'shares, dividend (annual per share), price?, cost_per_share?, growth_pct?, years?: income, yield, yield on cost, projection', function(a){
  var s = num(a.shares, 'shares'), d = num(a.dividend, 'dividend'), o = { annualIncome:s * d, monthlyIncome:s * d / 12 };
  if(a.price != null) o.yieldPct = d / num(a.price, 'price') * 100;
  if(a.cost_per_share != null) o.yieldOnCostPct = d / num(a.cost_per_share, 'cost_per_share') * 100;
  if(a.growth_pct != null && a.years != null){ var g = num(a.growth_pct, 'growth_pct') / 100, y = Math.min(50, num(a.years, 'years')), t = 0; o.byYear = []; for(var k = 1; k <= y; k++){ var inc = s * d * Math.pow(1 + g, k); t += inc; o.byYear.push({ year:k, income:inc }); } o.totalOverPeriod = t; }
  return o;
});
def('fx', 'amount, from, to (ISO codes, e.g. USD SGD): converted at the ECB reference rate', function(a, env){
  if(!env || !env.fx) bad('exchange rates are not available here');
  var f = String(a.from || '').toUpperCase(), t = String(a.to || '').toUpperCase(), amt = num(a.amount, 'amount');
  return Promise.resolve(env.fx(f, t)).then(function(r){ if(r == null || !r.rate) bad('no rate for ' + f + '/' + t); return { amount:amt, from:f, to:t, rate:r.rate, converted:amt * r.rate, rateDate:r.date, source:r.src }; });
});

/* options */
def('bs', 'spot, strike, days|years, vol_pct, type?[call]|put, rate_pct?[4], div_yield_pct?[0]: Black-Scholes price and greeks', function(a){
  var o = optArgs(a), v = num(a.vol_pct, 'vol_pct') / 100, g = bsCore(o.type, o.S, o.K, o.T, v, o.r, o.q);
  return { price:g.price, delta:g.delta, gamma:g.gamma, thetaPerDay:g.theta / 365, vegaPer1Pct:g.vega / 100, rhoPer1Pct:g.rho / 100,
    probItmPct:(o.type === 'put' ? ncdf(-g.d2) : ncdf(g.d2)) * 100, breakeven:o.type === 'put' ? o.K - g.price : o.K + g.price, intrinsic:Math.max(0, o.type === 'put' ? o.K - o.S : o.S - o.K) };
});
def('implied_vol', 'price (option premium), spot, strike, days|years, type?[call]|put, rate_pct?[4], div_yield_pct?[0]', function(a){
  var o = optArgs(a), P = num(a.price, 'price'), f = function(v){ return bsCore(o.type, o.S, o.K, o.T, v, o.r, o.q).price - P; };
  var v = 0.3; for(var k = 0; k < 50; k++){ var g = bsCore(o.type, o.S, o.K, o.T, v, o.r, o.q), d = g.price - P; if(Math.abs(d) < 1e-10) break; if(g.vega < 1e-8) { v = NaN; break; } v -= d / g.vega; if(!(v > 1e-4 && v < 10)){ v = NaN; break; } }
  if(!isFinite(v) || Math.abs(f(v)) > 1e-6) v = solve(f, 1e-4, 10, 'volatility');
  return { impliedVolPct:v * 100 };
});
def('payoff', 'legs:[{type:call|put|stock, side:long|short, strike?, premium? (per share; stock: entry price), qty?[1]}], multiplier?[100]: P/L at expiry, breakevens, max gain/loss', function(a){
  var legs = list(a.legs, 'legs').map(function(l, i){ var t = String(l.type || '').toLowerCase(); if(['call', 'put', 'stock'].indexOf(t) < 0) bad('legs[' + i + '].type must be call, put or stock');
    return { t:t, sg:String(l.side || 'long').toLowerCase() === 'short' ? -1 : 1, k:t === 'stock' ? 0 : num(l.strike, 'legs[' + i + '].strike'), p:num(l.premium, 'legs[' + i + '].premium', 0), q:num(l.qty, 'qty', 1) }; });
  if(!legs.length) bad('give at least one leg');
  var mult = num(a.multiplier, 'multiplier', 100);
  function pl(S){ return sum(legs.map(function(l){ var v = l.t === 'stock' ? S - l.p : (l.t === 'call' ? Math.max(S - l.k, 0) : Math.max(l.k - S, 0)) - l.p; return v * l.sg * l.q * (l.t === 'stock' ? 1 : mult); })); }
  var ks = legs.map(function(l){ return l.t === 'stock' ? l.p : l.k; }).filter(function(x){ return x > 0; }), hiK = ks.length ? hi(ks) : 1;
  var pts = [0].concat(ks.sort(function(x, y){ return x - y; })).concat([hiK * 3]), vals = pts.map(pl);
  var slopeUp = pl(hiK * 3 + 1) - pl(hiK * 3), be = [];
  for(var i = 1; i < pts.length; i++){ var a0 = vals[i - 1], b0 = vals[i]; if(a0 === 0 && i === 1) be.push(pts[0]); if(a0 * b0 < 0 || (b0 === 0 && i < pts.length - 1)) be.push(b0 === 0 ? pts[i] : pts[i - 1] + (pts[i] - pts[i - 1]) * -a0 / (b0 - a0)); }
  if(slopeUp && vals[vals.length - 1] * (vals[vals.length - 1] + slopeUp * 1e6) < 0) be.push(pts[pts.length - 1] - vals[vals.length - 1] / slopeUp);
  var mx = hi(vals), mn = lo(vals);
  return { breakevens:be.filter(function(x, i, s){ return s.indexOf(x) === i; }), maxGain:slopeUp > 1e-9 ? 'unlimited' : mx, maxLoss:slopeUp < -1e-9 ? 'unlimited' : mn,
    netPremium:-sum(legs.filter(function(l){ return l.t !== 'stock'; }).map(function(l){ return l.p * l.sg * l.q * mult; })),
    atPrices:pts.slice(1, -1).map(function(S){ return { price:S, pl:pl(S) }; }) };
});
def('prob_price', 'spot, target, days, vol_pct, drift_pct?[0]: chance of finishing above / below a price (lognormal), and the 1-sigma range', function(a){
  var S = num(a.spot, 'spot'), K = num(a.target, 'target'), T = num(a.days, 'days') / 365, v = num(a.vol_pct, 'vol_pct') / 100, mu = num(a.drift_pct, 'drift_pct', 0) / 100;
  var st = v * Math.sqrt(T), z = (Math.log(K / S) - (mu - v * v / 2) * T) / st, m = Math.log(S) + (mu - v * v / 2) * T;
  return { probAbovePct:(1 - ncdf(z)) * 100, probBelowPct:ncdf(z) * 100, oneSigmaLow:Math.exp(m - st), oneSigmaHigh:Math.exp(m + st), expectedMovePct:st * 100 };
});

/* projection */
def('monte_carlo', 'series (daily prices; range 5Y or MAX), years?[5], capital?[10000], expected_return_pct? (average yearly return to assume; needed when the series is under 3 years), drift_pct?[0] (extra shift per year), vol_mult?[1]: bootstrap of its own daily returns', function(a){
  var QN = root.QN; if(!QN || !QN.project) bad('projection engine not loaded');
  var s = arr(a.series, 'series', 60), per = perYear(s.dates), cap = num(a.capital, 'capital', 10000), r = rets(s), m = mean(r);
  if(per < 200) bad('monte_carlo needs daily prices: use a 1Y history range (5Y and MAX are weekly or monthly) or pass a daily series');
  var sy = s.dates ? span(s.dates) : r.length / per, own = m * per * 100, given = a.expected_return_pct != null;
  // a sample's average return is mostly noise at short lengths (a year of a 50%-volatility stock is +/-50%), so it must not be projected silently
  if(!given && sy < 3) bad('only ' + rd(sy) + ' years of prices: their average return (' + rd(own) + '% a year) is mostly noise. Use range 5Y or MAX, or pass expected_return_pct (the yearly return to assume; pass ' + rd(own) + ' to project this sample as it is)');
  var k = per / DAY, yrs = Math.max(1, Math.min(num(a.years, 'years', 5) * k, 30)) / k, assumed = given ? num(a.expected_return_pct, 'expected_return_pct') : own;
  var shift = (assumed - own) + num(a.drift_pct, 'drift_pct', 0);   // % a year added to every day's return so its average is the one assumed
  var p = QN.project(r, { years:yrs * k, capital:cap, drift:shift / k, volMult:num(a.vol_mult, 'vol_mult', 1) });   // QN steps 252 a year: stretch for 365-day markets
  var cg = function(v){ return (Math.pow(v / cap, 1 / yrs) - 1) * 100; };
  return { years:yrs, capital:cap, endP5:p.end[0], endP25:p.end[1], endMedian:p.end[2], endP75:p.end[3], endP95:p.end[4], cagrP5Pct:cg(p.end[0]), cagrMedianPct:cg(p.end[2]), cagrP95Pct:cg(p.end[4]), chanceOfLossPct:p.lossProb,
    assumedAverageReturnPct:assumed + num(a.drift_pct, 'drift_pct', 0), basedOnYears:sy, returnFrom:given ? 'assumption' : 'the series itself' };
});

/* ------------------------------------------------------------------ running: resolve live data refs, then compute */
function getHist(env, sym, range){
  if(!env || !env.history) bad('price history is not available here');
  var key = String(sym || '').toUpperCase() + '|' + (range || '1Y'), c = env.hc || (env.hc = {});
  return c[key] || (c[key] = Promise.resolve().then(function(){ return env.history(String(sym || '').toUpperCase(), range || '1Y'); }).then(function(rows){
    rows = (rows || []).filter(function(x){ return x && x.c != null; });
    if(rows.length < 3) bad('no price history for ' + sym);
    var a = rows.map(function(x){ return x.c; }); a.dates = rows.map(function(x){ return x.d; }); return a;
  }));
}
function withCache(env){ return Object.assign({}, env || {}, { hc:{} }); }   // the cache lives for one call (or one batch)
function resolve(v, env){   // { history:"NVDA", range } anywhere in the args becomes that symbol's daily closes
  if(Array.isArray(v)) return Promise.all(v.map(function(x){ return resolve(x, env); }));
  if(v && typeof v === 'object'){
    if(typeof v.history === 'string') return getHist(env, v.history, v.range);
    var ks = Object.keys(v), o = {};
    return Promise.all(ks.map(function(k){ return resolve(v[k], env).then(function(x){ o[k] = x; }); })).then(function(){ return o; });
  }
  return Promise.resolve(v);
}
function runOne(fn, args, env){
  var f = F[fn];
  if(!f) return Promise.reject(new Error('unknown function ' + fn + '. Available: ' + Object.keys(F).join(', ')));
  return resolve(args || {}, env).then(function(a){ return f.run(a, env); }).then(finish).catch(function(e){
    if(e instanceof TypeError || e instanceof RangeError) throw new Error(fn + ': the arguments are not in the expected shape (' + f.sig + ')');   // never show the model an engine stack message
    throw e;
  });
}
ME.run = function(fn, args, env){ return runOne(fn, args, withCache(env)); };
function histRefs(v, out){   // every {history, range} in a pile of args
  if(Array.isArray(v)) v.forEach(function(x){ histRefs(x, out); });
  else if(v && typeof v === 'object'){ if(typeof v.history === 'string') out.push([v.history, v.range]); else Object.keys(v).forEach(function(k){ histRefs(v[k], out); }); if(Array.isArray(v.assets)) v.assets.forEach(function(x){ if(x && x.symbol) out.push([x.symbol, v.range]); }); }
  return out;
}
function pick(res, path){ return path.split('.').reduce(function(o, k){ if(o == null || !(k in Object(o))) bad('no field ' + path); return o[k]; }, res); }
function refs(v, done){   // "$id.field" -> that result's value
  if(typeof v === 'string' && /^\$[A-Za-z_]\w*(\.[\w\[\]]+)*$/.test(v)){ var p = v.slice(1).replace(/\[(\d+)\]/g, '.$1').split('.'), id = p.shift(); if(!(id in done)) bad('unknown reference ' + v); return p.length ? pick(done[id], p.join('.')) : done[id]; }
  if(Array.isArray(v)) return v.map(function(x){ return refs(x, done); });
  if(v && typeof v === 'object'){ var o = {}; Object.keys(v).forEach(function(k){ o[k] = refs(v[k], done); }); return o; }
  return v;
}
/* Items run in order (later ones may use earlier results); a failed item reports its error and the rest carry on. */
ME.batch = function(items, env){
  var done = {}, out = [], e = withCache(env);
  histRefs(items, []).forEach(function(h){ if(e.history) getHist(e, h[0], h[1]).catch(function(){}); });   // fetch every symbol up front, in parallel; items then find them ready
  return (items || []).reduce(function(p, it, i){
    return p.then(function(){
      var id = it.id || 'r' + (i + 1);
      return Promise.resolve().then(function(){ return runOne(it.fn || 'eval', refs(it.args || (it.expression ? { expression:it.expression } : {}), done), e); })
        .then(function(r){ done[id] = r; out.push({ id:id, fn:it.fn || 'eval', result:r }); }, function(e){ out.push({ id:id, fn:it.fn, error:String(e && e.message || e) }); });
    });
  }, Promise.resolve()).then(function(){ return out; });
};
ME.catalog = function(){ return Object.keys(F).map(function(k){ return k + '(' + F[k].sig + ')'; }).join('; '); };

/* ------------------------------------------------------------------ checking an answer's numbers
   A figure is a number with its unit as written: "$2.3B", "12.5%", "1,234", "−4.1%". */
var UNIT = { k:1e3, K:1e3, M:1e6, B:1e9, bn:1e9, T:1e12, tn:1e12, million:1e6, billion:1e9, trillion:1e12, thousand:1e3 };
function isYear(f){ return !f.cur && !f.unit && !f.dec && f.v >= 1800 && f.v <= 2200; }
var FIG = /([−\-+]?)([$€£¥]|S\$|US\$)?\s?(\d{1,3}(?:,\d{3}){1,6}(?:\.\d{1,12})?|\d{1,15}(?:\.\d{1,12})?)(\s?(?:%|(?:k|K|M|B|T|bn|tn)\b|\s(?:thousand|million|billion|trillion|percent)\b))?/;
function parseFig(m){
  var sign = m[1] === '-' || m[1] === '−' ? -1 : 1, raw = m[3], u = (m[4] || '').trim(), dec = (raw.split('.')[1] || '').length, pct = u === '%' || u === 'percent';
  var v = parseFloat(raw.replace(/,/g, '')) * sign, mult = pct ? 1 : (UNIT[u] || 1);
  return { v:v, mult:mult, pct:pct, cur:!!m[2], dec:dec, unit:u, sign:m[1] || '' };
}
function fmtLike(x, f){   // write x (already in f's unit) the way f was written: decimals, thousands separators
  var s = Math.abs(x).toFixed(f.dec);
  return /,/.test(f.rawNum || '') ? s.replace(/^(\d+)/, function(d){ return d.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }) : s;
}
function close(shown, truth, dec){ var tol = Math.max(0.5 * Math.pow(10, -dec), Math.abs(truth) * 0.002) + 1e-12; return Math.abs(shown - truth) <= tol; }
var OPS = { '×':'*', 'x':'*', '*':'*', '·':'*', '/':'/', '÷':'/', '+':'+', '−':'-', '-':'-' };
/* Fixes wrong arithmetic stated in an answer. Returns { text, fixes:[{was, now}] }.
   ponytail: regex for the common written forms only (a op b = c, from X to Y with a %); a claim in words is not checked. */
ME.fix = function(text){
  var fixes = [], F1 = FIG.source;
  var arith = new RegExp('(' + F1 + ')(\\s[x\\-]\\s|\\s?[×*·/÷+−]\\s?)(' + F1 + ')\\s?(?:=|≈)\\s?(' + F1 + ')', 'g');   // "x" and "-" only between spaces
  text = String(text || '').replace(arith, function(all){
    var m = arguments, off = m[m.length - 2], str = m[m.length - 1];
    if((m[2] && /[\w)%]\s*$/.test(str.slice(Math.max(0, off - 4), off))) || /[-+−×*·\/÷^]\s?$|\sx\s*$/i.test(str.slice(Math.max(0, off - 4), off)) || /^\s?(?:[-+−×*·\/÷^]|x\s)\s?[\d$(.]/i.test(str.slice(off + all.length, off + all.length + 4))) return all;   // part of a longer chain ("10 + 20 + 30 = 60"): not a claim about two figures
    var a = parseFig([m[1], m[2], m[3], m[4], m[5]]), op = OPS[m[6].trim()], b = parseFig([m[7], m[8], m[9], m[10], m[11]]), cm = [m[12], m[13], m[14], m[15], m[16]], c = parseFig(cm);
    var av = a.pct ? a.v / 100 : a.v * a.mult, bv = b.pct ? b.v / 100 : b.v * b.mult, r = op === '*' ? av * bv : op === '/' ? (bv ? av / bv : NaN) : op === '+' ? av + bv : av - bv;
    if((op === '+' || op === '-') && a.pct !== b.pct) return all;   // mixed units: not plain arithmetic
    if(!isFinite(r)) return all;
    var truth = c.pct ? r * 100 : r / c.mult;
    if(c.pct && !a.pct && !b.pct && op !== '/') return all;
    if(close(c.v, truth, c.dec)) return all;
    c.rawNum = cm[3]; var now = (truth < 0 ? '−' : (c.sign === '+' ? '+' : '')) + (cm[2] || '') + fmtLike(truth, c) + (cm[4] || '');
    var was = cm[0].trim(); fixes.push({ was:was, now:now });
    return all.slice(0, all.lastIndexOf(cm[0])) + all.slice(all.lastIndexOf(cm[0])).replace(cm[0].trim(), now);
  });
  var move = new RegExp('from\\s(' + F1 + ')\\sto\\s(' + F1 + ')([^.\\n]{0,40}?)(\\b(?:up|down|rose|fell|gain\\w*|los(?:s|t|ing)|declin\\w*|drop\\w*|increas\\w*|decreas\\w*|climb\\w*|jump\\w*)\\b|\\()\\s?(?:of\\s|by\\s)?([−\\-+]?\\d+(?:\\.\\d+)?)%(?=\\)|[.,;:!?]|\\s*$|\\s*\\n)', 'gi');   // the % must end its clause, so "(25% of the portfolio)" and "up 15% a year" are left alone
  text = text.replace(move, function(all, f1, s1, c1, n1, u1, t1, s2, c2, n2, u2, mid, word, pct){
    var x = parseFig([f1, s1, c1, n1, u1]), y = parseFig([t1, s2, c2, n2, u2]); if(!x.v || x.pct || y.pct || (isYear(x) && isYear(y))) return all;   // years, and percentage-point moves, are not price changes
    var ch = ((y.v * y.mult) / (x.v * x.mult) - 1) * 100, shown = parseFloat(pct.replace('−', '-')), dec = (pct.split('.')[1] || '').length;
    var dirWord = /^(down|fell|los|declin|drop|decreas)/i.test(word), absShown = Math.abs(shown);
    if(close(absShown, Math.abs(ch), dec) && !(dirWord && ch > 0) && !(/^(up|rose|gain|increas|climb|jump)/i.test(word) && ch < 0)) return all;
    if(dirWord !== (ch < 0) && word !== '(') return all;   // direction word contradicts the numbers: leave it to the untraced check
    var sign = word === '(' ? (ch < 0 ? '−' : '+') : (/^[+]/.test(pct) ? '+' : ''), now = sign + Math.abs(ch).toFixed(dec) + '%';
    fixes.push({ was:pct + '%', now:now });
    var at = all.lastIndexOf(pct + '%'); return all.slice(0, at) + now + all.slice(at + pct.length + 1);
  });
  return { text:text, fixes:fixes };
};
/* Every number in a pile of source text (tool results, the question, the instructions), unit-scaled.
   The array also carries .pct and .mult: the numbers that were percentages (written with %, or under a key like changePct /
   grossMargin) and multiples (written 24x, or under pe / evToEbitda), so a "35%" or "24x" in an answer has to match one of its
   own kind, not any number that happens to be 35. */
var MULT_KEY = /pe|peg|pb|ps|ev|multiple|ratio|beta|cover|turnover|leverage|equity|ebitda|sales|book|cash|debt|payback|times/i;
var PCT_KEY = /pct|percent|margin|yield|growth|return|rate|roe|roa|roic|upside|downside|cagr|volatil|drawdown|payout|weight|chang|chg|alpha|prob|chance|tax|inflation|discount|ratio/i;
ME.ledger = function(texts){
  var out = [], pc = [], xs = [], re = new RegExp(FIG.source, 'g'), m;
  (texts || []).forEach(function(t){
    t = String(t || ''); re.lastIndex = 0;
    while((m = re.exec(t))){
      var f = parseFig(m), v = f.v * f.mult; out.push(v);
      if(/^\s?(?:x\b|times\b)/.test(t.slice(re.lastIndex, re.lastIndex + 8))) xs.push(v);   // "24x", "2.4 times"
      if(f.pct) pc.push(f.v);
      else {
        var k = m.index, c;   // a key just before the number: "changePct": 1.2  /  gross_margin = 0.45
        while(k > 0 && ((c = t[k - 1]) === ' ' || c === '"' || c === "'")) k--;
        if(k > 0 && (t[k - 1] === ':' || t[k - 1] === '=')){
          var key = /["']?([A-Za-z_][\w ]{0,30})["']?\s*[:=]\s*["']?\s*$/.exec(t.slice(Math.max(0, m.index - 48), m.index));
          if(key && MULT_KEY.test(key[1])) xs.push(v);
          if(key && PCT_KEY.test(key[1])){ pc.push(v); if(Math.abs(v) <= 1.5) pc.push(v * 100); continue; }
        }
        if(f.dec >= 2 && Math.abs(v) < 1) pc.push(v * 100);   // a bare fraction such as 0.1834 may be quoted as 18.3%
      }
      if(m.index === re.lastIndex) re.lastIndex++;
    }
  });
  out.pct = pc; out.mult = xs; return out;
};
/* Computed-looking figures (%, money, K/M/B/T, "25x") in the answer that no source contains at the shown precision.
   Years, dates, list numbers, [n] citations and links are skipped. A percentage must match a percentage in the sources,
   a multiple a multiple.
   ponytail: matching by value, so a figure that coincides with an unrelated source number passes. The more digits a figure shows,
   the harder that is: one decimal is checkable, a whole-number % or x in a long source is nearly always a coincidence (matching on
   the words around the figure was tried and did not help, real pages are full of same-topic percentages). The prompts therefore ask
   for one decimal on derived percentages and multiples. */
ME.untraced = function(text, ledger){
  text = String(text || '').replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, '').replace(/\[\d+\]/g, '').replace(/\b\d{4}-\d{2}(-\d{2})?\b/g, '');
  var re = new RegExp(FIG.source + '(\\s?x\\b)?', 'g'), m, out = [], seen = {}, pool = ledger.pct || ledger, xpool = ledger.mult || ledger;
  while((m = re.exec(text))){
    if(m.index === re.lastIndex) re.lastIndex++;
    var f = parseFig(m), mult = !!m[5];
    if(!(f.pct || f.cur || f.mult > 1 || mult)) continue;
    if(/[\w.]/.test(text[m.index + m[0].search(/\S/) - 1] || '') && !m[1]) continue;   // part of a word or ticker like "S&P500"
    var v = f.v * f.mult, tol = 0.5 * Math.pow(10, -f.dec) * f.mult * 1.0001 + 1e-9, src = f.pct ? pool : (mult && !f.cur && f.mult === 1) ? xpool : ledger;
    if(Math.abs(f.v) < 1e-12) continue;
    var hit = src.some(function(L){ return Math.abs(Math.abs(L) - Math.abs(v)) <= tol; });
    if(!hit && !seen[m[0]]){ seen[m[0]] = 1; out.push(m[0].trim()); }
  }
  return out;
};

root.ME = ME;
if(typeof module !== 'undefined' && module.exports) module.exports = ME;
})(typeof window !== 'undefined' ? window : globalThis);
