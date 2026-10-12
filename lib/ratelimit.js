/* lib/ratelimit.js — §1.7 of the server-program spec.
   Per-instance in-memory token bucket. Best-effort by design: it resets on
   cold start (documented, not hidden). Buckets: "public" (60/min per IP),
   "compute" (20/min per IP). Cron/admin endpoints don't use the IP bucket —
   they are protected by CRON_SECRET instead, plus a per-job cooldown.
   Key the bucket on x-forwarded-for (first entry), never the socket IP.
   Log a hash of abusive IPs, never the raw IP (§4.5). Zero dependencies. */
"use strict";

const crypto = require("crypto");

const CAPS = { public: 60, compute: 20 };
const WINDOW_MS = 60000;

const buckets = new Map(); // key -> { tokens, resetAt }

function clientIp(req) {
  const fwd = req.headers && req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim() || "unknown";
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function ipHash(ip) {
  return crypto.createHash("sha256").update(String(ip)).digest("hex").slice(0, 12);
}

// Returns { allowed, retryAfter }. On denial the caller logs
// `[ratelimit] ip=<hash> bucket=<b> path=<p>` and returns 429 RATE_LIMITED.
function checkLimit(ip, bucket) {
  const cap = CAPS[bucket] || CAPS.public;
  const now = Date.now();
  const key = bucket + ":" + ip;
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) b = { tokens: cap, resetAt: now + WINDOW_MS };
  if (b.tokens <= 0) {
    buckets.set(key, b);
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return { allowed: true, retryAfter: 0 };
}

module.exports = { checkLimit, clientIp, ipHash };
