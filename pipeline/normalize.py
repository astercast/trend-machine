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
HIST = os.path.join(ROOT, "data", "velocity_history.json")
OUT_DIR = os.path.join(ROOT, "pipeline", "out")
STALE_HOURS = 72
HIST_MAX_DAYS = 14       # history window for velocity sparklines
HIST_BUCKET_S = 3600     # keep at most one snapshot per hour per topic

def tokens(s):
    return set(re.findall(r"[a-z0-9]{3,}", (s or "").lower()))

# --- wave 2: meme-format detection -------------------------------------------
# Pattern signals for format/sound/challenge-type topics. Conservative on
# purpose: word-boundary matching, no ML, re-computed for every topic on
# every run. "challenge" is title/hashtags-only: in summaries it mostly
# shows up as the verb ("challenges how we define leadership"), which is
# not the meme-format sense. Tags surface as "format" chips on the dossier;
# category is never rewritten by this.
_FORMAT_TITLE_TAGS = {
    # "challenge" only counts where it signals a format: title/hashtags
    "challenge": [r"\bchallenge\b", r"\bchallenges\b"],
}
_FORMAT_FULL_TEXT = [
    ("pov",        [r"\bpov\b"]),
    ("sound",      [r"\bsound trend\b", r"\bviral sound\b", r"\btrending sound\b",
                    r"\bsong is taking over\b", r"\baudio trend\b"]),
    ("dance",      [r"\bdance challenge\b", r"\bdance trend\b", r"\bdance craze\b"]),
    ("meme",       [r"\bmeme\b", r"\bmemes\b", r"\bbrainrot\b", r"\bshitpost\b",
                    r"\bdank meme\b"]),
    ("duet",       [r"\bduet\b"]),
    ("stitch",     [r"\bstitch\b"]),
    ("green-screen", [r"\bgreen screen\b", r"\bgreenscreen\b"]),
    ("template",   [r"\btemplate trend\b", r"\bcapcut template\b"]),
    ("trend",      [r"\btrend on tiktok\b", r"\btrending format\b"]),
]

def detect_format(title, summary, hashtags):
    """Return sorted list of format tags detected in the topic text."""
    head = " ".join([title or "", " ".join(hashtags or [])]).lower()
    full = " ".join([title or "", summary or "", " ".join(hashtags or [])]).lower()
    tags = set()
    for tag, pats in _FORMAT_TITLE_TAGS.items():
        if any(re.search(p, head) for p in pats):
            tags.add(tag)
    for tag, pats in _FORMAT_FULL_TEXT:
        if any(re.search(p, full) for p in pats):
            tags.add(tag)
    return sorted(tags)

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

def load_history():
    """Load the velocity-history store; tolerate missing/corrupt file."""
    try:
        with open(HIST) as f:
            h = json.load(f)
        return h if isinstance(h, dict) else {}
    except Exception:
        return {}

def snapshot_history(topics, hist):
    """Append one snapshot per topic, downsample to hourly, prune >14 days.

    Store shape: {topic_id: [[iso_ts, velocity, opportunity], ...]}.
    Points are compact lists (the store is never served whole — build_site.py
    inlines per-topic SVG sparklines into dossiers).
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(days=HIST_MAX_DAYS)
    for tid, t in topics.items():
        pts = hist.get(tid) or []
        pts.append([now.isoformat(), int(t.get("velocity", 0)),
                    int(t.get("opportunity_score", 0))])
        # keep latest point per hour bucket, drop older than the window
        latest = {}
        for p in pts:
            try:
                dt = datetime.datetime.fromisoformat(p[0])
            except Exception:
                continue
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
            if dt < cutoff:
                continue
            latest[dt.strftime("%Y-%m-%dT%H")] = p
        hist[tid] = sorted(latest.values(), key=lambda p: p[0])
    # drop topics that no longer exist
    for tid in list(hist):
        if tid not in topics:
            del hist[tid]
    os.makedirs(os.path.dirname(HIST), exist_ok=True)
    with open(HIST, "w") as f:
        json.dump(hist, f, ensure_ascii=False, separators=(",", ":"))
    n_pts = sum(len(v) for v in hist.values())
    print(f"[normalize] history: {len(hist)} topics, {n_pts} points "
          f"(window {HIST_MAX_DAYS}d, bucket {HIST_BUCKET_S}s) -> {HIST}")

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
                "format_tags": detect_format(h.get("title", ""), h.get("summary", ""),
                                             h.get("hashtags", [])),
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
        # wave 2: meme-format signals (pattern-based, re-computed every run)
        t["format_tags"] = detect_format(t.get("title", ""), t.get("summary", ""),
                                         t.get("hashtags", []))

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
    # wave 2: snapshot velocity/opportunity history before writing the store.
    # Use the final (post-prune) topic list so removed topics don't
    # accumulate history.
    snapshot_history({t["id"]: t for t in data["topics"]}, load_history())
    with open(DATA, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    live = sum(1 for t in data["topics"] if not t.get("stale"))
    print(f"[normalize] {len(data['topics'])} topics ({live} live, {len(data['topics'])-live} stale) -> {DATA}")

if __name__ == "__main__":
    main()
