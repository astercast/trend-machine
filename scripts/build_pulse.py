#!/usr/bin/env python3
"""Pulse homepage: writes the top of index.html (hero, lead sighting, ledger)
between <!--PULSE:BEGIN--> and <!--PULSE:END-->.

Rules this file enforces, in code:
  1. A trend is shown only if TWO links on TWO different sites back it.
     Feed addresses (rss, xml, trends.google.com) are not citations.
  2. Nothing here forecasts. It reads what is in data/v1/trends.json now.
  3. No more than 2 stories from the same section of one site, so one
     football round cannot fill the page.
Run after build_site.py:  python3 scripts/build_pulse.py
"""
import json, os, re, sys
from datetime import datetime, timezone
from html import escape
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "v1", "trends.json")
PAGE = os.path.join(ROOT, "index.html")
SHOWN = 10            # one lead plus nine lines
PER_SECTION = 2
PER_SITE = 3          # a site may back at most 3 lines, so one outlet cannot own the page

OUTLET = {"bbc.com": "BBC", "bbc.co.uk": "BBC", "theguardian.com": "The Guardian",
          "nytimes.com": "New York Times", "espn.com": "ESPN", "yahoo.com": "Yahoo",
          "wikipedia.org": "Wikipedia", "reddit.com": "Reddit", "bsky.app": "Bluesky",
          "apple.com": "Apple", "cbc.ca": "CBC", "nbcnews.com": "NBC News",
          "nypost.com": "New York Post", "people.com": "People", "skysports.com": "Sky Sports",
          "youtube.com": "YouTube", "news.ycombinator.com": "Hacker News",
          "cbssports.com": "CBS Sports", "aljazeera.com": "Al Jazeera"}


def site(u):
    """Registered domain: bbc.co.uk stays bbc.co.uk, news.bbc.com becomes bbc.com."""
    p = urlparse(u).netloc.lower().removeprefix("www.").split(".")
    return ".".join(p[-3:] if len(p) > 2 and p[-2] in ("co", "com", "org", "gov") else p[-2:])


def is_citation(s):
    """A witness is a page that exists because the thing is rising: a story,
    a post, a video. Pages that exist either way are not witnesses
    (R303, review-trend-1 item 1): search-results pages, app-store
    listings, and bare Wikipedia article pages are all rejected."""
    u = s.get("url") or ""
    if not u.startswith("http") or "trends.google.com" in u:
        return False
    if "/rss" in u or re.search(r"\.(xml|rss|json)(\?|$)", u):
        return False
    p = urlparse(u)
    host = p.netloc.lower().removeprefix("www.")
    path = p.path.lower()
    if "/search" in path or re.search(r"[?&]q=", u):
        return False
    if host in ("apps.apple.com", "itunes.apple.com", "play.google.com"):
        return False
    if host.endswith("wikipedia.org") and path.startswith("/wiki/"):
        return False
    return True


def two_witnesses(t):
    seen = {}
    for s in sorted(t.get("sources") or [], key=lambda s: s.get("seen") or "", reverse=True):
        if is_citation(s):
            seen.setdefault(site(s["url"]), s)
    return list(seen.items())[:2] if len(seen) >= 2 else None


def label(host):
    return OUTLET.get(host) or OUTLET.get(".".join(host.split(".")[-2:])) or host


def section(w):
    u = urlparse(w[0][1]["url"])
    return w[0][0] + "/" + (u.path.strip("/").split("/")[0] if u.path.strip("/") else "")


def pick(topics):
    rows = []
    for t in topics:
        w = two_witnesses(t)
        if w:
            rows.append((t, w))
    rows.sort(key=lambda r: (-(r[0].get("strength") or 0), -(r[0].get("velocity") or 0),
                             r[0].get("last_seen") or ""), reverse=False)
    out, used = [], {}
    for t, w in rows:
        k = section(w)
        if used.get(k, 0) >= PER_SECTION or any(used.get("@" + h, 0) >= PER_SITE for h, _ in w):
            continue
        used[k] = used.get(k, 0) + 1
        for h, _ in w:
            used["@" + h] = used.get("@" + h, 0) + 1
        out.append((t, w))
        if len(out) == SHOWN:
            break
    return out, len(rows)


def when(iso):
    d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return d, d.strftime("%a %-d %b, %-I:%M %p UTC")


def wit(i, host, s):
    return ('<a class="wit" href="%s" rel="noopener" target="_blank">'
            '<span class="wit-n">%d</span>%s<span class="vh"> (opens the source)</span></a>'
            % (escape(s["url"], True), i, escape(label(host))))


def heat(v):
    v = max(0, min(100, int(v or 0)))
    return ('<span class="heat" style="--h:%d" role="img" aria-label="Heat %d of 100">'
            '<b>%d</b><i aria-hidden="true"></i></span>' % (v, v, v))


def title_of(t):
    x = re.sub(r"\s*\((Exclusive|Video|Opinion)\)\s*$", "", t["title"]).strip()
    if x == x.lower():                      # "premier league table" -> "Premier League Table"
        x = " ".join(w if w in ("vs", "v", "of", "the", "and") else w.capitalize() for w in x.split())
        x = x[0].upper() + x[1:]
    return escape(x)


def build():
    data = json.load(open(DATA))
    gen_d, gen_txt = when(data["generated_at"])
    rows, n_ok = pick(data["topics"])
    n_all = len(data["topics"])
    lead, rest = rows[0], rows[1:]
    lt, lw = lead
    out = []
    out.append('''<section class="pulse" id="board" aria-labelledby="board-h">
  <div class="status" id="data-ts" data-generated="%s" role="status">
    <span class="dot" aria-hidden="true"></span>
    <span class="status-text"><b id="status-word">Last check</b> <time datetime="%s">%s</time><span id="status-age"></span></span>
    <span class="fleet-slot" id="fleet-slot"></span>
  </div>
  <h1 id="board-h">Rising right now.</h1>
  <p class="deck">What people are talking about and looking up, as it happens. Each line is backed by two sources you can open. Nothing here guesses what comes next.</p>

  <article class="lead">
    <p class="lead-no"><span>No. 1</span></p>
    <h2 class="lead-t"><a href="topics/%s.html">%s</a></h2>
    <div class="lead-foot">
      <p class="seen">Seen by %s and %s</p>
      <div class="wits">%s%s</div>
      %s
    </div>
  </article>
''' % (escape(data["generated_at"], True), escape(data["generated_at"], True), gen_txt,
       escape(lt["id"]), title_of(lt), escape(label(lw[0][0])), escape(label(lw[1][0])),
       wit(1, *lw[0]), wit(2, *lw[1]), heat(lt.get("velocity"))))
    out.append('  <ol class="ledger" start="2" aria-label="Next nine, same rule">')
    for i, (t, w) in enumerate(rest):
        out.append('''    <li class="line" style="--i:%d"><h3 class="line-t"><a href="topics/%s.html">%s</a></h3>
      <div class="wits">%s%s</div>%s</li>''' % (i, escape(t["id"]), title_of(t), wit(1, *w[0]), wit(2, *w[1]), heat(t.get("velocity"))))
    out.append('  </ol>')
    out.append('''  <p class="rule-note"><b>Heat</b> is how fast people are picking something up, out of 100. It is not a prediction.
    <b>%d</b> of %d topics we track have two sources that open. The other %d are heard once, so we do not list them.
    <a href="algorithms.html">How we check</a></p>
</section>''' % (n_ok, n_all, n_all - n_ok))
    return "\n".join(out)


def main():
    page = open(PAGE).read()
    pat = re.compile(r"(<!--PULSE:BEGIN-->).*?(<!--PULSE:END-->)", re.S)
    if not pat.search(page):
        sys.exit("PULSE markers missing in index.html")
    page = pat.sub(lambda m: m.group(1) + "\n" + build() + "\n" + m.group(2), page, count=1)
    open(PAGE, "w").write(page)
    print("[pulse] home written")


if __name__ == "__main__":
    main()
