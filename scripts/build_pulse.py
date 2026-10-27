#!/usr/bin/env python3
"""Pulse homepage: writes the top of index.html (hero, lead sighting, ledger)
between <!--PULSE:BEGIN--> and <!--PULSE:END-->.

Rules this file enforces, in code:
  1. A trend is shown only if TWO links on TWO different sites back it.
     Feed addresses (rss, xml, trends.google.com) are not citations.
     A link may back at most ONE topic, evergreen roundup pages are
     not citations, and a page only witnesses a topic when the page
     itself names that topic and is fresh (R304, review-trend-2 item 1:
     the check is a real fetch, one attempt per candidate, cached for
     a week in hidden_files/witness-checks.json; R305, review-trend-3
     item 1: freshness means a parsed publication date within 14 days
     of the board's generated_at, or the source's own seen stamp
     within 48 hours of it — a page that merely carries some date
     somewhere no longer witnesses, and a statistics or market-size
     roundup title never does).
  2. Nothing here forecasts. It reads what is in data/v1/trends.json now.
  3. No more than 2 stories from the same section of one site, so one
     football round cannot fill the page.
Run after build_site.py:  python3 scripts/build_pulse.py
"""
import json, os, re, sys, threading
from datetime import date, datetime, timedelta, timezone
from html import escape, unescape
from urllib.parse import urlparse
from urllib.request import Request, urlopen

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


def is_roundup(u):
    """Evergreen roundup pages are not witnesses (R304, review-trend-2
    item 1): a "TikTok trends" listicle exists whether or not any one
    thing is rising, and it cannot witness two different topics at
    once. The rejection is by path shape, not by naming sites: any
    segment that is a trends index (tiktok-trends, october-tiktok-
    trends, trends, whats-trending, ...) disqualifies the page."""
    segs = [q for q in urlparse(u).path.lower().split("/") if q]
    return any(re.search(r"(?:^|-)trends(?:-|$)", q) or "whats-trending" in q
               or "what-is-trending" in q or q.startswith("trending-")
               for q in segs)


def is_citation(s):
    """A witness is a page that exists because the thing is rising: a story,
    a post, a video. Pages that exist either way are not witnesses
    (R303, review-trend-1 item 1): search-results pages, app-store
    listings, and bare Wikipedia article pages are all rejected.
    R304 adds evergreen roundup pages (see is_roundup)."""
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
    if is_roundup(u):
        return False
    return True


# --- R304 (review-trend-2 item 1): a witness must be specific. -------
# Opening the page is the only honest way to know it names the topic,
# so the builder fetches each candidate once and caches what it found
# (title, opening text, and — R305 — the parsed publication date, so
# the freshness rule is auditable from the cache) for a week. A page
# that cannot be opened cannot witness: the home page promises two
# sources that open.

CACHE = os.path.join(ROOT, "hidden_files", "witness-checks.json")
CACHE_DAYS = 7
_cache = None
_cache_dirty = False
_cache_lock = threading.Lock()

# R305 (review-trend-3 item 1): the witness check needs the page's
# publication date itself, parsed and stored, not a boolean "some
# date exists somewhere". Only structured metadata counts — JSON-LD
# datePublished, the article:published_time meta, an itemprop
# datePublished meta, or a <time datetime> stamp. Visible-text dates
# are never used: page chrome carries today's date, which would make
# every stale page look fresh.
_PUBDATE_RES = [re.compile(p) for p in (
    r'"datePublished"\s*:\s*"(\d{4})-(\d{2})-(\d{2})',
    r'article:published_time"\s+content="(\d{4})-(\d{2})-(\d{2})',
    r'itemprop="datePublished"[^>]+content="(\d{4})-(\d{2})-(\d{2})',
    r'<time[^>]+datetime="(\d{4})-(\d{2})-(\d{2})')]

FRESH_DAYS = 14        # published within 14 days of the board
SEEN_HOURS = 48        # or the heartbeat saw the source within 48 hours
_BAD_TITLE = ("statistics", "market size")


def _parse_pub_date(raw):
    """The page's stated publication date (ISO date or None), from
    its structured metadata only, first match in priority order."""
    for p in _PUBDATE_RES:
        m = p.search(raw)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)),
                            int(m.group(3))).isoformat()
            except ValueError:
                continue
    return None


_GEN = None


def _generated_at():
    """The board's own timestamp from data/v1/trends.json: freshness
    is measured against the board, not against whenever a build
    happens to run."""
    global _GEN
    if _GEN is None:
        raw = json.load(open(DATA))["generated_at"]
        _GEN = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    return _GEN

_STOP = frozenset(
    "the a an and or of to in on for with vs v is are was were as at by "
    "from after over under about into its it this that these those you "
    "your how why what when who will can could has have had not no but "
    "if then than so such more most new".split())


def _tokens(text):
    return [w for w in (x.strip("'") for x in
                        re.findall(r"[a-z0-9][a-z0-9']*", (text or "").lower()))
            if len(w) > 2 and w not in _STOP]


def _load_cache():
    global _cache
    if _cache is None:
        try:
            _cache = json.load(open(CACHE))
        except Exception:
            _cache = {}
    return _cache


def _save_cache():
    global _cache_dirty
    if _cache_dirty and _cache is not None:
        try:
            os.makedirs(os.path.dirname(CACHE), exist_ok=True)
            with open(CACHE, "w") as f:
                json.dump(_cache, f, ensure_ascii=False)
            _cache_dirty = False
        except Exception:
            pass


def _fresh(rec):
    # Records written before R305 carry no parsed publication date,
    # so they cannot answer the freshness question: they count as
    # stale once and are re-fetched under the new parser.
    if "pub_date" not in rec:
        return False
    try:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(rec["at"])
        return age < timedelta(days=CACHE_DAYS)
    except Exception:
        return False


def _fetch_record(url):
    """One standard attempt at opening a candidate witness page.
    Returns {ok, title, text, has_date, pub_date}; pub_date is the
    parsed publication date (ISO date or None) and has_date mirrors
    it. Every failure is ok=False, recorded as such, and never
    retried inside a build."""
    cache = _load_cache()
    rec = cache.get(url)
    if rec and _fresh(rec):
        return rec
    rec = {"at": datetime.now(timezone.utc).isoformat(), "ok": False,
           "title": "", "text": "", "has_date": False, "pub_date": None}
    try:
        req = Request(url, headers={
            "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64) "
                           "AppleWebKit/537.36 (KHTML, like Gecko) "
                           "Chrome/124.0 Safari/537.36"),
            "Accept": "text/html,application/xhtml+xml"})
        with urlopen(req, timeout=10) as r:
            raw = r.read(400_000).decode("utf-8", "ignore")
        m = re.search(r"<title[^>]*>(.*?)</title>", raw, re.S | re.I)
        title = unescape(re.sub(r"\s+", " ", m.group(1))).strip() if m else ""
        metas = " ".join(unescape(x) for x in re.findall(
            r'<meta[^>]+(?:property="og:(?:title|description)"'
            r'|name="description")[^>]+content="([^"]*)"', raw, re.I))
        body = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", raw,
                      flags=re.S | re.I)
        body = re.sub(r"<[^>]+>", " ", body)
        text = unescape(re.sub(r"\s+", " ", body)).strip()
        pub = _parse_pub_date(raw)
        rec = {"at": rec["at"], "ok": True, "title": title,
               "text": (metas + " " + text)[:4000],
               "has_date": pub is not None, "pub_date": pub}
    except Exception:
        pass
    global _cache_dirty
    with _cache_lock:
        cache[url] = rec
        _cache_dirty = True
    return rec


def _warm_cache(topics):
    """Open every candidate witness page once, in parallel, before
    the assignment pass, so the pass itself is local arithmetic and
    a build never waits on the network topic by topic. One attempt
    per URL, exactly as the rule states; the results are cached."""
    from concurrent.futures import ThreadPoolExecutor
    cache = _load_cache()
    urls = {s["url"] for t in topics for s in (t.get("sources") or [])
            if is_citation(s)}
    todo = [u for u in urls if not (cache.get(u) and _fresh(cache[u]))]
    if todo:
        with ThreadPoolExecutor(max_workers=10) as ex:
            list(ex.map(_fetch_record, todo))
        _save_cache()
    return len(urls), len(todo)


def witness_specific(t, s):
    """The page itself must name the topic and be fresh. Naming: at
    least three fifths of the topic title's real words (and at least
    one) appear in the page's title or opening text. Freshness
    (R305, review-trend-3 item 1): the page's parsed publication
    date falls within FRESH_DAYS of the board's generated_at (one
    day of slack for time zones), or the heartbeat's own seen stamp
    for this source falls within SEEN_HOURS of it. A statistics or
    market-size roundup title never witnesses, however fresh: those
    pages exist whether or not anything is rising."""
    rec = _fetch_record(s.get("url") or "")
    if not rec.get("ok"):
        return False
    if any(b in (rec.get("title") or "").lower() for b in _BAD_TITLE):
        return False
    need = _tokens(t.get("title"))
    if not need:
        return False
    have = set(_tokens(rec.get("title") + " " + rec.get("text")))
    if sum(1 for w in need if w in have) < max(1, -(-len(need) * 3 // 5)):
        return False
    gen = _generated_at()
    pub = rec.get("pub_date")
    if pub:
        try:
            age = (gen.date() - date.fromisoformat(pub)).days
            if -1 <= age <= FRESH_DAYS:
                return True
        except ValueError:
            pass
    seen = s.get("seen")
    if seen:
        try:
            delta = gen - datetime.fromisoformat(
                seen.replace("Z", "+00:00"))
            if timedelta(0) <= delta <= timedelta(hours=SEEN_HOURS):
                return True
        except ValueError:
            pass
    return False


def _rank(topics):
    return sorted(topics, key=lambda t: (-(t.get("strength") or 0),
                                         -(t.get("velocity") or 0),
                                         t.get("last_seen") or ""))


def _candidates(t, used_urls):
    """A topic's witnesses under the full rule: citations only, no
    roundups, specific to this topic, on two different sites, and no
    URL that already backs another topic (R304: one URL, one topic)."""
    seen = {}
    for s in sorted(t.get("sources") or [], key=lambda s: s.get("seen") or "",
                    reverse=True):
        if not is_citation(s) or s["url"] in used_urls:
            continue
        h = site(s["url"])
        if h in seen:
            continue
        if not witness_specific(t, s):
            continue
        seen[h] = s
        if len(seen) == 2:
            break
    return list(seen.items()) if len(seen) == 2 else None


_ASSIGN = None


def assignment(topics=None):
    """{topic id: witnesses} for the whole board, computed once per
    build in board order so URL uniqueness holds across topics, and
    shared by the home page, the topic pages and the structured data:
    every surface applies the same rule to the same assignment."""
    global _ASSIGN
    if _ASSIGN is None:
        if topics is None:
            topics = json.load(open(DATA))["topics"]
        _warm_cache(topics)
        used, out = set(), {}
        for t in _rank(topics):
            w = _candidates(t, used)
            if w:
                out[t["id"]] = w
                used.update(s["url"] for _, s in w)
        _ASSIGN = out
        _save_cache()
    return _ASSIGN


def two_witnesses(t):
    a = assignment()
    if t.get("id") in a:
        return a[t["id"]]
    return _candidates(t, set())


def label(host):
    return OUTLET.get(host) or OUTLET.get(".".join(host.split(".")[-2:])) or host


def section(w):
    u = urlparse(w[0][1]["url"])
    return w[0][0] + "/" + (u.path.strip("/").split("/")[0] if u.path.strip("/") else "")


def pick(topics):
    a = assignment(topics)
    rows = [(t, a[t["id"]]) for t in _rank(topics) if t["id"] in a]
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


def case_title(x):
    """The one title-casing rule for every surface (R304,
    review-trend-2 item 4): a title stored all-lowercase is shown
    title-cased, the same on the home lines, the topic pages, the
    board and the feed. build_site.py's disp_title calls this too,
    so no surface can drift from another."""
    if x == x.lower():                      # "premier league table" -> "Premier League Table"
        x = " ".join(w if w in ("vs", "v", "of", "the", "and") else w.capitalize() for w in x.split())
        if x:
            x = x[0].upper() + x[1:]
    return x


def title_of(t):
    x = re.sub(r"\s*\((Exclusive|Video|Opinion)\)\s*$", "", t["title"]).strip()
    return escape(case_title(x))


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
    out.append('  <ol class="ledger" start="2" aria-label="The rest of the board, same rule">')
    for i, (t, w) in enumerate(rest):
        out.append('''    <li class="line" style="--i:%d"><h3 class="line-t"><a href="topics/%s.html">%s</a></h3>
      <div class="wits">%s%s</div>%s</li>''' % (i, escape(t["id"]), title_of(t), wit(1, *w[0]), wit(2, *w[1]), heat(t.get("velocity"))))
    out.append('  </ol>')
    out.append('''  <p class="rule-note"><b>Heat</b> is how fast people are picking something up, out of 100. It is not a prediction.
    <b>%d</b> of %d topics we track have two sources on two different sites that open, name the topic and are fresh: published in the 14 days before this board, or seen by our heartbeat in the 48 hours before it. The other %d are heard once, so we do not list them.
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
