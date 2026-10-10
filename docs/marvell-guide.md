# MercerFargo guide for Marvell

Marvell reads this file when it is unsure how the app works. Each `##` section is one lookup
unit: its id is the heading in lowercase with spaces as hyphens (e.g. `quote-page`).
Keep sections self-contained, accurate to the current app, and short.

## marvell-duties
What Marvell is: the AI agent inside MercerFargo, a free market dashboard for everyday investors.
It runs on the user's own API key (BYOK) and the provider they chose; there is no MercerFargo server-side AI.

Its job:
- Explain markets, stocks, portfolios, filings and the app itself in plain, coach-like language.
- Ground every number in the DATA block, attachments or this guide. Never invent prices, filings, ratings or dates.
- Operate the app when asked (open pages, compare, create portfolios/watchlists) via action blocks. Writes need the user's Apply click.
- Point users to the right page or button when they ask "how do I…".

What it does not do: tell a user to buy or sell, size positions, promise returns, give tax or legal advice,
see the user's keys, place trades (the app has no broker connection), or see a page it just opened.

Where Marvell lives: the right-hand panel ("Research with Marvell" button in the header), with two tabs:
**Agent** (chat) and **Deep Research** (long cited reports). See `agent-chat` and `deep-research`.

## getting-started
1. Open the site. A first-run tour (about a minute) shows search, markets, lists and Marvell. Replay it from the ⋯ menu → *Take the tour*.
2. Add an API key: header key button ("Disconnected") or Settings → AI & API keys. Paste the key, Save, then Test. See `api-keys-and-models`.
3. Open Marvell with **Research with Marvell** in the header and ask, e.g. "Give me a quick read on NVDA".
4. Optional: add a portfolio (see `portfolios`) and create an account (see `accounts-and-profile`).

Everything (watchlists, portfolios, chats, keys) is stored in the user's browser (localStorage). Clearing site data removes it.

## navigation
- **Header**: logo (home), search box, market status chip, theme toggle (light/dark), **Research with Marvell**, key button, ⋯ menu, account avatar.
- **Search box**: type a ticker (AAPL) or company name to open its quote page. Anything else (a question) is sent to Marvell as a Deep Search.
- **Sub-nav tabs**: *Monitoring Terminal* (home) and *Research Log*, then market tabs US / Europe / Asia / Latin America / Currencies / Crypto / Commodities.
- **Left rail** (collapsible; ☰ on phones): Watchlists, Portfolios, Smart Money, Insider Trading, Filings & Reports, Sectors.
- **⋯ menu**: Home, Portfolio, Screener, Compare, Earnings calendar, Research Log, Markets, AI keys & defaults, Settings, Take the tour, Give feedback, Get help.
- Routes (URL hash): `#/`, `#/quote/SYM/tab`, `#/list/ID`, `#/portfolio/ID`, `#/markets/GROUP`, `#/screener`, `#/compare`, `#/earnings`, `#/research`, `#/investors/ID`, `#/insiders/SYM`, `#/filings/SYM`, `#/settings/SECTION`, `#/help`, `#/feedback`.

## home
Route `#/` (tab *Monitoring Terminal*). Shows, top to bottom:
- **Your portfolio** at a glance: value, today's move and what drove it, with ranges (all time, year to date, 3 months…) and whether the user is beating the S&P 500. Empty state offers *Add a holding* / *Import CSV*.
- Quote cards for the selected market group (US: SPY, QQQ, DIA, IWM, VTI — index ETFs stand in for the indexes).
- **Top movers in your watchlists**: sortable table with a *Columns* picker and trend sparklines.
- Daily gainers, daily losers, most valuable companies, market-wide movers.
- **Market news** with *Dive deeper with AI* and *Refresh*.

## markets
Route `#/markets/GROUP` (US, Europe, Asia, Latin America, Currencies, Crypto, Commodities), or the market tabs under the header.
Shows the group's quote cards, an index table, most valuable companies, trending in the user's watchlist, gainers and losers.
Button: **AI market summary**. The default group is set in Settings → Appearance.

## quote-page
Route `#/quote/SYM/TAB`. Opened from search, any ticker link, or Marvell's `open_quote` action.
Header area: name, exchange, price and change, pre/after-hours line, *Add to watchlist* (or "In watchlist ✓"), an AI outlook bar.
Chart: range pills 1D 5D 1M 6M YTD 1Y 5Y MAX; menus **Candles ▾** (area / line / candlestick), **Compare ▾** (overlay SPY, QQQ or the sector ETF), **Indicators ▾** (moving averages 20/50/200, volume).

Tabs:
- **Overview**: Top insights (*Generate with AI*), Outlook (bullish/bearish sentiment read), Key stats (market cap, P/E, EPS, dividend, beta, 52-week range, 1-year target, returns, sector, employees), related stocks, news.
- **Analysis**: analyst consensus from TradingView (buy/hold/sell counts, price target and range, technical rating). The user can type their own numbers (*Save & compute upside*), add analyst-action rows, or *Draft with AI* (AI drafts are labelled and must be verified).
- **Earnings**: next report date and period (*Set date*), *AI earnings take*, an estimates-vs-actual table (*Draft estimates with AI*), *Detect key moments* (AI marks price/news moments around past reports), links to the latest 10-Q / 8-K. No transcripts or call audio.
- **Financials**: income statement / balance sheet / cash flow. **Load from SEC** pulls real XBRL figures; *Import CSV* takes the user's own; *Explain with AI*. Until loaded it shows a **sample layout with illustrative numbers, not real figures** — say so if asked.
- **Holdings** (ETFs and funds only): top holdings are not in the free feeds; *Draft holdings with AI* or paste a CSV from the issuer.
- **Research**: quick AI buttons (Summary, Bull vs bear, Valuation check, Risk scan, Sentiment, Compare to peers), a free-text question, *Start deep research on SYM*, and Briefings for this symbol.

Crypto (BTC, ETH…) and FX pairs (EUR/USD) open on the same page with fewer tabs.

## watchlists
Route `#/list/ID`; listed in the left rail under Watchlists.
- Create: rail → *New watchlist*, or ask Marvell (`create_watchlist`).
- Add symbols: *Add symbol* on the list page, *Add to watchlist* on a quote page, *Add results to list* in the screener, or Marvell (`add_to_watchlist`).
- *Rename*, *Columns* picker, delete from the rail.
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

## screener
Route `#/screener`. Filters over about 1,000 of the largest Nasdaq/NYSE/AMEX listings (TradingView market scan, sorted by market cap):
symbol or name, price min/max, day change % min/max, market cap ≥ / ≤ ($B). Clicking a sector in the rail opens the screener with that sector.
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
- Type a question. Marvell receives the current page context (symbol, price, stats, watchlist, portfolio, headlines) automatically.
- **Attach** (paperclip): images, PDF, CSV, TXT, MD, JSON and more. Images need a vision-capable model.
- **Quick analyses** (lightning button): Summary, Bull vs bear, Earnings, Valuation, Risk scan, Sentiment, My watchlist, Portfolio, Deep Search.
- **Deep Search**: fetches fresh headlines for the question first, then answers.
- **Model pill** under the box: switch provider/model, Thinking on/off and Effort (Minimal → Ultra).
- **Mic**: dictate a question.
- **Skills**: type `/` (see `skills`).
- Actions: Marvell can open pages instantly; creating/adding/deleting shows an approval card (**Apply** / dismiss).
Each message is answered on its own with the current page data; earlier turns are shown but not re-sent to the model.

## deep-research
The **Deep Research** tab of the Marvell panel, or *Start deep research on SYM* on a quote's Research tab. Produces a structured, cited report.
- **Local (`python3 serve.py`)**: runs Google Research's FinanceHarness agent with the user's key — web search, reading and citing pages, fundamentals, DCF. Modes: auto, research, analytical. Must be installed once (*Install harness*). Non-commercial licence (CC BY-NC 4.0).
- **Hosted site (no serve.py)**: Marvell gathers data in the browser — quotes, news, insider trades (Form 4), SEC filings and an excerpt of the latest 10-K/10-Q — then writes the report.
The header button shows a pulsing gold dot while running and a green dot when the report is ready. Reports can be copied or downloaded and are saved to the Research Log.
`/learn` cannot run here; it moves to Agent chat.

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
Steps: pick a provider, paste the key, **Save**, **Test** (the dot turns green when it works), pick a default model and effort.
OpenRouter lists free models (marked *free*) — a good start for new users. *Refresh models* pulls the live catalog; *Add custom model…* stores other ids.
Keys stay in this browser and go only to the chosen provider. OpenCode Go/Zen and Deep Research's harness need `serve.py`; a Go key must use the OpenCode Go provider.
Errors usually mean a wrong key, a wrong model name, no credits, or a provider that blocks browser calls.

## accounts-and-profile
Avatar (top right) → Create account / Sign in (email or Google). Accounts are stored in this browser and keep the profile, default model and keys together.
Profile (Settings → Profile): name, age, what you do (Investing, Trading, Crypto, Forex, Options, Commodities, Real estate, Learning, Other), year started investing.
Marvell receives only an age range, years investing and interests — never name or email — to pitch explanations at the right depth.

## settings-and-export
Route `#/settings/SECTION`. Sections: **Profile**, **AI & API keys**, **Appearance** (theme auto/light/dark, default market group), **Data sources**
(feed status and sources), **Briefings**, **Skills**, **Export** (Watchlist CSV, Portfolio CSV, Quotes CSV, History CSV, Chat history CSV, Google Sheets formulas).
Help: ⋯ → *Get help* or *Give feedback* sends a message to the MercerFargo team (the page you were on is included, never API keys).

## data-sources
All free and delayed (typically ~15 minutes for US stocks). Nothing is fabricated: missing fields stay empty.
- Quotes, market cap, P/E, EPS, dividend, beta, 52-week range, analyst target and consensus, next earnings date: TradingView public endpoints.
- Daily price history: stockanalysis.com; intraday 1D/5D and the hosted chart: Yahoo via the Cloudflare worker.
- Screener, gainers/losers, most valuable: TradingView market scan. Crypto: CoinGecko. FX: ECB (Frankfurter).
- News: Google News RSS locally; Yahoo Finance on the hosted site.
- Financial statements: SEC XBRL (or the user's CSV). Filings: SEC EDGAR. Insider trades: OpenInsider (Form 4). Smart Money: 13F filings and public disclosures.
- Not available: real-time ticks, transcripts, fund holdings, full analyst estimates (user-entered or AI-drafted, always labelled).

## hosted-vs-local
- **Hosted** (https://innocentbear67-mercury.github.io/Mercer-Fargo/): static site plus a Cloudflare worker for charts, news, movers, insiders and filings. Works with OpenRouter, OpenAI, Anthropic, xAI, Gemini, DeepSeek and Groq keys. Deep Research uses browser mode.
- **Local** (`python3 serve.py`, then http://127.0.0.1:8000): adds the full screener scan, Google News, OpenCode Go/Zen models and the FinanceHarness Deep Research agent.
- Opening `index.html` directly from disk: quotes, history, crypto, FX and SEC data work; screener and news don't.

## troubleshooting
- **"No key" / Marvell won't answer**: add and Test a key (`api-keys-and-models`).
- **Request failed**: check key, model name, credits; some providers block browser calls (OpenRouter, OpenAI, Anthropic, Gemini, Groq, DeepSeek work).
- **Financials look odd**: they may be the sample layout — press *Load from SEC*.
- **Screener or news empty**: needs `serve.py` locally or the hosted worker.
- **Prices look stale**: free feeds are delayed; check the status chip in the header.
- **Data disappeared**: it lives in browser storage; clearing site data or a private window loses it. Export CSVs to keep a copy.
- **Image attachment ignored**: the model can't read images; pick a vision model.
- **Deep Research unavailable locally**: install the harness (*Install harness* in the panel).
