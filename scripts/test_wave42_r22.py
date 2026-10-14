#!/usr/bin/env python3
"""trend-machine — rotation 22 (build 7): pinned-fixture tests for the
TREND-STUDY §4 anatomy helpers in build_site.py + sparkline_prep.py.

Run: python3 scripts/test_wave42_r22.py   (exit 0 = all pass)
"""
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_site as bs
import sparkline_prep as sp

FAILS = []


def check(name, cond, detail=""):
    if cond:
        print("  ok: %s" % name)
    else:
        print("  FAIL: %s %s" % (name, detail))
        FAILS.append(name)


UTC = datetime.timezone.utc
REF = datetime.datetime(2026, 10, 13, 10, 15, tzinfo=UTC)

# --- age in words -------------------------------------------------------
check("age just now", bs.age_words("2026-10-13T10:14:40+00:00", REF) == "just now")
check("age minutes", bs.age_words("2026-10-13T09:28:00+00:00", REF) == "47 minutes ago")
check("age one minute", bs.age_words("2026-10-13T10:14:00+00:00", REF) == "1 minute ago")
check("age hours", bs.age_words("2026-10-13T07:15:00+00:00", REF) == "3 hours ago")
check("age one hour", bs.age_words("2026-10-13T09:15:00+00:00", REF) == "1 hour ago")
check("age days", bs.age_words("2026-10-11T10:15:00+00:00", REF) == "2 days ago")
check("age one day", bs.age_words("2026-10-12T10:15:00+00:00", REF) == "1 day ago")
check("age unknown", bs.age_words("nonsense", REF) == "at an unrecorded time")
check("age words carry no abbreviation",
      all(" ago" in bs.age_words(x, REF) or bs.age_words(x, REF) == "just now"
          for x in ["2026-10-13T10:00:00+00:00", "2026-10-12T10:15:00+00:00"]))

# --- credits ------------------------------------------------------------
t_pub = {"summary": "Tubefilter \u00b7 Sat, 27 Dec 2025 08:00:00 GMT",
         "sources": [{"name": "gnews-q:FaZe Clan"}]}
check("credit from summary head", bs.credit_name(t_pub) == "Tubefilter")
check("credit gnews lane", bs.credit_name(
    {"summary": "prose", "sources": [{"name": "gnews-q:TikTok viral"}]}) == "Google News")
check("credit reddit lane", bs.credit_name(
    {"summary": "", "sources": [{"name": "reddit-rss:r/news"}]}) == "Reddit (r/news)")
check("credit yt lane", bs.credit_name(
    {"summary": "", "sources": [{"name": "yt-rss:IGN"}]}) == "YouTube (IGN)")
check("credit hackernews", bs.credit_name(
    {"summary": "", "sources": [{"name": "hackernews"}]}) == "Hacker News")
check("credit plain name", bs.credit_name(
    {"summary": "", "sources": [{"name": "Game8"}]}) == "Game8")
check("credit empty record", bs.credit_name({"summary": "", "sources": []}) == "")
check("credit strips provenance rider", bs.credit_name(
    {"summary": "", "sources": [
        {"name": "New Engen (source URL not found on 2026-10-11 re-check)"}]})
    == "New Engen")

# --- record subline -----------------------------------------------------
t_rec = {"velocity": 91, "last_seen": "2026-10-11T10:15:00+00:00",
         "sources": [{"name": "Game8"}]}
check("record line", bs.record_line(t_rec, REF) ==
      "spreading 91 of 100 \u00b7 last seen 2 days ago \u00b7 1 source")
t_rec2 = dict(t_rec, sources=[{"name": "A"}, {"name": "B"}, {"name": "C"}])
check("record line plural", bs.record_line(t_rec2, REF).endswith("3 sources"))

# --- movement sentences -------------------------------------------------
flat = [["2026-10-11T00:00:00+00:00", 92], ["2026-10-12T00:00:00+00:00", 92],
        ["2026-10-13T00:00:00+00:00", 92]]
check("sentence flat", sp.movement_sentences(flat) ==
      ["Spreading held at 92 across all 3 readings, Oct 11 to Oct 13."])
fell = [["2026-10-11T00:00:00+00:00", 74], ["2026-10-12T00:00:00+00:00", 66],
        ["2026-10-13T00:00:00+00:00", 58]]
check("sentence fell", sp.movement_sentences(fell) ==
      ["Spreading fell from 74 on Oct 11 to 58 on Oct 13 across 3 readings."])
peaked = [["2026-10-11T00:00:00+00:00", 50], ["2026-10-12T00:00:00+00:00", 88],
          ["2026-10-13T00:00:00+00:00", 60]]
check("sentence peak", sp.movement_sentences(peaked) ==
      ["Spreading rose from 50 on Oct 11 to 60 on Oct 13 across 3 readings.",
       "It peaked at 88 on Oct 12."])

# --- evidence block -----------------------------------------------------
html = sp.evidence_block_html(fell, "t-fell", {"tiktok": fell})
check("evidence one svg", html.count("<svg") == 1)
check("evidence annotation inside drawing",
      '<text class="ev-anno"' in html and "Spreading fell from 74" in html)
check("evidence movers are text", "Movers, by platform" in html
      and "tiktok \u00b7 spreading 74 to 58 across 3 readings" in html)
check("evidence keeps data table", "View the readings (3 points)" in html)
thin = sp.evidence_block_html(fell[:2], "t-thin", None)
check("thin series draws nothing", "<svg" not in thin)
check("thin series honest line",
      "too few to draw honestly" in thin and "sources below are the record" in thin)

# --- catch-up selection -------------------------------------------------
def topic(tid, vel, stale=False):
    return {"id": tid, "title": tid, "category": "meme", "velocity": vel,
            "opportunity_score": vel, "saturation": "low", "platforms": [],
            "hashtags": [], "sources": [{"name": "Game8"}],
            "last_seen": "2026-10-12T10:15:00+00:00", "stale": stale,
            "summary": "", "angles": [], "format_tags": []}

topics = [topic("hot%d" % i, 90 + i) for i in range(8)]
topics += [topic("cooled", 58), topic("flat", 60),
           topic("thin", 40), topic("stale-cooled", 30, stale=True)]
hist = {
    "hot0": [["2026-10-11T00:00:00+00:00", 90]] * 3,
    "cooled": [["2026-10-11T00:00:00+00:00", 74],
               ["2026-10-12T00:00:00+00:00", 66],
               ["2026-10-13T00:00:00+00:00", 58]],
    "flat": [["2026-10-11T00:00:00+00:00", 60]] * 3,
    "thin": [["2026-10-11T00:00:00+00:00", 70],
             ["2026-10-13T00:00:00+00:00", 40]],
    "stale-cooled": [["2026-10-11T00:00:00+00:00", 90],
                     ["2026-10-12T00:00:00+00:00", 60],
                     ["2026-10-13T00:00:00+00:00", 30]],
}
board = bs.build_board(topics, topics, "2026-10-13T10:15:00+00:00", history=hist)
ids = [e["id"] for e in board["catchup"]]
check("catchup holds only the cooled", ids == ["cooled"], str(ids))
check("catchup record names the peak",
      board["catchup"][0]["record"].startswith(
          "spreading 58 of 100, peaked at 74 \u00b7 last seen 1 day ago"))
check("board entry anatomy fields",
      board["make_now"][0]["source_name"] == "Game8"
      and board["make_now"][0]["record"].startswith("spreading 97 of 100 \u00b7 last seen"))
check("board evidence no longer duplicates the record line",
      all(not c.startswith("velocity ") and not c.startswith("last seen")
          for c in board["make_now"][0]["evidence"]))

print()
if FAILS:
    print("FAILED: %d" % len(FAILS))
    sys.exit(1)
print("all wave42 checks passed")
