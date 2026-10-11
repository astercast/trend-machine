---
name: velocity-reading
description: Read a trend's velocity and know whether you're early, on time, or late.
---

# Read velocity like a trader reads a chart

## Use when

Deciding whether to jump on a trend today or let it pass.

## Inputs

- Topic dossier: `velocity`, `first_seen`, `last_seen`, `stale`

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
