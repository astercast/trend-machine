/* api/trends.js — GET /api/trends (§7.2 "The Wire" roster).
   Opportunity-ranked trends, served from the committed store
   (data/v1/trends.json — the same file that is both the database and the
   static fallback, §5/§4.6). Query: ?limit= (default 50, max 200),
   ?platform= (e.g. tiktok). Stale (>72h, no corroboration) topics are
   excluded — stale-ness is the pipeline's own cooling signal.
   Never invents a trend: on read failure it 502s honestly and the frontend
   falls back to its static file (§3). */
"use strict";

const path = require("path");
const fs = require("fs");
const envelope = require("../lib/envelope.js");
const ratelimit = require("../lib/ratelimit.js");
const github = require("../lib/github.js");

const SERVICE = "trend-wire";
const VERSION = "1.0.0";
const FILE = "data/v1/trends.json";

function readStore() {
  if (github.tokenConfigured()) return github.readJson(FILE);
  return new Promise((resolve) => {
    fs.readFile(path.join(__dirname, "..", FILE), "utf8", (e, text) => {
      if (e) return resolve({ ok: false, data: null, error: String(e.message || e) });
      try { resolve({ ok: true, data: JSON.parse(text), error: null }); }
      catch (err) { resolve({ ok: false, data: null, error: "unparseable: " + err.message }); }
    });
  });
}

function project(t) {
  return {
    id: t.id, title: t.title, platforms: t.platforms || [],
    velocity: t.velocity || 0, opportunity_score: t.opportunity_score || 0,
    first_seen: t.first_seen || null, last_seen: t.last_seen || null,
    sources: (t.sources || []).map((s) => ({ name: s.name, url: s.url })),
  };
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return envelope.err(res, SERVICE, VERSION, 400, "BAD_INPUT",
      "GET /api/trends only accepts GET.", { fields: ["method must be GET"] });
  }
  const ip = ratelimit.clientIp(req);
  const lim = ratelimit.checkLimit(ip, "public");
  if (!lim.allowed) {
    console.log("[ratelimit] ip=" + ratelimit.ipHash(ip) + " bucket=public path=/api/trends");
    return envelope.err(res, SERVICE, VERSION, 429, "RATE_LIMITED",
      "Too many requests — slow down and retry.", undefined, { retryAfter: lim.retryAfter });
  }

  const url = new URL(req.url, "http://localhost");
  const fields = [];
  let limit = 50;
  const limitRaw = url.searchParams.get("limit");
  if (limitRaw !== null) {
    if (!/^\d+$/.test(limitRaw)) fields.push("limit must be an integer 1–200");
    else {
      limit = parseInt(limitRaw, 10);
      if (limit < 1 || limit > 200) fields.push("limit must be an integer 1–200");
    }
  }
  const platform = url.searchParams.get("platform");
  if (fields.length) {
    return envelope.err(res, SERVICE, VERSION, 400, "BAD_INPUT",
      "Invalid query parameters.", { fields: fields });
  }

  const upstream = [];
  const t0 = Date.now();
  const read = await readStore();
  upstream.push({
    source: github.tokenConfigured() ? "github-contents:" + FILE : "bundle:" + FILE,
    ok: read.ok, checked_at: envelope.nowIso(),
    ...(read.ok ? { latency_ms: Date.now() - t0 } : { error: read.error }),
  });
  if (!read.ok || !read.data || !Array.isArray(read.data.topics)) {
    return envelope.err(res, SERVICE, VERSION, 502, "UPSTREAM_UNAVAILABLE",
      "The trend store could not be read at " + envelope.nowIso() +
      "; no fresh or cached data available from this function.",
      { sources: [FILE] });
  }

  let topics = read.data.topics.filter((t) => !t.stale);
  if (platform) {
    const p = platform.toLowerCase();
    topics = topics.filter((t) => (t.platforms || []).some((x) => String(x).toLowerCase() === p));
  }
  topics = topics.slice()
    .sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0))
    .slice(0, limit)
    .map(project);

  return envelope.ok(res, SERVICE, VERSION, topics, {
    source: "live",
    upstream: upstream,
    note: "Opportunity-ranked from the committed store (generated_at " +
          (read.data.generated_at || "unknown") + ").",
  });
};
