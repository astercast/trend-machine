#!/usr/bin/env node
/* trend-machine — rotation 24 (D1): shipped-JS parse check.
   QA round 82 found assets/js/board.js carrying a mismatched-quote
   SyntaxError (line 90, and a second masked twin at line 97) that
   killed the whole client-side board script in the browser while
   every suite in the battery stayed green — no suite ever parsed
   the shipped client files as scripts. This suite closes the class:
   it runs `node --check` over EVERY shipped client JS file
   (assets/js/*.js + the static/v1 JSONP twin) and fails if any one
   of them does not parse. Wired into the battery via
   tests/site-checks.sh ("js parse: shipped client JS").
   Run: node scripts/test_js_parse.js   (exit 0 = all parse) */
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIRS = ["assets/js", "static/v1"];
let files = [];
for (const d of DIRS) {
  const abs = path.join(ROOT, d);
  if (!fs.existsSync(abs)) continue;
  for (const name of fs.readdirSync(abs).sort()) {
    if (name.endsWith(".js")) files.push(path.join(d, name));
  }
}

let fails = 0;
for (const rel of files) {
  try {
    execFileSync(process.execPath, ["--check", path.join(ROOT, rel)], { stdio: "pipe" });
    console.log("  ok: parse " + rel);
  } catch (e) {
    fails++;
    console.log("  FAIL: parse " + rel);
    process.stdout.write(String(e.stderr || e.message) + "\n");
  }
}
console.log(`test_js_parse: ${files.length - fails}/${files.length} shipped JS files parse`);
if (!files.length || fails) process.exit(1);
