#!/usr/bin/env python3
"""trend-machine — wave 14: seed freshness sweep.

Checks every seeded topic for staleness and marks honestly:
  - source liveness: each named source URL probed (HEAD, fallback GET).
      2xx/3xx = live; 404/410 = dead; anything else = flaky (warning only).
  - corroboration: topic present in data/trends.json, not marked stale,
      last_seen within FRESH_DAYS.
  - tracking: the seed has a velocity_history.json series (the pipeline
      snapshots every store topic each run). A seed added hours ago with
      <3 snapshots is "warming up", not stale; only a seed whose first
      snapshot is >6h old with <3 points has broken tracking.

Verdicts:
  healthy        — sources live, corroborated, tracked
  stale-source   — at least one source URL dead (404/410). The honest fix is
                   to replace the dead source (wave 5 set the precedent:
                   LatestLY 410 -> Wikipedia), never to silently drop it.
  stale-untracked — seed missing from the store or with <3 velocity
                   snapshots: it never landed or stopped tracking.
  flaky-warning  — a source timed out / errored on probe: not marked stale,
                   retried on the next sweep. Timeouts are network weather,
                   not evidence of death.

Output: console report + data/seed_freshness.json +
        api/v1/seed-freshness.json (the public endpoint; described in the
        API manifest by scripts/build_site.py).

Run: python3 scripts/seed_freshness.py [--offline]
  --offline: skip network probes (report tracking/corroboration only).
Exit 0 = 0 stale, 2 = one or more stale seeds (printed above).
"""
import json
import os
import sys
import urllib.request
import datetime

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
STORE = os.path.join(ROOT, "data", "trends.json")
HIST = os.path.join(ROOT, "data", "velocity_history.json")
OUT_DATA = os.path.join(ROOT, "data", "seed_freshness.json")
OUT_API = os.path.join(ROOT, "api", "v1", "seed-freshness.json")

FRESH_DAYS = 7
PROBE_TIMEOUT_S = 12
OFFLINE = "--offline" in sys.argv


def probe(url):
    """Return (status, note). Never raises.

    bsky.app (and others) reject HEAD with 404/405 while GET returns 200 —
    so a HEAD failure NEVER judges the URL; only a GET 404/410 marks it
    dead. Server errors and timeouts are flaky (network weather, retry next
    sweep), never evidence of death.
    """
    last = None
    for method in ("HEAD", "GET"):
        try:
            req = urllib.request.Request(url, method=method,
                                         headers={"User-Agent": "trend-machine-freshness/1.0"})
            with urllib.request.urlopen(req, timeout=PROBE_TIMEOUT_S) as r:
                code = r.status
                if 200 <= code < 400:
                    return ("live", f"{code} {method}")
                last = f"{code} {method}"
                if method == "GET":
                    return ("dead" if code in (404, 410) else "flaky", last)
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code} {method}"
            if method == "GET":
                return ("dead" if e.code in (404, 410) else "flaky", last)
            # HEAD failed: fall through to GET (the real user experience)
        except Exception as e:
            last = f"{type(e).__name__} {method}: {e}"
            if method == "GET":
                return ("flaky", last)
            # HEAD exception: fall through to GET
    return ("flaky", last or "no response")


def load_json(path, fallback):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return fallback


def age_days(iso):
    try:
        dt = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return (datetime.datetime.now(datetime.timezone.utc) - dt).total_seconds() / 86400.0
    except Exception:
        return None


def main():
    store = load_json(STORE, {"topics": []})
    hist = load_json(HIST, {})
    topics = {t["id"]: t for t in store.get("topics", [])}
    seeds = [t for t in store.get("topics", []) if t.get("seeded")]

    results = []
    counts = {"healthy": 0, "stale-source": 0, "stale-untracked": 0, "flaky-warning": 0}
    for s in sorted(seeds, key=lambda t: t["id"]):
        sid = s["id"]
        t = topics.get(sid)
        sources = s.get("sources", []) or []
        src_results = []
        dead = 0
        flaky = 0
        if OFFLINE:
            src_results = [{"name": x.get("name"), "url": x.get("url"),
                            "status": "not-probed", "note": "--offline mode"} for x in sources]
        else:
            for x in sources:
                status, note = probe(x.get("url", ""))
                src_results.append({"name": x.get("name"), "url": x.get("url"),
                                    "status": status, "note": note})
                if status == "dead":
                    dead += 1
                elif status == "flaky":
                    flaky += 1
        last_seen = s.get("last_seen")
        age = age_days(last_seen) if last_seen else None
        corroborated = (t is not None and not t.get("stale")
                        and age is not None and age <= FRESH_DAYS)
        series = hist.get(sid, [])
        snaps = len(series)
        # wave 14 honesty fix: a seed added hours ago CANNOT have 3 hourly
        # snapshots yet — that is warming up, not stale. Only a seed whose
        # first snapshot is >6h old but still has <3 points has broken
        # tracking; 0 snapshots at all means the pipeline isn't tracking it.
        first_snap_age_h = None
        if series:
            try:
                dt = datetime.datetime.fromisoformat(
                    series[0][0].replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=datetime.timezone.utc)
                first_snap_age_h = (datetime.datetime.now(
                    datetime.timezone.utc) - dt).total_seconds() / 3600.0
            except Exception:
                first_snap_age_h = None
        in_store = t is not None

        if snaps == 0:
            verdict = "stale-untracked"
            reason = "no velocity snapshots at all — the pipeline is not tracking this seed"
        elif snaps < 3 and (first_snap_age_h is None or first_snap_age_h > 6):
            verdict = "stale-untracked"
            reason = (f"only {snaps} velocity snapshots over "
                      f"{round(first_snap_age_h, 1) if first_snap_age_h else '?'}h — tracking broken")
        elif dead:
            verdict = "stale-source"
            reason = f"{dead} dead source URL(s)"
        elif flaky:
            verdict = "flaky-warning"
            reason = f"{flaky} source URL(s) timed out on probe — retry next sweep, not marked stale"
        else:
            verdict = "healthy"
            reason = ("sources live, corroborated, tracked" if snaps >= 3 else
                      f"sources live, warming up ({snaps} snapshots, "
                      f"first {round(first_snap_age_h, 1)}h ago)")
        counts[verdict] += 1
        results.append({
            "id": sid, "title": s.get("title"),
            "verification": s.get("verification"),
            "verdict": verdict, "reason": reason,
            "sources": src_results,
            "last_seen": last_seen, "last_seen_age_days": round(age, 2) if age is not None else None,
            "velocity_snapshots": snaps, "in_store": in_store,
        })

    stale = [r for r in results if r["verdict"].startswith("stale")]
    payload = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "method": ("Every seeded topic probed: source URL liveness "
                   + ("(skipped — offline mode)" if OFFLINE else "(HTTP HEAD, GET fallback; only a GET 404/410 marks dead)") +
                   ", store corroboration (last_seen <= 7d), velocity tracking (series present; "
                   "a seed with <3 snapshots but a first snapshot <6h old is warming up, not stale). "
                   "stale-source = dead URL (GET 404/410), never a timeout or HEAD rejection; "
                   "timeouts are flaky-warning."),
        "counts": dict(counts, seeds=len(results)),
        "stale": [{"id": r["id"], "title": r["title"], "verdict": r["verdict"],
                   "reason": r["reason"]} for r in stale],
        "seeds": results,
    }
    os.makedirs(os.path.dirname(OUT_DATA), exist_ok=True)
    with open(OUT_DATA, "w") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    os.makedirs(os.path.dirname(OUT_API), exist_ok=True)
    with open(OUT_API, "w") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"[seed-freshness] {'offline' if OFFLINE else 'live-probe'}: "
          f"{len(results)} seeds — " + ", ".join(f"{k}={v}" for k, v in counts.items()))
    for r in stale:
        print(f"  STALE [{r['verdict']}] {r['id']}: {r['reason']}")
    for r in results:
        if r["verdict"] == "flaky-warning":
            print(f"  FLAKY {r['id']}: {r['reason']}")
    print(f"[seed-freshness] -> {OUT_DATA}, {OUT_API}")
    return 0 if not stale else 2


if __name__ == "__main__":
    sys.exit(main())
