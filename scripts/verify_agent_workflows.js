/* ============================================================
   TREND MACHINE — verify_agent_workflows.js (wave 5, wave 7: passes trend_type)
   Executes the 3 end-to-end workflows from AGENT.md against the
   REAL local api/v1 JSON files and asserts they work.

   Run: node scripts/verify_agent_workflows.js
   Exit 0 = all three workflows proven working.
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const API = path.join(__dirname, "..", "api", "v1");
const read = p => JSON.parse(fs.readFileSync(p, "utf8"));

let failed = 0;
function assert(cond, name, extra) {
  if (cond) { console.log("  ok -", name); }
  else { failed++; console.log("  FAIL -", name, extra === undefined ? "" : JSON.stringify(extra).slice(0, 200)); }
}

console.log("== Workflow 1: easiest trend to remix today ==");
const flat = read(path.join(API, "trends.flat.json"));
assert(flat.sample === false, "flat feed is the live one (sample:false)");
const top = flat.trends[0];
const opps = flat.trends.map(t => t.opportunity_score);
assert(opps.every((o, i) => i === 0 || o <= opps[i - 1]), "flat feed sorted by opportunity desc");
const dossiers = read(path.join(API, "trends.json"));
const staleIds = new Set(dossiers.topics.filter(t => t.stale).map(t => t.id));
assert(!staleIds.has(top.id), "top pick is not stale", top.id);
const dossier = dossiers.topics.find(t => t.id === top.id);
assert(!!dossier, "top pick enriches to a full dossier");
assert(dossier.angles.length > 0 && dossier.hooks.length > 0, "dossier has angles + hooks",
  { angles: dossier.angles.length, hooks: dossier.hooks.length });
console.log("   remix recipe: \"" + dossier.title + "\" | angle: \"" +
  dossier.angles[0].slice(0, 60) + "\" | hook: \"" + dossier.hooks[0] + "\" | " +
  dossier.hashtags.slice(0, 3).join(" "));

console.log("== Workflow 2: Ramalama 7-day battle plan ==");
const ramalama = dossiers.topics.find(t => t.id === "ramalama-walk");
assert(!!ramalama, "ramalama-walk dossier found");
const L = require("../assets/js/launch-plan-lib.js");
const payload = {
  title: ramalama.title, id: ramalama.id, category: ramalama.category,
  opportunity: ramalama.opportunity_score, velocity: ramalama.velocity,
  angles: ramalama.angles, hooks: ramalama.hooks, hashtags: ramalama.hashtags,
  platforms: ramalama.platforms, format_tags: ramalama.format_tags,
  trend_type: ramalama.trend_type
};
const plan = L.buildPlan(payload, null);
assert(plan.ok === true, "plan built", plan.reason);
assert(plan.days.length === 7, "plan has 7 days");
let invented = 0;
plan.days.forEach(d => {
  if (!ramalama.angles.includes(d.angle)) invented++;
  if (d.hook && !ramalama.hooks.includes(d.hook)) invented++;
  d.hashtags.forEach(h => { if (!ramalama.hashtags.includes(h)) invented++; });
  if (!ramalama.platforms.includes(d.platform)) invented++;
});
assert(invented === 0, "nothing invented — every angle/hook/hashtag/platform from the dossier");
assert(plan.days[0].day === 1 && plan.days[6].day === 7, "days 1..7 in order");
console.log("   day 1: \"" + plan.days[0].angle.slice(0, 50) + "\" / \"" + plan.days[0].hook + "\"");
console.log("   day 7: \"" + plan.days[6].angle.slice(0, 50) + "\" / \"" + plan.days[6].hook + "\"");

console.log("== Workflow 3: peaking in the next 48h ==");
const fcPath = path.join(API, "forecasts.json");
assert(fs.existsSync(fcPath), "forecasts.json exists");
if (fs.existsSync(fcPath)) {
  const fc = read(fcPath);
  assert(Array.isArray(fc.peaking_48h), "peaking_48h list present");
  assert(typeof fc.counts.insufficient === "number", "counts.insufficient present");
  const honest = fc.peaking_48h.concat(fc.rising_fast, fc.cooling_off, fc.steady)
    .every(r => /not a guarantee/.test(r.label));
  assert(honest, "every forecast carries the honest label");
  const inWindow = fc.peaking_48h.every(r => r.peak_in_hours === null || r.peak_in_hours <= 48);
  assert(inWindow, "peaking list within the 48h window");
  // Independent recompute: classify velocity.json with the real classifier
  // and confirm the same topics land in the peaking bucket.
  const T = require("../assets/js/trajectory.js");
  const hist = read(path.join(API, "velocity.json"));
  const recomputed = Object.keys(hist).filter(id => {
    const a = T.analyze(hist[id]);
    return a.state === "peaking" && a.peakInHours <= T.PEAK_WINDOW_H;
  });
  const served = new Set(fc.peaking_48h.map(r => r.id));
  const match = recomputed.every(id => served.has(id)) &&
                fc.peaking_48h.every(r => recomputed.includes(r.id));
  assert(match, "forecasts.json matches an independent trajectory.js recompute",
    { recomputed: recomputed.length, served: fc.peaking_48h.length });
  console.log("   peaking_48h=" + fc.peaking_48h.length +
    " rising=" + fc.rising_fast.length +
    " cooling=" + fc.cooling_off.length +
    " insufficient=" + fc.counts.insufficient);
}

console.log(failed ? "\nRESULT: " + failed + " FAILURES" : "\nRESULT: all 3 workflows proven working");
process.exit(failed ? 1 : 0);
