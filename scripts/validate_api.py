#!/usr/bin/env python3
"""Wave 5 — validate every api/v1 endpoint against its draft-07 schema.

Checks:
  - every endpoint file in api/v1 validates against data/v1/schema/*.json
  - all N topics in trends.json pass the trend schema (N/341 baseline)
  - manifest (index.json) is self-consistent: every listed path/schema exists
  - flat-feed <-> dossier consistency (ids, counts)

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

    # wave 28: live-wire.json — schema + lane/mover honesty vs stored outputs
    lw_path = os.path.join(API, "live-wire.json")
    if os.path.exists(lw_path):
        lw = validate_doc("live-wire.json", lw_path, "live-wire.json")
        lc = lw.get("counts", {})
        lanes = lw.get("lanes", [])
        check("live-wire lane totals reconcile",
              lc.get("lanes", -1) == len(lanes)
              and lc.get("lanes_live", -1) + lc.get("lanes_degraded", -2)
              + lc.get("lanes_stale_skip", -3)
              + lc.get("lanes_skip_by_design", -4)
              + lc.get("lanes_retired", -6) == lc.get("lanes", -5),
              f"counts={lc} lanes={len(lanes)}")
        check("live-wire retired lane claims nothing (DATAOPS-001)",
              all(l.get("hits", -1) == 0 and l.get("current_hits", -1) == 0
                  and l.get("output_file") is None
                  for l in lanes if l.get("status") == "retired")
              and {l.get("id") for l in lanes
                   if l.get("status") == "retired"} == {"youtube"}
              and not os.path.exists(os.path.join(
                  ROOT, "pipeline", "out", "youtube.json")),
              "exactly the youtube lane is retired, with 0 hits, no "
              "output file, and its stale stored file deleted")
        check("live-wire current hits sum only live lanes",
              lc.get("current_hits", -1)
              == sum(l.get("current_hits", 0) for l in lanes)
              and all(l.get("current_hits", 0) == l.get("hits", -1)
                      for l in lanes if l.get("status") == "live")
              and all(l.get("current_hits", -1) == 0
                      for l in lanes if l.get("status") != "live"),
              "current_hits must equal the live lanes' hits; every other lane contributes 0")
        check("live-wire stale hits excluded + dated",
              lc.get("stale_hits_excluded", -1)
              == sum(l.get("hits", 0) for l in lanes
                     if l.get("status") == "stale-skip")
              and all(l.get("newest_fetched_at")
                      for l in lanes if l.get("status") == "stale-skip"),
              "stale-skip hits are summed apart and every stale lane carries its newest stamp")
        check("live-wire skip-by-design lanes claim nothing",
              all(l.get("hits", -1) == 0 and l.get("output_file") is None
                  for l in lanes if l.get("status") == "skip-by-design")
              and {l.get("id") for l in lanes
                   if l.get("status") == "skip-by-design"} == {"tiktok", "x"},
              "exactly tiktok + x skip by design, with 0 hits and no output file")
        check("live-wire lane hit counts match pipeline/out files",
              all(l.get("hits", -1) == len(load(os.path.join(
                      ROOT, "pipeline", "out",
                      os.path.basename(l["output_file"]))))
                  for l in lanes if l.get("output_file")),
              "every file lane's hits must equal its stored file's length")
        mv = lw.get("movers", {})
        gains = mv.get("gainers", [])
        falls = mv.get("fallers", [])
        check("live-wire movers honest deltas + spans",
              all(m.get("delta", 0) > 0
                  and m.get("delta") == m.get("to_velocity", 0)
                  - m.get("from_velocity", 0)
                  and 0.5 <= m.get("span_hours", 0) <= 3
                  for m in gains)
              and all(m.get("delta", 0) < 0
                      and m.get("delta") == m.get("to_velocity", 0)
                      - m.get("from_velocity", 0)
                      and 0.5 <= m.get("span_hours", 0) <= 3
                      for m in falls)
              and len(gains) <= 10 and len(falls) <= 10,
              "gainers delta>0, fallers delta<0, delta = to - from, span within 0.5-3h, top-10 caps")
        check("live-wire mover counts reconcile",
              lc.get("gainers", -1) >= len(gains)
              and lc.get("fallers", -1) >= len(falls)
              and lc.get("movers_with_hour_pair", -1)
              == lc.get("gainers", -2) + lc.get("fallers", -3)
              + lc.get("flat", -4)
              and mv.get("with_hour_pair") == lc.get("movers_with_hour_pair"),
              f"counts={lc} movers={mv.get('with_hour_pair')}")
    else:
        print("[validate] live-wire.json absent (node step skipped) — not validated")

    # wave 29: streamer-desk.json — schema + the sourcing standard,
    # re-audited independently of the generator that published it
    sd_path = os.path.join(API, "streamer-desk.json")
    if os.path.exists(sd_path):
        sd = validate_doc("streamer-desk.json", sd_path, "streamer-desk.json")
        sc = sd.get("counts", {})

        def _domains(sources):
            from urllib.parse import urlparse
            return {(urlparse(s.get("url", "")).hostname or "")
                    .removeprefix("www.")
                    for s in sources or []}

        check("streamer-desk counts reconcile",
              sc.get("streamers", -1) == len(sd.get("streamers", []))
              and sc.get("houses", -1) == len(sd.get("houses", []))
              and sc.get("updates", -1) == len(sd.get("updates", []))
              and sc.get("drama_verified", -1) == len(sd.get("drama", []))
              and sc.get("unverified", -1) == len(sd.get("unverified", []))
              and sc.get("events", -1) == len(sd.get("events", []))
              and sc.get("events_upcoming", -2)
              == sum(1 for e in sd.get("events", [])
                     if e.get("status") == "upcoming")
              and sc.get("events_past", -3)
              == sum(1 for e in sd.get("events", [])
                     if e.get("status") == "past"),
              f"counts={sc}")
        check("streamer-desk every profile + house is sourced + dated",
              all(p.get("sources") and p.get("as_of")
                  for p in sd.get("streamers", []))
              and all(h.get("sources") and h.get("members_as_of")
                      for h in sd.get("houses", [])),
              "directory facts carry >= 1 source; rosters carry an as-of date")
        check("streamer-desk verified drama is multi-source",
              all(d.get("status") == "verified"
                  and len(_domains([s for ev in d.get("timeline", [])
                                    for s in ev.get("sources", [])])) >= 2
                  and all(ev.get("sources") and ev.get("date")
                          for ev in d.get("timeline", []))
                  and [ev.get("date") for ev in d.get("timeline", [])]
                  == sorted(ev.get("date")
                            for ev in d.get("timeline", []))
                  for d in sd.get("drama", []))
              and sc.get("drama_source_domains", 0) >= 2,
              "every verified timeline: >= 2 distinct source domains, "
              "every event sourced + dated, chronological")
        check("streamer-desk unverified stays quarantined",
              all(u.get("status") == "unverified"
                  and u.get("why_unverified") and u.get("sources")
                  for u in sd.get("unverified", []))
              and not ({u.get("id") for u in sd.get("unverified", [])}
                       & {d.get("id") for d in sd.get("drama", [])}),
              "unverified items carry status + reason + sources and "
              "never share an id with a verified timeline")
        check("streamer-desk event status honest vs dates",
              all((e.get("status") == "past") == (e.get("end", "") <
                  sd.get("generated_at", "")[:10])
                  or e.get("status") in ("happening-now",)
                  for e in sd.get("events", []))
              and all(e.get("start", "") <= e.get("end", "")
                      for e in sd.get("events", [])),
              "an event whose end precedes the build date is 'past'")
    else:
        print("[validate] streamer-desk.json absent (node step skipped) — not validated")

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

    # wave 30 · VP-0001: homepage static fallback rows + loading deadlines
    try:
        import re as _re
        import html as _html
        home = open(os.path.join(ROOT, "index.html")).read()

        def _region(name):
            m = _re.search(r"<!--TMFB:%s:BEGIN-->(.*?)<!--TMFB:%s:END-->" % (name, name),
                           home, _re.S)
            return m.group(1) if m else None

        _trends = json.load(open(os.path.join(ROOT, "data", "v1", "trends.json")))
        def _disp(t):
            t = _re.sub(r"\s+[\u2014\u2013]\s+", ", ", t)
            t = t.replace("\u2014", "-").replace("\u2013", "-")
            t = _re.sub(r"\(\s*(?:up\s*)?\+\d[\d,]*(?:\.\d+)?%[^)]*\)|\s\+\d[\d,]*(?:\.\d+)?%|\bup\s+\d[\d,]*(?:\.\d+)?%",
                        "", t, flags=_re.I)
            t = _re.sub(r"\s{2,}", " ", t).strip()
            return _re.sub(r"[\s\u00b7]+$", "", t)
        # pro rework (2026-10-15): the fallback contract is now THE
        # BOARD. The hot5 / radar / stations / wire-rail / topic-index
        # sections deliberately left the homepage (the same topics
        # four times over broke the five-second law); the pins below
        # hold the new contract at the old strength: the baked board
        # must equal board.json, in order, and the cut sections must
        # stay cut.
        _board = json.load(open(os.path.join(ROOT, "data", "v1", "board.json")))
        _mk = _board.get("make_now", [])
        _nw = _board.get("news_watch", [])
        _cu = _board.get("catchup", [])
        _breg = _region("board") or ""
        check("pro fallback board rows == board.json make_now",
              _breg.count('class="board-row') == len(_mk) and len(_mk) >= 1)
        _pos = [_breg.find(_html.escape(_disp(e["title"]), quote=True)) for e in _mk]
        check("pro fallback board titles match board.json in order",
              all(p >= 0 for p in _pos) and _pos == sorted(_pos))
        _nreg = _region("boardnews") or ""
        check("pro fallback news rows == board.json news_watch",
              _nreg.count('class="board-row news') == len(_nw))
        _creg = _region("catchup") or ""
        check("pro fallback catchup rows == board.json catchup",
              _creg.count('class="catchup-row"') == len(_cu) or "catchup-none" in _creg)
        check("pro homepage duplication stays cut",
              'id="hot5"' not in home and 'id="radar-strip"' not in home
              and 'class="stations"' not in home and "wire-rail" not in home
              and "topic-index" not in home)
        _tbl = _region("table") or ""
        check("vp0001 fallback table has 30 static rows", _tbl.count("<tr") >= 30)
        check("pro fallback stamp names the snapshot with an absolute time",
              "Snapshot" in (_region("datats") or "")
              and _re.search(r"\b\d{4}\b", _region("datats") or "") is not None)
        check("pro fallback table-meta names the snapshot",
              "snapshot" in (_region("tablemeta") or ""))
        _appjs = open(os.path.join(ROOT, "assets", "js", "app.js")).read()
        check("pro client stamp keeps the Snapshot label",
              'Snapshot <span class="num">' in _appjs and "tmStampUTC" in _appjs)
        for _fname, _marker in [("assets/js/app.js", "armWatchdog"),
                                ("assets/js/makeover.js", "withDeadline"),
                                ("live-wire.html", "deadline"),
                                ("streamer-desk.html", "deadline")]:
            _src = open(os.path.join(ROOT, _fname)).read()
            check(f"vp0001 loading deadline wired in {_fname}",
                  _marker in _src and "VP-0001" in _src)
    except (OSError, ValueError) as _e:
        check("vp0001 fallback block readable", False, str(_e))

    print(f"[validate] {len(passed)} checks passed, {len(failures)} failed")
    for f_ in failures:
        print("  FAIL:", f_)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
