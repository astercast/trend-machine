#!/usr/bin/env python3
"""Build trend-machine static site: topic pages, api/v1, llms.txt.

Run directly or via pipeline/refresh.sh.
"""
import json, os, re, html, datetime

# wave 8: pure sparkline data prep + SVG builders (unit-tested, pinned fixtures)
import sparkline_prep

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(ROOT, "data", "trends.json")
GUIDE_BASE = os.environ.get("GUIDE_BASE_URL", "../creator-growth-empire/")

# seed guide_links prefixes -> real guide phase pages (convention; see API.md)
GUIDE_MAP = {
    "phase-0": ("phase-0-start-from-nothing.html", "Phase 0 — Start from nothing"),
    "phase-1": ("phase-1-content-engine.html", "Phase 1 — The content engine"),
    "phase-4": ("phase-4-audience-to-community.html", "Phase 4 — Audience to community"),
}
LINK_PREFIX = {
    "packaging/": "phase-1", "content-engine/": "phase-1",
    "niche/": "phase-0", "audience/": "phase-4",
}

_FAMILY_NAMES = {}


def esc(s):
    return html.escape(str(s or ""), quote=True)

HIST_FILE = os.path.join(ROOT, "data", "velocity_history.json")

def load_history():
    try:
        with open(HIST_FILE) as f:
            h = json.load(f)
        return h if isinstance(h, dict) else {}
    except Exception:
        return {}

def sparkline_html(pts, topic_id="", per_platform=None):
    """Inline SVG velocity sparkline, wave 8.

    Delegates to scripts/sparkline_prep.py (pure, unit-tested). Honest:
    <3 snapshots renders "history building" — never a fake line. Includes
    per-platform mini-sparklines where platform trajectories exist and a
    <details> data-table alternative for screen readers.
    """
    return sparkline_prep.sparkline_figure_html(
        pts or [], topic_id or "topic", per_platform=per_platform)

def export_payload_json(t):
    payload = {
        "title": t.get("title", ""), "id": t.get("id", ""),
        "category": t.get("category", ""),
        "opportunity": t.get("opportunity_score", 0),
        "velocity": t.get("velocity", 0),
        "angles": t.get("angles", []), "hooks": t.get("hooks", []),
        "hashtags": t.get("hashtags", []),
        "platforms": t.get("platforms", []),
        "format_tags": t.get("format_tags", []),
        "trend_type": t.get("trend_type", "topic"),
    }
    return json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")

def guide_links(links):
    out = []
    for l in links or []:
        phase = None
        for pre, ph in LINK_PREFIX.items():
            if l.startswith(pre):
                phase = ph; break
        if not phase:
            continue
        slug, label = GUIDE_MAP[phase]
        if slug not in [o[0] for o in out]:
            out.append((slug, label))
    return [(GUIDE_BASE + s, label) for s, label in out]

TOPIC_TMPL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — Trend Machine</title>
<meta name="description" content="{desc}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%230b0f0e'/%3E%3Ccircle cx='8' cy='8' r='5' fill='none' stroke='%2339ff88' stroke-width='1.6'/%3E%3Ccircle cx='8' cy='8' r='1.4' fill='%2339ff88'/%3E%3C/svg%3E">
<link rel="stylesheet" href="../assets/css/tokens.css">
<link rel="stylesheet" href="../assets/css/base.css">
<link rel="stylesheet" href="../assets/css/components.css">
<link rel="stylesheet" href="../assets/css/wave2.css">
<link rel="stylesheet" href="../assets/css/wave3.css">
<link rel="stylesheet" href="../assets/css/wave8.css">
<link rel="stylesheet" href="../assets/css/fonts.css">
<link rel="stylesheet" href="../assets/css/wave12.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head"><div class="head-inner">
<a class="brand" href="../index.html" aria-label="Trend Machine home"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Trend&nbsp;Machine</a>
<span class="kicker">topic dossier</span>
</div></header>
<main id="main" class="wrap">
<nav aria-label="Breadcrumb" style="margin:20px 0 0"><a href="../index.html" style="font-size:13px">&larr; all trends</a></nav>
<article class="topic-hero {tier}">
<p class="kicker">{kicker}</p>
<h1>{title}</h1>
<p class="lede">{summary}</p>
<div class="stat-grid" role="list" aria-label="Signal stats">
<div class="stat" role="listitem"><div class="k">Detected</div><div class="v"><span class="fresh {fcls}"><span class="dot{pulse}" aria-hidden="true"></span>{age}</span></div></div>
<div class="stat" role="listitem"><div class="k">Opportunity</div><div class="v {ocls} num">{opp}</div></div>
<div class="stat" role="listitem"><div class="k">Velocity</div><div class="v num">{vel}</div></div>
<div class="stat" role="listitem"><div class="k">Platforms</div><div class="v num">{nplat}</div></div>
</div>
<div style="margin-bottom:4px">{plats}{tchip}{cats}{formats}{tags}</div>
{spark}
{stale_note}
<p style="margin:14px 0 0;font-size:14px"><a href="../oracle.html">🔮 See this topic's 48h forecast in the Oracle</a></p>
</article>
<section aria-labelledby="why"><div class="section-head"><h2 id="why"><span class="sec-no">01</span>Why it's trending</h2></div>
<p style="max-width:68ch;font-size:1.05rem">{summary_long}</p>
<h3 style="font-size:15px;margin-top:22px">Sources</h3>
<ul class="src-list">{sources}</ul>
</section>
<section aria-labelledby="angles"><div class="section-head"><h2 id="angles"><span class="sec-no">02</span>Content angles</h2>
<div class="angles-tools"><span class="kicker">topic in &rarr; video out</span>
<button type="button" class="btn remix-btn" id="remix-btn" aria-describedby="remix-status" aria-label="Remix this topic: copy angles, hook lines, hashtags and best platforms as plain text">⧉ Remix this</button>
<a class="btn" href="../launch-plan.html?topic={tid}">🗓 7-day battle plan</a>
<span class="copy-status" id="remix-status" role="status" aria-live="polite"></span>
</div></div>
{angles}
</section>
<section aria-labelledby="hooks"><div class="section-head"><h2 id="hooks"><span class="sec-no">03</span>Hook lines</h2></div>
{hooks}
</section>
<section aria-labelledby="watch"><div class="section-head"><h2 id="watch"><span class="sec-no">04</span>Who to watch</h2></div>
<p style="color:var(--ink-dim)">{watch}</p>
</section>
<aside class="guide-cta" aria-labelledby="gcta">
<h3 id="gcta" style="margin-top:0">Capitalize on this in the Creator Growth Empire guide</h3>
<p style="color:var(--ink-dim);font-size:14px">Playbooks for turning a trend into a content system:</p>
<ul>{guide}</ul>
<p style="font-size:12px;color:var(--ink-faint)">Guide base URL is configurable (see API.md); defaults to a sibling checkout.</p>
</aside>
</main>
<footer class="site-foot"><div class="wrap foot-grid">
<div><strong style="color:var(--ink)">Trend Machine</strong><br><span style="font-size:13px">Live trending-topic intelligence.</span></div>
<div class="num" style="font-size:12px">data: {ts}</div>
</div></footer>
<script type="application/json" id="export-payload">{payload}</script>
<script src="../assets/js/tm-copy.js"></script>
<script src="../assets/js/remix-text.js"></script>
<script src="../assets/js/remix-export.js"></script>
</body>
</html>
"""

def age_label(iso):
    try:
        dt = datetime.datetime.fromisoformat(iso)
    except Exception:
        return "unknown", "f-dead", ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    mins = max(0, (datetime.datetime.now(datetime.timezone.utc) - dt).total_seconds() / 60)
    if mins < 60:
        return f"{max(1, round(mins))}m ago", "f-live", " pulse"
    if mins < 1440:
        return f"{round(mins/60)}h ago", "f-warm", ""
    return f"{round(mins/1440)}d ago", "f-dead", ""

def build_topic(t, history_pts=None, plat_hist=None):
    age, fcls, pulse = age_label(t.get("last_seen", ""))
    opp, vel = t.get("opportunity_score", 0), t.get("velocity", 0)
    tier = "is-hot" if opp >= 70 else ("is-warm" if opp >= 40 else "")
    ocls = "hot-v" if opp >= 70 else ("warm-v" if opp >= 40 else "live-v")
    plats = "".join(f'<span class="chip plat">{esc(p)}</span>' for p in t.get("platforms", []))
    nplat = len(t.get("platforms", [])) or "—"
    cats = f'<span class="chip">{esc(t.get("category",""))}</span>'
    tt = esc(t.get("trend_type", "topic"))
    ticon = {"format": "⧉", "topic": "◉", "format+topic": "⧉◉"}.get(t.get("trend_type", "topic"), "◉")
    tchip = (f'<span class="chip type" title="Wave 7: format = a reusable template to join; '
             f'topic = a subject to cover; format+topic = an event riding a meme template">'
             f'{ticon} {tt}</span>')
    formats = "".join(
        f'<span class="chip format" title="Detected meme-format signal">format · {esc(f)}</span>'
        for f in t.get("format_tags", []))
    # wave 9: format-family chip — links to the family's card on formats.html
    fam_id = t.get("format_family")
    fam_names = _FAMILY_NAMES
    famchip = (f'<a class="chip family" href="../formats.html#family-{esc(fam_id)}" '
               f'title="Wave 9: tracked format family — see its current examples and evidence">'
               f'⧉ family: {esc(fam_names.get(fam_id, fam_id))}</a>'
               if fam_id else "")
    tags = "".join(f'<span class="tag">{esc(h)}</span>' for h in t.get("hashtags", [])[:10])
    spark = sparkline_html(history_pts or [], t.get("id", ""), plat_hist)
    payload = export_payload_json(t)
    def src_li(s):
        nm, url = esc(s.get("name", "source")), esc(s.get("url", ""))
        # wave 7: name-only sources (unverified seeds) render as plain text
        if url:
            return f'<li><a href="{url}">{nm}</a></li>'
        return f'<li><span class="src-name">{nm}</span> <em class="src-unverified">(unverified — confirm live)</em></li>'
    sources = "".join(src_li(s) for s in t.get("sources", [])) or "<li>No public sources captured yet.</li>"
    angles = "".join(
        f'<div class="angle"><span class="idx num">{i+1:02d}</span><p>{esc(a)}</p></div>'
        for i, a in enumerate(t.get("angles", []))) or "<p>No angles yet — check back after the next refresh.</p>"
    hooks = "".join(f'<div class="hook">&ldquo;{esc(h)}&rdquo;</div>' for h in t.get("hooks", []))
    watch = esc(", ".join(t.get("who_to_watch", [])) or "—")
    guide = "".join(f'<li><a href="{esc(u)}">{esc(l)}</a></li>' for u, l in guide_links(t.get("guide_links"))) \
        or '<li><a href="' + esc(GUIDE_BASE) + '">Creator Growth Empire guide</a></li>'
    stale_note = ('<p><span class="stale-badge">STALE</span> '
                  '<span style="font-size:13px;color:var(--ink-faint)">No corroboration in 72h+ — treat as cooling.</span></p>'
                  if t.get("stale") else "")
    return TOPIC_TMPL.format(
        title=esc(t["title"]), desc=esc(t["summary"][:150]),
        tid=esc(t["id"]),
        kicker=esc(t.get("category", "trend")) + " · dossier",
        summary=esc(t["summary"]), tier=tier, fcls=fcls, pulse=pulse, age=age,
        ocls=ocls, opp=opp, vel=vel, nplat=nplat, plats=plats, tchip=tchip, cats=cats,
        formats=formats + famchip, spark=spark, payload=payload,
        tags=tags,
        stale_note=stale_note, summary_long=esc(t["summary"]),
        sources=sources, angles=angles, hooks=hooks, watch=watch,
        guide=guide, ts=esc(t.get("last_seen", "")))

def main():
    with open(DATA) as f:
        data = json.load(f)
    topics = data["topics"]
    # wave 9: format-family display names for dossier chips
    global _FAMILY_NAMES
    try:
        with open(os.path.join(ROOT, "data", "meme_formats.json")) as _ff:
            _FAMILY_NAMES = {f.get("id"): f.get("name", f.get("id"))
                             for f in json.load(_ff).get("families", [])}
    except Exception:
        _FAMILY_NAMES = {}
    history = load_history()  # wave 2: velocity snapshots for sparklines
    # wave 8: per-platform velocity series for mini-sparklines on dossiers
    plat_history = {}
    try:
        with open(os.path.join(ROOT, "data", "platform_velocity_history.json")) as f:
            plat_history = json.load(f)
    except Exception:
        pass

    tdir = os.path.join(ROOT, "topics")
    os.makedirs(tdir, exist_ok=True)
    live_ids = set()
    for t in topics:
        live_ids.add(t["id"])
        with open(os.path.join(tdir, t["id"] + ".html"), "w") as f:
            f.write(build_topic(t, history.get(t["id"], []),
                                plat_history.get(t["id"], {})))
    # remove orphaned pages from pruned topics
    orphans = 0
    for fn in os.listdir(tdir):
        if fn.endswith(".html") and fn[:-5] not in live_ids:
            os.remove(os.path.join(tdir, fn))
            orphans += 1
    print(f"[build] {len(topics)} topic pages ({orphans} orphans removed)")

    # api/v1
    api = os.path.join(ROOT, "data", "v1")
    os.makedirs(os.path.join(api, "schema"), exist_ok=True)
    with open(os.path.join(api, "trends.json"), "w") as f:
        json.dump({"generated_at": data["generated_at"], "count": len(topics),
                   "topics": topics}, f, indent=2, ensure_ascii=False)
    tags = {}
    for t in topics:
        for h in t.get("hashtags", []):
            tags.setdefault(h, []).append(t["id"])
    with open(os.path.join(api, "hashtags.json"), "w") as f:
        json.dump({"generated_at": data["generated_at"], "tags": tags}, f, indent=2)
    # data/v1/velocity.json — Oracle input: hourly velocity snapshots, the exact
    # same shape as data/velocity_history.json ({topic_id: [[iso, vel, opp]]}).
    # (data/velocity_history.json is the pipeline working copy; api/v1 is the
    # public contract. Shape is identical so the dashboard math ports 1:1.)
    with open(os.path.join(api, "velocity.json"), "w") as f:
        json.dump(history, f, ensure_ascii=False)
    print(f"[build] data/v1/velocity.json ({len(history)} topics)")
    # data/v1/platform-velocity.json — wave 6: per-platform velocity series
    # ({topic_id: {platform: [[iso, vel], ...]}}). Starting points: series
    # begin empty and build one snapshot per refresh; per-platform
    # trajectories only classify after 3+ snapshots.
    phist = {}
    phist_path = os.path.join(ROOT, "data", "platform_velocity_history.json")
    try:
        with open(phist_path) as f:
            phist = json.load(f)
    except Exception:
        pass
    with open(os.path.join(api, "platform-velocity.json"), "w") as f:
        json.dump(phist, f, ensure_ascii=False)
    print(f"[build] data/v1/platform-velocity.json ({len(phist)} topics)")
    # data/v1/meme-formats.json — wave 9: the curated format-family table
    # (data/meme_formats.json) enriched with this run's derived topic links.
    # tracked_topics are the live topic ids whose format_family matched.
    families_path = os.path.join(ROOT, "data", "meme_formats.json")
    mf_doc = {}
    try:
        with open(families_path) as f:
            mf_doc = json.load(f)
    except Exception:
        mf_doc = {"families": []}
    # wave 14: seed-freshness audit payload (written by scripts/seed_freshness.py;
    # may not exist yet on a fresh checkout — manifest entry reports 0 seeds then)
    freshness = {}
    try:
        with open(os.path.join(ROOT, "data", "seed_freshness.json")) as f:
            freshness = json.load(f)
    except Exception:
        freshness = {}
    by_family = {}
    for t in topics:
        fam = t.get("format_family")
        if fam:
            by_family.setdefault(fam, []).append(t["id"])
    mf_out = {
        "generated_at": data["generated_at"],
        "version": mf_doc.get("version", 1),
        "method": mf_doc.get("method", ""),
        "families": [],
    }
    for fam in mf_doc.get("families", []):
        entry = dict(fam)
        entry["tracked_topics"] = sorted(by_family.get(fam.get("id"), []))
        mf_out["families"].append(entry)
    with open(os.path.join(api, "meme-formats.json"), "w") as f:
        json.dump(mf_out, f, ensure_ascii=False, indent=2)
    print(f"[build] data/v1/meme-formats.json ({len(mf_out['families'])} families, "
          f"{sum(len(f['tracked_topics']) for f in mf_out['families'])} topic links)")

    DRAFT = "http://json-schema.org/draft-07/schema#"

    def schema_path(name):
        return f"data/v1/schema/{name}.json"

    TOPIC = {
        "$schema": DRAFT,
        "title": "trend-machine topic",
        "type": "object",
        "required": ["id", "title", "summary", "category", "platforms",
                     "hashtags", "velocity", "opportunity_score",
                     "first_seen", "last_seen", "sources"],
        "properties": {
            "id": {"type": "string"},
            "title": {"type": "string"},
            "summary": {"type": "string",
                       "description": "Seeded topics may carry researched starting-point figures in the summary — treat as baselines, not live measurements."},
            "category": {"type": "string"},
            "platforms": {"type": "array", "items": {"type": "string"}},
            "hashtags": {"type": "array", "items": {"type": "string"}},
            "velocity": {"type": "integer", "minimum": 0, "maximum": 100},
            "saturation": {"type": "string", "enum": ["low", "medium", "high"]},
            "opportunity_score": {"type": "integer", "minimum": 0, "maximum": 100},
            "first_seen": {"type": "string"},
            "last_seen": {"type": "string"},
            "stale": {"type": "boolean"},
            "seeded": {"type": "boolean"},
            "seed_note": {"type": "string"},
            "sources": {"type": "array", "items": {"type": "object",
                "required": ["name", "url"]}},
            "angles": {"type": "array", "items": {"type": "string"}},
            "hooks": {"type": "array", "items": {"type": "string"}},
            "who_to_watch": {"type": "array", "items": {"type": "string"}},
            "format_tags": {"type": "array", "items": {"type": "string"},
                "description": "Wave 2: pattern-detected meme-format signals (pov/challenge/sound/dance/meme/duet/stitch/green-screen/template/trend)."},
            "trend_type": {"type": "string", "enum": ["format", "topic", "format+topic"],
                "description": "Wave 7: 'format' = a reusable template others can fill (dance, caption variant, sound, challenge); 'topic' = a subject/event to cover; 'format+topic' = an event-driven topic riding a meme template. Rule-derived from format_tags + category."},
            "format_family": {"type": ["string", "null"],
                "description": "Wave 9: id of the curated format family this topic belongs to (see data/v1/meme-formats.json) — matched from the topic's own text against the curated family keywords, re-computed every run; null when the topic matches no tracked family."},
            "verification": {"type": "string", "enum": ["verified", "single-source", "unverified"],
                "description": "Wave 7 (seeded topics): 'verified' = 2+ real sources; 'single-source' = one real source; 'unverified' = claimed sources not found on re-check — confirm live before building on it."},
            "guide_links": {"type": "array", "items": {"type": "string"}},
            "platform_hits": {"type": "object",
                "description": "Wave 6: recent hit timestamps per platform (last 48h window). Powers the per-platform velocity history.",
                "additionalProperties": {"type": "array", "items": {"type": "string"}}},
        },
    }

    VELOCITY_TREND = {
        "type": "object",
        "required": ["snapshots", "state", "since", "first_velocity",
                     "latest_velocity", "delta", "sparkline_svg", "per_platform"],
        "properties": {
            "snapshots": {"type": "integer", "minimum": 0,
                          "description": "Number of hourly velocity snapshots behind this trend."},
            "state": {"type": "string", "enum": ["ready", "building"],
                      "description": "ready = 3+ snapshots, sparkline drawn from real data; building = fewer than 3 snapshots, no line drawn (honest state)."},
            "since": {"type": ["string", "null"],
                      "description": "'Oct 11, 2026'-style label of the first snapshot; null when no snapshots yet."},
            "first_velocity": {"type": ["integer", "null"]},
            "latest_velocity": {"type": ["integer", "null"]},
            "delta": {"type": "integer",
                      "description": "latest_velocity - first_velocity."},
            "sparkline_svg": {"type": ["string", "null"],
                              "description": "Wave 8: pre-rendered inline SVG mini-sparkline (role=img, data-grounded aria-label, static/no animation) when state=ready; null when building."},
            "per_platform": {"type": "object",
                             "description": "Per-platform mini-summaries {platform: {snapshots, latest_velocity, delta, sparkline_svg|null}} from real per-platform snapshot data.",
                             "additionalProperties": {
                                 "type": "object",
                                 "required": ["snapshots", "latest_velocity", "delta", "sparkline_svg"],
                                 "properties": {
                                     "snapshots": {"type": "integer", "minimum": 0},
                                     "latest_velocity": {"type": ["integer", "null"]},
                                     "delta": {"type": "integer"},
                                     "sparkline_svg": {"type": ["string", "null"]},
                                 }}},
        },
    }

    FLAT_TREND = {
        "type": "object",
        "required": ["id", "title", "source", "url", "velocity",
                     "opportunity_score", "hashtags", "detected_at",
                     "summary", "category", "platforms", "format_tags",
                     "trend_type", "sources", "velocity_trend"],
        "properties": {
            "id": {"type": "string"}, "title": {"type": "string"},
            "source": {"type": "string",
                       "description": "First source name, or 'seed' for editorial seed topics."},
            "url": {"type": "string"},
            "velocity": {"type": "integer", "minimum": 0, "maximum": 100},
            "opportunity_score": {"type": "integer", "minimum": 0, "maximum": 100},
            "hashtags": {"type": "array", "items": {"type": "string"}},
            "detected_at": {"type": "string"},
            "summary": {"type": "string"},
            "category": {"type": "string"},
            "platforms": {"type": "array", "items": {"type": "string"}},
            "format_tags": {"type": "array", "items": {"type": "string"}},
            "trend_type": {"type": "string", "enum": ["format", "topic", "format+topic"]},
            "format_family": {"type": ["string", "null"],
                "description": "Wave 9: curated format-family id (see data/v1/meme-formats.json), or null."},
            "sources": {"type": "array", "items": {"type": "string"}},
            "velocity_trend": VELOCITY_TREND,
        },
    }

    FORECAST = {
        "type": "object",
        "required": ["id", "title", "state", "n_snapshots",
                     "latest_velocity", "slope_per_hour", "accel",
                     "peak_in_hours", "summary", "label"],
        "properties": {
            "id": {"type": "string"}, "title": {"type": "string"},
            "state": {"type": "string", "enum": ["accelerating", "rising",
                      "peaking", "fading", "steady", "insufficient"]},
            "n_snapshots": {"type": "integer", "minimum": 0},
            "latest_velocity": {"type": "integer"},
            "slope_per_hour": {"type": "number"},
            "accel": {"type": "number"},
            "peak_in_hours": {"type": ["number", "null"],
                              "description": "null when no peak is projected in the 48h window"},
            "summary": {"type": "string"},
            "label": {"type": "string",
                      "description": "Honest human label: always 'projection from N snapshots — not a guarantee'."},
            "confidence": {"type": "object",
                "description": "Wave 6: the evidence basis behind the forecast (snapshot count + fit quality). Never a probability of being right.",
                "properties": {
                    "level": {"type": "string", "enum": ["high", "medium", "low"]},
                    "n": {"type": "integer", "minimum": 0},
                    "r2": {"type": "number"},
                    "basis": {"type": "string"}}},
            "signals": {"type": "object",
                "description": "Wave 6: which signals drive the trajectory call — velocity delta, slope, accel, recency, cross-platform spread, and the classifier thresholds that fired (drivers).",
                "properties": {
                    "velocity_delta": {"type": "number"},
                    "slope_per_hour": {"type": "number"},
                    "accel": {"type": "number"},
                    "recency_hours": {"type": ["number", "null"]},
                    "platform_spread": {"type": "integer", "minimum": 0},
                    "platforms": {"type": "array", "items": {"type": "string"}},
                    "drivers": {"type": "array", "items": {"type": "string"}}}},
            "per_platform": {"type": "object",
                "description": "Wave 6: per-platform trajectory classifications, where the data supports it (3+ per-platform snapshots). Platforms with fewer get the honest 'insufficient' label.",
                "additionalProperties": {"type": "object",
                    "properties": {
                        "state": {"type": "string", "enum": ["accelerating", "rising",
                                  "peaking", "fading", "steady", "insufficient"]},
                        "n": {"type": "integer", "minimum": 0},
                        "latest_velocity": {"type": "integer"},
                        "slope_per_hour": {"type": "number"},
                        "peak_in_hours": {"type": ["number", "null"]},
                        "summary": {"type": "string"}}}},
        },
    }

    SCHEMAS = {
        # canonical topic dossier record (one item of data/v1/trends.json)
        "trend": TOPIC,
        "trends": {
            "$schema": DRAFT,
            "title": "trend-machine trends envelope",
            "type": "object",
            "required": ["generated_at", "count", "topics"],
            "properties": {
                "generated_at": {"type": "string"},
                "count": {"type": "integer", "minimum": 0},
                "topics": {"type": "array", "items": {"$ref": "trend.json"}},
            },
        },
        # flat consumer feed (live, opportunity-ranked)
        "trends-flat": {
            "$schema": DRAFT,
            "title": "trend-machine flat consumer feed",
            "type": "object",
            "required": ["generated_at", "sample", "source_count", "trends"],
            "properties": {
                "generated_at": {"type": "string"},
                "sample": {"const": False,
                           "description": "false = live feed (the labeled sample twin uses trends-flat-sample.json)"},
                "source_count": {"type": "integer", "minimum": 0},
                "trends": {"type": "array",
                           "items": {"$ref": "#/definitions/flatTrend"}},
            },
            "definitions": {"flatTrend": FLAT_TREND},
        },
        # labeled sample twin of the flat feed (development only)
        "trends-flat-sample": {
            "$schema": DRAFT,
            "title": "trend-machine flat feed sample",
            "type": "object",
            "required": ["generated_at", "sample", "source_count", "note",
                         "trends"],
            "properties": {
                "generated_at": {"type": "string"},
                "sample": {"const": True},
                "source_count": {"type": "integer", "minimum": 0},
                "note": {"type": "string"},
                "trends": {"type": "array",
                           "items": {"$ref": "trends-flat.json#/definitions/flatTrend"}},
            },
        },
        "hashtags": {
            "$schema": DRAFT,
            "title": "trend-machine hashtag index",
            "type": "object",
            "required": ["generated_at", "tags"],
            "properties": {
                "generated_at": {"type": "string"},
                "tags": {"type": "object",
                         "additionalProperties": {"type": "array",
                                                  "items": {"type": "string"}}},
            },
        },
        "meme-formats": {
            "$schema": DRAFT,
            "title": "trend-machine meme format families",
            "description": ("Wave 9: hand-curated meme format families (verified = 2+ independent "
                            "sources; single-source = one source or creator lore — flagged, never "
                            "hidden). tracked_topics are the live topic ids whose text matches the "
                            "family's curated keywords this run; family matches are derived, "
                            "never stale."),
            "type": "object",
            "required": ["generated_at", "version", "method", "families"],
            "properties": {
                "generated_at": {"type": "string"},
                "version": {"type": "integer", "minimum": 1},
                "method": {"type": "string"},
                "families": {"type": "array",
                    "items": {"type": "object",
                        "required": ["id", "name", "description", "status",
                                     "verification", "curated", "keywords",
                                     "examples", "tracked_topics"],
                        "properties": {
                            "id": {"type": "string"},
                            "name": {"type": "string"},
                            "description": {"type": "string"},
                            "status": {"type": "string",
                                       "enum": ["rising", "peak", "fading",
                                                "established", "evergreen"]},
                            "status_note": {"type": "string"},
                            "verification": {"type": "string",
                                             "enum": ["verified", "single-source"]},
                            "verification_note": {"type": "string"},
                            "curated": {"type": "string"},
                            "keywords": {"type": "array", "items": {"type": "string"}},
                            "examples": {"type": "array",
                                "items": {"type": "object",
                                    "required": ["name"],
                                    "properties": {
                                        "name": {"type": "string"},
                                        "evidence": {"type": "string"},
                                        "verification": {"type": "string"},
                                        "sources": {"type": "array",
                                            "items": {"type": "object",
                                                "required": ["name", "url"],
                                                "properties": {
                                                    "name": {"type": "string"},
                                                    "url": {"type": "string", "format": "uri"}}}}}}},
                            "tracked_topics": {"type": "array",
                                               "items": {"type": "string"}},
                        }},
                },
            },
        },
        "seed-freshness": {
            "$schema": DRAFT,
            "title": "trend-machine seed freshness sweep",
            "description": ("Wave 14: the seed-freshness audit. Every seeded topic "
                            "is checked for staleness: source URL liveness (HTTP "
                            "probe; dead = GET 404/410 only, never a timeout or "
                            "HEAD rejection), store corroboration (last_seen <= "
                            "7 days), and velocity tracking (a seed with <3 "
                            "snapshots but a first snapshot <6h old is warming "
                            "up, not stale). Verdicts: healthy / stale-source / "
                            "stale-untracked / flaky-warning (probe timeout — a "
                            "warning, never marked stale)."),
            "type": "object",
            "required": ["generated_at", "method", "counts", "stale", "seeds"],
            "properties": {
                "generated_at": {"type": "string"},
                "method": {"type": "string"},
                "counts": {"type": "object",
                    "required": ["healthy", "stale-source", "stale-untracked",
                                 "flaky-warning", "seeds"],
                    "properties": {
                        "healthy": {"type": "integer", "minimum": 0},
                        "stale-source": {"type": "integer", "minimum": 0},
                        "stale-untracked": {"type": "integer", "minimum": 0},
                        "flaky-warning": {"type": "integer", "minimum": 0},
                        "seeds": {"type": "integer", "minimum": 0},
                    }},
                "stale": {"type": "array",
                    "items": {"type": "object",
                        "required": ["id", "title", "verdict", "reason"],
                        "properties": {
                            "id": {"type": "string"},
                            "title": {"type": "string"},
                            "verdict": {"type": "string",
                                        "enum": ["stale-source", "stale-untracked"]},
                            "reason": {"type": "string"},
                        }}},
                "seeds": {"type": "array",
                    "items": {"type": "object",
                        "required": ["id", "title", "verification", "verdict",
                                     "reason", "sources", "last_seen",
                                     "last_seen_age_days", "velocity_snapshots",
                                     "in_store"],
                        "properties": {
                            "id": {"type": "string"},
                            "title": {"type": "string"},
                            "verification": {"type": "string"},
                            "verdict": {"type": "string",
                                        "enum": ["healthy", "stale-source",
                                                 "stale-untracked", "flaky-warning"]},
                            "reason": {"type": "string"},
                            "sources": {"type": "array",
                                "items": {"type": "object",
                                    "required": ["name", "url", "status", "note"],
                                    "properties": {
                                        "name": {"type": "string"},
                                        "url": {"type": "string", "format": "uri"},
                                        "status": {"type": "string",
                                                   "enum": ["live", "dead", "flaky",
                                                            "not-probed"]},
                                        "note": {"type": "string"},
                                    }}},
                            "last_seen": {"type": ["string", "null"]},
                            "last_seen_age_days": {"type": ["number", "null"]},
                            "velocity_snapshots": {"type": "integer", "minimum": 0},
                            "in_store": {"type": "boolean"},
                        }}},
            },
        },
        "lifecycle": {
            "$schema": DRAFT,
            "title": "trend-machine Oracle lifecycle layer",
            "description": ("Wave 17: ignition/burnout lifecycle stages for every "
                            "topic, classified from real velocity snapshots by "
                            "assets/js/lifecycle-lib.js using the classifier's own "
                            "thresholds (ignition line v=70, rise/fall ±1.5/hr). "
                            "Stages are readouts, never predictions. Topics with "
                            "fewer than 3 snapshots report 'building'."),
            "type": "object",
            "required": ["generated_at", "method", "honesty", "counts",
                         "ignitions", "burnouts", "topics"],
            "properties": {
                "generated_at": {"type": "string"},
                "method": {"type": "string"},
                "honesty": {"type": "string"},
                "counts": {"type": "object",
                           "additionalProperties": {"type": "integer", "minimum": 0}},
                "ignitions": {"type": "array", "items": {
                    "type": "object",
                    "required": ["id", "from", "to", "ts"],
                    "properties": {
                        "id": {"type": "string"},
                        "title": {"type": "string"},
                        "from": {"type": "string", "enum": ["building", "steady",
                                 "warming", "igniting", "peaking", "cooling",
                                 "burned-out"]},
                        "to": {"type": "string", "enum": ["igniting", "peaking"]},
                        "ts": {"type": "string"},
                    }}},
                "burnouts": {"type": "array", "items": {
                    "type": "object",
                    "required": ["id", "from", "to", "ts"],
                    "properties": {
                        "id": {"type": "string"},
                        "title": {"type": "string"},
                        "from": {"type": "string", "enum": ["building", "steady",
                                 "warming", "igniting", "peaking", "cooling",
                                 "burned-out"]},
                        "to": {"type": "string", "enum": ["cooling", "burned-out"]},
                        "ts": {"type": "string"},
                    }}},
                "topics": {"type": "object",
                           "additionalProperties": {
                               "type": "object",
                               "required": ["stage", "since", "ribbon"],
                               "properties": {
                                   "stage": {"type": "string", "enum": ["building",
                                            "steady", "warming", "igniting",
                                            "peaking", "cooling", "burned-out"]},
                                   "since": {"type": ["string", "null"]},
                                   "ribbon": {"type": "array",
                                              "items": {"type": "string"}},
                               }}},
            },
        },
        "velocity": {
            "$schema": DRAFT,
            "title": "trend-machine velocity snapshots",
            "description": "Oracle input: per-topic hourly velocity/opportunity snapshots, ascending by timestamp. Points are [iso_ts, velocity, opportunity].",
            "type": "object",
            "additionalProperties": {
                "type": "array",
                "items": {"type": "array", "minItems": 3, "maxItems": 3,
                          "items": [{"type": "string"},
                                    {"type": "integer", "minimum": 0, "maximum": 100},
                                    {"type": "integer", "minimum": 0, "maximum": 100}]},
            },
        },
        "platform-velocity": {
            "$schema": DRAFT,
            "title": "trend-machine per-platform velocity snapshots",
            "description": ("Wave 6: per-platform hourly velocity series per topic "
                            "({topic_id: {platform: [[iso_ts, velocity], ...]}}). "
                            "Starting points — series begin empty and build one "
                            "snapshot per refresh; per-platform trajectories only "
                            "classify after 3+ snapshots."),
            "type": "object",
            "additionalProperties": {
                "type": "object",
                "additionalProperties": {
                    "type": "array",
                    "items": {"type": "array", "minItems": 2, "maxItems": 2,
                              "items": [{"type": "string"},
                                        {"type": "integer", "minimum": 0, "maximum": 100}]},
                },
            },
        },
        "forecast-accuracy": {
            "$schema": DRAFT,
            "title": "trend-machine forecast accuracy log",
            "description": ("Wave 6: the Oracle's own forecast-vs-actual scorecard. "
                            "Decisive forecasts are recorded in a ledger and scored "
                            "hit/miss after a 48h horizon; wave 14 adds a terminal "
                            "'unverifiable' verdict (48h passed, <2 actual snapshots "
                            "— counted separately, never in the hit rate). Status is "
                            "'building history' until 10+ forecasts resolve decisively; "
                            "hit_rate is null before that. Wave 18: resolutions grade "
                            "against live history plus the resolution archive (series "
                            "of store-dropped topics), each verdict carries its "
                            "observed window coverage, and the payload reports "
                            "next_resolution_at + resolution_readiness."),
            "type": "object",
            "required": ["generated_at", "status", "method", "horizon_hours",
                         "resolution_rules", "counts", "hit_rate",
                         "hit_rate_note", "by_state", "recent"],
            "properties": {
                "generated_at": {"type": "string"},
                "status": {"type": "string", "enum": ["building history", "live"]},
                "method": {"type": "string"},
                "horizon_hours": {"type": "integer", "const": 48},
                "resolution_rules": {"type": "object",
                    "properties": {
                        "rising_accelerating": {"type": "string"},
                        "peaking": {"type": "string"},
                        "fading": {"type": "string"},
                        "unverifiable": {"type": "string"}}},
                "counts": {"type": "object",
                    "properties": {
                        "recorded": {"type": "integer", "minimum": 0},
                        "pending": {"type": "integer", "minimum": 0},
                        "resolved": {"type": "integer", "minimum": 0},
                        "unverifiable": {"type": "integer", "minimum": 0},
                        "hits": {"type": "integer", "minimum": 0}}},
                "hit_rate": {"type": ["number", "null"]},
                "hit_rate_note": {"type": "string"},
                "by_state": {"type": "object",
                    "additionalProperties": {"type": "object",
                        "properties": {
                            "resolved": {"type": "integer", "minimum": 0},
                            "hits": {"type": "integer", "minimum": 0}}}},
                "recent": {"type": "array",
                    "items": {"type": "object",
                        "properties": {
                            "topic_id": {"type": "string"},
                            "title": {"type": "string"},
                            "forecast_at": {"type": "string"},
                            "state": {"type": "string"},
                            "peak_in_hours": {"type": ["number", "null"]},
                            "verdict": {"type": "string", "enum": ["hit", "miss", "unverifiable"]},
                            "reason": {"type": "string"},
                            "actual_slope": {"type": ["number", "null"]},
                            "actual_end_velocity": {"type": ["number", "null"]},
                            "actual_max_velocity": {"type": ["number", "null"]},
                            "n_actual_points": {"type": ["integer", "null"]},
                            # wave 18: observed coverage of the 48h window
                            "actual_first_ts": {"type": ["string", "null"]},
                            "actual_last_ts": {"type": ["string", "null"]},
                            "window_coverage_hours": {"type": ["number", "null"]},
                            "topic_live": {"type": "boolean"},
                            "n_snapshots": {"type": "integer", "minimum": 0}}}},
                # wave 18: resolution-night readiness (real ledger + snapshot evidence)
                "next_resolution_at": {"type": ["string", "null"],
                    "description": "Exact ISO time the oldest pending forecast crosses its 48h horizon; null when nothing is pending."},
                "resolution_readiness": {"type": "object",
                    "description": "Pending forecasts split by whether their 48h window already holds the 2+ actual snapshots a decisive verdict needs (live store + resolution archive), as of generated_at.",
                    "properties": {
                        "pending": {"type": "integer", "minimum": 0},
                        "with_sufficient_data": {"type": "integer", "minimum": 0},
                        "awaiting_data": {"type": "integer", "minimum": 0}}},
                # wave 9: resolution timeline, ledger activity, calibration
                "upcoming_resolutions": {"type": "array",
                    "description": "Pending forecasts grouped by the day their 48h horizon lands (real ledger dates).",
                    "items": {"type": "object",
                        "properties": {
                            "date": {"type": "string"},
                            "pending": {"type": "integer", "minimum": 0}}}},
                "recorded_per_day": {"type": "array",
                    "description": "Forecasts recorded per day (the ledger's own pulse, from real timestamps).",
                    "items": {"type": "object",
                        "properties": {
                            "date": {"type": "string"},
                            "recorded": {"type": "integer", "minimum": 0}}}},
                "by_confidence": {"type": "object",
                    "description": "Wave 9: hit rate by the confidence level claimed at forecast time. Rows are honest — no rate until that level has 10+ resolved.",
                    "properties": {
                        "high": {"$ref": "#/properties/by_state/additionalProperties"},
                        "medium": {"$ref": "#/properties/by_state/additionalProperties"},
                        "low": {"$ref": "#/properties/by_state/additionalProperties"}}},
            },
        },
        "oracle-board": {
            "$schema": DRAFT,
            "title": "trend-machine Oracle Board",
            "description": ("Wave 27: the forecast-explorer payload. One row per "
                            "forecast in data/forecast_ledger.json — call type, "
                            "forecast-time velocity, the topic's full stored "
                            "velocity trajectory (live store merged with the "
                            "resolution archive, points as recorded), its 48h "
                            "window state (actual snapshots, coverage, slope, "
                            "ready/short), due time, and the verdict when one "
                            "exists. Pending stays pending; a window under 2 "
                            "actuals is labeled short. Status and hit_rate are "
                            "read from forecast-accuracy.json, never recomputed."),
            "type": "object",
            "required": ["generated_at", "status", "horizon_hours", "method",
                         "honesty", "counts", "next_resolution_at", "by_state",
                         "due_per_day", "entries"],
            "properties": {
                "generated_at": {"type": "string"},
                "status": {"type": "string", "enum": ["building history", "live"]},
                "horizon_hours": {"type": "integer", "const": 48},
                "method": {"type": "string"},
                "honesty": {"type": "string"},
                "counts": {"type": "object",
                    "required": ["recorded", "pending", "resolved",
                                 "unverifiable", "hits", "hit_rate", "ready",
                                 "short"],
                    "properties": {
                        "recorded": {"type": "integer", "minimum": 0},
                        "pending": {"type": "integer", "minimum": 0},
                        "resolved": {"type": "integer", "minimum": 0},
                        "unverifiable": {"type": "integer", "minimum": 0},
                        "hits": {"type": "integer", "minimum": 0},
                        "hit_rate": {"type": ["number", "null"]},
                        "ready": {"type": "integer", "minimum": 0},
                        "short": {"type": "integer", "minimum": 0}}},
                "next_resolution_at": {"type": ["string", "null"]},
                "by_state": {"type": "object",
                    "additionalProperties": {"type": "object",
                        "properties": {
                            "recorded": {"type": "integer", "minimum": 0},
                            "pending": {"type": "integer", "minimum": 0},
                            "resolved": {"type": "integer", "minimum": 0},
                            "hits": {"type": "integer", "minimum": 0},
                            "unverifiable": {"type": "integer", "minimum": 0},
                            "ready": {"type": "integer", "minimum": 0},
                            "short": {"type": "integer", "minimum": 0}}}},
                "due_per_day": {"type": "array",
                    "items": {"type": "object",
                        "properties": {
                            "date": {"type": "string"},
                            "pending": {"type": "integer", "minimum": 0}}}},
                "entries": {"type": "array",
                    "items": {"type": "object",
                        "required": ["topic_id", "title", "state",
                                     "forecast_at", "due_at",
                                     "forecast_velocity", "topic_live",
                                     "status", "verdict", "window",
                                     "trajectory", "trajectory_n"],
                        "properties": {
                            "topic_id": {"type": "string"},
                            "title": {"type": "string"},
                            "state": {"type": "string"},
                            "forecast_at": {"type": "string"},
                            "due_at": {"type": "string"},
                            "forecast_velocity": {"type": "number"},
                            "peak_in_hours": {"type": ["number", "null"]},
                            "n_snapshots_at_forecast": {"type": ["integer", "null"]},
                            "confidence": {"type": ["string", "null"]},
                            "topic_live": {"type": "boolean"},
                            "platforms": {"type": "array",
                                          "items": {"type": "string"}},
                            "status": {"type": "string",
                                       "enum": ["pending", "hit", "miss",
                                                "unverifiable"]},
                            "verdict": {"type": ["object", "null"]},
                            "window": {"type": "object",
                                "required": ["n_actual_points", "first_ts",
                                             "last_ts", "coverage_hours",
                                             "slope_per_hour", "ready"],
                                "properties": {
                                    "n_actual_points": {"type": "integer", "minimum": 0},
                                    "first_ts": {"type": ["string", "null"]},
                                    "last_ts": {"type": ["string", "null"]},
                                    "coverage_hours": {"type": "number", "minimum": 0},
                                    "slope_per_hour": {"type": ["number", "null"]},
                                    "ready": {"type": "boolean"}}},
                            "trajectory": {"type": "array",
                                "items": {"type": "array", "minItems": 2,
                                          "maxItems": 2,
                                          "items": [{"type": "string"},
                                                    {"type": "number"}]}},
                            "trajectory_n": {"type": "integer", "minimum": 0}}}},
            },
        },
        # self-describing manifest itself
        "index": {
            "$schema": DRAFT,
            "title": "trend-machine API manifest",
            "type": "object",
            "required": ["name", "version", "generated_at", "base",
                         "endpoints", "deprecated", "changelog", "usage"],
            "properties": {
                "name": {"const": "trend-machine"},
                "version": {"type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$"},
                "generated_at": {"type": "string"},
                "base": {"type": "string"},
                "endpoints": {
                    "type": "object",
                    "additionalProperties": {"$ref": "#/definitions/endpoint"},
                },
                "deprecated": {"type": "array", "items": {"type": "string"}},
                "changelog": {"type": "string"},
                "usage": {"type": "string"},
            },
            "definitions": {
                "endpoint": {
                    "type": "object",
                    "required": ["path", "description", "updated"],
                    "properties": {
                        "path": {"type": "string"},
                        "description": {"type": "string"},
                        "schema": {"type": "string"},
                        "updated": {"type": "string"},
                        "records": {"type": "integer", "minimum": 0},
                        "notes": {"type": "string"},
                    },
                },
            },
        },
        "forecasts": {
            "$schema": DRAFT,
            "title": "trend-machine Oracle forecasts",
            "description": ("Precomputed trajectory classifications from assets/js/trajectory.js "
                            "(the same classifier as the Oracle dashboard). Every forecast is a "
                            "projection from N snapshots — never a guarantee."),
            "type": "object",
            "required": ["generated_at", "method", "honesty", "counts",
                         "peaking_48h", "rising_fast", "cooling_off",
                         "steady", "projections"],
            "properties": {
                "generated_at": {"type": "string"},
                "method": {"type": "string"},
                "honesty": {"type": "string"},
                "counts": {"type": "object",
                           "properties": {
                               "peaking_48h": {"type": "integer"},
                               "rising_fast": {"type": "integer"},
                               "cooling_off": {"type": "integer"},
                               "steady": {"type": "integer"},
                               "insufficient": {"type": "integer"}}},
                "peaking_48h": {"type": "array", "items": {"$ref": "#/definitions/forecast"}},
                "rising_fast": {"type": "array", "items": {"$ref": "#/definitions/forecast"}},
                "cooling_off": {"type": "array", "items": {"$ref": "#/definitions/forecast"}},
                "steady": {"type": "array", "items": {"$ref": "#/definitions/forecast"}},
                "projections": {"type": "object",
                                "additionalProperties": {"$ref": "#/definitions/forecast"}},
            },
            "definitions": {"forecast": FORECAST},
        },
    }

    for sname, sdoc in SCHEMAS.items():
        with open(os.path.join(api, "schema", sname + ".json"), "w") as f:
            json.dump(sdoc, f, indent=2)
    print(f"[build] {len(SCHEMAS)} endpoint schemas -> data/v1/schema/")

    # ---- self-describing manifest (wave 5) ----
    stamp = data["generated_at"]
    live = [t for t in topics if not t.get("stale")]
    seeded = [t for t in topics if t.get("seeded")]

    def endpoint(path, description, schema=None, records=None, notes=None):
        e = {"path": path, "description": description, "updated": stamp}
        if schema:
            e["schema"] = schema
        if records is not None:
            e["records"] = records
        if notes:
            e["notes"] = notes
        return e

    manifest = {
        "name": "trend-machine",
        "version": "0.6.0",
        "generated_at": stamp,
        "base": ("data/v1/ relative to the site root. Works on any static host; "
                 "no auth, no keys, no rate limits."),
        "endpoints": {
            "trends": endpoint(
                "data/v1/trends.json",
                ("All topics, full editorial dossiers: angles, hooks, sources[], "
                 "first_seen/last_seen, stale + seeded flags. The canonical record — "
                 "sort by opportunity_score desc for the hottest plays."),
                schema_path("trends"), len(topics),
                ("Seeded topics (seeded:true) carry researched starting-point figures "
                 "in their summaries — treat as baselines, not live measurements.")),
            "trends_flat": endpoint(
                "data/v1/trends.flat.json",
                ("Flat consumer feed: opportunity-ranked, stale topics excluded. "
                 "Lightweight 'what to make content about today' list. Every item "
                 "carries 'velocity_trend': snapshots/delta/since plus a ready-made "
                 "inline SVG sparkline (wave 8) — honest 'building' state when fewer "
                 "than 3 snapshots exist."),
                schema_path("trends-flat"), len(live)),
            "trends_flat_sample": endpoint(
                "data/v1/trends.flat.sample.json",
                "Clearly-labeled SAMPLE (sample:true) derived from seeded topics — for consumer development only, never the live path.",
                schema_path("trends-flat-sample"), len(seeded)),
            "trends_flat_js": endpoint(
                "api/v1/trends.flat.js",  # public URL — preserved by the vercel.json rewrite (file lives at static/v1/)
                ("JSONP twin of the flat feed — trendsCallback({...}). The CORS-safe "
                 "fallback for pure static hosts that cannot send "
                 "Access-Control-Allow-Origin headers."),
                schema_path("trends-flat")),
            "hashtags": endpoint(
                "data/v1/hashtags.json",
                "Tag -> topic-id index.",
                schema_path("hashtags"), len(tags)),
            "velocity": endpoint(
                "data/v1/velocity.json",
                ("Oracle input: hourly velocity/opportunity snapshots per topic, "
                 "ascending by timestamp. Classify with assets/js/trajectory.js "
                 "(UMD — loadable in node) or read the precomputed "
                 "data/v1/forecasts.json."),
                schema_path("velocity"), len(history),
                "Snapshots are real pipeline observations; topics with <3 snapshots get no forecast."),
            "platform_velocity": endpoint(
                "data/v1/platform-velocity.json",
                ("Wave 6: per-platform hourly velocity series per topic "
                 "({topic_id: {platform: [[iso, vel], ...]}}). Starting points — "
                 "series build one snapshot per refresh; trajectories classify "
                 "after 3+ per-platform snapshots."),
                schema_path("platform-velocity"), len(phist),
                "Empty/missing series mean 'still building history', never a guess."),
            "meme_formats": endpoint(
                "data/v1/meme-formats.json",
                ("Wave 9: the tracked meme format families — hand-curated from "
                 "Oct-2026 web research (verified = 2+ independent sources; "
                 "single-source = one source or creator lore, flagged). Each "
                 "family carries current examples with evidence URLs and the "
                 "live topic ids whose text matches the family this run "
                 "(tracked_topics — derived, never stale)."),
                schema_path("meme-formats"), len(mf_out["families"]),
                "Topics link back via their format_family field (null when unmatched)."),
            "seed_freshness": endpoint(
                "data/v1/seed-freshness.json",
                ("Wave 14: the seed-freshness sweep — every seeded topic checked "
                 "for staleness: source URL liveness (HTTP probe; dead = GET "
                 "404/410 only — HEAD rejections fall through to GET, timeouts "
                 "never mark stale), store corroboration (last_seen <= 7d), and "
                 "velocity tracking (a seed with <3 snapshots but a first "
                 "snapshot <6h old is warming up, not stale). Verdicts: healthy / "
                 "stale-source / stale-untracked / flaky-warning."),
                schema_path("seed-freshness"),
                len([s for s in freshness.get("seeds", [])]) if isinstance(freshness, dict) else 0,
                "Generated by scripts/seed_freshness.py (not in refresh.sh — run as a periodic audit)."),
            "lifecycle": endpoint(
                "data/v1/lifecycle.json",
                ("Wave 17: the Oracle's ignition/burnout lifecycle layer — every "
                 "topic's current stage (building/steady/warming/igniting/peaking/"
                 "cooling/burned-out) from real velocity snapshots, per-topic "
                 "stage ribbons, and the last-24h ignitions/burnouts boards. "
                 "Stages are readouts, never predictions."),
                schema_path("lifecycle"), None,
                "Written by scripts/build_forecasts.js (runs after build_site.py in refresh.sh); human-readable on oracle.html."),
            "oracle_board": endpoint(
                "data/v1/oracle-board.json",
                ("Wave 27: the Oracle Board — every recorded forecast as an "
                 "explorable row: call type, forecast-time velocity, the "
                 "topic's full stored velocity trajectory, its 48h window "
                 "state (actual snapshots, coverage, slope, ready/short), "
                 "due time, and the verdict when one exists. Pending stays "
                 "pending; short windows are labeled short."),
                schema_path("oracle-board"), None,
                "Written by scripts/build_oracle_board.js (runs after build_forecasts.js in refresh.sh and in resolution_night.sh step 3); human-readable on oracle-board.html."),
            "schemas": endpoint(
                "data/v1/schema/",
                "JSON Schema (draft-07) for every endpoint.",
                None, len(SCHEMAS)),
        },
        "deprecated": [],
        "changelog": ("0.6.0 (2026-10-11/12): Wave 13 — the two missing wave-9 seeds land: "
                      "turn-to-your-neighbor and zayn-sleeping-photo, verified live against Know Your Meme "
                      "(both entries updated within the day) and meme.com's meme library. "
                      "Wave 14 — ledger health: forecast resolution gains a terminal 'unverifiable' verdict "
                      "(48h passed, <2 actual snapshots — counted separately, never in the hit rate) with "
                      "full evidence recorded (window bounds, point counts, thresholds); the resolution rules "
                      "live in one shared module (scripts/resolution-lib.js) used by both the hourly pipeline "
                      "and the standalone scripts/check_resolutions.js audit. New data/v1/seed-freshness.json "
                      "endpoint: the seed-freshness audit (scripts/seed_freshness.py) verdicts every seed "
                      "healthy / stale-source / stale-untracked / flaky-warning with per-source probe results. "
                      "Additive only. "
                      "0.5.0 (2026-10-11): Wave 9 — Oracle accuracy scorecard becomes a full page "
                      "(forecast-accuracy.html): honest pre-resolution states, per-horizon accuracy table, "
                      "by-call breakdown, recent resolutions, current 48h projections, and the resolution "
                      "method — all rendered live from data/v1/forecast-accuracy.json, with the hit rate "
                      "shown only after 10+ forecasts resolve. New meme-format family tracking: "
                      "data/meme_formats.json curates 12 hand-researched Oct-2026 format families "
                      "(verified/single-source flags kept honest), pipeline/format_families.py matches "
                      "topics to families by conservative keyword rules (re-computed every run), every "
                      "topic carries format_family, dossiers show a family chip linking to formats.html, "
                      "and data/v1/meme-formats.json publishes the families with their live topic links. "
                      "Additive only, no shape changes. "
                      "0.4.0 (2026-10-11): Wave 8 — velocity sparkline history UI + "
                      "'Remix this' exporter polish. Every flat-feed item now carries "
                      "'velocity_trend': snapshot count, first/latest velocity, delta, "
                      "tracked-since label, a pre-rendered inline SVG sparkline, and "
                      "per-platform mini-summaries — all from real snapshot data; "
                      "topics with <3 snapshots report state 'building' with no fake "
                      "line. Dossier pages gained per-platform mini-sparklines and a "
                      "<details> snapshot data-table for screen readers; the dashboard "
                      "table gained a sparkline column. The remix exporter is now a "
                      "pure unit-tested function (pinned fixtures) and copies best "
                      "platforms too. Additive only, no shape changes. "
                      "0.3.0 (2026-10-11): Wave 7 — Oct-2026 trend-drop refresh: 12 new "
                      "topics (SocialPilot Sept 25–Oct 10 re-check: Did I Win This Trend?, "
                      "31 Days of Halloween, Halloween Home Tour, Creepy Fact Storytime, "
                      "DIP ON EM, #CityTasteTest, Homecoming Proposal Reveal, girl in red "
                      "'we fell in love in october', Memo Boy 'Insomniac', Spooky Scary "
                      "Skeletons remix, Patient Zero TikTok Search Hub, pumpkin patch season); "
                      "new 'trend_type' field on every topic (format/topic/format+topic, "
                      "rule-derived from format_tags + category); seeded topics carry a "
                      "'verification' flag (verified/single-source/unverified — unverified "
                      "topics render name-only sources with a confirm-live note). "
                      "Bow Bow Bow re-graded to Peak/saturation-high. Additive only, no "
                      "shape changes. 0.2.1 (2026-10-11): Oracle 2.0 — forecasts.json records now "
                      "carry confidence basis (snapshot count + fit quality), signal "
                      "attribution (velocity delta, slope, accel, recency, "
                      "cross-platform spread, fired thresholds), and per-platform "
                      "trajectories (additive only, no shape changes). New "
                      "data/v1/platform-velocity.json and data/v1/forecast-accuracy.json "
                      "(the Oracle's own forecast-vs-actual log; 'building history' "
                      "until 10+ forecasts resolve). 0.2.0 (2026-10-11): index.json "
                      "endpoints are now objects "
                      "{path, description, schema, updated, records, notes} (was plain "
                      "path strings). Added flat-feed, JSONP, velocity entries; "
                      "draft-07 schemas for every endpoint under data/v1/schema/. "
                      "data/v1/forecasts.json is added by the post-build forecast step "
                      "(scripts/build_forecasts.js) when present."),
        "usage": ("GET data/v1/trends.json, sort by opportunity_score desc for the "
                  "hottest plays. Start at data/v1/index.json for the full endpoint map."),
    }
    with open(os.path.join(api, "index.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"[build] data/v1/index.json manifest v{manifest['version']}")

    # llms.txt
    lines = ["# Trend Machine", "",
             "Live trending-topic intelligence: what to make content about TODAY.",
             "Machine-readable: data/v1/trends.json (sort by opportunity_score desc).",
             f"Generated: {data['generated_at']} · {len(topics)} topics.", "",
             "## Hottest right now"]
    for t in topics[:10]:
        lines.append(f"- [{t['title']}](topics/{t['id']}.html) (opportunity {t['opportunity_score']}, velocity {t['velocity']})")
    nfmt = sum(1 for t in topics if t.get("trend_type") == "format")
    nmix = sum(1 for t in topics if t.get("trend_type") == "format+topic")
    nfam = {}
    for t in topics:
        _ff = t.get("format_family")
        if _ff:
            nfam[_ff] = nfam.get(_ff, 0) + 1
    famline = ("## Meme format families (wave 9): " +
               ", ".join(f"{_FAMILY_NAMES.get(_k, _k)} ({_v} topics)"
                         for _k, _v in sorted(nfam.items(), key=lambda x: -x[1])) +
               " — formats.html has every family with current examples, evidence, and verification flags.") if nfam else ""
    lines += ["", "## Categories",
              ", ".join(sorted({t['category'] for t in topics})), "",
              f"## Trend types (wave 7): {nfmt} formats, {nmix} format+topic, ",
              famline,
              f"{len(topics) - nfmt - nmix} topics — every dossier and the flat feed carry trend_type (format = reusable template to join; topic = subject to cover).",
              "", "## API", "- [data/v1/index.json](data/v1/index.json) — manifest: every endpoint with description, schema URL, updated timestamp, record counts",
              "- [data/v1/trends.json](data/v1/trends.json) — all topics, full dossiers", "- [data/v1/trends.flat.json](data/v1/trends.flat.json) — flat opportunity-ranked feed (stale excluded)",
              "- [data/v1/velocity.json](data/v1/velocity.json) — hourly velocity snapshots per topic (Oracle input)", "- [data/v1/forecasts.json](data/v1/forecasts.json) — precomputed 48h trajectory forecasts (Oracle output: confidence basis, signal attribution, per-platform trajectories)",
              "- [data/v1/platform-velocity.json](data/v1/platform-velocity.json) — per-platform hourly velocity series (per-platform trajectories input)", "- [data/v1/forecast-accuracy.json](data/v1/forecast-accuracy.json) — the Oracle's own forecast-vs-actual scorecard (building history; hit rate appears after 10+ forecasts resolve)", "- [data/v1/oracle-board.json](data/v1/oracle-board.json) — the Oracle Board: every recorded forecast with its stored trajectory, 48h window state (ready/short), and verdict when one exists",
              "- [data/v1/lifecycle.json](data/v1/lifecycle.json) — the Oracle's ignition/burnout lifecycle layer: per-topic stage (building/steady/warming/igniting/peaking/cooling/burned-out), stage ribbons, last-24h ignitions/burnouts boards (readouts, not predictions)",
              "- [data/v1/meme-formats.json](data/v1/meme-formats.json) — the tracked meme format families: curated families with current examples, evidence, verification flags, and live topic links",
              "- [data/v1/hashtags.json](data/v1/hashtags.json) — tag index", "- [data/v1/schema/](data/v1/schema/) — draft-07 schemas for every endpoint",
              "- [AGENT.md](AGENT.md) — how an agent uses this tracker (end-to-end workflows)", "",
              "## Oracle (flagship)", "- [oracle.html](oracle.html) — 48h peak forecasts: projections from hourly velocity snapshots, honestly labeled; forecasts unlock after 3 snapshots per topic",
              "- [forecast-accuracy.html](forecast-accuracy.html) — the Oracle's own scorecard: per-horizon accuracy, by-call breakdown, recent resolutions, current 48h projections; hit rate appears only after 10+ forecasts resolve (honest 'building history' before that)",
              "- [oracle-board.html](oracle-board.html) — the Oracle Board: a forecast-explorer over the ledger — every recorded call with its real stored trajectory, window readiness, and (after Resolution Night) its verdict",
              "- [formats.html](formats.html) — the tracked meme format families: current examples, evidence, verification flags; formats are reusable templates to join",
              "- [launch-plan.html](launch-plan.html) — 7-day content battle plans from each topic's own angles/hooks/hashtags (printable, copy-as-text)", "",
              "## Algorithm mechanics (Oct 2026)", "- [algorithms.html](algorithms.html) — what TikTok, YouTube Shorts, and Instagram Reels reward right now: signal hierarchies, the Oct 1 Shorts originality update, cross-platform breakout consensus; sourced and dated", "",
              "Freshness: every topic carries first_seen/last_seen; stale (>72h) topics are flagged."]
    with open(os.path.join(ROOT, "llms.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")

    full = ["# Trend Machine — full briefing", f"Generated {data['generated_at']}", ""]
    for t in topics:
        full.append(f"## {t['title']}")
        full.append(f"Category: {t['category']} | Platforms: {', '.join(t['platforms'])} | "
                    f"Opportunity {t['opportunity_score']} | Velocity {t['velocity']} | "
                    f"Last seen {t['last_seen']}" + (" | STALE" if t.get("stale") else ""))
        full.append(t["summary"])
        if t.get("hashtags"):
            full.append("Hashtags: " + " ".join(t["hashtags"]))
        for i, a in enumerate(t.get("angles", []), 1):
            full.append(f"Angle {i}: {a}")
        for h in t.get("hooks", []):
            full.append(f'Hook: "{h}"')
        full.append("")
    with open(os.path.join(ROOT, "llms-full.txt"), "w") as f:
        f.write("\n".join(full))
    print("[build] data/v1 + llms.txt + llms-full.txt done")

if __name__ == "__main__":
    main()
