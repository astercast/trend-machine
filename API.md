# API.md — Trend Machine agent API

All endpoints are static JSON. No auth, no rate limits (it's your own host).

## Endpoints

| Endpoint | Contents |
|---|---|
| `api/v1/index.json` | Manifest: version, generated_at, endpoint map, usage hint |
| `api/v1/trends.json` | All topics, full dossiers |
| `api/v1/hashtags.json` | Tag → topic-id index |
| `api/v1/schema/trend.json` | JSON Schema (draft-07) for a topic |

## The one query that matters

```bash
curl -s https://<host>/api/v1/trends.json \
 | python3 -c "
import json,sys
d = json.load(sys.stdin)
for t in sorted(d['topics'], key=lambda t: t['opportunity_score'], reverse=True)[:5]:
    if not t.get('stale'):
        print(t['opportunity_score'], t['title'], '|', ' '.join(t['hashtags'][:3]))
"
```

## Topic object

`id, title, summary, category, platforms[], hashtags[], velocity (0–100),
saturation (low|medium|high), opportunity_score (0–100), first_seen, last_seen,
stale (bool), seeded (bool), sources[{name,url}], angles[], hooks[],
who_to_watch[], guide_links[]`

## Freshness contract

- `last_seen` is ISO-8601 with timezone. Age = now − last_seen.
- `stale: true` means no corroboration in 72h+ — treat as cooling.
- The dashboard renders <60m as pulsing live, <24h as warm, older as dead.

## Creator-guide cross-links

Topic dossiers link playbooks in the brother site (Creator Growth Empire).
`guide_links` use phase slugs (`phase-0-start-from-nothing.html`, …).
Base URL defaults to `../creator-growth-empire/` (sibling checkout) and is
overridable via the `GUIDE_BASE_URL` env var at build time. If the guide
deploys at a real domain, rebuild with `GUIDE_BASE_URL=https://…`.

**Placeholder status (2026-10-11):** the guide's HTML pages are still being
built, so these links are an intentional documented placeholder pattern —
they resolve once the guide deploys. They are excluded from the link check
for this reason; everything else must be 0-broken.
