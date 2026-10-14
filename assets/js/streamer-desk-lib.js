/* trend-machine — Streamer Desk client lib (wave 29 / rotation 12).
   Pure rendering helpers for streamer-desk.html. Honesty contract:
   verified drama renders as a sourced timeline; unverified claims
   render ONLY in the quarantined section, badged UNVERIFIED, with
   the reason they do not meet the bar. Rosters print their as-of
   date. Event badges come from the payload's computed status.
   UMD: browser global TM_StreamerDesk + node require for tests. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else { root.TM_StreamerDesk = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function sourcesHTML(sources) {
    if (!sources || !sources.length) { return ""; }
    return '<span class="sd-srcs">Sources: ' + sources.map(function (s) {
      return '<a href="' + esc(s.url) + '" rel="noopener">' +
        esc(s.name) + "</a>";
    }).join(" · ") + "</span>";
  }
  function summaryHTML(desk) {
    var c = desk.counts || {};
    function fact(v, label) {
      return '<span class="sd-fact"><span class="sd-fact-v">' +
        esc(v == null ? "0" : v) + '</span> ' + label + "</span>";
    }
    return '<p class="sd-facts" aria-label="Desk counts">' +
      fact(c.streamers, "streamers") + fact(c.houses, "houses") +
      fact(c.updates, "dated updates") +
      fact(c.drama_verified, "Verified timelines") +
      fact(c.unverified, "Unverified (quarantined)") +
      fact(c.events, "events") + "</p>" +
      '<p class="sd-curated">Curated ' + esc(desk.curated_at) +
      " · built " + esc(desk.generated_at) + "</p>";
  }
  function streamersHTML(desk) {
    var houses = {};
    (desk.houses || []).forEach(function (h) { houses[h.id] = h.name; });
    return (desk.streamers || []).map(function (p) {
      var crew = p.crew ? (houses[p.crew] || p.crew) : "Independent";
      return '<article class="sd-row"><div class="sd-row-main">' +
        "<h3>" + esc(p.name) + "</h3>" +
        '<p class="sd-meta">' + esc((p.platforms || []).join(" · ")) +
        " · " + esc((p.categories || []).join(", ")) + "</p>" +
        "<p>" + esc(p.note) + "</p>" +
        '<p class="sd-crew">Crew: ' + esc(crew) +
        ' · roster facts as of ' + esc(p.as_of) + "</p>" +
        sourcesHTML(p.sources) + "</div></article>";
    }).join("");
  }
  function updatesHTML(desk) {
    return (desk.updates || []).map(function (u) {
      return '<article class="sd-row"><div class="sd-row-main">' +
        '<p class="sd-date num">' + esc(u.date) + " · " +
        esc(u.kind) + "</p><h3>" + esc(u.title) + "</h3><p>" +
        esc(u.summary) + "</p>" + sourcesHTML(u.sources) +
        "</div></article>";
    }).join("");
  }
  function dramaHTML(desk) {
    return (desk.drama || []).map(function (d) {
      var items = (d.timeline || []).map(function (ev) {
        return '<li><span class="sd-date num">' + esc(ev.date) +
          "</span><p>" + esc(ev.event) + "</p>" +
          sourcesHTML(ev.sources) + "</li>";
      }).join("");
      return '<article class="sd-drama"><h3>' + esc(d.title) +
        ' <span class="sd-badge ok">Verified · multi-source</span></h3>' +
        '<ol class="sd-timeline">' + items + "</ol>" +
        '<p class="sd-note">' + esc(d.note) + "</p></article>";
    }).join("");
  }
  function unverifiedHTML(desk) {
    var list = desk.unverified || [];
    if (!list.length) {
      return '<p class="sd-note">Nothing is quarantined right now.</p>';
    }
    return list.map(function (u) {
      return '<article class="sd-row sd-unv"><div class="sd-row-main">' +
        '<h3>' + esc(u.title) +
        ' <span class="sd-badge warn">Unverified</span></h3>' +
        "<p>" + esc(u.claim) + "</p>" +
        '<p class="sd-note">Why unverified: ' + esc(u.why_unverified) +
        "</p>" + sourcesHTML(u.sources) + "</div></article>";
    }).join("");
  }
  function housesHTML(desk) {
    return (desk.houses || []).map(function (h) {
      var members = (h.members || []).length
        ? "<p><strong>Members (as of " + esc(h.members_as_of) + "):</strong> " +
          esc(h.members.join("; ")) + "</p>"
        : "<p><strong>No current members</strong>. Roster as of " +
          esc(h.members_as_of) + ".</p>";
      var former = (h.former_members || []).length
        ? '<p class="sd-note">Former: ' + esc(h.former_members.join("; ")) +
          "</p>" : "";
      return '<article class="sd-row"><div class="sd-row-main">' +
        "<h3>" + esc(h.name) + ": " + esc(h.full_name) + "</h3>" +
        '<p class="sd-meta">' + esc(h.base) + " · founded " +
        esc(h.founded) + " · " + esc(h.status) + "</p>" +
        "<p>" + esc(h.content) + "</p>" + members + former +
        sourcesHTML(h.sources) + "</div></article>";
    }).join("");
  }
  function eventsHTML(desk) {
    return (desk.events || []).map(function (e) {
      var badge = e.status === "upcoming"
        ? '<span class="sd-badge ok">Upcoming</span>'
        : (e.status === "happening-now"
          ? '<span class="sd-badge ok">Happening now</span>'
          : '<span class="sd-badge dim">Past</span>');
      return '<article class="sd-row"><div class="sd-row-main">' +
        '<p class="sd-date num">' + esc(e.start) + " → " + esc(e.end) +
        " · " + esc(e.kind) + "</p><h3>" + esc(e.name) + " " + badge +
        "</h3><p>" + esc(e.note) + "</p>" +
        '<p class="sd-meta">' + esc(e.location) + "</p>" +
        sourcesHTML(e.sources) + "</div></article>";
    }).join("");
  }
  function feedsHTML(desk) {
    return (desk.feeds || []).map(function (f) {
      return '<article class="sd-row"><div class="sd-row-main">' +
        "<h3>" + esc(f.label) +
        ' <span class="sd-badge dim">Skip by design</span></h3><p>' +
        esc(f.detail) + "</p></div></article>";
    }).join("");
  }

  return {
    esc: esc, sourcesHTML: sourcesHTML, summaryHTML: summaryHTML,
    streamersHTML: streamersHTML, updatesHTML: updatesHTML,
    dramaHTML: dramaHTML, unverifiedHTML: unverifiedHTML,
    housesHTML: housesHTML, eventsHTML: eventsHTML, feedsHTML: feedsHTML
  };
});
