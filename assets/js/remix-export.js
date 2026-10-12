/* trend-machine — "Remix this" exporter (wave 2, refactored wave 3)
   Copies the dossier's angles, hook lines and hashtags as clean plain text,
   formatted for pasting into a content plan. Clipboard handling now comes
   from the shared TMCopy module (assets/js/tm-copy.js).
   Keyboard accessible: native <button>. Confirmation announced via the
   aria-live status region. */
(function () {
  "use strict";

  function buildText(p) {
    var lines = [];
    lines.push("TOPIC: " + (p.title || ""));
    lines.push("OPPORTUNITY " + p.opportunity + "/100 · VELOCITY " + p.velocity +
      "/100 · " + (p.category || "").toUpperCase());
    if (p.format_tags && p.format_tags.length) {
      lines.push("FORMAT SIGNALS: " + p.format_tags.join(", "));
    }
    lines.push("");
    lines.push("CONTENT ANGLES:");
    (p.angles || []).forEach(function (a, i) { lines.push((i + 1) + ". " + a); });
    if (!(p.angles || []).length) { lines.push("(none yet — check back after the next refresh)"); }
    lines.push("");
    lines.push("HOOK LINES:");
    (p.hooks || []).forEach(function (h) { lines.push('- "' + h + '"'); });
    if (!(p.hooks || []).length) { lines.push("(none yet)"); }
    lines.push("");
    lines.push("HASHTAGS: " + ((p.hashtags || []).join(" ") || "(none)"));
    lines.push("");
    lines.push("— from Trend Machine · topics/" + (p.id || "") + ".html");
    return lines.join("\n");
  }

  function init() {
    var payloadEl = document.getElementById("export-payload");
    if (!payloadEl) { return; }
    var payload;
    try { payload = JSON.parse(payloadEl.textContent); }
    catch (e) { return; }
    TMCopy.bindCopyButton("remix-btn", "remix-status", function () {
      return buildText(payload);
    }, function (status) {
      if (status) {
        status.textContent = "Copied " +
          ((payload.angles || []).length + (payload.hooks || []).length) +
          " angles/hooks and " + (payload.hashtags || []).length + " hashtags.";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
