/* trend-machine, wave 28: pure Live Wire rendering lib.
   Reads data/v1/live-wire.json (built by scripts/build_live_wire.js
   from the pipeline's own stored outputs) and renders the command
   view: lane health + the hour's movers. Honest by construction:
     - a degraded lane renders DEGRADED with its real 0, never
       smoothed into "quiet"
     - a stale-skip lane renders its stored hits DATED and marked
       excluded from the current total, old hits never pose as new
     - skip-by-design lanes claim no hits and say why
     - movers show their real comparison span (never rounded to a
       fake "1h") and link only when the topic is on the board
   Pure functions, no DOM, unit-tested with pinned fixtures
   (scripts/test_live_wire.js). Node-safe: exports when module exists. */
var TM_LiveWire = (function () {
  "use strict";

  function normT(s) {
    var out = String(s == null ? "" : s).replace(/\s+[\u2014\u2013]\s+/g, ", ").replace(/[\u2014\u2013]/g, "-");
    /* user order 2026-10-14 (absolute): no percentage uplift in
       presented copy, not even inside a recorded title. Display layer
       only; the stored record stays byte-true. Mirrors _strip_uplift. */
    out = out.replace(/\(\s*(?:up\s*)?\+\d[\d,]*(?:\.\d+)?%[^)]*\)/gi, "")
      .replace(/\s\+\d[\d,]*(?:\.\d+)?%/g, "")
      .replace(/\bup\s+\d[\d,]*(?:\.\d+)?%/gi, "")
      .replace(/\s{2,}/g, " ").replace(/^\s+|\s+$/g, "").replace(/[\s\u00b7]+$/, "");
    return out;
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtTime(iso) {
    return iso ? String(iso).slice(0, 16).replace("T", " ") + " UTC" : ", ";
  }

  function fmtDay(iso) { return iso ? String(iso).slice(0, 10) : ", "; }

  var STATUS_LABEL = {
    "live": "Working",
    "degraded": "Found nothing",
    "stale-skip": "Out of date",
    "skip-by-design": "Off on purpose",
    "retired": "Retired"
  };

  function statusBadge(lane) {
    var label = STATUS_LABEL[lane.status] || lane.status;
    return '<span class="lw-badge is-' + esc(lane.status) + '">' +
      esc(label) + "</span>";
  }

  function laneHitsCell(lane) {
    if (lane.status === "live") {
      return '<span class="num lw-hits">' + lane.hits + " finds</span>" +
        '<span class="lw-hits-note">found on the latest check</span>';
    }
    if (lane.status === "degraded") {
      return '<span class="num lw-hits">0 finds</span>' +
        '<span class="lw-hits-note">checked, found nothing</span>';
    }
    if (lane.status === "stale-skip") {
      var storedDay = lane.newest_fetched_at || lane.file_written_at;
      return '<span class="num lw-hits">' + lane.hits + " finds</span>" +
        '<span class="lw-hits-note">from ' + fmtDay(storedDay) +
        ", not the latest check, not counted in the totals</span>";
    }
    if (lane.status === "retired") {
      return '<span class="num lw-hits">no finds</span>' +
        '<span class="lw-hits-note">retired, out of the loop, claims none</span>';
    }
    return '<span class="num lw-hits">no finds</span>' +
      '<span class="lw-hits-note">off on purpose, claims none</span>';
  }

  function laneRowHTML(lane) {
    var sources = (lane.sources || []).length
      ? '<span class="lw-sources num">' + esc(lane.sources.join(" · ")) + "</span>"
      : '<span class="lw-sources">no source labels recorded</span>';
    var stamp = lane.newest_fetched_at
      ? "newest find " + fmtTime(lane.newest_fetched_at)
      : (lane.file_written_at
        ? "last wrote " + fmtTime(lane.file_written_at)
        : "nothing stored");
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
      ? '<a href="topics/' + esc(m.topic_id) + '.html">' + esc(normT(m.title)) + "</a>"
      : esc(normT(m.title)) + ' <span class="lw-offboard">(left the board)</span>';
    var delta = (m.delta > 0 ? "+" : "") + m.delta;
    var spanTxt = (m.span_hours >= 0.9 && m.span_hours <= 1.1)
      ? "about an hour" : m.span_hours + " hours";
    return '<article class="lw-mover" data-topic="' + esc(m.topic_id) + '">' +
      '<div class="lw-mover-main"><h4>' + title + "</h4>" +
      '<p class="lw-meta num">spreading ' + m.from_velocity + " → " + m.to_velocity +
      " over " + spanTxt + " · " + fmtTime(m.from_ts) + " → " +
      fmtTime(m.to_ts) + " · " + m.n_points + " readings</p></div>" +
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
      return '<p class="lw-empty">Nothing yet has two readings about ' +
        "an hour apart, so nothing counts as a mover. Movement prints " +
        "only when the readings prove it.</p>";
    }
    // Wave 29 audit fix: the payload caps each list at 10 while the
    // banner counts every mover, the headings must disclose the cap
    // ("top 10 of 21"), never let 10 rows pose as the whole count.
    function capNote(shown, total) {
      return (typeof total === "number" && total > shown)
        ? ", top " + shown + " of " + total : "";
    }
    return '<div class="lw-movers">' +
      '<section aria-label="Top gainers"><h3 class="lw-movers-h is-up">' +
      "▲ Climbing" + capNote((mv.gainers || []).length, c.gainers) +
      "</h3>" + (gain ||
        '<p class="lw-empty">Nothing climbed on two readings an hour apart.</p>') +
      "</section>" +
      '<section aria-label="Top fallers"><h3 class="lw-movers-h is-down">' +
      "▼ Cooling" + capNote((mv.fallers || []).length, c.fallers) +
      "</h3>" + (fall ||
        '<p class="lw-empty">Nothing cooled on two readings an hour apart.</p>') +
      "</section></div>";
  }

  function summaryHTML(wire) {
    var c = wire.counts || {};
    var banner = '<div class="lw-banner" role="status"><h2>The wire at ' +
      fmtTime(wire.refresh_at) + "</h2><p><strong>" + c.current_hits +
      " finds</strong> on the latest check across <strong>" +
      c.lanes_live + " working sources</strong>, failures on the " +
      "same board: " + c.lanes_degraded + " found nothing, " +
      c.lanes_stale_skip + " out of date (" + c.stale_hits_excluded +
      " old finds dated and not counted), " + c.lanes_skip_by_design +
      " off on purpose, " + (c.lanes_retired || 0) + " retired. " +
      c.topics_live + " trends on the board; " +
      c.movers_with_hour_pair + " have two readings an hour apart (" +
      c.gainers + " climbing, " + c.fallers + " cooling, " + c.flat +
      " flat).</p></div>";
    var cards = [
      ["Finds on the latest check", c.current_hits, "counted from the latest check only"],
      ["Working sources", c.lanes_live, "of " + c.lanes + " sources we watch"],
      ["Found nothing", c.lanes_degraded, "checked, came back empty"],
      ["Out of date", c.lanes_stale_skip, "not checked last time; old finds dated, not counted"],
      ["Off on purpose", c.lanes_skip_by_design, "TikTok + X: no honest way to read them, never faked"],
      ["Retired", c.lanes_retired || 0, "YouTube (Invidious / direct), closed 2026-10-13, reason on its row"],
      ["Movers", c.gainers + c.fallers, "two readings an hour apart: " + c.gainers + " up · " + c.fallers + " down · " + c.flat + " flat"]
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
