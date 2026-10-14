/* ============================================================
   TREND MACHINE — wave 16 makeover engine
   Hero live stats + scope blips (real data), stations tabs
   (ARIA tablist + keyboard), scroll reveals, one easter egg.
   Everything degrades to full static content with no JS or
   under prefers-reduced-motion.
   ============================================================ */
(function () {
  "use strict";
  document.documentElement.classList.add("js");
  var RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- hero live numbers ---------- */
  function setStat(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }
  /* wave 30 · VP-0001: hero stats settle even if a fetch hangs — a hung
     fetch resolves to null after 10s (the static snapshot values baked
     into the HTML by build_site.py stay on screen in that case). */
  function withDeadline(p) {
    return Promise.race([p, new Promise(function (res) {
      setTimeout(function () { res(null); }, 10000);
    })]);
  }
  function heroStats() {
    var tb = fetch("data/v1/trends.json").then(function (r) { return r.json(); }).catch(function () { return null; });
    /* wave 39 (VP-0011): the "peaking now" stat is gone — a lone count of
       peaking topics contradicted the board it sat above (393 tracked,
       "1 peaking" told a creator nothing about the other 392). The board
       stats now speak the board's language: makeable-now is set by
       board.js from data/v1/board.json; topics/platforms/age stay here. */
    Promise.all([withDeadline(tb)]).then(function (res) {
      var trends = res[0];
      if (trends) {
        var topics = trends.topics || trends;
        setStat("hs-topics", String(topics.length));
        var plats = {};
        topics.forEach(function (t) { (t.platforms || []).forEach(function (p) { plats[p] = 1; }); });
        setStat("hs-platforms", String(Object.keys(plats).length));
        // scope blips: top 5 by opportunity
        var top = topics.slice().sort(function (a, b) { return (b.opportunity || 0) - (a.opportunity || 0); }).slice(0, 5);
        placeBlips(top);
        var cap = document.getElementById("scope-cap-topic");
        if (cap && top[0]) cap.textContent = "#" + top[0].title.slice(0, 34);
      }
      var ts = document.getElementById("data-ts");
      if (ts && trends && trends.generated_at) {
        var d = new Date(trends.generated_at);
        setStat("hs-age", relAge(d));
      }
    });
  }
  function relAge(d) {
    var m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (m < 1) return "now";
    if (m < 60) return m + "m";
    return Math.round(m / 60) + "h";
  }

  /* ---------- hero scope blips (real top-5, deterministic layout) ---------- */
  function placeBlips(top) {
    var layer = document.getElementById("hero-blips");
    if (!layer || !top.length) return;
    var max = Math.max.apply(null, top.map(function (t) { return t.opportunity || 1; }));
    top.forEach(function (t, i) {
      var b = document.createElement("span");
      b.className = "hero-blip" + (i === 0 ? " hot" : i < 3 ? " warm" : "");
      var ang = (i / top.length) * Math.PI * 2 - Math.PI / 2 + (i * 0.35);
      var rad = 30 + ((t.opportunity || 1) / max) * 16; // hotter = further out
      b.style.left = (50 + rad * Math.cos(ang)) + "%";
      b.style.top = (50 + rad * Math.sin(ang)) + "%";
      b.style.animationDelay = (i * 0.5) + "s";
      b.title = t.title;
      layer.appendChild(b);
    });
  }

  /* ---------- stations tabs ---------- */
  function tabs() {
    var tablist = document.querySelector("[role=tablist]");
    if (!tablist) return;
    var tabNodes = Array.prototype.slice.call(tablist.querySelectorAll('[role=tab]'));
    function select(tab, focus, pushHash) {
      tabNodes.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute("aria-controls"));
        if (panel) {
          panel.classList.toggle("is-active", on);
          if (on) panel.removeAttribute("hidden");
          else panel.setAttribute("hidden", "");
        }
      });
      if (focus) tab.focus();
      if (pushHash) { try { history.replaceState(null, "", "#" + tab.id); } catch (e) {} }
    }
    tabNodes.forEach(function (tab, i) {
      tab.addEventListener("click", function () { select(tab, false, true); });
      tab.addEventListener("keydown", function (e) {
        var j = null;
        if (e.key === "ArrowRight") j = (i + 1) % tabNodes.length;
        else if (e.key === "ArrowLeft") j = (i - 1 + tabNodes.length) % tabNodes.length;
        else if (e.key === "Home") j = 0;
        else if (e.key === "End") j = tabNodes.length - 1;
        if (j !== null) { e.preventDefault(); select(tabNodes[j], true); }
      });
    });
    // deep link: #station-wire etc.
    var hash = (location.hash || "").slice(1);
    var linked = hash && tabNodes.filter(function (t) { return t.id === hash; })[0];
    select(linked || tabNodes[0], false);
  }

  /* ---------- scroll reveal ---------- */
  function reveals() {
    var els = document.querySelectorAll(".reveal");
    if (!els.length || RM || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- easter egg: five clicks on the mission clock ---------- */
  function egg() {
    var clock = document.getElementById("live-clock-time");
    var label = document.getElementById("clock-label");
    if (!clock || !label) return;
    var taps = [], timer = null;
    clock.parentElement.style.cursor = "pointer";
    clock.parentElement.setAttribute("title", "flight dynamics officer approved this button");
    clock.parentElement.addEventListener("click", function () {
      var now = Date.now();
      taps = taps.filter(function (t) { return now - t < 3000; });
      taps.push(now);
      if (taps.length >= 5) {
        taps = [];
        label.textContent = "GO";
        clock.textContent = "GO FOR LAUNCH";
        console.log("%c1202 · PROGRAM ALARM — but we're going anyway. Trend Machine flight: GO FOR LAUNCH.",
          "color:#41ff8a;font-family:monospace");
        clearTimeout(timer);
        timer = setTimeout(function () { label.textContent = "GET"; }, 12000);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    heroStats();
    tabs();
    reveals();
    egg();
  });
})();
