#!/usr/bin/env python3
"""Google News RSS fetcher (public, no key).

Pulls top stories + category feeds. Headline velocity = a story appearing
across multiple category feeds in one run.
"""
import re, sys, urllib.parse
sys.path.insert(0, __import__("os").path.dirname(__file__))
from common import fetch_text, hit, save_hits, extract_hashtags, clean

FEEDS = {
    "top": "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
    "technology": "https://news.google.com/rss/search?q=technology&hl=en-US&gl=US&ceid=US:en",
    "entertainment": "https://news.google.com/rss/search?q=entertainment+news&hl=en-US&gl=US&ceid=US:en",
    "sports": "https://news.google.com/rss/search?q=sports&hl=en-US&gl=US&ceid=US:en",
    "ai": "https://news.google.com/rss/search?q=artificial+intelligence&hl=en-US&gl=US&ceid=US:en",
}

def main():
    hits = []
    for cat, url in FEEDS.items():
        try:
            xml = fetch_text(url)
        except Exception as e:
            print(f"[news:{cat}] SKIP: {e}")
            continue
        for it in re.findall(r"<item>(.*?)</item>", xml, re.S)[:15]:
            title = clean(re.search(r"<title>(.*?)</title>", it, re.S).group(1))
            # Google News titles look like "Headline - Outlet"
            outlet = ""
            if " - " in title:
                title, outlet = title.rsplit(" - ", 1)
            link = re.search(r"<link>(.*?)</link>", it, re.S).group(1).strip()
            pub = ""
            m = re.search(r"<pubDate>(.*?)</pubDate>", it)
            if m: pub = m.group(1)
            hits.append(hit(
                title, link, f"gnews-{cat}",
                summary=f"{outlet} · {pub}" if outlet else pub,
                hashtags=extract_hashtags(title),
                category={"technology": "tech", "entertainment": "entertainment",
                          "sports": "sports", "ai": "tech"}.get(cat, "news"),
                platforms=["youtube", "x"]))
    save_hits("news", hits)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[news] SKIP: {e}")
