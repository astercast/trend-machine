/* trend-machine — wave 39 (rotation 20 · VP-0011): the One-Look Creator
   Board's live renderer. The build bakes the board into index.html as a
   static fallback (scripts/build_site.py, TMFB:board regions); this
   script re-renders the same markup from data/v1/board.json when the
   payload lands, and leaves the baked board untouched if it never does
   (10s deadline, the VP-0001 pattern — a hung fetch must not blank the
   first screen). Markup mirrors _fb_board_row() in build_site.py. */
(function () {
  "use strict";
  var DEADLINE_MS = 10000;
  function fetchDeadline(url) {
    var got = fetch(url);
    var deadline = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error("deadline " + url)); }, DEADLINE_MS);
    });
    return Promise.race([got, deadline]);
  }
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
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function titleHTML(e) {
    /* rotation 22 (§4.1): the primary source in parentheses inside the
       title line. Mirrors _fb_title_html() in build_site.py. */
    var src = e.source_name ? ' <span class="board-src">(' + esc(normT(e.source_name)) + ")</span>" : "";
    return '<a class="board-title" href="' + esc(e.url) + '">' + esc(normT(e.title)) + src + "</a>";
  }
  /* pro rework (2026-10-15): the row is ONE unit — rank, title, one
     meta line, one Make line, one score. Movement is a word in the
     meta line; the marginalia stack and the splash chart are
     retired. Mirrors _fb_board_row / _fb_meta_line in build_site.py. */
  var MOVE_WORD = { rising: "Rising", cooling: "Cooling", steady: "Steady" };
  function metaLine(e) {
    var parts = [e.record || ""];
    if (e.movement && MOVE_WORD[e.movement]) parts.push(MOVE_WORD[e.movement]);
    var plats = (e.platforms || []).map(String).slice(0, 3);
    if (plats.length) parts.push(plats.join(", "));
    return parts.filter(Boolean).join(" · ");
  }
  function rowHTML(e) {
    var aka = "";
    if (e.aka && e.aka.length) {
      aka = '<p class="board-aka">Also tracked as: ' + esc(e.aka.map(normT).join(" · ")) +
        ". Same trend, evidence combined.</p>";
    }
    var badge = "", make = "";
    if (e.kind === "news") {
      badge = '<span class="board-newsbadge">News, watch</span> ';
    } else if (e.angle) {
      make = '<p class="board-angle"><span class="board-make">Make</span> ' + esc(normT(e.angle)) + "</p>";
    }
    var meta = e.record ? '<p class="board-meta">' + esc(metaLine(e)) + "</p>" : "";
    return '<li class="board-row' + (e.kind === "news" ? " news" : "") + (e.splash ? " splash" : "") + '">' +
      '<span class="board-rank">' + e.rank + "</span>" +
      '<div class="board-main">' + badge + titleHTML(e) + aka + meta + make + "</div>" +
      '<div class="board-score"><span class="score-num">' + e.opportunity_score + "</span>" +
      '<span class="board-unit">/ 100</span>' +
      '<span class="score-bar" aria-hidden="true"><i style="width:' + e.opportunity_score + '%"></i></span></div></li>';
  }
  function catchupRowHTML(e) {
    return '<li class="catchup-row"><div class="board-main">' + titleHTML(e) +
      '<p class="board-meta">' + esc(e.record) + '</p></div>' +
      '<div class="board-score"><span class="score-num">' + e.velocity + "</span>" +
      '<span class="board-unit">spreading now</span>' +
      '<span class="score-bar" aria-hidden="true"><i style="width:' + e.velocity + '%"></i></span></div></li>';
  }
  function render(board) {
    var list = document.getElementById("board-list");
    if (list && board.make_now) list.innerHTML = board.make_now.map(rowHTML).join("");
    var news = document.getElementById("board-news");
    if (news && board.news_watch) news.innerHTML = board.news_watch.map(rowHTML).join("");
    var catchup = document.getElementById("catchup-list");
    if (catchup && board.catchup) {
      catchup.innerHTML = board.catchup.length
        ? board.catchup.map(catchupRowHTML).join("")
        : '<li class="catchup-none">Nothing on the record has cooled yet: no tracked topic is spreading more slowly now than at its fastest in the record.</li>';
    }
    var note = document.getElementById("board-note");
    if (note && board.note) note.textContent = normT(board.note);
    var mk = document.getElementById("hs-makenow");
    if (mk && board.counts) mk.textContent = String(board.counts.makeable_shown);
  }
  document.addEventListener("DOMContentLoaded", function () {
    fetchDeadline("data/v1/board.json").then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(render).catch(function () { /* baked board stays — it IS the board */ });
  });
})();
