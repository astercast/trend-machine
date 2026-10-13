/* ============================================================
   TREND MACHINE — build_oracle_board.js (wave 27 / rotation 10)
   The Oracle Board payload: a forecast-explorer over the REAL
   ledger + snapshot stores. One row per recorded forecast in
   data/forecast_ledger.json, carrying:
     - the call (state at forecast time, forecast-time velocity,
       snapshots behind the call, confidence when recorded)
     - the full stored velocity trajectory for the topic — live
       store merged with the resolution archive by the one merge
       rule (scripts/resolution-lib.js mergeHistory), points kept
       as recorded [iso_ts, velocity] pairs, never resampled,
       never invented
     - the 48h window state: how many actual snapshots the window
       after the forecast already holds, their first/last times,
       the observed coverage span, and the window slope — the same
       evidence the graders will use on Resolution Night
     - the verdict, when one exists: pending rows stay pending,
       terminal rows carry the ledger's own resolved object
       verbatim (verdict, reason, coverage evidence)

   Honesty contract (same as the scorecard's):
     - status / hit_rate are read from data/v1/forecast-accuracy.json
       — this payload never computes its own accuracy claim; while
       the scorecard says "building history", hit_rate stays null
     - a pending window with <2 actuals is "short" — shown as
       short, never smoothed over; it grades unverifiable with
       evidence if it is still short at its horizon
     - counts reconcile: recorded = pending + resolved +
       unverifiable, and ready + short = pending

   Input : data/forecast_ledger.json, data/velocity_history.json,
           data/velocity_archive.json, data/trends.json,
           data/v1/forecast-accuracy.json (status + hit_rate source)
   Output: data/v1/oracle-board.json
           + patches data/v1/index.json (oracle_board endpoint)
   Run   : node scripts/build_oracle_board.js
           (wired into pipeline/refresh.sh after build_forecasts.js,
           and into scripts/resolution_night.sh step 3 so verdicts
           land on the board in the same run that writes them)
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LEDGER_FILE = path.join(ROOT, "data", "forecast_ledger.json");
const HIST_FILE = path.join(ROOT, "data", "velocity_history.json");
const ARCHIVE_FILE = path.join(ROOT, "data", "velocity_archive.json");
const TRENDS_FILE = path.join(ROOT, "data", "trends.json");
const ACC_FILE = path.join(ROOT, "data", "v1", "forecast-accuracy.json");
const API = path.join(ROOT, "data", "v1");
const OUT = path.join(API, "oracle-board.json");
const MANIFEST = path.join(API, "index.json");

const R = require("./resolution-lib.js"); // the one merge + window rule set

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { return fallback; }
}

function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function round2(x) { return Math.round(x * 100) / 100; }

function buildBoard(now, ledger, mergedHistory, store, acc) {
  const topics = {};
  ((store && store.topics) || []).forEach(t => {
    topics[t.id] = t;
  });

  const entries = ((ledger && ledger.entries) || []).map(e => {
    const w = R.windowOf(e);
    const dueAt = new Date(w.endMs).toISOString();
    const series = (mergedHistory[e.topic_id] || []).map(p => [p[0], p[1]]);
    const actuals = R.actualsInWindow(e, mergedHistory);
    const coverage = actuals.length >= 2
      ? Math.round(((Date.parse(actuals[actuals.length - 1][0]) -
                     Date.parse(actuals[0][0])) / 360000)) / 10
      : 0;
    const slope = actuals.length >= 2
      ? round2(R.slopeOf(actuals, w.startMs).slope) : null;
    const verdict = e.resolved ? {
      verdict: e.resolved.verdict,
      reason: e.resolved.reason,
      resolved_at: e.resolved.resolved_at || null,
      n_actual_points: e.resolved.n_actual_points != null
        ? e.resolved.n_actual_points : actuals.length,
      window_coverage_hours: e.resolved.window_coverage_hours != null
        ? e.resolved.window_coverage_hours : coverage,
      actual_slope: e.resolved.actual_slope != null ? e.resolved.actual_slope : null,
      actual_end_velocity: e.resolved.actual_end_velocity != null
        ? e.resolved.actual_end_velocity : null,
      actual_max_velocity: e.resolved.actual_max_velocity != null
        ? e.resolved.actual_max_velocity : null,
      actual_first_ts: e.resolved.actual_first_ts != null
        ? e.resolved.actual_first_ts : (actuals.length ? actuals[0][0] : null),
      actual_last_ts: e.resolved.actual_last_ts != null
        ? e.resolved.actual_last_ts
        : (actuals.length ? actuals[actuals.length - 1][0] : null)
    } : null;
    const topic = topics[e.topic_id] || null;
    return {
      topic_id: e.topic_id,
      title: e.title,
      state: e.state,
      forecast_at: e.forecast_at,
      due_at: dueAt,
      forecast_velocity: e.latest_velocity,
      peak_in_hours: e.peak_in_hours != null ? e.peak_in_hours : null,
      n_snapshots_at_forecast: e.n_snapshots != null ? e.n_snapshots : null,
      confidence: e.confidence != null ? e.confidence : null,
      topic_live: !!topic,
      platforms: topic ? (topic.platforms || []) : [],
      status: e.resolved ? e.resolved.verdict : "pending",
      verdict: verdict,
      window: {
        n_actual_points: actuals.length,
        first_ts: actuals.length ? actuals[0][0] : null,
        last_ts: actuals.length ? actuals[actuals.length - 1][0] : null,
        coverage_hours: coverage,
        slope_per_hour: slope,
        ready: actuals.length >= 2
      },
      trajectory: series,
      trajectory_n: series.length
    };
  });

  // Board order: earliest horizon first (the queue Resolution Night
  // works through), forecast velocity breaking ties.
  entries.sort((a, b) =>
    (Date.parse(a.due_at) - Date.parse(b.due_at)) ||
    (b.forecast_velocity - a.forecast_velocity));

  const pending = entries.filter(e => e.status === "pending");
  const decisive = entries.filter(e => e.status === "hit" || e.status === "miss");
  const unverifiable = entries.filter(e => e.status === "unverifiable");
  const hits = entries.filter(e => e.status === "hit");
  const ready = pending.filter(e => e.window.ready);
  const short = pending.filter(e => !e.window.ready);

  const byState = {};
  entries.forEach(e => {
    const s = byState[e.state] ||
      (byState[e.state] = { recorded: 0, pending: 0, resolved: 0, hits: 0,
                            unverifiable: 0, ready: 0, short: 0 });
    s.recorded++;
    if (e.status === "pending") {
      s.pending++;
      if (e.window.ready) { s.ready++; } else { s.short++; }
    } else if (e.status === "unverifiable") {
      s.unverifiable++;
    } else {
      s.resolved++;
      if (e.status === "hit") { s.hits++; }
    }
  });

  const byDue = {};
  pending.forEach(e => {
    const day = e.due_at.slice(0, 10);
    byDue[day] = (byDue[day] || 0) + 1;
  });

  let nextResolutionAt = null;
  pending.forEach(e => {
    if (nextResolutionAt === null || e.due_at < nextResolutionAt) {
      nextResolutionAt = e.due_at;
    }
  });

  return {
    generated_at: now.toISOString(),
    status: acc ? acc.status : "building history",
    horizon_hours: 48,
    method: "One row per forecast in data/forecast_ledger.json. Trajectories " +
            "are the topic's stored velocity snapshots (live store merged " +
            "with the resolution archive via scripts/resolution-lib.js " +
            "mergeHistory — live store wins per hour bucket), kept as " +
            "recorded. Window evidence is resolution-lib.js " +
            "actualsInWindow() over the forecast's own 48h window — the " +
            "same evidence the graders use. Status and hit_rate are read " +
            "from data/v1/forecast-accuracy.json, never recomputed here.",
    honesty: "Zero invented data: every trajectory point is a stored " +
             "snapshot, every window count is counted from those points, " +
             "pending calls render as pending, and a window holding fewer " +
             "than 2 actual snapshots is labeled short — it grades " +
             "unverifiable with evidence at its horizon, never folded " +
             "into the hit rate. While the scorecard status is " +
             "\"building history\", hit_rate is null and no accuracy " +
             "is claimed.",
    counts: {
      recorded: entries.length,
      pending: pending.length,
      resolved: decisive.length,
      unverifiable: unverifiable.length,
      hits: hits.length,
      hit_rate: acc ? acc.hit_rate : null,
      ready: ready.length,
      short: short.length
    },
    next_resolution_at: nextResolutionAt,
    by_state: byState,
    due_per_day: Object.keys(byDue).sort().map(day => ({
      date: day, pending: byDue[day]
    })),
    entries: entries
  };
}

function main() {
  const now = new Date();
  const ledger = readJSON(LEDGER_FILE, null);
  const history = readJSON(HIST_FILE, null);
  if (!ledger || !history) {
    console.log("[oracle-board] SKIP: ledger or velocity history missing — run pipeline/refresh.sh first.");
    return;
  }
  const archive = readJSON(ARCHIVE_FILE, {});
  const store = readJSON(TRENDS_FILE, { topics: [] });
  const acc = readJSON(ACC_FILE, null);
  const merged = R.mergeHistory(history, archive);
  const board = buildBoard(now, ledger, merged, store, acc);

  fs.mkdirSync(API, { recursive: true });
  writeJSON(OUT, board);
  console.log("[oracle-board] " + board.counts.recorded + " forecasts -> " + OUT +
              " (pending=" + board.counts.pending +
              " ready=" + board.counts.ready +
              " short=" + board.counts.short +
              " resolved=" + board.counts.resolved +
              " unverifiable=" + board.counts.unverifiable +
              " status=" + board.status + ")");

  // Patch the manifest (same pattern as build_forecasts.js): the
  // endpoint itself is declared by build_site.py; here we only keep
  // its records/updated honest. No version bump — build_forecasts.js
  // owns the manifest version line.
  try {
    const manifest = readJSON(MANIFEST);
    if (manifest && manifest.endpoints) {
      const prev = manifest.endpoints.oracle_board || {};
      manifest.endpoints.oracle_board = {
        path: "data/v1/oracle-board.json",
        description: prev.description ||
          "The Oracle Board: every recorded forecast as an explorable row — call type, forecast-time velocity, the topic's full stored velocity trajectory, its 48h window state (actual snapshots, coverage, slope, ready/short), due time, and the verdict when one exists. Pending stays pending; short windows are labeled short. Status and hit_rate are read from forecast-accuracy.json, never recomputed.",
        schema: "data/v1/schema/oracle-board.json",
        updated: board.generated_at,
        records: board.counts.recorded,
        notes: prev.notes ||
          "Built by scripts/build_oracle_board.js from the ledger + merged snapshot stores (live + resolution archive). Human-readable at oracle-board.html."
      };
      writeJSON(MANIFEST, manifest);
      console.log("[oracle-board] data/v1/index.json patched with oracle_board endpoint");
    }
  } catch (e) {
    console.log("[oracle-board] WARNING: could not patch manifest: " + e.message);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildBoard: buildBoard };
}
if (require.main === module) { main(); }
