#!/usr/bin/env python3
"""Wave 35 — View Transitions adoption checks (Fleet Commons canonical v1.0.0).

Pins the shape of the adoption so a later edit cannot quietly break it:
  1. base.css carries the cross-document opt-in, inside the
     prefers-reduced-motion: no-preference guard — never outside it.
  2. The war-room idiom is opacity only: the root keyframes name no
     transform / translate / scale (no travel — a snapshot of the old
     page must never slide).
  3. Single source: no other stylesheet re-declares @view-transition.
  4. Every page loads base.css, so the opt-in is genuinely site-wide
     (root pages + the generated dossiers + 404.html).
  5. Same-document discipline: the two existing startViewTransition
     call sites (formats, launch-plan) each carry both
     canonical gates — the feature detect and the reduced-motion
     check — and NO other JS/HTML file uses startViewTransition
     (the live board / Live Wire / Streamer Desk
     fetch-renders stay direct swaps; WAVELOG wave 35 records why).
     (The third wave-35 call site was the retired scorecard page,
     removed with the prediction layer on 2026-10-13.)
  6. No view-transition-name shared-element pairings anywhere except
     the launch-plan plan-grid pairing that predates this wave
     (wave10.css, itself inside the no-preference guard).

Run: python3 scripts/test_view_transitions.py   (exit 0 = all pass)
"""
import glob
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
failures = []


def check(name, cond, detail=""):
    print(f"  {'ok' if cond else 'FAIL'}  {name}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


def guarded_block(css, needle):
    """Return the @media no-preference block(s) containing `needle`."""
    out = []
    for m in re.finditer(r"@media \(prefers-reduced-motion: no-preference\) \{", css):
        depth, i = 1, m.end()
        while i < len(css) and depth:
            depth += {"{": 1, "}": -1}.get(css[i], 0)
            i += 1
        block = css[m.start():i]
        if needle in block:
            out.append(block)
    return out


base = read("assets/css/base.css")

# 1 — opt-in present and guard-contained
blocks = guarded_block(base, "@view-transition")
check("base.css @view-transition inside no-preference guard", len(blocks) == 1)
check("base.css opt-in is navigation: auto",
      bool(blocks) and "navigation: auto" in blocks[0])
unguarded = base
for b in blocks:
    unguarded = unguarded.replace(b, "")
check("no @view-transition outside the guard in base.css",
      "@view-transition" not in unguarded)

# 2 — ROUND-004 (M6): the universal crossfade is replaced by the wire
# cut. The old tm-vt keyframes must NOT exist, and both transition
# pseudo-elements must carry animation: none (a hard step, no fade,
# no travel, no scale).
for kf in ("tm-vt-out", "tm-vt-in"):
    check(f"@keyframes {kf} removed (M6 wire cut)", f"@keyframes {kf}" not in base)
for pseudo in ("::view-transition-old(root)", "::view-transition-new(root)"):
    m = re.search(re.escape(pseudo) + r" \{([^}]*)\}", base)
    check(f"{pseudo} is the wire cut (animation: none)",
          m is not None and "animation: none" in m.group(1),
          m.group(1).strip() if m else "missing")

# 3 — single source across stylesheets
others = []
for path in glob.glob(os.path.join(ROOT, "assets/css/*.css")):
    rel = os.path.relpath(path, ROOT)
    # the rule itself, not a mention in a comment
    if rel != "assets/css/base.css" and re.search(r"@view-transition\s*\{", read(rel)):
        others.append(rel)
check("no other stylesheet declares @view-transition", not others, str(others))

# 4 — every page loads base.css
pages = (glob.glob(os.path.join(ROOT, "*.html")) +
         glob.glob(os.path.join(ROOT, "topics/*.html")))
missing = [os.path.relpath(p, ROOT) for p in pages if "assets/css/base.css" not in read(os.path.relpath(p, ROOT))]
check(f"all {len(pages)} pages load base.css", not missing, str(missing[:5]))

# 5 — same-document call sites: exactly the two known, both gates each
allowed = {"formats.html", "assets/js/launch-plan.js"}
found = {}
for path in (glob.glob(os.path.join(ROOT, "*.html")) +
             glob.glob(os.path.join(ROOT, "assets/js/*.js"))):
    rel = os.path.relpath(path, ROOT)
    text = read(rel)
    if "startViewTransition" in text:
        found[rel] = text
check("startViewTransition only at the two known call sites",
      set(found) == allowed, str(sorted(found)))
for rel, text in sorted(found.items()):
    check(f"{rel}: feature detect present",
          "document.startViewTransition" in text)
    check(f"{rel}: reduced-motion gate present",
          'matchMedia("(prefers-reduced-motion: reduce)")' in text or
          'matchMedia("(prefers-reduced-motion: reduce)")' in text.replace("\\\"", '"'))

# 6 — shared-element names: only the pre-existing plan-grid pairing
named = []
for path in glob.glob(os.path.join(ROOT, "assets/css/*.css")):
    rel = os.path.relpath(path, ROOT)
    for m in re.finditer(r"view-transition-name:\s*([\w-]+)", read(rel)):
        named.append((rel, m.group(1)))
check("view-transition-name only the wave-10 plan-grid pairing",
      named == [("assets/css/wave10.css", "plan-grid")], str(named))
w10 = guarded_block(read("assets/css/wave10.css"), "view-transition-name")
check("plan-grid pairing sits inside the no-preference guard", len(w10) == 1)

print(f"[test_view_transitions] {'FAILED: ' + ', '.join(failures) if failures else 'all checks passed'}")
sys.exit(1 if failures else 0)
