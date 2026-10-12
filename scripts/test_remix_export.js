#!/usr/bin/env node
/* trend-machine — wave 8: pinned-fixture tests for assets/js/remix-text.js
   (the pure "Remix this" exporter). Run: node scripts/test_remix_export.js */
"use strict";
var R = require("../assets/js/remix-text.js");

var FAILS = [];
function check(name, cond, detail) {
  if (cond) { console.log("  ok: " + name); }
  else { console.log("  FAIL: " + name + "\n--- got ---\n" + detail + "\n---"); FAILS.push(name); }
}
function eq(name, got, want) { check(name, got === want, got); }

console.log("[remix-text] full payload");
var FULL = {
  title: "Ramalama Costume Walk", id: "ramalama", category: "meme",
  opportunity: 91, velocity: 88,
  format_tags: ["dance", "sound"], trend_type: "format+topic",
  platforms: ["tiktok", "youtube"],
  angles: ["Film the walk in your own hallway", "Pet-costume edition"],
  hooks: ["Wait for the drop", "POV: the dog leads"],
  hashtags: ["#ramalama", "#costumewalk"]
};
eq("full payload exact text", R.buildRemixText(FULL),
  "TOPIC: Ramalama Costume Walk\n" +
  "OPPORTUNITY 91/100 · VELOCITY 88/100 · MEME\n" +
  "FORMAT SIGNALS: dance, sound\n" +
  "BEST PLATFORMS: tiktok, youtube\n" +
  "\n" +
  "CONTENT ANGLES:\n" +
  "1. Film the walk in your own hallway\n" +
  "2. Pet-costume edition\n" +
  "\n" +
  "HOOK LINES:\n" +
  '- "Wait for the drop"\n' +
  '- "POV: the dog leads"\n' +
  "\n" +
  "HASHTAGS: #ramalama #costumewalk\n" +
  "\n" +
  "— from Trend Machine · topics/ramalama.html");

console.log("[remix-text] thin payload (no angles/hooks/platforms)");
eq("empty sections exact text", R.buildRemixText({
  title: "Quiet topic", id: "quiet", category: "news",
  opportunity: 12, velocity: 10,
  platforms: [], angles: [], hooks: [], hashtags: []
}),
  "TOPIC: Quiet topic\n" +
  "OPPORTUNITY 12/100 · VELOCITY 10/100 · NEWS\n" +
  "BEST PLATFORMS: (none listed)\n" +
  "\n" +
  "CONTENT ANGLES:\n" +
  "(none yet — check back after the next refresh)\n" +
  "\n" +
  "HOOK LINES:\n" +
  "(none yet)\n" +
  "\n" +
  "HASHTAGS: (none)\n" +
  "\n" +
  "— from Trend Machine · topics/quiet.html");

console.log("[remix-text] missing fields never crash");
var bare = R.buildRemixText({});
check("bare payload renders", bare.indexOf("TOPIC: \n") === 0 &&
  bare.indexOf("BEST PLATFORMS: (none listed)") !== -1, bare);
var nul = R.buildRemixText(null);
check("null payload renders", nul.indexOf("TOPIC: ") === 0, nul);

console.log("[remix-text] platforms preserved verbatim");
var t = R.buildRemixText({ title: "x", platforms: ["instagram", "x"] });
check("platform order kept", t.indexOf("BEST PLATFORMS: instagram, x") !== -1, t);

console.log("\n[test_remix_export] " + FAILS.length + " failures");
process.exit(FAILS.length ? 1 : 0);
