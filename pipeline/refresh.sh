#!/usr/bin/env bash
# trend-machine refresh pipeline. Designed for cron:
#   */15 * * * * cd ~/workspace/trend-machine && ./pipeline/refresh.sh >> pipeline/refresh.log 2>&1
# Or via the included GitHub Actions workflow (.github/workflows/refresh.yml).
set -u
cd "$(dirname "$0")/.." || exit 1
echo "=== refresh $(date -u +%FT%TZ) ==="
# Wave 31 (DATAOPS-001): fetch_youtube is RETIRED and out of this loop —
# every no-key path is dead (see the fetcher's header for the evidence).
# YouTube coverage rides fetch_youtube_rss. Revival: set YT_API_KEY and
# re-add fetch_youtube here.
# The loop captures each fetcher's output so a lane that produced
# nothing is NAMED in a closing summary instead of passing silently
# (the refresh still exits 0 — a dark lane is data, not a crash).
DARK_LANES=""
for f in fetch_gtrends fetch_news fetch_news_search fetch_reddit fetch_reddit_rss fetch_hn fetch_mastodon fetch_bluesky fetch_youtube_rss fetch_streamers fetch_tiktok fetch_x; do
  out="$(python3 "pipeline/$f.py" 2>&1)"
  printf '%s\n' "$out"
  if [ "$f" != fetch_tiktok ] && [ "$f" != fetch_x ]; then
    case "$out" in
      *SKIP:*|*" 0 hits ->"*) DARK_LANES="$DARK_LANES $f" ;;
    esac
  fi
done
if [ -n "$DARK_LANES" ]; then
  echo "=== LANES DARK THIS RUN:$DARK_LANES — refresh continues; the Live Wire labels them, nothing is faked ==="
fi
python3 pipeline/normalize.py
python3 scripts/build_site.py
python3 pipeline/aggregate.py
# node-built payloads (Live Wire + Streamer Desk). The forecast and
# forecast-board builders were retired with the prediction layer on
# 2026-10-13 — their scripts stay in the repo as archived machinery but
# are no longer part of the build.
if command -v node >/dev/null 2>&1; then
  node scripts/build_live_wire.js
  node scripts/build_streamer_desk.js
else
  echo "[wire/desk] node unavailable — skipping data/v1/live-wire.json + data/v1/streamer-desk.json"
fi
echo "=== done ==="
