#!/usr/bin/env node
/* trend-machine — wave 27: pinned-fixture tests for the Oracle Board.
   Covers assets/js/oracle-board-lib.js (rendering + honesty contract)
   and scripts/build_oracle_board.js buildBoard() (payload invariants
   from a synthetic ledger + stores). The honesty contract:
     - pending renders as pending, with no verdict line
     - a window under 2 actuals renders SHORT with its real count
     - sparklines need 3+ stored points — fewer render "history
       building", never a fake line
     - hit rate shows only when status is "live" AND hit_rate is a
       number (the scorecard's own contract, read — not recomputed)
     - payload counts reconcile and every trajectory point in the
       payload is a point that was in the input stores
   Run: node scripts/test_oracle_board.js   (exit 0 = all pass) */
"use strict";
var B = require("../assets/js/oracle-board-lib.js");
var G = require("./build_oracle_board.js");
var R = require("./resolution-lib.js");

var FAILS = [];
function check(name, cond, detail) {
  if (cond) { console.log("  ok: " + name); }
  else { console.log("  FAIL: " + name + (detail ? " — " + detail : "")); FAILS.push(name); }
}

var NOW = Date.parse("2026-10-13T06:00:00Z");

function entry(over) {
  return Object.assign({
    topic_id: "alpha-topic", title: "Alpha Topic", state: "fading",
    forecast_at: "2026-10-12T01:45:28.760Z", due_at: "2026-10-14T01:45:28.760Z",
    forecast_velocity: 80, peak_in_hours: null, n_snapshots_at_forecast: 3,
    confidence: null, topic_live: true, platforms: ["tiktok"],
    status: "pending", verdict: null,
    window: { n_actual_points: 5, first_ts: "2026-10-12T03:00:00Z",
              last_ts: "2026-10-13T05:00:00Z", coverage_hours: 26,
              slope_per_hour: -2.1, ready: true },
    trajectory: [["2026-10-12T01:00:00Z", 90], ["2026-10-12T06:00:00Z", 85],
                 ["2026-10-13T01:00:00Z", 70], ["2026-10-13T05:00:00Z", 66]],
    trajectory_n: 4
  }, over || {});
}

var BOARD = {
  generated_at: "2026-10-13T06:00:00.000Z", status: "building history",
  horizon_hours: 48, method: "fixture", honesty: "fixture",
  counts: { recorded: 3, pending: 2, resolved: 1, unverifiable: 0,
            hits: 1, hit_rate: null, ready: 1, short: 1 },
  next_resolution_at: "2026-10-14T01:45:28.760Z",
  by_state: {}, due_per_day: [{ date: "2026-10-14", pending: 2 }],
  entries: [
    entry({}),
    entry({ topic_id: "short-topic", title: "Short Topic", state: "peaking",
            forecast_velocity: 92,
            window: { n_actual_points: 1, first_ts: "2026-10-12T03:00:00Z",
                      last_ts: "2026-10-12T03:00:00Z", coverage_hours: 0,
                      slope_per_hour: null, ready: false } }),
    entry({ topic_id: "hit-topic", title: "Hit Topic", status: "hit",
            verdict: { verdict: "hit", reason: "actual slope -2/hr vs falling threshold -1.5/hr",
                       resolved_at: "2026-10-14T02:00:00Z", n_actual_points: 9,
                       window_coverage_hours: 30, actual_slope: -2,
                       actual_end_velocity: 40, actual_max_velocity: 82,
                       actual_first_ts: "2026-10-12T03:00:00Z",
                       actual_last_ts: "2026-10-13T09:00:00Z" } })
  ]
};

// --- summary honesty -------------------------------------------------------
var sum = B.summaryHTML(BOARD, NOW);
check("building summary claims no hit rate",
      sum.indexOf("Building history") >= 0 &&
      sum.indexOf("no hit rate") >= 0 &&
      sum.indexOf("The Oracle's hit rate is") < 0);
check("building summary names the first verdict time",
      sum.indexOf("2026-10-14 01:45 UTC") >= 0);
var LIVE = JSON.parse(JSON.stringify(BOARD));
LIVE.status = "live"; LIVE.counts.hit_rate = 0.4; LIVE.counts.resolved = 15;
LIVE.counts.unverifiable = 3;
var liveSum = B.summaryHTML(LIVE, NOW);
check("live summary shows the payload's real hit rate",
      liveSum.indexOf("40%") >= 0 && liveSum.indexOf("3 unverifiable") >= 0);
var LYING = JSON.parse(JSON.stringify(BOARD));
LYING.counts.hit_rate = 0.9; // status still "building history"
check("hit_rate ignored while status is building history",
      B.summaryHTML(LYING, NOW).indexOf("90%") < 0);

// --- rows ------------------------------------------------------------------
var readyRow = B.rowHTML(BOARD.entries[0], NOW);
check("pending row renders PENDING badge", readyRow.indexOf("Pending") >= 0);
check("ready window renders Ready with its real count",
      readyRow.indexOf("Ready · 5 actuals") >= 0);
check("pending row has no verdict line",
      readyRow.indexOf("ob-verdict-line") < 0);
var shortRow = B.rowHTML(BOARD.entries[1], NOW);
check("short window renders SHORT with its real count (1 of 2)",
      shortRow.indexOf("Short · 1 of 2 actuals") >= 0);
var hitRow = B.rowHTML(BOARD.entries[2], NOW);
check("hit row renders Hit badge + the ledger's reason",
      hitRow.indexOf("Hit") >= 0 &&
      hitRow.indexOf("actual slope -2/hr") >= 0 &&
      hitRow.indexOf("9 actuals · 30h coverage") >= 0);
var offRow = B.rowHTML(entry({ topic_live: false }), NOW);
check("off-board topic renders plain text, no dead dossier link",
      offRow.indexOf("(left the board)") >= 0 && offRow.indexOf("<a href") < 0);

// --- sparkline honesty -------------------------------------------------------
check("sparkline draws at 3+ stored points",
      B.sparkSVG(BOARD.entries[0].trajectory, "alpha-topic").indexOf("<svg") === 0);
check("sparkline refuses at 2 points — history building, no svg",
      B.sparkSVG([["2026-10-12T01:00:00Z", 5], ["2026-10-12T02:00:00Z", 6]], "x")
        .indexOf("history building") >= 0);
check("sparkline refuses at 0 points",
      B.sparkSVG([], "x").indexOf("history building") >= 0);

// --- filter / sort -----------------------------------------------------------
check("filter by state", B.filterEntries(BOARD.entries, { state: "peaking" }).length === 1);
check("filter readiness=short finds only the short pending row",
      B.filterEntries(BOARD.entries, { readiness: "short" }).length === 1 &&
      B.filterEntries(BOARD.entries, { readiness: "short" })[0].topic_id === "short-topic");
check("filter readiness=ready excludes resolved rows",
      B.filterEntries(BOARD.entries, { readiness: "ready" }).length === 1);
check("filter by query matches title",
      B.filterEntries(BOARD.entries, { query: "hit top" }).length === 1);
check("sort by velocity desc",
      B.sortEntries(BOARD.entries, "velocity")[0].topic_id === "short-topic");
check("filter+rows render an honest empty state",
      B.rowsHTML(BOARD, { query: "no-such-topic" }, NOW).indexOf("No forecasts match") >= 0);

// --- generator: buildBoard invariants ---------------------------------------
var T0 = "2026-10-12T01:45:28.760Z";
var ledger = { entries: [
  { topic_id: "alpha-topic", title: "Alpha Topic", forecast_at: T0,
    state: "fading", peak_in_hours: null, latest_velocity: 80,
    n_snapshots: 3, resolved: null },
  { topic_id: "gone-topic", title: "Gone Topic", forecast_at: T0,
    state: "peaking", peak_in_hours: 0, latest_velocity: 95,
    n_snapshots: 3, resolved: null }
]};
var liveHist = { "alpha-topic": [
  ["2026-10-11T23:00:00+00:00", 88, 88], [T0.replace("Z", "+00:00"), 80, 80],
  ["2026-10-12T05:00:00+00:00", 70, 70], ["2026-10-13T05:00:00+00:00", 60, 60]] };
var archHist = { "gone-topic": [
  ["2026-10-12T05:00:00+00:00", 90, 90]] };
var merged = R.mergeHistory(liveHist, archHist);
var store = { topics: [{ id: "alpha-topic", title: "Alpha Topic",
                         platforms: ["tiktok"] }] };
var acc = { status: "building history", hit_rate: null };
var built = G.buildBoard(new Date("2026-10-13T06:00:00Z"),
                         ledger, merged, store, acc);
check("generator: counts reconcile",
      built.counts.recorded === 2 && built.counts.pending === 2 &&
      built.counts.resolved === 0 && built.counts.unverifiable === 0);
check("generator: ready + short = pending (1 ready, 1 short)",
      built.counts.ready === 1 && built.counts.short === 1);
var alpha = built.entries.filter(e => e.topic_id === "alpha-topic")[0];
check("generator: trajectory is exactly the stored points, as [iso, v] pairs",
      alpha.trajectory_n === 4 && alpha.trajectory[1][1] === 80 &&
      alpha.trajectory.every(p => p.length === 2));
check("generator: window counts only points inside the 48h window",
      alpha.window.n_actual_points === 2 && alpha.window.ready === true);
check("generator: due_at is forecast_at + 48h",
      alpha.due_at === "2026-10-14T01:45:28.760Z");
check("generator: live topic flagged live, archived topic not",
      alpha.topic_live === true &&
      built.entries.filter(e => e.topic_id === "gone-topic")[0].topic_live === false);
check("generator: hit_rate read from the accuracy payload (null stays null)",
      built.counts.hit_rate === null && built.status === "building history");
check("generator: next_resolution_at is the earliest due time",
      built.next_resolution_at === "2026-10-14T01:45:28.760Z");

console.log(FAILS.length ? ("[test_oracle_board] " + FAILS.length + " FAILURES")
                         : "[test_oracle_board] all checks passed");
process.exit(FAILS.length ? 1 : 0);
