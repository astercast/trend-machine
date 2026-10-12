/* ============================================================
   TREND MACHINE — build_forecasts.js (wave 5 · Agent API, wave 6 · Oracle 2.0)
   Precomputes the Oracle's trajectory forecasts as a static API
   endpoint so ANY agent can read them without running JS.

   Uses assets/js/trajectory.js directly (the same UMD classifier
   the oracle.html dashboard uses) — no reimplementation, no drift.

   Input : data/trends.json (titles/platforms), data/velocity_history.json,
           data/platform_velocity_history.json (wave 6)
   Output: api/v1/forecasts.json
           api/v1/forecast-accuracy.json (wave 6 — the Oracle's own
             forecast-vs-actual scorecard; labeled "building history"
             until >=10 forecasts resolve)
           data/forecast_ledger.json (append-only forecast record)
           + patches api/v1/index.json to add the forecasts and
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
const API = path.join(ROOT, "api", "v1");
const OUT = path.join(API, "forecasts.json");
const ACC_OUT = path.join(API, "forecast-accuracy.json");
const MANIFEST = path.join(API, "index.json");

const T = require("../assets/js/trajectory.js");

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

function slopeOf(points, t0ms) {
  // points: [[iso, v], ...] -> least-squares slope per hour vs t0ms
  const xs = points.map(p => (Date.parse(p[0]) - t0ms) / 3600000);
  const ys = points.map(p => p[1]);
  return { slope: T._slope(xs, ys), ys: ys };
}

function verdictFor(entry, history) {
  // Compare the forecast recorded 48h ago with what actually happened.
  // Rules are documented in the output's resolution_rules — same
  // thresholds the classifier itself uses (T.RISE / T.FALL).
  const fAt = Date.parse(entry.forecast_at);
  const end = fAt + HORIZON_H * 3600000;
  const pts = (history[entry.topic_id] || [])
    .filter(p => { const t = Date.parse(p[0]); return t > fAt && t <= end; });
  if (pts.length < 2) { return null; } // not enough actuals yet — retry later
  const r = slopeOf(pts, fAt);
  const slope = Math.round(r.slope * 100) / 100;
  const endVel = r.ys[r.ys.length - 1];
  const maxVel = Math.max.apply(null, r.ys);
  let verdict;
  if (entry.state === "accelerating" || entry.state === "rising") {
    verdict = slope >= T.RISE ? "hit" : "miss";
  } else if (entry.state === "fading") {
    verdict = slope <= T.FALL ? "hit" : "miss";
  } else if (entry.state === "peaking") {
    // Called the top: the peak stayed at/below the forecast level (+2 tolerance).
    verdict = maxVel <= entry.latest_velocity + 2 ? "hit" : "miss";
  } else {
    verdict = "miss";
  }
  return { verdict: verdict, actual_slope: slope,
           actual_end_velocity: endVel, actual_max_velocity: maxVel };
}

function updateAccuracyLedger(now, history, analyses) {
  // analyses: {topic_id: {state, latestVelocity, peakInHours, n, title}}
  const raw = readJSON(LEDGER_FILE, null);
  let entries = (raw && Array.isArray(raw.entries)) ? raw.entries : [];
  const nowMs = now.getTime();
  const maxAgeMs = MAX_LEDGER_AGE_D * 24 * 3600000;

  // 1) prune entries older than the max age
  entries = entries.filter(e => nowMs - Date.parse(e.forecast_at) < maxAgeMs);

  // 2) resolve pending entries old enough to judge
  entries.forEach(e => {
    if (e.resolved) { return; }
    if (nowMs - Date.parse(e.forecast_at) < HORIZON_H * 3600000) { return; }
    const res = verdictFor(e, history);
    if (res) {
      e.resolved = Object.assign({ resolved_at: now.toISOString() }, res);
    }
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
  const resolved = entries.filter(e => e.resolved);
  const hits = resolved.filter(e => e.resolved.verdict === "hit");
  const byState = {};
  RECORDED_STATES.forEach(s => {
    const rs = resolved.filter(e => e.state === s);
    byState[s] = { resolved: rs.length,
                   hits: rs.filter(e => e.resolved.verdict === "hit").length };
  });
  const recent = resolved
    .slice().sort((a, b) => Date.parse(b.resolved.resolved_at) - Date.parse(a.resolved.resolved_at))
    .slice(0, 20)
    .map(e => ({
      topic_id: e.topic_id, title: e.title, forecast_at: e.forecast_at,
      state: e.state, peak_in_hours: e.peak_in_hours,
      verdict: e.resolved.verdict, actual_slope: e.resolved.actual_slope,
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
    const rs = resolved.filter(e => e.confidence === level);
    byConfidence[level] = {
      resolved: rs.length,
      hits: rs.filter(e => e.resolved.verdict === "hit").length
    };
  });
  const showRate = resolved.length >= MIN_RESOLVED_FOR_RATE;
  return {
    generated_at: now.toISOString(),
    status: showRate ? "live" : "building history",
    method: "Each refresh records the Oracle's decisive forecasts (peaking / " +
            "accelerating / rising / fading) in data/forecast_ledger.json. " +
            "48h later the forecast is compared with the actual velocity " +
            "history and scored hit/miss. Nothing is backfilled — the log " +
            "starts 2026-10-11, so the first resolutions land 48h after that.",
    horizon_hours: HORIZON_H,
    resolution_rules: {
      rising_accelerating: "hit if the actual velocity slope over the 48h " +
        "window after the forecast is >= +" + T.RISE + "/hr (the classifier's own rising threshold)",
      peaking: "hit if the highest velocity in the 48h window stays at/below " +
        "the forecast-time velocity +2 (the top was called, not blown through)",
      fading: "hit if the actual velocity slope over the 48h window is <= " +
        T.FALL + "/hr (the classifier's own falling threshold)"
    },
    counts: { recorded: entries.length,
              pending: entries.length - resolved.length,
              resolved: resolved.length, hits: hits.length },
    upcoming_resolutions: upcoming_resolutions,
    recorded_per_day: recorded_per_day,
    by_confidence: byConfidence,
    hit_rate: showRate ? Math.round((hits.length / resolved.length) * 1000) / 1000 : null,
    hit_rate_note: showRate
      ? "Hit rate across " + resolved.length + " resolved forecasts."
      : "The Oracle shows its own hit rate once " + MIN_RESOLVED_FOR_RATE +
        " forecasts have resolved; currently " + resolved.length + " resolved.",
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

  // Patch the manifest so index.json stays accurate: add the forecasts and
  // forecast-accuracy entries only when the files actually exist.
  try {
    const manifest = readJSON(MANIFEST);
    manifest.endpoints.forecasts = {
      path: "api/v1/forecasts.json",
      description: "Oracle output: precomputed trajectory classifications (peaking_48h / rising_fast / cooling_off / steady) from the same classifier as the dashboard. Every forecast is a projection from N snapshots — never a guarantee. Wave 6 adds confidence basis, signal attribution, and per-platform trajectories.",
      schema: "api/v1/schema/forecasts.json",
      updated: payload.generated_at,
      records: Object.keys(projections).length,
      notes: "Topics with fewer than 3 snapshots are excluded from the lists (counts.insufficient). Additive-only changes; no payload-shape breaks."
    };
    manifest.endpoints.forecast_accuracy = {
      path: "api/v1/forecast-accuracy.json",
      description: "The Oracle's own scorecard: forecast-vs-actual ledger (hit/miss per forecast after a 48h horizon). Hit rate shown only after 10+ forecasts resolve; before that the status is 'building history'.",
      schema: "api/v1/schema/forecast-accuracy.json",
      updated: accPayload.generated_at,
      records: accPayload.counts.recorded,
      notes: "Started 2026-10-11 — first resolutions land 48h later. Nothing backfilled."
    };
    writeJSON(MANIFEST, manifest);
    console.log("[forecasts] api/v1/index.json patched with forecasts + forecast_accuracy endpoints");
  } catch (e) {
    console.log("[forecasts] WARNING: could not patch manifest: " + e.message);
  }
}

main();
