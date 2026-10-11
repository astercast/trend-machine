# WAVELOG — trend-machine build waves

One-line history per wave: date, what shipped, commit hash.

- **Wave 1:** dashboard + 330 topic dossiers + 10 fetchers + pipeline/refresh.sh + api/v1 (+JSONP) + 5 skills; design overhaul v2 "mission control" (tokens, components, dossier redesign, motion, a11y) — completed 2026-10-11. Commit `0864b9a`.
- **Wave 2 (capability expansion):** velocity sparkline history (`data/velocity_history.json`, hourly snapshots, 14-day prune, honest "tracked since <date>" labeling + <2-snapshot fallback); "⧉ Remix this" exporter button on every dossier (clipboard API + fallback, keyboard accessible, copied-confirmation state); TikTok lane researched (no reliable keyless source exists — verified 2026-10-11 — honest stub `pipeline/fetch_tiktok.py` wired into `refresh.sh`, never fakes data); meme-format detection in `normalize.py` (`format_tags`: pov/challenge/sound/dance/meme/duet/stitch/green-screen/template/trend) with `format · <tag>` chips on dossiers (verified sane on all 330 topics); `format_tags` added to schema + flat feed. — completed 2026-10-11. Commit `2737aa5`.
