/* ============================================================
   TREND MACHINE — unit tests for launch-plan-lib wave-10
   (battle plans, platform tips, exports, forecast-ledger hooks)
   Run: node scripts/test_launch_battle.js
   Pinned fixtures — no network, no real data.
   ============================================================ */
"use strict";
const L = require("../assets/js/launch-plan-lib.js");

let passed = 0, failed = 0;
function ok(cond, name, extra) {
  if (cond) { passed++; console.log("  ok -", name); }
  else { failed++; console.log("  FAIL -", name, extra === undefined ? "" : JSON.stringify(extra)); }
}

function mkTopic(id, opp, extra) {
  const t = {
    title: "Topic " + id, id: id, category: "meme",
    opportunity_score: opp, velocity: opp,
    angles: [id + " angle A", id + " angle B", id + " angle C"],
    hooks: [id + " hook 1", id + " hook 2"],
    hashtags: ["#" + id + "a", "#" + id + "b"],
    format_tags: ["dance"], platforms: ["tiktok"],
    trend_type: "topic"
  };
  return Object.assign(t, extra || {});
}
const risingTraj = { state: "rising", n: 12, summary: "rising" };
const peakingTraj = { state: "peaking", n: 8, summary: "peaking" };
const thinTraj = { state: "insufficient", n: 2, summary: "insufficient" };

console.log("== wave 10: platformTip ==");
let tip = L.platformTip("tiktok");
ok(tip && /completion/.test(tip.tip) && tip.source === "algorithms.html#tt",
   "tiktok tip restates sourced mechanics with attribution", tip);
tip = L.platformTip("YouTube");
ok(tip && /Oct 1, 2026/.test(tip.tip) && tip.source === "algorithms.html#yt",
   "platform matching is case-insensitive", tip);
tip = L.platformTip("instagram");
ok(tip && /Sends per reach/.test(tip.tip) && tip.source === "algorithms.html#ig",
   "instagram tip cites sends-per-reach research", tip);
ok(L.platformTip("x") === null && L.platformTip("") === null &&
   L.platformTip("threads") === null,
   "platforms without research get null, never invented tips",
   L.platformTip("x"));

console.log("== wave 10: buildBattlePlan ==");
const A = mkTopic("alpha", 92);
const B = mkTopic("beta", 74);
const C = mkTopic("gamma", 60);

let battle = L.buildBattlePlan(
  [{ topic: A, trajectory: risingTraj }, { topic: B, trajectory: peakingTraj }]
);
ok(battle.ok && battle.type === "battle", "battle plan builds for 2 topics", battle.ok);
ok(battle.days.length === 7, "7 battle days", battle.days.length);
// No adjacent days share a lead topic
let leadDup = battle.days.slice(1).some((d, i) => d.topicId === battle.days[i].topicId);
ok(!leadDup, "no adjacent-day lead repeat", battle.days.map(d => d.topicId));
// Lead order: strongest opportunity opens the week
ok(battle.days[0].topicId === "alpha" && battle.days[1].topicId === "beta",
   "opportunity-desc lead order (alpha 92 > beta 74)",
   battle.days.slice(0, 2).map(d => d.topicId));
// Each topic's k-th appearance runs its own plan's k-th day
let aDays = battle.days.filter(d => d.topicId === "alpha");
ok(aDays.length === 4 && aDays[0].postNo === 1 && aDays[3].postNo === 4,
   "alpha posts 4x, postNo 1..4", aDays.map(d => d.postNo));
let singleA = L.buildPlan(A, risingTraj);
ok(aDays[0].angle === singleA.days[0].angle && aDays[2].angle === singleA.days[2].angle,
   "battle slots match the topic's own 7-day plan days", aDays[0].angle);
// Nothing invented: every battle angle/hook/hashtag lives in one of the dossiers
let allOk = battle.days.every(d => {
  const src = d.topicId === "alpha" ? A : B;
  return src.angles.includes(d.angle) && src.hooks.includes(d.hook) &&
         d.hashtags.every(h => src.hashtags.includes(h));
});
ok(allOk, "battle plan uses only dossier angles/hooks/hashtags");
// Every day carries provenance + a platform tip (tiktok has research)
ok(battle.days.every(d => typeof d.provenance === "string" &&
                          /from the dossier/.test(d.provenance) &&
                          /trajectory (rising|peaking)/.test(d.provenance)),
   "every day carries data provenance with real trajectory state",
   battle.days[0].provenance);
ok(battle.days.every(d => d.platformTip && /completion/.test(d.platformTip.tip)),
   "tiktok days carry the sourced timing tip");
// Dates advance one day at a time
let dates = battle.days.map(d => d.date);
ok(new Set(dates).size === 7, "7 distinct calendar dates", dates);

// Three topics: rotation, no adjacent repeats, each own pacing kept
let b3 = L.buildBattlePlan([
  { topic: A, trajectory: risingTraj },
  { topic: B, trajectory: peakingTraj },
  { topic: C, trajectory: thinTraj }
]);
ok(b3.ok, "3-topic battle builds", b3.ok);
let dup3 = b3.days.slice(1).some((d, i) => d.topicId === b3.days[i].topicId);
ok(!dup3, "3-topic rotation has no adjacent lead repeat", b3.days.map(d => d.topicId));
ok(b3.days.filter(d => d.topicId === "gamma").every(d => /warming up/.test(d.provenance)),
   "thin-trajectory topic honestly labeled 'warming up'", 1);
ok(b3.rationale.some(r => /Lead order/ && /alpha/ && /beta/ && /gamma/.test(r)),
   "rationale explains lead order", b3.rationale.length);

// Guardrails
let one = L.buildBattlePlan([{ topic: A, trajectory: risingTraj }]);
ok(!one.ok && /at least two/.test(one.reason), "1 topic -> honest refusal", one.reason);
let many = L.buildBattlePlan([0, 1, 2, 3, 4, 5].map(i => ({ topic: mkTopic("t" + i, 50) })));
ok(!many.ok && /cap at 5/.test(many.reason), "6 topics -> cap refusal", many.reason);
let thinTopic = Object.assign(mkTopic("thin", 80), { angles: [] });
let refused = L.buildBattlePlan([
  { topic: A, trajectory: risingTraj }, { topic: thinTopic, trajectory: thinTraj }
]);
ok(!refused.ok && /thin/.test(refused.reason), "topic without angles fails honestly, named", refused.reason);

console.log("== wave 10: single-plan wave-10 fields ==");
let single = L.buildPlan(A, risingTraj);
ok(single.type === "single", "buildPlan marks type=single", single.type);
ok(single.days[0].platformTip && single.days[0].provenance &&
   single.days[0].trajectory.state === "rising",
   "single-plan days carry tip + provenance + trajectory", single.days[0].trajectory);
ok(single.meta.trajectory.state === "rising" && single.meta.ledger_ref === null,
   "meta carries trajectory; ledger_ref defaults null for the page to fill",
   single.meta.trajectory);
// Backward compat: planToText output shape unchanged
let txt = L.planToText(single);
ok(/7-DAY BATTLE PLAN: TOPIC ALPHA/.test(txt) && /OPPORTUNITY 92\/100/.test(txt),
   "planToText header unchanged", txt.slice(0, 60));

console.log("== wave 10: findLedgerRef ==");
const ledger = [
  { topic_id: "alpha", state: "rising", forecast_at: "2026-10-11T01:00:00Z", latest_velocity: 80, resolved: null },
  { topic_id: "alpha", state: "peaking", forecast_at: "2026-10-12T01:00:00Z", latest_velocity: 92, resolved: null },
  { topic_id: "beta", state: "fading", forecast_at: "2026-10-12T01:00:00Z", latest_velocity: 40, resolved: true, hit: true }
];
let ref = L.findLedgerRef(ledger, "alpha");
ok(ref && ref.state === "peaking" && ref.forecast_at === "2026-10-12T01:00:00Z",
   "findLedgerRef picks the NEWEST record per topic", ref);
ref = L.findLedgerRef(ledger, "beta");
ok(ref && ref.resolved === true && ref.hit === true,
   "resolved records pass through resolved/hit", ref);
ok(L.findLedgerRef(ledger, "gamma") === null, "no record -> null, never invented", L.findLedgerRef(ledger, "gamma"));
ok(L.findLedgerRef(null, "alpha") === null, "missing ledger -> null, no crash", 1);
// Battle meta carries per-topic ledger refs
let bLedger = L.buildBattlePlan(
  [{ topic: A, trajectory: risingTraj }, { topic: B, trajectory: peakingTraj }], ledger
);
ok(bLedger.meta.topics[0].ledger_ref.state === "peaking" &&
   bLedger.meta.topics[1].ledger_ref.state === "fading",
   "battle meta links each topic to its ledger record",
   bLedger.meta.topics.map(t => t.ledger_ref && t.ledger_ref.state));

console.log("== wave 10: exports ==");
let btxt = L.battlePlanToText(battle);
ok(/TOPIC ALPHA × TOPIC BETA/.test(btxt) && /DAY 7/.test(btxt) &&
   /WHY THIS ORDER/.test(btxt) && /timing tip:/.test(btxt),
   "battlePlanToText covers both trends, all days, tips", btxt.slice(0, 80));
let md = L.planToMarkdown(battle);
ok(/^# 7-day battle plan:/m.test(md) && /## Day-by-day/.test(md) &&
   /_Provenance:_/.test(md) && /nothing invented/.test(md) &&
   /algorithms.html#tt/.test(md),
   "battle markdown: header, days, provenance, tips with source, honesty footer", 1);
let mdSingle = L.planToMarkdown(single);
ok(/^# 7-day battle plan: Topic alpha/m.test(mdSingle) && /Opportunity 92\/100/.test(mdSingle),
   "markdown works for single plans too", 1);
let snap = L.planSnapshot(battle);
ok(snap.tool === "trend-machine-launch-planner" && snap.wave === 10 &&
   snap.type === "battle" && typeof snap.generated_at === "string" &&
   snap.topics.length === 2 && snap.days.length === 7 &&
   snap.rationale.length > 0 && /projections/.test(snap.honesty),
   "planSnapshot is the plan-vs-reality hook object", snap.type);
ok(snap.topics[0].ledger_ref === null &&
   JSON.stringify(snap.days[0].trajectory).includes("rising"),
   "snapshot freezes trajectory state per day (no ledger passed here)", 1);
let snapSingle = L.planSnapshot(L.buildPlan(A, risingTraj));
ok(snapSingle.type === "single" && snapSingle.topics.length === 1 &&
   snapSingle.topics[0].opportunity === 92 && snapSingle.topics[0].velocity === 92,
   "single snapshot freezes opportunity + velocity for later comparison", 1);
ok(!L.planSnapshot({ ok: false, reason: "nope" }).ok, "snapshot of a failed plan fails honestly", 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
