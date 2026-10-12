#!/usr/bin/env python3
"""Wave 5 — validate every api/v1 endpoint against its draft-07 schema.

Checks:
  - every endpoint file in api/v1 validates against api/v1/schema/*.json
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
API = os.path.join(ROOT, "api", "v1")
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

    sample = validate_doc("trends.flat.sample.json",
                          os.path.join(API, "trends.flat.sample.json"),
                          "trends-flat-sample.json")
    check("sample.sample-is-true", sample.get("sample") is True)

    validate_doc("hashtags.json", os.path.join(API, "hashtags.json"), "hashtags.json")
    vel = validate_doc("velocity.json", os.path.join(API, "velocity.json"), "velocity.json")
    check("velocity covers topics", set(vel.keys()) <= topic_ids,
          f"unknown ids: {sorted(set(vel.keys()) - topic_ids)[:3]}")

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

    # manifest self-consistency
    eps = manifest.get("endpoints", {})
    for key, e in eps.items():
        p = os.path.join(ROOT, e.get("path", ""))
        is_dir = e.get("path", "").endswith("/")
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
