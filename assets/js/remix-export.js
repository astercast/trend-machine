/* trend-machine — "Remix this" exporter (wave 2, refactored wave 3, pure-text wave 8)
   Copies the dossier's angles, hook lines, hashtags and best platforms as
   clean plain text, formatted for pasting into a content plan.
   The text itself is built by the pure, unit-tested TM_RemixText module
   (assets/js/remix-text.js); clipboard handling comes from the shared
   TMCopy module (assets/js/tm-copy.js).
   Keyboard accessible: native <button>. Confirmation announced via the
   aria-live status region. */
(function () {
  "use strict";

  function init() {
    var payloadEl = document.getElementById("export-payload");
    if (!payloadEl) { return; }
    var payload;
    try { payload = JSON.parse(payloadEl.textContent); }
    catch (e) { return; }
    if (typeof TM_RemixText === "undefined") { return; }
    TMCopy.bindCopyButton("remix-btn", "remix-status", function () {
      return TM_RemixText.buildRemixText(payload);
    }, function (status) {
      if (status) {
        var n = (payload.angles || []).length + (payload.hooks || []).length;
        var np = (payload.platforms || []).length;
        status.textContent = "Copied " + n + " angles/hooks, " +
          (payload.hashtags || []).length + " hashtags and " + np +
          " best platform" + (np === 1 ? "" : "s") + ".";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
