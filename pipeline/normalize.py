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
ARCHIVE = os.path.join(ROOT, "data", "velocity_archive.json")
LEDGER = os.path.join(ROOT, "data", "forecast_ledger.json")
LEDGER_MAX_DAYS = 7      # mirrors build_forecasts.js MAX_LEDGER_AGE_D
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
                    r"\bsong is taking over\b", r"\baudio trend\b",
                    # wave 7: TikTok jargon "original sound" = the meme audio
                    r"\boriginal sound\b"]),
    ("dance",      [r"\bdance challenge\b", r"\bdance trend\b", r"\bdance craze\b",
                    # wave 7: a dance move/choreography is itself a format
                    r"\bdance\b"]),
    ("meme",       [r"\bmeme\b", r"\bmemes\b", r"\bbrainrot\b", r"\bshitpost\b",
                    r"\bdank meme\b"]),
    ("duet",       [r"\bduet\b"]),
    ("stitch",     [r"\bstitch\b"]),
    ("green-screen", [r"\bgreen screen\b", r"\bgreenscreen\b"]),
    ("template",   [r"\btemplate trend\b", r"\bcapcut template\b",
                    # wave 7: any template reference
                    r"\btemplate\b"]),
    ("trend",      [r"\btrend on tiktok\b", r"\btrending format\b",
                    # wave 7: "this trend" is how caption-variant formats
                    # name themselves ("Did I win this trend?")
                    r"\bthis trend\b"]),
    # wave 7: new signals — a "format" or "caption" is the reusable
    # template itself ("carousel-native format", "'Did I win' caption")
    ("format",     [r"\bformat\b"]),
    ("caption",    [r"\bcaption\b"]),
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

# --- wave 7: format-vs-topic labeling ------------------------------------------
# Mandate: track which of the top trends are meme FORMATS (a reusable
# template others can fill — a dance, a caption variant, a sound, a
# challenge) vs TOPICS (a subject or event to cover — a game launch, a
# news event, a release). "format+topic" is both: an event-driven topic
# riding a meme template. Rule-based, conservative, re-computed on every
# run from format_tags + category (like format_tags itself), so the label
# is derived, never stale, and never invented by an LLM.
_FORMAT_SIGNALS = {"challenge", "dance", "pov", "sound", "meme", "duet",
                   "stitch", "template", "trend", "green-screen",
                   "format", "caption"}
_EVENT_CATEGORIES = {"news", "sports", "gaming"}

# --- wave 9: format-family link ------------------------------------------------
# Deferred import: format_families.py is a standalone module so scripts can
# test the matcher in isolation (scripts/test_format_families.py).
try:
    from format_families import match_family
except ImportError:  # pragma: no cover — defensive for exotic layouts
    def match_family(title, summary, hashtags):
        return None

def classify_trend_type(t):
    """Return 'format', 'topic', or 'format+topic' for one topic dict."""
    is_format = bool(set(t.get("format_tags") or []) & _FORMAT_SIGNALS)
    is_event = (t.get("category") or "").lower() in _EVENT_CATEGORIES
    if is_format and is_event:
        return "format+topic"
    if is_format:
        return "format"
    return "topic"

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

def load_store(path):
    """Load a JSON dict store; tolerate missing/corrupt file."""
    try:
        with open(path) as f:
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
    # wave 18: topics that leave the store keep their series — moved to
    # the resolution archive, never deleted. A decisive forecast resolves
    # 48h after it is recorded, but a churned-out news topic can leave
    # the store within hours; deleting its snapshots with its store
    # entry made its forecast ungradeable ("unverifiable") even though
    # the data existed. The graders (build_forecasts.js,
    # check_resolutions.js) read live history + archive merged
    # (resolution-lib.js mergeHistory — the archive fills the hour
    # buckets the live store no longer holds).
    archive = load_store(ARCHIVE)
    moved = 0
    for tid in list(hist):
        if tid not in topics:
            by_hour = {p[0][:13]: p for p in archive.get(tid) or []}
            for p in hist.pop(tid):
                by_hour[p[0][:13]] = p
            archive[tid] = sorted(by_hour.values(), key=lambda p: p[0])
            moved += 1
    # Archive pruning mirrors the ledger's own retention: points age out
    # at HIST_MAX_DAYS like the live store, and a series is dropped once
    # the ledger holds no entry for the topic inside its 7-day window
    # (the verdict's evidence is recorded on the ledger entry itself).
    # Ledger unreadable -> keep everything (fail-safe, never lose
    # grading evidence on a guess).
    ledger_ids = None
    try:
        with open(LEDGER) as f:
            led = json.load(f)
        led_cutoff = now - datetime.timedelta(days=LEDGER_MAX_DAYS)
        ledger_ids = set()
        for e in led.get("entries", []):
            dt = parse_ts(e.get("forecast_at", ""))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
            if dt >= led_cutoff:
                ledger_ids.add(e.get("topic_id"))
    except Exception:
        ledger_ids = None
    for tid in list(archive):
        pts = []
        for p in archive[tid]:
            dt = parse_ts(p[0])
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
            if dt >= cutoff:
                pts.append(p)
        if not pts or (ledger_ids is not None and tid not in ledger_ids):
            del archive[tid]
        else:
            archive[tid] = pts
    with open(ARCHIVE, "w") as f:
        json.dump(archive, f, ensure_ascii=False, separators=(",", ":"))
    os.makedirs(os.path.dirname(HIST), exist_ok=True)
    with open(HIST, "w") as f:
        json.dump(hist, f, ensure_ascii=False, separators=(",", ":"))
    n_pts = sum(len(v) for v in hist.values())
    a_pts = sum(len(v) for v in archive.values())
    print(f"[normalize] history: {len(hist)} topics, {n_pts} points "
          f"(window {HIST_MAX_DAYS}d, bucket {HIST_BUCKET_S}s) -> {HIST}")
    print(f"[normalize] archive: {len(archive)} topics, {a_pts} points "
          f"({moved} series moved this run) -> {ARCHIVE}")

# --- wave 6: per-platform velocity history -----------------------------------
# Same bucketing/pruning as the main history, but one series per platform
# per topic. Platform velocity uses the same corroboration recipe as the
# main velocity, scoped to hits seen on that platform:
#   vel_p = min(100, 25 * min(hits_48h, 3) + 20 * recency_p)
# These are STARTING points: the series begins empty and builds one
# snapshot per refresh, so per-platform trajectories only appear after
# 3+ hourly snapshots — the Oracle labels thinner series "building".
PHIST = os.path.join(ROOT, "data", "platform_velocity_history.json")
PLATFORM_HIT_WINDOW_H = 48

def snapshot_platform_history(topics, phist):
    """Append one per-platform snapshot per topic.

    Store shape: {topic_id: {platform: [[iso_ts, vel_p], ...]}}.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(days=HIST_MAX_DAYS)
    recent_cut = now - datetime.timedelta(hours=PLATFORM_HIT_WINDOW_H)
    for tid, t in topics.items():
        hits_map = t.get("platform_hits") or {}
        entry = phist.get(tid) or {}
        for p, stamps in hits_map.items():
            recent = []
            for s in stamps:
                dt = parse_ts(s)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=datetime.timezone.utc)
                if dt >= recent_cut:
                    recent.append(dt)
            recent.sort()
            hits_map[p] = [d.isoformat() for d in recent]  # prune in place
            if not recent:
                continue
            age_h = max(0, (now - recent[-1]).total_seconds() / 3600)
            recency = max(0, 1 - age_h / PLATFORM_HIT_WINDOW_H)
            vel = min(100, round(25 * min(len(recent), 3) + 20 * recency))
            pts = entry.get(p) or []
            pts.append([now.isoformat(), vel])
            latest = {}
            for pt in pts:
                dt = parse_ts(pt[0])
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=datetime.timezone.utc)
                if dt < cutoff:
                    continue
                latest[dt.strftime("%Y-%m-%dT%H")] = pt
            entry[p] = sorted(latest.values(), key=lambda x: x[0])
        for p in list(entry):
            if p not in (t.get("platforms") or []):
                del entry[p]
        if entry:
            phist[tid] = entry
        elif tid in phist:
            del phist[tid]
    for tid in list(phist):
        if tid not in topics:
            del phist[tid]
    os.makedirs(os.path.dirname(PHIST), exist_ok=True)
    with open(PHIST, "w") as f:
        json.dump(phist, f, ensure_ascii=False, separators=(",", ":"))
    n_pts = sum(len(v) for e in phist.values() for v in e.values())
    print(f"[normalize] platform history: {len(phist)} topics, {n_pts} points "
          f"(window {HIST_MAX_DAYS}d) -> {PHIST}")

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
            # wave 6: track per-platform hit timestamps (last 48h) so the
            # per-platform velocity series can be snapshotted honestly
            ph = t.setdefault("platform_hits", {})
            for p in h.get("platforms", []):
                ph.setdefault(p, []).append(h.get("fetched_at", now.isoformat()))
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
            hit_plats = h.get("platforms", []) or ["x"]
            topics[tid] = {
                "id": tid, "title": h.get("title", "")[:180],
                "summary": h.get("summary", "")[:400] or "Detected by the live pipeline; angles pending editorial pass.",
                "category": h.get("category") or "news",
                "platforms": hit_plats,
                "hashtags": h.get("hashtags", [])[:8],
                "velocity": 55, "saturation": "low",
                "opportunity_score": 55,
                "first_seen": h.get("fetched_at", now.isoformat()),
                "last_seen": h.get("fetched_at", now.isoformat()),
                "seeded": False, "stale": False, "needs_angles": True,
                "platform_hits": {p: [h.get("fetched_at", now.isoformat())]
                                  for p in hit_plats},
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
        # wave 7: format-vs-topic label (derived from format_tags + category)
        t["trend_type"] = classify_trend_type(t)
        # wave 9: format-family link (derived, re-computed every run from the
        # curated family table — None when the topic matches no family)
        t["format_family"] = match_family(t.get("title", ""), t.get("summary", ""),
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
    # wave 6: snapshot per-platform velocity history (starting points —
    # series begin empty and build one snapshot per refresh).
    snapshot_platform_history({t["id"]: t for t in data["topics"]},
                              load_store(PHIST))
    with open(DATA, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    live = sum(1 for t in data["topics"] if not t.get("stale"))
    print(f"[normalize] {len(data['topics'])} topics ({live} live, {len(data['topics'])-live} stale) -> {DATA}")

if __name__ == "__main__":
    main()
