#!/usr/bin/env python3
"""Restore the working state from the live site before a build.

The deployed site is the database. Each build starts from a clean checkout, so
this pulls the last published store and history from /data/v1/state/ and uses
them if they are valid and newer than the copy in the repo. If the live site is
unreachable or the files look wrong, the repo copy stays: nothing is lost, the
board just continues from the seed.
Usage: python3 pipeline/restore_state.py   (env LIVE_BASE overrides the site)
"""
import datetime, json, os, sys, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BASE = os.environ.get("LIVE_BASE", "https://trend-machine-live.vercel.app").rstrip("/")
UA = "trend-machine-build/1.0 (+state restore; contact via repo issues)"
# published name -> working path
FILES = {
    "trends.json": "data/trends.json",
    "velocity_history.json": "data/velocity_history.json",
    "velocity_archive.json": "data/velocity_archive.json",
    "platform_velocity_history.json": "data/platform_velocity_history.json",
    "lane_health.json": "data/lane_health.json",
}

def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))

def ts(x):
    t = datetime.datetime.fromisoformat(x)
    return t if t.tzinfo else t.replace(tzinfo=datetime.timezone.utc)

def acceptable(name, new, old):
    if name == "trends.json":
        if not isinstance(new, dict) or len(new.get("topics", [])) < 150:
            return False, "fewer than 150 topics"
        if old and ts(new["generated_at"]) <= ts(old["generated_at"]):
            return False, "not newer than the repo copy"
        return True, "ok"
    if not isinstance(new, dict) or not new:
        return False, "empty"
    if old and isinstance(old, dict) and len(new) < 0.5 * len(old):
        return False, "less than half the series of the repo copy"
    return True, "ok"

def main():
    got = 0
    for name, rel in FILES.items():
        path = os.path.join(ROOT, rel)
        old = None
        try:
            with open(path) as f: old = json.load(f)
        except Exception:
            pass
        try:
            new = fetch_json(f"{BASE}/data/v1/state/{name}")
        except Exception as e:
            print(f"[restore] {name}: keep repo copy ({type(e).__name__}: {e})")
            continue
        ok, why = acceptable(name, new, old)
        if not ok:
            print(f"[restore] {name}: keep repo copy ({why})")
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f: json.dump(new, f, ensure_ascii=False)
        got += 1
        print(f"[restore] {name}: restored from the live site")
    print(f"[restore] {got}/{len(FILES)} files restored")

if __name__ == "__main__":
    main()
