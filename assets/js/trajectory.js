/* ============================================================
   TREND MACHINE — trajectory.js (wave 3 · "Oracle", wave 6 · "Oracle 2.0")
   Trajectory classification for topic velocity histories.

   Input: points = [[iso_ts, velocity, opportunity], ...] sorted
   ascending by timestamp (this is the velocity_history.json shape).

   Output: { state, n, slopePerHour, accel, latestVelocity,
             peakInHours, summary, rankKey }

   States:
     "insufficient"  — fewer than 3 snapshots (no forecast)
     "accelerating"  — velocity climbing AND climbing faster
     "rising"        — velocity climbing at a steady clip
     "peaking"       — projected velocity peak within the next 48h
     "fading"        — velocity falling
     "steady"        — not moving enough to call

   Everything is a PROJECTION from real snapshots — never a
   guarantee. The browser UI must label it as such.

   Wave 6 adds (all additive, pure functions):
     rSquared(xs, ys)        — fit quality of the velocity slope
     confidence(points, a)   — high/medium/low + honest basis text
     signals(a, points, t, nowMs) — "why this is peaking" attribution:
       velocity delta, slope, accel, recency, cross-platform spread,
       and which classifier thresholds actually fired (drivers)
     platformTrajectories(pp) — per-platform analyze() for
       {platform: [[iso, v], ...]} (insufficient platforms included,
       honestly labeled)
     enrich(topic, points, nowMs) — {analysis, confidence, signals,
       per_platform} in one call (topic.platforms + topic.platform_points
       optional; missing -> honest empties)

   UMD: works as a browser global (window.Trajectory) and as a
   CommonJS module for node unit tests.
   ============================================================ */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Trajectory = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MIN_POINTS = 3;        // honest floor: no forecast under 3 snapshots
  var RISE = 1.5;            // velocity-points/hour that counts as "climbing"
  var FALL = -1.5;           // ...as "falling"
  var ACCEL = 1.0;           // slope-delta/hour that counts as accelerating
  var DECEL = -1.0;          // ...as decelerating
  var HIGH = 70;             // velocity tier that counts as "already hot"
  var PEAK_WINDOW_H = 48;    // the "peaking in the next 48h" window

  function tsMillis(p) {
    var t = Date.parse(p[0]);
    return isNaN(t) ? null : t;
  }

  // Least-squares slope of ys over xs. Returns 0 when degenerate.
  function slope(xs, ys) {
    var n = xs.length;
    if (n < 2 || ys.length < 2) { return 0; }
    var sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (var i = 0; i < n; i++) {
      sx += xs[i]; sy += ys[i]; sxy += xs[i] * ys[i]; sxx += xs[i] * xs[i];
    }
    var denom = n * sxx - sx * sx;
    if (denom === 0) { return 0; }
    var m = (n * sxy - sx * sy) / denom;
    return isFinite(m) ? m : 0;
  }

  // The points analyze() actually fits: most recent 8 with parsable
  // timestamps. Shared so confidence/signals use the same window.
  function windowPts(points) {
    var pts = (points || []).slice();
    return pts.filter(function (p) { return tsMillis(p) !== null; }).slice(-8);
  }

  // R^2 of the velocity least-squares fit: fraction of variance the
  // linear trend explains. 1 = perfect straight line, 0 = the line
  // explains nothing. Returns 1 when all velocities are identical
  // (the flat line explains everything).
  function rSquared(xs, ys) {
    var n = xs.length;
    if (n < 2 || ys.length < 2) { return 0; }
    var s = slope(xs, ys);
    var mean = 0, xMean = 0, ssTot = 0, ssRes = 0, i;
    for (i = 0; i < n; i++) { mean += ys[i]; }
    mean /= n;
    for (i = 0; i < n; i++) {
      ssTot += (ys[i] - mean) * (ys[i] - mean);
    }
    for (i = 0; i < n; i++) { xMean += xs[i]; }
    xMean /= n;
    for (i = 0; i < n; i++) {
      var pred = mean + s * (xs[i] - xMean);
      ssRes += (ys[i] - pred) * (ys[i] - pred);
    }
    if (ssTot === 0) { return 1; }
    var r2 = 1 - ssRes / ssTot;
    return (isFinite(r2) && r2 >= 0) ? r2 : 0;
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // Confidence basis for a forecast: how much data stands behind the call.
  // Never a probability of being right — just the evidence volume and
  // how consistently the snapshots point one way (fit quality).
  function confidence(points, analysis) {
    var a = analysis || {};
    var pts = windowPts(points);
    var n = pts.length;
    if (a.state === "insufficient" || n < MIN_POINTS) {
      return {
        level: "low",
        n: n,
        r2: 0,
        basis: "No forecast: fewer than " + MIN_POINTS +
               " snapshots — nothing to be confident about yet."
      };
    }
    var t0 = tsMillis(pts[0]);
    var xs = pts.map(function (p) { return (tsMillis(p) - t0) / 3600000; });
    var ys = pts.map(function (p) { return p[1]; });
    var mean = 0, i, sd;
    for (i = 0; i < ys.length; i++) { mean += ys[i]; }
    mean /= ys.length;
    sd = 0;
    for (i = 0; i < ys.length; i++) { sd += (ys[i] - mean) * (ys[i] - mean); }
    sd = Math.sqrt(sd / ys.length);
    var r2 = rSquared(xs, ys);
    var level, basis;
    if (sd <= 3) {
      // Flat-ish series: a "steady" call stands on N consistent snapshots —
      // the velocity barely moves, so R^2 of the slope is the wrong lens.
      level = n >= 6 ? "high" : (n >= 4 ? "medium" : "low");
      basis = cap(level) + " confidence basis: " + n + " snapshot" +
              (n === 1 ? "" : "s") + ", velocity barely moves (\u03C3 " +
              sd.toFixed(1) + ").";
    } else if (n >= 6 && r2 >= 0.6) {
      level = "high";
      basis = "High confidence basis: " + n + " snapshots with a consistent " +
              "trend (R\u00B2 " + r2.toFixed(2) + ").";
    } else if (n >= 4 && r2 >= 0.3) {
      level = "medium";
      basis = "Medium confidence basis: " + n + " snapshots; the trend is " +
              "still forming (R\u00B2 " + r2.toFixed(2) + ").";
    } else {
      level = "low";
      basis = "Low confidence basis: only " + n + " snapshot" +
              (n === 1 ? "" : "s") + " and a wobbly fit (R\u00B2 " +
              r2.toFixed(2) + ") — treat as an early read.";
    }
    return { level: level, n: n, r2: Math.round(r2 * 100) / 100,
             basis: basis };
  }

  // "Why this is peaking" — which signals drive the trajectory call.
  // velocity_delta: last minus first velocity inside the fit window
  // recency_hours : hours since the most recent snapshot (a stale feed
  //                 makes the call weaker — reported, not thresholded)
  // platform_spread / platforms: cross-platform corroboration from the topic
  // drivers: the classifier thresholds that actually fired, in the
  //          classifier's own terms — this is what decided the state.
  function signals(analysis, points, topic, nowMs) {
    var a = analysis || {};
    var pts = windowPts(points);
    var t = topic || {};
    var plats = Array.isArray(t.platforms) ? t.platforms.slice() : [];
    var vel = pts.length ? pts[pts.length - 1][1] : 0;
    var first = pts.length ? pts[0][1] : 0;
    var delta = vel - first;
    var lastTs = pts.length ? tsMillis(pts[pts.length - 1]) : null;
    var now = (typeof nowMs === "number") ? nowMs : Date.now();
    var recency = (lastTs === null) ? null :
      Math.round(((now - lastTs) / 3600000) * 10) / 10;

    var drivers = [];
    if (a.state === "insufficient") {
      drivers.push("no forecast — fewer than " + MIN_POINTS + " snapshots");
    } else if (a.state === "accelerating") {
      drivers.push("slope +" + a.slopePerHour.toFixed(1) + "/hr (rising threshold +1.5/hr)");
      drivers.push("accel +" + a.accel.toFixed(1) + "/hr\u00B2 (accelerating threshold +1.0/hr\u00B2)");
    } else if (a.state === "rising") {
      drivers.push("slope +" + a.slopePerHour.toFixed(1) + "/hr (rising threshold +1.5/hr)");
      drivers.push("accel " + (a.accel >= 0 ? "+" : "") + a.accel.toFixed(1) +
                   "/hr\u00B2 (below the +1.0/hr\u00B2 accelerating bar)");
    } else if (a.state === "peaking") {
      drivers.push("velocity " + vel + " (hot tier: \u226570)");
      if (a.accel <= DECEL) {
        drivers.push("accel " + a.accel.toFixed(1) + "/hr\u00B2 (decelerating past \u22121.0/hr\u00B2)");
      } else {
        drivers.push("slope " + a.slopePerHour.toFixed(1) + "/hr (no longer climbing)");
      }
    } else if (a.state === "fading") {
      drivers.push("slope " + a.slopePerHour.toFixed(1) + "/hr (falling threshold \u22121.5/hr)");
    } else {
      drivers.push("no motion threshold fired — drift below \u00B11.5/hr");
    }

    return {
      velocity_delta: delta,
      slope_per_hour: Math.round((a.slopePerHour || 0) * 100) / 100,
      accel: Math.round((a.accel || 0) * 100) / 100,
      recency_hours: recency,
      platform_spread: plats.length,
      platforms: plats,
      drivers: drivers
    };
  }

  // Per-platform trajectories: run the same classifier on each
  // platform's own snapshot series. Platforms with <3 snapshots get the
  // honest "insufficient" label — the UI shows those as "building".
  // pp: { platform: [[iso_ts, v], ...], ... }
  function platformTrajectories(pp) {
    var out = {};
    Object.keys(pp || {}).forEach(function (p) {
      var a = analyze(pp[p]);
      out[p] = {
        state: a.state,
        n: a.n,
        latest_velocity: a.latestVelocity,
        slope_per_hour: Math.round(a.slopePerHour * 100) / 100,
        peak_in_hours: isFinite(a.peakInHours) ? Math.round(a.peakInHours * 10) / 10 : null,
        summary: a.summary
      };
    });
    return out;
  }

  // One call for the dashboard/API builders: analysis + confidence +
  // signal attribution + per-platform trajectories.
  function enrich(topic, points, nowMs) {
    var t = topic || {};
    var analysis = analyze(points);
    return {
      analysis: analysis,
      confidence: confidence(points, analysis),
      signals: signals(analysis, points, t, nowMs),
      per_platform: platformTrajectories(t.platform_points || {})
    };
  }

  function analyze(points) {
    var pts = (points || []).slice();
    if (pts.length < MIN_POINTS) {
      return {
        state: "insufficient",
        n: pts.length,
        slopePerHour: 0,
        accel: 0,
        latestVelocity: pts.length ? pts[pts.length - 1][1] : 0,
        peakInHours: Infinity,
        summary: "Not enough snapshots yet",
        rankKey: 0
      };
    }
    // Use the most recent points; drop any with unparsable timestamps.
    pts = windowPts(pts);
    if (pts.length < MIN_POINTS) {
      return {
        state: "insufficient", n: pts.length, slopePerHour: 0, accel: 0,
        latestVelocity: pts.length ? pts[pts.length - 1][1] : 0,
        peakInHours: Infinity, summary: "Not enough snapshots yet", rankKey: 0
      };
    }

    var t0 = tsMillis(pts[0]);
    var xs = pts.map(function (p) { return (tsMillis(p) - t0) / 3600000; });
    var ys = pts.map(function (p) { return p[1]; });
    var s = slope(xs, ys);
    // wave 9: kill floating-point noise — a flat series can yield
    // s = -1e-14, which used to trip the "s < 0 && vel < 50" fading
    // branch and mislabel steady topics as cooling off.
    if (Math.abs(s) < 1e-9) { s = 0; }

    // Curvature: slope of the second half minus slope of the first half
    // (overlapping at the midpoint so short histories still work).
    var mid = Math.max(2, Math.floor(pts.length / 2));
    var s1 = slope(xs.slice(0, mid), ys.slice(0, mid));
    var s2 = slope(xs.slice(mid - 1), ys.slice(mid - 1));
    var accel = s2 - s1;

    var vel = ys[ys.length - 1];

    // Projected hours until the velocity peak, from a simple parabola
    // fit: v(t) = v0 + s*t + (accel/2)*t^2 peaks at t = -s/accel.
    // Only meaningful while rising and decelerating.
    var peakIn = Infinity;
    if (s > 0 && accel < 0) { peakIn = s / -accel; }
    else if (s <= 0) { peakIn = 0; } // crest already behind us

    var state, summary;
    if (vel >= HIGH && (accel <= DECEL || s < 0)) {
      state = "peaking";
      summary = peakIn === 0
        ? "Hot and cresting — the peak is at or just behind us"
        : "Hot and topping out — projected peak in ~" + Math.round(peakIn) + "h";
    } else if (s >= RISE && accel >= ACCEL) {
      state = "accelerating";
      summary = "Climbing and picking up speed (+" + s.toFixed(1) + " velocity/hr)";
    } else if (s >= RISE) {
      state = "rising";
      summary = "Climbing steadily (+" + s.toFixed(1) + " velocity/hr)";
    } else if (s <= FALL || (s < 0 && vel < 50)) {
      state = "fading";
      summary = "Cooling off (" + s.toFixed(1) + " velocity/hr)";
    } else {
      state = "steady";
      summary = "Holding steady — not enough motion to call";
    }

    return {
      state: state,
      n: pts.length,
      slopePerHour: s,
      accel: accel,
      latestVelocity: vel,
      peakInHours: peakIn,
      summary: summary,
      rankKey: 0 // filled in by rankLists()
    };
  }

  // Bucket classified topics into the three Oracle lists.
  // Only topics with a real forecast (n >= 3) appear; everything
  // else is honestly left out of the forecast lists.
  function rankLists(results) {
    // results: [{topic, analysis}, ...]
    var peaking = [], rising = [], cooling = [];
    results.forEach(function (r) {
      var a = r.analysis;
      if (a.state === "insufficient") { return; }
      if (a.state === "peaking" && a.peakInHours <= PEAK_WINDOW_H) {
        a.rankKey = (PEAK_WINDOW_H - Math.min(a.peakInHours, PEAK_WINDOW_H)) * 10 + a.latestVelocity;
        peaking.push(r);
      } else if (a.state === "accelerating" || a.state === "rising") {
        a.rankKey = a.slopePerHour * 100 + a.accel * 20 + a.latestVelocity;
        rising.push(r);
      } else if (a.state === "fading") {
        a.rankKey = -a.slopePerHour * 100 + (100 - a.latestVelocity);
        cooling.push(r);
      }
      // "steady" topics stay out of the forecast lists — no signal, no slot.
    });
    function byRank(a, b) { return b.analysis.rankKey - a.analysis.rankKey; }
    peaking.sort(byRank); rising.sort(byRank); cooling.sort(byRank);
    return { peaking: peaking, rising: rising, cooling: cooling };
  }

  return {
    MIN_POINTS: MIN_POINTS,
    PEAK_WINDOW_H: PEAK_WINDOW_H,
    RISE: RISE,                    // wave 6 · exported so the accuracy
    FALL: FALL,                    //   log uses the classifier's own thresholds
    analyze: analyze,
    rankLists: rankLists,
    rSquared: rSquared,            // wave 6 · fit quality
    confidence: confidence,        // wave 6 · confidence basis
    signals: signals,              // wave 6 · "why this is peaking" attribution
    platformTrajectories: platformTrajectories, // wave 6 · per-platform trajectories
    enrich: enrich,                // wave 6 · analysis+confidence+signals+per_platform
    _slope: slope // exported for unit tests only
  };
});
