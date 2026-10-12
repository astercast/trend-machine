/* trend-machine — wave 8: pure client-side sparkline lib.
   Same math + honesty contract as scripts/sparkline_prep.py (Python):
   series need >= MIN_POINTS snapshots to draw; fewer render the honest
   "building" text — never a fake line. Static SVG (no animation) so it is
   reduced-motion safe; role="img" + data-grounded aria-label.
   Pure functions, no DOM — unit-tested with pinned fixtures
   (scripts/test_sparkline_lib.js). Node-safe: exports when module exists. */
var TM_Sparkline = (function () {
  "use strict";

  var MIN_POINTS = 3;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function prep(points, width, height, pad) {
    width = width || 120; height = height || 30; pad = (pad == null ? 4 : pad);
    var pts = points || [];
    var vals = pts.map(function (p) { return p[1]; });
    var n = pts.length;
    var out = {
      n: n, ready: n >= MIN_POINTS, width: width, height: height,
      first: vals.length ? vals[0] : null,
      last: vals.length ? vals[vals.length - 1] : null,
      delta: vals.length >= 2 ? vals[vals.length - 1] - vals[0] : 0,
      coords: []
    };
    if (n >= 2) {
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      var span = Math.max(1, hi - lo);
      out.coords = vals.map(function (v, i) {
        var x = pad + (i * (width - 2 * pad) / (n - 1));
        var y = height - pad - ((v - lo) / span) * (height - 2 * pad);
        return x.toFixed(1) + "," + y.toFixed(1);
      });
    }
    return out;
  }

  function svg(points, opts) {
    opts = opts || {};
    var p = prep(points, opts.width, opts.height, opts.pad);
    if (!p.ready || !p.coords.length) { return ""; }
    var label = (opts.labelPrefix || "Velocity trend") + ": " + p.first +
      " at first snapshot, " + p.last + " at latest (" + p.n + " snapshots).";
    var dot = "";
    if (opts.lastDot !== false) {
      var last = p.coords[p.coords.length - 1].split(",");
      dot = '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.6"/>';
    }
    return '<svg class="' + esc(opts.cssClass || "spark spark-mini") +
      '" viewBox="0 0 ' + p.width + " " + p.height + '" role="img" ' +
      'aria-label="' + esc(label) + '" focusable="false">' +
      '<polyline points="' + p.coords.join(" ") + '" fill="none"/>' + dot + "</svg>";
  }

  /* Cell content for the dashboard table: sparkline or honest building text. */
  function cellHTML(points, topicId) {
    var p = prep(points);
    if (!p.ready) {
      return '<span class="spark-building" title="Fewer than ' + MIN_POINTS +
        ' velocity snapshots so far">history building</span>';
    }
    var d = p.delta;
    var arrow = d > 0 ? "▲" : (d < 0 ? "▼" : "●");
    return svg(points, { labelPrefix: "Velocity trend for " + topicId }) +
      '<span class="visually-hidden"> ' + esc(arrow) + " " + (d >= 0 ? "+" : "") +
      d + " since tracking started.</span>";
  }

  var api = { MIN_POINTS: MIN_POINTS, prep: prep, svg: svg, cellHTML: cellHTML };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  return api;
})();
