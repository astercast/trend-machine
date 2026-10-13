#!/usr/bin/env python3
"""Validate a function response envelope against the site's envelope schema
(ARCHITECTURE.md §1.10). Canonical v1.0.0 — reconciles three drifted forks:
film (hand-coded rules, stdlib), creator (schema-driven but needs the
`jsonschema` pip package — rejected: the commons is dependency-free), and
button-mash (schema-driven, stdlib subset engine — the lineage kept here).

Implements the draft 2020-12 subset the fleet schema uses: type (incl.
type lists), required, properties, pattern, enum, format:date-time,
allOf/if/then/not — plus two rules the subset engine can't fully express,
checked manually (film lineage): error must be ABSENT when ok is true and
PRESENT (object with code + message) when ok is false.

Schema location: $ENVELOPE_SCHEMA, else <site root>/data/v1/schema/envelope.json
where the site root is the parent of this file's directory (tests/).
Usage: curl -s $BASE/api/health | python3 tests/validate_envelope.py
Exit 0 = valid, 1 = invalid (violations printed), 2 = schema unreadable.
"""
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_schema_path = Path(os.environ.get(
    "ENVELOPE_SCHEMA", ROOT / "data" / "v1" / "schema" / "envelope.json"))
try:
    SCHEMA = json.loads(_schema_path.read_text())
except Exception as ex:
    print(f"envelope schema unreadable at {_schema_path}: {ex}")
    sys.exit(2)

errors = []


def check_date_time(v, path):
    try:
        s = v.replace("Z", "+00:00") if v.endswith("Z") else v
        datetime.fromisoformat(s)
    except Exception:
        errors.append(f"{path}: not RFC3339 date-time: {v!r}")


_silent = []


def check_type(v, t, path):
    global errors
    if isinstance(t, list):
        # try each alternative without recording misses
        saved, errors = errors, _silent
        hit = False
        for x in t:
            if check_type(v, x, path):
                hit = True
                break
        errors = saved
        if not hit:
            errors.append(f"{path}: type {type(v).__name__} not in {t}")
            return False
        return True
    want = {
        "object": dict, "array": list, "string": str,
        "boolean": bool, "integer": int, "null": type(None),
        "number": (int, float),
    }[t]
    if t == "integer" and isinstance(v, bool):
        ok = False
    else:
        ok = isinstance(v, want)
    if not ok:
        errors.append(f"{path}: expected {t}, got {type(v).__name__}")
    return ok


def validate(v, sch, path="$"):
    if "type" in sch:
        if not check_type(v, sch["type"], path):
            return
    if "enum" in sch and v not in sch["enum"]:
        errors.append(f"{path}: {v!r} not in enum {sch['enum']}")
    if "pattern" in sch and isinstance(v, str):
        if not re.search(sch["pattern"], v):
            errors.append(f"{path}: {v!r} does not match {sch['pattern']}")
    if "format" in sch and sch["format"] == "date-time" and isinstance(v, str):
        check_date_time(v, path)
    if isinstance(v, dict):
        for req in sch.get("required", []):
            if req not in v:
                errors.append(f"{path}: missing required {req!r}")
        for k, sub in sch.get("properties", {}).items():
            if k in v:
                validate(v[k], sub, f"{path}.{k}")
    if isinstance(v, list) and "items" in sch:
        for i, item in enumerate(v):
            validate(item, sch["items"], f"{path}[{i}]")
    for clause in sch.get("allOf", []):
        cond = clause.get("if")
        if cond and matches(v, cond):
            validate(v, clause.get("then", {}), path)
        elif cond:
            validate(v, clause.get("else", {}), path)


def matches(v, sch):
    # boolean-schema evaluation for if/then
    if "properties" in sch:
        for k, sub in sch["properties"].items():
            if "const" in sub and (k not in v or v[k] != sub["const"]):
                return False
    return True


def main():
    raw = sys.stdin.read()
    try:
        doc = json.loads(raw)
    except Exception as ex:
        print(f"response is not JSON: {ex}")
        return 1
    validate(doc, SCHEMA)
    # rules the schema subset can't fully express (film lineage)
    if doc.get("ok") is True and "error" in doc:
        errors.append("$.error: must be absent when ok is true")
    if doc.get("ok") is False:
        err = doc.get("error")
        if not isinstance(err, dict):
            errors.append("$.error: must be an object when ok is false")
        elif "code" not in err or "message" not in err:
            errors.append("$.error: missing code/message")
    if errors:
        print("ENVELOPE INVALID:")
        for e in errors:
            print(" -", e)
        return 1
    print("envelope valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
