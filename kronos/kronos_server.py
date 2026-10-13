"""Marvell Predict: a local Kronos forecasting server.

Runs on the user's own machine. The MercerFargo site sends it recent OHLCV bars,
it answers with sampled forecast paths from Kronos (NeoQuasar/Kronos-base).

    python kronos_server.py            # http://127.0.0.1:8793
    python kronos_server.py --check    # load the model, run one forecast, exit

Only binds to 127.0.0.1, and only answers the MercerFargo site and local dev
origins (add more with MARVELL_ORIGINS="https://a.com,https://b.com").
"""
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOME = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HOME, "Kronos"))   # the Kronos repo's `model` package lives here

PORT = int(os.environ.get("KRONOS_PORT", "8793"))
MODEL_ID = os.environ.get("KRONOS_MODEL", "NeoQuasar/Kronos-base")
TOKENIZER_ID = os.environ.get("KRONOS_TOKENIZER", "NeoQuasar/Kronos-Tokenizer-base")
VERSION = "4"
ORIGINS = ["https://innocentbear67-mercury.github.io"] + [
    o.strip() for o in os.environ.get("MARVELL_ORIGINS", "").split(",") if o.strip()]
LOCAL_ORIGIN = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$")

MAX_BARS, MAX_PRED, MAX_SAMPLES = 2000, 120, 32
# Candles Kronos reads. Kronos normalizes over its window, so a long window on a trending daily chart puts the
# last price far from the mean and the forecast snaps back toward it. Backtest (6 tickers x 5 dates, 20-day
# horizon, Oct 2026): 48 -> error 0.084, no bias; 160 -> 0.134; 400 -> 0.210 with a -3% average pull.
CONTEXT = 48

STATE = {"predictor": None, "device": None, "error": None, "loading": False}
LOAD_LOCK, RUN_LOCK = threading.Lock(), threading.Lock()   # ponytail: one forecast at a time; a local model has one user


def load_model():
    with LOAD_LOCK:
        if STATE["predictor"] is not None:
            return STATE["predictor"]
        STATE["loading"] = True
        try:
            from model import Kronos, KronosTokenizer, KronosPredictor
            tok = KronosTokenizer.from_pretrained(TOKENIZER_ID).eval()   # from_pretrained leaves training mode (dropout) on
            mdl = Kronos.from_pretrained(MODEL_ID).eval()
            STATE["predictor"] = KronosPredictor(mdl, tok, max_context=512)   # picks cuda, then mps, then cpu
            STATE["device"] = STATE["predictor"].device
            STATE["error"] = None
            return STATE["predictor"]
        except Exception as e:   # noqa: BLE001 - reported to the site so the user sees why
            STATE["error"] = "%s: %s" % (type(e).__name__, e)
            raise
        finally:
            STATE["loading"] = False


def yahoo_bars(symbol, interval):
    """Raw exchange candles. Not adjusted for dividends: Yahoo's adjclose next to unadjusted
    open/high/low puts most closes outside their own high-low range, and Kronos learns that as a trend."""
    if not re.match(r"^[A-Za-z0-9.^=-]{1,20}$", symbol or ""):
        raise ValueError("bad symbol")
    rng = {"1d": "2y", "60m": "6mo"}.get(interval)
    if not rng:
        raise ValueError("interval must be 1d or 60m")
    last = None
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        url = "https://%s/v8/finance/chart/%s?range=%s&interval=%s" % (host, urllib.parse.quote(symbol), rng, interval)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=15) as r:
                j = json.load(r)
            res = ((j.get("chart") or {}).get("result") or [None])[0]
            if not res:
                raise ValueError("no data for %s" % symbol)
            q = ((res.get("indicators") or {}).get("quote") or [{}])[0]
            bars = [{"t": t, "o": o, "h": h, "l": l, "c": c, "v": v or 0}
                    for t, o, h, l, c, v in zip(res.get("timestamp") or [], q.get("open") or [], q.get("high") or [],
                                                q.get("low") or [], q.get("close") or [], q.get("volume") or [])
                    if None not in (o, h, l, c)]
            return bars, (res.get("meta") or {}).get("currency")
        except ValueError:
            raise
        except Exception as e:   # noqa: BLE001 - try the other host
            last = e
    raise ValueError("could not reach Yahoo Finance (%s)" % last)


def _frame(bars, freq):
    import pandas as pd
    rows = []
    for b in bars:
        o, h, l, c = (float(b[k]) for k in ("o", "h", "l", "c"))
        rows.append({"t": int(b["t"]), "open": o, "high": max(h, o, c), "low": min(l, o, c), "close": c, "volume": float(b.get("v") or 0)})
    df = pd.DataFrame(rows)
    ts = pd.Series(pd.to_datetime(df["t"], unit="s"))
    if freq != "H":
        # Daily bars carry the session's open time (13:30 UTC for NYSE); Kronos reads hour/minute as features,
        # so history and future must agree, or the forecast sees a time jump at the boundary and drifts.
        ts = ts.dt.normalize()
    return df[["open", "high", "low", "close", "volume"]], ts


def track_record(predictor, allbars, ctx, pred_len, freq, k, T, top_p):
    """Kronos re-run on the last k non-overlapping windows of this ticker, scored against what happened.
    One batch, 2 samples averaged per window (4 doubled the wait for little change). This is the honest part of 'confidence'."""
    import math
    k = min(k, (len(allbars) - ctx) // pred_len)
    if k < 3:
        return None
    dfs, xts, yts, wins = [], [], [], []
    for i in range(1, k + 1):
        end = len(allbars) - pred_len * i
        x_df, x_ts = _frame(allbars[end - ctx:end], freq)
        _, y_ts = _frame(allbars[end:end + pred_len], freq)
        dfs.append(x_df); xts.append(x_ts); yts.append(y_ts)
        wins.append((float(allbars[end - 1]["c"]), float(allbars[end + pred_len - 1]["c"])))
    import torch
    torch.manual_seed(0)   # same data -> same score, so the rating doesn't flicker when the user re-runs
    outs = predictor.predict_batch(df_list=dfs, x_timestamp_list=xts, y_timestamp_list=yts,
                                   pred_len=pred_len, T=T, top_p=top_p, sample_count=2, verbose=False)
    hit = beat = 0
    em = ef = 0.0
    for (last, actual), out in zip(wins, outs):
        pred = float(out["close"].iloc[-1])
        hit += (pred - last) * (actual - last) > 0
        e_model, e_flat = abs(math.log(actual / pred)), abs(math.log(actual / last))
        beat += e_model < e_flat
        em += e_model; ef += e_flat
    return {"n": k, "hit": hit, "beat": beat, "err_model": round(em / k, 5), "err_flat": round(ef / k, 5)}


def forecast(req):
    import pandas as pd

    bars, currency = req.get("bars") or [], None
    if req.get("symbol"):
        bars, currency = yahoo_bars(str(req["symbol"]), "60m" if req.get("freq") == "H" else "1d")
    if not isinstance(bars, list) or len(bars) < 32:
        raise ValueError("need at least 32 bars of history")
    allbars = bars[-MAX_BARS:]
    shown = allbars[-200:]   # the chart's history, independent of how much the model reads
    ctx = max(32, min(512, int(req.get("context", CONTEXT))))
    bars = allbars[-ctx:]
    pred_len = max(1, min(MAX_PRED, int(req.get("pred_len", 20))))
    samples = max(1, min(MAX_SAMPLES, int(req.get("samples", 8))))
    T = max(0.1, min(2.0, float(req.get("T", 1.0))))
    top_p = max(0.1, min(1.0, float(req.get("top_p", 0.9))))
    freq = str(req.get("freq", "B"))   # B = trading days, D = every day (crypto), H = hours
    backtest = max(0, min(12, int(req.get("backtest", 0))))

    x_df, x_ts = _frame(bars, freq)
    last = x_ts.iloc[-1]
    if freq == "H":
        step = pd.Timedelta(seconds=max(60, int(req.get("interval_sec", 3600))))
        y_ts = pd.Series([last + step * (i + 1) for i in range(pred_len)])
    elif freq == "D":
        y_ts = pd.Series(pd.date_range(last + pd.Timedelta(days=1), periods=pred_len, freq="D"))
    else:
        y_ts = pd.Series(pd.bdate_range(last + pd.Timedelta(days=1), periods=pred_len))

    predictor = load_model()
    t0 = time.time()
    with RUN_LOCK:
        # N copies in one batch = N independent sampled paths (predict() would average them away).
        outs = predictor.predict_batch(
            df_list=[x_df] * samples, x_timestamp_list=[x_ts] * samples, y_timestamp_list=[y_ts] * samples,
            pred_len=pred_len, T=T, top_p=top_p, sample_count=1, verbose=False)
        record = track_record(predictor, allbars, len(bars), pred_len, freq, backtest, T, top_p) if backtest else None
    paths = [[{"o": float(r.open), "h": float(r.high), "l": float(r.low), "c": float(r.close), "v": float(r.volume)}
              for r in out.itertuples()] for out in outs]
    return {"t": [int(ts.timestamp()) for ts in y_ts], "paths": paths, "model": MODEL_ID, "currency": currency,
            "history": [{"t": int(b["t"]), "c": float(b["c"])} for b in shown], "track": record,
            "device": str(STATE["device"]), "seconds": round(time.time() - t0, 2), "context": len(bars)}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("[kronos] " + (fmt % args) + "\n")

    def origin_ok(self):
        o = self.headers.get("Origin")
        return o is None or o in ORIGINS or bool(LOCAL_ORIGIN.match(o))

    def send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        o = self.headers.get("Origin")
        if o and self.origin_ok():
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self.origin_ok():
            return self.send(403, {"error": "origin not allowed"})
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin") or "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")   # Chrome: public https page -> localhost
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self):
        if not self.origin_ok():
            return self.send(403, {"error": "origin not allowed"})
        if self.path.startswith("/health"):
            return self.send(200, {"ok": True, "version": VERSION, "model": MODEL_ID,
                                   "ready": STATE["predictor"] is not None, "loading": STATE["loading"],
                                   "device": str(STATE["device"]) if STATE["device"] else None, "error": STATE["error"]})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        if not self.origin_ok():
            return self.send(403, {"error": "origin not allowed"})
        if not self.path.startswith("/predict"):
            return self.send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if n > 2_000_000:
            return self.send(413, {"error": "request too large"})
        try:
            req = json.loads(self.rfile.read(n) or b"{}")
            return self.send(200, forecast(req))
        except (ValueError, KeyError, TypeError) as e:
            return self.send(400, {"error": str(e)})
        except Exception as e:   # noqa: BLE001
            return self.send(500, {"error": "%s: %s" % (type(e).__name__, e)})


def self_check():
    import math
    bars, p = [], 100.0
    for i in range(300):
        p *= 1 + 0.01 * math.sin(i / 7)
        bars.append({"t": 1700000000 + i * 86400, "o": p, "h": p * 1.01, "l": p * 0.99, "c": p, "v": 1e6})
    out = forecast({"bars": bars, "pred_len": 5, "samples": 2, "backtest": 4})
    assert len(out["paths"]) == 2 and len(out["paths"][0]) == 5 and len(out["t"]) == 5, out
    tr = out["track"]
    assert tr and tr["n"] == 4 and 0 <= tr["hit"] <= 4 and 0 <= tr["beat"] <= 4, tr
    assert all(math.isfinite(b["c"]) and b["c"] > 0 for path in out["paths"] for b in path), out
    print("Kronos OK on %s: 2 paths x 5 bars in %ss" % (out["device"], out["seconds"]))


def ensure_waker():
    """Register marvell-predict://start so the site's Start button can wake this server with one click (no terminal).
    Idempotent; runs on every launch so installs made before this existed pick it up the first time they start."""
    import subprocess
    home = os.path.dirname(os.path.abspath(__file__))
    base = os.environ.get("MARVELL_BASE", "https://innocentbear67-mercury.github.io/Mercer-Fargo")
    def put(path, text, mode=0o755):
        if os.path.exists(path) and open(path).read() == text:
            return False
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(text)
        os.chmod(path, mode)
        return True
    try:
        if sys.platform == "win32":
            import winreg
            bat = os.path.join(home, "wake.bat")
            put(bat, '@echo off\r\ncd /d "%s"\r\npowershell -NoProfile -Command "try { Invoke-WebRequest \'%s/kronos/kronos_server.py\' -OutFile kronos_server.py.new -UseBasicParsing; Move-Item -Force kronos_server.py.new kronos_server.py } catch { }"\r\nvenv\\Scripts\\pythonw.exe kronos_server.py\r\n' % (home, base))
            vbs = os.path.join(home, "wake.vbs")
            put(vbs, 'CreateObject("WScript.Shell").Run "cmd /c ""%s""", 0, False\r\n' % bat)
            k = winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\marvell-predict")
            winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "URL:Marvell Predict")
            winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
            winreg.SetValue(k, r"shell\open\command", winreg.REG_SZ, 'wscript.exe "%s"' % vbs)
            return
        wake = '#!/bin/bash\ncurl -fs -m 1 http://127.0.0.1:%d/health >/dev/null 2>&1 && exit 0\ncd "%s" || exit 1\nnohup ./start.sh >> server.log 2>&1 &\n' % (PORT, home)
        if sys.platform == "darwin":
            app = os.path.join(home, "Marvell Predict.app", "Contents")
            plist = ('<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.marvell.predict</string>'
                     '<key>CFBundleName</key><string>Marvell Predict</string><key>CFBundleExecutable</key><string>wake</string><key>CFBundlePackageType</key><string>APPL</string>'
                     '<key>LSUIElement</key><true/><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>Marvell Predict</string>'
                     '<key>CFBundleURLSchemes</key><array><string>marvell-predict</string></array></dict></array></dict></plist>\n')
            changed = put(os.path.join(app, "MacOS", "wake"), wake) | put(os.path.join(app, "Info.plist"), plist, 0o644)
            if changed:
                subprocess.run(["codesign", "-s", "-", "--force", os.path.dirname(app)], capture_output=True)
                subprocess.run(["/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", "-f", os.path.dirname(app)], capture_output=True)
        else:
            sh = os.path.join(home, "wake.sh")
            put(sh, wake)
            desk = os.path.expanduser("~/.local/share/applications/marvell-predict.desktop")
            if put(desk, "[Desktop Entry]\nType=Application\nName=Marvell Predict\nExec=%s %%u\nNoDisplay=true\nMimeType=x-scheme-handler/marvell-predict;\n" % sh, 0o644):
                subprocess.run(["xdg-mime", "default", "marvell-predict.desktop", "x-scheme-handler/marvell-predict"], capture_output=True)
    except Exception as e:   # noqa: BLE001 - the Start button is a convenience; the Desktop launcher still works
        print("One-click start not registered: %s" % e)


if __name__ == "__main__":
    if "--check" in sys.argv:
        self_check()
        sys.exit(0)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Marvell Predict (Kronos) listening on http://127.0.0.1:%d — keep this window open." % PORT)
    def warm():
        try:
            load_model()
            print("Model ready on %s." % STATE["device"])
        except Exception:   # noqa: BLE001 - kept in STATE["error"], shown on the site
            print("Model failed to load: %s" % STATE["error"])
    threading.Thread(target=warm, daemon=True).start()   # warm the model in the background
    ensure_waker()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
