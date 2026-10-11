#!/usr/bin/env python3
"""Build trend-machine static site: topic pages, api/v1, llms.txt.

Run directly or via pipeline/refresh.sh.
"""
import json, os, re, html, datetime

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

def esc(s):
    return html.escape(str(s or ""), quote=True)

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
<link rel="stylesheet" href="../assets/css/tokens.css">
<link rel="stylesheet" href="../assets/css/base.css">
<link rel="stylesheet" href="../assets/css/components.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head"><div class="head-inner">
<a class="brand" href="../index.html"><span class="brand-mark">TM</span>Trend&nbsp;Machine</a>
<span class="kicker">topic dossier</span>
</div></header>
<main id="main" class="wrap">
<nav aria-label="Breadcrumb" style="margin:20px 0 0"><a href="../index.html" style="font-size:13px">&larr; all trends</a></nav>
<article class="topic-hero">
<p class="kicker">{kicker}</p>
<h1>{title}</h1>
<p style="max-width:62ch;color:var(--ink-dim);font-size:18px">{summary}</p>
<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin:16px 0">
<span class="fresh {fcls}"><span class="dot{pulse}" aria-hidden="true"></span>detected {age}</span>
<span class="score {scls}"><span class="score-bar"><i style="width:{opp}%"></i></span><span class="num">opportunity {opp}</span></span>
<span class="score"><span class="score-bar"><i style="width:{vel}%"></i></span><span class="num">velocity {vel}</span></span>
</div>
<div>{plats}{cats}{tags}</div>
{stale_note}
</article>
<section aria-labelledby="why"><div class="section-head"><h2 id="why">Why it's trending</h2></div>
<p style="max-width:68ch">{summary_long}</p>
<h3 style="font-size:15px;margin-top:18px">Sources</h3>
<ul>{sources}</ul>
</section>
<section aria-labelledby="angles"><div class="section-head"><h2 id="angles">Content angles <span class="kicker">topic in &rarr; video out</span></h2></div>
{angles}
</section>
<section aria-labelledby="hooks"><div class="section-head"><h2 id="hooks">Hook lines</h2></div>
{hooks}
</section>
<section aria-labelledby="watch"><div class="section-head"><h2 id="watch">Who to watch</h2></div>
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
<div><strong style="color:var(--ink)">Trend Machine</strong><br>Live trending-topic intelligence.</div>
<div class="num" style="font-size:12px">data: {ts}</div>
</div></footer>
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

def build_topic(t):
    age, fcls, pulse = age_label(t.get("last_seen", ""))
    opp, vel = t.get("opportunity_score", 0), t.get("velocity", 0)
    scls = "hot" if opp >= 70 else ("warm" if opp >= 40 else "")
    plats = "".join(f'<span class="chip plat">{esc(p)}</span>' for p in t.get("platforms", []))
    cats = f'<span class="chip">{esc(t.get("category",""))}</span>'
    tags = "".join(f'<span class="tag">{esc(h)}</span>' for h in t.get("hashtags", [])[:10])
    sources = "".join(
        f'<li><a href="{esc(s.get("url",""))}">{esc(s.get("name","source"))}</a></li>'
        for s in t.get("sources", [])) or "<li>No public sources captured yet.</li>"
    angles = "".join(
        f'<div class="angle"><h4>Angle {i+1}</h4><p>{esc(a)}</p></div>'
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
        kicker=esc(t.get("category", "trend")) + " · dossier",
        summary=esc(t["summary"]), fcls=fcls, pulse=pulse, age=age,
        scls=scls, opp=opp, vel=vel, plats=plats, cats=cats, tags=tags,
        stale_note=stale_note, summary_long=esc(t["summary"]),
        sources=sources, angles=angles, hooks=hooks, watch=watch,
        guide=guide, ts=esc(t.get("last_seen", "")))

def main():
    with open(DATA) as f:
        data = json.load(f)
    topics = data["topics"]

    tdir = os.path.join(ROOT, "topics")
    os.makedirs(tdir, exist_ok=True)
    live_ids = set()
    for t in topics:
        live_ids.add(t["id"])
        with open(os.path.join(tdir, t["id"] + ".html"), "w") as f:
            f.write(build_topic(t))
    # remove orphaned pages from pruned topics
    orphans = 0
    for fn in os.listdir(tdir):
        if fn.endswith(".html") and fn[:-5] not in live_ids:
            os.remove(os.path.join(tdir, fn))
            orphans += 1
    print(f"[build] {len(topics)} topic pages ({orphans} orphans removed)")

    # api/v1
    api = os.path.join(ROOT, "api", "v1")
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
    with open(os.path.join(api, "index.json"), "w") as f:
        json.dump({"name": "trend-machine", "version": "0.1.0",
                   "generated_at": data["generated_at"],
                   "endpoints": {
                       "trends": "api/v1/trends.json",
                       "hashtags": "api/v1/hashtags.json",
                       "schema": "api/v1/schema/trend.json"},
                   "usage": "GET api/v1/trends.json, sort by opportunity_score desc for the hottest plays."},
                  f, indent=2)
    schema = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "trend-machine topic",
        "type": "object",
        "required": ["id", "title", "summary", "category", "platforms",
                     "hashtags", "velocity", "opportunity_score",
                     "first_seen", "last_seen", "sources"],
        "properties": {
            "id": {"type": "string"}, "title": {"type": "string"},
            "summary": {"type": "string"}, "category": {"type": "string"},
            "platforms": {"type": "array", "items": {"type": "string"}},
            "hashtags": {"type": "array", "items": {"type": "string"}},
            "velocity": {"type": "integer", "minimum": 0, "maximum": 100},
            "saturation": {"type": "string", "enum": ["low", "medium", "high"]},
            "opportunity_score": {"type": "integer", "minimum": 0, "maximum": 100},
            "first_seen": {"type": "string"}, "last_seen": {"type": "string"},
            "stale": {"type": "boolean"}, "seeded": {"type": "boolean"},
            "sources": {"type": "array", "items": {"type": "object",
                "required": ["name", "url"]}},
            "angles": {"type": "array", "items": {"type": "string"}},
            "hooks": {"type": "array", "items": {"type": "string"}},
            "who_to_watch": {"type": "array", "items": {"type": "string"}},
            "guide_links": {"type": "array", "items": {"type": "string"}},
        },
    }
    with open(os.path.join(api, "schema", "trend.json"), "w") as f:
        json.dump(schema, f, indent=2)

    # llms.txt
    lines = ["# Trend Machine", "",
             "Live trending-topic intelligence: what to make content about TODAY.",
             "Machine-readable: api/v1/trends.json (sort by opportunity_score desc).",
             f"Generated: {data['generated_at']} · {len(topics)} topics.", "",
             "## Hottest right now"]
    for t in topics[:10]:
        lines.append(f"- {t['title']} (opportunity {t['opportunity_score']}, velocity {t['velocity']}) — topics/{t['id']}.html")
    lines += ["", "## Categories",
              ", ".join(sorted({t['category'] for t in topics})), "",
              "## API", "- api/v1/trends.json — all topics", "- api/v1/hashtags.json — tag index",
              "- api/v1/schema/trend.json — schema", "",
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
    print("[build] api/v1 + llms.txt + llms-full.txt done")

if __name__ == "__main__":
    main()
