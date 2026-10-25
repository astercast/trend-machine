#!/usr/bin/env python3
"""Lemmy hot-posts fetcher (public API, no key, no signup).

https://lemmy.world/api/v3/post/list?sort=Hot&type_=All — the hot
link posts across the Lemmy fediverse, from the largest public
instance. Added 2026-10-24 (freshness widening): a second fediverse
lane alongside Mastodon/Bluesky, so a story rising outside the
commercial platforms is still seen. Every hit records the post's own
external URL (or its lemmy.world permalink) as its source.
"""
import sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from common import fetch_json, hit, save_hits, extract_hashtags

ENDPOINT = "https://lemmy.world/api/v3/post/list?sort=Hot&type_=All&limit=30"

def main():
    try:
        data = fetch_json(ENDPOINT, timeout=30)
    except Exception as e:
        print(f"[lemmy] SKIP: {e}")
        return
    hits = []
    for pv in data.get("posts", []):
        post = pv.get("post", {}) or {}
        if post.get("removed") or post.get("deleted") or post.get("nsfw"):
            continue
        title = post.get("name", "")
        if not title:
            continue
        url = post.get("url") or f"https://lemmy.world/post/{post.get('id')}"
        community = (pv.get("community", {}) or {}).get("title", "")
        counts = pv.get("counts", {}) or {}
        bits = []
        if community:
            bits.append(community)
        if counts.get("score") is not None:
            bits.append(f"{counts['score']} points")
        if counts.get("comments") is not None:
            bits.append(f"{counts['comments']} comments")
        hits.append(hit(
            title, url, "lemmy-hot",
            summary=" · ".join(bits) + " on Lemmy" if bits else "Hot on Lemmy",
            hashtags=extract_hashtags(title),
            category="news", platforms=["lemmy"]))
    save_hits("lemmy", hits)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[lemmy] SKIP: {e}")
