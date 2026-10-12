/* ============================================================
   TREND MACHINE — unit tests for trajectory.js (wave 3)
   Run: node scripts/test_trajectory.js
   Uses stubbed hourly snapshot data — no network, no real data.
   ============================================================ */
"use strict";
const T = require("../assets/js/trajectory.js");
const L = require("../assets/js/launch-plan-lib.js");

let passed = 0, failed = 0;
function ok(cond, name, extra) {
  if (cond) { passed++; console.log("  ok -", name); }
  else { failed++; console.log("  FAIL -", name, extra === undefined ? "" : JSON.stringify(extra)); }
}

// Hourly stub helper: points = [[iso, velocity, opportunity], ...]
function series(vels, startHour) {
  const base = Date.UTC(2026, 9, 11, startHour || 12);
  return vels.map((v, i) => [
    new Date(base + i * 3600000).toISOString(), v, v
  ]);
}

console.log("== trajectory.analyze ==");

// 1. rising: steady climb
let a = T.analyze(series([40, 45, 50, 55, 60]));
ok(a.state === "rising", "steady climb -> rising", a.state);

// 2. accelerating: climb getting faster
a = T.analyze(series([30, 32, 36, 42, 50]));
ok(a.state === "accelerating", "climb picking up speed -> accelerating", a.state);

// 3. peaking: hot and topping out (decelerating)
a = T.analyze(series([70, 80, 86, 88, 87]));
ok(a.state === "peaking", "hot + decelerating -> peaking", a.state);
ok(a.peakInHours <= T.PEAK_WINDOW_H, "projected peak inside 48h window", a.peakInHours);

// 4. peaking: hot and already falling (crest behind us)
a = T.analyze(series([92, 94, 91, 84, 76]));
ok(a.state === "peaking", "hot + falling -> peaking (just crested)", a.state);
ok(a.peakInHours === 0, "crest behind us -> peakInHours 0", a.peakInHours);

// 5. fading: clear decline
a = T.analyze(series([80, 75, 68, 60, 52]));
ok(a.state === "fading", "decline -> fading", a.state);

// 6. insufficient: fewer than 3 snapshots
a = T.analyze(series([50, 55]));
ok(a.state === "insufficient", "2 snapshots -> insufficient", a.state);
ok(a.n === 2, "n reflects the real snapshot count", a.n);
a = T.analyze([]);
ok(a.state === "insufficient", "0 snapshots -> insufficient", a.state);

// 7. steady: barely moving
a = T.analyze(series([55, 56, 55, 56, 55]));
ok(a.state === "steady", "flat line -> steady", a.state);

console.log("== trajectory.rankLists ==");
// Build one topic per case and check bucketing + ordering.
const mk = (id, vels) => ({ topic: { id, title: id }, analysis: T.analyze(series(vels)) });
let lists = T.rankLists([
  mk("falling-hard", [80, 74, 66, 58, 50]),
  mk("falling-soft", [70, 68, 64, 61, 59]),
  mk("riser-a", [40, 48, 56, 64, 72]),
  mk("riser-b", [30, 33, 36, 39, 42]),
  mk("peak-top", [70, 80, 86, 88, 87]),
  mk("thin", [50, 55]),                       // insufficient -> excluded
  mk("flat", [55, 56, 55, 56, 55]),           // steady -> excluded
]);
ok(lists.peaking.length === 1 && lists.peaking[0].topic.id === "peak-top",
   "peaking bucket holds only the peaking topic",
   lists.peaking.map(r => r.topic.id));
ok(lists.rising.map(r => r.topic.id).join(",") === "riser-a,riser-b",
   "rising bucket ordered by rankKey (steeper first)",
   lists.rising.map(r => r.topic.id));
ok(lists.cooling.map(r => r.topic.id).join(",") === "falling-hard,falling-soft",
   "cooling bucket holds fading topics, steepest decline first",
   lists.cooling.map(r => r.topic.id));

console.log("== launch-plan rotation ==");
const p = {
  title: "T", id: "t", category: "meme", opportunity: 92, velocity: 92,
  angles: ["Angle A", "Angle B", "Angle C"],
  hooks: ["Hook 1", "Hook 2"],
  hashtags: ["#a", "#b", "#c", "#d"],
  format_tags: ["meme"],
  platforms: ["tiktok", "youtube"]
};
let plan = L.buildPlan(p);
ok(plan.ok, "plan builds when dossier has angles");
ok(plan.days.length === 7, "7-day plan", plan.days.length);
// No two adjacent days reuse the same angle until the pool is exhausted
let adjDup = plan.days.slice(1).some((d, i) => d.angle === plan.days[i].angle);
ok(!adjDup, "no adjacent-day angle repeat", plan.days.map(d => d.angle));
// Angle+hook combos unique across all 7 days — OR, when the dossier's
// pool is smaller than 7 (3 angles x 2 hooks = 6 pairings), the first
// repeat only happens after every pairing has aired once (round-robin).
let combos = plan.days.map(d => d.angle + "|" + d.hook);
let maxCombos = p.angles.length * p.hooks.length;
if (maxCombos >= 7) {
  ok(new Set(combos).size === 7, "every day is a unique angle+hook combo", combos);
} else {
  ok(new Set(combos).size === maxCombos,
     "all " + maxCombos + " angle+hook pairings air before any repeats", combos);
  ok(combos[6] === combos[0] && new Set(combos.slice(0, 6)).size === maxCombos,
     "day 7 restarts the cycle only after every pairing aired", combos);
}
// Nothing invented: every angle/hook/hashtag in the plan comes from the dossier
let allOk = plan.days.every(d =>
  p.angles.includes(d.angle) && p.hooks.includes(d.hook) &&
  d.hashtags.every(h => p.hashtags.includes(h)));
ok(allOk, "plan uses only dossier angles/hooks/hashtags");
ok(plan.rationale.length >= 3, "rationale lines present", plan.rationale.length);
// Empty-angles dossier -> honest refusal, not invented content
let thin = L.buildPlan({ title: "X", angles: [], hooks: [], hashtags: [], platforms: [] });
ok(!thin.ok, "dossier without angles -> plan refused honestly", thin.reason);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
