/* trend-machine dashboard */
(function () {
  "use strict";
  var DATA_URLS = ["data/trends.json", "api/v1/trends.json"];
  var VELOCITY_URLS = ["api/v1/velocity.json", "data/velocity_history.json"];

  /* wave 8: velocity snapshots for the Trend sparkline column (best-effort) */
  function loadVelocity(i) {
    i = i || 0;
    if (i >= VELOCITY_URLS.length) { renderTable(); return; }
    fetch(VELOCITY_URLS[i]).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (data) {
      state.velocity = data || {};
      renderTable();
    }).catch(function () { loadVelocity(i + 1); });
  }
  function trendCell(t) {
    if (typeof TM_Sparkline === "undefined") { return ""; }
    var pts = state.velocity[t.id] || [];
    return TM_Sparkline.cellHTML(pts, t.id);
  }

  function minsSince(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return Infinity;
    return Math.max(0, (Date.now() - t) / 60000);
  }
  function freshHTML(iso) {
    var m = minsSince(iso), cls, label;
    if (m < 60) { cls = "f-live"; label = Math.max(1, Math.round(m)) + "m ago"; }
    else if (m < 1440) { cls = "f-warm"; label = Math.round(m / 60) + "h ago"; }
    else { cls = "f-dead"; label = Math.round(m / 1440) + "d ago"; }
    var pulse = cls === "f-live" ? " pulse" : "";
    return '<span class="fresh ' + cls + '"><span class="dot' + pulse + '" aria-hidden="true"></span>' + label + "</span>";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function scoreHTML(v, hot) {
    var cls = v >= 70 ? "hot" : v >= 40 ? "warm" : "";
    return '<span class="score ' + cls + '"><span class="score-bar" role="img" aria-label="score ' + v + ' of 100"><i style="width:' + v + '%"></i></span><span class="num">' + v + "</span></span>";
  }
  function chips(list, cls) {
    return list.map(function (x) { return '<span class="chip' + (cls ? " " + cls : "") + '">' + esc(x) + "</span>"; }).join("");
  }

  var state = { topics: [], velocity: {}, sort: "opportunity", dir: -1, platform: "all", category: "all", q: "" };

  function ageRank(t) { return minsSince(t.last_seen); }

  function filtered() {
    var list = state.topics.filter(function (t) {
      if (state.platform !== "all" && t.platforms.indexOf(state.platform) < 0) return false;
      if (state.category !== "all" && t.category !== state.category) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        var hay = (t.title + " " + t.summary + " " + t.hashtags.join(" ")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    list.sort(function (a, b) {
      var va, vb;
      if (key === "recency") { va = -ageRank(a); vb = -ageRank(b); }
      else if (key === "velocity") { va = a.velocity; vb = b.velocity; }
      else { va = a.opportunity_score; vb = b.opportunity_score; }
      return (va - vb) * state.dir;
    });
    return list;
  }

  function renderTicker(topics) {
    var items = topics.slice(0, 12).map(function (t) {
      return "<b>▲ " + t.opportunity_score + "</b> " + esc(t.title);
    }).join('<span class="tk-sep">·</span>');
    var track = document.getElementById("ticker-track");
    if (track) track.innerHTML = items + '<span class="tk-sep">·</span>' + items;
  }

  function clearLoading(id) {
    var el = document.getElementById(id);
    if (el) { el.classList.remove("is-loading"); el.setAttribute("aria-busy", "false"); el.removeAttribute("aria-label"); }
  }

  function renderHot5(topics) {
    var el = document.getElementById("hot5");
    if (!el) return;
    var top = topics.slice().sort(function (a, b) { return b.opportunity_score - a.opportunity_score; }).slice(0, 5);
    el.innerHTML = top.map(function (t, i) {
      var leader = i === 0;
      return '<a class="hot-card rise' + (leader ? " leader" : "") + '" style="--i:' + i + '" href="topics/' + t.id + '.html">' +
        (leader ? '<span class="badge-breaking">Breaking</span>' : "") +
        '<span class="rank num">0' + (i + 1) + "</span>" +
        "<div><h3>" + esc(t.title) + "</h3>" +
        "<p>" + esc(t.summary) + "</p></div>" +
        '<div class="card-foot">' +
        scoreHTML(t.opportunity_score, true) + freshHTML(t.last_seen) + "</div></a>";
    }).join("");
    clearLoading("hot5");
  }

  function renderRadar(topics) {
    var el = document.getElementById("radar-strip");
    if (!el) return;
    var memes = topics.filter(function (t) { return t.category === "meme"; })
      .sort(function (a, b) { return b.velocity - a.velocity; }).slice(0, 10);
    el.innerHTML = memes.map(function (t, i) {
      return '<a class="meme-card rise" style="--i:' + i + '" href="topics/' + t.id + '.html">' +
        '<div class="fmt num">◉ MEME · v' + t.velocity + "</div>" +
        "<h4>" + esc(t.title) + "</h4>" +
        '<div class="mhash">' + t.hashtags.slice(0, 3).map(esc).join(" ") + "</div>" +
        freshHTML(t.last_seen) + "</a>";
    }).join("");
    clearLoading("radar-strip");
    var count = document.getElementById("radar-count");
    if (count) count.textContent = memes.length + " meme signals tracked";
  }

  function renderTable() {
    var el = document.getElementById("dtable-body");
    if (!el) return;
    var list = filtered();
    var meta = document.getElementById("table-meta");
    if (meta) meta.textContent = list.length + " of " + state.topics.length + " topics";
    el.innerHTML = list.map(function (t, i) {
      var stale = t.stale ? ' class="is-stale rise"' : ' class="rise"';
      return "<tr" + stale + ' style="--i:' + Math.min(i, 12) + '">' +
        '<td data-label="Topic"><a class="topic-link" href="topics/' + t.id + '.html">' + esc(t.title) + "</a>" +
        (t.stale ? ' <span class="stale-badge">STALE</span>' : "") +
        '<div class="topic-cat">' + esc(t.category) + "</div></td>" +
        '<td data-label="Platforms">' + chips(t.platforms, "plat") + "</td>" +
        '<td data-label="Opportunity">' + scoreHTML(t.opportunity_score) + "</td>" +
        '<td data-label="Velocity">' + scoreHTML(t.velocity) + "</td>" +
        '<td data-label="Trend">' + trendCell(t) + "</td>" +
        '<td data-label="Detected">' + freshHTML(t.last_seen) + "</td></tr>";
    }).join("");
    var tbl = document.getElementById("dtable");
    if (tbl) tbl.setAttribute("aria-busy", "false");
  }

  function updateSortUI() {
    document.querySelectorAll("[data-sort]").forEach(function (btn) {
      var k = btn.getAttribute("data-sort");
      var arr = btn.querySelector(".arr");
      var th = btn.closest("th");
      if (k === state.sort) {
        if (arr) arr.textContent = state.dir === -1 ? "▼" : "▲";
        if (th) th.setAttribute("aria-sort", state.dir === -1 ? "descending" : "ascending");
      } else {
        if (arr) arr.textContent = "";
        if (th) th.removeAttribute("aria-sort");
      }
    });
  }

  function renderFilters(topics) {
    var plats = {}, cats = {};
    topics.forEach(function (t) {
      t.platforms.forEach(function (p) { plats[p] = 1; });
      cats[t.category] = 1;
    });
    var pf = document.getElementById("f-platform"), cf = document.getElementById("f-category");
    if (pf) pf.innerHTML = '<option value="all">all platforms</option>' +
      Object.keys(plats).sort().map(function (p) { return '<option value="' + p + '">' + p + "</option>"; }).join("");
    if (cf) cf.innerHTML = '<option value="all">all categories</option>' +
      Object.keys(cats).sort().map(function (c) { return '<option value="' + c + '">' + c + "</option>"; }).join("");
  }

  function tickClock() {
    var el = document.getElementById("live-clock-time");
    if (el) el.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function load(i) {
    i = i || 0;
    if (i >= DATA_URLS.length) {
      var err = document.getElementById("load-error");
      if (err) err.hidden = false;
      return;
    }
    fetch(DATA_URLS[i]).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (data) {
      state.topics = data.topics || [];
      var gen = document.getElementById("data-ts");
      if (gen && data.generated_at) {
        var d = new Date(data.generated_at);
        gen.innerHTML = 'data: <span class="num">' + d.toLocaleString() + "</span>";
      }
      renderTicker(state.topics);
      renderHot5(state.topics);
      renderRadar(state.topics);
      renderFilters(state.topics);
      renderTable();
    }).catch(function () { load(i + 1); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    load();
    loadVelocity();
    tickClock(); setInterval(tickClock, 1000);
    var pf = document.getElementById("f-platform");
    var cf = document.getElementById("f-category");
    var q = document.getElementById("f-search");
    if (pf) pf.addEventListener("change", function () { state.platform = pf.value; renderTable(); });
    if (cf) cf.addEventListener("change", function () { state.category = cf.value; renderTable(); });
    if (q) q.addEventListener("input", function () { state.q = q.value.trim(); renderTable(); });
    document.querySelectorAll("[data-sort]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var k = btn.getAttribute("data-sort");
        if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = -1; }
        updateSortUI();
        renderTable();
      });
    });
    updateSortUI();
  });
})();
