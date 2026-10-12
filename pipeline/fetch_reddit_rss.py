#!/usr/bin/env python3
"""Reddit public-RSS fetcher — KEYLESS, first-class.

Reads Atom feeds (lighter and less rate-limited than the .json endpoints):
  https://www.reddit.com/r/<sub>/.rss
High-velocity subs are a direct topic-velocity signal: front-page posts
with big comment counts are what the rest of the internet talks about
tomorrow.

Custom User-Agent required; 429/403 per subreddit skips gracefully.
Keep the subreddit list small and the refresh cadence >= 15 min.
"""
import re, sys, time
sys.path.insert(0, __import__("os").path.dirname(__file__))
from common import fetch_text, hit, save_hits, extract_hashtags, clean

# (subreddit, category, platforms) — platforms names the source actually
# observed (Reddit), never a guessed cross-platform home (wave-16 rule;
# old guesses removed in wave 20).
SUBS = [
    ("news", "news", ["reddit"]),
    ("television", "entertainment", ["reddit"]),
    ("gaming", "gaming", ["reddit"]),
    ("Music", "music", ["reddit"]),
    ("movies", "entertainment", ["reddit"]),
    ("YouTube", "entertainment", ["reddit"]),
]

PER_SUB = 12

def parse(xml, sub, cat, plats):
    hits = []
    for entry in re.findall(r"<entry>(.*?)</entry>", xml, re.S)[:PER_SUB]:
        title = re.search(r"<title>(.*?)</title>", entry, re.S)
        link = re.search(r'<link href="([^"]+)"', entry)
        updated = re.search(r"<updated>(.*?)</updated>", entry)
        author = re.search(r"<author>\s*<name>(.*?)</name>", entry, re.S)
        if not (title and link):
            continue
        hits.append(hit(
            title.group(1), link.group(1), f"reddit-rss:r/{sub}",
            summary=f"u/{author.group(1).strip() if author else '?'} · "
                    f"r/{sub} · {updated.group(1)[:10] if updated else ''}",
            hashtags=extract_hashtags(title.group(1)),
            category=cat, platforms=plats))
    return hits

def main():
    hits = []
    for sub, cat, plats in SUBS:
        try:
            xml = fetch_text(f"https://www.reddit.com/r/{sub}/.rss", timeout=20)
        except Exception as e:
            print(f"[reddit-rss:r/{sub}] SKIP: {e}")
            continue
        hits.extend(parse(xml, sub, cat, plats))
        time.sleep(2)  # be polite to Reddit
    save_hits("reddit_rss", hits)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[reddit-rss] SKIP: {e}")
