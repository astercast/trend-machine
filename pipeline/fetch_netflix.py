#!/usr/bin/env python3
"""Netflix Top 10 fetcher (official data file, no key, no signup).

Completeness build B3 (2026-10-15): streaming video is one of the
biggest hype surfaces there is, and the board covered it only
through news. Netflix publishes its global weekly Top 10 as one
official data file on the open web:

  https://top10.netflix.com/data/all-weeks-global.tsv
  (redirects to netflix.com/tudum/top10/data/all-weeks-global.tsv;
  measured 2026-10-15 from this machine: 903,899 bytes, about 4s)

The fetcher reads only the newest week in the file and takes the
top 5 of each of the four global charts (English and non-English
film and TV), 20 hits at most. Evidence type on the board:
makeable. A charting show or film is recap, reaction and theory
material, so hits carry category "entertainment", never "news".

Failure contract (same as fetch_streamers.py): on any failure the
fetcher saves an empty file so the Live Wire reads the lane as
degraded, never as live. Rows are only ever rows the file actually
carried, with the chart week printed in every summary.
"""
import csv, io, sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from common import fetch_text, hit, save_hits

URL = "https://top10.netflix.com/data/all-weeks-global.tsv"
PER_CHART = 5


def parse_tsv(text):
    """All-weeks TSV text -> hits for the newest week only."""
    rows = list(csv.DictReader(io.StringIO(text or ""), delimiter="\t"))
    weeks = sorted({r.get("week") for r in rows if r.get("week")})
    if not weeks:
        return []
    week = weeks[-1]
    hits = []
    for r in rows:
        if r.get("week") != week:
            continue
        try:
            rank = int(r.get("weekly_rank") or "")
        except ValueError:
            continue
        if rank > PER_CHART:
            continue
        chart = (r.get("category") or "").strip()
        title = (r.get("show_title") or r.get("season_title") or "").strip()
        if not chart or not title:
            continue
        views = ""
        try:
            views = f", {int(float(r['weekly_views'])):,} views that week"
        except (KeyError, TypeError, ValueError):
            views = ""
        hits.append(hit(
            title, "https://www.netflix.com/tudum/top10", "netflix-top10",
            summary=(f"No. {rank} on Netflix's global {chart} chart, "
                     f"week of {week}{views}"),
            hashtags=[], category="entertainment",
            platforms=["netflix"]))
    return hits


def main():
    try:
        text = fetch_text(URL, timeout=30)
    except Exception as e:
        print(f"[netflix] SKIP: {e}")
        save_hits("netflix", [])
        return
    save_hits("netflix", parse_tsv(text))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[netflix] SKIP: {e}")
        try:
            save_hits("netflix", [])
        except Exception:
            pass
