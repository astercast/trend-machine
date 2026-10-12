#!/usr/bin/env bash
# ============================================================
# TREND MACHINE — resolution_night.sh (wave 19)
# The resolution-night runner. See RESOLUTION_NIGHT.md for the
# full runbook; this script is the runbook's executable half.
#
#   scripts/resolution_night.sh            # preview (safe any time)
#   scripts/resolution_night.sh --preview  # same, explicit
#   scripts/resolution_night.sh --run      # publish verdicts (gated)
#
# The gate is the whole point: --run REFUSES while the clock is
# before data/v1/forecast-accuracy.json's next_resolution_at.
# No forecast is ever graded early, by this script or by hand —
# the graders themselves (resolution-lib.js) also hold every
# entry pending until its own 48h horizon passes, so even a
# mistimed --run can only resolve entries that are actually due.
#
# --run sequence (order matters, RESOLUTION_NIGHT.md §2):
#   1. dry-run preview — the counts about to be published
#   2. check_resolutions.js — writes the verdicts into the ledger
#   3. build_forecasts.js — rebuilds forecasts.json +
#      forecast-accuracy.json from the resolved ledger; the
#      scorecard status flips "building history" -> "live" in
#      this step, once 10+ forecasts have resolved decisively
#   4. verification — counts reconcile, hit rate present iff live
#   5. validate_api.py — the payload must validate before anyone
#      calls the night done
# The script never commits or pushes. That stays a human call,
# made after the verification output below is read.
# ============================================================
set -u
cd "$(dirname "$0")/.." || exit 1

MODE="preview"
if [ "${1:-}" = "--run" ]; then MODE="run"; fi
if [ "${1:-}" != "" ] && [ "${1:-}" != "--run" ] && [ "${1:-}" != "--preview" ]; then
  echo "[resolution-night] unknown argument: $1 (use --preview or --run)" >&2
  exit 1
fi

DUE=$(python3 -c "
import json
print(json.load(open('data/v1/forecast-accuracy.json')).get('next_resolution_at') or '')
")
NOW=$(date -u +%FT%TZ)
echo "[resolution-night] now (UTC):        $NOW"
echo "[resolution-night] next verdicts due: ${DUE:-none pending}"

if [ "$MODE" = "preview" ]; then
  echo "[resolution-night] PREVIEW — dry run only, nothing will be written."
  node scripts/check_resolutions.js --dry-run
  node scripts/audit_batch2.js
  echo "[resolution-night] preview done. When the due time above has passed,"
  echo "[resolution-night] publish with: scripts/resolution_night.sh --run"
  exit 0
fi

# --run gate: never grade early --------------------------------
if [ -n "$DUE" ]; then
  python3 - "$DUE" <<'PYEOF'
import sys
from datetime import datetime, timezone
due = datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00"))
if datetime.now(timezone.utc) < due:
    print(f"[resolution-night] REFUSED: earliest verdicts are due {sys.argv[1]}; "
          "grading before the horizon is fabrication. Run --preview instead.")
    sys.exit(2)
PYEOF
  GATE=$?
  if [ $GATE -ne 0 ]; then exit $GATE; fi
fi

echo "[resolution-night] step 1/5 — dry-run preview (writes nothing)"
node scripts/check_resolutions.js --dry-run || exit 1

echo "[resolution-night] step 2/5 — writing verdicts into the ledger"
node scripts/check_resolutions.js || exit 1

echo "[resolution-night] step 3/5 — rebuilding forecasts + scorecard payload"
node scripts/build_forecasts.js || exit 1

echo "[resolution-night] step 4/5 — verifying the published scorecard"
python3 - <<'PYEOF' || exit 1
import json, sys
acc = json.load(open("data/v1/forecast-accuracy.json"))
c = acc["counts"]
total = c["pending"] + c["resolved"] + c["unverifiable"]
print(f"[resolution-night] status={acc['status']} recorded={c['recorded']} "
      f"pending={c['pending']} resolved={c['resolved']} "
      f"unverifiable={c['unverifiable']} hits={c['hits']} "
      f"hit_rate={acc['hit_rate']}")
ok = True
if total != c["recorded"]:
    print(f"[resolution-night] FAIL: counts do not reconcile "
          f"({c['pending']}+{c['resolved']}+{c['unverifiable']} != {c['recorded']})")
    ok = False
if acc["status"] == "live" and acc["hit_rate"] is None:
    print("[resolution-night] FAIL: status is live but hit_rate is null")
    ok = False
if acc["status"] == "building history" and c["resolved"] >= 10:
    print("[resolution-night] FAIL: 10+ decisive resolutions but status "
          "did not flip to live")
    ok = False
for r in acc["recent"]:
    if r["verdict"] not in ("hit", "miss", "unverifiable"):
        print(f"[resolution-night] FAIL: unknown verdict {r['verdict']!r}")
        ok = False
    if r.get("window_coverage_hours") is None:
        print(f"[resolution-night] FAIL: {r['topic_id']} verdict carries "
              "no window-coverage evidence")
        ok = False
sys.exit(0 if ok else 1)
PYEOF

echo "[resolution-night] step 5/5 — validating the API payload"
python3 scripts/validate_api.py || exit 1

echo "[resolution-night] DONE. Verdicts are in data/forecast_ledger.json and"
echo "[resolution-night] published in data/v1/forecast-accuracy.json."
echo "[resolution-night] Next due: $(python3 -c "
import json
print(json.load(open('data/v1/forecast-accuracy.json')).get('next_resolution_at'))")"
echo "[resolution-night] Remaining batches due the same morning reuse this"
echo "[resolution-night] exact command — the graders are idempotent, already-"
echo "[resolution-night] resolved entries are never re-graded. Commit + push"
echo "[resolution-night] only after reading the verification output above."
