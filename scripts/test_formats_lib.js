#!/usr/bin/env node
/* trend-machine — wave 9: pinned-fixture tests for assets/js/formats-lib.js.
   Verification is surfaced, never smoothed over: single-source families
   must carry an explicit flag in the rendered output.
   Run: node scripts/test_formats_lib.js   (exit 0 = all pass) */
"use strict";
var F = require("../assets/js/formats-lib.js");

var FAILS = [];
function check(name, cond, detail) {
  if (cond) { console.log("  ok: " + name); }
  else { console.log("  FAIL: " + name + (detail ? " — " + detail : "")); FAILS.push(name); }
}

var DOC = {
  generated_at: "2026-10-11T20:30:00-07:00",
  method: "Hand-curated from web research.",
  families: [
    { id: "costume-walk", name: "Costume walks",
      description: "Low-angle walk then the reveal.",
      status: "rising", status_note: "Runs through Halloween.",
      verification: "verified", curated: "2026-10-11",
      keywords: ["ramalama"],
      examples: [
        { name: "Ramalama Costume Walk", evidence: "430.7K videos",
          sources: [{ name: "SocialPilot", url: "https://www.socialpilot.co/blog/tiktok-trends" }] }
      ],
      tracked_topics: ["ramalama-walk"] },
    { id: "mood-bed", name: "Mood beds",
      description: "Jazz beds under routines.",
      status: "rising", status_note: "",
      verification: "single-source",
      verification_note: "Single source (Virlo reporting Metricool's chart).",
      curated: "2026-10-11",
      keywords: ["my day is good"],
      examples: [
        { name: "Cozy-fall mood beds", evidence: "Original sounds.",
          sources: [{ name: "Virlo", url: "https://virlo.ai/blog/whats-trending-on-tiktok" }],
          verification: "single-source" }
      ],
      tracked_topics: [] }
  ]
};

var TITLES = { "ramalama-walk": "Ramalama Costume Walk" };

check("status chip rising", F.statusChip(DOC.families[0]).indexOf("Rising") > -1);
check("status chip classes", F.statusChip(DOC.families[0]).indexOf("fmt-rising") > -1);

var vbVerified = F.verificationBadge(DOC.families[0]);
check("verified badge shows ✓ verified", vbVerified.indexOf("✓ verified") > -1);
check("verified badge has NO warning", vbVerified.indexOf("single-source") === -1);

var vbSingle = F.verificationBadge(DOC.families[1]);
check("single-source badge shows ⚠ single-source", vbSingle.indexOf("single-source") > -1);
check("single-source note names the source",
  vbSingle.indexOf("Virlo") > -1 && vbSingle.indexOf("Metricool") > -1);

var card = F.familyCardHTML(DOC.families[0], TITLES);
check("card: name + description", card.indexOf("Costume walks") > -1 && card.indexOf("Low-angle walk") > -1);
check("card: example evidence", card.indexOf("430.7K videos") > -1);
check("card: example source link", card.indexOf("socialpilot.co") > -1);
check("card: tracked topic linked", card.indexOf("ramalama-walk") > -1 && card.indexOf("topics/ramalama-walk.html") > -1);
check("card: anchor id", card.indexOf('id="family-costume-walk"') > -1);

var cardEmpty = F.familyCardHTML(DOC.families[1], TITLES);
check("card empty topics: honest 'no live topics'",
  cardEmpty.indexOf("No live topics match this family right now") > -1);
check("card: single-source example flagged", cardEmpty.indexOf("fmt-single") > -1);

var page = F.pageHTML(DOC, TITLES);
check("page: lede names 2 families", page.indexOf("2 format families tracked") > -1);
check("page: method shown", page.indexOf("Hand-curated") > -1);
check("page: both cards present",
  page.indexOf("family-costume-walk") > -1 && page.indexOf("family-mood-bed") > -1);

var pageEmpty = F.pageHTML(null, {});
check("page: null doc is safe", pageEmpty.indexOf("0 format families") > -1);

// --- leaderboard (wave 9 scope-up) ----------------------------------------
var LB_DOC = { families: [
  { id: "costume-walk", name: "Costume walks", status: "rising",
    tracked_topics: ["ramalama-walk", "did-i-win-this-trend"] },
  { id: "dance-hook", name: "Dance hooks", status: "peak",
    tracked_topics: ["bow-bow-bow"] },
  { id: "mood-bed", name: "Mood beds", status: "rising",
    tracked_topics: [] }
]};
var LB_TOPICS = [
  { id: "ramalama-walk", title: "Ramalama", opportunity_score: 85 },
  { id: "did-i-win-this-trend", title: "Did I Win", opportunity_score: 70 },
  { id: "bow-bow-bow", title: "Bow", opportunity_score: 92 }
];

var lbd = F.leaderboardData(LB_DOC, LB_TOPICS);
check("leaderboard: ranks by max opportunity", lbd[0].id === "dance-hook" && lbd[1].id === "costume-walk");
check("leaderboard: max + median", lbd[1].max_opp === 85 && lbd[1].med_opp === 78);
check("leaderboard: familyless topics excluded", lbd.length === 2);
check("leaderboard: empty safe", F.leaderboardData(null, []).length === 0);

var lbh = F.leaderboardHTML(LB_DOC, LB_TOPICS);
check("leaderboard HTML: ranked rows", lbh.indexOf("dance-hook") > -1 && lbh.indexOf(">92<") > -1);
check("leaderboard HTML: anchor links to cards", lbh.indexOf('href="#family-dance-hook"') > -1);
check("leaderboard HTML: empty honest", F.leaderboardHTML({families:[]}, []).indexOf("No families have tracked topics") > -1);

check("playbook: template-then-twist guidance", F.playbookHTML().indexOf("Days 1") > -1);

var page3 = F.pageHTML(LB_DOC, { "bow-bow-bow": "Bow" }, LB_TOPICS);
check("page: leaderboard + playbook sections", page3.indexOf("Format leaderboard") > -1 && page3.indexOf("How to join a format") > -1);

if (FAILS.length) { console.log("\n" + FAILS.length + " FAILURES"); process.exit(1); }
console.log("\nall checks passed");
