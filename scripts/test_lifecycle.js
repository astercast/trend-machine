/* ============================================================
   TREND MACHINE — test_lifecycle.js (wave 17)
   Pinned-fixture unit tests for assets/js/lifecycle-lib.js —
   the ignition/burnout lifecycle classifier.
   Run: node scripts/test_lifecycle.js   (exit 0 = all pass)
   ============================================================ */
"use strict";
var L = require("../assets/js/lifecycle-lib.js");

var passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error("FAIL: " + name); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// Hourly synthetic series: climbs from 5, crosses the ignition line
// (v>=70) still rising, crests, falls, and dies below v=20.
function hourly(vals, startMs) {
  return vals.map(function (v, i) {
    return [new Date(startMs + i * 3600000).toISOString(), v, v];
  });
}
var T0 = Date.parse("2026-10-12T00:00:00Z");
var RUN = hourly([5, 8, 12, 20, 35, 55, 75, 95, 92, 70, 40, 15], T0);

// ---- classifySeries: the full lifecycle arc ----
var stages = L.classifySeries(RUN);
ok(eq(stages.slice(0, 6), ["warming", "warming", "warming", "warming", "warming", "warming"]),
  "warming while climbing below ignition");
ok(stages[6] === "igniting" && stages[7] === "igniting",
  "igniting while hot and still climbing");
ok(stages[8] === "cooling" && stages[9] === "cooling" && stages[10] === "cooling",
  "cooling once the slope turns negative");
ok(stages[11] === "burned-out",
  "burned-out: cold again (v<20) after a hot run");
ok(stages[0] === "warming" && stages[1] === "warming",
  "first two points backfill from the first classifiable stage");

// ---- steady / peaking / building floors ----
ok(eq(L.classifySeries(hourly([50, 50, 50], T0)), ["steady", "steady", "steady"]),
  "flat series is steady");
ok(eq(L.classifySeries(hourly([92, 92, 92, 92], T0)),
  ["peaking", "peaking", "peaking", "peaking"]),
  "hot flat series is peaking, not cooling");
ok(eq(L.classifySeries(hourly([10, 11], T0)), ["building", "building"]),
  "fewer than 3 snapshots is building");
ok(eq(L.classifySeries([]), []), "empty series classifies to empty");

// ---- burned-out requires a hot run first ----
ok(eq(L.classifySeries(hourly([5, 4, 3, 2], T0)), ["steady", "steady", "steady", "steady"]),
  "cold series that never crossed 70 is steady, not burned-out");
ok(eq(L.classifySeries(hourly([72, 40, 15, 10], T0))[3], "burned-out"),
  "burned-out reachable after crossing 70 and falling");

// ---- localSlope guards ----
ok(L.localSlope(RUN, 2) === 4, "localSlope is per-hour velocity change");
var badDt = [[new Date(T0).toISOString(), 50, 50],
             [new Date(T0).toISOString(), 60, 60],
             [new Date(T0 + 3600000).toISOString(), 60, 60]];
ok(L.localSlope(badDt, 1) === null, "localSlope null on zero dt");
ok(L.classifySeries(badDt)[1] === "steady", "null slope treated as 0 (steady)");

// ---- currentStage ----
var cur = L.currentStage(RUN);
ok(cur.stage === "burned-out", "currentStage finds the terminal stage");
ok(cur.since === RUN[11][0], "currentStage.since is the first snapshot of the run");
var flat3 = hourly([50, 50, 50], T0);
ok(L.currentStage(flat3).stage === "steady", "currentStage steady on flat");
ok(L.currentStage([]).stage === "building", "currentStage building on empty");

// ---- transitionsInWindow: the ignition/burnout board feed ----
var NOW = T0 + 12 * 3600000;
var trs = L.transitionsInWindow(RUN, 24, NOW);
ok(trs.length === 3, "three stage transitions in the full run");
ok(trs[0].from === "warming" && trs[0].to === "igniting",
  "transition 1: warming -> igniting");
ok(trs[1].from === "igniting" && trs[1].to === "cooling",
  "transition 2: igniting -> cooling");
ok(trs[2].from === "cooling" && trs[2].to === "burned-out",
  "transition 3: cooling -> burned-out");
var old = L.transitionsInWindow(RUN, 1, NOW); // 1h window: only the last
ok(old.length === 1 && old[0].to === "burned-out",
  "window filter keeps only recent transitions");

// ---- summarize: the whole-store board ----
var sum = L.summarize({ hot: RUN, flat: flat3 }, NOW);
ok(sum.counts["burned-out"] === 1 && sum.counts.steady === 1,
  "summarize counts current stages");
ok(sum.ignitions.length === 1 && sum.ignitions[0].id === "hot" &&
   sum.ignitions[0].to === "igniting",
  "summarize routes igniting transitions to the ignitions board");
ok(sum.burnouts.length === 2 && sum.burnouts[0].to === "burned-out",
  "summarize routes cooling/burned-out transitions to the burnouts board");
ok(sum.topics.hot.ribbon.length === 12 &&
   sum.topics.hot.ribbon[11] === "burned-out",
  "summarize carries a per-topic stage ribbon");
ok(sum.topics.flat.stage === "steady", "summarize carries per-topic stage");

console.log("lifecycle: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
