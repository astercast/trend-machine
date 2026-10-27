/* fleet-bar.js (Trend Machine copy): the "Updated N minutes ago, N new, Show"
   notice, fed by fleet-data instead of a deploy.
   <script src="/assets/js/fleet-live.js"></script><script src="/assets/js/fleet-bar.js" data-site="trend-machine"></script>
   R303 (review-trend-1 item 3): this copy mounts INSIDE the status strip's
   reserved slot (#fleet-slot in the .status bar under the nav) instead of
   floating over the page. The slot holds its height from first paint, so
   the notice appearing moves nothing. Fires "fleet:show" on your page when
   the visitor presses Show; your page redraws from the data it holds. */
(function () {
  var s = document.currentScript, site = s.dataset.site, t0 = new Date().toISOString().slice(0, 19) + "Z", seen = 0, last = null;
  var slot = document.getElementById("fleet-slot");
  if (!slot) return;
  var bar = document.createElement("span"); bar.setAttribute("role", "status"); bar.hidden = true;
  bar.className = "fleet-bar";
  var txt = document.createElement("span"), btn = document.createElement("button");
  btn.textContent = "Show"; btn.type = "button"; btn.className = "fleet-show";
  btn.onclick = function () { document.dispatchEvent(new CustomEvent("fleet:show")); bar.hidden = true; seen = fresh().length; };
  bar.append(txt, btn); slot.append(bar);
  function fresh() { return ((last && last.changes) || []).filter(function (c) { return c.at > t0; }); }
  function ago() { if (!last) return ""; var m = Math.max(0, Math.round((Date.now() - Date.parse(last.generated_at)) / 60000)); return m < 1 ? "just now" : m < 60 ? m + " minutes ago" : Math.round(m / 60) + " hours ago"; }
  FleetLive.watch(site, "pulse.json", function (p) { last = p; var n = fresh().length - seen; if (n > 0) { txt.textContent = "Updated " + ago() + ". " + n + " new."; bar.hidden = false; } });
})();
