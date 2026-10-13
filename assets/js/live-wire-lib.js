/* trend-machine — wave 28: pure Live Wire rendering lib.
   Reads data/v1/live-wire.json (built by scripts/build_live_wire.js
   from the pipeline's own stored outputs) and renders the command
   view: lane health + the hour's movers. Honest by construction:
     - a degraded lane renders DEGRADED with its real 0 — never
       smoothed into "quiet"
     - a stale-skip lane renders its stored hits DATED and marked
       excluded from the current total — old hits never pose as new
     - skip-by-design lanes claim no hits and say why
     - movers show their real comparison span (never rounded to a
       fake "1h") and link only when the topic is on the board
   Pure functions, no DOM — unit-tested with pinned fixtures
   (scripts/test_live_wire.js). Node-safe: exports when module exists. */
var TM_LiveWire = (function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtTime(iso) {
    return iso ? String(iso).slice(0, 16).replace("T", " ") + " UTC" : "—";
  }

  function fmtDay(iso) { return iso ? String(iso).slice(0, 10) : "—"; }

  var STATUS_LABEL = {
    "live": "Live",
    "degraded": "Degraded",
    "stale-skip": "Stale · skip",
    "skip-by-design": "Skip by design"
  };

  function statusBadge(lane) {
    var label = STATUS_LABEL[lane.status] || lane.status;
    return '<span class="lw-badge is-' + esc(lane.status) + '">' +
      esc(label) + "</span>";
  }

  function laneHitsCell(lane) {
    if (lane.status === "live") {
      return '<span class="num lw-hits">' + lane.hits + " hits</span>" +
        '<span class="lw-hits-note">recorded this refresh</span>';
    }
    if (lane.status === "degraded") {
      return '<span class="num lw-hits">0 hits</span>' +
        '<span class="lw-hits-note">ran this refresh, recorded nothing</span>';
    }
    if (lane.status === "stale-skip") {
      var storedDay = lane.newest_fetched_at || lane.file_written_at;
      return '<span class="num lw-hits">' + lane.hits + " hits</span>" +
        '<span class="lw-hits-note">stored ' + fmtDay(storedDay) +
        " — NOT this refresh, excluded from the current total</span>";
    }
    return '<span class="num lw-hits">—</span>' +
      '<span class="lw-hits-note">no output file, no hits claimed</span>';
  }

  function laneRowHTML(lane) {
    var sources = (lane.sources || []).length
      ? '<span class="lw-sources num">' + esc(lane.sources.join(" · ")) + "</span>"
      : '<span class="lw-sources">no source labels recorded</span>';
    var stamp = lane.newest_fetched_at
      ? "newest hit " + fmtTime(lane.newest_fetched_at)
      : (lane.file_written_at
        ? "file written " + fmtTime(lane.file_written_at)
        : "no stored output");
    return '<article class="lw-row" data-lane="' + esc(lane.id) + '">' +
      '<div class="lw-cell lw-lane"><h3>' + esc(lane.label) + "</h3>" +
        '<p class="lw-meta"><code>' + esc(lane.fetcher) + "</code></p>" +
        '<p class="lw-detail">' + esc(lane.detail) + "</p></div>" +
      '<div class="lw-cell lw-status">' + statusBadge(lane) + "</div>" +
      '<div class="lw-cell lw-hitcell">' + laneHitsCell(lane) + "</div>" +
      '<div class="lw-cell lw-srccell">' + sources +
        '<span class="lw-stamp num">' + esc(stamp) + "</span></div>" +
      "</article>";
  }

  function lanesHTML(wire) {
    return (wire.lanes || []).map(laneRowHTML).join("");
  }

  function moverRowHTML(m, dir) {
    var title = m.topic_live
      ? '<a href="topics/' + esc(m.topic_id) + '.html">' + esc(m.title) + "</a>"
      : esc(m.title) + ' <span class="lw-offboard">(left the board)</span>';
    var delta = (m.delta > 0 ? "+" : "") + m.delta;
    return '<article class="lw-mover" data-topic="' + esc(m.topic_id) + '">' +
      '<div class="lw-mover-main"><h4>' + title + "</h4>" +
      '<p class="lw-meta num">v' + m.from_velocity + " → v" + m.to_velocity +
      " over " + m.span_hours + "h · " + fmtTime(m.from_ts) + " → " +
      fmtTime(m.to_ts) + " · " + m.n_points + " stored pts</p></div>" +
      '<span class="lw-delta is-' + dir + ' num">' + delta + "</span>" +
      "</article>";
  }

  function moversHTML(wire) {
    var mv = wire.movers || { gainers: [], fallers: [] };
    var c = wire.counts || {};
    var gain = (mv.gainers || []).map(function (m) {
      return moverRowHTML(m, "up");
    }).join("");
    var fall = (mv.fallers || []).map(function (m) {
      return moverRowHTML(m, "down");
    }).join("");
    if (!gain && !fall) {
      return '<p class="lw-empty">No topic holds a stored pair spanning ' +
        "about an hour yet — the wire shows movement only when the " +
        "snapshots themselves prove it.</p>";
    }
    // Wave 29 audit fix: the payload caps each list at 10 while the
    // banner counts every mover — the headings must disclose the cap
    // ("top 10 of 21"), never let 10 rows pose as the whole count.
    function capNote(shown, total) {
      return (typeof total === "number" && total > shown)
        ? " — top " + shown + " of " + total : "";
    }
    return '<div class="lw-movers">' +
      '<section aria-label="Top gainers"><h3 class="lw-movers-h is-up">' +
      "▲ Climbing" + capNote((mv.gainers || []).length, c.gainers) +
      "</h3>" + (gain ||
        '<p class="lw-empty">Nothing climbed on a proven ~1h pair.</p>') +
      "</section>" +
      '<section aria-label="Top fallers"><h3 class="lw-movers-h is-down">' +
      "▼ Cooling" + capNote((mv.fallers || []).length, c.fallers) +
      "</h3>" + (fall ||
        '<p class="lw-empty">Nothing cooled on a proven ~1h pair.</p>') +
      "</section></div>";
  }

  function summaryHTML(wire) {
    var c = wire.counts || {};
    var banner = '<div class="lw-banner" role="status"><h2>The wire at ' +
      fmtTime(wire.refresh_at) + "</h2><p><strong>" + c.current_hits +
      " hits</strong> recorded by the latest refresh across <strong>" +
      c.lanes_live + " live lanes</strong> — with the failures on the " +
      "same board: " + c.lanes_degraded + " degraded, " +
      c.lanes_stale_skip + " stale-skip (" + c.stale_hits_excluded +
      " old hits dated and excluded), " + c.lanes_skip_by_design +
      " skip-by-design. " + c.topics_live + " topics on the board; " +
      c.movers_with_hour_pair + " hold a proven ~1h movement pair (" +
      c.gainers + " climbing, " + c.fallers + " cooling, " + c.flat +
      " flat).</p></div>";
    var cards = [
      ["Current hits", c.current_hits, "recorded by the latest refresh only"],
      ["Live lanes", c.lanes_live, "of " + c.lanes + " lanes wired into refresh.sh"],
      ["Degraded", c.lanes_degraded, "ran, recorded 0 — shown as degraded"],
      ["Stale · skip", c.lanes_stale_skip, "not rewritten last refresh — hits dated, excluded"],
      ["Skip by design", c.lanes_skip_by_design, "TikTok + X — no data, never faked"],
      ["Movers", c.gainers + c.fallers, "proven ~1h pairs: " + c.gainers + " up · " + c.fallers + " down · " + c.flat + " flat"]
    ].map(function (card) {
      return '<div class="lw-card"><span class="lw-card-num num">' + card[1] +
        '</span><span class="lw-card-label">' + card[0] +
        '</span><span class="lw-card-note">' + card[2] + "</span></div>";
    }).join("");
    return banner + '<div class="lw-cards">' + cards + "</div>";
  }

  var api = {
    esc: esc, fmtTime: fmtTime, fmtDay: fmtDay,
    STATUS_LABEL: STATUS_LABEL, statusBadge: statusBadge,
    laneHitsCell: laneHitsCell, laneRowHTML: laneRowHTML,
    lanesHTML: lanesHTML, moverRowHTML: moverRowHTML,
    moversHTML: moversHTML, summaryHTML: summaryHTML
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  return api;
})();
