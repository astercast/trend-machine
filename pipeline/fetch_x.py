#!/usr/bin/env python3
"""X (Twitter) fetcher — BYO API KEY ONLY.

Reads X_BEARER_TOKEN from the environment and queries the X API v2 recent
search for high-velocity topics. With NO key this fetcher does nothing but
log a skip — it NEVER fabricates X data.

Setup (documented in PIPELINE.md):
  1. Create a project at developer.x.com, get a Bearer Token (free tier works
     for low-volume recent search).
  2. export X_BEARER_TOKEN="..."
  3. Add queries below for the lanes you care about.

Free-tier note: v2 recent search is rate-limited; the default query set is
small on purpose. Raise refresh cadence cost by adding queries carefully.
"""
import os, sys, json, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from common import hit, save_hits, USER_AGENT, extract_hashtags

QUERIES = [
    ("min_faves:1000 lang:en -is:retweet", "meme", ["x", "tiktok"]),
    ("#gaming min_faves:500 lang:en -is:retweet", "gaming", ["x", "youtube"]),
    ("#newmusic min_faves:500 lang:en -is:retweet", "music", ["x", "tiktok"]),
]

def main():
    token = os.environ.get("X_BEARER_TOKEN", "").strip()
    if not token:
        print("[x] SKIP: X_BEARER_TOKEN not set — no X data (never faked). See PIPELINE.md.")
        return
    hits = []
    for q, cat, plats in QUERIES:
        params = urllib.parse.urlencode({
            "query": q, "max_results": 20,
            "tweet.fields": "public_metrics,created_at",
            "expansions": "author_id", "user.fields": "username"})
        req = urllib.request.Request(
            f"https://api.x.com/2/tweets/search/recent?{params}",
            headers={"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.load(r)
        except Exception as e:
            print(f"[x] query SKIP: {e}")
            continue
        users = {u["id"]: u["username"] for u in data.get("includes", {}).get("users", [])}
        for t in data.get("data", []):
            m = t.get("public_metrics", {})
            author = users.get(t.get("author_id", ""), "x")
            hits.append(hit(
                t["text"][:160], f"https://x.com/{author}/status/{t['id']}",
                "x-api",
                summary=f"@{author} · {m.get('like_count',0)} likes · {m.get('retweet_count',0)} RTs",
                hashtags=extract_hashtags(t["text"]),
                category=cat, platforms=plats))
    save_hits("x", hits)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[x] SKIP: {e}")
