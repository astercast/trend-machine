#!/usr/bin/env node
/* trend-machine — wave 39 (rotation 20, VP-0011): pinned-fixture tests
   for assets/js/board-lib.js (phenomenon merges + makeable/news split
   for the One-Look Creator Board). The honesty pins: a merge combines
   evidence and recomputes the score with the pipeline's own formula —
   it never invents a higher number than the formula gives; a merge
   whose canonical row is missing deletes nothing; news never enters
   the make-now list; stale topics never reach the board.
   Run: node scripts/test_board_lib.js   (exit 0 = all pass) */
"use strict";
var B = require("../assets/js/board-lib.js");

var FAILS = [];
function check(name, cond, detail) {
  if (cond) { console.log("  ok: " + name); }
  else { console.log("  FAIL: " + name + (detail ? " — " + detail : "")); FAILS.push(name); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

var MEME = { id: "six-seven-meme", title: "\"6-7\" meme", category: "meme",
  platforms: ["tiktok", "youtube"], hashtags: ["#67"], velocity: 92,
  saturation: "low", opportunity_score: 92, last_seen: "2026-10-12T00:00:00Z",
  sources: [{ name: "Wikipedia", url: "https://example.org/wiki" }],
  angles: ["angle A"], hooks: ["hook A"], format_tags: ["meme"], stale: false };
var DANCE = { id: "seis-sete-dance", title: "\"Six Seven\" funk dance", category: "meme",
  platforms: ["tiktok"], hashtags: ["#sixseven"], velocity: 90,
  saturation: "low", opportunity_score: 90, last_seen: "2026-10-13T00:00:00Z",
  sources: [{ name: "Lightreel", url: "https://example.org/lr" }],
  angles: ["angle B"], hooks: ["hook B"], format_tags: ["dance"], stale: false };
var NEWS = { id: "strike", title: "Missile strike", category: "news",
  platforms: ["x"], hashtags: [], velocity: 88, saturation: "low",
  opportunity_score: 88, last_seen: "2026-10-13T00:00:00Z",
  sources: [], angles: [], hooks: [], format_tags: [], stale: false };
var GAME = { id: "gta6", title: "GTA 6 detail", category: "gaming",
  platforms: ["youtube"], hashtags: [], velocity: 91, saturation: "low",
  opportunity_score: 91, last_seen: "2026-10-13T00:00:00Z",
  sources: [], angles: [], hooks: [], format_tags: [], stale: false };
var STALE = { id: "old", title: "Old meme", category: "meme",
  platforms: ["tiktok"], hashtags: [], velocity: 99, saturation: "low",
  opportunity_score: 99, last_seen: "2026-10-01T00:00:00Z",
  sources: [], angles: [], hooks: [], format_tags: [], stale: true };

console.log("board-lib: score formula (the pipeline's own)");
check("low saturation: no discount", B.opportunity(92, "low") === 92);
check("medium saturation: 35% discount", B.opportunity(100, "medium") === 65);
check("high saturation: 60% discount", B.opportunity(100, "high") === 40);
check("unknown saturation: no invented discount", B.opportunity(50, "?") === 50);

console.log("board-lib: phenomenon merge");
var merged = B.mergeTopics([MEME, GAME, DANCE, NEWS]);
check("one phenomenon, one row: 4 topics -> 3 rows", merged.length === 3);
check("absorbed id is gone", !merged.some(function (t) { return t.id === "seis-sete-dance"; }));
var row = merged.filter(function (t) { return t.id === "six-seven-meme"; })[0];
check("canonical row survives with its title", !!row && row.title === MEME.title);
check("merged_from names the absorbed listing",
  eq(row.merged_from, [{ id: "seis-sete-dance", title: "\"Six Seven\" funk dance" }]));
check("platforms unioned", eq(row.platforms, ["tiktok", "youtube"]));
check("hashtags unioned", eq(row.hashtags, ["#67", "#sixseven"]));
check("sources combined (the evidence merge)",
  eq(row.sources.map(function (s) { return s.name; }), ["Wikipedia", "Lightreel"]));
check("angles combined, canonical first", eq(row.angles, ["angle A", "angle B"]));
check("velocity is the max, not a sum or an invention", row.velocity === 92);
check("score recomputed by formula, not boosted", row.opportunity_score === 92);
check("last_seen is the fresher of the pair", row.last_seen === "2026-10-13T00:00:00Z");
check("unrelated rows pass through untouched", merged[1] === GAME && merged[2] === NEWS);
check("input list is not mutated", MEME.merged_from === undefined && DANCE.platforms.length === 1);

console.log("board-lib: merge guard rails");
var orphan = B.mergeTopics([DANCE]);
check("canonical missing -> absorbed row kept (a merge never deletes data)",
  orphan.length === 1 && orphan[0] === DANCE);
var saturated = B.mergeTopics([
  { id: "six-seven-meme", title: "a", category: "meme", platforms: [], hashtags: [],
    velocity: 80, saturation: "high", opportunity_score: 32, sources: [], angles: [], hooks: [], format_tags: [] },
  { id: "seis-sete-dance", title: "b", category: "meme", platforms: [], hashtags: [],
    velocity: 90, saturation: "low", opportunity_score: 90, sources: [], angles: [], hooks: [], format_tags: [] }
])[0];
check("less-saturated wins: score = 90 * (1 - 0)", saturated.opportunity_score === 90 && saturated.saturation === "low");

console.log("board-lib: makeable vs news");
check("news category is news", B.kindOf(NEWS) === "news");
check("meme category is makeable", B.kindOf(MEME) === "makeable");
check("gaming category is makeable", B.kindOf(GAME) === "makeable");
var sel = B.boardSelection(B.mergeTopics([MEME, DANCE, NEWS, GAME, STALE]));
check("make-now leads with the highest makeable score",
  sel.makeNow.length === 2 && sel.makeNow[0].id === "six-seven-meme" && sel.makeNow[1].id === "gta6");
check("news is labelled apart, never mixed into make-now",
  sel.newsWatch.length === 1 && sel.newsWatch[0].id === "strike" &&
  !sel.makeNow.some(function (t) { return t.id === "strike"; }));
check("stale topics never reach the board",
  !sel.makeNow.some(function (t) { return t.id === "old"; }));
check("caps hold (7 makeable / 3 news)",
  B.boardSelection(Array.from({ length: 12 }, function (_, i) {
    return { id: "m" + i, title: "m" + i, category: "meme", velocity: 50, opportunity_score: 50, stale: false };
  })).makeNow.length === 7);

console.log("board-lib: " + (FAILS.length ? FAILS.length + " FAILURES" : "all pass"));
process.exit(FAILS.length ? 1 : 0);
