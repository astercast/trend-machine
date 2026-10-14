/* trend-machine: The Wire rail (rotation 21 identity pass).
   The rail is a running mono list of the newest items on the board,
   newest first, each with its last seen stamp. It renders from the
   same stored record the board uses (data/v1/trends.json, last_seen
   field) and replaces the baked static fallback in index.html when
   the payload lands. If the payload never lands, the baked list
   stays: it is the same list, from the same record, at build time.
   No data is invented here: a topic with no stamp prints no stamp. */
(function () {
  "use strict";
  var DEADLINE_MS = 10000;
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function stamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "no stamp";
    var mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
    var hh = ("0" + d.getHours()).slice(-2), mm = ("0" + d.getMinutes()).slice(-2);
    return mon + " " + d.getDate() + " · " + hh + ":" + mm;
  }
  function render(topics) {
    var el = document.getElementById("wire-list");
    if (!el || !topics || !topics.length) return;
    var newest = topics.slice().sort(function (a, b) {
      return String(b.last_seen || "").localeCompare(String(a.last_seen || ""));
    }).slice(0, 14);
    el.innerHTML = newest.map(function (t) {
      return '<li class="wire-item"><span class="wire-time">' + esc(stamp(t.last_seen)) +
        '</span><a href="topics/' + esc(t.id) + '.html">' + esc(t.title) + "</a></li>";
    }).join("");
  }
  document.addEventListener("DOMContentLoaded", function () {
    var got = fetch("data/v1/trends.json").then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
    var deadline = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error("wire deadline")); }, DEADLINE_MS);
    });
    Promise.race([got, deadline]).then(function (data) {
      render(data.topics || data);
    }).catch(function () { /* baked wire stays */ });
  });
})();
