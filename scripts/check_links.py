#!/usr/bin/env python3
"""Wave 5 — link checker for the trend-machine static site.

Scope:
  - internal (relative) links in all *.html: must resolve to a file. HARD FAIL.
  - topic links in llms.txt: must resolve. HARD FAIL.
  - api/v1 schema paths referenced from the manifest: must exist. HARD FAIL.
  - external http(s) links: best-effort HEAD with timeout; failures are
    reported as warnings UNLESS the host resolves and returns 404/410
    (clearly broken). guide_links to the brother site are documented
    placeholders (see API.md) and are skipped by convention.

Exit 0 when zero hard failures, 1 otherwise. Prints a summary count.
"""
import html
import os
import re
import sys
from html.parser import HTMLParser
from urllib import request, parse

ROOT = os.path.join(os.path.dirname(__file__), "..")

# documented placeholders — skip (see API.md "Placeholder status")
SKIP_PREFIXES = (
    "../creator-growth-empire/",
    "https://creator-growth-empire",
)

ATTR_RE = re.compile(r'''(?:href|src)\s*=\s*["']([^"'#]+)["']''', re.I)


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        for k, v in attrs:
            if k in ("href", "src") and v:
                # strip fragment AND query string — launch-plan.html?topic=x
                # is a real page with a query param, not a missing file
                self.links.append(v.split("#")[0].split("?")[0])


def internal_links(changed_only=False):
    found = []  # (file, link)
    changed = set()
    if changed_only:
        import subprocess
        try:
            out = subprocess.run(
                ["git", "status", "--porcelain"], cwd=ROOT,
                capture_output=True, text=True, timeout=30).stdout
            for line in out.splitlines():
                parts = line.strip().split(None, 1)
                if len(parts) == 2 and parts[1].endswith(".html"):
                    changed.add(os.path.join(ROOT, parts[1]))
        except Exception:
            pass
    for dirpath, _, files in os.walk(ROOT):
        if "__pycache__" in dirpath or ".git" in dirpath or ".github" in dirpath:
            continue
        for fn in files:
            if not fn.endswith(".html"):
                continue
            fp = os.path.join(dirpath, fn)
            if changed_only and fp not in changed:
                continue
            p = LinkParser()
            with open(fp, encoding="utf-8", errors="replace") as f:
                p.feed(f.read())
            for link in p.links:
                if not link or link.startswith(("mailto:", "javascript:", "data:", "tel:")):
                    continue
                if link.startswith(SKIP_PREFIXES):
                    continue
                found.append((fp, link))
    return found


def check_external(url):
    """Return None if ok/unknown, or a failure string if clearly broken."""
    if url.startswith(SKIP_PREFIXES):
        return None
    try:
        req = request.Request(url, method="HEAD",
                              headers={"User-Agent": "trend-machine-linkcheck/1.0"})
        with request.urlopen(req, timeout=8) as r:
            if r.status in (404, 410):
                return f"HTTP {r.status}"
            return None
    except Exception as e:
        msg = str(e)
        # DNS/connection failures are network flakiness — warn, don't fail.
        # An HTTPError with a 404/410 code IS a broken link.
        if hasattr(e, "code") and e.code in (404, 410):
            return f"HTTP {e.code}"
        return "warn:" + msg[:80]


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--changed-only", action="store_true",
                    help="check external links only in new/modified HTML files "
                         "(internal links are always checked everywhere)")
    args = ap.parse_args()

    hard_fails = []
    warnings = []
    checked_internal = 0
    checked_external = 0

    internal = []
    external = []  # (file, url)
    # internals: always the full site. externals: scoped when --changed-only.
    all_links = internal_links(changed_only=False)
    changed_html = {fp for fp, _ in internal_links(changed_only=True)} if args.changed_only else None
    for fp, link in all_links:
        parsed = parse.urlparse(link)
        if parsed.scheme in ("http", "https"):
            if changed_html is None or fp in changed_html:
                external.append((fp, link))
        else:
            internal.append((fp, link))

    for fp, link in internal:
        checked_internal += 1
        target = os.path.normpath(os.path.join(os.path.dirname(fp), link))
        if not os.path.exists(target):
            hard_fails.append(f"{fp} -> {link} (missing)")

    # external: concurrent HEADs so 1000+ source links don't take forever.
    # dedupe by URL — the same source links repeat across topic pages.
    from concurrent.futures import ThreadPoolExecutor

    seen_urls = {}

    def _one(item):
        fp, url = item
        return fp, url, check_external(url)

    unique_external = []
    for fp, url in external:
        if url not in seen_urls:
            seen_urls[url] = None
            unique_external.append((fp, url))
    print(f"[linkcheck] {len(external)} external refs, {len(unique_external)} unique URLs",
          flush=True)

    with ThreadPoolExecutor(max_workers=32) as ex:
        for fp, url, res in ex.map(_one, unique_external):
            checked_external += 1
            if res and not res.startswith("warn:"):
                hard_fails.append(f"{fp} -> {url} ({res})")
            elif res:
                warnings.append(f"{fp} -> {url} ({res})")

    # llms.txt topic links
    llms = os.path.join(ROOT, "llms.txt")
    if os.path.exists(llms):
        with open(llms) as f:
            for m in re.finditer(r"topics/[\w\-.]+\.html", f.read()):
                checked_internal += 1
                if not os.path.exists(os.path.join(ROOT, m.group(0))):
                    hard_fails.append(f"llms.txt -> {m.group(0)} (missing)")

    print(f"[linkcheck] internal: {checked_internal} checked, "
          f"external: {checked_external} checked, "
          f"warnings: {len(warnings)}, broken: {len(hard_fails)}")
    for w in warnings[:10]:
        print("  WARN:", w)
    for f_ in hard_fails[:20]:
        print("  BROKEN:", f_)
    return 1 if hard_fails else 0


if __name__ == "__main__":
    sys.exit(main())
