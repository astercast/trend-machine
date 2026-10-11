# GO_LIVE.md — trend-machine live pipeline & deploy guide

Verified end-to-end 2026-10-11 (full `pipeline/refresh.sh` run: 330 trends in the
flat consumer feed, all fetchers exit 0 with zero keys set). Repo stays
**GitHub-only, no Vercel** — the whole site + API is static files.

## 1. Live architecture

```
[fetchers] --raw hits--> pipeline/out/*.json
      |
[pipeline/normalize.py] --merge/corroborate--> data/trends.json (canonical store)
      |
[scripts/build_site.py] --topic pages--> topics/*.html
                        --rich API-->   api/v1/trends.json  (full editorial schema)
                        --tag index-->  api/v1/hashtags.json
                        --api index-->  api/v1/index.json
                        --schema-->     api/v1/schema/trend.json
                        --llms-->       llms.txt / llms-full.txt
      |
[pipeline/aggregate.py] --flat consumer feed--> api/v1/trends.flat.json
                                               api/v1/trends.flat.js (JSONP)
                                               api/v1/trends.flat.sample.json
```

**Hosting:** any static host (GitHub Pages, Cloudflare Pages, Netlify, S3).
The site and `api/` ship together — deploy the repo root, everything is
pre-rendered. There is no server, no database, no runtime dependency.

**Which API should the creator site consume?** Two shapes ship:

| file | shape | use when |
|---|---|---|
| `api/v1/trends.json` | `{generated_at, count, topics:[...]}` — full dossiers (angles, hooks, guide_links, sources[], first_seen/last_seen, stale flag) | deep integration, topic pages |
| `api/v1/trends.flat.json` | `{generated_at, sample, source_count, trends:[{id,title,source,url,velocity,opportunity_score,hashtags[],detected_at}]}` | the flat contract — client-side fetch, opportunity-ranked list |

**CORS situation (decided 2026-10-11):** pure static hosts like GitHub Pages
cannot emit `Access-Control-Allow-Origin` headers, and the creator site is a
*different origin*, so `fetch(api/v1/trends.flat.json)` from it would be
blocked if the two sites live on different domains. Implemented solution:
every refresh also writes **`api/v1/trends.flat.js`** — a JSONP twin:

```html
<script>
function trendsCallback(feed){ /* feed.trends, sorted by opportunity_score */ }
</script>
<script src="https://<trend-machine-host>/api/v1/trends.flat.js"></script>
```

JSONP sidesteps CORS entirely (it's just a script tag) and needs no headers,
no proxy, no deploy-config. Alternatives, in preference order, if you ever
want plain `fetch()` instead:
1. **Same-origin deploy** — serve both sites from one domain/path (no CORS issue at all).
2. **`_headers` file** (Cloudflare Pages / Netlify, not GitHub Pages):
   `/api/*\n  Access-Control-Allow-Origin: *` — then plain fetch works.
3. **Tiny proxy** (Cloudflare Worker, etc.) — last resort; JSONP already covers it.

The sample feed `api/v1/trends.flat.sample.json` has `"sample": true` and is
for consumer development only — never promote it to the live path.

## 2. Pipeline stages and what each does

### Source tiers — live-keyless vs BYO-key (verified 2026-10-11)

**LIVE KEYLESS** — zero keys, zero signups, verified producing hits this run:

| source | fetcher | hits this run |
|---|---|---|
| YouTube channel RSS (10 curated channels, IDs verified 2026-10-11) | `pipeline/fetch_youtube_rss.py` | 80 |
| Google News RSS search (6 topic queries + Top Stories) | `pipeline/fetch_news_search.py` | 70 |
| Google News category feeds | `pipeline/fetch_news.py` | 75 |
| Google Trends daily RSS | `pipeline/fetch_gtrends.py` | 10 |
| Reddit Atom feeds (6 subs; 429s from this IP skip per-sub) | `pipeline/fetch_reddit_rss.py` | 24 |
| Hacker News Firebase API (top + best stories) | `pipeline/fetch_hn.py` | 49 |
| Mastodon trending hashtags | `pipeline/fetch_mastodon.py` | 20 |
| YouTube popular via Invidious public API | `pipeline/fetch_youtube.py` | 25 |

**BYO-KEY** — skip cleanly with exit 0 when the key is absent, never fake data:

| source | fetcher | key |
|---|---|---|
| X API v2 recent search (3 curated queries) | `pipeline/fetch_x.py` | `X_BEARER_TOKEN` — free tier works for low-volume search |
| YouTube Data API v3 mostPopular | `pipeline/fetch_youtube.py` | `YT_API_KEY` — free 10k units/day |

**NO FETCHER YET:** TikTok — official Research API requires institutional
approval (not practical for an indie tracker); scraping = ToS risk. Until a
proxy is wired, the TikTok lane is covered by editorial seed topics +
cross-platform corroboration. Do NOT fake TikTok data.

**Wiring note (2026-10-11):** `fetch_youtube_rss`, `fetch_news_search`, and
`fetch_reddit_rss` write `pipeline/out/*.json`, which `normalize.py` picks up
via glob automatically — but they are **not yet in `refresh.sh`'s fetcher
loop**. One-line change to wire them into the scheduled refresh: add
`fetch_youtube_rss fetch_news_search fetch_reddit_rss` to the `for f in ...`
line in `pipeline/refresh.sh` (builder's file — their call).

### Stage reference

| stage | file | does |
|---|---|---|
| X fetcher | `pipeline/fetch_x.py` | X API v2 recent search (3 curated queries: meme/gaming/music). **BYO key only** — with no `X_BEARER_TOKEN` it logs a skip and writes nothing. Never fabricates X data. |
| YouTube fetcher | `pipeline/fetch_youtube.py` | No-key path: Invidious public instances `/api/v1/popular` first, then direct trending-page scrape. Keyed path: `YT_API_KEY` → Data API v3 `videos.list?chart=mostPopular&regionCode=US` (stable, recommended). |
| YouTube RSS fetcher | `pipeline/fetch_youtube_rss.py` | Public channel RSS for 10 curated channels (MrBeast, pewdiepie, MKBHD, LinusTechTips, BBCNews, IGN, ESPN, VEVO, NPRMusic, TEDx). Channel IDs verified 2026-10-11 from canonical links. |
| News fetcher | `pipeline/fetch_news.py` | Google News RSS category feeds, no key. Headline velocity = a story appearing across category feeds in one run. |
| News search fetcher | `pipeline/fetch_news_search.py` | Google News RSS *search* across 6 topic lanes + Top Stories, no key. |
| Reddit fetcher | `pipeline/fetch_reddit.py` | Reddit public JSON, no key, custom UA. 403s aggressively from datacenters — skips per-subreddit, exit 0. |
| Reddit RSS fetcher | `pipeline/fetch_reddit_rss.py` | Reddit Atom `.rss` feeds (lighter than JSON), no key; 429/403 per-sub skips. |
| HN fetcher | `pipeline/fetch_hn.py` | Hacker News Firebase API top+best stories, no key. |
| Mastodon fetcher | `pipeline/fetch_mastodon.py` | mastodon.social trending hashtags, no key. |
| Google Trends fetcher | `pipeline/fetch_gtrends.py` | `trends.google.com/trending/rss?geo=US`, no key. Probed 2026-10-11: `category=`/`hours=` params are accepted but don't change the item set — the base daily-trends RSS is the useful keyless endpoint. |
| Aggregator | `pipeline/normalize.py` | Merges fetcher hits into `data/trends.json`: token-set Jaccard ≥0.55 dedup, corroborates seeded topics (refreshes `last_seen`), marks topics stale after 72h without corroboration, recomputes `velocity`/`opportunity_score`. |
| Site builder | `scripts/build_site.py` | Renders `topics/*.html` dossiers, rich `api/v1/*`, `llms.txt`. Reads `GUIDE_BASE_URL` env (default `../creator-growth-empire/`). |
| Contract publisher | `pipeline/aggregate.py` | Derives the flat consumer feed + JSONP twin + labeled sample from `data/trends.json`. Stale topics excluded from the live feed. |
| Orchestrator | `pipeline/refresh.sh` | Runs fetchers → normalize → build_site. Every stage is failure-tolerant: one source down never blocks the run. |
| Entry point | `pipeline/refresh.sh` (same) | Cron / Actions call this one file. |

**Known non-fatal issues (verified, left as-is — do not "fix" by editing fetchers):**
- Google News topic feeds (technology/sports/science) return 404 — their topic
  IDs rotated; top + entertainment feeds still work. Re-derive fresh topic IDs
  from news.google.com when convenient.
- Reddit 403/429s from CI/datacenter IPs (both JSON and RSS paths) — per-subreddit
  skips, no crash. RSS got through on 2/6 subs from this IP this run.
- TikTok: **no fetcher exists yet.** See §4.

**Scoring (live, in `normalize.py`):**
- `velocity = min(100, 25·min(sources,3) + 20·recency + tag_bonus)` — recency
  decays over 48h from `last_seen`; more corroborating sources = hotter.
- `saturation`: ≥4 sources → high, ≥2 → medium, else low.
- `opportunity_score = round(velocity · (1 − penalty))`, penalty low 0 / medium
  0.35 / high 0.6. (Seeded editorial topics keep their researched velocity.)

## 3. Refresh schedule

**Cron (on the box that owns the repo):**
```cron
# trend-machine refresh — every 2 hours
17 */2 * * * cd ~/workspace/trend-machine && bash pipeline/refresh.sh && python3 pipeline/aggregate.py >> pipeline/refresh.log 2>&1
```
Keep `pipeline/logs/` (or `refresh.log`) out of git if you cron locally —
refresh outputs under `api/v1`, `data/`, `topics/`, `llms*.txt` are the only
things that should be committed.

**GitHub Actions (ships in this repo):** `.github/workflows/refresh.yml`
— same cron (`17 */2 * * *`), runs the pipeline, commits changed outputs
back. Add secrets `X_BEARER_TOKEN` / `YT_API_KEY` in repo Settings → Secrets
to enable the keyed fetchers in CI. Manual runs via "Run workflow".

## 4. Keys needed

| key | fetcher | tier / where | required? |
|---|---|---|---|
| `X_BEARER_TOKEN` | `fetch_x.py` | developer.x.com → project → Bearer Token. **Free tier works** for low-volume `tweets/search/recent`; Basic ($100/mo) if you add queries or hit rate limits. BYO by design. | No — fetcher skips cleanly without it. |
| `YT_API_KEY` | `fetch_youtube.py` | Google Cloud Console → enable **YouTube Data API v3** → Credentials → API key (restrict to YouTube Data API v3). Free quota 10,000 units/day; one `mostPopular` call = 1 unit. | No — no-key scrape is the fallback (fragile). |
| TikTok | *(none yet)* | **Reality check:** TikTok's official Research API requires institutional approval (not practical for an indie tracker); the commercial Display API is per-app OAuth. Practical options are (a) scraping (ToS risk, blocks), or (b) a paid social-listening proxy (e.g. the kind of aggregator the seed topics were researched from). Until one is wired, the TikTok lane is covered by editorial seed topics + cross-platform corroboration. Do NOT fake TikTok data. | N/A — future work. |
| News / Reddit / Google Trends | — | none — public RSS/JSON. | — |

## 5. Deploy checklist

- [ ] Choose host: GitHub Pages (`main` branch, `/ (root)`) is the zero-config default.
- [ ] Deploy = push. Site + `api/` are static; no build step on the host.
- [ ] Enable the `trend-refresh` GitHub Action; verify one manual run greens.
- [ ] Add `X_BEARER_TOKEN` and/or `YT_API_KEY` as Actions secrets (optional but recommended).
- [ ] Creator site: point it at `<host>/api/v1/trends.flat.json` — or use the
      JSONP `<host>/api/v1/trends.flat.js` + `trendsCallback` if cross-origin
      fetch is blocked (see §1).
- [ ] Confirm `api/v1/trends.flat.json` has `"sample": false` post-deploy.
- [ ] Set uptime check on the feed URL (optional): alert if `generated_at` is
      older than 6h — that means the Action is failing or racing.

## 6. What "live" means per feature

- **Trend feed refresh cadence:** every 2 hours via cron/Actions. `generated_at`
  on the feed is the freshness signal — consumers should treat anything >6h
  old as stale and fall back to cache.
- **Velocity computation:** recomputed every run from corroboration count
  (distinct sources) + recency decay (48h half-life) + hashtag breadth. A topic
  seen once on one source scores ~25–45; a topic corroborated across 3+
  sources within hours scores 80–100.
- **Opportunity scores:** velocity penalized by saturation (crowded = more
  sources = lower opportunity). Sort `trends` by `opportunity_score` desc for
  the "what to make content about today" list — highest-opportunity =
  hot but not yet crowded.
- **Cooling/expiry:** topics with no corroboration for 72h are flagged
  `stale: true` (rich API) and dropped from the flat consumer feed — the feed
  only ever shows live plays. History is preserved in `data/trends.json`.
- **Degraded mode is the normal mode:** keyed fetchers skip without keys,
  fragile scrapers skip on markup changes, rate-limited sources skip
  per-endpoint. A run with only Google News + Google Trends still produces a
  valid feed — just thinner. This is by design, not a failure.
