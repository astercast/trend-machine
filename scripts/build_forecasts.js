/* ============================================================
   TREND MACHINE — build_forecasts.js (wave 5 · Agent API, wave 6 · Oracle 2.0)
   Precomputes the Oracle's trajectory forecasts as a static API
   endpoint so ANY agent can read them without running JS.

   Uses assets/js/trajectory.js directly (the same UMD classifier
   the oracle.html dashboard uses) — no reimplementation, no drift.

   Input : data/trends.json (titles/platforms), data/velocity_history.json,
           data/platform_velocity_history.json (wave 6)
   Output: data/v1/forecasts.json
           data/v1/forecast-accuracy.json (wave 6 — the Oracle's own
             forecast-vs-actual scorecard; labeled "building history"
             until >=10 forecasts resolve)
           data/forecast_ledger.json (append-only forecast record)
           + patches data/v1/index.json to add the forecasts and
             forecast-accuracy entries
   Run   : node scripts/build_forecasts.js  (wired into pipeline/refresh.sh)
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HIST_FILE = path.join(ROOT, "data", "velocity_history.json");
const PHIST_FILE = path.join(ROOT, "data", "platform_velocity_history.json");
const TRENDS_FILE = path.join(ROOT, "data", "trends.json");
const LEDGER_FILE = path.join(ROOT, "data", "forecast_ledger.json");
const API = path.join(ROOT, "data", "v1");
const OUT = path.join(API, "forecasts.json");
const ACC_OUT = path.join(API, "forecast-accuracy.json");
const LIFE_OUT = path.join(API, "lifecycle.json");
const MANIFEST = path.join(API, "index.json");

const T = require("../assets/js/trajectory.js");
const R = require("./resolution-lib.js"); // wave 14: shared resolution rules
                                          // (hit/miss/unverifiable + evidence)
const L = require("../assets/js/lifecycle-lib.js"); // wave 17: ignition/
                                          // burnout lifecycle stages from
                                          // the classifier's own thresholds

// --- wave 6: forecast-accuracy log -----------------------------------------
const HORIZON_H = 48;            // forecasts resolve after 48h
const MAX_LEDGER_AGE_D = 7;      // entries older than this are pruned
const LEDGER_CAP = 2000;         // hard cap on ledger size
const MIN_RESOLVED_FOR_RATE = 10; // hit rate shown only past this many resolved
const RECORDED_STATES = ["peaking", "accelerating", "rising", "fading"];

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { return fallback; }
}

function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

// wave 14: inline slope/verdict logic moved to scripts/resolution-lib.js
// (shared with scripts/check_resolutions.js — one rule set, no drift).
// The hit/miss rules below are unchanged: classifier's own T.RISE/T.FALL,
// peaking tolerance +2, least-squares slope with the isFinite guard.

function updateAccuracyLedger(now, history, analyses) {
  // analyses: {topic_id: {state, latestVelocity, peakInHours, n, title}}
  const raw = readJSON(LEDGER_FILE, null);
  let entries = (raw && Array.isArray(raw.entries)) ? raw.entries : [];
  const nowMs = now.getTime();
  const maxAgeMs = MAX_LEDGER_AGE_D * 24 * 3600000;

  // 1) prune entries older than the max age
  entries = entries.filter(e => nowMs - Date.parse(e.forecast_at) < maxAgeMs);

  // 2) resolve pending entries old enough to judge (wave 14: via the shared
  //    resolution-lib — same hit/miss rules as before, plus a terminal
  //    "unverifiable" verdict with evidence when the 48h window holds <2
  //    actual snapshots, instead of lingering pending forever)
  const thresholds = { rise: T.RISE, fall: T.FALL };
  entries.forEach(e => {
    if (e.resolved) { return; }
    if (nowMs - Date.parse(e.forecast_at) < HORIZON_H * 3600000) { return; }
    R.resolveEntry(e, history, nowMs, thresholds);
  });

  // 3) append today's decisive forecasts (dedupe: one open entry per
  //    topic per 24h so hourly runs don't spam the ledger)
  const openRecent = {};
  entries.forEach(e => {
    if (!e.resolved && nowMs - Date.parse(e.forecast_at) < 24 * 3600000) {
      openRecent[e.topic_id] = true;
    }
  });
  let appended = 0;
  Object.keys(analyses).forEach(id => {
    const a = analyses[id];
    if (RECORDED_STATES.indexOf(a.state) < 0) { return; }
    if (openRecent[id]) { return; }
    entries.push({
      topic_id: id,
      title: a.title,
      forecast_at: now.toISOString(),
      state: a.state,
      peak_in_hours: a.peakInHours,
      latest_velocity: a.latestVelocity,
      n_snapshots: a.n,
      // wave 9: confidence level at forecast time — powers the calibration
      // view once forecasts resolve. null for entries recorded before wave 9.
      confidence: a.confidence || null,
      resolved: null
    });
    appended++;
  });

  // 4) hard cap: drop oldest resolved first, then oldest pending
  if (entries.length > LEDGER_CAP) {
    entries.sort((x, y) => Date.parse(y.forecast_at) - Date.parse(x.forecast_at));
    entries = entries.slice(0, LEDGER_CAP);
  }
  writeJSON(LEDGER_FILE, { entries: entries });
  return { entries: entries, appended: appended };
}

function buildAccuracyPayload(now, entries) {
  // wave 14: "resolved" keeps its historical meaning — scored hit or miss
  // (the scorecard page's own words). Terminal-but-unscorable entries
  // (verdict "unverifiable": 48h passed, <2 actual snapshots) get their
  // own counter so the hit rate stays meaningful and the honesty contract
  // (MIN_RESOLVED_FOR_RATE) counts decisive calls only.
  const terminal = entries.filter(e => e.resolved);
  const decisive = terminal.filter(e => e.resolved.verdict === "hit" ||
                                        e.resolved.verdict === "miss");
  const unverifiable = terminal.filter(e => e.resolved.verdict === "unverifiable");
  const hits = decisive.filter(e => e.resolved.verdict === "hit");
  const byState = {};
  RECORDED_STATES.forEach(s => {
    const rs = decisive.filter(e => e.state === s);
    byState[s] = { resolved: rs.length,
                   hits: rs.filter(e => e.resolved.verdict === "hit").length };
  });
  const recent = terminal
    .slice().sort((a, b) => Date.parse(b.resolved.resolved_at) - Date.parse(a.resolved.resolved_at))
    .slice(0, 20)
    .map(e => ({
      topic_id: e.topic_id, title: e.title, forecast_at: e.forecast_at,
      state: e.state, peak_in_hours: e.peak_in_hours,
      verdict: e.resolved.verdict, reason: e.resolved.reason,
      actual_slope: e.resolved.actual_slope,
      actual_end_velocity: e.resolved.actual_end_velocity,
      actual_max_velocity: e.resolved.actual_max_velocity,
      n_actual_points: e.resolved.n_actual_points,
      n_snapshots: e.n_snapshots
    }));
  // wave 9: resolution timeline — pending forecasts grouped by the day their
  // 48h horizon lands (real ledger dates, never projections of accuracy).
  const pending = entries.filter(e => !e.resolved);
  const byResDay = {};
  pending.forEach(e => {
    const day = new Date(Date.parse(e.forecast_at) + HORIZON_H * 3600000)
      .toISOString().slice(0, 10);
    byResDay[day] = (byResDay[day] || 0) + 1;
  });
  const upcoming_resolutions = Object.keys(byResDay).sort().map(day => ({
    date: day, pending: byResDay[day]
  }));
  // wave 9: ledger activity — forecasts recorded per day (the Oracle's
  // own pulse, from real ledger timestamps).
  const byRecDay = {};
  entries.forEach(e => {
    const day = e.forecast_at.slice(0, 10);
    byRecDay[day] = (byRecDay[day] || 0) + 1;
  });
  const recorded_per_day = Object.keys(byRecDay).sort().map(day => ({
    date: day, recorded: byRecDay[day]
  }));
  // wave 9: calibration — hit rate by the confidence level the Oracle
  // claimed at forecast time. Honest pre-resolution: rows read "awaiting
  // data" until that confidence level has MIN_RESOLVED_FOR_RATE resolved.
  const byConfidence = {};
  ["high", "medium", "low"].forEach(level => {
    const rs = decisive.filter(e => e.confidence === level);
    byConfidence[level] = {
      resolved: rs.length,
      hits: rs.filter(e => e.resolved.verdict === "hit").length
    };
  });
  const showRate = decisive.length >= MIN_RESOLVED_FOR_RATE;
  return {
    generated_at: now.toISOString(),
    status: showRate ? "live" : "building history",
    method: "Each refresh records the Oracle's decisive forecasts (peaking / " +
            "accelerating / rising / fading) in data/forecast_ledger.json. " +
            "48h later the forecast is compared with the actual velocity " +
            "history and scored hit/miss; when the 48h window holds fewer than " +
            "2 actual snapshots the call is marked unverifiable (data gap — " +
            "not a miss) with its reason recorded. Nothing is backfilled — the log " +
            "starts 2026-10-11, so the first resolutions land 48h after that.",
    horizon_hours: HORIZON_H,
    resolution_rules: {
      rising_accelerating: "hit if the actual velocity slope over the 48h " +
        "window after the forecast is >= +" + T.RISE + "/hr (the classifier's own rising threshold)",
      peaking: "hit if the highest velocity in the 48h window stays at/below " +
        "the forecast-time velocity +2 (the top was called, not blown through)",
      fading: "hit if the actual velocity slope over the 48h window is <= " +
        T.FALL + "/hr (the classifier's own falling threshold)",
      unverifiable: "the 48h window holds fewer than 2 actual velocity " +
        "snapshots (data gap: topic dropped, series pruned, fetch outage) — " +
        "counted separately, never folded into the hit rate"
    },
    counts: { recorded: entries.length,
              pending: entries.length - terminal.length,
              resolved: decisive.length, unverifiable: unverifiable.length,
              hits: hits.length },
    upcoming_resolutions: upcoming_resolutions,
    recorded_per_day: recorded_per_day,
    by_confidence: byConfidence,
    hit_rate: showRate ? Math.round((hits.length / decisive.length) * 1000) / 1000 : null,
    hit_rate_note: showRate
      ? "Hit rate across " + decisive.length + " decisive resolved forecasts" +
        (unverifiable.length ? " (" + unverifiable.length + " unverifiable excluded)." : ".")
      : "The Oracle shows its own hit rate once " + MIN_RESOLVED_FOR_RATE +
        " forecasts have resolved decisively; currently " + decisive.length +
        " decisive" + (unverifiable.length ? ", " + unverifiable.length + " unverifiable" : "") + ".",
    by_state: byState,
    recent: recent
  };
}

// --- forecasts ---------------------------------------------------------------
function record(topicId, title, enriched) {
  const a = enriched.analysis;
  return {
    id: topicId,
    title: title,
    state: a.state,
    n_snapshots: a.n,
    latest_velocity: a.latestVelocity,
    slope_per_hour: Math.round(a.slopePerHour * 100) / 100,
    accel: Math.round(a.accel * 100) / 100,
    // Infinity serializes to null — schema allows number|null, and
    // null honestly means "no peak projected inside the 48h window".
    peak_in_hours: isFinite(a.peakInHours) ? Math.round(a.peakInHours * 10) / 10 : null,
    summary: a.summary,
    label: "Projection from " + a.n + " snapshot" +
           (a.n === 1 ? "" : "s") + " — not a guarantee.",
    // wave 6 (Oracle 2.0): confidence basis + signal attribution +
    // per-platform trajectories — all additive, all from real snapshots.
    confidence: enriched.confidence,
    signals: enriched.signals,
    per_platform: enriched.per_platform
  };
}

function main() {
  const now = new Date();
  let history, phist, store;
  try {
    history = readJSON(HIST_FILE);
    store = readJSON(TRENDS_FILE);
  } catch (e) {
    console.log("[forecasts] SKIP: data/trends.json or velocity history missing — run pipeline/refresh.sh first.");
    return;
  }
  if (!history || !store) {
    console.log("[forecasts] SKIP: data/trends.json or velocity history missing — run pipeline/refresh.sh first.");
    return;
  }
  phist = readJSON(PHIST_FILE, {});

  const topics = {};
  (store.topics || []).forEach(t => {
    topics[t.id] = { title: t.title, platforms: t.platforms || [],
                     platform_points: phist[t.id] || {} };
  });

  const enriched = {};
  Object.keys(history).forEach(id => {
    enriched[id] = T.enrich(
      { id: id, title: (topics[id] || {}).title || id,
        platforms: (topics[id] || {}).platforms || [],
        platform_points: (topics[id] || {}).platform_points || {} },
      history[id], now.getTime());
  });

  const results = Object.keys(enriched).map(id => ({
    topic: { id: id, title: (topics[id] || {}).title || id },
    analysis: enriched[id].analysis
  }));
  const lists = T.rankLists(results);

  const toRec = r => record(r.topic.id, r.topic.title, enriched[r.topic.id]);
  const steady = results
    .filter(r => r.analysis.state === "steady")
    .sort((a, b) => b.analysis.latestVelocity - a.analysis.latestVelocity)
    .map(toRec);

  const projections = {};
  const ledgerInput = {};
  results.forEach(r => {
    const e = enriched[r.topic.id];
    projections[r.topic.id] = record(r.topic.id, r.topic.title, e);
    ledgerInput[r.topic.id] = {
      state: e.analysis.state, title: r.topic.title,
      peakInHours: projections[r.topic.id].peak_in_hours,
      latestVelocity: e.analysis.latestVelocity, n: e.analysis.n,
      // wave 9: confidence level for the calibration view
      confidence: e.confidence ? e.confidence.level : null
    };
  });

  const insufficient = results.filter(r => r.analysis.state === "insufficient").length;

  const payload = {
    generated_at: now.toISOString(),
    method: "assets/js/trajectory.js analyze() + rankLists() + enrich() — the same classifier as the oracle.html dashboard",
    honesty: "Every forecast is a projection from N real velocity snapshots, never a guarantee. " +
             "Topics with fewer than " + T.MIN_POINTS + " snapshots are excluded from the forecast lists. " +
             "confidence.basis names the evidence behind each call (snapshot count + fit quality), " +
             "never a probability of being right. per_platform series are starting points — they " +
             "build one snapshot per refresh and only classify after 3+ snapshots.",
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
  writeJSON(OUT, payload);
  console.log("[forecasts] " + Object.keys(projections).length + " topics -> " + OUT +
              " (peaking=" + lists.peaking.length +
              " rising=" + lists.rising.length +
              " cooling=" + lists.cooling.length +
              " insufficient=" + insufficient + ")");

  // Wave 6: forecast-accuracy log — record today's forecasts, resolve old ones.
  const acc = updateAccuracyLedger(now, history, ledgerInput);
  const accPayload = buildAccuracyPayload(now, acc.entries);
  writeJSON(ACC_OUT, accPayload);
  console.log("[accuracy] ledger: " + acc.entries.length + " recorded (+" +
              acc.appended + " new), resolved=" + accPayload.counts.resolved +
              ", hits=" + accPayload.counts.hits + ", status=" + accPayload.status +
              " -> " + ACC_OUT);

  // Wave 17: lifecycle layer — ignition/burnout stages from real snapshots.
  const life = L.summarize(history, now.getTime());
  const withTitles = function (rows) {
    return rows.map(function (r) {
      return { id: r.id, title: (topics[r.id] || {}).title || r.id,
               from: r.from, to: r.to, ts: r.ts };
    });
  };
  const lifePayload = {
    generated_at: now.toISOString(),
    method: "assets/js/lifecycle-lib.js summarize() — stage-per-snapshot classification using the classifier's own thresholds (ignition line v=70, rise/fall ±1.5/hr)",
    honesty: "Stages are readouts from recorded velocity snapshots, not predictions. " +
             "Topics with fewer than 3 snapshots report 'building'. The ignitions/burnouts " +
             "boards list stage transitions that actually happened in the last 24h.",
    counts: life.counts,
    ignitions: withTitles(life.ignitions),
    burnouts: withTitles(life.burnouts),
    topics: life.topics
  };
  writeJSON(LIFE_OUT, lifePayload);
  console.log("[lifecycle] " + Object.keys(life.topics).length + " topics staged -> " +
              LIFE_OUT + " (ignitions=" + life.ignitions.length +
              ", burnouts=" + life.burnouts.length + ")");

  // Patch the manifest so index.json stays accurate: add the forecasts and
  // forecast-accuracy entries only when the files actually exist.
  try {
    const manifest = readJSON(MANIFEST);
    manifest.endpoints.forecasts = {
      path: "data/v1/forecasts.json",
      description: "Oracle output: precomputed trajectory classifications (peaking_48h / rising_fast / cooling_off / steady) from the same classifier as the dashboard. Every forecast is a projection from N snapshots — never a guarantee. Wave 6 adds confidence basis, signal attribution, and per-platform trajectories.",
      schema: "data/v1/schema/forecasts.json",
      updated: payload.generated_at,
      records: Object.keys(projections).length,
      notes: "Topics with fewer than 3 snapshots are excluded from the lists (counts.insufficient). Additive-only changes; no payload-shape breaks."
    };
    manifest.endpoints.forecast_accuracy = {
      path: "data/v1/forecast-accuracy.json",
      description: "The Oracle's own scorecard: forecast-vs-actual ledger (hit/miss per forecast after a 48h horizon). Hit rate shown only after 10+ forecasts resolve; before that the status is 'building history'.",
      schema: "data/v1/schema/forecast-accuracy.json",
      updated: accPayload.generated_at,
      records: accPayload.counts.recorded,
      notes: "Started 2026-10-11 — first resolutions land 48h later. Nothing backfilled."
    };
    manifest.endpoints.lifecycle = {
      path: "data/v1/lifecycle.json",
      description: "Ignition/burnout lifecycle layer: every topic's current lifecycle stage (building/steady/warming/igniting/peaking/cooling/burned-out) classified from its real velocity snapshots, per-topic stage ribbons, and the last-24h ignitions/burnouts boards. Stages use the classifier's own thresholds (ignition line v=70, rise/fall ±1.5/hr) — readouts, not predictions.",
      schema: "data/v1/schema/lifecycle.json",
      updated: lifePayload.generated_at,
      records: Object.keys(lifePayload.topics).length,
      notes: "Stages are computed from the same snapshots as forecasts.json; the boards show transitions that actually happened in the last 24h."
    };
    // Wave 17: manifest v0.7.0 — idempotent: only bump once per schema era.
    if (manifest.version !== "0.7.0") {
      manifest.version = "0.7.0";
      var entry = "0.7.0 (2026-10-12): Wave 17 — Oracle layer 2. New data/v1/lifecycle.json endpoint: every topic's ignition/burnout lifecycle stage (building/steady/warming/igniting/peaking/cooling/burned-out) classified from its real velocity snapshots with the classifier's own thresholds (ignition line v=70, rise/fall ±1.5/hr) — readouts, not predictions; per-topic stage ribbons; last-24h ignitions/burnouts boards. Additive only, no shape changes. ";
      manifest.changelog = entry + (manifest.changelog || "");
    }
    writeJSON(MANIFEST, manifest);
    console.log("[forecasts] data/v1/index.json patched with forecasts + forecast_accuracy + lifecycle endpoints");
  } catch (e) {
    console.log("[forecasts] WARNING: could not patch manifest: " + e.message);
  }
}

main();
