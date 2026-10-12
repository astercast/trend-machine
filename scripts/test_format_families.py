#!/usr/bin/env python3
"""Wave 9 — pinned-fixture tests for pipeline/format_families.py.

The matcher must:
  1. match the real seeded topics to their curated families,
  2. return None for non-format topics (a news topic must not be claimed
     by any family),
  3. never misfire on look-alike phrasing,
  4. keep the curated file honest (verification enum, sourced evidence
     or an explicit single-source flag).

Fixtures are pinned: hand-written topic text + expected family ids, so a
future keyword edit that misfires fails loudly.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
from format_families import match_family, family_names, load_families

ROOT = os.path.join(os.path.dirname(__file__), "..")

MATCH_CASES = [
    # (title, summary, hashtags, expected_family_id)
    ("Ramalama Costume Walk",
     "Low-angle creepy walk zooming out to reveal a Halloween fit, set to Róisín Murphy's Ramalama.",
     ["#halloween"], "costume-walk"),
    ("\"Did I Win This Trend?\" Costume Reveal",
     "Start in ordinary clothes, cut to the full costume on the drum drop and caption it Did I Win This Trend?",
     [], "costume-walk"),
    ("Mannequin Challenge is back",
     "The mannequin challenge returns for fit checks: one person stands still while the camera circles.",
     ["#fitcheck"], "costume-walk"),
    ("Netflix documentary parody",
     "Creators pretend to prepare for their Netflix documentary close-up, looking off-camera at an imaginary producer.",
     [], "pov-setup"),
    ("POV: you're dating a gym bro",
     "Imagine dating anything — a brand, a character, a gym bro. Stitched clips of the quirks.",
     ["#pov"], "pov-setup"),
    ("The \"Two Fishes\" deadpan audio",
     "Corbin Mims from Love Island USA calmly explains two fishes. Deadpan defense of a take.",
     ["#corbingpt"], "deadpan-debate"),
    ("Pumpkin Head Illusion",
     "Hold a real pumpkin to the lens so it becomes a fake head, to a hocus pocus remix.",
     ["#halloween"], "prop-illusion"),
    ("Be OK — happy dance over chaos",
     "Ingrid Michaelson track under a happy waist-up dance while the on-screen text confesses chaos.",
     [], "chaos-caption"),
    ("\"Stop the Wedding\" photo carousels",
     "Wedding-regret photo carousels: creators post wedding-day photos captioned Stop the wedding, but...",
     [], "carousel-story"),
    ("\"Bow Bow Bow\" dance",
     "Zeddy Will's bend-and-bounce dance with the shouted BOW hook.",
     [], "dance-hook"),
    ("Text From \"-A\"",
     "Pretty Little Liars copy trend: call out something you're hiding as if -A is watching.",
     [], "callout-copy"),
    ("Cozy-fall jazz beds",
     "My Day Is Good original sound for unproductive-day confessions.",
     [], "mood-bed"),
    ("\"Upside Down\" transitions",
     "Before/after main-character transitions with hand gestures.",
     [], "transition"),
    ("Ceiling-fan wipe transitions",
     "A ceiling fan wipe moves the scene from day to night.",
     [], "transition"),
    ("Red flag / green flag couple test",
     "Partners label statements red flags or green flags.",
     [], "flag-format"),
    ("Unpopular opinion: mornings are bad",
     "Hot take: pineapple on pizza is fine actually.",
     [], "hot-take"),
]

NO_MATCH_CASES = [
    # (title, summary, hashtags) — must match NO family
    ("NFL scores today",
     "The Buffalo Bills won their game on Sunday night. Red zone defense was strong.",
     ["#nfl"]),
    ("AI keeps pissing off mathematicians",
     "A new paper argues the proof is wrong. Hot debate in the comments.",  # "hot take" is a phrase here — "hot take:" with colon is the hook form; plain prose shouldn't count
     []),
    ("This is dumb",
     "A creator reacts to a viral video. It's fine, be okay with it.",  # "be okay" (no word-boundary "be ok")
     []),
    ("October calendar memes",
     "The month as a loading bar for your niche's big day.",
     ["#halloween"]),
]

fails = []
n_checks = [0]


def check(name, cond, detail=""):
    n_checks[0] += 1
    print(("PASS" if cond else "FAIL"), "-", name, detail if not cond else "")
    if not cond:
        fails.append(name)


for title, summary, tags, expected in MATCH_CASES:
    got = match_family(title, summary, tags)
    check(f"match '{title[:40]}' -> {expected}", got == expected, f"(got {got})")

for title, summary, tags in NO_MATCH_CASES:
    got = match_family(title, summary, tags)
    check(f"no match for '{title[:40]}'", got is None, f"(got {got})")

# curated file honesty
data = json.load(open(os.path.join(ROOT, "data", "meme_formats.json")))
fams = data.get("families", [])
ids = [f.get("id") for f in fams]
check("family ids unique", len(ids) == len(set(ids)))
for f in fams:
    fid = f.get("id")
    ver = f.get("verification")
    check(f"{fid}: verification in enum", ver in ("verified", "single-source"), f"(got {ver})")
    check(f"{fid}: status in enum", f.get("status") in ("rising", "peak", "fading", "established", "evergreen"),
          f"(got {f.get('status')})")
    check(f"{fid}: has name + description", bool(f.get("name")) and bool(f.get("description")))
    check(f"{fid}: keywords non-empty", bool(f.get("keywords")))
    for ex in f.get("examples", []):
        ex_ver = ex.get("verification", ver)
        sources = ex.get("sources", [])
        check(f"{fid}/{ex.get('name')}: sourced or explicitly single-source",
              bool(sources) or ex_ver == "single-source" or ver == "single-source",
              "(no source and not flagged single-source)")
        for s in sources:
            check(f"{fid}/{ex.get('name')}: source has name+url",
                  bool(s.get("name")) and (s.get("url", "").startswith("http")),
                  f"(got {s})")

check("family_names() covers all", set(family_names()) == set(ids))
check("matcher covers every family id",
      {fid for fid, _n, _p in load_families()} == set(ids))

if fails:
    print(f"\n{len(fails)} FAILURES")
    sys.exit(1)
print(f"\nall {n_checks[0]} checks passed")
