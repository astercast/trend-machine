/* trend-machine — wave 27: pure Oracle Board rendering lib.
   Reads data/v1/oracle-board.json (built by scripts/build_oracle_board.js
   from the real ledger + merged snapshot stores) and renders the
   forecast-explorer board. Honest by construction:
     - pending calls render as PENDING — never dressed as verdicts
     - windows with <2 actual snapshots render as SHORT with their
       real point count — the board's warning state, not a footnote
     - sparklines draw only from the entry's stored trajectory and
       only at 3+ points (the site-wide sparkline contract); fewer
       points render the honest "history building" text
     - the hit rate appears only when the payload's status is
       "live" AND hit_rate is a number — exactly the scorecard's
       own contract, read from the payload, never recomputed here
   Pure functions, no DOM — unit-tested with pinned fixtures
   (scripts/test_oracle_board.js). Node-safe: exports when module exists. */
var TM_OracleBoard = (function () {
  "use strict";

  var SPARK_MIN_POINTS = 3; // same contract as assets/js/sparkline-lib.js

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function stateLabel(s) {
    var labels = { peaking: "Peaking", accelerating: "Accelerating",
                   rising: "Rising", fading: "Cooling off" };
    return labels[s] || s;
  }

  function pct(rate) {
    return (rate === null || rate === undefined) ? "—"
      : Math.round(rate * 100) + "%";
  }

  function fmtDay(iso) { return iso ? String(iso).slice(0, 10) : "—"; }

  function fmtTime(iso) {
    return iso ? String(iso).slice(0, 16).replace("T", " ") + " UTC" : "—";
  }

  function relDue(dueIso, nowMs) {
    if (!dueIso) { return "—"; }
    var ms = Date.parse(dueIso) - nowMs;
    if (!isFinite(ms)) { return "—"; }
    if (ms <= 0) { return "due"; }
    var h = ms / 3600000;
    if (h < 1) { return "in <1h"; }
    if (h < 48) { return "in " + Math.round(h) + "h"; }
    return "in " + Math.round(h / 24) + "d";
  }

  /* --- sparkline: stored points only, honest below 3 --------------- */
  function sparkSVG(trajectory, topicId) {
    var pts = trajectory || [];
    if (pts.length < SPARK_MIN_POINTS) {
      return '<span class="ob-building" title="Fewer than ' + SPARK_MIN_POINTS +
        ' stored snapshots for this topic">history building · ' +
        pts.length + " pt" + (pts.length === 1 ? "" : "s") + "</span>";
    }
    var W = 168, H = 42, PAD = 4;
    var vals = pts.map(function (p) { return p[1]; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var span = Math.max(1, hi - lo);
    var coords = vals.map(function (v, i) {
      var x = PAD + (i * (W - 2 * PAD) / (vals.length - 1));
      var y = H - PAD - ((v - lo) / span) * (H - 2 * PAD);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    var last = coords[coords.length - 1].split(",");
    var label = "Stored velocity trajectory for " + topicId + ": " +
      vals[0] + " at first snapshot, " + vals[vals.length - 1] +
      " at latest (" + vals.length + " snapshots).";
    return '<svg class="ob-spark" viewBox="0 0 ' + W + " " + H +
      '" role="img" aria-label="' + esc(label) + '" focusable="false">' +
      '<polyline points="' + coords.join(" ") + '" fill="none"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.6"/></svg>';
  }

  /* --- filtering / sorting (pure) ----------------------------------- */
  function filterEntries(entries, f) {
    f = f || {};
    var q = (f.query || "").trim().toLowerCase();
    return (entries || []).filter(function (e) {
      if (f.state && e.state !== f.state) { return false; }
      if (f.status && e.status !== f.status) { return false; }
      if (f.readiness === "ready" &&
          !(e.status === "pending" && e.window && e.window.ready)) { return false; }
      if (f.readiness === "short" &&
          !(e.status === "pending" && e.window && !e.window.ready)) { return false; }
      if (q && (e.title + " " + e.topic_id).toLowerCase().indexOf(q) < 0) {
        return false;
      }
      return true;
    });
  }

  function sortEntries(entries, sort) {
    var out = (entries || []).slice();
    if (sort === "velocity") {
      out.sort(function (a, b) {
        return (b.forecast_velocity - a.forecast_velocity) ||
               (Date.parse(a.due_at) - Date.parse(b.due_at));
      });
    } else if (sort === "window") {
      out.sort(function (a, b) {
        return (b.window.n_actual_points - a.window.n_actual_points) ||
               (Date.parse(a.due_at) - Date.parse(b.due_at));
      });
    } else if (sort === "title") {
      out.sort(function (a, b) {
        return String(a.title).localeCompare(String(b.title));
      });
    } else { // "due" — the board's default queue order
      out.sort(function (a, b) {
        return (Date.parse(a.due_at) - Date.parse(b.due_at)) ||
               (b.forecast_velocity - a.forecast_velocity);
      });
    }
    return out;
  }

  /* --- rendering ------------------------------------------------------ */
  function statusBadge(e) {
    if (e.status === "pending") {
      return '<span class="ob-badge is-pending">Pending</span>';
    }
    if (e.status === "hit") { return '<span class="ob-badge is-hit">Hit</span>'; }
    if (e.status === "miss") { return '<span class="ob-badge is-miss">Miss</span>'; }
    if (e.status === "unverifiable") {
      return '<span class="ob-badge is-unverifiable">Unverifiable</span>';
    }
    return '<span class="ob-badge">' + esc(e.status) + "</span>";
  }

  function windowCell(e) {
    var w = e.window || { n_actual_points: 0, ready: false };
    if (e.status !== "pending") {
      var v = e.verdict || {};
      var n = v.n_actual_points != null ? v.n_actual_points : w.n_actual_points;
      var cov = v.window_coverage_hours != null ? v.window_coverage_hours
        : w.coverage_hours;
      return '<span class="ob-window is-closed">' + n + " actuals · " +
        cov + "h coverage</span>";
    }
    if (w.ready) {
      return '<span class="ob-window is-ready">Ready · ' + w.n_actual_points +
        " actuals · " + w.coverage_hours + "h span</span>";
    }
    return '<span class="ob-window is-short">Short · ' + w.n_actual_points +
      " of 2 actuals</span>";
  }

  function rowHTML(e, nowMs) {
    var title = e.topic_live
      ? '<a href="topics/' + esc(e.topic_id) + '.html">' + esc(e.title) + "</a>"
      : esc(e.title) + ' <span class="ob-offboard">(left the board)</span>';
    var verdictLine = "";
    if (e.status !== "pending" && e.verdict) {
      verdictLine = '<p class="ob-verdict-line">' + esc(e.verdict.reason) + "</p>";
    }
    var slope = e.window && e.window.slope_per_hour != null
      ? (e.window.slope_per_hour >= 0 ? "+" : "") + e.window.slope_per_hour + "/hr"
      : "—";
    return '<article class="ob-row" data-topic="' + esc(e.topic_id) + '">' +
      '<div class="ob-cell ob-topic"><h3>' + title + "</h3>" +
        '<p class="ob-meta">called ' + fmtTime(e.forecast_at) + " · " +
        e.n_snapshots_at_forecast + " snapshots behind the call" +
        (e.confidence ? " · " + esc(e.confidence) + " confidence" : "") +
        "</p>" + verdictLine + "</div>" +
      '<div class="ob-cell ob-call"><span class="ob-state is-' + esc(e.state) +
        '">' + esc(stateLabel(e.state)) + "</span>" +
        '<span class="ob-vel num">v' + e.forecast_velocity + "</span></div>" +
      '<div class="ob-cell ob-traj">' + sparkSVG(e.trajectory, e.topic_id) +
        '<span class="ob-traj-meta num">' + e.trajectory_n +
        " stored pts · window slope " + slope + "</span></div>" +
      '<div class="ob-cell ob-win">' + windowCell(e) + "</div>" +
      '<div class="ob-cell ob-due"><span class="num">' + fmtDay(e.due_at) +
        "</span>" + '<span class="ob-rel">' + relDue(e.due_at, nowMs) +
        "</span></div>" +
      '<div class="ob-cell ob-status">' + statusBadge(e) + "</div>" +
      "</article>";
  }

  function summaryHTML(board, nowMs) {
    var c = board.counts || {};
    var live = board.status === "live" && c.hit_rate != null;
    var banner = live
      ? '<div class="ob-banner is-live" role="status"><h2>Live verdicts</h2>' +
        "<p>The Oracle's hit rate is <strong>" + pct(c.hit_rate) +
        "</strong> across " + c.resolved + " decisive resolutions (" +
        c.hits + " hits" +
        (c.unverifiable ? "; " + c.unverifiable +
          " unverifiable, excluded — not counted as misses" : "") +
        "). Every row below is the evidence behind that number.</p></div>"
      : '<div class="ob-banner is-building" role="status"><h2>Building history — ' +
        "no verdicts yet</h2><p><strong>" + c.recorded +
        "</strong> forecasts are on the board, every one still pending its " +
        "48h horizon. The first verdicts land <strong>" +
        fmtTime(board.next_resolution_at) +
        "</strong>. Until 10 forecasts resolve decisively, no hit rate " +
        "is claimed — the board shows the evidence gathering, row by row." +
        "</p></div>";
    var cards = [
      ["On the board", c.recorded, "recorded forecasts, one row each"],
      ["Pending", c.pending, "awaiting their 48h horizon"],
      ["Ready", c.ready, "pending windows already holding 2+ actuals"],
      ["Short", c.short, "pending windows under 2 actuals — shown as short"],
      ["Resolved", c.resolved, "scored hit or miss"],
      ["Unverifiable", c.unverifiable, "counted apart, never in the hit rate"]
    ].map(function (card) {
      return '<div class="ob-card"><span class="ob-card-num num">' + card[1] +
        '</span><span class="ob-card-label">' + card[0] +
        '</span><span class="ob-card-note">' + card[2] + "</span></div>";
    }).join("");
    return banner + '<div class="ob-cards">' + cards + "</div>";
  }

  function rowsHTML(board, filters, nowMs) {
    var rows = sortEntries(filterEntries(board.entries, filters),
                           filters && filters.sort);
    if (!rows.length) {
      return '<p class="ob-empty">No forecasts match this view. ' +
        "Nothing is hidden — loosen a filter and every recorded call " +
        "is back on the board.</p>";
    }
    return rows.map(function (e) { return rowHTML(e, nowMs); }).join("");
  }

  function boardHTML(board, nowMs) {
    return summaryHTML(board, nowMs) +
      '<div class="ob-table" role="list">' +
      rowsHTML(board, {}, nowMs) + "</div>";
  }

  var api = {
    SPARK_MIN_POINTS: SPARK_MIN_POINTS,
    esc: esc, stateLabel: stateLabel, pct: pct,
    fmtDay: fmtDay, fmtTime: fmtTime, relDue: relDue,
    sparkSVG: sparkSVG, filterEntries: filterEntries,
    sortEntries: sortEntries, statusBadge: statusBadge,
    windowCell: windowCell, rowHTML: rowHTML,
    summaryHTML: summaryHTML, rowsHTML: rowsHTML, boardHTML: boardHTML
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  return api;
})();
