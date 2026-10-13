# tests/site-checks.sh — trend-machine payload checks (FC-001 adoption of
# the Fleet Commons api-contract-test pattern, 2026-10-13).
# Sourced by tests/api.test.sh at its section 3 with chk / JSON_OK / VAL /
# BASE / AUTH_HEADER in scope. Everything the old hand-rolled suite asserted
# about THIS site's payloads lives here, unchanged in substance; the shared
# contract (health, envelopes, cron gates, static fallback, vercel lint)
# stays in api.test.sh. The one adaptation: the old suite fetched the JSONP
# twin over HTTP via the Vercel rewrite — the canonical local runtime does
# not emulate rewrites, so that check now pins the file + the rewrite entry
# directly (the rewrite itself is Vercel-platform behavior).

# pick a real topic id from the static velocity store for the ?topic_id= test
TOPIC_ID="$(python3 -c "
import json
v=json.load(open('data/v1/velocity.json'))
ks=[k for k in v if isinstance(v[k],list) and len(v[k])>=3]
print(ks[0] if ks else '')")"

chk "health status ok/degraded" bash -c "curl -sf --max-time 15 '$BASE/api/health' | python3 -c \"
import json,sys; e=json.load(sys.stdin)
assert e['data']['status'] in ('ok','degraded'), e['data']['status']\""

chk "payload trends fields" bash -c "curl -sf --max-time 25 '$BASE/api/trends' | python3 -c \"
import json,sys; e=json.load(sys.stdin)
assert e['ok'] is True and isinstance(e['data'],list) and len(e['data'])>0
t=e['data'][0]
for f in ('id','title','platforms','velocity','opportunity_score','first_seen','last_seen','sources'):
    assert f in t, f\""
chk "payload trends?limit=5&platform=tiktok" bash -c "curl -sf --max-time 25 '$BASE/api/trends?limit=5&platform=tiktok' | python3 -c \"
import json,sys; e=json.load(sys.stdin)
assert e['ok'] is True and len(e['data'])<=5
assert all('tiktok' in [p.lower() for p in t['platforms']] for t in e['data'])\""
chk "payload forecasts fields" bash -c "curl -sf --max-time 25 '$BASE/api/forecasts' | python3 -c \"
import json,sys; e=json.load(sys.stdin)
assert e['ok'] is True
d=e['data']
for f in ('peaking_48h','rising_fast','cooling_off','steady','projections','computed_from','counts'):
    assert f in d, f\""
chk "payload velocity?topic_id=" bash -c "curl -sf --max-time 25 '$BASE/api/velocity?topic_id=$TOPIC_ID' | python3 -c \"
import json,sys; e=json.load(sys.stdin)
assert e['ok'] is True
assert e['data']['topic_id']=='$TOPIC_ID'
assert isinstance(e['data']['snapshots'],list) and len(e['data']['snapshots'])>=3
assert all(len(p)==3 for p in e['data']['snapshots'])\""
chk "schema velocity?topic_id=" bash -c "curl -sf --max-time 25 '$BASE/api/velocity?topic_id=$TOPIC_ID' | $VAL"

# authed cron: 200 ok:true. No GITHUB_REPO_TOKEN locally, so the job must
# degrade gracefully to read-only (computed, not persisted). The 60s
# duplicate-delivery cooldown means a re-run inside the window returns
# {duplicate:true} — accept either. Skipped when no secret is available
# (remote mode without CRON_SECRET): the gates are section 4's job.
case "${AUTH_HEADER:-}" in
  ""|"Authorization: Bearer "|Authorization:\ Bearer\ )
    echo "     (authed cron payload check skipped — no cron secret in scope)" ;;
  *)
    chk "cron authed 200 read-only" bash -c "curl -sf --max-time 90 -H '$AUTH_HEADER' '$BASE/api/cron/wire' | python3 -c \"
import json,sys; e=json.load(sys.stdin)
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
        assert s in up, list(up)\"" ;;
esac

# bad input → 400 BAD_INPUT envelopes (the body must still be a valid
# envelope on 4xx)
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

# unknown topic → 404 NOT_FOUND envelope
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

# JSONP twin: file at static/v1/ + the vercel.json rewrite preserving its
# public /api/v1 URL (see the header note — no HTTP fetch in local mode)
chk "static JSONP twin file + rewrite" python3 -c "
import json
assert open('static/v1/trends.flat.js').read(20).startswith('trendsCallback(')
v=json.load(open('vercel.json'))
rw={(r['source'],r['destination']) for r in v.get('rewrites',[])}
assert ('/api/v1/trends.flat.js','/static/v1/trends.flat.js') in rw, rw
"

# vercel.json site shape (beyond the canonical lint): build pins + the
# explicit function roster (the map is not an allowlist — every .js under
# api/ deploys, so the roster must stay exactly these five)
chk "vercel.json site shape" python3 -c "
import json
v=json.load(open('vercel.json'))
assert v['outputDirectory']=='.'
assert 'build_site.py' in v['buildCommand'] and 'build_forecasts.js' in v['buildCommand']
assert v['installCommand']==\"echo 'no dependencies'\"
fns=v['functions']
assert set(fns)=={'api/health.js','api/trends.js','api/forecasts.js','api/velocity.js','api/cron/wire.js'}, fns
assert v['cleanUrls'] is True and v['trailingSlash'] is False
assert len(v.get('crons',[]))==1, 'exactly one cron job per site'
"
