#!/usr/bin/env python3
"""Steam most-played fetcher (ISteamChartsService, no key).

Completeness wave (2026-10-15): Valve's keyless ISteamChartsService
GetMostPlayedGames returns the weekly top 100 with peak players, but
only app IDs; names resolve per app via the store appdetails endpoint
(filters=basic). Verified live 2026-10-15: the API rollup and Steam's
official most-played chart page agree at the top of the chart
(Counter-Strike 2, Dota 2, PUBG: BATTLEGROUNDS). Player counts are the
gaming signal no other lane carries: what people are actually playing,
not what they are posting about. On total failure the fetcher prints
SKIP and writes nothing, so the lane reads stale-skip, never faked.
"""
import sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from common import fetch_json, hit, save_hits

CHARTS = "https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/"
DETAILS = "https://store.steampowered.com/api/appdetails?appids={}&filters=basic"
LIMIT = 25

def main():
    data = fetch_json(CHARTS)
    ranks = (data.get("response") or {}).get("ranks") or []
    hits = []
    for row in ranks[:LIMIT]:
        appid = row.get("appid")
        if not appid:
            continue
        name = None
        try:
            det = fetch_json(DETAILS.format(appid))
            entry = (det.get(str(appid)) or {}).get("data") or {}
            name = entry.get("name")
        except Exception:
            name = None
        hits.append(hit(
            name or f"Steam app {appid}",
            f"https://store.steampowered.com/app/{appid}/",
            "steam",
            summary=(f"Steam rank {row.get('rank')}: "
                     f"{row.get('peak_in_game', 0):,} peak players "
                     f"in the weekly rollup"),
            category="gaming", platforms=["steam"]))
    save_hits("steam", hits)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[steam] SKIP: {e}")
