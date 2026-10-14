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
  function stamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "no stamp";
    var mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
    var hh = ("0" + d.getHours()).slice(-2), mm = ("0" + d.getMinutes()).slice(-2);
    return mon + " " + d.getDate() + " · " + hh + ":" + mm;
  }
  /* rotation 22 (§4.2): the source credited inside the line, from the
     record itself — the publication at the head of the record's
     summary where the fetcher stored one, else the first recorded
     source in its plain name. Mirrors credit_name() in build_site.py. */
  var PUB_HEAD = /^(.{2,60}?) \u00b7 (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),/;
  function laneCredit(name) {
    var n = String(name || "");
    if (n.indexOf(" (") > -1) n = n.split(" (")[0].replace(/\s+$/, "");
    if (n.indexOf("gnews-") === 0) return "Google News";
    if (n.indexOf("reddit-rss:") === 0) {
      var sub = n.split(":")[1];
      return sub ? "Reddit (" + sub + ")" : "Reddit";
    }
    if (n.indexOf("yt-rss:") === 0) {
      var ch = n.split(":")[1];
      return ch ? "YouTube (" + ch + ")" : "YouTube";
    }
    if (n === "hackernews") return "Hacker News";
    if (n === "mastodon-trends") return "Mastodon trends";
    if (n === "bluesky-trending") return "Bluesky trending";
    return normT(n);
  }
  function creditName(t) {
    var m = PUB_HEAD.exec(String(t.summary || "").replace(/^\s+/, ""));
    if (m) return normT(m[1].replace(/\s+$/, ""));
    var names = (t.sources || []).filter(function (s) { return s && s.name; });
    if (!names.length) return "";
    return laneCredit(names[0].name);
  }
  function ageWords(m) {
    if (m < 1) return "just now";
    if (m < 60) { var mm = Math.max(1, Math.round(m)); return mm + " minute" + (mm !== 1 ? "s" : "") + " ago"; }
    if (m < 1440) { var h = Math.round(m / 60); return h + " hour" + (h !== 1 ? "s" : "") + " ago"; }
    var d = Math.round(m / 1440); return d + " day" + (d !== 1 ? "s" : "") + " ago";
  }
  function render(topics) {
    var el = document.getElementById("wire-list");
    if (!el || !topics || !topics.length) return;
    var newest = topics.slice().sort(function (a, b) {
      return String(b.last_seen || "").localeCompare(String(a.last_seen || ""));
    }).slice(0, 14);
    el.innerHTML = newest.map(function (t, i) {
      var credit = creditName(t);
      var frame = credit ? '<span class="wire-credit">' + esc(credit) + " reported:</span> " : "";
      var mins = (Date.now() - new Date(t.last_seen).getTime()) / 60000;
      var age = isNaN(mins) ? "" : ' <span class="wire-age">\u00b7 ' + esc(ageWords(mins)) + "</span>";
      return '<li class="wire-item" style="--wi:' + i + '"><span class="wire-time">' + esc(stamp(t.last_seen)) +
        '</span><a href="topics/' + esc(t.id) + '.html">' + frame + esc(normT(t.title)) + "</a>" + age + "</li>";
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
