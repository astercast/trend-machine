#!/usr/bin/env python3
"""Google Trends daily-trends RSS fetcher (public, no key).

Endpoint: https://trends.google.com/trending/rss?geo=US
Upgrade path: none needed — this is the public feed. For finer queries use
the unofficial pytrends library (documented in PIPELINE.md).
"""
import re, sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from common import fetch_text, hit, save_hits, extract_hashtags, clean

URL = "https://trends.google.com/trending/rss?geo=US"

def main():
    xml = fetch_text(URL)
    items = re.findall(r"<item>(.*?)</item>", xml, re.S)
    hits = []
    for it in items[:20]:
        title = clean(re.search(r"<title>(.*?)</title>", it, re.S).group(1))
        link = re.search(r"<link>(.*?)</link>", it, re.S).group(1).strip()
        desc = ""
        m = re.search(r"<description>(.*?)</description>", it, re.S)
        if m: desc = m.group(1)
        traffic = ""
        m = re.search(r"<ht:approx_traffic>(.*?)</ht:approx_traffic>", it)
        if m: traffic = m.group(1)
        hits.append(hit(
            title, link, "google-trends",
            summary=f"~{traffic} searches. {desc}" if traffic else desc,
            hashtags=extract_hashtags(title + " " + desc),
            category="news", platforms=["google"]))
    save_hits("gtrends", hits)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[gtrends] SKIP: {e}")
