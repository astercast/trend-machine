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
  /* wave 12 · war-room: GET epoch (data run time) for the mission clock */
  var getEpoch = null;
  function lampTest(on) {
    document.body.classList.toggle("tm-lamptest", !!on);
  }

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
    renderScope(memes);
    var count = document.getElementById("radar-count");
    if (count) count.textContent = memes.length + " meme signals tracked";
  }

  /* wave 12 · radar scope: polar plot of the meme contacts.
     Hotter opportunity = closer to center (priority contact closing in).
     Static DOM + CSS sweep: reduced-motion users get a still scope. */
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
        '<title>' + esc(t.title) + " — opportunity " + t.opportunity_score + "</title></circle></g>";
    }).join("");
    box.innerHTML =
      '<svg viewBox="0 0 200 200" role="img" aria-label="Radar scope: ' + memes.length +
      " meme contacts tracked; closest: " + esc(memes[0].title) + '" focusable="false">' +
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
      var gen = document.getElementById("data-ts");
      if (gen && data.generated_at) {
        var d = new Date(data.generated_at);
        getEpoch = d.getTime();
        gen.innerHTML = 'data: <span class="num">' + d.toLocaleString() + "</span>";
      }
      lampTest(false); /* V35E complete — board is live */
      clearAlarm(wasAlarmed); wasAlarmed = false; /* GO only after an alarm */
      renderTicker(state.topics);
      renderHot5(state.topics);
      renderRadar(state.topics);
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
