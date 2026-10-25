"""Trend Machine fleet collector.

Runs the site's own refresh pipeline inside this (read-only) repo
checkout, exactly as pipeline/refresh.sh does — fetchers, normalize,
the health gate, the site build, the aggregator, the node payload
builders — then publishes the produced live files from data/v1 to
HB_OUT (this site's folder in the fleet-data repo). A data refresh
here never deploys the site; the site reads the board from
fleet-data and falls back to its baked copy.

The health gate keeps its meaning: when a run collects too little,
the gate stops the build and NOTHING is published — the last good
board stays live, and the pulse says the gate held. A dark lane is
data, not a crash: lane health comes from pipeline/out/*.json, the
same files the Live Wire labels from.

Tracks only. Nothing here forecasts or predicts anything.
Stdlib only, via the fleet lib.
"""
import glob
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib import Pulse, now, read, write_if_changed  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(ROOT, "pipeline", "out")

# The refresh.sh fetcher loop (fetch_youtube stays retired, per the
# note in refresh.sh: every no-key path is dead; YouTube coverage
# rides fetch_youtube_rss).
FETCHERS = ["fetch_gtrends", "fetch_news", "fetch_news_search",
            "fetch_reddit", "fetch_reddit_rss", "fetch_hn",
            "fetch_mastodon", "fetch_bluesky", "fetch_lemmy",
            "fetch_charts", "fetch_wiki", "fetch_netflix",
            "fetch_youtube_rss", "fetch_streamers", "fetch_steam",
            "fetch_tiktok", "fetch_x"]

PUBLISH = ["board.json", "trends.json", "freshness.json",
           "live-wire.json", "streamer-desk.json", "hashtags.json",
           "lifecycle.json", "platform-velocity.json", "velocity.json",
           "meme-formats.json", "index.json"]

MIN_BOARD_TOPICS = 150  # the repo's own acceptability bar (restore_state.py)


def run(script, *args, timeout=300):
    try:
        r = subprocess.run([sys.executable, script, *args], cwd=ROOT,
                           timeout=timeout, capture_output=True, text=True)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        return None, "timeout"
    except Exception as e:  # noqa: BLE001 - a dead step is data
        return None, type(e).__name__


def lane_items(path):
    try:
        doc = json.load(open(path))
    except Exception:
        return None
    if isinstance(doc, list):
        return len(doc)
    if isinstance(doc, dict):
        for k in ("items", "topics", "results", "hits", "trends"):
            if isinstance(doc.get(k), list):
                return len(doc[k])
        return len(doc)
    return 0


def main():
    p = Pulse(stale_after_h=8)

    # State comes from the live site, as in refresh.sh; a failed
    # restore is not fatal (the repo seed continues the board).
    run(os.path.join("pipeline", "restore_state.py"), timeout=120)
    for f in glob.glob(os.path.join(OUT_DIR, "*.json")):
        os.remove(f)

    for f in FETCHERS:
        lane = f[len("fetch_"):]
        run(os.path.join("pipeline", f + ".py"), timeout=180)
        n = lane_items(os.path.join(OUT_DIR, lane + ".json"))
        p.source("lane-" + lane, f"Trend lane: {lane}", n is not None,
                 n or 0, None if n is not None else "no output this run",
                 None)

    rc, _ = run(os.path.join("pipeline", "normalize.py"), timeout=600)
    if rc != 0:
        p.source("board", "Trend board", False, 0,
                 "normalize failed; last good board kept", None)
        p.write()
        print("trend: normalize failed, board held")
        return 0

    rc, out = run(os.path.join("pipeline", "health.py"),
                  "--run-start", now(), "--gate", timeout=120)
    if rc != 0:
        p.source("board", "Trend board", False, 0,
                 "health gate held the board; last good board kept", None)
        p.write()
        print("trend: health gate held the board")
        return 0

    run(os.path.join("scripts", "build_site.py"), timeout=600)
    run(os.path.join("pipeline", "aggregate.py"), timeout=300)
    # Node payloads (Live Wire + Streamer Desk), as in refresh.sh.
    for js in ("build_live_wire.js", "build_streamer_desk.js"):
        path = os.path.join(ROOT, "scripts", js)
        if not os.path.exists(path):
            continue
        try:
            subprocess.run(["node", path], cwd=ROOT, timeout=300,
                           capture_output=True, text=True)
        except Exception:
            pass  # node unavailable or builder failed: file stays stale

    published = 0
    board_topics = 0
    for name in PUBLISH:
        path = os.path.join(ROOT, "data", "v1", name)
        try:
            doc = json.load(open(path))
        except Exception:
            continue
        if name == "board.json":
            topics = doc.get("topics") if isinstance(doc, dict) else None
            board_topics = len(topics) if isinstance(topics, list) else 0
            if board_topics < MIN_BOARD_TOPICS:
                continue  # below the repo's own bar: keep the last good
        if write_if_changed(name, doc, volatile=("generated_at",)):
            published += 1
    prev_board = read("board.json", {})
    board_ok = board_topics >= MIN_BOARD_TOPICS
    p.source("board", "Trend board", board_ok, board_topics,
             None if board_ok else "board below the 150-topic bar", None)
    if board_ok and isinstance(prev_board, dict):
        new_at = None
        try:
            new_at = json.load(open(os.path.join(
                ROOT, "data", "v1", "board.json"))).get("generated_at")
        except Exception:
            pass
        if new_at and new_at != prev_board.get("generated_at"):
            p.change("board", "Board refreshed", "board.json")
    p.write()
    print(f"trend: {published} file(s) published, board topics {board_topics}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
