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

WAVE 6 (2026-10-11) FLAKINESS NOTE: YouTube's /feeds/videos.xml endpoint
serves intermittent 404/500s for VALID channel IDs from this server
(verified: YouTube's own channel UCBR8-60-B28hp2BmDPdntcQ also 404'd on
all 3 probes the same hour, and a failing channel returned 200 on a later
retry). The 10 IDs below are all the canonical well-known IDs; the failures
are endpoint flakiness, not wrong IDs. Each feed is now fetched with
retry + backoff (3 attempts, 0/3/9s), and when the official feed still
flaps, the fetcher falls back to parsing the channel's own /videos page
(ytInitialData JSON — real titles/URLs from the channel's videos tab).
"""
import re, sys, time, json, urllib.parse
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
FEED_ATTEMPTS = 3          # wave 6: YouTube 404/500s are flaky, not wrong IDs
FEED_BACKOFF_S = [0, 3, 9]  # exponential-ish waits between attempts

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

def fetch_feed(cid, label):
    """Fetch one channel feed with retry+backoff. Returns (xml, attempts)."""
    last_err = None
    for attempt in range(FEED_ATTEMPTS):
        if FEED_BACKOFF_S[attempt]:
            time.sleep(FEED_BACKOFF_S[attempt])
        try:
            return fetch_text(
                f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}",
                timeout=20), attempt + 1
        except Exception as e:
            last_err = e
            if attempt < FEED_ATTEMPTS - 1:
                print(f"[yt-rss:{label}] attempt {attempt + 1} failed ({e}) — retrying")
    return None, FEED_ATTEMPTS

def fetch_via_channel_page(label):
    """Fallback: parse the channel's own /videos page (ytInitialData JSON).

    Same real data as the RSS (the channel's latest videos: id, title,
    URL, views/age), only used when the official feed endpoint flaps.
    """
    page_html = fetch_text(f"https://www.youtube.com/@{label}/videos", timeout=25)
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", page_html, re.S)
    if not m:
        raise RuntimeError("ytInitialData not found on channel page")
    data = json.loads(m.group(1))
    tabs = data["contents"]["twoColumnBrowseResultsRenderer"]["tabs"]
    grid = None
    for t in tabs:
        tr = t.get("tabRenderer", {})
        if "richGridRenderer" in tr.get("content", {}):
            grid = tr["content"]["richGridRenderer"]["contents"]
            break
    if not grid:
        raise RuntimeError("no videos grid on channel page")
    out = []
    for it in grid:
        try:
            lv = it["richItemRenderer"]["content"]["lockupViewModel"]
            vid = (lv["rendererContext"]["commandContext"]["onTap"]
                     ["innertubeCommand"]["watchEndpoint"]["videoId"])
            md = lv["metadata"]["lockupMetadataViewModel"]
            title = md["title"]["content"]
            meta = []
            rows = (md.get("metadata", {}).get("contentMetadataViewModel", {})
                      .get("metadataRows", []))
            for row in rows:
                for part in row.get("metadataParts", []):
                    label_text = (part.get("accessibilityLabel")
                                  or (part.get("text") or {}).get("content"))
                    if label_text:
                        meta.append(label_text)
        except (KeyError, TypeError):
            continue
        out.append({
            "video_id": vid,
            "title": title,
            "url": f"https://www.youtube.com/watch?v={vid}",
            "published": "",
            "description": " · ".join(meta),
        })
        if len(out) >= PER_CHANNEL:
            break
    if not out:
        raise RuntimeError("no videos parsed from channel page")
    return out

def main():
    hits = []
    ok_feeds = 0
    for cid, label, cat, plats in CHANNELS:
        videos = []
        xml, attempts = fetch_feed(cid, label)
        if xml is None:
            print(f"[yt-rss:{label}] RSS flapping — trying channel page fallback")
            try:
                videos = fetch_via_channel_page(label)
                print(f"[yt-rss:{label}] channel page ok: {len(videos)} videos")
            except Exception as e:
                print(f"[yt-rss:{label}] SKIP after {attempts} RSS attempts + page fallback ({e})")
                continue
        else:
            videos = parse_feed(xml)
        ok_feeds += 1
        for v in videos:
            pub = f"published {v['published'][:10]}. " if v.get("published") else ""
            hits.append(hit(
                v["title"], v["url"], f"yt-rss:{label}",
                summary=f"{label} · {pub}{v['description'][:200]}",
                hashtags=extract_hashtags(v["title"]),
                category=cat, platforms=plats))
        time.sleep(1)  # be polite to the feed endpoint
    print(f"[yt-rss] {ok_feeds}/{len(CHANNELS)} feeds ok")
    save_hits("youtube_rss", hits)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[yt-rss] SKIP: {e}")
