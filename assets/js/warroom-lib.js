/* ============================================================
   TREND MACHINE — warroom-lib.js (wave 15 · Oracle war-room)
   Pure geometry for the Oracle trajectory theatre.

   The theatre plots each forecast contact on a trajectory map:
     X = hours from now (past snapshots < 0, projection to +48)
     Y = velocity
   Past points are REAL velocity snapshots; the projection curve is
   the same parabola the classifier's peak_in_hours is estimated from:
     v(t) = v0 + slope*t + (accel/2)*t^2
   Blips, pings and the sweep are illustrative animation — every
   POSITION is computed from real snapshot data.

   UMD: browser global (window.WarRoomLib) + CommonJS for tests.
   ============================================================ */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.WarRoomLib = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var PROJ_HOURS = 48;   // the 48h projection horizon
  var IGNITION_V = 70;   // classifier's hot tier — the ignition line
  var PROJ_STEP = 3;     // projection sample step (hours)

  // v(t) = v0 + s*t + (a/2)*t^2, clamped at 0 (velocity can't go negative).
  function projectVelocity(v0, slope, accel, t) {
    var v = v0 + slope * t + (accel / 2) * t * t;
    return v < 0 ? 0 : v;
  }

  // Hours until the parabola vertex — the same estimate trajectory.js
  // uses for peakInHours. null when there's no future peak.
  function peakAt(slope, accel) {
    if (slope > 0 && accel < 0) { return slope / -accel; }
    return null;
  }

  // Percentage position of an hour-value inside [xMin, xMax] — drives the
  // absolutely-positioned HTML blips so they stay glued to the SVG on resize.
  function xPct(h, xMin, xMax) {
    if (!(xMax > xMin)) { return 0; }
    return ((h - xMin) / (xMax - xMin)) * 100;
  }
  // Logarithmic vertical: real projections fan out over a 100x spread
  // (a parabola with positive accel explodes by T+48h), so the scope uses
  // a log10(v+1) axis — honest direction + curvature, no fake precision.
  function logFrac(v, vMax) {
    if (!(vMax > 0)) { return 0; }
    return Math.log10(Math.max(0, v) + 1) / Math.log10(vMax + 1);
  }
  function yPct(v, vMax) {
    return (1 - logFrac(v, vMax)) * 100;
  }
  // Nice log tick values at or below vMax (10, 100, 1k, 10k, ...).
  function logTicks(vMax) {
    var out = [], v = 10;
    while (v < vMax) { out.push(v); v *= 10; }
    return out;
  }

  // contact: { id, latest_velocity, slope_per_hour, accel,
  //            peak_in_hours, state }
  // pastPts: [[iso_ts, velocity, opportunity], ...] (real snapshots)
  // nowMs:   the "T+NOW" cursor time
  // Returns { past:[{h,v}], proj:[{h,v}], peak:{h,v}|null, cur:{h:0,v} }
  function contactGeometry(contact, pastPts, nowMs) {
    var v0 = contact.latest_velocity || 0;
    var s = contact.slope_per_hour || 0;
    var a = contact.accel || 0;
    var past = [];
    (pastPts || []).forEach(function (p) {
      var ms = Date.parse(p[0]);
      if (isNaN(ms)) { return; }
      past.push({ h: (ms - nowMs) / 3600000, v: p[1] });
    });
    var proj = [];
    for (var t = 0; t <= PROJ_HOURS; t += PROJ_STEP) {
      proj.push({ h: t, v: projectVelocity(v0, s, a, t) });
    }
    // End the curve where the model bottoms out: a long flat zero tail
    // would fake 40h of confident nothing. Keep the first zero point so
    // the endpoint lands on the floor honestly.
    for (var i = 1; i < proj.length; i++) {
      if (proj[i].v === 0) { proj = proj.slice(0, i + 1); break; }
    }
    var peak = null;
    var ph = (typeof contact.peak_in_hours === "number" &&
              isFinite(contact.peak_in_hours)) ? contact.peak_in_hours : null;
    if (ph !== null && ph >= 0 && ph <= PROJ_HOURS) {
      peak = { h: ph, v: projectVelocity(v0, s, a, ph) };
    }
    return { past: past, proj: proj, peak: peak, cur: { h: 0, v: v0 } };
  }

  // Compute shared scales across all contacts' geometries.
  function theatreScales(geoms) {
    var xMin = -1, vMax = 100;
    geoms.forEach(function (g) {
      g.past.forEach(function (p) { if (p.h < xMin) { xMin = p.h; } });
      g.past.forEach(function (p) { if (p.v > vMax) { vMax = p.v; } });
      g.proj.forEach(function (p) { if (p.v > vMax) { vMax = p.v; } });
    });
    xMin = Math.floor(xMin - 0.5);
    vMax = Math.ceil(vMax / 10) * 10;
    if (vMax < 100) { vMax = 100; }
    return { xMin: xMin, xMax: PROJ_HOURS, vMax: vMax };
  }

  // "NNh" / "Nd" countdown phrasing for the resolution queue.
  function countdown(ms) {
    if (!(ms > 0)) { return "due now"; }
    var h = Math.floor(ms / 3600000);
    if (h < 1) { return "under an hour"; }
    if (h < 48) { return "~" + h + "h"; }
    var d = Math.floor(h / 24);
    return "~" + d + "d " + (h % 24) + "h";
  }

  // Group ledger records by their 48h-window close day (real data).
  // records: [{ forecast_at }, ...]; horizonH = 48.
  function resolutionDays(records, horizonH) {
    var days = {};
    (records || []).forEach(function (r) {
      var ms = Date.parse(r.forecast_at);
      if (isNaN(ms)) { return; }
      var close = new Date(ms + (horizonH || 48) * 3600000);
      var day = close.toISOString().slice(0, 10);
      days[day] = (days[day] || 0) + 1;
    });
    return Object.keys(days).sort().map(function (day) {
      return { date: day, pending: days[day] };
    });
  }

  return {
    PROJ_HOURS: PROJ_HOURS,
    IGNITION_V: IGNITION_V,
    projectVelocity: projectVelocity,
    peakAt: peakAt,
    xPct: xPct,
    yPct: yPct,
    logFrac: logFrac,   // exported for the SVG mapper + unit tests
    logTicks: logTicks,
    contactGeometry: contactGeometry,
    theatreScales: theatreScales,
    countdown: countdown,
    resolutionDays: resolutionDays
  };
});
