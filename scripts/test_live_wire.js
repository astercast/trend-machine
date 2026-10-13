#!/usr/bin/env node
/* trend-machine — wave 28: pinned-fixture tests for the Live Wire.
   Covers assets/js/live-wire-lib.js (rendering + honesty contract)
   and scripts/build_live_wire.js (lane classification + movers
   from synthetic stored inputs). The honesty contract:
     - a lane rewritten with 0 hits is DEGRADED, never "quiet"
     - a lane not rewritten by the latest refresh is STALE-SKIP:
       its hits are shown but excluded from the current total
     - TikTok / X are SKIP-BY-DESIGN with no hits claimed
     - movers need a stored pair spanning 0.5–3h around the 1h
       mark; the real span is published; flat is counted
     - lane totals reconcile: live+degraded+stale+skip = lanes,
       current_hits sums only live lanes' current_hits
   Run: node scripts/test_live_wire.js   (exit 0 = all pass) */
"use strict";
var L = require("../assets/js/live-wire-lib.js");
var G = require("./build_live_wire.js");

var FAILS = [];
function check(name, cond, detail) {
  if (cond) { console.log("  ok: " + name); }
  else { console.log("  FAIL: " + name + (detail ? " — " + detail : "")); FAILS.push(name); }
}

var REFRESH = "2026-10-13T06:30:00.000Z";

// --- lane classification (generator) ---------------------------------------
function laneFiles(over) {
  var base = {};
  G.LANES.forEach(d => { base[d.id] = null; });
  // file lanes default: fresh file, 5 hits at 06:25Z
  ["gtrends", "news", "news_search", "reddit_rss", "hn", "mastodon",
   "bluesky", "youtube_rss"].forEach(id => {
    base[id] = { hits: 5, sources: ["src-" + id],
                 newest_fetched_at: "2026-10-13T06:25:00.000Z",
                 mtime: "2026-10-13T06:25:30.000Z" };
  });
  // reddit direct: rewritten this refresh, 0 hits (degraded)
  base.reddit = { hits: 0, sources: [], newest_fetched_at: null,
                  mtime: "2026-10-13T06:24:00.000Z" };
  // youtube direct: NOT rewritten — file still holds yesterday's hits
  base.youtube = { hits: 25, sources: ["youtube-invidious"],
                   newest_fetched_at: "2026-10-12T08:06:54.000Z",
                   mtime: "2026-10-12T08:06:54.000Z" };
  return Object.assign(base, over || {});
}

var hist = {
  "up-topic": [["2026-10-13T04:00:00Z", 40], ["2026-10-13T05:25:00Z", 52],
               ["2026-10-13T06:25:00Z", 70]],
  "down-topic": [["2026-10-13T05:25:00Z", 80], ["2026-10-13T06:25:00Z", 61]],
  "flat-topic": [["2026-10-13T05:25:00Z", 50], ["2026-10-13T06:25:00Z", 50]],
  "thin-topic": [["2026-10-13T06:25:00Z", 99]],
  "burst-topic": [["2026-10-13T06:10:00Z", 10], ["2026-10-13T06:25:00Z", 90]]
};
var store = { generated_at: REFRESH, topics: [
  { id: "up-topic", title: "Up Topic", platforms: ["tiktok"] },
  { id: "down-topic", title: "Down Topic", platforms: ["youtube"] }
]};

var wire = G.buildLiveWire(new Date(REFRESH), REFRESH, laneFiles(), hist, store);
var byId = {};
wire.lanes.forEach(l => { byId[l.id] = l; });

check("registry covers every refresh.sh fetcher (12 lanes)",
      wire.lanes.length === 12 &&
      byId.gtrends && byId.news_search && byId.reddit_rss &&
      byId.youtube_rss && byId.tiktok && byId.x);
check("fresh lane with hits is live and counts its hits as current",
      byId.gtrends.status === "live" && byId.gtrends.current_hits === 5);
check("rewritten empty lane is degraded with 0 current",
      byId.reddit.status === "degraded" && byId.reddit.hits === 0 &&
      byId.reddit.current_hits === 0);
check("unrewritten lane is stale-skip: hits shown, none current",
      byId.youtube.status === "stale-skip" && byId.youtube.hits === 25 &&
      byId.youtube.current_hits === 0);
check("tiktok + x are skip-by-design with no hits claimed",
      byId.tiktok.status === "skip-by-design" && byId.tiktok.hits === 0 &&
      byId.x.status === "skip-by-design" && byId.x.output_file === null);
check("lane totals reconcile",
      wire.counts.lanes_live + wire.counts.lanes_degraded +
      wire.counts.lanes_stale_skip + wire.counts.lanes_skip_by_design
      === wire.counts.lanes);
check("current_hits excludes the stale file's 25",
      wire.counts.current_hits === 8 * 5 &&
      wire.counts.stale_hits_excluded === 25);

// old-but-present file for a normally-live lane also goes stale-skip
var wire2 = G.buildLiveWire(new Date(REFRESH), REFRESH,
  laneFiles({ hn: { hits: 50, sources: ["hackernews"],
                    newest_fetched_at: "2026-10-11T00:00:00.000Z",
                    mtime: "2026-10-11T00:00:00.000Z" } }), hist, store);
var hn2 = wire2.lanes.filter(l => l.id === "hn")[0];
check("a day-old hn file is stale-skip, not live",
      hn2.status === "stale-skip" && hn2.current_hits === 0);

// the previous hourly run's file (75 min before the stamp) must not
// pose as this refresh's work — the timeout-skip case
var wire3 = G.buildLiveWire(new Date(REFRESH), REFRESH,
  laneFiles({ mastodon: { hits: 20, sources: ["mastodon-trends"],
                    newest_fetched_at: "2026-10-13T05:15:00.000Z",
                    mtime: "2026-10-13T05:15:00.000Z" } }), hist, store);
var ma3 = wire3.lanes.filter(l => l.id === "mastodon")[0];
check("previous-hour file (75 min old) is stale-skip, not live",
      ma3.status === "stale-skip" && ma3.current_hits === 0 &&
      wire3.counts.stale_hits_excluded === 45);

// --- movers (generator) ------------------------------------------------------
check("movers: gainers ranked by real delta, span published",
      wire.movers.gainers.length === 1 &&
      wire.movers.gainers[0].topic_id === "up-topic" &&
      wire.movers.gainers[0].delta === 18 &&
      wire.movers.gainers[0].span_hours === 1);
check("movers: fallers carry negative delta",
      wire.movers.fallers.length === 1 &&
      wire.movers.fallers[0].topic_id === "down-topic" &&
      wire.movers.fallers[0].delta === -19);
check("movers: flat counted, thin + sub-0.5h-burst excluded",
      wire.counts.flat === 1 && wire.counts.gainers === 1 &&
      wire.counts.fallers === 1 && wire.movers.with_hour_pair === 3);
check("movers: off-board topic renders its id as title, not live",
      wire.movers.fallers[0].topic_live === true &&
      wire.movers.gainers[0].title === "Up Topic");

// --- rendering (lib) ----------------------------------------------------------
var sum = L.summaryHTML(wire);
check("summary names current hits and the excluded stale hits",
      sum.indexOf("40 hits") >= 0 && sum.indexOf("25 old hits") >= 0);
var ytRow = L.laneRowHTML(byId.youtube);
check("stale row says NOT this refresh + excluded",
      ytRow.indexOf("Stale · skip") >= 0 &&
      ytRow.indexOf("NOT this refresh, excluded") >= 0 &&
      ytRow.indexOf("2026-10-12") >= 0);
var rdRow = L.laneRowHTML(byId.reddit);
check("degraded row renders Degraded with its real 0",
      rdRow.indexOf("Degraded") >= 0 && rdRow.indexOf("0 hits") >= 0);
var ttRow = L.laneRowHTML(byId.tiktok);
check("skip-by-design row claims no hits",
      ttRow.indexOf("Skip by design") >= 0 &&
      ttRow.indexOf("no hits claimed") >= 0);
var mv = L.moversHTML(wire);
check("movers render the real span, never a bare '1h'",
      mv.indexOf("over 1h") >= 0 && mv.indexOf("+18") >= 0 &&
      mv.indexOf("-19") >= 0);
var empty = L.moversHTML({ movers: { gainers: [], fallers: [] } });
check("empty movers render the honest no-pair state",
      empty.indexOf("No topic holds a stored pair") >= 0);

console.log(FAILS.length ? ("[test_live_wire] " + FAILS.length + " FAILURES")
                         : "[test_live_wire] all checks passed");
process.exit(FAILS.length ? 1 : 0);
