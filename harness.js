/* ============================================================================
   Marvell harness: the agent loop behind Agent chat and Deep Research.

   Same shape as Google Research's FinanceHarness, rebuilt for this site and
   run in the browser so it works on the hosted copy and locally alike:
     loop      call the model with tool schemas -> run the tool calls it makes ->
               feed results back -> repeat until it answers or a cap trips
     adapters  native tool calling for OpenAI-style chat, OpenAI responses,
               Anthropic messages and Gemini (provider wire formats differ)
     tools     live data for ANY ticker (the site's own scrapers), web search and
               page reading (worker / serve.py), compute, the app guide, and
               app control (navigation runs at once; writes wait for Apply)
     sources   every fetched source gets a number the model cites as [n]
     review    Deep Research ends with a grounding pass against its sources

   Depends on globals from index.html (fetchJSON, resolveTV, filList, actNorm, ...),
   so it loads after the main script.
   ========================================================================== */
'use strict';

var MH = (function(){

  /* ---- small helpers ---------------------------------------------------- */
  function clip(s, n){ s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '\n…[truncated]' : s; }
  function num2(v){ var n = numOf(v); return n == null ? null : Math.round(n * 100) / 100; }
  function big(v){ var n = numOf(v); return n == null ? null : compact(n); }
  function symOf(x){ var s = dispSym(String(x || '').trim().toUpperCase()); return /^[A-Z0-9.\-=^:\/]{1,15}$/.test(s) ? s : ''; }
  var NAV = { t:0 };   // when the harness last navigated, so read_current_page waits for the new view
  function host(u){ try{ return new URL(u).hostname.replace(/^www\./, ''); }catch(e){ return u; } }
  function withTimeout(p, ms, what){
    return Promise.race([p, new Promise(function(_, rej){ setTimeout(function(){ rej(new Error(what + ' timed out')); }, ms); })]);
  }
  /* GET one of our own JSON routes: local serve.py first, then the hosted worker. Error bodies carry a message. */
  function apiGet(path){
    function get(url){
      return withTimeout(fetch(url), 25000, 'request').then(function(r){
        return r.text().then(function(t){
          var j; try{ j = JSON.parse(t); }catch(e){ throw new Error(r.ok ? 'bad response' : 'HTTP ' + r.status); }
          if(!r.ok || j.error) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), { status:r.status, json:true });
          return j;
        });
      });
    }
    if(!canTryProxy()) return get(OC_PROXY + path);
    return get(path).catch(function(e){ if(e.json && e.status !== 404 && e.status !== 405) throw e; return get(OC_PROXY + path); });
  }

  /* ---- tools -------------------------------------------------------------
     Each tool: description, JSON-schema params, run(args, ctx) -> string|object,
     label(args) for the step line, modes it is offered in. */
  var S = function(props, req){ return { type:'object', properties:props, required:req || [] }; };
  var STR = function(d, e){ var o = { type:'string', description:d }; if(e) o.enum = e; return o; };
  var NUM = function(d){ return { type:'number', description:d }; };
  var ARR = function(d, items){ return { type:'array', description:d, items:items || { type:'string' } }; };

  var TOOLS = {
    get_quote:{
      modes:'chat research', label:function(a){ return '📈 Quote: ' + (a.symbols || []).join(', '); },
      description:'Live (delayed) quote and key stats for up to 10 symbols of ANY US-listed stock, ETF, crypto (BTC, ETH) or FX pair (EUR/USD): price, change, market cap, P/E, EPS, dividend yield, beta, 52-week range, sector, revenue, net income, analyst consensus and price targets, next earnings date and forecasts. Use for any company, not just the one on screen (e.g. TSM for TSMC).',
      params:S({ symbols:ARR('Tickers, e.g. ["TSM","NVDA"]') }, ['symbols']),
      run:function(a, ctx){
        var syms = (a.symbols || []).map(symOf).filter(Boolean).slice(0, 10);
        if(!syms.length) throw new Error('give at least one ticker');
        return Promise.all(syms.map(function(s){
          if(isCrypto(s) || isFx(s)){
            return fetchQuotes([s]).then(function(){
              var q = DATA.quotes[s] || {};
              if(q.c == null) return { symbol:s, error:'no quote' };
              return { symbol:s, price:num2(q.c), changePct:num2(q.pct), source:q.src };
            });
          }
          // TradingView directly (not tvQuotes): the app's loader also writes earnings dates into the user's calendar.
          return resolveTV(s).then(function(full){
            if(!full) return { symbol:s, error:'unknown symbol on US exchanges; try web_search' };
            return fetchJSON('https://scanner.tradingview.com/symbol?symbol=' + encodeURIComponent(full) + '&fields=' + TV_FIELDS, 12000).then(function(d){
              var n = ctx.source('TradingView quote: ' + s, 'https://www.tradingview.com/symbols/' + full.replace(':', '-') + '/');
              var ne = numOf(d.earnings_release_next_date);
              return { symbol:s, source:n, name:d.description, exchange:d.exchange, price:num2(d.close), changePct:num2(d.change),
                preMarket:num2(d.premarket_close), afterHours:num2(d.postmarket_close), volume:big(d.volume), avgVolume10d:big(d.average_volume_10d_calc),
                marketCap:big(d.market_cap_basic), pe:num2(d.price_earnings_ttm), epsTTM:num2(d.earnings_per_share_diluted_ttm),
                dividendYieldPct:num2(d.dividends_yield), beta1y:num2(d.beta_1_year), high52w:num2(d.price_52_week_high), low52w:num2(d.price_52_week_low),
                sector:d.sector, industry:d.industry, country:d.country, revenueTTM:big(d.total_revenue), netIncomeTTM:big(d.net_income),
                debtToEquity:num2(d.debt_to_equity), roePct:num2(d.return_on_equity), employees:big(d.employees),
                analysts:{ total:d.recommendation_total, strongBuy:d.recommendation_buy, buy:d.recommendation_over, hold:d.recommendation_hold, sell:d.recommendation_under, strongSell:d.recommendation_sell,
                  targetAvg:num2(d.price_target_average), targetMedian:num2(d.price_target_median), targetHigh:num2(d.price_target_high), targetLow:num2(d.price_target_low) },
                nextEarnings:ne ? new Date(ne * 1000).toISOString().slice(0, 10) : null,
                epsForecastNextQ:num2(d.earnings_per_share_forecast_next_fq), epsForecastNextFY:num2(d.earnings_per_share_forecast_next_fy), revenueForecastNextFY:big(d.revenue_forecast_next_fy) };
            });
          }).catch(function(e){ return { symbol:s, error:String(e.message || e) }; });
        })).then(function(rows){ return { quotes:rows, note:'Free feeds, typically ~15 min delayed.' }; });
      }
    },
    get_price_history:{
      modes:'chat research', label:function(a){ return '📉 Price history: ' + a.symbol + ' ' + (a.range || '1Y'); },
      description:'Daily price history for any symbol: start/end/high/low, total return, and ~30 sampled closes.',
      params:S({ symbol:STR('Ticker'), range:STR('Window', ['1M', '6M', 'YTD', '1Y', '5Y']) }, ['symbol']),
      run:function(a, ctx){
        var s = symOf(a.symbol), r = /^(1M|6M|YTD|1Y|5Y)$/.test(a.range) ? a.range : '1Y';
        if(!s) throw new Error('bad ticker');
        return fetchHistory(s, r).then(function(rows){
          rows = (rows || []).filter(function(x){ return x && x.c != null; });
          if(!rows.length) throw new Error('no history for ' + s);
          var cs = rows.map(function(x){ return x.c; }), step = Math.max(1, Math.floor(rows.length / 30));
          var hi = Math.max.apply(null, cs), lo = Math.min.apply(null, cs);
          return { symbol:s, range:r, source:ctx.source('Price history: ' + s, 'https://stockanalysis.com/stocks/' + s.toLowerCase() + '/history/'),
            from:rows[0].d, to:rows[rows.length - 1].d, start:num2(cs[0]), end:num2(cs[cs.length - 1]), high:num2(hi), low:num2(lo),
            returnPct:num2((cs[cs.length - 1] / cs[0] - 1) * 100),
            sampled:rows.filter(function(_, i){ return i % step === 0 || i === rows.length - 1; }).map(function(x){ return [x.d, num2(x.c)]; }) };
        });
      }
    },
    get_financials:{
      modes:'chat research', label:function(a){ return '🧾 Financials: ' + a.symbol + ' (' + (a.statement || 'income') + ')'; },
      description:'Reported annual figures from SEC XBRL (last 4 fiscal years) for US filers: income statement, balance sheet or cash flow.',
      params:S({ symbol:STR('Ticker'), statement:STR('Which statement', ['income', 'balance', 'cash']) }, ['symbol']),
      run:function(a, ctx){
        var s = symOf(a.symbol), k = /^(income|balance|cash)$/.test(a.statement) ? a.statement : 'income';
        return secFinancials(s, k).then(function(f){
          return { symbol:s, entity:f.entity, statement:k, source:ctx.source('SEC XBRL company facts: ' + (f.entity || s), 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=' + s),
            rows:f.rows.map(function(r){ return { item:r.label, unit:r.unit, byFiscalYearEnd:r.ends.reduce(function(o, e, i){ o[e] = r.values[i]; return o; }, {}) }; }) };
        });
      }
    },
    list_filings:{
      modes:'chat research', label:function(a){ return '🗂 Filings: ' + a.symbol; },
      description:'Recent SEC EDGAR filings for a company (10-K, 10-Q, 8-K, 20-F, 6-K, proxy, Form 4...). Returns accession numbers for read_filing.',
      params:S({ symbol:STR('Ticker'), forms:ARR('Optional form filter, e.g. ["10-K","10-Q","8-K"]'), limit:NUM('Max rows, default 15') }, ['symbol']),
      run:function(a){
        var s = symOf(a.symbol), forms = (a.forms || []).map(function(f){ return String(f).toUpperCase(); });
        return filList(s).then(function(j){
          var rows = (j.filings || []).filter(function(r){ return !forms.length || forms.indexOf(r.form) >= 0; }).slice(0, Math.min(40, a.limit || 15));
          return { company:j.name, cik:j.cik, filings:rows.map(function(r){ return { date:r.filing_date, form:r.form, title:filTitle(r), accession:r.accession, url:filArch(r, null, j.cik) }; }) };
        });
      }
    },
    read_filing:{
      modes:'chat research', label:function(a){ return '📑 Reading ' + a.symbol + ' ' + (a.form || a.accession || 'latest report'); },
      description:'Read the text of one SEC filing: by accession number, or the latest of a form (default: latest 10-K/10-Q/20-F). Long reports are trimmed to risk factors and MD&A.',
      params:S({ symbol:STR('Ticker'), accession:STR('Accession number from list_filings (optional)'), form:STR('Form type if no accession, e.g. 10-K') }, ['symbol']),
      run:function(a, ctx){
        var s = symOf(a.symbol);
        return filList(s).then(function(j){
          var rows = j.filings || [], want = String(a.form || '').toUpperCase();
          var r = a.accession ? rows.filter(function(x){ return x.accession === a.accession; })[0]
            : rows.filter(function(x){ return want ? x.form === want : /^(10-K|10-Q|20-F)$/.test(x.form); })[0];
          if(!r) throw new Error('no matching filing; call list_filings first');
          return filDoc(r, s, j.cik).then(function(d){
            var url = d.url || filArch(r, null, j.cik);
            return 'source [' + ctx.source(s + ' ' + r.form + ' filed ' + r.filing_date, url) + '] ' + r.form + ' filed ' + r.filing_date + (d.partial ? ' (partial: very large document)' : '') +
              '\n\n' + filExcerpt(filLines(d.text), 18000);
          });
        });
      }
    },
    get_insider_trades:{
      modes:'chat research', label:function(a){ return '👔 Insider trades: ' + a.symbol; },
      description:'SEC Form 4 insider transactions (OpenInsider) for a US company: open-market buys and sales by officers/directors, with totals.',
      params:S({ symbol:STR('Ticker'), months:NUM('Look-back in months, default 6') }, ['symbol']),
      run:function(a, ctx){
        var s = symOf(a.symbol), m = Math.max(1, Math.min(24, a.months || 6));
        return insFetch(s).then(function(rows){
          var since = new Date(Date.now() - m * 30.4 * 864e5).toISOString().slice(0, 10);
          rows = rows.filter(function(r){ return r.d >= since; });
          var sum = function(k){ return rows.filter(function(r){ return r.kind === k; }).reduce(function(t, r){ return t + Math.abs(r.val || 0); }, 0); };
          return { symbol:s, months:m, source:ctx.source('OpenInsider Form 4: ' + s, 'http://openinsider.com/' + s),
            buys:rows.filter(function(r){ return r.kind === 'buy'; }).length, buyValue:compact(sum('buy')),
            sales:rows.filter(function(r){ return r.kind === 'sell'; }).length, saleValue:compact(sum('sell')),
            largest:rows.filter(function(r){ return r.kind !== 'other'; }).sort(function(x, y){ return Math.abs(y.val || 0) - Math.abs(x.val || 0); }).slice(0, 12)
              .map(function(r){ return { date:r.d, who:r.name, title:r.title, type:r.type, shares:r.qty, price:r.px, value:r.val }; }),
            note:'Sales are often planned (10b5-1), tax or diversification; open-market buys are the rarer signal.' };
        });
      }
    },
    get_news:{
      modes:'chat research', label:function(a){ return '📰 News: ' + a.query; },
      description:'Recent headlines for a ticker, company or topic (Google News / Yahoo Finance RSS).',
      params:S({ query:STR('e.g. "TSMC" or "NVDA stock"'), limit:NUM('Max headlines, default 10') }, ['query']),
      run:function(a, ctx){
        return fetchNews(String(a.query || ''), Math.min(20, a.limit || 10)).then(function(items){
          return { headlines:items.map(function(i){ return { source:ctx.source(i.title, i.link || i.url || ''), title:i.title, publisher:i.src, date:i.date ? new Date(i.date).toISOString().slice(0, 10) : null }; }) };
        });
      }
    },
    web_search:{
      modes:'chat research', label:function(a){ return '🔎 Searching “' + a.query + '”'; },
      description:'Search the web (Bing, DuckDuckGo fallback). Use for anything the data tools do not cover: recent events, guidance, competitors, industry data, non-US companies, macro. Follow up with read_webpage on the best results.',
      params:S({ query:STR('Search query') }, ['query']),
      run:function(a){
        return apiGet('/api/search?q=' + encodeURIComponent(String(a.query || '').slice(0, 300))).then(function(j){
          return { engine:(j._meta || {}).source, results:(j.results || []).slice(0, 8) };
        });
      }
    },
    read_webpage:{
      modes:'chat research', label:function(a){ return '📄 Reading ' + host(a.url); },
      description:'Fetch a public web page and return its readable text (up to ~20k characters). Some sites block automated reading; then try another source.',
      params:S({ url:STR('Full https URL') }, ['url']),
      run:function(a, ctx){
        return apiGet('/api/read?u=' + encodeURIComponent(String(a.url || ''))).then(function(j){
          return 'source [' + ctx.source(j.title || host(j.url), j.url) + '] ' + (j.title || '') + ' (' + j.url + ')' + (j.truncated ? ' [first 20k chars]' : '') + '\n\n' + j.text;
        });
      }
    },
    screen_stocks:{
      modes:'chat research', label:function(){ return '🧮 Screening stocks'; },
      description:'Filter ~1000 of the largest Nasdaq/NYSE/AMEX stocks by sector, market cap, price and day change; sort by market cap or day move. Good for peers, movers and ideas.',
      params:S({ sector:STR('Sector text to match, e.g. "Electronic Technology"'), query:STR('Name or ticker text to match'), min_market_cap_b:NUM('Min market cap, $ billions'),
        max_market_cap_b:NUM('Max market cap, $ billions'), min_price:NUM('Min price'), max_price:NUM('Max price'), min_change_pct:NUM('Min day change %'),
        max_change_pct:NUM('Max day change %'), sort:STR('Sort order', ['market_cap', 'gainers', 'losers']), limit:NUM('Max rows, default 15') }),
      run:function(a){
        return loadScreener(1000).then(function(){
          var q = String(a.query || '').toLowerCase(), sec = String(a.sector || '').toLowerCase();
          var rows = screenRows().filter(function(r){
            return (!sec || String(r.sector).toLowerCase().indexOf(sec) >= 0) && (!q || (r.sym + ' ' + r.name).toLowerCase().indexOf(q) >= 0) &&
              (a.min_market_cap_b == null || (r.mc || 0) >= a.min_market_cap_b * 1e9) && (a.max_market_cap_b == null || (r.mc || 0) <= a.max_market_cap_b * 1e9) &&
              (a.min_price == null || r.c >= a.min_price) && (a.max_price == null || r.c <= a.max_price) &&
              (a.min_change_pct == null || r.pct >= a.min_change_pct) && (a.max_change_pct == null || r.pct <= a.max_change_pct);
          });
          rows.sort(a.sort === 'gainers' ? function(x, y){ return y.pct - x.pct; } : a.sort === 'losers' ? function(x, y){ return x.pct - y.pct; } : function(x, y){ return (y.mc || 0) - (x.mc || 0); });
          return { matches:rows.length, rows:rows.slice(0, Math.min(50, a.limit || 15)).map(function(r){ return { symbol:r.sym, name:r.name, sector:r.sector, price:num2(r.c), changePct:num2(r.pct), marketCap:big(r.mc) }; }) };
        }, function(){ throw new Error('the market scan is unavailable here; use get_quote on specific tickers or web_search'); });
      }
    },
    get_investor_holdings:{
      modes:'chat research', label:function(a){ return '💼 Smart money: ' + (a.investor || 'all investors'); },
      description:'Holdings of tracked famous investors from their latest 13F / disclosures (Buffett, Burry, Ackman, Wood, Soros, Dalio, Li Lu, Marks, Jensen Huang, Pelosi, Trump). Omit investor to list them; pass symbol to see who holds a stock.',
      params:S({ investor:STR('Investor id or name, e.g. buffett'), symbol:STR('Optional ticker to look up across all investors') }),
      run:function(a){
        return guruLoad().then(function(inv){
          var sym = symOf(a.symbol);
          if(sym) return { symbol:sym, heldBy:Object.keys(inv).map(function(id){
            var h = (inv[id].holdings || []).filter(function(x){ return x.t === sym; })[0];
            return h ? { investor:(guruById(id) || {}).name || id, weightPct:num2(h.w), value:compact(h.v), shares:h.s, prevShares:h.ps, period:inv[id].period } : null;
          }).filter(Boolean) };
          var ref = String(a.investor || '').toLowerCase();
          var id = Object.keys(inv).filter(function(k){ var g = guruById(k) || {}; return k === ref || String(g.name || '').toLowerCase().indexOf(ref) >= 0; })[0];
          if(!ref || !id) return { investors:Object.keys(inv).map(function(k){ var g = guruById(k) || {}; return { id:k, name:g.name, firm:g.firm, style:g.tag, period:inv[k].period, holdings:(inv[k].holdings || []).length }; }) };
          var d = inv[id];
          return { investor:(guruById(id) || {}).name, filer:d.filer, source:d.source, period:d.period, filed:d.filed, totalValue:compact(d.total),
            top:(d.holdings || []).slice(0, 20).map(function(h){ return { symbol:h.t, name:h.n, weightPct:num2(h.w), value:compact(h.v), shares:h.s, prevShares:h.ps, option:h.pc || null }; }),
            soldOut:(d.sold || []).slice(0, 10).map(function(h){ return h.t; }), note:'13Fs are quarterly snapshots filed up to 45 days after quarter end, US long positions only.' };
        });
      }
    },
    calculate:{
      modes:'chat research', label:function(){ return '🧮 Calculating'; },
      description:'Evaluate an arithmetic expression exactly (+ - * / ^ % parentheses, decimals). Use instead of mental math.',
      params:S({ expression:STR('e.g. (229.33/176.5-1)*100') }, ['expression']),
      run:function(a){
        var e = String(a.expression || '').replace(/,/g, '');
        if(!/^[\d\s+\-*/().%^eE]+$/.test(e)) throw new Error('only numbers and + - * / ^ % ( ) are allowed');
        var v = Function('"use strict";return (' + e.replace(/\^/g, '**') + ')')();   // ponytail: whitelist above keeps this to arithmetic
        if(typeof v !== 'number' || !isFinite(v)) throw new Error('not a finite number');
        return { expression:a.expression, result:Math.round(v * 1e8) / 1e8 };
      }
    },
    dcf:{
      modes:'chat research', label:function(){ return '🧮 DCF model'; },
      description:'Simple discounted cash flow: project free cash flow at a growth rate, add a Gordon terminal value, discount, and (optionally) convert to value per share.',
      params:S({ fcf:NUM('Current annual free cash flow, in dollars'), growth_pct:NUM('Annual FCF growth % during the projection'), years:NUM('Projection years, default 5'),
        discount_pct:NUM('Discount rate (WACC) %'), terminal_growth_pct:NUM('Terminal growth %, default 2.5'), net_debt:NUM('Net debt in dollars (negative for net cash), default 0'), shares:NUM('Diluted shares outstanding (optional)') },
        ['fcf', 'growth_pct', 'discount_pct']),
      run:function(a){
        var n = Math.max(1, Math.min(15, a.years || 5)), g = a.growth_pct / 100, r = a.discount_pct / 100, tg = (a.terminal_growth_pct == null ? 2.5 : a.terminal_growth_pct) / 100;
        if(!(r > tg)) throw new Error('discount rate must exceed terminal growth');
        var f = a.fcf, pv = 0, flows = [];
        for(var t = 1; t <= n; t++){ f *= 1 + g; var d = f / Math.pow(1 + r, t); pv += d; flows.push({ year:t, fcf:compact(f), pv:compact(d) }); }
        var tv = f * (1 + tg) / (r - tg), pvTv = tv / Math.pow(1 + r, n), ev = pv + pvTv, eq = ev - (a.net_debt || 0);
        return { flows:flows, pvOfFlows:compact(pv), terminalValue:compact(tv), pvOfTerminal:compact(pvTv), terminalSharePct:num2(pvTv / ev * 100),
          enterpriseValue:compact(ev), equityValue:compact(eq), perShare:a.shares ? num2(eq / a.shares) : null, note:'Sensitive to growth and discount rate; show a range.' };
      }
    },
    read_docs:{
      modes:'chat research', label:function(){ return '📖 Checking the guide'; },
      description:'Read sections of the MercerFargo guide: how every page and feature works, and your own duties. Use when unsure about the app.',
      params:S({ sections:ARR('Section ids') }, ['sections']),
      run:function(a){
        var ids = (a.sections || []).map(String).filter(function(id){ return DOCS[id]; }).slice(0, 4);
        if(!ids.length) return 'No such section. Available: ' + (Object.keys(DOCS).join(', ') || '(guide unavailable)');
        return ids.map(function(id){ return DOCS[id]; }).join('\n\n');
      }
    },
    read_current_page:{
      modes:'chat', label:function(){ return '👀 Reading the page'; },
      description:'Read what is on the user\'s screen right now (route and visible text). Use after opening a page if you need its numbers.',
      params:S({}),
      run:function(){
        // Pages render after navigation (and quote pages fetch first): wait until the new view is on screen.
        var t0 = Date.now();
        function ready(){
          var m = $('main'), txt = m ? m.innerText : '';
          var quoteOk = CUR.view !== 'quote' || txt.indexOf(dispSym(CUR.sym) + ':') >= 0;
          return Date.now() - NAV.t > 900 && quoteOk && txt.length > 200;
        }
        return new Promise(function(done){
          (function poll(){ if(ready() || Date.now() - t0 > 6000) done(); else setTimeout(poll, 250); })();
        }).then(function(){
          var m = $('main');
          return 'Route: ' + (location.hash || '#/') + '\n\n' + clip(m ? m.innerText.replace(/\n{2,}/g, '\n') : '', 9000);
        });
      }
    },
    open_quote:{
      modes:'chat', label:function(a){ return '↗ Opening ' + a.symbol; },
      description:'Open a symbol\'s quote page for the user, optionally on a tab and chart range.',
      params:S({ symbol:STR('Ticker'), tab:STR('Tab', ['overview', 'analysis', 'earnings', 'financials', 'holdings', 'research']), range:STR('Chart range', ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'MAX']) }, ['symbol']),
      run:function(a, ctx){ return ctx.act({ do:'open_quote', symbol:a.symbol, tab:a.tab, range:a.range }); }
    },
    navigate:{
      modes:'chat', label:function(a){ return '↗ Opening ' + a.page + (a.symbol ? ' ' + a.symbol : ''); },
      description:'Open a page: home, portfolio (id optional), watchlist (id), screener, compare, earnings, markets (group), research (Research Log), settings (section), investors (id, e.g. buffett), insiders (symbol), filings (symbol).',
      params:S({ page:STR('Page', ['home', 'portfolio', 'watchlist', 'screener', 'compare', 'earnings', 'markets', 'research', 'settings', 'investors', 'insiders', 'filings']),
        id:STR('Portfolio/watchlist id or name, market group (US, Europe, Asia, Latin America, Currencies, Crypto, Commodities), settings section (profile, ai, appearance, data, briefings, skills, export) or investor id'),
        symbol:STR('Ticker for insiders/filings') }, ['page']),
      run:function(a, ctx){
        var p = a.page, id = String(a.id || ''), s = symOf(a.symbol);
        if(p === 'home' || p === 'screener' || p === 'compare' || p === 'earnings' || p === 'research' || p === 'portfolio') return ctx.act({ do:'open_page', page:p, id:id });
        var to = p === 'watchlist' ? '#/list/' + (actFind(LISTS, id) || CUR.list) : p === 'markets' ? '#/markets/' + (MARKET_GROUPS.filter(function(g){ return g.id.toLowerCase() === id.toLowerCase(); }).map(function(g){ return g.id; })[0] || CFG.market)
          : p === 'settings' ? '#/settings/' + (/^(profile|ai|appearance|data|briefings|skills|export)$/.test(id) ? id : 'profile') : p === 'investors' ? '#/investors/' + (guruById(id.toLowerCase()) ? id.toLowerCase() : '')
          : p === 'insiders' ? '#/insiders/' + s : p === 'filings' ? '#/filings/' + s : '';
        if(!to) throw new Error('unknown page');
        return ctx.go(to, 'Opened ' + p + (s ? ' ' + s : id ? ' ' + id : ''));
      }
    },
    compare:{
      modes:'chat', label:function(a){ return '↗ Comparing ' + (a.symbols || []).join(', '); },
      description:'Open the Compare page with 2-6 symbols side by side (normalized 1-year chart and returns table).',
      params:S({ symbols:ARR('2-6 tickers') }, ['symbols']),
      run:function(a, ctx){ return ctx.act({ do:'compare', symbols:a.symbols }); }
    },
    set_chart:{
      modes:'chat', label:function(){ return '↗ Adjusting the chart'; },
      description:'Change the chart on the open quote page: type, range, comparison overlays and moving averages.',
      params:S({ type:STR('Chart type', ['area', 'line', 'candles']), range:STR('Range', ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'MAX']),
        overlays:ARR('Up to 4 tickers to overlay, e.g. ["SPY","QQQ"]; [] clears'), moving_averages:ARR('Any of ma20, ma50, ma200; [] clears') }),
      run:function(a){
        if(CUR.view !== 'quote') throw new Error('no quote page is open; call open_quote first');
        if(/^(area|line|candles)$/.test(a.type)){ CUR.chart = CFG.chart = a.type; saveCfg(); }
        if(RANGE_DAYS[a.range]) CUR.range = a.range;
        if(Array.isArray(a.moving_averages)) ['ma20', 'ma50', 'ma200'].forEach(function(k){ CUR.ind[k] = a.moving_averages.indexOf(k) >= 0; });
        if(Array.isArray(a.overlays)){ CUR.cmp = {}; a.overlays.map(symOf).filter(Boolean).slice(0, 4).forEach(function(s){ CUR.cmp[s] = true; }); }
        return loadQuoteHistory().then(function(){ paintQuote(); return 'Chart updated on ' + CUR.sym + '.'; });
      }
    },
    run_screener:{
      modes:'chat', label:function(){ return '↗ Running the screener'; },
      description:'Open the Screener page with filters applied so the user can browse the results.',
      params:S({ sector:STR('Sector'), query:STR('Symbol or name text'), min_price:NUM('Min price'), max_price:NUM('Max price'), min_change_pct:NUM('Min day change %'),
        max_change_pct:NUM('Max day change %'), min_market_cap_b:NUM('Min market cap $B'), max_market_cap_b:NUM('Max market cap $B') }),
      run:function(a, ctx){
        var v = function(x){ return x == null ? '' : String(x); };
        CUR.screen = Object.assign(defaultScreen(), { sector:v(a.sector), q:v(a.query), minPx:v(a.min_price), maxPx:v(a.max_price), minPct:v(a.min_change_pct),
          maxPct:v(a.max_change_pct), minMc:v(a.min_market_cap_b), maxMc:v(a.max_market_cap_b) });
        return ctx.go('#/screener', 'Opened the screener with filters');
      }
    },
    open_filing:{
      modes:'chat', label:function(a){ return '↗ Opening ' + a.symbol + ' filings'; },
      description:'Open the Filings & Reports page for a company, optionally straight into one filing (accession from list_filings).',
      params:S({ symbol:STR('Ticker'), accession:STR('Accession number (optional)') }, ['symbol']),
      run:function(a, ctx){ var s = symOf(a.symbol); return ctx.go('#/filings/' + s + (a.accession ? '/' + encodeURIComponent(a.accession) : ''), 'Opened ' + s + ' filings'); }
    },
    propose_changes:{
      modes:'chat', label:function(){ return '✋ Proposing changes for approval'; },
      description:'Create, add to or delete portfolios and watchlists. Nothing changes until the user presses Apply on the card shown with your answer. Each action: {do:"create_portfolio",name,holdings:[{symbol,shares,cost?}]} | {do:"add_holdings",portfolio,holdings} | {do:"delete_portfolio",portfolio} | {do:"create_watchlist",name,symbols} | {do:"add_to_watchlist",watchlist,symbols}. Use exactly the holdings the user gave; never invent shares or costs.',
      params:S({ actions:ARR('Actions to propose', { type:'object', properties:{ do:STR('Action', ['create_portfolio', 'add_holdings', 'delete_portfolio', 'create_watchlist', 'add_to_watchlist']),
        name:STR('Name for a new portfolio/watchlist'), portfolio:STR('Existing portfolio id or name'), watchlist:STR('Existing watchlist id or name'),
        holdings:ARR('Holdings', { type:'object', properties:{ symbol:STR('Ticker'), shares:NUM('Shares'), cost:NUM('Average cost per share') }, required:['symbol', 'shares'] }),
        symbols:ARR('Tickers') }, required:['do'] }) }, ['actions']),
      run:function(a, ctx){
        var out = (a.actions || []).slice(0, 8).map(function(o){
          var n = actNorm(o);
          if(!n || actInstant(n)) return 'Rejected (invalid or unknown target): ' + JSON.stringify(o).slice(0, 120);
          ctx.acts.push({ a:n, st:'pending' });
          return 'Waiting for the user\'s approval: ' + actLabel(n);
        });
        return out.join('\n') || 'No actions given.';
      }
    },
    update_plan:{
      modes:'research', label:function(){ return '🗒 Updating the plan'; },
      description:'Set or update your research plan: the full ordered list of steps with status. Call at the start and whenever a step finishes.',
      params:S({ steps:ARR('Plan steps', { type:'object', properties:{ step:STR('Short imperative step'), status:STR('Status', ['pending', 'in_progress', 'completed']) }, required:['step', 'status'] }) }, ['steps']),
      run:function(a, ctx){ ctx.plan((a.steps || []).slice(0, 10)); return 'Plan updated.'; }
    }
  };

  /* ---- prompts ---------------------------------------------------------- */
  var CHAT_PROMPT = '\n\nTOOLS: you run inside the Marvell harness with live tools. You are NOT limited to the page the user has open: for any company, fund, crypto or market question, ' +
    'fetch real data (get_quote, get_price_history, get_financials, list_filings, read_filing, get_insider_trades, get_news, get_investor_holdings, screen_stocks) and use web_search plus read_webpage for anything else, ' +
    'recent, or non-US. Every number in your answer must come from a tool result, the DATA block or an attachment; cite tool sources as [n]. Use calculate or dcf for arithmetic.\n' +
    'APP CONTROL: you can drive MercerFargo. When the user wants to see something, or a page would clearly help, open it (open_quote, navigate, compare, set_chart, run_screener, open_filing); ' +
    'read_current_page shows what is on screen. Portfolio and watchlist changes go through propose_changes and wait for the user\'s Apply click; say what you proposed. ' +
    'Use read_docs when unsure how the app works or what you may do (sections: ' + '%DOCS%' + ').\n' +
    'Work efficiently: call independent tools in parallel, stop as soon as you can answer well, and never claim a page shows something you have not read.';
  var RESEARCH_PROMPT = '\n\nDEEP RESEARCH MODE: produce a thorough, well-sourced report. First call update_plan with 3-6 concrete steps and keep it current. ' +
    'Gather evidence with the tools: real numbers from the data tools, SEC filings for company facts, web_search plus read_webpage for news, guidance, competitors, industry and macro context. ' +
    'Prefer primary sources, cross-check key figures, and compute with calculate/dcf. Then write the final report in markdown: a short answer first, then the analysis the question needs, ' +
    'key risks, and what to watch next. Cite every specific figure or claim as [n] using the source numbers from tool results. Do not write a Sources list; the app appends it.';
  var REVIEW_PROMPT = 'Before this is final, reread your report against the tool results above. For any specific figure or claim you cannot tie to one of them, attribute it to whoever stated it ' +
    'or soften it to what you can support; leave everything already grounded, including figures you computed with tools, exactly as it is. Do not call tools. Reply with the complete revised report only.';

  /* ---- provider adapters ---------------------------------------------------
     History is kept neutral: {role:'user',content,images} | {role:'assistant',text,calls,raw} | {role:'tool',id,name,content}.
     Each adapter builds the wire request from it and parses the reply into {text, calls, raw}. */
  function geminiSchema(x){
    if(Array.isArray(x)) return x.map(geminiSchema);
    if(!x || typeof x !== 'object') return x;
    var o = {};
    Object.keys(x).forEach(function(k){ o[k] = k === 'type' ? String(x[k]).toUpperCase() : (k === 'properties' ? Object.keys(x[k]).reduce(function(p, n){ p[n] = geminiSchema(x[k][n]); return p; }, {}) : geminiSchema(x[k])); });
    if(o.type === 'OBJECT' && !Object.keys(o.properties || {}).length) delete o.properties;
    return o;
  }
  function groupTools(hist, fn){   // consecutive tool results become one message
    var out = [];
    hist.forEach(function(m){
      if(m.role === 'tool' && out.length && out[out.length - 1]._tools) out[out.length - 1]._tools.push(m);
      else if(m.role === 'tool') out.push({ _tools:[m] });
      else out.push(m);
    });
    return out.map(function(m){ return m._tools ? fn(m._tools) : m; });
  }
  function buildRequest(ep, model, sys, hist, tools, o){
    var names = Object.keys(tools), maxT = o.maxTokens, none = !!o.noTools;
    if(ep.wire === 'a' || ep.wire === 'm'){
      var msgs = groupTools(hist, function(ts){ return { role:'user', content:ts.map(function(t){ return { type:'tool_result', tool_use_id:t.id, content:t.content, is_error:!!t.err }; }) }; })
        .map(function(m){ return m.role === 'assistant' ? { role:'assistant', content:m.raw } : m.role === 'user' && m.content !== undefined && !Array.isArray(m.content) ? aiShape([m], 'a')[0] : m; });
      var b = { model:model, max_tokens:maxT, system:sys, messages:msgs,
        tools:names.map(function(n){ return { name:n, description:tools[n].description, input_schema:tools[n].params }; }) };
      if(none) b.tool_choice = { type:'none' };
      return b;
    }
    if(ep.wire === 'g'){
      var contents = groupTools(hist, function(ts){ return { role:'user', parts:ts.map(function(t){ return { functionResponse:{ name:t.name, response:{ content:t.content } } }; }) }; })
        .map(function(m){
          if(m.parts) return m;   // already-built tool results
          if(m.role === 'assistant') return { role:'model', parts:m.raw };
          if(m.role === 'user') return { role:'user', parts:(m.images || []).map(function(i){ return { inlineData:{ mimeType:i.mime, data:i.data } }; }).concat([{ text:m.content }]) };
          return m;
        });
      var g = { systemInstruction:{ parts:[{ text:sys }] }, contents:contents, generationConfig:{ maxOutputTokens:maxT },
        tools:[{ functionDeclarations:names.map(function(n){ var d = { name:n, description:tools[n].description }; var p = geminiSchema(tools[n].params); if(p.properties) d.parameters = p; return d; }) }] };
      if(none) g.toolConfig = { functionCallingConfig:{ mode:'NONE' } };
      return g;
    }
    if(ep.wire === 'r'){
      var input = [];
      hist.forEach(function(m){
        if(m.role === 'user') input.push(aiShape([m], 'r')[0]);
        else if(m.role === 'assistant'){
          if(m.text) input.push({ role:'assistant', content:m.text });
          m.calls.forEach(function(c){ input.push({ type:'function_call', call_id:c.id, name:c.name, arguments:JSON.stringify(c.args || {}) }); });
        } else input.push({ type:'function_call_output', call_id:m.id, output:m.content });
      });
      var r = { model:model, instructions:sys, input:input, max_output_tokens:maxT,
        tools:names.map(function(n){ return { type:'function', name:n, description:tools[n].description, parameters:tools[n].params }; }) };
      if(none) r.tool_choice = 'none';
      return r;
    }
    var keepReasoning = ep.prov === 'openrouter' || ep.prov === 'deepseek' || ep.zen;
    var messages = [{ role:'system', content:sys }];
    hist.forEach(function(m){
      if(m.role === 'user') messages.push(aiShape([m], 'o')[0]);
      else if(m.role === 'assistant'){
        var am = { role:'assistant', content:m.text || null };
        if(m.calls.length) am.tool_calls = m.calls.map(function(c){ return { id:c.id, type:'function', function:{ name:c.name, arguments:JSON.stringify(c.args || {}) } }; });
        if(keepReasoning && m.raw){ ['reasoning_content', 'reasoning', 'reasoning_details'].forEach(function(k){ if(m.raw[k] != null) am[k] = m.raw[k]; }); }
        messages.push(am);
      } else messages.push({ role:'tool', tool_call_id:m.id, content:m.content });
    });
    var c = { model:model, messages:messages, tools:names.map(function(n){ return { type:'function', function:{ name:n, description:tools[n].description, parameters:tools[n].params } }; }) };
    c[ep.prov === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = maxT;
    if(none) c.tool_choice = 'none';
    return c;
  }
  function parseArgs(x){ if(x && typeof x === 'object') return x; try{ var j = JSON.parse(x || '{}'); return j && typeof j === 'object' ? j : {}; }catch(e){ return {}; } }
  function parseReply(ep, j){
    if(ep.wire === 'a' || ep.wire === 'm'){
      var content = j.content || [];
      return { raw:content, text:content.filter(function(c){ return c.type === 'text'; }).map(function(c){ return c.text; }).join('\n').trim(),
        calls:content.filter(function(c){ return c.type === 'tool_use'; }).map(function(c){ return { id:c.id, name:c.name, args:c.input || {} }; }), cut:j.stop_reason === 'max_tokens' };
    }
    if(ep.wire === 'g'){
      var cand = (j.candidates || [])[0] || {}, parts = (cand.content || {}).parts || [];
      return { raw:parts, text:parts.filter(function(p){ return p.text && !p.thought; }).map(function(p){ return p.text; }).join('\n').trim(),
        calls:parts.filter(function(p){ return p.functionCall; }).map(function(p, i){ return { id:'g' + Date.now() + i, name:p.functionCall.name, args:p.functionCall.args || {} }; }), cut:cand.finishReason === 'MAX_TOKENS' };
    }
    if(ep.wire === 'r'){
      var out = j.output || [];
      return { raw:out, text:(j.output_text || out.filter(function(o){ return o.type === 'message'; }).map(function(o){ return (o.content || []).map(function(c){ return c.text || ''; }).join(''); }).join('\n')).trim(),
        calls:out.filter(function(o){ return o.type === 'function_call'; }).map(function(o){ return { id:o.call_id, name:o.name, args:parseArgs(o.arguments) }; }), cut:(j.incomplete_details || {}).reason === 'max_output_tokens' };
    }
    var ch = (j.choices || [])[0] || {}, msg = ch.message || {};
    return { raw:msg, text:String(msg.content || '').trim(),
      calls:(msg.tool_calls || []).map(function(c, i){ return { id:c.id || ('c' + Date.now() + i), name:(c.function || {}).name, args:parseArgs((c.function || {}).arguments) }; }), cut:ch.finish_reason === 'length' };
  }

  /* Old tool results are the bulk of a long run: past the budget, shrink the oldest ones first. */
  function trimHistory(hist, budget){
    var size = function(){ return hist.reduce(function(t, m){ return t + String(m.content || m.text || '').length; }, 0); };
    for(var i = 0; i < hist.length && size() > budget; i++){
      if(hist[i].role === 'tool' && hist[i].content.length > 1600) hist[i].content = hist[i].content.slice(0, 1500) + '\n…[older result trimmed to save space]';
    }
  }

  /* ---- the loop ----------------------------------------------------------- */
  function run(o){
    var mode = o.mode === 'research' ? 'research' : 'chat';
    var prov = o.provider, model = o.model || AI_DEFAULT_MODEL[prov] || '';
    if(prov === 'anthropic') model = model || 'claude-sonnet-5-5';
    if(prov === 'gemini') model = model || 'gemini-3.8-flash';
    var ep = aiEndpoint(prov, model), effortKey = AI_EFFORT[o.effort] ? o.effort : 'medium';
    var tools = {};
    Object.keys(TOOLS).forEach(function(n){ if(TOOLS[n].modes.indexOf(mode) >= 0) tools[n] = TOOLS[n]; });
    var sys = o.system + (mode === 'research' ? RESEARCH_PROMPT : CHAT_PROMPT.replace('%DOCS%', Object.keys(DOCS).join(', ') || 'guide unavailable'));
    var maxTokens = Math.max(AI_EFFORT[effortKey].mt, mode === 'research' ? 8000 : 3000);
    if(ep.wire !== 'a' && ep.wire !== 'm') maxTokens += THINK_ROOM[effortKey] || 4096;   // reasoning shares the output limit
    var maxRounds = o.maxRounds || (mode === 'research' ? 40 : 15), deadline = Date.now() + (o.maxMs || (mode === 'research' ? 600000 : 240000));
    var hist = (o.history || []).map(function(m){ return { role:m.role, content:m.content, text:m.content, calls:[], raw:m.role === 'assistant' ? aiAssistantRaw(ep, m.content) : null }; });
    hist.push({ role:'user', content:o.user, images:o.images || [] });
    var sources = [], acts = [], rounds = 0, stop = o.stop || {};
    var ctx = {
      source:function(title, url){
        var hit = sources.filter(function(x){ return x.url === url && url; })[0];
        if(hit) return hit.index;
        sources.push({ index:sources.length + 1, title:String(title || url).slice(0, 160), url:url || '' });
        return sources.length;
      },
      acts:acts,
      act:function(raw){
        var n = actNorm(raw);
        if(!n || !actInstant(n)) throw new Error('invalid target');
        actRun(n); NAV.t = Date.now(); acts.push({ a:n, st:'auto' });
        return actLabel(n) + '. You cannot see the new page yet; call read_current_page if you need its contents.';
      },
      go:function(hash, label){
        if($('drawer').classList.contains('full')) setFull(false);
        go(hash); NAV.t = Date.now(); return label + '. Call read_current_page if you need its contents.';
      },
      plan:function(steps){ if(o.onPlan) o.onPlan(steps); }
    };
    function step(s){ if(o.onStep) try{ o.onStep(s); }catch(e){} }
    function call(noTools, extraUser){
      var h = extraUser ? hist.concat([{ role:'user', content:extraUser, images:[] }]) : hist;
      trimHistory(hist, mode === 'research' ? 300000 : 120000);
      var body = buildRequest(ep, model, sys, h, tools, { maxTokens:maxTokens, noTools:noTools });
      aiReason(ep, model, body, effortKey);
      return aiPost(ep, o.key, body).then(function(j){ return parseReply(ep, j); });
    }
    function execAll(calls){
      return Promise.all(calls.map(function(c){
        var t = tools[c.name];
        if(!t) return Promise.resolve({ id:c.id, name:c.name, content:'ERROR: unknown tool ' + c.name, err:true });
        var label = ''; try{ label = t.label(c.args || {}); }catch(e){ label = c.name; }
        var rec = { kind:'tool', name:c.name, label:label, args:c.args };
        step(rec);
        return withTimeout(Promise.resolve().then(function(){ return t.run(c.args || {}, ctx); }), 45000, c.name).then(function(r){
          rec.ok = true; step(rec);
          var text = typeof r === 'string' ? r : JSON.stringify(r);
          return { id:c.id, name:c.name, content:clip(text, c.name === 'read_webpage' || c.name === 'read_filing' ? 21000 : 12000) };
        }, function(e){
          rec.ok = false; rec.error = String((e && e.message) || e); step(rec);
          return { id:c.id, name:c.name, content:'ERROR: ' + rec.error, err:true };
        });
      }));
    }
    function loop(){
      if(stop.stopped) return Promise.resolve('');
      if(rounds >= maxRounds || Date.now() > deadline){
        step({ kind:'round', label:'Writing the answer', detail:rounds >= maxRounds ? 'round limit reached' : 'time limit reached' });
        return call(true, 'You have reached your tool budget. Answer now with what you have, and say what you could not check.').then(function(r){ return r.text; });
      }
      rounds++;
      step({ kind:'round', label:'Round ' + rounds, round:rounds });
      return call(false).then(function(r){
        if(stop.stopped) return '';
        if(!r.calls.length){
          if(!r.text && r.cut) throw new Error('The model ran out of output tokens while thinking. Raise the effort level or pick another model.');
          return r.text;
        }
        hist.push({ role:'assistant', text:r.text, calls:r.calls, raw:r.raw });
        return execAll(r.calls).then(function(results){
          results.forEach(function(x){ hist.push({ role:'tool', id:x.id, name:x.name, content:x.content, err:x.err }); });
          return loop();
        });
      });
    }
    return loop().then(function(text){
      if(stop.stopped || mode !== 'research' || !text) return text;
      hist.push({ role:'assistant', text:text, calls:[], raw:aiAssistantRaw(ep, text) });
      step({ kind:'round', label:'Checking the report against its sources' });
      return call(true, REVIEW_PROMPT).then(function(r){ return r.text && r.text.length > text.length * 0.5 ? r.text : text; }, function(){ return text; });
    }).then(function(text){
      return { text:text || '', sources:sources, acts:acts, rounds:rounds, stopped:!!stop.stopped };
    });
  }
  /* A plain-text assistant turn in each wire's native shape (for earlier chat turns and the review pass). */
  function aiAssistantRaw(ep, text){
    if(ep.wire === 'a' || ep.wire === 'm') return [{ type:'text', text:text || '(no text)' }];
    if(ep.wire === 'g') return [{ text:text || '(no text)' }];
    return null;
  }

  return { run:run, TOOLS:TOOLS };
})();
