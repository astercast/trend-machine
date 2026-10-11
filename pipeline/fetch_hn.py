#!/usr/bin/env python3
"""Hacker News front-page fetcher (public Firebase API, no key).

https://github.com/HackerNews/API — topstories + beststories. Strong for
tech/AI/startup topics that become YouTube explainer fodder.
"""
import sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from common import fetch_json, hit, save_hits

BASE = "https://hacker-news.firebaseio.com/v0"

def main():
    hits = []
    for endpoint in ("topstories", "beststories"):
        try:
            ids = fetch_json(f"{BASE}/{endpoint}.json")[:25]
        except Exception as e:
            print(f"[hn:{endpoint}] SKIP: {e}")
            continue
        for i in ids:
            try:
                it = fetch_json(f"{BASE}/item/{i}.json")
            except Exception:
                continue
            if not it or it.get("type") != "story":
                continue
            url = it.get("url") or f"https://news.ycombinator.com/item?id={i}"
            hits.append(hit(
                it.get("title", ""), url, "hackernews",
                summary=f"{it.get('score',0)} points · {it.get('descendants',0)} comments",
                category="tech", platforms=["youtube", "x"]))
    save_hits("hn", hits)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[hn] SKIP: {e}")
