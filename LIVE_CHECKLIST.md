# LIVE_CHECKLIST.md — what's wired in the live track (2026-10-11)

Working repo: `astercast/trend-machine` (never connected to Vercel).
Live repo: `astercast/trend-machine-live` (release snapshot, one-time Vercel
deploy, no git integration). Snapshots land in `-live` ONLY on an explicit
user "push"/"ship it" — never from wave-engine automation.

## Live repo contents (snapshot of 2026-10-11)

- Static frontend at repo root: `index.html`, `oracle.html`, `formats.html`,
  `launch-plan.html`, `algorithms.html`, `forecast-accuracy.html`,
  `api-docs.html`, `topics/*.html` (393 topic pages)
- Static data fallback: `data/v1/` (trends.json, trends.flat.json,
  forecasts.json, forecast-accuracy.json, velocity.json,
  platform-velocity.json, hashtags.json, meme-formats.json, seed-freshness.json,
  schema/, manifest index.json), `static/v1/trends.flat.js` (JSONP twin —
  public URL `/data/v1/trends.flat.js` via `vercel.json` rewrite), `assets/`,
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
- Serverless functions (`nodejs20.x`, explicit paths in `vercel.json`):
  1. `GET /api/health` — status + data-freshness SLA checks; never 5xx
  2. `GET /api/trends` — opportunity-ranked trends (?limit=, ?platform=)
  3. `GET /api/velocity` — per-topic 30-day snapshots (?topic_id=)
  4. `GET /api/forecasts` — precomputed Oracle trajectories
  5. `GET /api/cron/wire` — The Wire daily heartbeat (cron only)
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
`/data/v1/trends.flat.js` URL; (2) the `functions` map keeps the 5 real paths
explicit (never broad globs). Each entry carries `{"maxDuration": 10}` (10s
Hobby limit) and NO `runtime` key (Vercel rejects both `nodejs22.x` and
`nodejs20.x`, and empty `{}` — 2026-10-12 lessons above).

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
