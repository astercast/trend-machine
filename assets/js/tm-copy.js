/* ============================================================
   TREND MACHINE — tm-copy.js (wave 3 · "Oracle")
   Shared clipboard helper, extracted from the wave-2
   "Remix this" exporter so exporters reuse one pattern:
   Clipboard API first, hidden-textarea fallback.
   Browser global: window.TMCopy
   ============================================================ */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TMCopy = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function copyText(text, done) {
    if (typeof navigator !== "undefined" && navigator.clipboard &&
        navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); },
        function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ok = false;
    try {
      if (typeof document === "undefined") { done(false); return; }
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e) { ok = false; }
    done(ok);
  }

  // Wire a button + status region to a text-builder. Returns the button.
  function bindCopyButton(btnId, statusId, buildText, onCopied) {
    var btn = document.getElementById(btnId);
    if (!btn) { return null; }
    var status = statusId ? document.getElementById(statusId) : null;
    var originalLabel = btn.textContent;
    var timer = null;
    btn.addEventListener("click", function () {
      var text = buildText();
      copyText(text, function (ok) {
        if (ok) {
          btn.textContent = "\u2713 Copied";
          btn.classList.add("is-copied");
          if (status) { status.textContent = "Copied to clipboard."; }
          if (onCopied) { onCopied(status); }
        } else {
          if (status) {
            status.textContent = "Copy failed — your browser blocked clipboard access.";
          }
        }
        if (timer) { clearTimeout(timer); }
        timer = setTimeout(function () {
          btn.textContent = originalLabel;
          btn.classList.remove("is-copied");
          if (status) { status.textContent = ""; }
        }, 3000);
      });
    });
    return btn;
  }

  return { copyText: copyText, bindCopyButton: bindCopyButton };
});
