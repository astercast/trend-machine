/* trend-machine — wave 37: pure board-filter lib for the dashboard.
   Two jobs, both pure (no DOM) and unit-tested with pinned fixtures
   (scripts/test_board_filter.js):

   1. Phase classification for the board's Phase filter. The phases are
      the Oracle's own calls, read from data/v1/forecasts.json — the
      same classifier output oracle.html prints. A topic the classifier
      has not called (fewer than 3 snapshots) is "nocall" — never
      guessed, never smoothed into a neighbouring phase.

   2. URL state for the board's filters (wave-11 flagged follow-up #3:
      URL-state-synced filters -> shareable filtered views). parseQuery
      reads an inbound link's query string into a filter-state patch;
      toQuery serializes the non-default state back out. Defaults are
      omitted, so the plain board keeps a clean URL and only a filtered
      view carries parameters. Node-safe: exports when module exists. */
var TM_BoardFilter = (function () {
  "use strict";

  /* forecast list key -> board phase key. The four lists in
     forecasts.json are disjoint by construction (rankLists partitions
     the classified topics); if a payload ever double-lists an id, the
     earlier list wins — peaking is the most time-critical call. */
  var LIST_PHASES = [
    ["peaking_48h", "peaking"],
    ["rising_fast", "rising"],
    ["cooling_off", "fading"],
    ["steady", "steady"]
  ];

  var PHASES = [
    { key: "all", label: "all phases" },
    { key: "peaking", label: "peaking in 48h" },
    { key: "rising", label: "rising fast" },
    { key: "fading", label: "cooling off" },
    { key: "steady", label: "steady" },
    { key: "nocall", label: "no call yet" }
  ];
  var PHASE_KEYS = {};
  PHASES.forEach(function (p) { PHASE_KEYS[p.key] = 1; });

  var SORT_KEYS = { opportunity: 1, velocity: 1, recency: 1 };

  function isPhase(key) { return !!PHASE_KEYS[key]; }

  /* forecasts payload -> { id: phaseKey } for every classified topic. */
  function buildPhaseMap(forecasts) {
    var map = {};
    if (!forecasts) return map;
    LIST_PHASES.forEach(function (pair) {
      var list = forecasts[pair[0]] || [];
      list.forEach(function (e) {
        if (e && e.id && !(e.id in map)) map[e.id] = pair[1];
      });
    });
    return map;
  }

  /* A topic's phase: its classified call, or "nocall" when the
     classifier has not called it (or the payload never arrived). */
  function phaseOf(map, id) {
    return (map && map[id]) || "nocall";
  }

  function matchesPhase(map, id, phase) {
    if (!phase || phase === "all") return true;
    return phaseOf(map, id) === phase;
  }

  /* Per-phase counts over a topic list, for the select's labels.
     nocall is derived, never read from the payload: topics minus
     classified topics present in the list. */
  function phaseCounts(map, topics) {
    var counts = { peaking: 0, rising: 0, fading: 0, steady: 0, nocall: 0 };
    (topics || []).forEach(function (t) { counts[phaseOf(map, t.id)] += 1; });
    return counts;
  }

  function phaseOptionsHTML(counts) {
    return PHASES.map(function (p) {
      if (p.key === "all") return '<option value="all">all phases</option>';
      var n = counts ? counts[p.key] : null;
      var label = p.label + (typeof n === "number" ? " (" + n + ")" : "");
      return '<option value="' + p.key + '">' + label + "</option>";
    }).join("");
  }

  /* Inbound link -> filter-state patch. Only known keys with valid
     values survive: an unknown phase or sort in a hand-edited link is
     dropped, never applied — a bad link opens the plain board, not a
     broken one. `dir` rides along only with an explicit sort. */
  function parseQuery(search) {
    var patch = {};
    if (!search) return patch;
    var params;
    try { params = new URLSearchParams(search); } catch (e) { return patch; }
    var phase = params.get("phase");
    if (phase && isPhase(phase) && phase !== "all") patch.phase = phase;
    var platform = params.get("platform");
    if (platform && platform !== "all") patch.platform = platform;
    var category = params.get("category");
    if (category && category !== "all") patch.category = category;
    var q = params.get("q");
    if (q) patch.q = q;
    var sort = params.get("sort");
    if (sort && SORT_KEYS[sort]) {
      patch.sort = sort;
      patch.dir = params.get("dir") === "1" ? 1 : -1;
    }
    return patch;
  }

  /* Filter state -> query string (no leading "?"). Defaults omitted:
     the unfiltered board serializes to "" and its URL stays clean. */
  function toQuery(state) {
    var params = new URLSearchParams();
    if (state.phase && state.phase !== "all") params.set("phase", state.phase);
    if (state.platform && state.platform !== "all") params.set("platform", state.platform);
    if (state.category && state.category !== "all") params.set("category", state.category);
    if (state.q) params.set("q", state.q);
    if (state.sort && state.sort !== "opportunity") {
      params.set("sort", state.sort);
      params.set("dir", String(state.dir === 1 ? 1 : -1));
    } else if (state.sort === "opportunity" && state.dir === 1) {
      params.set("sort", "opportunity");
      params.set("dir", "1");
    }
    return params.toString();
  }

  return {
    PHASES: PHASES,
    LIST_PHASES: LIST_PHASES,
    isPhase: isPhase,
    buildPhaseMap: buildPhaseMap,
    phaseOf: phaseOf,
    matchesPhase: matchesPhase,
    phaseCounts: phaseCounts,
    phaseOptionsHTML: phaseOptionsHTML,
    parseQuery: parseQuery,
    toQuery: toQuery
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = TM_BoardFilter;
}
