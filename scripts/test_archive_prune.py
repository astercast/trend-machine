#!/usr/bin/env python3
"""trend-machine — wave 19: pinned-fixture tests for the resolution
archive pruning in pipeline/normalize.py snapshot_history().

The archive (data/velocity_archive.json) holds the velocity series of
topics that churned out of the store before their 48h forecast
horizon — the evidence their verdicts grade against. It must prune
exactly on the ledger's own retention, and never on a guess:

  - a series is dropped once the ledger holds no entry for its topic
    inside the 7-day window (mirrors build_forecasts.js
    MAX_LEDGER_AGE_D);
  - points older than the 14-day history window age out individually;
  - ledger unreadable -> keep everything (fail-safe: never lose
    grading evidence because a file failed to parse).

snapshot_history() reads/writes the module's HIST / ARCHIVE / LEDGER
paths, so the tests point all three at a temp directory. Real data
files are never touched.

Run: python3 scripts/test_archive_prune.py   (exit 0 = all pass)
"""
import datetime
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "..", "pipeline"))
import normalize  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    if cond:
        print(f"  ok: {name}")
    else:
        print(f"  FAIL: {name} {detail}")
        FAILS.append(name)


NOW = datetime.datetime.now(datetime.timezone.utc)


def iso(dt):
    return dt.isoformat()


def pts(*ages_h):
    """Velocity points at the given ages (hours before now)."""
    return [[iso(NOW - datetime.timedelta(hours=a)), 50, 50] for a in ages_h]


def run_case(ledger_entries, hist):
    """Run snapshot_history with every store path in a temp dir.

    ledger_entries=None writes no ledger file at all (unreadable case).
    topics={} means every history series has churned out of the store,
    so each one is a candidate for the archive and its pruning.
    Returns the archive dict as written.
    """
    tmp = tempfile.mkdtemp(prefix="tm-prune-")
    normalize.HIST = os.path.join(tmp, "velocity_history.json")
    normalize.ARCHIVE = os.path.join(tmp, "velocity_archive.json")
    normalize.LEDGER = os.path.join(tmp, "forecast_ledger.json")
    if ledger_entries is not None:
        with open(normalize.LEDGER, "w") as f:
            json.dump({"entries": ledger_entries}, f)
    normalize.snapshot_history({}, hist)
    with open(normalize.ARCHIVE) as f:
        return json.load(f)


def entry(topic_id, age_d):
    return {"topic_id": topic_id,
            "forecast_at": iso(NOW - datetime.timedelta(days=age_d))}


# --- fresh ledger entry: series kept, points intact -------------------------
arch = run_case([entry("keepme", 1)],
                {"keepme": pts(1, 2, 3)})
check("fresh ledger entry keeps the series",
      "keepme" in arch and len(arch["keepme"]) == 3,
      f"archive={ {k: len(v) for k, v in arch.items()} }")

# --- ledger entry aged past 7 days: series dropped --------------------------
arch = run_case([entry("dropme", 8)],
                {"dropme": pts(1, 2)})
check("ledger entry 8d old -> series pruned", "dropme" not in arch)

# --- no ledger entry at all: series dropped ---------------------------------
arch = run_case([entry("someone-else", 1)],
                {"nolegder": pts(1, 2)})
check("topic with no ledger entry -> series pruned", "nolegder" not in arch)

# --- mixed store: only the in-window topic survives -------------------------
arch = run_case([entry("keepme", 0), entry("dropme", 9)],
                {"keepme": pts(5), "dropme": pts(5), "nolegder": pts(5)})
check("mixed store prunes to exactly the in-window topic",
      sorted(arch) == ["keepme"], f"archive keys={sorted(arch)}")

# --- point-age prune: >14d points age out, the series survives --------------
arch = run_case([entry("oldpoints", 1)],
                {"oldpoints": pts(1, 24 * 15)})
check("point older than 14d ages out, recent point kept",
      "oldpoints" in arch and len(arch["oldpoints"]) == 1 and
      arch["oldpoints"][0][0] == iso(NOW - datetime.timedelta(hours=1)))

# --- fail-safe: ledger unreadable -> nothing is pruned -----------------------
arch = run_case(None, {"keepme": pts(1), "nolegder": pts(2)})
check("ledger unreadable -> fail-safe keeps every series",
      sorted(arch) == ["keepme", "nolegder"],
      f"archive keys={sorted(arch)}")

print(f"\n[test_archive_prune] {len(FAILS)} failures")
sys.exit(1 if FAILS else 0)
