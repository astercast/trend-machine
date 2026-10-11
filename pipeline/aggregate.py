#!/usr/bin/env python3
"""Flat contract publisher — the creator-site consumer feed.

The builder's pipeline (fetchers -> pipeline/normalize.py -> scripts/build_site.py)
produces the rich editorial schema in data/trends.json and api/v1/trends.json.
This stage derives the FLAT, consumer-safe contract from the canonical store
(data/trends.json) so the creator-growth-empire site can fetch one stable
shape client-side:

  api/v1/trends.flat.json = { generated_at, sample, source_count, trends: [
      { id, title, source, url, velocity, opportunity_score, hashtags[],
        detected_at, summary, category, platforms, sources[] } ] }

  api/v1/trends.flat.js   = JSONP twin: trendsCallback({...}) — the CORS-safe
                            fallback for pure static hosts that cannot send
                            Access-Control-Allow-Origin headers (see GO_LIVE.md).

  api/v1/trends.flat.sample.json = clearly-labeled sample from seed topics
                            (sample: true) for consumer development.

Stale (>72h, no corroboration) topics are excluded from the live feed;
stale-ness is the pipeline's own cooling signal. Exit 0 always when the
store exists; exits 0 with a log line (no output written) when the store
is missing — run pipeline/refresh.sh first in that case.
"""
import json, os, sys

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, "..")
STORE = os.path.join(ROOT, "data", "trends.json")
API = os.path.join(ROOT, "api", "v1")
OUT_JSON = os.path.join(API, "trends.flat.json")
OUT_JS = os.path.join(API, "trends.flat.js")
OUT_SAMPLE = os.path.join(API, "trends.flat.sample.json")

sys.path.insert(0, HERE)
from common import now_iso

def flat(t):
    srcs = t.get("sources", []) or []
    return {
        "id": t.get("id"),
        "title": t.get("title"),
        "source": srcs[0].get("name") if srcs else "seed",
        "url": srcs[0].get("url") if srcs else "",
        "velocity": t.get("velocity", 0),
        "opportunity_score": t.get("opportunity_score", 0),
        "hashtags": t.get("hashtags", []),
        "detected_at": t.get("first_seen", t.get("last_seen", "")),
        "summary": (t.get("summary") or "")[:400],
        "category": t.get("category"),
        "platforms": t.get("platforms", []),
        "sources": [s.get("name") for s in srcs],
    }

def write(feed, json_path, with_js=False):
    os.makedirs(API, exist_ok=True)
    with open(json_path, "w") as f:
        json.dump(feed, f, indent=2, ensure_ascii=False)
    if with_js:
        with open(OUT_JS, "w") as f:
            f.write("trendsCallback(")
            json.dump(feed, f, ensure_ascii=False)
            f.write(");")
    print(f"[flat-feed] {len(feed['trends'])} trends -> {json_path}"
          + (f" + {OUT_JS}" if with_js else ""))

def main():
    if not os.path.exists(STORE):
        print("[flat-feed] SKIP: data/trends.json not found — run pipeline/refresh.sh first.")
        return
    with open(STORE) as f:
        data = json.load(f)
    topics = data.get("topics", [])

    live = [flat(t) for t in topics if not t.get("stale")]
    live.sort(key=lambda t: (-t["opportunity_score"], -t["velocity"]))
    write({"generated_at": now_iso(), "sample": False,
           "source_count": len(live),
           "trends": live}, OUT_JSON, with_js=True)

    seeds = [flat(t) for t in topics if t.get("seeded")]
    seeds.sort(key=lambda t: (-t["opportunity_score"], -t["velocity"]))
    write({"generated_at": now_iso(), "sample": True,
           "source_count": len(seeds),
           "note": "Clearly-labeled SAMPLE derived from editorial seed topics (data/trends.json). "
                   "Not live data — for consumer development only.",
           "trends": seeds}, OUT_SAMPLE)

if __name__ == "__main__":
    main()
