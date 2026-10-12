# LIVE.md — going live with Trend Machine

The repo is a static site + a Python pipeline. Nothing here requires Vercel;
it runs on any static host with a cron (or GitHub Actions).

## Option A — static host + cron (simplest)

1. Serve the repo root as static files (any host: nginx, S3, Netlify, Cloudflare Pages…).
2. On a machine that stays up, add the cron line from PIPELINE.md:
   `*/15 * * * * cd /path/to/trend-machine && ./pipeline/refresh.sh`
3. Sync the repo root to the host after each refresh (rsync, or push to a
   branch the host deploys from).

## Option B — GitHub Actions (included)

`.github/workflows/refresh.yml` runs `pipeline/refresh.sh` every 15 minutes
and commits `data/trends.json`, `topics/`, `data/v1/`, and `llms.txt` back to
the repo. Point any static host at the repo and you're live.

Requirements: the workflow needs write permission (default `GITHUB_TOKEN`
with `contents: write` is set in the file). X/YouTube keys go in the repo's
Actions secrets as `X_BEARER_TOKEN` / `YT_API_KEY`.

## What "live" means here

- Dashboard freshness indicators are computed client-side from `last_seen` —
  minutes-old data pulses green, stale data (>72h) is dimmed and flagged.
- `pipeline/refresh.log` records which fetchers were live each run.
- If a fetcher needs a key you don't have, it skips — the site keeps working
  on the remaining sources. X data is never fabricated.

## Checklist before flipping the switch

- [ ] `pipeline/refresh.sh` runs clean end-to-end locally
- [ ] At least one no-key fetcher returns hits (gtrends/news are the reliable ones)
- [ ] `GUIDE_BASE_URL` set if the Creator Growth Empire guide has a real URL
- [ ] Cron or Actions workflow active; `refresh.log` shows 15-min cadence
