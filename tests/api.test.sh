#!/usr/bin/env bash
# tests/api.test.sh — canonical API contract suite (fleet-commons
# api-contract-test pattern v1.0.0). Reconciles the seven drifted per-site
# copies (film, marvel, aster, trend, activity-vault, button-mash, creator).
#
# THE SPLIT: this file asserts the CONTRACT every envelope site shares —
# health, envelope schema, cron auth gates, static fallback, vercel.json
# lint, rate limiting. Payload-shape assertions (counts, field values,
# authorized cron runs against real sources) are site-specific and live in
# tests/site-checks.sh, sourced at section 3 with chk/JSON_OK/VAL/BASE/
# AUTH_HEADER in scope.
#
# Usage:
#   ./tests/api.test.sh                 # spawns tests/local-server.js, runs all
#   BASE=https://<preview>.vercel.app ./tests/api.test.sh   # against a live URL
# Deps: bash, curl, python3, node (local mode) only. Exit 0 iff all pass.
set -euo pipefail

# ============================ SITE CONFIG ============================
# Fill these in when adopting. Everything below is fleet-generic.
ROSTER_FUNCS="health trends velocity cron/wire"            # expected data.functions from /api/health (any order)
READ_ENDPOINTS="trends"                # GET endpoints: envelope + schema + cache, e.g. "models-status models-pricing"
READ_CACHE_S=600                 # expected s-maxage on READ_ENDPOINTS (health is always 60)
CRON_PATH="cron/wire"                     # e.g. "cron/watchtower" — auth-gate section runs when set
STATIC_FILES="trends.flat.json velocity.json"                  # files that must exist under /data/v1/, e.g. "models.json pricing.json"
RL_ENDPOINT=""                   # left unset on purpose: trend's public bucket (lib/ratelimit.js) is one shared 60/min bucket across trends/velocity, and the authed-cron payload section spends from it too — a 70-burst probe would be order-dependent, not a contract check. The 429 envelope itself is pinned by the unit suites.
RL_BURST=70                      # requests to fire at RL_ENDPOINT expecting a 429
# =====================================================================

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

pass=0; fail=0
chk() { # chk <name> <command...>
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then pass=$((pass+1)); echo "ok   $name";
  else fail=$((fail+1)); echo "FAIL $name"; fi
}

CRON_SECRET_TEST="test-secret-fleet-commons"

if [ -z "${BASE:-}" ]; then
  # Local mode: pick a free port, start the harness with a known CRON_SECRET.
  PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
  BASE="http://127.0.0.1:$PORT"
  PORT="$PORT" CRON_SECRET="$CRON_SECRET_TEST" node tests/local-server.js > /tmp/api-contract-test-server.log 2>&1 &
  SERVER_PID=$!
  trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
  for i in $(seq 1 50); do
    curl -sf -o /dev/null "$BASE/api/health" 2>/dev/null && break
    sleep 0.2
  done
  AUTH_HEADER="Authorization: Bearer $CRON_SECRET_TEST"
else
  # Remote mode (preview URL): the caller owns the server; use their secret if given.
  AUTH_HEADER="Authorization: Bearer ${CRON_SECRET:-}"
fi

VAL="python3 tests/validate_envelope.py"
JSON_OK='import json,sys; e=json.load(sys.stdin); assert e["ok"] is True, "ok!=true"; assert "request_id" in e["meta"], "no request_id"'

echo "== 1. health =="
chk "health 200" curl -sf "$BASE/api/health"
chk "health envelope ok" bash -c "curl -sf '$BASE/api/health' | python3 -c '$JSON_OK'"
chk "health schema" bash -c "curl -sf '$BASE/api/health' | $VAL"
chk "health functions == roster" bash -c "curl -sf '$BASE/api/health' | python3 -c \"
import json,sys; e=json.load(sys.stdin)
assert sorted(e['data']['functions']) == sorted('$ROSTER_FUNCS'.split()), e['data']['functions']\""
chk "health cache s-maxage=60" bash -c "curl -sf -D - -o /dev/null '$BASE/api/health' | grep -qi 'cache-control: public, s-maxage=60'"

echo "== 2. roster endpoints: envelope ok:true =="
for p in $READ_ENDPOINTS; do
  chk "envelope $p" bash -c "curl -sf '$BASE/api/$p' | python3 -c '$JSON_OK'"
  chk "schema $p" bash -c "curl -sf '$BASE/api/$p' | $VAL"
  chk "cache $p s-maxage=$READ_CACHE_S" bash -c "curl -sf -D - -o /dev/null '$BASE/api/$p' | grep -qi 'cache-control: public, s-maxage=$READ_CACHE_S'"
done

echo "== 3. site-specific payload checks =="
if [ -f tests/site-checks.sh ]; then
  # shellcheck disable=SC1091
  . tests/site-checks.sh
else
  echo "     (no tests/site-checks.sh — contract sections only)"
fi

if [ -n "$CRON_PATH" ]; then
  echo "== 4. cron auth gates =="
  chk "cron 401 no secret" bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '$BASE/api/$CRON_PATH')\" = 401 ]"
  chk "cron 401 no secret envelope" bash -c "curl -s '$BASE/api/$CRON_PATH' | python3 -c \"
import json,sys; e=json.load(sys.stdin); assert e['ok'] is False and e['error']['code']=='UNAUTHORIZED'\""
  chk "cron 401 bad secret" bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer wrong' '$BASE/api/$CRON_PATH')\" = 401 ]"
  chk "cron no-store" bash -c "curl -s -D - -o /dev/null '$BASE/api/$CRON_PATH' | grep -qi 'cache-control: no-store'"
fi

echo "== 5. static fallback present =="
for f in $STATIC_FILES; do
  chk "static /data/v1/$f" curl -sf "$BASE/data/v1/$f"
done
chk "static schema envelope.json" curl -sf "$BASE/data/v1/schema/envelope.json"

echo "== 6. vercel.json lint =="
chk "vercel.json valid json" python3 -c "import json; json.load(open('vercel.json'))"
chk "cron daily-or-slower (<=1)" python3 -c "
import json; v=json.load(open('vercel.json'))
assert len(v.get('crons',[]))<=1, v.get('crons')
for c in v.get('crons',[]):
    f=c['schedule'].split()
    assert f[0]!='*' and '*/' not in f[0] and '*/' not in f[1], c"
chk "functions: maxDuration only, no runtime key" python3 -c "
import json; v=json.load(open('vercel.json'))
assert all(e=={'maxDuration':10} for e in v['functions'].values()), v['functions']
assert 'runtime' not in json.dumps(v)"

if [ -n "$RL_ENDPOINT" ]; then
  echo "== 7. rate limiting (runs last: trips the bucket on purpose) =="
  chk "429 after bucket exhausted" bash -c "
codes=\$(for i in \$(seq 1 $RL_BURST); do curl -s -o /dev/null -w '%{http_code} ' '$BASE/api/$RL_ENDPOINT'; done)
echo \"\$codes\" | grep -q ' 429 '"
  chk "429 has envelope RATE_LIMITED" bash -c "
for i in \$(seq 1 $RL_BURST); do code=\$(curl -s -o /tmp/rl.json -w '%{http_code}' '$BASE/api/$RL_ENDPOINT'); [ \"\$code\" = 429 ] && break; done
[ \"\$code\" = 429 ] && python3 -c \"
import json; e=json.load(open('/tmp/rl.json')); assert e['ok'] is False and e['error']['code']=='RATE_LIMITED'\""
fi

echo
echo "pass=$pass fail=$fail"
[ "$fail" = 0 ]
