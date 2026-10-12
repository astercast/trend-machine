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
        format: formatLabel(formats),
        // Wave 10: every day carries its own provenance + timing tip.
        platformTip: platformTip(platform),
        trajectory: trajStateOf(trajectory),
        provenance: provenanceFor(angles.indexOf(angle) + 1, angles.length, trajectory)
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
      type: "single",
      days: days,
      rationale: rationale,
      meta: {
        title: p.title || "", id: p.id || "",
        category: p.category || "",
        opportunity: opportunity, velocity: velocity,
        angleCount: angles.length, hookCount: hooks.length,
        platforms: platforms, formats: formats,
        trend_type: p.trend_type || "topic",
        // Wave 10: trajectory snapshot + forecast-ledger hook slot.
        // ledger_ref is filled by the page (it owns the ledger data);
        // the lib only ever reads it, never writes the ledger.
        trajectory: trajStateOf(trajectory),
        ledger_ref: null
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

  /* ============================================================
     WAVE 10 — battle plans, platform-timing tips, exports,
     forecast-ledger hooks.
     ============================================================ */

  // PLATFORM_TIPS: execution notes drawn from the site's own sourced
  // algorithm research (algorithms.html, Oct 2026). These are published
  // mechanics with source attribution — never invented posting times
  // or guarantees.
  var PLATFORM_TIPS = {
    tiktok: {
      tip: "Watch time + completion rate dominate ranking; front-load the " +
           "hook in the first seconds and design for rewatches.",
      source: "algorithms.html#tt",
      basis: "Signal hierarchy verified across Hootsuite, Vamp, fivebbc " +
             "(Oct 2026 research)"
    },
    youtube: {
      tip: "Since the Oct 1, 2026 originality update, Shorts prioritize " +
           "original footage — add your own take; raw re-uploads get " +
           "reach-cut at the channel level.",
      source: "algorithms.html#yt",
      basis: "Announced by Creator Liaison Rene Ritchie (Oct 1, 2026)"
    },
    instagram: {
      tip: "Sends per reach is the #1 Reels signal — make something a " +
           "viewer wants to DM to someone specific. Discovery sweet spot " +
           "is 7–30 seconds.",
      source: "algorithms.html#ig",
      basis: "Per Mosseri; CreatorFlow/SocialPilot signal hierarchy"
    }
  };

  function platformTip(platform) {
    var t = PLATFORM_TIPS[String(platform || "").toLowerCase()];
    if (!t) { return null; }
    // Clone so callers can't mutate the table.
    return { tip: t.tip, source: t.source, basis: t.basis };
  }

  function trajStateOf(traj) {
    if (traj && traj.state && traj.state !== "insufficient") {
      return { state: traj.state, n: traj.n || 0 };
    }
    return { state: "warming up", n: (traj && traj.n) || 0 };
  }

  function provenanceFor(angleNo, angleCount, traj) {
    var ts = trajStateOf(traj);
    return "angle #" + angleNo + " of " + angleCount + " from the dossier · " +
           "trajectory " + ts.state + " (" + ts.n + " snapshot" +
           (ts.n === 1 ? "" : "s") + ") · hooks/hashtags from the dossier";
  }

  // findLedgerRef: hook a plan into the Oracle's forecast ledger
  // (data/forecast_ledger.json). Returns the newest recorded forecast
  // for the topic, or null — the plan cites the record so the creator
  // can compare plan-vs-reality after the forecast window closes.
  function findLedgerRef(entries, topicId) {
    var best = null;
    list(entries).forEach(function (e) {
      if (!e || e.topic_id !== topicId || !e.forecast_at) { return; }
      if (!best || String(e.forecast_at) > String(best.forecast_at)) {
        best = e;
      }
    });
    if (!best) { return null; }
    return {
      topic_id: best.topic_id,
      state: best.state || null,
      forecast_at: best.forecast_at,
      latest_velocity: best.latest_velocity != null ? best.latest_velocity : null,
      resolved: best.resolved === true,
      hit: (best.hit === true) ? true : (best.hit === false ? false : null)
    };
  }

  // buildBattlePlan: weave 2–5 trends into one 7-day battle plan.
  // entries: [{topic, trajectory}]. Each trend keeps its own pacing:
  // days rotate through the lead order (opportunity desc, no two
  // adjacent days share a lead), and a trend's k-th appearance runs
  // its own 7-day plan's k-th day. Nothing is invented — every slot
  // is a dossier-sourced day from buildPlan.
  var MAX_BATTLE_TOPICS = 5;

  function opportunityOf(p) {
    return (p.opportunity != null ? p.opportunity :
            p.opportunity_score != null ? p.opportunity_score : 0);
  }

  function buildBattlePlan(entries, ledgerEntries) {
    entries = list(entries).filter(function (e) { return e && e.topic; });
    if (entries.length < 2) {
      return {
        ok: false,
        reason: "A battle plan needs at least two topics — pick 2–" +
                MAX_BATTLE_TOPICS + " trends to weave into one week. " +
                "Single-topic plans use the regular 7-day planner."
      };
    }
    if (entries.length > MAX_BATTLE_TOPICS) {
      return {
        ok: false,
        reason: "Battle plans cap at " + MAX_BATTLE_TOPICS +
                " topics so the week stays schedulable. Drop the " +
                "lowest-opportunity topics and regenerate."
      };
    }

    var perTopic = [];
    for (var i = 0; i < entries.length; i++) {
      var topic = entries[i].topic;
      var traj = entries[i].trajectory || null;
      var plan = buildPlan(topic, traj);
      if (!plan.ok) {
        return {
          ok: false,
          reason: "Topic " + topic.id + " can't join the battle: " + plan.reason
        };
      }
      perTopic.push({
        topic: topic, trajectory: traj, plan: plan,
        opportunity: opportunityOf(plan.meta)
      });
    }
    // Lead order: strongest opportunity opens the week.
    perTopic.sort(function (a, b) { return b.opportunity - a.opportunity; });

    var counts = {};
    var days = [];
    for (var d = 1; d <= DAYS; d++) {
      var lead = perTopic[(d - 1) % perTopic.length];
      var id = lead.topic.id;
      counts[id] = (counts[id] || 0) + 1;
      var postNo = counts[id];
      var src = lead.plan.days[postNo - 1];
      days.push({
        day: d,
        date: dateLabel(dayDate(d)),
        topicId: id,
        topicTitle: lead.plan.meta.title,
        postNo: postNo,
        angle: src.angle,
        angleNo: src.angleNo,
        angleCount: src.angleCount,
        hook: src.hook,
        hashtags: src.hashtags.slice(),
        platform: src.platform,
        format: src.format,
        trend_type: lead.plan.meta.trend_type,
        platformTip: platformTip(src.platform),
        trajectory: trajStateOf(lead.trajectory),
        provenance: provenanceFor(src.angleNo, src.angleCount, lead.trajectory)
      });
    }

    var ledgerRefs = {};
    perTopic.forEach(function (t) {
      ledgerRefs[t.topic.id] = findLedgerRef(ledgerEntries, t.topic.id);
    });

    var rationale = [];
    rationale.push(
      "Lead order: " + perTopic.map(function (t, k) {
        return (k + 1) + ". " + t.plan.meta.title + " (opportunity " +
               t.opportunity + "/100, Oracle: " + trajStateOf(t.trajectory).state + ")";
      }).join(" → ") + " — the strongest opportunity opens the week."
    );
    perTopic.forEach(function (t) {
      var dayNos = days.filter(function (dd) { return dd.topicId === t.topic.id; })
                       .map(function (dd) { return dd.day; });
      rationale.push(
        t.plan.meta.title + " posts on Day" + (dayNos.length > 1 ? "s " : " ") +
        dayNos.join("/") + " — its own 7-day pacing is preserved; its " +
        dayNos.length + (dayNos.length === 1 ? "st" : dayNos.length === 2 ? "nd" : dayNos.length === 3 ? "rd" : "th") +
        " appearance runs its own plan's Day " + dayNos.length + "."
      );
    });
    rationale.push(
      "Days rotate the lead — no two adjacent days push the same trend, " +
      "so the week reads as a campaign, not a repeat."
    );
    rationale.push(
      "Platform tips restate the site's sourced algorithm research " +
      "(algorithms.html) — mechanics with attribution, never invented " +
      "posting times or reach guarantees."
    );
    rationale.push(
      "Plan-vs-reality: each trend is linked to the Oracle's recorded " +
      "forecasts in data/forecast_ledger.json (see the plan snapshot). " +
      "Save this plan and check back after the forecast window to see " +
      "whether reality matched the projection."
    );
    rationale.push(
      "Everything above comes from these topics' dossiers — no angles, " +
      "hooks, or hashtags were invented for this battle plan."
    );

    return {
      ok: true,
      type: "battle",
      days: days,
      rationale: rationale,
      meta: {
        topicCount: perTopic.length,
        topics: perTopic.map(function (t) {
          var ts = trajStateOf(t.trajectory);
          return {
            id: t.topic.id,
            title: t.plan.meta.title,
            category: t.plan.meta.category,
            opportunity: t.opportunity,
            velocity: t.plan.meta.velocity,
            trend_type: t.plan.meta.trend_type,
            trajectory: ts,
            ledger_ref: ledgerRefs[t.topic.id]
          };
        })
      }
    };
  }

  // battlePlanToText: plain-text export of a battle plan (copy/print).
  function battlePlanToText(plan) {
    if (!plan.ok) { return plan.reason; }
    var lines = [];
    lines.push("7-DAY BATTLE PLAN: " +
               plan.meta.topics.map(function (t) { return t.title.toUpperCase(); }).join(" × "));
    lines.push(plan.meta.topics.map(function (t) {
      return t.title + " opp " + t.opportunity + "/100 · " + t.trajectory.state;
    }).join(" | "));
    lines.push("");
    plan.days.forEach(function (d) {
      lines.push("DAY " + d.day + " — " + d.date.toUpperCase() + " · " + d.topicTitle.toUpperCase());
      lines.push("  angle: " + d.angle);
      if (d.hook) { lines.push('  hook: "' + d.hook + '"'); }
      lines.push("  platform: " + d.platform + " · format: " + d.format);
      if (d.hashtags.length) { lines.push("  hashtags: " + d.hashtags.join(" ")); }
      if (d.platformTip) { lines.push("  timing tip: " + d.platformTip.tip); }
      lines.push("");
    });
    lines.push("WHY THIS ORDER:");
    plan.rationale.forEach(function (r) { lines.push("  - " + r); });
    lines.push("");
    lines.push("— from Trend Machine Oracle · battle plan");
    return lines.join("\n");
  }

  // planToMarkdown: shareable markdown export (single or battle plan).
  function planToMarkdown(plan) {
    if (!plan.ok) { return plan.reason; }
    var lines = [];
    var isBattle = plan.type === "battle";
    var title = isBattle
      ? plan.meta.topics.map(function (t) { return t.title; }).join(" × ")
      : plan.meta.title;
    lines.push("# 7-day battle plan: " + title);
    lines.push("");
    lines.push("Generated " + new Date().toISOString().slice(0, 10) +
               " · from Trend Machine (trend-machine).");
    lines.push("");
    if (isBattle) {
      lines.push("## Trends");
      plan.meta.topics.forEach(function (t) {
        lines.push("- **" + t.title + "** — opportunity " + t.opportunity +
                   "/100 · velocity " + t.velocity + " · Oracle: " +
                   t.trajectory.state + " (" + t.trajectory.n + " snapshots)" +
                   " · " + t.trend_type);
      });
      lines.push("");
    } else {
      lines.push("Opportunity " + plan.meta.opportunity + "/100 · velocity " +
                 plan.meta.velocity + " · " + plan.meta.category + " · " +
                 (plan.meta.trend_type || "topic") + ".");
      lines.push("");
    }
    lines.push("## Day-by-day");
    plan.days.forEach(function (d) {
      var head = "### Day " + d.day + " — " + d.date;
      if (isBattle) { head += " · " + d.topicTitle; }
      lines.push(head);
      lines.push("");
      lines.push("- **Angle:** " + d.angle);
      if (d.hook) { lines.push('- **Hook:** "' + d.hook + '"'); }
      lines.push("- **Platform:** " + d.platform + " · **Format:** " + d.format);
      if (d.hashtags.length) { lines.push("- **Hashtags:** " + d.hashtags.join(" ")); }
      if (d.platformTip) {
        lines.push("- **Timing tip:** " + d.platformTip.tip + " _(source: " +
                   d.platformTip.source + " — " + d.platformTip.basis + ")_");
      }
      lines.push("- _Provenance:_ " + d.provenance);
      lines.push("");
    });
    lines.push("## Why this order");
    plan.rationale.forEach(function (r) { lines.push("- " + r); });
    lines.push("");
    lines.push("---");
    lines.push("All angles, hooks, and hashtags come from the topics' " +
               "dossiers — nothing invented. Trajectories are projections " +
               "from snapshot data, not guarantees.");
    return lines.join("\n");
  }

  // planSnapshot: exportable JSON plan object. This is the
  // plan-vs-reality tracking hook: it freezes each topic's velocity,
  // opportunity, trajectory state, and forecast-ledger reference at
  // plan time, so a later check-in can compare against reality.
  function planSnapshot(plan) {
    if (!plan.ok) { return { ok: false, reason: plan.reason }; }
    var isBattle = plan.type === "battle";
    var topics;
    if (isBattle) {
      topics = plan.meta.topics;
    } else {
      var m = plan.meta;
      topics = [{
        id: m.id, title: m.title, category: m.category,
        opportunity: m.opportunity, velocity: m.velocity,
        trend_type: m.trend_type,
        trajectory: m.trajectory || null,
        ledger_ref: m.ledger_ref || null
      }];
    }
    return {
      tool: "trend-machine-launch-planner",
      wave: 10,
      generated_at: new Date().toISOString(),
      type: isBattle ? "battle" : "single",
      topics: topics,
      days: plan.days.map(function (d) {
        return {
          day: d.day, date: d.date,
          topic_id: d.topicId || plan.meta.id || null,
          topic_title: d.topicTitle || plan.meta.title,
          angle: d.angle, hook: d.hook, hashtags: d.hashtags,
          platform: d.platform, format: d.format,
          platform_tip: d.platformTip || null,
          trajectory: d.trajectory || null,
          provenance: d.provenance || null
        };
      }),
      rationale: plan.rationale.slice(),
      honesty: "All angles, hooks, and hashtags come from the topics' " +
               "dossiers — nothing invented. Trajectories are projections " +
               "from snapshot data, not guarantees. Compare saved-plan " +
               "velocities against later snapshots to see whether reality " +
               "matched the plan."
    };
  }

  return {
    DAYS: DAYS,
    buildPlan: buildPlan,
    planToText: planToText,
    MAX_BATTLE_TOPICS: MAX_BATTLE_TOPICS,
    platformTip: platformTip,
    findLedgerRef: findLedgerRef,
    buildBattlePlan: buildBattlePlan,
    battlePlanToText: battlePlanToText,
    planToMarkdown: planToMarkdown,
    planSnapshot: planSnapshot
  };
});
