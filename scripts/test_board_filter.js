#!/usr/bin/env node
/* trend-machine — wave 37: pinned-fixture tests for
   assets/js/board-filter-lib.js (dashboard phase filter + URL state).
   The honesty pins: an unclassified topic is "nocall", never guessed;
   an invalid value in a hand-edited link is dropped, never applied;
   the unfiltered board serializes to an empty query (clean URL).
   Run: node scripts/test_board_filter.js   (exit 0 = all pass) */
"use strict";
var B = require("../assets/js/board-filter-lib.js");

var FAILS = [];
function check(name, cond, detail) {
  if (cond) { console.log("  ok: " + name); }
  else { console.log("  FAIL: " + name + (detail ? " — " + detail : "")); FAILS.push(name); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

var FORECASTS = {
  counts: { peaking_48h: 1, rising_fast: 1, cooling_off: 1, steady: 2, insufficient: 1 },
  peaking_48h: [{ id: "alpha", state: "peaking" }],
  rising_fast: [{ id: "beta", state: "accelerating" }],
  cooling_off: [{ id: "gamma", state: "fading" }],
  steady: [{ id: "delta", state: "steady" }, { id: "epsilon", state: "steady" }]
};
var TOPICS = [{ id: "alpha" }, { id: "beta" }, { id: "gamma" },
              { id: "delta" }, { id: "epsilon" }, { id: "zeta" }];

console.log("board-filter: phase map");
var map = B.buildPhaseMap(FORECASTS);
check("peaking list maps to peaking", map.alpha === "peaking");
check("rising_fast list maps to rising", map.beta === "rising");
check("cooling_off list maps to fading", map.gamma === "fading");
check("steady list maps to steady", map.delta === "steady" && map.epsilon === "steady");
check("unclassified topic is nocall, never guessed", B.phaseOf(map, "zeta") === "nocall");
check("missing payload -> empty map, everything nocall",
  eq(B.buildPhaseMap(null), {}) && B.phaseOf(null, "alpha") === "nocall");
check("double-listed id: earlier (peaking) list wins",
  B.buildPhaseMap({ peaking_48h: [{ id: "x" }], steady: [{ id: "x" }] }).x === "peaking");

console.log("board-filter: matching + counts");
check("phase=all matches everything",
  TOPICS.every(function (t) { return B.matchesPhase(map, t.id, "all"); }));
check("phase=peaking matches only the peaking topic",
  B.matchesPhase(map, "alpha", "peaking") && !B.matchesPhase(map, "delta", "peaking"));
check("phase=nocall matches only the unclassified topic",
  B.matchesPhase(map, "zeta", "nocall") && !B.matchesPhase(map, "alpha", "nocall"));
check("counts reconcile with the topic list",
  eq(B.phaseCounts(map, TOPICS), { peaking: 1, rising: 1, fading: 1, steady: 2, nocall: 1 }));

console.log("board-filter: options HTML");
var html = B.phaseOptionsHTML(B.phaseCounts(map, TOPICS));
check("options carry per-phase counts", html.indexOf("peaking in 48h (1)") >= 0 &&
  html.indexOf("no call yet (1)") >= 0);
check("options without counts carry no invented numbers",
  B.phaseOptionsHTML(null).indexOf("(") === -1);

console.log("board-filter: URL state");
check("empty search -> empty patch", eq(B.parseQuery(""), {}));
check("full link parses",
  eq(B.parseQuery("?phase=fading&platform=tiktok&category=meme&q=cat&sort=velocity&dir=1"),
     { phase: "fading", platform: "tiktok", category: "meme", q: "cat", sort: "velocity", dir: 1 }));
check("unknown phase dropped, never applied", eq(B.parseQuery("?phase=bogus"), {}));
check("unknown sort dropped (and its dir with it)", eq(B.parseQuery("?sort=size&dir=1"), {}));
check("explicit defaults are not state", eq(B.parseQuery("?phase=all&platform=all"), {}));
check("sort without dir defaults to descending",
  eq(B.parseQuery("?sort=recency"), { sort: "recency", dir: -1 }));
check("default state serializes to a clean (empty) query",
  B.toQuery({ phase: "all", platform: "all", category: "all", q: "", sort: "opportunity", dir: -1 }) === "");
check("filtered state serializes",
  B.toQuery({ phase: "peaking", platform: "all", category: "all", q: "", sort: "opportunity", dir: -1 }) === "phase=peaking");
check("non-default sort carries its direction",
  B.toQuery({ phase: "all", platform: "all", category: "all", q: "", sort: "velocity", dir: 1 }) === "sort=velocity&dir=1");
check("default sort flipped ascending still serializes",
  B.toQuery({ phase: "all", platform: "all", category: "all", q: "", sort: "opportunity", dir: 1 }) === "sort=opportunity&dir=1");
check("round-trip: parse(serialize(state)) restores the state",
  eq(B.parseQuery("?" + B.toQuery({ phase: "steady", platform: "tiktok", category: "all", q: "cat", sort: "recency", dir: -1 })),
     { phase: "steady", platform: "tiktok", q: "cat", sort: "recency", dir: -1 }));

console.log("board-filter: " + (FAILS.length ? FAILS.length + " FAILURES" : "all pass"));
process.exit(FAILS.length ? 1 : 0);
