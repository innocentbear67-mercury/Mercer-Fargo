/* Deep Research PDFs. The company memo is the Stock Research Pro memo (generate_memo_pdf.py), section for section: verdict, boxed Thesis Risk,
   valuation snapshot, intake, financials, bull vs bear, fair value and scenarios, niche and chain effects, rationale, risks. It is set on carbon black
   in the MercerFargo brand: one gold accent, an off-white serif, flat tone steps instead of rules and boxes, and the logo as a faint watermark behind
   every page. Any other report (markdown) gets the same design.
     MEMO.memoPdf(memo, sources)  -> Promise<{ doc, name }>
     MEMO.mdPdf(markdown, meta)   -> Promise<{ doc, name }>     meta: { title, sub, sources }
   Needs jsPDF (loaded from cdnjs on first use, like the Quant report). */
var MEMO = (function(){
  /* One ground, one ink, one accent. s1 / s2 are the two surface tones that separate things where a line would have been. */
  var C = { bg:[20, 20, 20], s1:[28, 28, 28], s2:[38, 38, 38], head:[48, 43, 33], gold:[193, 165, 120], ink:[245, 241, 232], med:[184, 179, 168],
    green:[47, 122, 54], red:[178, 52, 62], pos:[92, 196, 86], neg:[255, 104, 114], dark:[20, 20, 20], fieldBull:[26, 41, 29], fieldBear:[46, 27, 30], fieldRisk:[46, 28, 30] };
  var VC = { 'strong buy':C.green, 'buy':C.green, 'hold':C.gold, 'sell':C.red, 'buy more':C.green, 'bet heavily on it':C.green, 'wait for a better price':C.gold, 'pass':C.red, 'hard pass':C.red };
  /* Three sizes do the visible work (a very large one, body, small); everything is left-aligned serif. */
  var ST = {
    Title:{ f:'bold', s:34, l:38, c:C.ink, a:4 }, Sub:{ f:'normal', s:10.5, l:14, c:C.med, a:16 }, H:{ f:'normal', s:17, l:21, c:C.gold, b:30, a:9 }, H3:{ f:'bold', s:11.5, l:15, c:C.gold, b:10, a:3 },
    Body:{ f:'normal', s:10.4, l:14.6, c:C.ink, a:6 }, Tight:{ f:'normal', s:10.2, l:14, c:C.ink, a:3 }, Cell:{ f:'normal', s:9.8, l:13, c:C.ink }, Label:{ f:'normal', s:9.8, l:13, c:C.med },
    Head:{ f:'bold', s:9.8, l:13, c:C.gold }, Small:{ f:'normal', s:8.6, l:11.4, c:C.med, a:3 }
  };
  var PW = 612, PH = 792, ML = 40, CW = 532, MT = 72, MB = 62, LOGO = {};

  function dataUrl(u){
    return fetch(u).then(function(r){ if(!r.ok) throw 0; return r.blob(); }).then(function(b){ return new Promise(function(ok, no){ var f = new FileReader(); f.onload = function(){ ok(f.result); }; f.onerror = no; f.readAsDataURL(b); }); });
  }
  function ensure(){
    var lib = window.jspdf ? Promise.resolve() : new Promise(function(ok, no){
      var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; sc.onload = ok;
      sc.onerror = function(){ no(new Error('PDF library failed to load')); }; document.head.appendChild(sc);
    });
    var logos = Promise.all([['wm', 'assets/logo-wordmark.png'], ['mark', 'assets/logo-mark.png']].map(function(x){
      return LOGO[x[0]] ? 0 : dataUrl(x[1]).then(function(d){ LOGO[x[0]] = d; }, function(){});   // a missing logo only drops the logo
    }));
    return lib.then(function(){ return logos; });
  }
  /* Built-in Times covers Latin-1: map the rest to something the page can print. */
  function clean(t){
    return String(t == null ? '' : t).replace(/[−–]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=')
      .replace(/≈/g, '~').replace(/[▲▴]/g, 'up ').replace(/[▼▾]/g, 'down ').replace(/…/g, '...').replace(/ /g, ' ').replace(/✓/g, 'yes').replace(/✗/g, 'no')
      .replace(/[^\x09\x0a\x20-\x7e\xa0-\xff—•\xb7]/g, '');
  }
  function runs(t){   // **bold** and <b>bold</b> become runs
    var out = [], re = /\*\*([^*]+)\*\*|<b>([\s\S]*?)<\/b>/g, i = 0, m; t = clean(t).replace(/<\/?(i|em|u)>/g, '');
    while((m = re.exec(t))){ if(m.index > i) out.push({ t:t.slice(i, m.index) }); out.push({ t:m[1] || m[2], b:true }); i = re.lastIndex; }
    if(i < t.length) out.push({ t:t.slice(i) });
    return out;
  }
  function sent(t){ t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(); }

  function Pdf(){
    var doc = new window.jspdf.jsPDF({ unit:'pt', format:'letter', compress:true }), y = MT, me = this;
    this.doc = doc;
    function op(a){ try{ doc.setGState(new doc.GState({ opacity:a })); }catch(e){} }
    function paint(){   // carbon black, then the mark behind everything, so nothing ever lies over a heading
      doc.setFillColor(C.bg[0], C.bg[1], C.bg[2]); doc.rect(0, 0, PW, PH, 'F');
      if(LOGO.mark){ op(.07); doc.addImage(LOGO.mark, 'PNG', (PW - 340) / 2, (PH - 270) / 2, 340, 270.3); op(1); }
    }
    paint();
    function font(st, bold){ doc.setFont('times', bold ? 'bold' : st.f); doc.setFontSize(st.s); doc.setTextColor(st.c[0], st.c[1], st.c[2]); }
    this.page = function(){ doc.addPage(); paint(); y = MT; };
    this.need = function(h){ if(y + h > PH - MB) me.page(); };
    this.y = function(v){ if(v != null) y = v; return y; };
    this.space = function(n){ y += n; };
    this.fill = function(x, yy, w, h, col, a){ if(a) op(a); doc.setFillColor(col[0], col[1], col[2]); doc.rect(x, yy, w, h, 'F'); if(a) op(1); };
    /* Greedy word wrap over mixed bold / regular runs. */
    this.wrap = function(text, st, w){
      var words = [], lines = [], cur = [], cw = 0;
      runs(text).forEach(function(r){ r.t.split(/(\s+)/).forEach(function(p){ if(p) words.push({ t:p, b:!!r.b }); }); });
      function width(wd){ font(st, wd.b); return doc.getTextWidth(wd.t); }
      words.forEach(function(wd){
        if(/^\s+$/.test(wd.t)){ if(wd.t.indexOf('\n') >= 0){ lines.push(cur); cur = []; cw = 0; } else if(cur.length){ cur.push({ t:' ', b:wd.b }); cw += width({ t:' ', b:wd.b }); } return; }
        var ww = width(wd);
        while(ww > w && wd.t.length > 1){   // a word wider than the cell: break it
          var k = wd.t.length - 1; while(k > 1 && width({ t:wd.t.slice(0, k), b:wd.b }) > w - cw) k--;
          cur.push({ t:wd.t.slice(0, k), b:wd.b }); lines.push(cur); cur = []; cw = 0; wd = { t:wd.t.slice(k), b:wd.b }; ww = width(wd);
        }
        if(cw + ww > w + .01 && cur.length){ while(cur.length && /^\s+$/.test(cur[cur.length - 1].t)) cur.pop(); lines.push(cur); cur = []; cw = 0; }
        cur.push(wd); cw += ww;
      });
      if(cur.length) lines.push(cur);
      return lines.length ? lines : [[]];
    };
    this.line = function(line, st, x, yy, align, w){
      var tw = 0; line.forEach(function(r){ font(st, r.b); tw += doc.getTextWidth(r.t); });
      var cx = align === 'center' ? x + (w - tw) / 2 : align === 'right' ? x + w - tw : x;
      line.forEach(function(r){ font(st, r.b); doc.text(r.t, cx, yy + st.s * .82, { baseline:'alphabetic' }); cx += doc.getTextWidth(r.t); });
    };
    this.height = function(text, st, w){ return me.wrap(text, st, w).length * st.l; };
    /* A paragraph flows over pages line by line. */
    this.para = function(text, st, opt){
      opt = opt || {}; var x = opt.x == null ? ML : opt.x, w = opt.w || CW;
      if(st.b && y > MT + 1) y += st.b;
      var ls = me.wrap(text, st, w), keep = opt.keep || (st === ST.H ? 96 : 0); if(keep) me.need(ls.length * st.l + (st.a || 0) + (keep === true ? 40 : keep));   // a heading never ends a page alone
      ls.forEach(function(l){ me.need(st.l); me.line(l, st, x, y, opt.align, w); y += st.l; });
      y += st.a || 0;
    };
    this.bullets = function(items, st, x, w){
      x = x == null ? ML + 2 : x; w = w || CW - 4;
      (items && items.length ? items : ['—']).forEach(function(it){
        me.wrap(String(it), st, w - 14).forEach(function(l, i){ me.need(st.l); if(i === 0){ font(st); doc.setTextColor(C.gold[0], C.gold[1], C.gold[2]); doc.text('•', x + 2, y + st.s * .82); } me.line(l, st, x + 14, y); y += st.l; });
        y += 3;
      });
    };
    /* A table row is a tone, never a line, and is never split across pages. cols: [{w, st, bg}], cells: strings. */
    this.row = function(cells, cols, o){
      o = o || {}; var padY = o.pad || 6.5, padX = 10, hs = cells.map(function(c, i){ return me.height(c, cols[i].st, cols[i].w - 2 * padX); }), h = Math.max.apply(null, hs) + 2 * padY;
      me.need(h);
      var x = ML; cells.forEach(function(c, i){
        var col = cols[i], bg = o.bg ? o.bg[i] : col.bg;
        if(bg) me.fill(x, y, col.w, h, bg, .92);
        me.wrap(c, col.st, col.w - 2 * padX).forEach(function(l, k){ me.line(l, col.st, x + padX, y + padY + k * col.st.l, col.align, col.w - 2 * padX); });
        x += col.w;
      });
      y += h;
    };
    this.kv = function(rows){
      var cols = [{ w:158, st:ST.Label, bg:C.s2 }, { w:CW - 158, st:ST.Cell, bg:C.s1 }];
      rows.forEach(function(r){ me.row([String(r[0]), String(r[1])], cols); });
    };
    this.grid = function(head, rows){   // generic table for markdown: equal columns, tinted head, zebra body
      var n = head.length, w = CW / n, cols = head.map(function(){ return { w:w, st:ST.Cell }; });
      me.row(head, cols.map(function(c){ return { w:c.w, st:ST.Head }; }), { bg:head.map(function(){ return C.head; }) });
      rows.forEach(function(r, i){ var rr = r.slice(0, n); while(rr.length < n) rr.push(''); me.row(rr, cols, { bg:rr.map(function(){ return i % 2 ? C.s2 : C.s1; }) }); });
    };
    /* A big number with its small label under it: a row of these replaces boxed stat cards. */
    this.figures = function(items){
      items = items.filter(function(it){ return it[1]; }); if(!items.length) return;
      var w = CW / items.length, size = 22, need = 0;
      var fit = items.map(function(it){ var sz = 22; while(sz > 11){ var st = { f:'bold', s:sz, l:sz * 1.15, c:C.ink }, ls = me.wrap(it[1], st, w - 14); if(ls.length <= 2 && (ls.length === 1 || sz <= 15)) break; sz -= 1.5; } return sz; });
      var hh = Math.max.apply(null, items.map(function(it, i){ var st = { f:'bold', s:fit[i], l:fit[i] * 1.15, c:C.ink }; return me.wrap(it[1], st, w - 14).length * st.l; })) + 22;
      me.need(hh + 8);
      items.forEach(function(it, i){
        var st = { f:'bold', s:fit[i], l:fit[i] * 1.15, c:it[2] || C.ink };
        me.wrap(it[1], st, w - 14).forEach(function(l, k){ me.line(l, st, ML + i * w, y + k * st.l); });
        me.line(me.wrap(it[0], ST.Label, w - 14)[0], ST.Label, ML + i * w, y + hh - 16);
      });
      y += hh + 8;
    };
    /* The verdict: a whole field of colour, the word set very large. */
    this.verdict = function(verdict, oneLiner, price){
      var col = VC[String(verdict || '').trim().toLowerCase()] || C.s2, tc = col === C.gold ? C.dark : C.ink;
      var vs = { f:'bold', s:50, l:54, c:tc }, os = { f:'normal', s:11.5, l:15.5, c:tc }, ls = { f:'normal', s:9.6, l:12, c:tc }, ps = { f:'bold', s:28, l:32, c:tc };
      var half = price ? CW * .56 : CW, ol = oneLiner ? me.wrap(oneLiner, os, half - 44) : [];
      var h = 26 + 54 + (ol.length ? 10 + ol.length * 15.5 : 0) + 26;
      me.need(h + 10); me.fill(ML, y, CW, h, col);
      me.line([{ t:sent(verdict || '—') }], vs, ML + 22, y + 22);
      ol.forEach(function(l, i){ me.line(l, os, ML + 22, y + 22 + 54 + 10 + i * 15.5); });
      if(price){ var px = ML + half + 4, pw = CW - half - 26; me.line([{ t:'Highest price I would pay' }], ls, px, y + 36, 'right', pw); me.line(me.wrap(price, ps, pw)[0], ps, px, y + 52, 'right', pw); }
      y += h;
    };
    /* Thesis risk: a tinted field with the three parts, no border and no numbers. */
    this.thesis = function(t, any){
      var parts = any ? [['', t.flaws]] : [['Main analytical flaws in this memo.', t.flaws], ['Key risks, including overlap with existing concentrated exposure.', t.risks], ['The single assumption that would flip the verdict.', t.flip]].filter(function(p){ return p[1]; });
      var hs = { f:'bold', s:13, l:17, c:C.neg }, bs = { f:'normal', s:10, l:14, c:C.ink }, pw = CW - 40;
      var blocks = parts.map(function(p){ return me.wrap(p[0] ? '**' + p[0] + '** ' + p[1] : p[1], bs, pw); });
      var h = 18 + 17 + 12 + blocks.reduce(function(a, b){ return a + b.length * 14 + 9; }, 0) + 10;
      me.need(Math.min(h, 330));
      var top = y, yy = y + 18, drawn = 0;
      me.fill(ML, top, CW, Math.min(h, PH - MB - top), C.fieldRisk);
      me.line([{ t:'Thesis risk: read this first', b:true }], hs, ML + 20, yy); yy += 29;
      blocks.forEach(function(b){
        b.forEach(function(l){
          if(yy + 14 > PH - MB - 8){ me.page(); top = y; yy = y + 14; me.fill(ML, top, CW, Math.min(h - (yy - 0), PH - MB - top), C.fieldRisk); }
          me.line(l, bs, ML + 20, yy); yy += 14;
        });
        yy += 9;
      });
      y = Math.max(yy + 6, top + Math.min(h, PH - MB - top));
    };
    /* The bull case and the bear case: two tinted fields; they flow across pages together. */
    this.bullBear = function(bull, bear){
      var st = ST.Tight, cw = (CW - 8) / 2, items = function(a){ return (a && a.length ? a : ['—']).map(function(t){ return me.wrap(String(t), st, cw - 44); }); };
      var B = items(bull), R = items(bear), bi = 0, ri = 0, first = true;
      while(bi < B.length || ri < R.length){
        me.need(40 + 40);
        var top = y, avail = PH - MB - top - 24 - 34, hb = 0, hr = 0, sb = bi, sr = ri;
        while(bi < B.length && hb + B[bi].length * st.l + 4 <= avail){ hb += B[bi].length * st.l + 4; bi++; }
        while(ri < R.length && hr + R[ri].length * st.l + 4 <= avail){ hr += R[ri].length * st.l + 4; ri++; }
        if(bi === sb && ri === sr){ if(bi < B.length){ hb += B[bi].length * st.l + 4; bi++; } else { hr += R[ri].length * st.l + 4; ri++; } }
        var bh = Math.max(hb, hr) + 34 + 20;
        me.fill(ML, top, cw, bh, C.fieldBull); me.fill(ML + cw + 8, top, cw, bh, C.fieldBear);
        var hs = { f:'bold', s:12.5, l:16, c:C.pos }, hn = { f:'bold', s:12.5, l:16, c:C.neg };
        me.line([{ t:first ? 'The bull case' : 'The bull case, continued' }], hs, ML + 20, top + 16); me.line([{ t:first ? 'The bear case' : 'The bear case, continued' }], hn, ML + cw + 28, top + 16);
        var draw = function(list, from, to, x){ var yy = top + 42; for(var i = from; i < to; i++){ list[i].forEach(function(l, k){ if(k === 0){ font(st); doc.setTextColor(C.gold[0], C.gold[1], C.gold[2]); doc.text('•', x + 20, yy + st.s * .82); } me.line(l, st, x + 32, yy); yy += st.l; }); yy += 4; } };
        draw(B, sb, bi, ML); draw(R, sr, ri, ML + cw + 8);
        y = top + bh; first = false;
      }
    };
    this.scenarios = function(list){
      if(!list || !list.length) return;
      var cols = [{ w:92, st:ST.Cell }, { w:82, st:ST.Cell }, { w:108, st:ST.Cell }, { w:CW - 282, st:ST.Cell }];
      me.row(['Scenario', 'Probability', 'Implied value', 'What has to be true'], cols.map(function(c){ return { w:c.w, st:ST.Head }; }), { bg:[C.head, C.head, C.head, C.head] });
      list.forEach(function(s, i){ var bg = i % 2 ? C.s2 : C.s1; me.row([s.name || '', s.probability || '', s.value || '', s.note || ''], [{ w:92, st:{ f:'bold', s:9.8, l:13, c:C.ink } }, cols[1], cols[2], cols[3]], { bg:[bg, bg, bg, bg] }); });
    };
    this.sources = function(src){
      if(!src || !src.length) return;
      me.para('Sources', ST.H, { keep:60 });
      var st = { f:'normal', s:8.4, l:11.2, c:C.med };
      src.forEach(function(s){ me.para('[' + s.index + ']  ' + (s.title || s.url) + (s.url ? '   ' + s.url : ''), st, { x:ML + 2, w:CW - 4 }); });
    };
    /* The close: the name comes back large, then the caveats. */
    this.close = function(list){
      me.need(150); y += 30;
      if(LOGO.wm){ doc.addImage(LOGO.wm, 'PNG', ML, y, 300, 64.8); y += 64.8 + 14; }
      (list || []).forEach(function(c){ me.para(c, ST.Small, { w:CW - 40 }); });
    };
    /* Running head and foot on every page, once the page count is known. */
    this.chrome = function(label){
      var n = doc.getNumberOfPages(), foot = { f:'normal', s:8.4, l:11, c:C.med };
      for(var i = 1; i <= n; i++){
        doc.setPage(i);
        if(LOGO.wm) doc.addImage(LOGO.wm, 'PNG', ML, 26, 76, 16.4); else me.line([{ t:'MercerFargo', b:true }], { f:'bold', s:11, l:14, c:C.ink }, ML, 28);
        me.line([{ t:label }], foot, ML, 31, 'right', CW);
        me.line([{ t:'MercerFargo research, for information only. Not investment advice.' }], foot, ML, PH - 38);
        me.line([{ t:i + ' / ' + n }], foot, ML, PH - 38, 'right', CW);
      }
    };
  }

  var CAVEATS = [
    'Research framework, not investment advice. The verdict is only as good as its stated, contestable assumptions.',
    'Public data only: no management access or proprietary datasets. Prices and filings are as of the dates shown.',
    'Horizon and lens were chosen by the user; a different horizon can yield a different verdict from the same facts.',
    'Intrinsic value is sensitive to the discount rate and terminal assumptions; the ranges reflect this. AI can make mistakes.'
  ];
  function arr(x){ return Array.isArray(x) ? x.map(String) : (x ? [String(x)] : []); }
  function day(m){ return /^\d{4}-\d{2}-\d{2}/.test(m.analysis_date || '') ? m.analysis_date.slice(0, 10) : new Date().toISOString().slice(0, 10); }

  /* ---- the memo, section for section as generate_memo_pdf.py lays it out ---- */
  function memoPdf(m, sources){
    return ensure().then(function(){
      var p = new Pdf(), nm = m.company_name || m.ticker || '';
      p.para(nm, ST.Title);
      p.para((m.ticker ? m.ticker + '  ·  ' : '') + 'Screening memo  ·  ' + day(m) + '  ·  Lens: ' + (m.lens || '—') + '  ·  Horizon: ' + (m.time_horizon || '—'), ST.Sub);
      p.verdict(m.verdict, m.verdict_one_liner, m.highest_price); p.space(20);
      p.figures([['Current price', m.current_price], ['Independent fair value', m.fair_value_range || m.fair_value], ['Margin of safety', m.margin_of_safety], ['Valuation call', m.valuation_call]]);
      p.space(14);
      p.thesis(m.thesis_risk || { flaws:'', risks:arr(m.risks).join(' '), flip:m.what_would_change_my_mind || '' });
      p.para('Valuation snapshot', ST.H);
      p.kv([['Current price', m.current_price || '—'], ['Independent fair value', m.fair_value || '—'], ['Fair value range', m.fair_value_range || '—'], ['Margin of safety', m.margin_of_safety || '—'],
        ['Valuation call', m.valuation_call || '—'], ['Method(s) used', m.valuation_method || '—'], ['Consensus target (challenged)', m.consensus_target || '—']]);
      p.para('Intake and assumptions', ST.H);
      p.kv([['Lens', m.lens || '—'], ['Time horizon', m.time_horizon || '—'], ['Position size', m.position_size || '—'], ['Currently holding', m.holding || '—'], ['Cost basis', m.cost_basis || '—']]);
      if(arr(m.assumption_flags).length){ p.space(8); p.para('Flagged assumptions (the user did not confirm these):', ST.Tight); p.bullets(arr(m.assumption_flags), ST.Tight); }
      if(Array.isArray(m.financial_highlights) && m.financial_highlights.length){ p.para('Financial snapshot', ST.H); p.kv(m.financial_highlights.map(function(r){ return [r[0], r[1]]; })); }
      p.para('Bull vs bear', ST.H, { keep:170 }); p.bullBear(arr(m.bull_case), arr(m.bear_case));
      p.para('Independent fair value', ST.H);
      if(m.fair_value_narrative) p.para(m.fair_value_narrative, ST.Body);
      if(m.scenarios && m.scenarios.length){ p.space(6); p.scenarios(m.scenarios); }
      if(m.probability_weighted_value){ p.space(8); p.para('<b>Probability-weighted value:</b> ' + m.probability_weighted_value, ST.Body); }
      var cp = m.catalyst_panel;
      if(cp){
        p.para('Catalyst, convexity and reflexivity (growth lens)', ST.H);
        p.kv([['Hard catalyst', cp.catalyst || '—'], ['Narrative alignment', cp.narrative || '—'], ['Convexity profile', cp.convexity || '—']]);
        if(cp.reflexivity){ p.space(8); p.row(['Speculative reflexivity. Speculation, not value.'], [{ w:CW, st:{ f:'bold', s:9.8, l:13, c:C.dark } }], { bg:[C.gold] }); p.row([cp.reflexivity], [{ w:CW, st:ST.Cell }], { bg:[C.s2] }); }
        if(cp.survivorship_note) p.para(cp.survivorship_note, ST.Small);
      }
      p.para('Niche dominance and chain effects', ST.H);
      p.kv([['Dominates its niche?', m.dominance_verdict || '—'], ['Market share and trend', m.market_share || '—'], ['Moat type(s)', m.moat_type || '—'], ['Moat direction', m.moat_direction || '—']]);
      if(arr(m.chain_effects).length){ p.space(8); p.para('Chain effects (who catches a cold if it sneezes, and the reverse):', ST.Tight); p.bullets(arr(m.chain_effects), ST.Tight); }
      p.para('Verdict rationale', ST.H);
      if(m.verdict_rationale) p.para(m.verdict_rationale, ST.Body);
      if(m.what_would_change_my_mind) p.para('<b>What would change this judgment:</b> ' + m.what_would_change_my_mind, ST.Body);
      /* Pipeline items (Stock Research Pro Phase 4, kill gate, closing block), in the same language. */
      var er = [['Highest price I would pay', m.highest_price], ['Entry band', m.entry_band], ['Margin-of-safety tier', m.entry_tier], ['Position sizing', m.sizing]].filter(function(r){ return r[1]; });
      if(er.length || m.thesis){
        p.para('Entry, sizing and triggers', ST.H);
        if(m.thesis) p.para('<b>Thesis:</b> ' + m.thesis, ST.Body);
        if(er.length) p.kv(er);
        [['Add triggers', m.add_triggers], ['Trim triggers', m.trim_triggers], ['Exit triggers (price and valuation)', m.exit_triggers]].forEach(function(t){ if(arr(t[1]).length){ p.space(8); p.para(t[0] + ':', ST.Tight); p.bullets(arr(t[1]), ST.Tight); } });
      }
      if(arr(m.kill_criteria).length){ p.para('Kill criteria: wrong on the facts, exit regardless of price', ST.H); p.bullets(arr(m.kill_criteria), ST.Tight); }
      if(m.flow && (m.flow.form4 || m.flow.politicians || m.flow.institutional)){
        p.para('Insider and institutional flow (corroboration only)', ST.H);
        p.kv([['SEC Form 4 insiders', m.flow.form4 || '—'], ['Politician trades', m.flow.politicians || '—'], ['13F institutions', m.flow.institutional || '—']]);
      }
      if(arr(m.kill_gate).length){
        p.para('Kill gate', ST.H);
        p.kv(arr(m.kill_gate).map(function(s, i){ var k = s.indexOf(':'); return k > 0 && k < 40 ? [s.slice(0, k), s.slice(k + 1).trim()] : ['Check ' + (i + 1), s]; }));
      }
      if(m.confidence || arr(m.could_not_verify).length || m.review_date){
        p.para('Closing block', ST.H);
        p.kv([['Confidence', m.confidence || '—'], ['What I could not verify', arr(m.could_not_verify).join('; ') || 'Nothing material'], ['Analysis date', day(m)], ['Review date', m.review_date || '—']]);
      }
      p.para('Key risks and thesis breakers', ST.H); p.bullets(arr(m.risks), ST.Tight);
      p.sources(sources);
      p.close(arr(m.caveats).length ? arr(m.caveats) : CAVEATS);
      p.chrome('Deep Research  ·  ' + day(m));
      return { doc:p.doc, name:String(m.ticker || 'memo').toUpperCase().replace(/[^A-Z0-9.\-]/g, '') + '_stock-research-pro_memo_' + day(m) + '.pdf' };
    });
  }

  /* ---- any other report: markdown in the same design ---- */
  function mdPdf(md, meta){
    meta = meta || {};
    return ensure().then(function(){
      var p = new Pdf(), lines = String(md || '').replace(/\r/g, '').split('\n'), i = 0;
      var strip = function(t){ return String(t).replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`([^`]*)`/g, '$1').replace(/__([^_]+)__/g, '**$1**').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1$2').replace(/^\s*#+\s*/, ''); };
      p.para(meta.title || 'Research', ST.Title);
      p.para(meta.sub || 'Deep Research  ·  ' + new Date().toISOString().slice(0, 10), ST.Sub);
      while(i < lines.length){
        var l = lines[i];
        if(!l.trim()){ i++; continue; }
        var h = /^(#{1,6})\s+(.*)$/.exec(l);
        if(h && h[1].length === 1 && !p.started){ p.started = true; i++; continue; }   // the report's own top title is already the PDF title
        p.started = true;
        if(h){ p.para(strip(h[2]), h[1].length <= 2 ? ST.H : ST.H3, { keep:60 }); i++; continue; }
        if(/^\s*\|/.test(l) && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1] || '') && /-/.test(lines[i + 1] || '')){
          var cells = function(s){ return s.trim().replace(/^\||\|$/g, '').split('|').map(function(c){ return strip(c.trim()); }); };
          var head = cells(l), rows = []; i += 2;
          while(i < lines.length && /^\s*\|/.test(lines[i])){ rows.push(cells(lines[i])); i++; }
          p.space(4); p.grid(head, rows); p.space(10); continue;
        }
        if(/^\s*>/.test(l)){
          var q = []; while(i < lines.length && /^\s*>/.test(lines[i])){ q.push(strip(lines[i].replace(/^\s*>\s?/, ''))); i++; }
          var txt = q.join(' ').trim(), risk = /^\*{0,2}thesis risk/i.test(txt);
          p.space(6);
          if(risk) p.thesis({ flaws:txt.replace(/^\*{0,2}thesis risk\*{0,2}[:.\s-]*/i, ''), risks:'', flip:'' }, true); else p.row([txt], [{ w:CW, st:ST.Body, bg:C.s2 }], { pad:12 });
          p.space(10); continue;
        }
        if(/^\s*([-*+]|\d+[.)])\s+/.test(l)){
          var items = []; while(i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])){ items.push(strip(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''))); i++; }
          p.bullets(items, ST.Body); p.space(4); continue;
        }
        if(/^\s*(-{3,}|\*{3,})\s*$/.test(l)){ p.space(12); i++; continue; }
        var para = []; while(i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*>|\s*\|)/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])){ para.push(strip(lines[i])); i++; }
        p.para(para.join(' '), ST.Body);
      }
      p.sources(meta.sources);
      p.close(CAVEATS);
      p.chrome('Deep Research  ·  ' + new Date().toISOString().slice(0, 10));
      var slug = String(meta.title || 'research').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 6).join('-') || 'research';
      return { doc:p.doc, name:'MercerFargo-Research_' + slug + '_' + new Date().toISOString().slice(0, 10) + '.pdf' };
    });
  }
  return { memoPdf:memoPdf, mdPdf:mdPdf, VERDICTS:['Strong Buy', 'Buy', 'Hold', 'Sell'] };
})();
