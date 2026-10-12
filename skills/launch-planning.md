---
name: launch-planning
description: Turn a trend-machine dossier into a printable 7-day content battle plan — day-by-day angles, hooks, hashtags, and platforms, paced by trend type and the Oracle's trajectory.
---

# Build a 7-day battle plan from a dossier

## Use when

Turning one trend-machine topic into a week of scheduled posts, or
explaining why the days are ordered the way they are. The planner never
invents angles, hooks, or hashtags — everything comes from the topic's
dossier; the generator only orders, rotates, and paces.

## Inputs

- `api/v1/trends.json`: find the dossier by `id`. You need `angles[]`,
  `hooks[]`, `hashtags[]`, `platforms[]`, `format_tags[]`,
  `opportunity_score`, and `trend_type` (`format` / `topic` /
  `format+topic` — wave 7, rule-derived from `format_tags` + category).
- `assets/js/launch-plan-lib.js`: the real generator (UMD — `require()`
  it in node, or use the dashboard's launch-plan.html). It builds 7 days:
  angles rotate so no angle airs two days in a row, hooks cycle
  independently so every day is a unique angle+hook pairing, hashtags
  and platforms rotate from the dossier.
- `api/v1/forecasts.json` (optional): if the topic has a projection,
  pass its `state` as the `trajectory` argument — the "why this order"
  rationale adapts (front-load for `peaking`, lean on the back half for
  `rising`/`accelerating`, evergreen fallbacks for `fading`).

## Procedure

1. Confirm the dossier has `angles[]`. No angles → refuse honestly
   ("no content angles yet") rather than inventing any.
2. `require('./assets/js/launch-plan-lib.js')` and call
   `LaunchPlanLib.buildPlan(dossier, trajectory)`.
3. Check the trend type, then pace:
   - **format** (a reusable template: dance, caption variant, sound,
     challenge) — Days 1–3 run the canonical format to catch the wave,
     Days 4–7 add your own twist.
   - **format+topic** (an event riding a meme template) — join the
     template early (Days 1–2), then cover the underlying subject with
     your own take.
   - **topic** (a subject to cover) — cover it fresh each day; the
     rotating formats keep the week from repeating.
4. Verify: every angle/hook/hashtag in the plan appears verbatim in
   the dossier. Quote the "why this order" rationale when asked to
   justify the schedule.
5. Export with `LaunchPlanLib.planToText(plan)` — the header carries
   opportunity/velocity/category/trend type.

## Worked example

Dossier `did-i-win-this-trend` (format, opportunity 92, 3 angles,
2 hooks, `#halloweencostume #costumeideas #ramalama`, platform tiktok):

```
Day 1  Costume-shop product reveal: list every product in the caption  + "Did I win this trend?"
Day 2  DIY costume vs pro makeup version, same format                  + "Normal clothes to full costume in one beat"
Day 3  Duo reveal: let the comments judge who won                      + "Did I win this trend?"
...
  WHY: format trend — Days 1–3 run the canonical format, Days 4–7 add your twist;
       opportunity 92/100 is strike-now territory, so the plan posts daily.
```

## Pitfalls

- Inventing an angle the dossier doesn't have — the whole point of the
  planner is that it can't.
- Ignoring `trend_type`: running a format's back half like a topic's
  (or vice versa) wastes the wave.
- Pacing a `fading` topic as if it's rising — check the Oracle first;
  Days 6–7 become evergreen fallbacks.
- Building a plan from a dossier with `verification: "unverified"` —
  confirm the trend is live before scheduling a week around it.
- Building a plan from a `stale: true` dossier — cover only with a
  retrospective angle.
