/* ============================================================
   TREND MACHINE — build_live_wire.js (wave 28 / rotation 11)
   The Live Wire payload: a command view over the pipeline's OWN
   stored outputs — nothing else. Two panels:

     1. LANES — every fetcher wired into pipeline/refresh.sh, with
        the hit count and health the pipeline itself recorded:
          - the 10 lanes that write a stored output file
            (pipeline/out/<lane>.json) carry that file's real hit
            count, its distinct recorded source labels, and the
            newest fetched_at stamp inside the file;
          - a lane whose file was rewritten by the latest refresh
            with 0 hits is DEGRADED (it ran, it recorded nothing —
            e.g. the Reddit public-JSON lane, recorded in
            PIPELINE.md as often 403 from datacenters);
          - a lane whose file was NOT rewritten by the latest
            refresh is STALE-SKIP: its stored hits are from an
            earlier run, are shown with their real age, and are
            never counted as current (e.g. the YouTube
            Invidious/direct lane, whose fetcher prints SKIP and
            writes nothing when every path fails);
          - TikTok and X write no output file at all — SKIP BY
            DESIGN, exactly as their fetchers log it (no vetted
            keyless TikTok source exists; X needs a bearer token
            that is not set). No hits are claimed for them, ever.
        "Latest refresh" is anchored to data/trends.json's
        generated_at — the stamp the same refresh leaves when it
        finishes — never to the wall clock, so a later standalone
        rebuild cannot relabel an old file as fresh.

     2. TOP MOVERS — the hour's movement computed ONLY from stored
        snapshot history (live velocity store merged with the
        resolution archive via resolution-lib.js mergeHistory,
        the board's own merge rule): for each topic, the latest
        stored velocity vs the latest stored point at or before
        one hour earlier. A topic enters only when that pair spans
        0.5–3h (the actual span is published per mover — never
        rounded to "1h" silently). Gainers and fallers are ranked
        by the real delta; flat topics are counted, not hidden.

   Honesty contract: zero invented data. Every number traces to a
   file named in `provenance`. A lane that produced nothing says
   so; a stale file is labeled stale with its age; skip-by-design
   lanes claim no hits.

   Input : pipeline/out/*.json, data/trends.json,
           data/velocity_history.json, data/velocity_archive.json
   Output: data/v1/live-wire.json
           + patches data/v1/index.json (live_wire endpoint)
   Run   : node scripts/build_live_wire.js
           (wired into pipeline/refresh.sh after build_oracle_board.js)
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "pipeline", "out");
const TRENDS_FILE = path.join(ROOT, "data", "trends.json");
const HIST_FILE = path.join(ROOT, "data", "velocity_history.json");
const ARCHIVE_FILE = path.join(ROOT, "data", "velocity_archive.json");
const API = path.join(ROOT, "data", "v1");
const OUT = path.join(API, "live-wire.json");
const MANIFEST = path.join(API, "index.json");

const R = require("./resolution-lib.js"); // the one merge rule

// The lane registry: every fetcher in pipeline/refresh.sh, in
// refresh order. `file` is the stored output it writes via
// common.save_hits (null = the fetcher writes no file by design).
const LANES = [
  { id: "gtrends", label: "Google Trends", fetcher: "pipeline/fetch_gtrends.py",
    file: "gtrends.json", detail: "Google Trends daily RSS (US)." },
  { id: "news", label: "Google News", fetcher: "pipeline/fetch_news.py",
    file: "news.json", detail: "Google News RSS — top / tech / entertainment / sports / AI feeds." },
  { id: "news_search", label: "Google News Search", fetcher: "pipeline/fetch_news_search.py",
    file: "news_search.json", detail: "Google News RSS topic searches." },
  { id: "reddit", label: "Reddit (direct JSON)", fetcher: "pipeline/fetch_reddit.py",
    file: "reddit.json",
    detail: "Reddit public JSON (r/popular, r/memes, r/gaming, r/Music, r/tiktok). PIPELINE.md records this lane as often 403 from datacenters — it skips gracefully; an empty rewritten file is the degraded record, never faked." },
  { id: "reddit_rss", label: "Reddit (RSS)", fetcher: "pipeline/fetch_reddit_rss.py",
    file: "reddit_rss.json", detail: "Reddit subreddit RSS feeds — the lane that carries Reddit when the direct JSON lane is degraded." },
  { id: "hn", label: "Hacker News", fetcher: "pipeline/fetch_hn.py",
    file: "hn.json", detail: "Hacker News top/best stories (public Firebase API)." },
  { id: "mastodon", label: "Mastodon", fetcher: "pipeline/fetch_mastodon.py",
    file: "mastodon.json", detail: "Mastodon fediverse trending hashtags (/api/v1/trends/tags — repaired wave 20)." },
  { id: "bluesky", label: "Bluesky", fetcher: "pipeline/fetch_bluesky.py",
    file: "bluesky.json", detail: "Bluesky trending topics (keyless public API)." },
  { id: "youtube", label: "YouTube (Invidious / direct)", fetcher: "pipeline/fetch_youtube.py",
    file: "youtube.json",
    detail: "YouTube trending via Invidious public instances, direct scrape fallback (official Data API when YT_API_KEY is set). When every path fails the fetcher prints SKIP and writes nothing — the stored file then ages, and this board labels it stale-skip instead of counting old hits as new." },
  { id: "youtube_rss", label: "YouTube (channel RSS)", fetcher: "pipeline/fetch_youtube_rss.py",
    file: "youtube_rss.json", detail: "YouTube channel RSS with channel-page fallback — the lane that carries YouTube." },
  { id: "tiktok", label: "TikTok", fetcher: "pipeline/fetch_tiktok.py",
    file: null,
    detail: "SKIP by design: no vetted keyless TikTok trending source exists (research in PIPELINE.md) and TikTok data is never faked. The lane is covered by seed topics + cross-platform corroboration." },
  { id: "x", label: "X", fetcher: "pipeline/fetch_x.py",
    file: null,
    detail: "SKIP by design: the X API v2 path needs X_BEARER_TOKEN, which is not set — the fetcher logs its SKIP and writes nothing. X data is never faked." }
];

// A stored file counts as written by the latest refresh when its
// newest evidence stamp lands within 45 minutes before the
// refresh stamp. The fetch phase of a full refresh takes minutes
// (lane stamps land 0–10 minutes before the stamp on observed
// runs), while the previous hourly refresh's stamps sit a full
// cadence earlier (~65–75 minutes before the new stamp) — 45
// minutes separates the two with margin on both sides. This
// matters: a lane whose fetcher timed out on the latest run
// (its SKIP path writes nothing) still holds the previous run's
// file, and only this window keeps that file from posing as new.
const FRESH_WINDOW_MS = 45 * 60000;

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { return fallback; }
}

function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function round1(x) { return Math.round(x * 10) / 10; }

/* Summarize one stored lane file (pure — inputs are plain values
   so tests can pin the rules without touching the filesystem). */
function summarizeLane(def, file) {
  // file: null (no stored output) or
  // { hits: n, sources: [...], newest_fetched_at: iso|null,
  //   mtime: iso|null }
  if (!def.file || !file) {
    return {
      id: def.id, label: def.label, fetcher: def.fetcher,
      output_file: def.file ? "pipeline/out/" + def.file : null,
      status: "skip-by-design", hits: 0, current_hits: 0,
      sources: [], newest_fetched_at: null, file_written_at: null,
      detail: def.detail
    };
  }
  return {
    id: def.id, label: def.label, fetcher: def.fetcher,
    output_file: "pipeline/out/" + def.file,
    status: null, // resolved by classifyLane against the refresh stamp
    hits: file.hits, current_hits: 0,
    sources: file.sources,
    newest_fetched_at: file.newest_fetched_at,
    file_written_at: file.mtime,
    detail: def.detail
  };
}

function classifyLane(lane, refreshMs) {
  if (lane.status === "skip-by-design") { return lane; }
  const evidence = lane.newest_fetched_at || lane.file_written_at;
  const evMs = evidence ? Date.parse(evidence) : NaN;
  const fresh = isFinite(evMs) && isFinite(refreshMs) &&
    evMs >= refreshMs - FRESH_WINDOW_MS && evMs <= refreshMs + 5 * 60000;
  if (fresh && lane.hits > 0) {
    lane.status = "live"; lane.current_hits = lane.hits;
  } else if (fresh && lane.hits === 0) {
    lane.status = "degraded"; lane.current_hits = 0;
  } else {
    // The file on disk was not written by the latest refresh: the
    // fetcher's SKIP path (it writes nothing on failure). Its hits
    // are real but old — shown, dated, and excluded from current.
    lane.status = "stale-skip"; lane.current_hits = 0;
  }
  return lane;
}

/* The hour's movers, from stored snapshot points only. Points are
   merged-store points: [iso_ts, velocity, opportunity?]. */
function computeMovers(mergedHistory, topicsById) {
  const gainers = [], fallers = [];
  let eligible = 0, flat = 0, series = 0;
  Object.keys(mergedHistory || {}).forEach(id => {
    const pts = (mergedHistory[id] || []).filter(p =>
      Array.isArray(p) && isFinite(Date.parse(p[0])) &&
      typeof p[1] === "number");
    if (!pts.length) { return; }
    series++;
    if (pts.length < 2) { return; }
    const last = pts[pts.length - 1];
    const lastMs = Date.parse(last[0]);
    const target = lastMs - 3600000;
    let from = null;
    for (let i = pts.length - 2; i >= 0; i--) {
      if (Date.parse(pts[i][0]) <= target) { from = pts[i]; break; }
    }
    if (!from) { return; }
    const spanH = (lastMs - Date.parse(from[0])) / 3600000;
    if (spanH < 0.5 || spanH > 3) { return; }
    eligible++;
    const delta = last[1] - from[1];
    const topic = topicsById[id] || null;
    const mover = {
      topic_id: id,
      title: topic ? topic.title : id,
      topic_live: !!topic,
      platforms: topic ? (topic.platforms || []) : [],
      from_velocity: from[1], to_velocity: last[1], delta: delta,
      from_ts: from[0], to_ts: last[0],
      span_hours: round1(spanH), n_points: pts.length
    };
    if (delta > 0) { gainers.push(mover); }
    else if (delta < 0) { fallers.push(mover); }
    else { flat++; }
  });
  const byDelta = (a, b) =>
    (Math.abs(b.delta) - Math.abs(a.delta)) ||
    (b.to_velocity - a.to_velocity) ||
    String(a.topic_id).localeCompare(String(b.topic_id));
  gainers.sort(byDelta); fallers.sort(byDelta);
  return {
    gainers: gainers.slice(0, 10), fallers: fallers.slice(0, 10),
    counts: {
      topics_with_series: series, with_hour_pair: eligible,
      gainers: gainers.length, fallers: fallers.length, flat: flat
    }
  };
}

function buildLiveWire(now, refreshStamp, laneFiles, mergedHistory, store) {
  const refreshMs = Date.parse(refreshStamp);
  const lanes = LANES.map(def =>
    classifyLane(summarizeLane(def, laneFiles ? laneFiles[def.id] : null),
                 refreshMs));
  const topicsById = {};
  ((store && store.topics) || []).forEach(t => { topicsById[t.id] = t; });
  const movers = computeMovers(mergedHistory, topicsById);
  const byStatus = { live: 0, degraded: 0, "stale-skip": 0, "skip-by-design": 0 };
  let currentHits = 0, staleHits = 0;
  lanes.forEach(l => {
    byStatus[l.status]++;
    currentHits += l.current_hits;
    if (l.status === "stale-skip") { staleHits += l.hits; }
  });
  return {
    generated_at: now.toISOString(),
    refresh_at: refreshStamp || null,
    method: "Lanes: one row per fetcher wired into pipeline/refresh.sh. " +
      "The 10 file-writing lanes read pipeline/out/<lane>.json — hit count " +
      "is that file's array length, source labels are the hits' own " +
      "recorded `source` values, and freshness compares the file's newest " +
      "fetched_at (or, for an empty file, its write time) with " +
      "data/trends.json's generated_at from the same refresh. TikTok and " +
      "X write no file and are skip-by-design. Movers: per topic, latest " +
      "stored velocity vs the latest stored point at or before 1h " +
      "earlier, over the live velocity store merged with the resolution " +
      "archive (scripts/resolution-lib.js mergeHistory); only pairs " +
      "spanning 0.5–3h count, and the real span is published per mover.",
    honesty: "Zero invented data: a lane that recorded nothing says so, " +
      "a file the latest refresh did not rewrite is labeled stale-skip " +
      "with its hits excluded from the current total, skip-by-design " +
      "lanes claim no hits, and movers are computed only from stored " +
      "snapshot points — a topic with no ~1h pair is not a mover, " +
      "however hot it looks.",
    provenance: {
      lanes: "pipeline/out/*.json (hit counts, source labels, fetched_at stamps)",
      refresh_stamp: "data/trends.json generated_at",
      movers: "data/velocity_history.json + data/velocity_archive.json (merged, stored points only)",
      lane_registry: "pipeline/refresh.sh fetcher loop + pipeline/fetch_*.py"
    },
    counts: {
      lanes: lanes.length,
      lanes_live: byStatus.live,
      lanes_degraded: byStatus.degraded,
      lanes_stale_skip: byStatus["stale-skip"],
      lanes_skip_by_design: byStatus["skip-by-design"],
      current_hits: currentHits,
      stale_hits_excluded: staleHits,
      topics_live: ((store && store.topics) || []).length,
      movers_with_hour_pair: movers.counts.with_hour_pair,
      gainers: movers.counts.gainers,
      fallers: movers.counts.fallers,
      flat: movers.counts.flat
    },
    lanes: lanes,
    movers: {
      window: "latest stored point vs latest stored point at or before 1h earlier (accepted span 0.5–3h, published per mover)",
      topics_with_series: movers.counts.topics_with_series,
      with_hour_pair: movers.counts.with_hour_pair,
      gainers: movers.gainers,
      fallers: movers.fallers
    }
  };
}

function readLaneFile(def) {
  if (!def.file) { return null; }
  const p = path.join(OUT_DIR, def.file);
  const hits = readJSON(p, null);
  if (!Array.isArray(hits)) { return null; }
  let newest = null;
  const sources = {};
  hits.forEach(h => {
    if (h && h.source) { sources[h.source] = true; }
    if (h && h.fetched_at && (newest === null || h.fetched_at > newest)) {
      newest = h.fetched_at;
    }
  });
  let mtime = null;
  try { mtime = fs.statSync(p).mtime.toISOString(); } catch (e) { /* absent */ }
  return {
    hits: hits.length, sources: Object.keys(sources).sort(),
    newest_fetched_at: newest, mtime: mtime
  };
}

function main() {
  const now = new Date();
  const store = readJSON(TRENDS_FILE, null);
  const history = readJSON(HIST_FILE, null);
  if (!store || !history) {
    console.log("[live-wire] SKIP: trends store or velocity history missing — run pipeline/refresh.sh first.");
    return;
  }
  const archive = readJSON(ARCHIVE_FILE, {});
  const laneFiles = {};
  LANES.forEach(def => { laneFiles[def.id] = readLaneFile(def); });
  const merged = R.mergeHistory(history, archive);
  const wire = buildLiveWire(now, store.generated_at, laneFiles, merged, store);

  fs.mkdirSync(API, { recursive: true });
  writeJSON(OUT, wire);
  console.log("[live-wire] " + wire.counts.lanes + " lanes (" +
    wire.counts.lanes_live + " live, " + wire.counts.lanes_degraded +
    " degraded, " + wire.counts.lanes_stale_skip + " stale-skip, " +
    wire.counts.lanes_skip_by_design + " skip-by-design), " +
    wire.counts.current_hits + " current hits, movers " +
    wire.counts.gainers + " up / " + wire.counts.fallers + " down -> " + OUT);

  // Patch the manifest (same pattern as build_oracle_board.js).
  try {
    const manifest = readJSON(MANIFEST);
    if (manifest && manifest.endpoints) {
      const prev = manifest.endpoints.live_wire || {};
      manifest.endpoints.live_wire = {
        path: "data/v1/live-wire.json",
        description: prev.description ||
          "The Live Wire: a command view over the pipeline's own stored outputs — every refresh lane with its real recorded hit count and health (live / degraded / stale-skip / skip-by-design, exactly as the pipeline records it), plus the hour's top movers computed from stored velocity snapshots only. Stale hits are dated and excluded from the current total; skip-by-design lanes (TikTok, X) claim no hits.",
        schema: "data/v1/schema/live-wire.json",
        updated: wire.generated_at,
        records: wire.counts.lanes,
        notes: prev.notes ||
          "Built by scripts/build_live_wire.js from pipeline/out/*.json + the stored velocity history. Human-readable at live-wire.html."
      };
      writeJSON(MANIFEST, manifest);
      console.log("[live-wire] data/v1/index.json patched with live_wire endpoint");
    }
  } catch (e) {
    console.log("[live-wire] WARNING: could not patch manifest: " + e.message);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LANES: LANES, FRESH_WINDOW_MS: FRESH_WINDOW_MS,
    summarizeLane: summarizeLane, classifyLane: classifyLane,
    computeMovers: computeMovers, buildLiveWire: buildLiveWire
  };
}
if (require.main === module) { main(); }
