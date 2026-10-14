/* trend-machine — wave 9: pure meme-format-families rendering lib.
   Reads data/v1/meme-formats.json (the curated family file + per-run topic
   links) and renders the "Meme formats" view. Verification is surfaced,
   never smoothed over: single-source families carry an explicit flag.
   Pure functions, no DOM — unit-tested with pinned fixtures
   (scripts/test_formats_lib.js). Node-safe: exports when module exists. */
var TM_Formats = (function () {
  "use strict";

  function normT(s) {
    return String(s == null ? "" : s).replace(/\s+[\u2014\u2013]\s+/g, ", ").replace(/[\u2014\u2013]/g, "-");
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var STATUS_LABELS = {
    rising: "Rising", peak: "At peak", fading: "Fading",
    established: "Established", evergreen: "Evergreen"
  };

  function statusChip(f) {
    var s = f.status || "rising";
    return '<span class="chip fmt-status fmt-' + esc(s) + '">' +
      esc(STATUS_LABELS[s] || s) + "</span>";
  }

  function verificationBadge(f) {
    if (f.verification === "single-source") {
      var note = f.verification_note || "one source";
      return '<span class="chip fmt-verify fmt-single" title="Single source: ' +
        esc(normT(note)) + '">⚠ single-source</span>' +
        '<p class="fmt-flag-note">' + esc(normT(note)) + "</p>";
    }
    return '<span class="chip fmt-verify fmt-verified">✓ verified</span>';
  }

  function exampleHTML(ex) {
    var srcs = (ex.sources || []).map(function (s) {
      return s.url
        ? '<a href="' + esc(s.url) + '">' + esc(normT(s.name)) + "</a>"
        : "<span>" + esc(normT(s.name)) + "</span>";
    }).join(" · ");
    var flag = ex.verification === "single-source"
      ? ' <span class="chip fmt-verify fmt-single">single-source</span>' : "";
    return '<li><strong>' + esc(normT(ex.name)) + "</strong>" + flag +
      (ex.evidence ? "<br>" + esc(normT(ex.evidence)) : "") +
      (srcs ? "<br><span class=\"fmt-sources\">Sources: " + srcs + "</span>" : "") +
      "</li>";
  }

  function familyCardHTML(f, topicTitles) {
    var examples = (f.examples || []).map(exampleHTML).join("");
    var topics = (f.tracked_topics || []).map(function (tid) {
      var title = (topicTitles || {})[tid] || tid;
      return '<li><a href="topics/' + esc(tid) + '.html">' + esc(normT(title)) + "</a></li>";
    }).join("");
    return '<article class="fmt-card" id="family-' + esc(f.id) + '" role="listitem">' +
      '<div class="fmt-top"><h2>' + esc(normT(f.name)) + "</h2>" +
      statusChip(f) + verificationBadge(f) + "</div>" +
      '<p class="fmt-desc">' + esc(f.description) + "</p>" +
      (f.status_note ? '<p class="fmt-status-note">' + esc(f.status_note) + "</p>" : "") +
      (examples ? '<h3>Current examples</h3><ul class="fmt-examples">' + examples + "</ul>" : "") +
      (topics ? '<h3>Tracked in the pipeline</h3><ul class="fmt-topics">' + topics + "</ul>"
              : '<p class="oracle-empty">No live topics match this family right now. ' +
                "The pipeline links topics automatically when their text names the family.</p>") +
      "</article>";
  }

  function methodHTML(doc) {
    return '<section class="fmt-method" aria-labelledby="fmt-method-h">' +
      '<h2 id="fmt-method-h">How format families are tracked</h2>' +
      '<p class="oc-honest">' + esc((doc && doc.method) || "") + "</p>" +
      '<p class="oc-honest">Curated ' + esc((doc && doc.generated_at) || "recently") +
      " from web research: " + esc(STATUS_LABELS.rising) + " / " +
      esc(STATUS_LABELS.peak) + " describe the current cycle; " +
      esc(STATUS_LABELS.established) + " and " + esc(STATUS_LABELS.evergreen) +
      " are long-lived templates tracked for completeness, not momentum.</p></section>";
  }

  // Wave 9 — format leaderboard: families ranked by the hottest tracked
  // topic opportunity. Real pipeline numbers — a family with no tracked
  // topics gets no rank, never a zero.
  function leaderboardData(doc, topics) {
    var fams = (doc && doc.families) || [];
    var byId = {};
    (topics || []).forEach(function (t) { byId[t.id] = t; });
    var rows = [];
    fams.forEach(function (f) {
      var opps = (f.tracked_topics || [])
        .map(function (tid) { return byId[tid]; })
        .filter(function (t) { return t && typeof t.opportunity_score === "number"; })
        .map(function (t) { return t.opportunity_score; });
      if (!opps.length) { return; }
      rows.push({ id: f.id, name: f.name, status: f.status,
                  topics: opps.length,
                  max_opp: Math.max.apply(null, opps),
                  med_opp: median(opps) });
    });
    rows.sort(function (a, b) { return b.max_opp - a.max_opp; });
    return rows;
  }

  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  }

  function leaderboardHTML(doc, topics) {
    var rows = leaderboardData(doc, topics);
    var body;
    if (!rows.length) {
      body = '<p class="oracle-empty">No families have tracked topics right now.</p>';
    } else {
      var trs = rows.map(function (r, i) {
        return "<tr><td class=\"num\">" + (i + 1) + "</td>" +
          '<td><a href="#family-' + esc(r.id) + '">' + esc(r.name) + "</a></td>" +
          "<td>" + esc(STATUS_LABELS[r.status] || r.status) + "</td>" +
          '<td class="num">' + r.topics + '</td><td class="num">' + r.max_opp + "</td>" +
          '<td class="num">' + r.med_opp + "</td></tr>";
      }).join("");
      body = '<table class="sc-table"><thead><tr><th scope="col">#</th>' +
        '<th scope="col">Family</th><th scope="col">Status</th>' +
        '<th scope="col">Tracked topics</th><th scope="col">Hottest topic</th>' +
        '<th scope="col">Median</th></tr></thead><tbody>' + trs +
        "</tbody></table>";
    }
    return '<section class="fmt-leaderboard" aria-labelledby="fmt-lb-h">' +
      '<h2 id="fmt-lb-h">Format leaderboard</h2>' +
      '<p class="oc-honest">Ranked by the hottest tracked topic\u2019s ' +
      "opportunity score, live pipeline numbers. Families with no tracked " +
      "topics get no rank, never a zero.</p>" + body + "</section>";
  }

  function playbookHTML() {
    return '<section class="fmt-method" aria-labelledby="fmt-pb-h">' +
      '<h2 id="fmt-pb-h">How to join a format</h2>' +
      '<p class="oc-honest">Formats reward speed and the twist. The pacing ' +
      "that works across families: run the template straight for Days 1 to 3 " +
      "(the audience needs the recognizable shape), then twist it on Day 4+: " +
      "your niche, your product, your confession. Rising families are the " +
      "join-now window; peaked families need the twist up front; " +
      "evergreen/established families are always fillable but never urgent.</p></section>";
  }

  function pageHTML(doc, topicTitles, topics) {
    var fams = (doc && doc.families) || [];
    var n = fams.length;
    var cards = fams.map(function (f) { return familyCardHTML(f, topicTitles); }).join("");
    return '<p class="fmt-lede">' + n + " format families tracked: reusable templates, " +
      "not one-off trends. A family's topics are linked from the live pipeline data; " +
      "families the evidence doesn't support are flagged, never hidden.</p>" +
      leaderboardHTML(doc, topics) +
      methodHTML(doc) + playbookHTML() +
      '<div class="fmt-grid" role="list">' + cards + "</div>";
  }

  var api = {
    STATUS_LABELS: STATUS_LABELS,
    statusChip: statusChip,
    verificationBadge: verificationBadge,
    exampleHTML: exampleHTML,
    familyCardHTML: familyCardHTML,
    leaderboardData: leaderboardData,
    leaderboardHTML: leaderboardHTML,
    playbookHTML: playbookHTML,
    methodHTML: methodHTML,
    pageHTML: pageHTML
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  return api;
})();
