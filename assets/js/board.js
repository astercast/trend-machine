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
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function rowHTML(e) {
    var plats = (e.platforms || []).map(esc).join(" · ");
    var marg = "";
    if (plats) marg += '<p class="board-marg board-marg-plats">On: ' + plats + "</p>";
    if (e.evidence && e.evidence.length) {
      marg += '<ul class="board-marg">' + e.evidence.map(function (c) {
        return "<li>" + esc(c) + "</li>";
      }).join("") + "</ul>";
    }
    var aka = "";
    if (e.aka && e.aka.length) {
      aka = '<span class="board-aka">Also tracked as: ' + esc(e.aka.join(" · ")) +
        ". One phenomenon, evidence combined.</span>";
    }
    var badge = "", make = "";
    if (e.kind === "news") {
      badge = '<span class="board-newsbadge">News, watch</span> ';
    } else if (e.angle) {
      make = '<p class="board-angle"><span class="board-make">Make</span> ' + esc(e.angle) +
        '<span class="board-fmt"> · format: ' + esc(e.format) + "</span></p>";
    }
    var splash = !!e.splash;
    var move = e.movement ? '<span class="board-move">' + esc(e.movement) + "</span>" : "";
    if (splash) {
      var chart = e.spark_svg ? '<figure class="splash-fig">' + e.spark_svg + "</figure>" : "";
      return '<li class="board-row splash">' +
        '<span class="board-rank">' + e.rank + "</span>" +
        '<div class="board-main">' + badge +
        '<a class="board-title" href="' + esc(e.url) + '">' + esc(e.title) + "</a>" +
        make + chart + "</div>" +
        '<div class="board-score"><span class="score-num">' + e.opportunity_score + "</span>" +
        '<span class="board-unit">opportunity / 100</span>' + move + "</div></li>";
    }
    return '<li class="board-row' + (e.kind === "news" ? " news" : "") + '">' +
      '<span class="board-rank">' + e.rank + "</span>" +
      '<div class="board-main">' + badge +
      '<a class="board-title" href="' + esc(e.url) + '">' + esc(e.title) + "</a>" +
      aka + make + marg + "</div>" +
      '<div class="board-score"><span class="score-num">' + e.opportunity_score + "</span>" +
      '<span class="board-unit">opportunity / 100</span>' + move + "</div></li>";
  }
  function render(board) {
    var list = document.getElementById("board-list");
    if (list && board.make_now) list.innerHTML = board.make_now.map(rowHTML).join("");
    var news = document.getElementById("board-news");
    if (news && board.news_watch) news.innerHTML = board.news_watch.map(rowHTML).join("");
    var note = document.getElementById("board-note");
    if (note && board.note) note.textContent = board.note;
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
