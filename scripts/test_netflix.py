#!/usr/bin/env python3
"""Fixture tests for pipeline/fetch_netflix.py (completeness B3).

Pins: only the newest week in the all-weeks file becomes hits; the
per-chart cap is 5; rank, chart, week and views land in the summary;
category is entertainment (makeable evidence), platform netflix;
malformed rows are dropped; empty input invents nothing; no em dash
in generated text. No network.
Run: python3 scripts/test_netflix.py  (exit 0 = all pass)
"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import fetch_netflix

FAILS = []


def check(name, cond, detail=""):
    if cond:
        print("  ok: " + name)
    else:
        print("  FAIL: " + name + (f" - {detail}" if detail else ""))
        FAILS.append(name)


HEADER = ("week\tcategory\tweekly_rank\tshow_title\tseason_title\t"
          "weekly_hours_viewed\truntime\tweekly_views\t"
          "cumulative_weeks_in_top_10")


def row(week, cat, rank, title, views):
    return "\t".join([week, cat, str(rank), title, title + ": Season 1",
                      "1000000", "1.5", str(views), "1"])


TSV = "\n".join([
    HEADER,
    row("2026-09-27", "Films (English)", 1, "Old Week Film", 5000000),
    row("2026-10-04", "Films (English)", 1, "New Film", 24900000),
    row("2026-10-04", "Films (English)", 5, "Fifth Film", 2500000),
    row("2026-10-04", "Films (English)", 6, "Sixth Film", 2400000),
    row("2026-10-04", "TV (English)", 1, "New Show", 6500000),
    row("2026-10-04", "TV (Non-English)", 2, "Other Show", 5100000),
    "\t".join(["2026-10-04", "TV (English)", "x", "Broken", "", "", "", "", ""]),
])

hits = fetch_netflix.parse_tsv(TSV)
titles = [h["title"] for h in hits]
check("netflix: only the newest week is used",
      "Old Week Film" not in titles and "New Film" in titles)
check("netflix: per-chart cap of 5 holds",
      "Fifth Film" in titles and "Sixth Film" not in titles)
check("netflix: malformed rank rows are dropped",
      "Broken" not in titles and len(hits) == 4)
film = [h for h in hits if h["title"] == "New Film"][0]
check("netflix: summary carries rank, chart, week and views",
      film["summary"].startswith("No. 1 on Netflix's global Films (English)")
      and "week of 2026-10-04" in film["summary"]
      and "24,900,000 views" in film["summary"])
check("netflix: category entertainment (makeable), platform netflix",
      film["category"] == "entertainment"
      and film["platforms"] == ["netflix"]
      and film["source"] == "netflix-top10")
check("netflix: empty input invents nothing",
      fetch_netflix.parse_tsv("") == []
      and fetch_netflix.parse_tsv("week\tcategory\n") == [])
check("netflix: no em dash in generated text",
      all("—" not in h["title"] and "—" not in h["summary"] for h in hits))

print("[test_netflix] " + ("all checks passed" if not FAILS
                           else f"{len(FAILS)} FAILURES"))
sys.exit(1 if FAILS else 0)
