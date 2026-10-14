/* Brokerage trade-history import. Pure code, no model needed for the common layouts:
     TRD.parse(csvText, map?)  -> { fills, skipped, cols, ... }  or { error, headers }
     TRD.build(fills)          -> { holdings, sold, stats }       (first in, first out)
   Columns are found by their header names (Futu/moomoo, Interactive Brokers, Robinhood, Schwab, Fidelity, Webull, Tiger, Trading212 and
   anything that names its columns in a similar way). When the headers are not recognised, `map` (column name per role, e.g. from a model
   that was shown only the header row and a few sample rows) is used instead. Cancelled and failed orders, deposits, dividends, fees,
   options and cash rows are skipped and counted; multi-fill orders (Futu writes each extra fill on its own row) are followed. */
(function(root){
'use strict';
var TRD = {};

/* ---- CSV ------------------------------------------------------------------ */
TRD.csv = function(text){
  var rows = [], row = [], f = '', q = false, s = String(text).replace(/^﻿/, '');
  for(var i = 0; i < s.length; i++){
    var c = s[i];
    if(q){ if(c === '"'){ if(s[i + 1] === '"'){ f += '"'; i++; } else q = false; } else f += c; }
    else if(c === '"') q = true;
    else if(c === ','){ row.push(f); f = ''; }
    else if(c === '\n' || c === '\r'){ if(c === '\r' && s[i + 1] === '\n') i++; row.push(f); f = ''; if(row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else f += c;
  }
  if(f !== '' || row.length){ row.push(f); rows.push(row); }
  return rows;
};

/* ---- column roles ----------------------------------------------------------- */
var norm = function(h){ return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
var ROLES = {   // first name found wins, so the more specific names come first
  side:   ['side', 'action', 'buysell', 'transcode', 'transactiontype', 'trantype', 'direction', 'type', 'activity'],
  symbol: ['symbol', 'ticker', 'code', 'securitycode', 'instrument', 'stock', 'security'],
  name:   ['name', 'securityname', 'description', 'instrumentname'],
  qty:    ['fillqty', 'filledqty', 'executedquantity', 'executedqty', 'tradequantity', 'quantity', 'qty', 'shares', 'units', 'filled'],
  price:  ['fillprice', 'tprice', 'executionprice', 'executedprice', 'tradeprice', 'avgprice', 'price', 'pricepershare', 'fillpx'],
  date:   ['filltime', 'executiontime', 'executedat', 'tradedate', 'datetime', 'transactiondate', 'activitydate', 'date', 'time', 'timestamp', 'settledate', 'ordertime'],
  status: ['status', 'orderstatus'],
  currency: ['currency', 'ccy'],
  market: ['markets', 'market', 'exchange']
};
function pick(heads, names, last){
  for(var n = 0; n < names.length; n++){
    var hit = -1;
    for(var i = 0; i < heads.length; i++) if(heads[i] === names[n]){ hit = i; if(!last) break; }
    if(hit >= 0) return hit;
  }
  return -1;
}
TRD.columns = function(headers, map){
  var h = headers.map(norm), c = {};
  if(map){   // explicit: a column name (or index) for each role
    Object.keys(map).forEach(function(r){
      var v = map[r]; if(v == null || v === '') return;
      var i = typeof v === 'number' ? v : headers.findIndex(function(x){ return norm(x) === norm(v); });
      if(i >= 0 && i < headers.length) c[r] = i;
    });
    return c;
  }
  Object.keys(ROLES).forEach(function(r){ var i = pick(h, ROLES[r], r === 'currency' || r === 'market'); if(i >= 0) c[r] = i; });   // the second Currency / Markets pair belongs to the fill
  return c;
};

/* ---- values ---------------------------------------------------------------- */
var MON = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
function num(v){
  var s = String(v == null ? '' : v).trim(); if(!s || s === '--' || s === '-') return NaN;
  var neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  var n = parseFloat(s.replace(/[(),$€£¥\s]/g, '').replace(/^-/, '').replace(/[A-Za-z]+$/, ''));
  return isNaN(n) ? NaN : (neg ? -n : n);
}
function pad(n){ return (n < 10 ? '0' : '') + n; }
/* dmy: true when the file writes day first (decided over the whole column, since 03/04/2026 alone is ambiguous). */
function parseDate(v, dmy){
  var s = String(v || '').trim(), m, y, mo, d, t = '00:00:00';
  var tm = /(\d{1,2}):(\d\d)(?::(\d\d))?\s*(am|pm)?/i.exec(s);
  if(tm){ var hh = +tm[1]; if(tm[4]){ hh = hh % 12 + (/pm/i.test(tm[4]) ? 12 : 0); } t = pad(hh) + ':' + tm[2] + ':' + (tm[3] || '00'); }
  if((m = /(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(s))){ y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if((m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(s))){ mo = MON[m[1].toLowerCase()]; d = +m[2]; y = +m[3]; }
  else if((m = /(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s,]+(\d{4})/.exec(s))){ d = +m[1]; mo = MON[m[2].toLowerCase()]; y = +m[3]; }
  else if((m = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(s))){ var a = +m[1], b = +m[2]; y = +m[3]; if(y < 100) y += 2000; if(dmy){ d = a; mo = b; } else { mo = a; d = b; } }
  if(!y || !mo || !d || mo > 12 || d > 31) return null;
  return { d:y + '-' + pad(mo) + '-' + pad(d), t:t };
}
function sideOf(v){
  var s = String(v || '').trim().toLowerCase();
  if(/^(buy|b|bot|bought|purchase|buy to open|buy to cover|market buy|limit buy)\b/.test(s) || s === 'buy') return 'B';
  if(/^(sell|s|sld|sold|sale|sell short|sell to close|market sell|limit sell)\b/.test(s)) return 'S';
  return '';
}
var SKIP_ROW = /dividend|interest|deposit|withdraw|transfer|fee|tax|split|journal|adjust|cash|reinvest|credit|debit|wire/i;
var OPTION = /^[A-Z.]{1,6}\s?\d{6}[CP]\d{3,8}$|\d{6}\s?[\d.]+[CP]$|^[A-Z]{1,6}\s\d{1,2}\/\d{1,2}\/\d{2,4}\s/;
var SUFFIX = { SG:'.SI', SGX:'.SI', JP:'.T', TSE:'.T', HK:'.HK', HKEX:'.HK', GB:'.L', LSE:'.L', UK:'.L', CA:'.TO', TSX:'.TO', AU:'.AX', ASX:'.AX', DE:'.DE', XETRA:'.DE', FR:'.PA', CN:'', KR:'.KS' };
function symbolOf(raw, market){
  var s = String(raw || '').trim().toUpperCase(); if(!s) return '';
  s = s.replace(/^[A-Z]{2,5}:/, '').replace(/\s+/g, '');
  var suf = SUFFIX[String(market || '').trim().toUpperCase()] || '';
  if(suf === '.HK') s = s.replace(/^0+(\d{4,})$/, '$1').replace(/^(\d{1,3})$/, function(x){ return ('0000' + x).slice(-4); });
  if(suf && !/\.[A-Z]{1,3}$/.test(s)) s += suf;
  return s;
}

/* ---- parse ----------------------------------------------------------------- */
TRD.parse = function(text, map){
  var grid = TRD.csv(text); if(grid.length < 2) return { error:'The file has no rows.', headers:[] };
  /* some exports start with a title or account line: the header is the first row that names a symbol or side column */
  var hi = 0; for(var k = 0; k < Math.min(grid.length, 12); k++){ var hh = grid[k].map(norm); if(pick(hh, ROLES.symbol) >= 0 && (pick(hh, ROLES.side) >= 0 || pick(hh, ROLES.qty) >= 0)){ hi = k; break; } }
  var headers = grid[hi], c = TRD.columns(headers, map), body = grid.slice(hi + 1);
  var need = ['symbol', 'qty', 'price', 'date'].filter(function(r){ return c[r] == null; });
  if(c.side == null && c.qty != null && need.length === 0){ /* signed quantities can stand in for a side column */ }
  else if(c.side == null) need.push('side');
  if(need.length) return { error:'Could not find the ' + need.join(', ') + ' column' + (need.length > 1 ? 's' : '') + '.', headers:headers, missing:need, cols:c };

  var dmy = false;   // day-first dates anywhere in the column settle the order for the whole file
  body.forEach(function(r){ var m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-]\d{2,4}/.exec(String(r[c.date] || '').trim()); if(m && +m[1] > 12) dmy = true; });
  var sk = { cancelled:0, failed:0, nonTrade:0, option:0, incomplete:0 }, fills = [], last = null, ord = 0;
  var get = function(r, i){ return i == null ? '' : String(r[i] == null ? '' : r[i]).trim(); };
  body.forEach(function(r){
    if(!r.some(function(x){ return String(x).trim(); })) return;
    var sideRaw = get(r, c.side), symRaw = get(r, c.symbol), qty = num(get(r, c.qty)), px = num(get(r, c.price)), when = parseDate(get(r, c.date), dmy), st = get(r, c.status);
    var cont = !sideRaw && !symRaw;   // an extra fill of the order above (Futu writes them on their own rows)
    var side = cont && last ? last.side : sideOf(sideRaw), sym = cont && last ? last.raw : symRaw, mk = cont && last && !get(r, c.market) ? last.market : get(r, c.market);
    if(!side && qty < 0 && c.side == null){ side = 'S'; }
    else if(!side && c.side == null && qty > 0) side = 'B';
    if(!side){ if(sideRaw || SKIP_ROW.test(r.join(' '))) sk.nonTrade++; return; }
    if(!sym){ return; }
    if(OPTION.test(sym.toUpperCase().trim())){ sk.option++; return; }
    if(!cont) last = { side:side, raw:sym, market:mk, name:get(r, c.name) };
    qty = Math.abs(qty);
    if(!(qty > 0) || !(px > 0) || !when){
      if(/cancel|expire/i.test(st)) sk.cancelled++; else if(/fail|reject/i.test(st)) sk.failed++; else sk.incomplete++;
      return;
    }
    fills.push({ s:symbolOf(sym, mk), side:side, q:qty, px:px, d:when.d, t:when.t, cur:get(r, c.currency) || '', name:cont && last ? last.name : get(r, c.name), n:ord++ });
  });
  if(!fills.length) return { error:'No filled trades were found in this file.', headers:headers, cols:c, skipped:sk };
  var dates = fills.map(function(f){ return f.d; }).sort();
  return { fills:fills, skipped:sk, cols:c, headers:headers, from:dates[0], to:dates[dates.length - 1], rows:body.length, dmy:dmy };
};

/* ---- lots (first in, first out) ----------------------------------------------- */
function r8(v){ return Math.round(v * 1e8) / 1e8; }
TRD.build = function(fills){
  var desc = fills.length > 1 && fills[0].d + fills[0].t > fills[fills.length - 1].d + fills[fills.length - 1].t;   // newest-first files: reverse the tie-break
  var seq = fills.slice().sort(function(a, b){
    var ka = a.d + ' ' + a.t, kb = b.d + ' ' + b.t; if(ka !== kb) return ka < kb ? -1 : 1;
    if(a.side !== b.side) return a.side === 'B' ? -1 : 1;
    return desc ? b.n - a.n : a.n - b.n;
  });
  var book = {}, sold = [], unmatched = 0, realized = {};
  seq.forEach(function(f){
    var k = f.s, bk = book[k] || (book[k] = { lots:[], cur:f.cur });
    if(f.side === 'B'){ bk.lots.push({ q:f.q, px:f.px, d:f.d }); return; }
    var left = f.q;
    while(left > 1e-9 && bk.lots.length){
      var lot = bk.lots[0], take = Math.min(lot.q, left);
      sold.push({ s:k, q:r8(take), px:lot.px, d:lot.d, sd:f.d, sp:f.px, cur:f.cur });
      realized[f.cur || '?'] = (realized[f.cur || '?'] || 0) + (f.px - lot.px) * take;
      lot.q = r8(lot.q - take); left = r8(left - take); if(lot.q <= 1e-9) bk.lots.shift();
    }
    if(left > 1e-9){ unmatched++; sold.push({ s:k, q:r8(left), px:0, sd:f.d, sp:f.px, cur:f.cur }); }   // sold from a position opened before this file starts: cost unknown
  });
  var holdings = [];
  Object.keys(book).forEach(function(k){
    var lots = book[k].lots; if(!lots.length) return;
    var q = 0, cost = 0; lots.forEach(function(l){ q += l.q; cost += l.q * l.px; });
    holdings.push({ s:k, q:r8(q), px:q ? cost / q : 0, d:lots[0].d, lots:lots.map(function(l){ return { q:l.q, px:l.px, d:l.d }; }), cur:book[k].cur });
  });
  holdings.sort(function(a, b){ return b.q * b.px - a.q * a.px; });
  sold.sort(function(a, b){ return a.sd < b.sd ? 1 : a.sd > b.sd ? -1 : 0; });
  return { holdings:holdings, sold:sold, stats:{ symbols:Object.keys(book).length, open:holdings.length, closed:sold.length, unmatched:unmatched, realized:realized,
    buys:fills.filter(function(f){ return f.side === 'B'; }).length, sells:fills.filter(function(f){ return f.side === 'S'; }).length } };
};

root.TRD = TRD;
if(typeof module !== 'undefined' && module.exports) module.exports = TRD;
})(typeof window !== 'undefined' ? window : globalThis);
