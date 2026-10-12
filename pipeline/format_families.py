#!/usr/bin/env python3
"""Wave 9 — format-family tracking.

Loads data/meme_formats.json (hand-curated from Oct-2026 web research) and
matches topics to format families with conservative word-boundary regexes —
the same recipe as format_tags detection (no ML, no LLM guessing).

Like trend_type, the family is DERIVED and re-computed on every pipeline
run from the topic's current text, so links never go stale when the family
file is re-curated. First family in file order wins; a topic with no match
gets None (most topics are topics, not formats — that's fine).
"""
import json
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), "..")
FORMATS_FILE = os.path.join(ROOT, "data", "meme_formats.json")

_FAMILIES = None  # cached: [(id, name, [(pattern, keyword), ...]), ...]


def load_families(force=False):
    """Return the family table, compiled. Tolerates a missing file (no families)."""
    global _FAMILIES
    if _FAMILIES is None or force:
        table = []
        try:
            with open(FORMATS_FILE) as f:
                data = json.load(f)
        except Exception:
            data = {"families": []}
        for fam in data.get("families", []):
            pats = []
            for kw in fam.get("keywords", []):
                pats.append((re.compile(r"\b" + re.escape(kw) + r"\b"), kw))
            table.append((fam.get("id"), fam.get("name", ""), pats))
        _FAMILIES = table
    return _FAMILIES


def match_family(title, summary, hashtags):
    """Return the family id for one topic, or None if no family matches.

    Matches against title + summary + hashtags (the same full text the
    format_tags detector reads), word-boundary keyword matching, first
    family in file order wins.
    """
    full = " ".join([title or "", summary or "",
                     " ".join(hashtags or [])]).lower()
    for fid, _name, pats in load_families():
        for pat, _kw in pats:
            if pat.search(full):
                return fid
    return None


def family_names():
    """Return {id: name} for every curated family."""
    return {fid: name for fid, name, _pats in load_families()}
