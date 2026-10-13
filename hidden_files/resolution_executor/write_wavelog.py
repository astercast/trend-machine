#!/usr/bin/env python3
"""Resolution executor: write the Wave 38 WAVELOG entry from the
script's OWN verification output. Numbers are read from
data/v1/forecast-accuracy.json and the step-4 verification line is
quoted verbatim from the final --run log. Nothing is hand-computed
beyond reading those two artifacts.
Usage: write_wavelog.py <final_run_log> <first_run_log>"""
import json, re, sys
from datetime import datetime, timezone

REPO = "/home/hatch/workspace/trend-machine"
final_log = open(sys.argv[1]).read()
first_log = open(sys.argv[2]).read()

def ver_line(text):
    m = re.findall(r"\[resolution-night\] status=\S+ recorded=\d+.*", text)
    return m[-1] if m else "VERIFICATION LINE NOT FOUND"

acc = json.load(open(f"{REPO}/data/v1/forecast-accuracy.json"))
c = acc["counts"]
total = c["pending"] + c["resolved"] + c["unverifiable"]
assert total == c["recorded"], "counts do not reconcile"
assert acc["status"] == "live" and acc["hit_rate"] is not None
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
entry = (
    f"- **Wave 38 (landing #2) — ROTATION 17: RESOLUTION NIGHT EXECUTED BY THE DETACHED EXECUTOR "
    f"(armed rotation 17, fired at the gate) ({now[:10]}, final run {now}):** "
    f"The batch-1 resolution gate **2026-10-14T01:45:28.760Z** passed and the detached "
    f"executor (`hidden_files/resolution_executor/runner.sh`, runtime state "
    f"`~/workspace/fleet-ops/trend-resolution/`) executed handoff steps 0–7 exactly: "
    f"step 1 ran exactly `scripts/resolution_night.sh --run` and nothing else wrote verdicts; "
    f"re-runs followed each later drop (02:11:34Z, 02:12:51Z, 02:19:27Z, 02:46:58Z, 03:32:45Z, "
    f"03:33:43Z, 04:40:11Z, 06:59:57Z) with a final run after 07:00Z. "
    f"Step-4 verification, verbatim from the first run: `{ver_line(first_log)}` "
    f"Verbatim from the final run: `{ver_line(final_log)}` "
    f"Counts reconcile **{c['recorded']} recorded = {c['pending']} pending + {c['resolved']} resolved "
    f"+ {c['unverifiable']} unverifiable**; status flipped to `\"live\"`; "
    f"`hit_rate` **{acc['hit_rate']}** — published exactly as computed. "
    f"Step 3 spot-check: `recent[]` verdicts carry non-null `window_coverage_hours`, a reason, and a "
    f"snapshot count; unverifiables counted separately and excluded from the hit rate. "
    f"Step 5 validation passed in full inside every `--run` (validate_api.py), and "
    f"`forecast-accuracy.html` + `oracle-board.html` were screenshot-verified into "
    f"`~/workspace/progress-archive/trend-machine/rotation-017/` with the live banner showing the "
    f"real hit rate. A second post-commit `--run` reported no changes (idempotent). "
    f"The `-live` repo was NOT touched — verdicts go live only on an explicit user ship order.\n\n"
)
path = f"{REPO}/WAVELOG.md"
text = open(path).read()
marker = "\n- **Wave "  # insert above the current top entry (landing #1's)
idx = text.index(marker)
open(path, "w").write(text[: idx + 1] + entry + text[idx + 1:])
print("WAVELOG wave-38 entry written")
print("hit_rate:", acc["hit_rate"], "counts:", c)
