/* trend-machine — wave 9: pure Oracle-scorecard rendering lib.
   Reads data/v1/forecast-accuracy.json + data/v1/forecasts.json and renders
   the "Forecast accuracy" view. Honest by construction: the ONLY accuracy
   ever shown comes from the ledger's resolved counts — with fewer than
   MIN_RESOLVED resolved the page says "building history" and hit_rate
   stays null. Nothing here invents accuracy.
   Wave 18 (Resolution Week): the view is ready for the first verdicts —
   unverifiable resolutions get their own count card and verdict styling
   (never dressed as misses), every resolution shows its reason and the
   observed coverage of its 48h window, the method table carries the
   unverifiable rule, and a readiness panel shows the exact next due
   time plus how many pending windows already hold enough actuals.
   Pure functions, no DOM — unit-tested with pinned fixtures
   (scripts/test_scorecard.js). Node-safe: exports when module exists. */
var TM_Scorecard = (function () {
  "use strict";

  var MIN_RESOLVED = 10; // same contract as scripts/build_forecasts.js

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pct(rate) {
    return rate === null || rate === undefined ? "—" : Math.round(rate * 100) + "%";
  }

  function stateLabel(s) {
    var labels = { peaking: "Peaking", accelerating: "Accelerating",
                   rising: "Rising", fading: "Cooling off" };
    return labels[s] || s;
  }

  // --- honesty contract ------------------------------------------------
  // The page is honest iff: (a) with < MIN_RESOLVED resolved, the status
  // says "building history" and no hit rate is shown; (b) with >= it shows
  // the measured rate. verdict(acc) -> {honest: bool, live: bool}.
  function verdict(acc) {
    var c = (acc && acc.counts) || { recorded: 0, pending: 0, resolved: 0, hits: 0 };
    var live = c.resolved >= MIN_RESOLVED;
    var status = acc ? acc.status : null;
    var rate = acc ? acc.hit_rate : undefined;
    var honest = live
      ? (status === "live" && rate !== null && rate !== undefined)
      : (status === "building history" && rate === null);
    return { honest: honest, live: live, resolved: c.resolved };
  }

  function statusBannerHTML(acc) {
    var v = verdict(acc);
    var c = (acc && acc.counts) || { recorded: 0, pending: 0, resolved: 0, hits: 0 };
    if (v.live) {
      var unv = c.unverifiable || 0;
      return '<div class="sc-banner is-live" role="status">' +
        "<h2>📊 Live scorecard</h2>" +
        "<p>The Oracle's hit rate is <strong>" + pct(acc.hit_rate) + "</strong> " +
        "across " + c.resolved + " resolved forecasts (" + c.hits + " hits" +
        (unv ? "; " + unv + " more came back unverifiable and are excluded, " +
               "not counted as misses" : "") + "). " +
        "Each forecast is judged against the actual velocity 48h later — " +
        "nothing is backfilled, nothing is cherry-picked.</p></div>";
    }
    return '<div class="sc-banner is-building" role="status">' +
      "<h2>📊 Building history</h2>" +
      "<p><strong>" + c.recorded + "</strong> forecasts recorded, " +
      "<strong>" + c.resolved + "</strong> resolved. " +
      "The Oracle shows its own hit rate after <strong>" + MIN_RESOLVED +
      "</strong> forecasts resolve — until then, no accuracy is claimed. " +
      "Each forecast is scored hit/miss against the actual velocity " +
      "48 hours later.</p></div>";
  }

  function countsHTML(acc) {
    var c = (acc && acc.counts) || { recorded: 0, pending: 0, resolved: 0, hits: 0 };
    var cards = [
      ["Recorded", c.recorded, "forecasts the Oracle has logged"],
      ["Pending", c.pending, "awaiting their 48h horizon"],
      ["Resolved", c.resolved, "scored hit or miss"],
      ["Hits", c.hits, "forecasts the actuals confirmed"],
      ["Unverifiable", c.unverifiable || 0,
       "horizon passed with too little data to judge — never counted as misses"]
    ];
    return '<div class="sc-counts">' + cards.map(function (cd) {
      return '<div class="sc-count"><span class="num">' + cd[1] + "</span>" +
        "<strong>" + cd[0] + "</strong><span>" + cd[2] + "</span></div>";
    }).join("") + "</div>";
  }

  function readinessHTML(acc, nowMs) {
    // Wave 18 — resolution-night readiness: the exact moment the next
    // verdicts land and whether the pending windows already hold the
    // 2+ actual snapshots a decisive verdict needs. Everything shown
    // comes from the payload (next_resolution_at, resolution_readiness,
    // both computed from the ledger + real snapshots at build time);
    // the relative "in ~Nh" is arithmetic on the viewer's clock.
    var next = acc && acc.next_resolution_at;
    var r = (acc && acc.resolution_readiness) || null;
    if (!next || !r || !r.pending) {
      return '<section class="sc-section sc-readiness" aria-labelledby="sc-ready">' +
        '<h2 id="sc-ready">Resolution readiness</h2>' +
        '<p class="oracle-empty">No forecasts are waiting on a horizon right now.</p></section>';
    }
    var due = new Date(next);
    var when = due.toUTCString().replace("GMT", "UTC");
    var rel = "";
    if (typeof nowMs === "number" && isFinite(nowMs)) {
      var diffH = (due.getTime() - nowMs) / 3600000;
      if (diffH > 1) { rel = " — in about " + Math.round(diffH) + " hours"; }
      else if (diffH > 0) { rel = " — in under an hour"; }
      else { rel = " — due now; verdicts land on the next pipeline run"; }
    }
    var max = Math.max(r.with_sufficient_data, r.awaiting_data, 1);
    return '<section class="sc-section sc-readiness" aria-labelledby="sc-ready">' +
      '<h2 id="sc-ready">Resolution readiness</h2>' +
      '<p class="oc-honest">The next verdicts land <strong>' + esc(when) + "</strong>" +
      esc(rel) + ", when the oldest pending forecasts cross their 48h horizon. " +
      "A forecast can only be graded if its window holds 2 or more actual " +
      "velocity snapshots; the bars below are the evidence position as of " +
      "the ledger's last update — topics still on the board keep gaining " +
      "snapshots until their horizon lands.</p>" +
      '<div class="sc-bars" role="img" aria-label="Pending forecasts by evidence: ' +
      r.with_sufficient_data + " already hold 2 or more snapshots in their window; " +
      r.awaiting_data + ' are still short of data">' +
      barRow("Ready to grade", r.with_sufficient_data, max, "pending") +
      barRow("Still short of data", r.awaiting_data, max, "pending") +
      "</div></section>";
  }

  function horizonTableHTML(acc) {
    // Wave 9: the ledger currently tracks ONE horizon (48h). The table is
    // honest: one row, the only horizon that exists, with null hit rate
    // while history builds.
    var horizon = (acc && acc.horizon_hours) || 48;
    var v = verdict(acc);
    var row = "<tr><td class=\"num\">" + horizon + "h</td>" +
      "<td>" + (v.live ? "Live" : "Building history") + "</td>" +
      "<td class=\"num\">" + pct(acc ? acc.hit_rate : null) + "</td></tr>";
    return '<section class="sc-section" aria-labelledby="sc-horizon">' +
      '<h2 id="sc-horizon">Per-horizon accuracy</h2>' +
      '<p class="oc-honest">The Oracle currently scores forecasts on a single ' +
      "48h horizon — the classifier's own projection window. New horizons " +
      "will appear here as rows, never as invented numbers.</p>" +
      '<table class="sc-table"><thead><tr><th scope="col">Horizon</th>' +
      '<th scope="col">Status</th><th scope="col">Hit rate</th></tr></thead>' +
      "<tbody>" + row + "</tbody></table></section>";
  }

  function byCallHTML(acc) {
    var byState = (acc && acc.by_state) || {};
    var rows = ["peaking", "accelerating", "rising", "fading"].map(function (s) {
      var b = byState[s] || { resolved: 0, hits: 0 };
      var rate = b.resolved >= MIN_RESOLVED ? (b.hits / b.resolved) : null;
      return "<tr><td>" + esc(stateLabel(s)) + "</td>" +
        '<td class="num">' + b.resolved + '</td><td class="num">' + b.hits + "</td>" +
        '<td class="num">' + pct(rate) + "</td></tr>";
    }).join("");
    return '<section class="sc-section" aria-labelledby="sc-bycall">' +
      '<h2 id="sc-bycall">By call type</h2>' +
      '<p class="oc-honest">Hit rate per forecast type appears only after ' +
      "that type has " + MIN_RESOLVED + " resolved forecasts — until then, " +
      "the row reads —, never 0%.</p>" +
      '<table class="sc-table"><thead><tr><th scope="col">Forecast</th>' +
      '<th scope="col">Resolved</th><th scope="col">Hits</th>' +
      '<th scope="col">Hit rate</th></tr></thead><tbody>' + rows +
      "</tbody></table></section>";
  }

  function recentHTML(acc) {
    var recent = (acc && acc.recent) || [];
    var body;
    if (!recent.length) {
      body = '<p class="oracle-empty">No forecasts have resolved yet. ' +
        "The ledger starts 2026-10-11; each forecast is scored 48h after " +
        "it's recorded, so the first resolutions land around " +
        "<strong>Oct 14, 2026</strong>. This table fills itself in.</p>";
    } else {
      var rows = recent.map(function (r) {
        var verdictClass = r.verdict === "hit" ? "is-hit"
          : r.verdict === "unverifiable" ? "is-unverifiable" : "is-miss";
        // link the dossier only while it exists (payload carries the
        // flag); a topic that left the board renders as plain text
        var title = r.topic_live === false
          ? esc(r.title) + ' <span class="sc-offboard">(left the board)</span>'
          : '<a href="topics/' + esc(r.topic_id) + '.html">' + esc(r.title) + "</a>";
        var slope = (r.actual_slope === null || r.actual_slope === undefined)
          ? "—"
          : (r.actual_slope >= 0 ? "+" : "") + esc(String(r.actual_slope)) + "/hr";
        // the verdict's evidence, on its face: why it graded this way
        // and how much of the 48h window was actually observed
        var evidence = esc(r.reason || "");
        if (r.n_actual_points !== null && r.n_actual_points !== undefined) {
          evidence += (evidence ? " · " : "") + r.n_actual_points +
            " actual snapshot" + (r.n_actual_points === 1 ? "" : "s");
        }
        if (r.window_coverage_hours !== null &&
            r.window_coverage_hours !== undefined) {
          evidence += " spanning " + esc(String(r.window_coverage_hours)) +
            "h of the 48h window";
        }
        return "<tr><td>" + title + "</td><td>" + esc(stateLabel(r.state)) + "</td>" +
          '<td class="num">' + esc(r.n_snapshots) + "</td>" +
          '<td class="' + verdictClass + '">' + esc(r.verdict) + "</td>" +
          '<td class="num">' + slope + "</td></tr>" +
          (evidence
            ? '<tr class="sc-evidence"><td colspan="5">' + evidence + "</td></tr>"
            : "");
      }).join("");
      body = '<table class="sc-table"><thead><tr><th scope="col">Topic</th>' +
        '<th scope="col">Forecast</th><th scope="col">Snapshots</th>' +
        '<th scope="col">Verdict</th><th scope="col">Actual slope</th>' +
        "</tr></thead><tbody>" + rows + "</tbody></table>" +
        '<p class="oc-honest">Every verdict carries its evidence: the rule ' +
        "that decided it, how many actual snapshots its window held, and " +
        "how much of the 48 hours they span. A verdict graded on a " +
        "partially observed window says so.</p>";
    }
    return '<section class="sc-section" aria-labelledby="sc-recent">' +
      '<h2 id="sc-recent">Recent resolutions</h2>' + body + "</section>";
  }

  function projectionsHTML(fc) {
    // Current projections for the next 48h — from forecasts.json, the same
    // precomputed lists the Oracle page shows. Every item is a projection,
    // labeled as such, with a link to the forecast page for the full list.
    if (!fc || !fc.counts) {
      return '<section class="sc-section" aria-labelledby="sc-now">' +
        '<h2 id="sc-now">Current projections · next 48h</h2>' +
        '<p class="oracle-empty">Forecasts unavailable — run the pipeline or ' +
        "check the connection.</p></section>";
    }
    var c = fc.counts;
    var top = (fc.peaking_48h || []).slice(0, 5);
    var items = top.map(function (p) {
      return '<li><a href="topics/' + esc(p.id) + '.html">' + esc(p.title) +
        '</a> <span class="num">v' + esc(String(p.latest_velocity)) + "</span></li>";
    }).join("");
    var body = "<ul>" + (items ||
      "<li>Nothing projecting a peak in the next 48h right now.</li>") + "</ul>";
    return '<section class="sc-section" aria-labelledby="sc-now">' +
      '<h2 id="sc-now">Current projections · next 48h</h2>' +
      '<p class="oc-honest">Live from the Oracle — projections from real ' +
      "snapshots, never guarantees. " +
      '<a href="oracle.html">Open the Oracle for the full lists →</a></p>' +
      '<div class="sc-counts">' +
      '<div class="sc-count"><span class="num">' + c.peaking_48h +
      "</span><strong>Peaking</strong><span>projected to top out within 48h</span></div>" +
      '<div class="sc-count"><span class="num">' + c.rising_fast +
      "</span><strong>Rising fast</strong><span>climbing, steepest first</span></div>" +
      '<div class="sc-count"><span class="num">' + c.cooling_off +
      "</span><strong>Cooling off</strong><span>fading — spend your week elsewhere</span></div>" +
      "</div>" + body + "</section>";
  }

  function methodHTML(acc) {
    var rules = (acc && acc.resolution_rules) || {};
    var rows = [
      ["Rising / accelerating",
       rules.rising_accelerating || "—"],
      ["Peaking", rules.peaking || "—"],
      ["Fading", rules.fading || "—"],
      ["Unverifiable", rules.unverifiable || "—"]
    ].map(function (r) {
      return "<tr><td>" + r[0] + "</td><td>" + esc(r[1]) + "</td></tr>";
    }).join("");
    return '<section class="sc-section" aria-labelledby="sc-method">' +
      '<h2 id="sc-method">How resolutions are scored</h2>' +
      '<p class="oc-honest">' + esc((acc && acc.method) || "") + "</p>" +
      '<table class="sc-table"><thead><tr><th scope="col">Forecast type</th>' +
      '<th scope="col">Counts as a hit when</th></tr></thead><tbody>' + rows +
      "</tbody></table>" +
      "<p class=\"oc-honest\">The bar is the classifier's own thresholds " +
      "(the same ±1.5/hr it uses to make the call) — the Oracle is graded " +
      "against its own rules.</p></section>";
  }

  function barRow(label, value, max, suffix) {
    var width = max > 0 ? Math.round((value / max) * 100) : 0;
    return '<div class="sc-bar-row"><span class="sc-bar-label">' + esc(label) +
      '</span><span class="sc-bar-track"><span class="sc-bar-fill" style="width:' +
      width + '%"></span></span><span class="num sc-bar-val">' + value +
      (suffix ? " " + esc(suffix) : "") + "</span></div>";
  }

  function timelineHTML(acc) {
    // Wave 9 — resolution timeline: when the pending forecasts' 48h
    // horizons land. Real ledger dates; the bars show the queue draining,
    // never a prediction of the outcomes.
    var rows = (acc && acc.upcoming_resolutions) || [];
    var body;
    if (!rows.length) {
      body = '<p class="oracle-empty">No pending forecasts in the ledger.</p>';
    } else {
      var max = Math.max.apply(null, rows.map(function (r) { return r.pending; }));
      body = '<div class="sc-bars" role="img" aria-label="Pending forecasts by resolution day: ' +
        esc(rows.map(function (r) { return r.date + ": " + r.pending; }).join("; ")) + '">' +
        rows.map(function (r) { return barRow(r.date, r.pending, max, "pending"); }).join("") +
        "</div>";
    }
    return '<section class="sc-section" aria-labelledby="sc-timeline">' +
      '<h2 id="sc-timeline">Resolution timeline</h2>' +
      '<p class="oc-honest">When the currently pending forecasts become ' +
      "judgeable — each bar is the day that batch's 48h horizon lands. " +
      "This is a queue schedule, not a prediction of hit or miss.</p>" + body +
      "</section>";
  }

  function activityHTML(acc) {
    // Wave 9 — ledger activity: forecasts recorded per day. The Oracle's
    // own pulse, from real ledger timestamps.
    var rows = (acc && acc.recorded_per_day) || [];
    var body;
    if (!rows.length) {
      body = '<p class="oracle-empty">No recording activity yet.</p>';
    } else {
      var max = Math.max.apply(null, rows.map(function (r) { return r.recorded; }));
      body = '<div class="sc-bars" role="img" aria-label="Forecasts recorded per day: ' +
        esc(rows.map(function (r) { return r.date + ": " + r.recorded; }).join("; ")) + '">' +
        rows.map(function (r) { return barRow(r.date, r.recorded, max, "recorded"); }).join("") +
        "</div>";
    }
    return '<section class="sc-section" aria-labelledby="sc-activity">' +
      '<h2 id="sc-activity">Ledger activity</h2>' +
      '<p class="oc-honest">How many decisive forecasts the Oracle logged ' +
      "each day — the ledger's own pulse.</p>" + body + "</section>";
  }

  function calibrationHTML(acc) {
    // Wave 9 — calibration: does the Oracle's claimed confidence match its
    // measured hit rate? Honest pre-resolution: every row reads "awaiting
    // data" until that confidence level has MIN_RESOLVED resolved forecasts.
    var bc = (acc && acc.by_confidence) || {};
    var rows = ["high", "medium", "low"].map(function (level) {
      var b = bc[level] || { resolved: 0, hits: 0 };
      var ready = b.resolved >= MIN_RESOLVED;
      var rate = ready ? (b.hits / b.resolved) : null;
      return "<tr><td>" + esc(level) + "</td>" +
        '<td class="num">' + b.resolved + '</td><td class="num">' + b.hits + "</td>" +
        '<td class="num">' + (ready ? pct(rate) : "awaiting data") + "</td></tr>";
    }).join("");
    return '<section class="sc-section" aria-labelledby="sc-calib">' +
      '<h2 id="sc-calib">Calibration — claimed confidence vs measured hits</h2>' +
      '<p class="oc-honest">A well-calibrated Oracle hits more often when it ' +
      'claims "high" confidence than "low". The verdict needs ' + MIN_RESOLVED +
      " resolved forecasts per confidence level — until then the row honestly " +
      "says awaiting data. Note: confidence here is the evidence basis " +
      "(snapshot count + fit quality), never a probability of being right.</p>" +
      '<table class="sc-table"><thead><tr><th scope="col">Claimed confidence</th>' +
      '<th scope="col">Resolved</th><th scope="col">Hits</th>' +
      '<th scope="col">Hit rate</th></tr></thead><tbody>' + rows +
      "</tbody></table></section>";
  }

  function pageHTML(acc, fc, nowMs) {
    return statusBannerHTML(acc) + countsHTML(acc) + readinessHTML(acc, nowMs) +
      projectionsHTML(fc) + timelineHTML(acc) + activityHTML(acc) +
      horizonTableHTML(acc) + byCallHTML(acc) + calibrationHTML(acc) +
      recentHTML(acc) + methodHTML(acc);
  }

  var api = {
    MIN_RESOLVED: MIN_RESOLVED,
    verdict: verdict,
    statusBannerHTML: statusBannerHTML,
    countsHTML: countsHTML,
    horizonTableHTML: horizonTableHTML,
    byCallHTML: byCallHTML,
    recentHTML: recentHTML,
    readinessHTML: readinessHTML,
    projectionsHTML: projectionsHTML,
    timelineHTML: timelineHTML,
    activityHTML: activityHTML,
    calibrationHTML: calibrationHTML,
    methodHTML: methodHTML,
    pageHTML: pageHTML,
    pct: pct
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  return api;
})();
