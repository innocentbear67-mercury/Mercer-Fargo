/* The Terminal home: a desk the user arranges, a call book that keeps their track record, a brief of what changed
   since they were last here, and a command palette (Ctrl/Cmd+K). Loaded before the main script and only touches the
   page's globals (PFS, DATA, CUR, CFG, INBOX, EARNINGS ...) inside functions, so load order does not matter. */

var DESK = { edit:false, mk:'gainers', form:null, all:false, visit:undefined, drag:'', snapped:false };
var DESK_MODS = [
  { id:'brief',     t:'Since you were last here', on:1 },
  { id:'portfolio', t:'Portfolio at a glance',    on:1 },
  { id:'calls',     t:'Call book',                on:1 },
  { id:'watch',     t:'Watchlist movers',         on:1 },
  { id:'market',    t:'Market movers',            on:1 },
  { id:'news',      t:'Market news',              on:1 },
  { id:'earnings',  t:'Earnings calendar',        on:1 },
  { id:'trh',       t:'Market-wide movers',       on:0 }
];

/* ---------------------------------------------------------------- layout (order + hidden modules) */
function deskState(){
  var s = load('fh3_desk', {}), ids = DESK_MODS.map(function(m){ return m.id; });
  var order = (s.order || []).filter(function(i){ return ids.indexOf(i) >= 0; });
  ids.forEach(function(i){ if(order.indexOf(i) < 0) order.push(i); });
  var off = s.off || DESK_MODS.filter(function(m){ return !m.on; }).map(function(m){ return m.id; });
  return { order:order, off:off.filter(function(i){ return ids.indexOf(i) >= 0; }) };
}
function deskSave(s){ save('fh3_desk', s); }
function deskMod(id){ return DESK_MODS.filter(function(m){ return m.id === id; })[0]; }

/* ---------------------------------------------------------------- the call book */
var CALLS = null;
function calls(){ return CALLS || (CALLS = load('fh3_calls', []).filter(function(c){ return c && c.id && c.s && c.px; })); }
function callsSave(){ save('fh3_calls', calls()); }
function callNow(c){ if(c.closed) return c.closed.px; var q = DATA.quotes[c.s]; return q && q.c != null ? q.c : null; }
function callRet(c){   // return in the direction of the call: a short that falls is a gain
  var n = callNow(c); if(n == null) return null;
  var r = (n / c.px - 1) * 100; r = c.side === 'short' ? -r : r; return Math.abs(r) < 0.005 ? 0 : r;   // never "-0.0%"
}
function callAlpha(c){   // points over the S&P 500 (SPY) across the same window, in the same direction
  var r = callRet(c), now = c.closed ? c.closed.spy : (DATA.quotes.SPY || {}).c;
  if(r == null || !c.spy || now == null) return null;
  var s = (now / c.spy - 1) * 100; return r - (c.side === 'short' ? -s : s);
}
function callAgo(t){
  var d = Math.floor((Date.now() - t) / 864e5);
  return d < 1 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? d + ' days ago' : Math.round(d / 30) + ' months ago';
}
function callScore(){
  var cs = calls().filter(function(c){ return c.side !== 'watch' && callRet(c) != null; });
  if(!cs.length) return null;
  var rets = cs.map(callRet), hit = rets.filter(function(r){ return r > 0; }).length;
  var al = cs.map(callAlpha).filter(function(a){ return a != null; });
  return { n:cs.length, hit:hit, avg:rets.reduce(function(a, b){ return a + b; }, 0) / cs.length, beat:al.filter(function(a){ return a > 0; }).length, of:al.length };
}
function dkCalls(){
  var all = calls().slice().sort(function(a, b){ return (a.closed ? 1 : 0) - (b.closed ? 1 : 0) || b.t - a.t; });
  var sc = callScore(), shown = DESK.all ? all : all.slice(0, 5), F = DESK.form;
  var score = sc ? '<span class="num">' + sc.n + ' call' + (sc.n === 1 ? '' : 's') + '</span> · <span class="num">' + Math.round(sc.hit / sc.n * 100) + '%</span> went your way · average <b class="num ' + (sc.avg >= 0 ? 'up' : 'down') + '">' + pct(sc.avg, 1) + '</b>' +
    (sc.of ? ' · beat the S&amp;P on <span class="num">' + sc.beat + ' of ' + sc.of + '</span>' : '') : (all.length ? 'Waiting for prices…' : 'Write down what you believe, with the price on the day. Your record builds from here.');
  var form = '';
  if(F){
    form = '<div class="ck-form">' +
      '<div class="ck-f1"><input id="ckSym" class="inp" placeholder="Ticker" value="' + esc(F.sym) + '" autocomplete="off" aria-label="Ticker">' +
      '<div class="tm-seg" role="group" aria-label="Stance">' + [['long', 'Long'], ['short', 'Short'], ['watch', 'Watch']].map(function(x){
        return '<button type="button" class="' + (F.side === x[0] ? 'on' : '') + '" data-act="ck-side" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<input id="ckTgt" class="inp" placeholder="Target price (optional)" value="' + esc(F.tgt) + '" inputmode="decimal" aria-label="Target price"></div>' +
      '<textarea id="ckNote" class="inp" rows="2" maxlength="240" placeholder="Why? One or two sentences you will be glad to read back." aria-label="Thesis">' + esc(F.note) + '</textarea>' +
      '<div class="ck-f2"><span class="mut">' + (F.err ? '<b class="down">' + esc(F.err) + '</b>' : 'The price today and the S&amp;P 500 are recorded when you save.') + '</span>' +
      '<span><button class="btn text" data-act="ck-cancel">Cancel</button><button class="btn filled" data-act="ck-save"' + (F.busy ? ' disabled' : '') + '>' + (F.busy ? 'Saving…' : 'Save call') + '</button></span></div></div>';
  }
  var rows = shown.map(function(c){
    var r = callRet(c), al = callAlpha(c), n = callNow(c), tg = c.tgt && n ? (c.tgt / n - 1) * 100 : null;
    return '<div class="ck-row' + (c.closed ? ' done' : '') + '" data-id="' + c.id + '">' +
      '<a class="ck-s" href="#/quote/' + encodeURIComponent(c.s) + '"><b>' + esc(c.s) + '</b><span class="ck-side ' + c.side + '">' + (c.closed ? 'Closed ' : '') + c.side + '</span></a>' +
      '<p class="ck-note">' + (c.note ? esc(c.note) : '<span class="mut">No note</span>') + '</p>' +
      '<div class="ck-r"><b class="num ' + (r == null ? 'mut' : r >= 0 ? 'up' : 'down') + '">' + (r == null ? '—' : pct(r, 1)) + '</b>' +
      '<small class="num mut">' + (al == null ? '' : (al >= 0 ? '+' : '−') + num(Math.abs(al), 1) + ' pts vs S&amp;P') + '</small></div>' +
      '<small class="ck-meta num mut">' + money(c.px, 'USD') + ' → ' + (n == null ? '…' : money(n, 'USD')) + ' · ' + callAgo(c.t) +
      (c.tgt && !c.closed ? ' · target ' + money(c.tgt, 'USD') + (tg != null ? ' (' + (tg >= 0 ? '' : '−') + num(Math.abs(tg), 0) + '% away)' : '') : '') + '</small>' +
      '<span class="ck-act">' + (c.closed ? '' : '<button data-act="ck-close" data-id="' + c.id + '">Close</button>') + '<button data-act="ck-del" data-id="' + c.id + '">Delete</button></span></div>';
  }).join('');
  return '<div class="section-head"><h2>Call book</h2>' + (F ? '' : '<button class="btn tonal sm" data-act="ck-new">+ New call</button>') + '</div>' +
    '<p class="ck-score">' + score + '</p>' + form + (rows ? '<div class="ck-list">' + rows + '</div>' : '') +
    (all.length > 5 ? '<button class="btn text sm" data-act="ck-all">' + (DESK.all ? 'Show fewer' : 'Show all ' + all.length) + '</button>' : '');
}
function ckSave(){
  var F = DESK.form; if(!F || F.busy) return;
  var sym = dispSym((F.sym || '').trim().toUpperCase());
  if(!sym){ F.err = 'Enter a ticker.'; return deskRepaint('calls'); }
  F.busy = true; F.err = ''; deskRepaint('calls');
  loadQuotesFor([sym, 'SPY']).then(function(){
    var q = DATA.quotes[sym], tgt = alNum(F.tgt);
    F.busy = false;
    if(!q || q.c == null){ F.err = 'No price found for ' + sym + '.'; return deskRepaint('calls'); }
    calls().unshift({ id:'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), s:sym, side:F.side, note:F.note.trim().slice(0, 240),
      tgt:tgt > 0 ? tgt : null, px:q.c, spy:(DATA.quotes.SPY || {}).c || null, t:Date.now(), closed:null });
    callsSave(); DESK.form = null; toast('Call recorded: ' + F.side + ' ' + sym + ' at ' + money(q.c, 'USD'));
    deskRepaint('calls'); deskRepaint('brief');
  });
}
function deskNewCall(sym){
  DESK.form = DESK.form || { sym:'', side:'long', note:'', tgt:'', err:'', busy:false };
  if(sym) DESK.form.sym = sym;
  if(CUR.view !== 'home'){ go('#/'); setTimeout(function(){ deskFocus('ckSym'); }, 600); return; }
  deskRepaint('calls'); deskFocus('ckSym');
}
function deskFocus(id){ setTimeout(function(){ var e = $(id); if(e){ e.focus(); e.scrollIntoView({ block:'center', behavior:'smooth' }); } }, 30); }

/* ---------------------------------------------------------------- the brief */
function deskSince(t){
  var h = (Date.now() - t) / 36e5;
  return h < 1 ? 'in the last hour' : h < 24 ? 'in the last ' + Math.round(h) + 'h' : 'since ' + new Date(t).toLocaleDateString([], { month:'short', day:'numeric' });
}
function deskPf(){ return PFS[CUR.pf] || PFS[Object.keys(PFS)[0]]; }
function deskHk(pf){ return pf.holdings.map(function(h){ return h.s + ':' + h.q; }).join(); }
function deskVisit(){ if(DESK.visit === undefined) DESK.visit = load('fh3_visit', null); return DESK.visit; }
function deskSnap(){   // remember this visit once an hour at most, after prices are in
  if(DESK.snapped) return; DESK.snapped = true;
  setTimeout(function(){
    var v = load('fh3_visit', null) || { t:0, rets:{} }, pf = deskPf();
    if(Date.now() - v.t < 36e5) return;
    if(pf && pf.holdings.length){ var st = pfStats(pf); v.rets = v.rets || {}; v.rets[CUR.pf] = { ret:st.ret, hk:deskHk(pf) }; }
    v.t = Date.now(); save('fh3_visit', v);
  }, 15000);
}
function dkBrief(){
  var v = deskVisit(), pf = deskPf(), st = pf && pf.holdings.length ? pfStats(pf) : null, tiles = [];
  var cur = st ? st.base : 'USD', sg = function(x){ return (x >= 0 ? '+' : '−') + money(Math.abs(x), cur); };
  var was = v && v.rets && v.rets[CUR.pf];
  if(st && was && was.hk === deskHk(pf)){ var d = st.ret - was.ret; tiles.push([sg(d), 'portfolio ' + deskSince(v.t), d >= 0, 'dk-go', '#/portfolio']); }
  else if(st) tiles.push([sg(st.day), 'portfolio today', st.day >= 0, 'dk-go', '#/portfolio']);
  else tiles.push(['Add holdings', 'to see your value move', null, 'addholding', '']);
  var n = INBOX.filter(function(m){ return v && v.t ? m.ts > v.t : !m.read; }).length;
  tiles.push([String(n), n === 1 ? 'alert ' + (v ? 'fired' : 'waiting') : 'alerts ' + (v ? 'fired' : 'waiting'), null, 'ib-toggle', '']);
  var now = Date.now(), nx = EARNINGS.map(function(e){ return { e:e, d:e.date ? Date.parse(e.date) : NaN }; }).filter(function(x){ return isFinite(x.d) && x.d >= now - 864e5 && x.d < now + 14 * 864e5; }).sort(function(a, b){ return a.d - b.d; })[0];
  if(nx){ var dd = Math.max(0, Math.round((nx.d - now) / 864e5)); tiles.push([nx.e.s, dd === 0 ? 'reports today' : 'reports in ' + dd + ' day' + (dd === 1 ? '' : 's'), null, 'quote', nx.e.s]); }
  else tiles.push(['—', 'no earnings in the next 14 days', null, 'dk-go', '#/earnings']);
  var best = calls().filter(function(c){ return !c.closed && c.side !== 'watch' && callRet(c) != null; }).sort(function(a, b){ return callRet(b) - callRet(a); })[0];
  if(best) tiles.push([best.s + ' ' + pct(callRet(best), 1), 'your best open call', callRet(best) >= 0, 'quote', best.s]);
  else tiles.push(['Make a call', 'and keep score of your ideas', null, 'ck-new', '']);
  return '<div class="section-head"><h2>Since you were last here</h2><span class="mut" style="font-size:12.5px">' + (v && v.t ? 'You last visited ' + esc(alAgo(v.t)) : 'Your first visit. Tomorrow this shows what changed.') + '</span></div>' +
    '<div class="dk-tiles">' + tiles.map(function(t){
      return '<button class="dk-tile" data-act="' + t[3] + '" data-href="' + esc(t[4]) + '" data-sym="' + esc(t[4]) + '"><b class="num ' + (t[2] == null ? '' : t[2] ? 'up' : 'down') + '">' + esc(t[0]) + '</b><span class="mut">' + esc(t[1]) + '</span></button>';
    }).join('') + '</div>';
}

/* ---------------------------------------------------------------- the other modules */
function dkWatch(){
  var listId = CUR.list && LISTS[CUR.list] ? CUR.list : Object.keys(LISTS)[0], syms = (LISTS[listId] ? LISTS[listId].syms : []).slice(0, 12);
  return '<div class="section-head"><h2>Top movers in your watchlists</h2><button class="btn text sm" data-act="menu-cols">Columns</button>' +
    '<button class="btn text sm" data-act="nav" data-href="#/list/' + esc(listId) + '">View all watchlists</button></div>' +
    moversTableHTML(syms.length ? syms : UNIVERSE.slice(0, 10).map(function(u){ return u[0]; })) +
    '<div class="movers-note">Nasdaq delayed feed. Market cap from the Nasdaq screener snapshot. Change is measured against the previous close.</div>';
}
function dkMarket(){
  var tabs = [['gainers', 'Gainers'], ['losers', 'Losers'], ['active', 'Most valuable']];
  return '<div class="section-head"><h2>Market movers</h2><div class="tm-seg" role="group" aria-label="Movers">' + tabs.map(function(t){
    return '<button class="' + (DESK.mk === t[0] ? 'on' : '') + '" data-act="dk-mk" data-k="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div></div>' +
    rowListHTML(topMovers(DESK.mk)) + (DESK.mk === 'active' ? '<div class="movers-note">By market cap across US listings.</div>' : '');
}
function dkNews(){
  return '<div class="section-head"><h2>Market news</h2><button class="btn text sm" data-act="ai" data-kind="news">Dive deeper with AI</button>' +
    '<button class="btn text sm" data-act="refresh-news">Refresh</button></div>' + newsClusterHTML();
}
function dkEarnings(){
  return '<div class="section-head"><h2>Earnings calendar</h2><button class="btn text sm" data-act="nav" data-href="#/earnings">All earnings</button></div>' + earningsListHTML(6);
}
function dkTrh(){
  return '<div class="section-head"><h2>Market-wide movers</h2><span class="mut" style="font-size:12px">TraderHub reference board</span></div><div id="trh-movers"><div class="kv-inline">Loading…</div></div>';
}
function dkBody(id){
  return id === 'brief' ? dkBrief() : id === 'portfolio' ? glanceHTML() : id === 'calls' ? dkCalls() : id === 'watch' ? dkWatch() :
    id === 'market' ? dkMarket() : id === 'news' ? dkNews() : id === 'earnings' ? dkEarnings() : id === 'trh' ? dkTrh() : '';
}

/* ---------------------------------------------------------------- the desk */
function deskWrap(id){
  var m = deskMod(id), bar = DESK.edit ? '<div class="dk-bar"><span class="dk-grip" title="Drag to reorder" aria-hidden="true">⠿</span><b>' + esc(m.t) + '</b><span class="dk-bs">' +
    '<button data-act="dk-mv" data-id="' + id + '" data-d="-1" aria-label="Move ' + esc(m.t) + ' up">Up</button><button data-act="dk-mv" data-id="' + id + '" data-d="1" aria-label="Move ' + esc(m.t) + ' down">Down</button>' +
    '<button data-act="dk-hide" data-id="' + id + '" aria-label="Hide ' + esc(m.t) + '">Hide</button></span></div>' : '';
  return '<section class="section dk' + (DESK.edit ? ' edit' : '') + '" data-mod="' + id + '"' + (DESK.edit ? ' draggable="true"' : '') + '>' + bar + '<div class="dk-body">' + dkBody(id) + '</div></section>';
}
function deskHTML(){
  var s = deskState(), tools = '<div class="dk-tools"><button class="dk-k" data-act="cmdk-open" title="Search, jump and act from the keyboard">Commands <kbd>' + (/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl') + ' K</kbd></button>' +
    '<button class="btn ' + (DESK.edit ? 'filled' : 'tonal') + ' sm" data-act="dk-edit">' + (DESK.edit ? 'Done' : 'Arrange') + '</button></div>';
  var tray = DESK.edit ? '<div class="dk-tray"><b>Add to your desk</b>' + (s.off.length ? s.off.map(function(id){ return '<button class="btn tonal sm" data-act="dk-show" data-id="' + id + '">+ ' + esc(deskMod(id).t) + '</button>'; }).join('') : '<span class="mut">Everything is on your desk.</span>') +
    '<button class="btn text sm" data-act="dk-reset">Reset layout</button></div>' : '';
  return '<div id="deskRoot">' + tools + tray + s.order.filter(function(i){ return s.off.indexOf(i) < 0; }).map(deskWrap).join('') + '</div>';
}
function deskRender(){
  var r = $('deskRoot'); if(!r || CUR.view !== 'home') return;
  r.outerHTML = deskHTML();
  if(typeof fillTRHMovers === 'function') fillTRHMovers();
}
function deskRepaint(id){
  var el = document.querySelector('.dk[data-mod="' + id + '"]'); if(!el || CUR.view !== 'home') return;
  var t = document.createElement('div'); t.innerHTML = deskWrap(id); el.replaceWith(t.firstChild);
  if(id === 'trh' && typeof fillTRHMovers === 'function') fillTRHMovers();
}
function deskLoad(){   // quotes behind the call book, once the home page asks
  var syms = calls().filter(function(c){ return !c.closed; }).map(function(c){ return c.s; });
  if(!syms.length) return Promise.resolve();
  return loadQuotesFor(syms.concat(['SPY'])).then(function(){ deskRepaint('calls'); deskRepaint('brief'); });
}
function deskMove(id, to){
  var s = deskState(), i = s.order.indexOf(id); if(i < 0) return;
  s.order.splice(i, 1); s.order.splice(clamp(to, 0, s.order.length), 0, id); deskSave(s); deskRender();
}

/* ---------------------------------------------------------------- clicks, typing, dragging */
document.addEventListener('click', function(ev){
  var el = ev.target.closest && ev.target.closest('[data-act^="dk-"],[data-act^="ck-"],[data-act^="cmdk-"]'); if(!el) return;
  var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
  if(act === 'dk-edit'){ DESK.edit = !DESK.edit; deskRender(); }
  else if(act === 'dk-go'){ go(el.getAttribute('data-href')); }
  else if(act === 'dk-mk'){ DESK.mk = el.getAttribute('data-k'); deskRepaint('market'); }
  else if(act === 'dk-mv'){ var s = deskState(), vis = s.order.filter(function(i){ return s.off.indexOf(i) < 0; }), at = vis.indexOf(id), to = vis[at + (+el.getAttribute('data-d'))]; if(to) deskMove(id, s.order.indexOf(to)); }
  else if(act === 'dk-hide'){ var s2 = deskState(); if(s2.off.indexOf(id) < 0) s2.off.push(id); deskSave(s2); deskRender(); }
  else if(act === 'dk-show'){ var s3 = deskState(); s3.off = s3.off.filter(function(i){ return i !== id; }); deskSave(s3); deskRender(); if(id === 'calls') deskLoad(); }
  else if(act === 'dk-reset'){ try{ localStorage.removeItem('fh3_desk'); CLOUD.del('fh3_desk'); }catch(e){} deskRender(); }
  else if(act === 'ck-new'){ ev.preventDefault(); deskNewCall(); }
  else if(act === 'ck-cancel'){ DESK.form = null; deskRepaint('calls'); }
  else if(act === 'ck-side'){ DESK.form.side = el.getAttribute('data-v'); deskRepaint('calls'); }
  else if(act === 'ck-save'){ ckSave(); }
  else if(act === 'ck-all'){ DESK.all = !DESK.all; deskRepaint('calls'); }
  else if(act === 'ck-close'){
    var c = calls().filter(function(x){ return x.id === id; })[0], n = c && callNow(c);
    if(c && n != null){ c.closed = { px:n, spy:(DATA.quotes.SPY || {}).c || null, t:Date.now() }; callsSave(); toast('Closed ' + c.s + ' at ' + pct(callRet(c), 1)); deskRepaint('calls'); deskRepaint('brief'); }
  }
  else if(act === 'ck-del'){
    if(el.getAttribute('data-sure')){ CALLS = calls().filter(function(x){ return x.id !== id; }); callsSave(); deskRepaint('calls'); deskRepaint('brief'); }
    else { el.setAttribute('data-sure', '1'); el.textContent = 'Delete?'; setTimeout(function(){ if(el.isConnected){ el.removeAttribute('data-sure'); el.textContent = 'Delete'; } }, 2500); }
  }
  else if(act === 'cmdk-open'){ cmdkOpen(); }
  else if(act === 'cmdk-run'){ cmdkRun(+el.getAttribute('data-i')); }
});
document.addEventListener('input', function(ev){
  var F = DESK.form, t = ev.target; if(!t.id) return;
  if(t.id === 'cmdkIn') return cmdkPaint();
  if(!F) return;
  if(t.id === 'ckSym') F.sym = t.value; else if(t.id === 'ckNote') F.note = t.value; else if(t.id === 'ckTgt') F.tgt = t.value;
});
document.addEventListener('keydown', function(ev){
  var t = ev.target, typing = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || (t && t.isContentEditable);
  if((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k'){ ev.preventDefault(); CMDK.open ? cmdkClose() : cmdkOpen(); return; }
  if(ev.key === '/' && !typing && !CMDK.open && !ev.metaKey && !ev.ctrlKey){ ev.preventDefault(); cmdkOpen(); return; }
  if(CMDK.open){
    if(ev.key === 'Escape'){ cmdkClose(); }
    else if(ev.key === 'ArrowDown' || ev.key === 'ArrowUp'){ ev.preventDefault(); CMDK.at = clamp(CMDK.at + (ev.key === 'ArrowDown' ? 1 : -1), 0, CMDK.items.length - 1); cmdkPaint(true); }
    else if(ev.key === 'Enter'){ ev.preventDefault(); cmdkRun(CMDK.at); }
    return;
  }
  if(t && t.id === 'ckNote' && ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)){ ev.preventDefault(); ckSave(); }
  if(t && t.id === 'ckSym' && ev.key === 'Enter'){ ev.preventDefault(); ckSave(); }
});
document.addEventListener('dragstart', function(ev){ var s = ev.target.closest && ev.target.closest('.dk.edit'); if(!s) return; DESK.drag = s.getAttribute('data-mod'); ev.dataTransfer.effectAllowed = 'move'; try{ ev.dataTransfer.setData('text/plain', DESK.drag); }catch(e){} s.classList.add('drag'); });
document.addEventListener('dragover', function(ev){
  var s = ev.target.closest && ev.target.closest('.dk.edit'); if(!s || !DESK.drag) return; ev.preventDefault();
  document.querySelectorAll('.dk.over').forEach(function(e){ e.classList.remove('over'); }); if(s.getAttribute('data-mod') !== DESK.drag) s.classList.add('over');
});
document.addEventListener('drop', function(ev){
  var s = ev.target.closest && ev.target.closest('.dk.edit'); if(!s || !DESK.drag) return; ev.preventDefault();
  var to = s.getAttribute('data-mod'), id = DESK.drag; DESK.drag = '';
  if(to !== id){ var st = deskState(); deskMove(id, st.order.indexOf(to)); } else deskRender();
});
document.addEventListener('dragend', function(){ DESK.drag = ''; document.querySelectorAll('.dk.drag,.dk.over').forEach(function(e){ e.classList.remove('drag', 'over'); }); });

/* ---------------------------------------------------------------- command palette */
var CMDK = { open:false, items:[], at:0 };
function cmdkActions(){
  var pf = Object.keys(PFS)[0], lists = typeof LISTS !== 'undefined' ? Object.keys(LISTS)[0] : '';
  return [
    ['Make a call', 'Write down an idea with today\'s price', function(){ deskNewCall(); }],
    ['Set an alert', 'Price, volume or a new filing', function(){ alNew(CUR.view === 'quote' ? CUR.sym : ''); }],
    ['Arrange the Terminal', 'Reorder, hide and add modules', function(){ DESK.edit = true; if(CUR.view !== 'home') go('#/'); else deskRender(); }],
    [CFG.mute ? 'Unmute alerts' : 'Mute alerts', 'Pop-ups, sound and desktop notifications', function(){ CFG.mute = !CFG.mute; saveCfg(); alBadge(); toast(CFG.mute ? 'Alerts muted' : 'Alerts unmuted'); }],
    ['Open the inbox', 'Notifications and your alerts', function(){ alPanelToggle(true); }],
    ['Go to Terminal', '', function(){ go('#/'); }],
    ['Go to Research Log', '', function(){ go('#/research'); }],
    ['Go to my portfolio', '', function(){ go('#/portfolio/' + encodeURIComponent(pf)); }],
    ['Go to earnings', '', function(){ go('#/earnings'); }],
    ['Go to watchlists', '', function(){ go('#/list/' + encodeURIComponent(lists)); }]
  ];
}
function cmdkBuild(q){
  q = q.trim(); var low = q.toLowerCase(), items = [], seen = {};
  var add = function(it){ if(!seen[it[0]]){ seen[it[0]] = 1; items.push(it); } };
  if(/^[A-Za-z][A-Za-z0-9.\-^=]{0,9}$/.test(q)){
    var U = q.toUpperCase();
    add(['Open ' + U, 'Quote page', function(){ go('#/quote/' + encodeURIComponent(dispSym(U))); }]);
    add(['Make a call on ' + U, 'Long, short or watch, with today\'s price', function(){ deskNewCall(U); }]);
    add(['Set an alert on ' + U, '', function(){ alNew(U); }]);
  }
  if(low){
    var pool = UNIVERSE.map(function(u){ return [u[0], u[1]]; }).concat(Object.keys(PFS).reduce(function(a, k){ return a.concat(PFS[k].holdings.map(function(h){ return [dispSym(h.s), labelOf(h.s)]; })); }, []));
    pool.filter(function(p){ return p[0].toLowerCase().indexOf(low) === 0 || (p[1] || '').toLowerCase().indexOf(low) >= 0; }).slice(0, 5).forEach(function(p){
      add(['Open ' + p[0], p[1] || 'Quote page', function(){ go('#/quote/' + encodeURIComponent(p[0])); }]);
    });
  }
  cmdkActions().filter(function(a){ return !low || (a[0] + ' ' + a[1]).toLowerCase().indexOf(low) >= 0; }).forEach(add);
  if(q.length > 2) add(['Search or ask Marvell: ' + q, 'Runs the header search', function(){ doSearch(q); }]);
  return items.slice(0, 9);
}
function cmdkOpen(){
  var o = $('cmdk');
  if(!o){ o = document.createElement('div'); o.id = 'cmdk'; o.className = 'cmdk'; o.innerHTML = '<div class="cmdk-box" role="dialog" aria-label="Commands"><input id="cmdkIn" class="cmdk-in" placeholder="Type a ticker, a command, or a question" autocomplete="off" spellcheck="false" aria-label="Commands"><div id="cmdkList" class="cmdk-list" role="listbox"></div></div>'; document.body.appendChild(o);
    o.addEventListener('mousedown', function(e){ if(e.target === o) cmdkClose(); }); }
  CMDK.open = true; CMDK.at = 0; o.hidden = false; $('cmdkIn').value = ''; cmdkPaint(); $('cmdkIn').focus();
}
function cmdkClose(){ CMDK.open = false; var o = $('cmdk'); if(o) o.hidden = true; }
function cmdkPaint(keep){
  var q = $('cmdkIn') ? $('cmdkIn').value : ''; if(!keep){ CMDK.items = cmdkBuild(q); CMDK.at = 0; }
  $('cmdkList').innerHTML = CMDK.items.map(function(it, i){
    return '<button class="cmdk-it' + (i === CMDK.at ? ' on' : '') + '" role="option" aria-selected="' + (i === CMDK.at) + '" data-act="cmdk-run" data-i="' + i + '"><b>' + esc(it[0]) + '</b><span>' + esc(it[1]) + '</span></button>';
  }).join('') || '<div class="cmdk-none mut">Nothing matches. Press Enter to search anyway.</div>';
  var on = document.querySelector('.cmdk-it.on'); if(on && on.scrollIntoView) on.scrollIntoView({ block:'nearest' });
}
function cmdkRun(i){ var it = CMDK.items[i]; if(!it){ var q = $('cmdkIn').value.trim(); cmdkClose(); if(q) doSearch(q); return; } cmdkClose(); it[2](); }
