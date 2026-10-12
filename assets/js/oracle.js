/* ============================================================
   TREND MACHINE — oracle.js (wave 3 · "Oracle" flagship)
   Forecasting view: classifies every topic from its real
   velocity-history snapshots (assets/js/trajectory.js) and
   renders the three forecast lists — "Peaking in the next
   48h", "Rising fast", "Cooling off".

   Honest by construction: every prediction is labeled a
   projection from N snapshots, never a guarantee. Topics with
   fewer than 3 snapshots are excluded from the lists, and when
   none qualify the page says forecasts unlock after N more
   hourly refreshes instead of faking predictions.
   ============================================================ */
(function () {
  "use strict";

  var TRENDS_URL = "api/v1/trends.json";
  var HIST_URL = "data/velocity_history.json";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function trajMeta(state) {
    // arrow, css class, human label
    switch (state) {
      case "accelerating": return { arrow: "▲▲", cls: "t-acc", label: "Accelerating" };
      case "rising":       return { arrow: "▲",  cls: "t-rise", label: "Rising" };
      case "peaking":      return { arrow: "⌁",  cls: "t-peak", label: "Peaking" };
      case "fading":       return { arrow: "▼",  cls: "t-fade", label: "Cooling" };
      default:             return { arrow: "●",  cls: "t-steady", label: "Steady" };
    }
  }

  function miniSpark(points) {
    // Tiny SVG sparkline from real snapshots (needs >=2 points).
    if (!points || points.length < 2) { return ""; }
    var W = 120, H = 34, PAD = 3;
    var vals = points.slice(-12).map(function (p) { return p[1]; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var span = Math.max(1, hi - lo);
    var coords = vals.map(function (v, i) {
      var x = PAD + (i * (W - 2 * PAD) / Math.max(1, vals.length - 1));
      var y = H - PAD - ((v - lo) / span) * (H - 2 * PAD);
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    var aria = "Velocity moved from " + vals[0] + " to " + vals[vals.length - 1] +
               " across " + vals.length + " snapshots.";
    return '<svg class="mini-spark" viewBox="0 0 ' + W + " " + H + '" role="img" ' +
           'aria-label="' + esc(aria) + '" focusable="false">' +
           '<polyline points="' + coords + '" fill="none"/></svg>';
  }

  function cardHTML(item) {
    var t = item.topic, a = item.analysis;
    var m = trajMeta(a.state);
    var honest = "Projection from " + a.n + " snapshot" +
                 (a.n === 1 ? "" : "s") + " — not a guarantee.";
    var peakLine = "";
    if (a.state === "peaking") {
      peakLine = a.peakInHours === 0
        ? "Projected peak: now / just crested."
        : "Projected peak in ~" + Math.round(a.peakInHours) + "h.";
    }
    return '<article class="oracle-card ' + m.cls + '" role="listitem">' +
      '<div class="oc-top"><span class="traj-arrow" aria-hidden="true">' + m.arrow + "</span>" +
      '<h3 class="oc-title"><a href="topics/' + esc(t.id) + '.html">' + esc(t.title) + "</a></h3></div>" +
      '<p class="oc-sum">' + esc(a.summary) + ". " + esc(peakLine) + "</p>" +
      '<div class="oc-spark-row">' + miniSpark(item.points) +
      '<span class="oc-nums num">v' + a.latestVelocity + " · " +
      (a.slopePerHour >= 0 ? "+" : "") + a.slopePerHour.toFixed(1) + "/hr</span></div>" +
      '<p class="oc-honest">' + esc(honest) + "</p>" +
      '<div class="oc-actions"><a class="btn btn-sm" href="launch-plan.html?topic=' + esc(t.id) + '">🗓 7-day battle plan</a></div>' +
      "</article>";
  }

  function listHTML(title, kicker, items, emptyNote) {
    var body = items.length
      ? items.map(cardHTML).join("")
      : '<p class="oracle-empty">' + esc(emptyNote) + "</p>";
    var id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return '<section class="oracle-list" aria-labelledby="' + id + '">' +
      '<div class="section-head"><h2 id="' + id + '">' + esc(title) + "</h2>" +
      '<span class="kicker">' + esc(kicker) + "</span></div>" +
      '<div class="oracle-grid" role="list">' + body + "</div></section>";
  }

  function showFallback(statusEl, maxN) {
    var need = Math.max(1, Trajectory.MIN_POINTS - maxN);
    statusEl.innerHTML =
      '<div class="oracle-fallback" role="note">' +
      "<h2>🔮 Forecasts are warming up</h2>" +
      "<p>The Oracle reads hourly velocity snapshots, and velocity tracking " +
      "only just started. Forecasts unlock after <strong>" + need +
      " more hourly refresh" + (need === 1 ? "" : "es") + "</strong> — " +
      "that's when every topic has the " + Trajectory.MIN_POINTS +
      " snapshots a projection needs.</p>" +
      '<p class="oc-honest">No fake predictions below. Check back after a ' +
      "few refresh cycles — the dashboard's signal-history sparklines " +
      "already show the raw data.</p></div>";
  }

  function init() {
    var statusEl = document.getElementById("oracle-status");
    var main = document.getElementById("oracle-main");
    if (!statusEl || !main) { return; }
    Promise.all([
      fetch(TRENDS_URL).then(function (r) { if (!r.ok) { throw new Error("trends"); } return r.json(); }),
      fetch(HIST_URL).then(function (r) { if (!r.ok) { throw new Error("history"); } return r.json(); })
    ]).then(function (res) {
      var topics = res[0].topics || [];
      var hist = res[1] || {};
      var byId = {};
      topics.forEach(function (t) { byId[t.id] = t; });

      var results = [], maxN = 0, qualifying = 0;
      Object.keys(hist).forEach(function (id) {
        var pts = hist[id] || [];
        if (pts.length > maxN) { maxN = pts.length; }
        var analysis = Trajectory.analyze(pts);
        if (analysis.state !== "insufficient") { qualifying++; }
        if (byId[id]) {
          results.push({ topic: byId[id], analysis: analysis, points: pts });
        }
      });

      var countsEl = document.getElementById("oracle-counts");
      if (countsEl) {
        countsEl.textContent = qualifying + " of " + results.length +
          " topics have enough history for a forecast.";
      }

      if (!qualifying) {
        showFallback(statusEl, maxN);
        return;
      }
      statusEl.hidden = true;
      var lists = Trajectory.rankLists(results);
      main.innerHTML =
        listHTML("⏳ Peaking in the next 48h", "hot + topping out — act fast",
                 lists.peaking.slice(0, 12),
                 "Nothing projecting a peak in the next 48h right now.") +
        listHTML("🚀 Rising fast", "climbing, steepest first",
                 lists.rising.slice(0, 12),
                 "No topic is clearly rising on its trajectory right now.") +
        listHTML("❄️ Cooling off", "fading — spend your week elsewhere",
                 lists.cooling.slice(0, 12),
                 "Nothing is clearly fading right now.") +
        '<p class="oracle-method">How this works: the Oracle fits a slope to ' +
        'each topic\'s recent hourly velocity snapshots and compares the ' +
        'slope of the first half to the second half. Rising + steepening = ' +
        'accelerating. Hot + decelerating = projected peak (peak hour ' +
        'estimated from the parabola vertex). Falling = cooling off. ' +
        "Steady topics are left out — no signal, no slot. Every forecast " +
        "is a projection from real snapshots, not a guarantee.</p>";
    }).catch(function () {
      statusEl.innerHTML =
        '<div class="oracle-fallback" role="alert"><h2>Couldn\'t load the data</h2>' +
        "<p>The Oracle needs api/v1/trends.json and data/velocity_history.json. " +
        "Run pipeline/refresh.sh or check the connection.</p></div>";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
