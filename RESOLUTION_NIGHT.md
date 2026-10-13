# RESOLUTION_NIGHT.md — the first Oracle verdicts, published with zero improvisation

The Oracle's first 286 forecasts resolve on **2026-10-14 (UTC)**. This is
the exact procedure. The executable half is `scripts/resolution_night.sh`;
this document is why each step exists, what numbers to expect, and what
to do when a number is wrong.

The one rule above all others: **no forecast is graded before its own
48h horizon.** The runner refuses to publish early, and the graders
(`scripts/resolution-lib.js`) independently hold every entry pending
until its horizon passes — a mistimed run resolves only what is due.

## 1. When things land

Batch 1 was recorded in nine moments on 2026-10-12, so it resolves in
nine drops across one morning — not a single instant:

| Recorded (UTC) | Forecasts | Due (UTC, +48h) |
|---|---|---|
| Oct 12 01:45:28.760Z | 143 | **Oct 14 01:45:28.760Z** |
| Oct 12 02:11:34.070Z | 6 | Oct 14 02:11:34.070Z |
| Oct 12 02:12:51.346Z | 65 | Oct 14 02:12:51.346Z |
| Oct 12 02:19:27.641Z | 5 | Oct 14 02:19:27.641Z |
| Oct 12 02:46:58.898Z | 3 | Oct 14 02:46:58.898Z |
| Oct 12 03:32:45.259Z | 2 | Oct 14 03:32:45.259Z |
| Oct 12 03:33:43.334Z | 59 | Oct 14 03:33:43.334Z |
| Oct 12 04:40:11.037Z | 2 | Oct 14 04:40:11.037Z |
| Oct 12 06:59:57.558Z | 1 | Oct 14 06:59:57.558Z |

Positions going in (verified 2026-10-12 22:51 UTC, after a full
refresh): **267 of 286 windows (93.4%) already hold the 2+ actual
snapshots a decisive verdict needs.** The other 19 hold 0–1 points;
their topics stopped producing snapshots, and unless points land
before their horizons they grade `unverifiable` — with the evidence
on the record, never folded into the hit rate. Readiness moves only
one way from here: snapshots keep landing in open windows until each
window closes at its horizon.

*Wave-20 re-verification (2026-10-12 23:30 UTC, after two more
refreshes): readiness improved to **268/286 (93.7%)** — one short window
gained its second point. The early-grading gate was re-tested live
(`--run` refused, exit 2, ledger untouched), the write path re-ran
end-to-end in a sandbox copy (verdicts written, scorecard flipped to
"live", counts reconciled), and the scorecard page was screenshot-
verified in its "building history" state with zero console errors.*

*Wave-25 pre-gate check (2026-10-13 03:50–04:02 UTC, ~21.9h before
the gate): the gate was re-proved once — `--run` refused with exit 2
and the ledger md5 (`09d2e8ef7751671e25e0cafb981115a5`) was
byte-identical before and after. A full refresh then ran (exit 0,
393 topics live, forecasts built 2026-10-13T03:58:19.724Z) and
recorded +0 new forecasts — the ledger md5 was unchanged start to
end. Readiness held at **271/290 overall (268/286 batch 1)**; the
same 19 windows stay short (18 batch-1 + the wave-21 first-timer),
the audit ends ALL INVARIANTS HOLD (0 homeless — 80 live / 194
archive / 16 both; archive 210 topics / 1,391 points, 0 outside the
7d ledger window, 0 points older than 14d), counts reconcile
290 recorded = 290 pending + 0 resolved + 0 unverifiable, and the
scorecard stays "building history" with `hit_rate` null,
screenshot-verified with zero console errors.*

*Wave-24 pre-gate check (2026-10-13 03:19 UTC, ~22.4h before the gate):
the gate was re-proved once more — `--run` refused with exit 2 and the
ledger md5 (`09d2e8ef7751671e25e0cafb981115a5`) was byte-identical
before and after. Readiness held at **271/290 overall (268/286 batch
1)**; counts reconcile 290 recorded = 290 pending + 0 resolved + 0
unverifiable, scorecard still "building history" with `hit_rate`
null, screenshot-verified with zero console errors. No refresh ran:
wave 23's last refresh already occupies the 03:00Z hourly snapshot
bucket and this check sat in the same bucket. Refreshes resume on the
hourly cadence from the 04:00Z bucket onward, per the WAVELOG
handoff step (0).*

## 2. The sequence

One command runs the whole night:

```bash
scripts/resolution_night.sh --run
```

It performs, in order:

1. **Dry-run preview** — `check_resolutions.js --dry-run` prints the
   counts about to be published. Nothing is written.
2. **Verdicts** — `check_resolutions.js` writes each due entry's
   resolution into `data/forecast_ledger.json`: verdict
   (`hit` / `miss` / `unverifiable`), reason, and coverage evidence
   (`actual_first_ts`, `actual_last_ts`, `window_coverage_hours`,
   slope, end/max velocity). Already-resolved entries are never
   re-graded.
3. **Scorecard rebuild** — `scripts/build_forecasts.js` republishes
   `data/v1/forecasts.json` and `data/v1/forecast-accuracy.json` from
   the resolved ledger, and records any newly decisive forecasts
   (batch 2, §4). **The scorecard flip happens here:** status goes
   from `"building history"` to `"live"` and `hit_rate` appears the
   moment 10+ forecasts have resolved decisively.
4. **Verification** — counts must reconcile
   (`recorded = pending + resolved + unverifiable`), `hit_rate` must
   be present iff status is `live`, and every published verdict must
   carry window-coverage evidence. Any failure stops the night here.
5. **Validation** — `scripts/validate_api.py` must pass in full.

The script never commits or pushes. Read the verification output,
then commit the working repo. The `-live` repo updates only on an
explicit ship order, as always.

**Cadence on the night:** run `--run` at 01:45 UTC for the first drop
(143 verdicts — the flip happens in this run), then again after each
later drop, or hourly. A final run after **07:00 UTC** closes the
batch: the ledger should show 0 pending from batch 1. Every run is
idempotent; running it ten times publishes the same verdicts once.

**Before the night** (any time, safe): `scripts/resolution_night.sh
--preview` runs the dry-run plus the batch-2 audit and writes nothing.
The pre-flight audit is `node scripts/audit_batch2.js` — it must end
with `ALL INVARIANTS HOLD` (no homeless pending topic, readiness
matching the payload, archive inside its retention).

**Rehearsal, and its limits:** `node scripts/check_resolutions.js
--dry-run --at 2026-10-14T01:46:00Z` classifies as if it were that
moment (`--at` requires `--dry-run`; a rehearsal clock can never
write). The 2026-10-12 rehearsal classified the first drop as
14 hit / 119 miss / 10 unverifiable — mechanics proof only. It graded
windows holding ~20h of a 48h span; real verdicts grade the full
windows and will differ. Never quote rehearsal numbers as results.

## 3. What correct looks like

After the 01:45 UTC run, `data/v1/forecast-accuracy.json` should show:

- `status: "live"` (the first drop alone carries ~133 decisive
  verdicts at current readiness — far past the 10-verdict threshold)
- `counts.resolved` + `counts.unverifiable` ≈ 143, `counts.pending`
  ≈ 143, `hit_rate` a real number with `hit_rate_note` naming the
  decisive count and any excluded unverifiables
- `recent[]` entries carrying verdict, reason, snapshot count, and
  window coverage — a verdict graded on a partial window says so
- `next_resolution_at` advanced to the next drop (02:11:34.070Z)

And on `forecast-accuracy.html`: the live banner with the real hit
rate, the unverifiable card counting the excluded calls, and no
verdict rendered without its evidence line.

## 4. Batch 2 — already in motion, deliberately gradual

Batch 2 is not a second drop. `build_forecasts.js` records at most
one open entry per topic per 24h, so batch 2 opens topic-by-topic
starting **2026-10-13T01:45:28.760Z**, and a topic records only while
the classifier still calls it decisive (peaking / accelerating /
rising / fading) at that refresh. Expect a thin, rolling batch — at
the last build only 2 topics were decisive — not another 286.

Its windows are protected from birth by the wave-18 fix, verified
this wave three ways:

- **Live audit** (`scripts/audit_batch2.js`): every pending topic's
  series sits in the live store, the archive, or both — 0 homeless;
  the 36 series that churned out in the latest refresh were *moved*
  to the archive, not deleted.
- **Prune test** (`scripts/test_archive_prune.py`, 6/6): a series is
  dropped only when the ledger holds no entry for its topic inside
  the 7-day window; points older than 14 days age out individually;
  an unreadable ledger prunes nothing (fail-safe).
- **Live archive**: 199 topics / 1,276 points, every one inside the
  retention — 0 stray topics, 0 over-age points.

One honest scar from before the fix: 70 batch-1 entries no longer
have surviving *pre-forecast* snapshots (deleted in the pre-wave-18
era, only partly recovered from git history). Verdicts never read
pre-forecast points — grading uses the 48h window after the forecast
— so this costs nothing on the night. It is recorded here so nobody
mistakes it for a new loss.

## 5. When a number is wrong

- **Verification fails on reconciliation:** stop. Do not hand-edit
  `resolved` fields to make counts agree — a verdict written by hand
  is a fabricated verdict. Re-run step 2's dry-run, read the per-entry
  evidence, and fix the data problem (usually a history file) first.
- **Status stays "building history" after the first drop:** that
  means fewer than 10 decisive resolutions — at current readiness it
  would mean the graders read the wrong history. Check that
  `data/velocity_archive.json` is present and non-empty; without it,
  194 of 286 windows grade unverifiable.
- **`validate_api.py` fails:** the payload is not publishable. The
  ledger verdicts are still correct on disk; fix the payload issue
  and re-run from step 3 (`build_forecasts.js` is idempotent).
- **A refresh runs mid-night:** harmless. `pipeline/refresh.sh` ends
  in the same `build_forecasts.js`; resolutions stay idempotent and
  new snapshots only help windows that are still open.
- **The Vercel wire never resolves anything.** Resolution is
  repo-side by design (the wire's division of labor excludes the
  ledger and the accuracy payload). Verdicts reach the live site
  with the next snapshot push, on a ship order — not before.
