/* ============================================================
   TREND MACHINE — warroom.js (wave 15 · Oracle war-room)
   The Oracle as a LIVE WAR-ROOM: a trajectory theatre where forecast
   contacts ignite and burn out on a real-data trajectory map.

   Data (all real, all from the pipeline):
     data/v1/forecasts.json        — contact lists + projections
     data/velocity_history.json   — real past snapshot trails
     data/v1/forecast-accuracy.json — resolution queue countdowns

   Pure geometry lives in warroom-lib.js (unit-tested). This file is the
   DOM layer: SVG scope + HTML blips, the sweep cursor, pings, LEDs,
   mission clock, contacts table, resolution queue.

   Honesty contract: blip/trajectory POSITIONS are data. The sweep and
   pings are illustrative motion only and are labeled as such.
   Reduced motion: the sweep never runs, nothing flashes; the table
   below carries the full content either way.
   ============================================================ */
(function () {
  "use strict";

  var FORECASTS_URL = "data/v1/forecasts.json";
  var HIST_URL = "data/velocity_history.json"; // same URL oracle.js uses
  var ACC_URL = "data/v1/forecast-accuracy.json";

  var SWEEP_PERIOD_MS = 14000;
  var PING_STAGGER_MS = 130;

  var W = window.WarRoomLib;

  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) { throw new Error("http " + r.status + " " + url); }
      return r.json();
    });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function stateClass(state) {
    if (state === "peaking") { return "wr-peak"; }
    if (state === "accelerating" || state === "rising") { return "wr-rise"; }
    if (state === "fading") { return "wr-cool"; }
    return "wr-steady";
  }
  function stateLabel(state) {
    if (state === "peaking") { return "peaking"; }
    if (state === "accelerating") { return "accelerating"; }
    if (state === "rising") { return "rising"; }
    if (state === "fading") { return "cooling"; }
    return state;
  }

  /* ---------- theatre rendering ---------- */

  var PX_W = 1000, PX_H = 520, PAD_L = 64, PAD_R = 28, PAD_T = 26, PAD_B = 44;

  function svgX(h, sc) {
    return PAD_L + ((h - sc.xMin) / (sc.xMax - sc.xMin)) * (PX_W - PAD_L - PAD_R);
  }
  function svgY(v, sc) {
    return (PX_H - PAD_B) - W.logFrac(v, sc.vMax) * (PX_H - PAD_T - PAD_B);
  }
  function pts(points, sc) {
    return points.map(function (p) {
      return svgX(p.h, sc).toFixed(1) + "," + svgY(p.v, sc).toFixed(1);
    }).join(" ");
  }

  function theatreSVG(contacts, geoms, sc) {
    var x0 = svgX(0, sc), x48 = svgX(48, sc);
    var yIgn = svgY(W.IGNITION_V, sc);
    var out = '<svg viewBox="0 0 ' + PX_W + " " + PX_H + '" ' +
      'class="wr-svg" role="img" focusable="false" ' +
      'aria-label="' + esc(theatreAria(contacts, sc)) + '">';

    // grid + axes (logarithmic velocity axis)
    W.logTicks(sc.vMax).forEach(function (v) {
      var y = svgY(v, sc);
      out += '<line x1="' + PAD_L + '" y1="' + y.toFixed(1) + '" x2="' +
        (PX_W - PAD_R) + '" y2="' + y.toFixed(1) + '" class="wr-grid"/>';
      var lbl = v >= 1000 ? "v" + (v / 1000) + "k" : "v" + v;
      out += '<text x="' + (PAD_L - 8) + '" y="' + (y + 4).toFixed(1) +
        '" class="wr-axis" text-anchor="end">' + lbl + "</text>";
    });
    var yBase = svgY(0, sc);
    out += '<text x="' + (PAD_L - 8) + '" y="' + (yBase + 4).toFixed(1) +
      '" class="wr-axis" text-anchor="end">v0</text>';
    var ticks = [
      { h: sc.xMin, label: "T" + sc.xMin + "h" },
      { h: 0, label: "T+NOW" },
      { h: 24, label: "T+24h" },
      { h: 48, label: "T+48h" }
    ];
    ticks.forEach(function (tk) {
      var x = svgX(tk.h, sc);
      out += '<text x="' + x.toFixed(1) + '" y="' + (PX_H - 22) +
        '" class="wr-axis" text-anchor="middle">' + esc(tk.label) + "</text>";
    });

    // ignition line — the classifier's own hot tier
    out += '<line x1="' + PAD_L + '" y1="' + yIgn.toFixed(1) + '" x2="' +
      (PX_W - PAD_R) + '" y2="' + yIgn.toFixed(1) + '" class="wr-ignition"/>';
    out += '<text x="' + (PX_W - PAD_R) + '" y="' + (yIgn - 8).toFixed(1) +
      '" class="wr-ignition-label" text-anchor="end">IGNITION · v≥70</text>';

    // T+NOW cursor
    out += '<line x1="' + x0.toFixed(1) + '" y1="' + PAD_T + '" x2="' +
      x0.toFixed(1) + '" y2="' + (PX_H - PAD_B) + '" class="wr-now"/>';
    out += '<text x="' + x0.toFixed(1) + '" y="' + (PAD_T - 8) +
      '" class="wr-now-label" text-anchor="middle">NOW</text>';

    // trajectories: past solid, projection dashed
    contacts.forEach(function (c) {
      var g = geoms[c.id], cls = stateClass(c.state);
      if (g.past.length >= 2) {
        out += '<polyline points="' + pts(g.past, sc) + '" fill="none" class="wr-past ' + cls + '"/>';
      }
      out += '<polyline points="' + pts(g.proj, sc) + '" fill="none" class="wr-proj ' + cls + '"/>';
      if (g.peak) {
        var px = svgX(g.peak.h, sc), py = svgY(g.peak.v, sc);
        out += '<g class="wr-peakmark ' + cls + '" transform="translate(' +
          px.toFixed(1) + "," + py.toFixed(1) + ')">' +
          '<line x1="-8" y1="0" x2="8" y2="0"/><line x1="0" y1="-8" x2="0" y2="8"/>' +
          '<circle r="10" class="wr-peakring"/></g>';
      }
      var ex = svgX(48, sc), ey = svgY(g.proj[g.proj.length - 1].v, sc);
      out += '<circle cx="' + ex.toFixed(1) + '" cy="' + ey.toFixed(1) +
        '" r="4.5" class="wr-end ' + cls + '" data-end="' + esc(c.id) + '"/>';
    });

    out += "</svg>";
    return out;
  }

  function theatreAria(contacts, sc) {
    var n = { peaking: 0, rising: 0, cooling: 0 };
    contacts.forEach(function (c) {
      var k = c.state === "peaking" ? "peaking"
        : (c.state === "rising" || c.state === "accelerating") ? "rising" : "cooling";
      n[k]++;
    });
    return "Trajectory map of " + contacts.length + " forecast contacts: " +
      n.peaking + " peaking, " + n.rising + " rising, " + n.cooling +
      " cooling. Horizontal axis T" + sc.xMin + "h to T+48h, vertical axis " +
      "velocity on a logarithmic scale (v0 to v" + sc.vMax + "). Dashed " +
      "ignition line at velocity 70. Solid traces are recorded snapshots; " +
      "dashed traces are 48h projections.";
  }

  /* ---------- HTML blips (transform-positioned, 60fps-friendly) ---------- */

  function blipsHTML(contacts, geoms, sc) {
    // Numbered chips, not text tags: 11 blips cluster in a narrow velocity
    // band, so titles would stack and collide. The contacts table below is
    // the numbered legend — war-room style, and it survives 390px screens.
    return contacts.map(function (c, i) {
      var g = geoms[c.id];
      var x = W.xPct(0, sc.xMin, sc.xMax).toFixed(3);
      var y = W.yPct(g.cur.v, sc.vMax).toFixed(3);
      var cls = stateClass(c.state);
      return '<div class="wr-blip ' + cls + '" data-blip="' + esc(c.id) + '" ' +
        'style="left:' + x + "%;top:" + y + '%" ' +
        'title="' + esc(c.title) + " — " + esc(stateLabel(c.state)) + '">' +
        '<span class="wr-dot" aria-hidden="true"></span>' +
        '<span class="wr-ping" aria-hidden="true"></span>' +
        '<span class="wr-num" aria-hidden="true">' + (i + 1) + "</span></div>";
    }).join("");
  }

  /* ---------- sweep (transform only, rAF) ---------- */

  function startSweep(root, contacts, sc) {
    var sweep = root.querySelector(".wr-sweep");
    if (!sweep) { return function () {}; }
    var plot = root.querySelector(".wr-plot");
    var xStart = PAD_L, xEnd = PX_W - PAD_R;
    var plotW = function () { return plot.clientWidth; };
    var pxPerUnit = function () { return plotW() / PX_W; };
    var xAt = function (h) { return svgX(h, sc) * pxPerUnit(); };
    var x0px = null, x48px = null;

    var raf = 0, prevH = sc.xMin, running = true, visible = true;
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { return function () {}; }

    var io = new IntersectionObserver(function (entries) {
      visible = entries[0] && entries[0].isIntersecting;
    }, { threshold: 0.05 });
    io.observe(plot);

    function ping(contact, i) {
      var blip = root.querySelector('[data-blip="' + CSS.escape(contact.id) + '"]');
      if (!blip) { return; }
      var ignite = contact.state !== "fading";
      setTimeout(function () {
        blip.classList.add(ignite ? "wr-fire" : "wr-ember");
        setTimeout(function () {
          blip.classList.remove("wr-fire", "wr-ember");
        }, 950);
      }, i * PING_STAGGER_MS);
    }
    function flashEndpoints() {
      root.querySelectorAll(".wr-end").forEach(function (el) {
        el.classList.add("wr-flash");
        setTimeout(function () { el.classList.remove("wr-flash"); }, 900);
      });
    }

    var t0 = null;
    function frame(ts) {
      if (!running) { return; }
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) { prevH = null; return; }
      if (t0 === null) { t0 = ts; }
      var ph = ((ts - t0) % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS; // 0..1
      var h = sc.xMin + ph * (sc.xMax - sc.xMin);
      sweep.style.transform = "translateX(" + xAt(h).toFixed(1) + "px)";
      // crossings: T+NOW -> ping the contacts; T+48 -> flash endpoints
      if (prevH !== null) {
        if (prevH < 0 && h >= 0) {
          contacts.forEach(ping);
        }
        if (h < prevH) { // wrapped past the right edge
          flashEndpoints();
        }
      }
      prevH = h;
    }
    raf = requestAnimationFrame(frame);
    return function stop() { running = false; cancelAnimationFrame(raf); io.disconnect(); };
  }

  /* ---------- mission clock / LEDs ---------- */

  function missionClock(generatedAt) {
    var el = document.getElementById("wr-clock");
    if (!el) { return; }
    function tick() {
      var ms = Date.parse(generatedAt);
      if (isNaN(ms)) { el.textContent = "LOCAL CLOCK"; return; }
      var s = Math.floor((Date.now() - ms) / 1000);
      var hh = String(Math.floor(s / 3600)).padStart(2, "0");
      var mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      var ss = String(s % 60).padStart(2, "0");
      el.textContent = "T+" + hh + ":" + mm + ":" + ss;
    }
    tick();
    setInterval(tick, 1000);
  }

  function leds(counts, generatedAt, sweepOn) {
    var ageH = (Date.now() - Date.parse(generatedAt)) / 3600000;
    var dataState = ageH <= 26 ? ["wr-led-ok", "DATA RUN"] : ["wr-led-warn", "DATA STALE"];
    return '<div class="wr-leds" role="status" aria-label="War-room status">' +
      '<span class="wr-led ' + dataState[0] + '"><i></i>' + dataState[1] +
      " · " + esc(generatedAt.slice(0, 16).replace("T", " ")) + "Z</span>" +
      '<span class="wr-led ' + (sweepOn ? "wr-led-ok wr-blink" : "wr-led-hold") + '"><i></i>' +
      (sweepOn ? "SWEEP ACTIVE" : "SWEEP HOLD · reduced motion") + "</span>" +
      '<span class="wr-led wr-led-warn"><i></i>RESOLUTIONS · ' +
      (counts.pending || 0) + " pending · " + (counts.resolved || 0) + " resolved</span>" +
      '<span class="wr-led wr-led-ok"><i></i>CONTACTS · ' +
      (counts.peaking || 0) + " peaking · " + (counts.rising || 0) + " rising · " +
      (counts.cooling || 0) + " cooling</span></div>";
  }

  /* ---------- contacts table (the full content, always present) ---------- */

  function contactsTable(contacts) {
    var rows = contacts.map(function (c, i) {
      var peak = (c.state === "peaking")
        ? (c.peak_in_hours === 0 ? "now" : "~" + Math.round(c.peak_in_hours) + "h")
        : "—";
      var slope = (c.slope_per_hour || 0);
      var slopeTxt = (slope >= 0 ? "+" : "") + slope.toFixed(1) + "/hr";
      var accel = (c.accel || 0);
      var accelTxt = (accel >= 0 ? "+" : "") + accel.toFixed(1) + "/hr²";
      var conf = c.confidence ? c.confidence.level : "—";
      return "<tr>" +
        '<td class="num">' + (i + 1) + "</td>" +
        '<th scope="row"><a href="topics/' + esc(c.id) + '.html">' + esc(c.title) + "</a></th>" +
        '<td><span class="wr-state ' + stateClass(c.state) + '">' +
        esc(stateLabel(c.state)) + "</span></td>" +
        '<td class="num">' + c.latest_velocity + "</td>" +
        '<td class="num">' + slopeTxt + "</td>" +
        '<td class="num">' + accelTxt + "</td>" +
        '<td class="num">' + peak + "</td>" +
        '<td>' + esc(conf) + "</td>" +
        '<td class="num">' + c.n_snapshots + "</td></tr>";
    }).join("");
    return '<div class="wr-tablewrap"><table class="wr-table">' +
      "<caption>Every contact on the scope, with the real numbers behind it. " +
      "№ matches the numbered blip on the scope. Slope and accel come from " +
      "the fitted trajectory — accel explains why some curves bend hard. " +
      "No velocity values are predicted.</caption>" +
      "<thead><tr><th scope=\"col\">№</th><th scope=\"col\">Contact</th><th scope=\"col\">State</th>" +
      "<th scope=\"col\">V now</th><th scope=\"col\">Slope</th>" +
      "<th scope=\"col\">Accel</th><th scope=\"col\">Peak in</th>" +
      "<th scope=\"col\">Confidence</th><th scope=\"col\">Snapshots</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></div>";
  }

  /* ---------- resolution queue ---------- */

  function queueHTML(acc) {
    if (!acc || !acc.upcoming_resolutions || !acc.upcoming_resolutions.length) {
      return '<p class="wr-queue-empty">No resolution windows on the board yet.</p>';
    }
    var nowMs = Date.now();
    var rows = acc.upcoming_resolutions.map(function (u) {
      var closeMs = Date.parse(u.date + "T00:00:00Z");
      var cd = W.countdown(closeMs - nowMs);
      return '<div class="wr-queue-row"><span class="wr-queue-date num">' +
        esc(u.date) + '</span><span class="wr-queue-n num">' + u.pending +
        ' forecasts come due</span><span class="wr-queue-cd">' + esc(cd) + "</span></div>";
    }).join("");
    var c = acc.counts || {};
    return '<div class="wr-queue" role="list" aria-label="Forecast resolution queue">' +
      rows + "</div>" +
      '<p class="wr-queue-note">Each forecast is judged against the actual ' +
      "velocity 48h after recording: hit, miss, or unverifiable. " +
      (c.recorded || 0) + " recorded · " + (c.resolved || 0) + " resolved · " +
      '<a href="forecast-accuracy.html">open the full scorecard →</a></p>';
  }

  /* ---------- init ---------- */

  function fail(msg, retry) {
    var el = document.getElementById("warroom");
    if (!el) { return; }
    el.innerHTML = '<div class="wr-alarm" role="alert"><h2>⚠ THEATRE OFFLINE</h2>' +
      "<p>" + esc(msg) + "</p>" +
      (retry ? '<button type="button" class="btn" id="wr-retry">↻ Retry</button>' : "") +
      "</div>";
    var b = document.getElementById("wr-retry");
    if (b) { b.addEventListener("click", init); }
  }

  function init() {
    var root = document.getElementById("warroom");
    if (!root || !W) { return; }
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    Promise.all([getJSON(FORECASTS_URL), getJSON(HIST_URL), getJSON(ACC_URL)])
      .then(function (res) {
        var fc = res[0], hist = res[1] || {}, acc = res[2] || null;
        var contacts = (fc.peaking_48h || []).concat(fc.rising_fast || [], fc.cooling_off || []);
        if (!contacts.length) {
          root.innerHTML = '<div class="wr-quiet" role="note"><h2>Scope is quiet</h2>' +
            "<p>No contact qualifies for a forecast right now — nothing is " +
            "peaking, rising, or cooling on its trajectory. The scope lights " +
            "up again when a topic earns 3+ snapshots and a decisive call.</p></div>";
          return;
        }
        var nowMs = Date.now();
        var geoms = {};
        contacts.forEach(function (c) {
          geoms[c.id] = W.contactGeometry(c, hist[c.id] || [], nowMs);
        });
        var sc = W.theatreScales(Object.keys(geoms).map(function (k) { return geoms[k]; }));

        var counts = {
          peaking: (fc.peaking_48h || []).length,
          rising: (fc.rising_fast || []).length,
          cooling: (fc.cooling_off || []).length,
          pending: acc && acc.counts ? acc.counts.pending : 0,
          resolved: acc && acc.counts ? acc.counts.resolved : 0
        };

        root.innerHTML =
          leds(counts, fc.generated_at || "", !reduced) +
          '<div class="wr-clockline"><span class="kicker">mission clock</span> ' +
          '<span class="num wr-clock" id="wr-clock">T+--:--:--</span></div>' +
          '<div class="wr-plot' + (reduced ? " wr-still" : "") + '" id="wr-plot">' +
          theatreSVG(contacts, geoms, sc) +
          '<div class="wr-blips">' + blipsHTML(contacts, geoms, sc) + "</div>" +
          (reduced ? "" : '<div class="wr-sweep" aria-hidden="true"></div>') +
          "</div>" +
          '<div class="wr-legend">' +
          '<span><i class="wr-key wr-past"></i>recorded snapshots</span>' +
          '<span><i class="wr-key wr-proj"></i>48h projection</span>' +
          '<span><i class="wr-key wr-peakmark"></i>projected peak</span>' +
          '<span><i class="wr-key wr-fire-key"></i>ignition ping · peaking/rising</span>' +
          '<span><i class="wr-key wr-ember-key"></i>burnout ember · cooling</span>' +
          "</div>" +
          '<p class="wr-honest">Every position on this scope is computed from ' +
          "real snapshot data (" + contacts.length + " contacts, 3–8 snapshots " +
          "each). The vertical axis is logarithmic so the full spread fits " +
          "on one scope; curves show direction and curvature from the " +
          "fitted parabola — not predicted velocity values. The sweep and " +
          "pings are illustrative motion, not data — " +
          (reduced ? "motion is off for you, and nothing is hidden: " : "") +
          "the full numbers are in the table below.</p>" +
          '<h3 class="wr-sub">Contacts on scope</h3>' + contactsTable(contacts) +
          '<h3 class="wr-sub">Resolution queue</h3>' + queueHTML(acc);

        missionClock(fc.generated_at || "");
        if (!reduced) { startSweep(root, contacts, sc); }
      })
      .catch(function (e) {
        fail("Couldn't load the forecast data (" + (e && e.message || "fetch failed") +
             "). The theatre needs data/v1/forecasts.json and data/velocity_history.json.", true);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
