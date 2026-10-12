/* trend-machine — wave 8: pure "Remix this" text builder.
   buildRemixText(payload) is a pure function (no DOM, no clipboard) that
   turns a dossier's angles, hook lines, hashtags and best platforms into
   clean plain text for pasting into a content plan.
   Unit-tested with pinned fixtures (scripts/test_remix_export.js).
   Node-safe: exports when module exists. */
var TM_RemixText = (function () {
  "use strict";

  function lines_of(arr) { return Array.isArray(arr) ? arr : []; }

  function buildRemixText(p) {
    p = p || {};
    var lines = [];
    lines.push("TOPIC: " + (p.title || ""));
    lines.push("OPPORTUNITY " + (p.opportunity == null ? "?" : p.opportunity) +
      "/100 \u00b7 VELOCITY " + (p.velocity == null ? "?" : p.velocity) +
      "/100 \u00b7 " + String(p.category || "").toUpperCase());
    var formats = lines_of(p.format_tags);
    if (formats.length) { lines.push("FORMAT SIGNALS: " + formats.join(", ")); }
    var plats = lines_of(p.platforms).filter(Boolean);
    lines.push("BEST PLATFORMS: " + (plats.length ? plats.join(", ") : "(none listed)"));
    lines.push("");
    lines.push("CONTENT ANGLES:");
    var angles = lines_of(p.angles);
    if (angles.length) {
      angles.forEach(function (a, i) { lines.push((i + 1) + ". " + a); });
    } else {
      lines.push("(none yet \u2014 check back after the next refresh)");
    }
    lines.push("");
    lines.push("HOOK LINES:");
    var hooks = lines_of(p.hooks);
    if (hooks.length) {
      hooks.forEach(function (h) { lines.push('- "' + h + '"'); });
    } else {
      lines.push("(none yet)");
    }
    lines.push("");
    var tags = lines_of(p.hashtags);
    lines.push("HASHTAGS: " + (tags.join(" ") || "(none)"));
    lines.push("");
    lines.push("\u2014 from Trend Machine \u00b7 topics/" + (p.id || "") + ".html");
    return lines.join("\n");
  }

  var api = { buildRemixText: buildRemixText };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  return api;
})();
