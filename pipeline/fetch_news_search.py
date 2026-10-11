#!/usr/bin/env python3
"""Google News RSS *search* fetcher — KEYLESS, first-class.

Queries the public search endpoint per topic lane:
  https://news.google.com/rss/search?q=<query>&hl=en-US&gl=US&ceid=US:en
plus the Top Stories feed. A story surfacing under several different
queries in one run is a strong velocity signal for the aggregator.

No key, no signup. Keep the query list small — each query is one request.
"""
import re, sys, time, urllib.parse
sys.path.insert(0, __import__("os").path.dirname(__file__))
from common import fetch_text, hit, save_hits, extract_hashtags, clean

# (query, category, platforms)
QUERIES = [
    ("trending", "news", ["x", "tiktok", "youtube"]),
    ("artificial intelligence", "tech", ["x", "youtube"]),
    ("video games", "gaming", ["youtube", "twitch", "tiktok"]),
    ("movies", "entertainment", ["youtube", "tiktok"]),
    ("new music", "music", ["tiktok", "youtube"]),
    ("TikTok viral", "meme", ["tiktok", "instagram"]),
]

BASE = "https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
TOP = "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en"
PER_QUERY = 10

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
    feeds = [("gnews-top", TOP, "news", ["youtube", "x"])] + [
        (f"gnews-q:{q}", BASE.format(q=urllib.parse.quote(q)), cat, plats)
        for q, cat, plats in QUERIES
    ]
    for name, url, cat, plats in feeds:
        try:
            xml = fetch_text(url, timeout=20)
        except Exception as e:
            print(f"[news-search:{name}] SKIP: {e}")
            continue
        hits.extend(parse(xml, name, cat, plats))
        time.sleep(1)
    save_hits("news_search", hits)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[news-search] SKIP: {e}")
