#!/usr/bin/env python3
"""Merge fetcher outputs into data/trends.json.

Dedup: normalized titles are compared by token-set Jaccard; >= 0.55 merges.
Scoring (documented in PIPELINE.md):
  velocity    = min(100, 25 * sources + 15 * recency_boost + hashtag_bonus)
  saturation  = high if >=4 sources else medium if >=2 else low
  opportunity = round(velocity * (1 - {low:0, medium:.35, high:.6}[saturation]))
Seeded topics are preserved and re-corroborated: a fetcher hit matching a
seeded topic refreshes its last_seen and adds the source; seeded topics with
no corroboration for 72h are marked stale (not deleted — history matters).
"""
import json, os, re, datetime, glob

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(ROOT, "data", "trends.json")
OUT_DIR = os.path.join(ROOT, "pipeline", "out")
STALE_HOURS = 72

def tokens(s):
    return set(re.findall(r"[a-z0-9]{3,}", (s or "").lower()))

def jaccard(a, b):
    if not a or not b: return 0.0
    return len(a & b) / len(a | b)

def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s[:60] or "topic"

def parse_ts(s):
    try:
        return datetime.datetime.fromisoformat(s)
    except Exception:
        return datetime.datetime.now(datetime.timezone.utc)

def main():
    with open(DATA) as f:
        data = json.load(f)
    topics = {t["id"]: t for t in data["topics"]}
    now = datetime.datetime.now(datetime.timezone.utc)

    # load all fetcher hits
    hits = []
    for path in glob.glob(os.path.join(OUT_DIR, "*.json")):
        try:
            with open(path) as f:
                hits.extend(json.load(f))
        except Exception as e:
            print(f"[normalize] bad file {path}: {e}")

    matched_ids = set()
    for h in hits:
        ht = tokens(h.get("title", ""))
        best, best_score = None, 0.0
        for tid, t in topics.items():
            s = jaccard(ht, tokens(t["title"]))
            if s > best_score:
                best, best_score = tid, s
        src = {"name": h.get("source", "?"), "url": h.get("url", "")}
        if best and best_score >= 0.55:
            t = topics[best]
            t["last_seen"] = h.get("fetched_at", now.isoformat())
            urls = {s["url"] for s in t.get("sources", [])}
            if src["url"] not in urls:
                t.setdefault("sources", []).append(src)
            for p in h.get("platforms", []):
                if p not in t["platforms"]:
                    t["platforms"].append(p)
            for tag in h.get("hashtags", []):
                if tag not in t["hashtags"]:
                    t["hashtags"].append(tag)
            t["stale"] = False
            matched_ids.add(best)
        else:
            tid = slugify(h.get("title", ""))[:50]
            n = 1
            while tid in topics:
                n += 1
                tid = f"{tid}-{n}"
            topics[tid] = {
                "id": tid, "title": h.get("title", "")[:180],
                "summary": h.get("summary", "")[:400] or "Detected by the live pipeline; angles pending editorial pass.",
                "category": h.get("category") or "news",
                "platforms": h.get("platforms", []) or ["x"],
                "hashtags": h.get("hashtags", [])[:8],
                "velocity": 55, "saturation": "low",
                "opportunity_score": 55,
                "first_seen": h.get("fetched_at", now.isoformat()),
                "last_seen": h.get("fetched_at", now.isoformat()),
                "seeded": False, "stale": False, "needs_angles": True,
                "sources": [src], "angles": [], "hooks": [],
                "who_to_watch": [], "guide_links": [],
            }

    # recompute velocity/opportunity from corroboration
    for tid, t in topics.items():
        n_src = len(t.get("sources", []))
        last = parse_ts(t.get("last_seen", ""))
        if last.tzinfo is None:
            last = last.replace(tzinfo=datetime.timezone.utc)
        age_h = max(0, (now - last).total_seconds() / 3600)
        recency = max(0, 1 - age_h / 48)  # decays over 48h
        tag_bonus = min(10, len(t.get("hashtags", [])) * 2)
        velocity = min(100, round(25 * min(n_src, 3) + 20 * recency + tag_bonus))
        if not t.get("seeded"):
            t["velocity"] = velocity
        sat = "high" if n_src >= 4 else ("medium" if n_src >= 2 else "low")
        t["saturation"] = sat
        pen = {"low": 0.0, "medium": 0.35, "high": 0.6}[sat]
        t["opportunity_score"] = round(t["velocity"] * (1 - pen))
        t["stale"] = age_h > STALE_HOURS

    data["topics"] = sorted(topics.values(),
                            key=lambda t: t["opportunity_score"], reverse=True)
    # prune: keep all seeded/editorial topics, cap auto-added ones so the
    # store stays bounded across refreshes (drop oldest single-source first)
    MAX_AUTO = 300
    auto = [t for t in data["topics"] if not t.get("seeded")]
    if len(auto) > MAX_AUTO:
        drop_ids = {t["id"] for t in
                    sorted(auto, key=lambda t: t.get("last_seen", ""))[:len(auto) - MAX_AUTO]}
        data["topics"] = [t for t in data["topics"] if t["id"] not in drop_ids]
        print(f"[normalize] pruned {len(drop_ids)} old auto topics (cap {MAX_AUTO})")
    data["generated_at"] = now.isoformat()
    data["generator"] = "pipeline/normalize.py"
    with open(DATA, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    live = sum(1 for t in data["topics"] if not t.get("stale"))
    print(f"[normalize] {len(data['topics'])} topics ({live} live, {len(data['topics'])-live} stale) -> {DATA}")

if __name__ == "__main__":
    main()
