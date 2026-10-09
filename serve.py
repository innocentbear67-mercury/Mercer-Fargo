#!/usr/bin/env python3
"""
FinanceHub local server.

Serves index.html (and anything else in this folder), exposes a small same-origin
proxy so the page can reach market-data APIs that do not send CORS headers, and
bridges the page to Google Research's FinanceHarness deep-research agent running
locally with the user's own model key.

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

Why the research bridge exists: FinanceHarness is a Python agent that calls a model
from the server side. The page hands its question, provider, model and key to this
server, which runs `harness/fh_bridge.py` in the harness virtualenv and streams the
agent's events back. The key travels over loopback only, is never written to disk,
and is never logged.

Endpoints
    GET  /                        -> index.html
    GET  /proxy?url=<encoded>     -> forwards to an allow-listed host
    GET  /research/status         -> harness install/model status (JSON)
    GET  /research/runs           -> saved trajectories from .work/research
    GET  /research/run?id=<id>    -> one saved trajectory
    POST /research/setup          -> create the harness venv with uv (SSE log)
    POST /research/run            -> run a research question (SSE event stream)
    POST /research/cancel         -> stop a running research process

No third-party packages are used. Nothing is written to disk except research
trajectories, under .work/research/.
"""

import argparse
import gzip
import io
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
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
    # OpenCode Zen / Go — the AI gateway sends no CORS headers, so the browser
    # reaches it through this proxy. The caller's Authorization header is forwarded.
    "opencode.ai",
}

MAX_BYTES = 12 * 1024 * 1024

# --- FinanceHarness bridge ---------------------------------------------------

HARNESS_DIR = os.path.join(ROOT, "harness", "finance_harness")
HARNESS_PY = os.path.join(HARNESS_DIR, ".venv", "bin", "python")
BRIDGE = os.path.join(ROOT, "bridge", "fh_bridge.py")
RUNS_DIR = os.path.join(ROOT, ".work", "research")
RUN_TIMEOUT = 20 * 60          # hard cap per research run, seconds

_runs = {}                     # run_id -> Popen
_runs_lock = threading.Lock()


def find_uv():
    """Locate uv: PATH first, then the usual install locations."""
    found = shutil.which("uv")
    if found:
        return found
    for cand in ("~/.local/bin/uv", "/opt/homebrew/bin/uv", "/usr/local/bin/uv",
                 "~/.cargo/bin/uv"):
        path = os.path.expanduser(cand)
        if os.path.exists(path):
            return path
    return None


def harness_status():
    """What the page needs to know before offering a research run."""
    return {
        "installed": os.path.exists(HARNESS_PY),
        "bridge": os.path.exists(BRIDGE),
        "harnessDir": HARNESS_DIR,
        "python": HARNESS_PY if os.path.exists(HARNESS_PY) else None,
        "uv": find_uv(),
        "license": "CC BY-NC 4.0 (non-commercial use only)",
        "source": "https://github.com/google-research/google-research/tree/master/finance_harness",
        "runsDir": RUNS_DIR,
        "modes": ["auto", "research", "analytical"],
    }


def sse_pack(obj):
    """One SSE frame: JSON on a single data line."""
    return ("data: " + json.dumps(obj, ensure_ascii=False) + "\n\n").encode("utf-8")


class Run:
    """Bookkeeping for one child process, so /research/cancel can reach it."""

    def __init__(self, run_id, proc):
        self.id = run_id
        self.proc = proc
        self.started = time.time()


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
        if path == "/research/status":
            return self.json_out(harness_status())
        if path == "/research/runs":
            return self.json_out({"runs": self.list_runs()})
        if path == "/research/run":
            return self.get_run()
        if self.path in ("/", ""):
            self.path = "/index.html"
        return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/research/run":
            return self.research_run()
        if path == "/research/setup":
            return self.research_setup()
        if path == "/research/cancel":
            return self.research_cancel()
        if not self.path.startswith("/proxy"):
            return self.json_error(405, "POST is only supported on /proxy and /research/*")
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

    # --- sse helpers --------------------------------------------------------

    def sse_open(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "close")
        self.cors()
        self.end_headers()
        self.close_connection = True
        self._sse_lock = threading.Lock()
        self._client_gone = False

    def sse_send(self, obj):
        """Write one frame; a dead client flips the flag so we can stop the child."""
        with self._sse_lock:
            if self._client_gone:
                return False
            try:
                self.wfile.write(sse_pack(obj))
                self.wfile.flush()
                return True
            except (BrokenPipeError, ConnectionResetError, OSError):
                self._client_gone = True
                return False

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
                status, _, body = fetch_upstream(url, ua="Mozilla/5.0", timeout=20)
            except urllib.error.HTTPError as e:
                last = "yahoo HTTP %s (%s)" % (e.code, host)
                if e.code == 429:
                    time.sleep(1.5)
                    continue
                raise ValueError(last)
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
        status, _, body = fetch_upstream(url)
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
            except Exception as e:                                # noqa: BLE001
                try:
                    url = ("https://stooq.com/q/l/?s=%s&f=sd2t2ohlcv&h&e=csv"
                           % urllib.parse.quote(self.oa_stooq_sym(s), safe=""))
                    st, _, body = fetch_upstream(url)
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

    # --- research -----------------------------------------------------------

    def list_runs(self):
        out = []
        if not os.path.isdir(RUNS_DIR):
            return out
        for name in sorted(os.listdir(RUNS_DIR), reverse=True):
            if not name.endswith(".json"):
                continue
            path = os.path.join(RUNS_DIR, name)
            try:
                stat = os.stat(path)
            except OSError:
                continue
            meta = {"id": name[:-5], "bytes": stat.st_size, "mtime": int(stat.st_mtime)}
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    head = json.load(fh)
                meta["question"] = (head.get("question") or "")[:300]
                meta["model"] = head.get("model")
                meta["mode"] = head.get("mode")
                meta["rounds"] = head.get("rounds")
                meta["termination"] = head.get("termination")
                meta["citations"] = len(head.get("citations") or [])
                meta["elapsed"] = head.get("elapsed_s")
            except Exception:                                      # noqa: BLE001
                pass
            out.append(meta)
        return out

    def get_run(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        run_id = (qs.get("id", [""])[0] or "").strip()
        if not run_id or "/" in run_id or "\\" in run_id or run_id.startswith("."):
            return self.json_error(400, "bad id")
        path = os.path.join(RUNS_DIR, run_id + ".json")
        if not os.path.exists(path):
            return self.json_error(404, "no such run")
        with open(path, "r", encoding="utf-8") as fh:
            return self.json_out(json.load(fh))

    def research_cancel(self):
        run_id = (self.read_json_body().get("runId") or "").strip()
        with _runs_lock:
            targets = [_runs[run_id]] if run_id in _runs else list(_runs.values())
        killed = []
        for run in targets:
            if run.proc.poll() is None:
                run.proc.kill()
                killed.append(run.id)
        return self.json_out({"cancelled": killed})

    def research_setup(self):
        """First-run install: `uv sync` inside the harness folder, streamed."""
        self.sse_open()
        uv = find_uv()
        if not uv:
            self.sse_send({"type": "log", "text": "uv was not found on this machine."})
            self.sse_send({"type": "error", "error":
                           "Install uv first (https://docs.astral.sh/uv/) — it also "
                           "fetches the Python 3.12 the harness needs."})
            self.sse_send({"type": "exit", "code": 1})
            return
        self.sse_send({"type": "log", "text": "uv: %s" % uv})
        self.sse_send({"type": "log", "text": "syncing %s" % HARNESS_DIR})
        env = dict(os.environ, PYTHONUNBUFFERED="1", NO_COLOR="1")
        try:
            proc = subprocess.Popen([uv, "sync"], cwd=HARNESS_DIR, env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, bufsize=1)
        except OSError as exc:
            self.sse_send({"type": "error", "error": "could not start uv: %s" % exc})
            self.sse_send({"type": "exit", "code": 1})
            return
        with _runs_lock:
            _runs["setup"] = Run("setup", proc)
        for line in proc.stdout:
            if not self.sse_send({"type": "log", "text": line.rstrip()}):
                proc.kill()
                break
        proc.wait()
        with _runs_lock:
            _runs.pop("setup", None)
        self.sse_send({"type": "status", "status": harness_status()})
        self.sse_send({"type": "exit", "code": proc.returncode})

    def research_run(self):
        """Run one question through the harness, streaming its events."""
        self.sse_open()
        if not os.path.exists(HARNESS_PY) or not os.path.exists(BRIDGE):
            self.sse_send({"type": "error", "error":
                           "The harness is not installed yet. Run the setup step first."})
            self.sse_send({"type": "exit", "code": 1})
            return
        req = self.read_json_body()
        if not (req.get("question") or "").strip():
            self.sse_send({"type": "error", "error": "A question is required."})
            self.sse_send({"type": "exit", "code": 2})
            return

        run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
        os.makedirs(RUNS_DIR, exist_ok=True)
        req["savePath"] = os.path.join(RUNS_DIR, run_id + ".json")
        req["runId"] = run_id

        env = dict(os.environ)
        env["PYTHONUNBUFFERED"] = "1"
        env["NO_COLOR"] = "1"
        env.pop("PYTHONPATH", None)
        try:
            proc = subprocess.Popen(
                [HARNESS_PY, BRIDGE],
                cwd=ROOT, env=env, text=True, bufsize=1,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
        except OSError as exc:
            self.sse_send({"type": "error", "error": "could not start the harness: %s" % exc})
            self.sse_send({"type": "exit", "code": 1})
            return

        run = Run(run_id, proc)
        with _runs_lock:
            _runs[run_id] = run
        self.sse_send({"type": "run", "runId": run_id, "savePath": req["savePath"]})

        def drain_stderr():
            """Harness progress notes ("→ tool", "ok") stay visible in the log."""
            try:
                for line in proc.stderr:
                    text = line.rstrip()
                    if not text:
                        continue
                    if not self.sse_send({"type": "log", "stream": "stderr", "text": text}):
                        break
            except Exception:                                      # noqa: BLE001
                pass

        err_thread = threading.Thread(target=drain_stderr, daemon=True)
        err_thread.start()

        try:
            proc.stdin.write(json.dumps(req, ensure_ascii=False))
            proc.stdin.close()
        except (BrokenPipeError, OSError):
            pass

        deadline = time.time() + RUN_TIMEOUT
        try:
            for line in proc.stdout:
                if time.time() > deadline:
                    proc.kill()
                    self.sse_send({"type": "error", "error": "run exceeded the time limit"})
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    obj = {"type": "log", "text": line}
                if not self.sse_send(obj):
                    proc.kill()
                    break
        except Exception as exc:                                   # noqa: BLE001
            self.sse_send({"type": "error", "error": "stream failed: %s" % exc})
            proc.kill()
        proc.wait()
        err_thread.join(timeout=2)
        with _runs_lock:
            _runs.pop(run_id, None)
        self.sse_send({"type": "exit", "code": proc.returncode, "runId": run_id})


def main():
    ap = argparse.ArgumentParser(description="FinanceHub local server")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    os.chdir(ROOT)
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = "http://%s:%d/" % ("127.0.0.1" if args.host in ("0.0.0.0", "") else args.host, args.port)
    status = harness_status()
    print("")
    print("  FinanceHub is running")
    print("  open  %s" % url)
    print("")
    print("  Quotes, history, crypto, FX and filings work even if you open")
    print("  index.html directly. This server adds three things:")
    print("    · the market-wide screener scan and Google News headlines (via /proxy)")
    print("    · the FinanceHarness deep-research bridge (/research/*)")
    print("  FinanceHarness: %s" % ("ready" if status["installed"]
                                    else "not installed yet — open Research to set it up"))
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
