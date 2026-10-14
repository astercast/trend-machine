#!/usr/bin/env python3
"""trend-machine — wave 8: pinned-fixture tests for sparkline_prep.py.

Run: python3 scripts/test_sparkline_prep.py   (exit 0 = all pass)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sparkline_prep as sp

FAILS = []


def check(name, cond, detail=""):
    if cond:
        print(f"  ok: {name}")
    else:
        print(f"  FAIL: {name} {detail}")
        FAILS.append(name)


# ---- pinned fixtures -------------------------------------------------------
RISING_4 = [  # 4 real hourly snapshots, rising 40 -> 70
    ["2026-10-11T18:00:00+00:00", 40],
    ["2026-10-11T19:00:00+00:00", 50],
    ["2026-10-11T20:00:00+00:00", 60],
    ["2026-10-11T21:00:00+00:00", 70],
]
FLAT_3 = [
    ["2026-10-11T18:00:00+00:00", 55],
    ["2026-10-11T19:00:00+00:00", 55],
    ["2026-10-11T20:00:00+00:00", 55],
]
THIN_2 = [
    ["2026-10-11T20:00:00+00:00", 61],
    ["2026-10-11T21:00:00+00:00", 63],
]
ONE = [["2026-10-11T21:00:00+00:00", 42]]
# velocity_history.json points carry a 3rd element (opportunity) — must be ignored
WITH_OPP = [
    ["2026-10-11T18:00:00+00:00", 40, 38],
    ["2026-10-11T19:00:00+00:00", 50, 47],
    ["2026-10-11T20:00:00+00:00", 60, 55],
]

print("[sparkline_prep] prep_series")
p = sp.prep_series(RISING_4, width=260, height=48, pad=5)
check("rising n=4", p["n"] == 4)
check("rising ready (>=3)", p["ready"] is True)
check("rising first/last", p["first"] == 40 and p["last"] == 70)
check("rising delta", p["delta"] == 30)
check("rising since label", p["since"] == "Oct 11, 2026", p["since"])
# exact coordinate math: x spreads 5..255 across 4 points; y maps 40..70 -> 43..5
check("rising coords exact",
      p["coords"] == ["5.0,43.0", "88.3,30.3", "171.7,17.7", "255.0,5.0"],
      str(p["coords"]))

p = sp.prep_series(FLAT_3, width=260, height=48, pad=5)
check("flat ready", p["ready"] is True)
check("flat y identical", len({c.split(",")[1] for c in p["coords"]}) == 1,
      str(p["coords"]))
check("flat delta 0", p["delta"] == 0)

p = sp.prep_series(THIN_2)
check("2-pt not ready (honest <3 rule)", p["ready"] is False)
p = sp.prep_series(ONE)
check("1-pt not ready", p["ready"] is False)
p = sp.prep_series([])
check("empty not ready, n=0", p["ready"] is False and p["n"] == 0
      and p["first"] is None)

p = sp.prep_series(WITH_OPP)
check("3rd element ignored", p["first"] == 40 and p["last"] == 60
      and len(p["coords"]) == 3)

print("[sparkline_prep] sparkline_svg")
p = sp.prep_series(RISING_4)
svg = sp.sparkline_svg(p)
check("svg has role=img", 'role="img"' in svg)
check("svg aria-label grounded in data",
      "40 when tracking started (Oct 11, 2026), 70 at the latest reading (4 readings)" in svg)
check("svg has polyline + last dot",
      "<polyline" in svg and "<circle" in svg)
check("svg static: no animate/script", "<animate" not in svg and "<script" not in svg)
check("svg not-ready returns empty", sp.sparkline_svg(sp.prep_series(THIN_2)) == "")
# escaping: hostile label must not break the attribute
p2 = sp.prep_series(RISING_4)
evil = dict(p2)
evil["since"] = 'x"><script>alert(1)</script>'
svg2 = sp.sparkline_svg(evil)
check("aria-label escaped", "<script" not in svg2 and "&quot;" not in svg2 or "&lt;script" in svg2)

print("[sparkline_prep] honest states")
e = sp.empty_state_html(2)
check("empty says history building", "History building" in e and "fake" not in e.lower() or "No line drawn" in e)
check("empty counts remaining", "1 more hourly refresh" in e, e)
t = sp.data_table_html(RISING_4, "spark-data-x", "Velocity snapshots")
check("data table has caption+thead", "<caption>Velocity snapshots</caption>" in t
      and "<th scope=\"col\">Snapshot</th>" in t)
check("data table lists all 4 rows", t.count("<tr>") == 5, str(t.count("<tr>")))
check("data table is real table markup", "<table" in t and "<details" in t)

print("[sparkline_prep] sparkline_figure_html")
fig = sp.sparkline_figure_html(RISING_4, "ramalama",
                               {"tiktok": RISING_4, "youtube": THIN_2, "x": ONE})
check("figure wraps in figure/figcaption", "<figure" in fig and "<figcaption" in fig)
check("per-platform group labeled", 'aria-label="Per-platform velocity sparklines"' in fig)
check("ready platform gets mini svg", fig.count("spark spark-mini") == 1, str(fig.count("spark spark-mini")))
check("thin platforms honest", "history building" in fig and "(2 snapshots)" in fig
      and "(1 snapshot)" in fig)
check("screen-reader platform summary", "tiktok: 40 to 70 over 4 snapshots" in fig)
fig2 = sp.sparkline_figure_html(THIN_2, "thin-topic")
check("thin main series: no svg, honest note",
      "<svg" not in fig2 and "History building" in fig2)
fig3 = sp.sparkline_figure_html(RISING_4, "noplat")
check("no per-platform -> no group", "plat-sparks" not in fig3)

print("[sparkline_prep] flat_velocity_trend")
hist = {"aaa": RISING_4, "bbb": THIN_2}
phist = {"aaa": {"tiktok": RISING_4, "youtube": ONE}}
vt = sp.flat_velocity_trend("aaa", hist, phist)
check("flat trend state ready", vt["state"] == "ready" and vt["snapshots"] == 4)
check("flat trend svg present", vt["sparkline_svg"] and "<svg" in vt["sparkline_svg"])
check("flat trend per-platform",
      vt["per_platform"]["tiktok"]["snapshots"] == 4
      and vt["per_platform"]["youtube"]["sparkline_svg"] is None
      and vt["per_platform"]["youtube"]["latest_velocity"] == 42)
vt2 = sp.flat_velocity_trend("bbb", hist, phist)
check("flat trend thin -> building, svg None",
      vt2["state"] == "building" and vt2["sparkline_svg"] is None
      and vt2["latest_velocity"] == 63)
vt3 = sp.flat_velocity_trend("missing", hist, phist)
check("flat trend unknown topic", vt3["state"] == "building" and vt3["snapshots"] == 0
      and vt3["per_platform"] == {})

print(f"\n[test_sparkline_prep] {len(FAILS)} failures")
sys.exit(1 if FAILS else 0)
