"""python3 scripts/test_proxy_slow.py [seconds]
Deep Research sends one model call per round and a reasoning model sends nothing until it has finished thinking.
This starts a fake model that waits `seconds` (default 30) before answering and calls it through serve.py's real /proxy
handler: it must come back with the answer, not "upstream error: timed out"."""
import http.server, json, os, sys, threading, time, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import serve

delay = float(sys.argv[1]) if len(sys.argv) > 1 else 30

class Slow(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        time.sleep(delay)
        body = json.dumps({"choices": [{"message": {"content": "done"}}]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass

up = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Slow); threading.Thread(target=up.serve_forever, daemon=True).start()
serve.ALLOWED_HOSTS.add("127.0.0.1")
mine = serve.ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler); threading.Thread(target=mine.serve_forever, daemon=True).start()
url = "http://127.0.0.1:%d/proxy?url=%s" % (mine.server_address[1], urllib.parse.quote("http://127.0.0.1:%d/x" % up.server_address[1]))
t0 = time.time()
try:
    r = urllib.request.urlopen(urllib.request.Request(url, data=b"{}", headers={"Content-Type": "application/json"}), timeout=delay + 60)
    out = json.loads(r.read())
    ok = out.get("choices", [{}])[0].get("message", {}).get("content") == "done"
    print("%s: model took %.0fs, proxy returned %s" % ("PASS" if ok else "FAIL", time.time() - t0, r.status)); sys.exit(0 if ok else 1)
except urllib.error.HTTPError as e:
    print("FAIL: model took %.0fs, proxy returned %s %s" % (time.time() - t0, e.code, e.read()[:120])); sys.exit(1)
