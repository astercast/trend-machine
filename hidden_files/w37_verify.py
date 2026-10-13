#!/usr/bin/env python3
"""Wave 37 headless verification: dashboard phase filter + URL state.
Checks-only pass (screenshots were captured by the earlier runs and
are already in the rotation-016 archive). Design for this loaded VM:
ONE browser, ONE page reused sequentially, container-safe flags,
and a single relaunch-and-continue if the browser dies mid-run —
earlier attempts failed on (a) a wait that could never be satisfied
by the honest 0-row view and (b) per-case fresh browsers competing
with the fleet's own Chromium load until the VM starved."""
import json, os, subprocess, sys, threading, time
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

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("  ok: " if cond else "  FAIL: ") + name + ((" — " + str(detail)) if (detail and not cond) else ""), flush=True)

fc = json.load(open(os.path.join(ROOT, "data/v1/forecasts.json")))
counts = fc["counts"]
expect = {"peaking": counts["peaking_48h"], "rising": counts["rising_fast"],
          "fading": counts["cooling_off"], "steady": counts["steady"],
          "nocall": counts["insufficient"]}
print("payload phase counts:", expect, flush=True)

serve_q(ROOT, 3177)

from playwright.sync_api import sync_playwright

ROWS = "document.querySelectorAll('#dtable-body tr').length"
META = "document.getElementById('table-meta').textContent"
BASE = "http://127.0.0.1:3177/index.html"

def run_cases(p, browser_holder):
    def new_browser():
        browser_holder["b"] = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        browser_holder["page"] = browser_holder["b"].new_page(viewport={"width": 1440, "height": 900})
        browser_holder["errors"] = []
        pg = browser_holder["page"]
        pg.on("console", lambda m: browser_holder["errors"].append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: browser_holder["errors"].append(str(e)))
    new_browser()

    def goto(url, expect_rows=None):
        pg = browser_holder["page"]
        browser_holder["errors"] = []
        pg.on("console", lambda m: browser_holder["errors"].append(m.text) if m.type == "error" else None)
        pg.goto(url)
        pg.wait_for_function(
            "document.getElementById('f-phase') && !document.getElementById('f-phase').disabled",
            timeout=30000)
        if expect_rows is not None:
            pg.wait_for_function(
                f"document.getElementById('table-meta').textContent.startsWith('{expect_rows} of ')",
                timeout=30000)
        else:
            pg.wait_for_function(f"{ROWS} > 0", timeout=30000)
        return pg

    steps = []

    def step_plain():
        pg = goto(BASE)
        check("plain board rows == 393", pg.evaluate(ROWS) == 393, pg.evaluate(ROWS))
        check("plain board meta", pg.evaluate(META).startswith("393 of 393"), pg.evaluate(META))
        opts = pg.evaluate("Array.from(document.getElementById('f-phase').options).map(o => o.textContent)")
        check("phase options carry payload counts",
              opts == ["all phases", f"peaking in 48h ({expect['peaking']})", f"rising fast ({expect['rising']})",
                       f"cooling off ({expect['fading']})", f"steady ({expect['steady']})",
                       f"no call yet ({expect['nocall']})"], opts)
        check("plain board URL stays clean", "?" not in pg.url, pg.url)
        check("plain board zero console/page errors", browser_holder["errors"] == [], browser_holder["errors"])
    steps.append(("plain", step_plain))

    def step_interact():
        pg = goto(BASE)
        pg.select_option("#f-phase", "steady")
        pg.wait_for_function(f"{ROWS} === {expect['steady']}")
        check("select steady -> rows match payload", pg.evaluate(ROWS) == expect["steady"])
        check("select steady -> URL gains ?phase=steady", pg.url.endswith("?phase=steady"), pg.url)
        pg.select_option("#f-phase", "all")
        pg.wait_for_function(f"{ROWS} === 393")
        check("select all -> URL clean again", "?" not in pg.url, pg.url)
    steps.append(("interact", step_interact))

    for phase, n in expect.items():
        def make(ph, n):
            def s():
                pg = goto(f"{BASE}?phase={ph}", expect_rows=n)
                check(f"?phase={ph} rows == {n}", pg.evaluate(ROWS) == n, pg.evaluate(ROWS))
                check(f"?phase={ph} select restored", pg.evaluate("document.getElementById('f-phase').value") == ph)
                check(f"?phase={ph} zero errors", browser_holder["errors"] == [], browser_holder["errors"])
                if ph == "peaking":
                    title = pg.evaluate("document.querySelector('#dtable-body tr .topic-link').textContent")
                    check("peaking row is the payload's peaking topic",
                          title.startswith("Epic Games Delays Disney Project"), title)
            return s
        steps.append((f"phase-{phase}", make(phase, n)))

    def step_bogus():
        pg = goto(f"{BASE}?phase=bogus")
        check("?phase=bogus -> plain board (393 rows)", pg.evaluate(ROWS) == 393, pg.evaluate(ROWS))
        check("?phase=bogus -> select shows all", pg.evaluate("document.getElementById('f-phase').value") == "all")
    steps.append(("bogus", step_bogus))

    def step_combo():
        pg = goto(f"{BASE}?phase=steady&sort=velocity", expect_rows=expect["steady"])
        check("?phase=steady&sort=velocity rows == steady count", pg.evaluate(ROWS) == expect["steady"], pg.evaluate(ROWS))
    steps.append(("combo", step_combo))

    for name, fn in steps:
        try:
            fn()
        except Exception as e:
            check(name + " (first attempt)", False, repr(e)[:160])
            print("  .. browser relaunch and one improved retry of this case", flush=True)
            try:
                browser_holder["b"].close()
            except Exception:
                pass
            time.sleep(3)
            new_browser()
            try:
                fn()
            except Exception as e2:
                check(name + " (retry)", False, repr(e2)[:160])
        time.sleep(1)
    try:
        browser_holder["b"].close()
    except Exception:
        pass

with sync_playwright() as p:
    run_cases(p, {})

fails = [r for r in results if not r[1]]
print(f"w37 verify: {len(results) - len(fails)}/{len(results)} pass")
sys.exit(1 if fails else 0)
