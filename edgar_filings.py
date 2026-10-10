#!/usr/bin/env python3
"""SEC EDGAR filings scraper: 10-K, 10-Q, 8-K, 6-K + earnings releases to disk.

Why this design (no lags for the website):
- EDGAR's JSON API is the publisher of record: zero structural lag, keyless,
  machine-readable. Every aggregator (BamSEC, stockanalysis, Quiver) is a
  reparsed copy of this feed and cannot be fresher than it.
- No browser, no HTML scraping for discovery: ticker->CIK map, submissions
  JSON, per-filing index.json, then the documents. 3-4 small HTTP hits total.
- Cache split by mutability: ticker map (7d), submissions (15min, filings are
  event-driven), filing documents (forever — accessioned docs are immutable).

Usage:
    python3 edgar_filings.py latest AAPL [--forms 10-K,10-Q,8-K] [--n 10]
    python3 edgar_filings.py earnings AAPL [--out .]      # latest 8-K/6-K press exhibit -> .htm + .txt
    python3 edgar_filings.py doc AAPL --form 10-K [--out .]  # latest primary doc of a form
    python3 edgar_filings.py export-tickers [assets/sec_tickers.json]  # refresh the site's CIK map
    Flags: --no-cache, --cache-min N, --cache-dir DIR, --contact EMAIL

SEC fair access: sends a contactable User-Agent, modest sequential volume,
reuses cached docs. Set --contact to your email.
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import time

import requests

UA_TMPL = "FinanceByok research {contact}"  # UA must carry a plausible contact
# email (SEC fair access); the wall 403s localhost-style contacts — Oct 2026
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SUB_URL = "https://data.sec.gov/submissions/CIK{cik10}.json"
ARCH = "https://www.sec.gov/Archives/edgar/data/{cik}/{nodash}/{name}"
SESSION = requests.Session()
SESSION.headers["Accept"] = "application/json"


def set_contact(email):
    """SEC fair access wants a contactable User-Agent; call before any fetch."""
    SESSION.headers["User-Agent"] = UA_TMPL.format(contact=email)


set_contact(os.environ.get("SEC_CONTACT", "contact@example.com"))  # library default


def _get(url, timeout=30, tries=4):
    last = None
    for i in range(tries):
        try:
            r = SESSION.get(url, timeout=timeout)
            if r.status_code == 200:
                return r
            last = RuntimeError(f"HTTP {r.status_code} for {url}")
        except requests.RequestException as e:
            last = e
        time.sleep(1.5 * (i + 1))  # EDGAR 503s under bursts: back off
    raise RuntimeError(f"fetch failed: {last}")


def _cache_get(path, ttl_min):
    try:
        if (time.time() - os.path.getmtime(path)) / 60 < ttl_min:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
    except (OSError, ValueError):
        pass
    return None


def _cache_put(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f)
    os.replace(tmp, path)


def tickers_map(cache_dir):
    p = os.path.join(cache_dir, "company_tickers.json")
    data = _cache_get(p, 7 * 24 * 60)
    if data is None:
        data = _get(TICKERS_URL).json()
        _cache_put(p, data)
    vals = data.values() if isinstance(data, dict) else data
    return {str(v["ticker"]).upper(): (int(v["cik_str"]),
            v.get("title", "")) for v in vals}


def resolve(sym, cache_dir):
    m = tickers_map(cache_dir)
    if sym.upper() not in m:
        raise RuntimeError(f"unknown ticker: {sym} (not in SEC company_tickers)")
    return m[sym.upper()]  # (cik_int, company_name)


def submissions(cik, cache_dir, cache_min, no_cache):
    cik10 = f"{cik:010d}"
    p = os.path.join(cache_dir, f"submissions_{cik10}.json")
    data = None if no_cache else _cache_get(p, cache_min)
    if data is None:
        data = _get(SUB_URL.format(cik10=cik10)).json()
        _cache_put(p, data)
    return data


def all_filings(sub):
    """The 'recent' block as a newest-first list (EDGAR keeps ~1000 filings or a year there,
    whichever is more; older pages in filings.files are not fetched)."""
    rec = sub.get("filings", {}).get("recent", {})
    n = len(rec.get("accessionNumber", []))
    rows = [{
        "accession": rec["accessionNumber"][i],
        "filing_date": rec["filingDate"][i],
        "form": rec["form"][i],
        "primary_doc": rec["primaryDocument"][i],
        "description": (rec.get("primaryDocDescription") or [""] * n)[i],
        "report_date": (rec.get("reportDate") or [""] * n)[i],
        "items": (rec.get("items") or [""] * n)[i],  # 8-K item codes, e.g. "2.02,9.01"
        "size": (rec.get("size") or [0] * n)[i],
    } for i in range(n)]
    return rows


def filing_index(cik, accession, cache_dir):
    nodash = accession.replace("-", "")
    p = os.path.join(cache_dir, f"index_{nodash}.json")
    idx = _cache_get(p, 10 ** 9)  # immutable: cache forever
    if idx is None:
        base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{nodash}/"
        idx = _get(base + "index.json").json()
        idx["_base"] = base
        _cache_put(p, idx)
    return idx


def download(cik, accession, filename, dest):
    nodash = accession.replace("-", "")
    url = ARCH.format(cik=cik, nodash=nodash, name=filename)
    r = _get(url)
    with open(dest, "wb") as f:
        f.write(r.content)
    return dest, len(r.content)


def html_to_text(html):
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        BeautifulSoup = None
    if BeautifulSoup is not None:
        soup = BeautifulSoup(html, "lxml")
        for tag in soup(["script", "style", "ix:header"]):  # ix:header = hidden XBRL facts
            tag.decompose()
        # newline only after block elements, so inline-XBRL spans don't shred sentences
        for tag in soup(["p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table"]):
            tag.append("\n")
        for tag in soup(["td", "th"]):
            tag.append(" ")
        text = re.sub(r"[ \t\xa0]+", " ", soup.get_text())
        return re.sub(r"\n\s*\n+", "\n", re.sub(r" *\n *", "\n", text)).strip()
    text = re.sub(r"(?s)<script.*?</script>|<style.*?</style>|<!--.*?-->", " ", html)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n\n", text)).strip()


def pick_earnings_exhibit(items):
    """Prefer an EX-99 press-release exhibit, else the primary 8-K/6-K doc."""
    names = [it["name"] for it in items if it.get("name")]
    ex99 = [n for n in names if re.search(r"ex99", n, re.I)]
    if ex99:
        return sorted(ex99, key=len)[0]
    htm = [n for n in names if n.lower().endswith((".htm", ".html"))
           and "index" not in n.lower() and "filing" not in n.lower()
           and not re.search(r"_r\d+\.htm", n, re.I)]  # skip R-file exhibits
    return htm[0] if htm else (names[0] if names else None)


def is_earnings(r):
    return r["form"] == "8-K" and "2.02" in (r.get("items") or "")


def document_text(cik, filing, cache_dir):
    """Readable text of a filing -> (document name, text). Earnings 8-Ks and 6-Ks
    read their EX-99 press release (the cover doc is a one-pager); everything else
    reads the primary document. Cached forever: accessioned docs are immutable."""
    nodash = filing["accession"].replace("-", "")
    p = os.path.join(cache_dir, f"text_{nodash}.json")
    hit = _cache_get(p, 10 ** 9)
    if hit:
        return hit["name"], hit["text"]
    name = filing["primary_doc"]
    if is_earnings(filing) or filing["form"] == "6-K":
        items = (filing_index(cik, filing["accession"], cache_dir).get("directory") or {}).get("item", [])
        name = pick_earnings_exhibit(items) or name
    r = _get(ARCH.format(cik=cik, nodash=nodash, name=name))
    raw = r.content.decode(r.encoding or "utf-8", errors="replace")
    raw = re.sub(r"(?is)\A\s*<DOCUMENT>.*?<TEXT>", "", raw)  # EDGAR's SGML wrapper (<TYPE>, <FILENAME>…)
    text = html_to_text(raw) if name.lower().endswith((".htm", ".html")) else raw
    _cache_put(p, {"name": name, "text": text})
    return name, text


def cmd_latest(a):
    cik, name = resolve(a.ticker, a.cache_dir)
    forms = {f.strip().upper() for f in a.forms.split(",")}
    rows = [r for r in all_filings(
        submissions(cik, a.cache_dir, a.cache_min, a.no_cache))
        if r["form"] in forms][:a.n]
    print(f"{a.ticker.upper()} ({name}, CIK {cik}): {len(rows)} filings")
    for r in rows:
        print(f'{r["filing_date"]}  {r["form"]:<6} {r["accession"]}  '
              f'{r["primary_doc"]}  {r["description"][:60]}')


def cmd_doc(a):
    cik, _ = resolve(a.ticker, a.cache_dir)
    sub = submissions(cik, a.cache_dir, a.cache_min, a.no_cache)
    hits = [r for r in all_filings(sub) if r["form"] == a.form.upper()]
    if not hits:
        raise RuntimeError(f"no {a.form} found for {a.ticker}")
    r = hits[0]
    os.makedirs(a.out, exist_ok=True)
    stem = f'{a.ticker.upper()}_{r["form"]}_{r["filing_date"]}'
    dest = os.path.join(a.out, stem + "_" + r["primary_doc"])
    _, size = download(cik, r["accession"], r["primary_doc"], dest)
    print(f'{r["form"]} filed {r["filing_date"]}  accession {r["accession"]}')
    print(f"FILE: {dest} ({size:,} bytes)")


def cmd_earnings(a):
    cik, _ = resolve(a.ticker, a.cache_dir)
    sub = submissions(cik, a.cache_dir, a.cache_min, a.no_cache)
    hits = [r for r in all_filings(sub) if r["form"] in ("8-K", "6-K")]
    hits.sort(key=lambda r: not is_earnings(r))  # stable: newest item-2.02 8-K first
    if not hits:
        raise RuntimeError(f"no 8-K/6-K found for {a.ticker}")
    r = hits[0]
    idx = filing_index(cik, r["accession"], a.cache_dir)
    items = (idx.get("directory") or {}).get("item", [])
    doc = pick_earnings_exhibit(items)
    if not doc:
        raise RuntimeError("filing index has no downloadable documents")
    os.makedirs(a.out, exist_ok=True)
    stem = (f'{a.ticker.upper()}_earnings_{r["form"]}_{r["filing_date"]}_'
            f'{r["accession"]}')
    htm_p = os.path.join(a.out, stem + "_" + os.path.basename(doc))
    _, size = download(cik, r["accession"], doc, htm_p)
    raw = open(htm_p, encoding="utf-8", errors="replace").read()
    txt_p = os.path.splitext(htm_p)[0] + ".txt"
    text = html_to_text(raw)
    open(txt_p, "w", encoding="utf-8").write(text)
    print(f'Latest {r["form"]} {r["filing_date"]}  accession {r["accession"]}')
    print(f"EXHIBIT: {htm_p} ({size:,} bytes)")
    print(f"TEXT   : {txt_p} ({len(text):,} chars)")


def cmd_export_tickers(a):
    """Write {TICKER: cik} for the static site: www.sec.gov blocks browser fetches
    of company_tickers.json, so the page ships this copy as its fallback."""
    data = _get(TICKERS_URL).json()
    m = {}
    for v in data.values():
        m.setdefault(str(v["ticker"]).upper(), int(v["cik_str"]))  # first row = primary listing
    with open(a.path, "w", encoding="utf-8") as f:
        json.dump(m, f, separators=(",", ":"), sort_keys=True)
    print(f"{len(m):,} tickers -> {a.path}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="SEC EDGAR filings scraper.")
    ap.add_argument("--cache-dir", default=os.path.expanduser(
        "~/.cache/edgar_filings"))
    ap.add_argument("--cache-min", type=float, default=15,
                    help="submissions TTL minutes (default 15)")
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--contact", default=os.environ.get("SEC_CONTACT", "contact@example.com"),
                    help="contact email for SEC User-Agent (use your own)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("latest", help="list recent filings by form")
    p.add_argument("ticker")
    p.add_argument("--forms", default="10-K,10-Q,8-K,6-K")
    p.add_argument("--n", type=int, default=10)
    p.set_defaults(fn=cmd_latest)

    p = sub.add_parser("doc", help="download latest primary doc of a form")
    p.add_argument("ticker")
    p.add_argument("--form", default="10-K")
    p.add_argument("--out", default=".")
    p.set_defaults(fn=cmd_doc)

    p = sub.add_parser("earnings", help="pull latest earnings-release exhibit")
    p.add_argument("ticker")
    p.add_argument("--out", default=".")
    p.set_defaults(fn=cmd_earnings)

    p = sub.add_parser("export-tickers", help="write the ticker->CIK map the static site falls back to")
    p.add_argument("path", nargs="?", default="assets/sec_tickers.json")
    p.set_defaults(fn=cmd_export_tickers)

    a = ap.parse_args(argv)
    set_contact(a.contact)
    a.fn(a)


if __name__ == "__main__":
    main()
