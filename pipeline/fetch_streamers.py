#!/usr/bin/env python3
"""Streamer Desk wire fetcher — KEYLESS, first-class (wave 29).

The Streamer Desk's one live lane: Google News RSS searches for the
streamer beat (the Desk's houses, platforms and tentpole events).
Same contract as fetch_news_search.py — the query text is a search
term, not evidence a story trends on the platform it names.

The Desk payload itself (data/v1/streamer-desk.json) is CURATED and
never written by this fetcher. This lane exists so the Live Wire can
report the streamer beat's real recorded hit count and health with
the same honesty as every other lane: a rewritten empty file is
degraded, an unrewritten file is stale-skip, and no hit is faked.
On total failure the fetcher still saves (empty) so the lane reads
degraded — never silently stale, never silently live.
"""
import re, sys, time, urllib.parse
sys.path.insert(0, __import__("os").path.dirname(__file__))
from common import fetch_text, hit, save_hits, extract_hashtags, clean

QUERIES = [
    ("Twitch streamer", "streaming", ["google"]),
    ("Kai Cenat", "streaming", ["google"]),
    ("streamer subathon OR TwitchCon", "streaming", ["google"]),
    ("FaZe Clan OR OTK streamer", "streaming", ["google"]),
]

BASE = "https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
PER_QUERY = 8


def parse(xml, source, cat, plats):
    hits = []
    for it in re.findall(r"<item>(.*?)</item>", xml, re.S)[:PER_QUERY]:
        title = clean(re.search(r"<title>(.*?)</title>", it, re.S).group(1))
        outlet = ""
        if " - " in title:
            title, outlet = title.rsplit(" - ", 1)
        link = re.search(r"<link>(.*?)</link>", it, re.S).group(1).strip()
        pub = ""
        m = re.search(r"<pubDate>(.*?)</pubDate>", it)
        if m:
            pub = m.group(1)
        hits.append(hit(
            title, link, source,
            summary=f"{outlet} · {pub}" if outlet else pub,
            hashtags=extract_hashtags(title),
            category=cat, platforms=plats))
    return hits


def main():
    hits = []
    ok = 0
    for q, cat, plats in QUERIES:
        name = f"gnews-q:{q}"
        try:
            xml = fetch_text(BASE.format(q=urllib.parse.quote(q)), timeout=20)
        except Exception as e:
            print(f"[streamers:{name}] SKIP: {e}")
            continue
        ok += 1
        hits.extend(parse(xml, name, cat, plats))
        time.sleep(1)
    if not ok:
        print("[streamers] all queries failed — saving empty (degraded, not faked)")
    save_hits("streamers", hits)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[streamers] SKIP: {e}")
        try:
            save_hits("streamers", [])
        except Exception:
            pass
