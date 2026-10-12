#!/usr/bin/env python3
"""Mastodon trends fetcher (public API, no key, no signup).

https://mastodon.social/api/v1/trends/tags — trending hashtags of the
fediverse. Hashtags here often surface 12–48h before they hit mainstream
TikTok. (The path is /api/v1/trends/tags; /data/v1/trends 404s — that typo
kept this lane dark until wave 20.)
"""
import sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from common import fetch_json, hit, save_hits

def main():
    try:
        tags = fetch_json("https://mastodon.social/api/v1/trends/tags?limit=20")
    except Exception as e:
        print(f"[mastodon] SKIP: {e}")
        return
    hits = []
    for t in tags:
        name = t.get("name", "")
        hist = t.get("history", []) or []
        uses = sum(int(h.get("uses", 0)) for h in hist[:2])
        hits.append(hit(
            f"#{name}", t.get("url", f"https://mastodon.social/tags/{name}"),
            "mastodon-trends",
            summary=f"{uses} recent uses across the fediverse",
            hashtags=["#" + name], category="culture",
            platforms=["mastodon"]))
    save_hits("mastodon", hits)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[mastodon] SKIP: {e}")
