/* ============================================================
   TREND MACHINE — launch-plan.js (wave 3 · "Oracle", wave 10 flagship)
   Standalone 7-day battle planner (launch-plan.html).
   ?topic=<id> deep-links single plans from dossiers and Oracle
   cards; ?battle=a,b,c deep-links multi-trend battle plans.
   Single plans render from LaunchPlanLib.buildPlan; battle plans
   from LaunchPlanLib.buildBattlePlan (2–5 topics, opportunity-led
   rotation, each trend keeps its own pacing).
   Exports: copy-as-text, download .md / .json, print. Saved plans
   (localStorage) support plan-vs-reality check-ins against
   data/velocity_history.json + the forecast ledger.
   ============================================================ */
(function () {
  "use strict";

  var TRENDS_URL = "api/v1/trends.json";
  var HIST_URL = "data/velocity_history.json";
  var LEDGER_URL = "data/forecast_ledger.json";
  var STORE_KEY = "tm_plans_v1";
  var BATTLE_CANDIDATES = 12;

  var byId = {};
  var hist = {};
  var ledgerEntries = [];
  var mode = "single"; // "single" | "battle"
  var currentPlan = null;
  var currentTopics = []; // dossiers behind the current plan

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function qs(name) {
    var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }

  function trajFor(id) {
    return Trajectory.analyze(hist[id] || []);
  }

  function trajStateLine(traj) {
    if (traj && traj.state && traj.state !== "insufficient") {
      return '<span class="traj-chip">' + esc(traj.summary) + "</span> " +
        '<span class="provenance">projection from ' + traj.n +
        " snapshot" + (traj.n === 1 ? "" : "s") + ", not a guarantee</span>";
    }
    return '<span class="provenance">forecasts warming up (fewer than 3 snapshots) — ' +
      "paced as if rising, adapts with history</span>";
  }

  function ledgerLine(ref) {
    if (!ref) {
      return '<span class="provenance">No Oracle forecast recorded for this trend yet — ' +
        "the ledger starts recording once it has 3+ snapshots.</span>";
    }
    var when = esc(String(ref.forecast_at).slice(0, 16).replace("T", " "));
    var status = ref.resolved
      ? "resolved" + (ref.hit === true ? " — hit" : ref.hit === false ? " — miss" : "")
      : "resolves ~48h after recording";
    return '<span class="provenance">Oracle ledger: <strong>' + esc(ref.state || "—") +
      "</strong> recorded " + when + " UTC · " + esc(status) +
      ' · <a href="forecast-accuracy.html">scorecard</a></span>';
  }

  function tipBox(tip) {
    if (!tip) { return ""; }
    return '<p class="plan-tip"><span class="plan-tip-tag">timing tip</span> ' +
      esc(tip.tip) + ' <a href="' + esc(tip.source) + '" class="provenance">(' +
      esc(tip.basis) + ")</a></p>";
  }

  function dayCard(d, isBattle) {
    var meta = '<dl class="mc-meta">' +
      "<div><dt>Platform</dt><dd>" + esc(d.platform) + "</dd></div>" +
      "<div><dt>Format</dt><dd>" + esc(d.format) + "</dd></div>" +
      (d.hashtags.length ? "<div><dt>Hashtags</dt><dd>" + esc(d.hashtags.join(" ")) + "</dd></div>" : "") +
      "</dl>";
    return '<article class="mission-card" role="listitem" data-reveal>' +
      '<header class="mc-head"><span class="mc-day num">Day ' + d.day + "</span>" +
      '<span class="mc-date">' + esc(d.date) + "</span>" +
      (isBattle ? '<span class="battle-topic-chip">' + esc(d.topicTitle) + "</span>" : "") +
      "</header>" +
      '<h3 class="mc-angle">' + esc(d.angle) + "</h3>" +
      '<p class="mc-hook">&ldquo;' + esc(d.hook || "No hook line yet — write one in the moment.") + "&rdquo;</p>" +
      meta + tipBox(d.platformTip) +
      '<p class="mc-src provenance">' + esc(d.provenance) + "</p>" +
      "</article>";
  }

  function whySection(rationale) {
    return '<section class="plan-why" aria-labelledby="why-order">' +
      '<h2 id="why-order">Why this order</h2><ol>' +
      rationale.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") +
      "</ol></section>";
  }

  function planHeader(titleHTML, trajHTML, ledgerHTML) {
    return '<div class="plan-head">' +
      '<p class="kicker">7-day battle plan</p>' +
      "<h2>" + titleHTML + "</h2>" +
      '<p class="oc-honest plan-traj">' + trajHTML + "</p>" +
      '<p class="plan-ledger">' + ledgerHTML + "</p>" +
      "</div>";
  }

  function attachLedgerRefs(plan) {
    if (plan.type === "battle") {
      plan.meta.topics.forEach(function (t) {
        t.ledger_ref = LaunchPlanLib.findLedgerRef(ledgerEntries, t.id);
      });
    } else {
      plan.meta.ledger_ref = LaunchPlanLib.findLedgerRef(ledgerEntries, plan.meta.id);
    }
  }

  function renderSingle(topic) {
    var host = document.getElementById("plan-host");
    var traj = trajFor(topic.id);
    var plan = LaunchPlanLib.buildPlan(topic, traj);
    if (!plan.ok) {
      host.innerHTML = "";
      document.getElementById("plan-status").innerHTML =
        '<div class="oracle-fallback" role="note"><h2>Not enough material yet</h2>' +
        "<p>" + esc(plan.reason) + "</p></div>";
      document.getElementById("plan-actions").hidden = true;
      currentPlan = null;
      return;
    }
    attachLedgerRefs(plan);
    currentPlan = plan;
    currentTopics = [topic];
    document.getElementById("plan-status").innerHTML = "";
    var html =
      planHeader('<a href="topics/' + esc(topic.id) + '.html">' + esc(topic.title) + "</a>",
                 trajStateLine(traj), ledgerLine(plan.meta.ledger_ref)) +
      '<div class="mission-grid" role="list">' +
      plan.days.map(function (d) { return dayCard(d, false); }).join("") +
      "</div>" + whySection(plan.rationale);
    renderInto(host, function () {
      host.innerHTML = html;
      document.getElementById("plan-actions").hidden = false;
    });
  }

  function renderBattle(topics) {
    var host = document.getElementById("plan-host");
    var entries = topics.map(function (t) { return { topic: t, trajectory: trajFor(t.id) }; });
    var plan = LaunchPlanLib.buildBattlePlan(entries, ledgerEntries);
    if (!plan.ok) {
      host.innerHTML = "";
      document.getElementById("plan-status").innerHTML =
        '<div class="oracle-fallback" role="note"><h2>Can\'t build this battle</h2>' +
        "<p>" + esc(plan.reason) + "</p></div>";
      document.getElementById("plan-actions").hidden = true;
      currentPlan = null;
      return;
    }
    currentPlan = plan;
    currentTopics = topics;
    document.getElementById("plan-status").innerHTML = "";
    var chips = plan.meta.topics.map(function (t) {
      return '<span class="battle-topic-chip"><a href="topics/' + esc(t.id) + '.html">' +
        esc(t.title) + "</a> · opp " + t.opportunity + "</span>";
    }).join(" ");
    var ledgerRows = plan.meta.topics.map(function (t) {
      return '<p class="plan-ledger"><strong>' + esc(t.title) + ":</strong> " + ledgerLine(t.ledger_ref) + "</p>";
    }).join("");
    var html =
      '<div class="plan-head">' +
      '<p class="kicker">7-day battle plan · ' + plan.meta.topics.length + " trends</p>" +
      '<h2>' + plan.meta.topics.map(function (t) { return esc(t.title); }).join(" × ") + "</h2>" +
      '<p class="battle-order">' + chips + "</p>" +
      ledgerRows + "</div>" +
      '<div class="mission-grid" role="list">' +
      plan.days.map(function (d) { return dayCard(d, true); }).join("") +
      "</div>" + whySection(plan.rationale);
    renderInto(host, function () {
      host.innerHTML = html;
      document.getElementById("plan-actions").hidden = false;
    });
  }

  /* ---------- exports ---------- */
  function exportText() {
    if (!currentPlan) { return ""; }
    return currentPlan.type === "battle"
      ? LaunchPlanLib.battlePlanToText(currentPlan)
      : LaunchPlanLib.planToText(currentPlan);
  }

  function download(name, content, mime) {
    var blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function planSlug() {
    var ids = (currentPlan.type === "battle"
      ? currentPlan.meta.topics.map(function (t) { return t.id; })
      : [currentPlan.meta.id]);
    return ids.join("-").slice(0, 60);
  }

  /* ---------- saved plans + check-ins ---------- */
  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function storeSaved(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (e) { /* storage full/blocked */ }
  }

  function saveCurrentPlan() {
    if (!currentPlan) { return; }
    var snap = LaunchPlanLib.planSnapshot(currentPlan);
    var list = loadSaved();
    list.unshift(snap);
    storeSaved(list.slice(0, 12)); // cap: keep the 12 most recent
    renderSaved();
    var s = document.getElementById("plan-save-status");
    if (s) { s.textContent = "Plan saved — check back after the forecast window to compare against reality."; }
  }

  function latestVelocity(id) {
    var pts = hist[id] || [];
    return pts.length ? pts[pts.length - 1][1] : null;
  }

  function checkProgress(idx, btn) {
    var list = loadSaved();
    var snap = list[idx];
    if (!snap) { return; }
    var host = document.getElementById("checkin-" + idx);
    btn.disabled = true;
    var rows = snap.topics.map(function (t) {
      var now = latestVelocity(t.id);
      var then = t.velocity;
      var delta = (now == null || then == null) ? null : now - then;
      var arrow = delta == null ? "—" : (delta > 0 ? "▲" : delta < 0 ? "▼" : "●");
      var cls = delta == null ? "" : (delta > 0 ? "up" : delta < 0 ? "down" : "flat");
      var ref = t.ledger_ref;
      var refNote = ref
        ? "Oracle: " + ref.state + " (recorded " + String(ref.forecast_at).slice(0, 16).replace("T", " ") +
          " UTC" + (ref.resolved ? ", resolved" + (ref.hit === true ? " — hit" : ref.hit === false ? " — miss" : "") : ", ~48h window") + ")"
        : "no Oracle forecast recorded at plan time";
      return '<div class="checkin-row">' +
        '<span class="checkin-title">' + esc(t.title) + "</span>" +
        '<span class="checkin-vel num ' + cls + '">' + arrow + " " +
        (then == null ? "—" : then) + " → " + (now == null ? "—" : now) +
        (delta == null ? "" : " (" + (delta > 0 ? "+" : "") + delta + ")") + "</span>" +
        '<span class="provenance">' + esc(refNote) + "</span></div>";
    }).join("");
    host.innerHTML = '<div class="checkin-result" role="status">' +
      '<p><strong>Plan-vs-reality check</strong> — velocity at plan time vs now:</p>' +
      rows +
      '<p class="provenance">Compare against the Oracle\'s recorded forecasts on the ' +
      '<a href="forecast-accuracy.html">scorecard</a>. ' +
      "Saved " + esc(String(snap.generated_at).slice(0, 16).replace("T", " ")) + " UTC.</p></div>";
    host.hidden = false;
    btn.disabled = false;
  }

  function renderSaved() {
    var host = document.getElementById("saved-host");
    if (!host) { return; }
    var list = loadSaved();
    if (!list.length) {
      host.innerHTML = '<p class="provenance">No saved plans yet — generate a plan and hit ' +
        "“Save this plan”. Plans are stored in this browser only.</p>";
      return;
    }
    host.innerHTML = list.map(function (snap, i) {
      var titles = snap.topics.map(function (t) { return t.title; }).join(" × ");
      return '<div class="saved-plan">' +
        '<div><strong>' + esc(titles) + "</strong><br>" +
        '<span class="provenance">' + esc(snap.type) + " · saved " +
        esc(String(snap.generated_at).slice(0, 16).replace("T", " ")) + " UTC</span></div>" +
        '<div class="saved-actions">' +
        '<button type="button" class="btn btn-sm" data-checkin="' + i + '">Check progress</button> ' +
        '<button type="button" class="btn btn-sm" data-unsave="' + i + '">Remove</button></div>' +
        '<div id="checkin-' + i + '" hidden></div>' +
        "</div>";
    }).join("");
    host.querySelectorAll("[data-checkin]").forEach(function (b) {
      b.addEventListener("click", function () {
        checkProgress(parseInt(b.getAttribute("data-checkin"), 10), b);
      });
    });
    host.querySelectorAll("[data-unsave]").forEach(function (b) {
      b.addEventListener("click", function () {
        var l = loadSaved();
        l.splice(parseInt(b.getAttribute("data-unsave"), 10), 1);
        storeSaved(l);
        renderSaved();
      });
    });
  }

  /* ---------- reveal-on-scroll (failure-mode safe, web-craft r2) ---------- */
  var revealObserver = null;
  function revealInit() {
    if (revealObserver) { revealObserver.disconnect(); }
    if (!("IntersectionObserver" in window)) { return; } // content stays visible
    // Arm the hidden initial state ONLY now that the reveal system is
    // live — no-JS / no-IO visitors see finished content, not blanks.
    // (Reduced-motion visitors still get the opacity-fade variant via CSS.)
    document.documentElement.classList.add("reveal-armed");
    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          revealObserver.unobserve(e.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll("[data-reveal]:not(.in)").forEach(function (el) {
      revealObserver.observe(el);
    });
  }

  /* ---------- in-page view transitions (Baseline, reduced-motion gated) ---------- */
  function renderInto(host, build) {
    var reduce = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var update = function () { build(); revealInit(); };
    if (!reduce && document.startViewTransition) {
      document.startViewTransition(update);
    } else {
      update();
    }
  }

  /* ---------- picker ---------- */
  function sortedTopics(topics) {
    return topics.slice().sort(function (a, b) {
      return (b.opportunity_score || 0) - (a.opportunity_score || 0);
    });
  }

  function buildPickers(topics) {
    var sorted = sortedTopics(topics);
    // Single select
    var select = document.getElementById("plan-topic");
    var frag = document.createDocumentFragment();
    sorted.forEach(function (t) {
      var opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.title + " (opp " + t.opportunity_score + ")";
      frag.appendChild(opt);
    });
    select.appendChild(frag);
    select.addEventListener("change", function () {
      if (select.value) {
        history.replaceState(null, "", "?topic=" + encodeURIComponent(select.value));
        renderSingle(byId[select.value]);
      }
    });

    // Battle checklist: top N by opportunity
    var box = document.getElementById("battle-pick");
    var frag2 = document.createDocumentFragment();
    sorted.slice(0, BATTLE_CANDIDATES).forEach(function (t, i) {
      var id = "battle-" + t.id;
      var label = document.createElement("label");
      label.className = "battle-opt";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = id;
      cb.value = t.id;
      if (i < 3) { cb.checked = true; } // start with the top 3
      label.appendChild(cb);
      var span = document.createElement("span");
      span.innerHTML = "<strong>" + esc(t.title) + "</strong> <span class='num'>opp " +
        esc(t.opportunity_score) + "</span>";
      label.appendChild(span);
      frag2.appendChild(label);
    });
    box.appendChild(frag2);
    box.addEventListener("change", updateBattleCount);
    updateBattleCount();
  }

  function updateBattleCount() {
    var n = document.querySelectorAll("#battle-pick input:checked").length;
    var el = document.getElementById("battle-count");
    if (el) { el.textContent = n + " selected"; }
    var btn = document.getElementById("battle-generate");
    if (btn) { btn.disabled = !(n >= 2 && n <= LaunchPlanLib.MAX_BATTLE_TOPICS); }
  }

  function setMode(m) {
    mode = m;
    document.getElementById("mode-single").classList.toggle("active", m === "single");
    document.getElementById("mode-battle").classList.toggle("active", m === "battle");
    document.getElementById("mode-single").setAttribute("aria-pressed", m === "single");
    document.getElementById("mode-battle").setAttribute("aria-pressed", m === "battle");
    document.getElementById("single-pane").hidden = m !== "single";
    document.getElementById("battle-pane").hidden = m !== "battle";
  }

  function generateBattle() {
    var ids = Array.prototype.map.call(
      document.querySelectorAll("#battle-pick input:checked"),
      function (cb) { return cb.value; }
    ).filter(function (id) { return byId[id]; });
    if (ids.length < 2 || ids.length > LaunchPlanLib.MAX_BATTLE_TOPICS) { return; }
    history.replaceState(null, "", "?battle=" + ids.map(encodeURIComponent).join(","));
    renderBattle(ids.map(function (id) { return byId[id]; }));
  }

  function init() {
    var status = document.getElementById("plan-status");
    var actions = document.getElementById("plan-actions");
    actions.hidden = true;

    document.getElementById("mode-single").addEventListener("click", function () { setMode("single"); });
    document.getElementById("mode-battle").addEventListener("click", function () { setMode("battle"); });

    Promise.all([
      fetch(TRENDS_URL).then(function (r) { if (!r.ok) { throw new Error("trends"); } return r.json(); }),
      fetch(HIST_URL).then(function (r) { if (!r.ok) { throw new Error("history"); } return r.json(); }),
      fetch(LEDGER_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var topics = res[0].topics || [];
      hist = res[1] || {};
      var ledger = res[2];
      ledgerEntries = (ledger && ledger.entries) || (Array.isArray(ledger) ? ledger : []);
      topics.forEach(function (t) { byId[t.id] = t; });
      buildPickers(topics);

      document.getElementById("plan-generate").addEventListener("click", function () {
        var id = document.getElementById("plan-topic").value;
        if (id && byId[id]) { renderSingle(byId[id]); }
      });
      document.getElementById("battle-generate").addEventListener("click", generateBattle);

      // Exports
      TMCopy.bindCopyButton("plan-copy", "plan-copy-status", exportText, function (s) {
        if (s) { s.textContent = "Copied the full plan as plain text."; }
      });
      document.getElementById("plan-md").addEventListener("click", function () {
        download("battle-plan-" + planSlug() + ".md",
                 LaunchPlanLib.planToMarkdown(currentPlan), "text/markdown;charset=utf-8");
      });
      document.getElementById("plan-json").addEventListener("click", function () {
        download("battle-plan-" + planSlug() + ".json",
                 JSON.stringify(LaunchPlanLib.planSnapshot(currentPlan), null, 2),
                 "application/json;charset=utf-8");
      });
      document.getElementById("plan-save").addEventListener("click", saveCurrentPlan);

      renderSaved();

      // Deep links
      var bq = qs("battle");
      if (bq) {
        var ids = bq.split(",").map(function (s) { return s.trim(); }).filter(function (id) { return byId[id]; });
        if (ids.length >= 2 && ids.length <= LaunchPlanLib.MAX_BATTLE_TOPICS) {
          setMode("battle");
          document.querySelectorAll("#battle-pick input").forEach(function (cb) {
            cb.checked = ids.indexOf(cb.value) >= 0;
          });
          updateBattleCount();
          renderBattle(ids.map(function (id) { return byId[id]; }));
          return;
        }
      }
      var id = qs("topic");
      if (id && byId[id]) {
        document.getElementById("plan-topic").value = id;
        renderSingle(byId[id]);
      } else {
        status.innerHTML = '<p class="oracle-empty">Pick a topic and hit ' +
          "<strong>Generate plan</strong> — or switch to <strong>Battle mode</strong> to weave " +
          "up to 5 trends into one week.</p>";
      }
    }).catch(function () {
      status.innerHTML = '<div class="oracle-fallback" role="alert"><h2>Couldn\'t load the data</h2>' +
        "<p>The planner needs api/v1/trends.json and data/velocity_history.json. " +
        "Run pipeline/refresh.sh or check the connection.</p></div>";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
