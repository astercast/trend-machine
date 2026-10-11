---
name: trend-spotting
description: Find what's trending right now and whether it's worth covering.
---

# Spot a trend worth covering

## Use when

Before making any video, check what's moving. A good topic beats a good video.

## Inputs

- `api/v1/trends.json` (or the dashboard)
- Your niche and platforms

## Procedure

1. Pull the feed, sort by `opportunity_score` desc. Take the top 10.
2. Filter to your platforms and categories. Discard `stale: true` topics unless you're doing a retrospective.
3. For each candidate, check `velocity` vs `saturation`: high velocity + low saturation is the sweet spot (easy views). High velocity + high saturation means you'll be voice #10,000 — only enter with a genuinely new angle.
4. Check `first_seen`: under 48h old = early; over a week = you're late, need a twist.
5. Read the dossier's angles. If none of the 3–5 angles fit your voice, skip the topic — forced coverage flops.

## Worked example

"Two Fishes" audio: velocity 88, saturation low, first seen 6 days ago. A comedy creator's take: "defending my niche's most unreasonable opinion deadpan." Fits the format, early enough, low competition → green light.

## Pitfalls

- Chasing high-velocity + high-saturation topics with a generic take — you become background noise.
- Covering a stale topic straight — if it's flagged STALE, you need a "where are they now" frame or skip it.
- Ignoring `platforms`: a TikTok-native meme rarely ports cleanly to long-form YouTube.
