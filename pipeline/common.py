"""Shared helpers for trend-machine fetchers."""
import json, re, html, hashlib, datetime, urllib.request

USER_AGENT = "trend-machine/0.1 (+https://github.com/astercast/trend-machine)"

def fetch_text(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")

def fetch_json(url, timeout=20):
    return json.loads(fetch_text(url, timeout))

def clean(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()

def uid(*parts):
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:12]

def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat()

def hit(title, url, source, summary="", hashtags=None, category=None, platforms=None, also=None):
    h = {
        "title": clean(title)[:180], "url": url, "source": source,
        "summary": clean(summary)[:400], "hashtags": hashtags or [],
        "category": category, "platforms": platforms or [],
        "fetched_at": now_iso(),
    }
    if also:
        # other real pages that corroborate this signal: [{"name","url","title"}]
        h["also"] = also[:4]
    return h

def save_hits(name, hits, outdir="pipeline/out"):
    import os
    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, f"{name}.json")
    with open(path, "w") as f:
        json.dump(hits, f, indent=2, ensure_ascii=False)
    print(f"[{name}] {len(hits)} hits -> {path}")
    return path

HASHTAG_RE = re.compile(r"#(\w+)")
def extract_hashtags(text):
    return ["#" + h for h in HASHTAG_RE.findall(text or "")][:8]
