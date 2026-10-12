# Trend Machine

**What should I make content about TODAY?** Live trending-topic intelligence for
creators and agents: the hottest topics, memes, and hashtags right now, scored
by opportunity (high interest + low creator saturation = easy views).

Brother site of the [Creator Growth Empire](../creator-growth-empire/) guide —
trends are the *what*, the guide is the *how*.

## The dashboard

- **Hot right now** — top 5 by opportunity, above the fold. Open it and know in 10 seconds.
- **◉ Meme radar** — viral formats, sounds, and brainrot as it happens. Memes die in days; the radar only shows what's breathing.
- **All signals** — sortable/filterable table of every tracked topic with live freshness indicators (pulsing = minutes old, grey = stale).
- Every topic → a dossier: why it's trending, sources, 3–5 content angles, hook lines, who to watch, guide cross-links.
- **Signal history** — every dossier shows a velocity sparkline from real per-run snapshots (hourly, 14-day window), honestly labeled "tracked since <date>".
- **⧉ Remix this** — one-click copy of a topic's angles, hook lines and hashtags as plain text, ready to paste into a content plan.
- **Format chips** — meme-format signals (`pov`, `challenge`, `sound`, `dance`, `meme`, …) detected pattern-wise and tagged on dossiers.

## The pipeline

Pluggable Python fetchers (`pipeline/`): Google Trends RSS, Google News RSS,
Reddit public JSON, YouTube (best-effort scrape, API-key upgrade path), X
(BYO bearer token — **never faked**), and a TikTok **stub** (no reliable
keyless source exists — verified 2026-10-11, documented honestly in
PIPELINE.md). `normalize.py` dedupes, merges, scores, snapshots velocity
history, and detects meme-format signals; `refresh.sh` runs the loop
(cron-ready, 15 min). Full docs: [PIPELINE.md](PIPELINE.md).

**Scoring:** `opportunity = velocity × (1 − saturation penalty)`. Documented in PIPELINE.md.

## For agents

- `data/v1/trends.json` — everything, machine-readable. Sort by `opportunity_score` desc, skip `stale: true`.
- `data/v1/hashtags.json`, `data/v1/schema/trend.json`, `llms.txt`, `llms-full.txt`
- `skills/` — trend-spotting, angle-generation, hashtag-research, velocity-reading, remix-ideation
- [API.md](API.md) · [LIVE.md](LIVE.md)

## Status

Private repo, GitHub-only. Static site + pipeline; goes live on any static host
(see LIVE.md). No Vercel, no trackers, no invented trends.
