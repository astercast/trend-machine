#!/usr/bin/env bash
# trend-machine refresh pipeline. Designed for cron:
#   */15 * * * * cd ~/workspace/trend-machine && ./pipeline/refresh.sh >> pipeline/refresh.log 2>&1
# Or via the included GitHub Actions workflow (.github/workflows/refresh.yml).
set -u
cd "$(dirname "$0")/.." || exit 1
echo "=== refresh $(date -u +%FT%TZ) ==="
for f in fetch_gtrends fetch_news fetch_news_search fetch_reddit fetch_reddit_rss fetch_hn fetch_mastodon fetch_bluesky fetch_youtube fetch_youtube_rss fetch_tiktok fetch_x; do
  python3 "pipeline/$f.py"
done
python3 pipeline/normalize.py
python3 scripts/build_site.py
python3 pipeline/aggregate.py
# wave 5: precomputed Oracle forecasts (needs node; skips honestly without it —
# the manifest only advertises forecasts.json when this step actually writes it)
if command -v node >/dev/null 2>&1; then
  node scripts/build_forecasts.js
else
  echo "[forecasts] node unavailable — skipping data/v1/forecasts.json"
fi
echo "=== done ==="
