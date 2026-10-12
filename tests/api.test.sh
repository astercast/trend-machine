#!/usr/bin/env bash
# tests/api.test.sh — Wave A verification for "The Wire" (trend-machine).
# Spec §12.2: bash + curl + python3, no deps beyond those.
# Runs against a local function runtime or a preview URL:
#   PORT=3000 node /tmp/wire-harness/server.js &   # local runtime
#   BASE=http://localhost:3000 ./tests/api.test.sh
# or:
#   BASE=https://<preview>.vercel.app ./tests/api.test.sh
#
# Sections: 1 health · 2 roster envelopes · 3 envelope-schema validation ·
# 4 cron 401 gates · 5 authed cron (read-only without the PAT) ·
# 6 400 gates · 7 404 gate · 8 static fallback · 9 vercel.json cron-daily lint.
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"
CRON_SECRET="${CRON_SECRET:-test-secret-wire-wave-a}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VALIDATOR="$ROOT/../server-program/validate_envelope.py"

pass=0; fail=0
chk() { # chk <name> <command...>
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then pass=$((pass+1)); echo "ok   $name";
  else fail=$((fail+1)); echo "FAIL $name"; fi
}
chk_pipe() { # chk_pipe <name> <curl-url> <python-assert-script>
  local name="$1" url="$2" pyscript="$3"
  if curl -sf --max-time 25 "$url" | python3 -c "$pyscript" >/dev/null 2>&1; then
    pass=$((pass+1)); echo "ok   $name"
  else fail=$((fail+1)); echo "FAIL $name"; fi
}

echo "== target: $BASE =="

# pick a real topic id from the static velocity store for the ?topic_id= test
TOPIC_ID="$(python3 -c "
import json
v=json.load(open('$ROOT/api/v1/velocity.json'))
ks=[k for k in v if isinstance(v[k],list) and len(v[k])>=3]
print(ks[0] if ks else '')")"

# 1. health — 200, ok:true, functions list matches the §7 roster exactly
chk "health 200" curl -sf --max-time 15 "$BASE/api/health"
chk_pipe "health roster" "$BASE/api/health" "
import json,sys
e=json.load(sys.stdin)
assert e['ok'] is True
assert e['data']['functions']==['health','trends','forecasts','velocity','cron/wire'], e['data']['functions']
assert e['data']['status'] in ('ok','degraded')
"

# 2. every roster endpoint returns an ok:true envelope
chk_pipe "envelope trends" "$BASE/api/trends" "
import json,sys
e=json.load(sys.stdin)
assert e['ok'] is True and isinstance(e['data'],list) and len(e['data'])>0
t=e['data'][0]
for f in ('id','title','platforms','velocity','opportunity_score','first_seen','last_seen','sources'):
    assert f in t, f
"
chk_pipe "envelope trends?limit=5&platform=tiktok" "$BASE/api/trends?limit=5&platform=tiktok" "
import json,sys
e=json.load(sys.stdin)
assert e['ok'] is True and len(e['data'])<=5
assert all('tiktok' in [p.lower() for p in t['platforms']] for t in e['data'])
"
chk_pipe "envelope forecasts" "$BASE/api/forecasts" "
import json,sys
e=json.load(sys.stdin)
assert e['ok'] is True
d=e['data']
for f in ('peaking_48h','rising_fast','cooling_off','steady','projections','computed_from','counts'):
    assert f in d, f
"
chk_pipe "envelope velocity?topic_id=" "$BASE/api/velocity?topic_id=$TOPIC_ID" "
import json,sys
e=json.load(sys.stdin)
assert e['ok'] is True
assert e['data']['topic_id']=='$TOPIC_ID'
assert isinstance(e['data']['snapshots'],list) and len(e['data']['snapshots'])>=3
assert all(len(p)==3 for p in e['data']['snapshots'])
"

# 3. envelope schema validation (§1.10) via the shared validator
for p in health trends forecasts "velocity?topic_id=$TOPIC_ID"; do
  if curl -sf --max-time 25 "$BASE/api/$p" | python3 "$VALIDATOR" --root "$ROOT" >/dev/null 2>&1; then
    pass=$((pass+1)); echo "ok   schema $p"
  else fail=$((fail+1)); echo "FAIL schema $p"; fi
done

# 4. cron without secret → 401; cron with wrong secret → 401
chk "cron 401 no secret" bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 '$BASE/api/cron/wire')\" = 401 ]"
chk "cron 401 bad secret" bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H 'Authorization: Bearer wrong' '$BASE/api/cron/wire')\" = 401 ]"
chk "cron 401 envelope" python3 -c "
import json,urllib.request,urllib.error
try:
    urllib.request.urlopen('$BASE/api/cron/wire', timeout=15)
    raise SystemExit('expected 401')
except urllib.error.HTTPError as ex:
    assert ex.code==401, ex.code
    e=json.load(ex)
    assert e['ok'] is False and e['error']['code']=='UNAUTHORIZED'
"

# 5. cron WITH secret → 200 ok:true. No GITHUB_REPO_TOKEN locally, so the job
#    must degrade gracefully to read-only (computed, not persisted).
#    NOTE: the 60s duplicate-delivery cooldown (§4.3) means a re-run inside
#    the window returns {duplicate:true} — accept either the full result or
#    the honest duplicate response.
chk "cron authed 200 read-only" python3 -c "
import json,urllib.request
req=urllib.request.Request('$BASE/api/cron/wire', headers={'Authorization':'Bearer $CRON_SECRET'})
e=json.load(urllib.request.urlopen(req, timeout=90))
assert e['ok'] is True, e
d=e['data']
if d.get('duplicate'):
    assert d['note'].startswith('Duplicate delivery'), d
else:
    assert d['mode'].startswith('read-only'), d['mode']
    assert d['committed'] is False
    assert 'sources_ok' in d and 'trends_count' in d and d['trends_count']>0
    up={u['source']:u for u in e['meta']['upstream']}
    for s in ('gtrends-rss','hn-api','bluesky-api','mastodon-trends','news-rss','reddit-proxy','youtube-rss'):
        assert s in up, list(up)
"

# 6. bad input → 400 BAD_INPUT envelopes (curl WITHOUT -f: the body must
#    still be a valid envelope even on 4xx — §1.2)
chk "bad input limit=abc" python3 -c "
import json,urllib.request,urllib.error
try:
    urllib.request.urlopen('$BASE/api/trends?limit=abc', timeout=15)
    raise SystemExit('expected 400')
except urllib.error.HTTPError as ex:
    assert ex.code==400, ex.code
    e=json.load(ex)
    assert e['ok'] is False and e['error']['code']=='BAD_INPUT'
    assert any('limit' in f for f in e['error']['details']['fields'])
"
chk "bad input limit=999" python3 -c "
import json,urllib.request,urllib.error
try:
    urllib.request.urlopen('$BASE/api/trends?limit=999', timeout=15)
    raise SystemExit('expected 400')
except urllib.error.HTTPError as ex:
    assert ex.code==400, ex.code
    e=json.load(ex)
    assert e['ok'] is False and e['error']['code']=='BAD_INPUT'
"
chk "bad input velocity no topic_id" python3 -c "
import json,urllib.request,urllib.error
try:
    urllib.request.urlopen('$BASE/api/velocity', timeout=15)
    raise SystemExit('expected 400')
except urllib.error.HTTPError as ex:
    assert ex.code==400, ex.code
    e=json.load(ex)
    assert e['ok'] is False and e['error']['code']=='BAD_INPUT'
"

# 7. unknown topic → 404 NOT_FOUND envelope
chk "velocity unknown topic 404" python3 -c "
import json,urllib.request,urllib.error
try:
    urllib.request.urlopen('$BASE/api/velocity?topic_id=no-such-topic-xyz', timeout=15)
    raise SystemExit('expected 404')
except urllib.error.HTTPError as ex:
    assert ex.code==404, ex.code
    e=json.load(ex)
    assert e['ok'] is False and e['error']['code']=='NOT_FOUND'
"

# 8. static fallback present (the §3 coexistence gate — function AND static
#    file both return 200 on the same deploy)
chk "static fallback trends.flat.json" curl -sf --max-time 15 "$BASE/api/v1/trends.flat.json"
# 2026-10-12: the JSONP twin lives at static/v1/ (no static .js under api/);
# the public /api/v1 URL is preserved by the vercel.json rewrite.
chk "static fallback trends.flat.js (rewrite)" curl -sf --max-time 15 "$BASE/api/v1/trends.flat.js"
chk "static fallback forecasts.json" curl -sf --max-time 15 "$BASE/api/v1/forecasts.json"
chk "static fallback velocity.json" curl -sf --max-time 15 "$BASE/api/v1/velocity.json"
chk "static fallback envelope schema" curl -sf --max-time 15 "$BASE/api/v1/schema/envelope.json"

# 9. vercel.json lint: cron daily-or-slower (Hobby hard limit, §4.1);
#    buildCommand pins the repo's real build; functions runtime pinned.
chk "cron daily-or-slower" python3 -c "
import json
v=json.load(open('$ROOT/vercel.json'))
assert len(v.get('crons',[]))==1, 'exactly one cron job per site'
for c in v['crons']:
    f=c['schedule'].split()
    assert len(f)==5, c
    assert f[0]!='*' and '*/' not in f[0] and '*/' not in f[1], c
"
chk "vercel.json shape" python3 -c "
import json
v=json.load(open('$ROOT/vercel.json'))
assert v['outputDirectory']=='.'
assert 'build_site.py' in v['buildCommand'] and 'build_forecasts.js' in v['buildCommand']
assert v['installCommand']==\"echo 'no dependencies'\"
# explicit function paths (NOT the api/**/*.js glob): the glob would deploy
# api/v1/trends.flat.js (the static JSONP twin) as a serverless function
fns=v['functions']
assert set(fns)=={'api/health.js','api/trends.js','api/forecasts.js','api/velocity.js','api/cron/wire.js'}, fns
assert all(f=={'maxDuration':10} for f in fns.values()), fns  # 2026-10-12: entries need >=1 valid property (maxDuration 10 = Hobby limit); runtime key must NEVER be set for Node
assert v['cleanUrls'] is True and v['trailingSlash'] is False
"

echo "pass=$pass fail=$fail"
[ "$fail" = 0 ]
