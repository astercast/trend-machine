#!/usr/bin/env python3
"""YouTube public channel-RSS fetcher — KEYLESS, first-class.

Reads the official public feeds:
  https://www.youtube.com/feeds/videos.xml?channel_id=<CHANNEL_ID>
No API key, no signup, no scraping of HTML. A curated channel list covering
trending/entertainment/news/gaming/sports/music/tech gives a keyless
topic-velocity signal: when several channels in one lane publish on the
same topic within a run, the aggregator scores it hot.

Channel IDs were verified 2026-10-11 against each channel's canonical
<link> on youtube.com/@handle (never from memory). Re-verify a channel by
re-running that check if its feed 404s — IDs do change on rebrands.
"""
import re, sys, time, urllib.parse
sys.path.insert(0, __import__("os").path.dirname(__file__))
from common import fetch_text, hit, save_hits, extract_hashtags, clean

# (channel_id, label, category, platforms)
CHANNELS = [
    ("UCX6OQ3DkcsbYNE6H8uQQuVA", "MrBeast",      "entertainment", ["youtube", "tiktok"]),
    ("UC-lHJZR3Gqxm24_Vd_AJ5Yw", "pewdiepie",    "entertainment", ["youtube"]),
    ("UCBJycsmduvYEL83R_U4JriQ", "MKBHD",        "tech",          ["youtube", "x"]),
    ("UCXuqSBlHAE6Xw-yeJA0Tunw", "LinusTechTips","tech",          ["youtube"]),
    ("UC16niRr50-MSBwiO3YDb3RA", "BBCNews",      "news",          ["youtube", "x"]),
    ("UCKy1dAqELo0zrOtPkf0eTMw", "IGN",          "gaming",        ["youtube", "twitch"]),
    ("UCiWLfSweyRNmLpgEHekhoAg", "ESPN",         "sports",        ["youtube", "x"]),
    ("UC2pmfLm7iq6Ov1UwYrWYkZA", "VEVO",         "music",         ["youtube", "tiktok"]),
    ("UC4eYXhJI4-7wSWc8UNRwD4A", "NPRMusic",     "music",         ["youtube"]),
    ("UCsT0YIqwnpJCM-mx7-gSA4Q", "TEDx",         "culture",       ["youtube"]),
]

PER_CHANNEL = 8

def parse_feed(xml):
    out = []
    for entry in re.findall(r"<entry>(.*?)</entry>", xml, re.S):
        vid = re.search(r"<yt:videoId>(.*?)</yt:videoId>", entry)
        title = re.search(r"<title>(.*?)</title>", entry, re.S)
        link = re.search(r'<link rel="alternate" href="([^"]+)"', entry)
        pub = re.search(r"<published>(.*?)</published>", entry)
        desc = re.search(r"<media:description>(.*?)</media:description>", entry, re.S)
        if not (vid and title and link):
            continue
        out.append({
            "video_id": vid.group(1),
            "title": title.group(1),
            "url": link.group(1),
            "published": pub.group(1) if pub else "",
            "description": desc.group(1) if desc else "",
        })
        if len(out) >= PER_CHANNEL:
            break
    return out

def main():
    hits = []
    for cid, label, cat, plats in CHANNELS:
        try:
            xml = fetch_text(
                f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}",
                timeout=20)
        except Exception as e:
            print(f"[yt-rss:{label}] SKIP: {e}")
            continue
        for v in parse_feed(xml):
            hits.append(hit(
                v["title"], v["url"], f"yt-rss:{label}",
                summary=f"{label} · published {v['published'][:10]}. {v['description'][:200]}",
                hashtags=extract_hashtags(v["title"]),
                category=cat, platforms=plats))
        time.sleep(1)  # be polite to the feed endpoint
    save_hits("youtube_rss", hits)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[yt-rss] SKIP: {e}")
