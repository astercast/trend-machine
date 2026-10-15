#!/usr/bin/env python3
"""Fixture tests for the completeness-build fetchers (2026-10-15).

Pins the parsers of pipeline/fetch_charts.py (B1, Apple charts) and
pipeline/fetch_wiki.py (B2, Wikipedia most read) against payloads in
the endpoints' published shapes. No network: these tests prove the
parsing, filtering and labeling rules, not a live fetch.

Rules pinned:
  charts: rank comes from list position; a song's title carries its
    artist; categories are music / tech / culture, never news, so
    board rows are makeable evidence; the chart name and rank land
    in the summary; nameless rows are dropped.
  wiki: housekeeping namespaces (Main_Page, Special:, Wikipedia:,
    and friends) never become topics; rows without integer views or
    rank are dropped; titles un-underscore; the summary carries the
    rank, the date and the real view count; the cap is 15; category
    is news, so board rows are news evidence, listed apart.
  both: no generated title or summary may contain an em dash.
Run: python3 scripts/test_charts_wiki.py  (exit 0 = all pass)
"""
import datetime, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import fetch_charts, fetch_wiki

FAILS = []


def check(name, cond, detail=""):
    if cond:
        print("  ok: " + name)
    else:
        print("  FAIL: " + name + (f" - {detail}" if detail else ""))
        FAILS.append(name)


def feed(results):
    return {"feed": {"title": "fixture", "results": results}}


songs = fetch_charts.parse_feed(feed([
    {"name": "Song One", "artistName": "Artist A", "url": "https://x/1",
     "genres": [{"name": "Pop"}]},
    {"name": "Song Two", "artistName": "Artist B", "url": "https://x/2",
     "genres": []},
    {"name": "", "artistName": "Nobody", "url": "https://x/3"},
]), "apple-music-chart", "music", ["apple"],
    "Apple Music US most-played songs chart")
check("charts: songs keep feed order and drop nameless rows",
      len(songs) == 2 and songs[0]["title"] == "Song One by Artist A")
check("charts: song summary carries chart name, rank and genre",
      "most-played songs chart, no. 1" in songs[0]["summary"]
      and "Pop" in songs[0]["summary"])
check("charts: song category is music (makeable), platform apple",
      songs[0]["category"] == "music" and songs[0]["platforms"] == ["apple"]
      and songs[0]["source"] == "apple-music-chart")

apps = fetch_charts.parse_feed(feed([
    {"name": "App One", "artistName": "Dev Co", "url": "https://x/a",
     "genres": [{"name": "Games"}]},
]), "apple-appstore-chart", "tech", ["apple"],
    "US App Store top free apps chart")
check("charts: app title is the app name, developer in the summary",
      apps[0]["title"] == "App One" and "Dev Co" in apps[0]["summary"]
      and apps[0]["category"] == "tech")

pods = fetch_charts.parse_feed(feed([
    {"name": "Show One", "artistName": "Host", "url": "https://x/p"},
]), "apple-podcasts-chart", "culture", ["apple"],
    "Apple Podcasts US top podcasts chart")
check("charts: podcast category is culture (makeable)",
      pods[0]["category"] == "culture"
      and pods[0]["source"] == "apple-podcasts-chart")

day = datetime.date(2026, 10, 14)
wiki_payload = {"items": [{"articles": [
    {"article": "Main_Page", "views": 9000000, "rank": 1},
    {"article": "Special:Search", "views": 8000000, "rank": 2},
    {"article": "Wikipedia:About", "views": 7000000, "rank": 3},
    {"article": "Some_Show", "views": 123456, "rank": 4},
    {"article": "No_Views_Row", "rank": 5},
    {"article": "A_Big_Event", "views": 99999, "rank": 6},
]}]}
wiki = fetch_wiki.parse_top(wiki_payload, day)
check("wiki: housekeeping and view-less rows are filtered out",
      [h["title"] for h in wiki] == ["Some Show", "A Big Event"])
check("wiki: summary carries rank, date and the real view count",
      "No. 4 most-read" in wiki[0]["summary"]
      and "2026-10-14" in wiki[0]["summary"]
      and "123,456 views" in wiki[0]["summary"])
check("wiki: category is news, platform wikipedia, real article URL",
      wiki[0]["category"] == "news"
      and wiki[0]["platforms"] == ["wikipedia"]
      and wiki[0]["url"] == "https://en.wikipedia.org/wiki/Some_Show")
check("wiki: empty payload parses to no hits, never an invention",
      fetch_wiki.parse_top({}, day) == []
      and fetch_wiki.parse_top({"items": []}, day) == [])

many = {"items": [{"articles": [
    {"article": f"Topic_{i}", "views": 1000 - i, "rank": i + 1}
    for i in range(30)]}]}
check("wiki: the lane caps at 15 hits",
      len(fetch_wiki.parse_top(many, day)) == fetch_wiki.MAX_HITS == 15)

check("no em dash in any generated title or summary",
      all("—" not in h["title"] and "—" not in h["summary"]
          for h in songs + apps + pods + wiki))

print("[test_charts_wiki] " + ("all checks passed" if not FAILS
                               else f"{len(FAILS)} FAILURES"))
sys.exit(1 if FAILS else 0)
