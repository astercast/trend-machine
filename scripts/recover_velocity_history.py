#!/usr/bin/env python3
"""Wave 18 — recover resolution evidence deleted before the archive existed.

Before wave 18, pipeline/normalize.py deleted a topic's velocity series
when the topic churned out of the store. 112 of the 286 forecasts awaiting
their first resolution on 2026-10-14 had already lost their series that
way and could only ever have graded "unverifiable" — not because the
snapshots never existed, but because a later refresh threw them away.

The snapshots were committed, though: every refresh lands in git. This
script restores them from the repo's own history into
data/velocity_archive.json (the archive normalize.py now maintains),
where the graders merge them back in (resolution-lib.js mergeHistory).

Honesty rules:
  - Only points that were actually recorded and committed are restored;
    every restored point keeps its original timestamp and values.
  - Provenance is printed per topic: source commit + point count.
  - Only topics with unresolved ledger entries are recovered — this is
    resolution evidence, not a general history rewrite.
  - Idempotent: buckets already in the live store or the archive are
    never overwritten. Run with --dry-run to report without writing.
"""
import datetime
import json
import os
import subprocess
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
HIST = os.path.join(ROOT, "data", "velocity_history.json")
ARCHIVE = os.path.join(ROOT, "data", "velocity_archive.json")
LEDGER = os.path.join(ROOT, "data", "forecast_ledger.json")
HIST_REL = "data/velocity_history.json"
HORIZON_H = 48


def load(path, fallback):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return fallback


def parse(s):
    dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)


def in_window_points(entry, series):
    fa = parse(entry["forecast_at"])
    end = fa + datetime.timedelta(hours=HORIZON_H)
    return [p for p in series if fa < parse(p[0]) <= end]


def committed_versions():
    """Yield (commit, {topic_id: [points]}) newest commit first."""
    out = subprocess.run(
        ["git", "log", "--format=%H", "--", HIST_REL],
        cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    for commit in out:
        show = subprocess.run(
            ["git", "show", f"{commit}:{HIST_REL}"],
            cwd=ROOT, capture_output=True, text=True)
        if show.returncode != 0:
            continue
        try:
            yield commit, json.loads(show.stdout)
        except Exception:
            continue


def main():
    dry = "--dry-run" in sys.argv
    ledger = load(LEDGER, {"entries": []})
    hist = load(HIST, {})
    archive = load(ARCHIVE, {})
    pending = [e for e in ledger.get("entries", []) if not e.get("resolved")]
    targets = sorted({e["topic_id"] for e in pending})
    by_topic_entries = {}
    for e in pending:
        by_topic_entries.setdefault(e["topic_id"], []).append(e)

    def window_count(tid, series):
        return sum(len(in_window_points(e, series)) for e in by_topic_entries[tid])

    def merged_series(tid):
        by_hour = {p[0][:13]: p for p in archive.get(tid) or []}
        for p in hist.get(tid) or []:
            by_hour[p[0][:13]] = p
        return sorted(by_hour.values(), key=lambda p: p[0])

    before = {tid: window_count(tid, merged_series(tid)) for tid in targets}
    need = [tid for tid in targets
            if any(len(in_window_points(e, merged_series(tid))) < 2
                   for e in by_topic_entries[tid])]
    print(f"[recover] pending topics: {len(targets)}; "
          f"with a forecast window holding <2 points: {len(need)}")
    if not need:
        print("[recover] nothing to recover — every pending window already "
              "holds 2+ points across live history + archive.")
        return 0

    # newest commit wins per hour bucket (the pipeline's own bucketing)
    recovered = {}   # tid -> {hour: point}
    provenance = {}  # tid -> first (newest) commit that held the series
    remaining = set(need)
    for commit, version in committed_versions():
        if not remaining:
            break
        for tid in list(remaining):
            series = version.get(tid)
            if not series:
                continue
            provenance.setdefault(tid, commit[:9])
            slots = recovered.setdefault(tid, {})
            for p in series:
                slots.setdefault(p[0][:13], p)
            have = sorted(slots.values(), key=lambda p: p[0])
            if all(len(in_window_points(e, have)) >= 2
                   for e in by_topic_entries[tid]):
                remaining.discard(tid)
    restored_topics = 0
    restored_points = 0
    for tid in sorted(recovered):
        slots = {p[0][:13]: p for p in archive.get(tid) or []}
        live_hours = {p[0][:13] for p in hist.get(tid) or []}
        added = 0
        for hour, p in recovered[tid].items():
            if hour not in slots and hour not in live_hours:
                slots[hour] = p
                added += 1
        if added:
            # in-memory in both modes (only the file write is gated on
            # --dry-run), so merged_series() reflects the recovery here
            archive[tid] = sorted(slots.values(), key=lambda p: p[0])
            restored_topics += 1
            restored_points += added
            print(f"[recover] {tid}: +{added} points from commit "
                  f"{provenance.get(tid, '?')} — window points "
                  f"{before[tid]} -> {window_count(tid, merged_series(tid))}")
    still_short = [tid for tid in need
                   if any(len(in_window_points(e, merged_series(tid))) < 2
                          for e in by_topic_entries[tid])]
    if dry:
        print(f"[recover] DRY RUN — would restore {restored_points} points "
              f"for {restored_topics} topics; wrote nothing.")
    else:
        with open(ARCHIVE, "w") as f:
            json.dump(archive, f, ensure_ascii=False, separators=(",", ":"))
        print(f"[recover] wrote {ARCHIVE}: {restored_points} points restored "
              f"for {restored_topics} topics.")
    if still_short:
        print(f"[recover] still short (<2 window points after recovery): "
              f"{len(still_short)} topics — these will honestly grade "
              f"unverifiable if no new snapshots land: "
              f"{', '.join(still_short[:10])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
