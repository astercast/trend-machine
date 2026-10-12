/* ============================================================
   TREND MACHINE — check_resolutions.js (wave 14 · ledger health)
   The resolution-check workflow, run on demand:

     node scripts/check_resolutions.js [--dry-run]

   Re-checks every unresolved forecast in data/forecast_ledger.json
   against the merged velocity history (data/velocity_history.json +
   data/velocity_archive.json — wave 18: the archive holds series of
   topics that left the store before their horizon) and resolves
   honestly: hit / miss / unverifiable (see resolution-lib.js for the
   rules). Already-resolved and not-yet-due entries are never touched.

   Every resolution is recorded with its evidence in
   data/forecast_ledger.json (entry.resolved), and a summary prints to
   stdout so the wave log can cite exact numbers.

   --dry-run: classify only, write nothing.

   Resolution-night rehearsal (wave 18):
     node scripts/check_resolutions.js --dry-run --at <ISO time>
       [--ledger <path>] [--history <path>] [--archive <path>]
   --at classifies as if it were that moment, so the night can be
   rehearsed before it happens. It REQUIRES --dry-run: a rehearsal
   clock must never write a verdict (a run with --at and no --dry-run
   exits with an error). Rehearsal verdicts are mechanics proof only —
   the window's later snapshots don't exist yet at rehearsal time, so
   real verdicts on the night can differ. Path overrides exist so a
   rehearsal can run against copies in a scratch directory.
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LEDGER_FILE = path.join(ROOT, "data", "forecast_ledger.json");
const HIST_FILE = path.join(ROOT, "data", "velocity_history.json");
const ARCHIVE_FILE = path.join(ROOT, "data", "velocity_archive.json");

const T = require("../assets/js/trajectory.js");
const R = require("./resolution-lib.js");

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { return fallback; }
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function main() {
  const dryRun = process.argv.indexOf("--dry-run") >= 0;
  const atArg = argValue("--at");
  let nowMs = Date.now();
  if (atArg !== null) {
    if (!dryRun) {
      console.error("[check-resolutions] ERROR: --at is rehearsal-only and " +
                    "requires --dry-run (a rehearsal clock never writes).");
      return 1;
    }
    nowMs = Date.parse(atArg);
    if (isNaN(nowMs)) {
      console.error("[check-resolutions] ERROR: --at value is not a valid " +
                    "timestamp: " + atArg);
      return 1;
    }
    console.log("[check-resolutions] REHEARSAL clock: " +
                new Date(nowMs).toISOString() +
                " (dry-run; verdicts are mechanics proof, not results)");
  }
  const ledgerFile = argValue("--ledger") || LEDGER_FILE;
  const histFile = argValue("--history") || HIST_FILE;
  const archiveFile = argValue("--archive") || ARCHIVE_FILE;
  const raw = readJSON(ledgerFile, null);
  if (!raw || !Array.isArray(raw.entries)) {
    console.error("[check-resolutions] ERROR: ledger unreadable: " + ledgerFile);
    process.exit(1);
  }
  const history = R.mergeHistory(readJSON(histFile, {}),
                                 readJSON(archiveFile, {}));
  const entries = raw.entries;
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
    fs.writeFileSync(ledgerFile, JSON.stringify({ entries: entries }, null, 2));
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
                  " coverage=" + r.evidence.window_coverage_hours + "h" +
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
              "ledger written: " + ledgerFile));
  return 0;
}

process.exit(main());
