/* api/forecasts.js — GET /api/forecasts (§7.2 "The Wire" roster).
   The Oracle's trajectories, computed from REAL velocity snapshots by the
   daily wire cron (assets/js/trajectory.js — the same classifier as the
   oracle.html dashboard). Every forecast is a projection, never a guarantee:
   the payload carries method + honesty text and confidence.basis names the
   evidence (snapshot count + fit quality), never a probability of being right.
   computed_from names the snapshot evidence the lists were built on.
   Topics with fewer than 3 snapshots are excluded from the forecast lists
   (counts.insufficient) — honestly left out, never interpolated. */
"use strict";

const path = require("path");
const fs = require("fs");
const envelope = require("../lib/envelope.js");
const ratelimit = require("../lib/ratelimit.js");
const github = require("../lib/github.js");

const SERVICE = "trend-wire";
const VERSION = "1.0.0";
const FILE = "api/v1/forecasts.json";
const VEL_FILE = "api/v1/velocity.json";

function readStore(name) {
  if (github.tokenConfigured()) return github.readJson(name);
  return new Promise((resolve) => {
    fs.readFile(path.join(__dirname, "..", name), "utf8", (e, text) => {
      if (e) return resolve({ ok: false, data: null, error: String(e.message || e) });
      try { resolve({ ok: true, data: JSON.parse(text), error: null }); }
      catch (err) { resolve({ ok: false, data: null, error: "unparseable: " + err.message }); }
    });
  });
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return envelope.err(res, SERVICE, VERSION, 400, "BAD_INPUT",
      "GET /api/forecasts only accepts GET.", { fields: ["method must be GET"] });
  }
  const ip = ratelimit.clientIp(req);
  const lim = ratelimit.checkLimit(ip, "public");
  if (!lim.allowed) {
    console.log("[ratelimit] ip=" + ratelimit.ipHash(ip) + " bucket=public path=/api/forecasts");
    return envelope.err(res, SERVICE, VERSION, 429, "RATE_LIMITED",
      "Too many requests — slow down and retry.", undefined, { retryAfter: lim.retryAfter });
  }

  const upstream = [];
  const t0 = Date.now();
  const [fc, vel] = await Promise.all([readStore(FILE), readStore(VEL_FILE)]);
  const srcTag = (f) => (github.tokenConfigured() ? "github-contents:" + f : "bundle:" + f);
  upstream.push({ source: srcTag(FILE), ok: fc.ok, checked_at: envelope.nowIso(),
    ...(fc.ok ? { latency_ms: Date.now() - t0 } : { error: fc.error }) });
  upstream.push({ source: srcTag(VEL_FILE), ok: vel.ok, checked_at: envelope.nowIso(),
    ...(vel.ok ? { latency_ms: Date.now() - t0 } : { error: vel.error }) });

  if (!fc.ok || !fc.data) {
    return envelope.err(res, SERVICE, VERSION, 502, "UPSTREAM_UNAVAILABLE",
      "The forecast store could not be read at " + envelope.nowIso() +
      "; no fresh or cached data available from this function.",
      { sources: [FILE] });
  }
  const d = fc.data;

  // computed_from: the honest evidence line — how many topics carry real
  // snapshot series behind these lists. A forecast with no snapshots is
  // not served as a forecast (the lists only contain 3+ snapshot topics).
  let velTopics = 0, velPoints = 0;
  if (vel.ok && vel.data) {
    velTopics = Object.keys(vel.data).length;
    velPoints = Object.keys(vel.data).reduce(
      (n, k) => n + (Array.isArray(vel.data[k]) ? vel.data[k].length : 0), 0);
  }

  const data = {
    generated_at: d.generated_at || null,
    method: d.method || null,
    honesty: d.honesty || null,
    counts: d.counts || null,
    peaking_48h: d.peaking_48h || [],
    rising_fast: d.rising_fast || [],
    cooling_off: d.cooling_off || [],
    steady: d.steady || [],
    projections: d.projections || {},
    computed_from: {
      velocity_topics: velTopics,
      velocity_snapshots: velPoints,
      as_of: d.generated_at || null,
      note: "Every list entry is a projection from that topic's real " +
            "velocity snapshots (3+ required) — never a guarantee.",
    },
  };

  return envelope.ok(res, SERVICE, VERSION, data, {
    source: "live",
    degraded: !vel.ok,
    staleSince: !vel.ok ? (d.generated_at || null) : null,
    upstream: upstream,
    note: vel.ok ? null
      : "Velocity snapshot evidence unreadable; serving the last committed forecast lists.",
  });
};
