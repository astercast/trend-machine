# LIVE_CHECKLIST.md — what's wired in the live track (2026-10-11)

Working repo: `astercast/trend-machine` (never connected to Vercel).
Live repo: `astercast/trend-machine-live` (release snapshot, one-time Vercel
deploy, no git integration). Snapshots land in `-live` ONLY on an explicit
user "push"/"ship it" — never from wave-engine automation.

## Live repo contents (snapshot of 2026-10-11)

- Static frontend at repo root: `index.html`, `formats.html`,
  `launch-plan.html`, `algorithms.html`,
  `api-docs.html`, `topics/*.html` (393 topic pages)
- Static data fallback: `data/v1/` (trends.json, trends.flat.json,
  velocity.json,
  platform-velocity.json, hashtags.json, meme-formats.json, seed-freshness.json,
  schema/, manifest index.json), `static/v1/trends.flat.js` (JSONP twin —
  public URL `/api/v1/trends.flat.js` via `vercel.json` rewrite), `assets/`,
  `llms.txt`, `llms-full.txt`
- **Vercel never serves static files under `api/`** — all static data lives
  in `data/v1/`; only real function handlers (`.js` with exported handlers)
  under `api/` (2026-10-12). Every frontend fetch of `api/v1/*.json` 404s in
  production otherwise.
- **No static `.js` data files under `api/` ever** — Vercel deploys every
  `.js` there as a function (the `functions` map is not an allowlist);
  basename collisions (`x.js` + `x.json` in one dir) fail the build with
  "conflicting paths or names" (2026-10-12: this killed the
  trend-machine-live deploy).
- Serverless functions (no `runtime` key anywhere — Vercel auto-detects
  Node; explicit paths in `vercel.json`):
  1. `GET /api/health` — status + data-freshness SLA checks; never 5xx
  2. `GET /api/trends` — opportunity-ranked trends (?limit=, ?platform=)
  3. `GET /api/velocity` — per-topic 30-day snapshots (?topic_id=)
  4. `GET /api/cron/wire` — The Wire daily heartbeat (cron only)
- **Vercel functions entries need ≥1 valid property — use `{"maxDuration": 10}`
  per explicit function path; never set `runtime` for Node (omit it); never
  broad globs** (2026-10-12: `nodejs22.x` then `nodejs20.x` both failed build
  validation — `runtime` is only for community runtimes like
  `vercel-php@0.5.2`; empty `{}` also fails, "Function must contain at least
  one property"; `maxDuration: 10` matches the 10s Hobby execution limit).
- Shared `lib/`: envelope.js, cronauth.js, ratelimit.js, github.js, fetchx.js
- `vercel.json`: functions + cron config; publish dir = repo root;
  `buildCommand: null` (pre-built snapshot); Standard builds (never Turbo).

### vercel.json fixes (both repos, verified)

The `functions` map is NOT an allowlist — Vercel auto-deploys EVERY `.js`
file under `api/` as a serverless function regardless, and two files sharing
a basename-without-extension in one dir (`trends.flat.js` + `trends.flat.json`)
fail the build with "conflicting paths or names" (this killed the
trend-machine-live deploy on 2026-10-12). So: (1) the static JSONP twin moved
to `static/v1/trends.flat.js` with a `rewrites` entry preserving the public
`/data/v1/trends.flat.js` URL; (2) the `functions` map keeps the 4 real paths
explicit (never broad globs). Each entry carries `{"maxDuration": 10}` (10s
Hobby limit) and NO `runtime` key (Vercel rejects both `nodejs22.x` and
`nodejs20.x`, and empty `{}` — 2026-10-12 lessons above).

## Cron schedules

| path | schedule | notes |
|---|---|---|
Retired 2026-10-24 (fleet-data migration): no GITHUB_REPO_TOKEN is used anywhere. Live data refreshes through the astercast/fleet-data repo; the fleet watchdog does the checking.

## Env vars (Vercel project settings)

| var | required? | behavior without it |
|---|---|---|
| `CRON_SECRET` | yes, for the cron | wire 401s fail-closed; Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron invocations |
Retired 2026-10-24 (fleet-data migration): no GITHUB_REPO_TOKEN is used anywhere. Live data refreshes through the astercast/fleet-data repo; the fleet watchdog does the checking.
| `GITHUB_REPO` | no | `owner/name` to read/write when token set (live: `astercast/trend-machine-live`) |
| `REPO_STATIC_PREFIX` | no | `""` for root deploys |
| `WIRE_FETCH_TIMEOUT_MS` | no | overrides 4000ms per-source fetch timeout |

## Known-good status (2026-10-11, pre-push verification)

- Build: `scripts/build_site.py` exit 0
  (393 topic pages, endpoint manifest)
- 10 fetcher outputs sane (all parse; reddit.json empty list)
- All 25 `api/v1` JSON files parse; link check exit 0 (6014 internal, 0 broken;
  external timeouts are warnings only)
- `vercel.json` valid JSON; 4 functions ≤ 12; explicit paths (JSONP file excluded)
- Function harness: 4 GET endpoints → HTTP 200 envelopes from bundled files;
  wire → 401 fail-closed without CRON_SECRET
- Standard builds only (Turbo never — Sept 2026 invoice lesson)

## Pending

Retired 2026-10-24 (fleet-data migration): no GITHUB_REPO_TOKEN is used anywhere. Live data refreshes through the astercast/fleet-data repo; the fleet watchdog does the checking.
  contents:write). Until set: wire read-only, functions serve bundled static.
- First `-live` push blocked 2026-10-11 23:52 PDT by GitHub secondary rate
  limit (403 on repo creation) — retry `gh.py create-repo trend-machine-live`
  then `gh-push.py ~/workspace/trend-machine-live`.

## Free-tier / best-pattern audit (wave 29 — rotation 12, 2026-10-13)

Audited as ordered: real numbers, stated assumptions, the Live Wire
treated as the fleet's health model.

### Function count vs the ≤12 cap

**4 functions** (cap 12, headroom 8), all explicit paths in
`vercel.json`, each `{"maxDuration": 10}`, no `runtime` key anywhere:

| function | kind | work per call |
|---|---|---|
| `api/health.js` | GET | reads bundled JSON stamps, SLA verdicts; never 5xx |
| `api/trends.js` | GET | serves one precomputed file (bundle, or GitHub Contents when a token is set) |
| `api/velocity.js` | GET | same pattern, per-topic filter |
| `api/cron/wire.js` | cron only | the daily heartbeat (below) |

Wave 29's Streamer Desk added **zero functions**: it is a precomputed
static payload (`data/v1/streamer-desk.json`, 44K) + a static page —
the static-first rule applied to the flagship itself.

### Estimated monthly invocations (assumptions stated)

Assumption: the live snapshot serves a niche audience — **5,000 page
views/month**. Pages are static and fetch `data/v1/*.json` (static
files, **not** function invocations), so page traffic does not consume
the invocation budget at all. Functions are reached only by API
consumers, health checks, and the one cron:

| source | math | /month |
|---|---|---|
| cron wire | 1/day (`0 13 * * *`) | ~31 |
| health | assumed 10 checks/day | ~300 |
| GET APIs (trends/velocity) | assumed 20 calls/day total | ~600 |
| **total** | | **~950/month** |

That is **~1% of the Hobby budget (100,000 function invocations/mo)**.
Stress case: 100× the assumed API traffic (2,000 calls/day) still
lands at ~61k/month — under the cap, and the SWR headers below mean
real consumers rarely re-invoke at that rate anyway. Bandwidth: the
largest payload is `data/v1/trends.json` at ~646K; even 5,000 full
page loads pulling ~2MB of JSON/CSS/fonts each is ~10GB of the 100GB
Hobby bandwidth budget.

### Worst-case duration vs the 10s ceiling

- GET handlers: one file read + JSON parse + envelope. Sub-second by
  construction (largest file ~646K); the GitHub-Contents path adds
  one API round-trip, still ≪ 10s.
- **Worst case is the cron wire**, and it is bounded by design:
  7 keyless sources fetched in parallel (`Promise.allSettled`),
  4,000ms per-source timeout (`WIRE_FETCH_TIMEOUT_MS`, spec default
  kept in production), HN item fan-out under the same timeout, then a
  pure-function recompute. Fetch phase ≤ ~4s even if every source
Retired 2026-10-24 (fleet-data migration): no GITHUB_REPO_TOKEN is used anywhere. Live data refreshes through the astercast/fleet-data repo; the fleet watchdog does the checking.
  is a handful of Contents API calls. Observed headroom is
  comfortable, but this is the first duration risk if source latency
  or the commit-back chain grows — it is the number to watch, and the
  timeout is a single env override away from tightening.

### First degradation point

In order: **(1)** the wire cron's duration under a slow-source day
(bounded above; degrades to partial results per source, never a
hang — `allSettled` + per-source timeouts); **(2)** invocation volume
only under programmatic polling of `/api/*` that ignores the SWR
headers (~100k/mo needs ~3,200 uncached API calls/day, 160× the
assumed rate); **(3)** bandwidth at ~50× assumed traffic. Static
pages and `data/v1/*.json` do not degrade at all — they are files.

### Best-pattern alignment (verified in code, not asserted)

- **Static-first**: every page renders from precomputed
  `data/v1/*.json`; functions are a convenience layer over the same
  files, never the only path.
- **SWR caching**: `lib/envelope.js` sets
  `public, s-maxage=600, stale-while-revalidate=86400` on GET
  envelopes; health overrides to `s-maxage=60` + SWR; the cron is
  `no-store`. Coalescing: parallel fetch with per-source timeouts in
  the wire; refresh generators are idempotent and dedupe by design
  (lane files rewritten atomically per run).
- **Honest failure fallbacks**: health never 5xx (degrades to a
  `"degraded"` status payload); the wire runs read-only without a
  token and says so in its envelope; the pipeline's lanes degrade in
  the open (below).

### The Live Wire as the health model — audit + fixes (wave 29)

The Wire (`data/v1/live-wire.json`, 13 lanes after wave 29) is the
fleet's health surface: every lane's health is the pipeline's own
recorded outcome. This wave audited it as such and fixed two places
where its reporting overstated reality:

1. **Movers cap disclosure (fixed).** The banner counts every mover
   (this run: 4 climbing / 21 cooling / 463 flat) but the board lists
   only the top 10 per direction — the headings said nothing about
   the other 11 fallers, so 10 rows silently posed as the whole
   board. `assets/js/live-wire-lib.js` now prints the cap on the
   heading ("Cooling — top 10 of 21") whenever the list is shorter
   than the count; pinned by a new `test_live_wire.js` check.
2. **Dateless stale rows (fixed).** A stale-skip lane whose stored
   hits carry no `fetched_at` rendered "stored —" with no date; the
   row now falls back to the file's write date, so a stale claim is
   always dated.
3. **Copy drift (fixed).** `live-wire.html` and the payload method
   string still said "ten file-writing lanes" after the streamer
   lane landed; both now say eleven (13 lanes = 11 file-writing +
   TikTok/X skip-by-design — and the validator still pins the
   skip-by-design set to exactly `{tiktok, x}`).

Lane health after this run, exactly as recorded: **9 live** (incl.
the new Streamer Desk wire lane, 32 real Google News RSS hits on its
first run), **1 degraded** (reddit direct, 403s), **1 stale-skip**
(YouTube Invidious/direct: 25 old hits dated 2026-10-12 and excluded
from the 419 current hits), **2 skip-by-design**. Mastodon recovered
to live this run after wave 28's stale-skip — the board shows both
states across runs without smoothing either.

