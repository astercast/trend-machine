/* ============================================================
   TREND MACHINE — trajectory.js (wave 3 · "Oracle")
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
    pts = pts.filter(function (p) { return tsMillis(p) !== null; })
             .slice(-8);
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
    analyze: analyze,
    rankLists: rankLists,
    _slope: slope // exported for unit tests only
  };
});
