/* lib/envelope.js — §1.1 / §1.2 / §1.6 of the server-program spec.
   The ONLY way functions build responses. Every function returns JSON in
   the shared envelope: { ok, data, meta } on success, { ok:false, data:null,
   meta, error:{code,message,details?} } on failure.
   GET functions get the §1.6 edge-cache headers; everything else is no-store.
   Zero dependencies. Copied verbatim between the seven site repos — do not
   fork behavior; bump per-function meta.version instead. */
"use strict";

const crypto = require("crypto");

// RFC 3339 UTC, second precision, Z suffix (§1.3).
function nowIso() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function newRequestId() {
  return "req_" + crypto.randomBytes(3).toString("hex");
}

function baseMeta(service, version) {
  return {
    service: service,
    version: version,
    generated_at: nowIso(),
    request_id: newRequestId(),
  };
}

function setCacheHeaders(res, kind) {
  if (kind === "get") {
    // §1.6: 10 min fresh at the edge, serve-stale up to a day while
    // revalidating. All freshness SLAs are >= 24h so this never violates them.
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
}

function send(res, status, obj) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = status;
  res.end(JSON.stringify(obj));
}

// Success envelope. opts: { source, degraded, staleSince, upstream, note, requestId }
function ok(res, service, version, data, opts) {
  opts = opts || {};
  setCacheHeaders(res, "get");
  const meta = baseMeta(service, version);
  if (opts.requestId) meta.request_id = opts.requestId;
  meta.source = opts.source || "live";
  meta.degraded = !!opts.degraded;
  meta.stale_since = opts.staleSince || null;
  meta.upstream = Array.isArray(opts.upstream) ? opts.upstream : [];
  meta.note = opts.note || null;
  send(res, 200, { ok: true, data: data, meta: meta });
}

// Error envelope (4xx and 5xx both use it — §1.2). opts: { retryAfter, requestId }
function err(res, service, version, httpStatus, code, message, details, opts) {
  opts = opts || {};
  setCacheHeaders(res, "err");
  const meta = baseMeta(service, version);
  if (opts.requestId) meta.request_id = opts.requestId;
  const body = { ok: false, data: null, meta: meta,
                 error: { code: code, message: message } };
  if (details !== undefined) body.error.details = details;
  if (opts.retryAfter) res.setHeader("Retry-After", String(opts.retryAfter));
  send(res, httpStatus, body);
}

module.exports = { ok, err, newRequestId, nowIso };
