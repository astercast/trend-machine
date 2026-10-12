---
name: velocity-reading
description: Read a trend's velocity and know whether you're early, on time, or late.
---

# Read velocity like a trader reads a chart

## Use when

Deciding whether to jump on a trend today or let it pass.

## Inputs

- Topic dossier: `velocity`, `first_seen`, `last_seen`, `stale`
- Signal-history sparkline on the dossier (SVG from real hourly snapshots),
  per-platform mini-sparklines, and the flat feed's `velocity_trend` object

## Reading the sparkline (wave 8)

The dossier's Signal history figure draws only from real velocity snapshots —
a line appears after 3+ hourly snapshots; before that it honestly says
"history building". The flat feed's `velocity_trend` carries the same data
machine-readably: `snapshots`, `state` (`ready`/`building`), `since`,
`first_velocity`, `latest_velocity`, `delta`, plus a ready-made
`sparkline_svg` and `per_platform` mini-summaries.

1. Slope over the sparkline beats the current number: a 55 climbing +30 reads
   earlier than a 70 sliding −20. Trust `delta`, not just `velocity`.
2. Per-platform minis tell you WHERE to post: the platform with the steepest
   mini-sparkline is where the energy is right now — post there first.
3. "History building" is a signal too: the topic is brand new. If the subject
   is fresh and the angle is yours, that's the earliest entry you'll get.
4. Flat or falling line + high velocity = saturation: don't do a straight
   cover; do the definitive take, the parody, or the retrospective.

## Procedure

1. Compute trend age: now − `first_seen`. Memes: <3 days early, 3–7 on time, >7 late. News: <12h early, 12–48h on time, >48h late.
2. Check `last_seen`: if it's more than 24h old, the data is aging — verify the trend is still alive with a quick platform search before producing.
3. If `stale` is true (>72h no corroboration): the wave has passed. Only cover with a retrospective angle.
4. Rising velocity + young age = post TODAY. High velocity + old age = you need the definitive take or a parody, not another entry.
5. Log your decision: topic, age at decision, angle. Review weekly — calibrate your instincts against what actually popped.

## Worked example

"Six Seven dance": velocity 90, first seen ~3 weeks ago. You're late for a straight cover — but a "your niche does the Six Seven" parody or a tutorial still works because the format is peaking, not dying.

## Pitfalls

- Treating velocity as a constant — it decays; yesterday's 90 is today's 60.
- Producing for a trend older than its half-life with a straight cover.
- Trusting `last_seen` blindly — the pipeline refreshes every 15 min, but always spot-check before filming.
