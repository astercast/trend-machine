#!/usr/bin/env node
/* trend-machine — wave 8: pinned-fixture tests for assets/js/sparkline-lib.js.
   Run: node scripts/test_sparkline_lib.js   (exit 0 = all pass) */
"use strict";
var S = require("../assets/js/sparkline-lib.js");

var FAILS = [];
function check(name, cond, detail) {
  if (cond) { console.log("  ok: " + name); }
  else { console.log("  FAIL: " + name + (detail ? " " + detail : "")); FAILS.push(name); }
}

var RISING_4 = [
  ["2026-10-11T18:00:00+00:00", 40],
  ["2026-10-11T19:00:00+00:00", 50],
  ["2026-10-11T20:00:00+00:00", 60],
  ["2026-10-11T21:00:00+00:00", 70]
];
var FLAT_3 = [
  ["2026-10-11T18:00:00+00:00", 55],
  ["2026-10-11T19:00:00+00:00", 55],
  ["2026-10-11T20:00:00+00:00", 55]
];
var THIN_2 = [
  ["2026-10-11T20:00:00+00:00", 61],
  ["2026-10-11T21:00:00+00:00", 63]
];

console.log("[sparkline-lib] prep");
// width=120 height=30 pad=4: x spans 4..116; y = 26 - ((v-40)/30)*22
var p = S.prep(RISING_4, 120, 30, 4);
check("rising ready", p.ready === true && p.n === 4);
check("rising coords exact",
  JSON.stringify(p.coords) === JSON.stringify(["4.0,26.0", "41.3,18.7", "78.7,11.3", "116.0,4.0"]),
  JSON.stringify(p.coords));
check("rising delta", p.delta === 30 && p.first === 40 && p.last === 70);

p = S.prep(FLAT_3, 120, 30, 4);
check("flat ready, y identical",
  p.ready === true && p.coords.every(function (c) { return c.split(",")[1] === "26.0"; }),
  JSON.stringify(p.coords));

p = S.prep(THIN_2);
check("2-pt not ready (honest <3 rule)", p.ready === false);
p = S.prep([]);
check("empty not ready", p.ready === false && p.first === null);

console.log("[sparkline-lib] svg");
var s = S.svg(RISING_4, { labelPrefix: "Velocity trend for ramalama" });
check("svg role=img + grounded aria-label",
  s.indexOf('role="img"') !== -1 &&
  s.indexOf("Velocity trend for ramalama: 40 at first snapshot, 70 at latest (4 snapshots).") !== -1);
check("svg static", s.indexOf("<animate") === -1 && s.indexOf("<script") === -1);
check("thin returns empty string", S.svg(THIN_2) === "");
var evil = S.svg(RISING_4, { labelPrefix: 'x"><script>alert(1)</script>' });
check("label escaped", evil.indexOf("<script") === -1 && evil.indexOf("&lt;script") !== -1);

console.log("[sparkline-lib] cellHTML");
var cell = S.cellHTML(RISING_4, "ramalama");
check("ready cell has svg + sr delta", cell.indexOf("<svg") !== -1 && cell.indexOf("+30 since tracking started") !== -1);
var thin = S.cellHTML(THIN_2, "thin");
check("thin cell honest, no svg", thin.indexOf("<svg") === -1 && thin.indexOf("history building") !== -1);

console.log("\n[test_sparkline_lib] " + FAILS.length + " failures");
process.exit(FAILS.length ? 1 : 0);
