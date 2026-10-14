#!/usr/bin/env node
/* trend-machine — wave 29: pinned tests for the Streamer Desk.
   Covers scripts/build_streamer_desk.js (the sourcing gate +
   computed event status) and assets/js/streamer-desk-lib.js
   (rendering + quarantine contract). The contract:
     - a verified drama entry needs >= 2 DISTINCT source domains
       across its timeline — one domain twice is still one source
     - a profile/house/update/event with no source fails the gate
     - an unverified item without a reason fails the gate
     - a non-chronological drama timeline fails the gate
     - event status is computed from dates: an ended event is
       "past", never "upcoming", whatever the seed claims
     - unverified claims render ONLY in the quarantine section,
       badged Unverified, with their reason
   Run: node scripts/test_streamer_desk.js   (exit 0 = all pass) */
"use strict";
var G = require("./build_streamer_desk.js");
var L = require("../assets/js/streamer-desk-lib.js");

var FAILS = [];
function check(name, cond, detail) {
  if (cond) { console.log("  ok: " + name); }
  else { console.log("  FAIL: " + name + (detail ? " — " + detail : "")); FAILS.push(name); }
}
function src(name, url) { return { name: name, url: url }; }

function goodSeed() {
  return {
    curated_at: "2026-10-13", method: "m", sourcing_standard: {},
    streamers: [{ id: "a", name: "A", platforms: ["Twitch"],
      categories: ["gaming"], crew: null, note: "n", as_of: "2026-10-13",
      sources: [src("Wikipedia", "https://en.wikipedia.org/wiki/A")] }],
    houses: [{ id: "h", name: "H", full_name: "House", base: "X",
      founded: "2020", status: "active", members_as_of: "2026-10-13",
      members: ["A"], former_members: [], content: "c",
      sources: [src("Wikipedia", "https://en.wikipedia.org/wiki/H")] }],
    updates: [{ id: "u", date: "2026-10-01", kind: "record", title: "T",
      summary: "s", streamer_ids: ["a"],
      sources: [src("Dexerto", "https://dexerto.com/x")] }],
    drama: [{ id: "d", title: "D", status: "verified", note: "n",
      timeline: [
        { date: "2026-09-01", event: "e1",
          sources: [src("Wikipedia", "https://en.wikipedia.org/wiki/D")] },
        { date: "2026-09-02", event: "e2",
          sources: [src("Dexerto", "https://dexerto.com/y")] }] }],
    unverified: [{ id: "uv", title: "UV", status: "unverified",
      claim: "c", why_unverified: "single chain",
      sources: [src("Blog", "https://blog.example.com/z")] }],
    events: [{ id: "e", name: "E", kind: "convention",
      start: "2026-11-13", end: "2026-11-15", location: "L", note: "n",
      sources: [src("Official", "https://twitchcon.com/")] }],
    feeds: [{ id: "f", label: "F", status: "skip-by-design",
      detail: "no credentials held" }]
  };
}

// --- the gate ------------------------------------------------------
check("well-formed seed passes the gate", G.auditSeed(goodSeed()).length === 0,
      G.auditSeed(goodSeed()).join("; "));

var oneDomain = goodSeed();
oneDomain.drama[0].timeline[1].sources =
  [src("Wikipedia again", "https://en.wikipedia.org/wiki/D2")];
check("drama with 2 events but 1 distinct domain FAILS",
      G.auditSeed(oneDomain).some(e => e.indexOf("distinct") >= 0));

var noSrc = goodSeed();
noSrc.streamers[0].sources = [];
check("sourceless profile FAILS",
      G.auditSeed(noSrc).some(e => e.indexOf("streamer a") >= 0));

var noReason = goodSeed();
noReason.unverified[0].why_unverified = "";
check("unverified without a reason FAILS",
      G.auditSeed(noReason).some(e => e.indexOf("why_unverified") >= 0));

var undated = goodSeed();
undated.houses[0].members_as_of = "";
check("undated roster FAILS",
      G.auditSeed(undated).some(e => e.indexOf("house h") >= 0));

var unordered = goodSeed();
unordered.drama[0].timeline.reverse();
check("non-chronological timeline FAILS",
      G.auditSeed(unordered).some(e => e.indexOf("chronological") >= 0));

var fakeVerified = goodSeed();
fakeVerified.unverified = [];
fakeVerified.drama.push({ id: "d2", title: "D2", status: "reported",
  note: "n", timeline: [{ date: "2026-01-01", event: "x",
    sources: [src("Blog", "https://blog.example.com/q")] }] });
check("non-'verified' drama entry FAILS (belongs in unverified[])",
      G.auditSeed(fakeVerified).some(e => e.indexOf("drama d2") >= 0));

// --- computed event status ------------------------------------------
var now = new Date("2026-10-13T12:00:00Z");
var desk = G.buildDesk(goodSeed(), now);
check("future event computes upcoming",
      desk.events[0].status === "upcoming");
var pastSeed = goodSeed();
pastSeed.events[0].start = "2026-01-04"; pastSeed.events[0].end = "2026-01-10";
check("ended event computes past, never upcoming",
      G.buildDesk(pastSeed, now).events[0].status === "past");
var liveSeed = goodSeed();
liveSeed.events[0].start = "2026-10-12"; liveSeed.events[0].end = "2026-10-14";
check("in-window event computes happening-now",
      G.buildDesk(liveSeed, now).events[0].status === "happening-now");

// --- counts ----------------------------------------------------------
check("counts reconcile with the seed",
      desk.counts.streamers === 1 && desk.counts.houses === 1 &&
      desk.counts.drama_verified === 1 && desk.counts.unverified === 1 &&
      desk.counts.drama_source_domains === 2 &&
      desk.counts.events_upcoming === 1 && desk.counts.events_past === 0 &&
      desk.counts.feeds_skip_by_design === 1);
check("updates sort newest first",
      G.buildDesk(Object.assign(goodSeed(), { updates: [
        { id: "u1", date: "2026-01-01", kind: "k", title: "old",
          summary: "s", streamer_ids: [],
          sources: [src("A", "https://a.example.com/")] },
        { id: "u2", date: "2026-09-01", kind: "k", title: "new",
          summary: "s", streamer_ids: [],
          sources: [src("A", "https://a.example.com/")] }] }), now)
        .updates[0].id === "u2");

// --- rendering --------------------------------------------------------
var drama = L.dramaHTML(desk);
check("verified timeline renders its badge + sources",
      drama.indexOf("Verified · multi-source") >= 0 &&
      drama.indexOf("en.wikipedia.org") >= 0);
var unv = L.unverifiedHTML(desk);
check("quarantine renders the claim badged + its reason",
      unv.indexOf("Unverified") >= 0 &&
      unv.indexOf("single chain") >= 0 &&
      drama.indexOf("UV") < 0);
var houses = L.housesHTML(desk);
check("roster renders its as-of date",
      houses.indexOf("as of 2026-10-13") >= 0);
var events = L.eventsHTML(desk);
check("upcoming event renders the Upcoming badge",
      events.indexOf("Upcoming") >= 0);
var feeds = L.feedsHTML(desk);
check("skip-by-design feed renders its reason, claims nothing live",
      feeds.indexOf("Off on purpose") >= 0 &&
      feeds.indexOf("no credentials held") >= 0);
var sum = L.summaryHTML(desk);
check("summary strip carries the desk counts",
      sum.indexOf("Verified timelines") >= 0 &&
      sum.indexOf("Unverified (quarantined)") >= 0);

console.log(FAILS.length ? ("[test_streamer_desk] " + FAILS.length + " FAILURES")
                         : "[test_streamer_desk] all checks passed");
process.exit(FAILS.length ? 1 : 0);
