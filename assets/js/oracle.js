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
  var PHIST_URL = "data/platform_velocity_history.json"; // wave 6, best-effort
  var ACC_URL = "api/v1/forecast-accuracy.json";         // wave 6, best-effort

  function getJSON(url, optional) {
    return fetch(url).then(function (r) {
      if (!r.ok) { throw new Error(url); }
      return r.json();
    }).catch(function () {
      if (optional) { return null; }
      throw new Error(url);
    });
  }

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
    var en = item.enriched || { confidence: null, signals: null, per_platform: {} };
    var m = trajMeta(a.state);
    var honest = "Projection from " + a.n + " snapshot" +
                 (a.n === 1 ? "" : "s") + " — not a guarantee.";
    var peakLine = "";
    if (a.state === "peaking") {
      peakLine = a.peakInHours === 0
        ? "Projected peak: now / just crested."
        : "Projected peak in ~" + Math.round(a.peakInHours) + "h.";
    }

    // Wave 6 — confidence display
    var confHTML = "";
    if (en.confidence) {
      confHTML = '<p class="oc-conf"><span class="oc-chip oc-conf-' + en.confidence.level +
        '">confidence: ' + en.confidence.level + "</span> " +
        esc(en.confidence.basis) + "</p>";
    }

    // Wave 6 — "why this is peaking" signal attribution
    var whyHTML = "";
    if (en.signals) {
      var s = en.signals;
      var chips = [];
      var d = s.velocity_delta;
      chips.push("velocity " + (d >= 0 ? "+" : "") + d + " over " + a.n + " snapshots");
      chips.push("slope " + (s.slope_per_hour >= 0 ? "+" : "") + s.slope_per_hour.toFixed(1) + "/hr");
      chips.push("accel " + (s.accel >= 0 ? "+" : "") + s.accel.toFixed(2) + "/hr\u00B2");
      chips.push(s.platform_spread + " platform" + (s.platform_spread === 1 ? "" : "s") +
                 (s.platforms.length ? " (" + s.platforms.join(", ") + ")" : ""));
      chips.push(s.recency_hours === null ? "no snapshots yet"
        : "last snapshot " + s.recency_hours + "h ago");
      var chipHTML = chips.map(function (c) {
        return '<span class="oc-chip">' + esc(c) + "</span>";
      }).join("");
      var driversHTML = (s.drivers || []).map(function (dr) {
        return "<li>" + esc(dr) + "</li>";
      }).join("");
      whyHTML = '<div class="oc-why"><span class="oc-why-label">Why this call:</span> ' +
        '<span class="oc-chips">' + chipHTML + "</span>" +
        '<details class="oc-drivers"><summary>Which thresholds fired</summary><ul>' +
        driversHTML + "</ul></details></div>";
    }

    // Wave 6 — per-platform trajectories (only where the data supports it)
    var platHTML = "";
    var pp = en.per_platform || {};
    var platKeys = Object.keys(pp).filter(function (p) { return pp[p].n >= 1; });
    if (platKeys.length) {
      var parts = platKeys.map(function (p) {
        var pa = pp[p];
        var pm = trajMeta(pa.state);
        var label = pa.state === "insufficient"
          ? "building history (" + pa.n + " snapshot" + (pa.n === 1 ? "" : "s") + ")"
          : pm.label.toLowerCase() + " " + pm.arrow + " (" + pa.n + " snapshots)";
        return "<strong>" + esc(p) + ":</strong> " + esc(label);
      });
      platHTML = '<p class="oc-plat"><span class="oc-why-label">Per platform:</span> ' +
        parts.join(' <span aria-hidden="true">·</span> ') + "</p>";
    }

    return '<article class="oracle-card ' + m.cls + '" role="listitem">' +
      '<div class="oc-top"><span class="traj-arrow" aria-hidden="true">' + m.arrow + "</span>" +
      '<h3 class="oc-title"><a href="topics/' + esc(t.id) + '.html">' + esc(t.title) + "</a></h3></div>" +
      '<p class="oc-sum">' + esc(a.summary) + ". " + esc(peakLine) + "</p>" +
      confHTML + whyHTML + platHTML +
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

  function accuracyHTML(acc) {
    // Wave 6 — the Oracle's own scorecard. Honest by construction: until
    // 10 forecasts resolve, the status is "building history" and no hit
    // rate is shown.
    if (!acc) { return ""; }
    var c = acc.counts || { recorded: 0, pending: 0, resolved: 0, hits: 0 };
    var body;
    if (acc.status === "live" && acc.hit_rate !== null) {
      var pct = Math.round(acc.hit_rate * 100);
      var byState = acc.by_state || {};
      var parts = Object.keys(byState).map(function (s) {
        var b = byState[s];
        return esc(s) + " " + b.hits + "/" + b.resolved;
      });
      body = "<p><strong>Hit rate: " + pct + "%</strong> across " + c.resolved +
        " resolved forecasts (" + c.hits + " hits). By call: " + parts.join(" · ") + ".</p>";
    } else {
      body = "<p><strong>Building history</strong> — " + c.recorded + " forecast" +
        (c.recorded === 1 ? "" : "s") + " recorded, " + c.resolved + " resolved. " +
        "The Oracle shows its own hit rate after 10 forecasts resolve " +
        "(each is judged against the actual velocity 48h later).</p>";
    }
    return '<section class="oracle-accuracy" aria-labelledby="acc-title">' +
      '<h2 id="acc-title">📊 The Oracle&#39;s own scorecard</h2>' + body +
      '<p class="oc-honest">Recorded from 2026-10-11 — nothing backfilled. ' +
      "The first resolutions land 48h after recording starts.</p></section>";
  }

  function init() {
    var statusEl = document.getElementById("oracle-status");
    var main = document.getElementById("oracle-main");
    if (!statusEl || !main) { return; }
    Promise.all([
      getJSON(TRENDS_URL),
      getJSON(HIST_URL),
      getJSON(PHIST_URL, true),
      getJSON(ACC_URL, true)
    ]).then(function (res) {
      var topics = res[0].topics || [];
      var hist = res[1] || {};
      var phist = res[2] || {};
      var acc = res[3];
      var byId = {};
      topics.forEach(function (t) { byId[t.id] = t; });
      var nowMs = Date.now();

      var results = [], maxN = 0, qualifying = 0;
      Object.keys(hist).forEach(function (id) {
        var pts = hist[id] || [];
        if (pts.length > maxN) { maxN = pts.length; }
        var topic = byId[id] || { id: id, title: id, platforms: [] };
        var enriched = Trajectory.enrich({
          id: topic.id, title: topic.title,
          platforms: topic.platforms || [],
          platform_points: phist[id] || {}
        }, pts, nowMs);
        if (enriched.analysis.state !== "insufficient") { qualifying++; }
        if (byId[id]) {
          results.push({ topic: byId[id], analysis: enriched.analysis,
                          points: pts, enriched: enriched });
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
        accuracyHTML(acc) +
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
        "is a projection from real snapshots, not a guarantee. Each card " +
        "shows its confidence basis (snapshot count + fit quality), the " +
        "signals that drove the call, and — where per-platform history " +
        "exists — a per-platform split. The scorecard above is the Oracle's " +
        "own forecast-vs-actual record.</p>";
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
