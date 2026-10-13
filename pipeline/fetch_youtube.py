#!/usr/bin/env python3
"""YouTube trending fetcher — RETIRED 2026-10-13 (DATAOPS-001, wave 31).

This fetcher is OUT of pipeline/refresh.sh and its stored output
(pipeline/out/youtube.json) is deleted. Evidence for the retirement,
verified live on 2026-10-13 through this pipeline's own fetch paths:
  - all three configured Invidious instances fail, three different
    ways (nadeko: non-JSON — its registry entry now reads api: false;
    nerdvpn: HTTP 403, also api: false; melmac: connection dropped);
  - the official registry (api.invidious.io/instances.json) lists
    exactly ONE API-enabled public instance (invidious.f5.si), and it
    answers /data/v1/* with an anti-bot HTML page, not JSON;
  - the direct-scrape target is gone: youtube.com/feed/trending
    returns a generic ~950 KB page with ZERO videoRenderer blocks —
    there is no trending markup left to parse.
YouTube coverage rides pipeline/fetch_youtube_rss.py (channel RSS,
80 hits/run). REVIVAL PATH: set YT_API_KEY (the Data API v3 path
below still works with a key) and re-add fetch_youtube to the
refresh.sh loop; the Live Wire lane def in scripts/build_live_wire.js
carries the matching `retired` flag to remove.

NO-KEY PATH (best effort), in order:
  1. Invidious public instances (no key, no signup): /data/v1/popular.
     Instances rotate; the fetcher tries several.
  2. Direct youtube.com/feed/trending scrape (markup changes often).
API-KEY UPGRADE PATH (recommended): set YT_API_KEY and this fetcher uses the
YouTube Data API v3 videos.list?chart=mostPopular&regionCode=US — stable and
complete. See PIPELINE.md for setup.
"""
import os, re, sys, json, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from common import fetch_text, hit, save_hits, USER_AGENT

def via_api(key):
    params = urllib.parse.urlencode({
        "part": "snippet,statistics", "chart": "mostPopular",
        "regionCode": "US", "maxResults": 25, "key": key})
    req = urllib.request.Request(
        f"https://www.googleapis.com/youtube/v3/videos?{params}",
        headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.load(r)
    hits = []
    for v in data.get("items", []):
        sn = v["snippet"]; st = v.get("statistics", {})
        views = int(st.get("viewCount", 0))
        hits.append(hit(
            sn["title"], f"https://www.youtube.com/watch?v={v['id']}",
            "youtube-api",
            summary=f"{views:,} views · {sn.get('channelTitle','')}",
            category="entertainment", platforms=["youtube"]))
    return hits

INVIDIOUS = [
    "https://inv.nadeko.net",
    "https://invidious.nerdvpn.de",
    "https://iv.melmac.space",
]

def via_invidious():
    from common import fetch_json
    for inst in INVIDIOUS:
        try:
            data = fetch_json(inst + "/data/v1/popular", timeout=15)
        except Exception as e:
            print(f"[youtube] invidious {inst} SKIP: {e}")
            continue
        hits = []
        for v in data[:25]:
            views = v.get("viewCount", 0)
            hits.append(hit(
                v.get("title", ""), "https://www.youtube.com/watch?v=" + v.get("videoId", ""),
                "youtube-invidious",
                summary=f"{views:,} views · {v.get('author','')}",
                category="entertainment", platforms=["youtube"]))
        if hits:
            return hits
    raise RuntimeError("all invidious instances failed")

def via_scrape():
    html = fetch_text("https://www.youtube.com/feed/trending", timeout=25)
    # videoRenderer JSON blobs in the page data
    titles = re.findall(r'"videoRenderer":\{"videoId":"([\w-]{11})","thumbnail".*?"title":\{"runs":\[\{"text":"(.*?)"', html)
    hits, seen = [], set()
    for vid, title in titles:
        if vid in seen: continue
        seen.add(vid)
        title = title.encode().decode("unicode_escape", "replace")
        hits.append(hit(title, f"https://www.youtube.com/watch?v={vid}",
                        "youtube-scrape", category="entertainment",
                        platforms=["youtube"]))
        if len(hits) >= 25: break
    if not hits:
        raise RuntimeError("no videoRenderer blocks parsed (markup changed?)")
    return hits

def main():
    key = os.environ.get("YT_API_KEY", "").strip()
    if key:
        hits = via_api(key)
        print("[youtube] via Data API v3")
    else:
        try:
            hits = via_invidious()
            print("[youtube] via Invidious public API (set YT_API_KEY for official data)")
        except Exception as e:
            print(f"[youtube] invidious failed: {e}; trying direct scrape")
            hits = via_scrape()
            print("[youtube] via no-key scrape")
    save_hits("youtube", hits)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[youtube] SKIP: {e}")
