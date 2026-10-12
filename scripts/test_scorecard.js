#!/usr/bin/env node
/* trend-machine — wave 9: pinned-fixture tests for assets/js/scorecard-lib.js.
   The honesty contract: with <10 resolved, "building history" + no hit rate;
   with >=10, the measured rate shows. Pinned fixtures so a future edit that
   invents accuracy fails loudly.
   Run: node scripts/test_scorecard.js   (exit 0 = all pass) */
"use strict";
var S = require("../assets/js/scorecard-lib.js");

var FAILS = [];
function check(name, cond, detail) {
  if (cond) { console.log("  ok: " + name); }
  else { console.log("  FAIL: " + name + (detail ? " — " + detail : "")); FAILS.push(name); }
}

// --- fixtures ------------------------------------------------------------
// pre-resolution state, mirrored on the real ledger (222 recorded, 0 resolved)
var BUILDING = {
  generated_at: "2026-10-12T02:46:58.898Z",
  status: "building history",
  method: "Each refresh records the Oracle's decisive forecasts.",
  horizon_hours: 48,
  resolution_rules: {
    rising_accelerating: "hit if slope >= +1.5/hr",
    peaking: "hit if max <= forecast +2",
    fading: "hit if slope <= -1.5/hr"
  },
  counts: { recorded: 222, pending: 222, resolved: 0, hits: 0 },
  hit_rate: null,
  hit_rate_note: "The Oracle shows its own hit rate once 10 forecasts have resolved; currently 0 resolved.",
  by_state: {
    peaking: { resolved: 0, hits: 0 }, accelerating: { resolved: 0, hits: 0 },
    rising: { resolved: 0, hits: 0 }, fading: { resolved: 0, hits: 0 }
  },
  upcoming_resolutions: [
    { date: "2026-10-13", pending: 40 },
    { date: "2026-10-14", pending: 182 }
  ],
  recorded_per_day: [
    { date: "2026-10-11", recorded: 143 },
    { date: "2026-10-12", recorded: 79 }
  ],
  by_confidence: {
    high: { resolved: 0, hits: 0 }, medium: { resolved: 0, hits: 0 },
    low: { resolved: 0, hits: 0 }
  },
  recent: []
};

// live state: 15 resolved, 9 hits = 60%
var LIVE = {
  generated_at: "2026-10-15T02:00:00.000Z",
  status: "live",
  method: "Each refresh records the Oracle's decisive forecasts.",
  horizon_hours: 48,
  resolution_rules: {
    rising_accelerating: "hit if slope >= +1.5/hr",
    peaking: "hit if max <= forecast +2",
    fading: "hit if slope <= -1.5/hr"
  },
  counts: { recorded: 240, pending: 225, resolved: 15, hits: 9 },
  hit_rate: 0.6,
  hit_rate_note: "Hit rate across 15 resolved forecasts.",
  by_state: {
    peaking: { resolved: 6, hits: 4 }, accelerating: { resolved: 4, hits: 3 },
    rising: { resolved: 3, hits: 2 }, fading: { resolved: 2, hits: 0 }
  },
  upcoming_resolutions: [
    { date: "2026-10-15", pending: 120 },
    { date: "2026-10-16", pending: 105 }
  ],
  recorded_per_day: [
    { date: "2026-10-11", recorded: 143 },
    { date: "2026-10-12", recorded: 79 },
    { date: "2026-10-13", recorded: 18 }
  ],
  by_confidence: {
    high: { resolved: 12, hits: 9 }, medium: { resolved: 3, hits: 0 },
    low: { resolved: 0, hits: 0 }
  },
  recent: [
    { topic_id: "bow-bow-bow", title: "\"Bow Bow Bow\" — Zeddy Will's bend-and-bounce",
      forecast_at: "2026-10-13T01:00:00.000Z", state: "peaking", peak_in_hours: 0,
      verdict: "hit", actual_slope: -2.1, n_snapshots: 5 }
  ]
};

var FORECASTS = {
  generated_at: "2026-10-12T02:00:00.000Z",
  counts: { peaking_48h: 5, rising_fast: 3, cooling_off: 7, steady: 200, insufficient: 138 },
  peaking_48h: [
    { id: "bow-bow-bow", title: "\"Bow Bow Bow\" — Zeddy Will's bend-and-bounce", latest_velocity: 90 }
  ],
  rising_fast: [], cooling_off: [], steady: []
};

// --- honesty verdicts ------------------------------------------------------
var vb = S.verdict(BUILDING);
check("building: not live", vb.live === false);
check("building: honest", vb.honest === true);

var vl = S.verdict(LIVE);
check("live: is live", vl.live === true);
check("live: honest", vl.honest === true);

// a lying payload (status says live but no hit rate) is flagged dishonest
check("dishonest payload detected",
  S.verdict({ status: "live", hit_rate: 0.9, counts: { recorded: 5, pending: 5, resolved: 3, hits: 2 } }).honest === false);
check("premature rate (status building, rate present) detected",
  S.verdict({ status: "building history", hit_rate: 0.5, counts: { recorded: 12, pending: 2, resolved: 10, hits: 5 } }).honest === false);
check("null payload verdicts safe",
  S.verdict(null).live === false && S.verdict(null).honest === false);

// --- rendering --------------------------------------------------------------
var bannerBuilding = S.statusBannerHTML(BUILDING);
check("building banner says Building history", bannerBuilding.indexOf("Building history") > -1);
check("building banner names 222 recorded", bannerBuilding.indexOf("222") > -1);
check("building banner shows NO hit rate %", !/[0-9]+%/.test(bannerBuilding));

var bannerLive = S.statusBannerHTML(LIVE);
check("live banner shows 60%", bannerLive.indexOf("60%") > -1);
check("live banner names 15 resolved", bannerLive.indexOf("15 resolved") > -1);

var counts = S.countsHTML(BUILDING);
["Recorded", "Pending", "Resolved", "Hits"].forEach(function (w) {
  check("counts card: " + w, counts.indexOf(w) > -1);
});

var horizon = S.horizonTableHTML(BUILDING);
check("horizon table has 48h row", horizon.indexOf("48h") > -1);
check("horizon building: dash not 0%", horizon.indexOf("—") > -1);
check("horizon live: shows 60%", S.horizonTableHTML(LIVE).indexOf("60%") > -1);

var bycall = S.byCallHTML(BUILDING);
check("by-call: dash for unresolvable rate", bycall.indexOf("—") > -1);
check("by-call: never shows 0% as a rate",
  !/<td class="num">0%<\/td>/.test(bycall));

var recentEmpty = S.recentHTML(BUILDING);
check("recent empty: honest 'no forecasts have resolved yet'",
  recentEmpty.indexOf("No forecasts have resolved yet") > -1);
check("recent empty: names Oct 14, 2026", recentEmpty.indexOf("Oct 14, 2026") > -1);

var recentLive = S.recentHTML(LIVE);
check("recent live: renders the resolution row", recentLive.indexOf("bow-bow-bow") > -1);
check("recent live: verdict hit shown", recentLive.indexOf(">hit<") > -1);

var proj = S.projectionsHTML(FORECASTS);
check("projections: peaking count 5", proj.indexOf(">5<") > -1 || proj.indexOf(">5</") > -1);
check("projections: links back to oracle.html", proj.indexOf("oracle.html") > -1);
check("projections: top peak listed", proj.indexOf("Bow Bow Bow") > -1);

var projMissing = S.projectionsHTML(null);
check("projections: honest when forecasts.json missing",
  projMissing.indexOf("Forecasts unavailable") > -1);

var method = S.methodHTML(BUILDING);
check("method: lists all three resolution rules",
  method.indexOf("hit if slope &gt;= +1.5/hr") > -1 &&
  method.indexOf("hit if max &lt;= forecast +2") > -1 &&
  method.indexOf("hit if slope &lt;= -1.5/hr") > -1);

var page = S.pageHTML(BUILDING, FORECASTS);
check("full page: no invented hit rate",
  !/>[0-9]+%<\/td>/.test(page) && !/>[0-9]+%<\/strong>/.test(page) &&
  !/hit rate is <strong>[0-9]+%/.test(page));
check("full page: keeps the 'never 0%' honesty line",
  page.indexOf("never 0%") > -1);
check("full page: all sections present",
  page.indexOf("Current projections") > -1 &&
  page.indexOf("Per-horizon accuracy") > -1 &&
  page.indexOf("By call type") > -1 &&
  page.indexOf("Recent resolutions") > -1 &&
  page.indexOf("How resolutions are scored") > -1);

var tl = S.timelineHTML(BUILDING);
check("timeline: shows resolution days", tl.indexOf("2026-10-14") > -1 && tl.indexOf("182") > -1);
check("timeline: honest queue note", tl.indexOf("queue schedule, not a prediction") > -1);
check("timeline: empty is honest", S.timelineHTML(null).indexOf("No pending forecasts") > -1);

var act = S.activityHTML(BUILDING);
check("activity: shows recorded-per-day", act.indexOf("2026-10-11") > -1 && act.indexOf("143") > -1);
check("activity: empty is honest", S.activityHTML({}).indexOf("No recording activity yet") > -1);

var calB = S.calibrationHTML(BUILDING);
check("calibration pre-resolution: awaiting data rows", (calB.match(/>awaiting data<\/td>/g) || []).length === 3);
check("calibration pre-resolution: no invented rates", !/>[0-9]+%<\/td>/.test(calB));
var calL = S.calibrationHTML(LIVE);
check("calibration live: high shows 75%", calL.indexOf("75%") > -1);
check("calibration live: medium/low still awaiting", (calL.match(/>awaiting data<\/td>/g) || []).length === 2);

var page2 = S.pageHTML(BUILDING, FORECASTS);
check("full page v2: timeline + activity + calibration present",
  page2.indexOf("Resolution timeline") > -1 &&
  page2.indexOf("Ledger activity") > -1 &&
  page2.indexOf("Calibration") > -1);

if (FAILS.length) { console.log("\n" + FAILS.length + " FAILURES"); process.exit(1); }
console.log("\nall checks passed");
