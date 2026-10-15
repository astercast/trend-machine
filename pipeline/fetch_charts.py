#!/usr/bin/env python3
"""Apple charts fetcher (public JSON feeds, no key, no signup).

Completeness build B1 (2026-10-15): the board had no chart lane at
all. Its music, app and podcast topics came from news and seeds,
never from what people are actually playing, downloading and
listening to. Apple's Marketing Tools feed service publishes three
US charts as small keyless JSON feeds built for embedding:

  music    https://rss.marketingtools.apple.com/api/v2/us/music/most-played/10/songs.json
  apps     https://rss.marketingtools.apple.com/api/v2/us/apps/top-free/10/apps.json
  podcasts https://rss.marketingtools.apple.com/api/v2/us/podcasts/top/10/podcasts.json

Evidence type on the board: makeable. A charting song is a sound to
use, a charting app is a topic to cover, a charting podcast is clip
material, so hits carry real categories (music / tech / culture),
never "news".

Failure contract (same as fetch_streamers.py): a feed that fails is
skipped per feed; if all three fail the fetcher saves an empty file
so the Live Wire reads the lane as degraded, never as live. Hits are
only ever rows the feeds actually returned.
"""
import sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from common import fetch_json, hit, save_hits

BASE = "https://rss.marketingtools.apple.com/api/v2/us"
FEEDS = [
    ("music/most-played/10/songs.json", "apple-music-chart",
     "music", ["apple"], "Apple Music US most-played songs chart"),
    ("apps/top-free/10/apps.json", "apple-appstore-chart",
     "tech", ["apple"], "US App Store top free apps chart"),
    ("podcasts/top/10/podcasts.json", "apple-podcasts-chart",
     "culture", ["apple"], "Apple Podcasts US top podcasts chart"),
]


def parse_feed(data, source, category, platforms, chart_label):
    """One feed payload -> hits, rank read from list position."""
    results = ((data or {}).get("feed") or {}).get("results") or []
    hits = []
    for i, r in enumerate(results):
        name = (r.get("name") or "").strip()
        if not name:
            continue
        artist = (r.get("artistName") or "").strip()
        rank = i + 1
        if source == "apple-music-chart" and artist:
            title = f"{name} by {artist}"
        else:
            title = name
        detail = chart_label + f", no. {rank}"
        if artist and source != "apple-music-chart":
            detail += f" · {artist}"
        genres = [g.get("name") for g in (r.get("genres") or []) if g.get("name")]
        if genres:
            detail += f" · {genres[0]}"
        hits.append(hit(
            title, r.get("url") or "", source,
            summary=detail,
            hashtags=[], category=category, platforms=platforms))
    return hits


def main():
    hits, ok = [], 0
    for path, source, category, platforms, label in FEEDS:
        try:
            data = fetch_json(f"{BASE}/{path}", timeout=20)
        except Exception as e:
            print(f"[charts:{source}] SKIP: {e}")
            continue
        ok += 1
        hits.extend(parse_feed(data, source, category, platforms, label))
    if not ok:
        print("[charts] all feeds failed, saving empty (degraded, not faked)")
    save_hits("charts", hits)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[charts] SKIP: {e}")
        try:
            save_hits("charts", [])
        except Exception:
            pass
