# LIVE_CHECKLIST.md — what's wired in the live track (2026-10-11)

Working repo: `astercast/trend-machine` (never connected to Vercel).
Live repo: `astercast/trend-machine-live` (release snapshot, one-time Vercel
deploy, no git integration). Snapshots land in `-live` ONLY on an explicit
user "push"/"ship it" — never from wave-engine automation.

## Live repo contents (snapshot of 2026-10-11)

- Static frontend at repo root: `index.html`, `oracle.html`, `formats.html`,
  `launch-plan.html`, `algorithms.html`, `forecast-accuracy.html`,
  `api-docs.html`, `topics/*.html` (393 topic pages)
- Static data fallback: `api/v1/` (trends.json, trends.flat.json,
  trends.flat.js JSONP, forecasts.json, forecast-accuracy.json, velocity.json,
  platform-velocity.json, hashtags.json, meme-formats.json, seed-freshness.json,
  schema/, manifest index.json), `assets/`, `llms.txt`, `llms-full.txt`
- Serverless functions (`nodejs22.x`, explicit paths in `vercel.json`):
  1. `GET /api/health` — status + data-freshness SLA checks; never 5xx
  2. `GET /api/trends` — opportunity-ranked trends (?limit=, ?platform=)
  3. `GET /api/velocity` — per-topic 30-day snapshots (?topic_id=)
  4. `GET /api/forecasts` — precomputed Oracle trajectories
  5. `GET /api/cron/wire` — The Wire daily heartbeat (cron only)
- Shared `lib/`: envelope.js, cronauth.js, ratelimit.js, github.js, fetchx.js
- `vercel.json`: functions + cron config; publish dir = repo root;
  `buildCommand: null` (pre-built snapshot); Standard builds (never Turbo).

### vercel.json fix vs the working repo

The working repo's `vercel.json` uses the glob `api/**/*.js` for functions —
that would wrongly deploy `api/v1/trends.flat.js` (a static JSONP data file)
as a function. The `-live` repo's `vercel.json` lists the 5 real function
paths explicitly instead.

## Cron schedules

| path | schedule | notes |
|---|---|---|
| `/api/cron/wire` | `0 13 * * *` UTC | bounded refresh: 7 keyless sources in parallel (4000ms/source), velocity + forecast recompute from real snapshots; commits back only on real change; **read-only until GITHUB_REPO_TOKEN is set** |

## Env vars (Vercel project settings)

| var | required? | behavior without it |
|---|---|---|
| `CRON_SECRET` | yes, for the cron | wire 401s fail-closed; Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron invocations |
| `GITHUB_REPO_TOKEN` | no — pending user's decision | functions read the bundled static files; wire runs read-only (returns results in envelope, persists nothing) |
| `GITHUB_REPO` | no | `owner/name` to read/write when token set (live: `astercast/trend-machine-live`) |
| `REPO_STATIC_PREFIX` | no | `""` for root deploys |
| `WIRE_FETCH_TIMEOUT_MS` | no | overrides 4000ms per-source fetch timeout |

## Known-good status (2026-10-11, pre-push verification)

- Build: `scripts/build_site.py` + `scripts/build_forecasts.js` exit 0
  (393 topic pages, 12-endpoint manifest, forecasts peaking=5/rising=5/cooling=3)
- 10 fetcher outputs sane (all parse; reddit.json empty list)
- All 25 `api/v1` JSON files parse; link check exit 0 (6014 internal, 0 broken;
  external timeouts are warnings only)
- `vercel.json` valid JSON; 5 functions ≤ 12; explicit paths (JSONP file excluded)
- Function harness: 4 GET endpoints → HTTP 200 envelopes from bundled files;
  wire → 401 fail-closed without CRON_SECRET
- Standard builds only (Turbo never — Sept 2026 invoice lesson)

## Pending

- `GITHUB_REPO_TOKEN`: awaiting user's decision (fine-grained PAT,
  contents:write). Until set: wire read-only, functions serve bundled static.
- First `-live` push blocked 2026-10-11 23:52 PDT by GitHub secondary rate
  limit (403 on repo creation) — retry `gh.py create-repo trend-machine-live`
  then `gh-push.py ~/workspace/trend-machine-live`.
