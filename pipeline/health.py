#!/usr/bin/env python3
"""Lane health, the freshness record, and the build gate.

Run after the fetchers and normalize.py:
    python3 pipeline/health.py --run-start 2026-10-24T12:00:00Z [--gate]

Writes
  data/lane_health.json            per lane: lastGoodAt, misses (in a row), recent results
  data/v1/freshness.json           what the site shows as its proof of freshness
  data/v1/state/*.json             the working state, published so the next build can restore it
With --gate it exits 1 (the build fails, the previous deploy stays live) if the new board
would be worse than useless: too few topics, too few lanes alive, or no new data at all.

A lane is only "live" if it produced hits during THIS run. A lane that did not is
degraded for the first few misses and dead after DEAD_AFTER. Its old hits are never
carried forward: pipeline/out is emptied at the start of every run.
"""
import argparse, datetime, glob, json, os, shutil, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "pipeline", "out")
CADENCE_H = 3
FRESH_AFTER_H = CADENCE_H + 1      # up to 4h old: fresh
STALE_AFTER_H = 12                 # older than 12h: stale
DEAD_AFTER = 4                     # misses in a row (12h at a 3h cadence)
MIN_TOPICS = 150
MIN_LIVE_LANES = 6

# id -> (label, kind). kind: "lane" runs every time; "design" is skipped on purpose; "retired" is gone.
LANES = {
    "gtrends": ("Google Trends", "lane"), "news": ("Google News", "lane"),
    "news_search": ("Google News searches", "lane"), "reddit": ("Reddit (JSON)", "lane"),
    "reddit_rss": ("Reddit (RSS)", "lane"), "hn": ("Hacker News", "lane"),
    "mastodon": ("Mastodon tags", "lane"), "bluesky": ("Bluesky trending", "lane"),
    "charts": ("Apple charts", "lane"), "wiki": ("Wikipedia most read", "lane"),
    "netflix": ("Netflix Top 10", "lane"), "youtube_rss": ("YouTube channels", "lane"),
    "streamers": ("Streamer news", "lane"), "steam": ("Steam most played", "lane"),
    "tiktok": ("TikTok", "design"), "x": ("X", "design"), "youtube": ("YouTube popular", "retired"),
}

def now_utc():
    return datetime.datetime.now(datetime.timezone.utc)

def ts(x):
    t = datetime.datetime.fromisoformat(x.replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=datetime.timezone.utc)

def iso(t):
    return t.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def load(path, default):
    try:
        with open(path) as f: return json.load(f)
    except Exception:
        return default

def lane_result(lid, run_start):
    """-> (hits_this_run, newest_fetched_at or None)"""
    hits = load(os.path.join(OUT, lid + ".json"), [])
    if not isinstance(hits, list): return 0, None
    newest = None
    n = 0
    for h in hits:
        try:
            t = ts(h["fetched_at"])
        except Exception:
            continue
        if t >= run_start - datetime.timedelta(minutes=2):
            n += 1
            newest = max(newest, t) if newest else t
    return n, newest

def state_for(kind, misses):
    if kind == "retired": return "retired"
    if kind == "design": return "by-design"
    if misses == 0: return "live"
    return "degraded" if misses < DEAD_AFTER else "dead"

def update_health(prev, run_start, now):
    health, rows = {}, []
    for lid, (label, kind) in LANES.items():
        p = prev.get(lid, {})
        n, newest = lane_result(lid, run_start) if kind == "lane" else (0, None)
        ok = n > 0
        misses = 0 if (ok or kind != "lane") else int(p.get("misses", 0)) + 1
        last_good = iso(newest) if ok else p.get("lastGoodAt")
        recent = (p.get("recent", "") + ("o" if ok else ("m" if kind == "lane" else "-")))[-24:]
        health[lid] = {"lastGoodAt": last_good, "misses": misses, "recent": recent}
        st = state_for(kind, misses)
        if kind == "lane" and not ok and last_good and (now - ts(last_good)).total_seconds() > 48 * 3600:
            st = "dead"
        age = round((now - ts(last_good)).total_seconds() / 3600, 1) if last_good else None
        rows.append({"id": lid, "label": label, "state": st, "hits": n, "lastGoodAt": last_good,
                     "ageHours": age, "missesInARow": misses})
    return health, rows

def board_summary(store):
    topics = store.get("topics", [])
    auto = [t for t in topics if not t.get("seeded")]
    newest = None
    for t in auto:
        try: newest = max(newest, ts(t["last_seen"])) if newest else ts(t["last_seen"])
        except Exception: pass
    return {
        "topics": len(topics), "tracked": len(auto),
        "confirmed": sum(1 for t in auto if t.get("confirmed")),
        "singleSource": sum(1 for t in auto if not t.get("confirmed")),
        "newestSighting": iso(newest) if newest else None,
    }

def verdict(age_h):
    return "fresh" if age_h <= FRESH_AFTER_H else ("aging" if age_h <= STALE_AFTER_H else "stale")

def build(run_start, now, prev_health, store):
    health, lanes = update_health(prev_health, run_start, now)
    counts = {}
    for l in lanes: counts[l["state"]] = counts.get(l["state"], 0) + 1
    gen = now
    fresh = {
        "generatedAt": iso(gen), "runStartedAt": iso(run_start), "cadenceHours": CADENCE_H,
        "freshUntil": iso(gen + datetime.timedelta(hours=FRESH_AFTER_H)),
        "staleAfter": iso(gen + datetime.timedelta(hours=STALE_AFTER_H)),
        "board": board_summary(store), "laneCounts": counts, "lanes": lanes,
        "how": "Rebuilt every 3 hours from public sources. A source that returns nothing is shown as degraded or dead and contributes nothing; old hits are never carried forward.",
    }
    return health, fresh

def gate(fresh, store):
    problems = []
    if fresh["board"]["topics"] < MIN_TOPICS: problems.append(f"only {fresh['board']['topics']} topics (need {MIN_TOPICS})")
    live = fresh["laneCounts"].get("live", 0)
    if live < MIN_LIVE_LANES: problems.append(f"only {live} live lanes (need {MIN_LIVE_LANES})")
    nw = fresh["board"]["newestSighting"]
    if not nw or (ts(fresh["generatedAt"]) - ts(nw)).total_seconds() > 6 * 3600:
        problems.append("no sighting newer than 6 hours: nothing new was collected")
    return problems

def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f: json.dump(obj, f, ensure_ascii=False, indent=1)

def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-start", required=True)
    ap.add_argument("--gate", action="store_true")
    a = ap.parse_args(argv)
    now, run_start = now_utc(), ts(a.run_start)
    store = load(os.path.join(ROOT, "data", "trends.json"), {"topics": []})
    prev = load(os.path.join(ROOT, "data", "lane_health.json"), {})
    health, fresh = build(run_start, now, prev, store)
    problems = gate(fresh, store)
    fresh["gate"] = {"passed": not problems, "problems": problems}
    write_json(os.path.join(ROOT, "data", "lane_health.json"), health)
    write_json(os.path.join(ROOT, "data", "v1", "freshness.json"), fresh)
    st = os.path.join(ROOT, "data", "v1", "state")
    os.makedirs(st, exist_ok=True)
    for name, rel in [("trends.json", "data/trends.json"), ("velocity_history.json", "data/velocity_history.json"),
                      ("velocity_archive.json", "data/velocity_archive.json"),
                      ("platform_velocity_history.json", "data/platform_velocity_history.json"),
                      ("lane_health.json", "data/lane_health.json")]:
        src = os.path.join(ROOT, rel)
        if os.path.exists(src): shutil.copyfile(src, os.path.join(st, name))
    c = fresh["laneCounts"]
    print(f"[health] {c.get('live',0)} live, {c.get('degraded',0)} degraded, {c.get('dead',0)} dead; "
          f"{fresh['board']['tracked']} tracked, {fresh['board']['confirmed']} confirmed -> data/v1/freshness.json")
    if problems:
        for p in problems: print("[health] GATE:", p)
        if a.gate:
            print("[health] build refused: the previous deploy stays live")
            return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
