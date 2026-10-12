/* lib/fetchx.js — §1.11 of the server-program spec.
   Every upstream call goes through fetchTimeout(): AbortController timeout
   (default 4000ms), returns { ok, status, text, ms, error }. The User-Agent
   identifies the service — no scraping disguised as a browser (§8.7).
   Zero dependencies. Copied verbatim between the seven site repos. */
"use strict";

function fetchTimeout(url, opts) {
  opts = opts || {};
  const timeoutMs = opts.timeoutMs || 4000;
  const method = opts.method || "GET";
  const headers = Object.assign(
    { "User-Agent": opts.userAgent || "trend-wire/1.0.0 (+https://github.com/astercast/trend-machine)" },
    opts.headers || {}
  );
  const ctrl = new AbortController();
  const t0 = Date.now();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const init = { method: method, headers: headers, signal: ctrl.signal, redirect: "follow" };
  if (opts.body !== undefined) init.body = opts.body;
  return fetch(url, init).then(
    async (r) => {
      const ms = Date.now() - t0;
      clearTimeout(timer);
      let text = "";
      try { text = await r.text(); } catch (e) { /* body unreadable */ }
      return { ok: r.ok, status: r.status, text: text, ms: ms,
               error: r.ok ? null : "http " + r.status };
    },
    (e) => {
      const ms = Date.now() - t0;
      clearTimeout(timer);
      const reason = (e && e.name === "AbortError")
        ? "timeout after " + timeoutMs + "ms"
        : String((e && e.message) || e);
      return { ok: false, status: 0, text: "", ms: ms, error: reason };
    }
  );
}

module.exports = { fetchTimeout };
