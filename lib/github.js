/* lib/github.js — §1.11 + §5 of the server-program spec.
   The repo is the database: cron jobs read/write versioned JSON via the
   GitHub Contents API, and functions read the same files (the fallback file
   and the store are literally the same file — §4.6).

   Env: GITHUB_REPO_TOKEN (fine-grained PAT, contents:write on this repo
   only), GITHUB_REPO ("owner/name"), REPO_STATIC_PREFIX ("" for
   trend-machine — outputDirectory is ".").

   TOKEN DECISION RESOLVED (2026-10-24, fleet-data migration): no repo
   token is ever set. Live data refreshes through the separate
   astercast/fleet-data repo, whose collectors need no secrets at all.
   This helper therefore always runs in its read-only degradation:
   tokenConfigured() is false, writes are skipped, and reads come from
   the deployment bundle (local files). Nothing here ever throws for a
   missing token — callers branch on tokenConfigured().

   writeJsonIfChanged: GETs the current file, compares SHA-256 of the
   canonical JSON (sorted keys, 2-space indent, trailing newline), PUTs only
   on change; on SHA mismatch (409) it re-reads once and retries once, then
   returns { committed:false, reason:'conflict' }. All calls carry an 8000ms
   timeout. Never force-pushes, never deletes (§4.3).
   Zero dependencies. Copied verbatim between the seven site repos. */
"use strict";

const { fetchTimeout } = require("./fetchx.js");

const TOKEN = process.env.GITHUB_REPO_TOKEN || "";
const REPO = process.env.GITHUB_REPO || "";          // e.g. "astercast/trend-machine"
const PREFIX = process.env.REPO_STATIC_PREFIX || ""; // "" or "site/"
const API = "https://api.github.com";

function tokenConfigured() {
  return !!(TOKEN && REPO);
}

function repoPath(p) {
  return PREFIX + p;
}

function ghHeaders() {
  return {
    "Authorization": "Bearer " + TOKEN,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "trend-wire/1.0.0 (+https://github.com/astercast/trend-machine)",
  };
}

// Canonical JSON: sorted keys, 2-space indent, trailing newline.
// The wire and the repo pipeline must produce byte-identical files for
// identical content — this is the shared canonicalization (§4.3).
function canonicalJson(obj) {
  return JSON.stringify(sortKeys(obj), null, 2) + "\n";
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    Object.keys(v).sort().forEach((k) => { out[k] = sortKeys(v[k]); });
    return out;
  }
  return v;
}

// Read a JSON file from the repo. Returns { ok, data, sha, error }.
async function readJson(path) {
  const url = API + "/repos/" + REPO + "/contents/" + encodeURIComponent(repoPath(path)).replace(/%2F/g, "/");
  const r = await fetchTimeout(url, { timeoutMs: 8000, headers: ghHeaders() });
  if (!r.ok) {
    return { ok: false, data: null, sha: null,
             error: "github read " + path + ": " + (r.error || ("http " + r.status)) };
  }
  try {
    const body = JSON.parse(r.text);
    const data = JSON.parse(Buffer.from(body.content || "", "base64").toString("utf8"));
    return { ok: true, data: data, sha: body.sha || null, error: null };
  } catch (e) {
    return { ok: false, data: null, sha: null,
             error: "github read " + path + ": unparseable response" };
  }
}

// PUT one file. sha may be null for a brand-new file.
async function putFile(path, content, message, sha) {
  const url = API + "/repos/" + REPO + "/contents/" + encodeURIComponent(repoPath(path)).replace(/%2F/g, "/");
  const body = JSON.stringify({
    message: message,
    content: Buffer.from(content, "utf8").toString("base64"),
    sha: sha || undefined,
  });
  const r = await fetchTimeout(url, {
    timeoutMs: 8000, method: "PUT", headers: ghHeaders(), body: body,
  });
  if (!r.ok) {
    let detail = r.error || ("http " + r.status);
    return { ok: false, status: r.status, error: detail };
  }
  try {
    const b = JSON.parse(r.text);
    return { ok: true, status: r.status, sha: (b.content && b.content.sha) || null, error: null };
  } catch (e) {
    return { ok: true, status: r.status, sha: null, error: null };
  }
}

// Write JSON only when the canonical bytes differ from the repo's.
// Returns { committed, changed, sha, reason }.
async function writeJsonIfChanged(path, obj, message) {
  const want = canonicalJson(obj);
  const cur = await readJson(path);
  if (!cur.ok && cur.error && !/http 404/.test(cur.error)) {
    return { committed: false, changed: false, sha: null, reason: "read-failed: " + cur.error };
  }
  if (cur.ok && cur.data !== null) {
    try {
      if (canonicalJson(cur.data) === want) {
        return { committed: false, changed: false, sha: cur.sha, reason: "unchanged" };
      }
    } catch (e) { /* fall through to write */ }
  }
  let attempt = await putFile(path, want, message, cur.ok ? cur.sha : null);
  if (!attempt.ok && attempt.status === 409) {
    // SHA conflict: re-read once, re-compare, retry once (§4.3).
    const cur2 = await readJson(path);
    if (cur2.ok && cur2.data !== null) {
      try {
        if (canonicalJson(cur2.data) === want) {
          return { committed: false, changed: false, sha: cur2.sha, reason: "unchanged-after-retry" };
        }
      } catch (e) { /* fall through */ }
    }
    attempt = await putFile(path, want, message, cur2.ok ? cur2.sha : null);
    if (!attempt.ok) {
      return { committed: false, changed: false, sha: null, reason: "conflict" };
    }
  }
  if (!attempt.ok) {
    return { committed: false, changed: false, sha: null, reason: "write-failed: " + attempt.error };
  }
  return { committed: true, changed: true, sha: attempt.sha, reason: "committed" };
}

// Raw-text twin (for trends.flat.js — the JSONP file is text, not JSON).
async function writeTextIfChanged(path, text, message) {
  const raw = await fetchTimeout(
    API + "/repos/" + REPO + "/contents/" + encodeURIComponent(repoPath(path)).replace(/%2F/g, "/"),
    { timeoutMs: 8000, headers: Object.assign(ghHeaders(), { Accept: "application/vnd.github.raw" }) }
  );
  if (raw.ok && raw.text === text) {
    return { committed: false, changed: false, sha: null, reason: "unchanged" };
  }
  const sha = await (async () => {
    const meta = await readJson(path);
    return meta.ok ? meta.sha : null;
  })();
  let attempt = await putFile(path, text, message, sha);
  if (!attempt.ok && attempt.status === 409) {
    const meta2 = await readJson(path);
    attempt = await putFile(path, text, message, meta2.ok ? meta2.sha : null);
    if (!attempt.ok) return { committed: false, changed: false, sha: null, reason: "conflict" };
  }
  if (!attempt.ok) {
    return { committed: false, changed: false, sha: null, reason: "write-failed: " + attempt.error };
  }
  return { committed: true, changed: true, sha: attempt.sha, reason: "committed" };
}

module.exports = { tokenConfigured, readJson, writeJsonIfChanged, writeTextIfChanged,
                   canonicalJson, repoPath };
