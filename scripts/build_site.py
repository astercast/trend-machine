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
    "phase-0": ("phase-0-start-from-nothing.html", "Phase 0: Start from nothing"),
    "phase-1": ("phase-1-content-engine.html", "Phase 1: The content engine"),
    "phase-4": ("phase-4-audience-to-community.html", "Phase 4: Audience to community"),
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
<title>{title} · Trend Machine</title>
<meta name="description" content="{desc}">
<meta name="theme-color" content="#0a0c10">
<meta property="og:type" content="website">
<meta property="og:title" content="{title} · Trend Machine">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="https://trend-machine-live.vercel.app/assets/og-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title} · Trend Machine">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="https://trend-machine-live.vercel.app/assets/og-card.png">
<link rel="canonical" href="https://trend-machine-live.vercel.app/topics/{tid}.html">
<script type="application/ld+json">{jsonld}</script>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
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
        return f'<li><span class="src-name">{nm}</span> <em class="src-unverified">(unverified, confirm live)</em></li>'
    sources = "".join(src_li(s) for s in t.get("sources", [])) or "<li>No public sources captured yet.</li>"
    angles = "".join(
        f'<div class="angle"><span class="idx num">{i+1:02d}</span><p>{esc(a)}</p></div>'
        for i, a in enumerate(t.get("angles", []))) or "<p>No angles yet. Check back after the next refresh.</p>"
    hooks = "".join(f'<div class="hook">&ldquo;{esc(h)}&rdquo;</div>' for h in t.get("hooks", []))
    watch = esc(", ".join(t.get("who_to_watch", [])) or "—")
    guide = "".join(f'<li><a href="{esc(u)}">{esc(l)}</a></li>' for u, l in guide_links(t.get("guide_links"))) \
        or '<li><a href="' + esc(GUIDE_BASE) + '">Creator Growth Empire guide</a></li>'
    stale_note = ('<p><span class="stale-badge">STALE</span> '
                  '<span style="font-size:13px;color:var(--ink-faint)">No corroboration in 72h+. Treat as cooling.</span></p>'
                  if t.get("stale") else "")
    # Commons round 10: honest Article JSON-LD from the topic record's own
    # fields only (title / summary / first_seen / last_seen) — no ratings,
    # no metrics, nothing the record does not already hold.
    _art = {"@context": "https://schema.org", "@type": "Article",
            "headline": t["title"], "description": t["summary"][:150],
            "url": "https://trend-machine-live.vercel.app/topics/"
                   + t["id"] + ".html",
            "publisher": {"@type": "Organization", "name": "Trend Machine",
                          "url": "https://trend-machine-live.vercel.app/"}}
    if t.get("first_seen"):
        _art["datePublished"] = t["first_seen"]
    if t.get("last_seen"):
        _art["dateModified"] = t["last_seen"]
    jsonld = json.dumps(_art, ensure_ascii=False).replace("</", "<\\/")
    return TOPIC_TMPL.format(
        title=esc(t["title"]), desc=esc(t["summary"][:150]),
        tid=esc(t["id"]), jsonld=jsonld,
        kicker=esc(t.get("category", "trend")) + " · dossier",
        summary=esc(t["summary"]), tier=tier, fcls=fcls, pulse=pulse, age=age,
        ocls=ocls, opp=opp, vel=vel, nplat=nplat, plats=plats, tchip=tchip, cats=cats,
        formats=formats + famchip, spark=spark, payload=payload,
        tags=tags,
        stale_note=stale_note, summary_long=esc(t["summary"]),
        sources=sources, angles=angles, hooks=hooks, watch=watch,
        guide=guide, ts=esc(t.get("last_seen", "")))

# ---------------------------------------------------------------------------
# VP-0001 (wave 30): homepage static fallback rows.
# The board (hot5 / meme radar / all-signals table / ticker / hero stats) is
# rendered client-side from data/v1/trends.json. Before wave 30 the static
# HTML shipped EMPTY containers, so any slow or interrupted data path left a
# permanent loading state (Visitor Panel ticket VP-0001). The build now bakes
# the top rows from the same stored data between TMFB markers in index.html;
# app.js/makeover.js replace them wholesale when live data lands, and if the
# data path fails the visitor still gets real rows labeled as a static
# snapshot (plus the app.js watchdog raises the DATA LINK LOST banner).
# Markup mirrors assets/js/app.js renderHot5/renderRadar/renderTable/
# renderTicker exactly so styling and layout are identical.
TMFB_TABLE_ROWS = 30


def _fb_parse(iso):
    try:
        return datetime.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except Exception:
        return None


def _fb_fresh(iso, ref):
    t = _fb_parse(iso)
    if t is None or ref is None:
        return '<span class="fresh f-dead"><span class="dot" aria-hidden="true"></span>—</span>'
    m = max(0.0, (ref - t).total_seconds() / 60.0)
    if m < 60:
        cls, label = "f-live", "%dm ago" % max(1, round(m))
    elif m < 1440:
        cls, label = "f-warm", "%dh ago" % round(m / 60)
    else:
        cls, label = "f-dead", "%dd ago" % round(m / 1440)
    pulse = " pulse" if cls == "f-live" else ""
    return ('<span class="fresh %s"><span class="dot%s" aria-hidden="true"></span>%s</span>'
            % (cls, pulse, label))


def _fb_score(v):
    v = int(v or 0)
    cls = "hot" if v >= 70 else "warm" if v >= 40 else ""
    return ('<span class="score %s"><span class="score-bar" role="img" aria-label="score %d of 100">'
            '<i style="width:%d%%"></i></span><span class="num">%d</span></span>' % (cls, v, v, v))


def _fb_region(page, name, inner):
    pat = re.compile(r"(<!--TMFB:%s:BEGIN-->).*?(<!--TMFB:%s:END-->)" % (name, name), re.S)
    if not pat.search(page):
        print("[build] WARN home-fallback: marker %s missing in index.html" % name)
        return page
    return pat.sub(lambda m: m.group(1) + inner + m.group(2), page, count=1)



def _fb_wire_items(topics, generated_at):
    def key(t):
        return t.get("last_seen") or ""
    newest = sorted(topics, key=key, reverse=True)[:14]
    out = []
    for t in newest:
        dt = _fb_parse(t.get("last_seen"))
        stamp = dt.strftime("%b %-d · %H:%M") if dt else "no stamp"
        out.append('<li class="wire-item"><span class="wire-time">%s</span>'
                   '<a href="topics/%s.html">%s</a></li>'
                   % (stamp, esc(t["id"]), esc(t.get("title"))))
    return "".join(out)


def write_home_fallback(topics, generated_at, merged=None, board=None):
    path = os.path.join(ROOT, "index.html")
    with open(path) as f:
        page = f.read()
    ref = _fb_parse(generated_at)
    by_opp = sorted(topics, key=lambda t: -(t.get("opportunity_score") or 0))
    # wave 39 (VP-0011): the phenomenon-merged view drives the board,
    # ticker, radar and desk fallback; hot5 stays the RAW stored top 5 —
    # validate_api.py pins it to the canonical record, and the section is
    # labelled as exactly that (the unfiltered record, one layer down).
    merged = merged if merged is not None else topics
    by_opp_m = sorted(merged, key=lambda t: (-(t.get("opportunity_score") or 0),
                                             -(t.get("velocity") or 0)))

    hot = []
    for i, t in enumerate(by_opp[:5]):
        leader = i == 0
        hot.append(
            '<a class="hot-card%s" style="--i:%d" href="topics/%s.html">%s'
            '<span class="rank num">0%d</span><div><h3>%s</h3><p>%s</p></div>'
            '<div class="card-foot">%s%s</div></a>'
            % (" leader" if leader else "", i, esc(t["id"]),
               '<span class="badge-breaking">Breaking</span>' if leader else "",
               i + 1, esc(t.get("title")), esc(t.get("summary")),
               _fb_score(t.get("opportunity_score")), _fb_fresh(t.get("last_seen"), ref)))
    page = _fb_region(page, "hot5", "".join(hot))

    memes = sorted((t for t in merged if t.get("category") == "meme"),
                   key=lambda t: -(t.get("velocity") or 0))[:10]
    radar = []
    for i, t in enumerate(memes):
        radar.append(
            '<a class="meme-card" style="--i:%d" href="topics/%s.html">'
            '<div class="fmt num">◉ MEME · v%s</div><h4>%s</h4>'
            '<div class="mhash">%s</div>%s</a>'
            % (i, esc(t["id"]), t.get("velocity") or 0, esc(t.get("title")),
               " ".join(esc(h) for h in (t.get("hashtags") or [])[:3]),
               _fb_fresh(t.get("last_seen"), ref)))
    page = _fb_region(page, "radar", "".join(radar))
    page = _fb_region(page, "radarcount",
                      "%d meme signals tracked · static snapshot" % len(memes))

    rows = []
    for i, t in enumerate(by_opp_m[:TMFB_TABLE_ROWS]):
        stale = bool(t.get("stale"))
        aka = ""
        if t.get("merged_from"):
            aka = ('<div class="topic-aka">also tracked as: %s. One phenomenon, '
                   'evidence combined</div>'
                   % esc(" · ".join(x["title"] for x in t["merged_from"])))
        rows.append(
            '<tr%s style="--i:%d"><td data-label="Topic"><a class="topic-link" href="topics/%s.html">%s</a>%s'
            '<div class="topic-cat">%s</div>%s</td>'
            '<td data-label="Platforms">%s</td>'
            '<td data-label="Opportunity">%s</td>'
            '<td data-label="Velocity">%s</td>'
            '<td data-label="Trend">—</td>'
            '<td data-label="Detected">%s</td></tr>'
            % (' class="is-stale"' if stale else '', min(i, 12),
               esc(t["id"]), esc(t.get("title")),
               ' <span class="stale-badge">STALE</span>' if stale else "",
               esc(t.get("category")), aka,
               "".join('<span class="chip plat">%s</span>' % esc(p)
                       for p in (t.get("platforms") or [])),
               _fb_score(t.get("opportunity_score")), _fb_score(t.get("velocity")),
               _fb_fresh(t.get("last_seen"), ref)))
    page = _fb_region(page, "table", "".join(rows))
    page = _fb_region(page, "tablemeta",
                      "%d of %d phenomena · %d topics tracked · static snapshot. The live board replaces this on load"
                      % (min(TMFB_TABLE_ROWS, len(merged)), len(merged), len(topics)))

    # wave 39 (VP-0011): the One-Look Creator Board, baked as the first
    # screen's static fallback (assets/js/board.js re-renders it from
    # data/v1/board.json when the live payload lands).
    if board is not None:
        page = _fb_region(page, "wire", _fb_wire_items(topics, generated_at))
        page = _fb_region(page, "board",
                          "".join(_fb_board_row(e) for e in board["make_now"]))
        page = _fb_region(page, "boardnews",
                          "".join(_fb_board_row(e) for e in board["news_watch"]))
        page = _fb_region(page, "boardnote", esc(board["note"]))
        page = _fb_region(page, "hsmakenow", str(board["counts"]["makeable_shown"]))

    if ref is not None:
        stamp = ref.strftime("%b %-d, %Y, %-I:%M %p UTC")
    else:
        stamp = esc(generated_at)
    page = _fb_region(page, "datats",
                      'data: <span class="num">%s</span> · static snapshot' % stamp)
    page = _fb_region(page, "hstopics", str(len(topics)))
    plats = set()
    for t in topics:
        plats.update(t.get("platforms") or [])
    page = _fb_region(page, "hsplatforms", str(len(plats)))

    with open(path, "w") as f:
        f.write(page)
    print("[build] home fallback: %d hot / %d radar / %d table rows baked into index.html"
          % (min(5, len(topics)), len(memes), min(TMFB_TABLE_ROWS, len(topics))))


# ---------------------------------------------------------------------------
# Wave 39 (rotation 20 · VP-0011): the One-Look Creator Board.
# The home's first screen is a ranked "make now" list: each entry carries
# the topic, the evidence it is rising (chips derived from the stored
# record — platforms, velocity, saturation, the topic's own snapshot
# count, source names, hashtags), and the angle a creator would
# make (the topic's stored first angle + its format). This builder is
# the Python mirror of assets/js/board-lib.js; both implement the same
# two rules and scripts/test_board_lib.js pins the JS half:
#   1. PHENOMENON_MERGES — one phenomenon, one row, evidence combined,
#      score recomputed with the pipeline's own formula. The canonical
#      store is never rewritten; the merge is re-derived every build.
#   2. kind: category "news" is straight news — labelled, listed apart,
#      never mixed into the make-now ranking.
# The score's honest name (printed on the board itself): the
# OPPORTUNITY INDEX, 0-100 = round(velocity x (1 - saturation penalty))
# — velocity is spread speed (pipeline/normalize.py: corroboration +
# recency; seeded topics carry documented editorial estimates),
# saturation discounts lanes already crowded with creators. It is not
# a percentage rise and it promises no views: per the rotation-20
# research rule, view-pull evidence is thin, so the board prints
# evidence chips, never an uplift figure.
PHENOMENON_MERGES = {"seis-sete-dance": "six-seven-meme"}
_SAT_PEN = {"low": 0.0, "medium": 0.35, "high": 0.6}
_SAT_LABEL = {"low": "saturation low: lane uncrowded",
              "medium": "saturation medium: lane filling",
              "high": "saturation high: lane crowded"}
BOARD_MAKE_CAP = 7
BOARD_NEWS_CAP = 3


def _union(a, b, key=None):
    out, seen = [], set()
    for x in list(a or []) + list(b or []):
        k = key(x) if key else x
        if k not in seen:
            seen.add(k)
            out.append(x)
    return out


def merge_phenomena(topics):
    """Fold each absorbed topic into its canonical row (evidence
    combined, velocity = max, saturation = the less crowded of the
    pair, opportunity recomputed by formula). A merge whose canonical
    id is absent leaves the absorbed topic in place — a merge never
    deletes data. Mirrors TM_BoardLib.mergeTopics."""
    by_id = {t["id"]: t for t in topics}
    absorbed = {a: c for a, c in PHENOMENON_MERGES.items()
                if a in by_id and c in by_id and a != c}
    if not absorbed:
        return list(topics)
    out = []
    for t in topics:
        if t["id"] in absorbed:
            continue
        abs_ids = [a for a, c in absorbed.items() if c == t["id"]]
        if not abs_ids:
            out.append(t)
            continue
        m = dict(t)
        m["merged_from"] = []
        for abs_id in abs_ids:
            a = by_id[abs_id]
            m["merged_from"].append({"id": a["id"], "title": a.get("title")})
            m["platforms"] = _union(m.get("platforms"), a.get("platforms"))
            m["hashtags"] = _union(m.get("hashtags"), a.get("hashtags"))
            m["sources"] = _union(m.get("sources"), a.get("sources"),
                                  key=lambda s: s.get("name"))
            m["angles"] = _union(m.get("angles"), a.get("angles"))
            m["hooks"] = _union(m.get("hooks"), a.get("hooks"))
            m["format_tags"] = _union(m.get("format_tags"), a.get("format_tags"))
            m["velocity"] = max(m.get("velocity") or 0, a.get("velocity") or 0)
            sat = m.get("saturation")
            if _SAT_PEN.get(a.get("saturation"), 0) < _SAT_PEN.get(sat, 0):
                sat = a.get("saturation")
            m["saturation"] = sat
            if (a.get("last_seen") or "") > (m.get("last_seen") or ""):
                m["last_seen"] = a.get("last_seen")
        m["opportunity_score"] = round((m.get("velocity") or 0)
                                       * (1 - _SAT_PEN.get(m.get("saturation"), 0)))
        out.append(m)
    return out


def _board_snapshot_chip(n):
    # Retirement (2026-10-13): the board's third evidence chip used to be
    # the Oracle's forecast call for the topic. The prediction layer is
    # retired; the chip is now a pure readout — how many real velocity
    # snapshots stand behind the row.
    if not n:
        return "no velocity snapshots yet"
    return "tracked across %d velocity snapshots" % n


def _board_movement(pts):
    if not pts or len(pts) < 2:
        return None
    try:
        delta = (pts[-1][1] or 0) - (pts[-2][1] or 0)
    except Exception:
        return None
    if delta >= 3:
        return "rising"
    if delta <= -3:
        return "cooling"
    return "steady"


def _board_entry(t, rank, n_snapshots, movement=None, splash=False,
                 spark_svg=None):
    names = [s.get("name") for s in (t.get("sources") or []) if s.get("name")]
    evidence = ["velocity %d/100" % (t.get("velocity") or 0),
                _SAT_LABEL.get(t.get("saturation"),
                               "saturation %s" % t.get("saturation")),
                _board_snapshot_chip(n_snapshots)]
    if len(names) == 1:
        evidence.append("source: %s" % names[0])
    elif names:
        evidence.append("sources: %s" % " + ".join(names[:3]))
    evidence.extend((t.get("hashtags") or [])[:2])
    age, _, _ = age_label(t.get("last_seen", ""))
    if age != "unknown":
        evidence.append("last seen %s" % age)
    if t.get("verification") and t.get("verification") != "verified":
        evidence.append("verification: %s, confirm live before building on it"
                        % t["verification"])
    fmt = (t.get("format_tags") or [None])[0] or t.get("category")
    return {
        "rank": rank, "id": t["id"], "title": t.get("title"),
        "aka": [x["title"] for x in (t.get("merged_from") or [])],
        "merged_from": [x["id"] for x in (t.get("merged_from") or [])],
        "url": "topics/%s.html" % t["id"],
        "kind": "news" if t.get("category") == "news" else "makeable",
        "category": t.get("category"),
        "opportunity_score": t.get("opportunity_score") or 0,
        "velocity": t.get("velocity") or 0,
        "saturation": t.get("saturation"),
        "platforms": t.get("platforms") or [],
        "hashtags": t.get("hashtags") or [],
        "format": fmt,
        "angle": (t.get("angles") or [None])[0],
        "evidence": evidence,
        "last_seen": t.get("last_seen"),
        "movement": movement,
        "splash": splash,
        "spark_svg": spark_svg,
    }


def build_board(topics, merged, generated_at, history=None):
    history = history or {}
    live = [t for t in merged if not t.get("stale")]
    by_score = lambda t: (-(t.get("opportunity_score") or 0),
                          -(t.get("velocity") or 0))
    make = sorted((t for t in live if t.get("category") != "news"),
                  key=by_score)[:BOARD_MAKE_CAP]
    news = sorted((t for t in live if t.get("category") == "news"),
                  key=by_score)[:BOARD_NEWS_CAP]
    merges = []
    for t in merged:
        if t.get("merged_from"):
            merges.append({
                "canonical_id": t["id"], "canonical_title": t.get("title"),
                "absorbed": t["merged_from"],
                "rule": ("One phenomenon tracked under two titles; the build "
                         "folds the absorbed listing into the canonical row "
                         "and combines its evidence. The canonical store "
                         "(data/trends.json) keeps both records — the merge "
                         "is a view, re-derived on every build.")})
    merge_txt = "; ".join(
        "%s + %s read as one phenomenon (%s)"
        % (m["canonical_title"],
           " · ".join(x["title"] for x in m["absorbed"]),
           m["canonical_id"]) for m in merges)
    note = ("%d phenomena from %d tracked topics%s. "
            "The full unfiltered record, all "
            "%d rows, stays one layer down: the desk below and "
            "data/v1/trends.json."
            % (len(merged), len(topics),
               (" — " + merge_txt) if merge_txt else "", len(topics)))
    splash_id = None
    if make and (make[0].get("opportunity_score") or 0) >= 88 \
            and (make[0].get("velocity") or 0) >= 88:
        splash_id = make[0]["id"]

    def _entry(t, i):
        pts = history.get(t["id"]) or []
        svg = None
        if t["id"] == splash_id and len(pts) >= 3:
            prep = sparkline_prep.prep_series(pts, width=560, height=110, pad=6)
            if prep is not None:
                svg = sparkline_prep.sparkline_svg(
                    prep, css_class="splash-chart",
                    label_prefix="Velocity from stored snapshots")
        return _board_entry(t, i + 1, len(pts),
                            movement=_board_movement(pts),
                            splash=(t["id"] == splash_id), spark_svg=svg)

    return {
        "generated_at": generated_at,
        "score": {
            "name": "Opportunity index",
            "unit": "index, 0 to 100",
            "formula": ("opportunity = round(velocity x (1 minus saturation "
                        "penalty)); penalties: low 0, medium 0.35, high 0.6 "
                        "(pipeline/normalize.py)"),
            "velocity": ("0 to 100 spread speed. Auto topics: min(100, "
                         "25 × corroborating sources + 15 × recency boost "
                         "+ hashtag bonus). Seeded topics carry documented "
                         "editorial estimates."),
            "saturation": ("How crowded the lane already is — high when "
                           "4+ sources track the same topic."),
            "honesty": ("An index for ranking what to make first. It is "
                        "not a percentage, not a rise, and it promises no "
                        "views. The board prints evidence lines, never an "
                        "uplift figure."),
        },
        "merges": merges,
        "counts": {"tracked": len(topics), "phenomena": len(merged),
                   "makeable_shown": len(make), "news_shown": len(news)},
        "note": note,
        "splash_id": splash_id,
        "make_now": [_entry(t, i) for i, t in enumerate(make)],
        "news_watch": [_entry(t, i) for i, t in enumerate(news)],
    }


def _fb_board_row(e):
    plats = " · ".join(esc(p) for p in e["platforms"])
    ev = "".join("<li>%s</li>" % esc(c) for c in e["evidence"])
    marg = ""
    if plats:
        marg += '<p class="board-marg board-marg-plats">On: %s</p>' % plats
    if ev:
        marg += '<ul class="board-marg">%s</ul>' % ev
    aka = ""
    if e.get("aka"):
        aka = ('<span class="board-aka">Also tracked as: %s. One phenomenon, '
               'evidence combined.</span>' % esc(" · ".join(e["aka"])))
    badge = ""
    make = ""
    if e["kind"] == "news":
        badge = '<span class="board-newsbadge">News, watch</span> '
    elif e.get("angle"):
        make = ('<p class="board-angle"><span class="board-make">Make</span> %s'
                '<span class="board-fmt"> · format: %s</span></p>'
                % (esc(e["angle"]), esc(e["format"])))
    splash = bool(e.get("splash"))
    move = ""
    if e.get("movement"):
        move = '<span class="board-move">%s</span>' % esc(e["movement"])
    if splash:
        chart = ""
        if e.get("spark_svg"):
            chart = '<figure class="splash-fig">%s</figure>' % e["spark_svg"]
        return ('<li class="board-row splash"><span class="board-rank">%d</span>'
                '<div class="board-main">%s<a class="board-title" href="%s">%s</a>%s%s</div>'
                '<div class="board-score"><span class="score-num">%d</span>'
                '<span class="board-unit">opportunity / 100</span>%s</div></li>'
                % (e["rank"], badge, esc(e["url"]), esc(e["title"]), make, chart,
                   e["opportunity_score"], move))
    return ('<li class="board-row%s"><span class="board-rank">%d</span>'
            '<div class="board-main">%s<a class="board-title" href="%s">%s</a>%s%s'
            '%s</div>'
            '<div class="board-score"><span class="score-num">%d</span>'
            '<span class="board-unit">opportunity / 100</span>%s</div></li>'
            % (" news" if e["kind"] == "news" else "",
               e["rank"], badge, esc(e["url"]), esc(e["title"]), aka, make, marg,
               e["opportunity_score"], move))


# wave 32 (Foundry round 2; round-11 placement packet): the root pages are
# hand-maintained sources, so their OG / theme-color / favicon head block is
# injected by the generator — idempotently — rather than hand-edited into
# outputs, keeping every rebuild and refresh covered. Per-page rule from the
# packet: og:title / twitter:title mirror the page's own <title>;
# og:description / twitter:description mirror its existing meta description
# — verbatim, nothing invented. og:image / twitter:image are ABSOLUTE URLs
# against the live deployment domain (Foundry round 6 catch: social
# crawlers ignore relative og:image paths). theme-color is the site's own
# declared war-room ground, tokens.css --bg. The favicon set is file-based,
# completing the site's existing radar-reticle mark (formerly only an inline
# SVG data URI) per the Foundry round-12 icon+theme proposal: geometry
# verbatim, colors token-harmonized (--bg field, --live ring/dot), files at
# the repo root — favicon.svg, favicon.ico (16/32/48), icon-192.png,
# icon-512.png, apple-touch-icon.png (full-bleed field for the iOS mask).
ROOT_PAGES = ["index.html", "live-wire.html", "streamer-desk.html",
              "formats.html", "launch-plan.html", "algorithms.html",
              "api-docs.html", "404.html"]
OG_IMAGE_URL = "https://trend-machine-live.vercel.app/assets/og-card.png"
THEME_COLOR = "#0a0c10"  # assets/css/tokens.css --bg


def inject_root_head_meta():
    import re
    icon_data = re.compile(r'<link rel="icon" href="data:image/svg\+xml,[^>]*>\n?')
    for name in ROOT_PAGES:
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            continue
        with open(path) as f:
            page = f.read()
        if "og:image" in page:
            continue  # already wired — idempotent
        mt = re.search(r"<title>(.*?)</title>", page, re.S)
        md = re.search(r'<meta name="description" content="(.*?)">', page, re.S)
        if not mt or not md:
            print(f"[build] head-meta SKIP {name}: no title/description found")
            continue
        title, desc = mt.group(1), md.group(1)
        block = (
            '<meta name="theme-color" content="' + THEME_COLOR + '">\n'
            '<meta property="og:type" content="website">\n'
            '<meta property="og:title" content="' + title + '">\n'
            '<meta property="og:description" content="' + desc + '">\n'
            '<meta property="og:image" content="' + OG_IMAGE_URL + '">\n'
            '<meta property="og:image:width" content="1200">\n'
            '<meta property="og:image:height" content="630">\n'
            '<meta name="twitter:card" content="summary_large_image">\n'
            '<meta name="twitter:title" content="' + title + '">\n'
            '<meta name="twitter:description" content="' + desc + '">\n'
            '<meta name="twitter:image" content="' + OG_IMAGE_URL + '">'
        )
        page = page.replace(md.group(0), md.group(0) + "\n" + block, 1)
        icons = (
            '<link rel="icon" href="/favicon.ico" sizes="48x48">\n'
            '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n'
            '<link rel="apple-touch-icon" href="/apple-touch-icon.png">'
        )
        page, n = icon_data.subn(icons + "\n", page, count=1)
        if not n:
            print(f"[build] head-meta WARN {name}: inline icon link not found")
        with open(path, "w") as f:
            f.write(page)
        print(f"[build] head-meta wired {name}")


LIVE_BASE = "https://trend-machine-live.vercel.app"


def _ld_script(obj):
    return ('<script type="application/ld+json">'
            + json.dumps(obj, ensure_ascii=False).replace("</", "<\\/")
            + "</script>")


def _read_json(rel):
    try:
        with open(os.path.join(ROOT, rel)) as f:
            return json.load(f)
    except Exception:
        return None


def inject_canonical_jsonld(topics):
    # Commons round 10: self-referential ABSOLUTE canonical on the live
    # domain for every generator-owned page — 404.html deliberately gets
    # none (a 404 has no canonical self) — plus honest JSON-LD built ONLY
    # from fields the site's own data already holds:
    #   topics/*.html  Article, in TOPIC_TMPL/build_topic (headline /
    #     description / datePublished / dateModified from the record).
    #   index.html     ItemList — the board's top 30 in the same
    #     opportunity order the VP-0001 static fallback bakes
    #     (position / name / dossier URL per item, nothing else).
    #   streamer-desk  ItemList of Person(name) from the curated desk
    #     source's streamers[] — names only; no metrics exist to claim.
    #   live-wire      ItemList of lane labels from the wire payload.
    import re
    for name in ROOT_PAGES:
        if name == "404.html":
            continue
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            continue
        with open(path) as f:
            page = f.read()
        if 'rel="canonical"' in page:
            continue  # idempotent
        md = re.search(r'<meta name="description" content="(.*?)">', page, re.S)
        desc = md.group(1) if md else ""
        canon = LIVE_BASE + "/" + ("" if name == "index.html" else name)
        extra = ['<link rel="canonical" href="' + canon + '">']
        ld = None
        if name == "index.html":
            by_opp = sorted(topics,
                            key=lambda t: -(t.get("opportunity_score") or 0))
            ld = {"@context": "https://schema.org", "@type": "ItemList",
                  "name": "Trend Machine board - top topics by opportunity",
                  "numberOfItems": min(30, len(by_opp)),
                  "itemListElement": [
                      {"@type": "ListItem", "position": i + 1,
                       "name": t["title"],
                       "url": LIVE_BASE + "/topics/" + t["id"] + ".html"}
                      for i, t in enumerate(by_opp[:30])]}
        elif name == "streamer-desk.html":
            src = _read_json(os.path.join("data", "streamer_desk.json")) or {}
            names = [s.get("name") for s in src.get("streamers", [])
                     if s.get("name")]
            if names:
                ld = {"@context": "https://schema.org", "@type": "ItemList",
                      "name": "Streamer Desk - streamer directory",
                      "numberOfItems": len(names),
                      "itemListElement": [
                          {"@type": "ListItem", "position": i + 1,
                           "item": {"@type": "Person", "name": n}}
                          for i, n in enumerate(names)]}
        elif name == "live-wire.html":
            wire = _read_json(os.path.join("data", "v1", "live-wire.json")) or {}
            labels = [l.get("label") for l in wire.get("lanes", [])
                      if l.get("label")]
            if labels:
                ld = {"@context": "https://schema.org", "@type": "ItemList",
                      "name": "Live Wire - source lanes",
                      "numberOfItems": len(labels),
                      "itemListElement": [
                          {"@type": "ListItem", "position": i + 1, "name": n}
                          for i, n in enumerate(labels)]}
        if ld:
            extra.append(_ld_script(ld))
        anchor = '<link rel="icon" href="/favicon.ico"'
        if anchor not in page:
            print(f"[build] canonical SKIP {name}: icon anchor not found")
            continue
        page = page.replace(anchor, "\n".join(extra) + "\n" + anchor, 1)
        with open(path, "w") as f:
            f.write(page)
        print(f"[build] canonical wired {name}")


def write_robots_txt():
    # Commons round 8 (robots.txt): the fleet census found robots.txt in
    # ZERO of 9 repos. Minimal allow-all; this repo publishes no sitemap,
    # so no Sitemap: pointer is emitted (never invent one). Emitted by the
    # generator on every build, so it survives rebuilds and refreshes.
    with open(os.path.join(ROOT, "robots.txt"), "w") as f:
        f.write("# Trend Machine - generated by scripts/build_site.py "
                "(Commons round 8). Allow-all; no sitemap is published.\n"
                "User-agent: *\nAllow: /\n")
    print("[build] robots.txt written")


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
    # wave 39 (VP-0011): the One-Look Creator Board payload. Evidence
    # chips carry each topic's real snapshot count from the velocity
    # history loaded above (the prediction layer was retired 2026-10-13 —
    # the board makes no forward calls).
    merged_topics = merge_phenomena(topics)
    board = build_board(topics, merged_topics, data["generated_at"],
                        history=history)
    with open(os.path.join(api, "board.json"), "w") as f:
        json.dump(board, f, indent=2, ensure_ascii=False)
    print(f"[build] data/v1/board.json ({board['counts']['makeable_shown']} make-now / "
          f"{board['counts']['news_shown']} news / {board['counts']['phenomena']} phenomena "
          f"from {board['counts']['tracked']} topics)")
    # VP-0001: bake the homepage static fallback rows from the same payload
    write_home_fallback(topics, data["generated_at"],
                        merged=merged_topics, board=board)
    # wave 32: OG / theme-color / favicon head wiring on the root pages
    inject_root_head_meta()
    # Commons round 8: robots.txt, regenerated every build
    write_robots_txt()
    # Commons round 10: canonical + honest JSON-LD on the root pages
    inject_canonical_jsonld(topics)
    tags = {}
    for t in topics:
        for h in t.get("hashtags", []):
            tags.setdefault(h, []).append(t["id"])
    with open(os.path.join(api, "hashtags.json"), "w") as f:
        json.dump({"generated_at": data["generated_at"], "tags": tags}, f, indent=2)
    # data/v1/velocity.json — hourly velocity snapshots, the exact
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
            "title": "trend-machine lifecycle layer",
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
            "description": "Per-topic hourly velocity/opportunity snapshots, ascending by timestamp. Points are [iso_ts, velocity, opportunity].",
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
        "live-wire": {
            "$schema": DRAFT,
            "title": "trend-machine Live Wire",
            "description": ("Wave 28: the pipeline command view. One row per "
                            "fetcher wired into pipeline/refresh.sh, with the "
                            "hit count and health the pipeline itself recorded "
                            "in pipeline/out/*.json — live (rewritten by the "
                            "latest refresh, hits > 0), degraded (rewritten, "
                            "0 hits), stale-skip (not rewritten; stored hits "
                            "dated and excluded from the current total), or "
                            "skip-by-design (TikTok / X write no file and "
                            "claim no hits), or retired (the YouTube "
                            "Invidious / direct lane, closed 2026-10-13 in "
                            "DATAOPS-001: out of refresh.sh, stored file "
                            "deleted, reason shown, no hits). Plus the "
                            "hour's top movers: "
                            "latest stored velocity vs the latest stored "
                            "point at or before 1h earlier, merged live + "
                            "archive history, real span published per mover."),
            "type": "object",
            "required": ["generated_at", "refresh_at", "method", "honesty",
                         "provenance", "counts", "lanes", "movers"],
            "properties": {
                "generated_at": {"type": "string"},
                "refresh_at": {"type": ["string", "null"]},
                "method": {"type": "string"},
                "honesty": {"type": "string"},
                "provenance": {"type": "object"},
                "counts": {"type": "object",
                    "required": ["lanes", "lanes_live", "lanes_degraded",
                                 "lanes_stale_skip", "lanes_skip_by_design",
                                 "lanes_retired",
                                 "current_hits", "stale_hits_excluded",
                                 "topics_live", "movers_with_hour_pair",
                                 "gainers", "fallers", "flat"],
                    "properties": {
                        "lanes": {"type": "integer", "minimum": 0},
                        "lanes_live": {"type": "integer", "minimum": 0},
                        "lanes_degraded": {"type": "integer", "minimum": 0},
                        "lanes_stale_skip": {"type": "integer", "minimum": 0},
                        "lanes_skip_by_design": {"type": "integer", "minimum": 0},
                        "lanes_retired": {"type": "integer", "minimum": 0},
                        "current_hits": {"type": "integer", "minimum": 0},
                        "stale_hits_excluded": {"type": "integer", "minimum": 0},
                        "topics_live": {"type": "integer", "minimum": 0},
                        "movers_with_hour_pair": {"type": "integer", "minimum": 0},
                        "gainers": {"type": "integer", "minimum": 0},
                        "fallers": {"type": "integer", "minimum": 0},
                        "flat": {"type": "integer", "minimum": 0}}},
                "lanes": {"type": "array",
                    "items": {"type": "object",
                        "required": ["id", "label", "fetcher", "output_file",
                                     "status", "hits", "current_hits",
                                     "sources", "newest_fetched_at",
                                     "file_written_at", "detail"],
                        "properties": {
                            "id": {"type": "string"},
                            "label": {"type": "string"},
                            "fetcher": {"type": "string"},
                            "output_file": {"type": ["string", "null"]},
                            "status": {"type": "string",
                                       "enum": ["live", "degraded",
                                                "stale-skip",
                                                "skip-by-design",
                                                "retired"]},
                            "hits": {"type": "integer", "minimum": 0},
                            "current_hits": {"type": "integer", "minimum": 0},
                            "sources": {"type": "array",
                                        "items": {"type": "string"}},
                            "newest_fetched_at": {"type": ["string", "null"]},
                            "file_written_at": {"type": ["string", "null"]},
                            "detail": {"type": "string"}}}},
                "movers": {"type": "object",
                    "required": ["window", "topics_with_series",
                                 "with_hour_pair", "gainers", "fallers"],
                    "properties": {
                        "window": {"type": "string"},
                        "topics_with_series": {"type": "integer", "minimum": 0},
                        "with_hour_pair": {"type": "integer", "minimum": 0},
                        "gainers": {"$ref": "#/definitions/movers"},
                        "fallers": {"$ref": "#/definitions/movers"}}},
            },
            "definitions": {
                "movers": {"type": "array",
                    "items": {"type": "object",
                        "required": ["topic_id", "title", "topic_live",
                                     "platforms", "from_velocity",
                                     "to_velocity", "delta", "from_ts",
                                     "to_ts", "span_hours", "n_points"],
                        "properties": {
                            "topic_id": {"type": "string"},
                            "title": {"type": "string"},
                            "topic_live": {"type": "boolean"},
                            "platforms": {"type": "array",
                                          "items": {"type": "string"}},
                            "from_velocity": {"type": "number"},
                            "to_velocity": {"type": "number"},
                            "delta": {"type": "number"},
                            "from_ts": {"type": "string"},
                            "to_ts": {"type": "string"},
                            "span_hours": {"type": "number", "minimum": 0},
                            "n_points": {"type": "integer", "minimum": 0}}}},
            },
        },
        "streamer-desk": {
            "$schema": DRAFT,
            "title": "trend-machine Streamer Desk",
            "description": ("Wave 29: the Streamer Desk payload, built by "
                            "scripts/build_streamer_desk.js from the curated "
                            "data/streamer_desk.json. Directory profiles and "
                            "houses carry named sources; drama timelines are "
                            "verified only when their events trace to 2+ "
                            "distinct source domains (the generator refuses "
                            "to publish otherwise); unverified claims are "
                            "quarantined with their reason; rosters are "
                            "dated as-of claims; event status (past / "
                            "happening-now / upcoming) is computed from "
                            "dates at build time."),
            "type": "object",
            "required": ["generated_at", "curated_at", "method",
                         "sourcing_standard", "honesty", "provenance",
                         "counts", "streamers", "updates", "drama",
                         "unverified", "houses", "events", "feeds"],
            "properties": {
                "generated_at": {"type": "string"},
                "curated_at": {"type": ["string", "null"]},
                "method": {"type": "string"},
                "sourcing_standard": {"type": "object"},
                "honesty": {"type": "string"},
                "provenance": {"type": "object"},
                "counts": {"type": "object",
                    "required": ["streamers", "houses", "updates",
                                 "drama_verified", "unverified",
                                 "drama_source_domains", "events",
                                 "events_upcoming", "events_past",
                                 "feeds_skip_by_design"],
                    "properties": {
                        "streamers": {"type": "integer", "minimum": 0},
                        "houses": {"type": "integer", "minimum": 0},
                        "updates": {"type": "integer", "minimum": 0},
                        "drama_verified": {"type": "integer", "minimum": 0},
                        "unverified": {"type": "integer", "minimum": 0},
                        "drama_source_domains": {"type": "integer", "minimum": 0},
                        "events": {"type": "integer", "minimum": 0},
                        "events_upcoming": {"type": "integer", "minimum": 0},
                        "events_past": {"type": "integer", "minimum": 0},
                        "feeds_skip_by_design": {"type": "integer", "minimum": 0}}},
                "streamers": {"type": "array", "items": {"type": "object",
                    "required": ["id", "name", "platforms", "categories",
                                 "note", "as_of", "sources"],
                    "properties": {
                        "id": {"type": "string"}, "name": {"type": "string"},
                        "platforms": {"type": "array", "items": {"type": "string"}},
                        "categories": {"type": "array", "items": {"type": "string"}},
                        "crew": {"type": ["string", "null"]},
                        "note": {"type": "string"},
                        "as_of": {"type": "string"},
                        "sources": {"$ref": "#/definitions/sources"}}}},
                "updates": {"type": "array", "items": {"type": "object",
                    "required": ["id", "date", "kind", "title", "summary",
                                 "streamer_ids", "sources"],
                    "properties": {
                        "id": {"type": "string"}, "date": {"type": "string"},
                        "kind": {"type": "string"}, "title": {"type": "string"},
                        "summary": {"type": "string"},
                        "streamer_ids": {"type": "array", "items": {"type": "string"}},
                        "sources": {"$ref": "#/definitions/sources"}}}},
                "drama": {"type": "array", "items": {"type": "object",
                    "required": ["id", "title", "status", "note", "timeline"],
                    "properties": {
                        "id": {"type": "string"}, "title": {"type": "string"},
                        "status": {"const": "verified"},
                        "note": {"type": "string"},
                        "timeline": {"type": "array", "items": {"type": "object",
                            "required": ["date", "event", "sources"],
                            "properties": {
                                "date": {"type": "string"},
                                "event": {"type": "string"},
                                "sources": {"$ref": "#/definitions/sources"}}}}}}},
                "unverified": {"type": "array", "items": {"type": "object",
                    "required": ["id", "title", "status", "claim",
                                 "why_unverified", "sources"],
                    "properties": {
                        "id": {"type": "string"}, "title": {"type": "string"},
                        "status": {"const": "unverified"},
                        "claim": {"type": "string"},
                        "why_unverified": {"type": "string"},
                        "sources": {"$ref": "#/definitions/sources"}}}},
                "houses": {"type": "array", "items": {"type": "object",
                    "required": ["id", "name", "full_name", "base", "founded",
                                 "status", "members_as_of", "members",
                                 "content", "sources"],
                    "properties": {
                        "id": {"type": "string"}, "name": {"type": "string"},
                        "full_name": {"type": "string"},
                        "base": {"type": "string"},
                        "founded": {"type": "string"},
                        "status": {"type": "string"},
                        "members_as_of": {"type": "string"},
                        "members": {"type": "array", "items": {"type": "string"}},
                        "former_members": {"type": "array", "items": {"type": "string"}},
                        "content": {"type": "string"},
                        "sources": {"$ref": "#/definitions/sources"}}}},
                "events": {"type": "array", "items": {"type": "object",
                    "required": ["id", "name", "kind", "start", "end",
                                 "location", "note", "sources", "status"],
                    "properties": {
                        "id": {"type": "string"}, "name": {"type": "string"},
                        "kind": {"type": "string"},
                        "start": {"type": "string"}, "end": {"type": "string"},
                        "location": {"type": "string"},
                        "note": {"type": "string"},
                        "status": {"type": "string",
                                   "enum": ["past", "happening-now", "upcoming"]},
                        "sources": {"$ref": "#/definitions/sources"}}}},
                "feeds": {"type": "array", "items": {"type": "object",
                    "required": ["id", "label", "status", "detail"],
                    "properties": {
                        "id": {"type": "string"}, "label": {"type": "string"},
                        "status": {"type": "string", "enum": ["skip-by-design"]},
                        "detail": {"type": "string"}}}},
            },
            "definitions": {
                "sources": {"type": "array", "minItems": 1,
                    "items": {"type": "object",
                        "required": ["name", "url"],
                        "properties": {
                            "name": {"type": "string"},
                            "url": {"type": "string", "format": "uri"}}}},
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
    }

    # wave 39 (VP-0011): the Creator Board payload's schema.
    SCHEMAS["board"] = {
        "$schema": DRAFT,
        "title": "trend-machine Creator Board",
        "description": ("Wave 39 (VP-0011): the One-Look Creator Board — the "
                        "homepage's first screen as data. make_now: the ranked "
                        "creator-makeable picks (top 7, stale excluded, news "
                        "excluded), each with its evidence chips and the "
                        "angle to make. news_watch: straight-news topics, "
                        "labelled and listed apart (top 3). merges: the "
                        "phenomenon dedupe the build applied (one phenomenon, "
                        "one row, evidence combined; the canonical store "
                        "keeps both records). score: the opportunity index's "
                        "honest definition — an index 0-100, never a "
                        "percentage or a view promise."),
        "type": "object",
        "required": ["generated_at", "score", "merges", "counts", "note",
                     "make_now", "news_watch"],
        "properties": {
            "generated_at": {"type": "string"},
            "score": {"type": "object",
                      "required": ["name", "unit", "formula", "velocity",
                                   "saturation", "honesty"],
                      "properties": {
                          "name": {"type": "string"},
                          "unit": {"type": "string"},
                          "formula": {"type": "string"},
                          "velocity": {"type": "string"},
                          "saturation": {"type": "string"},
                          "honesty": {"type": "string"}}},
            "merges": {"type": "array",
                       "items": {"type": "object",
                                 "properties": {
                                     "canonical_id": {"type": "string"},
                                     "canonical_title": {"type": "string"},
                                     "absorbed": {"type": "array",
                                                  "items": {"type": "object"}},
                                     "rule": {"type": "string"}}}},
            "counts": {"type": "object",
                       "required": ["tracked", "phenomena", "makeable_shown",
                                    "news_shown"],
                       "properties": {
                           "tracked": {"type": "integer", "minimum": 0},
                           "phenomena": {"type": "integer", "minimum": 0},
                           "makeable_shown": {"type": "integer", "minimum": 0},
                           "news_shown": {"type": "integer", "minimum": 0}}},
            "note": {"type": "string"},
            "make_now": {"type": "array", "items": {"$ref": "#/definitions/board_entry"}},
            "news_watch": {"type": "array", "items": {"$ref": "#/definitions/board_entry"}},
        },
        "definitions": {"board_entry": {
            "type": "object",
            "required": ["rank", "id", "title", "url", "kind", "category",
                         "opportunity_score", "velocity", "platforms",
                         "format", "angle", "evidence"],
            "properties": {
                "rank": {"type": "integer", "minimum": 1},
                "id": {"type": "string"},
                "title": {"type": "string"},
                "aka": {"type": "array", "items": {"type": "string"}},
                "merged_from": {"type": "array", "items": {"type": "string"}},
                "url": {"type": "string"},
                "kind": {"type": "string", "enum": ["makeable", "news"]},
                "category": {"type": "string"},
                "opportunity_score": {"type": "integer", "minimum": 0, "maximum": 100},
                "velocity": {"type": "integer", "minimum": 0, "maximum": 100},
                "saturation": {"type": ["string", "null"]},
                "platforms": {"type": "array", "items": {"type": "string"}},
                "hashtags": {"type": "array", "items": {"type": "string"}},
                "format": {"type": "string"},
                "angle": {"type": ["string", "null"]},
                "evidence": {"type": "array", "items": {"type": "string"}},
                "last_seen": {"type": ["string", "null"]}}}},
    }

    for sname, sdoc in SCHEMAS.items():
        with open(os.path.join(api, "schema", sname + ".json"), "w") as f:
            json.dump(sdoc, f, indent=2)
    print(f"[build] {len(SCHEMAS)} endpoint schemas -> data/v1/schema/")

    # ---- self-describing manifest (wave 5) ----
    stamp = data["generated_at"]
    live = [t for t in topics if not t.get("stale")]
    seeded = [t for t in topics if t.get("seeded")]

    def endpoint(path, description, schema=None, records=None, notes=None,
                 updated=None, js_order=False):
        # js_order: the entries the downstream JS builders rebuild use
        # their object key order (path, description, schema, updated, …);
        # matching it keeps a standalone build byte-identical to the
        # committed manifest apart from timestamps.
        e = {"path": path, "description": description}
        if js_order and schema:
            e["schema"] = schema
        e["updated"] = updated if updated is not None else stamp
        if schema and not js_order:
            e["schema"] = schema
        if records is not None:
            e["records"] = records
        if notes:
            e["notes"] = notes
        return e

    # Wave 34 (manifest-drift fix): this generator owns the WHOLE
    # manifest. It emits the current version directly — including the
    # entries whose payloads the downstream builders own, whose
    # records/updated are read from the payload files already on disk
    # (the same values the downstream patchers re-stamp with fresh
    # ones when they run later in refresh.sh). A standalone
    # build_site.py run therefore never regresses the manifest.
    def _on_disk(name):
        try:
            with open(os.path.join(api, name)) as f:
                return json.load(f)
        except Exception:
            return {}

    _life_disk = _on_disk("lifecycle.json")
    _wire_disk = _on_disk("live-wire.json")
    _desk_disk = _on_disk("streamer-desk.json")

    manifest = {
        "name": "trend-machine",
        "version": "0.8.0",
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
                ("Hourly velocity/opportunity snapshots per topic, "
                 "ascending by timestamp. Classify with assets/js/trajectory.js "
                 "(UMD — loadable in node)."),
                schema_path("velocity"), len(history),
                "Snapshots are real pipeline observations; topics with <3 snapshots are still building history."),
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
                ("Ignition/burnout lifecycle layer: every topic's current "
                 "lifecycle stage (building/steady/warming/igniting/peaking/"
                 "cooling/burned-out) classified from its real velocity "
                 "snapshots, per-topic stage ribbons, and the last-24h "
                 "ignitions/burnouts boards. Stages use the classifier's own "
                 "thresholds (ignition line v=70, rise/fall ±1.5/hr) — "
                 "readouts, not predictions."),
                schema_path("lifecycle"),
                len(_life_disk.get("topics", {})) or len(topics),
                "Stages are computed from the same velocity snapshots as data/v1/velocity.json; the boards show transitions that actually happened in the last 24h.",
                updated=_life_disk.get("generated_at"), js_order=True),
            "board": endpoint(
                "data/v1/board.json",
                ("Wave 39 (VP-0011): the One-Look Creator Board — the "
                 "homepage's first screen as data: the ranked make-now "
                 "picks (creator-makeable, stale excluded) with evidence "
                 "chips and the angle to make, straight news labelled and "
                 "listed apart, the phenomenon merges the build applied, "
                 "and the opportunity index's honest definition (an "
                 "index 0-100 — velocity discounted by saturation — "
                 "never a percentage or a view promise)."),
                schema_path("board"),
                board["counts"]["makeable_shown"] + board["counts"]["news_shown"],
                "Derived from the canonical store every build; the store itself (data/v1/trends.json) keeps all tracked topics, merged listings included."),
            "live_wire": endpoint(
                "data/v1/live-wire.json",
                ("Wave 28: the Live Wire — a command view over the pipeline's "
                 "own stored outputs: every refresh lane with its real "
                 "recorded hit count and health (live / degraded / "
                 "stale-skip / skip-by-design, exactly as the pipeline "
                 "records it), plus the hour's top movers computed from "
                 "stored velocity snapshots only."),
                schema_path("live-wire"),
                (_wire_disk.get("counts") or {}).get("lanes"),
                "Written by scripts/build_live_wire.js (runs in refresh.sh after build_site.py); human-readable on live-wire.html.",
                updated=_wire_disk.get("generated_at"), js_order=True),
            "streamer_desk": endpoint(
                "data/v1/streamer-desk.json",
                ("Wave 29: the Streamer Desk — sourced streamer directory, "
                 "dated updates, a drama tracker that prints only "
                 "multi-source-verified timelines (unverified claims "
                 "quarantined with reasons), streamer houses with dated "
                 "rosters, and an events calendar whose past/upcoming "
                 "status is computed from dates."),
                schema_path("streamer-desk"),
                ((_desk_disk.get("counts") or {}).get("streamers", 0) +
                 (_desk_disk.get("counts") or {}).get("houses", 0)) or None,
                "Written by scripts/build_streamer_desk.js (runs after build_live_wire.js in refresh.sh); human-readable on streamer-desk.html.",
                updated=_desk_disk.get("generated_at"), js_order=True),
            "schemas": endpoint(
                "data/v1/schema/",
                "JSON Schema (draft-07) for every endpoint.",
                None, len(SCHEMAS)),
        },
        "deprecated": [],
        "changelog": ("0.8.0 (2026-10-13): Prediction layer RETIRED by direct order — the Oracle pages, "
                      "the scorecard page, the forecast-explorer board page, the forecast endpoints, "
                      "their data payloads and their schemas are removed from the served site and "
                      "the build; the site now tracks ongoing hype only (the creator board, the "
                      "Live Wire, the Streamer Desk, lifecycle stage readouts). The forecast ledger "
                      "file stays in the repo as an archived record, unlinked. "
                      "0.7.0 (2026-10-13): Wave 39 — the One-Look Creator Board. New data/v1/board.json endpoint: "
                      "the homepage's first screen as data — ranked make-now picks with evidence chips and angles, "
                      "straight news labelled apart, phenomenon merges (additive view only; the canonical store "
                      "keeps every tracked topic). Additive only, no shape changes to existing endpoints. "
                      "0.7.0 (2026-10-12): Wave 17 — Oracle layer 2. New data/v1/lifecycle.json endpoint: "
                      "every topic's ignition/burnout lifecycle stage (building/steady/warming/igniting/peaking/cooling/burned-out) "
                      "classified from its real velocity snapshots with the classifier's own thresholds (ignition line v=70, "
                      "rise/fall ±1.5/hr) — readouts, not predictions; per-topic stage ribbons; last-24h ignitions/burnouts boards. "
                      "Additive only, no shape changes. "
                      "0.6.0 (2026-10-11/12): Wave 13 — the two missing wave-9 seeds land: "
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
                      "(the scorecard page): honest pre-resolution states, per-horizon accuracy table, "
                      "by-call breakdown, recent resolutions, current 48h projections, and the resolution "
                      "method — all rendered live from the forecast accuracy payload, with the hit rate "
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
                      "data/v1/platform-velocity.json and the forecast accuracy "
                      "payload (the Oracle's own forecast-vs-actual log; 'building history' "
                      "until 10+ forecasts resolve). 0.2.0 (2026-10-11): index.json "
                      "endpoints are now objects "
                      "{path, description, schema, updated, records, notes} (was plain "
                      "path strings). Added flat-feed, JSONP, velocity entries; "
                      "draft-07 schemas for every endpoint under data/v1/schema/."),
        "usage": ("GET data/v1/trends.json, sort by opportunity_score desc for the "
                  "hottest plays. Start at data/v1/index.json for the full endpoint map."),
    }
    with open(os.path.join(api, "index.json"), "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
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
              "- [data/v1/velocity.json](data/v1/velocity.json) — hourly velocity snapshots per topic",
              "- [data/v1/platform-velocity.json](data/v1/platform-velocity.json) — per-platform hourly velocity series (per-platform trajectories input)", "- [data/v1/live-wire.json](data/v1/live-wire.json) — the Live Wire: every pipeline lane with its recorded hit count + health (live/degraded/stale-skip/skip-by-design) and the hour's top movers from stored snapshots only", "- [data/v1/streamer-desk.json](data/v1/streamer-desk.json) — the Streamer Desk: sourced streamer directory, dated updates, multi-source-verified drama timelines, houses with dated rosters, events calendar",
              "- [data/v1/lifecycle.json](data/v1/lifecycle.json) — the ignition/burnout lifecycle layer: per-topic stage (building/steady/warming/igniting/peaking/cooling/burned-out), stage ribbons, last-24h ignitions/burnouts boards (readouts, not predictions)",
              "- [data/v1/meme-formats.json](data/v1/meme-formats.json) — the tracked meme format families: curated families with current examples, evidence, verification flags, and live topic links",
              "- [data/v1/hashtags.json](data/v1/hashtags.json) — tag index", "- [data/v1/schema/](data/v1/schema/) — draft-07 schemas for every endpoint",
              "- [AGENT.md](AGENT.md) — how an agent uses this tracker (end-to-end workflows)", "",
              "## Pages",               "- [live-wire.html](live-wire.html) — the Live Wire: a command view over the pipeline's own stored outputs — every source lane with its recorded hit count and health (live/degraded/stale-skip/skip-by-design), plus the hour's top movers from stored snapshots only",
              "- [streamer-desk.html](streamer-desk.html) — the Streamer Desk: streamer directory, dated updates, multi-source-verified drama timelines (unverified quarantined), houses with dated rosters, events calendar",
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
