#!/usr/bin/env python3
"""Bluesky trending-topics fetcher (public API, no key, no signup).

https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrendingTopics
is Bluesky's unauthenticated trending-topics endpoint: the network's own
"what's hot right now" list with a one-line description per topic.
Verified working keyless 2026-10-11 (HTTP 200, real topics: e.g. the
"Resume gap interview meme", National Coming Out Day, Canadian
Thanksgiving). Topics land here hours before they cross to mainstream
press — the same early-signal role the Mastodon fetcher plays.
"""
import sys
from urllib.parse import quote_plus
sys.path.insert(0, __import__("os").path.dirname(__file__))
from common import fetch_json, hit, save_hits, extract_hashtags

ENDPOINT = ("https://public.api.bsky.app/xrpc/"
            "app.bsky.unspecced.getTrendingTopics?limit=10")

def main():
    try:
        data = fetch_json(ENDPOINT)
    except Exception as e:
        print(f"[bluesky] SKIP: {e}")
        return
    topics = data.get("topics", []) or []
    if not topics:
        print("[bluesky] SKIP: empty topics list")
        return
    hits = []
    for t in topics:
        topic = (t.get("displayName") or t.get("topic") or "").strip()
        if not topic:
            continue
        desc = t.get("description", "") or ""
        hits.append(hit(
            topic,
            "https://bsky.app/search?q=" + quote_plus(topic),
            "bluesky-trending",
            summary=desc or "Trending on Bluesky right now",
            hashtags=extract_hashtags(topic + " " + desc),
            category=None, platforms=["bluesky"]))
    save_hits("bluesky", hits)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[bluesky] SKIP: {e}")
