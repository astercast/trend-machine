/* ============================================================
   TREND MACHINE — resolution-lib.js (wave 14 · ledger health)
   Pure, unit-tested forecast-resolution logic for the Oracle's
   accuracy ledger (data/forecast_ledger.json).

   One rule set, used both by the hourly pipeline
   (scripts/build_forecasts.js) and the standalone audit
   (scripts/check_resolutions.js) — no drift.

   An entry is terminal in exactly one of three ways:
     hit / miss          — 48h window has real velocity data and the
                           call is judged by the classifier's own
                           thresholds (T.RISE / T.FALL from
                           assets/js/trajectory.js).
     unverifiable        — the 48h horizon has passed but the window
                           holds fewer than 2 actual snapshots
                           (data gap: topic dropped, series pruned,
                           fetch outage). Marked honestly instead of
                           lingering "pending" forever.
   Entries not yet 48h old stay pending (with their due date).

   Every terminal resolution carries its evidence: window bounds,
   number of actual points, slope, end/max velocity, thresholds used.
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TMResolution = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var HORIZON_H = 48;            // forecasts resolve after 48h
  var MAX_LEDGER_AGE_D = 7;      // entries older than this are pruned
  var PEAK_TOLERANCE = 2;        // "peaking" hit if max velocity stays within
                                 // forecast-time velocity + this tolerance

  function slopeOf(points, t0ms) {
    // points: [[iso, v, ...], ...] -> least-squares slope per hour vs t0ms
    var xs = points.map(function (p) { return (Date.parse(p[0]) - t0ms) / 3600000; });
    var ys = points.map(function (p) { return p[1]; });
    var n = xs.length, sx = 0, sy = 0, sxx = 0, sxy = 0, i;
    for (i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    var denom = n * sxx - sx * sx;
    // identical to trajectory.js's _slope (incl. the isFinite guard) — no drift
    var m = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
    return { slope: isFinite(m) ? m : 0, ys: ys };
  }

  function windowOf(entry) {
    var start = Date.parse(entry.forecast_at);
    return { startMs: start, endMs: start + HORIZON_H * 3600000 };
  }

  function actualsInWindow(entry, history) {
    var w = windowOf(entry);
    return ((history || {})[entry.topic_id] || []).filter(function (p) {
      var t = Date.parse(p[0]);
      return t > w.startMs && t <= w.endMs;
    });
  }

  // classifyResolution(entry, history, nowMs, thresholds)
  //   thresholds: { rise: <T.RISE>, fall: <T.FALL> } — the classifier's own
  //   verdict returns:
  //     { status: "already" }                                        — untouched
  //     { status: "pending", reason: "not-due", due_at: iso }
  //     { status: "resolved", verdict: "hit"|"miss"|"unverifiable",
  //       reason, evidence: { window_start, window_end, n_actual_points,
  //                           actual_slope?, actual_end_velocity?,
  //                           actual_max_velocity?, rise_threshold?,
  //                           fall_threshold? } }
  function classifyResolution(entry, history, nowMs, thresholds) {
    if (entry.resolved) { return { status: "already" }; }
    var w = windowOf(entry);
    if (nowMs < w.endMs) {
      return { status: "pending", reason: "not-due",
               due_at: new Date(w.endMs).toISOString() };
    }
    var pts = actualsInWindow(entry, history);
    var evidence = {
      window_start: entry.forecast_at,
      window_end: new Date(w.endMs).toISOString(),
      n_actual_points: pts.length
    };
    if (pts.length < 2) {
      return { status: "resolved", verdict: "unverifiable",
               reason: "48h horizon passed but the window holds fewer than 2 " +
                       "actual velocity snapshots — data gap (topic dropped, " +
                       "series pruned, or fetch outage). No honest comparison " +
                       "is possible.",
               evidence: evidence };
    }
    var r = slopeOf(pts, w.startMs);
    var slope = Math.round(r.slope * 100) / 100;
    var endVel = r.ys[r.ys.length - 1];
    var maxVel = Math.max.apply(null, r.ys);
    evidence.actual_slope = slope;
    evidence.actual_end_velocity = endVel;
    evidence.actual_max_velocity = maxVel;
    evidence.rise_threshold = thresholds.rise;
    evidence.fall_threshold = thresholds.fall;

    var verdict, reason;
    if (entry.state === "accelerating" || entry.state === "rising") {
      verdict = slope >= thresholds.rise ? "hit" : "miss";
      reason = "actual slope " + slope + "/hr vs rising threshold +" +
               thresholds.rise + "/hr";
    } else if (entry.state === "fading") {
      verdict = slope <= thresholds.fall ? "hit" : "miss";
      reason = "actual slope " + slope + "/hr vs falling threshold " +
               thresholds.fall + "/hr";
    } else if (entry.state === "peaking") {
      verdict = maxVel <= entry.latest_velocity + PEAK_TOLERANCE ? "hit" : "miss";
      reason = "max velocity in window " + maxVel + " vs forecast-time " +
               entry.latest_velocity + " (tolerance +" + PEAK_TOLERANCE + ")";
    } else {
      verdict = "miss";
      reason = "recorded state '" + entry.state + "' is not a decisive " +
               "forecast; cannot score as a hit";
    }
    return { status: "resolved", verdict: verdict, reason: reason,
             evidence: evidence };
  }

  // resolveEntry(entry, history, nowMs, thresholds) — the mutating twin:
  // writes entry.resolved = { resolved_at, verdict, reason, ...evidence }
  // and returns the classification. Idempotent on already-resolved entries.
  function resolveEntry(entry, history, nowMs, thresholds) {
    var c = classifyResolution(entry, history, nowMs, thresholds);
    if (c.status === "resolved") {
      entry.resolved = Object.assign({ resolved_at: new Date(nowMs).toISOString(),
                                       verdict: c.verdict, reason: c.reason },
                                     c.evidence);
    }
    return c;
  }

  return {
    HORIZON_H: HORIZON_H,
    MAX_LEDGER_AGE_D: MAX_LEDGER_AGE_D,
    PEAK_TOLERANCE: PEAK_TOLERANCE,
    slopeOf: slopeOf,
    windowOf: windowOf,
    actualsInWindow: actualsInWindow,
    classifyResolution: classifyResolution,
    resolveEntry: resolveEntry
  };
}));
