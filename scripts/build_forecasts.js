/* ============================================================
   TREND MACHINE — build_forecasts.js (wave 5 · Agent API)
   Precomputes the Oracle's trajectory forecasts as a static API
   endpoint so ANY agent can read them without running JS.

   Uses assets/js/trajectory.js directly (the same UMD classifier
   the oracle.html dashboard uses) — no reimplementation, no drift.

   Input : data/trends.json (titles), data/velocity_history.json
   Output: api/v1/forecasts.json
           + patches api/v1/index.json to add the forecasts entry
   Run   : node scripts/build_forecasts.js  (wired into pipeline/refresh.sh)
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HIST_FILE = path.join(ROOT, "data", "velocity_history.json");
const TRENDS_FILE = path.join(ROOT, "data", "trends.json");
const API = path.join(ROOT, "api", "v1");
const OUT = path.join(API, "forecasts.json");
const MANIFEST = path.join(API, "index.json");

const T = require("../assets/js/trajectory.js");

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function record(topicId, title, analysis) {
  return {
    id: topicId,
    title: title,
    state: analysis.state,
    n_snapshots: analysis.n,
    latest_velocity: analysis.latestVelocity,
    slope_per_hour: analysis.slopePerHour,
    accel: analysis.accel,
    // Infinity serializes to null — schema allows number|null, and
    // null honestly means "no peak projected inside the 48h window".
    peak_in_hours: isFinite(analysis.peakInHours) ? analysis.peakInHours : null,
    summary: analysis.summary,
    label: "Projection from " + analysis.n + " snapshot" +
           (analysis.n === 1 ? "" : "s") + " — not a guarantee."
  };
}

function main() {
  let history, store;
  try {
    history = readJSON(HIST_FILE);
    store = readJSON(TRENDS_FILE);
  } catch (e) {
    console.log("[forecasts] SKIP: data/trends.json or velocity history missing — run pipeline/refresh.sh first.");
    return;
  }
  const titles = {};
  (store.topics || []).forEach(t => { titles[t.id] = t.title; });

  const results = [];
  Object.keys(history).forEach(id => {
    const analysis = T.analyze(history[id]);
    results.push({ topic: { id: id, title: titles[id] || id }, analysis: analysis });
  });

  const lists = T.rankLists(results);

  const toRec = r => record(r.topic.id, r.topic.title, r.analysis);
  const steady = results
    .filter(r => r.analysis.state === "steady")
    .sort((a, b) => b.analysis.latestVelocity - a.analysis.latestVelocity)
    .map(toRec);

  const projections = {};
  results.forEach(r => {
    projections[r.topic.id] = record(r.topic.id, r.topic.title, r.analysis);
  });

  const insufficient = results.filter(r => r.analysis.state === "insufficient").length;

  const payload = {
    generated_at: new Date().toISOString(),
    method: "assets/js/trajectory.js analyze() + rankLists() — the same classifier as the oracle.html dashboard",
    honesty: "Every forecast is a projection from N real velocity snapshots, never a guarantee. " +
             "Topics with fewer than " + T.MIN_POINTS + " snapshots are excluded from the forecast lists.",
    counts: {
      peaking_48h: lists.peaking.length,
      rising_fast: lists.rising.length,
      cooling_off: lists.cooling.length,
      steady: steady.length,
      insufficient: insufficient
    },
    peaking_48h: lists.peaking.map(toRec),
    rising_fast: lists.rising.map(toRec),
    cooling_off: lists.cooling.map(toRec),
    steady: steady,
    projections: projections
  };

  fs.mkdirSync(API, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log("[forecasts] " + Object.keys(projections).length + " topics -> " + OUT +
              " (peaking=" + lists.peaking.length +
              " rising=" + lists.rising.length +
              " cooling=" + lists.cooling.length +
              " insufficient=" + insufficient + ")");

  // Patch the manifest so index.json stays accurate: add the forecasts
  // endpoint entry only when the file actually exists (honest by default).
  try {
    const manifest = readJSON(MANIFEST);
    manifest.endpoints.forecasts = {
      path: "api/v1/forecasts.json",
      description: "Oracle output: precomputed trajectory classifications (peaking_48h / rising_fast / cooling_off / steady) from the same classifier as the dashboard. Every forecast is a projection from N snapshots — never a guarantee.",
      schema: "api/v1/schema/forecasts.json",
      updated: payload.generated_at,
      records: Object.keys(projections).length,
      notes: "Topics with fewer than 3 snapshots are excluded from the lists (counts.insufficient)."
    };
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    console.log("[forecasts] api/v1/index.json patched with forecasts endpoint");
  } catch (e) {
    console.log("[forecasts] WARNING: could not patch manifest: " + e.message);
  }
}

main();
