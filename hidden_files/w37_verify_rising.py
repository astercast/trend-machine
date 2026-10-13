#!/usr/bin/env python3
"""Wave 37 — the one case the loaded VM kept eating: ?phase=rising
(the honest 0-row view). Minimal footprint: waits for memory headroom,
single-process Chromium, reduced motion, image/font requests aborted,
small viewport, one page, one assertion set."""
import json, os, sys, threading, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial

ROOT = os.path.expanduser("~/workspace/trend-machine")

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve_q(directory, port):
    handler = partial(Quiet, directory=directory)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

def avail_mb():
    for line in open("/proc/meminfo"):
        if line.startswith("MemAvailable"):
            return int(line.split()[1]) // 1024
    return 0

# wait for headroom in short sleeps (fleet contention is spiky)
deadline = time.time() + 240
while avail_mb() < 1500 and time.time() < deadline:
    time.sleep(10)
print(f"MemAvailable at launch: {avail_mb()} MB", flush=True)

serve_q(ROOT, 3179)
from playwright.sync_api import sync_playwright

ok = True
with sync_playwright() as p:
    browser = p.chromium.launch(args=[
        "--no-sandbox", "--disable-dev-shm-usage", "--single-process",
        "--disable-gpu", "--js-flags=--max-old-space-size=256"])
    page = browser.new_page(viewport={"width": 800, "height": 600},
                            reduced_motion="reduce")
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ico}",
               lambda r: r.abort())
    page.goto("http://127.0.0.1:3179/index.html?phase=rising")
    page.wait_for_function(
        "document.getElementById('f-phase') && !document.getElementById('f-phase').disabled",
        timeout=30000)
    page.wait_for_function(
        "document.getElementById('table-meta').textContent.startsWith('0 of ')",
        timeout=30000)
    rows = page.evaluate("document.querySelectorAll('#dtable-body tr').length")
    meta = page.evaluate("document.getElementById('table-meta').textContent")
    sel = page.evaluate("document.getElementById('f-phase').value")
    opt = page.evaluate("document.querySelector('#f-phase option[value=rising]').textContent")
    for name, cond, detail in [
        ("?phase=rising rows == 0 (honest empty view)", rows == 0, rows),
        ("?phase=rising meta reads '0 of 393 topics'", meta.startswith("0 of 393"), meta),
        ("?phase=rising select restored", sel == "rising", sel),
        ("rising option carries the honest (0) count", opt == "rising fast (0)", opt),
        ("?phase=rising zero console/page errors", errors == [], errors),
    ]:
        print(("  ok: " if cond else "  FAIL: ") + name + ("" if cond else f" — {detail}"), flush=True)
        ok = ok and cond
    browser.close()
print("w37 rising verify:", "pass" if ok else "FAIL")
sys.exit(0 if ok else 1)
