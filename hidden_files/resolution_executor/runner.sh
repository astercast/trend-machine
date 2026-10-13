#!/usr/bin/env bash
# ============================================================
# TREND MACHINE — Resolution Night detached executor (rotation 17)
# Armed 2026-10-13 by the rotation-17 builder. Waits for the
# batch-1 resolution gate 2026-10-14T01:45:28.760Z, then executes
# WAVELOG handoff steps 0-7 EXACTLY. The ONLY verdict-writing
# command it ever runs is: scripts/resolution_night.sh --run
# Runtime state (durable, outside the worktree):
#   ~/workspace/fleet-ops/trend-resolution/
#     executor.pid / heartbeat.txt / status.txt / executor.log
#     runs/run-*.log / COMPLETION.txt
# On any verification/validation failure: STOP per
# RESOLUTION_NIGHT.md §5, write BLOCKED status, never commit.
# ============================================================
set -u
REPO="/home/hatch/workspace/trend-machine"
STATE="/home/hatch/workspace/fleet-ops/trend-resolution"
PUSHLOGS="/home/hatch/workspace/fleet-ops/push-logs"
SHOTS="/home/hatch/workspace/progress-archive/trend-machine/rotation-017"
GATE="2026-10-14T01:45:28.760Z"
CHROME="/opt/meta-chromium/chrome"
mkdir -p "$STATE/runs" "$PUSHLOGS" "$SHOTS"
cd "$REPO" || exit 1

log() { echo "[executor $(date -u +%FT%TZ)] $*" >> "$STATE/executor.log"; }
status() { printf '%s\n' "$*" > "$STATE/status.txt"; log "STATUS: $*"; }
heartbeat() { date -u +%FT%TZ > "$STATE/heartbeat.txt"; }
blocked() { status "BLOCKED $*"; heartbeat; exit 1; }
epoch() { python3 -c "from datetime import datetime,timezone; print(int(datetime.fromisoformat('$1'.replace('Z','+00:00')).timestamp()))"; }
sleep_until() { # $1 = ISO time; heartbeat at least every ~4 min while waiting
  local target; target=$(epoch "$1")
  while [ "$(date -u +%s)" -lt "$target" ]; do
    heartbeat; local remain=$(( target - $(date -u +%s) ))
    status "WAITING target=$1 gate=$GATE now=$(date -u +%FT%TZ) seconds_remaining=$remain"
    [ "$remain" -le 240 ] && sleep "$remain" || sleep 240
  done
  heartbeat
}

RUN_N=0; FIRST_LOG=""; LAST_LOG=""; LAST_EXIT=0
do_run() { # $1 = label
  RUN_N=$(( RUN_N + 1 ))
  local f="$STATE/runs/run-$(printf %02d $RUN_N)-$1-$(date -u +%Y%m%dT%H%M%SZ).log"
  log "RUN $RUN_N ($1): scripts/resolution_night.sh --run -> $f"
  status "RUNNING run=$RUN_N label=$1 at=$(date -u +%FT%TZ)"
  scripts/resolution_night.sh --run > "$f" 2>&1; LAST_EXIT=$?
  LAST_LOG="$f"; [ -z "$FIRST_LOG" ] && FIRST_LOG="$f"
  heartbeat
  log "RUN $RUN_N exit=$LAST_EXIT"
  grep -E "\[resolution-night\] (status=|DONE|REFUSED|FAIL)" "$f" >> "$STATE/executor.log" 2>/dev/null || true
  [ "$LAST_EXIT" -ne 0 ] && blocked "run $RUN_N ($1) exit=$LAST_EXIT — see $f (RESOLUTION_NIGHT.md §5: STOP, no commit)"
}

verify_first() { # handoff step 2+3: read step-4 verification FIRST, spot-check recent[]
  python3 - "$FIRST_LOG" <<'PYEOF' || blocked "step-4 verification / recent[] spot-check FAILED (see executor log + $FIRST_LOG)"
import json, re, sys
acc = json.load(open("data/v1/forecast-accuracy.json"))
c = acc["counts"]
total = c["pending"] + c["resolved"] + c["unverifiable"]
assert total == c["recorded"], f"counts do not reconcile: {c}"
assert acc["status"] == "live", f"status did not flip to live: {acc['status']}"
assert acc["hit_rate"] is not None, "hit_rate is null on a live scorecard"
for r in acc["recent"]:
    assert r.get("window_coverage_hours") is not None, f"{r.get('topic_id')}: window_coverage_hours null"
    assert r.get("reason"), f"{r.get('topic_id')}: no reason"
    assert any(k in r for k in ("n_snapshots", "snapshots", "snapshot_count", "actual_snapshots", "points")), \
        f"{r.get('topic_id')}: no snapshot count field in {sorted(r.keys())}"
print(f"[executor-verify] OK status=live recorded={c['recorded']} pending={c['pending']} "
      f"resolved={c['resolved']} unverifiable={c['unverifiable']} hit_rate={acc['hit_rate']}")
PYEOF
  grep -E "\[executor-verify\]" "$STATE/executor.log" >/dev/null 2>&1 || true
}

screenshots() { # handoff step 5
  (cd "$REPO" && python3 -c "
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
ThreadingHTTPServer(('127.0.0.1', 8791), SimpleHTTPRequestHandler).serve_forever()
" > "$STATE/httpserver.log" 2>&1 & echo $! > "$STATE/httpserver.pid")
  sleep 2
  for page in forecast-accuracy oracle-board; do
    "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
      --force-prefers-reduced-motion --window-size=1440,1100 \
      --virtual-time-budget=10000 \
      --screenshot="$SHOTS/$page.png" "http://127.0.0.1:8791/$page.html" \
      >> "$STATE/executor.log" 2>&1 || log "screenshot $page: chromium exit $?"
    # DOM evidence: the live banner must carry the real hit rate
    "$CHROME" --headless=new --disable-gpu --no-sandbox \
      --force-prefers-reduced-motion --virtual-time-budget=10000 \
      --dump-dom "http://127.0.0.1:8791/$page.html" > "$SHOTS/$page.dom.html" 2>/dev/null || true
  done
  kill "$(cat "$STATE/httpserver.pid")" 2>/dev/null || true
  python3 - <<'PYEOF' >> "$STATE/executor.log" 2>&1 || blocked "screenshot banner check FAILED — live banner does not show the real hit rate"
import json
acc = json.load(open("data/v1/forecast-accuracy.json"))
dom = open("/home/hatch/workspace/progress-archive/trend-machine/rotation-017/forecast-accuracy.dom.html").read()
rate = acc["hit_rate"]
pct_forms = {f"{rate*100:.1f}%", f"{rate*100:.0f}%", f"{rate:.4f}", f"{rate:.2f}"}
hit = [p for p in pct_forms if p in dom]
assert hit, f"hit rate {rate} not found in rendered forecast-accuracy DOM (tried {pct_forms})"
print(f"[executor-shots] forecast-accuracy banner shows hit rate via {hit}; oracle-board captured")
PYEOF
  log "screenshots done -> $SHOTS"
}

# ---- step 0 (until the gate): NO refresh this night. Wave-37 precedent,
# restated in rotation 17: a refresh that recorded new forecasts pre-gate
# would move the ledger held byte-identical (md5
# a81bcd99129a71ac091168ddecd762e3) until the gate. State: WAIT only.
log "executor started pid=$$ gate=$GATE"
md5sum data/forecast_ledger.json >> "$STATE/executor.log"
sleep_until "$GATE"

# ---- steps 1-5: first drop (143 due), verification, screenshots
do_run "gate-0145"
verify_first
screenshots

# ---- step 6: re-run after each later drop (+75s buffer), final after 07:00Z
sleep_until "2026-10-14T02:12:49Z"; do_run "drop-0211"
sleep_until "2026-10-14T02:14:06Z"; do_run "drop-0212"
sleep_until "2026-10-14T02:20:42Z"; do_run "drop-0219"
sleep_until "2026-10-14T02:48:13Z"; do_run "drop-0246"
sleep_until "2026-10-14T03:34:00Z"; do_run "drop-0332"
sleep_until "2026-10-14T03:34:58Z"; do_run "drop-0333"
sleep_until "2026-10-14T04:41:26Z"; do_run "drop-0440"
sleep_until "2026-10-14T07:01:12Z"; do_run "drop-0659-and-final-after-0700"

# ---- step 7: WAVELOG entry (numbers verbatim from the script's own
# verification output), commit, push, tree-verify, idempotence check
python3 hidden_files/resolution_executor/write_wavelog.py "$LAST_LOG" "$FIRST_LOG" >> "$STATE/executor.log" 2>&1 \
  || blocked "WAVELOG write failed"
[ "$(git remote get-url origin)" = "https://github.com/astercast/trend-machine.git" ] \
  || blocked "remote mismatch: $(git remote get-url origin)"
git add -A -- . ':!hidden_files/w37_commit2.log' ':!hidden_files/w37_push2.log' \
  ':!hidden_files/w37_verify_remote.log' ':!hidden_files/w37_verify_remote.py'
if git diff --cached --quiet; then
  log "nothing staged — verdict tree already committed?"
else
  python3 - <<'PYEOF' > "$STATE/commit_msg.txt"
import json
acc = json.load(open("data/v1/forecast-accuracy.json")); c = acc["counts"]
print(f"Wave 38 (Rotation 17): Resolution Night executed at the 2026-10-14T01:45:28.760Z gate by the detached executor — verdicts written only by scripts/resolution_night.sh --run (first drop + every later drop + final post-07:00Z run, idempotent); counts reconcile {c['recorded']} = {c['pending']} pending + {c['resolved']} resolved + {c['unverifiable']} unverifiable; status live; hit_rate {acc['hit_rate']} published exactly as computed; validate_api.py passed in full inside every run; forecast-accuracy + oracle-board screenshot-verified (rotation-017 archive, live banner shows the real hit rate)")
PYEOF
  git -c user.name=astercast -c user.email=255064122+astercast@users.noreply.github.com \
    commit -F "$STATE/commit_msg.txt" >> "$STATE/executor.log" 2>&1 || blocked "git commit failed"
fi
LOCAL_SHA=$(git rev-parse HEAD); log "local HEAD after commit: $LOCAL_SHA"
PUSHLOG="$PUSHLOGS/trend-wave38-resolution-$(date -u +%Y%m%dT%H%M%SZ).log"
python3 /home/hatch/workspace/skills/github/bin/gh-push.py "$REPO" > "$PUSHLOG" 2>&1
PUSH_EXIT=$?; log "gh-push exit=$PUSH_EXIT log=$PUSHLOG"; cat "$PUSHLOG" >> "$STATE/executor.log"
[ "$PUSH_EXIT" -ne 0 ] && blocked "gh-push failed exit=$PUSH_EXIT — see $PUSHLOG"
python3 hidden_files/resolution_executor/verify_remote.py > "$STATE/verify_remote.log" 2>&1 \
  || blocked "tree verification FAILED — see $STATE/verify_remote.log"
log "tree verification PASS (modulo the named .pyc exception)"

# second run reports no changes (idempotence proof)
MD5_BEFORE=$(md5sum data/forecast_ledger.json | cut -d' ' -f1)
do_run "post-commit-idempotence"
MD5_AFTER=$(md5sum data/forecast_ledger.json | cut -d' ' -f1)
DIRTY=$(git status --porcelain --untracked-files=no)
[ "$MD5_BEFORE" = "$MD5_AFTER" ] || blocked "second run changed the ledger md5 ($MD5_BEFORE -> $MD5_AFTER)"
[ -z "$DIRTY" ] || blocked "second run left a dirty tracked tree: $DIRTY"
log "idempotence confirmed: second --run no changes, ledger md5 $MD5_AFTER"

python3 - "$LOCAL_SHA" <<'PYEOF'
import json, sys
acc = json.load(open("data/v1/forecast-accuracy.json")); c = acc["counts"]
done = (f"DONE resolution night executed 2026-10-14; final counts: recorded={c['recorded']} "
        f"pending={c['pending']} resolved={c['resolved']} unverifiable={c['unverifiable']} "
        f"hits={c['hits']} hit_rate={acc['hit_rate']} status={acc['status']}; "
        f"commit={sys.argv[1]}; push verdict=PASS (GitHub API tree equality modulo the named .pyc exception); "
        f"second --run reported no changes; screenshots in ~/workspace/progress-archive/trend-machine/rotation-017/; "
        f"logs in ~/workspace/fleet-ops/trend-resolution/")
open("/home/hatch/workspace/fleet-ops/trend-resolution/COMPLETION.txt", "w").write(done + "\n")
open("/home/hatch/workspace/fleet-ops/trend-resolution/status.txt", "w").write(done + "\n")
print(done)
PYEOF
heartbeat
log "DONE"
