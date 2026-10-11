#!/usr/bin/env python3
"""Reddit public-JSON fetcher (no key, custom UA).

Subreddits sampled: popular (velocity), memes, gaming, Music, tiktok.
Reddit rate-limits aggressively — keep the subreddit list small and the
refresh cadence >= 15 min (see PIPELINE.md).
"""
import sys, time
sys.path.insert(0, __import__("os").path.dirname(__file__))
from common import fetch_json, hit, save_hits, extract_hashtags

SUBS = {
    "r/popular": ("news", ["x", "tiktok"]),
    "r/memes": ("meme", ["tiktok", "instagram"]),
    "r/gaming": ("gaming", ["youtube", "twitch"]),
    "r/Music": ("music", ["tiktok", "youtube"]),
    "r/tiktok": ("meme", ["tiktok"]),
}

def main():
    hits = []
    for sub, (cat, plats) in SUBS.items():
        try:
            data = fetch_json(f"https://www.reddit.com/{sub}/hot/.json?limit=25")
        except Exception as e:
            print(f"[reddit:{sub}] SKIP: {e}")
            continue
        for c in data["data"]["children"][:20]:
            d = c["data"]
            if d.get("stickied") or d.get("over_18"):
                continue
            score = d.get("score", 0)
            comments = d.get("num_comments", 0)
            hits.append(hit(
                d.get("title", ""), "https://www.reddit.com" + d.get("permalink", ""),
                f"reddit-{sub}",
                summary=f"{score} upvotes · {comments} comments · r/{d.get('subreddit','')}",
                hashtags=extract_hashtags(d.get("title", "")),
                category=cat, platforms=plats))
        time.sleep(2)  # be polite to Reddit
    save_hits("reddit", hits)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[reddit] SKIP: {e}")
