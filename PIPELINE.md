# PIPELINE.md — how Trend Machine stays live

## The loop

```
fetchers → pipeline/out/*.json → normalize.py → data/trends.json
                                              → scripts/build_site.py → topics/, data/v1/, llms.txt
                                              → pipeline/aggregate.py → data/v1/trends.flat.{json,js}
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
| `fetch_news_search.py` | Google News RSS topic searches | No | Working |
| `fetch_reddit.py` | Reddit public JSON (r/popular, r/memes, r/gaming, r/Music, r/tiktok) | No | Often 403 from datacenters — skips gracefully |
| `fetch_reddit_rss.py` | Reddit subreddit RSS feeds | No | Working |
| `fetch_hn.py` | Hacker News top/best stories (public Firebase API) | No | Working |
| `fetch_mastodon.py` | Mastodon fediverse trending hashtags | No | Working |
| `fetch_bluesky.py` | Bluesky trending topics (`public.api.bsky.app` unauthenticated `getTrendingTopics`) | No | **New wave 11**: verified keyless 2026-10-11 (HTTP 200, real topics w/ descriptions); early-signal lane like Mastodon — 10 hits/run |
| `fetch_youtube.py` | Invidious public API (`/data/v1/popular`, no key) → direct scrape fallback | No | Working via Invidious; set `YT_API_KEY` for the official Data API v3 path |
| `fetch_youtube_rss.py` | YouTube channel RSS (`/feeds/videos.xml`) → channel `/videos` page fallback | No | **Repaired wave 6**: official RSS endpoint intermittently 404/500s on *valid* IDs (verified via control channels) — now retries 3× with backoff, then parses each channel's own `/videos` page (ytInitialData JSON, real titles/URLs). 10/10 feeds ok, 80 hits |
| `fetch_tiktok.py` | **STUB — no reliable keyless source exists** (see "The TikTok lane" below) | N/A (wired in `refresh.sh`, logs a SKIP) | Stub; never fakes data |
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

## The TikTok lane (researched 2026-10-11 — wave 2)

There is **no reliable keyless TikTok trend source**, verified by direct
testing on 2026-10-11:

- **TikTok Research API** (developers.tiktok.com): free, but access is
  gated — non-profit academic affiliation + a formal research proposal
  approved by TikTok's USDS division. An indie tracker doesn't qualify,
  and granted data is contractually limited to the approved project.
- **No official public trending endpoint exists.** TikTok's own hashtag
  pages (`tiktok.com/tag/...`) are JS-rendered and pull data through signed
  `www.tiktok.com/api/*` endpoints (msToken + signed params) not meant for
  programmatic use — a server-side fetch returns no extractable content
  (verified: page fetch returned nothing parseable).
- **Scraping is off the table:** TikTok's Terms of Service bar automated
  data collection without written approval. We don't scrape TikTok.
- Third-party paid/keyed options (not wired): TrendsMCP (free key,
  100 req/day), TikAPI.io (paid), Apify TikTok actors (paid, breakage-prone).

`pipeline/fetch_tiktok.py` is a **stub** wired into `refresh.sh`: it logs a
clear SKIP and emits nothing. When a vetted source appears, implement it
there behind an env var (e.g. `TIKTOK_TRENDS_API_KEY`) following the
`fetch_x.py` pattern. Until then the TikTok lane is covered by editorial
seed topics + cross-platform corroboration (`r/tiktok` via the Reddit
fetchers, TikTok hashtag trackers like Revid via seed research).
**TikTok data is never faked.**

## Velocity history + format detection (wave 2)

- `normalize.py` snapshots every topic's `velocity` + `opportunity_score`
  each run into `data/velocity_history.json` (hourly buckets, pruned past
  14 days). Dossiers render an inline SVG sparkline from these snapshots,
  honestly labeled "tracked since <date>" — with <2 snapshots the dossier
  says so instead of drawing a fake line.
- `normalize.py` also runs `detect_format()` (conservative regex signals:
  `pov`, `challenge` (title/hashtags only), `sound` (+ "original sound"),
  `dance`, `meme`, `duet`, `stitch`, `green-screen`, `template`, `trend`
  (+ "this trend"), plus wave-7's `format` and `caption`) and stores
  `format_tags` on every topic; dossiers show a `format · <tag>` chip.
  Category is never rewritten by this.
- Dossiers have a "⧉ Remix this" button (`assets/js/remix-export.js`)
  that copies angles + hook lines + hashtags as plain text (Clipboard API

## Format-vs-topic labeling (wave 7)

- `normalize.py`'s `classify_trend_type()` labels every topic `format`
  (a reusable template others can fill: dance, caption variant, sound,
  challenge), `topic` (a subject/event to cover: launch, news event),
  or `format+topic` (event-driven topic riding a meme template).
- Rule-based and conservative: any `format_tags` hit makes it a format;
  `news`/`sports`/`gaming` categories make it a topic; both together make
  it `format+topic`. Re-computed on every run from `format_tags` +
  category, so the label is derived, never stale. Dossiers show a
  ⧉/◉/⧉◉ chip; the launch planner paces days differently per label
  (formats repeat the template early then twist; topics cover fresh daily).
  with textarea fallback, keyboard accessible, copied-confirmation state).

## Format families (wave 9)

- `data/meme_formats.json` curates the tracked meme format families by hand
  (Oct-2026 web research; `verified` = 2+ independent sources,
  `single-source` = one source or creator lore — flagged, never hidden;
  `status` = rising/peak/fading/established/evergreen).
- `pipeline/format_families.py` matches topics to families with conservative
  word-boundary keyword regexes (same recipe as `detect_format` — no ML);
  `normalize.py` stores `format_family` (family id or null) on every topic,
  re-computed every run, so links are derived, never stale.
- `data/v1/meme-formats.json` publishes the families with `tracked_topics[]`
  (live topic ids matched this run); dossiers show a `⧉ family:` chip
  linking to `formats.html#family-<id>`; `formats.html` renders every family
  with current examples, evidence, verification flags, a format leaderboard
  (ranked by tracked-topic opportunity), and a join-the-format playbook.

## Per-platform velocity history + Oracle 2.0 (wave 6)

- Every fetcher hit carries `platforms[]`; `normalize.py` records each
  hit's timestamp per platform on the topic (`platform_hits`, pruned to
  the last 48h) and snapshots one per-platform velocity per refresh into
  `data/platform_velocity_history.json`
  (`{topic_id: {platform: [[iso_ts, vel_p], ...]}}`, same hourly
  bucketing + 14-day pruning as the main history). Platform velocity uses
  the same corroboration recipe scoped to that platform:
  `vel_p = min(100, 25 × min(hits_48h, 3) + 20 × recency_p)`.
  These are **starting points**: series begin empty and build one snapshot
  per refresh — published as `data/v1/platform-velocity.json`.
- `scripts/build_forecasts.js` enriches every forecast via
  `trajectory.js`'s `enrich()` (additive, no shape changes): `confidence`
  (high/medium/low + basis text from snapshot count and R² fit quality —
  never a probability of being right), `signals` ("why this is peaking":
  velocity delta, slope, accel, recency hours, cross-platform spread, and
  the classifier thresholds that fired), and `per_platform` (each
  platform's own trajectory where it has 3+ snapshots; thinner series get
  the honest `insufficient` label).
- The Oracle also keeps its own scorecard: every refresh records decisive
  forecasts (peaking / accelerating / rising / fading) in
  `data/forecast_ledger.json`; 48h later each is judged against the actual
  velocity history (same ±1.5/hr thresholds the classifier uses) and
  published as `data/v1/forecast-accuracy.json`. Status stays
  "building history" (hit_rate: null) until 10+ forecasts resolve —
  the log starts 2026-10-11, nothing is backfilled.
- **Resolution archive (wave 18):** a topic can churn out of the store
  hours after its forecast is recorded, long before the 48h horizon.
  `normalize.py` now moves such a topic's velocity series into
  `data/velocity_archive.json` instead of deleting it, and both graders
  (`scripts/build_forecasts.js`, `scripts/check_resolutions.js`) judge
  against live history + archive merged (`resolution-lib.js`
  `mergeHistory` — live store wins per hour bucket). The archive prunes
  with the ledger's own 7-day retention. Before wave 18 the series were
  deleted outright; `scripts/recover_velocity_history.py` restored the
  already-lost points from the repo's own git history (real recorded
  timestamps only, provenance printed per topic).

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
2026-10-11 (news, TikTok trend trackers, gaming press). Wave 4 (2026-10-11)
added 11 more seeds + refreshed 4 existing ones from the October-2026 wave-fuel
research (SocialPilot Sept 25–Oct 5, New Engen, Virlo, Later, MediaNug, Lightreel —
41 seeds total). Wave 7 (2026-10-11) re-verified every wave-4 seed against fresh
research: verified topics keep their figures with real source URLs; 5 seeds are
flagged `verification: "single-source"` and 2 (`text-from-a`, `be-ok`) as
`"unverified"` (claimed sources not found — name-only sources, down-weighted,
confirm-live note in dossiers); 12 new seeds came from SocialPilot's
Sept 25–Oct 10 re-check (7 new Halloween-cycle formats, 2 early-stage sounds,
the Patient Zero TikTok Search Hub mechanic, pumpkin patch season). Wave 9
(2026-10-11) added 3 fresh meme-format seeds (56 total). Wave 11 (2026-10-11)
added the biggest injection yet — 35 new seeds from fresh Oct-2026 research
(Anijam, Lightreel, Virlo, SocialPilot, SocialBee, MediaNug, Revid, genznewz,
NapoleonCat) plus 5 day-of topics from live Bluesky trending data. 91 seeds
total. Wave 13 (2026-10-11) re-added the two wave-9 seeds that never landed
(turn-to-your-neighbor, zayn-sleeping-photo — verified live against Know Your
Meme + meme.com). 93 seeds total. `verification` lives on every seeded topic (`verified`/`single-source`/
`unverified`) and is documented in the trend schema. **seed.py upserts by id**
(preserves non-seed topics — never rewrites the store from scratch). The refresh
pipeline corroborates or expires seeds like any other topic.
