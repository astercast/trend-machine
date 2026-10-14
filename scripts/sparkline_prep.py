"""trend-machine, wave 8: pure sparkline data prep + SVG builders.

Everything here is a pure function of the snapshot points (no I/O, no DOM)
so the math is unit-testable with pinned fixtures (scripts/test_sparkline_prep.py).

Honesty contract (wave-8 mandate):
  - A series needs >= MIN_POINTS snapshots to draw a line. Fewer than that
    renders the "history building" state, never a fake two-point line.
  - All SVGs are static (no <animate>, no JS) so they are reduced-motion safe.
  - Every SVG gets role="img" + a data-grounded aria-label.
  - Every rendered sparkline ships with a screen-reader data-table
    alternative (<details> with the raw snapshot rows).
"""
import datetime
import html as _html

MIN_POINTS = 3  # honest threshold: forecasts + sparklines unlock together


def esc(s):
    return _html.escape(str(s or ""), quote=True)


def tracked_since_label(pts):
    """Honest 'tracked since <date>' label from the first history point."""
    try:
        dt = datetime.datetime.fromisoformat(pts[0][0])
        return dt.strftime("%b %d, %Y")
    except Exception:
        return "recently"


def prep_series(pts, width=260, height=48, pad=5):
    """Normalize snapshot points to SVG coordinates.

    pts: [[iso_ts, velocity], ...] (a third [iso, vel, opp] element is ignored).
    Returns a dict with everything renderers need; "ready" is False when the
    series is too thin to draw honestly.
    """
    pts = list(pts or [])
    vals = [p[1] for p in pts]
    n = len(pts)
    prep = {
        "n": n,
        "ready": n >= MIN_POINTS,
        "width": width,
        "height": height,
        "first": vals[0] if vals else None,
        "last": vals[-1] if vals else None,
        "delta": (vals[-1] - vals[0]) if len(vals) >= 2 else 0,
        "since": tracked_since_label(pts) if pts else None,
        "coords": [],
    }
    if n >= 2:
        lo, hi = min(vals), max(vals)
        span = max(1, hi - lo)
        for i, v in enumerate(vals):
            x = pad + (i * (width - 2 * pad) / (n - 1))
            y = height - pad - ((v - lo) / span) * (height - 2 * pad)
            prep["coords"].append(f"{x:.1f},{y:.1f}")
    return prep


def sparkline_svg(prep, css_class="spark", label_prefix="Spreading trend",
                  last_dot=True):
    """Inline SVG polyline from a prepped series. Static, no animation.

    Returns "" when the series is not ready, callers must render the
    honest empty state instead.
    """
    if not prep["ready"] or not prep["coords"]:
        return ""
    w, h = prep["width"], prep["height"]
    aria = (f"{label_prefix}: {prep['first']} when tracking started "
            f"({prep['since']}), {prep['last']} at the latest reading "
            f"({prep['n']} readings).")
    last_x, last_y = prep["coords"][-1].split(",")
    dot = (f'<circle cx="{last_x}" cy="{last_y}" r="3.2"/>'
           if last_dot else "")
    return (
        f'<svg class="{css_class}" viewBox="0 0 {w} {h}" role="img" '
        f'aria-label="{esc(aria)}" focusable="false">'
        f'<polyline points="{" ".join(prep["coords"])}" fill="none"/>'
        f'{dot}</svg>'
    )


def empty_state_html(n, what="velocity"):
    """Honest 'history building' state, never a fake line."""
    more = max(0, MIN_POINTS - n)
    return (
        f'<p class="hist-empty" role="note">History building: {what} tracking '
        f'started recently ({n} snapshot{"s" if n != 1 else ""} so far). '
        f'A sparkline appears after {more} more hourly refresh'
        f'{"es" if more != 1 else ""}. No line drawn until the data is real.</p>'
    )


def data_table_html(pts, table_id, caption="Velocity snapshots"):
    """Screen-reader data-table alternative for a sparkline.

    Visually a collapsed <details>; the table itself is real <table> markup
    so assistive tech can read every snapshot.
    """
    rows = []
    for p in pts or []:
        ts = p[0]
        try:
            dt = datetime.datetime.fromisoformat(ts)
            ts_label = dt.strftime("%b %d, %Y %H:%M UTC")
        except Exception:
            ts_label = str(ts)
        rows.append(
            f"<tr><td>{esc(ts_label)}</td>"
            f'<td class="num">{int(p[1])}</td></tr>')
    return (
        f'<details class="spark-data"><summary>View the readings '
        f'({len(pts)} point{"s" if len(pts) != 1 else ""})</summary>'
        f'<table id="{esc(table_id)}"><caption>{esc(caption)}</caption>'
        f"<thead><tr><th scope=\"col\">Snapshot</th>"
        f"<th scope=\"col\">Velocity</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table></details>"
    )


def sparkline_figure_html(pts, topic_id, per_platform=None):
    """Full dossier figure: main sparkline + per-platform mini-sparklines.

    per_platform: {platform: [[iso, vel], ...]} from
    data/platform_velocity_history.json (wave 6). Platforms with >=3
    snapshots get a mini sparkline; thinner ones get the honest label.
    """
    prep = prep_series(pts)
    if prep["ready"]:
        svg = sparkline_svg(prep)
        delta = prep["delta"]
        arrow = "\u25b2" if delta > 0 else ("\u25bc" if delta < 0 else "\u25cf")
        caption = (
            f'<p class="hist-cap">Velocity tracked since {esc(prep["since"])} \u00b7 '
            f'{prep["n"]} snapshot{"s" if prep["n"] != 1 else ""} \u00b7 '
            f'<span class="num">{esc(arrow)} {abs(delta):+d}</span> since tracking started</p>')
        body = svg + caption + data_table_html(
            pts, f"spark-data-{esc(topic_id)}",
            "Spread readings for this topic")
    else:
        body = empty_state_html(prep["n"])

    plats_html = ""
    if per_platform:
        parts = []
        for plat in sorted(per_platform.keys()):
            ppts = per_platform[plat]
            pprep = prep_series(ppts, width=120, height=30, pad=4)
            if pprep["ready"]:
                psvg = sparkline_svg(
                    pprep, css_class="spark spark-mini",
                    label_prefix=f"{plat} velocity trend", last_dot=False)
                d = pprep["delta"]
                arrow = "\u25b2" if d > 0 else ("\u25bc" if d < 0 else "\u25cf")
                parts.append(
                    f'<div class="plat-spark"><span class="plat-name">{esc(plat)}</span>'
                    f"{psvg}"
                    f'<span class="plat-delta num" aria-hidden="true">{esc(arrow)} {abs(d):+d}</span>'
                    f'<span class="visually-hidden">{esc(plat)}: {pprep["first"]} to '
                    f'{pprep["last"]} over {pprep["n"]} snapshots.</span></div>')
            else:
                parts.append(
                    f'<div class="plat-spark plat-building"><span class="plat-name">{esc(plat)}</span>'
                    f'<span class="plat-note">history building '
                    f'({pprep["n"]} snapshot{"s" if pprep["n"] != 1 else ""})</span></div>')
        plats_html = (
            '<div class="plat-sparks" role="group" '
            'aria-label="Per-platform velocity sparklines">'
            + "".join(parts) + "</div>")

    return (
        f'<figure class="sig-hist"><figcaption class="hist-label">'
        f'Signal history <span class="hist-note">\u00b7 last 14 days max</span></figcaption>'
        f"{body}{plats_html}</figure>")


def _dlabel(iso):
    """Short date label for annotation sentences: 'Oct 12'."""
    try:
        dt = datetime.datetime.fromisoformat(str(iso))
        return dt.strftime("%b ") + str(dt.day)
    except Exception:
        return "the first snapshot"


def movement_sentences(pts):
    """Wire sentences composed from the series itself (rotation 22,
    TREND-STUDY §4.3): the dossier's one drawn evidence piece is
    annotated inside the drawing in complete sentences that state only
    what the stored snapshots hold. No sentence is printed that the
    data cannot carry."""
    vals = [p[1] for p in pts or []]
    if len(vals) < 2:
        return []
    n = len(vals)
    first, last = vals[0], vals[-1]
    d1, d2 = _dlabel(pts[0][0]), _dlabel(pts[-1][0])
    out = []
    if len(set(vals)) == 1:
        out.append("Spreading held at %d across all %d readings, %s to %s."
                   % (first, n, d1, d2))
    elif last > first:
        out.append("Spreading rose from %d on %s to %d on %s across %d readings."
                   % (first, d1, last, d2, n))
    elif last < first:
        out.append("Spreading fell from %d on %s to %d on %s across %d readings."
                   % (first, d1, last, d2, n))
    else:
        out.append("Spreading ended where it started, at %d, across %d readings, %s to %s."
                   % (last, n, d1, d2))
    peak = max(vals)
    if peak > max(first, last):
        out.append("It peaked at %d on %s." % (peak, _dlabel(pts[vals.index(peak)][0])))
    return out


def _wrap_words(text, width):
    lines, cur = [], ""
    for w in text.split():
        if cur and len(cur) + 1 + len(w) > width:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w) if cur else w
    if cur:
        lines.append(cur)
    return lines


def evidence_block_html(pts, topic_id, per_platform=None):
    """Rotation 22 (TREND-STUDY §4.3): the dossier's ONE drawn evidence
    piece — the topic's velocity across its stored window, annotated
    inside the drawing in wire sentences — followed by the per-platform
    movers as text sublines (never a second drawing). A series thinner
    than MIN_POINTS draws nothing and prints the honest line: the
    sources below are the record."""
    pts = list(pts or [])
    prep = prep_series(pts, width=560, height=150, pad=12)
    head = ('<figure class="sig-hist ev-fig"><figcaption class="hist-label">'
            'Evidence <span class="hist-note">\u00b7 its spread across the '
            'tracked days</span></figcaption>')
    if prep["ready"]:
        sentences = movement_sentences(pts)
        lines = _wrap_words(" ".join(sentences), 84)
        if len(lines) > 3 and len(sentences) > 1:
            lines = _wrap_words(sentences[0], 84)
        anno_h = 14 + 17 * len(lines) + 8
        lo = min(p[1] for p in pts)
        hi = max(p[1] for p in pts)
        span = max(1, hi - lo)
        top, bottom = anno_h, 150 - 12
        coords = []
        for i, p in enumerate(pts):
            x = 12 + (i * (560 - 24) / (len(pts) - 1))
            y = bottom - ((p[1] - lo) / span) * (bottom - top)
            coords.append("%.1f,%.1f" % (x, y))
        last_x, last_y = coords[-1].split(",")
        texts = "".join(
            '<text class="ev-anno" x="12" y="%d">%s</text>'
            % (16 + 17 * i, esc(line)) for i, line in enumerate(lines))
        aria = ("Spreading evidence: %s when tracking started (%s), %s at "
                "the latest reading (%d readings)."
                % (prep["first"], prep["since"], prep["last"], prep["n"]))
        svg = ('<svg class="spark ev-svg" viewBox="0 0 560 150" role="img" '
               'aria-label="%s" focusable="false">%s'
               '<polyline points="%s" fill="none"/>'
               '<circle cx="%s" cy="%s" r="3.2"/></svg>'
               % (esc(aria), texts, " ".join(coords), last_x, last_y))
        delta = prep["delta"]
        arrow = "\u25b2" if delta > 0 else ("\u25bc" if delta < 0 else "\u25cf")
        caption = (
            '<p class="hist-cap">Spreading tracked since %s \u00b7 '
            '%d reading%s \u00b7 <span class="num">%s %+d</span> since '
            'tracking started</p>'
            % (esc(prep["since"]), prep["n"],
               "s" if prep["n"] != 1 else "", esc(arrow), delta))
        body = svg + caption + data_table_html(
            pts, "spark-data-%s" % esc(topic_id),
            "Spreading readings for this topic")
    else:
        body = (
            '<p class="ev-none">The record holds %d reading%s '
            'for this topic, too few to draw honestly, so no chart is '
            'drawn. The sources below are the record.</p>'
            % (prep["n"], "s" if prep["n"] != 1 else ""))
    movers = ""
    if per_platform:
        rows = []
        for plat in sorted(per_platform.keys()):
            ppts = per_platform[plat]
            pp = prep_series(ppts)
            if pp["ready"] or pp["n"] >= 2:
                rows.append(
                    "<li>%s \u00b7 spreading %s to %s across %d readings</li>"
                    % (esc(plat), pp["first"], pp["last"], pp["n"]))
            else:
                rows.append(
                    "<li>%s \u00b7 still building, %d reading%s so far</li>"
                    % (esc(plat), pp["n"], "s" if pp["n"] != 1 else ""))
        if rows:
            movers = ('<div class="movers"><p class="movers-h">Movers, by '
                      'platform</p><ul>' + "".join(rows) + "</ul></div>")
    return head + body + "</figure>" + movers


def flat_velocity_trend(topic_id, history, phist):
    """Compact velocity-trend summary for the flat consumer feed.

    Adds a pre-rendered mini sparkline SVG (ready series only) plus
    per-platform mini-summaries, all from real snapshot data.
    """
    pts = (history or {}).get(topic_id, [])
    prep = prep_series(pts, width=120, height=28, pad=4)
    plat = {}
    for p, ppts in sorted(((phist or {}).get(topic_id, {}) or {}).items()):
        pp = prep_series(ppts, width=120, height=28, pad=4)
        plat[p] = {
            "snapshots": pp["n"],
            "latest_velocity": pp["last"],
            "delta": pp["delta"],
            "sparkline_svg": sparkline_svg(
                pp, css_class="spark spark-mini",
                label_prefix=f"{p} spreading trend",
                last_dot=False) if pp["ready"] else None,
        }
    return {
        "snapshots": prep["n"],
        "state": "ready" if prep["ready"] else "building",
        "since": prep["since"],
        "first_velocity": prep["first"],
        "latest_velocity": prep["last"],
        "delta": prep["delta"],
        "sparkline_svg": sparkline_svg(
            prep, css_class="spark spark-mini",
            label_prefix="Velocity trend",
            last_dot=False) if prep["ready"] else None,
        "per_platform": plat,
    }
