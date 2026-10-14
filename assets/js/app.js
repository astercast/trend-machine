/* trend-machine dashboard */
(function () {
  "use strict";
  var DATA_URLS = ["data/trends.json", "data/v1/trends.json"];
  var VELOCITY_URLS = ["data/v1/velocity.json", "data/velocity_history.json"];

  /* wave 30 · VP-0001: every load carries a deadline. A fetch that never
     settles (stalled data path) used to leave the board in its loading
     state forever — the 1202 alarm only fired on rejection. Race each
     fetch against a timer so a hang becomes a failure the chain (and the
     watchdog below) can act on. */
  var FETCH_DEADLINE_MS = 10000;
  function fetchDeadline(url) {
    var got = fetch(url);
    var deadline = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error("deadline " + url)); }, FETCH_DEADLINE_MS);
    });
    return Promise.race([got, deadline]);
  }
  /* Hard watchdog: if the board is not live 15s after start, raise the
     alarm even if some attempt is still pending. A late success clears
     it again through the GO path in clearAlarm(). */
  var boardLive = false, watchdog = null;
  function armWatchdog() {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(function () { if (!boardLive) raiseAlarm(); }, 15000);
  }

  /* wave 8: velocity snapshots for the Trend sparkline column (best-effort) */
  /* Retirement (2026-10-13): the Phase filter's call set came from the
     retired forecast payload, so the phase select was removed from the
     board rather than left permanently disabled. TM_BoardFilter (the
     pure lib + its URL-state handling) is unchanged: a ?phase= value in
     an old shared link still parses, it simply has no calls to match
     against, and the desk below is otherwise untouched. */

  function loadVelocity(i) {
    i = i || 0;
    if (i >= VELOCITY_URLS.length) { renderTable(); return; }
    fetchDeadline(VELOCITY_URLS[i]).then(function (r) {
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
  function normT(s) {
    /* display normalization: tracked titles render dash-free (data stays byte-true) */
    return String(s == null ? "" : s).replace(/\s+[\u2014\u2013]\s+/g, ", ").replace(/[\u2014\u2013]/g, "-");
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

  var BF = (typeof TM_BoardFilter !== "undefined") ? TM_BoardFilter : null;
  var state = { topics: [], merged: null, velocity: {}, sort: "opportunity", dir: -1, platform: "all", category: "all", q: "", phase: "all", phases: null };
  /* wave 39 (VP-0011): the phenomenon-merged view (TM_BoardLib — one
     phenomenon, one row, evidence combined). state.topics stays the raw
     canonical record (Hot right now is the raw top 5 by design); the
     ticker, radar and desk render from state.merged. */
  function mergedTopics() { return state.merged || state.topics; }
  /* wave 37 · shareable filtered views (wave-11 follow-up #3): an inbound
     link's query string seeds the filter state; every later change is
     written back with replaceState, so the address bar always holds a
     link to the exact view on screen. phases stays null — its call set
     retired with the forecast payload (2026-10-13), so a phase value
     in a link is carried, never guessed at. */
  if (BF) {
    var patch = BF.parseQuery(window.location.search);
    ["phase", "platform", "category", "q", "sort", "dir"].forEach(function (k) {
      if (patch[k] !== undefined) state[k] = patch[k];
    });
  }
  function syncURL() {
    if (!BF || !window.history || !window.history.replaceState) return;
    var qs = BF.toQuery(state);
    var url = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
    try { window.history.replaceState(null, "", url); } catch (e) { /* file:// etc. */ }
  }
  /* wave 12 · war-room: GET epoch (data run time) for the mission clock */
  var getEpoch = null;
  function lampTest(on) {
    document.body.classList.toggle("tm-lamptest", !!on);
  }

  function ageRank(t) { return minsSince(t.last_seen); }

  function filtered() {
    var list = mergedTopics().filter(function (t) {
      if (state.platform !== "all" && t.platforms.indexOf(state.platform) < 0) return false;
      if (state.category !== "all" && t.category !== state.category) return false;
      if (state.phase !== "all" && state.phases && BF && !BF.matchesPhase(state.phases, t.id, state.phase)) return false;
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
    /* wave 39 (VP-0011): the score prints WITH its unit — an opportunity
       index out of 100. A bare ▲ read as a percentage rise; it never was. */
    var items = topics.slice(0, 12).map(function (t) {
      return "<b>" + t.opportunity_score + "/100</b> " + esc(normT(t.title));
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
      return '<a class="hot-row' + (leader ? " leader" : "") + '" href="topics/' + t.id + '.html">' +
        '<span class="board-rank">' + (i + 1) + "</span>" +
        '<span class="hot-main"><h3>' + esc(normT(t.title)) + "</h3>" +
        "<p>" + esc(normT(t.summary)) + "</p>" +
        '<span class="hot-meta">' + (leader ? "breaking · " : "") + freshHTML(t.last_seen) + "</span></span>" +
        '<span class="board-score"><span class="score-num">' + t.opportunity_score + "</span>" +
        '<span class="board-unit">opportunity / 100</span></span></a>';
    }).join("");
    clearLoading("hot5");
  }

  function renderRadar(topics) {
    var el = document.getElementById("radar-strip");
    if (!el) return;
    var memes = topics.filter(function (t) { return t.category === "meme"; })
      .sort(function (a, b) { return b.velocity - a.velocity; }).slice(0, 10);
    el.innerHTML = memes.map(function (t) {
      return '<a class="meme-row" href="topics/' + t.id + '.html">' +
        '<span class="meme-main"><span class="fmt num">MEME · v' + t.velocity + "</span>" +
        "<h4>" + esc(normT(t.title)) + "</h4></span>" +
        '<span class="meme-meta">' + esc((t.hashtags || []).slice(0, 3).join(" ")) +
        " · " + freshHTML(t.last_seen) + "</span></a>";
    }).join("");
    var cnt = document.getElementById("radar-count");
    if (cnt) cnt.textContent = memes.length + " meme signals tracked";
    clearLoading("radar-strip");
  }
  function renderScope(memes) {
    var box = document.getElementById("radar-scope");
    if (!box || !memes.length) return;
    var CX = 100, CY = 100, R = 90;
    function tierColor(t) {
      if (t.opportunity_score >= 70) return "#ff5468";
      if (t.opportunity_score >= 40) return "#ffb224";
      return "#41ff8a";
    }
    var rings = [30, 55, 80].map(function (r) {
      return '<circle cx="' + CX + '" cy="' + CY + '" r="' + r + '" fill="none" stroke="rgba(83,233,255,.16)" stroke-width="1"/>';
    }).join("");
    var ticks = "";
    for (var d = 0; d < 12; d++) {
      var a = d * Math.PI / 6, x1 = CX + 84 * Math.cos(a), y1 = CY + 84 * Math.sin(a);
      var x2 = CX + 90 * Math.cos(a), y2 = CY + 90 * Math.sin(a);
      ticks += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) +
        '" y2="' + y2.toFixed(1) + '" stroke="rgba(139,147,167,.5)" stroke-width="1"/>';
    }
    var blips = memes.map(function (t, i) {
      var ang = (i / memes.length) * Math.PI * 2 - Math.PI / 2;
      var rad = R - (Math.max(0, Math.min(100, t.opportunity_score)) / 100) * (R - 18);
      var x = (CX + rad * Math.cos(ang)).toFixed(1), y = (CY + rad * Math.sin(ang)).toFixed(1);
      var c = tierColor(t);
      return '<g class="blip"><circle class="blip-ring" cx="' + x + '" cy="' + y + '" r="5" fill="none" stroke="' +
        c + '" stroke-width="1" style="animation-delay:' + (i * 0.24).toFixed(2) + 's"/>' +
        '<circle cx="' + x + '" cy="' + y + '" r="3.4" fill="' + c + '">' +
        '<title>' + esc(normT(t.title)) + " · opportunity " + t.opportunity_score + "</title></circle></g>";
    }).join("");
    box.innerHTML =
      '<svg viewBox="0 0 200 200" role="img" aria-label="Radar scope: ' + memes.length +
      " meme contacts tracked; closest: " + esc(normT(memes[0].title)) + '" focusable="false">' +
      '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke="rgba(83,233,255,.35)" stroke-width="1.5"/>' +
      rings + ticks +
      '<line x1="' + CX + '" y1="' + (CY - R) + '" x2="' + CX + '" y2="' + (CY + R) + '" stroke="rgba(83,233,255,.12)" stroke-width="1"/>' +
      '<line x1="' + (CX - R) + '" y1="' + CY + '" x2="' + (CX + R) + '" y2="' + CY + '" stroke="rgba(83,233,255,.12)" stroke-width="1"/>' +
      '<g class="radar-sweep"><path d="M100,100 L100,14 A86,86 0 0 1 143,22 Z" fill="url(#sweepGrad)" opacity=".55"/>' +
      '<line x1="100" y1="100" x2="100" y2="14" stroke="#41ff8a" stroke-width="1.5" opacity=".9"/></g>' +
      '<defs><linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="#41ff8a" stop-opacity=".5"/>' +
      '<stop offset="1" stop-color="#41ff8a" stop-opacity="0"/></linearGradient></defs>' +
      blips + "</svg>" +
      '<div class="scope-cap"><span class="tm-plate-label">SCOPE · MEME CONTACTS</span>' +
      '<span class="led led-violet blink" aria-hidden="true"></span></div>';
    box.hidden = false;
  }

  function renderTable() {
    var el = document.getElementById("dtable-body");
    if (!el) return;
    var list = filtered();
    var meta = document.getElementById("table-meta");
    if (meta) meta.textContent = list.length + " of " + mergedTopics().length + " phenomena · " + state.topics.length + " topics tracked";
    el.innerHTML = list.map(function (t, i) {
      var stale = t.stale ? ' class="is-stale"' : '';
      var aka = (t.merged_from && t.merged_from.length)
        ? '<div class="topic-aka">also tracked as: ' + t.merged_from.map(function (x) { return esc(normT(x.title)); }).join(" · ") + ". One phenomenon, evidence combined</div>" : "";
      return "<tr" + stale + ' style="--i:' + Math.min(i, 12) + '">' +
        '<td data-label="Topic"><a class="topic-link" href="topics/' + t.id + '.html">' + esc(normT(t.title)) + "</a>" +
        (t.stale ? ' <span class="stale-badge">STALE</span>' : "") +
        '<div class="topic-cat">' + esc(t.category) + "</div>" + aka + "</td>" +
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
    /* wave 37: restore the view an inbound link asked for. A platform or
       category the current data no longer carries falls back to "all" —
       the link degrades to the plain board, never to an empty one. */
    if (pf) { pf.value = state.platform; if (pf.value !== state.platform) { state.platform = "all"; pf.value = "all"; } }
    if (cf) { cf.value = state.category; if (cf.value !== state.category) { state.category = "all"; cf.value = "all"; } }
  }

  function tickClock() {
    var el = document.getElementById("live-clock-time");
    if (!el) return;
    var lbl = document.getElementById("clock-label");
    if (getEpoch) {
      /* GET: ground elapsed time since the data run */
      var s = Math.max(0, Math.floor((Date.now() - getEpoch) / 1000));
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
      el.textContent = "T+" + (h < 10 ? "0" + h : h) + ":" + (m < 10 ? "0" + m : m) + ":" + (ss < 10 ? "0" + ss : ss);
      if (lbl) lbl.textContent = "GET";
    } else {
      el.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      if (lbl) lbl.textContent = "LOCAL";
    }
  }

  /* wave 12 · 1202 program alarm: shed non-essential loads, offer a retry.
     Recovery prints GO. */
  var wasAlarmed = false;
  function raiseAlarm() {
    wasAlarmed = true;
    document.body.classList.add("tm-alarm-1202");
    var err = document.getElementById("load-error");
    if (err) {
      err.hidden = false;
      err.classList.remove("tm-go");
      var code = document.getElementById("alarm-code");
      if (code) code.textContent = "1202 · DATA LINK LOST";
      var btn = document.getElementById("load-retry");
      if (btn) btn.hidden = false;
    }
  }
  function clearAlarm(go) {
    document.body.classList.remove("tm-alarm-1202");
    var err = document.getElementById("load-error");
    if (!err) return;
    if (go) {
      err.classList.add("tm-go");
      var code = document.getElementById("alarm-code");
      if (code) code.textContent = "GO · LINK RESTORED";
      var msg = document.getElementById("alarm-msg");
      if (msg) msg.textContent = "The trend feed is back. All loads restored — the board is live.";
      var btn = document.getElementById("load-retry");
      if (btn) btn.hidden = true;
      setTimeout(function () { err.hidden = true; }, 4000);
    } else {
      err.hidden = true;
    }
  }

  function load(i) {
    i = i || 0;
    if (i >= DATA_URLS.length) {
      raiseAlarm();
      return;
    }
    fetchDeadline(DATA_URLS[i]).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (data) {
      boardLive = true;
      state.topics = data.topics || [];
      state.merged = (typeof TM_BoardLib !== "undefined")
        ? TM_BoardLib.mergeTopics(state.topics) : state.topics;
      var gen = document.getElementById("data-ts");
      if (gen && data.generated_at) {
        var d = new Date(data.generated_at);
        getEpoch = d.getTime();
        gen.innerHTML = 'data: <span class="num">' + d.toLocaleString() + "</span>";
      }
      lampTest(false); /* V35E complete — board is live */
      clearAlarm(wasAlarmed); wasAlarmed = false; /* GO only after an alarm */
      renderTicker(mergedTopics());
      renderHot5(state.topics);
      renderRadar(mergedTopics());
      renderFilters(state.topics);
      renderTable();
    }).catch(function () { load(i + 1); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    lampTest(true); /* V35E lamp test: every lamp burns while data loads */
    armWatchdog(); /* wave 30 · VP-0001 */
    load();
    loadVelocity();
    tickClock(); setInterval(tickClock, 1000);
    var retry = document.getElementById("load-retry");
    if (retry) retry.addEventListener("click", function () {
      document.body.classList.remove("tm-alarm-1202");
      var err = document.getElementById("load-error");
      if (err) err.hidden = true;
      lampTest(true);
      boardLive = false; /* wave 30 · VP-0001: re-arm for the retry */
      armWatchdog();
      load();
    });
    var pf = document.getElementById("f-platform");
    var cf = document.getElementById("f-category");
    var q = document.getElementById("f-search");
    var sf = document.getElementById("f-phase");
    if (q && state.q) q.value = state.q; /* wave 37: inbound ?q= shows in the box */
    if (pf) pf.addEventListener("change", function () { state.platform = pf.value; syncURL(); renderTable(); });
    if (cf) cf.addEventListener("change", function () { state.category = cf.value; syncURL(); renderTable(); });
    if (sf) sf.addEventListener("change", function () { state.phase = sf.value; syncURL(); renderTable(); });
    if (q) q.addEventListener("input", function () { state.q = q.value.trim(); syncURL(); renderTable(); });
    document.querySelectorAll("[data-sort]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var k = btn.getAttribute("data-sort");
        if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = -1; }
        updateSortUI();
        syncURL();
        renderTable();
      });
    });
    updateSortUI();
  });
})();
