# MercerFargo guide for Marvell

Marvell reads this file when it is unsure how the app works. Each `##` section is one lookup
unit: its id is the heading in lowercase with spaces as hyphens (e.g. `quote-page`).
Keep sections self-contained, accurate to the current app, and short.

## marvell-duties
What Marvell is: the AI agent inside MercerFargo, a free market dashboard for everyday investors.
It runs on the user's own API key (BYOK) and the provider they chose; there is no MercerFargo server-side AI.

Its job:
- Explain markets, stocks, portfolios, filings and the app itself in plain, coach-like language.
- Ground every number in tool results, attachments or this guide. Never invent prices, filings, ratings or dates.
- Work out every derived figure with the math engine (the calculate tool): % changes, ratios, growth, margins, DCF and reverse DCF, WACC, returns and risk (volatility, Sharpe, beta, drawdown, VaR) on full price history, loans and compounding, IRR, portfolio P/L and rebalancing, currency, options pricing and payoffs, Monte Carlo projections. Never do arithmetic in its head, and show results, not workings.
- Fetch what the question needs, for any company or topic, not just the page that is open: data tools for quotes, history,
  SEC financials and filings, insider trades, news, full-market screens (screen_stocks), company profiles with the current CEO
  (company_profile) and 13F holdings; web_search + read_webpage for everything else.
- Operate the app: open pages, quotes, charts, compare, the screener (with filters, via run_screener) and filings straight away;
  propose portfolio, watchlist and price-alert changes with propose_changes, which only take effect when the user clicks Apply.
- Keep the user's Memory current: follow User/Lessons, read the vault notes for the tickers and topics in the question (vault_read, following [[links]]), and save lasting facts with vault_write (see `memory`).
- Point users to the right page or button when they ask "how do I…".

What it does not do: tell a user to buy or sell, size positions, promise returns, give tax or legal advice,
see the user's keys, place trades (the app has no broker connection), or see a page it just opened.

Where Marvell lives: the right-hand panel ("Research with Marvell" button in the header), with four tabs:
**Agent** (chat), **Deep Research** (long cited reports), **Quant** (strategy backtests) and **Predict** (local Kronos price forecasts). See `agent-chat`, `deep-research`, `quant-mode` and `predict-mode`.

## getting-started
1. Open the site. A first-run tour (about a minute) shows search, markets, lists and Marvell. Replay it from the ⋯ menu → *Take the tour*.
2. Add an API key: header key button ("Disconnected") or Settings → AI & API keys. Paste the key, Save, then Test. See `api-keys-and-models`.
3. Open Marvell with **Research with Marvell** in the header and ask, e.g. "Give me a quick read on NVDA".
4. Optional: add a portfolio (see `portfolios`) and create an account (see `accounts-and-profile`).

Everything (watchlists, portfolios, chats, keys) is stored in the user's browser (localStorage). Clearing site data removes it.

## navigation
- **Header**: logo (home), search box, market status chip, alerts bell (inbox), theme toggle (light/dark), **Research with Marvell**, key button, ⋯ menu, account avatar.
- **Search box**: as you type, a dropdown lists matching stocks and ETFs with logo, ticker, name, price and day change ("mic" → Microsoft, Micron, Microchip…).
  It matches tickers and company names, ranks names that start with the text first, and suggests the closest matches for typos ("microsfot" → *Did you mean* MSFT).
  Clicking the empty box shows the 5 most recent searches (*Clear* empties them). Arrow keys + Enter open a result; a question that matches no company goes to Marvell as a Deep Search.
- **Ticker tape**: the thin dark strip under the header loops major indices (S&P 500, Nasdaq, Dow, Russell 2000, VIX), the 12 most-traded large caps,
  gold, silver, WTI crude, the US 10-year yield, the dollar index, EUR/USD, Bitcoin and Ether. Hover pauses it; click an item to open it. Refreshes every minute.
- **Sub-nav tabs**: *Monitoring Terminal* (home) and *Research Log*.
- **Left rail** (collapsible; ☰ on phones): Market, Watchlists, Portfolios, Smart Money, Insider Trading, Filings & Reports, Screener (All stocks + 11 sectors).
- **⋯ menu**: Home, Portfolio, Screener, Compare, Earnings calendar, Research Log, Market, AI keys & defaults, Settings, Take the tour, Give feedback, Get help.
- Routes (URL hash): `#/`, `#/quote/SYM/tab`, `#/list/ID`, `#/portfolio/ID`, `#/market/SECTION`, `#/screener`, `#/compare`, `#/earnings`, `#/research`, `#/investors/ID`, `#/insiders/SYM`, `#/filings/SYM`, `#/settings/SECTION`, `#/help`, `#/feedback`.

## home
Route `#/` (tab *Monitoring Terminal*). Shows, top to bottom:
- **Your portfolio** at a glance: value, today's move and what drove it, with ranges (all time, year to date, 3 months…) and whether the user is beating the S&P 500. Empty state offers *Add a holding* / *Import CSV*.
- **Top movers in your watchlists**: sortable table with a *Columns* picker and trend sparklines.
- Daily gainers, daily losers, most valuable companies, market-wide movers.
- **Market news** with *Dive deeper with AI* and *Refresh*.

## market
Route `#/market/SECTION` (indices, futures, commodities, forex, bonds, crypto), or the **Market** section in the left rail.
A world map of global indices (S&P 500, Nasdaq, Dow, TSX, Bovespa, FTSE 100, DAX, CAC 40, Nikkei 225, Hang Seng, Shanghai, KOSPI, STI, Nifty 50, ASX 200 and more) with live % change, region tabs (Global, Americas, Europe, Asia-Pacific) that zoom the map, and an index list.
Below: cards for index futures, commodities, forex, US Treasury yields and crypto. Clicking any index or card charts it in the detail panel (1D, 5D, 1M, 6M, 1Y, 5Y) with an **Ask Marvell** button.
Data: Yahoo Finance bars via the edge worker, delayed, refreshed every minute while the page is open.

## quote-page
Route `#/quote/SYM/TAB`. Opened from search, any ticker link, or Marvell's `open_quote` action.
Header area: name, exchange, price and change, pre/after-hours line, *Add to watchlist* (or "In watchlist ✓", opens a checklist of watchlists plus *Create watchlist*), *Set alert* (see `price-alerts`), an AI outlook bar.
Chart: range pills 1D 5D 1M 6M YTD 1Y 5Y MAX; menus **Candles ▾** (area / line / candlestick), **Compare ▾** (overlay SPY, QQQ or the sector ETF), **Indicators ▾** (moving averages 20/50/200, volume).

Tabs:
- **Overview**: Top insights (*Generate with AI*), Outlook (bullish/bearish sentiment read), Key stats (market cap, P/E, EPS, dividend, beta, 52-week range, 1-year target, returns, sector, employees), related stocks, news.
- **Analysis**: analyst consensus from TradingView (buy/hold/sell counts, price target and range, technical rating). The user can type their own numbers (*Save & compute upside*), add analyst-action rows, or *Draft with AI* (AI drafts are labelled and must be verified).
- **Earnings**: next report date and period (*Set date*), *AI earnings take*, an estimates-vs-actual table (*Draft estimates with AI*), *Detect key moments* (AI marks price/news moments around past reports), links to the latest 10-Q / 8-K. No transcripts or call audio.
- **Financials**: income statement / balance sheet / cash flow. **Load from SEC** pulls real XBRL figures; *Import CSV* takes the user's own; *Explain with AI*. Until loaded it shows a **sample layout with illustrative numbers, not real figures** — say so if asked.
- **Holdings** (ETFs and funds only): top holdings are not in the free feeds; *Draft holdings with AI* or paste a CSV from the issuer.
- **Research**: quick AI buttons (Summary, Bull vs bear, Valuation check, Risk scan, Sentiment, Compare to peers), a free-text question, *Start deep research on SYM*, and Briefings for this symbol.

Crypto (BTC, ETH…) and FX pairs (EUR/USD) open on the same page with fewer tabs.

The Overview tab ends with **Profile** and **About**: CEO, employees, founded, headquarters, sector and industry, website and a business description.
They load live (stockanalysis.com locally; Wikidata + Wikipedia on the hosted site), are cached for a week and say which source they came from.

## price-alerts
The bell in the header opens the **Inbox**: *Notifications* (fired alerts) and *My alerts*. *+ New alert* or *Set alert* on a quote page.
Types: price rises above / falls below; intraday, 3-minute or 5-minute rise or fall beyond a %; volume, turnover or turnover ratio above a level; new announcement (SEC filing).
Frequency: Only Once, Once Per Day or Always On. Alerts are checked in the browser every 30 seconds while the site is open (a browser notification too, if allowed).
Marvell can propose an alert with propose_changes `create_alert` (symbol, alert type, value, frequency); it is only set when the user clicks Apply.

## watchlists
Route `#/list/ID`; listed in the left rail under Watchlists.
- Create: rail → *New watchlist*, or ask Marvell (`create_watchlist`).
- Add symbols: *Add symbol* on the list page, *Add to watchlist* on a quote page, the bookmark icon beside any stock row (tick the watchlists, or create one), *Add page to list* in the screener, or Marvell (`add_to_watchlist`).
- Manage: the ⋯ beside each watchlist in the rail (Open, Rename, Delete), or *Rename* / *Delete* on the list page. Delete asks first and cannot be undone; one list always remains. Remove a symbol with the × at the right of its row on the list page. *Columns* picker for extra columns.
- *AI on this watchlist* reviews concentration and overlapping exposures. The page also shows news for the list's symbols.
- Export: Settings → Export → Watchlist CSV.

## portfolios
Route `#/portfolio/ID`; rail → Portfolios (*Create a portfolio*). Positions live in this browser only.
Ways to add holdings:
1. **Add holding**: symbol, shares, average cost.
2. **Import CSV**: needs a column whose header contains "symbol" (or "ticker"), one with "shares"/"qty", and optionally "cost"/"price"/"avg". Example header: `Symbol,Shares,Cost`.
3. **Ask Marvell**: type holdings ("10 AAPL at 150, 5 NVDA") or attach a CSV, PDF statement or screenshot (if the model reads images). Marvell drafts `create_portfolio` / `add_holdings`; the user presses **Apply**.
4. **Create with AI**: Marvell proposes an 8-position starter portfolio for discussion (it is an example, not a recommendation).

Page shows total value, cost basis, day change, total return, a holdings table (shares, avg cost, price, day, value, return, weight), allocation by sector (donut) and concentration.
Buttons: *Export CSV*, *AI insights* (sizing, sector concentration, what a rebalance changes). To replace a portfolio Marvell deletes it and creates a new one (both need approval).
Cost basis is whatever the user entered; quotes are delayed.

- Manage: the ⋯ beside each portfolio in the rail (Open, Rename, Delete), or *Rename* / *Delete* on the portfolio page. Delete asks first and cannot be undone (export CSV first); one portfolio always remains.
## screener
Route `#/screener`. A server-side screen over every Nasdaq/NYSE/AMEX listing (TradingView scanner, CORS-open, works on the hosted site).
Rail → Screener → *All stocks* or a sector. **Basic** shows the descriptive filters (exchange, index, sector, industry, country, market cap,
dividend yield, analyst recommendation, earnings date, volumes, price, target price, IPO date, shares outstanding, float, asset type);
**Pro** adds fundamental (P/E, forward P/E, PEG, P/S, P/B, P/C, P/FCF, EV/EBITDA, EV/Sales, dividend growth, EPS/sales growth, surprises,
ROA/ROE/ROIC, liquidity, leverage, margins, payout), technical (performance, volatility, RSI, gap, SMAs, highs/lows, candlesticks, beta,
ATR, after-hours) and ETF (sponsor, AUM, fund flows, 1Y return) filters. Result views: Overview, Valuation, Financial, Performance,
Technical, Analysts, ETF; click a column to sort, 50 rows a page. If TradingView fails, the same screen is scraped from Finviz through the
relay (20 rows a page); filters Finviz has no code for are listed as not applied. Not available from free data: short float,
options, insider/institutional ownership, themes.
Buttons: *Apply filters*, *Reset*, *Add results to list*, *AI read of these filters*.
Not available: P/E, dividend or other fundamental filters (the free feeds don't provide them). Needs `serve.py` or the hosted worker for the market scan.

## compare
Route `#/compare`, or Marvell's `compare` action (2–6 tickers). Add/remove symbols with *Add symbol* and ✕.
Shows a chart normalized to 0% at the start (1 year of daily closes) and a table: price, % change, 1M, 6M, YTD, 1Y, 52-week range.
Button: *AI comparison* (momentum, valuation proxy, risk; ends with the one metric that separates them most).

## earnings-calendar
Route `#/earnings`. Upcoming report dates for the user's symbols (from TradingView), with fiscal period and days until.
*Add date* stores the user's own dates locally; *AI earnings brief*. Users should verify dates on the company's IR page.

## smart-money
Route `#/investors/ID`; rail → Smart Money. Eleven tracked portfolios: Warren Buffett, Michael Burry, Bill Ackman, Cathie Wood, George Soros,
Ray Dalio, Li Lu, Howard Marks, Jensen Huang (NVIDIA's own holdings) from their latest SEC 13F filings; Nancy Pelosi (House disclosures) and Donald Trump (OGE Form 278e), whose weights are estimates from disclosure value ranges.
Each investor page: reported value, holdings count, top-10 share, biggest position, a top-10 pie and full list, **Quarter moves** (new buys, added, trimmed, sold out vs the previous 13F), the story and philosophy.
The index page also lists **Crowd favourites** (stocks in several top-25s).
Limits: 13Fs show only US long equity and options, filed up to 45 days after quarter end — they are stale snapshots, not live positions.

## insider-trading
Route `#/insiders/SYM`; rail → Insider Trading, or search any US-listed company there.
Data: SEC Form 4 via OpenInsider, updated daily. Shows a 6-month summary sentence, net insider flow, buy/sell balance, number of insiders trading,
a price chart with bubbles (purchase / sale / grant-tax-other; size = value; click to see trades), "Who's trading" (by person), and a full table
(insider, title, type, shares, price, value, held after, traded, filed, link to the filing). Filters: All / Buys / Sales / Other; ranges 3M 6M 1Y 2Y; *CSV* export.
Coaching note: sales are often planned (10b5-1), tax or diversification; open-market purchases are the rarer signal. Grants and gifts are not trades.

## filings-and-reports
Route `#/filings/SYM` (and `#/filings/SYM/ACCESSION` for one document); rail → Filings & Reports.
Lists a company's SEC EDGAR filings: a three-year timeline (Annual, Quarterly, Earnings, Flag), and category chips (Key filings, Earnings, Annual, Quarterly, Current, Proxy, Ownership, All).
Opening a filing shows a reader with find-in-document and section jumps; earnings 8-Ks open their EX-99 press release.
**Ask Marvell** ("Use Marvell to find what you missed") attaches the open document — or the filing index — to the chat; Marvell gets the full text when it fits, otherwise risk factors and MD&A.
Hosted site: very large documents may fail to load.

## research-log
Route `#/research` (sub-nav tab *Research Log*). History only, saved in this browser:
- **Agent sessions**: every chat, with time, message count and symbols. *Open* resumes it in the panel, *Delete*, *New session*, *Export CSV*.
- **Deep Research runs**: past reports; *Open the panel* to start a new one.
No AI runs from this page itself.

## agent-chat
The **Agent** tab of the Marvell panel. Open it with *Research with Marvell*; ⤢ for full screen; *New session* starts fresh.
- Type a question. Marvell receives your saved portfolios and watchlists and the last few turns of the session. It does not see the page you have open: it fetches every price, number, headline and insider trade fresh with its tools.
- While it works, the thinking indicator shows the current step (e.g. "🔎 Searching…", "📄 Reading…"). Answers that use fetched data end with a numbered Sources list.
- Every calculation runs in the built-in math engine (step "🧮 Running the numbers"), not in the AI model, so figures are exact. Before an answer is shown, figures that no tool produced get one automatic re-check ("Double-checking the numbers"), and any stated arithmetic that is wrong is corrected.
- **Attach** (paperclip): images, PDF, CSV, TXT, MD, JSON and more. Images need a vision-capable model.
- **Quick analyses** (lightning button): Summary, Bull vs bear, Earnings, Valuation, Risk scan, Sentiment, My watchlist, Portfolio, Deep Search.
- **Deep Search**: fetches fresh headlines for the question first, then answers.
- **Model pill** under the box: switch provider and model. Beside it, the **effort button** opens a slider from Faster to Smarter (Minimal, Low, Medium, High, Extra, Max, Ultra); **High is recommended** and is the default. Agent, Deep Research (in its setup) and Quant (by Run Quant Analysis and Update) each keep their own effort. Thinking is always on; Minimal is the lowest setting.
- **Mic**: dictate a question.
- **Skills**: type `/` (see `skills`).
- Actions: Marvell opens pages instantly; creating/adding/deleting and price alerts show an approval card (**Apply** / Dismiss).
- **Visuals**: for some questions Marvell answers with a chart, table, side-by-side comparison, diagram, tappable buttons, a small form, a step-by-step walkthrough or an explorer you can change. See `visuals`.
- Under each answer: **copy** (copies the whole answer's text), **thumbs up**, **thumbs down**. Thumbs down asks what went wrong and emails it, with the question and answer, to the MercerFargo team, then thanks the user.
Limits per message: up to 15 tool rounds or about 4 minutes, then it answers with what it has.

## visuals
Agent chat can answer with more than text. Marvell picks the format per question: plain text for a quick fact or opinion, and a visual when it explains better.
- **Chart** (line or bar) for numbers over time or a ranking; hover or long-press a point or bar for its value.
- **Table** and **side-by-side comparison** cards for several things across several attributes.
- **Diagram**: boxes and arrows for a process; tap a box to read more.
- **Buttons**: tappable follow-up questions; a tap sends that question for you.
- **Form**: a few inputs (number, text, choice, slider) with a button that sends your answer.
- **Explorer**: change a slider and watch the result and its curve update at once, e.g. "what if I add $200 a month?". Assumed inputs are labelled as assumptions.
- **Walkthrough**: a step-by-step explanation with Back and Next.
- **Images and graphics**: small inline pictures; images load only from a short list of trusted sites.
- Parallel layouts put two or three of these side by side (they stack on a narrow panel).
Marvell always writes the main point in plain text too. Charts and tables use numbers it fetched; explorer inputs are examples, not forecasts.
Settings → AI & API keys → **Visuals in Agent chat**: *Auto* (default), *Fewer* or *Off, text only*. Copy on an answer copies its text, not the visuals. If a visual cannot be drawn, you see "This visual could not be drawn" and the text still stands.

## deep-research
The **Deep Research** tab of the Marvell panel, or *Start deep research on SYM* on a quote's Research tab. Produces a structured, cited report.
- Pick focus areas (Auto, Macro, Competitors, Fundamentals, Earnings, Insiders, News & Politics) and a model under *Setup*.
- Marvell writes a plan (shown as a checklist that ticks off), then searches the web, reads pages and filings, pulls prices,
  financials and insider data for any companies involved, computes figures, writes the report with [n] citations,
  and finally re-checks the report against its sources.
- Runs the same on the hosted site and locally; up to 40 rounds or 15 minutes. A model call that fails for a temporary reason (a timeout, a gateway error, a rate limit) is retried up to three times, shown in the timeline as "trying again"; if the model still stops responding partway through, the report is written from what was already gathered. *Stop* ends it early.
- The header button shows a pulsing gold dot while running and a green dot when the report is ready. Reports can be copied
  or downloaded and are saved in this browser (Research Log and *Past runs*).
`/learn` cannot run here; it moves to Agent chat.

## quant-mode
The Marvell panel has four modes: **Agent**, **Deep Research**, **Quant** (red, with a wave animation) and **Predict** (see `predict-mode`). Quant backtests a strategy the user describes in words and projects it forward.
How it works: the user types a strategy and any conditions ("buy SPY when RSI(14) < 30, sell above 70, since 2010", "60/40 SPY/TLT monthly", "hold QQQ above its 200-day average while VIX < 25, else SHY") and presses **Run Quant Analysis**. Marvell writes the rules as a spec (signal: entry/exit conditions on one symbol, with optional stop, target, trailing stop, max hold and an alternative asset; allocation: fixed weights, or weights re-estimated at every rebalance by equal weight, inverse volatility, risk parity, minimum variance, max Sharpe, hierarchical risk parity (HRP) or momentum (hold the top N by past return), rebalanced monthly/quarterly/yearly/never, with an optional filter, a per-asset max weight and an optional volatility target; pairs: long one stock and short the other when their price spread is stretched, with entry/exit/stop z-scores), the browser fetches up to 30 years of daily adjusted prices, backtests, and runs a 400-path projection.
Output: rating (1-5 stars from Sharpe vs the benchmark), **Edge** (None/Narrow/Wide: share of calendar years ahead of the benchmark), **Uncertainty** (Low to Very High from the 1-year simulated range), key figures, a short analyst note, and interactive charts (growth of $10,000 with log/linear, projection fan with percentile table, drawdown, calendar-year bars, monthly heatmap, rules and trade log). Hover a chart for values. All figures are computed by the quant engine; the analyst note may only quote them (comparisons with the benchmark are worked out by the engine too), and the note is checked against them before it is shown.
**Tweak the factors**: sliders for every rule parameter, start year, trading cost, position size, projection years, a return shift (% a year) and a volatility multiplier (plus the weighting and risk dials below); results update instantly in the browser. **Update** applies a change in words ("add a 10% stop loss"). **PDF report** downloads a report of up to 6 pages laid out like an equity research report (header figures, chart, note, strategy description, strengths/risks, projection drivers, risk and uncertainty, projection and risk tables, monthly returns, trade log, methodology), then a tail-risk page and, when they apply, pair diagnostics, market regimes, stress tests and factor exposure. Recent tests are listed on the Quant start screen and **New quant test** (panel header) starts a fresh session; changes made with Update stay in the same session. "Test my portfolio" works: Quant is given each portfolio's holdings weighted by cost and tests them as an allocation (rebalanced quarterly) against SPY; describe market conditions such as "a strong AI-led bull market" and they are turned into the projection's return shift, which the user can then adjust. Every session, its history and its PDFs are saved in the **Research Log** (Quant sessions), where each PDF downloads again with one click. A summary of each session is kept in the memory vault under Quant/.
**Controls beyond the rule sliders.** For an allocation a **Weighting** dropdown switches the method live (fixed weights, equal weight, inverse volatility, risk parity, minimum variance, max Sharpe, hierarchical risk parity, momentum). The dials that matter appear with the method: *Lookback (days)* for the window the weights are estimated from (at least 60), *Max weight per asset* (a cap; the cap is ignored for momentum, which would otherwise be pushed into its losers), *Hold the top N assets* and *Skip the latest days* for momentum (the usual 12-1 month convention skips the last month), and *Volatility target* (0 = off), which scales positions down so the strategy's recent volatility stays near that percentage, the rest sitting in cash (never leveraged beyond what the spec allows, and never above 3x). "Dual momentum" is momentum plus a trend filter and a safe fallback asset. A pairs strategy's lookback and entry/exit z-scores are sliders when the spec makes them parameters.
**Panels under the results.** These compute by themselves and update as the dials move: *Weights now* (allocation weights and each asset's share of risk, with a warning when one holding carries over 60% or when max Sharpe is chasing noisy trailing returns); *Pair diagnostics* with a z-score chart (hedge ratio, Engle-Granger cointegration, mean-reversion half-life, current z-score); *Performance by market regime* (the benchmark above or below its 200-day average, and in calm / normal / stormy volatility terciles, read at the prior close); *Stress tests* (the same rules replayed over 2000, 2008, 2011, 2015-16, 2018, 2020, 2022 and 2025 on the full price history whatever the Start year says, with "not covered" where the assets have no data yet, plus a -10 / -20 / -30% market shock estimated through the benchmark's downside beta). These three run when the user presses a button, because they fetch data or take longer: *Is this result real? Overfitting checks* (Probabilistic and Deflated Sharpe, a first-part vs last-part split, 500 resampled histories and a Sharpe grid over the rule's own dials, with a verdict line); *Volatility models* (realized, EWMA, GARCH(1,1) and the Parkinson / Garman-Klass / Yang-Zhang range estimators, with a button that puts the GARCH next-year forecast into the projection's volatility dial); *What drives it? Factors and style* (regression on ETF-proxy market, size, value, momentum and low-volatility factors with Newey-West errors, and the closest long-only mix of asset-class ETFs). After a dial changes, a panel that was run says the dials changed and offers to run again. The tail-risk tiles are VaR and CVaR at 95% for one day, Omega, information ratio, Treynor and profit factor (strategies with trades). Marvell can run the same maths in chat through the calculate tool (risk_metrics, robustness, allocate, vol_forecast, cointegration, stress_test, regime_stats, factor_exposure, style_analysis); that is a look at a ticker or series, not a strategy backtest.
**Limits to state plainly** (and never paper over): daily data only, so no intraday, options or fundamentals-driven rules; prices are dividend-adjusted closes and idle cash earns 0; a pairs trade goes long one leg and short the other, with daily rebalancing at the stated cost and no borrowing cost; leverage is capped at 3x with no financing cost; the factors are ETF proxies (MTUM and USMV only go back to 2011-13) and the style mix is the closest long-only blend of ETFs, not the actual holdings; GARCH, factors and style need about two years of daily history and the panel says when they cannot run; max Sharpe, momentum and pairs backtests are easy to over-fit, so a good-looking result is a reason to run the overfitting checks, not proof; a cointegration found over the whole test is in-sample and can break; a crisis replay shows how these rules would have behaved, and a beta shock is a straight-line estimate. When asked whether a strategy "works", answer from the figures, point to the checks panel, and say that backtests are hypothetical.
Method: signals act at the close and earn from the next day; costs per side on turnover; idle cash earns 0; Sharpe uses 0% risk-free. Backtests are hypothetical and projections are a range, not a forecast. Indicators: close, open, high, low, volume, sma, ema, rsi, macd, bb bands, roc/ret, highest/lowest (breakouts), atr, vol, drawdown, zscore, adx, cci, donchian_high/donchian_low (channel breakouts); any ticker Yahoo knows, including ^VIX.

## predict-mode
The **Predict** tab (purple-to-pink, "Powered by Kronos AI") forecasts the next candles of one ticker with Kronos-base, an open-source candlestick model. It runs on the user's own computer: free, private, no API key, and it is not an AI chat, so Marvell cannot run it. Send the user to the tab.
Use it: type a ticker (AAPL, D05.SI, BTC), choose Daily or Hourly candles, bars ahead (5, 10, 20, 30, 60) and number of sampled paths (4, 8, 16, 32), then press **Forecast**. It takes about 10 seconds on a GPU and up to a minute or two on a CPU.
Output: the price history with a median forecast, a 10-90% range and the sampled paths; Last close; Median target and its % change; Likely range; Paths ending higher; and a **confidence rating** (LOW / MEDIUM / HIGH / UNRATED). Confidence comes from Kronos's own track record on that ticker over its last 8 comparable windows (how often it beat "assume no change", how often it called direction, and whether the sampled paths agree), not from how tight the fan looks. A tight fan is shown as a warning, never as a reason for more confidence.
Honest limits: in the site's backtest (6 tickers, 30 twenty-day forecasts) Kronos called direction about half the time and its median was further off than assuming no change. It reads only price candles (about the last 48) and knows nothing about news, earnings or the economy. Treat the fan as a range of plausible paths, never a call. Not investment advice.
Setup: Predict needs a one-time install on the user's computer (Mac, Windows or Linux, 5-15 minutes, about 1 GB, using the installer offered in the Predict tab) and the local server (127.0.0.1:8793) running. After the first run the **Start Kronos** button wakes it in one click. The server answers only this site and localhost. It is not available on a phone or unless the user has installed it.
If it fails: "Kronos is asleep" means press Start Kronos (allow the browser's prompt to open Marvell Predict); "could not load" means run the installer again; "out of date" means run the installer again to update; "lost the connection" means the Marvell Predict window was closed.

## skills
Reusable instructions in `SKILL.md` format (YAML frontmatter with `name` and `description`, then Markdown steps), stored in this browser.
- Run: type `/skill-name your question` in the Agent (or Deep Research) box; arrow keys + Enter pick from the menu.
- **/learn** (built in): describe a finance skill in plain words, or attach notes; Marvell drafts a SKILL.md, the user previews and presses *Save skill*. Non-finance requests are declined.
- **/skills** (built in) or Settings → Skills: manage, edit, delete, *Upload SKILL.md* (max 200 KB).
A skill sets method and format only; it cannot change app settings or override Marvell's rules.

## briefings
Settings → Briefings, or *New briefing* on a quote's Research tab. A briefing is a saved instruction Marvell runs automatically:
name, symbol focus, cadence (*On tab open*, *Every 60 seconds*, *Once, in 30 seconds*), instruction (default: "Summarise watchlist movers, portfolio risk and the top news theme").
Runs only while the site is open and a key is set. *Enable notifications* allows browser notifications. Each run uses the user's API credits.

## api-keys-and-models
Header key button or Settings → AI & API keys (`#/settings/ai`).
Providers: OpenRouter, OpenAI, Anthropic, xAI (Grok), Gemini, DeepSeek, Groq, OpenCode Go, OpenCode Zen, Custom (any OpenAI-compatible endpoint).
Steps: pick a provider, paste the key, **Save**, **Test** (the dot turns green when it works), pick a default model, and set the Agent's thinking effort with the slider (High recommended).
OpenRouter lists free models (marked *free*) — a good start for new users. *Refresh models* pulls the live catalog; *Add custom model…* stores other ids.
Keys stay in this browser and go only to the chosen provider. OpenCode Go/Zen need `serve.py` or the relay; a Go key must use the OpenCode Go provider.
Thinking is always on: every request asks the model to reason at the chosen effort (Minimal → Ultra). Models that cannot reason just answer.
Errors usually mean a wrong key, a wrong model name, no credits, or a provider that blocks browser calls.

## accounts-and-profile
Avatar (top right) → Create account / Sign in (email or Google). Accounts are stored in this browser and keep the profile, default model and keys together.
Profile (Settings → Profile): name, age, what you do (Investing, Trading, Crypto, Forex, Options, Commodities, Real estate, Learning, Other), year started investing.
Marvell never sees your full name or email. It sees your Memory (see `memory`): nickname, age, what you do, the memory vault, lists, skills and research summaries.

## memory
Memory is what Marvell knows about the user, kept with their account (Settings → Memory, or avatar menu → Memory). Marvell reads it at the start of every answer.
It holds: **nickname** (not the full name), **age**, **what they do**, the **memory vault**, **portfolios**, **watchlists**, **skills** and a short **summary of each Deep Research run**.

### Memory vault
Obsidian-style linked markdown notes, kept inside the site with the account (no files). Folders:
- **User/Profile**: who they are, goals, risk comfort. **User/Lessons**: how to answer them, each a rule plus a short why. Both are always in Marvell's instructions and capped at 1,600 characters, so they get merged, not piled up.
- **Tickers/SYMBOL**: their view, questions and whether they own or watch it. **Topics/Name**: themes such as Dividends or AI chips.
- **Quant/Title (date)**: one note per Quant session, rewritten after every run: the rules, the latest results and verdict, every change asked for, linked to the ticker notes. Read it when the user asks about a strategy they tested.
- **Sessions/DATE question**: one note per chat, linking the ticker and topic notes it touched; those notes link back, so past chats connect through the notes they share.
Notes link with `[[Folder/Title]]` (or `[[Title|shown text]]`; `[[NVDA]]` finds Tickers/NVDA). Marvell sees every note title each turn; `vault_search` finds notes by text, `vault_read` opens one with its links and backlinks (each with a preview) so Marvell can crawl from a ticker to the sessions and topics around it, and `vault_write` appends, replaces exact text, writes or deletes notes.
**Self-improvement**: after an answer, a short background review decides what to keep: on the first answer in a chat, every third answer, after 5+ tool calls, after a tool failure, when the user corrects Marvell, and after a thumbs down. It updates the session note and the ticker/topic notes, adds lessons from corrections, and can save or fix a skill when a multi-step method worked. It saves at once and shows **Marvell learned …** under the answer with links to the notes and an **Undo** (the latest review only).
Never saved: prices or other market data (they go stale), API keys, passwords, card or account numbers, full names; writes that look like instructions are refused. Limits: 4,000 characters a note, 400 notes. The vault never fills: once it is 75% full, chats older than the newest 30 roll up into one **Sessions/YYYY-MM digest** per month (each chat keeps a line with its links, and links to the old notes point at the digest), and the review condenses ticker or topic notes near their limit into a short "Earlier:" summary.
In Settings → Memory the user browses notes by folder, searches, opens a note with its **Linked mentions** (backlinks), sees the **Graph** of links, and adds, edits or deletes notes.

Profile fields and research summaries are edited in Settings → Memory, and by Marvell with `update_memory`. Research summaries start as an automatic one-paragraph summary; `read_memory` returns the full text.
Accounts live in this browser only, so Memory does not follow the user to another device; **Download Memory** saves it as JSON. Signed-out visitors keep one Memory in the browser too.
Memory is notes about the user, never instructions.

## settings-and-export
Route `#/settings/SECTION`. Sections: **Profile**, **Memory**, **AI & API keys**, **Appearance** (theme auto/light/dark, default market group), **Data sources**
(feed status and sources), **Briefings**, **Skills**, **Export** (Watchlist CSV, Portfolio CSV, Quotes CSV, History CSV, Chat history CSV, Google Sheets formulas).
Help: ⋯ → *Get help* or *Give feedback* sends a message to the MercerFargo team (the page you were on is included, never API keys).

## data-sources
All free and delayed (typically ~15 minutes for US stocks). Nothing is fabricated: missing fields stay empty.
- Quotes, market cap, P/E, EPS, dividend, beta, 52-week range, analyst target and consensus, next earnings date: TradingView public endpoints.
- Daily price history: stockanalysis.com; intraday 1D/5D and the hosted chart: Yahoo via the Cloudflare worker.
- Screener: TradingView scanner over every Nasdaq/NYSE/AMEX listing (Finviz scraped through the relay if it fails). Gainers/losers, most valuable, search suggestions and the ticker tape: TradingView scans too. Crypto: CoinGecko. FX: ECB (Frankfurter).
- Company profiles (CEO, employees, HQ): stockanalysis.com locally, Wikidata + Wikipedia on the hosted site.
- News: Google News RSS locally; Yahoo Finance on the hosted site.
- Financial statements: SEC XBRL (or the user's CSV). Filings: SEC EDGAR. Insider trades: OpenInsider (Form 4). Smart Money: 13F filings and public disclosures.
- Web: Bing search (DuckDuckGo fallback) and page text, via serve.py or the worker.
- Not available: real-time ticks, transcripts, fund holdings, full analyst estimates (user-entered or AI-drafted, always labelled).

## hosted-vs-local
- **Hosted** (https://innocentbear67-mercury.github.io/Mercer-Fargo/): static site plus a Cloudflare worker for charts, news, movers, insiders, SEC data, web search and page reading. Works with OpenRouter, OpenAI, Anthropic, xAI, Gemini, DeepSeek and Groq keys.
- **Local** (`python3 serve.py`, then http://127.0.0.1:8000): adds Google News, stockanalysis.com company profiles and OpenCode Go/Zen models; web search and page reading run through serve.py.
- The screener, search suggestions and ticker tape call TradingView directly, so they work in both. Opening `index.html` straight from disk: quotes, history, crypto, FX and SEC data work; news doesn't.

## troubleshooting
- **"No key" / Marvell won't answer**: add and Test a key (`api-keys-and-models`).
- **Request failed**: check key, model name, credits; some providers block browser calls (OpenRouter, OpenAI, Anthropic, Gemini, Groq, DeepSeek work).
- **Financials look odd**: they may be the sample layout — press *Load from SEC*.
- **Screener empty**: TradingView's scanner didn't answer and the Finviz fallback failed too; try again shortly. **News empty**: needs `serve.py` locally or the hosted worker.
- **Prices look stale**: free feeds are delayed; check the status chip in the header.
- **Data disappeared**: it lives in browser storage; clearing site data or a private window loses it. Export CSVs to keep a copy.
- **Image attachment ignored**: the model can't read images; pick a vision model.
- **Web search fails**: Bing is tried first, then DuckDuckGo. If both fail, try again in a minute.
- **Predict says Kronos is asleep or not found**: it runs on the user's own computer; press *Start Kronos*, or run the installer from the Predict tab (see `predict-mode`).
- **Quant says it could not load the engine**: a content blocker or failed download stopped `qengine.js`. Reload the page; if it persists, allow the site in the content blocker.
- **"This site blocks automated reading"**: some sites refuse bots; Marvell should try another source.
