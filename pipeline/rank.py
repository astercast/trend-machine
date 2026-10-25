#!/usr/bin/env python3
"""Strength: how well a trend is holding up, from what we actually observed.

This tracks. It does not predict. Four measured parts, each 0 to 1:

  support      distinct kinds of source that carried it (news, search, social,
               video, reference, chart ...). One kind = one voice, three = a trend.
  freshness    half life of 18 hours on the newest sighting.
  persistence  share of the last 24 hours of runs in which it appeared.
  momentum     change in its support score against about a day ago.

A part we cannot measure yet (not enough history) is left out and the others
are re-weighted, and the row says which parts were measured. A row with one
outlet is marked single source and its strength is scaled by 0.6.
Room (the old opportunity score, the saturation penalty) stays a separate
column. Strength says how real; Room says how crowded.

Used by normalize.py:  rank.apply(topics, hist, now)
"""
import datetime, re
from urllib.parse import urlparse

HALF_LIFE_H = 18.0
WEIGHTS = {"support": 0.40, "freshness": 0.20, "persistence": 0.25, "momentum": 0.15}
SINGLE_SOURCE_SCALE = 0.6
MIN_RUNS_FOR_PERSISTENCE = 4

# source name (text before the first ':' or '/') -> kind. Anything not listed is
# treated as a publisher: kind "web", counted once per distinct domain.
KIND = {
    "gnews": "news", "gnews-q": "news",
    "google-trends": "search", "gtrends": "search", "gtrends-news": "news",
    "hackernews": "community", "reddit-rss": "social", "reddit": "social",
    "mastodon-trends": "social", "bluesky-trending": "social", "Bluesky trending": "social",
    "yt-rss": "video", "youtube-invidious": "video",
    "wikipedia-most-read": "reference", "Wikipedia": "reference",
    "apple-appstore-chart": "chart", "apple-music-chart": "chart",
    "apple-podcasts-chart": "chart", "netflix-top10": "chart", "steam": "chart",
}

# Weekly ritual tags (#Caturday, #FensterFreitag, #FridayReads ...) trend every
# week because people agreed to post them. Shown, never ranked high.
RITUAL = re.compile(r"^#?(\w*(caturday|freitag|vendredi|fridayreads|fridayfeeling|mondaymotivation|"
                    r"tuesdaythoughts|wednesdaywisdom|throwbackthursday|sundayvibes|saturdayvibes|"
                    r"fridayvibes|friyay|jukebox\w*|tvtalkshowasong|fensterfreitag|photomonday|"
                    r"mosstodon|monday\w*|tuesday\w*|wednesday\w*|thursday\w*|friday\w*|saturday\w*|sunday\w*))$", re.I)

def _name(s):
    return re.split(r"[:/]", (s.get("name") if isinstance(s, dict) else str(s)) or "?")[0].strip()

def _domain(url):
    try:
        h = urlparse(url).netloc.lower()
        return h[4:] if h.startswith("www.") else h
    except Exception:
        return ""

SOURCE_WINDOW_H = 48

def support_of(sources, now=None, topic=None):
    """-> (kinds, outlets). Outlets are distinct domains (news.google.com is
    only a pipe, so its own domain does not count as an outlet)."""
    kinds, outlets = set(), set()
    for s in sources or []:
        if now is not None:
            # only count a source seen in the last 48 hours; an old entry with no
            # timestamp counts only while the topic itself was seen in that window
            when = s.get("seen") if isinstance(s, dict) else None
            when = when or (topic or {}).get("last_seen")
            try:
                if (now - _ts(when)).total_seconds() > SOURCE_WINDOW_H * 3600:
                    continue
            except Exception:
                pass
        n = _name(s)
        k = KIND.get(n)
        d = _domain(s.get("url", "")) if isinstance(s, dict) else ""
        if k is None:
            k = "web"
        kinds.add(k)
        if d and d != "news.google.com":
            outlets.add(d)
        elif not d or d == "news.google.com":
            outlets.add("src:" + n)   # a pipe with no outlet url still counts once per named source
    return kinds, outlets

def _ts(x):
    t = datetime.datetime.fromisoformat(x)
    return t if t.tzinfo else t.replace(tzinfo=datetime.timezone.utc)

def _hour(p):
    return _ts(p[0]).strftime("%Y-%m-%dT%H")

def support_score(n_kinds):
    return min(n_kinds, 3) / 3.0

def apply(topics, hist, now):
    """Adds strength fields to every topic in place. topics: {id: topic}."""
    win = now - datetime.timedelta(hours=24)
    run_hours = set()
    for pts in hist.values():
        for p in pts:
            try:
                if _ts(p[0]) >= win: run_hours.add(_hour(p))
            except Exception:
                pass
    runs = len(run_hours)
    for tid, t in topics.items():
        kinds, outlets = support_of(t.get("sources"), now, t)
        parts = {"support": support_score(len(kinds))}
        try:
            age_h = max(0.0, (now - _ts(t.get("last_seen", ""))).total_seconds() / 3600)
            parts["freshness"] = 0.5 ** (age_h / HALF_LIFE_H)
        except Exception:
            pass
        pts = hist.get(tid) or []
        if runs >= MIN_RUNS_FOR_PERSISTENCE:
            seen = {_hour(p) for p in pts if _ts(p[0]) >= win}
            seen.add(now.strftime("%Y-%m-%dT%H"))   # this run
            parts["persistence"] = min(1.0, len(seen & (run_hours | {now.strftime('%Y-%m-%dT%H')})) / float(max(runs, 1)))
        old = [p for p in pts if 10 <= (now - _ts(p[0])).total_seconds() / 3600 <= 36]
        if old and len(p := old[0]) >= 2:
            then = min(1.0, (p[3] if len(p) > 3 else len(kinds)) / 3.0) if len(p) > 3 else None
            if then is not None:
                parts["momentum"] = max(0.0, min(1.0, 0.5 + (support_score(len(kinds)) - then)))
        w = {k: WEIGHTS[k] for k in parts}
        total = sum(w.values())
        strength = 100.0 * sum(parts[k] * w[k] for k in parts) / total
        confirmed = len(outlets) >= 2
        if not confirmed:
            strength *= SINGLE_SOURCE_SCALE
        ritual = bool(RITUAL.match((t.get("title") or "").strip().split(" ")[0])) and (t.get("title") or "").strip().startswith("#")
        if ritual:
            strength *= 0.3
        if t.get("stale"):
            strength *= 0.5
        t["ritual"] = ritual
        t["strength"] = round(strength)
        t["strength_parts"] = {k: round(v, 2) for k, v in parts.items()}
        t["strength_measured"] = sorted(parts)
        t["kinds"] = sorted(kinds)
        t["outlets"] = len(outlets)
        t["confirmed"] = confirmed
    return topics
