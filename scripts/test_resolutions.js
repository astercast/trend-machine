#!/usr/bin/env node
/* trend-machine — wave 14: pinned-fixture tests for scripts/resolution-lib.js.
   The resolution contract:
     - entries younger than 48h stay pending (with due_at)
     - terminal verdicts: hit / miss / unverifiable
     - "unverifiable" when the 48h window holds <2 actual snapshots
     - same thresholds as the classifier (rise=+1.5/hr, fall=-1.5/hr)
     - peaking hit iff max window velocity <= forecast-time velocity + 2
     - every terminal resolution carries window bounds + point counts
     - already-resolved entries are never touched (idempotent)
   Run: node scripts/test_resolutions.js   (exit 0 = all pass) */
"use strict";
var R = require("./resolution-lib.js");

var FAILS = [];
function check(name, cond, detail) {
  if (cond) { console.log("  ok: " + name); }
  else { console.log("  FAIL: " + name + (detail ? " — " + detail : "")); FAILS.push(name); }
}

var TH = { rise: 1.5, fall: -1.5 };
var NOW = Date.parse("2026-10-15T06:00:00Z"); // 73h after the fixtures below
var FAT = "2026-10-12T05:00:00Z";

function series(vels, startIso) {
  var t0 = Date.parse(startIso || "2026-10-12T06:00:00Z");
  return vels.map(function (v, i) {
    return [new Date(t0 + i * 3600000).toISOString(), v];
  });
}
function hist(topicId, vels) {
  var h = {}; h[topicId] = series(vels); return h;
}
function entry(topicId, state, latestVelocity) {
  return { topic_id: topicId, title: topicId, forecast_at: FAT, state: state,
           latest_velocity: latestVelocity, n_snapshots: 5, resolved: null };
}

// --- rising: slope >= +1.5/hr is a hit ---------------------------------------
var e1 = entry("t-rise-hit", "rising", 60);
var c1 = R.classifyResolution(e1, hist("t-rise-hit", [60, 62, 64, 66, 68]), NOW, TH);
check("rising, slope +2/hr -> hit", c1.status === "resolved" && c1.verdict === "hit",
      JSON.stringify(c1));
check("rising hit records evidence", c1.evidence.n_actual_points === 5 &&
      c1.evidence.window_start === FAT && typeof c1.evidence.actual_slope === "number");

var e2 = entry("t-rise-miss", "rising", 60);
var c2 = R.classifyResolution(e2, hist("t-rise-miss", [60, 60, 60, 60, 60]), NOW, TH);
check("rising, flat slope -> miss", c2.status === "resolved" && c2.verdict === "miss",
      JSON.stringify(c2));

// --- accelerating uses the rising threshold ----------------------------------
var e3 = entry("t-accel", "accelerating", 60);
var c3 = R.classifyResolution(e3, hist("t-accel", [60, 63, 66, 69, 72]), NOW, TH);
check("accelerating, slope +3/hr -> hit", c3.status === "resolved" && c3.verdict === "hit");

// --- fading: slope <= -1.5/hr is a hit ----------------------------------------
var e4 = entry("t-fade-hit", "fading", 90);
var c4 = R.classifyResolution(e4, hist("t-fade-hit", [90, 88, 86, 84, 82]), NOW, TH);
check("fading, slope -2/hr -> hit", c4.status === "resolved" && c4.verdict === "hit");

var e5 = entry("t-fade-miss", "fading", 90);
var c5 = R.classifyResolution(e5, hist("t-fade-miss", [90, 89, 88, 87, 86]), NOW, TH);
check("fading, slope -1/hr -> miss", c5.status === "resolved" && c5.verdict === "miss",
      JSON.stringify(c5));

// --- peaking: max <= forecast + 2 ---------------------------------------------
var e6 = entry("t-peak-hit", "peaking", 92);
var c6 = R.classifyResolution(e6, hist("t-peak-hit", [92, 94, 93, 90, 88]), NOW, TH);
check("peaking, max 94 <= 92+2 -> hit", c6.status === "resolved" && c6.verdict === "hit",
      JSON.stringify(c6));

var e7 = entry("t-peak-miss", "peaking", 92);
var c7 = R.classifyResolution(e7, hist("t-peak-miss", [92, 95, 96, 95, 93]), NOW, TH);
check("peaking, max 96 > 92+2 -> miss", c7.status === "resolved" && c7.verdict === "miss",
      JSON.stringify(c7));

// --- non-decisive state ---------------------------------------------------------
var e8 = entry("t-steady", "steady", 70);
var c8 = R.classifyResolution(e8, hist("t-steady", [70, 70, 70, 70, 70]), NOW, TH);
check("non-decisive state -> miss", c8.status === "resolved" && c8.verdict === "miss");

// --- not due stays pending ------------------------------------------------------
var young = entry("t-young", "rising", 60);
young.forecast_at = "2026-10-15T02:00:00Z"; // 4h ago, horizon lands 2026-10-17T02:00Z
var c9 = R.classifyResolution(young, hist("t-young", [60, 62, 64]), NOW, TH);
check("entry <48h old -> pending with due_at",
      c9.status === "pending" && c9.reason === "not-due" &&
      c9.due_at === "2026-10-17T02:00:00.000Z", JSON.stringify(c9));

// --- data gap -> unverifiable -----------------------------------------------------
var e10 = entry("t-gap", "rising", 60);
var c10 = R.classifyResolution(e10, { "t-gap": [series([61])[0]] }, NOW, TH);
check("48h passed, 1 snapshot -> unverifiable",
      c10.status === "resolved" && c10.verdict === "unverifiable", JSON.stringify(c10));
check("unverifiable records evidence", c10.evidence.n_actual_points === 1 &&
      c10.reason.indexOf("fewer than 2") >= 0);

var e11 = entry("t-gone", "peaking", 80);
var c11 = R.classifyResolution(e11, {}, NOW, TH); // topic dropped entirely
check("48h passed, 0 snapshots -> unverifiable",
      c11.status === "resolved" && c11.verdict === "unverifiable");

// --- idempotency -----------------------------------------------------------------
var done = entry("t-done", "rising", 60);
done.resolved = { resolved_at: "2026-10-14T06:00:00Z", verdict: "hit" };
var c12 = R.classifyResolution(done, hist("t-done", [60, 62, 64, 66, 68]), NOW, TH);
check("already resolved -> status already", c12.status === "already");
var before = JSON.stringify(done.resolved);
R.resolveEntry(done, hist("t-done", [60, 62, 64, 66, 68]), NOW, TH);
check("resolveEntry never rewrites an existing resolution",
      JSON.stringify(done.resolved) === before);

// --- resolveEntry writes evidence -------------------------------------------------
var e13 = entry("t-write", "fading", 90);
var c13 = R.resolveEntry(e13, hist("t-write", [90, 88, 86, 84, 82]), NOW, TH);
check("resolveEntry returns classification",
      c13.status === "resolved" && c13.verdict === "hit");
check("resolveEntry stores resolved_at + verdict + evidence",
      e13.resolved && e13.resolved.verdict === "hit" &&
      e13.resolved.actual_slope <= -1.5 &&
      e13.resolved.window_start === FAT &&
      typeof e13.resolved.window_end === "string" &&
      e13.resolved.n_actual_points === 5);

// --- constants ----------------------------------------------------------------------
check("HORIZON_H is 48", R.HORIZON_H === 48);
check("PEAK_TOLERANCE is 2", R.PEAK_TOLERANCE === 2);

console.log(FAILS.length === 0 ? "test_resolutions: ALL PASS" :
            "test_resolutions: " + FAILS.length + " FAILURES");
process.exit(FAILS.length === 0 ? 0 : 1);
