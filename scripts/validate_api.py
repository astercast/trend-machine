#!/usr/bin/env python3
"""Wave 5 — validate every api/v1 endpoint against its draft-07 schema.

Checks:
  - every endpoint file in api/v1 validates against data/v1/schema/*.json
  - all N topics in trends.json pass the trend schema (N/341 baseline)
  - manifest (index.json) is self-consistent: every listed path/schema exists
  - flat-feed <-> dossier consistency (ids, counts)
  - forecasts projections cover all topics

Exit 0 when everything validates, 1 otherwise.
"""
import json
import os
import sys

import jsonschema
from jsonschema import Draft7Validator

ROOT = os.path.join(os.path.dirname(__file__), "..")
API = os.path.join(ROOT, "data", "v1")
SCHEMA_DIR = os.path.join(API, "schema")

failures = []
passed = []


def check(name, cond, detail=""):
    if cond:
        passed.append(name)
    else:
        failures.append(f"{name} {detail}".strip())


def load(path):
    with open(path) as f:
        return json.load(f)


def validate_doc(name, doc_path, schema_name):
    schema = load(os.path.join(SCHEMA_DIR, schema_name))
    doc = load(doc_path)
    # resolve relative $refs (e.g. trends-flat.json#/definitions/...) from the schema dir
    resolver = jsonschema.RefResolver(
        base_uri="file://" + os.path.abspath(SCHEMA_DIR) + "/",
        referrer=schema,
    )
    v = Draft7Validator(schema, resolver=resolver)
    errs = sorted(v.iter_errors(doc), key=lambda e: list(e.path))
    check(f"schema:{name}", not errs,
          "; ".join(f"{'/'.join(map(str, e.path))}: {e.message[:120]}" for e in errs[:5]))
    return doc


def main():
    manifest = validate_doc("index.json", os.path.join(API, "index.json"), "index.json")

    trends_doc = validate_doc("trends.json", os.path.join(API, "trends.json"), "trends.json")
    topics = trends_doc.get("topics", [])
    check("trends.count>=1", len(topics) >= 1, f"count={len(topics)}")
    check("trends.count-matches", trends_doc.get("count") == len(topics),
          f"count field={trends_doc.get('count')} actual={len(topics)}")

    # per-topic validation -> the 341/341 baseline
    topic_schema = load(os.path.join(SCHEMA_DIR, "trend.json"))
    tv = Draft7Validator(topic_schema)
    bad = [t.get("id") for t in topics if list(tv.iter_errors(t))]
    check(f"topics {len(topics) - len(bad)}/{len(topics)} pass trend schema", not bad,
          f"bad ids: {bad[:5]}")

    flat = validate_doc("trends.flat.json", os.path.join(API, "trends.flat.json"), "trends-flat.json")
    check("flat.sample-is-false", flat.get("sample") is False)
    stale_ids = {t["id"] for t in topics if t.get("stale")}
    flat_stale = [t["id"] for t in flat.get("trends", []) if t["id"] in stale_ids]
    check("flat excludes stale", not flat_stale, f"stale in feed: {flat_stale[:3]}")
    flat_ids = {t["id"] for t in flat.get("trends", [])}
    topic_ids = {t["id"] for t in topics}
    check("flat ids subset of topics", flat_ids <= topic_ids,
          f"orphans: {sorted(flat_ids - topic_ids)[:3]}")
    opps = [t["opportunity_score"] for t in flat.get("trends", [])]
    check("flat sorted by opportunity desc", opps == sorted(opps, reverse=True))

    # wave 8: velocity_trend honesty contract — real data only, no fake lines
    vt_bad = []
    for t in flat.get("trends", []):
        vt = t.get("velocity_trend") or {}
        n, state, svg = vt.get("snapshots", -1), vt.get("state"), vt.get("sparkline_svg")
        if state == "ready":
            if not (n >= 3 and svg and "<svg" in svg and 'role="img"' in svg
                    and "<animate" not in svg):
                vt_bad.append(t["id"])
        elif state == "building":
            if not (n < 3 and svg is None):
                vt_bad.append(t["id"])
        else:
            vt_bad.append(t["id"])
    check("flat velocity_trend honest (ready>=3 w/ svg, building<3 w/o svg)",
          not vt_bad, f"bad ids: {vt_bad[:5]}")

    sample = validate_doc("trends.flat.sample.json",
                          os.path.join(API, "trends.flat.sample.json"),
                          "trends-flat-sample.json")
    check("sample.sample-is-true", sample.get("sample") is True)

    validate_doc("hashtags.json", os.path.join(API, "hashtags.json"), "hashtags.json")
    vel = validate_doc("velocity.json", os.path.join(API, "velocity.json"), "velocity.json")
    check("velocity covers topics", set(vel.keys()) <= topic_ids,
          f"unknown ids: {sorted(set(vel.keys()) - topic_ids)[:3]}")

    pv = validate_doc("platform-velocity.json",
                      os.path.join(API, "platform-velocity.json"),
                      "platform-velocity.json")
    check("platform-velocity ids subset of topics",
          set(pv.keys()) <= topic_ids,
          f"unknown ids: {sorted(set(pv.keys()) - topic_ids)[:3]}")
    flat_pts = [p for e in pv.values() for s in e.values() for p in s]
    check("platform-velocity points are [iso, vel]",
          all(isinstance(p, list) and len(p) == 2 and isinstance(p[0], str)
              and isinstance(p[1], int) for p in flat_pts))

    # wave 9: meme-formats.json — schema + consistency with topics
    mf_path = os.path.join(API, "meme-formats.json")
    if os.path.exists(mf_path):
        mf = validate_doc("meme-formats.json", mf_path, "meme-formats.json")
        mf_ids = {f["id"] for f in mf.get("families", [])}
        # every topic's format_family must reference a real family (or be null)
        bad_fam = [t["id"] for t in topics
                   if t.get("format_family") not in (None, *mf_ids)]
        check("topics' format_family references real families", not bad_fam,
              f"bad ids: {bad_fam[:5]}")
        # tracked_topics must be live topic ids that actually claim the family
        fam_of = {t["id"]: t.get("format_family") for t in topics}
        bad_link = []
        for f in mf.get("families", []):
            for tid in f.get("tracked_topics", []):
                if tid not in topic_ids or fam_of.get(tid) != f["id"]:
                    bad_link.append((f["id"], tid))
        check("meme-formats tracked_topics consistent with topics",
              not bad_link, f"bad links: {bad_link[:5]}")
        # verification flags stay honest: only the two enum values
        bad_ver = [f["id"] for f in mf.get("families", [])
                   if f.get("verification") not in ("verified", "single-source")]
        check("meme-formats verification flags honest", not bad_ver,
              f"bad ids: {bad_ver[:5]}")
        # flat feed carries format_family too
        bad_flat_fam = [t["id"] for t in flat.get("trends", [])
                        if t.get("format_family") != fam_of.get(t["id"])]
        check("flat feed format_family matches dossiers", not bad_flat_fam,
              f"bad ids: {bad_flat_fam[:5]}")
    else:
        print("[validate] meme-formats.json absent — not validated")

    # wave 14: seed-freshness.json — schema + consistency with seeded topics
    sf_path = os.path.join(API, "seed-freshness.json")
    if os.path.exists(sf_path):
        sf = validate_doc("seed-freshness.json", sf_path, "seed-freshness.json")
        sc = sf.get("counts", {})
        check("seed-freshness counts sum to seeds",
              sc.get("healthy", -1) + sc.get("stale-source", -1)
              + sc.get("stale-untracked", -1) + sc.get("flaky-warning", -1)
              == sc.get("seeds", -2) == len(sf.get("seeds", [])),
              f"counts={sc}")
        seeded_ids = {t["id"] for t in topics if t.get("seeded")}
        bad_sf = [s["id"] for s in sf.get("seeds", [])
                  if s["id"] not in seeded_ids]
        check("seed-freshness covers exactly the seeded topics",
              not bad_sf and len(sf.get("seeds", [])) == len(seeded_ids),
              f"bad ids: {bad_sf[:5]}")
        stale_ids = {s["id"] for s in sf.get("stale", [])}
        bad_stale = [s["id"] for s in sf.get("seeds", [])
                     if (s["verdict"].startswith("stale")) != (s["id"] in stale_ids)]
        check("seed-freshness stale list matches verdicts", not bad_stale,
              f"mismatches: {bad_stale[:5]}")
        check("seed-freshness verdicts honest enum",
              all(s["verdict"] in ("healthy", "stale-source", "stale-untracked",
                                   "flaky-warning") for s in sf.get("seeds", [])))
    else:
        print("[validate] seed-freshness.json absent (sweep not run) — not validated")

    # wave 9: forecast-accuracy rich-dashboard fields (additive, honest)
    fa_path2 = os.path.join(API, "forecast-accuracy.json")
    if os.path.exists(fa_path2):
        fa2 = load(fa_path2)
        c2 = fa2.get("counts", {})
        tl = fa2.get("upcoming_resolutions", [])
        check("upcoming_resolutions sums to pending",
              sum(r.get("pending", 0) for r in tl) == c2.get("pending", 0),
              f"timeline={sum(r.get('pending', 0) for r in tl)} pending={c2.get('pending')}")
        rp = fa2.get("recorded_per_day", [])
        check("recorded_per_day sums to recorded",
              sum(r.get("recorded", 0) for r in rp) == c2.get("recorded", 0),
              f"activity={sum(r.get('recorded', 0) for r in rp)} recorded={c2.get('recorded')}")
        bc = fa2.get("by_confidence", {})
        check("by_confidence levels honest",
              set(bc.keys()) <= {"high", "medium", "low"} and
              all(set(v.keys()) == {"resolved", "hits"} for v in bc.values()))

    fc_path = os.path.join(API, "forecasts.json")
    if os.path.exists(fc_path):
        fc = validate_doc("forecasts.json", fc_path, "forecasts.json")
        check("forecasts projections cover all topics",
              set(fc.get("projections", {}).keys()) == topic_ids,
              f"missing={len(topic_ids - set(fc.get('projections', {}).keys()))}")
        lists = (fc.get("peaking_48h", []) + fc.get("rising_fast", [])
                 + fc.get("cooling_off", []) + fc.get("steady", []))
        states_ok = all(
            (r["id"] in fc["projections"] and fc["projections"][r["id"]]["state"] == r["state"])
            for r in lists)
        check("forecast lists match projections", states_ok)
    else:
        print("[validate] forecasts.json absent (node step skipped) — not validated")

    fa_path = os.path.join(API, "forecast-accuracy.json")
    if os.path.exists(fa_path):
        fa = validate_doc("forecast-accuracy.json", fa_path, "forecast-accuracy.json")
        c = fa.get("counts", {})
        # wave 14: unverifiable is counted separately, never in the hit rate
        check("accuracy counts consistent",
              c.get("recorded", -1) == c.get("pending", -2) + c.get("resolved", -3)
              + c.get("unverifiable", 0)
              and c.get("hits", 999) <= c.get("resolved", -1),
              f"counts={c}")
        check("accuracy hit_rate honest",
              (c.get("resolved", 0) >= 10 and fa.get("hit_rate") is not None) or
              (c.get("resolved", 0) < 10 and fa.get("hit_rate") is None
               and fa.get("status") == "building history"),
              f"status={fa.get('status')} hit_rate={fa.get('hit_rate')} resolved={c.get('resolved')}")
        check("accuracy verdicts honest enum",
              all(r.get("verdict") in ("hit", "miss", "unverifiable")
                  for r in fa.get("recent", [])),
              "recent verdicts must be hit/miss/unverifiable")
        check("every resolution carries its evidence",
              all(isinstance(r.get("reason"), str) and r.get("reason")
                  and isinstance(r.get("n_actual_points"), int)
                  for r in fa.get("recent", [])),
              "recent entries must carry reason + n_actual_points")
        # wave 18: readiness + coverage evidence, computed from real data
        rd = fa.get("resolution_readiness", {})
        check("resolution readiness sums to pending",
              rd.get("pending", -1) == c.get("pending", -2)
              and rd.get("with_sufficient_data", -1)
              + rd.get("awaiting_data", -2) == rd.get("pending", -3),
              f"readiness={rd} pending={c.get('pending')}")
        check("next_resolution_at consistent with the queue",
              (c.get("pending", 0) == 0 and fa.get("next_resolution_at") is None)
              or (c.get("pending", 0) > 0
                  and isinstance(fa.get("next_resolution_at"), str)
                  and fa["next_resolution_at"][:10]
                  == (fa.get("upcoming_resolutions") or [{}])[0].get("date")),
              f"next={fa.get('next_resolution_at')} "
              f"upcoming={fa.get('upcoming_resolutions')}")
        check("resolution coverage evidence sane",
              all(r.get("window_coverage_hours") is None
                  or 0 <= r["window_coverage_hours"] <= 48
                  for r in fa.get("recent", [])),
              "coverage must be null (pre-wave-18) or within the 48h window")
    else:
        print("[validate] forecast-accuracy.json absent (node step skipped) — not validated")

    # manifest self-consistency
    # 2026-10-12: resolve vercel.json rewrites first — the manifest advertises
    # public URLs (e.g. /data/v1/trends.flat.js), which may rewrite to a file
    # living elsewhere (static/v1/trends.flat.js — no static .js under api/).
    rewrites = {}
    try:
        vcfg = json.load(open(os.path.join(ROOT, "vercel.json")))
        for r in vcfg.get("rewrites", []):
            src, dst = r.get("source", ""), r.get("destination", "")
            if src.startswith("/") and dst.startswith("/"):
                rewrites[src.lstrip("/")] = dst.lstrip("/")
    except (OSError, ValueError):
        pass
    eps = manifest.get("endpoints", {})
    for key, e in eps.items():
        mpath = e.get("path", "")
        mpath = rewrites.get(mpath, mpath)
        p = os.path.join(ROOT, mpath)
        is_dir = mpath.endswith("/")
        check(f"manifest[{key}].path exists",
              os.path.isdir(p) if is_dir else os.path.isfile(p), e.get("path", ""))
        s = e.get("schema")
        if s:
            check(f"manifest[{key}].schema exists",
                  os.path.isfile(os.path.join(ROOT, s)), s)
        check(f"manifest[{key}].updated present", bool(e.get("updated")))

    print(f"[validate] {len(passed)} checks passed, {len(failures)} failed")
    for f_ in failures:
        print("  FAIL:", f_)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
