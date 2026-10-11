# PIPELINE.md — how Trend Machine stays live

## The loop

```
fetchers → pipeline/out/*.json → normalize.py → data/trends.json
                                              → scripts/build_site.py → topics/, api/v1/, llms.txt
                                              → pipeline/aggregate.py → api/v1/trends.flat.{json,js}
```

Run everything: `./pipeline/refresh.sh` (or `pipeline/refresh.sh` from the repo root).
Cron it (every 15 minutes is the sweet spot):

```
*/15 * * * * cd ~/workspace/trend-machine && ./pipeline/refresh.sh >> pipeline/refresh.log 2>&1
```

Or use the included GitHub Actions workflow (`.github/workflows/refresh.yml`) — same cadence, commits the result.

## Fetchers (`pipeline/fetch_*.py`)

| Fetcher | Source | Key needed | Status |
|---|---|---|---|
| `fetch_gtrends.py` | Google Trends daily RSS (US) | No | Working (the unofficial JSON endpoint 404s as of 2026-10-11 — removed) |
| `fetch_news.py` | Google News RSS (top/tech/entertainment/sports) | No | Working |
| `fetch_reddit.py` | Reddit public JSON (r/popular, r/memes, r/gaming, r/Music, r/tiktok) | No | Often 403 from datacenters — skips gracefully |
| `fetch_hn.py` | Hacker News top/best stories (public Firebase API) | No | Working |
| `fetch_mastodon.py` | Mastodon fediverse trending hashtags | No | Working |
| `fetch_youtube.py` | Invidious public API (`/api/v1/popular`, no key) → direct scrape fallback | No | Working via Invidious; set `YT_API_KEY` for the official Data API v3 path |
| `fetch_x.py` | X API v2 recent search | **Yes** (`X_BEARER_TOKEN`) | Full implementation; **skips silently with no key — X data is never faked** |

Every fetcher writes `pipeline/out/<name>.json` and **never crashes the run** —
failures print `[name] SKIP: <reason>` and the pipeline continues. Shared helpers
live in `pipeline/common.py`.

### API key setup

```bash
# YouTube Data API v3 (recommended for stable trending data)
export YT_API_KEY="..."

# X API v2 (free tier works for low-volume recent search)
# 1. Create a project at developer.x.com → get a Bearer Token
export X_BEARER_TOKEN="..."
```

Without keys the pipeline still runs on the public sources. Document which
sources were live in each run via `pipeline/refresh.log`.

### Adding a fetcher

1. Write `pipeline/fetch_<name>.py` emitting hits via `common.hit(...)`.
2. Add it to the loop in `pipeline/refresh.sh`.
3. Document its key requirements in the table above.

## Scoring (`pipeline/normalize.py`)

Dedup: normalized titles compared by token-set Jaccard similarity; ≥ 0.55 merges
into the existing topic (new source appended, `last_seen` refreshed).

- `velocity` = min(100, 25 × min(sources,3) + 20 × recency + hashtag bonus),
  where recency decays linearly over 48h. Seeded topics keep their researched
  velocity until re-corroborated.
- `saturation` = high (≥4 sources) / medium (≥2) / low.
- `opportunity_score` = round(velocity × (1 − penalty)), penalty low 0 / medium 0.35 / high 0.6.
  Thesis: high interest + low creator saturation = easy views.
- `stale` = true when `last_seen` is older than 72h. Stale topics are dimmed,
  never deleted (history matters).

## Seed data

`pipeline/seed.py` wrote the initial 30 topics from real web research on
2026-10-11 (news, TikTok trend trackers, gaming press). Each traces to a source
URL. The refresh pipeline corroborates or expires them like any other topic.
