/* MercerFargo drawing tools: the toolbar, the shapes and the mouse handling, in the style of TradingView's left toolbar.
   A drawing is { id, type, pts:[{t, p}], col, w, dash, txt, locked }. Points are a time and a price, so a drawing
   stays where you put it when you change timeframe, zoom or scroll. Drawings are saved per symbol in this browser.
   Needs from the page: chartView's c (c.geo, c.main(), c.i0, c.soon, c.svg, c.o), chI, chT, num, esc, clamp, askText, toast. */
(function(root){
'use strict';
var DR = {};

var COLS = ['#c1a578', '#ffffff', '#5b8def', '#1f9d55', '#e0353b', '#9c27b0', '#ff9800', '#9aa0a6'];
var FIB = [0, .236, .382, .5, .618, .786, 1], FIBC = ['#9aa0a6', '#e0353b', '#ff9800', '#1f9d55', '#00a38c', '#5b8def', '#9aa0a6'];
var FEXT = [0, .618, 1, 1.272, 1.618, 2, 2.618], FEXC = ['#9aa0a6', '#ff9800', '#1f9d55', '#00a38c', '#5b8def', '#9c27b0', '#e0353b'];
var GREEN = '#1f9d55', RED = '#e0353b';

var ICON = {
  cross:'<path d="M12 4v16M4 12h16"/>', arrow:'<path d="M6 3l12 8-5.5 1.5L10 18z"/>', eraser:'<path d="M8 20l-4-4 9-10 7 7-6 7zM10 20h10"/>',
  trend:'<path d="M5 19L19 5"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>', ray:'<path d="M5 19L21 3"/><circle cx="5" cy="19" r="2"/><circle cx="13" cy="11" r="2"/>',
  ext:'<path d="M3 21L21 3"/><circle cx="9" cy="15" r="2"/><circle cx="16" cy="8" r="2"/>', hline:'<path d="M3 12h18"/><circle cx="12" cy="12" r="2"/>',
  hray:'<path d="M5 12h16"/><circle cx="5" cy="12" r="2"/>', vline:'<path d="M12 3v18"/><circle cx="12" cy="12" r="2"/>',
  channel:'<path d="M4 14L20 6M4 21L20 13"/>', fib:'<path d="M3 5h18M3 10h18M3 15h18M3 20h18"/>',
  fibext:'<path d="M3 20h18M3 14h18M3 8h18M5 20l5-10 4 4"/>', rect:'<rect x="4" y="6" width="16" height="12"/>',
  ellipse:'<ellipse cx="12" cy="12" rx="9" ry="6"/>', triangle:'<path d="M4 19L12 5l8 14z"/>', brush:'<path d="M4 20c4-1 3-5 6-6l8-8 2 2-8 8c-1 3-5 2-8 4z"/>',
  text:'<path d="M5 6h14M12 6v13M9 19h6"/>', label:'<path d="M4 8h12l4 4-4 4H4z"/>', arrowup:'<path d="M12 20V6M6 12l6-6 6 6"/>', arrowdn:'<path d="M12 4v14M6 12l6 6 6-6"/>',
  long:'<path d="M4 4h16v8H4zM4 12h16v8H4z"/>', short:'<path d="M4 4h16v8H4zM4 12h16v8H4z"/>', measure:'<path d="M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2"/>',
  magnet:'<path d="M6 3v9a6 6 0 0 0 12 0V3h-4v9a2 2 0 0 1-4 0V3z"/>', stay:'<path d="M5 19l1-4L16 5l3 3L9 18zM14 7l3 3"/>',
  lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', unlock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7-2"/>',
  eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', eyeoff:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM4 4l16 16"/>',
  trash:'<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>', copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
  full:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', exit:'<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'
};
function icon(id, size){ return '<svg width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (ICON[id] || '') + '</svg>'; }
DR.icon = icon;

/* [id, label, shortcut] */
var GROUPS = [
  { id:'cursor', name:'Cursors', tools:[['cross', 'Crosshair'], ['arrow', 'Arrow'], ['eraser', 'Eraser (click a drawing to remove it)']] },
  { id:'lines', name:'Lines', tools:[['trend', 'Trend line', 'Alt+T'], ['ray', 'Ray'], ['ext', 'Extended line'], ['hline', 'Horizontal line', 'Alt+H'], ['hray', 'Horizontal ray'], ['vline', 'Vertical line', 'Alt+V'], ['channel', 'Parallel channel']] },
  { id:'fib', name:'Fibonacci', tools:[['fib', 'Fib retracement', 'Alt+F'], ['fibext', 'Trend-based fib extension']] },
  { id:'shapes', name:'Shapes', tools:[['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['triangle', 'Triangle'], ['brush', 'Brush']] },
  { id:'notes', name:'Text and markers', tools:[['text', 'Text'], ['label', 'Price label'], ['arrowup', 'Arrow up'], ['arrowdn', 'Arrow down']] },
  { id:'measure', name:'Positions and measure', tools:[['long', 'Long position'], ['short', 'Short position'], ['measure', 'Measure']] }
];
var NPTS = { trend:2, ray:2, ext:2, hline:1, hray:1, vline:1, channel:3, fib:2, fibext:3, rect:2, ellipse:2, triangle:3, brush:0, text:1, label:1, arrowup:1, arrowdn:1, long:1, short:1, measure:2 };
var CURSORS = { cross:1, arrow:1, eraser:1 };
DR.GROUPS = GROUPS; DR.COLS = COLS;

/* ------------------------------------------------------------------ state */
var S = DR.S = { tool:'cross', magnet:false, stay:false, lock:false, hide:false, sel:null, hov:null, draft:null, drag:null, measure:null, fly:null, col:COLS[0], w:2, last:{}, tick:0 };
try{ var saved = JSON.parse(localStorage.getItem('fh3_drset') || '{}'); ['magnet', 'stay', 'lock', 'hide'].forEach(function(k){ if(saved[k]) S[k] = true; }); if(saved.col) S.col = saved.col; }catch(e){}
function saveSet(){ try{ localStorage.setItem('fh3_drset', JSON.stringify({ magnet:S.magnet, stay:S.stay, lock:S.lock, hide:S.hide, col:S.col })); }catch(e){} }
var STORE = null, UNDO = [];
function store(){ if(!STORE){ try{ STORE = JSON.parse(localStorage.getItem('fh3_draw') || '{}') || {}; }catch(e){ STORE = {}; } } return STORE; }
function persist(){ try{ localStorage.setItem('fh3_draw', JSON.stringify(STORE)); }catch(e){} }
DR.items = function(sym){ return store()[sym] || []; };
function itemsW(sym){ var s = store(); return s[sym] || (s[sym] = []); }
function pushUndo(sym){ UNDO.push({ sym:sym, json:JSON.stringify(DR.items(sym)) }); if(UNDO.length > 60) UNDO.shift(); }
function isDraw(tool){ return !CURSORS[tool]; }
function newId(){ return 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }

/* ------------------------------------------------------------------ geometry: one function per drawing type */
function dist2seg(x, y, s){
  var dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / l2)) : 0;
  return Math.hypot(x - (s[0] + t * dx), y - (s[1] + t * dy));
}
function inPoly(x, y, P){ var c = false; for(var i = 0, j = P.length - 1; i < P.length; j = i++){ if(((P[i].y > y) !== (P[j].y > y)) && (x < (P[j].x - P[i].x) * (y - P[i].y) / (P[j].y - P[i].y) + P[i].x)) c = !c; } return c; }
function ext(a, b, k){ var dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x:a.x + dx / l * k, y:a.y + dy / l * k }; }
function dur(sec){ sec = Math.abs(sec); return sec >= 86400 ? Math.round(sec / 86400) + 'd' : sec >= 3600 ? Math.round(sec / 3600) + 'h' : Math.round(sec / 60) + 'm'; }
function tag(x, y, txt, col, anchor){   // a small filled label
  var w = txt.length * 7 + 12, x0 = anchor === 'end' ? x - w : x;
  return '<rect x="' + x0.toFixed(1) + '" y="' + (y - 11).toFixed(1) + '" width="' + w + '" height="22" rx="4" fill="' + col + '"/><text x="' + (x0 + 6).toFixed(1) + '" y="' + (y + 4.5).toFixed(1) + '" class="dr-tt" fill="#141414">' + esc(txt) + '</text>';
}

/* Returns { svg, segs:[[x1,y1,x2,y2]], polys:[[{x,y}]], boxes:[{x,y,w,h}], handles:[{x,y}], bb:[x0,y0,x1,y1] }. */
DR.shape = function(d, ctx, mode){
  var P = d.pts.map(function(q){ return { x:ctx.X(q.t), y:ctx.Y(q.p) }; }), col = d.col || COLS[0], w = (d.w || 2) + (mode === 'hover' ? 1 : 0);
  var out = { svg:'', segs:[], polys:[], boxes:[], handles:P.slice(), bb:null };
  var st = 'stroke="' + col + '" stroke-width="' + w + '" fill="none"' + (d.dash ? ' stroke-dasharray="6 4"' : '') + ' stroke-linecap="round" stroke-linejoin="round"';
  var seg = function(a, b, extra){ out.segs.push([a.x, a.y, b.x, b.y]); return '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '" ' + (extra || st) + '/>'; };
  var need = NPTS[d.type];
  if(d.type !== 'brush' && P.length < need){   // still being placed: show what there is so far
    if(P.length > 1) out.svg += '<polyline points="' + P.map(function(p){ return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ') + '" ' + st + ' stroke-dasharray="4 4"/>';
    return finish(out, P, col);
  }
  var a = P[0], b = P[1], c = P[2], L = ctx.L, R = ctx.R, T = ctx.T, B = ctx.B, fmt = ctx.fmt;
  switch(d.type){
    case 'trend': out.svg += seg(a, b); break;
    case 'ray': out.svg += seg(a, ext(a, b, 6000)); break;
    case 'ext': out.svg += seg(ext(b, a, 6000), ext(a, b, 6000)); break;
    case 'hline': out.svg += seg({ x:L, y:a.y }, { x:R, y:a.y }) + tag(R - 4, a.y, fmt(d.pts[0].p), col, 'end'); break;
    case 'hray': out.svg += seg(a, { x:R, y:a.y }) + tag(R - 4, a.y, fmt(d.pts[0].p), col, 'end'); break;
    case 'vline': out.svg += seg({ x:a.x, y:T }, { x:a.x, y:B }); break;
    case 'channel': {
      var sl = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x), off = c.y - (a.y + sl * (c.x - a.x)), a2 = { x:a.x, y:a.y + off }, b2 = { x:b.x, y:b.y + off };
      out.svg += '<polygon points="' + [a, b, b2, a2].map(function(p){ return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ') + '" fill="' + col + '" opacity=".1"/>' + seg(a, b) + seg(a2, b2) +
        seg({ x:a.x, y:a.y + off / 2 }, { x:b.x, y:b.y + off / 2 }, st.replace('fill="none"', 'fill="none" opacity=".6"') + ' stroke-dasharray="4 4"');
      out.polys.push([a, b, b2, a2]); out.handles = [a, b, { x:c.x, y:a.y + sl * (c.x - a.x) + off }];
      break;
    }
    case 'fib': {
      var x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x, x0 + 90), lv = FIB.map(function(f){ return d.pts[1].p + (d.pts[0].p - d.pts[1].p) * f; });
      out.svg += seg(a, b, 'stroke="' + col + '" stroke-width="1" stroke-dasharray="3 4" opacity=".7"');
      lv.forEach(function(p, k){
        var y = ctx.Y(p);
        if(k) out.svg += '<rect x="' + x0.toFixed(1) + '" y="' + Math.min(y, ctx.Y(lv[k - 1])).toFixed(1) + '" width="' + (x1 - x0).toFixed(1) + '" height="' + Math.abs(y - ctx.Y(lv[k - 1])).toFixed(1) + '" fill="' + FIBC[k] + '" opacity=".08"/>';
        out.svg += seg({ x:x0, y:y }, { x:x1, y:y }, 'stroke="' + FIBC[k] + '" stroke-width="' + (w > 2 ? 2 : 1.3) + '"') +
          '<text class="dr-t" x="' + (x0 + 4).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" fill="' + FIBC[k] + '">' + FIB[k] + ' (' + fmt(p) + ')</text>';
      });
      break;
    }
    case 'fibext': {
      var dlt = d.pts[1].p - d.pts[0].p, xs = c.x, xe = Math.max(R, xs + 100);
      out.svg += seg(a, b, 'stroke="' + col + '" stroke-width="1" stroke-dasharray="3 4" opacity=".7"') + seg(b, c, 'stroke="' + col + '" stroke-width="1" stroke-dasharray="3 4" opacity=".7"');
      FEXT.forEach(function(f, k){
        var p = d.pts[2].p + dlt * f, y = ctx.Y(p);
        out.svg += seg({ x:xs, y:y }, { x:xe, y:y }, 'stroke="' + FEXC[k] + '" stroke-width="1.3"') + '<text class="dr-t" x="' + (xs + 4).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" fill="' + FEXC[k] + '">' + FEXT[k] + ' (' + fmt(p) + ')</text>';
      });
      break;
    }
    case 'rect': {
      var rx = Math.min(a.x, b.x), ry = Math.min(a.y, b.y), rw = Math.abs(b.x - a.x), rh = Math.abs(b.y - a.y);
      out.svg += '<rect x="' + rx.toFixed(1) + '" y="' + ry.toFixed(1) + '" width="' + rw.toFixed(1) + '" height="' + rh.toFixed(1) + '" fill="' + col + '" fill-opacity=".12" ' + st.replace('fill="none"', '') + '/>';
      out.boxes.push({ x:rx, y:ry, w:rw, h:rh, fill:true }); out.segs.push([rx, ry, rx + rw, ry], [rx + rw, ry, rx + rw, ry + rh], [rx + rw, ry + rh, rx, ry + rh], [rx, ry + rh, rx, ry]);
      break;
    }
    case 'ellipse': {
      var ex = (a.x + b.x) / 2, ey = (a.y + b.y) / 2, erx = Math.abs(b.x - a.x) / 2, ery = Math.abs(b.y - a.y) / 2;
      out.svg += '<ellipse cx="' + ex.toFixed(1) + '" cy="' + ey.toFixed(1) + '" rx="' + erx.toFixed(1) + '" ry="' + ery.toFixed(1) + '" fill="' + col + '" fill-opacity=".1" ' + st.replace('fill="none"', '') + '/>';
      out.ell = { cx:ex, cy:ey, rx:erx, ry:ery };
      break;
    }
    case 'triangle': {
      out.svg += '<polygon points="' + P.map(function(p){ return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ') + '" fill="' + col + '" fill-opacity=".12" ' + st.replace('fill="none"', '') + '/>';
      out.polys.push(P.slice()); out.segs.push([a.x, a.y, b.x, b.y], [b.x, b.y, c.x, c.y], [c.x, c.y, a.x, a.y]);
      break;
    }
    case 'brush': {
      if(P.length > 1){ out.svg += '<path d="' + P.map(function(p, i){ return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join('') + '" ' + st + '/>'; for(var i = 1; i < P.length; i++) out.segs.push([P[i - 1].x, P[i - 1].y, P[i].x, P[i].y]); }
      out.handles = [];
      break;
    }
    case 'text': {
      var txt = d.txt || 'Text', tw = txt.length * 7.6 + 16;
      out.svg += '<rect x="' + a.x.toFixed(1) + '" y="' + (a.y - 14).toFixed(1) + '" width="' + tw.toFixed(1) + '" height="28" rx="6" fill="var(--fh-background-surface-elevated)" stroke="' + col + '" stroke-width="' + (w > 2 ? 2 : 1.2) + '"/>' +
        '<text x="' + (a.x + 8).toFixed(1) + '" y="' + (a.y + 5).toFixed(1) + '" class="dr-tt big" fill="' + col + '">' + esc(txt) + '</text>';
      out.boxes.push({ x:a.x, y:a.y - 14, w:tw, h:28, fill:true });
      break;
    }
    case 'label': {
      var lt = fmt(d.pts[0].p), lw = lt.length * 7.4 + 14;
      out.svg += '<path d="M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + 'l9 -12h' + lw.toFixed(1) + 'v24h-' + lw.toFixed(1) + 'z" fill="' + col + '"/><text x="' + (a.x + 14).toFixed(1) + '" y="' + (a.y + 4.5).toFixed(1) + '" class="dr-tt big" fill="#141414">' + lt + '</text>';
      out.boxes.push({ x:a.x, y:a.y - 12, w:lw + 9, h:24, fill:true });
      break;
    }
    case 'arrowup': case 'arrowdn': {
      var s = d.type === 'arrowup' ? 1 : -1, pts = [[0, 0], [-11, 13 * s], [-4, 13 * s], [-4, 32 * s], [4, 32 * s], [4, 13 * s], [11, 13 * s]].map(function(q){ return { x:a.x + q[0], y:a.y + q[1] }; });
      out.svg += '<polygon points="' + pts.map(function(p){ return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ') + '" fill="' + col + '" stroke="var(--fh-background-surface)" stroke-width="1"/>';
      out.boxes.push({ x:a.x - 11, y:Math.min(a.y, a.y + 32 * s), w:22, h:32, fill:true });
      break;
    }
    case 'long': case 'short': {
      var entry = d.pts[0], stop = d.pts[1], tgt = d.pts[2], x0p = a.x, x1p = Math.max(b.x, a.x + 20), ys = b.y, yt = c.y, up = d.type === 'long';
      var risk = Math.abs(entry.p - stop.p) || 1e-9, reward = Math.abs(tgt.p - entry.p);
      var pcts = function(p){ return (p >= entry.p ? '+' : '−') + Math.abs((p / entry.p - 1) * 100).toFixed(2) + '%'; };
      out.svg += '<rect x="' + x0p.toFixed(1) + '" y="' + Math.min(a.y, yt).toFixed(1) + '" width="' + (x1p - x0p).toFixed(1) + '" height="' + Math.abs(yt - a.y).toFixed(1) + '" fill="' + GREEN + '" opacity=".22"/>' +
        '<rect x="' + x0p.toFixed(1) + '" y="' + Math.min(a.y, ys).toFixed(1) + '" width="' + (x1p - x0p).toFixed(1) + '" height="' + Math.abs(ys - a.y).toFixed(1) + '" fill="' + RED + '" opacity=".22"/>' +
        seg({ x:x0p, y:a.y }, { x:x1p, y:a.y }, 'stroke="' + col + '" stroke-width="1.5"') +
        '<text class="dr-t" x="' + (x0p + 6).toFixed(1) + '" y="' + (yt + (yt < a.y ? 14 : -6)).toFixed(1) + '" fill="' + GREEN + '">Target ' + fmt(tgt.p) + ' (' + pcts(tgt.p) + ')</text>' +
        '<text class="dr-t" x="' + (x0p + 6).toFixed(1) + '" y="' + (ys + (ys > a.y ? -6 : 14)).toFixed(1) + '" fill="' + RED + '">Stop ' + fmt(stop.p) + ' (' + pcts(stop.p) + ')</text>' +
        '<text class="dr-t big" x="' + (x0p + 6).toFixed(1) + '" y="' + (a.y - 6).toFixed(1) + '" fill="' + col + '">' + (up ? 'Long' : 'Short') + ' · risk/reward ' + (reward / risk).toFixed(2) + '</text>';
      out.boxes.push({ x:x0p, y:Math.min(a.y, yt, ys), w:x1p - x0p, h:Math.max(a.y, yt, ys) - Math.min(a.y, yt, ys), fill:true });
      out.handles = [a, { x:x1p, y:ys }, { x:x1p, y:yt }];
      break;
    }
    case 'measure': {
      var up2 = d.pts[1].p >= d.pts[0].p, mc = up2 ? GREEN : RED, dp = d.pts[1].p - d.pts[0].p, mx = Math.min(a.x, b.x), my = Math.min(a.y, b.y), mw = Math.abs(b.x - a.x), mh = Math.abs(b.y - a.y);
      var info = (dp >= 0 ? '+' : '−') + fmt(Math.abs(dp)) + ' (' + (dp >= 0 ? '+' : '−') + Math.abs(dp / d.pts[0].p * 100).toFixed(2) + '%)  ·  ' + ctx.bars(d.pts[0].t, d.pts[1].t) + ' bars  ·  ' + dur(d.pts[1].t - d.pts[0].t);
      out.svg += '<rect x="' + mx.toFixed(1) + '" y="' + my.toFixed(1) + '" width="' + mw.toFixed(1) + '" height="' + mh.toFixed(1) + '" fill="' + mc + '" opacity=".14"/>' +
        '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '" stroke="' + mc + '" stroke-width="1.6"/>' +
        '<rect x="' + (mx + mw / 2 - info.length * 3.6 - 8).toFixed(1) + '" y="' + (up2 ? my - 30 : my + mh + 8).toFixed(1) + '" width="' + (info.length * 7.2 + 16).toFixed(1) + '" height="24" rx="5" fill="' + mc + '"/>' +
        '<text x="' + (mx + mw / 2).toFixed(1) + '" y="' + (up2 ? my - 14 : my + mh + 24).toFixed(1) + '" text-anchor="middle" class="dr-tt" fill="#fff">' + esc(info) + '</text>';
      out.boxes.push({ x:mx, y:my, w:mw, h:mh, fill:true });
      break;
    }
  }
  return finish(out, P, col);
};
function finish(out, P, col){
  var xs = [], ys = [];
  (out.handles.length ? out.handles : P).forEach(function(p){ xs.push(p.x); ys.push(p.y); });
  out.segs.forEach(function(s){ if(Math.abs(s[0]) < 1e4 && Math.abs(s[2]) < 1e4){ xs.push(s[0], s[2]); ys.push(s[1], s[3]); } });
  out.boxes.forEach(function(b){ xs.push(b.x, b.x + b.w); ys.push(b.y, b.y + b.h); });
  out.bb = xs.length ? [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)] : null;
  out.col = col;
  return out;
}
/* Distance in pixels from a point to a drawing (0 when inside a filled one); Infinity when far. */
DR.dist = function(sh, x, y){
  var m = Infinity;
  sh.segs.forEach(function(s){ m = Math.min(m, dist2seg(x, y, s)); });
  sh.boxes.forEach(function(b){ if(b.fill && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) m = 0; });
  sh.polys.forEach(function(p){ if(p.length > 2 && inPoly(x, y, p)) m = Math.min(m, 0); });
  if(sh.ell && sh.ell.rx > 0 && sh.ell.ry > 0){ var nx = (x - sh.ell.cx) / sh.ell.rx, ny = (y - sh.ell.cy) / sh.ell.ry, q = Math.hypot(nx, ny); if(q <= 1) m = 0; else m = Math.min(m, (q - 1) * Math.min(sh.ell.rx, sh.ell.ry)); }
  return m;
};
DR.handleAt = function(sh, x, y){
  for(var i = sh.handles.length - 1; i >= 0; i--) if(Math.hypot(x - sh.handles[i].x, y - sh.handles[i].y) <= 9) return i;
  return -1;
};

/* ------------------------------------------------------------------ chart plumbing */
function ctxOf(c){
  var g = c.geo, r = c.main();
  return { r:r, g:g, L:g.padL, R:g.padL + g.plotW, T:g.padT, B:g.padT + g.plotH,
    X:function(t){ return g.X(chI(r, t)); }, Y:g.Y,
    invT:function(x){ return chT(r, c.i0 + (x - g.padL) / g.ppb); },
    invP:function(y){ return g.hi - (y - g.padT) / g.plotH * (g.hi - g.lo); },
    fmt:function(p){ return num(p, Math.abs(p) < 10 ? 4 : 2); },
    bars:function(t1, t2){ return Math.round(Math.abs(chI(r, t2) - chI(r, t1))); } };
}
function local(c, e){ var rc = c.svg.getBoundingClientRect(); return { x:e.clientX - rc.left, y:e.clientY - rc.top }; }
function inPlot(ctx, p){ return p.x >= ctx.L - 2 && p.x <= ctx.R + 2 && p.y >= ctx.T - 2 && p.y <= ctx.B + 2; }
function snap(c, ctx, p){
  var t = ctx.invT(p.x), v = ctx.invP(p.y);
  if(!S.magnet) return { t:t, p:v };
  var i = clamp(Math.round(c.i0 + (p.x - ctx.g.padL) / ctx.g.ppb), 0, ctx.r.length - 1), row = ctx.r[i], best = v, bd = Infinity;
  if(!row) return { t:t, p:v };
  [row.o, row.h, row.l, row.c].forEach(function(q){ if(isFinite(q) && Math.abs(q - v) < bd){ bd = Math.abs(q - v); best = q; } });
  return { t:row.t, p:best };
}
function symOf(c){ return c.o.draw.sym(); }
function usable(c){ return c && c.o && c.o.draw && c.geo && !c.geo.pct; }
function hitTest(c, ctx, p){
  var list = S.hide ? [] : DR.items(symOf(c)), best = null;
  for(var i = list.length - 1; i >= 0; i--){
    var sh = DR.shape(list[i], ctx), isSel = S.sel === list[i].id, hd = isSel ? DR.handleAt(sh, p.x, p.y) : -1;
    if(hd >= 0) return { d:list[i], sh:sh, handle:hd };
    var dd = DR.dist(sh, p.x, p.y);
    if(dd <= 7 && (!best || dd < best.dd)) best = { d:list[i], sh:sh, handle:-1, dd:dd };
  }
  return best;
}
function touch(c){ S.tick++; c.soon(); if(DR.hooks.sync) DR.hooks.sync(); }

DR.render = function(c){
  if(!usable(c) || S.hide) return '';
  var ctx = ctxOf(c), sym = symOf(c), s = '';
  DR.items(sym).forEach(function(d){
    var sh = DR.shape(d, ctx, S.hov === d.id && !S.drag ? 'hover' : ''), sel = S.sel === d.id;
    s += '<g class="dr-d' + (sel ? ' sel' : '') + '">' + sh.svg + '</g>';
    if(sel) sh.handles.forEach(function(h){ s += '<circle class="dr-h" cx="' + h.x.toFixed(1) + '" cy="' + h.y.toFixed(1) + '" r="5.5"/>'; });
  });
  var dr = S.draft;
  if(dr && dr.c === c){
    var pts = dr.brush ? dr.d.pts : dr.placed.concat(dr.cur ? [dr.cur] : []);
    s += '<g class="dr-d draft">' + DR.shape({ type:dr.d.type, pts:pts, col:dr.d.col, w:dr.d.w, dash:dr.d.dash }, ctx).svg + '</g>';
    dr.placed && dr.placed.forEach(function(q){ s += '<circle class="dr-h" cx="' + ctx.X(q.t).toFixed(1) + '" cy="' + ctx.Y(q.p).toFixed(1) + '" r="4.5"/>'; });
  }
  if(S.measure && S.measure.c === c) s += '<g class="dr-d">' + DR.shape(S.measure.d, ctx).svg + '</g>';
  return s;
};

/* ------------------------------------------------------------------ creating drawings */
function defaults(d, c, ctx, pt){   // positions open with a stop and a target around the entry
  if(d.type !== 'long' && d.type !== 'short') return;
  var span = (ctx.g.hi - ctx.g.lo) * .12, i0 = c.i0 + (pt.x - ctx.g.padL) / ctx.g.ppb, tEnd = chT(ctx.r, i0 + Math.max(10, (c.i1 - c.i0) * .18)), up = d.type === 'long', e = d.pts[0].p;
  d.pts = [d.pts[0], { t:tEnd, p:e + (up ? -span / 2 : span / 2) }, { t:tEnd, p:e + (up ? span : -span) }];
}
function commit(c, d){
  var sym = symOf(c);
  if(d.type === 'measure'){ S.measure = { c:c, d:d }; }
  else { pushUndo(sym); itemsW(sym).push(d); persist(); S.sel = d.id; S.measure = null; }
  S.draft = null;
  if(!S.stay) { S.tool = 'cross'; }
  S.mark = performance.now();
  touch(c);
}
function begin(c, ctx, p, e){
  var pt = snap(c, ctx, p), tool = S.tool;
  var d = { id:newId(), type:tool, pts:[{ t:pt.t, p:pt.p }], col:S.col, w:S.w };
  S.measure = null; S.sel = null;
  if(tool === 'text'){
    askText('Text', 'Note', '', function(v){ d.txt = (v || '').trim() || 'Text'; commit(c, d); });
    return;
  }
  if(NPTS[tool] === 1){ defaults(d, c, ctx, p); commit(c, d); return; }
  if(tool === 'brush'){ S.draft = { c:c, d:d, brush:true, last:p }; c.soon(); return; }
  S.draft = { c:c, d:d, placed:[pt], cur:pt, need:NPTS[tool], down:p, dragMode:true };
  c.soon();
}
function addPoint(c, ctx, p){
  var D = S.draft, pt = snap(c, ctx, p);
  D.placed.push(pt); D.cur = pt;
  if(D.placed.length >= D.need){ D.d.pts = D.placed.slice(); commit(c, D.d); }
  else c.soon();
}

/* ------------------------------------------------------------------ pointer handling (called from chartView) */
DR.down = function(c, e){
  if(!usable(c) || (e.pointerType === 'mouse' && e.button !== 0)) return false;
  var ctx = ctxOf(c), p = local(c, e);
  if(!inPlot(ctx, p)) return false;
  if(S.draft && S.draft.c === c && !S.draft.brush){ addPoint(c, ctx, p); return true; }
  if(isDraw(S.tool) && !S.hide){
    begin(c, ctx, p, e);
    try{ c.svg.setPointerCapture(e.pointerId); }catch(x){}
    return true;
  }
  var h = hitTest(c, ctx, p);
  if(S.tool === 'eraser'){
    if(h){ var sym = symOf(c); pushUndo(sym); store()[sym] = DR.items(sym).filter(function(d){ return d !== h.d; }); persist(); if(S.sel === h.d.id) S.sel = null; touch(c); }
    return true;
  }
  if(h){
    S.sel = h.d.id;
    if(!h.d.locked && !S.lock){
      pushUndo(symOf(c));
      S.drag = { d:h.d, handle:h.handle, p0:p, orig:clone(h.d.pts), moved:false, i0:c.i0 };
      try{ c.svg.setPointerCapture(e.pointerId); }catch(x){}
    }
    touch(c); return true;
  }
  S.measure = null;
  if(S.sel){ S.sel = null; touch(c); }
  return false;
};
DR.move = function(c, e){
  if(!usable(c)) return false;
  var ctx = ctxOf(c), p = local(c, e), D = S.draft;
  if(D && D.c === c){
    if(D.brush){
      if(Math.hypot(p.x - D.last.x, p.y - D.last.y) > 3){ var q = snap(c, ctx, p); D.d.pts.push({ t:q.t, p:q.p }); D.last = p; c.soon(); }
    } else { D.cur = snap(c, ctx, p); c.soon(); }
    c.hoverOut(); return true;
  }
  if(S.drag){
    var k = S.drag, d = k.d, g = ctx.g;
    if(Math.hypot(p.x - k.p0.x, p.y - k.p0.y) > 2) k.moved = true;
    var pt = snap(c, ctx, p);
    if(k.handle >= 0 && d.type !== 'brush'){
      if(d.type === 'long' || d.type === 'short'){
        if(k.handle === 0) d.pts[0] = { t:pt.t, p:pt.p };
        else { d.pts[k.handle] = { t:d.pts[k.handle].t, p:pt.p }; d.pts[1].t = d.pts[2].t = pt.t; }
      } else d.pts[k.handle] = { t:pt.t, p:pt.p };
    } else {
      var di = (p.x - k.p0.x) / g.ppb, dpP = ctx.invP(p.y) - ctx.invP(k.p0.y);
      d.pts = k.orig.map(function(q){ var i = chI(ctx.r, q.t) + di; return { t:chT(ctx.r, i), p:q.p + dpP }; });
    }
    c.hoverOut(); c.soon(); return true;
  }
  if(!inPlot(ctx, p)){ c.svg.style.cursor = ''; return false; }
  if(isDraw(S.tool) && !S.hide){ c.svg.style.cursor = 'crosshair'; return false; }
  var h = hitTest(c, ctx, p), id = h ? h.d.id : null;
  c.svg.style.cursor = S.tool === 'eraser' ? (h ? 'not-allowed' : '') : h ? (h.handle >= 0 ? 'grab' : 'move') : '';
  if(id !== S.hov){ S.hov = id; c.soon(); }
  return false;
};
DR.up = function(c, e){
  if(!usable(c)) return false;
  if(S.drag){
    var k = S.drag; S.drag = null;
    if(k.moved) persist(); else UNDO.pop();
    c.soon(); return true;
  }
  var D = S.draft;
  if(D && D.c === c){
    var ctx = ctxOf(c), p = local(c, e);
    if(D.brush){
      if(D.d.pts.length > 1) commit(c, D.d); else { S.draft = null; c.soon(); }
      return true;
    }
    if(D.dragMode && D.placed.length === 1){
      if(Math.hypot(p.x - D.down.x, p.y - D.down.y) > 7) addPoint(c, ctx, p); else D.dragMode = false;
    }
    return true;
  }
  return false;
};
DR.dbl = function(c, e){
  if(!usable(c)) return false;
  if(S.mark && performance.now() - S.mark < 600) return true;   // the second click of a double-click that placed a point
  var ctx = ctxOf(c), p = local(c, e), h = hitTest(c, ctx, p);
  if(!h) return false;
  if(h.d.type === 'text') askText('Edit text', 'Note', h.d.txt || '', function(v){ pushUndo(symOf(c)); h.d.txt = (v || '').trim() || 'Text'; persist(); touch(c); });
  return true;
};

/* ------------------------------------------------------------------ actions */
DR.hooks = { chart:function(){ return null; }, sync:null, fullscreen:null };
DR.setTool = function(t){
  S.tool = t; S.draft = null; S.fly = null;
  GROUPS.forEach(function(g){ if(g.tools.some(function(x){ return x[0] === t; })) S.last[g.id] = t; });
  if(isDraw(t)){ S.sel = null; S.hide = false; saveSet(); }
  var c = DR.hooks.chart(); if(c){ c.svg.style.cursor = isDraw(t) ? 'crosshair' : ''; c.soon(); }
  if(DR.hooks.sync) DR.hooks.sync();
};
DR.toggle = function(k){
  S[k] = !S[k]; if(k === 'hide' && S.hide){ S.sel = null; S.draft = null; }
  saveSet(); var c = DR.hooks.chart(); if(c) c.soon(); if(DR.hooks.sync) DR.hooks.sync();
};
DR.removeSel = function(){
  var c = DR.hooks.chart(); if(!c || !S.sel) return;
  var sym = symOf(c), d = DR.items(sym).filter(function(x){ return x.id === S.sel; })[0];
  if(!d || d.locked) return;
  pushUndo(sym); store()[sym] = DR.items(sym).filter(function(x){ return x.id !== S.sel; }); S.sel = null; persist(); touch(c);
};
DR.clearAll = function(){
  var c = DR.hooks.chart(); if(!c || !usable(c)) return;
  var sym = symOf(c); if(!DR.items(sym).length){ if(typeof toast === 'function') toast('No drawings on ' + sym + '.'); return; }
  if(!confirm('Remove all ' + DR.items(sym).length + ' drawings on ' + sym + '?')) return;
  pushUndo(sym); store()[sym] = []; S.sel = null; persist(); touch(c);
};
DR.undo = function(){
  var u = UNDO.pop(), c = DR.hooks.chart(); if(!u) return;
  store()[u.sym] = JSON.parse(u.json); S.sel = null; persist(); if(c) touch(c);
};
DR.cancel = function(){   // Esc: first the half-drawn shape, then the tool, then the selection
  var c = DR.hooks.chart();
  if(S.draft){ S.draft = null; if(c) c.soon(); return true; }
  if(isDraw(S.tool)){ DR.setTool('cross'); return true; }
  if(S.sel || S.measure){ S.sel = null; S.measure = null; if(c) touch(c); return true; }
  return false;
};
function style(patch){
  var c = DR.hooks.chart(); if(!c || !S.sel) return;
  var d = DR.items(symOf(c)).filter(function(x){ return x.id === S.sel; })[0]; if(!d) return;
  pushUndo(symOf(c)); Object.assign(d, patch); if(patch.col){ S.col = patch.col; saveSet(); } persist(); touch(c);
}
DR.duplicate = function(){
  var c = DR.hooks.chart(); if(!c || !S.sel) return;
  var sym = symOf(c), d = DR.items(sym).filter(function(x){ return x.id === S.sel; })[0]; if(!d) return;
  pushUndo(sym); var n = clone(d), ctx = ctxOf(c); n.id = newId();
  n.pts = n.pts.map(function(q){ return { t:chT(ctx.r, chI(ctx.r, q.t) + 4), p:q.p - (ctx.g.hi - ctx.g.lo) * .03 }; });
  itemsW(sym).push(n); S.sel = n.id; persist(); touch(c);
};

/* the floating style bar above the selected drawing */
DR.ui = function(c){
  var host = c.svg.parentNode, el = host.querySelector('.dr-float');
  var d = usable(c) && !S.hide && !S.draft && S.sel ? DR.items(symOf(c)).filter(function(x){ return x.id === S.sel; })[0] : null;
  if(!d){ if(el) el.hidden = true; return; }
  if(!el){
    el = document.createElement('div'); el.className = 'dr-float'; host.appendChild(el);
    el.addEventListener('pointerdown', function(ev){ ev.stopPropagation(); });
    el.addEventListener('click', function(ev){
      ev.stopPropagation();
      var b = ev.target.closest('[data-a]'); if(!b) return;
      var a = b.getAttribute('data-a'), v = b.getAttribute('data-v');
      if(a === 'col') style({ col:v }); else if(a === 'w') style({ w:+v });
      else if(a === 'dash') style({ dash:!(DR.cur(c) || {}).dash });
      else if(a === 'lock') style({ locked:!(DR.cur(c) || {}).locked });
      else if(a === 'dup') DR.duplicate(); else if(a === 'del') DR.removeSel();
    });
  }
  var sig = d.id + '|' + d.col + '|' + d.w + '|' + !!d.dash + '|' + !!d.locked + '|' + S.tick;
  if(el._sig !== sig){
    el._sig = sig;
    el.innerHTML = COLS.map(function(k){ return '<button class="sw' + (d.col === k ? ' on' : '') + '" data-a="col" data-v="' + k + '" style="background:' + k + '" aria-label="Colour"></button>'; }).join('') + '<i></i>' +
      [1, 2, 3, 4].map(function(n){ return '<button class="wd' + ((d.w || 2) === n ? ' on' : '') + '" data-a="w" data-v="' + n + '" title="Line width ' + n + '"><b style="height:' + n + 'px"></b></button>'; }).join('') +
      '<button data-a="dash" class="' + (d.dash ? 'on' : '') + '" title="Dashed">- -</button><i></i>' +
      '<button data-a="lock" class="' + (d.locked ? 'on' : '') + '" title="' + (d.locked ? 'Unlock' : 'Lock') + '">' + icon(d.locked ? 'lock' : 'unlock', 17) + '</button>' +
      '<button data-a="dup" title="Duplicate">' + icon('copy', 17) + '</button><button data-a="del" title="Delete (Del)">' + icon('trash', 17) + '</button>';
  }
  var sh = DR.shape(d, ctxOf(c)), bb = sh.bb;
  el.hidden = false;
  if(bb){
    var rc = host.getBoundingClientRect();
    el.style.left = clamp((bb[0] + bb[2]) / 2 - el.offsetWidth / 2, 6, Math.max(6, c.svg.clientWidth - el.offsetWidth - 6)) + 'px';
    el.style.top = clamp(bb[1] - el.offsetHeight - 12, 6, Math.max(6, c.svg.clientHeight - el.offsetHeight - 40)) + 'px';
  }
};
DR.cur = function(c){ return DR.items(symOf(c)).filter(function(x){ return x.id === S.sel; })[0]; };

/* ------------------------------------------------------------------ the left toolbar */
DR.barHTML = function(){
  var h = '<div class="dr-bar" id="drBar" role="toolbar" aria-label="Drawing tools">';
  GROUPS.forEach(function(g){
    var cur = S.last[g.id] || g.tools[0][0], on = g.tools.some(function(x){ return x[0] === S.tool; });
    var name = g.tools.filter(function(x){ return x[0] === cur; })[0];
    h += '<div class="dr-grp' + (S.fly === g.id ? ' open' : '') + '" data-g="' + g.id + '"><button class="dr-b' + (on ? ' on' : '') + '" data-act="dr-tool" data-tool="' + cur + '" title="' + esc(name[1] + (name[2] ? ' (' + name[2] + ')' : '')) + '">' + icon(cur) + '</button>' +
      '<button class="dr-more" data-act="dr-fly" data-g="' + g.id + '" aria-label="More ' + esc(g.name) + '">›</button>' +
      '<div class="dr-fly"><div class="mhead">' + esc(g.name) + '</div>' + g.tools.map(function(t){
        return '<button class="dr-i' + (S.tool === t[0] ? ' on' : '') + '" data-act="dr-tool" data-tool="' + t[0] + '">' + icon(t[0], 20) + '<span>' + esc(t[1]) + '</span>' + (t[2] ? '<kbd>' + t[2] + '</kbd>' : '') + '</button>'; }).join('') + '</div></div>';
  });
  h += '<i class="dr-sep"></i>' +
    '<button class="dr-b' + (S.magnet ? ' on' : '') + '" data-act="dr-toggle" data-k="magnet" title="Magnet: snap to the open, high, low or close">' + icon('magnet') + '</button>' +
    '<button class="dr-b' + (S.stay ? ' on' : '') + '" data-act="dr-toggle" data-k="stay" title="Stay in drawing mode">' + icon('stay') + '</button>' +
    '<button class="dr-b' + (S.lock ? ' on' : '') + '" data-act="dr-toggle" data-k="lock" title="Lock all drawings">' + icon(S.lock ? 'lock' : 'unlock') + '</button>' +
    '<button class="dr-b' + (S.hide ? ' on' : '') + '" data-act="dr-toggle" data-k="hide" title="Hide all drawings">' + icon(S.hide ? 'eyeoff' : 'eye') + '</button>' +
    '<button class="dr-b" data-act="dr-clear" title="Remove all drawings">' + icon('trash') + '</button></div>';
  return h;
};
DR.syncBar = function(){   // repaint the toolbar in place (keeps scroll and hover)
  var bar = document.getElementById('drBar'); if(!bar) return;
  var tmp = document.createElement('div'); tmp.innerHTML = DR.barHTML();
  bar.innerHTML = tmp.firstChild.innerHTML;
};
DR.fly = function(g){ S.fly = S.fly === g ? null : g; DR.syncBar(); };
DR.closeFly = function(){ if(S.fly){ S.fly = null; DR.syncBar(); } };

/* ------------------------------------------------------------------ keyboard */
document.addEventListener('keydown', function(e){
  var c = DR.hooks.chart(); if(!c || !usable(c)) { if(e.code === 'KeyF' && e.shiftKey && DR.hooks.fullscreen && !/INPUT|TEXTAREA/.test((e.target || {}).tagName || '')) { e.preventDefault(); DR.hooks.fullscreen(); } return; }
  var tg = e.target || {}; if(/INPUT|TEXTAREA|SELECT/.test(tg.tagName || '') || tg.isContentEditable) return;
  if(e.altKey && !e.ctrlKey && !e.metaKey){
    var t = { KeyT:'trend', KeyH:'hline', KeyV:'vline', KeyF:'fib' }[e.code];
    if(t){ e.preventDefault(); DR.setTool(t); return; }
  }
  if(e.code === 'KeyF' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey){ e.preventDefault(); if(DR.hooks.fullscreen) DR.hooks.fullscreen(); return; }
  if((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey){ e.preventDefault(); DR.undo(); return; }
  if(e.key === 'Delete' || e.key === 'Backspace'){ if(S.sel){ e.preventDefault(); DR.removeSel(); } return; }
  if(e.key === 'Escape'){ if(DR.cancel()) e.stopImmediatePropagation(); }
}, true);

root.DR = DR;
if(typeof module !== 'undefined' && module.exports) module.exports = DR;
})(typeof window !== 'undefined' ? window : globalThis);
