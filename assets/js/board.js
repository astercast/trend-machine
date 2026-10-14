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
  function rowHTML(e) {
    var plats = (e.platforms || []).map(esc).join(" · ");
    var marg = "";
    if (plats) marg += '<p class="board-marg board-marg-plats">On: ' + plats + "</p>";
    if (e.evidence && e.evidence.length) {
      marg += '<ul class="board-marg">' + e.evidence.map(function (c) {
        return "<li>" + esc(normT(c)) + "</li>";
      }).join("") + "</ul>";
    }
    var aka = "";
    if (e.aka && e.aka.length) {
      aka = '<span class="board-aka">Also tracked as: ' + esc(e.aka.map(normT).join(" · ")) +
        ". One phenomenon, evidence combined.</span>";
    }
    var badge = "", make = "";
    if (e.kind === "news") {
      badge = '<span class="board-newsbadge">News, watch</span> ';
    } else if (e.angle) {
      make = '<p class="board-angle"><span class="board-make">Make</span> ' + esc(normT(e.angle)) +
        '<span class="board-fmt"> · format: ' + esc(e.format) + "</span></p>";
    }
    var record = e.record ? '<p class="board-record">' + esc(e.record) + "</p>" : "";
    var splash = !!e.splash;
    var move = e.movement ? '<span class="board-move">' + esc(e.movement) + "</span>" : "";
    if (splash) {
      var chart = e.spark_svg ? '<figure class="splash-fig">' + e.spark_svg + "</figure>" : "";
      return '<li class="board-row splash">' +
        '<span class="board-rank">' + e.rank + "</span>" +
        '<div class="board-main">' + badge + titleHTML(e) + record +
        make + chart + "</div>" +
        '<div class="board-score"><span class="score-num">' + e.opportunity_score + "</span>" +
        '<span class="board-unit">opportunity / 100</span>' + move + "</div></li>";
    }
    return '<li class="board-row' + (e.kind === "news" ? " news" : "") + '">' +
      '<span class="board-rank">' + e.rank + "</span>" +
      '<div class="board-main">' + badge + titleHTML(e) + record +
      aka + make + marg + "</div>" +
      '<div class="board-score"><span class="score-num">' + e.opportunity_score + "</span>" +
      '<span class="board-unit">opportunity / 100</span>' + move + "</div></li>";
  }
  function catchupRowHTML(e) {
    return '<li class="catchup-row"><div class="board-main">' + titleHTML(e) +
      '<p class="board-record">' + esc(e.record) + '</p></div>' +
      '<div class="board-score"><span class="score-num">' + e.velocity + "</span>" +
      '<span class="board-unit">velocity now</span></div></li>';
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
        : '<li class="catchup-none">Nothing on the record has cooled yet: no tracked topic\u2019s latest velocity sits below its window peak.</li>';
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
