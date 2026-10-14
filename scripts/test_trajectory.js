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

// 5b. wave 9: flat low-velocity series must NOT read as fading.
// Regression: floating-point noise (-1e-14 slope) used to trip the
// "s < 0 && vel < 50" branch and mislabel steady topics as cooling off.
a = T.analyze(series([47, 47, 47, 47, 47]));
ok(a.state === "steady", "flat 47s -> steady (not fading)", a.state);
ok(a.slopePerHour === 0, "flat series slope snaps to exactly 0", a.slopePerHour);

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

console.log("== wave 6: confidence basis ==");
// High: 6+ snapshots, consistent trend (R^2 >= 0.6)
a = T.analyze(series([30, 36, 44, 54, 66, 80]));
let c = T.confidence(series([30, 36, 44, 54, 66, 80]), a);
ok(c.level === "high", "6 consistent snapshots -> high", c);
ok(c.n === 6, "n reflects real snapshot count", c.n);
ok(c.r2 >= 0.6, "r2 high on a consistent climb", c.r2);
ok(c.basis.indexOf("6 snapshots") >= 0, "basis names the evidence volume", c.basis);
// Low: wobbly fit with few snapshots
a = T.analyze(series([40, 70, 45, 75, 42]));
c = T.confidence(series([40, 70, 45, 75, 42]), a);
ok(c.level === "low", "wobbly 5-snapshot fit -> low", c);
// Flat series: steady call on barely-moving velocity is real confidence
a = T.analyze(series([55, 56, 55, 56, 55, 56]));
c = T.confidence(series([55, 56, 55, 56, 55, 56]), a);
ok(c.level === "high", "6 flat snapshots -> high (steady is consistent)", c);
ok(c.basis.indexOf("barely moves") >= 0, "flat basis says what it is", c.basis);
// Insufficient: honest, never inflated
a = T.analyze(series([50, 55]));
c = T.confidence(series([50, 55]), a);
ok(c.level === "low" && c.n === 2, "2 snapshots -> low, n=2", c);
ok(/fewer than 3 snapshots/.test(c.basis), "insufficient basis is explicit", c.basis);

console.log("== wave 6: signal attribution ==");
const NOW = Date.UTC(2026, 9, 11, 20);
// accelerating topic: drivers name the exact thresholds that fired
let pts = series([30, 33, 38, 45, 54, 65]);
a = T.analyze(pts);
let s = T.signals(a, pts, { platforms: ["tiktok", "youtube", "x"] }, NOW);
ok(s.velocity_delta === 35, "velocity_delta = last - first in window", s.velocity_delta);
ok(s.slope_per_hour > 1.5, "slope reported", s.slope_per_hour);
ok(s.platform_spread === 3, "platform_spread counts topic platforms", s.platform_spread);
ok(s.platforms.join(",") === "tiktok,youtube,x", "platform list passed through", s.platforms);
ok(s.drivers.length === 2 && /rising threshold/.test(s.drivers[0]) &&
   /accelerating threshold/.test(s.drivers[1]),
   "accelerating drivers name both fired thresholds", s.drivers);
// recency: 3h since the last snapshot (series 12:00..17:00, NOW 20:00)
ok(Math.abs(s.recency_hours - 3) < 0.01, "recency_hours = now - last snapshot", s.recency_hours);
// peaking topic: drivers cite the hot tier + deceleration
pts = series([70, 80, 86, 88, 87]);
a = T.analyze(pts);
s = T.signals(a, pts, { platforms: ["youtube"] }, NOW);
ok(a.state === "peaking", "stub still classifies peaking", a.state);
ok(/hot tier/.test(s.drivers[0]) && /decelerating/.test(s.drivers[1]),
   "peaking drivers cite hot tier + deceleration", s.drivers);
ok(s.platform_spread === 1, "single-platform spread reported honestly", s.platform_spread);
// steady topic: drivers say no threshold fired (not invented)
pts = series([55, 56, 55, 56, 55, 56]);
a = T.analyze(pts);
s = T.signals(a, pts, { platforms: ["x"] }, NOW);
ok(/no motion threshold fired/.test(s.drivers[0]), "steady drivers admit no signal", s.drivers);
// topic without platform data: spread 0, no crash
s = T.signals(a, pts, {}, NOW);
ok(s.platform_spread === 0 && s.platforms.length === 0,
   "missing platforms -> spread 0, not invented", s);

console.log("== wave 6: per-platform trajectories ==");
const pp = {
  tiktok: series([20, 30, 45, 60]),
  youtube: series([50, 51, 50, 52]),
  x: series([40, 42]) // too thin -> honest insufficient
};
const per = T.platformTrajectories(pp);
ok(per.tiktok.state === "accelerating", "tiktok platform classified on its own series", per.tiktok.state);
ok(per.youtube.state === "steady", "youtube platform steady on its own series", per.youtube.state);
ok(per.x.state === "insufficient" && per.x.n === 2,
   "thin platform -> insufficient, honestly labeled", per.x);
ok(per.tiktok.n === 4 && typeof per.tiktok.slope_per_hour === "number",
   "per-platform records carry n + slope", per.tiktok);
// enrich() bundles everything; missing platform_points -> empty object, no crash
const en = T.enrich({ id: "e", title: "E", platforms: ["tiktok"] }, series([40, 45, 50, 55, 60, 65]), NOW);
ok(en.analysis.state === "rising" && en.confidence.level && en.signals.velocity_delta === 25,
   "enrich returns analysis + confidence + signals", { state: en.analysis.state, conf: en.confidence.level, delta: en.signals.velocity_delta });
ok(Object.keys(en.per_platform).length === 0, "no platform_points -> empty per_platform", en.per_platform);

console.log("== wave 7: trend-type pacing in the launch planner ==");
const baseP = {
  title: "T", id: "t", category: "meme", opportunity: 92, velocity: 92,
  angles: ["Angle A", "Angle B", "Angle C"],
  hooks: ["Hook 1", "Hook 2"],
  hashtags: ["#a", "#b"], format_tags: ["dance"],
  platforms: ["tiktok"]
};
let fmtPlan = L.buildPlan(Object.assign({}, baseP, { trend_type: "format" }));
ok(fmtPlan.ok && fmtPlan.meta.trend_type === "format", "format trend_type passes through to plan meta", fmtPlan.meta.trend_type);
ok(fmtPlan.rationale.some(r => /format trend/.test(r) && /Days 1 to 3/.test(r)),
   "format pacing: canonical format early, twist later", fmtPlan.rationale.length);
let mixPlan = L.buildPlan(Object.assign({}, baseP, { trend_type: "format+topic" }));
ok(mixPlan.rationale.some(r => /format\+topic trend/.test(r) && /Days 1 to 2/.test(r)),
   "format+topic pacing: template early, subject coverage later", 1);
let topPlan = L.buildPlan(Object.assign({}, baseP, { trend_type: "topic" }));
ok(topPlan.rationale.some(r => /topic trend/.test(r) && /fresh each day/.test(r)),
   "topic pacing: fresh coverage daily", 1);
// missing trend_type -> defaults to topic pacing (never crashes)
let defPlan = L.buildPlan(baseP);
ok(defPlan.ok && defPlan.meta.trend_type === "topic" &&
   defPlan.rationale.some(r => /topic trend/.test(r)),
   "missing trend_type defaults to topic", defPlan.meta.trend_type);
// wave 7 fix: raw dossiers carry opportunity_score, not opportunity —
 // the planner must not score every plan 0
let rawDossier = Object.assign({}, baseP, { opportunity_score: 85 });
delete rawDossier.opportunity;
let rawPlan = L.buildPlan(rawDossier);
ok(rawPlan.ok && rawPlan.meta.opportunity === 85,
   "raw dossier opportunity_score maps to plan opportunity", rawPlan.meta.opportunity);
ok(rawPlan.rationale.some(r => /85\/100 is strike-now/.test(r)),
   "strike-now pacing fires on opportunity_score >= 70", 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);