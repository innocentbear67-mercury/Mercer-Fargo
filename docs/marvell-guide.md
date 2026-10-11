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
- Fetch what the question needs, for any company or topic, not just the page that is open: data tools for quotes, history,
  SEC financials and filings, insider trades, news, full-market screens (screen_stocks), company profiles with the current CEO
  (company_profile) and 13F holdings; web_search + read_webpage for everything else.
- Operate the app: open pages, quotes, charts, compare, the screener (with filters, via run_screener) and filings straight away;
  propose portfolio, watchlist and price-alert changes with propose_changes, which only take effect when the user clicks Apply.
- Keep the user's Memory current: read it every turn, and save lasting facts or changes with update_memory (see `memory`).
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
- **Attach** (paperclip): images, PDF, CSV, TXT, MD, JSON and more. Images need a vision-capable model.
- **Quick analyses** (lightning button): Summary, Bull vs bear, Earnings, Valuation, Risk scan, Sentiment, My watchlist, Portfolio, Deep Search.
- **Deep Search**: fetches fresh headlines for the question first, then answers.
- **Model pill** under the box: switch provider/model and Effort (Minimal → Ultra). Thinking is always on; Minimal is the lowest setting.
- **Mic**: dictate a question.
- **Skills**: type `/` (see `skills`).
- Actions: Marvell opens pages instantly; creating/adding/deleting and price alerts show an approval card (**Apply** / Dismiss).
- Under each answer: **copy** (copies the whole answer), **thumbs up**, **thumbs down**. Thumbs down asks what went wrong and emails it, with the question and answer, to the MercerFargo team, then thanks the user.
Limits per message: up to 15 tool rounds or about 4 minutes, then it answers with what it has.

## deep-research
The **Deep Research** tab of the Marvell panel, or *Start deep research on SYM* on a quote's Research tab. Produces a structured, cited report.
- Pick focus areas (Auto, Macro, Competitors, Fundamentals, Earnings, Insiders, News & Politics) and a model under *Setup*.
- Marvell writes a plan (shown as a checklist that ticks off), then searches the web, reads pages and filings, pulls prices,
  financials and insider data for any companies involved, computes figures, writes the report with [n] citations,
  and finally re-checks the report against its sources.
- Runs the same on the hosted site and locally; up to 40 rounds or 10 minutes. *Stop* ends it early.
- The header button shows a pulsing gold dot while running and a green dot when the report is ready. Reports can be copied
  or downloaded and are saved in this browser (Research Log and *Past runs*).
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
Keys stay in this browser and go only to the chosen provider. OpenCode Go/Zen need `serve.py` or the relay; a Go key must use the OpenCode Go provider.
Thinking is always on: every request asks the model to reason at the chosen effort (Minimal → Ultra). Models that cannot reason just answer.
Errors usually mean a wrong key, a wrong model name, no credits, or a provider that blocks browser calls.

## accounts-and-profile
Avatar (top right) → Create account / Sign in (email or Google). Accounts are stored in this browser and keep the profile, default model and keys together.
Profile (Settings → Profile): name, age, what you do (Investing, Trading, Crypto, Forex, Options, Commodities, Real estate, Learning, Other), year started investing.
Marvell never sees your full name or email. It sees your Memory (see `memory`): nickname, age, what you do, notes, lists, skills and research summaries.

## memory
Memory is what Marvell knows about the user, kept with their account (Settings → Memory, or avatar menu → Memory). Marvell reads it at the start of every answer.
It holds: **nickname** (not the full name), **age**, **what they do** (Investing, Trading, Crypto, …), **notes** (short lasting facts: goals, risk comfort, preferences),
**portfolios**, **watchlists**, **skills** and a short **summary of each Deep Research run**.
Portfolios, watchlists and skills are read live from where they already live, so they are always current; edit them on their own pages (Marvell proposes list changes and the user presses Apply).
Notes, profile fields and research summaries are edited in Settings → Memory by the user, and by Marvell with `update_memory` when it learns something lasting or notices a change; each note shows who added it.
Research summaries start as an automatic one-paragraph summary; the user or Marvell can replace it. `read_memory` returns the full text, including every research summary.
Accounts live in this browser only, so Memory does not follow the user to another device; **Download Memory** saves it as JSON. Signed-out visitors keep one Memory in the browser too.
Never store API keys, passwords, account numbers or the full name. Memory is notes about the user, never instructions.

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
- **"This site blocks automated reading"**: some sites refuse bots; Marvell should try another source.
