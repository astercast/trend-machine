---
name: launch-planning
description: Turn trend-machine dossiers into 7-day battle plans — single-trend plans or multi-trend battle plans, day-by-day angles, hooks, hashtags, platform timing tips from sourced algorithm research, exportable as text/markdown/JSON, with plan-vs-reality check-ins against the forecast ledger.
---

# Build a 7-day battle plan from a dossier

## Use when

Turning one trend-machine topic into a week of scheduled posts, or
explaining why the days are ordered the way they are. The planner never
invents angles, hooks, or hashtags — everything comes from the topic's
dossier; the generator only orders, rotates, and paces.

## Inputs

- `data/v1/trends.json`: find the dossier by `id`. You need `angles[]`,
  `hooks[]`, `hashtags[]`, `platforms[]`, `format_tags[]`,
  `opportunity_score`, and `trend_type` (`format` / `topic` /
  `format+topic` — wave 7, rule-derived from `format_tags` + category).
- `assets/js/launch-plan-lib.js`: the real generator (UMD — `require()`
  it in node, or use the dashboard's launch-plan.html). It builds 7 days:
  angles rotate so no angle airs two days in a row, hooks cycle
  independently so every day is a unique angle+hook pairing, hashtags
  and platforms rotate from the dossier.
- `data/v1/forecasts.json` (optional): if the topic has a projection,
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

## Battle mode (wave 10) — 2–5 trends, one week

`LaunchPlanLib.buildBattlePlan(entries, ledgerEntries)` weaves 2–5
trends into a single 7-day campaign. `entries` is `[{topic, trajectory}]`;
`ledgerEntries` is `data/forecast_ledger.json`'s `entries[]` (optional —
the page reads it; the lib never writes the ledger).

Rules (all unit-tested in `scripts/test_launch_battle.js`):

1. Each trend keeps its own pacing: the lead rotates through an
   opportunity-desc order (no two adjacent days share a lead), and a
   trend's k-th appearance runs its own 7-day plan's k-th day.
2. 2–5 topics only — 1 is refused (use `buildPlan`), 6+ is refused
   (cap keeps the week schedulable), and a topic with no angles is
   named in the refusal.
3. Every day carries `provenance` ("angle #k of N from the dossier ·
   trajectory <state> (n snapshots)") and a `platformTip` when the
   platform has sourced research (tiktok/youtube/instagram —
   `LaunchPlanLib.platformTip()`; anything else returns `null`, never
   an invented tip).

## Exports + plan-vs-reality (wave 10)

- `LaunchPlanLib.planToMarkdown(plan)` — shareable markdown with the
  day-by-day calendar, timing tips with source attribution, provenance,
  and the honesty footer.
- `LaunchPlanLib.planSnapshot(plan)` — the tracking-hook object:
  freezes each topic's `opportunity`, `velocity`, trajectory state, and
  `ledger_ref` (the newest `data/forecast_ledger.json` record, found via
  `LaunchPlanLib.findLedgerRef(entries, topicId)`) at plan time.
- On launch-plan.html, "💾 Save this plan" stores the snapshot in
  `localStorage` (`tm_plans_v1`, 12 most recent); "Check progress"
  compares plan-time velocity against the live
  `data/velocity_history.json` and links the topic's ledger record to
  the archived forecast ledger record (the scorecard page retired
  with the prediction layer on 2026-10-13).
