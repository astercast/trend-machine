/* ============================================================
   TREND MACHINE — test_warroom.js (wave 15)
   Pinned-fixture unit tests for assets/js/warroom-lib.js.
   Run: node scripts/test_warroom.js   (exit 0 = all pass)
   ============================================================ */
"use strict";
var W = require("../assets/js/warroom-lib.js");

var passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error("FAIL: " + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }

// ---- projectVelocity ----
ok(W.projectVelocity(90, 2, -1, 0) === 90, "proj t=0 is v0");
ok(approx(W.projectVelocity(90, 2, -1, 2), 92), "proj rising parabola");
ok(approx(W.projectVelocity(90, 2, -1, 4), 90), "proj crests back");
ok(W.projectVelocity(5, -3, 0, 3) === 0, "proj clamps negative to 0");
ok(W.projectVelocity(70, -1.5, 0, 48) === 0, "proj long fall clamps to 0");

// ---- peakAt (same estimate as trajectory.js) ----
ok(approx(W.peakAt(2, -1), 2), "peakAt rising+decel");
ok(W.peakAt(0, -1) === null, "peakAt no peak when slope<=0");
ok(W.peakAt(2, 1) === null, "peakAt no peak when accel>=0");
ok(W.peakAt(-2, -1) === null, "peakAt no peak when falling");

// ---- xPct / yPct (logarithmic vertical) ----
ok(approx(W.xPct(0, -8, 48), 8 / 56 * 100), "xPct T+NOW");
ok(W.xPct(-8, -8, 48) === 0, "xPct left edge");
ok(W.xPct(48, -8, 48) === 100, "xPct right edge");
ok(W.yPct(0, 100) === 100, "yPct bottom");
ok(approx(W.yPct(100, 100), 0, 1e-6), "yPct top");
ok(approx(W.yPct(70, 100), 7.6, 0.1), "yPct ignition line on log scale");
ok(W.yPct(10, 100) > W.yPct(70, 100), "yPct log ordering (slower = lower)");

// ---- logTicks ----
var ticks = W.logTicks(11000);
ok(JSON.stringify(ticks) === "[10,100,1000,10000]", "logTicks nice values");
ok(W.logTicks(90).length === 1, "logTicks under 100");

// ---- contactGeometry (pinned fixture) ----
var nowMs = Date.parse("2026-10-12T07:00:00Z");
var contact = { id: "ramalama-walk", latest_velocity: 90,
                slope_per_hour: 0.75, accel: -2.91, peak_in_hours: 0.3,
                state: "peaking" };
var past = [
  ["2026-10-12T00:00:00Z", 81, 81],
  ["2026-10-12T07:00:00Z", 90, 90]
];
var g = W.contactGeometry(contact, past, nowMs);
ok(g.past.length === 2, "geometry keeps 2 past points");
ok(approx(g.past[0].h, -7), "geometry past hour offset");
ok(g.past[0].v === 81, "geometry past velocity");
ok(g.proj.length < 17 && g.proj[g.proj.length - 1].v === 0,
   "geometry truncates the diving projection at the floor");
ok(g.proj[0].v === 90, "geometry proj starts at v0");
ok(g.peak !== null && approx(g.peak.h, 0.3), "geometry peak at 0.3h");
ok(approx(g.peak.v, W.projectVelocity(90, 0.75, -2.91, 0.3)), "geometry peak v on parabola");
ok(g.cur.h === 0 && g.cur.v === 90, "geometry current point");

// bad timestamps are dropped, not plotted
var g2 = W.contactGeometry(contact, [["not-a-date", 50, 50]], nowMs);
ok(g2.past.length === 0, "geometry drops unparsable timestamps");

// peak outside the window is not marked
var c3 = { id: "x", latest_velocity: 50, slope_per_hour: 1, accel: -1,
           peak_in_hours: 99, state: "peaking" };
ok(W.contactGeometry(c3, [], nowMs).peak === null, "geometry ignores out-of-window peak");

// projection truncates at the floor instead of drawing a fake flat tail
var dive = { id: "d", latest_velocity: 90, slope_per_hour: 0.75, accel: -2.91,
             peak_in_hours: 0.3, state: "peaking" };
var gd = W.contactGeometry(dive, [], nowMs);
ok(gd.proj.length < 17 && gd.proj[gd.proj.length - 1].v === 0,
   "geometry truncates projection at first zero (" + gd.proj.length + " pts)");
var climb = { id: "u", latest_velocity: 70, slope_per_hour: 5, accel: 0,
              peak_in_hours: Infinity, state: "rising" };
var gu = W.contactGeometry(climb, [], nowMs);
ok(gu.proj.length === 17, "geometry keeps full projection when never zero");

// ---- theatreScales ----
var geoms = [g, W.contactGeometry(
  { id: "y", latest_velocity: 40, slope_per_hour: 5, accel: 0,
    peak_in_hours: Infinity, state: "rising" }, [], nowMs)];
var sc = W.theatreScales(geoms);
ok(sc.xMin === -8, "scales xMin floors past span (" + sc.xMin + ")");
ok(sc.xMax === 48, "scales xMax is the horizon");
ok(sc.vMax >= 90 && sc.vMax % 10 === 0, "scales vMax covers data, nice-rounded");

// ---- countdown ----
ok(W.countdown(0) === "due now", "countdown zero");
ok(W.countdown(30 * 60000) === "under an hour", "countdown sub-hour");
ok(W.countdown(5 * 3600000) === "~5h", "countdown hours");
ok(W.countdown(60 * 3600000) === "~2d 12h", "countdown days");

// ---- resolutionDays ----
var recs = [
  { forecast_at: "2026-10-12T01:45:28.760Z" },
  { forecast_at: "2026-10-12T06:59:57.558Z" },
  { forecast_at: "not-a-date" }
];
var days = W.resolutionDays(recs, 48);
ok(days.length === 1 && days[0].date === "2026-10-14" && days[0].pending === 2,
   "resolutionDays groups 48h windows by close day, drops bad dates");

console.log("warroom: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
