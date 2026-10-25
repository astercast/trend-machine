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
        # Each trending search ships with the news stories behind it, from
        # named outlets. They are the independent second voice for this signal.
        also = []
        for ni in re.findall(r"<ht:news_item>(.*?)</ht:news_item>", it, re.S)[:3]:
            nt = re.search(r"<ht:news_item_title>(.*?)</ht:news_item_title>", ni, re.S)
            nu = re.search(r"<ht:news_item_url>(.*?)</ht:news_item_url>", ni, re.S)
            ns = re.search(r"<ht:news_item_source>(.*?)</ht:news_item_source>", ni, re.S)
            if nt and nu:
                also.append({"name": "gtrends-news:" + clean(ns.group(1) if ns else "outlet"),
                             "url": nu.group(1).strip(), "title": clean(nt.group(1))[:160]})
        hits.append(hit(
            title, link, "google-trends",
            summary=f"~{traffic} searches. {desc}" if traffic else desc,
            hashtags=extract_hashtags(title + " " + desc),
            category="news", platforms=["google"], also=also))
    save_hits("gtrends", hits)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[gtrends] SKIP: {e}")
