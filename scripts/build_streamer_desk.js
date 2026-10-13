/* ============================================================
   TREND MACHINE — build_streamer_desk.js (wave 29 / rotation 12)
   The Streamer Desk payload: generator-owned, built from the
   hand-curated record data/streamer_desk.json (the meme-formats
   pattern: a curated source file, a generator that refuses to
   publish anything that breaks the sourcing standard).

   The standard is enforced HERE, in code, not in prose:
     - every streamer profile and house carries >= 1 source;
     - every drama entry printed as "verified" must hold >= 2
       DISTINCT source domains across its timeline events, every
       timeline event carries >= 1 source, and the entry carries
       a note;
     - every update carries >= 1 source and a real date;
     - every event carries >= 1 source and start <= end;
     - unverified items must say WHY they are unverified.
   A seed that breaks the bar makes this build FAIL — the Desk
   would rather not publish than launder a claim.

   Event status (past / upcoming / happening now) is computed
   from the event dates against the build clock — never stored,
   so a past event can never pose as upcoming.

   Input : data/streamer_desk.json
   Output: data/v1/streamer-desk.json
           + patches data/v1/index.json (streamer_desk endpoint)
   Run   : node scripts/build_streamer_desk.js
           (wired into pipeline/refresh.sh after build_live_wire.js)
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SEED = path.join(ROOT, "data", "streamer_desk.json");
const API = path.join(ROOT, "data", "v1");
const OUT = path.join(API, "streamer-desk.json");
const MANIFEST = path.join(API, "index.json");

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { return fallback; }
}
function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}
function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch (e) { return ""; }
}
function isDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    isFinite(Date.parse(s + "T00:00:00Z"));
}

/* The sourcing gate. Returns a list of violations ([] = publish). */
function auditSeed(seed) {
  const errs = [];
  const needSources = (where, sources) => {
    if (!Array.isArray(sources) || !sources.length) {
      errs.push(where + ": no sources");
      return;
    }
    sources.forEach(s => {
      if (!s || !s.name || !s.url || !/^https?:\/\//.test(s.url)) {
        errs.push(where + ": malformed source " + JSON.stringify(s));
      }
    });
  };
  (seed.streamers || []).forEach(p => {
    needSources("streamer " + p.id, p.sources);
    if (!p.platforms || !p.platforms.length) {
      errs.push("streamer " + p.id + ": no platforms");
    }
    if (!p.as_of) { errs.push("streamer " + p.id + ": no as_of date"); }
  });
  (seed.houses || []).forEach(h => {
    needSources("house " + h.id, h.sources);
    if (!h.members_as_of) {
      errs.push("house " + h.id + ": roster not dated (members_as_of)");
    }
  });
  (seed.updates || []).forEach(u => {
    needSources("update " + u.id, u.sources);
    if (!isDate(u.date)) { errs.push("update " + u.id + ": bad date"); }
  });
  (seed.drama || []).forEach(d => {
    if (d.status !== "verified") {
      errs.push("drama " + d.id + ": status must be 'verified' here " +
        "(single-source claims belong in unverified[])");
      return;
    }
    if (!d.note) { errs.push("drama " + d.id + ": no framing note"); }
    if (!Array.isArray(d.timeline) || !d.timeline.length) {
      errs.push("drama " + d.id + ": empty timeline"); return;
    }
    const domains = {};
    d.timeline.forEach((ev, i) => {
      if (!isDate(ev.date) && !/^\d{4}-\d{2}$/.test(ev.date || "")) {
        errs.push("drama " + d.id + " event " + i + ": bad date");
      }
      needSources("drama " + d.id + " event " + i, ev.sources);
      (ev.sources || []).forEach(s => {
        const dom = domainOf(s.url);
        if (dom) { domains[dom] = true; }
      });
    });
    if (Object.keys(domains).length < 2) {
      errs.push("drama " + d.id + ": verified requires >= 2 distinct " +
        "source domains across the timeline (has " +
        Object.keys(domains).join(", ") + ")");
    }
    // timeline must be chronological
    const ds = d.timeline.map(e => e.date);
    const sorted = ds.slice().sort();
    if (JSON.stringify(ds) !== JSON.stringify(sorted)) {
      errs.push("drama " + d.id + ": timeline not chronological");
    }
  });
  (seed.unverified || []).forEach(u => {
    needSources("unverified " + u.id, u.sources);
    if (!u.why_unverified) {
      errs.push("unverified " + u.id + ": must state why_unverified");
    }
  });
  (seed.events || []).forEach(e => {
    needSources("event " + e.id, e.sources);
    if (!isDate(e.start) || !isDate(e.end) || e.start > e.end) {
      errs.push("event " + e.id + ": bad start/end");
    }
  });
  (seed.feeds || []).forEach(f => {
    if (f.status === "skip-by-design" && !f.detail) {
      errs.push("feed " + f.id + ": skip-by-design needs a reason");
    }
  });
  return errs;
}

function eventStatus(ev, todayISO) {
  if (ev.end < todayISO) { return "past"; }
  if (ev.start > todayISO) { return "upcoming"; }
  return "happening-now";
}

function buildDesk(seed, now) {
  const today = now.toISOString().slice(0, 10);
  const events = (seed.events || []).map(e =>
    Object.assign({}, e, { status: eventStatus(e, today) }));
  events.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const dramaSources = {};
  (seed.drama || []).forEach(d => {
    (d.timeline || []).forEach(ev => (ev.sources || []).forEach(s => {
      const dom = domainOf(s.url);
      if (dom) { dramaSources[dom] = true; }
    }));
  });
  return {
    generated_at: now.toISOString(),
    curated_at: seed.curated_at || null,
    method: seed.method || "",
    sourcing_standard: seed.sourcing_standard || {},
    honesty: "Every profile and house carries its sources on the record. " +
      "A drama event is printed as verified only when two or more " +
      "independent sources report it; anything weaker is listed under " +
      "unverified with the reason, or omitted. Rosters are dated 'as of' " +
      "claims. No follower, viewership or revenue numbers appear except " +
      "where a named source states them for a dated event. Event status " +
      "is computed from dates at build time — a past event never poses " +
      "as upcoming.",
    provenance: {
      seed: "data/streamer_desk.json (hand-curated, wave 29)",
      generator: "scripts/build_streamer_desk.js (refuses to publish a seed that breaks the sourcing standard)",
      live_lane: "pipeline/out/streamers.json via pipeline/fetch_streamers.py (the Desk's Live Wire lane — real recorded hits only)"
    },
    counts: {
      streamers: (seed.streamers || []).length,
      houses: (seed.houses || []).length,
      updates: (seed.updates || []).length,
      drama_verified: (seed.drama || []).length,
      unverified: (seed.unverified || []).length,
      drama_source_domains: Object.keys(dramaSources).length,
      events: events.length,
      events_upcoming: events.filter(e => e.status === "upcoming").length,
      events_past: events.filter(e => e.status === "past").length,
      feeds_skip_by_design: (seed.feeds || [])
        .filter(f => f.status === "skip-by-design").length
    },
    streamers: seed.streamers || [],
    updates: (seed.updates || []).slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    drama: seed.drama || [],
    unverified: seed.unverified || [],
    houses: seed.houses || [],
    events: events,
    feeds: seed.feeds || []
  };
}

function main() {
  const seed = readJSON(SEED, null);
  if (!seed) {
    console.log("[streamer-desk] SKIP: data/streamer_desk.json missing.");
    process.exit(1);
  }
  const errs = auditSeed(seed);
  if (errs.length) {
    console.error("[streamer-desk] REFUSED — seed breaks the sourcing standard:");
    errs.forEach(e => console.error("  - " + e));
    process.exit(1);
  }
  const desk = buildDesk(seed, new Date());
  fs.mkdirSync(API, { recursive: true });
  writeJSON(OUT, desk);
  console.log("[streamer-desk] " + desk.counts.streamers + " streamers, " +
    desk.counts.houses + " houses, " + desk.counts.updates + " updates, " +
    desk.counts.drama_verified + " verified drama timelines (" +
    desk.counts.drama_source_domains + " source domains), " +
    desk.counts.unverified + " unverified, " + desk.counts.events +
    " events -> " + OUT);
  try {
    const manifest = readJSON(MANIFEST);
    if (manifest && manifest.endpoints) {
      const prev = manifest.endpoints.streamer_desk || {};
      manifest.endpoints.streamer_desk = {
        path: "data/v1/streamer-desk.json",
        description: prev.description ||
          "The Streamer Desk: sourced streamer directory, dated 'what they're up to' entries, a multi-source-verified drama tracker (timeline format, neutral tone, unverified claims quarantined), streamer houses with dated rosters, and an events calendar whose past/upcoming status is computed from dates. No invented numbers.",
        schema: "data/v1/schema/streamer-desk.json",
        updated: desk.generated_at,
        records: desk.counts.streamers + desk.counts.houses,
        notes: prev.notes ||
          "Built by scripts/build_streamer_desk.js from data/streamer_desk.json; the generator refuses to publish a seed that breaks the sourcing standard. Human-readable at streamer-desk.html."
      };
      writeJSON(MANIFEST, manifest);
      console.log("[streamer-desk] data/v1/index.json patched with streamer_desk endpoint");
    }
  } catch (e) {
    console.log("[streamer-desk] WARNING: could not patch manifest: " + e.message);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { auditSeed: auditSeed, buildDesk: buildDesk,
                     eventStatus: eventStatus, domainOf: domainOf };
}
if (require.main === module) { main(); }
