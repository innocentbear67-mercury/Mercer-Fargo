#!/usr/bin/env python3
"""OpenInsider screener scraper: per-ticker Form 4 trades to CSV + JSON.

Mirrors the Mercer Fargo / finance-byok insider panel (index.html INS module):
same screener URL, same tinytable parse, same joint-filer dedupe — as a
standalone stdlib+requests+bs4 CLI so it runs without the web app or proxy.

Usage:
    python3 openinsider_scraper.py AAPL [--days 730] [--out .] [--max-pages 10]

Output:
    <TICKER>_openinsider_fd<days>_<YYYYMMDD>.csv
    <TICKER>_openinsider_fd<days>_<YYYYMMDD>.json

Notes:
- Needs: pip install requests beautifulsoup4 lxml
- Uses http:// (NOT https://) — openinsider.com fails plain-TLS fetches;
  verified Oct 2026: http curl -> 200 + tinytable, https curl -> connection fail.
- cnt=1000 rows per page; loops page=1..N until a page yields zero new rows.
- Filing URLs are normalized to https: for the SEC Archives link.
"""

import argparse
import csv
import datetime as dt
import json
import re
import sys
import time

import requests
from bs4 import BeautifulSoup

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")
BASE = ("http://openinsider.com/screener?s={sym}&fd={days}&xp=1&xs=1&xa=1"
        "&xd=1&xg=1&xf=1&xm=1&xx=1&xc=1&xw=1&cnt=1000&page={page}")
SESSION = requests.Session()
SESSION.headers["User-Agent"] = UA

KIND = {"P": "buy", "S": "sell"}
PAGE = 1000  # cnt= rows per screener page
TICKER_RE = re.compile(r"[A-Z][A-Z.\-]{0,9}")


def clean_ticker(sym):
    """Upper-case and validate: the ticker goes into a URL and into filenames."""
    sym = (sym or "").upper().strip()
    if not TICKER_RE.fullmatch(sym):
        raise ValueError(f"bad ticker: {sym!r}")
    return sym


def num(t):
    v = re.sub(r"[$,+%]", "", (t or "").strip())
    try:
        return float(v.replace(",", "")) if v not in ("", "-", "—") else None
    except ValueError:
        return None


def intnum(t):
    v = num(t)
    return int(v) if v is not None else None


def parse_page(html):
    """Parse one screener page -> list of row dicts (may be empty)."""
    soup = BeautifulSoup(html, "lxml")
    table = soup.select_one("table.tinytable")
    if not table:
        return []
    rows = []
    for tr in table.select("tbody tr"):
        c = tr.find_all("td")
        if len(c) < 12:
            continue
        tx = lambda i: re.sub(r"\s+", " ", c[i].get_text(" ", strip=True)).strip()
        trade_date = tx(2)
        if not re.match(r"^\d{4}-\d\d-\d\d$", trade_date):
            continue  # header / pager row, not a filing
        code = tx(6)[:1]
        a = c[1].find("a")
        url = (a.get("href") if a else "") or ""
        url = "https:" + url[5:] if url.startswith("http:") else url
        rows.append({
            "filed": tx(1)[:10],
            "filed_time": tx(1),
            "trade_date": trade_date,
            "ticker": tx(3),
            "insider": tx(4),
            "title": tx(5),
            "trade_type": re.sub(r"^[A-Z]\s*-\s*", "", tx(6)),
            "code": code,
            "kind": KIND.get(code, "other"),
            "price": num(tx(7)),
            "qty": intnum(tx(8)),
            "owned": intnum(tx(9)),
            "delta_own": tx(10),
            "value": intnum(tx(11)),
            "perf_1d": tx(12) if len(c) > 12 else "",
            "perf_1w": tx(13) if len(c) > 13 else "",
            "perf_1m": tx(14) if len(c) > 14 else "",
            "perf_6m": tx(15) if len(c) > 15 else "",
            "filing_url": url,
        })
    return rows


def scrape(sym, days=730, max_pages=10, pause=0.0, timeout=30):
    """Fetch all pages for a ticker; dedupes joint-filer repeats like the app."""
    sym = clean_ticker(sym)
    seen, out = set(), []
    for page in range(1, max_pages + 1):
        url = BASE.format(sym=sym, days=days, page=page)
        r = None
        for attempt in range(3):
            try:
                r = SESSION.get(url, timeout=timeout)
                r.raise_for_status()
                break
            except requests.RequestException as e:
                if attempt == 2:
                    raise RuntimeError(f"fetch failed page {page}: {e}")
                time.sleep(2 * (attempt + 1))
        assert r is not None  # raised above if all retries failed
        new_rows = 0
        page_rows = parse_page(r.text)
        for row in page_rows:
            key = (row["trade_date"], row["insider"], row["qty"],
                   row["price"], row["owned"])
            if key in seen:
                continue
            seen.add(key)
            out.append(row)
            new_rows += 1
        if new_rows == 0 or len(page_rows) < PAGE:
            break  # short page = last page; no new rows = screener repeated itself
        time.sleep(pause)
    return out


FIELDS = ["filed", "filed_time", "trade_date", "ticker", "insider", "title",
          "trade_type", "code", "kind", "price", "qty", "owned", "delta_own",
          "value", "perf_1d", "perf_1w", "perf_1m", "perf_6m", "filing_url"]


def main(argv=None):
    ap = argparse.ArgumentParser(description="Scrape OpenInsider screener per ticker.")
    ap.add_argument("ticker", help="e.g. AAPL")
    ap.add_argument("--days", type=int, default=730, help="lookback days fd (default 730)")
    ap.add_argument("--out", default=".", help="output dir (default .)")
    ap.add_argument("--max-pages", type=int, default=10)
    ap.add_argument("--pause", type=float, default=0.0,
                    help="sleep secs between pages (default 0)")
    ap.add_argument("--cache-min", type=float, default=30,
                    help="reuse cached rows younger than this (minutes)")
    ap.add_argument("--no-cache", action="store_true",
                    help="force a fresh fetch")
    args = ap.parse_args(argv)
    try:
        args.ticker = clean_ticker(args.ticker)
    except ValueError as e:
        ap.error(str(e))

    import os
    os.makedirs(args.out, exist_ok=True)
    stamp = dt.date.today().strftime("%Y%m%d")
    stem = f"{args.ticker.upper()}_openinsider_fd{args.days}_{stamp}"
    cache_p = os.path.join(
        args.out, f".cache_{args.ticker.upper()}_fd{args.days}.json")

    rows, cached_note = None, ""
    if not args.no_cache and os.path.exists(cache_p):
        try:
            age_min = (time.time() - os.path.getmtime(cache_p)) / 60
            if age_min < args.cache_min:
                with open(cache_p, encoding="utf-8") as f:
                    rows = json.load(f)["rows"]
                cached_note = f" (cached {age_min:.1f}m ago)"
        except (OSError, ValueError, KeyError):
            rows = None  # corrupt cache: fall through to fresh fetch
    if rows is None:
        rows = scrape(args.ticker, days=args.days,
                      max_pages=args.max_pages, pause=args.pause)
        with open(cache_p, "w", encoding="utf-8") as f:
            json.dump({"rows": rows}, f)
    csv_p = os.path.join(args.out, stem + ".csv")
    json_p = os.path.join(args.out, stem + ".json")

    with open(csv_p, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    with open(json_p, "w", encoding="utf-8") as f:
        json.dump({"ticker": args.ticker.upper(), "days": args.days,
                   "scraped_at": stamp, "source": "openinsider.com",
                   "rows": rows}, f, indent=1)

    buys = sum(1 for r in rows if r["kind"] == "buy")
    sells = sum(1 for r in rows if r["kind"] == "sell")
    print(f"{args.ticker.upper()}: {len(rows)} rows ({buys} buys, {sells} sells){cached_note}")
    print(f"CSV : {csv_p}")
    print(f"JSON: {json_p}")


if __name__ == "__main__":
    main()
