/* trend-machine — wave 39 (rotation 20, VP-0011): the One-Look Creator
   Board's data rules, shared by the dashboard (app.js) and pinned by
   scripts/test_board_lib.js. Pure functions, no DOM.

   Two rules live here, and they are the SAME rules scripts/build_site.py
   applies when it bakes data/v1/board.json and the homepage fallback —
   one phenomenon, one row, on every surface:

   1. PHENOMENON MERGES. Some tracked topics are one phenomenon wearing
      two titles (the "6-7" brainrot joke and its "Six Seven" funk-dance
      variant). PHENOMENON_MERGES maps an absorbed topic id to the
      canonical id that survives. The merged row keeps the canonical
      title/id, combines the evidence (platforms / hashtags / sources /
      angles unioned, velocity = max), and recomputes the opportunity
      score with the pipeline's own formula —
      round(velocity * (1 - saturation_penalty)), penalties
      low 0 / medium 0.35 / high 0.6 (pipeline/normalize.py) — using the
      LESS saturated of the merged pair (more corroboration must never
      lower a phenomenon's score for being seen twice). The absorbed
      titles ride along as merged_from so the row can say, on its face,
      that it is two listings combined. The canonical store
      (data/trends.json, data/v1/trends.json) is NOT rewritten: the full
      393-topic record stays intact one layer down, and this view is
      re-derived on every build and every page load, so a refresh can
      never un-merge it.

   2. MAKEABLE vs NEWS. kindOf() is the board's only filter: category
      "news" is straight news (labelled NEWS · WATCH, never mixed into
      the make-now ranking); every other category is creator-makeable.
      Stale topics are excluded by the caller, not hidden here.

   The score itself: "opportunity_score" is an INDEX, 0-100 — velocity
   (spread speed: source corroboration + recency; seeded topics carry
   documented editorial estimates) discounted by saturation (how crowded
   the lane already is). It is not a percentage, not a rise, and it
   promises no views. The board prints evidence chips, never uplift. */
var TM_BoardLib = (function () {
  "use strict";

  var PHENOMENON_MERGES = {
    "seis-sete-dance": "six-seven-meme"
  };

  var SATURATION_PENALTY = { low: 0, medium: 0.35, high: 0.6 };

  function opportunity(velocity, saturation) {
    var pen = SATURATION_PENALTY[saturation];
    if (pen === undefined) pen = 0;
    return Math.round((velocity || 0) * (1 - pen));
  }

  function kindOf(topic) {
    return topic && topic.category === "news" ? "news" : "makeable";
  }

  function union(a, b) {
    var out = [], seen = {};
    (a || []).concat(b || []).forEach(function (x) {
      var k = typeof x === "object" ? (x.name || JSON.stringify(x)) : String(x);
      if (!seen[k]) { seen[k] = 1; out.push(x); }
    });
    return out;
  }

  function lessSaturated(a, b) {
    var pa = SATURATION_PENALTY[a], pb = SATURATION_PENALTY[b];
    if (pa === undefined) return b;
    if (pb === undefined) return a;
    return pa <= pb ? a : b;
  }

  /* mergeTopics(topics) -> a NEW list where every absorbed id has been
     folded into its canonical topic. Input order is preserved apart
     from the absorbed rows disappearing; the canonical row's position
     is its own. Topics not named in PHENOMENON_MERGES pass through
     untouched (same object). A merge whose canonical id is absent
     leaves the absorbed topic in place — a merge never deletes data. */
  function mergeTopics(topics) {
    var byId = {};
    (topics || []).forEach(function (t) { byId[t.id] = t; });
    var absorbed = {};
    Object.keys(PHENOMENON_MERGES).forEach(function (absId) {
      var canId = PHENOMENON_MERGES[absId];
      if (byId[absId] && byId[canId] && absId !== canId) absorbed[absId] = canId;
    });
    if (!Object.keys(absorbed).length) return (topics || []).slice();
    var mergedByCanon = {};
    return (topics || []).filter(function (t) { return !absorbed[t.id]; })
      .map(function (t) {
        var absIds = Object.keys(absorbed).filter(function (a) { return absorbed[a] === t.id; });
        if (!absIds.length) return t;
        if (mergedByCanon[t.id]) return mergedByCanon[t.id];
        var m = {};
        Object.keys(t).forEach(function (k) { m[k] = t[k]; });
        m.merged_from = [];
        absIds.forEach(function (absId) {
          var a = byId[absId];
          m.merged_from.push({ id: a.id, title: a.title });
          m.platforms = union(m.platforms, a.platforms);
          m.hashtags = union(m.hashtags, a.hashtags);
          m.sources = union(m.sources, a.sources);
          m.angles = union(m.angles, a.angles);
          m.hooks = union(m.hooks, a.hooks);
          m.format_tags = union(m.format_tags, a.format_tags);
          m.velocity = Math.max(m.velocity || 0, a.velocity || 0);
          m.saturation = lessSaturated(m.saturation, a.saturation);
          if ((a.last_seen || "") > (m.last_seen || "")) m.last_seen = a.last_seen;
        });
        m.opportunity_score = opportunity(m.velocity, m.saturation);
        mergedByCanon[t.id] = m;
        return m;
      });
  }

  /* boardSelection(mergedTopics) -> { makeNow, newsWatch }: the board's
     two ranked lists. Non-stale only, opportunity desc (velocity breaks
     ties), makeable capped at 7, news capped at 3 and kept apart. */
  function boardSelection(mergedTopics, makeCap, newsCap) {
    makeCap = makeCap === undefined ? 7 : makeCap;
    newsCap = newsCap === undefined ? 3 : newsCap;
    var live = (mergedTopics || []).filter(function (t) { return !t.stale; });
    function byScore(a, b) {
      return (b.opportunity_score - a.opportunity_score) || (b.velocity - a.velocity);
    }
    return {
      makeNow: live.filter(function (t) { return kindOf(t) === "makeable"; }).sort(byScore).slice(0, makeCap),
      newsWatch: live.filter(function (t) { return kindOf(t) === "news"; }).sort(byScore).slice(0, newsCap)
    };
  }

  return {
    PHENOMENON_MERGES: PHENOMENON_MERGES,
    SATURATION_PENALTY: SATURATION_PENALTY,
    opportunity: opportunity,
    kindOf: kindOf,
    mergeTopics: mergeTopics,
    boardSelection: boardSelection
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = TM_BoardLib;
}
