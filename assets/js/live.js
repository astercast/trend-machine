/* live.js: the board redraws itself when newer data exists, and never lies about its age.
   Claude bundle 2026-10-24 §11.5, reconciled to this repo: rows also carry the
   evidence drawer (every source + time), a My Watch pin (device-local, max 5),
   niche boards via ?niche=<category>, a brief export, and a motion off-switch.
   Polling, the age clock, View Transitions and the @property count-up are
   Claude's design unchanged in behaviour. */
/* the clock is the span.age stamp only: <html> itself carries data-age
   ("live"/"stale", set by the page's stamp script) and precedes it in
   document order, so an unscoped [data-age] selector matches <html> and
   the first tick would write the clock text over the whole document. */
const ul = document.querySelector("[data-board]"), clock = document.querySelector("span.age[data-age]");
let stamp = "", rank = new Map(), score = new Map(), DATA = null;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const niche = new URLSearchParams(location.search).get("niche") || "";
const pins = () => { try { return JSON.parse(localStorage.getItem("tm-watch") || "[]"); } catch { return []; } };
const motionOff = () => localStorage.getItem("tm-live-motion") === "off" || document.documentElement.classList.contains("live-motion-off");
const row = (t, i) => {
  const was = rank.get(t.id), d = was == null ? "" : was - (i + 1);
  const one = !t.confirmed;
  const srcs = (t.sources || []).map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.name)}</a>${s.seen ? " · seen " + esc(String(s.seen).slice(0, 16).replace("T", " ")) + " UTC" : ""}</li>`).join("");
  return `<li class="row${one ? " dim" : ""}" style="view-transition-name:t-${esc(t.id)}"><span class="rk">${i + 1}${rank.size && was == null ? '<b class="newtag">NEW</b>' : ""}</span>` +
    `<span class="tt"><a href="${esc(t.url || ("topics/" + t.id + ".html"))}">${esc(t.title)}</a></span><span class="sc" data-to="${t.opportunity_score}" style="--n:${score.get(t.id) ?? 0}"><small>/100</small></span>` +
    (d ? `<span class="moved" style="grid-column:2">${d > 0 ? "up " + d : "down " + -d} since last check</span>` : "") +
    `<button class="pin" type="button" data-pin="${esc(t.id)}" aria-pressed="${pins().includes(t.id)}">${pins().includes(t.id) ? "Pinned" : "Pin"}</button>` +
    `<details class="ev"><summary>Evidence · ${(t.sources || []).length} source${(t.sources || []).length === 1 ? "" : "s"}${one ? " · 1 source only, treat with care" : ""}</summary><ul>${srcs}</ul></details></li>`;
};
function paint(data) {
  DATA = data;
  const topics = niche ? data.topics.filter((t) => (t.category || "") === niche) : data.topics;
  const html = topics.map(row).join("");
  const go = () => { ul.innerHTML = html; requestAnimationFrame(() => ul.querySelectorAll(".sc").forEach((e) => e.style.setProperty("--n", e.dataset.to))); paintWatch(data); };
  matchMedia("(prefers-reduced-motion: reduce)").matches || motionOff() || !document.startViewTransition ? go() : document.startViewTransition(go);
  rank = new Map(data.topics.map((t, i) => [t.id, i + 1])); score = new Map(data.topics.map((t) => [t.id, t.opportunity_score]));
}
function paintWatch(data) {
  const box = document.querySelector("[data-watch-box]"); if (!box) return;
  const list = box.querySelector("[data-watch]"), mine = pins();
  if (!mine.length) { box.hidden = true; return; }
  box.hidden = false;
  let last = {}; try { last = JSON.parse(localStorage.getItem("tm-watch-ranks") || "{}"); } catch {}
  list.innerHTML = mine.map((id) => {
    const i = data.topics.findIndex((t) => t.id === id), t = data.topics[i];
    if (!t) return `<li class="row"><span class="tt">${esc(id)} (not on the board this check)</span></li>`;
    const was = last[id], mv = was == null ? "new to your watch" : (was - (i + 1) > 0 ? "up " + (was - (i + 1)) + " since you were here" : (was - (i + 1) < 0 ? "down " + (i + 1 - was) + " since you were here" : "same place since you were here"));
    return `<li class="row"><span class="rk">${i + 1}</span><span class="tt"><a href="${esc(t.url || ("topics/" + t.id + ".html"))}">${esc(t.title)}</a></span><span class="moved" style="grid-column:2">${mv}</span></li>`;
  }).join("");
  const now = {}; data.topics.forEach((t, i) => { now[t.id] = i + 1; });
  localStorage.setItem("tm-watch-ranks", JSON.stringify(now));
}
function tick() {
  if (!stamp) return;
  const s = Math.max(0, (Date.now() - Date.parse(stamp)) / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = Math.floor(s % 60), p = (n) => String(n).padStart(2, "0");
  clock.textContent = s > 6 * 3600 ? `OLD DATA, ${Math.floor(s / 86400) || 0 ? Math.floor(s / 86400) + " DAYS" : h + " HOURS"}` : `CHECKED ${p(h)}:${p(m)}:${p(x)} AGO`;
  clock.classList.toggle("old", s > 6 * 3600);
}
async function pull() {
  try { const r = await fetch("/data/v1/board.json", { cache: "no-store" }); if (!r.ok) return; const d = await r.json();
    if (d.generated_at !== stamp) { stamp = d.generated_at; paint(d); } } catch {}
}
if (ul && clock) {
  if (motionOff()) document.documentElement.classList.add("live-motion-off");
  const mt = document.getElementById("motion-toggle");
  if (mt) { const sync = () => { mt.textContent = "Motion: " + (motionOff() ? "off" : "on"); mt.setAttribute("aria-pressed", String(motionOff())); }; sync();
    mt.addEventListener("click", () => { const off = !motionOff(); localStorage.setItem("tm-live-motion", off ? "off" : "on"); document.documentElement.classList.toggle("live-motion-off", off); sync(); }); }
  ul.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pin]"); if (!b) return;
    let mine = pins(); const id = b.dataset.pin;
    if (mine.includes(id)) mine = mine.filter((x) => x !== id);
    else { if (mine.length >= 5) { b.textContent = "Watch is full (5)"; return; } mine.push(id); }
    localStorage.setItem("tm-watch", JSON.stringify(mine));
    if (DATA) paint(DATA);
  });
  const bx = document.getElementById("brief-export");
  if (bx) bx.addEventListener("click", () => {
    if (!DATA) return;
    const lines = ["Trend Machine brief · data from " + DATA.generated_at, ""];
    (niche ? DATA.topics.filter((t) => (t.category || "") === niche) : DATA.topics).forEach((t, i) => {
      lines.push(`${i + 1}. ${t.title} — ${t.opportunity_score}/100 · ${(t.sources || []).length} source(s)${t.confirmed ? "" : " (single source)"} · last seen ${t.last_seen || "?"}`);
    });
    const mine = pins(); if (mine.length) { lines.push("", "My watch: " + mine.join(", ")); }
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "trend-brief.txt"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    if (navigator.clipboard) navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
  });
  pull(); setInterval(pull, 5 * 60 * 1000); setInterval(tick, 1000);
  addEventListener("pulse:test", (e) => { stamp = e.detail.generated_at; paint(e.detail); });
}
