/* trend-machine — "Remix this" exporter (wave 2)
   Copies the dossier's angles, hook lines and hashtags as clean plain text,
   formatted for pasting into a content plan. Clipboard API first, hidden
   textarea + execCommand fallback. Keyboard accessible: native <button>.
   Confirmation state is announced via the aria-live status region. */
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

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); },
        function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    done(ok);
  }

  function init() {
    var btn = document.getElementById("remix-btn");
    var payloadEl = document.getElementById("export-payload");
    var status = document.getElementById("remix-status");
    if (!btn || !payloadEl) { return; }
    var payload;
    try { payload = JSON.parse(payloadEl.textContent); }
    catch (e) { return; }
    var originalLabel = btn.textContent;
    var timer = null;
    btn.addEventListener("click", function () {
      var text = buildText(payload);
      copyText(text, function (ok) {
        if (ok) {
          btn.textContent = "✓ Copied";
          btn.classList.add("is-copied");
          if (status) { status.textContent = "Copied " +
            (payload.angles.length + payload.hooks.length) +
            " angles/hooks and " + payload.hashtags.length + " hashtags."; }
        } else {
          if (status) { status.textContent = "Copy failed — your browser blocked clipboard access."; }
        }
        if (timer) { clearTimeout(timer); }
        timer = setTimeout(function () {
          btn.textContent = originalLabel;
          btn.classList.remove("is-copied");
          if (status) { status.textContent = ""; }
        }, 3000);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
