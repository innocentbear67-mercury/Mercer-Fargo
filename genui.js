/* ============================================================================
   Marvell Intelligent UI: lets Agent chat answer with a visual or interactive block instead of only text.

   The model never writes HTML or script. It writes ONE small JSON spec inside a fenced block labelled `ui`:

     ```ui
     {"type":"chart","kind":"line","title":"Revenue ($B)","x":["2023","2024"],"series":[{"name":"AAPL","data":[383,391]}]}
     ```

   and this file draws it with its own components, so a spec can only ever pick from the list below.
     chart      line or bar, up to 4 series
     table      columns + rows
     compare    side-by-side cards (name, tag, stats, points)
     diagram    boxes and arrows; tap a box to flip it and read its detail on the back
     buttons    tappable follow-up questions (a tap sends the question as the user)
     form       inputs (number, text, select, slider) that send an answer when submitted
     explorer   inputs + live outputs from formulas, optionally plotted: change a number, see the outcome
     steps      a step-by-step walkthrough with Back / Next
     image      an inline picture from an allow-listed host
     graphic    a few shapes (rect, circle, line, text) for a custom drawing
     columns    parallel layout: 2-3 of the blocks above side by side (stacks on a narrow panel)

   Everything the model supplies is escaped or coerced to a number; colours come from a fixed palette; formulas run in a
   small parser (no eval); images only load from the hosts in IMG_HOSTS (a prompt-injected URL cannot carry data out).
   Interaction state lives here (keyed per message + block), so a re-render of the chat keeps your slider and step.

   Browser: window.GENUI.  Node (tests): module.exports.
   ========================================================================== */
(function(root){
'use strict';

var MAX_BLOCK = 24000, MAX_ROWS = 60, MAX_POINTS = 120, MAX_NODES = 12, MAX_COLS = 3;
var PALETTE = ['#C1A578', '#5B8DEF', '#3FB68B', '#E5706A'];            // series colours: gold, blue, green, red
var TONES = { accent:'var(--fh-colors-and-accents-primary)', pos:'var(--fh-positive)', neg:'var(--fh-negative)', blue:'var(--fh-chart-blue)',
  muted:'var(--fh-foreground-on-surface-de-emphasis)', text:'var(--fh-foreground-on-surface-default)' };
var IMG_HOSTS = ['upload.wikimedia.org', 'commons.wikimedia.org', 'www.sec.gov', 's3-symbol-logo.tradingview.com'];
var TYPES = ['chart', 'table', 'compare', 'diagram', 'buttons', 'form', 'explorer', 'steps', 'image', 'graphic', 'columns'];

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
function str(v, n){ return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n || 200); }
/* Numbers: also accepts what models write for money ("US$1,015.70", "S$1,300", "7%", "1 300"). */
function fin(v, d){
  var n = typeof v === 'number' ? v : NaN;
  if(typeof v === 'string'){ var t = v.replace(/(?:US|SG|S|A|C|HK|NZ)?\$|SGD|USD|EUR|GBP|[\u20ac\u00a3\u00a5,%\s\u00a0]/gi, ''); n = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? Number(t) : NaN; }
  return isFinite(n) ? n : (d === undefined ? null : d);
}
function arr(v, n){ return Array.isArray(v) ? v.slice(0, n) : []; }
function isObj(v){ return v && typeof v === 'object' && !Array.isArray(v); }
function ident(v){ var s = String(v == null ? '' : v); return /^[A-Za-z_][A-Za-z0-9_]{0,23}$/.test(s) && s.indexOf('__') < 0 ? s : ''; }

/* ---- split an answer into markdown pieces and ui blocks ------------------------------------------------------------ */
/* Models often write JSON with // comments, trailing commas or curly quotes; fix those and try again. */
function relax(raw){
  return String(raw).replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/[\u201c\u201d]/g, '"').replace(/,(\s*[}\]])/g, '$1');
}
function parse(text){
  var out = [], s = String(text == null ? '' : text), re = /(^|\n)[ \t]*```ui[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*(?=\n|$)/g, last = 0, m;
  while((m = re.exec(s))){
    var before = s.slice(last, m.index);
    if(before.trim()) out.push({ t:'md', x:before });
    var raw = m[2], spec = null, err = '';
    if(raw.length > MAX_BLOCK) err = 'block too long';
    else { try{ spec = JSON.parse(raw); }catch(e){ try{ spec = JSON.parse(relax(raw)); }catch(e2){ err = 'JSON error: ' + str(e2.message, 80); } } }
    out.push({ t:'ui', b:spec, raw:raw, err:err });
    last = m.index + m[0].length;
  }
  var rest = s.slice(last);
  if(rest.trim()) out.push({ t:'md', x:rest });
  return out;
}
/* Text with the ui blocks cut out: what the chat history, copy button and feedback form should see. */
function plain(text){
  return parse(text).map(function(p){ return p.t === 'md' ? p.x : ''; }).join('').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---- formulas: numbers, + - * / ^ %, ( ), names, min max abs sqrt pow log ln exp round floor ceil ------------------- */
var FN = { min:Math.min, max:Math.max, abs:Math.abs, sqrt:Math.sqrt, pow:Math.pow, log:function(x){ return Math.log10(x); }, ln:Math.log, exp:Math.exp,
  round:Math.round, floor:Math.floor, ceil:Math.ceil };
function evalExpr(src, vars){
  var s = String(src == null ? '' : src).replace(/\*\*/g, '^').replace(/\u00d7/g, '*').replace(/\u00f7/g, '/');
  if(!s.trim() || s.length > 240) return NaN;
  var toks = [], re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(.))/gy, m;
  re.lastIndex = 0;
  while(re.lastIndex < s.length && (m = re.exec(s))){
    if(m[1] !== undefined) toks.push({ n:parseFloat(m[1]) });
    else if(m[2] !== undefined) toks.push({ id:m[2] });
    else if(m[3] !== undefined && /[-+*\/^%(),]/.test(m[3])) toks.push({ op:m[3] });
    else if(m[3] !== undefined) return NaN;
  }
  var i = 0, steps = 0;
  function peek(){ return toks[i]; }
  function isOp(o){ var t = toks[i]; return t && t.op === o; }
  function expr(){ var v = term(); while(isOp('+') || isOp('-')){ var o = toks[i++].op, r = term(); v = o === '+' ? v + r : v - r; } return v; }
  function term(){ var v = unary(); while(isOp('*') || isOp('/') || isOp('%')){ var o = toks[i++].op, r = unary(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; }
  function unary(){ if(isOp('-')){ i++; return -unary(); } if(isOp('+')){ i++; return unary(); } return power(); }
  function power(){ var b = atom(); if(isOp('^')){ i++; return Math.pow(b, unary()); } return b; }
  function atom(){
    if(++steps > 400) throw new Error('too long');
    var t = toks[i++];
    if(!t) throw new Error('end');
    if(t.n !== undefined) return t.n;
    if(t.op === '('){ var v = expr(); if(!isOp(')')) throw new Error('paren'); i++; return v; }
    if(t.id !== undefined){
      var name = t.id.toLowerCase();
      if(isOp('(')){
        if(!Object.prototype.hasOwnProperty.call(FN, name)) throw new Error('fn');
        i++; var args = [];
        if(!isOp(')')){ for(;;){ args.push(expr()); if(isOp(',')){ i++; continue; } break; } }
        if(!isOp(')')) throw new Error('paren');
        i++;
        return FN[name].apply(null, args);
      }
      if(name === 'pi') return Math.PI;
      if(name === 'e' && !(vars && Object.prototype.hasOwnProperty.call(vars, t.id))) return Math.E;
      if(vars && Object.prototype.hasOwnProperty.call(vars, t.id)){ var x = vars[t.id]; if(typeof x !== 'number') throw new Error('var'); return x; }
      throw new Error('name');
    }
    throw new Error('token');
  }
  try{ var v = expr(); if(i < toks.length) return NaN; return typeof v === 'number' && isFinite(v) ? v : NaN; }catch(e){ return NaN; }
}

/* ---- number formatting ----------------------------------------------------------------------------------------- */
function fmtNum(v, o){
  o = o || {};
  if(v == null || !isFinite(v)) return '—';
  var d = fin(o.decimals, null), a = Math.abs(v), body;
  if(d == null) d = o.compact && a >= 1000 ? 2 : a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 3;
  d = Math.max(0, Math.min(6, Math.round(d)));
  if(o.compact && a >= 1000){
    var u = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
    body = (v / u[0]).toFixed(Math.min(d, 2)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + u[1];
  } else {
    var parts = v.toFixed(d).split('.');
    body = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts[1] ? '.' + parts[1] : '');
  }
  return str(o.prefix, 4) + body + str(o.suffix, 6);
}

/* ---- state: one record per message + block, so a chat re-render keeps what the user did -------------------------- */
var STATE = {}, REG = {};
function stOf(key){ return STATE[key] || (STATE[key] = {}); }

/* ---- validation: turn whatever the model sent into a clean spec, or null ---------------------------------------- */
var ALIAS = { line:['chart', 'line'], linechart:['chart', 'line'], linegraph:['chart', 'line'], area:['chart', 'line'], areachart:['chart', 'line'], graph:['chart'], plot:['chart'],
  bar:['chart', 'bar'], barchart:['chart', 'bar'], column:['chart', 'bar'], columnchart:['chart', 'bar'], comparison:['compare'], cards:['compare'], flowchart:['diagram'], flow:['diagram'],
  calculator:['explorer'], simulator:['explorer'], interactive:['explorer'], slider:['explorer'], walkthrough:['steps'], stepper:['steps'], button:['buttons'], actions:['buttons'], chips:['buttons'], suggestions:['buttons'] };
function numLike(v){ return typeof v === 'number' || (typeof v === 'string' && fin(v) != null); }
/* Accept the other shapes a model tends to use: type "line", labels/datasets, {x,y} points, row objects, series as a map. */
function normChart(b){
  var o = Object.assign({}, b), x = o.x || o.labels || o.categories || o.xs || o.xAxis || o.x_axis || o.years || o.periods, ser = o.series || o.datasets || o.lines || o.bars, rows = null;
  if(isObj(x) && Array.isArray(x.data)) x = x.data;
  if(!ser && Array.isArray(o.data)){ if(o.data.length && isObj(o.data[0])) rows = o.data; else ser = [{ name:o.name || o.title, data:o.data }]; }
  if(!ser && Array.isArray(o.values)) ser = [{ name:o.name || o.title, data:o.values }];
  if(isObj(ser)) ser = Object.keys(ser).slice(0, 4).map(function(k){ var v = ser[k]; return isObj(v) ? Object.assign({ name:k }, v) : { name:k, data:v }; });
  if(!ser && rows){
    var keys = Object.keys(rows[0]), xk = keys.filter(function(k){ return /^(x|label|name|year|date|period|category|month|age)$/i.test(k); })[0] || keys[0];
    if(!x) x = rows.map(function(r){ return r[xk]; });
    ser = keys.filter(function(k){ return k !== xk && rows.some(function(r){ return numLike(r[k]); }); }).slice(0, 4).map(function(k){ return { name:k, data:rows.map(function(r){ return r[k]; }) }; });
  }
  ser = arr(ser, 4).map(function(s, i){
    if(Array.isArray(s)) return { name:'Series ' + (i + 1), data:s };
    s = isObj(s) ? s : {};
    var d = s.data || s.values || s.y || s.points || [], nm = s.name || s.label || s.title || s.id;
    if(Array.isArray(d) && d.length && isObj(d[0])){
      if(!x) x = d.map(function(p){ return p.x != null ? p.x : (p.label != null ? p.label : p.t); });
      d = d.map(function(p){ return p.y != null ? p.y : (p.value != null ? p.value : p.v); });
    } else if(Array.isArray(d) && d.length && Array.isArray(d[0])){
      if(!x) x = d.map(function(p){ return p[0]; });
      d = d.map(function(p){ return p[1]; });
    }
    return { name:nm, data:d };
  });
  o.x = x; o.series = ser;
  if(!o.kind) o.kind = o.chartType || o.chart_type || o.shape;
  if(!o.unit) o.unit = o.prefix || o.currency;
  return o;
}
function normTable(b){
  var o = Object.assign({}, b), cols = o.columns || o.headers || o.header;
  if(Array.isArray(cols)) cols = cols.map(function(c){ return isObj(c) ? (c.label || c.title || c.key || c.name) : c; });
  var rows = arr(o.rows || o.data, MAX_ROWS);
  if(!cols && rows.length && isObj(rows[0])) cols = Object.keys(rows[0]);
  o.columns = cols;
  o.rows = rows.map(function(r){ return isObj(r) ? (cols || []).map(function(c){ return r[c]; }) : r; });
  return o;
}
function norm(b){
  if(!isObj(b)) return b;
  var key = String(b.type == null ? '' : b.type).toLowerCase().replace(/[^a-z]/g, ''), a = ALIAS[key], o = b;
  if(a){ o = Object.assign({}, b, { type:a[0] }); if(a[1] && !o.kind) o.kind = a[1]; }
  if(o.type === 'chart') o = normChart(o);
  else if(o.type === 'table') o = normTable(o);
  else if(o.type === 'explorer'){ o = Object.assign({}, o); o.outputs = arr(o.outputs || o.results, 4).map(function(f){ return isObj(f) ? Object.assign({}, f, { expr:f.expr || f.formula || f.value }) : f; }); }
  return o;
}
/* A one-line reason a spec was rejected, shown under "could not be drawn" so a bad answer can be diagnosed. */
function why(spec){
  if(spec === null || spec === undefined) return 'the block is not valid JSON';
  if(!isObj(spec)) return 'the block is not a JSON object';
  var b = norm(spec);
  if(TYPES.indexOf(b.type) < 0) return 'unknown type "' + str(spec.type, 30) + '"';
  return { chart:'needs series with numeric data (and x labels)', table:'needs columns and rows', compare:'needs 2 to 4 items with a name', diagram:'needs 2 or more nodes with id and label',
    buttons:'needs items with a label', form:'needs fields with id and kind', explorer:'needs inputs (id, min, max) and outputs (label, expr)', steps:'needs 2 or more steps',
    image:'the image host is not on the allowed list', graphic:'needs shapes', columns:'needs 2 or 3 blocks (columns cannot nest)' }[b.type] || 'invalid';
}
function clean(b, nested){
  b = norm(b);
  if(!isObj(b) || TYPES.indexOf(b.type) < 0) return null;
  var o = { type:b.type, title:str(b.title, 90), note:str(b.note, 240) };
  switch(b.type){
    case 'chart': {
      o.kind = b.kind === 'bar' ? 'bar' : 'line';
      o.x = arr(b.x, MAX_POINTS).map(function(v){ return str(v, 16); });
      o.unit = str(b.unit, 6); o.suffix = str(b.suffix, 6);
      o.series = arr(b.series, 4).map(function(s, i){
        s = isObj(s) ? s : { data:s };
        return { name:str(s.name || ('Series ' + (i + 1)), 40), data:arr(s.data, MAX_POINTS).map(function(v){ return fin(v); }) };
      }).filter(function(s){ return s.data.some(function(v){ return v != null; }); });
      if(!o.series.length) return null;
      var n = Math.max.apply(null, o.series.map(function(s){ return s.data.length; }));
      if(!o.x.length) o.x = Array.apply(null, Array(n)).map(function(_, i){ return String(i + 1); });
      return o;
    }
    case 'table': {
      o.columns = arr(b.columns, 8).map(function(c){ return str(c, 40); });
      o.rows = arr(b.rows, MAX_ROWS).map(function(r){ return arr(r, 8).map(function(c){ return str(c, 120); }); });
      return o.columns.length && o.rows.length ? o : null;
    }
    case 'compare': {
      o.items = arr(b.items, 4).map(function(it){
        it = isObj(it) ? it : {};
        return { name:str(it.name, 40), tag:str(it.tag, 30), stats:arr(isObj(it.stats) ? Object.keys(it.stats) : [], 8).map(function(k){ return [str(k, 30), str(it.stats[k], 40)]; }),
          points:arr(it.points, 5).map(function(p){ return str(p, 140); }) };
      }).filter(function(it){ return it.name; });
      return o.items.length >= 2 ? o : null;
    }
    case 'diagram': {
      o.nodes = arr(b.nodes, MAX_NODES).map(function(nd){ nd = isObj(nd) ? nd : {}; return { id:ident(nd.id), label:str(nd.label, 48), detail:str(nd.detail, 130), tone:TONES[nd.tone] ? nd.tone : 'accent' }; })
        .filter(function(nd, i, all){ return nd.id && nd.label && all.findIndex(function(z){ return z.id === nd.id; }) === i; });
      var ids = o.nodes.map(function(nd){ return nd.id; });
      o.edges = arr(b.edges, 24).map(function(e){ e = Array.isArray(e) ? e : []; return { a:ident(e[0]), b:ident(e[1]), label:str(e[2], 24) }; })
        .filter(function(e){ return ids.indexOf(e.a) >= 0 && ids.indexOf(e.b) >= 0 && e.a !== e.b; });
      return o.nodes.length >= 2 ? o : null;
    }
    case 'buttons': {
      o.items = arr(b.items, 6).map(function(it){ it = isObj(it) ? it : { label:it }; var label = str(it.label, 48); return { label:label, ask:str(it.ask || label, 300) }; })
        .filter(function(it){ return it.label; });
      return o.items.length ? o : null;
    }
    case 'form': {
      o.submit = str(b.submit || 'Send', 30); o.ask = str(b.ask, 400);
      o.fields = arr(b.fields, 6).map(function(f){
        f = isObj(f) ? f : {};
        var kind = ['number', 'text', 'select', 'slider'].indexOf(f.kind) >= 0 ? f.kind : 'text', id = ident(f.id);
        var r = { id:id, label:str(f.label || f.id, 60), kind:kind };
        if(kind === 'select') r.options = arr(f.options, 12).map(function(x){ return str(x, 40); }).filter(Boolean);
        if(kind === 'number' || kind === 'slider'){
          r.min = fin(f.min, 0); r.max = fin(f.max, Math.max(100, r.min + 1)); r.step = fin(f.step, 1) || 1;
          r.value = Math.min(r.max, Math.max(r.min, fin(f.default, fin(f.value, r.min))));
        } else r.value = str(f.default == null ? (f.value == null ? '' : f.value) : f.default, 120);
        if(kind === 'select' && r.value === '' && r.options.length) r.value = r.options[0];
        return r;
      }).filter(function(f){ return f.id && (f.kind !== 'select' || f.options.length); });
      return o.fields.length ? o : null;
    }
    case 'explorer': {
      o.inputs = arr(b.inputs, 5).map(function(f){
        f = isObj(f) ? f : {};
        var r = { id:ident(f.id), label:str(f.label || f.id, 60), min:fin(f.min, 0), max:fin(f.max, 100), step:fin(f.step, 1) || 1, prefix:str(f.prefix, 4), suffix:str(f.suffix, 6) };
        if(r.max <= r.min) r.max = r.min + 1;
        r.value = Math.min(r.max, Math.max(r.min, fin(f.value, fin(f.default, r.min))));
        return r;
      }).filter(function(f, i, all){ return f.id && all.findIndex(function(z){ return z.id === f.id; }) === i; });
      o.outputs = arr(b.outputs, 4).map(function(f){
        f = isObj(f) ? f : {};
        return { label:str(f.label, 60), expr:str(f.expr, 240), prefix:str(f.prefix, 4), suffix:str(f.suffix, 6), decimals:fin(f.decimals, null), compact:!!f.compact };
      }).filter(function(f){ return f.label && f.expr; });
      if(isObj(b.plot)){
        var oi = fin(b.plot.output, 0);
        o.plot = { over:ident(b.plot.over), output:oi != null && oi >= 0 ? Math.floor(oi) : 0, points:Math.max(8, Math.min(60, Math.floor(fin(b.plot.points, 30)))) };
        if(!o.inputs.some(function(f){ return f.id === o.plot.over; }) || !o.outputs[o.plot.output]) o.plot = null;
      }
      return o.inputs.length && o.outputs.length ? o : null;
    }
    case 'steps': {
      o.steps = arr(b.steps, 10).map(function(s){ s = isObj(s) ? s : { body:s }; return { title:str(s.title, 80), body:str(s.body, 500) }; }).filter(function(s){ return s.title || s.body; });
      return o.steps.length >= 2 ? o : null;
    }
    case 'image': {
      o.url = safeImg(b.url); o.alt = str(b.alt || b.title || 'image', 140); o.caption = str(b.caption, 200);
      return o.url ? o : null;
    }
    case 'graphic': {
      o.w = Math.max(120, Math.min(600, fin(b.width, 320))); o.h = Math.max(80, Math.min(500, fin(b.height, 200)));
      o.shapes = arr(b.shapes, 40).map(function(s){
        s = isObj(s) ? s : {};
        var k = s.shape;
        if(['rect', 'circle', 'line', 'text'].indexOf(k) < 0) return null;
        var r = { shape:k, tone:TONES[s.tone] ? s.tone : 'accent', fill:s.fill === false ? false : true };
        ['x', 'y', 'w', 'h', 'r', 'x2', 'y2'].forEach(function(p){ r[p] = fin(s[p], 0); });
        r.text = str(s.text, 60); r.size = Math.max(8, Math.min(40, fin(s.size, 12)));
        return r;
      }).filter(Boolean);
      return o.shapes.length ? o : null;
    }
    case 'columns': {
      if(nested) return null;
      o.items = arr(b.items, MAX_COLS).map(function(x){ return clean(x, true); }).filter(Boolean);
      return o.items.length >= 2 ? o : null;
    }
  }
  return null;
}
function safeImg(u){
  var s = String(u == null ? '' : u).trim();
  if(/^assets\/[A-Za-z0-9._\/-]+\.(png|jpe?g|gif|webp|svg)$/i.test(s) && s.indexOf('..') < 0) return s;
  try{
    var x = new URL(s);
    if(x.protocol === 'https:' && !x.username && !x.password && x.port === '' && IMG_HOSTS.indexOf(x.hostname) >= 0) return x.href;
  }catch(e){}
  return '';
}

/* ---- renderers: each returns an HTML string; all model text goes through esc() ------------------------------------ */
function head(b){ return b.title ? '<div class="iu-h">' + esc(b.title) + '</div>' : ''; }
function foot(b){ return b.note ? '<div class="iu-note">' + esc(b.note) + '</div>' : ''; }

function niceTicks(lo, hi){
  if(lo === hi){ lo -= 1; hi += 1; }
  var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / 4))), err = span / 4 / step;
  step *= err >= 5 ? 5 : err >= 2 ? 2 : 1;
  var a = Math.floor(lo / step) * step, z = Math.ceil(hi / step) * step, t = [];
  for(var v = a; v <= z + step / 2 && t.length < 12; v += step) t.push(Math.round(v / step * 1e6) / 1e6 * step);
  return { lo:a, hi:z, ticks:t };
}
function chartSvg(b, uid){
  var W = 360, H = 190, L = 44, R = 10, T = 10, B = 26, n = b.x.length;
  var vals = []; b.series.forEach(function(s){ s.data.forEach(function(v){ if(v != null) vals.push(v); }); });
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  if(b.kind === 'bar'){ lo = Math.min(0, lo); hi = Math.max(0, hi); }
  var tk = niceTicks(lo, hi), yOf = function(v){ return T + (H - T - B) * (1 - (v - tk.lo) / (tk.hi - tk.lo)); };
  var xs = function(i){ return L + (W - L - R) * (n <= 1 ? .5 : i / (n - 1)); };
  var fmt = function(v){ return v === 0 ? '0' : fmtNum(v, { prefix:b.unit, suffix:b.suffix, compact:true, decimals:Math.abs(v) < 10 ? 2 : 0 }); };
  var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="iu-svg" role="img" aria-label="' + esc(b.title || 'chart') + '">';
  tk.ticks.forEach(function(t){
    g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yOf(t).toFixed(1) + '" y2="' + yOf(t).toFixed(1) + '" class="iu-grid"/>' +
      '<text x="' + (L - 6) + '" y="' + (yOf(t) + 3.5).toFixed(1) + '" class="iu-ax" text-anchor="end">' + esc(fmt(t)) + '</text>';
  });
  var every = Math.max(1, Math.ceil(n / 6));
  b.x.forEach(function(lbl, i){
    if(i % every && i !== n - 1) return;
    var px = b.kind === 'bar' ? L + (W - L - R) * ((i + .5) / n) : xs(i);
    g += '<text x="' + px.toFixed(1) + '" y="' + (H - 8) + '" class="iu-ax" text-anchor="middle">' + esc(lbl) + '</text>';
  });
  if(b.kind === 'bar'){
    var groupW = (W - L - R) / n, bw = Math.max(2, Math.min(28, groupW * .8 / b.series.length)), y0 = yOf(Math.max(tk.lo, Math.min(0, tk.hi)));
    b.series.forEach(function(s, si){
      s.data.forEach(function(v, i){
        if(v == null) return;
        var cx = L + groupW * (i + .5) + (si - (b.series.length - 1) / 2) * bw, y = yOf(v);
        g += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + Math.min(y, y0).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, Math.abs(y0 - y)).toFixed(1) +
          '" rx="2" fill="' + PALETTE[si] + '"><title>' + esc(s.name + ' · ' + (b.x[i] || '') + ': ' + fmt(v)) + '</title></rect>';
      });
    });
  } else {
    b.series.forEach(function(s, si){
      var d = '', pen = false;
      s.data.forEach(function(v, i){ if(v == null){ pen = false; return; } d += (pen ? 'L' : 'M') + xs(i).toFixed(1) + ' ' + yOf(v).toFixed(1); pen = true; });
      g += '<path d="' + d + '" fill="none" stroke="' + PALETTE[si] + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      if(n <= 40) s.data.forEach(function(v, i){
        if(v == null) return;
        g += '<circle cx="' + xs(i).toFixed(1) + '" cy="' + yOf(v).toFixed(1) + '" r="3" fill="' + PALETTE[si] + '"><title>' + esc(s.name + ' · ' + (b.x[i] || '') + ': ' + fmt(v)) + '</title></circle>';
      });
    });
  }
  return g + '</svg>';
}
function legend(b){
  return b.series.length > 1 ? '<div class="iu-leg">' + b.series.map(function(s, i){ return '<span><i style="background:' + PALETTE[i] + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>' : '';
}
function rChart(b){ return head(b) + chartSvg(b) + legend(b) + foot(b); }

function rTable(b){
  return head(b) + '<div class="md-tbl"><table><thead><tr>' + b.columns.map(function(c){ return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
    b.rows.map(function(r){ return '<tr>' + b.columns.map(function(_, i){ return '<td>' + esc(r[i] == null ? '' : r[i]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' + foot(b);
}
function rCompare(b){
  return head(b) + '<div class="iu-cmp">' + b.items.map(function(it, i){
    return '<div class="iu-card" style="border-top-color:' + PALETTE[i] + '"><div class="iu-cn">' + esc(it.name) + '</div>' + (it.tag ? '<div class="iu-tag">' + esc(it.tag) + '</div>' : '') +
      (it.stats.length ? '<dl>' + it.stats.map(function(s){ return '<dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd>'; }).join('') + '</dl>' : '') +
      (it.points.length ? '<ul>' + it.points.map(function(p){ return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
  }).join('') + '</div>' + foot(b);
}

/* diagram: nodes are layered top to bottom by longest path from a start node (cycles are cut), boxes are tappable */
function layout(b){
  var ids = b.nodes.map(function(n){ return n.id; }), depth = {}, inc = {}, state = {}, fwd = [];
  ids.forEach(function(id){ depth[id] = 0; inc[id] = 0; });
  b.edges.forEach(function(e){ inc[e.b]++; });
  /* depth-first walk from the start nodes; an edge that points back at a box on the current path is a loop and is not used for layering */
  function walk(id){
    state[id] = 1;
    b.edges.forEach(function(e){ if(e.a !== id) return; if(state[e.b] === 1) return; fwd.push(e); if(!state[e.b]) walk(e.b); });
    state[id] = 2;
  }
  ids.filter(function(id){ return !inc[id]; }).concat(ids).forEach(function(id){ if(!state[id]) walk(id); });
  for(var pass = 0; pass < ids.length; pass++){
    var moved = false;
    fwd.forEach(function(e){ if(depth[e.b] < depth[e.a] + 1){ depth[e.b] = depth[e.a] + 1; moved = true; } });
    if(!moved) break;
  }
  var layers = [];
  b.nodes.forEach(function(n){ (layers[depth[n.id]] = layers[depth[n.id]] || []).push(n); });
  layers = layers.filter(Boolean);
  var NW = 112, NH = b.nodes.some(function(n){ return n.detail; }) ? 60 : 40, GX = 14, GY = 46, cols = Math.max.apply(null, layers.map(function(l){ return l.length; }));
  var W = Math.max(NW, cols * NW + (cols - 1) * GX), H = layers.length * NH + (layers.length - 1) * GY, pos = {};
  layers.forEach(function(l, li){
    var rowW = l.length * NW + (l.length - 1) * GX, x0 = (W - rowW) / 2;
    l.forEach(function(n, ni){ pos[n.id] = { x:x0 + ni * (NW + GX), y:li * (NH + GY), w:NW, h:NH }; });
  });
  return { W:W, H:H, pos:pos, NW:NW, NH:NH };
}
function wrap2(s, n){
  if(s.length <= n) return [s];
  var cut = s.lastIndexOf(' ', n); if(cut < n * .4) cut = n;
  var a = s.slice(0, cut).trim(), c = s.slice(cut).trim();
  return [a, c.length > n ? c.slice(0, n - 1) + '…' : c];
}
function wrapN(s, n, max){
  var out = [], cur = '';
  s.split(/\s+/).forEach(function(w){ if(cur && (cur + ' ' + w).length > n){ out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; });
  if(cur) out.push(cur);
  if(out.length > max){ out = out.slice(0, max); out[max - 1] = out[max - 1].slice(0, n - 1) + '…'; }
  return out;
}
function rDiagram(b, key){
  var st = stOf(key), L = layout(b), flip = st.flip || {};
  var labels = '', outN = {}, inN = {}; b.edges.forEach(function(e){ outN[e.a] = (outN[e.a] || 0) + 1; inN[e.b] = (inN[e.b] || 0) + 1; });
  var svg = '<svg viewBox="-6 -6 ' + (L.W + 12) + ' ' + (L.H + 12) + '" class="iu-svg iu-dg" role="img" aria-label="' + esc(b.title || 'diagram') + '">' +
    '<defs><marker id="iua' + key.replace(/\W/g, '') + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="iu-arrow"/></marker></defs>';
  b.edges.forEach(function(e){
    var a = L.pos[e.a], z = L.pos[e.b], x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = z.x + z.w / 2, y2 = z.y;
    if(z.y <= a.y){ y1 = a.y + a.h / 2; y2 = z.y + z.h / 2; x1 = a.x + (z.x >= a.x ? a.w : 0); x2 = z.x + (z.x >= a.x ? 0 : z.w); }
    var my = (y1 + y2) / 2;
    svg += '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + 'C' + x1.toFixed(1) + ' ' + my.toFixed(1) + ' ' + x2.toFixed(1) + ' ' + my.toFixed(1) + ' ' + x2.toFixed(1) + ' ' + y2.toFixed(1) +
      '" class="iu-edge" marker-end="url(#iua' + key.replace(/\W/g, '') + ')"/>';
    /* labels of arrows that share a box sit at the spread-out end (near the target on a fan-out, near the source on a fan-in) so they do not stack */
    if(e.label){
      var t = outN[e.a] > 1 ? .8 : inN[e.b] > 1 ? .3 : .5, k = 3 * t * t - 2 * t * t * t, spread = t !== .5;
      var lw = e.label.length * 5.3 + 10, lx = x1 + (x2 - x1) * k + (spread ? 0 : 4 + lw / 2), ly = y1 + (y2 - y1) * k;
      /* ponytail: label width is estimated from the character count (no text measuring in a string renderer) */
      labels += '<rect x="' + (lx - lw / 2).toFixed(1) + '" y="' + (ly - 8).toFixed(1) + '" width="' + lw.toFixed(1) + '" height="14" rx="3" class="iu-lb"/>' +
        '<text x="' + lx.toFixed(1) + '" y="' + (ly + 2.5).toFixed(1) + '" class="iu-ax iu-lt" text-anchor="middle">' + esc(e.label) + '</text>';
    }
  });
  svg += labels;
  b.nodes.forEach(function(n){
    var p = L.pos[n.id], lines = wrap2(n.label, 16), cx = (p.x + p.w / 2).toFixed(1), back = n.detail ? wrapN(n.detail, 24, 5) : [];
    svg += '<g class="iu-node' + (n.detail ? ' tap' : '') + (flip[n.id] ? ' back' : '') + '" data-iu="node" data-key="' + esc(key) + '" data-id="' + esc(n.id) + '" tabindex="0" role="button" aria-label="' + esc(n.label) + (n.detail ? ' (tap to flip)' : '') + '">' +
      '<rect x="' + p.x.toFixed(1) + '" y="' + p.y.toFixed(1) + '" width="' + p.w + '" height="' + p.h + '" rx="9" style="stroke:' + TONES[n.tone] + '"/>' +
      lines.map(function(t, i){ return '<text class="ft" x="' + cx + '" y="' + (p.y + p.h / 2 + (lines.length === 1 ? 4 : (i ? 13 : -3))).toFixed(1) + '" text-anchor="middle">' + esc(t) + '</text>'; }).join('') +
      back.map(function(t, i){ return '<text class="bk" x="' + cx + '" y="' + (p.y + p.h / 2 + (i - (back.length - 1) / 2) * 10.5 + 3).toFixed(1) + '" text-anchor="middle">' + esc(t) + '</text>'; }).join('') + '</g>';
  });
  svg += '</svg>';
  return head(b) + svg + '<div class="iu-detail"><span class="iu-hint">' + (b.nodes.some(function(n){ return n.detail; }) ? 'Tap a box to flip it.' : '') + '</span></div>' + foot(b);
}

function rButtons(b, key){
  var used = stOf(key).used;
  return head(b) + '<div class="iu-btns">' + b.items.map(function(it, i){
    return '<button type="button" class="iu-btn' + (used === i ? ' on' : '') + '" data-iu="ask" data-key="' + esc(key) + '" data-i="' + i + '">' + esc(it.label) + '</button>';
  }).join('') + '</div>' + foot(b);
}

function stepDec(step){ return Math.min(4, (String(step).split('.')[1] || '').length); }
function valLabel(f, v){ return fmtNum(v, { prefix:f.prefix, suffix:f.suffix, decimals:stepDec(f.step) }); }
function fieldHTML(f, key, val, ns){
  var id = 'iu' + key.replace(/\W/g, '') + ns + f.id;
  var lab = '<label for="' + id + '">' + esc(f.label) + (f.kind === 'slider' || ns === 'x' ? ' <b data-iu-val="' + esc(f.id) + '">' + esc(valLabel(f, val)) + '</b>' : '') + '</label>';
  if(f.kind === 'select') return '<div class="iu-f">' + lab + '<select id="' + id + '" data-iu="in" data-key="' + esc(key) + '" data-id="' + esc(f.id) + '">' +
    f.options.map(function(o){ return '<option' + (String(val) === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></div>';
  if(f.kind === 'text') return '<div class="iu-f">' + lab + '<input id="' + id + '" type="text" maxlength="120" value="' + esc(val) + '" data-iu="in" data-key="' + esc(key) + '" data-id="' + esc(f.id) + '"></div>';
  var type = f.kind === 'number' ? 'number' : 'range';
  return '<div class="iu-f">' + lab + '<input id="' + id + '" type="' + type + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '" value="' + esc(val) + '" data-iu="in" data-key="' + esc(key) + '" data-id="' + esc(f.id) + '"></div>';
}
function rForm(b, key){
  var vals = stOf(key).v || {};
  return head(b) + '<form class="iu-form" data-iu="form" data-key="' + esc(key) + '" novalidate>' + b.fields.map(function(f){
    return fieldHTML(f, key, vals[f.id] != null ? vals[f.id] : f.value, 'f');
  }).join('') + '<button type="submit" class="iu-btn go">' + esc(b.submit) + '</button></form>' + foot(b);
}

/* explorer */
function exVars(b, key){
  var v = {}, saved = stOf(key).v || {};
  b.inputs.forEach(function(f){ var s = fin(saved[f.id]); v[f.id] = s == null ? f.value : Math.min(f.max, Math.max(f.min, s)); });
  return v;
}
function exOut(b, key){
  var vars = exVars(b, key);
  var cards = '<div class="iu-outs">' + b.outputs.map(function(o){
    return '<div class="iu-out"><span>' + esc(o.label) + '</span><b>' + esc(fmtNum(evalExpr(o.expr, vars), o)) + '</b></div>';
  }).join('') + '</div>';
  if(!b.plot) return cards;
  var inp = b.inputs.filter(function(f){ return f.id === b.plot.over; })[0], out = b.outputs[b.plot.output], xs = [], ys = [];
  for(var i = 0; i < b.plot.points; i++){
    var x = inp.min + (inp.max - inp.min) * i / (b.plot.points - 1), v2 = Object.assign({}, vars); v2[inp.id] = x;
    xs.push(x); ys.push(evalExpr(out.expr, v2));
  }
  if(!ys.some(function(y){ return isFinite(y); })) return cards;
  var cur = evalExpr(out.expr, vars);
  var spec = { kind:'line', title:'', note:'', unit:out.prefix, suffix:out.suffix, x:xs.map(function(x){ return fmtNum(x, { compact:true, decimals:Math.abs(inp.max - inp.min) < 20 ? 1 : 0 }); }),
    series:[{ name:out.label, data:ys.map(function(y){ return isFinite(y) ? y : null; }) }] };
  var svg = chartSvg(spec).replace(/<circle [^>]*><title>[\s\S]*?<\/title><\/circle>/g, '');
  var mark = '';
  var ci = (vars[inp.id] - inp.min) / (inp.max - inp.min);
  if(isFinite(cur)){
    var vs = ys.filter(isFinite), tk = niceTicks(Math.min.apply(null, vs), Math.max.apply(null, vs));
    var px = 44 + (360 - 44 - 10) * ci, py = 10 + (190 - 10 - 26) * (1 - (cur - tk.lo) / (tk.hi - tk.lo));
    mark = '<line x1="' + px.toFixed(1) + '" x2="' + px.toFixed(1) + '" y1="10" y2="164" class="iu-cur"/><circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="5" fill="' + PALETTE[0] + '" stroke="var(--fh-background-surface)" stroke-width="2"/>';
  }
  svg = svg.replace('</svg>', mark + '</svg>');
  return cards + '<div class="iu-plot-cap">' + esc(out.label) + ' as ' + esc(inp.label) + ' changes</div>' + svg;
}
function rExplorer(b, key){
  var vars = exVars(b, key);
  return head(b) + '<div class="iu-ex">' + b.inputs.map(function(f){
    return fieldHTML({ id:f.id, label:f.label, kind:'slider', min:f.min, max:f.max, step:f.step, prefix:f.prefix, suffix:f.suffix }, key, vars[f.id], 'x');
  }).join('') + '<div data-iu-out="1">' + exOut(b, key) + '</div></div>' + foot(b);
}

function rSteps(b, key){
  var i = Math.min(b.steps.length - 1, Math.max(0, stOf(key).i || 0)), s = b.steps[i];
  return head(b) + '<div class="iu-steps"><div class="iu-dots">' + b.steps.map(function(_, k){ return '<i class="' + (k === i ? 'on' : k < i ? 'done' : '') + '"></i>'; }).join('') + '</div>' +
    '<div class="iu-step"><div class="iu-sn">Step ' + (i + 1) + ' of ' + b.steps.length + '</div>' + (s.title ? '<div class="iu-st">' + esc(s.title) + '</div>' : '') + (s.body ? '<div>' + esc(s.body) + '</div>' : '') + '</div>' +
    '<div class="iu-nav"><button type="button" class="iu-btn" data-iu="step" data-d="-1" data-key="' + esc(key) + '"' + (i ? '' : ' disabled') + '>Back</button>' +
    '<button type="button" class="iu-btn go" data-iu="step" data-d="1" data-key="' + esc(key) + '"' + (i < b.steps.length - 1 ? '' : ' disabled') + '>Next</button></div></div>' + foot(b);
}
function rImage(b){
  return head(b) + '<figure class="iu-fig"><img src="' + esc(b.url) + '" alt="' + esc(b.alt) + '" loading="lazy" referrerpolicy="no-referrer" decoding="async">' + (b.caption ? '<figcaption>' + esc(b.caption) + '</figcaption>' : '') + '</figure>' + foot(b);
}
function rGraphic(b){
  var g = '<svg viewBox="0 0 ' + b.w + ' ' + b.h + '" class="iu-svg" role="img" aria-label="' + esc(b.title || 'graphic') + '">';
  b.shapes.forEach(function(s){
    var c = TONES[s.tone], f = s.fill ? 'fill:' + c + ';fill-opacity:.85' : 'fill:none;stroke:' + c + ';stroke-width:2';
    if(s.shape === 'rect') g += '<rect x="' + s.x + '" y="' + s.y + '" width="' + Math.max(0, s.w) + '" height="' + Math.max(0, s.h) + '" rx="4" style="' + f + '"/>';
    else if(s.shape === 'circle') g += '<circle cx="' + s.x + '" cy="' + s.y + '" r="' + Math.max(0, s.r) + '" style="' + f + '"/>';
    else if(s.shape === 'line') g += '<line x1="' + s.x + '" y1="' + s.y + '" x2="' + s.x2 + '" y2="' + s.y2 + '" style="stroke:' + c + ';stroke-width:2"/>';
    else g += '<text x="' + s.x + '" y="' + s.y + '" font-size="' + s.size + '" style="fill:' + c + '">' + esc(s.text) + '</text>';
  });
  return head(b) + g + '</svg>' + foot(b);
}
function rColumns(b, key){
  return '<div class="iu-cols iu-n' + b.items.length + '">' + b.items.map(function(it, i){ return '<div class="iu-col">' + inner(it, key + '.' + i) + '</div>'; }).join('') + '</div>' + foot(b);
}
function inner(b, key){
  REG[key] = b;
  switch(b.type){
    case 'chart': return rChart(b); case 'table': return rTable(b); case 'compare': return rCompare(b); case 'diagram': return rDiagram(b, key);
    case 'buttons': return rButtons(b, key); case 'form': return rForm(b, key); case 'explorer': return rExplorer(b, key); case 'steps': return rSteps(b, key);
    case 'image': return rImage(b); case 'graphic': return rGraphic(b); case 'columns': return rColumns(b, key);
  }
  return '';
}

/* One ui block -> HTML. `key` must be unique per block in the chat (message id + position). A spec that fails validation draws a quiet note. */
function render(spec, key, info){
  var b = clean(spec);
  if(!b){
    var reason = (info && info.err) || why(spec), raw = info && info.raw ? str(info.raw, 1500) : '';
    return '<div class="iu iu-bad"><details><summary>This visual could not be drawn.</summary><div class="iu-why">Reason: ' + esc(reason) + '.</div>' + (raw ? '<pre>' + esc(raw) + '</pre>' : '') + '</details></div>';
  }
  return '<div class="iu iu-' + b.type + '" data-iu-root="' + esc(key) + '">' + inner(b, key) + '</div>';
}
/* A whole answer -> HTML, with `md` turning the text pieces into HTML. */
function renderAnswer(text, key, md){
  return parse(text).map(function(p, i){ return p.t === 'md' ? md(p.x) : render(p.b, key + '-' + i, p); }).join('');
}
/* What the model sees of its own earlier answer: the text, plus a one-line stand-in for each visual (its JSON would only cost tokens). */
function forHistory(text){
  return parse(text).map(function(p){
    if(p.t === 'md') return p.x;
    var b = isObj(p.b) ? p.b : {};
    return '[visual shown: ' + str(b.type || 'unknown', 20) + (b.title ? ' "' + str(b.title, 60) + '"' : '') + ']';
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function hasUi(text){ return /(^|\n)[ \t]*```ui[ \t]*\n/.test(String(text || '')); }

/* ---- interaction: delegated events, no per-render wiring --------------------------------------------------------- */
var onAsk = null;   // set by the page: function(text){ ... } sends `text` to the agent as the user
function redraw(key){
  if(!REG[key] || typeof document === 'undefined') return;
  var topKey = key.split('.')[0], els = document.querySelectorAll('[data-iu-root]'), host = null;
  for(var i = 0; i < els.length; i++) if(els[i].getAttribute('data-iu-root') === topKey) host = els[i];
  if(!host) return;
  var top = REG[topKey]; host.innerHTML = inner(top, topKey);
}
function fillAsk(tpl, fields, vals){
  var s = String(tpl || '');
  if(!s.trim()) return fields.map(function(f){ return f.label + ': ' + vals[f.id]; }).join(', ');
  return s.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, function(all, id){ return vals[id] != null ? String(vals[id]).replace(/[{}]/g, '') : ''; });
}
function ask(text){ text = str(text, 600).trim(); if(text && onAsk) onAsk(text); }

function onClick(ev){
  var t = ev.target && ev.target.closest ? ev.target.closest('[data-iu]') : null; if(!t) return;
  var act = t.getAttribute('data-iu'), key = t.getAttribute('data-key'), b = key ? REG[key] : null;
  if(act === 'ask' && b){ var it = b.items[+t.getAttribute('data-i')]; if(it){ stOf(key).used = +t.getAttribute('data-i'); redraw(key); ask(it.ask); } }
  else if(act === 'step' && b){ var st = stOf(key); st.i = Math.min(b.steps.length - 1, Math.max(0, (st.i || 0) + (+t.getAttribute('data-d') || 0))); redraw(key); }
  else if(act === 'node' && b){
    var id = t.getAttribute('data-id'), nd = b.nodes.filter(function(n){ return n.id === id; })[0], fs = stOf(key);
    if(!nd || !nd.detail) return;
    fs.flip = fs.flip || {}; fs.flip[id] = !fs.flip[id];
    t.classList.add('flipping'); setTimeout(function(){ t.classList.toggle('back', !!fs.flip[id]); }, 150); setTimeout(function(){ t.classList.remove('flipping'); }, 320);
  }
}
function onKey(ev){
  if((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.getAttribute && ev.target.getAttribute('data-iu') === 'node'){ ev.preventDefault(); onClick(ev); }
}
function onInput(ev){
  var t = ev.target; if(!t || !t.getAttribute || t.getAttribute('data-iu') !== 'in') return;
  var key = t.getAttribute('data-key'), id = t.getAttribute('data-id'), b = REG[key]; if(!b) return;
  var st = stOf(key); st.v = st.v || {};
  var v = t.type === 'range' || t.type === 'number' ? fin(t.value) : String(t.value).slice(0, 120);
  if(v == null) return;
  st.v[id] = v;
  var scope = t.closest('.iu-ex') || t.closest('.iu-form'); if(!scope) return;
  if(b.type === 'explorer'){
    var f = b.inputs.filter(function(x){ return x.id === id; })[0], lab = scope.querySelector('[data-iu-val="' + id + '"]');
    if(lab && f) lab.textContent = valLabel(f, v);
    var out = scope.querySelector('[data-iu-out]'); if(out) out.innerHTML = exOut(b, key);
  } else if(b.type === 'form' && t.type === 'range'){
    var l2 = scope.querySelector('[data-iu-val="' + id + '"]'); if(l2) l2.textContent = valLabel(b.fields.filter(function(x){ return x.id === id; })[0] || {}, v);
  }
}
function onSubmit(ev){
  var f = ev.target; if(!f || !f.getAttribute || f.getAttribute('data-iu') !== 'form') return;
  ev.preventDefault();
  var key = f.getAttribute('data-key'), b = REG[key]; if(!b) return;
  var saved = stOf(key).v || {}, vals = {};
  b.fields.forEach(function(fd){ vals[fd.id] = saved[fd.id] != null ? saved[fd.id] : fd.value; });
  ask(fillAsk(b.ask, b.fields, vals));
}
function attach(doc, fn){
  onAsk = fn;
  if(attach.done || !doc) return;
  attach.done = true;
  doc.addEventListener('click', onClick);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('input', onInput);
  doc.addEventListener('change', onInput);
  doc.addEventListener('submit', onSubmit, true);
}

/* The prompt the harness adds to Agent chat. `level` is the user's Visuals setting: 'auto' (default), 'less' or 'off'. */
function promptFor(level){
  if(level === 'off') return '\nVISUALS: the user turned visuals off. Answer in text and markdown tables only; never write a ui block.\n';
  return '\nVISUALS (Intelligent UI): choose the lightest format that answers the question well, then say the key point in plain text first; a visual supports the answer, it never replaces it. ' +
    'Short fact, opinion or explanation: text only. Numbers over time or a ranking: chart. Several things across several attributes: table, or compare for 2-4 items side by side. A process or how-parts-connect: diagram. ' +
    '"What if", calculators, "how does X work" the user can play with: explorer. A long how-to: steps. A choice the user may want next: buttons. You need details only the user has: form. ' +
    (level === 'less' ? 'The user asked for fewer visuals: use one only when text would clearly be worse, at most one per answer. ' : 'At most two visuals per answer, and none when text is enough. ') +
    'Write a visual as a fenced block labelled ui holding ONE JSON object, nothing else inside. Types and fields: ' +
    'chart {kind:"line"|"bar", title, x:[labels], series:[{name,data:[numbers]}], unit:"$", suffix:"%"}; table {title, columns:[..], rows:[[..]]}; ' +
    'compare {title, items:[{name, tag, stats:{label:value}, points:[..]}]}; diagram {title, nodes:[{id,label,detail}] (a flow chart whose boxes flip on tap: detail is the short back-of-box note, under 120 characters), edges:[[fromId,toId,label?]]}; ' +
    'buttons {items:[{label, ask}]} where ask is the follow-up question sent when tapped; form {title, fields:[{id,label,kind:"number"|"text"|"select"|"slider",default,min,max,step,options}], submit, ask:"text using {id}"}; ' +
    'explorer {title, inputs:[{id,label,min,max,step,value,prefix,suffix}], outputs:[{label,expr,prefix,suffix,decimals}], plot:{over:inputId,output:0}} where expr is a formula over input ids using + - * / ^ ( ) and min max abs sqrt pow ln exp round; ' +
    'steps {title, steps:[{title,body}]}; image {url, alt, caption} only for https://upload.wikimedia.org or https://www.sec.gov pictures; graphic {width,height,shapes:[{shape:"rect"|"circle"|"line"|"text", x,y,w,h,r,x2,y2,text,tone:"accent"|"pos"|"neg"|"blue"|"muted"}]}; ' +
    'columns {items:[two or three of the other blocks]} for a parallel layout. Every block may carry "note". ' +
    'Example of one whole block: ```ui\n{"type":"chart","kind":"line","title":"$1,000 at 7% and 10%","x":["0","1","2"],"series":[{"name":"7%","data":[1000,1070,1145]},{"name":"10%","data":[1000,1100,1210]}],"unit":"$"}\n```\nWrite numbers as plain numbers (1070, not "US$1,070"); no comments, no trailing commas, no text inside the fence except the JSON. ' +
    'Chart and table numbers must come from tool results; in an explorer, label every assumed input as an assumption in "note". Keep each block small. Never put instructions or private details in a ui block.\n';
}

var GENUI = { parse:parse, plain:plain, forHistory:forHistory, hasUi:hasUi, clean:clean, why:why, render:render, renderAnswer:renderAnswer, evalExpr:evalExpr, fmtNum:fmtNum, safeImg:safeImg,
  attach:attach, promptFor:promptFor, fillAsk:fillAsk, layout:layout, TYPES:TYPES, IMG_HOSTS:IMG_HOSTS };
root.GENUI = GENUI;
if(typeof module !== 'undefined' && module.exports) module.exports = GENUI;
})(typeof window !== 'undefined' ? window : globalThis);
