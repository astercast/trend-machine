/* Status strip: one sentence about how old the data is. Plain words, no clock games.
   Runs once. Without JS the strip still prints the check time. */
(function () {
  var box = document.getElementById("data-ts");
  var g = box && Date.parse(box.dataset.generated || "");
  if (!g) return;
  var mins = Math.max(0, Math.round((Date.now() - g) / 6e4));
  var word = document.getElementById("status-word");
  var age = document.getElementById("status-age");
  var h = document.getElementById("board-h");
  var root = document.documentElement;
  function ago(m) {
    if (m < 2) return "just now";
    if (m < 90) return m + " minutes ago";
    if (m < 2880) return Math.round(m / 60) + " hours ago";
    return Math.round(m / 1440) + " days ago";
  }
  age.textContent = " · " + ago(mins);
  if (mins < 1440) { root.dataset.age = "live"; word.textContent = "Checked"; return; }
  root.dataset.age = "stale";
  word.textContent = "Old data. Last check";
  var day = new Date(g).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  h.innerHTML = "Rising on <time datetime=\"" + new Date(g).toISOString().slice(0, 10) + "\">" + day + "</time>.";
  var deck = document.querySelector(".deck");
  if (deck) deck.textContent = "This list is old. The next check has not landed yet. Each line is still backed by two sources you can open. Nothing here guesses what comes next.";
})();
