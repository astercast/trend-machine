/* ============================================================
   TREND MACHINE — lifecycle-lib.js (wave 17 · Oracle layer 2)
   The ignition/burnout layer: classify every snapshot of a topic's
   real velocity history into a lifecycle stage, so the war-room can
   show trends IGNITING and BURNING OUT — not just where each curve
   sits, but how it got there.

   Stages (from the classifier's own thresholds — no new magic):
     building    <3 snapshots — the honest "not yet" state
     steady      |slope| < 1.5/hr, nothing moving
     warming     climbing below the ignition line (slope >= 1.5, v < 70)
     igniting    hot and still climbing (v >= 70, slope >= 1.5)
     peaking     hot and flattening (v >= 70, |slope| < 1.5)
     cooling     falling (slope <= -1.5) from any level
     burned-out  cold again after a hot run (v < 20, max v ever >= 70)

   IGNITION_V = 70 is the war-room's own ignition line (warroom-lib.js);
   RISE/FALL = ±1.5/hr are trajectory.js's classifier thresholds.

   UMD: browser global (window.LifecycleLib) + CommonJS for tests and
   the build_forecasts.js node step. Node-safe: no DOM.
   ============================================================ */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LifecycleLib = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var IGNITION_V = 70;    // the war-room's ignition line
  var BURNOUT_V = 20;     // cold enough to call the run over
  var RISE = 1.5;         // velocity-points/hour that counts as climbing
  var FALL = -1.5;        // ...as falling
  var MIN_POINTS = 3;     // honest floor, same as the classifier

  // snapshots: [[iso_ts, velocity, opportunity], ...] (real pipeline data)
  function velocityAt(snapshots, i) {
    var p = snapshots[i];
    if (!p) { return null; }
    var v = Array.isArray(p) ? p[1] : p.velocity;
    return (typeof v === "number" && isFinite(v)) ? v : null;
  }
  function tsAt(snapshots, i) {
    var p = snapshots[i];
    if (!p) { return null; }
    return Array.isArray(p) ? p[0] : p.ts;
  }

  // Local per-hour slope between snapshot i-1 and i. null when the
  // pair is unusable (bad timestamps) — callers treat it as 0.
  function localSlope(snapshots, i) {
    if (i < 1) { return null; }
    var v1 = velocityAt(snapshots, i), v0 = velocityAt(snapshots, i - 1);
    var t1 = Date.parse(tsAt(snapshots, i)), t0 = Date.parse(tsAt(snapshots, i - 1));
    if (v1 === null || v0 === null || isNaN(t1) || isNaN(t0)) { return null; }
    var dtH = (t1 - t0) / 3600000;
    if (!(dtH > 0)) { return null; }
    return (v1 - v0) / dtH;
  }

  // Classify ONE snapshot (index i) given the max velocity seen UP TO i
  // (a snapshot can't be "burned out" from a peak it hasn't reached yet).
  function stageAt(snapshots, i, maxVSoFar) {
    var v = velocityAt(snapshots, i);
    if (v === null) { return "building"; }
    var s = localSlope(snapshots, i);
    var slope = (s === null || !isFinite(s)) ? 0 : s;
    if (v >= IGNITION_V) {
      if (slope >= RISE) { return "igniting"; }
      if (slope <= FALL) { return "cooling"; }
      return "peaking";
    }
    if (maxVSoFar >= IGNITION_V && v < BURNOUT_V) { return "burned-out"; }
    if (slope >= RISE) { return "warming"; }
    if (slope <= FALL) { return "cooling"; }
    return "steady";
  }

  // Classify the whole series → one stage per snapshot. The first two
  // points have no local slope, so they inherit the first classifiable
  // stage (i=2) — backfill from real data, never invented.
  function classifySeries(snapshots) {
    snapshots = snapshots || [];
    var n = snapshots.length;
    if (n < MIN_POINTS) {
      var b = [];
      for (var k = 0; k < n; k++) { b.push("building"); }
      return b;
    }
    var maxV = 0, stages = new Array(n);
    for (var i = 2; i < n; i++) {
      for (var j = 0; j <= i; j++) {
        var vj = velocityAt(snapshots, j);
        if (vj !== null && vj > maxV) { maxV = vj; }
      }
      stages[i] = stageAt(snapshots, i, maxV);
    }
    stages[0] = stages[2];
    if (n > 1) { stages[1] = stages[2]; }
    return stages;
  }

  // The topic's current stage + when it entered it.
  function currentStage(snapshots) {
    snapshots = snapshots || [];
    var stages = classifySeries(snapshots);
    if (!stages.length) { return { stage: "building", since: null }; }
    var cur = stages[stages.length - 1], since = tsAt(snapshots, snapshots.length - 1);
    for (var i = stages.length - 1; i >= 0; i--) {
      if (stages[i] !== cur) { break; }
      since = tsAt(snapshots, i);
    }
    return { stage: cur, since: since };
  }

  // Stage transitions inside the window: [{from, to, ts}]. Powers the
  // IGNITIONS / BURNOUTS boards.
  function transitionsInWindow(snapshots, windowHours, nowMs) {
    snapshots = snapshots || [];
    windowHours = windowHours || 24;
    var cutoff = (nowMs || Date.now()) - windowHours * 3600000;
    var stages = classifySeries(snapshots);
    var out = [];
    for (var i = 1; i < stages.length; i++) {
      if (stages[i] === stages[i - 1]) { continue; }
      var ts = tsAt(snapshots, i);
      var ms = Date.parse(ts);
      if (isNaN(ms) || ms < cutoff) { continue; }
      out.push({ from: stages[i - 1], to: stages[i], ts: ts });
    }
    return out;
  }

  // Whole-store summary for the lifecycle board.
  // hist: { id: snapshots }. nowMs optional (tests pin time).
  function summarize(hist, nowMs) {
    hist = hist || {};
    var counts = {}, ignitions = [], burnouts = [], topics = {};
    Object.keys(hist).forEach(function (id) {
      var snaps = hist[id] || [];
      var cur = currentStage(snaps);
      counts[cur.stage] = (counts[cur.stage] || 0) + 1;
      var ribbon = classifySeries(snaps).slice(-24);
      topics[id] = { stage: cur.stage, since: cur.since, ribbon: ribbon };
      transitionsInWindow(snaps, 24, nowMs).forEach(function (tr) {
        var row = { id: id, from: tr.from, to: tr.to, ts: tr.ts };
        if (tr.to === "igniting" || tr.to === "peaking") { ignitions.push(row); }
        if (tr.to === "cooling" || tr.to === "burned-out") { burnouts.push(row); }
      });
    });
    var byTs = function (a, b) { return Date.parse(b.ts) - Date.parse(a.ts); };
    ignitions.sort(byTs);
    burnouts.sort(byTs);
    return { counts: counts, ignitions: ignitions, burnouts: burnouts, topics: topics };
  }

  return {
    IGNITION_V: IGNITION_V,
    BURNOUT_V: BURNOUT_V,
    RISE: RISE,
    FALL: FALL,
    MIN_POINTS: MIN_POINTS,
    classifySeries: classifySeries,
    currentStage: currentStage,
    transitionsInWindow: transitionsInWindow,
    summarize: summarize,
    localSlope: localSlope   // exported for unit tests
  };
});
