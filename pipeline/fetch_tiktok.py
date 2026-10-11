#!/usr/bin/env python3
"""TikTok lane fetcher — STUB (no reliable keyless source exists).

Research (2026-10-11, documented in PIPELINE.md):
- TikTok's official Research API is free BUT requires institutional access:
  non-profit academic affiliation + a formal research proposal approved by
  TikTok's USDS division. Not available to an indie tracker — we don't
  qualify, and the terms restrict data to the approved research project only.
- There is NO official keyless trending endpoint. TikTok's own public pages
  (tiktok.com/tag/...) are JS-rendered and fetch data through signed
  www.tiktok.com/api/* endpoints (msToken + signed params) that are not
  meant for programmatic access; page loads from a server return no
  extractable content (verified 2026-10-11 — no scrapeable surface).
- TikTok's Terms of Service bar automated data collection without written
  approval. We don't scrape TikTok, period.
- Third-party options that exist but need a key/account and aren't free
  tier keyless: TrendsMCP (free key, 100 req/day), TikAPI.io (paid),
  Apify TikTok actors (paid/breakable). None wired by default — cost and
  reliability are the builder's call.

What this stub does: NOTHING but log why. If a TikTok source ever becomes
available, implement it here behind an env var (e.g. TIKTOK_TRENDS_API_KEY)
following the fetch_x.py pattern, and emit hits via common.hit(...).

Until then the TikTok lane is covered by editorial seed topics +
cross-platform corroboration (r/tiktok via fetch_reddit.py, TikTok hashtag
trackers like Revid via seed research). NEVER fake TikTok data.
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

TIKTOK_API_KEY = os.environ.get("TIKTOK_TRENDS_API_KEY", "").strip()

def main():
    if not TIKTOK_API_KEY:
        print("[tiktok] SKIP: no TikTok API key set (TIKTOK_TRENDS_API_KEY). "
              "TikTok has no keyless trending endpoint; the lane stays covered "
              "by seed topics + cross-platform corroboration. Never faked. "
              "See PIPELINE.md.")
        return
    # A keyed path goes here when one is vetted. Until then: never fake.
    print("[tiktok] SKIP: TIKTOK_TRENDS_API_KEY present but no vetted keyed "
          "implementation yet — refusing to guess an endpoint. See PIPELINE.md.")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[tiktok] SKIP: {e}")
