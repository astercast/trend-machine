/* api/cron/wire.js — GET /api/cron/wire — "The Wire" daily heartbeat (§7.2).
   Cron only (CRON_SECRET bearer; fails closed 401). Vercel Cron schedule:
   `0 13 * * *` UTC (vercel.json). Fits the 10s Hobby timeout by design:
   bounded sources, 4000ms per-source timeout, parallel fetch, pure-function
   merge, content-hash commits (no change → no commit → no redeploy).

   WHAT IT DOES (bounded incremental refresh — §4.2):
     1. fetch 7 keyless sources in parallel (Promise.allSettled — partial
        success is the normal case)
     2. normalize → dedupe (Jaccard ≥0.55 on title token sets, same rule as
        pipeline/normalize.py) → server-side velocity + opportunity scoring
        (same formula as the repo pipeline — deterministic, no deps)
     3. append one snapshot per topic (hourly bucket, 30-day retention —
        §5.1), recompute the Oracle's forecasts from the real snapshots via
        assets/js/trajectory.js (the SAME classifier as oracle.html — the
        forecasts are computed from real snapshots, not static seeds)
     4. rebuild trends.json, trends.flat.json, trends.flat.js (JSONP twin,
        same `trendsCallback(...)` contract), forecasts.json, velocity.json;
        commit only on real change (generated_at excluded from the compare,
        so identical upstream data → byte-identical output → no commit)

   DIVISION OF LABOR (§7.2 "Cron does / Repo pipeline does"):
     - The wire is the lightweight daily heartbeat. The repo pipeline
       (pipeline/refresh.sh, 12 fetchers incl. tiktok/x which stay repo-side,
       topic-page rebuilds, format families, seed backfills) keeps its own
       cadence in the wave engine and does the deep work.
     - The wire does NOT touch: data/forecast_ledger.json or
       data/v1/forecast-accuracy.json (the resolution-check workflow —
       scripts/resolution-lib.js hit/miss/unverifiable semantics — stays
       repo-side in scripts/build_forecasts.js + scripts/check_resolutions.js),
       data/v1/index.json (manifest), data/v1/trends.flat.sample.json.
     - Derived-artifact fields the wire cannot recompute byte-identically
       (flat feed `velocity_trend` sparkline SVGs) are PRESERVED from the
       current file for existing topics; new topics get the honest
       `state:"building"` shape (same keys/types — schema-identical, the
       pipeline's next aggregate.py run fills in the real SVG).

   HONESTY (§6): X/Twitter has no free passive aggregator (verified across 3
   research rounds) — there is deliberately NO X source entry. A source that
   fails is listed in meta.upstream with ok:false and the error; degraded
   data is still served with real timestamps. The job never invents a model,
   a trend, or a forecast.

   PENDING TOKEN: GITHUB_REPO_TOKEN (fine-grained PAT, contents:write) is
   still awaiting the user's decision (spec §14.1). Until it is set, the job
   runs READ-ONLY: it computes everything and returns it in the envelope
   (data.mode = "read-only ..."), but persists nothing. Static JSON then
   updates only via the wave-engine pipeline's pushes. */
"use strict";

const path = require("path");
const fs = require("fs");
const envelope = require("../../lib/envelope.js");
const { fetchTimeout } = require("../../lib/fetchx.js");
const { assertCron } = require("../../lib/cronauth.js");
const github = require("../../lib/github.js");
const T = require("../../assets/js/trajectory.js"); // UMD — same classifier, no drift

const SERVICE = "trend-wire";
const VERSION = "1.0.0";
const ROOT = path.resolve(__dirname, "..", ".."); // servedRoot = repo root

const FILES = {
  trends: "data/v1/trends.json",
  flat: "data/v1/trends.flat.json",
  flatJs: "static/v1/trends.flat.js", // 2026-10-12: outside api/ — Vercel
  // deploys every .js under api/ as a function (functions map is not an
  // allowlist); public URL /data/v1/trends.flat.js preserved via rewrite
  forecasts: "data/v1/forecasts.json",
  velocity: "data/v1/velocity.json",
  platformVelocity: "data/v1/platform-velocity.json",
  memeFormats: "data/v1/meme-formats.json",
};

const FETCH_TIMEOUT_MS = Math.max(1000,
  parseInt(process.env.WIRE_FETCH_TIMEOUT_MS || "4000", 10) || 4000);
// Per-source fetch budget, ms. Spec default 4000 (§4.2/§7.2); override via
// WIRE_FETCH_TIMEOUT_MS only for local verification behind a slow proxy —
// production stays at the spec default so the job fits the 10s timeout.
const BUDGET_MS = 9500;          // hard stop guard inside the 10s function limit
const COMMIT_GUARD_MS = 8000;    // skip the commit phase past this (log loudly)
const MAX_NEW_TOPICS = 25;       // bounded commit: new topics per run
const MAX_AUTO = 300;            // store bound: auto topics kept (seeded always kept)
const STALE_HOURS = 72;
const SNAPSHOT_RETENTION_D = 30; // §5.1: last 30 daily snapshots per topic
const SEEN_TTL_MS = 60000;       // 60s global cooldown — duplicate-delivery guard (§4.3)

let lastRunAt = 0;

// ---------------------------------------------------------------------------
// small pure helpers (ports of pipeline/common.py + pipeline/normalize.py)
// ---------------------------------------------------------------------------

function tokens(s) {
  const m = String(s || "").toLowerCase().match(/[a-z0-9]{3,}/g);
  return new Set(m || []);
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((t) => { if (b.has(t)) inter++; });
  return inter / (a.size + b.size - inter);
}
function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 60) || "topic";
}
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
function cleanHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-fA-F]+|\w+);/g, (m, e) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isNaN(n) ? m : String.fromCodePoint(n);
      }
      return ENTITIES[e] !== undefined ? ENTITIES[e] : m;
    }).trim();
}
function extractHashtags(text) {
  const m = String(text || "").match(/#(\w+)/g);
  return (m || []).slice(0, 8);
}

// Port of normalize.py detect_format (pattern-based, conservative).
const FORMAT_TITLE_TAGS = { challenge: [/\bchallenge\b/, /\bchallenges\b/] };
const FORMAT_FULL_TEXT = [
  ["pov", [/\bpov\b/]],
  ["sound", [/\bsound trend\b/, /\bviral sound\b/, /\btrending sound\b/, /\bsong is taking over\b/, /\baudio trend\b/, /\boriginal sound\b/]],
  ["dance", [/\bdance challenge\b/, /\bdance trend\b/, /\bdance craze\b/, /\bdance\b/]],
  ["meme", [/\bmeme\b/, /\bmemes\b/, /\bbrainrot\b/, /\bshitpost\b/, /\bdank meme\b/]],
  ["duet", [/\bduet\b/]],
  ["stitch", [/\bstitch\b/]],
  ["green-screen", [/\bgreen screen\b/, /\bgreenscreen\b/]],
  ["template", [/\btemplate trend\b/, /\bcapcut template\b/, /\btemplate\b/]],
  ["trend", [/\btrend on tiktok\b/, /\btrending format\b/, /\bthis trend\b/]],
  ["format", [/\bformat\b/]],
  ["caption", [/\bcaption\b/]],
];
function detectFormat(title, summary, hashtags) {
  const head = [title || "", (hashtags || []).join(" ")].join(" ").toLowerCase();
  const full = [title || "", summary || "", (hashtags || []).join(" ")].join(" ").toLowerCase();
  const tags = new Set();
  Object.keys(FORMAT_TITLE_TAGS).forEach((tag) => {
    if (FORMAT_TITLE_TAGS[tag].some((re) => re.test(head))) tags.add(tag);
  });
  FORMAT_FULL_TEXT.forEach(([tag, pats]) => {
    if (pats.some((re) => re.test(full))) tags.add(tag);
  });
  return Array.from(tags).sort();
}
const FORMAT_SIGNALS = new Set(["challenge", "dance", "pov", "sound", "meme", "duet",
  "stitch", "template", "trend", "green-screen", "format", "caption"]);
const EVENT_CATEGORIES = new Set(["news", "sports", "gaming"]);
function classifyTrendType(t) {
  const isFormat = (t.format_tags || []).some((x) => FORMAT_SIGNALS.has(x));
  const isEvent = EVENT_CATEGORIES.has(String(t.category || "").toLowerCase());
  if (isFormat && isEvent) return "format+topic";
  if (isFormat) return "format";
  return "topic";
}
// Port of pipeline/format_families.py match_family: first family (file order)
// with a word-boundary keyword hit wins; null when nothing matches.
function matchFamily(title, summary, hashtags, families) {
  const text = [title || "", summary || "", (hashtags || []).join(" ")].join(" ").toLowerCase();
  for (const fam of families || []) {
    for (const kw of fam.keywords || []) {
      const re = new RegExp("\\b" + String(kw).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
      if (re.test(text)) return fam.id || null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// upstream sources — all keyless, 4s each, partial success is normal.
// X/Twitter: deliberately absent — no free passive aggregator exists.
// ---------------------------------------------------------------------------

const UA = "trend-wire/1.0.0 (+https://github.com/astercast/trend-machine)";

function hit(title, url, source, summary, hashtags, category, platforms) {
  return { title: cleanHtml(title).slice(0, 180), url: url || "",
           source: source, summary: cleanHtml(summary).slice(0, 400),
           hashtags: hashtags || [], category: category || null,
           platforms: platforms || [], fetched_at: envelope.nowIso() };
}

function parseRssItems(xml, max) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < max) {
    const it = m[1];
    const tag = (name) => {
      const mm = it.match(new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">"));
      return mm ? mm[1].trim() : "";
    };
    items.push({ title: tag("title"), link: tag("link"),
                 description: tag("description"), pubDate: tag("pubDate"),
                 traffic: tag("ht:approx_traffic") });
  }
  return items;
}

async function srcGtrends() {
  const r = await fetchTimeout("https://trends.google.com/trending/rss?geo=US",
    { timeoutMs: FETCH_TIMEOUT_MS, userAgent: UA });
  if (!r.ok) throw new Error(r.error || ("http " + r.status));
  const items = parseRssItems(r.text, 20);
  // Empty feed = source-down, not "no trends" (§7.2 — gtrends throttles by IP).
  if (!items.length) throw new Error("empty feed (likely throttled)");
  return items.map((it) => hit(it.title, it.link, "google-trends",
    it.traffic ? ("~" + it.traffic + " searches. " + it.description) : it.description,
    extractHashtags(it.title + " " + it.description), "news", ["google"]));
}

async function srcHn() {
  const ids = await fetchTimeout("https://hacker-news.firebaseio.com/v0/topstories.json",
    { timeoutMs: FETCH_TIMEOUT_MS, userAgent: UA });
  if (!ids.ok) throw new Error(ids.error || ("http " + ids.status));
  const list = JSON.parse(ids.text).slice(0, 12);
  const items = await Promise.all(list.map((id) =>
    fetchTimeout("https://hacker-news.firebaseio.com/v0/item/" + id + ".json",
      { timeoutMs: FETCH_TIMEOUT_MS, userAgent: UA })));
  const hits = [];
  for (const it of items) {
    if (!it.ok) continue;
    let d;
    try { d = JSON.parse(it.text); } catch (e) { continue; }
    if (!d || d.type !== "story") continue;
    hits.push(hit(d.title || "", d.url || ("https://news.ycombinator.com/item?id=" + d.id),
      "hackernews", (d.score || 0) + " points · " + (d.descendants || 0) + " comments",
      extractHashtags(d.title || ""), "tech", ["youtube", "x"]));
  }
  if (!hits.length) throw new Error("no stories parsed");
  return hits;
}

async function srcBluesky() {
  const r = await fetchTimeout(
    "https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrendingTopics?limit=10",
    { timeoutMs: FETCH_TIMEOUT_MS, userAgent: UA });
  if (!r.ok) throw new Error(r.error || ("http " + r.status));
  const topics = (JSON.parse(r.text).topics || []);
  if (!topics.length) throw new Error("empty topics list");
  return topics.map((t) => {
    const topic = (t.displayName || t.topic || "").trim();
    const desc = t.description || "";
    return hit(topic, "https://bsky.app/search?q=" + encodeURIComponent(topic),
      "bluesky-trending", desc || "Trending on Bluesky right now",
      extractHashtags(topic + " " + desc), "culture", ["bluesky"]);
  }).filter((h) => h.title);
}

async function srcMastodon() {
  const r = await fetchTimeout("https://mastodon.social/data/v1/trends?limit=20",
    { timeoutMs: FETCH_TIMEOUT_MS, userAgent: UA });
  if (!r.ok) throw new Error(r.error || ("http " + r.status));
  const tags = JSON.parse(r.text).slice(0, 12);
  if (!tags.length) throw new Error("empty trends list");
  return tags.map((t) => {
    const uses = (t.history || []).slice(0, 2)
      .reduce((n, h) => n + (parseInt(h.uses, 10) || 0), 0);
    return hit("#" + t.name, t.url || ("https://mastodon.social/tags/" + t.name),
      "mastodon-trends", uses + " recent uses across the fediverse",
      ["#" + t.name], "culture", ["x", "tiktok"]);
  });
}

async function srcNews() {
  const r = await fetchTimeout(
    "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
    { timeoutMs: FETCH_TIMEOUT_MS, userAgent: UA });
  if (!r.ok) throw new Error(r.error || ("http " + r.status));
  const items = parseRssItems(r.text, 12);
  if (!items.length) throw new Error("empty feed");
  return items.map((it) => {
    let title = cleanHtml(it.title), outlet = "";
    if (title.includes(" - ")) {
      const i = title.lastIndexOf(" - ");
      outlet = title.slice(i + 3); title = title.slice(0, i);
    }
    return hit(title, it.link, "gnews-top",
      outlet ? (outlet + " · " + it.pubDate) : it.pubDate,
      extractHashtags(title), "news", ["youtube", "x"]);
  });
}

// Machine-readable Reddit proxy: liyedanpdx/reddit-ai-trends publishes a
// daily markdown report table (Reddit's own JSON is 403 from servers).
async function srcRedditProxy() {
  const r = await fetchTimeout(
    "https://raw.githubusercontent.com/liyedanpdx/reddit-ai-trends/main/reports/latest_report_en.md",
    { timeoutMs: FETCH_TIMEOUT_MS, userAgent: UA });
  if (!r.ok) throw new Error(r.error || ("http " + r.status));
  const hits = [];
  for (const line of r.text.split("\n")) {
    if (hits.length >= 12) break;
    const m = line.match(/^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*\[?r\/([^\]|]+)\]?(?:\([^)]*\))?\s*\|\s*(\d+)\s*\|\s*(\d+)/);
    if (!m) continue;
    hits.push(hit(m[1], m[2], "reddit-proxy",
      m[4] + " upvotes · " + m[5] + " comments · r/" + m[3],
      extractHashtags(m[1]), "tech", ["x", "tiktok"]));
  }
  if (!hits.length) throw new Error("no table rows parsed");
  return hits;
}

const YT_CHANNELS = [
  ["UCX6OQ3DkcsbYNE6H8uQQuVA", "MrBeast", "entertainment", ["youtube", "tiktok"]],
  ["UCBJycsmduvYEL83R_U4JriQ", "MKBHD", "tech", ["youtube", "x"]],
  ["UCKy1dAqELo0zrOtPkf0eTMw", "IGN", "gaming", ["youtube", "twitch"]],
  ["UC16niRr50-MSBwiO3YDb3RA", "BBCNews", "news", ["youtube", "x"]],
];
async function srcYoutube() {
  const feeds = await Promise.all(YT_CHANNELS.map(([id, label, cat, plats]) =>
    fetchTimeout("https://www.youtube.com/feeds/videos.xml?channel_id=" + id,
      { timeoutMs: FETCH_TIMEOUT_MS, userAgent: UA })
      .then((r) => ({ label, cat, plats, r }))));
  const hits = [];
  for (const f of feeds) {
    if (!f.r.ok) continue; // per-channel flakiness is normal (wave-6 note)
    const re = /<entry>([\s\S]*?)<\/entry>/g;
    let m, n = 0;
    while ((m = re.exec(f.r.text)) && n < 4) {
      n++;
      const e = m[1];
      const vid = (e.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
      const title = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
      const link = (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1];
      const pub = (e.match(/<published>(.*?)<\/published>/) || [])[1] || "";
      if (!vid || !title || !link) continue;
      hits.push(hit(title, link, "youtube:" + f.label, f.label + " · " + pub.slice(0, 10),
        extractHashtags(title), f.cat, f.plats));
    }
  }
  if (!hits.length) throw new Error("all channel feeds failed");
  return hits;
}

const SOURCES = [
  ["gtrends-rss", srcGtrends],
  ["hn-api", srcHn],
  ["bluesky-api", srcBluesky],
  ["mastodon-trends", srcMastodon],
  ["news-rss", srcNews],
  ["reddit-proxy", srcRedditProxy],
  ["youtube-rss", srcYoutube],
];

// One retry on 429, then mark source-down (§7.2).
async function runSource(name, fn) {
  const checkedAt = () => envelope.nowIso();
  const t0 = Date.now();
  try {
    const hits = await fn();
    return { name, ok: true, hits, checked_at: checkedAt(), latency_ms: Date.now() - t0, error: null };
  } catch (e1) {
    const msg1 = String((e1 && e1.message) || e1);
    if (/429/.test(msg1)) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const hits = await fn();
        return { name, ok: true, hits, checked_at: checkedAt(), latency_ms: Date.now() - t0, error: null };
      } catch (e2) { /* fall through to source-down */ }
    }
    console.log("[upstream] " + name + " fail error=" + msg1 + " latency_ms=" + (Date.now() - t0));
    return { name, ok: false, hits: [], checked_at: checkedAt(),
             latency_ms: Date.now() - t0, error: msg1 };
  }
}

// ---------------------------------------------------------------------------
// store I/O — GitHub when the token exists, bundle otherwise
// ---------------------------------------------------------------------------

function readLocal(name) {
  return new Promise((resolve) => {
    fs.readFile(path.join(ROOT, name), "utf8", (e, text) => {
      if (e) return resolve({ ok: false, data: null, error: String(e.message || e) });
      try { resolve({ ok: true, data: JSON.parse(text), error: null }); }
      catch (err) { resolve({ ok: false, data: null, error: "unparseable: " + err.message }); }
    });
  });
}
function readStore(name) {
  return github.tokenConfigured() ? github.readJson(name) : readLocal(name);
}

// ---------------------------------------------------------------------------
// merge / score / snapshot / forecast (ports of normalize.py + build_forecasts.js)
// ---------------------------------------------------------------------------

function mergeHits(topics, hits, families, now) {
  let added = 0;
  const newIds = new Set();
  for (const h of hits) {
    if (!h.title) continue;
    const ht = tokens(h.title);
    let best = null, bestScore = 0;
    for (const tid of Object.keys(topics)) {
      const s = jaccard(ht, tokens(topics[tid].title));
      if (s > bestScore) { best = tid; bestScore = s; }
    }
    const src = { name: h.source, url: h.url };
    if (best && bestScore >= 0.55) {
      const t = topics[best];
      t.last_seen = h.fetched_at;
      if (!t.sources.some((s) => s.url === src.url)) t.sources.push(src);
      for (const p of h.platforms) if (!t.platforms.includes(p)) t.platforms.push(p);
      const ph = t.platform_hits || (t.platform_hits = {});
      for (const p of h.platforms) (ph[p] || (ph[p] = [])).push(h.fetched_at);
      for (const tag of h.hashtags) if (!t.hashtags.includes(tag)) t.hashtags.push(tag);
      t.stale = false;
    } else {
      if (added >= MAX_NEW_TOPICS) continue;
      let tid = slugify(h.title).slice(0, 50) || "topic";
      let n = 1, base = tid;
      while (topics[tid] || newIds.has(tid)) { n++; tid = (base + "-" + n).slice(0, 50); }
      newIds.add(tid);
      const plats = h.platforms.length ? h.platforms : ["x"];
      const ftags = detectFormat(h.title, h.summary, h.hashtags);
      const draft = { format_tags: ftags, category: h.category || "news" };
      topics[tid] = {
        id: tid, title: h.title.slice(0, 180),
        summary: h.summary.slice(0, 400) || "Detected by the Wire heartbeat; angles pending editorial pass.",
        category: h.category || "news", platforms: plats,
        hashtags: h.hashtags.slice(0, 8),
        velocity: 0, saturation: "low", opportunity_score: 0,
        first_seen: h.fetched_at, last_seen: h.fetched_at,
        seeded: false, stale: false, needs_angles: true,
        platform_hits: Object.fromEntries(plats.map((p) => [p, [h.fetched_at]])),
        format_tags: ftags, trend_type: classifyTrendType(draft),
        format_family: matchFamily(h.title, h.summary, h.hashtags, families),
        sources: [src], angles: [], hooks: [], who_to_watch: [], guide_links: [],
      };
      added++;
    }
  }
  return added;
}

// Same scoring recipe as pipeline/normalize.py (deterministic).
function rescore(topics, nowMs) {
  for (const tid of Object.keys(topics)) {
    const t = topics[tid];
    const nSrc = (t.sources || []).length;
    let last = Date.parse(t.last_seen || "");
    if (isNaN(last)) last = nowMs;
    const ageH = Math.max(0, (nowMs - last) / 3600000);
    const recency = Math.max(0, 1 - ageH / 48);
    const tagBonus = Math.min(10, (t.hashtags || []).length * 2);
    if (!t.seeded) {
      t.velocity = Math.min(100, Math.round(25 * Math.min(nSrc, 3) + 20 * recency + tagBonus));
    }
    t.saturation = nSrc >= 4 ? "high" : (nSrc >= 2 ? "medium" : "low");
    const pen = { low: 0, medium: 0.35, high: 0.6 }[t.saturation];
    t.opportunity_score = Math.round((t.velocity || 0) * (1 - pen));
    t.stale = ageH > STALE_HOURS;
  }
  // prune: keep all seeded/editorial, cap auto topics (oldest last_seen first)
  const auto = Object.keys(topics).filter((tid) => !topics[tid].seeded);
  if (auto.length > MAX_AUTO) {
    const drop = auto.sort((a, b) =>
      String(topics[a].last_seen || "").localeCompare(String(topics[b].last_seen || ""))
    ).slice(0, auto.length - MAX_AUTO);
    drop.forEach((tid) => delete topics[tid]);
  }
}

function snapshotVelocity(vel, topics, nowMs) {
  const now = new Date(nowMs);
  const cutoff = nowMs - SNAPSHOT_RETENTION_D * 24 * 3600000;
  const hourKey = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? null : d.toISOString().slice(0, 13);
  };
  for (const tid of Object.keys(topics)) {
    const t = topics[tid];
    const pts = vel[tid] || [];
    pts.push([now.toISOString(), Math.round(t.velocity || 0), Math.round(t.opportunity_score || 0)]);
    const latest = {};
    for (const p of pts) {
      const k = hourKey(p[0]);
      if (!k) continue;
      if (Date.parse(p[0]) < cutoff) continue;
      latest[k] = p;
    }
    vel[tid] = Object.keys(latest).sort().map((k) => latest[k]);
  }
  for (const tid of Object.keys(vel)) if (!topics[tid]) delete vel[tid];
}

// Port of scripts/build_forecasts.js record() — same classifier, no drift.
function recordForecast(tid, title, enriched) {
  const a = enriched.analysis;
  return {
    id: tid, title: title, state: a.state, n_snapshots: a.n,
    latest_velocity: a.latestVelocity,
    slope_per_hour: Math.round(a.slopePerHour * 100) / 100,
    accel: Math.round(a.accel * 100) / 100,
    peak_in_hours: isFinite(a.peakInHours) ? Math.round(a.peakInHours * 10) / 10 : null,
    summary: a.summary,
    label: "Projection from " + a.n + " snapshot" + (a.n === 1 ? "" : "s") + " — not a guarantee.",
    confidence: enriched.confidence, signals: enriched.signals,
    per_platform: enriched.per_platform,
  };
}

function buildForecasts(vel, pvel, topics, existing, nowMs) {
  const enriched = {};
  for (const tid of Object.keys(vel)) {
    const t = topics[tid] || {};
    enriched[tid] = T.enrich(
      { id: tid, title: t.title || tid, platforms: t.platforms || [],
        platform_points: (pvel && pvel[tid]) || {} },
      vel[tid], nowMs);
  }
  const results = Object.keys(enriched).map((tid) => ({
    topic: { id: tid, title: (topics[tid] || {}).title || tid },
    analysis: enriched[tid].analysis,
  }));
  const lists = T.rankLists(results);
  const toRec = (r) => recordForecast(r.topic.id, r.topic.title, enriched[r.topic.id]);
  const steady = results.filter((r) => r.analysis.state === "steady")
    .sort((a, b) => b.analysis.latestVelocity - a.analysis.latestVelocity).map(toRec);
  const projections = {};
  results.forEach((r) => { projections[r.topic.id] = toRec(r); });
  const insufficient = results.filter((r) => r.analysis.state === "insufficient").length;
  const prior = (existing && typeof existing === "object") ? existing : {};
  return {
    generated_at: new Date(nowMs).toISOString(),
    method: prior.method ||
      "assets/js/trajectory.js analyze() + rankLists() + enrich() — the same classifier as the oracle.html dashboard",
    honesty: prior.honesty ||
      "Every forecast is a projection from N real velocity snapshots, never a guarantee. " +
      "Topics with fewer than 3 snapshots are excluded from the forecast lists. " +
      "confidence.basis names the evidence behind each call (snapshot count + fit quality), " +
      "never a probability of being right.",
    counts: {
      peaking_48h: lists.peaking.length, rising_fast: lists.rising.length,
      cooling_off: lists.cooling.length, steady: steady.length, insufficient: insufficient,
    },
    peaking_48h: lists.peaking.map(toRec),
    rising_fast: lists.rising.map(toRec),
    cooling_off: lists.cooling.map(toRec),
    steady: steady,
    projections: projections,
  };
}

// Port of pipeline/aggregate.py flat(). velocity_trend is preserved from the
// current flat file for existing topics (the pipeline's aggregate.py rebuilds
// the SVG sparklines on its own cadence); new topics get the honest
// state:"building" shape — same keys/types, schema-identical.
function buildingTrend(t) {
  const v = Math.round(t.velocity || 0);
  return { snapshots: 1, state: "building", since: t.last_seen || null,
           first_velocity: v, latest_velocity: v, delta: 0,
           sparkline_svg: null, per_platform: {} };
}
function buildFlat(topics, currentFlat, now) {
  const prev = {};
  if (currentFlat && Array.isArray(currentFlat.trends)) {
    currentFlat.trends.forEach((t) => { prev[t.id] = t.velocity_trend || null; });
  }
  const live = Object.values(topics).filter((t) => !t.stale)
    .sort((a, b) => ((b.opportunity_score || 0) - (a.opportunity_score || 0)) ||
                    ((b.velocity || 0) - (a.velocity || 0)));
  const trends = live.map((t) => {
    const srcs = t.sources || [];
    return {
      id: t.id, title: t.title,
      source: srcs.length ? srcs[0].name : "seed",
      url: srcs.length ? srcs[0].url : "",
      velocity: t.velocity || 0, opportunity_score: t.opportunity_score || 0,
      hashtags: t.hashtags || [],
      detected_at: t.first_seen || t.last_seen || null,
      summary: (t.summary || "").slice(0, 400),
      category: t.category || null, platforms: t.platforms || [],
      format_tags: t.format_tags || [],
      sources: srcs.map((s) => s.name),
      trend_type: t.trend_type || "topic",
      format_family: t.format_family !== undefined ? t.format_family : null,
      velocity_trend: prev[t.id] || buildingTrend(t),
    };
  });
  return { generated_at: now.toISOString(), sample: false,
           source_count: trends.length, trends: trends };
}

// Change detection: canonical-compare everything EXCEPT the volatile
// generated_at, so identical upstream data → no commit (§4.3 idempotency).
function canonExcept(obj, exceptKeys) {
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out = {};
      Object.keys(v).sort().forEach((k) => {
        if (!exceptKeys.includes(k)) out[k] = strip(v[k]);
      });
      return out;
    }
    return v;
  };
  return JSON.stringify(strip(obj));
}

// ---------------------------------------------------------------------------
// the job
// ---------------------------------------------------------------------------

module.exports = async (req, res) => {
  const requestId = envelope.newRequestId();
  const t0 = Date.now();

  // Fail closed: no/incorrect CRON_SECRET → 401, nothing runs (§8.3).
  if (!assertCron(req)) {
    return envelope.err(res, SERVICE, VERSION, 401, "UNAUTHORIZED",
      "Missing or incorrect CRON_SECRET. The wire cron never runs unprotected.",
      undefined, { requestId });
  }
  // 60s global cooldown — duplicate Vercel delivery guard (§4.3).
  if (Date.now() - lastRunAt < SEEN_TTL_MS) {
    console.log("[cron] wire duplicate-suppressed request_id=" + requestId);
    return okNoStore(res,
      { checked: envelope.nowIso(), duplicate: true,
        note: "Duplicate delivery inside the 60s cooldown — no work done." },
      { requestId: requestId, upstream: [] });
  }
  lastRunAt = Date.now();
  console.log("[cron] wire start request_id=" + requestId);

  const fail = (stage, error) => {
    console.log("[cron] wire fail stage=" + stage + " error=" + String(error).slice(0, 200) +
                " request_id=" + requestId);
    return envelope.err(res, SERVICE, VERSION, 500, "REFRESH_FAILED",
      "The wire refresh failed at stage '" + stage + "'.",
      { stage: stage }, { requestId });
  };

  try {
    const nowMs = Date.now();
    const now = new Date(nowMs);
    const upstream = [];

    // 1) read current store files (GitHub = source of truth when the token
    //    exists; bundle otherwise — §4.2)
    const [curTrends, curVel, curPvel, curFormats, curFlat, curFc] = await Promise.all([
      readStore(FILES.trends), readStore(FILES.velocity), readStore(FILES.platformVelocity),
      readStore(FILES.memeFormats), readStore(FILES.flat), readStore(FILES.forecasts),
    ]);
    for (const [name, r] of [[FILES.trends, curTrends], [FILES.velocity, curVel],
                             [FILES.platformVelocity, curPvel], [FILES.memeFormats, curFormats],
                             [FILES.flat, curFlat], [FILES.forecasts, curFc]]) {
      upstream.push({ source: (github.tokenConfigured() ? "github-contents:" : "bundle:") + name,
        ok: r.ok, checked_at: envelope.nowIso(),
        ...(r.ok ? { latency_ms: Date.now() - t0 } : { error: r.error }) });
    }
    if (!curTrends.ok || !curTrends.data || !Array.isArray(curTrends.data.topics)) {
      return fail("read-store", "cannot read " + FILES.trends + ": " +
                  (curTrends.error || "bad shape"));
    }
    const topics = {};
    curTrends.data.topics.forEach((t) => { topics[t.id] = t; });
    const vel = (curVel.ok && curVel.data) || {};
    const pvel = (curPvel.ok && curPvel.data) || {};
    const families = (curFormats.ok && curFormats.data && curFormats.data.families) || [];

    // 2) fetch upstreams in parallel — partial success is the normal case
    const results = await Promise.all(SOURCES.map(([name, fn]) => runSource(name, fn)));
    const allHits = [];
    for (const r of results) {
      upstream.push({ source: r.name, ok: r.ok, checked_at: r.checked_at,
        ...(r.ok ? { latency_ms: r.latency_ms } : { error: r.error }) });
      if (r.ok) allHits.push(...r.hits);
    }
    const sourcesOk = results.filter((r) => r.ok).length;

    // 3) merge → dedupe → score
    const newCount = mergeHits(topics, allHits, families, now);
    rescore(topics, nowMs);
    const topicList = Object.values(topics)
      .sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0));

    // 4) snapshots (30d retention) + forecasts from the real snapshots
    snapshotVelocity(vel, topics, nowMs);
    const forecasts = buildForecasts(vel, pvel, topics,
      (curFc.ok && curFc.data) || null, nowMs);
    const flat = buildFlat(topics, (curFlat.ok && curFlat.data) || null, now);
    const flatJs = "trendsCallback(" + JSON.stringify(flat) + ");";
    // NOTE: the repo pipeline writes the JSONP twin with Python's default
    // separators (spaces after , and :); this twin is byte-compact. Same
    // callback contract, same parsed payload — the contract is the callback
    // name + payload shape, not whitespace.

    const trendsPayload = {
      generated_at: now.toISOString(),
      count: topicList.length,
      generator: curTrends.data.generator || "api/cron/wire (trend-wire)",
      topics: topicList,
    };

    // 5) change detection (generated_at excluded → idempotent, §4.3)
    const cur = {
      trends: (curTrends.data && { count: curTrends.data.count, topics: curTrends.data.topics }) || null,
      flat: (curFlat.ok && curFlat.data &&
             { sample: curFlat.data.sample, source_count: curFlat.data.source_count,
               trends: curFlat.data.trends }) || null,
      forecasts: (curFc.ok && curFc.data && canonExcept(curFc.data, ["generated_at"])) || null,
    };
    const want = {
      trends: { count: trendsPayload.count, topics: trendsPayload.topics },
      flat: { sample: flat.sample, source_count: flat.source_count, trends: flat.trends },
      forecasts: canonExcept(forecasts, ["generated_at"]),
      velocity: github.canonicalJson(vel),
    };
    const changed = {
      trends: !cur.trends || github.canonicalJson(cur.trends) !== github.canonicalJson(want.trends),
      flat: !cur.flat || github.canonicalJson(cur.flat) !== github.canonicalJson(want.flat),
      forecasts: !cur.forecasts || cur.forecasts !== want.forecasts,
      velocity: true, // snapshots always append — the daily heartbeat's own pulse
    };
    // velocity: compare against the actual current file to avoid a pointless
    // commit when nothing moved (e.g. duplicate run inside the hour bucket).
    if (curVel.ok && curVel.data) {
      try {
        changed.velocity = github.canonicalJson(curVel.data) !== want.velocity;
      } catch (e) { /* keep true */ }
    }
    const anyChanged = changed.trends || changed.flat || changed.forecasts || changed.velocity;
    const changedFiles = Object.keys(changed).filter((k) => changed[k]);

    // 6) commit — or read-only mode when the PAT is still pending (§14.1)
    const tokenOk = github.tokenConfigured();
    const commits = {};
    let committed = false;
    if (!tokenOk) {
      console.log("[cron] wire read-only (GITHUB_REPO_TOKEN pending) request_id=" + requestId);
    } else if (!anyChanged) {
      console.log("[cron] wire no-change request_id=" + requestId);
    } else if (Date.now() - t0 > COMMIT_GUARD_MS) {
      console.log("[cron] wire commit-skipped (budget guard) request_id=" + requestId);
    } else {
      const msg = "wire: daily heartbeat " + now.toISOString().slice(0, 10) +
                  " (" + sourcesOk + "/" + results.length + " sources, +" + newCount +
                  " topics, " + topicList.length + " total)";
      const jobs = [];
      if (changed.trends) jobs.push(["trends.json",
        github.writeJsonIfChanged(FILES.trends, trendsPayload, msg)]);
      if (changed.flat) jobs.push(["trends.flat.json",
        github.writeJsonIfChanged(FILES.flat, flat, msg)]);
      if (changed.flat) jobs.push(["trends.flat.js",
        github.writeTextIfChanged(FILES.flatJs, flatJs, msg)]);
      if (changed.forecasts) jobs.push(["forecasts.json",
        github.writeJsonIfChanged(FILES.forecasts, forecasts, msg)]);
      if (changed.velocity) jobs.push(["velocity.json",
        github.writeJsonIfChanged(FILES.velocity, vel, msg)]);
      const outs = await Promise.all(jobs.map(([, p]) => p));
      jobs.forEach(([name], i) => {
        const o = outs[i];
        commits[name] = { committed: o.committed, sha: o.sha, reason: o.reason };
        upstream.push({ source: "github-commit:" + name, ok: o.committed || o.reason === "unchanged",
          checked_at: envelope.nowIso(),
          ...((o.committed || o.reason === "unchanged") ? {} : { error: o.reason }) });
        if (!o.committed && o.reason !== "unchanged" && o.reason !== "unchanged-after-retry") {
          console.log("[cron] wire commit issue file=" + name + " reason=" + o.reason +
                      " request_id=" + requestId);
        }
      });
      committed = Object.values(commits).some((c) => c.committed);
    }

    const anySourceFailed = results.some((r) => !r.ok);
    const failedNames = results.filter((r) => !r.ok).map((r) => r.name);
    console.log("[cron] wire done changed=" + anyChanged + " committed=" + committed +
                " sources_ok=" + sourcesOk + "/" + results.length +
                " new=" + newCount + " trends=" + topicList.length +
                " request_id=" + requestId);

    return okNoStore(res, {
      checked: now.toISOString(),
      mode: tokenOk ? "read-write"
        : "read-only — GITHUB_REPO_TOKEN (fine-grained PAT, contents:write) is still " +
          "pending the user's decision (spec §14.1). Computed but not persisted; " +
          "static JSON updates only via the wave-engine pipeline's pushes.",
      changed: anyChanged,
      changed_files: changedFiles,
      committed: committed,
      commits: commits,
      sources_ok: sourcesOk + "/" + results.length,
      trends_count: topicList.length,
      new_count: newCount,
      forecasts: {
        peaking_48h: forecasts.counts.peaking_48h,
        rising_fast: forecasts.counts.rising_fast,
        cooling_off: forecasts.counts.cooling_off,
        steady: forecasts.counts.steady,
        insufficient: forecasts.counts.insufficient,
      },
    }, {
      source: "live",
      degraded: anySourceFailed,
      staleSince: null,
      upstream: upstream,
      requestId: requestId,
      note: anySourceFailed
        ? "Partial upstream outage (" + failedNames.join(", ") + ") — merged " +
          sourcesOk + "/" + results.length + " sources; failed sources are listed in meta.upstream."
        : (tokenOk ? null : "Read-only mode: commit-back token pending; nothing was persisted."),
    });
  } catch (e) {
    return fail("unhandled", (e && e.stack) || String(e));
  }
};

// §1.6: cron/admin endpoints are no-store (not the GET edge-cache default).
// Same envelope shape as envelope.ok, with Cache-Control: no-store.
function okNoStore(res, data, opts) {
  opts = opts || {};
  const meta = {
    service: SERVICE, version: VERSION, generated_at: envelope.nowIso(),
    request_id: opts.requestId || envelope.newRequestId(),
    source: opts.source || "live", degraded: !!opts.degraded,
    stale_since: opts.staleSince || null,
    upstream: Array.isArray(opts.upstream) ? opts.upstream : [],
    note: opts.note || null,
  };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, data: data, meta: meta }));
}
