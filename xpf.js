/* Main portfolio + experimental portfolios.
   Real portfolios: at most PF_MAX, exactly one is the main one (the Terminal shows it).
   Experimental portfolios (at most XPF_MAX): a sandbox the user designs with tickers, weights, a portfolio size and a deposit plan.
   The user never types a position value: the math engine sizes every position from the size, the weights and live prices
   (ME 'build_portfolio'), and 'contribution_schedule' dates the deposits. "Backtest in Quant" hands the same portfolio to Quant as a spec.
   Like desk.js, this file uses the page's globals (PFS, DATA, CUR, ME, QN ...) only inside functions, so load order does not matter. */
var PF_MAX = 3, XPF_MAX = 5, XPF_POS = 20;
var XPF = null, XPF_T = 0;
var XPF_FREQ = [['none', 'No deposits'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']];
var XPF_REB = [['none', 'Never'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']];

/* ---- main portfolio ------------------------------------------------------ */
function mainPfId(){ var ks = Object.keys(PFS); return ks.filter(function(k){ return PFS[k].main; })[0] || (PFS.main ? 'main' : ks[0]); }
function mainPf(){ return PFS[mainPfId()]; }
function pfNormMain(){ var id = mainPfId(); Object.keys(PFS).forEach(function(k){ if(!!PFS[k].main !== (k === id)) PFS[k].main = k === id; }); }
function pfSetMain(id){ if(!PFS[id]) return; Object.keys(PFS).forEach(function(k){ PFS[k].main = k === id; }); savePfs(); renderRail(); if(CUR.view === 'portfolio') renderPortfolio(); }
function pfFull(){ return Object.keys(PFS).length >= PF_MAX; }
function pfLimitMsg(){ return 'You can keep up to ' + PF_MAX + ' portfolios. Delete one first, or try ideas in an experimental portfolio.'; }

/* ---- store --------------------------------------------------------------- */
function xpfAll(){
  if(XPF) return XPF;
  XPF = load('fh3_xpf', {});
  Object.keys(XPF).forEach(function(k){
    var x = XPF[k];
    if(!x || typeof x !== 'object' || !Array.isArray(x.positions)){ delete XPF[k]; return; }
    x.name = String(x.name || k).slice(0, 60); x.size = x.size > 0 ? +x.size : 10000; x.whole = !!x.whole;
    x.rebalance = XPF_REB.some(function(r){ return r[0] === x.rebalance; }) ? x.rebalance : 'quarterly';
    x.contrib = x.contrib && XPF_FREQ.some(function(f){ return f[0] === x.contrib.freq; }) && x.contrib.amount > 0 ? { amount:+x.contrib.amount, freq:x.contrib.freq } : { amount:0, freq:'none' };
    x.positions = x.positions.filter(function(p){ return p && typeof p.s === 'string'; }).slice(0, XPF_POS).map(function(p){ return { s:p.s.toUpperCase(), w:isFinite(p.w) ? +p.w : 0 }; });
  });
  return XPF;
}
function xpfSave(){ save('fh3_xpf', xpfAll()); }
function xpfIds(){ return Object.keys(xpfAll()); }
function xpfNew(){
  if(xpfIds().length >= XPF_MAX){ toast('You can keep up to ' + XPF_MAX + ' experimental portfolios. Delete one first.'); return; }
  var id = 'x' + Date.now().toString(36), n = xpfIds().length + 1;
  xpfAll()[id] = { name:'Experiment ' + n, size:10000, whole:false, rebalance:'quarterly', contrib:{ amount:0, freq:'none' }, positions:[], created:Date.now() };
  xpfSave(); go('#/xpf/' + id);
}
function xpfWeightSum(x){ return x.positions.reduce(function(a, p){ return a + (+p.w || 0); }, 0); }
function xpfPrice(s){ var q = DATA.quotes[dispSym(s)]; return q && q.c > 0 ? q.c : null; }
function xpfMoney(v){ return '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function xpfRound(v){ return Math.round(v * 100) / 100; }

/* ---- rail ---------------------------------------------------------------- */
function xpfRailHTML(){
  var body = xpfIds().map(function(id){
    var x = XPF[id];
    return '<a class="rail-item' + (CUR.view === 'xpf' && CUR.xpf === id ? ' on' : '') + '" href="#/xpf/' + esc(id) + '"><span class="ri-dot"></span><span class="lbl">' + esc(x.name) + '</span><span class="cnt">' + x.positions.length + '</span></a>';
  }).join('');
  return body || '<button class="rail-item ri-empty" data-act="xpf-new"><span class="lbl">Try a portfolio idea</span></button>';
}

/* ---- pages --------------------------------------------------------------- */
function renderXpf(id){
  CUR.xpf = id || '';
  var all = xpfAll();
  if(!id){
    $('main').innerHTML = '<div class="section"><div class="section-head"><h2>Experimental portfolios</h2><button class="btn filled sm" data-act="xpf-new"' + (xpfIds().length >= XPF_MAX ? ' disabled' : '') + '>New experiment</button></div>' +
      '<p class="mut xpf-lead">Design a portfolio, size it, set a deposit plan, then test it in Quant. Nothing here is held or traded. ' + xpfIds().length + ' of ' + XPF_MAX + ' used.</p>' +
      '<div class="xpf-cards">' + (xpfIds().map(function(k){ var x = all[k];
        return '<a class="card xpf-card" href="#/xpf/' + esc(k) + '"><b>' + esc(x.name) + '</b><span class="mut">' + x.positions.length + ' positions · ' + xpfMoney(x.size).replace('.00', '') + '</span><span class="xpf-mini">' + xpfBar(x) + '</span></a>'; }).join('') ||
        '<div class="card xpf-card empty"><b>No experiments yet</b><span class="mut">Start one to see how a set of tickers, weights and monthly deposits would behave.</span></div>') + '</div></div>';
    return Promise.resolve();
  }
  var x = all[id];
  if(!x){ go('#/xpf'); return Promise.resolve(); }
  $('main').innerHTML = xpfPageHTML(id, x);
  var syms = x.positions.map(function(p){ return p.s; });
  return (syms.length ? loadQuotesFor(syms) : Promise.resolve()).then(function(){ if(CUR.view === 'xpf' && CUR.xpf === id) xpfPreview(); });
}
function xpfBar(x){
  var tot = xpfWeightSum(x) || 1;
  return '<span class="xpf-bar">' + x.positions.map(function(p, i){ return '<i style="flex:' + Math.max(0, +p.w) / tot + ';opacity:' + (1 - (i % 6) * 0.13).toFixed(2) + '" title="' + esc(p.s) + ' ' + p.w + '%"></i>'; }).join('') + '</span>';
}
function xpfSel(name, opts, cur){ return '<select class="inp" data-xf="' + name + '">' + opts.map(function(o){ return '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; }
function xpfRowHTML(p, i){
  return '<tr data-i="' + i + '"><td><input class="inp xpf-sym" data-xf="sym" data-i="' + i + '" value="' + esc(p.s) + '" placeholder="Ticker" maxlength="16" autocapitalize="characters" spellcheck="false"></td>' +
    '<td><input class="inp xpf-w" data-xf="w" data-i="' + i + '" type="number" min="0" max="100" step="0.1" value="' + (p.w || '') + '" placeholder="0"></td>' +
    '<td class="num" id="xp-px-' + i + '">—</td><td class="num" id="xp-val-' + i + '">—</td><td class="num" id="xp-sh-' + i + '">—</td>' +
    '<td><button class="icon-btn xpf-x" data-act="xpf-rm" data-i="' + i + '" title="Remove" aria-label="Remove ' + esc(p.s || 'row') + '">✕</button></td></tr>';
}
function xpfPageHTML(id, x){
  return '<div class="section xpf"><div class="section-head"><h2>' + esc(x.name) + ' <span class="xpf-tag">Experiment</span></h2><div class="xpf-actions">' +
    '<button class="btn text sm" data-act="xpf-rename">Rename</button><button class="btn text sm" data-act="xpf-del" style="color:var(--fh-negative,#ea4335)">Delete</button>' +
    '<button class="btn filled sm" data-act="xpf-quant">Test in Quant</button></div></div>' +
    '<p class="mut xpf-lead">A sandbox: nothing here is held or traded. Choose tickers and weights; each position is sized for you from the portfolio size and live prices.</p>' +
    '<div class="xpf-grid"><div class="card xpf-setup"><h3>Plan</h3>' +
      '<label class="field"><span>Portfolio size ($)</span><input class="inp" data-xf="size" type="number" min="1" step="100" value="' + x.size + '"></label>' +
      '<div class="xpf-two"><label class="field"><span>Deposit</span><input class="inp" data-xf="amount" type="number" min="0" step="10" value="' + (x.contrib.amount || '') + '" placeholder="0"></label>' +
      '<label class="field"><span>How often</span>' + xpfSel('freq', XPF_FREQ, x.contrib.freq) + '</label></div>' +
      '<div class="mut xpf-note" id="xpSched"></div>' +
      '<label class="field"><span>Rebalance in tests</span>' + xpfSel('reb', XPF_REB, x.rebalance) + '</label>' +
      '<label class="xpf-chk"><input type="checkbox" data-xf="whole"' + (x.whole ? ' checked' : '') + '><span>Whole shares only <em class="mut">(the remainder stays as cash)</em></span></label></div>' +
    '<div class="card xpf-pos"><h3>Positions</h3><div class="tbl-wrap"><table class="fh xpf-tbl"><thead><tr><th>Ticker</th><th>Weight %</th><th class="num">Price</th><th class="num">Value</th><th class="num">Shares</th><th></th></tr></thead>' +
      '<tbody id="xpRows">' + x.positions.map(xpfRowHTML).join('') + '</tbody></table></div>' +
      '<div id="xpBar"></div><div class="xpf-foot"><span id="xpTotal" class="xpf-total"></span><span class="xpf-tools">' +
      '<button class="btn text sm" data-act="xpf-add"' + (x.positions.length >= XPF_POS ? ' disabled' : '') + '>+ Add ticker</button><button class="btn text sm" data-act="xpf-eq">Equal weights</button><button class="btn text sm" data-act="xpf-norm">Scale to 100%</button></span></div>' +
      '<div class="xpf-sum" id="xpSum"></div></div></div></div>';
}

/* ---- live preview: the math engine does the sizing ------------------------ */
function xpfPreview(){
  var x = xpfAll()[CUR.xpf]; if(!x || !$('xpRows')) return;
  var tot = xpfWeightSum(x), ok = Math.abs(tot - 100) <= 0.01, left = xpfRound(100 - tot);
  if($('xpTotal')) $('xpTotal').innerHTML = x.positions.length ? '<b class="' + (ok ? 'pos' : 'neg') + '">' + xpfRound(tot) + '%</b> assigned' + (ok ? ' ✓' : left > 0 ? ' · ' + left + '% left to assign' : ' · ' + (-left) + '% over') : 'Add tickers to begin';
  if($('xpBar')) $('xpBar').innerHTML = x.positions.length ? xpfBar(x) : '';
  x.positions.forEach(function(p, i){ var px = xpfPrice(p.s), c = $('xp-px-' + i); if(c) c.textContent = px ? xpfMoney(px) : (p.s ? 'no price' : '—'); });
  var prices = {}; x.positions.forEach(function(p){ var v = xpfPrice(p.s); if(v) prices[p.s] = v; });
  var mark = ++XPF_T;
  ME.run('build_portfolio', { size:x.size, positions:x.positions.filter(function(p){ return p.s; }).map(function(p){ return { symbol:p.s, weight_pct:p.w }; }), prices:prices, whole_shares:x.whole }).then(function(r){
    if(mark !== XPF_T || !$('xpRows')) return;
    r.positions.forEach(function(rp){ var i = x.positions.findIndex(function(p){ return p.s === rp.symbol; });
      if($('xp-val-' + i)) $('xp-val-' + i).textContent = xpfMoney(rp.value); if($('xp-sh-' + i)) $('xp-sh-' + i).textContent = (+rp.shares.toFixed(x.whole ? 0 : 4)).toLocaleString(undefined, { maximumFractionDigits:4 }); });
    $('xpSum').innerHTML = 'Invested <b>' + xpfMoney(r.invested) + '</b>' + (r.cash > 0.005 ? ' · cash <b>' + xpfMoney(r.cash) + '</b> (' + xpfRound(r.cashPct) + '%)' : '') + ' · priced live';
  }, function(e){
    if(mark !== XPF_T || !$('xpRows')) return;
    x.positions.forEach(function(p, i){ if($('xp-val-' + i)) $('xp-val-' + i).textContent = '—'; if($('xp-sh-' + i)) $('xp-sh-' + i).textContent = '—'; });
    $('xpSum').innerHTML = x.positions.length ? '<span class="mut">' + esc(String(e.message || e).replace(/^Error: /, '')) + '</span>' : '';
  });
  var sch = $('xpSched');
  if(sch){
    if(!(x.contrib.amount > 0) || x.contrib.freq === 'none') sch.textContent = 'No deposits: the portfolio is a one-time ' + xpfMoney(x.size).replace('.00', '') + '.';
    else ME.run('contribution_schedule', { amount:x.contrib.amount, freq:x.contrib.freq, years:1 }).then(function(s){
      if($('xpSched')) $('xpSched').textContent = 'Next deposit ' + s.first + ' · ' + s.count + ' a year · ' + xpfMoney(s.perYearAmount).replace('.00', '') + ' a year.'; });
  }
}

function xpfEdit(ev){
  var el = ev.target.closest && ev.target.closest('[data-xf]'); if(!el || CUR.view !== 'xpf') return;
  var x = xpfAll()[CUR.xpf]; if(!x) return;
  var k = el.getAttribute('data-xf'), i = +el.getAttribute('data-i'), v = el.type === 'checkbox' ? el.checked : el.value;
  if(k === 'size') x.size = Math.max(1, +v || 0) || x.size;
  else if(k === 'amount') x.contrib.amount = Math.max(0, +v || 0);
  else if(k === 'freq') x.contrib.freq = v;
  else if(k === 'reb') x.rebalance = v;
  else if(k === 'whole') x.whole = !!v;
  else if(k === 'w' && x.positions[i]) x.positions[i].w = Math.max(0, Math.min(100, +v || 0));
  else if(k === 'sym' && x.positions[i]){
    if(ev.type === 'input') return;   // commit when the box is left
    var s = String(v).trim().toUpperCase().replace(/[^A-Z0-9.\-^=]/g, ''); el.value = s;
    if(x.positions.some(function(p, j){ return j !== i && p.s === s && s; })){ toast(s + ' is already in this portfolio.'); el.value = x.positions[i].s; return; }
    x.positions[i].s = s; if(s) loadQuotesFor([s]).then(xpfPreview);
  }
  xpfSave(); xpfPreview();
}
document.addEventListener('input', xpfEdit);
document.addEventListener('change', xpfEdit);

function xpfAct(act, el){
  var x = xpfAll()[CUR.xpf], i = +el.getAttribute('data-i');
  if(act === 'xpf-new') return xpfNew();
  if(!x) return;
  if(act === 'xpf-add'){ if(x.positions.length >= XPF_POS) return; x.positions.push({ s:'', w:0 }); xpfSave(); $('main').innerHTML = xpfPageHTML(CUR.xpf, x); xpfPreview(); var r = document.querySelector('#xpRows tr:last-child input'); if(r) r.focus(); }
  else if(act === 'xpf-rm'){ x.positions.splice(i, 1); xpfSave(); $('main').innerHTML = xpfPageHTML(CUR.xpf, x); xpfPreview(); renderRail(); }
  else if(act === 'xpf-eq' || act === 'xpf-norm'){
    var n = x.positions.length; if(!n) return;
    if(act === 'xpf-eq'){ var each = Math.floor(10000 / n) / 100; x.positions.forEach(function(p){ p.w = each; }); x.positions[n - 1].w = xpfRound(100 - each * (n - 1)); }
    else { var t = xpfWeightSum(x); if(!t){ toast('Enter some weights first.'); return; } x.positions.forEach(function(p){ p.w = Math.floor(p.w / t * 10000) / 100; }); x.positions[n - 1].w = xpfRound(x.positions[n - 1].w + 100 - xpfWeightSum(x)); }
    xpfSave(); $('main').innerHTML = xpfPageHTML(CUR.xpf, x); xpfPreview();
  }
  else if(act === 'xpf-rename') askText('Rename experiment', 'Name', x.name, function(name){ x.name = name.slice(0, 60); xpfSave(); renderRail(); renderXpf(CUR.xpf); });
  else if(act === 'xpf-del') dialog('Delete this experiment?', '<div class="vt-warn"><b>“' + esc(x.name) + '” will be deleted for good.</b></div>', '<button class="btn text" data-act="dlg-close">Keep it</button><button class="btn filled danger" data-act="xpf-del-go">Delete</button>');
  else if(act === 'xpf-del-go'){ delete XPF[CUR.xpf]; xpfSave(); closeDialog(); renderRail(); toast('Experiment deleted'); go('#/xpf'); }
  else if(act === 'xpf-quant') xpfQuant(CUR.xpf);
}

/* ---- hand-off to Quant ---------------------------------------------------- */
/* The portfolio as a Quant allocation spec: fixed weights, the chosen rebalance, and the deposit plan so Quant can show how the plan would have grown and how it might progress. */
function xpfSpec(x){
  var yrs = new Date(Date.now() - 10 * 365.25 * 864e5);
  return { title:x.name, summary:'Experimental portfolio: ' + x.positions.map(function(p){ return p.s + ' ' + p.w + '%'; }).join(', ') + (x.rebalance === 'none' ? ', never rebalanced' : ', rebalanced ' + x.rebalance) + ', against SPY.',
    type:'allocation', method:'fixed', assets:x.positions.map(function(p){ return { sym:p.s, weight:p.w }; }), rebalance:x.rebalance, benchmark:'SPY', start:ymd(yrs), cost_bps:5, params:[],
    projection:{ years:5, drift:0, volMult:1, note:'Past returns of this mix carried forward.' },
    plan:{ capital:x.size, amount:x.contrib.amount, freq:x.contrib.freq },
    assumptions:['Weights are the ones set in the experiment; positions are sized from them, so any rebalance returns to those weights.', x.contrib.freq !== 'none' ? 'Deposits of ' + xpfMoney(x.contrib.amount) + ' ' + x.contrib.freq + ' ride the same daily returns; they are not traded at live prices.' : 'No deposits.'], unsupported:'' };
}
function xpfQuant(id){
  var x = xpfAll()[id]; if(!x) return;
  if(!x.positions.length || x.positions.some(function(p){ return !p.s; })){ toast('Add your tickers first.'); return; }
  if(Math.abs(xpfWeightSum(x) - 100) > 0.01){ toast('Weights must total 100% before testing (now ' + xpfRound(xpfWeightSum(x)) + '%).'); return; }
  if(x.positions.length < 1) return;
  rsOpenPanel('quant'); qnRunSpec(xpfSpec(x), 'Testing ' + x.name);
}
