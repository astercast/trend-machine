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
    var chips = (e.platforms || []).map(function (p) {
      return '<span class="chip plat">' + esc(p) + "</span>";
    }).join("") + (e.evidence || []).map(function (c) {
      return '<span class="chip ev">' + esc(c) + "</span>";
    }).join("");
    var aka = "";
    if (e.aka && e.aka.length) {
      aka = '<span class="board-aka">also tracked as: ' + esc(e.aka.join(" · ")) +
        " — one phenomenon, evidence combined</span>";
    }
    var badge = "", make = "";
    if (e.kind === "news") {
      badge = '<span class="board-newsbadge">News · watch</span> ';
    } else if (e.angle) {
      make = '<p class="board-angle"><span class="board-make">Make</span> ' + esc(e.angle) +
        '<span class="board-fmt"> · format: ' + esc(e.format) + "</span></p>";
    }
    return '<li class="board-row rise' + (e.kind === "news" ? " news" : "") + '">' +
      '<span class="board-rank num">' + (e.rank < 10 ? "0" : "") + e.rank + "</span>" +
      '<div class="board-main">' + badge +
      '<a class="board-title" href="' + esc(e.url) + '">' + esc(e.title) + "</a>" +
      aka + make +
      '<div class="board-chips">' + chips + "</div></div>" +
      '<div class="board-score"><span class="num">' + e.opportunity_score + "</span>" +
      '<span class="board-unit">opp /100</span></div></li>';
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
