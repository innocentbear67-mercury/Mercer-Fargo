# MercerFargo Finance Superhub
A market terminal in the Google Finance tradition — same layout discipline, its own
brand: the header search and market tab strip, horizontal quote cards, a quote page
with Overview / Analysis / Earnings / Financials / Holdings / Research tabs,
watchlists, portfolios, a screener, a compare view, and Marvell, a BYOK AI agent with
live data tools, web search and Deep Research.
The app is **`index.html`** plus Marvell's agent loop in **`harness.js`**. No build step, no
framework, no account, and no API keys required for market data.

**Brand:** charcoal black is the default theme — canvas `#141414` up through
surfaces at `#1C1C1C`, `#2A2A2A` and the brand swatch `#333333`; antique gold
`#C1A578` is the accent (buttons, active pills, links, chart line, the *Fargo* half
of the wordmark) and deep navy `#1A2E50` carries brand surfaces (monogram tile,
badge, active tab, the app bar's gradient). The light theme is the same identity on
warm ivory. Tokens are overridden once, at the end of the stylesheet, in the
MercerFargo brand layer — see `.work/reference/brand.md`.

## Use it online

**Live site:** https://innocentbear67-mercury.github.io/Mercer-Fargo/

Open it, press the key button in the header, paste your own model key and pick a default
provider, model and effort. Your key stays in your browser's localStorage and is sent only
to the provider you chose. Nothing is stored on a server.

The hosted copy is static; the Cloudflare worker (`worker/`) fills the gaps: charts, news,
movers, insiders, SEC data, and Marvell's web search and page reading. Everything works there
with OpenRouter / OpenAI / Anthropic / xAI / Gemini / DeepSeek / Groq keys (OpenCode needs the
relay or `serve.py`).
Charts on the hosted copy come from the Cloudflare worker (`worker/`,
`GET /api/chart` → Yahoo with edge cache) with stockanalysis.com as fallback,
so no local server is needed for them.

> **Not investment advice.** Market data is free and delayed, and may be incomplete or wrong.
> AI answers can be wrong. Nothing here is a recommendation to buy or sell anything.

**Licence:** MIT (see `LICENSE`).

---

## Run it

```bash
cd finance-byok
python3 serve.py            # http://127.0.0.1:8000
```

`serve.py` is a small standard-library server (no packages to install). It serves
the page, adds a `/proxy` endpoint for the two feeds a browser cannot call directly,
and gives Marvell web search and page reading (`/api/search`, `/api/read`).

You can also just double-click `index.html`. Quotes, history, crypto, FX and SEC
filings still work; only the market-wide screener scan and Google News headlines
need the server.

```bash
python3 serve.py --port 9000        # different port
python3 serve.py --host 0.0.0.0     # reachable from your phone on the same Wi-Fi
```

**Insider trading** (`#/insiders`) is served by `openinsider_scraper.py` through
`serve.py`'s `/api/insiders` endpoint, which needs `pip install requests beautifulsoup4 lxml`.
Without them (or on the hosted copy) the page parses OpenInsider in the browser instead.
The scraper also runs on its own: `python3 openinsider_scraper.py TEM --out exports/`
writes CSV and JSON.

**Filings & Reports** (`#/filings`) lists a company's SEC filings and opens any of them in a
reader with find-in-document, section jumps and Marvell. `serve.py` serves them through
`edgar_filings.py` (`/api/filings`, `/api/filings/doc`; needs `requests`, and `bs4`/`lxml` for
the cleanest text). Earnings 8-Ks open their EX-99 press release. Set `SEC_CONTACT=you@example.com`
so SEC's fair-access rules can reach you. The hosted copy reads EDGAR directly instead: very
large documents may not load there, and the ticker→CIK map ships as `assets/sec_tickers.json`
(refresh with `python3 edgar_filings.py export-tickers`).

---

## Where the data comes from

All free, keyless and delayed. Nothing is fabricated: when a field is not
available, the row is left empty instead of guessed.

| What | Source | Notes |
| --- | --- | --- |
| Quotes, market cap, P/E, EPS, dividend yield, beta, 52-week range, analyst target, next earnings date, sector/industry | TradingView public scanner (`scanner.tradingview.com/symbol`) | Sends CORS headers, so the browser calls it directly. Includes pre/post-market prices. |
| Daily price history for charts and sparklines | stockanalysis.com (`/api/symbol/s/<ticker>/history`) | CORS enabled. Up to ~5 years of daily bars. |
| Market-wide snapshot: screener, "most valuable companies", gainers/losers | TradingView market scan (`POST /america/scan`) | The CORS preflight only allows GET, so this one goes through `serve.py`. ~20,000 listings, filtered to NASDAQ/NYSE/AMEX. |
| Crypto | CoinGecko | CORS enabled, 24/7 change. |
| FX | Frankfurter (European Central Bank reference rates) | CORS enabled. |
| Headlines | Google News RSS | No CORS headers, so it uses the proxy. |
| Company financial statements | SEC XBRL company facts (or your own CSV) | CORS enabled. |

### OpenAlice-style layer (added)

`serve.py` also exposes `/api/oa/*`, mirroring how OpenAlice itself pulls market
data (same hosted upstreams, same server-side pattern):

| Route | What it serves | Upstream |
| --- | --- | --- |
| `GET /api/oa/boards?board=<name>` | Reference boards: `movers`, `valuation`, `macro`, `calendar`, `fed`, `rotation`, `shipping`, `term-structure`, `global-macro` | `traderhub.openalice.ai` (the hosted TraderHub OpenAlice's `market-data.json` points at; free, unauthenticated) |
| `GET /api/oa/chart?symbol=&range=` | OHLCV bars — intraday too (`1D` = 5-minute bars, `5D` = 15-minute) | Yahoo Finance chart API v8, fetched server-side with a plain `Mozilla/5.0` UA (long spoofed UA strings get rate-limited with HTTP 429) |
| `GET /api/oa/quote?symbols=` | Quotes with previous close and market timestamp | Yahoo Finance, same server-side path |

How the page uses it:

- **Home** gains a "Market-wide movers" card fed by the TraderHub `movers`
  board — the same reference layer OpenAlice reads.
- **Charts** use Yahoo bars for `1D`/`5D` ranges (stockanalysis.com is
  daily-only, so intraday was impossible before); longer ranges stay on
  stockanalysis with Yahoo as fallback.
- **Quotes** fall back to Yahoo per symbol when TradingView fails.
- If Yahoo rate-limits, the chart route falls back to Stooq daily bars
  server-side, so the page still renders with a labeled source.

Honesty note: "real-time" here means the same grade OpenAlice itself gets from
its default providers — Yahoo is typically ~15 minutes delayed for US equities
(and OpenAlice's default config is yfinance, i.e. the same upstream). True
exchange-tick data needs a funded broker feed (OpenAlice: UTA broker packs
with `asVendor`; here: bring a keyed vendor via `/proxy`).

If TradingView is unreachable, quotes fall back to whatever is already cached in
the browser and the status chip in the header says so.

### Why a local server at all?

Two things cannot be fetched straight from a page: TradingView's `POST` market scan
(its preflight only permits GET) and Google News RSS (no CORS headers). `serve.py`
forwards exactly those through `/proxy?url=…`, with a strict host allow-list, and
nothing else. It never stores or logs your data.

---

### Smart Money

`#/investors` (left rail, collapsible) tracks eleven well-known portfolios: a top-10 donut and a full list per
investor, with story and philosophy pages. Holdings live in `assets/gurus/holdings.json`:

- Buffett, Burry, Ackman, Wood, Soros, Dalio, Li Lu, Marks, and Jensen Huang (NVIDIA Corp's own
  portfolio): each filer's latest 13F-HR on SEC
  EDGAR, CUSIPs mapped to tickers with OpenFIGI (fallback: SEC's ticker list by name).
- Pelosi and Trump don't file 13Fs. `assets/gurus/disclosures.json` holds their House / OGE
  disclosures at the midpoint of each value range, so the weights are estimates.

Each 13F is compared with the filer's previous quarter: new buys, adds, trims and exits show
in a Quarter moves panel, as chips in the list and in the hover bubble.

Refresh after each 13F deadline (mid-Feb, May, Aug, Nov): `python3 scripts/fetch_13f.py`.
Company logos load from financialmodelingprep.com; a missing logo falls back to the ticker.

## What is implemented

**Layout** — Google-style app bar (hamburger, wordmark, search, market status chip,
theme toggle, keys, more, avatar), market tab strip (US / Europe / Asia / Latin
America / Currencies / Crypto), watchlist rail with collapsible lists, portfolios and
symbol count, footer with source disclosure.

**Home** — quote cards for the selected market group with live sparklines, the
portfolio card, "Top movers in your watchlists" with sortable columns, column picker
and per-row trend sparklines, gainers/losers and "most valuable companies" lists, and
a market news feed. The home tab is labelled **Monitoring Terminal**.

**Quote page** — breadcrumb, AI insight bar, ticker line, price block with session
change, pre/post-market line, area/line/candlestick chart with range pills, compare
mode (SPY / QQQ / sector ETF), moving-average and volume overlays, key stats grid,
related stocks, news, company profile and financial statements.

**Tabs** — Overview, Analysis (analyst consensus loaded from TradingView, plus your
own editable rows), Earnings (next report date and forecasts from TradingView, your
own actuals), Financials (SEC XBRL or your own CSV), Holdings for ETFs, Research
(links plus an AI brief).

**Screener** — filters for symbol, price, day change and market cap over the whole
US listing snapshot, sorted by market cap by default, with "add results to a list".

**Other** — compare view, portfolio tracking (cost basis, P/L), watchlist CRUD,
symbol search with autocomplete, localStorage persistence, light/dark theme,
responsive down to phone width. Watchlists are named objects you can create, **rename**
and delete; each one is called a "watchlist" throughout the UI, and the old default
"Equity sectors" list is gone (the migration removes it from existing browsers).

**First-run tour** — new visitors without a key get a guided tour: a spotlight, a bubble with an
arrow and a short animation for each step (search, markets, lists, Marvell), then step by step through
adding an API key (paste, Save, Test) and opening Marvell. Skip any time with *Skip* or `Esc`; `←` `→`
move between steps. Replay it from the ⋯ menu → *Take the tour*, or from the Agent's empty page. The
"seen" flag is `fh3_tour` in localStorage. The Agent's *Add an API key to start* and the missing-key
reply both open the key page directly.

**AI (bring your own key)** — OpenRouter, OpenAI, Anthropic, DeepSeek, Gemini, Groq
or any OpenAI-compatible endpoint. Keys live only in this browser's localStorage
(`fh_keys`) and are sent only to the provider you pick. Prompt buttons: sentiment,
bull vs bear, earnings take, valuation check, risk scan, compare, screener read,
market summary. The model is told to label assumptions and never to invent figures.

**Skills (type `/` in the Agent box)** — Marvell can run reusable skills written as
`SKILL.md` files (the [Agent Skills](https://agentskills.io/specification) format: YAML
frontmatter with `name` and `description`, then Markdown steps).

* **Upload**: type `/` and press *Upload SKILL.md*, or go to Settings → Skills. Max 200 KB each.
* **Run**: `/skill-name your question`. Arrow keys + Enter pick from the menu.
* **`/learn`** (built in): describe a finance skill in plain words, or attach notes, and Marvell
  drafts a `SKILL.md`. You preview it and press *Save skill*. Non-finance requests are declined.
* **Deep Research**: skills work there too (`/skill-name your research question`). `/learn` does not:
  the research harness can't create skills, so typing `/learn …` in Deep Research opens a new Agent
  session and drafts the skill there automatically.
* **`/skills`** (built in): opens the manager (edit, delete, upload).
* Skills live in this browser's localStorage (`fh3_skills`). A skill sets the method and format
  only: it can't change app settings, and Marvell's data-only rules still apply.

**OpenCode Zen / Go** is supported as its own provider (one `oc_sk-…` key works for
**OpenCode** is supported as **two** providers, because the endpoints differ:

* **OpenCode Go** — the $10/month subscription. Endpoint `https://opencode.ai/zen/go/v1`,
  models such as `deepseek-v4.1-flash`, `deepseek-v4-pro`, `glm-5.3(-flash)`, `kimi-k3`,
  `mimo-v2.6-flash`, `minimax-m3`, `qwen3.8-flash`, `grok-4.6/4.7`, `gpt-5.6-luna`.
  Default model: `deepseek-v4.1-flash` at **low reasoning effort**.
* **OpenCode Zen** — pay-per-use gateway. Endpoint `https://opencode.ai/zen/v1`,
  models such as `claude-sonnet-5-5`, `claude-haiku-5-5`, `gpt-6-luna`, `glm-5.3-flash`,
  `kimi-k3`, `qwen3.8-max`, `mistral-large-4`, `deepseek-v4.1-flash`.

Both use the same `oc_sk-…` key, but a **Go key must select OpenCode Go** — pointing it
at the Zen endpoint returns "Insufficient account funds" because the subscription and
the Zen balance are separate. Go also requires a stable `x-opencode-session` header per
conversation and a client-identifying user agent; the app sends the chat session id,
and `serve.py` adds the user agent. Neither endpoint sends CORS headers, so calls go
through the local `/proxy`, which forwards the `Authorization` header and never writes
the key anywhere. Zen's *free* models only run inside the OpenCode app ("free tier can
only be used from within OpenCode"), so paid models need credits on the account.

**Model picker (Oct 2026 catalog).** The model line under the chat opens a grouped
picker like the one in OpenCode: provider sections, ★ favorites, FLASH/MAX/MED
badges, and a per-model submenu (chevron) with a 7-step **Effort** scale
(Minimal → Ultra). Thinking is always on, so there is no toggle; Minimal is the lowest. Current defaults per provider:
OpenRouter `deepseek/deepseek-v4.1-flash`, OpenAI `gpt-6.1-sol`, Anthropic
`claude-sonnet-5-5`, DeepSeek `deepseek-flash` (V4.1 Flash; legacy `deepseek-chat` /
`deepseek-reasoner` were retired Jul 2026), Gemini `gemini-3.8-flash` (2.5-series
retires Oct 20, 2026), Groq `openai/gpt-oss-120b`, OpenCode `deepseek-v4.1-flash`.
Every request carries the provider's reasoning knob at that effort (OpenRouter
`reasoning`, OpenAI/OpenCode/Groq `reasoning_effort`, DeepSeek `thinking`, Anthropic
thinking budget, Gemini thinking budget, responses `reasoning`). reasoning models (GPT-5/6, o-series) skip
`temperature`, which their APIs reject. "Refresh models" pulls the live
OpenRouter catalog; "Add custom model…" stores ids under Custom.

---

## Files

```
index.html                 the app (markup, CSS, data layer, views, AI, research panel)
harness.js                 Marvell's agent loop: provider adapters, tools, sources, review pass
docs/marvell-guide.md      the app guide Marvell reads with its read_docs tool
serve.py                   static server, /proxy allow-list, /api/search and /api/read
worker/                    Cloudflare worker: charts, feed relay, web search and page reading
README.md                  this file
.work/                     working files, notes and test fixtures
  plan.md                  the implementation and design plan
  ui/brand.css             the MercerFargo brand layer (source for the tokens in index.html)
  reference/brand.md       brand spec: palette, logotype rules, where each colour is used
  research/                saved research trajectories (JSON)
  scripts/mock_llm.py      mock OpenAI-compatible model used to test the bridge
  reference/data-sources.md  endpoint findings, verified with real requests
  reference/finance-harness.md  harness API notes and licence summary
  reference/gfinance.css   theme tokens copied from Google Finance for reference
```

## Marvell harness — the agent behind chat and Deep Research

`harness.js` is a browser-side agent loop modelled on Google Research's FinanceHarness
(loop → tool calls → results → repeat, with round and time caps, a live plan, numbered
sources and a final grounding pass), rebuilt for this site so it runs the same on the
hosted copy and locally.

* **Your key, your provider.** Native tool calling for OpenAI-style chat (OpenRouter, OpenAI,
  xAI, DeepSeek, Groq, OpenCode, custom), OpenAI responses, Anthropic and Gemini.
* **Thinking is always on.** Every request asks for reasoning at the chosen effort; Minimal is
  the floor and there is no off switch. A provider that rejects the reasoning field gets one
  retry without it; models that cannot reason simply answer.
* **Not limited to the open page.** Data tools take any ticker: `get_quote`, `get_price_history`,
  `get_financials` (SEC XBRL), `list_filings` / `read_filing` (EDGAR), `get_insider_trades`
  (Form 4), `get_news`, `screen_stocks`, `get_investor_holdings` (13F), plus `calculate` and `dcf`.
* **Web access, always loaded.** `web_search` (Bing, with DuckDuckGo as fallback) and `read_webpage` go through `/api/search` and `/api/read` — `serve.py`
  locally, the worker on the hosted site. Page reading is GET-only, public hosts only
  (no IPs, localhost or private ranges; redirects re-checked), text-only and size-capped.
* **Drives the app.** `open_quote`, `navigate`, `compare`, `set_chart`, `run_screener`,
  `open_filing` and `read_current_page` run straight away. `propose_changes` (create/add/delete
  portfolios and watchlists) only shows an Apply card; nothing changes until the user clicks.
* **Knows the app.** `read_docs` reads `docs/marvell-guide.md`.
* **Chat** (Agent tab): up to 15 rounds, 4 minutes; the thinking indicator shows the current step.
  **Deep Research**: up to 40 rounds, 10 minutes, a live plan (`update_plan`), cited report,
  then a grounding review; runs are saved in this browser (Research Log, Past runs).

After changing `worker/opencode-proxy.js`, redeploy it: `cd worker && npx wrangler deploy`.

## Notes and limits

- Quotes are delayed, typically by 15 minutes on the free feeds. This is a viewer,
  not a trading terminal.
- Analyst buy/hold/sell counts and quarterly estimates are not in any free feed, so
  those fields are yours to enter (or have the AI draft, labelled as drafted).
- Index history (S&P 500, Nasdaq Composite) is not freely available keylessly, so
  the market cards use the index trackers SPY, QQQ, DIA, IWM and VTI and say so.
- Watchlists, portfolios, notes and keys live in localStorage. Clearing site data
  removes them.
- Not investment advice.
