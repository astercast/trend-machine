/* ============================================================
   TREND MACHINE — audit_batch2.js (wave 19 · second-batch prep)
   Live audit of the forecast ledger's second batch, run on demand:

     node scripts/audit_batch2.js

   Batch 1 (286 forecasts recorded 2026-10-12) proved the failure
   mode wave 18 fixed: a topic churns out of the store, its velocity
   series used to be deleted with it, and its forecast could only
   ever grade "unverifiable". This audit proves the fix holds for
   every forecast recorded from now on — batch 2 and later:

     1. No pending forecast is homeless: every pending topic's series
        lives in the live store, the resolution archive, or both.
        A topic in neither store is a lost window — hard failure.
     2. Window evidence is accumulating: per pending entry, the
        merged history (resolution-lib mergeHistory — the graders'
        own merge) already holds the actual snapshots its verdict
        will read. (Retirement 2026-10-13: the published readiness
        payload this used to cross-check against was retired with
        the prediction layer; the audit now reports its own count.)
     3. The archive obeys its retention: every archived topic still
        has a ledger entry inside the 7-day window, and no archived
        point is older than the 14-day history window. Anything else
        is a prune bug — hard failure.
     4. The batch-2 gate is stated, not assumed: the ledger records
        at most one open entry per topic per 24h
        (build_forecasts.js dedupe), so batch 2 opens topic-by-topic
        as each batch-1 entry ages past 24h, and only for topics the
        classifier still calls decisive at that refresh. The audit
        prints when the gate first opens.

   Read-only. Writes nothing, resolves nothing. Exit 0 = every
   invariant holds; exit 1 = a failure above (fix before resolution
   night, not during it).
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const R = require("./resolution-lib.js");

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { return fallback; }
}

function main() {
  const failures = [];
  const ledger = readJSON(path.join(ROOT, "data", "forecast_ledger.json"), null);
  const live = readJSON(path.join(ROOT, "data", "velocity_history.json"), {});
  const archive = readJSON(path.join(ROOT, "data", "velocity_archive.json"), {});
  if (!ledger || !Array.isArray(ledger.entries)) {
    console.error("[audit-batch2] ERROR: ledger unreadable");
    return 1;
  }
  const nowMs = Date.now();
  const merged = R.mergeHistory(live, archive);
  const pending = ledger.entries.filter(function (e) { return !e.resolved; });

  // 1) homeless check + store partition -----------------------------------
  const part = { liveOnly: 0, archiveOnly: 0, both: 0, neither: [] };
  pending.forEach(function (e) {
    const inLive = Object.prototype.hasOwnProperty.call(live, e.topic_id);
    const inArch = Object.prototype.hasOwnProperty.call(archive, e.topic_id);
    if (inLive && inArch) { part.both++; }
    else if (inLive) { part.liveOnly++; }
    else if (inArch) { part.archiveOnly++; }
    else { part.neither.push(e.topic_id); }
  });
  console.log("[audit-batch2] pending forecasts: " + pending.length +
              " (live store " + part.liveOnly + ", archive " + part.archiveOnly +
              ", both " + part.both + ", neither " + part.neither.length + ")");
  if (part.neither.length) {
    failures.push("homeless pending topics (series in neither store): " +
                  part.neither.slice(0, 5).join(", "));
  }

  // 2) window evidence so far, cross-checked against the payload ---------
  let sufficient = 0;
  const short = [];
  pending.forEach(function (e) {
    const n = R.actualsInWindow(e, merged)
      .filter(function (p) { return Date.parse(p[0]) <= nowMs; }).length;
    if (n >= 2) { sufficient++; }
    else { short.push({ topic_id: e.topic_id, in_window: n }); }
  });
  console.log("[audit-batch2] windows already holding 2+ actuals: " +
              sufficient + "/" + pending.length +
              " (" + Math.round((sufficient / pending.length) * 1000) / 10 + "%)");
  if (short.length) {
    console.log("[audit-batch2] honestly short so far (" + short.length + "): " +
                short.map(function (s) { return s.topic_id + "=" + s.in_window; })
                     .join(", "));
  }
  console.log("[audit-batch2] (readiness payload retired 2026-10-13 — " +
              "audit count above stands on its own)");

  // 3) archive retention ---------------------------------------------------
  const ledgerCutoff = nowMs - R.MAX_LEDGER_AGE_D * 24 * 3600000;
  const recentIds = new Set(ledger.entries
    .filter(function (e) { return Date.parse(e.forecast_at) >= ledgerCutoff; })
    .map(function (e) { return e.topic_id; }));
  const pointCutoff = nowMs - 14 * 24 * 3600000;
  const strayTopics = [];
  let strayPoints = 0, archivePoints = 0;
  Object.keys(archive).forEach(function (tid) {
    if (!recentIds.has(tid)) { strayTopics.push(tid); }
    (archive[tid] || []).forEach(function (p) {
      archivePoints++;
      if (Date.parse(p[0]) < pointCutoff) { strayPoints++; }
    });
  });
  console.log("[audit-batch2] archive: " + Object.keys(archive).length +
              " topics, " + archivePoints + " points; topics with no ledger " +
              "entry in the 7d window: " + strayTopics.length +
              "; points older than 14d: " + strayPoints);
  if (strayTopics.length) {
    failures.push("archive holds topics outside the 7d ledger window: " +
                  strayTopics.slice(0, 5).join(", "));
  }
  if (strayPoints) {
    failures.push("archive holds " + strayPoints + " points older than 14d");
  }

  // 4) batch-2 gate ----------------------------------------------------------
  let gateMs = null;
  pending.forEach(function (e) {
    const opens = Date.parse(e.forecast_at) + 24 * 3600000;
    if (gateMs === null || opens < gateMs) { gateMs = opens; }
  });
  console.log("[audit-batch2] batch-2 gate: first topics unlock at " +
              new Date(gateMs).toISOString() +
              " (24h dedupe, per topic)" +
              " — batch 2 forms gradually from the gate, it is not a " +
              "single drop, and a topic records only while decisive.");

  if (failures.length) {
    failures.forEach(function (f) { console.log("[audit-batch2] FAIL: " + f); });
    return 1;
  }
  console.log("[audit-batch2] ALL INVARIANTS HOLD");
  return 0;
}

process.exit(main());
