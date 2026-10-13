'use strict';
/* tests/local-server.js — canonical local function runtime (fleet-commons
 * api-contract-test pattern v1.0.0).
 *
 * `vercel dev` isn't available in this sandbox, so this harness executes the
 * real function files with a faithful emulation of Vercel's Node serverless
 * contract: req.{method,url,headers,query,body,socket},
 * res.{statusCode,setHeader,end}. The fleet's functions only use those
 * (via lib/envelope.js), so what runs here is what Vercel runs.
 *
 * Reconciles four drifted forks: film tests/local-server.js, aster
 * tests/local_server.js, creator tests/serve-functions.js, button-mash
 * tests/run_local.js. Decisions (see pattern README):
 *   - Routes are DERIVED from vercel.json's functions map — no hardcoded
 *     ROUTES table to drift. (vercel.json absent -> scan FN_ROOT/api/**.)
 *   - Warm-instance module cache by default (button-mash semantics: like a
 *     warm Vercel instance, in-memory rate-limit/cooldown state persists —
 *     the rate-limit test section depends on this). FRESH=1 switches to
 *     film's fresh-require-per-request while iterating on a handler.
 *   - The real Node req/res pass through, augmented with parsed .query
 *     and awaited, JSON-parsed .body (film's readBody semantics).
 *
 * Config (env; defaults suit the standard layout — functions + data at
 * the repo root, this file in tests/):
 *   HARNESS_ROOT  repo root                       (default: parent of tests/)
 *   FN_ROOT       dir vercel.json paths resolve   (default: HARNESS_ROOT;
 *                 against                         film sets HARNESS_ROOT/site)
 *   DATA_ROOT     dir holding data/v1/            (default: FN_ROOT;
 *                                                  creator sets HARNESS_ROOT/site)
 *   FN_STRIP      path segment between api/ and   (default: none;
 *                 the route name to strip         creator sets "functions")
 *   PORT          listen port                     (argv[2] > env > 0 = ephemeral)
 *   FRESH=1       fresh require per request
 *
 * Usage: PORT=0 CRON_SECRET=test-secret node tests/local-server.js
 * Prints "READY port=N" plus the derived route table on boot.
 */
var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');

var HARNESS_ROOT = process.env.HARNESS_ROOT || path.join(__dirname, '..');
var FN_ROOT = process.env.FN_ROOT || HARNESS_ROOT;
var DATA_ROOT = process.env.DATA_ROOT || FN_ROOT;
var FN_STRIP = process.env.FN_STRIP || '';
var FRESH = process.env.FRESH === '1';

function deriveRoutes() {
  var keys = [];
  try {
    var v = JSON.parse(fs.readFileSync(path.join(HARNESS_ROOT, 'vercel.json'), 'utf8'));
    keys = Object.keys(v.functions || {});
  } catch (e) {
    (function walk(dir, rel) {
      if (!fs.existsSync(dir)) return;
      fs.readdirSync(dir, { withFileTypes: true }).forEach(function (ent) {
        var p = rel ? rel + '/' + ent.name : ent.name;
        if (ent.isDirectory()) walk(path.join(dir, ent.name), p);
        else if (ent.name.endsWith('.js')) keys.push('api/' + p);
      });
    })(path.join(FN_ROOT, 'api'), '');
  }
  var routes = {};
  keys.forEach(function (key) {
    var parts = key.replace(/\.js$/, '').split('/');
    if (parts[0] === 'api') parts.shift();
    if (FN_STRIP && parts[0] === FN_STRIP) parts.shift();
    routes['/api/' + parts.join('/')] = path.join(FN_ROOT, key);
  });
  return routes;
}

var ROUTES = deriveRoutes();
var handlerCache = new Map();

var MIME = { '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8' };

function readBody(req) {
  return new Promise(function (resolve) {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      var raw = Buffer.concat(chunks).toString('utf8');
      var ct = String(req.headers['content-type'] || '');
      if (raw && ct.indexOf('application/json') !== -1) {
        try { resolve(JSON.parse(raw)); return; } catch (e) { resolve(raw); return; }
      }
      resolve(raw || undefined);
    });
  });
}

var server = http.createServer(async function (req, res) {
  var parsed = url.parse(req.url, true);
  var pathname = parsed.pathname || '/';

  // Static fallback files.
  if (pathname.indexOf('/data/v1/') === 0) {
    var rel = pathname.replace('/data/v1/', '');
    var fp = path.join(DATA_ROOT, 'data', 'v1', rel.split('/').filter(function (p) { return p && p !== '..'; }).join('/'));
    fs.readFile(fp, function (err, data) {
      if (err) { res.statusCode = 404; res.end('not found'); return; }
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
      res.end(data);
    });
    return;
  }

  var fnFile = ROUTES[pathname];
  if (!fnFile) { res.statusCode = 404; res.end('no such route'); return; }

  var handler;
  try {
    if (FRESH) delete require.cache[require.resolve(fnFile)];
    handler = handlerCache.get(fnFile);
    if (!handler || FRESH) { handler = require(fnFile); handlerCache.set(fnFile, handler); }
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, harness_error: 'require failed: ' + String((e && e.message) || e) }));
    return;
  }

  req.query = parsed.query;
  req.body = await readBody(req);
  try {
    await handler(req, res);
    if (!res.writableEnded) res.end();
  } catch (e) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, harness_error: String((e && e.message) || e) }));
    }
  }
});

var PORT = parseInt(process.argv[2] || process.env.PORT || '0', 10);
server.listen(PORT, '127.0.0.1', function () {
  console.log('READY port=' + server.address().port);
  Object.keys(ROUTES).sort().forEach(function (r) { console.log('  route ' + r + ' -> ' + ROUTES[r]); });
});
