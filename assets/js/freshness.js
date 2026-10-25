/* Freshness proof + live lane. No dependencies.
   Reads /data/v1/freshness.json (written by pipeline/health.py every build).
   The age is worked out in the visitor's browser from generatedAt, so an open
   tab keeps ageing honestly and a board that stops rebuilding says so. */
(function () {
  "use strict";
  var FRESH_H = 4, STALE_H = 12;
  var $ = function (id) { return document.getElementById(id); };
  var root = $("freshness");
  if (!root) return;

  function ago(ms) {
    var m = Math.round(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 48) return h + " h ago";
    return Math.round(h / 24) + " days ago";
  }
  function when(iso) {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  }
  function verdict(h) { return h <= FRESH_H ? "fresh" : (h <= STALE_H ? "aging" : "stale"); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  var data = null;
  function paint() {
    var gen = data ? Date.parse(data.generatedAt) : Date.parse(root.getAttribute("data-generated") || "");
    if (!gen) return;
    var h = (Date.now() - gen) / 36e5, v = verdict(h);
    document.documentElement.setAttribute("data-fresh", v);
    root.setAttribute("data-state", v);
    root.textContent = "";
    root.appendChild(el("span", "fr-dot"));
    root.appendChild(el("span", "fr-age", (v === "stale" ? "Last rebuilt " : "Updated ") + ago(Date.now() - gen)));
    if (data) {
      var c = data.laneCounts || {}, total = (c.live || 0) + (c.degraded || 0) + (c.dead || 0);
      root.appendChild(el("span", "fr-sep", "·"));
      root.appendChild(el("span", "fr-lanes", (c.live || 0) + " of " + total + " sources reporting"));
      if (data.board && data.board.tracked) {
        root.appendChild(el("span", "fr-sep", "·"));
        root.appendChild(el("span", "fr-conf", data.board.confirmed + " of " + data.board.tracked + " confirmed by 2 or more outlets"));
      }
    }
    if (v === "stale") {
      var b = $("fr-banner");
      if (b) { b.hidden = false; b.textContent = "This board was last rebuilt " + when(new Date(gen).toISOString()) + ". It has not refreshed since, so treat it as a record, not as today."; }
    }
    if (data) {
      var d = $("fr-detail");
      if (d && !d.dataset.done) {
        d.dataset.done = "1";
        (data.lanes || []).forEach(function (l) {
          if (l.state === "retired") return;
          var li = el("li", "fr-lane fr-" + l.state);
          li.appendChild(el("span", "fr-lane-dot"));
          li.appendChild(el("span", "fr-lane-name", l.label));
          li.appendChild(el("span", "fr-lane-state",
            l.state === "live" ? "reporting, " + l.hits + " items" :
            l.state === "degraded" ? "no data this run (" + l.missesInARow + " in a row)" :
            l.state === "dead" ? "offline since " + (l.lastGoodAt ? when(l.lastGoodAt) : "never seen") :
            "off by design"));
          d.appendChild(li);
        });
      }
    }
  }

  fetch("data/v1/freshness.json", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (j) { data = j; paint(); })
    .catch(function () { paint(); });          // falls back to the stamp baked into the page
  paint();
  setInterval(paint, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) paint(); });

  /* ---- live in your browser: four lanes that allow cross-origin reads ---- */
  var live = $("live-now");
  if (!live) return;
  var lanes = [
    { id: "hn", label: "Hacker News front page",
      url: "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=5",
      pick: function (j) { return j.hits.map(function (x) { return { t: x.title, u: "https://news.ycombinator.com/item?id=" + x.objectID }; }); } },
    { id: "bsky", label: "Bluesky trending",
      url: "https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrendingTopics?limit=5",
      pick: function (j) { return (j.topics || []).map(function (x) { return { t: x.topic, u: "https://bsky.app" + (x.link || "") }; }); } },
    { id: "masto", label: "Mastodon trending tags",
      url: "https://mastodon.social/api/v1/trends/tags?limit=5",
      pick: function (j) { return j.map(function (x) { return { t: "#" + x.name, u: x.url }; }); } },
    { id: "wiki", label: "Wikipedia most read yesterday",
      url: (function () { var d = new Date(Date.now() - 36e5 * 30); var p = function (n) { return String(n).padStart(2, "0"); };
        return "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/" + d.getUTCFullYear() + "/" + p(d.getUTCMonth() + 1) + "/" + p(d.getUTCDate()); })(),
      pick: function (j) { return j.items[0].articles.filter(function (a) { return !/^(Main_Page|Special:|Wikipedia:|Portal:|-)/.test(a.article); }).slice(0, 5)
        .map(function (a) { var n = a.article.replace(/_/g, " "); return { t: n, u: "https://en.wikipedia.org/wiki/" + encodeURIComponent(a.article) }; }); } }
  ];
  lanes.forEach(function (l) {
    var box = el("section", "ln-lane"), h = el("h3", "ln-h", l.label), ul = el("ul", "ln-list"), st = el("p", "ln-stat", "loading");
    box.appendChild(h); box.appendChild(ul); box.appendChild(st); live.appendChild(box);
    var ctl = new AbortController(), to = setTimeout(function () { ctl.abort(); }, 8000);
    fetch(l.url, { signal: ctl.signal, referrerPolicy: "no-referrer" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        var rows = l.pick(j).slice(0, 5);
        if (!rows.length) throw new Error("empty");
        rows.forEach(function (x) { var li = el("li"), a = el("a", null, x.t); a.href = x.u; a.rel = "noopener"; li.appendChild(a); ul.appendChild(li); });
        st.textContent = "fetched by your browser at " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        box.setAttribute("data-state", "live");
      })
      .catch(function () { st.textContent = "not reachable from your browser right now"; box.setAttribute("data-state", "down"); })
      .then(function () { clearTimeout(to); });
  });
})();
