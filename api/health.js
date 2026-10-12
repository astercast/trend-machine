/* api/health.js — GET /api/health (§1.4 of the server-program spec).
   No auth. Edge-cacheable (s-maxage=60 per §1.4 — set here explicitly rather
   than the §1.6 default). Never returns 5xx: status is "ok" unless a check
   fails, then "degraded". data_freshness lists every static JSON the Wire's
   functions depend on, with SLA verdicts (SLA 24h per §7.2). */
"use strict";

const path = require("path");
const fs = require("fs");
const envelope = require("../lib/envelope.js");
const github = require("../lib/github.js");

const SERVICE = "trend-wire";
const VERSION = "1.0.0";
const SLA_S = 86400; // §7.2 freshness SLA: 24h

const STARTED_AT = envelope.nowIso();
const FUNCTIONS = ["health", "trends", "forecasts", "velocity", "cron/wire"];
const DEPS = ["data/v1/trends.json", "data/v1/trends.flat.json",
              "data/v1/forecasts.json", "data/v1/velocity.json"];

function readDep(name) {
  // Prefer the GitHub read when the commit-back token is configured
  // (§4.2 — GitHub is the source of truth); otherwise read the bundle.
  if (github.tokenConfigured()) return github.readJson(name);
  return new Promise((resolve) => {
    fs.readFile(path.join(__dirname, "..", name), "utf8", (e, text) => {
      if (e) return resolve({ ok: false, data: null, error: String(e.message || e) });
      try {
        resolve({ ok: true, data: JSON.parse(text), error: null });
      } catch (err) {
        resolve({ ok: false, data: null, error: "unparseable: " + err.message });
      }
    });
  });
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return envelope.err(res, SERVICE, VERSION, 400, "BAD_INPUT",
      "GET /api/health only accepts GET.", { fields: ["method must be GET"] });
  }
  const now = Date.now();
  const freshness = {};
  let allPresent = true;
  const reads = await Promise.all(DEPS.map((d) => readDep(d)));
  reads.forEach((r, i) => {
    const name = DEPS[i].split("/").pop();
    let gen = r.ok && r.data ? r.data.generated_at : null;
    // velocity.json is a bare {topic_id: [[ts, v, opp]...]} map with no
    // top-level generated_at — its freshness is the newest snapshot inside.
    if (!gen && r.ok && r.data && name === "velocity.json") {
      let newest = 0;
      for (const k of Object.keys(r.data)) {
        const series = r.data[k];
        if (!Array.isArray(series)) continue;
        for (const p of series) {
          const t = Date.parse(p && p[0]);
          if (!isNaN(t) && t > newest) newest = t;
        }
      }
      if (newest) gen = new Date(newest).toISOString();
    }
    if (!gen) {
      allPresent = false;
      freshness[name] = { generated_at: null, age_s: null, sla_s: SLA_S,
                          within_sla: false, error: r.ok ? "missing generated_at" : (r.error || "unreadable") };
      return;
    }
    const g = Date.parse(gen);
    const ageS = isNaN(g) ? null : Math.max(0, Math.round((now - g) / 1000));
    freshness[name] = { generated_at: gen, age_s: ageS,
                        sla_s: SLA_S, within_sla: ageS !== null && ageS <= SLA_S };
    if (!freshness[name].within_sla) allPresent = false;
  });

  const checks = {
    static_fallback_present: allPresent,
    cron_secret_configured: !!process.env.CRON_SECRET,
    github_token_configured: github.tokenConfigured(),
  };
  // Booleans only — never leak secret values (§1.4).
  const status = (checks.static_fallback_present && checks.cron_secret_configured)
    ? "ok" : "degraded";

  const data = {
    status: status,
    service: SERVICE,
    version: VERSION,
    started_at: STARTED_AT,
    uptime_s: Math.round(process.uptime()),
    node: process.version,
    functions: FUNCTIONS,
    data_freshness: freshness,
    checks: checks,
  };
  // §1.4: s-maxage=60 for health (overrides the §1.6 GET default).
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=86400");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = 200;
  const meta = {
    service: SERVICE, version: VERSION, generated_at: envelope.nowIso(),
    source: "live", degraded: status !== "ok", request_id: envelope.newRequestId(),
  };
  res.end(JSON.stringify({ ok: true, data: data, meta: meta }));
};
