#!/usr/bin/env python3
"""
FinanceHub local server.

Serves index.html (and anything else in this folder), exposes a small same-origin
proxy so the page can reach market-data APIs that do not send CORS headers, and
gives Marvell's in-browser harness web search and page reading.

    python3 serve.py            # http://127.0.0.1:8000
    python3 serve.py --port 9000
    python3 serve.py --host 0.0.0.0      # reachable from other devices on your LAN

Why the proxy exists: most of the data layer is CORS friendly and works with the
page opened directly (TradingView quotes, stockanalysis.com history, CoinGecko,
Frankfurter, SEC). Two things still need a same-origin hop:

  * TradingView's market-wide scanner (POST /america/scan), which powers the
    screener page and the "most valuable companies" list. Its CORS preflight only
    allows GET, so a browser cannot POST to it.
  * Google News RSS, which sends no CORS headers.

Endpoints
    GET  /                        -> index.html
    GET  /proxy?url=<encoded>     -> forwards to an allow-listed host
    GET  /api/search?q=<query>    -> Bing web results, DuckDuckGo fallback (JSON)
    GET  /api/read?u=<url>        -> readable text of one public web page (JSON)

No third-party packages are used. Nothing is written to disk.
"""

import argparse
import base64
import gzip
import html as htmllib
import io
import ipaddress
import json
import re
import os
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
# OpenCode Go asks clients to identify themselves with their own user agent
# instead of a generic SDK or library name.
CLIENT_UA = "MercerFargo-Finance-Superhub/1.0"

# Only these hosts may be proxied. Keep the list tight: an open proxy on a
# laptop is a bad idea.
ALLOWED_HOSTS = {
    "scanner.tradingview.com",
    "stockanalysis.com",
    "news.google.com",
    "api.coingecko.com",
    "api.frankfurter.dev",
    "api.frankfurter.app",
    "data.sec.gov",
    "www.sec.gov",
    "api.gdeltproject.org",
    "query1.finance.yahoo.com",
    "query2.finance.yahoo.com",
    "api.nasdaq.com",
    "stooq.com",
    "stooq.pl",
    "api.twelvedata.com",
    "traderhub.openalice.ai",
    "openinsider.com",
    # OpenCode Zen / Go — the AI gateway sends no CORS headers, so the browser
    # reaches it through this proxy. The caller's Authorization header is forwarded.
    "opencode.ai",
}

MAX_BYTES = 12 * 1024 * 1024

def fetch_upstream(url, timeout=25, method="GET", payload=None, content_type=None,
                   ua=None, extra_headers=None):
    """Fetch a URL with a browser UA and transparent gzip/deflate handling."""
    headers = {
        "User-Agent": ua or UA,
        "Accept": "application/json, text/csv, application/xml, text/xml, text/html, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        "Cache-Control": "no-cache",
    }
    if content_type:
        headers["Content-Type"] = content_type
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read(MAX_BYTES)
        enc = (resp.headers.get("Content-Encoding") or "").lower()
        if "gzip" in enc:
            raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
        elif "deflate" in enc:
            try:
                raw = zlib.decompress(raw)
            except zlib.error:
                raw = zlib.decompress(raw, -zlib.MAX_WBITS)
        return resp.status, resp.headers.get("Content-Type") or "application/octet-stream", raw


# --- web access for Marvell's harness (mirrors worker/opencode-proxy.js) -----

SEARCH_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
             "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")


def _strip(x):
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", "", x or ""))).strip()


def ddg_parse(page):
    out = []
    for b in page.split('class="result__a"')[1:]:
        m = re.search(r'href="([^"]+)"[^>]*>([\s\S]*?)</a>', b)
        if not m:
            continue
        href = htmllib.unescape(m.group(1))
        u = re.search(r"[?&]uddg=([^&]+)", href)
        if u:
            href = urllib.parse.unquote(u.group(1))
        if href.startswith("//"):
            href = "https:" + href
        if not re.match(r"https?://", href) or "duckduckgo.com/y.js" in href:
            continue
        sn = re.search(r'class="result__snippet"[^>]*>([\s\S]*?)</a>', b)
        out.append({"title": _strip(m.group(2)), "url": href, "snippet": _strip(sn.group(1) if sn else "")})
        if len(out) >= 10:
            break
    return out


def bing_parse(page):
    out = []
    for b in page.split('class="b_algo"')[1:]:
        m = re.search(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', b)
        if not m:
            continue
        href = htmllib.unescape(m.group(1))
        u = re.search(r"[?&]u=a1([^&]+)", href)
        if u:
            try:
                enc = u.group(1)
                href = base64.urlsafe_b64decode(enc + "=" * (-len(enc) % 4)).decode("utf-8")
            except (ValueError, UnicodeDecodeError):
                continue
        if not re.match(r"https?://", href):
            continue
        sn = re.search(r"<p[^>]*>([\s\S]*?)</p>", b)
        out.append({"title": _strip(m.group(2)), "url": href, "snippet": _strip(sn.group(1) if sn else "")})
        if len(out) >= 10:
            break
    return out


SEARCH_ENGINES = [   # Bing first; DuckDuckGo blocks bursts of automated queries, so it is the fallback
    ("Bing", lambda q: "https://www.bing.com/search?setlang=en&cc=US&q=" + urllib.parse.quote_plus(q), bing_parse),
    ("DuckDuckGo", lambda q: "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote_plus(q), ddg_parse),
]


def html_text(page):
    t = re.search(r"<title[^>]*>([\s\S]*?)</title>", page, re.I)
    body = re.sub(r"<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?</\1>", " ", page, flags=re.I)
    body = re.sub(r"<!--[\s\S]*?-->", " ", body)
    body = re.sub(r"</(p|div|h[1-6]|li|tr|section|article|table)>|<br\s*/?>", "\n", body, flags=re.I)
    body = re.sub(r"<(td|th)[^>]*>", " | ", body, flags=re.I)
    body = htmllib.unescape(re.sub(r"<[^>]+>", " ", body))
    body = re.sub(r"[ \t\f\v]+", " ", body)
    body = re.sub(r"\n\s*", "\n", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return _strip(t.group(1) if t else ""), body


def public_url(raw):
    """A URL is readable only if it is http(s) and every address its host resolves to is public."""
    try:
        u = urllib.parse.urlparse(raw)
    except ValueError:
        return None
    host = (u.hostname or "").lower()
    if u.scheme not in ("http", "https") or not host or u.username or u.password:
        return None
    try:
        addrs = {a[4][0] for a in socket.getaddrinfo(host, u.port or (443 if u.scheme == "https" else 80))}
    except (socket.gaierror, UnicodeError, ValueError):
        return None
    if not addrs or not all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addrs):
        return None
    return u


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class NotFound(ValueError):
    """Yahoo says the symbol does not exist: there is no point trying the Stooq fallback."""


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "FinanceHub/1.0"

    def log_message(self, fmt, *args):
        # Keep the console readable: report only proxy problems, not every call.
        if "/proxy" not in (self.path or ""):
            return
        line = fmt % args
        if '" 200 ' in line or '" 204 ' in line:
            return
        sys.stderr.write("  proxy %s\n" % line)

    # --- routing ------------------------------------------------------------

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if self.path.startswith("/proxy"):
            return self.handle_proxy()
        if path == "/api/oa/boards":
            return self.oa_boards()
        if path == "/api/oa/chart":
            return self.oa_chart()
        if path == "/api/oa/quote":
            return self.oa_quote()
        if path == "/api/insiders":
            return self.insiders()
        if path == "/api/filings":
            return self.filings()
        if path == "/api/filings/doc":
            return self.filing_doc()
        if path == "/api/search":
            return self.web_search()
        if path == "/api/read":
            return self.web_read()
        if self.path in ("/", ""):
            self.path = "/index.html"
        return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if not self.path.startswith("/proxy"):
            return self.json_error(405, "POST is only supported on /proxy")
        length = int(self.headers.get("Content-Length") or 0)
        if length > 1_000_000:
            return self.json_error(413, "body too large")
        payload = self.rfile.read(length) if length else None
        return self.handle_proxy(payload=payload,
                                 content_type=self.headers.get("Content-Type") or "application/json")

    def end_headers(self):
        # Always serve the latest copy: this is a local development server and a
        # stale index.html is confusing.
        if not self.path.startswith("/proxy"):
            self.send_header("Cache-Control", "no-store, must-revalidate")
        SimpleHTTPRequestHandler.end_headers(self)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Expose-Headers", "*")

    # --- json helpers -------------------------------------------------------

    def read_json_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:                                          # noqa: BLE001
            return {}

    def json_out(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def json_error(self, code, msg):
        body = json.dumps({"error": msg}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    # --- proxy --------------------------------------------------------------

    def forward_headers(self):
        """Pass the local client's auth headers upstream (allow-listed hosts only).
        OpenCode Go/Zen authenticate with the caller's own bearer key and want a
        stable x-opencode-session plus a client-identifying user agent; the app's
        key never leaves this machine except on the request it belongs to."""
        keep = {}
        for name in ("Authorization", "X-Api-Key", "X-Title", "HTTP-Referer",
                     "X-Opencode-Session"):
            value = self.headers.get(name)
            if value:
                keep[name] = value
        target_host = ""
        try:
            target_host = urllib.parse.urlparse(
                urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("url", [""])[0]
            ).hostname or ""
        except Exception:                                          # noqa: BLE001
            target_host = ""
        if target_host == "opencode.ai":
            keep["User-Agent"] = CLIENT_UA
            keep.setdefault("X-Opencode-Session", "mercerfargo-local")
        return keep

    def handle_proxy(self, payload=None, content_type=None):
        qs = urllib.parse.urlparse(self.path).query
        target = urllib.parse.parse_qs(qs).get("url", [""])[0]
        if not target:
            return self.json_error(400, "missing ?url=")
        parsed = urllib.parse.urlparse(target)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return self.json_error(400, "bad url")
        if parsed.hostname not in ALLOWED_HOSTS:
            return self.json_error(403, "host not allowed: %s" % parsed.hostname)
        try:
            status, ctype, body = fetch_upstream(
                target,
                method="POST" if payload is not None else "GET",
                payload=payload,
                content_type=content_type,
                extra_headers=self.forward_headers(),
            )
        except urllib.error.HTTPError as e:
            body = e.read(65536) or b""
            status, ctype = e.code, e.headers.get("Content-Type") or "text/plain"
        except Exception as e:                                    # noqa: BLE001
            return self.json_error(502, "upstream error: %s" % e)
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    # --- insider trades (openinsider_scraper.py) -----------------------------

    _ins_cache = {}            # (sym, days) -> (fetched_at, rows); ponytail: unbounded, fine for one user

    def web_search(self):
        q = (urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("q", [""])[0]).strip()[:300]
        if not q:
            return self.json_error(400, "missing q")
        tried = []
        for name, url, parse in SEARCH_ENGINES:
            try:
                _, _, raw = fetch_upstream(url(q), timeout=12, ua=SEARCH_UA)
                results = parse(raw.decode("utf-8", "replace"))
                if results:
                    return self.json_out({"query": q, "results": results, "_meta": {"source": name}})
                tried.append(name + ": no results")
            except Exception as e:                                # noqa: BLE001
                tried.append("%s: %s" % (name, str(e)[:80]))
        return self.json_error(502, "search unavailable (%s)" % "; ".join(tried))

    def web_read(self):
        raw_url = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("u", [""])[0]
        u = public_url(raw_url)
        if not u:
            return self.json_error(400, "only public http(s) pages can be read")
        opener = urllib.request.build_opener(_NoRedirect)
        cur = u.geturl()
        try:
            for _ in range(5):   # follow redirects by hand so every hop is re-checked
                ua = "MercerFargo research %s" % os.environ.get("SEC_CONTACT", "contact@example.com") \
                    if re.search(r"(^|\.)sec\.gov$", urllib.parse.urlparse(cur).hostname or "") else SEARCH_UA
                req = urllib.request.Request(cur, headers={"User-Agent": ua, "Accept": "text/html,text/plain,application/json,*/*",
                                                           "Accept-Encoding": "gzip"})
                try:
                    resp = opener.open(req, timeout=15)
                except urllib.error.HTTPError as e:
                    if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
                        nxt = urllib.parse.urljoin(cur, e.headers["Location"])
                        if not public_url(nxt):
                            return self.json_error(400, "redirected to a non-public address")
                        cur = nxt
                        continue
                    return self.json_error(502, "page HTTP %d" % e.code)
                break
            else:
                return self.json_error(502, "too many redirects")
            with resp:
                ctype = resp.headers.get("Content-Type") or ""
                if not re.search(r"text/|json|xml", ctype):
                    return self.json_error(415, "not a text page (%s)" % ctype.split(";")[0])
                body = resp.read(3_000_000)
                if "gzip" in (resp.headers.get("Content-Encoding") or "").lower():
                    body = gzip.GzipFile(fileobj=io.BytesIO(body)).read()
        except Exception as e:                                    # noqa: BLE001
            return self.json_error(502, "could not read page: %s" % str(e)[:120])
        text = body.decode("utf-8", "replace")
        title, text = html_text(text) if "html" in ctype else ("", text)
        if len(text) < 400 and re.search(r"just a moment|attention required|access denied|captcha|enable javascript", title + " " + text, re.I):
            return self.json_error(403, "this site blocks automated reading; try another source")
        return self.json_out({"url": cur, "title": title, "text": text[:20000], "truncated": len(text) > 20000})

    def insiders(self):
        """Form 4 rows for one ticker via openinsider_scraper.scrape(). The scraper
        needs requests/bs4/lxml; without them this answers 501 and the page falls
        back to parsing OpenInsider in the browser."""
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            import openinsider_scraper as oi
        except ImportError as e:
            return self.json_error(501, "insider scraper unavailable: %s" % e)
        try:
            sym = oi.clean_ticker(qs.get("s", [""])[0])
            days = max(1, min(3650, int(qs.get("days", ["730"])[0])))
        except ValueError as e:
            return self.json_error(400, str(e))
        hit = self._ins_cache.get((sym, days))
        if hit and time.time() - hit[0] < 30 * 60:
            rows = hit[1]
        else:
            try:
                rows = oi.scrape(sym, days=days)
            except Exception as e:                                # noqa: BLE001
                return self.json_error(502, "openinsider: %s" % e)
            self._ins_cache[(sym, days)] = (time.time(), rows)
        return self.json_out({"ticker": sym, "days": days, "rows": rows})

    # --- SEC filings (edgar_filings.py) ---------------------------------------

    EDGAR_CACHE = os.path.join(ROOT, ".work", "edgar")

    def _edgar(self):
        """(module, sym, cik, company, filings) or None after answering an error.
        Needs `requests` (bs4/lxml optional); without it the page reads EDGAR itself."""
        try:
            import edgar_filings as ef
        except ImportError as e:
            self.json_error(501, "edgar scraper unavailable: %s" % e)
            return None
        sym = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("s", [""])[0].upper().strip()
        if not re.fullmatch(r"[A-Z][A-Z.\-]{0,9}", sym):
            self.json_error(400, "bad ticker")
            return None
        try:
            cik, name = ef.resolve(sym, self.EDGAR_CACHE)
            rows = ef.all_filings(ef.submissions(cik, self.EDGAR_CACHE, 15, False))
        except Exception as e:                                    # noqa: BLE001
            self.json_error(404 if "unknown ticker" in str(e) else 502, str(e))
            return None
        return ef, sym, cik, name, rows

    def filings(self):
        got = self._edgar()
        if got:
            ef, sym, cik, name, rows = got
            self.json_out({"ticker": sym, "cik": cik, "name": name, "filings": rows})

    def filing_doc(self):
        got = self._edgar()
        if not got:
            return
        ef, sym, cik, name, rows = got
        acc = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("acc", [""])[0]
        hit = [r for r in rows if r["accession"] == acc]   # only this company's own filings
        if not hit:
            return self.json_error(404, "no filing %s for %s" % (acc, sym))
        try:
            doc, text = ef.document_text(cik, hit[0], self.EDGAR_CACHE)
        except Exception as e:                                    # noqa: BLE001
            return self.json_error(502, str(e))
        url = ef.ARCH.format(cik=cik, nodash=acc.replace("-", ""), name=doc)
        self.json_out({"accession": acc, "form": hit[0]["form"], "doc": doc, "url": url, "text": text})

    # --- OpenAlice-style market data (hub-first reference, Yahoo bars) --------

    OA_BOARDS = {"movers", "calendar", "macro", "valuation", "term-structure",
                 "global-macro", "shipping", "fed", "rotation"}

    OA_YMAP = {"^SPX": "^GSPC", "^IQX": "^IXIC", "^DJI": "^DJI", "^RUT": "^RUT",
               "^UKX": "^FTSE", "^DAX": "^GDAXI", "^CAC": "^FCHI", "^NKX": "^N225",
               "^HSI": "^HSI", "^SHC": "000001.SS", "^NDQ": "^NDX", "^VIX": "^VIX",
               "ES.F": "ES=F", "NQ.F": "NQ=F", "YM.F": "YM=F", "GC.F": "GC=F", "CL.F": "CL=F"}

    OA_RANGE = {"1D": ("1d", "5m"), "5D": ("5d", "15m"), "1M": ("1mo", "1d"),
                "6M": ("6mo", "1d"), "YTD": ("ytd", "1d"), "1Y": ("1y", "1d"),
                "5Y": ("5y", "1wk"), "MAX": ("max", "1mo")}

    def oa_symbol(self, s):
        s = (s or "").strip().upper()
        if s in self.OA_YMAP:
            return self.OA_YMAP[s]
        return s

    def oa_boards(self):
        """Reference boards from hosted TraderHub, like OpenAlice's hub-first path."""
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        board = (qs.get("board", ["movers"])[0] or "movers").strip()
        if board not in self.OA_BOARDS:
            return self.json_error(400, "unknown board: %s" % board)
        url = "https://traderhub.openalice.ai/api/reference/%s" % board
        try:
            status, _, body = fetch_upstream(url)
        except Exception as e:                                    # noqa: BLE001
            return self.json_error(502, "traderhub error: %s" % e)
        try:
            data = json.loads(body.decode("utf-8"))
        except ValueError:
            return self.json_error(502, "traderhub sent non-JSON")
        data["_meta"] = {"source": "traderhub.openalice.ai (OpenAlice hub-first)",
                         "board": board, "asOf": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
        return self.json_out(data, code=status if status == 200 else status)

    def oa_yahoo_chart(self, symbol, rng="1M", interval=None):
        ysym = self.oa_symbol(symbol)
        r, default_i = self.OA_RANGE.get(rng.upper(), ("1mo", "1d"))
        i = interval or default_i
        last = None
        for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
            url = ("https://%s/v8/finance/chart/%s?range=%s&interval=%s"
                   % (host, urllib.parse.quote(ysym, safe=""), r, i))
            try:
                # Yahoo blocks long/spoofed UA strings; plain Mozilla/5.0 is the
                # combo that works from this machine.
                status, _, body = fetch_upstream(url, ua="Mozilla/5.0", timeout=8)
            except urllib.error.HTTPError as e:
                last = "yahoo HTTP %s (%s)" % (e.code, host)
                if e.code == 429:
                    time.sleep(1.5)
                    continue
                raise (NotFound(last) if e.code == 404 else ValueError(last))
            if status != 200:
                last = "yahoo HTTP %s (%s)" % (status, host)
                continue
            return json.loads(body.decode("utf-8")), ysym, r, i
        raise ValueError(last or "yahoo unavailable")

    def oa_stooq_sym(self, s):
        s = (s or "").strip()
        if not s:
            return "aapl.us"
        if s.startswith("^") or "-" in s or "." in s:
            return s.lower()
        return s.lower() + ".us"

    def oa_stooq_chart(self, symbol, rng="1M"):
        days = {"1D": 5, "5D": 8, "1M": 35, "6M": 190, "YTD": 400,
                "1Y": 380, "5Y": 1900, "MAX": 5000}.get(rng.upper(), 35)
        end = time.time()
        start = end - days * 86400
        f = lambda t: time.strftime("%Y-%m-%d", time.gmtime(t))
        url = ("https://stooq.com/q/d/l/?s=%s&d1=%s&d2=%s&i=d"
               % (urllib.parse.quote(self.oa_stooq_sym(symbol), safe=""), f(start), f(end)))
        status, _, body = fetch_upstream(url, timeout=6)   # stooq is often unreachable: fail fast
        if status != 200:
            raise ValueError("stooq HTTP %s" % status)
        lines = body.decode("utf-8").strip().split("\n")
        bars = []
        for ln in lines[1:]:
            c = ln.split(",")
            if len(c) < 6 or c[4] == "N/D":
                continue
            try:
                bars.append({"t": None, "d": c[0], "o": float(c[1]), "h": float(c[2]),
                             "l": float(c[3]), "c": float(c[4]),
                             "v": float(c[5]) if c[5] != "N/D" else None})
            except ValueError:
                continue
        if not bars:
            raise ValueError("stooq empty for %s" % symbol)
        return bars

    def oa_chart(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        symbol = (qs.get("symbol", ["AAPL"])[0] or "AAPL").strip()
        rng = (qs.get("range", ["1M"])[0] or "1M").strip()
        try:
            j, ysym, r, i = self.oa_yahoo_chart(symbol, rng)
            res = (j.get("chart") or {}).get("result") or []
            if not res:
                err = (j.get("chart") or {}).get("error") or {}
                return self.json_error(502, "yahoo: %s" % err.get("description", "no result"))
            r0 = res[0]
            ts = r0.get("timestamp") or []
            q = ((r0.get("indicators") or {}).get("quote") or [{}])[0]
            adj = ((r0.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose")
            bars = []
            for n, t in enumerate(ts):
                try:
                    bars.append({
                        "t": t,
                        "d": time.strftime("%Y-%m-%d", time.gmtime(t)),
                        "o": q.get("open", [None])[n], "h": q.get("high", [None])[n],
                        "l": q.get("low", [None])[n],
                        "c": (adj[n] if adj and n < len(adj) and adj[n] is not None
                              else q.get("close", [None])[n]),
                        "v": (q.get("volume", [None])[n] if n < len(q.get("volume", [])) else None),
                    })
                except IndexError:
                    continue
            meta = r0.get("meta") or {}
            return self.json_out({
                "symbol": symbol.upper(), "yahooSymbol": ysym, "range": r, "interval": i,
                "currency": meta.get("currency"), "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
                "regularMarketPrice": meta.get("regularMarketPrice"),
                "previousClose": meta.get("chartPreviousClose") or meta.get("previousClose"),
                "bars": bars,
                "_meta": {"source": "Yahoo Finance chart (same upstream as OpenAlice yfinance)",
                          "asOf": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                          "note": "date-level freshness; latest candle may be incomplete; ~15min delayed"},
            })
        except NotFound as e:
            return self.json_error(404, "unknown symbol: %s" % e)
        except Exception as e:                                    # noqa: BLE001
            try:
                bars = self.oa_stooq_chart(symbol, rng)
                last = bars[-1]
                return self.json_out({
                    "symbol": symbol.upper(), "yahooSymbol": self.oa_symbol(symbol),
                    "range": rng.upper(), "interval": "1d",
                    "currency": None, "exchange": None,
                    "regularMarketPrice": last["c"], "previousClose": bars[-2]["c"] if len(bars) > 1 else None,
                    "bars": bars,
                    "_meta": {"source": "Stooq (Yahoo rate-limited: %s)" % e,
                              "asOf": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                              "note": "fallback bars; delayed; latest candle may be incomplete"},
                })
            except Exception as e2:                             # noqa: BLE001
                return self.json_error(502, "chart error: %s; stooq fallback: %s" % (e, e2))

    def oa_quote(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        raw = (qs.get("symbols", [qs.get("symbol", ["AAPL"])[0]])[0] or "AAPL")
        out = []
        for s in [x.strip() for x in raw.split(",") if x.strip()][:20]:
            try:
                j, ysym, _, _ = self.oa_yahoo_chart(s, "1D", "5m")
                res = (j.get("chart") or {}).get("result") or [{}]
                meta = res[0].get("meta") or {}
                ts = res[0].get("timestamp") or []
                q = ((res[0].get("indicators") or {}).get("quote") or [{}])[0]
                closes = [c for c in (q.get("close") or []) if c is not None]
                price = meta.get("regularMarketPrice") or (closes[-1] if closes else None)
                prev = meta.get("chartPreviousClose") or meta.get("previousClose")
                out.append({"symbol": s.upper(), "yahooSymbol": ysym, "price": price,
                            "previousClose": prev, "currency": meta.get("currency"),
                            "marketTime": meta.get("regularMarketTime"),
                            "bars": len(ts)})
            except NotFound as e:
                out.append({"symbol": s.upper(), "error": "unknown symbol (%s)" % e})
            except Exception as e:                                # noqa: BLE001
                try:
                    url = ("https://stooq.com/q/l/?s=%s&f=sd2t2ohlcv&h&e=csv"
                           % urllib.parse.quote(self.oa_stooq_sym(s), safe=""))
                    st, _, body = fetch_upstream(url, timeout=6)
                    parts = body.decode("utf-8").strip().split("\n")
                    c = parts[1].split(",") if len(parts) > 1 else []
                    price = float(c[6]) if len(c) > 6 and c[6] != "N/D" else None
                    out.append({"symbol": s.upper(), "yahooSymbol": self.oa_symbol(s),
                                "price": price, "previousClose": None,
                                "currency": None, "marketTime": None, "bars": 0,
                                "_fallback": "stooq (yahoo: %s)" % e})
                except Exception as e2:                         # noqa: BLE001
                    out.append({"symbol": s.upper(), "error": "%s; stooq: %s" % (e, e2)})
        return self.json_out({
            "quotes": out,
            "_meta": {"source": "Yahoo Finance (same upstream as OpenAlice yfinance)",
                      "asOf": time.strftime("%Y-%m-%dT%H:%M:%S%z")},
        })

def main():
    ap = argparse.ArgumentParser(description="FinanceHub local server")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    os.chdir(ROOT)
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = "http://%s:%d/" % ("127.0.0.1" if args.host in ("0.0.0.0", "") else args.host, args.port)
    print("")
    print("  FinanceHub is running")
    print("  open  %s" % url)
    print("")
    print("  Quotes, history, crypto, FX and filings work even if you open")
    print("  index.html directly. This server adds the market-wide screener scan,")
    print("  Google News headlines, and web search/page reading for Marvell (/api/search, /api/read).")
    print("")
    print("  Ctrl+C to stop.")
    print("")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
