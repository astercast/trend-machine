/* ============================================================
   TREND MACHINE — check_resolutions.js (wave 14 · ledger health)
   The resolution-check workflow, run on demand:

     node scripts/check_resolutions.js [--dry-run]

   Re-checks every unresolved forecast in data/forecast_ledger.json
   against current data/velocity_history.json and resolves honestly:
   hit / miss / unverifiable (see scripts/resolution-lib.js for the
   rules). Already-resolved and not-yet-due entries are never touched.

   Every resolution is recorded with its evidence in
   data/forecast_ledger.json (entry.resolved), and a summary prints to
   stdout so the wave log can cite exact numbers.

   --dry-run: classify only, write nothing.
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LEDGER_FILE = path.join(ROOT, "data", "forecast_ledger.json");
const HIST_FILE = path.join(ROOT, "data", "velocity_history.json");

const T = require("../assets/js/trajectory.js");
const R = require("./resolution-lib.js");

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { return fallback; }
}

function main() {
  const dryRun = process.argv.indexOf("--dry-run") >= 0;
  const raw = readJSON(LEDGER_FILE, null);
  if (!raw || !Array.isArray(raw.entries)) {
    console.error("[check-resolutions] ERROR: ledger unreadable: " + LEDGER_FILE);
    process.exit(1);
  }
  const history = readJSON(HIST_FILE, {});
  const entries = raw.entries;
  const nowMs = Date.now();
  const thresholds = { rise: T.RISE, fall: T.FALL };

  const counts = { checked: 0, hit: 0, miss: 0, unverifiable: 0,
                   pending: 0, already: 0 };
  const newlyResolved = [];

  entries.forEach(function (e) {
    const c = R.classifyResolution(e, history, nowMs, thresholds);
    counts.checked++;
    if (c.status === "already") { counts.already++; return; }
    if (c.status === "pending") {
      counts.pending++;
      return;
    }
    // terminal: hit / miss / unverifiable
    counts[c.verdict]++;
    newlyResolved.push({ topic_id: e.topic_id, title: e.title,
                         forecast_at: e.forecast_at, state: e.state,
                         verdict: c.verdict, reason: c.reason,
                         evidence: c.evidence });
    if (!dryRun) {
      R.resolveEntry(e, history, nowMs, thresholds);
    }
  });

  if (!dryRun) {
    fs.writeFileSync(LEDGER_FILE, JSON.stringify({ entries: entries }, null, 2));
  }

  // --- report: oldest unresolved first ---------------------------------
  const pendingList = entries
    .filter(function (e) { return !e.resolved; })
    .sort(function (a, b) { return Date.parse(a.forecast_at) - Date.parse(b.forecast_at); });
  console.log("[check-resolutions] " + (dryRun ? "DRY RUN — " : "") +
              "ledger entries: " + entries.length +
              ", already resolved: " + counts.already +
              ", pending: " + counts.pending +
              ", newly terminal: " + (counts.hit + counts.miss + counts.unverifiable) +
              " (hit=" + counts.hit + ", miss=" + counts.miss +
              ", unverifiable=" + counts.unverifiable + ")");
  if (newlyResolved.length) {
    console.log("[check-resolutions] newly resolved:");
    newlyResolved.forEach(function (r) {
      console.log("  " + r.verdict.toUpperCase() + "  " + r.topic_id +
                  "  (" + r.state + ", forecast " + r.forecast_at + ")");
      console.log("      reason: " + r.reason);
      console.log("      evidence: slope=" + r.evidence.actual_slope +
                  " end=" + r.evidence.actual_end_velocity +
                  " max=" + r.evidence.actual_max_velocity +
                  " n=" + r.evidence.n_actual_points +
                  " window=" + r.evidence.window_start + ".." + r.evidence.window_end);
    });
  }
  if (pendingList.length) {
    const oldest = pendingList[0];
    const dueAt = new Date(Date.parse(oldest.forecast_at) +
                           R.HORIZON_H * 3600000).toISOString();
    console.log("[check-resolutions] oldest unresolved: " + oldest.topic_id +
                " (forecast " + oldest.forecast_at + "), resolution due " + dueAt);
  } else {
    console.log("[check-resolutions] no unresolved entries remain.");
  }
  console.log("[check-resolutions] " + (dryRun ? "wrote nothing (--dry-run)" :
              "ledger written: " + LEDGER_FILE));
  return 0;
}

process.exit(main());
