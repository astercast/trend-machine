# AGENT.md — how an agent uses Trend Machine

Trend Machine is a static trending-topic tracker: what to make content
about TODAY. Everything an agent needs is plain JSON under `data/v1/`.
There is no server, no auth, no API keys, and no rate limits — it's your
own static host.

## Base URL

`data/v1/` relative to the site root. Works on any static host.

- Deployed: `https://<your-host>/data/v1/trends.json`
- Local checkout: read `data/v1/*.json` straight off disk.
- Cross-origin from a browser page on another domain: plain `fetch()`
  is blocked by CORS on pure static hosts (GitHub Pages can't send
  `Access-Control-Allow-Origin`). Use the JSONP twin instead:
  `<script src="https://<host>/data/v1/trends.flat.js">` with a
  `trendsCallback(feed)` handler. See GO_LIVE.md §1.

**Start at `data/v1/index.json`.** It's a self-describing manifest: every
endpoint with `description`, `schema` (draft-07), `updated` timestamp,
`records` count, and notes. The changelog there tells you what changed
between versions; breaking changes get a new `v2/` path, never a silent
shape change. The shared conventions block (timestamps, freshness,
pagination, errors) lives in API.md.

## Key endpoints (with example requests)

All responses are complete static snapshots sized for client-side
filtering — there is no pagination and no query language. Fetch the
file, filter in memory.

**1. Full dossiers — `data/v1/trends.json`**
`{generated_at, count, topics:[{id, title, summary, category, platforms[],
hashtags[], velocity 0-100, saturation, opportunity_score 0-100,
first_seen, last_seen, stale, seeded, verification, trend_type,
format_family, sources[{name,url}], angles[], hooks[], who_to_watch[],
format_tags[], guide_links[]}]}`

- `format_family` (wave 9): id of the curated format family this topic
  belongs to (see `data/v1/meme-formats.json`), or `null`. Matched from the
  topic's own text against the family's keywords — re-computed every run.

- `trend_type` (wave 7): `format` = a reusable template to join (dance,
  caption variant, sound, challenge); `topic` = a subject to cover;
  `format+topic` = an event-driven topic riding a meme template.
  Rule-derived from `format_tags` + category — filter client-side.
- `verification` (wave 7, seeded topics): `verified` (2+ real sources),
  `single-source` (one real source), `unverified` (claimed sources not
  found on re-check — confirm the trend is live before building on it).

```bash
# Hottest plays right now (opportunity = velocity minus saturation penalty)
curl -s https://<host>/data/v1/trends.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
for t in sorted(d['topics'], key=lambda t: t['opportunity_score'], reverse=True)[:5]:
    if not t.get('stale'):
        print(t['opportunity_score'], '|', t['title'], '|', ' '.join(t['hashtags'][:3]))
"
```

```js
// node: load the dossier for one topic
const d = require('./data/v1/trends.json');
const t = d.topics.find(t => t.id === 'ramalama-walk');
console.log(t.title, t.opportunity_score, t.angles);
```

**2. Flat feed — `data/v1/trends.flat.json`**
`{generated_at, sample:false, source_count, trends:[{id, title, source,
url, velocity, opportunity_score, hashtags[], detected_at, summary,
category, platforms[], format_tags[], trend_type, sources[],
velocity_trend}]}` — opportunity-ranked, stale topics already excluded.
The lightweight "what's hot today" list. `velocity_trend` (wave 8):
`{snapshots, state, since, first_velocity, latest_velocity, delta,
sparkline_svg, per_platform}` — a ready-made inline SVG sparkline
(`role="img"`, data-grounded `aria-label`, static — safe to embed) plus
per-platform mini-summaries. `state` is `ready` (3+ real snapshots) or
`building` (fewer than 3 — `sparkline_svg` is then `null`: no fake line).
When you need the raw series, `data/v1/velocity.json` (all platforms) and
`data/v1/platform-velocity.json` (per-platform) have every snapshot.

**3. Hashtag index — `data/v1/hashtags.json`**
`{generated_at, tags: {"#tag": [topic-id, ...]}}` — reverse lookup.

**4. Velocity snapshots — `data/v1/velocity.json`**
`{topic-id: [[iso_ts, velocity, opportunity], ...]}` — hourly velocity
snapshots per topic, ascending by time. Classify them with
`assets/js/trajectory.js` (UMD — `require()` it in node) into
`accelerating | rising | peaking | fading | steady | insufficient`.

**5b. Per-platform input — `data/v1/platform-velocity.json`** (wave 6)
`{topic-id: {platform: [[iso_ts, velocity], ...]}}` — per-platform
hourly velocity series. Starting points: series begin empty and build
one snapshot per refresh; treat missing/thin series as "still building
history", never a guess.

**5d. Meme format families — `data/v1/meme-formats.json`** (wave 9)
The tracked meme format families: hand-curated from Oct-2026 web research
(`verification`: `verified` = 2+ independent sources, `single-source` =
one source or creator lore — flagged, never hidden; `status`: rising /
peak / fading / established / evergreen). Each family carries `examples[]`
with evidence + source URLs, `keywords`, and `tracked_topics[]` — the live
topic ids whose text matches the family's curated keywords this run
(re-computed every pipeline run by `pipeline/format_families.py`, so links
are derived, never stale). Topics link back via their `format_family`
field (null when unmatched). Human-readable at `formats.html`, which also
ranks families by tracked-topic opportunity (the format leaderboard).

**6. Schemas — `data/v1/schema/`**
Draft-07 for every endpoint: `trends.json`, `trends-flat.json`,
`trends-flat-sample.json`, `hashtags.json`, `velocity.json`,
`platform-velocity.json`,
`meme-formats.json`, `trend.json` (one dossier), `seed-freshness.json` (wave 14:
seed-staleness audit — verdicts healthy / stale-source / stale-untracked /
flaky-warning per seeded topic), `lifecycle.json` (wave 17: ignition/burnout
lifecycle stage per topic + last-24h ignitions/burnouts boards — readouts from
real snapshots, never predictions), and `index.json` itself.

## End-to-end workflows

### Workflow 1 — Find the easiest trend to remix today

Goal: one topic, one angle, one hook, ready to film.

1. `GET data/v1/trends.flat.json`. Confirm `sample` is `false`
   (the `sample:true` twin is for development only).
2. Take the first entry — the feed is already sorted by
   `opportunity_score` desc, stale topics excluded.
3. Enrich: look the `id` up in `data/v1/trends.json` for `angles[]`,
   `hooks[]`, `platforms[]`, `format_tags[]`.
4. Check freshness: `last_seen` should be within ~24h; if the dossier
   is `stale:true`, skip it (the flat feed already does this for you).

Example (run against this repo's data):

```
easiest today: "6-7" — Gen Alpha's defining brainrot joke
  opportunity 92 · velocity 92 · platforms tiktok, youtube
  angles: Explain the meme to millennials/parents (reaction gold) /
          Teacher/parent POV: surviving the 67 epidemic /
          Rank every 67 variant from cringe to elite
  hooks: "The number breaking every classroom in America" /
         "South Park just made it official"
  remix recipe: film angle #1, open with hook #1, tag #67 #sixseven
```

### Workflow 2 — Turn "Ramalama Costume Walk" into a 7-day battle plan

Goal: a week of posts from one trend, nothing invented.

1. `GET data/v1/trends.json`, find `id == "ramalama-walk"`. Read its
   dossier: 3 angles, 2 hooks, `#halloweencostume #ramalama
   #spookyseason`, platform `tiktok`, opportunity 58, velocity 90.
   (This is a seeded topic — its "430K videos" figure is a researched
   starting-point baseline from Oct 2026, not a live count.)
2. Feed the dossier into the launch-planner rule set
   (`assets/js/launch-plan-lib.js` — UMD, `require()` it in node, or
   replicate its documented rule): 7 days, rotate angles so no angle
   airs two days in a row, cycle hooks independently so every day is a
   unique angle+hook pairing, keep the dossier's own hashtags and
   platform throughout. Then pace by `trend_type`: **format** — Days 1–3
   run the canonical template, Days 4–7 add your twist; **format+topic** —
   join the template Days 1–2, cover the subject with your own take after;
   **topic** — cover fresh each day with rotating formats.
3. Verify: every angle/hook/hashtag in your plan appears verbatim in
   the dossier — the planner only orders, rotates, and paces.

Example plan (from the real dossier, via the real lib):

```
Day 1  Costume reveal timed to the Ramalama drop      + "Wait for the reveal"
Day 2  Synchronized group stalk — everyone hits the beat + "430K videos deep and counting"
Day 3  Parody: mundane costume, maximum menace walk   + "Wait for the reveal"
Day 4  Costume reveal timed to the Ramalama drop      + "430K videos deep and counting"
Day 5  Synchronized group stalk — everyone hits the beat + "Wait for the reveal"
Day 6  Parody: mundane costume, maximum menace walk   + "430K videos deep and counting"
Day 7  Costume reveal timed to the Ramalama drop      + "Wait for the reveal"
  all 7 days: tiktok · #halloweencostume #ramalama #spookyseason
```

The same plan is one click in the dashboard: any topic dossier has a
"7-day battle plan" button (launch-plan.html).

### Workflow 3 — Everything riding one hashtag

Goal: find every topic a hashtag touches.

1. `GET data/v1/hashtags.json`, look up e.g. `tags["#dancechallenge"]`
   → topic ids.
2. Join against `data/v1/trends.json` dossiers for titles, scores,
   and angles. Sort by `opportunity_score` desc.

### Workflow 4 — Weave 2–5 trends into one battle week

Goal: a single 7-day campaign across multiple trends, exportable and
trackable against reality.

1. Pick 2–5 dossier ids from `data/v1/trends.json` (or start at
   `launch-plan.html?battle=id1,id2,id3`).
2. `require('./assets/js/launch-plan-lib.js')` and call
   `LaunchPlanLib.buildBattlePlan(entries, ledgerEntries)` where
   `entries = [{topic, trajectory}]` and `ledgerEntries` comes from
   `data/forecast_ledger.json`'s `entries[]`. Rules: lead rotates in
   opportunity-desc order (no adjacent-day lead repeat), each trend's
   k-th appearance runs its own plan's k-th day, 1 or 6+ topics refuse
   honestly.
3. Every day carries `provenance` (angle #, trajectory state, snapshot
   count) and `platformTip` — a sourced execution note from the
   algorithm research page (`algorithms.html#tt` / `#yt` / `#ig`),
   never an invented posting time.
4. Export: `LaunchPlanLib.planToMarkdown(plan)` for sharing,
   `LaunchPlanLib.planSnapshot(plan)` for the JSON tracking hook —
   it freezes opportunity, velocity, trajectory state, and the newest
   forecast-ledger reference (`findLedgerRef`) at plan time.
5. Later, compare `snapshot.topics[].velocity` against the current
   `data/velocity_history.json` — that's the plan-vs-reality check-in.

## Rates, expectations, and honesty rules

- **Static JSON, not a live API.** Every payload states `generated_at`
  and which snapshot it came from. Treat undated numbers as stale.
  Freshness signal: if `generated_at` is older than ~6h, the refresh
  pipeline is behind — fall back to cache.
- **Seeded velocities are starting points.** Topics with `seeded:true`
  were hand-researched (Oct 2026 wave-fuel, re-verified wave 7); their
  velocities and any figures quoted in summaries (e.g. "430.7K videos")
  are researched baselines, not live measurements. Corroboration on later
  refreshes moves them. Never present a seed figure as a current
  measurement.
- **Seeded verification flags are load-bearing.** `verification:
  "unverified"` means the claimed sources couldn't be re-found — don't
  build plans on that topic without a live-feed confirmation.
  `"single-source"` = one real source, treat figures as provisional.
- **Topic figures are reported ranges, not exacts.** Velocities and
  opportunity scores are 0–100 indices computed from corroboration
  count, recency decay, and hashtag breadth — directional, not precise.
- **No predictions.** The Oracle forecast layer was retired on
  2026-10-13 by direct order: the site tracks ongoing hype (current
  velocity, opportunity, lifecycle stage readouts) and makes no
  forward calls. The forecast ledger stays in the repo as an
  archived record (`data/forecast_ledger.json`), unlinked.
- **Stale means cooling.** `stale:true` = no corroboration in 72h+.
  Cover only with a retrospective angle.
- **No auth, no keys, no rate limits** — but be a good citizen: fetch
  the snapshot once and filter client-side rather than hammering the
  host.

## For skill authors

Six content skills ship in `skills/` (`trend-spotting`,
`velocity-reading`, `remix-ideation`, `angle-generation`,
`hashtag-research`, `launch-planning`) — each a standalone playbook
in the standard format. Pair them with the workflows above:
workflow 1 → `remix-ideation`, workflow 2 → `launch-planning`
(and `angle-generation`), workflow 3 → `hashtag-research`.
