/* api/velocity.js — GET /api/velocity (§7.2 "The Wire" roster).
   ?topic_id= (required) → { topic_id, snapshots: [[iso_ts, velocity,
   opportunity], ...] } — the raw 30-day trajectory the Oracle classifies.
   Missing topic_id → 400 BAD_INPUT; unknown topic_id → 404 NOT_FOUND.
   Points are real snapshots only: a missing day renders as a gap, never a
   guess (§6 — never interpolate). */
"use strict";

const path = require("path");
const fs = require("fs");
const envelope = require("../lib/envelope.js");
const ratelimit = require("../lib/ratelimit.js");
const github = require("../lib/github.js");

const SERVICE = "trend-wire";
const VERSION = "1.0.0";
const FILE = "api/v1/velocity.json";

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

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return envelope.err(res, SERVICE, VERSION, 400, "BAD_INPUT",
      "GET /api/velocity only accepts GET.", { fields: ["method must be GET"] });
  }
  const ip = ratelimit.clientIp(req);
  const lim = ratelimit.checkLimit(ip, "public");
  if (!lim.allowed) {
    console.log("[ratelimit] ip=" + ratelimit.ipHash(ip) + " bucket=public path=/api/velocity");
    return envelope.err(res, SERVICE, VERSION, 429, "RATE_LIMITED",
      "Too many requests — slow down and retry.", undefined, { retryAfter: lim.retryAfter });
  }

  const url = new URL(req.url, "http://localhost");
  const topicId = (url.searchParams.get("topic_id") || "").trim();
  if (!topicId) {
    return envelope.err(res, SERVICE, VERSION, 400, "BAD_INPUT",
      "Missing required query parameter.", { fields: ["topic_id is required"] });
  }

  const upstream = [];
  const t0 = Date.now();
  const read = await readStore();
  upstream.push({
    source: github.tokenConfigured() ? "github-contents:" + FILE : "bundle:" + FILE,
    ok: read.ok, checked_at: envelope.nowIso(),
    ...(read.ok ? { latency_ms: Date.now() - t0 } : { error: read.error }),
  });
  if (!read.ok || !read.data) {
    return envelope.err(res, SERVICE, VERSION, 502, "UPSTREAM_UNAVAILABLE",
      "The velocity store could not be read at " + envelope.nowIso() +
      "; no fresh or cached data available from this function.",
      { sources: [FILE] });
  }
  const series = read.data[topicId];
  if (!Array.isArray(series)) {
    return envelope.err(res, SERVICE, VERSION, 404, "NOT_FOUND",
      "No velocity series for topic_id '" + topicId.slice(0, 80) + "'.",
      { topic_id: topicId });
  }

  return envelope.ok(res, SERVICE, VERSION,
    { topic_id: topicId, snapshots: series }, { source: "live", upstream: upstream });
};
