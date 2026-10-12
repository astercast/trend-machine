/* ============================================================
   TREND MACHINE — launch-plan.js (wave 3 · "Oracle")
   Standalone 7-day battle planner (launch-plan.html).
   ?topic=<id> deep-links from dossiers and Oracle cards;
   a topic picker handles direct visits. Plan rendering comes
   from the shared LaunchPlanLib (rotation/scheduling, never
   inventing angles). Trajectory adapts the plan's "why this
   order" rationale when the topic has 3+ velocity snapshots.
   ============================================================ */
(function () {
  "use strict";

  var TRENDS_URL = "api/v1/trends.json";
  var HIST_URL = "data/velocity_history.json";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function qs(name) {
    var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }

  function renderPlan(topic, traj) {
    var host = document.getElementById("plan-host");
    var status = document.getElementById("plan-status");
    var plan = LaunchPlanLib.buildPlan(topic, traj);
    if (!plan.ok) {
      host.innerHTML = "";
      status.innerHTML = '<div class="oracle-fallback" role="note"><h2>Not enough material yet</h2>' +
        "<p>" + esc(plan.reason) + "</p></div>";
      document.getElementById("plan-actions").hidden = true;
      return;
    }
    status.innerHTML = "";

    var trajNote = "";
    if (traj && traj.state && traj.state !== "insufficient") {
      trajNote = '<p class="oc-honest plan-traj">Trajectory: ' + esc(traj.summary) +
        " — projection from " + traj.n + " snapshot" + (traj.n === 1 ? "" : "s") +
        ", not a guarantee. The plan's pacing adapts to it.</p>";
    } else {
      trajNote = '<p class="oc-honest plan-traj">Forecasts for this topic are still ' +
        "warming up (fewer than 3 snapshots) — the plan paces as if the trend " +
        "is rising and adapts once history exists.</p>";
    }

    var cards = plan.days.map(function (d) {
      return '<article class="mission-card" role="listitem">' +
        '<header class="mc-head"><span class="mc-day num">Day ' + d.day + "</span>" +
        '<span class="mc-date">' + esc(d.date) + "</span></header>" +
        '<h3 class="mc-angle">' + esc(d.angle) + "</h3>" +
        '<p class="mc-hook">&ldquo;' + esc(d.hook || "No hook line yet — write one in the moment.") + "&rdquo;</p>" +
        '<dl class="mc-meta">' +
        "<div><dt>Platform</dt><dd>" + esc(d.platform) + "</dd></div>" +
        "<div><dt>Format</dt><dd>" + esc(d.format) + "</dd></div>" +
        (d.hashtags.length ? "<div><dt>Hashtags</dt><dd>" + esc(d.hashtags.join(" ")) + "</dd></div>" : "") +
        "</dl>" +
        '<p class="mc-src">Angle ' + d.angleNo + " of " + d.angleCount + " from the dossier — nothing invented.</p>" +
        "</article>";
    }).join("");

    var why = '<section class="plan-why" aria-labelledby="why-order">' +
      '<h2 id="why-order">Why this order</h2><ol>' +
      plan.rationale.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") +
      "</ol></section>";

    host.innerHTML =
      '<div class="plan-head">' +
      '<p class="kicker">7-day battle plan</p>' +
      '<h2><a href="topics/' + esc(topic.id) + '.html">' + esc(topic.title) + "</a></h2>" +
      trajNote + "</div>" +
      '<div class="mission-grid" role="list">' + cards + "</div>" + why;

    document.getElementById("plan-actions").hidden = false;

    // Copy-as-text (shared TMCopy pattern, like "Remix this")
    TMCopy.bindCopyButton("plan-copy", "plan-copy-status", function () {
      return LaunchPlanLib.planToText(plan);
    }, function (s) {
      if (s) { s.textContent = "Copied the full 7-day plan as plain text."; }
    });
  }

  function pick(id, byId, hist) {
    var topic = byId[id];
    if (!topic) { return; }
    var select = document.getElementById("plan-topic");
    if (select) { select.value = id; }
    var pts = hist[id] || [];
    var traj = Trajectory.analyze(pts);
    renderPlan(topic, traj);
  }

  function init() {
    var status = document.getElementById("plan-status");
    var actions = document.getElementById("plan-actions");
    actions.hidden = true;
    Promise.all([
      fetch(TRENDS_URL).then(function (r) { if (!r.ok) { throw new Error("trends"); } return r.json(); }),
      fetch(HIST_URL).then(function (r) { if (!r.ok) { throw new Error("history"); } return r.json(); })
    ]).then(function (res) {
      var topics = res[0].topics || [];
      var hist = res[1] || {};
      var byId = {};
      topics.forEach(function (t) { byId[t.id] = t; });

      // Topic picker (standalone use)
      var select = document.getElementById("plan-topic");
      var frag = document.createDocumentFragment();
      var sorted = topics.slice().sort(function (a, b) { return b.opportunity_score - a.opportunity_score; });
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
          pick(select.value, byId, hist);
        }
      });

      document.getElementById("plan-generate").addEventListener("click", function () {
        pick(select.value, byId, hist);
      });

      var id = qs("topic");
      if (id && byId[id]) {
        pick(id, byId, hist);
      } else {
        status.innerHTML = '<p class="oracle-empty">Pick a topic and hit ' +
          "<strong>Generate plan</strong> — or open this page from a topic dossier " +
          "or an Oracle card.</p>";
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
