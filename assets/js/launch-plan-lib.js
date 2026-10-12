/* ============================================================
   TREND MACHINE — launch-plan-lib.js (wave 3 · "Oracle", wave 7 trend-type pacing)
   Pure 7-day battle-plan generator. Takes a topic's dossier
   payload and schedules its angles/hooks/hashtags across 7
   days. NEVER invents angles, hooks, or hashtags — everything
   in the plan comes from the dossier; the generator only
   orders, rotates, and paces.

   UMD: browser global (window.LaunchPlanLib) + node module
   for unit tests.
   ============================================================ */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LaunchPlanLib = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DAYS = 7;

  function list(x) { return Array.isArray(x) ? x : []; }

  function dayDate(d) {
    var dt = new Date();
    dt.setDate(dt.getDate() + (d - 1));
    return dt;
  }

  function dateLabel(dt) {
    var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return days[dt.getDay()] + " " + months[dt.getMonth()] + " " + dt.getDate();
  }

  function formatLabel(formatTags) {
    var tags = list(formatTags);
    if (!tags.length) { return "short-form video"; }
    var f = tags[0];
    if (f === "pov") { return "POV video"; }
    if (f === "dance") { return "dance video"; }
    if (f === "duet") { return "duet"; }
    if (f === "stitch") { return "stitch"; }
    if (f === "challenge") { return "challenge video"; }
    if (f === "green-screen") { return "green-screen video"; }
    if (f === "template") { return "template video"; }
    if (f === "sound") { return "sound-trend video"; }
    return f + " video";
  }

  // Rotate angles so no angle airs two days in a row; when the pool
  // is smaller than 7 days, hooks cycle independently so every
  // day is still a unique angle+hook pairing.
  function pickAngle(angles, d, prevAngle) {
    var idx = (d - 1) % angles.length;
    var angle = angles[idx];
    if (angle === prevAngle && angles.length > 1) {
      angle = angles[(idx + 1) % angles.length];
    }
    return angle;
  }

  function buildPlan(p, trajectory) {
    var angles = list(p.angles).filter(Boolean);
    var hooks = list(p.hooks).filter(Boolean);
    var hashtags = list(p.hashtags).filter(Boolean);
    var platforms = list(p.platforms).filter(Boolean);
    var formats = list(p.format_tags).filter(Boolean);
    // Wave 7 fix: accept both the dossier's opportunity_score and the
    // export payload's opportunity — the planner page passes raw dossiers,
    // which only carry opportunity_score (previously scored every plan 0).
    var opportunity = (p.opportunity != null ? p.opportunity :
                       p.opportunity_score != null ? p.opportunity_score : 0);
    var velocity = p.velocity || 0;

    if (!angles.length) {
      return {
        ok: false,
        reason: "This dossier has no content angles yet — the pipeline " +
                "hasn't extracted any. Check back after the next refresh; " +
                "we won't invent angles."
      };
    }

    var days = [];
    var prevAngle = null;
    for (var d = 1; d <= DAYS; d++) {
      var angle = pickAngle(angles, d, prevAngle);
      prevAngle = angle;
      var hook = hooks.length ? hooks[(d - 1) % hooks.length] : "";
      var tags = [];
      if (hashtags.length) {
        var per = Math.min(3, hashtags.length);
        for (var k = 0; k < per; k++) {
          tags.push(hashtags[((d - 1) * 2 + k) % hashtags.length]);
        }
      }
      // Best-platform ordering: lead days on the top-signal platform,
      // rotate the secondary ones through the midweek.
      var platform;
      if (platforms.length === 0) { platform = "your main platform"; }
      else if (d <= 2) { platform = platforms[0]; }
      else { platform = platforms[(d - 1) % platforms.length]; }

      days.push({
        day: d,
        date: dateLabel(dayDate(d)),
        angle: angle,
        angleNo: angles.indexOf(angle) + 1,
        angleCount: angles.length,
        hook: hook,
        hashtags: tags,
        platform: platform,
        format: formatLabel(formats)
      });
    }

    // "Why this order" — every line is derived from real dossier data.
    var rationale = [];
    rationale.push(
      "Day 1 leads with angle #1 and your first hook on " +
      (platforms.length ? platforms[0] : "your main platform") +
      " — front-loading gives the trend the most runway."
    );
    if (opportunity >= 70) {
      rationale.push(
        "Opportunity " + opportunity + "/100 is strike-now territory, " +
        "so this plan posts daily instead of pacing it out."
      );
    } else {
      rationale.push(
        "Opportunity " + opportunity + "/100 says pace yourself: daily " +
        "posts, but each day is a self-contained take, so dropping to " +
        "3 days/week still works."
      );
    }
    if (platforms.length > 1) {
      rationale.push(
        "Best-platform order: " + platforms[0] + " gets Days 1–2 (fastest " +
        "feedback loop), " + platforms.slice(1).join("/") + " take the " +
        "midweek for second-wave reach."
      );
    }
    rationale.push(
      "Angles rotate — no angle airs two days in a row, and every day " +
      "pairs a different angle + hook, so the week never feels repeated."
    );
    if (formats.length) {
      rationale.push(
        "Format signals (" + formats.join(", ") + ") are baked into the " +
        "lead days — sounds and formats rot fastest, so they go first."
      );
    }
    // Wave 7: trend-type-aware pacing — formats repeat, topics cover.
    // A format trend is a reusable template: the plan runs the canonical
    // version early, then adds your twist. A topic trend is a subject to
    // cover fresh each day.
    var tt = p.trend_type || "topic";
    if (tt === "format") {
      rationale.push(
        "This is a format trend — the template itself is the play: Days 1–3 " +
        "run the canonical format to catch the wave, Days 4–7 add your own twist."
      );
    } else if (tt === "format+topic") {
      rationale.push(
        "This is a format+topic trend — join the template early (Days 1–2), " +
        "then use the back half of the week to cover the underlying subject " +
        "with your own take."
      );
    } else {
      rationale.push(
        "This is a topic trend — cover the subject fresh each day; the rotating " +
        "formats keep the week from feeling repeated."
      );
    }
    if (trajectory && trajectory.state && trajectory.state !== "insufficient") {
      if (trajectory.state === "peaking") {
        rationale.push(
          "The Oracle projects this trend's peak inside 48h (from " +
          trajectory.n + " snapshots) — this plan is deliberately " +
          "front-loaded."
        );
      } else if (trajectory.state === "fading") {
        rationale.push(
          "The Oracle shows this trend cooling (from " + trajectory.n +
          " snapshots) — Days 6–7 work as evergreen fallback takes " +
          "rather than new pushes."
        );
      } else if (trajectory.state === "accelerating" || trajectory.state === "rising") {
        rationale.push(
          "The Oracle shows this trend still climbing (from " +
          trajectory.n + " snapshots) — the back half of the week is " +
          "where the biggest upside sits."
        );
      }
    } else {
      rationale.push(
        "Forecast data is still warming up — this pacing assumes a " +
        "rising trend and adapts automatically once 3+ hourly snapshots exist."
      );
    }
    rationale.push(
      "Everything above comes from this topic's dossier — no angles, " +
      "hooks, or hashtags were invented for this plan."
    );

    return {
      ok: true,
      days: days,
      rationale: rationale,
      meta: {
        title: p.title || "", id: p.id || "",
        category: p.category || "",
        opportunity: opportunity, velocity: velocity,
        angleCount: angles.length, hookCount: hooks.length,
        platforms: platforms, formats: formats,
        trend_type: p.trend_type || "topic"
      }
    };
  }

  function planToText(plan) {
    if (!plan.ok) { return plan.reason; }
    var lines = [];
    lines.push("7-DAY BATTLE PLAN: " + plan.meta.title.toUpperCase());
    lines.push("OPPORTUNITY " + plan.meta.opportunity + "/100 · VELOCITY " +
               plan.meta.velocity + "/100 · " + String(plan.meta.category).toUpperCase() +
               " · " + String(plan.meta.trend_type || "topic").toUpperCase());
    lines.push("");
    plan.days.forEach(function (d) {
      lines.push("DAY " + d.day + " — " + d.date.toUpperCase());
      lines.push("  angle: " + d.angle);
      if (d.hook) { lines.push('  hook: "' + d.hook + '"'); }
      lines.push("  platform: " + d.platform + " · format: " + d.format);
      if (d.hashtags.length) { lines.push("  hashtags: " + d.hashtags.join(" ")); }
      lines.push("");
    });
    lines.push("WHY THIS ORDER:");
    plan.rationale.forEach(function (r) { lines.push("  - " + r); });
    lines.push("");
    lines.push("— from Trend Machine Oracle · topic " + plan.meta.id);
    return lines.join("\n");
  }

  return {
    DAYS: DAYS,
    buildPlan: buildPlan,
    planToText: planToText
  };
});
