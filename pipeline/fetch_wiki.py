#!/usr/bin/env python3
"""Wikipedia most-read fetcher (Wikimedia REST API, no key, no signup).

Completeness build B2 (2026-10-15): the board read search intent
(Google Trends daily, 10 US terms) but never lookup intent, what
people actually looked up. Wikimedia publishes the previous day's
most-read English Wikipedia articles, with view counts and ranks,
at a keyless endpoint, one request per run:

  https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/<YYYY>/<MM>/<DD>

Evidence type on the board: news. A lookup spike is attention to a
subject, so hits carry category "news" and the board lists them
apart with the other straight news, never in the make-now ranking.

Housekeeping pages (Main Page, Special:, Wikipedia: and the other
namespaces) are not topics and are filtered out. On any failure the
fetcher saves an empty file so the Live Wire reads the lane as
degraded, never as live, and no article is ever invented.
"""
import datetime, sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from common import fetch_json, hit, save_hits

ENDPOINT = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/top/"
            "en.wikipedia/all-access/{y}/{m:02d}/{d:02d}")
SKIP_PREFIXES = ("Main_Page", "Special:", "Wikipedia:", "Help:",
                 "Portal:", "Template:", "Category:", "File:",
                 "Talk:", "User:", "Draft:", "MediaWiki:", "Module:")
MAX_HITS = 15


def parse_top(data, day):
    """One day payload -> hits for real articles only, best first."""
    items = (data or {}).get("items") or []
    if not items:
        return []
    articles = items[0].get("articles") or []
    hits = []
    for a in articles:
        raw = a.get("article") or ""
        if not raw or raw.startswith(SKIP_PREFIXES):
            continue
        views = a.get("views")
        rank = a.get("rank")
        if not isinstance(views, int) or not isinstance(rank, int):
            continue
        title = raw.replace("_", " ")
        hits.append(hit(
            title, f"https://en.wikipedia.org/wiki/{raw}",
            "wikipedia-most-read",
            summary=(f"No. {rank} most-read article on English "
                     f"Wikipedia on {day.isoformat()}, "
                     f"{views:,} views that day"),
            hashtags=[], category="news", platforms=["wikipedia"]))
        if len(hits) >= MAX_HITS:
            break
    return hits


def main():
    day = (datetime.datetime.now(datetime.timezone.utc)
           - datetime.timedelta(days=1)).date()
    url = ENDPOINT.format(y=day.year, m=day.month, d=day.day)
    try:
        data = fetch_json(url, timeout=20)
    except Exception as e:
        print(f"[wiki] SKIP: {e}")
        save_hits("wiki", [])
        return
    save_hits("wiki", parse_top(data, day))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[wiki] SKIP: {e}")
        try:
            save_hits("wiki", [])
        except Exception:
            pass
