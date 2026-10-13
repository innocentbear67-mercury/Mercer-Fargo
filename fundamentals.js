/* Fundamentals tab: income statement, balance sheet, cash flow and the revenue breakdown (business and region) for any
   US-listed stock. Everything comes from SEC XBRL: companyfacts for the statements, the filing's own XBRL instance for
   the segment split. Quarterly Q4 is the 12-month figure minus the first nine; cash-flow quarters are differences of the
   year-to-date figures. Nothing is invented: a stock the SEC has no facts for gets a plain message. */
var FD = (function(){
  var S = { inst:{}, isort:'held', kind:'income', per:'q', show:'yoy', row:0, sym:'', st:'idle', err:'', facts:null, fyes:[], tbl:{}, seg:{}, segSel:{ biz:0, reg:0 } };
  var DAY = 864e5, PAL = ['#2f6bff', '#18a0a8', '#1fa35a', '#7aa62a', '#e0a21a', '#e0653a', '#a855f7', '#8a8f9c'];
  var REV = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'];

  var DEFS = {
    income:{ dur:true, rows:[
      { l:'Total Revenue', c:REV.concat(['RevenuesNetOfInterestExpense']), b:1 }, { l:'Cost of Revenue', c:['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'] },
      { l:'Gross Profit', c:['GrossProfit'], b:1, der:function(g){ return sub(g('Total Revenue'), g('Cost of Revenue')); } },
      { l:'Operating Expense', c:['OperatingExpenses'], b:1 },
      { l:'Selling and Admin Expenses', c:['SellingGeneralAndAdministrativeExpense'], s:1 }, { l:'Research & Development', c:['ResearchAndDevelopmentExpense'], s:1 },
      { l:'Depreciation & Amortization', c:['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization'], s:1 },
      { l:'Other Operating Expenses', c:['OtherCostAndExpenseOperating'], s:1 },
      { l:'Operating Profit', c:['OperatingIncomeLoss'], b:1 },
      { l:'Net Non-Operating Interest Income (Expense)', c:[], b:1, der:function(g){ return sub(g('Non-Operating Interest Income'), g('Non-Operating Interest Expense')); } },
      { l:'Non-Operating Interest Income', c:['InvestmentIncomeInterest', 'InvestmentIncomeInterestAndDividend', 'InterestIncomeOther'], s:1 },
      { l:'Non-Operating Interest Expense', c:['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt'], s:1 },
      { l:'Other Income (Expense)', c:['NonoperatingIncomeExpense', 'OtherNonoperatingIncomeExpense'], b:1 },
      { l:'Gain on Sale of Security', c:['GainLossOnSaleOfSecuritiesNet', 'GainLossOnInvestments', 'MarketableSecuritiesRealizedGainLoss'], s:1 },
      { l:'Special Income (Charges)', c:['AssetImpairmentCharges', 'GoodwillImpairmentLoss', 'ImpairmentOfLongLivedAssetsHeldForUse'], s:1 },
      { l:'Less: Restructuring and Merger & Acquisition', c:['RestructuringCharges', 'BusinessCombinationAcquisitionRelatedCosts'], s:1 },
      { l:'Pretax Profit', c:['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'], b:1 },
      { l:'Tax', c:['IncomeTaxExpenseBenefit'] }, { l:'Net Profit', c:['ProfitLoss', 'NetIncomeLoss'], b:1 },
      { l:'Profit from Continuing Operations', c:['IncomeLossFromContinuingOperations'] },
      { l:'Net Income Extraordinary', c:['IncomeLossFromDiscontinuedOperationsNetOfTax', 'ExtraordinaryItemNetOfTax'] },
      { l:'Net Income to Parent Company', c:['NetIncomeLoss'], b:1 }, { l:'Net Income to Common Stockholders', c:['NetIncomeLossAvailableToCommonStockholdersBasic', 'NetIncomeLoss'], b:1 },
      { l:'Basic EPS', c:['EarningsPerShareBasic'], u:'USD/shares', eps:1 }, { l:'Diluted EPS', c:['EarningsPerShareDiluted'], u:'USD/shares', eps:1 },
      { l:'Basic Shares', c:['WeightedAverageNumberOfSharesOutstandingBasic'], u:'shares' }, { l:'Diluted Shares', c:['WeightedAverageNumberOfDilutedSharesOutstanding'], u:'shares' },
      { l:'Dividend Per Share', c:['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid'], u:'USD/shares', eps:1 } ] },
    balance:{ dur:false, rows:[
      { l:'Total Assets', c:['Assets'], b:1 }, { l:'Total Current Assets', c:['AssetsCurrent'], b:1 },
      { l:'Cash and Cash Equivalents & Short-Term Investments', c:['CashCashEquivalentsAndShortTermInvestments', 'CashAndShortTermInvestments'], der:function(g){ return add(g('Cash and Cash Equivalents'), g('Short Term Investments')); } },
      { l:'Cash and Cash Equivalents', c:['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'], s:1 },
      { l:'Short Term Investments', c:['MarketableSecuritiesCurrent', 'ShortTermInvestments', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent', 'DebtSecuritiesCurrent'], s:1 },
      { l:'Receivables', c:['ReceivablesNetCurrent', 'AccountsReceivableNetCurrent'] }, { l:'Accounts Receivable', c:['AccountsReceivableNetCurrent'], s:1 },
      { l:'Prepaid Assets', c:['PrepaidExpenseCurrent', 'PrepaidExpenseAndOtherAssetsCurrent'] }, { l:'Inventory', c:['InventoryNet'] },
      { l:'Restricted Cash', c:['RestrictedCashCurrent', 'RestrictedCashAndCashEquivalentsAtCarryingValue'] }, { l:'Current Deferred Assets', c:['DeferredTaxAssetsNetCurrent', 'DeferredIncomeTaxAssetsNetCurrent'] },
      { l:'Other Current Assets', c:['OtherAssetsCurrent'] },
      { l:'Total Non-Current Assets', c:['NoncurrentAssets'], b:1, der:function(g){ return sub(g('Total Assets'), g('Total Current Assets')); } },
      { l:'Net PPE', c:['PropertyPlantAndEquipmentNet'] }, { l:'Gross PPE', c:['PropertyPlantAndEquipmentGross'], s:1 },
      { l:'Accumulated Depreciation', c:['AccumulatedDepreciationDepletionAndAmortizationPropertyPlantAndEquipment'], s:1 },
      { l:'Investments and Advances', c:['LongTermInvestments', 'LongTermInvestmentsAndReceivablesNet'] },
      { l:'Available for Sale Securities', c:['AvailableForSaleSecuritiesDebtSecuritiesNoncurrent', 'MarketableSecuritiesNoncurrent', 'AvailableForSaleSecuritiesNoncurrent'], s:1 },
      { l:'Non Current Accounts Receivables', c:['AccountsReceivableNetNoncurrent', 'NotesAndLoansReceivableNetNoncurrent'] }, { l:'Non-Current Prepaid Assets', c:['PrepaidExpenseNoncurrent', 'OtherPrepaidExpenseNoncurrent'] },
      { l:'Goodwill and Other Intangible Assets', c:['IntangibleAssetsNetIncludingGoodwill'], der:function(g){ return add(g('Goodwill'), g('Other Intangible Assets')); } },
      { l:'Goodwill', c:['Goodwill'], s:1 }, { l:'Other Intangible Assets', c:['IntangibleAssetsNetExcludingGoodwill', 'FiniteLivedIntangibleAssetsNet'], s:1 },
      { l:'Non-Current Deferred Assets', c:['DeferredIncomeTaxAssetsNet', 'DeferredTaxAssetsNetNoncurrent'] }, { l:'Other Non-Current Assets', c:['OtherAssetsNoncurrent'] },
      { l:'Total Liabilities', c:['Liabilities'], b:1, der:function(g){ return sub(g('Total Liabilities and Equity'), g('Total Equity')); } },
      { l:'Total Current Liabilities', c:['LiabilitiesCurrent'], b:1 },
      { l:'Payables', c:['AccountsPayableAndAccruedLiabilitiesCurrent'], der:function(g){ return add(g('Accounts Payable'), g('Total Tax Payable')); } },
      { l:'Accounts Payable', c:['AccountsPayableCurrent', 'AccountsPayableTradeCurrent'], s:1 }, { l:'Total Tax Payable', c:['TaxesPayableCurrent', 'IncomeTaxesPayableCurrent', 'AccruedIncomeTaxesCurrent'], s:1 },
      { l:'Other Payable', c:['OtherAccountsPayableAndAccruedLiabilities'], s:1 }, { l:'Current Accrued Expenses', c:['AccruedLiabilitiesCurrent'] },
      { l:'Short-Term Debt and Capital Lease Obligation', c:['DebtCurrent'], der:function(g){ return add(g('Current Debt'), g('Current Capital Lease Obligation')); } },
      { l:'Current Debt', c:['LongTermDebtCurrent', 'ShortTermBorrowings', 'ShortTermBankLoansAndNotesPayable'], s:1 },
      { l:'Current Capital Lease Obligation', c:['FinanceLeaseLiabilityCurrent', 'CapitalLeaseObligationsCurrent'], s:1 },
      { l:'Current Deferred Liabilities', c:['ContractWithCustomerLiabilityCurrent', 'DeferredRevenueCurrent'] }, { l:'Other Current Liabilities', c:['OtherLiabilitiesCurrent'] },
      { l:'Total Non-Current Liabilities', c:['LiabilitiesNoncurrent'], b:1, der:function(g){ return sub(g('Total Liabilities'), g('Total Current Liabilities')); } },
      { l:'Long Term Debt and Capital Lease Obligation', c:['LongTermDebtAndCapitalLeaseObligations'], der:function(g){ return add(g('Long Term Debt'), g('Long Term Capital Lease Obligation')); } },
      { l:'Long Term Debt', c:['LongTermDebtNoncurrent', 'LongTermDebt'], s:1 }, { l:'Long Term Capital Lease Obligation', c:['FinanceLeaseLiabilityNoncurrent', 'CapitalLeaseObligationsNoncurrent'], s:1 },
      { l:'Derivative Product Liabilities', c:['DerivativeLiabilitiesNoncurrent'] }, { l:'Non-Current Deferred Liabilities', c:['DeferredTaxLiabilitiesNoncurrent', 'DeferredIncomeTaxLiabilitiesNet'] },
      { l:'Employee Benefits', c:['PensionAndOtherPostretirementDefinedBenefitPlansLiabilitiesNoncurrent', 'LiabilityForFuturePolicyBenefits'] }, { l:'Other Non-Current Liabilities', c:['OtherLiabilitiesNoncurrent'] },
      { l:'Total Equity', c:['StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'StockholdersEquity'], b:1 }, { l:'Stockholders\u2019 Equity', c:['StockholdersEquity'], b:1 },
      { l:'Capital Stock', c:[], der:function(g){ return add(g('Common Stock'), g('Preferred Stock')); } },
      { l:'Common Stock', c:['CommonStockValue', 'CommonStockValueOutstanding'], s:1 }, { l:'Preferred Stock', c:['PreferredStockValue'], s:1 },
      { l:'Additional Paid-In Capital', c:['AdditionalPaidInCapital', 'AdditionalPaidInCapitalCommonStock'] }, { l:'Retained Earnings', c:['RetainedEarningsAccumulatedDeficit'] },
      { l:'Less: Treasury Stock', c:['TreasuryStockValue', 'TreasuryStockCommonValue'] }, { l:'Gains/Losses Not Affecting Retained Earnings', c:['AccumulatedOtherComprehensiveIncomeLossNetOfTax'] },
      { l:'Other Equity Interests', c:['MinorityInterest'] },
      { l:'Total Liabilities and Equity', c:['LiabilitiesAndStockholdersEquity'], hide:1 } ] },
    cash:{ dur:true, rows:[
      { l:'Operating Cash Flow', c:['NetCashProvidedByUsedInOperatingActivities'], b:1 }, { l:'Investing Cash Flow', c:['NetCashProvidedByUsedInInvestingActivities'], b:1 },
      { l:'Financing Cash Flow', c:['NetCashProvidedByUsedInFinancingActivities'], b:1 },
      { l:'Depreciation & Amortization', c:['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet'], s:1 },
      { l:'Share-Based Compensation', c:['ShareBasedCompensation'], s:1 }, { l:'Capital Expenditure', c:['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'], s:1 },
      { l:'Free Cash Flow', c:[], b:1, der:function(g){ return sub(g('Operating Cash Flow'), g('Capital Expenditure')); } },
      { l:'Dividends Paid', c:['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock'], s:1 }, { l:'Share Repurchases', c:['PaymentsForRepurchaseOfCommonStock'], s:1 } ] }
  };
  function add(a, b){ var o = {}; [a, b].forEach(function(m){ if(m) Object.keys(m).forEach(function(k){ o[k] = (o[k] || 0) + m[k]; }); }); return o; }
  function sub(a, b){ var o = {}; if(!a || !b) return o; Object.keys(a).forEach(function(k){ if(b[k] != null) o[k] = a[k] - b[k]; }); return o; }
  function esc2(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
  function ms(d){ return Date.parse(d); }

  /* ---- series from companyfacts ---- */
  function durSeries(arr){
    var by = {};
    arr.forEach(function(x){ if(!x.start) return; var k = x.start + '|' + x.end; if(!by[k] || x.filed > by[k].filed) by[k] = { s:x.start, e:x.end, v:x.val, filed:x.filed }; });
    var list = Object.keys(by).map(function(k){ var o = by[k]; o.d = (ms(o.e) - ms(o.s)) / DAY; return o; }), q = {}, a = {}, g = {};
    list.forEach(function(o){ if(o.d > 350 && o.d < 380) a[o.e] = o.v; if(o.d >= 80) (g[o.s] = g[o.s] || []).push(o); });
    Object.keys(g).forEach(function(s){
      var gr = g[s].sort(function(x, y){ return x.e < y.e ? -1 : 1; });
      gr.forEach(function(o, i){
        if(!i){ if(o.d <= 100) q[o.e] = o.v; return; }
        var gap = (ms(o.e) - ms(gr[i - 1].e)) / DAY;
        if(gap >= 80 && gap <= 100) q[o.e] = o.v - gr[i - 1].v;   // year-to-date difference (cash flow, and Q4 of everything)
      });
    });
    return { q:q, a:a };
  }
  function instSeries(arr){
    var by = {};
    arr.forEach(function(x){ if(!by[x.end] || x.filed > by[x.end].filed) by[x.end] = { v:x.val, filed:x.filed }; });
    var q = {}; Object.keys(by).forEach(function(e){ q[e] = by[e].v; });
    return { q:q, a:{} };
  }
  function merge(into, from){ ['q', 'a'].forEach(function(k){ Object.keys(from[k]).forEach(function(e){ if(into[k][e] == null) into[k][e] = from[k][e]; }); }); }
  function concept(facts, names, unit, dur){
    var out = { q:{}, a:{} };
    names.forEach(function(n){
      var f = facts[n]; if(!f || !f.units) return;
      var u = f.units[unit] || f.units[Object.keys(f.units)[0]]; if(!u) return;
      var arr = u.filter(function(x){ return /^10-[KQ]/.test(x.form); });
      merge(out, dur ? durSeries(arr) : instSeries(arr));
    });
    return out;
  }

  /* ---- fiscal labels: the fiscal year is named after the year it ends in (NVDA's quarter ending Jul 2026 is 2027/Q2 because its year ends Jan 2027) ---- */
  function fiscalLabel(end, annual){
    var t = ms(end), fy = null, i;
    for(i = 0; i < S.fyes.length; i++) if(S.fyes[i] >= t - 6 * DAY){ fy = S.fyes[i]; break; }
    if(fy == null){ var last = S.fyes[S.fyes.length - 1] || t; fy = last; while(fy < t - 6 * DAY) fy += 364.25 * DAY; }
    var yr = new Date(fy).getUTCFullYear();
    if(annual) return yr + '/FY';
    var q = 4 - Math.round((fy - t) / DAY / 91.3);
    return yr + '/Q' + Math.min(4, Math.max(1, q));
  }
  function build(){
    var facts = (S.facts.facts && (S.facts.facts['us-gaap'] || S.facts.facts['ifrs-full'])) || {};
    S.gaap = S.facts.facts && S.facts.facts['us-gaap'] ? 'US_GAAP' : 'IFRS';
    var fye = {}, rv = concept(facts, REV, 'USD', true);
    Object.keys(rv.a).forEach(function(e){ fye[e] = 1; });
    if(!Object.keys(fye).length) Object.keys(concept(facts, ['NetIncomeLoss', 'ProfitLoss'], 'USD', true).a).forEach(function(e){ fye[e] = 1; });
    S.fyes = Object.keys(fye).sort().map(ms);
    if(!S.fyes.length && !Object.keys(facts).length) throw new Error('The SEC has no 10-K / 10-Q facts for ' + S.sym + ' (non-US issuers file different forms).');
    Object.keys(DEFS).forEach(function(kind){
      var D = DEFS[kind], ser = {};
      D.rows.forEach(function(r){ ser[r.l] = concept(facts, r.c, r.u || 'USD', D.dur); });
      D.rows.forEach(function(r){
        if(!r.der) return;
        var g = function(l){ return ser[l]; }, dq = r.der(function(l){ return ser[l] && ser[l].q; });
        Object.keys(dq).forEach(function(e){ if(ser[r.l].q[e] == null) ser[r.l].q[e] = dq[e]; });
      });
      // annual column: duration kinds use the 12-month facts; balance sheet uses the Q4 / fiscal-year-end balance
      var ends = {};
      D.rows.forEach(function(r){ if(!r.hide) Object.keys(ser[r.l].q).forEach(function(e){ ends[e] = 1; }); });
      var qe = Object.keys(ends).sort();
      var ae = D.dur ? Object.keys(ser[D.rows[0].l].a).sort() : qe.filter(function(e){ return /Q4$/.test(fiscalLabel(e)); });
      if(!D.dur) D.rows.forEach(function(r){ ae.forEach(function(e){ if(ser[r.l].q[e] != null) ser[r.l].a[e] = ser[r.l].q[e]; }); });
      else D.rows.forEach(function(r){ if(r.der) { var dq = r.der(function(l){ return ser[l] && ser[l].a; }); Object.keys(dq).forEach(function(e){ if(ser[r.l].a[e] == null) ser[r.l].a[e] = dq[e]; }); } });
      S.tbl[kind] = { ser:ser, q:qe, a:ae };
    });
  }
  function near(map, end, back){   // the value one year (or one quarter) earlier, tolerating 52/53-week drift
    var t = ms(end) - back * DAY, best = null, bd = 25;
    Object.keys(map).forEach(function(e){ var d = Math.abs(ms(e) - t) / DAY; if(d < bd){ bd = d; best = e; } });
    return best == null ? null : map[best];
  }
  function matrix(kind){
    var T = S.tbl[kind], D = DEFS[kind], per = S.per, ends = (per === 'q' ? T.q : T.a).slice(-(per === 'q' ? 20 : 10));
    var rows = D.rows.filter(function(r){ return !r.hide; }).map(function(r){
      var m = T.ser[r.l][per] || {};
      return { r:r, cells:ends.map(function(e){
        var v = m[e], p = v == null ? null : near(m, e, 365.25), yoy = v != null && p != null && p !== 0 ? (v - p) / Math.abs(p) * 100 : null;
        return { v:v, yoy:yoy };
      }) };
    }).filter(function(x){ return x.cells.some(function(c){ return c.v != null; }); });
    return { ends:ends, labels:ends.map(function(e){ return fiscalLabel(e, per === 'a'); }), rows:rows };
  }
  function fmt(v, eps){ return v == null ? '—' : eps ? v.toFixed(2) : compact(v); }

  /* ---- page ---- */
  function load(){
    var sym = dispSym(CUR.sym);
    S.sym = sym; S.st = 'loading'; S.err = ''; S.seg = {}; S.subs = null; S.row = 0;
    secCikFor(sym).then(function(cik){ S.cik = cik; return fetchJSON('https://data.sec.gov/api/xbrl/companyfacts/CIK' + cik + '.json', 40000); }).then(function(j){
      if(S.sym !== sym) return;
      S.facts = j; build(); S.st = 'ready'; S.entity = j.entityName;
      compat();
    }).catch(function(e){ if(S.sym !== sym) return; S.st = 'error'; S.err = e && e.status === 404 ? 'the SEC has no filings for it (funds, ETFs and non-US issuers do not file 10-K / 10-Q)' : (e && e.message) || 'unreachable'; }).then(function(){ if(S.sym === sym && CUR.tab === 'financials') paintQuotePanel(); });
  }
  function compat(){   // keeps the "Explain with AI" button fed with the real rows (in millions)
    try{ var k = S.kind === 'rev' ? 'income' : S.kind, mx = matrix(k); Q.fin.data = { cols:mx.labels.slice(-4), rows:mx.rows.map(function(x){ return [x.r.l].concat(x.cells.slice(-4).map(function(c){ return c.v == null ? null : x.r.eps ? c.v : c.v / 1e6; })); }) }; Q.fin.status = 'sec'; }catch(e){}
  }
  function html(){
    var sym = dispSym(CUR.sym);
    if(S.sym !== sym || S.st === 'idle') load();
    var kinds = [['income', 'Income Statement'], ['balance', 'Balance Sheet'], ['cash', 'Cash Flow'], ['rev', 'Revenue Breakdown'], ['inst', 'Institutions']];
    var h = '<div class="section fd"><div class="sub-tabs">' + kinds.map(function(k){ return '<button class="' + (S.kind === k[0] ? 'on' : '') + '" data-fd="kind" data-v="' + k[0] + '">' + k[1] + '</button>'; }).join('') +
      '</div><div class="section-head"><h2>' + esc2(S.entity || sym) + '</h2><button class="btn text sm" data-act="ai" data-kind="financials">Explain with AI</button></div>';
    if(S.st === 'loading' || S.st === 'idle') return h + '<div class="mut fd-msg">Loading ' + esc2(sym) + ' filings from the SEC…</div></div>';
    if(S.st === 'error') return h + '<div class="mut fd-msg">Could not load statements for ' + esc2(sym) + ': ' + esc2(S.err) + '</div></div>';
    if(S.kind === 'rev') return h + revHTML() + '</div>';
    if(S.kind === 'inst') return h + instHTML() + '</div>';
    var mx = matrix(S.kind);
    if(!mx.rows.length) return h + '<div class="mut fd-msg">The SEC has no ' + esc2(S.kind) + ' facts for ' + esc2(sym) + '.</div></div>';
    if(S.row >= mx.rows.length) S.row = 0;
    h += '<div class="fd-ctl"><select class="inp" data-fd="per"><option value="q"' + (S.per === 'q' ? ' selected' : '') + '>Quarterly</option><option value="a"' + (S.per === 'a' ? ' selected' : '') + '>Annual</option></select>' +
      '<select class="inp" data-fd="show"><option value="yoy"' + (S.show === 'yoy' ? ' selected' : '') + '>YoY Change</option><option value="val"' + (S.show === 'val' ? ' selected' : '') + '>Values only</option></select></div>';
    h += '<div class="fd-chart" id="fdChart"></div><div class="fd-wrap" id="fdWrap"><table class="fd-tbl"><thead><tr><th>Currency: USD</th>' + mx.labels.map(function(l){ return '<th>' + l + '</th>'; }).join('') + '</tr></thead><tbody>' +
      mx.rows.map(function(x, i){
        return '<tr class="' + (i === S.row ? 'sel ' : '') + (x.r.s ? 'sub' : '') + '" data-fd="row" data-v="' + i + '"><td class="nm">' + (x.r.b ? '<i class="bul"></i>' : '') + esc2(x.r.l) + '</td>' +
          x.cells.map(function(c){
            return '<td><b>' + fmt(c.v, x.r.eps) + '</b>' + (S.show === 'yoy' ? '<small class="' + (c.yoy == null ? 'mut' : c.yoy >= 0 ? 'up' : 'down') + '">' + (c.yoy == null ? '' : (c.yoy >= 0 ? '+' : '') + c.yoy.toFixed(2) + '%') + '</small>' : '') + '</td>';
          }).join('') + '</tr>';
      }).join('') + '<tr class="meta"><td class="nm">Deadline</td>' + mx.ends.map(function(e){ return '<td>' + new Date(e + 'T00:00:00Z').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', timeZone:'UTC' }) + '</td>'; }).join('') + '</tr>' +
      '<tr class="meta"><td class="nm">Accounting Standard</td>' + mx.ends.map(function(){ return '<td>' + S.gaap + '</td>'; }).join('') + '</tr></tbody></table></div>' +
      '<div class="movers-note">Source: SEC XBRL filings (10-K and 10-Q). Q4 is the full year minus the first nine months' + (S.kind === 'cash' ? '; cash-flow quarters are differences of the year-to-date figures' : '') + '. Click a row to chart it. Fiscal years are named after the year they end in.</div></div>';
    return h;
  }

  /* ---- the bar + YoY line chart for the selected row ---- */
  function draw(){
    var host = $('fdChart'), w = $('fdWrap');
    if(w && !w.dataset.done){ w.scrollLeft = w.scrollWidth; w.dataset.done = 1; }
    if(!host || S.kind === 'rev' || S.st !== 'ready') return;
    var mx = matrix(S.kind), x = mx.rows[S.row]; if(!x) return;
    var n = mx.ends.length, W = host.clientWidth || 900, H = 230, L = 58, R = 74, T = 14, B = 32, iw = W - L - R, ih = H - T - B, band = iw / n;
    var vs = x.cells.map(function(c){ return c.v; }).filter(function(v){ return v != null; }), ys = x.cells.map(function(c){ return c.yoy; }).filter(function(v){ return v != null; });
    var vmin = Math.min(0, Math.min.apply(null, vs)), vmax = Math.max(0, Math.max.apply(null, vs)) || 1, vs2 = vmax - vmin || 1;
    var ymin = ys.length ? Math.min.apply(null, ys) : 0, ymax = ys.length ? Math.max.apply(null, ys) : 1, ys2 = ymax - ymin || 1;
    var vy = function(v){ return T + ih - (v - vmin) / vs2 * ih; }, py = function(p){ return T + ih - (p - ymin) / ys2 * ih; };
    var o = [], k;
    for(k = 0; k <= 3; k++){
      var yy = T + ih - ih * k / 3;
      o.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" class="fdg"/>');
      o.push('<text x="' + (W - R + 8) + '" y="' + (yy + 4) + '" class="fda">' + fmt(vmin + vs2 * k / 3, x.r.eps) + '</text>');
      if(S.show === 'yoy' && ys.length) o.push('<text x="' + (L - 8) + '" y="' + (yy + 4) + '" text-anchor="end" class="fda">' + (ymin + ys2 * k / 3).toFixed(1) + '%</text>');
    }
    var z = vy(0), step = Math.ceil(n / Math.max(1, Math.floor(iw / 62)));
    x.cells.forEach(function(c, i){
      var cx = L + band * (i + .5), bw = Math.max(4, Math.min(30, band * .34));
      if(c.v != null) o.push('<rect x="' + (cx - bw / 2) + '" y="' + Math.min(z, vy(c.v)) + '" width="' + bw + '" height="' + Math.max(1, Math.abs(vy(c.v) - z)) + '" fill="#2f6bff" rx="1.5"/>');
      if((n - 1 - i) % step === 0) o.push('<text x="' + cx + '" y="' + (H - 10) + '" text-anchor="middle" class="fda">' + mx.labels[i] + '</text>');
    });
    if(S.show === 'yoy' && ys.length){
      var d = '', pen = false;
      x.cells.forEach(function(c, i){ if(c.yoy == null){ pen = false; return; } d += (pen ? 'L' : 'M') + (L + band * (i + .5)).toFixed(1) + ' ' + py(c.yoy).toFixed(1); pen = true; });
      o.push('<path d="' + d + '" fill="none" stroke="#ff8a1f" stroke-width="1.6"/>');
    }
    o.push('<rect id="fdHit" x="' + L + '" y="' + T + '" width="' + iw + '" height="' + ih + '" fill="transparent"/><line id="fdCur" y1="' + T + '" y2="' + (T + ih) + '" class="fdc" style="display:none"/>');
    host.innerHTML = '<svg width="' + W + '" height="' + H + '">' + o.join('') + '</svg><div class="fd-tip" id="fdTip" hidden></div>' +
      '<div class="fd-leg"><i style="background:#2f6bff"></i>' + esc2(x.r.l) + (S.show === 'yoy' ? '<i style="background:#ff8a1f"></i>YoY Change' : '') + '</div>';
    var hit = $('fdHit'), cur = $('fdCur'), tip = $('fdTip');
    hit.onmousemove = function(ev){
      var r = host.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.floor((ev.clientX - r.left - L) / band))), c = x.cells[i], cx = L + band * (i + .5);
      cur.setAttribute('x1', cx); cur.setAttribute('x2', cx); cur.style.display = '';
      tip.hidden = false; tip.innerHTML = '<b>' + mx.labels[i] + '</b><div><i style="background:#2f6bff"></i>' + esc2(x.r.l) + '<span>' + fmt(c.v, x.r.eps) + '</span></div>' + (S.show === 'yoy' ? '<div><i style="background:#ff8a1f"></i>YoY Change<span>' + (c.yoy == null ? '—' : (c.yoy >= 0 ? '+' : '') + c.yoy.toFixed(2) + '%') + '</span></div>' : '');
      tip.style.left = Math.max(0, Math.min(W - tip.offsetWidth, cx - tip.offsetWidth / 2)) + 'px';
    };
    hit.onmouseleave = function(){ cur.style.display = 'none'; tip.hidden = true; };
  }

  /* ---- revenue breakdown (business and region), read from the filing's XBRL instance ---- */
  var ISO = { US:'United States', TW:'Taiwan', CN:'China', HK:'Hong Kong', JP:'Japan', KR:'South Korea', DE:'Germany', GB:'United Kingdom', FR:'France', IN:'India', SG:'Singapore', CA:'Canada', MX:'Mexico', IL:'Israel', NL:'Netherlands', IE:'Ireland', CH:'Switzerland', AU:'Australia', BR:'Brazil', IT:'Italy', ES:'Spain', SE:'Sweden', BE:'Belgium', MY:'Malaysia', TH:'Thailand', VN:'Vietnam', AE:'United Arab Emirates', SA:'Saudi Arabia', RU:'Russia' };
  function memberName(q){
    var p = q.split(':'), loc = p[1] || q;
    if(p[0] === 'country' && ISO[loc]) return ISO[loc];
    return loc.replace(/(Member|Segment|Segments)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\bNon Us\b/, 'Non-US').replace(/\bAnd\b/g, '&').replace(/\bIncluding\b/g, '(including').replace(/(\(including [A-Za-z ]+)$/, '$1)').trim();
  }
  var BIZ = /StatementBusinessSegmentsAxis|ProductOrServiceAxis/, GEO = /StatementGeographicalAxis|SegmentGeographicalAxis/;
  function parseInstance(xml){
    var doc = new DOMParser().parseFromString(xml, 'text/xml'), XB = 'http://www.xbrl.org/2003/instance', XD = 'http://xbrl.org/2006/xbrldi', ctx = {};
    var cs = doc.getElementsByTagNameNS(XB, 'context'), i;
    for(i = 0; i < cs.length; i++){
      var c = cs[i], s = c.getElementsByTagNameNS(XB, 'startDate')[0], e = c.getElementsByTagNameNS(XB, 'endDate')[0], dims = [], ms2 = c.getElementsByTagNameNS(XD, 'explicitMember'), j;
      for(j = 0; j < ms2.length; j++) dims.push([ms2[j].getAttribute('dimension'), ms2[j].textContent.trim()]);
      ctx[c.getAttribute('id')] = { s:s && s.textContent, e:e && e.textContent, dims:dims };
    }
    var facts = [], kids = doc.documentElement.children;
    for(i = 0; i < kids.length; i++){
      var k = kids[i], ci = k.getAttribute('contextRef');
      if(!ci || REV.indexOf(k.localName) < 0) continue;
      var cx = ctx[ci], v = parseFloat(k.textContent); if(!cx || !cx.s || !isFinite(v)) continue;
      facts.push({ cx:cx, v:v });
    }
    function pick(axisRe, skip){
      var total = {}, byAx = {};
      facts.forEach(function(f){
        var per = f.cx.s + '|' + f.cx.e;
        if(!f.cx.dims.length){ if(total[per] == null) total[per] = f.v; return; }
        if(f.cx.dims.length !== 1 || !axisRe.test(f.cx.dims[0][0])) return;
        var ax = f.cx.dims[0][0]; ((byAx[ax] = byAx[ax] || {})[per] = byAx[ax][per] || {})[f.cx.dims[0][1]] = f.v;
      });
      var best = null;
      Object.keys(byAx).forEach(function(ax){
        var pers = Object.keys(byAx[ax]).sort(function(a, b){ var pa = a.split('|'), pb = b.split('|'); return pa[1] < pb[1] ? 1 : pa[1] > pb[1] ? -1 : (ms(pa[1]) - ms(pa[0])) - (ms(pb[1]) - ms(pb[0])); });
        var per = pers[0], mem = byAx[ax][per], tot = total[per], items = Object.keys(mem).filter(function(m){ return mem[m] > 0 && !(skip && skip.test(m)); }).sort(function(a, b){ return mem[b] - mem[a]; }), acc = 0, out = [];
        items.forEach(function(m){ if(!tot || acc + mem[m] <= tot * 1.005){ out.push({ name:memberName(m), v:mem[m] }); acc += mem[m]; } });   // overlapping members (a sub-split of another) would push past the total, so they are left out
        if(out.length < 2) return;
        var score = tot ? Math.abs(acc - tot) / tot : 1;
        if(!best || score < best.score - 1e-9) best = { score:score, per:per, items:out, sum:acc, total:tot };
      });
      return best;
    }
    return { biz:pick(BIZ, /Americas|Europe|Asia|China|Japan|Pacific/), reg:pick(GEO) };
  }
  function filings(){
    if(S.subs) return Promise.resolve(S.subs);
    return fetchJSON('https://data.sec.gov/submissions/CIK' + S.cik + '.json', 30000).then(function(j){
      var r = j.filings.recent, out = [];
      r.form.forEach(function(f, i){ if(f === '10-K' || f === '10-Q') out.push({ form:f, acc:r.accessionNumber[i], date:r.filingDate[i], end:r.reportDate[i] }); });
      return (S.subs = out);
    });
  }
  function segLoad(which){
    var sel = S.segSel[which], key = which + sel; if(S.seg[key]) return;
    S.seg[key] = { st:'loading' };
    filings().then(function(all){
      var list = which === 'reg' ? all.filter(function(f){ return f.form === '10-K'; }).slice(0, 4) : all.slice(0, 6), f = list[sel] || list[0];
      if(!f) throw new Error('no filings');
      var cik = String(parseInt(S.cik, 10)), nd = f.acc.replace(/-/g, ''), base = 'https://www.sec.gov/Archives/edgar/data/' + cik + '/' + nd + '/';
      return fetchJSON(base + 'index.json', 30000).then(function(ix){
        var names = ix.directory.item.map(function(x){ return x.name; }), nm = names.filter(function(n){ return /_htm\.xml$/.test(n); })[0] || names.filter(function(n){ return /^[^_]+\.xml$/.test(n) && !/FilingSummary/.test(n); })[0];
        if(!nm) throw new Error('no XBRL instance');
        return fetchText(base + nm, 60000);
      }).then(function(xml){
        var res = parseInstance(xml)[which];
        S.seg[key] = { st:'ready', f:f, list:list, res:res };
      });
    }).catch(function(e){ S.seg[key] = { st:'error', err:(e && e.message) || 'unreachable' }; }).then(function(){ if(CUR.tab === 'financials' && S.kind === 'rev') paintQuotePanel(); });
  }
  function donut(res){
    var R = 78, C = 2 * Math.PI * R, off = 0, tot = res.sum;
    return '<svg viewBox="0 0 200 200" width="200" height="200" class="fd-donut">' + res.items.map(function(it, i){
      var len = it.v / tot * C, s = '<circle cx="100" cy="100" r="' + R + '" fill="none" stroke="' + PAL[i % PAL.length] + '" stroke-width="30" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 100 100)" data-fd-slice="' + i + '"/>';
      off += len; return s;
    }).join('') + '<text x="100" y="96" text-anchor="middle" class="fd-ct1">' + compact(tot) + '</text><text x="100" y="116" text-anchor="middle" class="fd-ct2">Total</text></svg>';
  }
  function card(which, title){
    segLoad(which);
    var d = S.seg[which + S.segSel[which]] || { st:'loading' };
    var head = '<div class="fd-card-h"><b>' + title + '</b>';
    if(d.st === 'ready'){
      head += '<select class="inp" data-fd="seg" data-v="' + which + '">' + d.list.map(function(f, i){ return '<option value="' + i + '"' + (i === S.segSel[which] ? ' selected' : '') + '>' + fiscalLabel(f.end, f.form === '10-K') + '</option>'; }).join('') + '</select>';
    }
    head += '</div>';
    if(d.st === 'loading') return '<div class="fd-card">' + head + '<div class="mut fd-msg">Reading the filing…</div></div>';
    if(d.st === 'error') return '<div class="fd-card">' + head + '<div class="mut fd-msg">Not available: ' + esc2(d.err) + '</div></div>';
    if(!d.res) return '<div class="fd-card">' + head + '<div class="mut fd-msg">This filing does not break revenue down by ' + (which === 'reg' ? 'region' : 'business') + '.</div>' + (d.list ? '<div class="fd-card-h" style="border:0"><span></span><select class="inp" data-fd="seg" data-v="' + which + '">' + d.list.map(function(f, i){ return '<option value="' + i + '"' + (i === S.segSel[which] ? ' selected' : '') + '>' + fiscalLabel(f.end, f.form === '10-K') + '</option>'; }).join('') + '</select></div>' : '') + '</div>';
    var r = d.res;
    return '<div class="fd-card">' + head + '<div class="fd-card-b">' + donut(r) + '<table class="fd-leg2"><thead><tr><th>Name</th><th>Revenue</th><th>Ratio</th></tr></thead><tbody>' + r.items.map(function(it, i){
      return '<tr data-fd-slice="' + i + '"><td><i style="background:' + PAL[i % PAL.length] + '"></i>' + esc2(it.name) + '</td><td>' + compact(it.v) + '</td><td>' + (it.v / r.sum * 100).toFixed(2) + '%</td></tr>';
    }).join('') + '</tbody></table></div></div>';
  }
  function revHTML(){ return '<div class="fd-cards">' + card('biz', 'Business') + card('reg', 'Region') + '</div><div class="movers-note">Currency: USD. Read from the XBRL data inside each 10-K / 10-Q; companies that do not tag a split show a note instead.</div>'; }


  /* ---- institutions: who is buying and selling the stock (Nasdaq's 13F roll-up; the quarter-by-quarter history is not in a free feed) ---- */
  function nn(s){ var v = parseFloat(String(s == null ? '' : s).replace(/[$,%\s]/g, '').replace(/,/g, '')); return isFinite(v) ? v : null; }
  function instLoad(){
    var sym = dispSym(CUR.sym), I = S.inst;
    if(I.sym === sym) return;
    I.sym = sym; I.st = 'loading'; I.data = null;
    fetchJSON('https://api.nasdaq.com/api/company/' + encodeURIComponent(sym) + '/institutional-holdings?limit=100&type=TOTAL&sortColumn=marketValue&sortOrder=DESC', 30000).then(function(j){
      var d = j && j.data; if(!d || !d.holdingsTransactions) throw new Error((j && j.status && j.status.bCodeMessage && j.status.bCodeMessage[0] && j.status.bCodeMessage[0].errorMessage) || 'no data');
      var row = function(blk, name){ var r = ((blk && blk.rows) || []).filter(function(x){ return x.positions === name; })[0]; return r ? { n:nn(r.holders), sh:nn(r.shares) } : { n:null, sh:null }; };
      var os = d.ownershipSummary || {}, ht = d.holdingsTransactions;
      I.data = { pct:nn(os.SharesOutstandingPCT && os.SharesOutstandingPCT.value), out:nn(os.ShareoutstandingTotal && os.ShareoutstandingTotal.value) * 1e6, val:nn(os.TotalHoldingsValue && os.TotalHoldingsValue.value) * 1e6,
        n:nn(ht.totalRecords), sh:nn(ht.sharesHeld),
        inc:row(d.activePositions, 'Increased Positions'), dec:row(d.activePositions, 'Decreased Positions'), held:row(d.activePositions, 'Held Positions'), neu:row(d.newSoldOutPositions, 'New Positions'), sold:row(d.newSoldOutPositions, 'Sold Out Positions'),
        rows:(ht.table.rows || []).map(function(r){ return { name:r.ownerName, date:r.date, sh:nn(r.sharesHeld), ch:nn(r.sharesChange), chp:nn(r.sharesChangePCT), val:nn(r.marketValue) * 1000 }; }) };
      I.st = 'ready';
    }).catch(function(e){ I.st = 'error'; I.err = (e && e.message) || 'unreachable'; }).then(function(){ if(I.sym === sym && CUR.tab === 'financials' && S.kind === 'inst') paintQuotePanel(); });
  }
  function instHTML(){
    instLoad();
    var I = S.inst, d = I.data;
    if(I.st === 'loading') return '<div class="mut fd-msg">Loading institutional holdings…</div>';
    if(I.st === 'error' || !d) return '<div class="mut fd-msg">No institutional data for ' + esc2(I.sym) + ' (' + esc2(I.err || 'none') + '). Funds, ETFs and non-US issuers are not covered.</div>';
    var net = (d.inc.sh || 0) + (d.neu.sh || 0) - (d.dec.sh || 0) - (d.sold.sh || 0), pc = function(v){ return v == null ? '—' : v.toLocaleString('en-US'); };
    var kpi = function(l, v, sub){ return '<div class="fd-kpi"><span>' + l + '</span><b>' + v + '</b>' + (sub || '') + '</div>'; };
    var h = '<div class="fd-kpis">' + kpi('No. of Institutions', pc(d.n) + ' <small>holders</small>') + kpi('Total Shares Held', compact(d.sh)) + kpi('% Owned', d.pct == null ? '—' : d.pct.toFixed(2) + '%') +
      kpi('Value Held', '$' + compact(d.val)) + kpi('Net Buying (shares)', '<span class="' + (net >= 0 ? 'up' : 'down') + '">' + (net >= 0 ? '+' : '-') + compact(Math.abs(net)) + '</span>') + '</div>';
    var acts = [['Increased positions', d.inc, 'up'], ['New positions', d.neu, 'up'], ['Held positions', d.held, 'mut'], ['Decreased positions', d.dec, 'down'], ['Sold out positions', d.sold, 'down']];
    var mx = Math.max.apply(null, acts.filter(function(a){ return a[2] !== 'mut'; }).map(function(a){ return a[1].sh || 0; }).concat([1]));   // 'held' dwarfs the moves, so it is drawn full-width and faint
    h += '<div class="fd-card" style="margin-bottom:16px"><div class="fd-card-h"><b>Trading activity</b><span class="mut" style="font-size:12.5px">Latest 13F quarter</span></div><table class="fd-act"><thead><tr><th></th><th>Holders</th><th>Shares</th><th></th></tr></thead><tbody>' +
      acts.map(function(a){ return '<tr><td>' + a[0] + '</td><td>' + pc(a[1].n) + '</td><td>' + compact(a[1].sh) + '</td><td class="bar"><i class="' + a[2] + '" style="width:' + (a[2] === 'mut' ? 100 : (a[1].sh || 0) / mx * 100).toFixed(1) + '%"></i></td></tr>'; }).join('') + '</tbody></table></div>';
    var rows = d.rows.slice().sort(function(a, b){ return S.isort === 'buy' ? (b.ch || 0) - (a.ch || 0) : S.isort === 'sell' ? (a.ch || 0) - (b.ch || 0) : (b.sh || 0) - (a.sh || 0); });
    h += '<div class="fd-ctl"><select class="inp" data-fd="isort"><option value="held"' + (S.isort === 'held' ? ' selected' : '') + '>Largest holders</option><option value="buy"' + (S.isort === 'buy' ? ' selected' : '') + '>Biggest buyers</option><option value="sell"' + (S.isort === 'sell' ? ' selected' : '') + '>Biggest sellers</option></select></div>' +
      '<div class="fd-wrap"><table class="fd-tbl fd-hold"><thead><tr><th>Owner</th><th>Date</th><th>Shares Held</th><th>Change (Shares)</th><th>Change (%)</th><th>Value</th></tr></thead><tbody>' +
      rows.map(function(r){ var c = r.ch == null ? 'mut' : r.ch >= 0 ? 'up' : 'down';
        return '<tr><td class="nm">' + esc2(r.name) + '</td><td>' + esc2(r.date) + '</td><td>' + compact(r.sh) + '</td><td class="' + c + '">' + (r.ch == null ? '—' : (r.ch >= 0 ? '+' : '-') + compact(Math.abs(r.ch))) + '</td><td class="' + c + '">' + (r.chp == null ? '—' : (r.ch >= 0 ? '+' : '') + r.chp.toFixed(2) + '%') + '</td><td>$' + compact(r.val) + '</td></tr>'; }).join('') +
      '</tbody></table></div><div class="movers-note">Source: Nasdaq\u2019s roll-up of 13F filings (top 100 holders shown). Holders file up to 45 days after quarter end, so some dates trail the latest quarter.</div>';
    return h;
  }

  /* ---- events ---- */
  document.addEventListener('click', function(ev){
    var t = ev.target.closest('[data-fd]');
    if(t && !/^(per|show|seg)$/.test(t.getAttribute('data-fd'))){
      var a = t.getAttribute('data-fd'), v = t.getAttribute('data-v');
      if(a === 'kind'){ S.kind = v; compat(); paintQuotePanel(); }
      if(a === 'row'){ S.row = +v; paintQuotePanel(); }
    }
  });
  document.addEventListener('change', function(ev){
    var t = ev.target; if(!t.getAttribute || !t.getAttribute('data-fd')) return;
    var a = t.getAttribute('data-fd');
    if(a === 'isort') S.isort = t.value; else if(a === 'per'){ S.per = t.value; compat(); } else if(a === 'show') S.show = t.value; else if(a === 'seg') S.segSel[t.getAttribute('data-v')] = +t.value;
    paintQuotePanel();
  });
  var tip = null;
  function sliceData(el){
    var card = el.closest('.fd-card'), sel = card.querySelector('[data-fd=seg]'), d = sel && S.seg[sel.getAttribute('data-v') + S.segSel[sel.getAttribute('data-v')]];
    return d && d.res ? { card:card, res:d.res, i:+el.getAttribute('data-fd-slice') } : null;
  }
  function lit(card, i){
    card.classList.toggle('hov', i != null);
    card.querySelectorAll('[data-fd-slice]').forEach(function(e){ e.classList.toggle('on', +e.getAttribute('data-fd-slice') === i); });
    var c1 = card.querySelector('.fd-ct1'), c2 = card.querySelector('.fd-ct2'), sel = card.querySelector('[data-fd=seg]'), d = sel && S.seg[sel.getAttribute('data-v') + S.segSel[sel.getAttribute('data-v')]];
    if(c1 && d && d.res){ var it = i != null ? d.res.items[i] : null; c1.textContent = it ? (it.v / d.res.sum * 100).toFixed(1) + '%' : compact(d.res.sum); c2.textContent = it ? (it.name.length > 18 ? it.name.slice(0, 17) + '…' : it.name) : 'Total'; }
  }
  document.addEventListener('mousemove', function(ev){
    var el = ev.target.closest && ev.target.closest('[data-fd-slice]');
    if(!el){ if(tip){ tip.remove(); tip = null; document.querySelectorAll('.fd-card.hov').forEach(function(c){ lit(c, null); }); } return; }
    var s = sliceData(el); if(!s) return;
    lit(s.card, s.i);
    if(!tip){ tip = document.createElement('div'); tip.className = 'fd-tip fd-tip-fix'; document.body.appendChild(tip); }
    var it = s.res.items[s.i];
    tip.innerHTML = '<div><i style="background:' + PAL[s.i % PAL.length] + '"></i>' + esc2(it.name) + '</div><div><b>' + compact(it.v) + ' (' + (it.v / s.res.sum * 100).toFixed(2) + '%)</b></div>';
    tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, ev.clientX + 14) + 'px'; tip.style.top = (ev.clientY + 14) + 'px';
  });
  return { html:html, draw:draw, reset:function(){ S.st = 'idle'; } };
})();
