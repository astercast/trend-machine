---
name: forecast-reader
description: Read the Oracle's 48h trajectory forecasts and know whether to post today, schedule ahead, or skip.
---

# Read the Oracle's forecasts like a weather report

## Use when

Deciding what to post in the next 48 hours from the Oracle's trajectory
forecasts (`api/v1/forecasts.json`), or explaining why a trend is
"peaking", "rising", or "cooling" to another agent or a creator.

## Inputs

- `api/v1/forecasts.json`: `peaking_48h[]`, `rising_fast[]`,
  `cooling_off[]`, `steady[]`, `projections{}`. Each record carries
  `state, n_snapshots, latest_velocity, slope_per_hour, accel,
  peak_in_hours, summary, label`.
- Fallback: `api/v1/velocity.json` + `assets/js/trajectory.js`
  (`require()` it in node — same classifier the dashboard uses).

## Procedure

1. Read `peaking_48h[]` first. These are projected to crest within 48h —
   post TODAY, lead with the definitive take or the parody, not a
   me-too entry. `peak_in_hours` tells you how soon the crest lands.
2. Read `rising_fast[]` next — accelerating or rising, slope positive.
   These are your "this week" plays: you can still be early.
3. `cooling_off[]` (fading): only cover with a retrospective angle
   ("what we learned from X") or skip.
4. `steady[]`: no trajectory signal — decide from the dossier's
   opportunity_score and age instead.
5. **Honor the honest fallback.** If all lists are empty, check
   `counts.insufficient`: the Oracle needs 3+ hourly snapshots per
   topic. Don't invent a forecast — report that forecasts unlock after
   more refreshes.
6. **Label everything.** Any forecast you surface must carry the
   record's `label`: "Projection from N snapshots — not a guarantee."
   Never present a projection as a prediction.

## Worked example

`forecasts.json` shows "Ramalama Costume Walk": state `rising`,
n_snapshots 3, latest_velocity 90, slope_per_hour +12.5 → it's in
`rising_fast[]`. Call: schedule this week's posts around it (see the
7-day battle plan workflow in AGENT.md). A topic in `cooling_off[]`
with slope_per_hour −8.2 and latest_velocity 41: skip unless you have a
retrospective angle.

## Pitfalls

- Treating a projection as a prediction — the label is load-bearing.
- Forecasting from <3 snapshots — the classifier refuses, and so should you.
- Ignoring `slope_per_hour`'s sign: a high velocity with a negative
  slope is already past the party.
- Using `forecasts.json` from a stale snapshot — check `generated_at`;
  older than ~6h means the refresh pipeline is behind.
