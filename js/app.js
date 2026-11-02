/*
 * Insights page controller. One renderer, four demo tabs; each tab turns on
 * more capabilities so the progression can be shown step by step.
 *
 * Columns are always:  [column 1] → Publisher → Policy → Destination
 *   column 1 = devices (no group-by) or the group-by attribute's values.
 *   The view colours flows by one device attribute; it never changes columns.
 */
(function (TL) {
  'use strict';
  const S = TL.sankey, esc = S.esc, fmt = S.fmt;
  const LAST = TL.MONTHS.length - 1;

  // Capabilities switched on for the page (all on; kept as flags so any can be turned off).
  const FEATURES = { groupBy: true, comments: true, time: true };

  const state = {
    view: 'neutral',
    groupBy: 'device',       // 'device' = one node per device in column 1
    isolate: {},             // { viewId: valueId } — colour only this value
    excluded: {},            // { dim: { valueId: true } }
    query: '',               // device name filter
    selected: null, hover: null,
    month: LAST, baseline: 'none', playing: false,
    sustainOpen: null        // sustainability accordion in tooltips; null = default for the view
  };

  const $ = function (id) { return document.getElementById(id); };
  const el = {
    viewSelect: $('view-select'), hlField: $('hl-field'), groupby: $('groupby'),
    groupbyField: $('groupby-field'), hl: $('hl-switch'), hlLabel: $('lbl-hl'), filter: $('group-filter'), question: $('view-question'),
    kpis: $('kpis'), legend: $('legend'), wrap: $('chart-wrap'), svg: $('sankey'), timeline: $('timeline'),
    comments: $('comments'), tooltip: $('tooltip')
  };

  // ---- derived state --------------------------------------------------
  function tab() { return FEATURES; }
  function view() { return TL.viewById(state.view); }
  function attr() { return TL.ATTRIBUTES[view().attr]; }
  function palette() { return attr().values.map(function (v) { return { id: v.id, color: v.color || null }; }); }
  function groupBy() { return tab().groupBy ? state.groupBy : 'device'; }
  function stages() { return [groupBy()].concat(TL.PIPELINE); }
  function ctx() { return { view: state.view, groupBy: groupBy() }; }
  function month() { return tab().time ? state.month : LAST; }
  function periodIndex() { return Math.round(month()); }
  // which attribute the filter chips act on: the group-by, or (for devices) the view attribute
  function filterDim() { return groupBy() === 'device' ? view().attr : groupBy(); }
  function filterFn() {
    const fd = filterDim(), ex = state.excluded[fd] || {}, q = state.query.trim().toLowerCase();
    const hasEx = Object.keys(ex).length, useQ = q && groupBy() === 'device';
    if (!hasEx && !useQ) return null;
    return function (f) { return !ex[f[fd]] && (!useQ || f.device.indexOf(q) >= 0); };
  }
  function focusFn() {
    const id = state.hover || state.selected; if (!id) return null;
    const p = TL.parseNodeId(id);
    return function (f) { return f[p.dim] === p.val; };
  }
  function aggAt(m, withFocus) {
    return S.aggregate(TL.snapshot(m), stages(), { filter: filterFn(), segAttr: view().attr, focus: withFocus ? focusFn() : null });
  }
  function currentAgg() {
    const m = month(), m0 = Math.floor(m), m1 = Math.min(LAST, Math.ceil(m));
    const a = aggAt(m0, true);
    return m1 === m0 ? a : S.interpolate(a, aggAt(m1, true), m - m0);
  }
  // device counts by value of an attribute (respecting filters)
  function deviceCounts(m, attrId) {
    const seen = {}, out = {}, f = filterFn();
    TL.snapshot(m).forEach(function (x) {
      if (seen[x.device] || (f && !f(x))) return;
      seen[x.device] = 1; out[x[attrId]] = (out[x[attrId]] || 0) + 1;
    });
    out._total = Object.keys(seen).length;
    return out;
  }

  // ---- static UI builders --------------------------------------------
  function buildViewSwitch() {
    // views without a group are top-level options; grouped views nest under an <optgroup>
    let html = '', open = null;
    TL.VIEWS.forEach(function (v) {
      if (v.group !== open) {
        if (open) html += '</optgroup>';
        if (v.group) html += '<optgroup label="' + esc(v.group) + '">';
        open = v.group || null;
      }
      html += '<option value="' + v.id + '"' + (v.id === state.view ? ' selected' : '') + '>' + esc(v.label) + '</option>';
    });
    if (open) html += '</optgroup>';
    el.viewSelect.innerHTML = html;
  }
  function isNeutral() { return view().id === 'neutral'; }
  function buildGroupBy() {
    const opt = function (g, label) {
      return '<option value="' + g + '"' + (g === state.groupBy ? ' selected' : '') + '>' + esc(label) + '</option>';
    };
    el.groupby.innerHTML = TL.GROUP_BY_MENU.map(function (e) {
      if (e.id) return opt(e.id, e.label);
      return '<optgroup label="' + esc(e.group) + '">' + e.items.map(function (g) {
        return opt(g, TL.GROUP_BY_LABELS[g] || TL.ATTRIBUTES[g].label);
      }).join('') + '</optgroup>';
    }).join('');
  }
  function buildHighlight() {
    const a = attr(), iso = state.isolate[state.view] || null;
    const counts = deviceCounts(periodIndex(), view().attr);
    el.hlField.hidden = isNeutral();
    el.hlLabel.textContent = 'Colour by ' + a.label.toLowerCase();
    el.hl.innerHTML = a.values.map(function (v) {
      const on = iso === v.id, dimmed = iso && !on;
      return '<button type="button" role="radio" aria-checked="' + on + '" class="p-chip p-chip--legend' + (on ? ' is-active' : '') + (dimmed ? ' is-dimmed' : '') + '" data-iso="' + v.id + '" title="' + (on ? 'Show all values' : 'Isolate ' + esc(v.label)) + '">' +
        '<span class="swatch' + (v.color ? '' : ' swatch--none') + '" style="background:' + (v.color || '#d3d3d3') + '"></span>' + esc(v.label) +
        '<span class="p-chip__count">' + (counts[v.id] || 0) + '</span></button>';
    }).join('') + (iso ? '<button type="button" class="p-link" data-iso="">Show all</button>' : '');
  }
  function buildGroupFilter() {
    if (!tab().groupBy) { el.filter.hidden = true; return; }
    const g = groupBy(), fd = filterDim();
    const ex = state.excluded[fd] || {};
    const counts = (function () { // unfiltered device counts so excluded chips still show their size
      const seen = {}, out = {};
      TL.snapshot(periodIndex()).forEach(function (x) { if (seen[x.device]) return; seen[x.device] = 1; out[x[fd]] = (out[x[fd]] || 0) + 1; });
      return out;
    })();
    const nEx = Object.keys(ex).length;
    el.filter.hidden = false;
    const search = g === 'device'
      ? '<input type="search" class="p-search" id="device-q" placeholder="Filter devices…" value="' + esc(state.query) + '" aria-label="Filter devices by name">'
      : '';
    if (fd === 'neutral') { // nothing to filter by in the neutral view: devices get the search box only
      el.filter.innerHTML = '<span class="p-group-filter__label">Devices</span>' + search;
      const q0 = $('device-q');
      if (q0) q0.addEventListener('input', function (e) { state.query = e.target.value; render(); });
      return;
    }
    el.filter.innerHTML = '<span class="p-group-filter__label">' + (g === 'device' ? 'Show devices with' : 'Show streams') + '</span>' +
      TL.ATTRIBUTES[fd].values.map(function (v) {
        const on = !ex[v.id];
        return '<button type="button" class="p-filter-chip' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" data-gval="' + v.id + '" title="Click to toggle · Alt-click to show only this">' +
          '<span class="p-filter-chip__check" aria-hidden="true">' + (on ? '✓' : '') + '</span>' + esc(v.label) +
          '<span class="p-filter-chip__count">' + (counts[v.id] || 0) + '</span></button>';
      }).join('') +
      (nEx ? '<button type="button" class="p-link" data-gall="1">Show all</button>' : '') + search;
    const q = $('device-q');
    if (q) q.addEventListener('input', function (e) { state.query = e.target.value; render(); });
  }

  // ---- dynamic render -------------------------------------------------
  let lastLayout = null, rafPending = false;
  function render() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; draw(); });
  }

  function draw() {
    const t = tab(), v = view();
    el.groupbyField.hidden = !t.groupBy;
    const firstColour = attr().values.filter(function (x) { return x.color; })[0].color;
    el.question.innerHTML = '<span class="p-question__swatch" style="background:' + firstColour + '"></span>' + esc(v.question);

    const agg = currentAgg();
    const stg = stages();
    // on small screens keep the chart wide enough to read and let it scroll sideways
    const minW = window.innerWidth <= 760 ? 900 : 720;
    const width = Math.max(minW, el.wrap.clientWidth || 900);
    const n1 = Object.keys(agg.nodes).filter(function (k) { return agg.nodes[k].col === 0; }).length;
    const height = Math.max(460, n1 * (groupBy() === 'device' ? 24 : 62));
    const L = S.layout(agg, stg, width, height);
    lastLayout = L;

    let deltas = null;
    if (t.time && state.baseline !== 'none') {
      const pi = periodIndex();
      const baseM = state.baseline === 'start' ? 0 : Math.max(0, pi - 1);
      if (baseM !== pi) {
        const base = aggAt(baseM, false), cur = aggAt(pi, false);
        deltas = {};
        Object.keys(cur.nodes).forEach(function (k) {
          const b = base.nodes[k] ? base.nodes[k].value : 0;
          deltas[k] = b ? (cur.nodes[k].value - b) / b * 100 : null;
        });
      }
    }

    el.svg.classList.toggle('is-neutral', isNeutral());
    S.render(el.svg, L, {
      palette: palette(),
      isolate: state.isolate[state.view] || null,
      focusId: state.hover || state.selected,
      selectedId: state.selected,
      showCommentBadges: t.comments,
      commentCounts: t.comments ? TL.comments.counts(ctx()) : null,
      deltas: deltas
    });
    el.svg.setAttribute('aria-label', 'Sankey diagram: ' + stg.map(function (d) { return TL.DIMENSIONS[d].label; }).join(' → ') + ', coloured by ' + attr().label);

    drawLegend(stg, L);
    drawKpis(agg);
    if (t.time) drawTimeline(); else el.timeline.hidden = true;
    if (t.comments) drawComments(); else el.comments.hidden = true;
  }

  function drawLegend(stg, L) {
    el.legend.style.width = L.width + 'px';
    el.legend.innerHTML = stg.map(function (d, i) {
      const n = L.nodes.filter(function (x) { return x.col === i; })[0];
      const label = d === 'device' ? 'Device' : TL.DIMENSIONS[d].label;
      return '<span class="chart-legend__col' + (i === stg.length - 1 ? ' is-last' : '') + (i === 0 ? ' is-first' : '') + '" style="left:' + (n ? n.x : 0) + 'px">' + esc(label) + '</span>';
    }).join('');
  }

  function drawKpis(agg) {
    const t = tab(), a = attr(), pi = periodIndex();
    const counts = deviceCounts(pi, view().attr);
    const items = [];
    items.push(kpi('Devices reporting', String(counts._total), fmt(agg.total) + ' events/day · ' + (t.time ? TL.monthLabel(TL.MONTHS[pi]) : 'latest month (' + TL.monthLabel(TL.MONTHS[LAST]) + ')')));
    // distribution bar for the view attribute
    const bar = a.values.map(function (v) {
      const c = counts[v.id] || 0; if (!c) return '';
      return '<span class="p-dist__seg" style="flex:' + c + ';background:' + (v.color || '#d3d3d3') + '" title="' + esc(v.label) + ': ' + c + '"></span>';
    }).join('');
    const iso = state.isolate[state.view];
    if (isNeutral()) {
      // no breakdown to report: summarise the pipeline instead
      const pubs = {}, dests = {};
      Object.keys(agg.nodes).forEach(function (k) { const n = agg.nodes[k]; if (n.dim === 'publisher') pubs[k] = 1; if (n.dim === 'destination') dests[k] = 1; });
      items.push(kpi('Pipeline', Object.keys(pubs).length + ' <span class="p-kpi__unit">snaps → </span>' + Object.keys(dests).length + ' <span class="p-kpi__unit">destinations</span>',
        'Pick a view to colour flows by an attribute'));
    } else if (view().attr === 'lifecycle' && !iso) {
      // the actionable number: devices that would be replaced for software reasons alone
      const sw = counts.software || 0, end = counts.ending || 0;
      items.push(kpi('<span class="dot" style="background:' + TL.valueOf('lifecycle', 'software').color + '"></span>Software-only replacement risk',
        sw + ' <span class="p-kpi__unit">device' + (sw === 1 ? '' : 's') + '</span>' + (end ? ' + ' + end + ' <span class="p-kpi__unit">with support ending</span>' : ''),
        '<span class="p-dist">' + bar + '</span>',
        t.time ? sparkline(TL.MONTHS.map(function (_, m) { const c = deviceCounts(m, 'lifecycle'); return (c.software || 0) + (c.ending || 0); }), TL.valueOf('lifecycle', 'ending').color) : ''));
    } else if (view().attr === 'energy' && !iso) {
      // total measured energy, and what idle-but-powered devices are using
      const e = energyAt(pi);
      items.push(kpi('Measured energy',
        (e.total >= 1000 ? (e.total / 1000).toFixed(1) + ' <span class="p-kpi__unit">MWh/month</span>' : Math.round(e.total) + ' <span class="p-kpi__unit">kWh/month</span>'),
        e.idle + ' idle device' + (e.idle === 1 ? '' : 's') + ' still powered on · ' + Math.round(e.idleKwh) + ' kWh/month<span class="p-dist">' + bar + '</span>',
        t.time ? sparkline(TL.MONTHS.map(function (_, m) { return energyAt(m).total; }), TL.valueOf('energy', 'e4').color) : ''));
    } else if (view().attr === 'health' && !iso) {
      // health is a score: show the fleet average and its trend
      const avg = avgHealth(pi);
      const band = TL.valueOf('health', bandOf(avg));
      items.push(kpi('<span class="dot" style="background:' + band.color + '"></span>Average health',
        Math.round(avg) + ' <span class="p-kpi__unit">/ 100</span>',
        '<span class="p-dist">' + bar + '</span>',
        t.time ? sparkline(TL.MONTHS.map(function (_, m) { return avgHealth(m); }), band.color) : ''));
    } else {
      const kv = iso ? a.values.filter(function (x) { return x.id === iso; })[0] : a.values[0];
      const share = counts._total ? (counts[kv.id] || 0) / counts._total * 100 : 0;
      items.push(kpi('<span class="dot" style="background:' + (kv.color || '#999') + '"></span>' + esc(kv.label),
        share.toFixed(0) + '% <span class="p-kpi__unit">of devices</span>',
        '<span class="p-dist">' + bar + '</span>',
        t.time ? sparkline(TL.MONTHS.map(function (_, m) { const c = deviceCounts(m, view().attr); return c._total ? (c[kv.id] || 0) / c._total * 100 : 0; }), kv.color || '#666') : ''));
    }
    const focusId = state.hover || state.selected;
    if (focusId && agg.nodes[focusId]) {
      const n = agg.nodes[focusId];
      const sh = agg.total ? n.value / agg.total * 100 : 0;
      items.push(kpi((state.hover && state.hover !== state.selected ? 'Hovering' : 'Selected') + ' · ' + esc(TL.DIMENSIONS[n.dim].label), esc(TL.nodeLabel(focusId)),
        fmt(n.value) + ' events/day · ' + sh.toFixed(1) + '% of all telemetry', '', true));
    } else {
      items.push(kpi('Trace a path', '<span class="p-kpi__muted">Hover or click a node</span>', 'Flows not passing through it fade back', '', true));
    }
    el.kpis.innerHTML = items.join('');
  }
  function kpi(label, value, sub, extra, wide) {
    return '<div class="p-kpi' + (wide ? ' p-kpi--wide' : '') + '"><div class="p-kpi__label">' + label + '</div><div class="p-kpi__value">' + value + '</div><div class="p-kpi__sub">' + sub + '</div>' + (extra || '') + '</div>';
  }
  // average health score of the (filtered) devices reporting in month m
  function avgHealth(m) {
    const seen = {}, f = filterFn(); let sum = 0, n = 0;
    TL.snapshot(m).forEach(function (x) {
      if (seen[x.device] || (f && !f(x))) return;
      seen[x.device] = 1; sum += x.healthScore; n++;
    });
    return n ? sum / n : 0;
  }
  // measured energy across (filtered) devices in month m, plus the idle-but-powered share
  function energyAt(m) {
    const seen = {}, f = filterFn(); let total = 0, idle = 0, idleKwh = 0;
    TL.snapshot(m).forEach(function (x) {
      if (seen[x.device] || (f && !f(x))) return;
      seen[x.device] = 1;
      if (x.energyKwh == null) return;
      total += x.energyKwh;
      if (x.idle) { idle++; idleKwh += x.energyKwh; }
    });
    return { total: total, idle: idle, idleKwh: idleKwh };
  }
  function bandOf(score) {
    score = Math.round(score);
    return TL.ATTRIBUTES.health.values.filter(function (v) { return score >= v.lo && score <= v.hi; })[0].id;
  }
  function sparkline(vals, col) {
    const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    const W = 120, H = 30, rng = (max - min) || 1;
    const pts = vals.map(function (v, i) { return (i / LAST * W).toFixed(1) + ',' + (H - 3 - (v - min) / rng * (H - 6)).toFixed(1); });
    const cx = month() / LAST * W, iy = H - 3 - (vals[periodIndex()] - min) / rng * (H - 6);
    return '<svg class="p-kpi__spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">' +
      '<polyline fill="none" stroke="' + col + '" stroke-width="1.5" points="' + pts.join(' ') + '"/>' +
      '<line x1="' + cx + '" x2="' + cx + '" y1="0" y2="' + H + '" stroke="#666" stroke-dasharray="2,2"/>' +
      '<circle cx="' + cx + '" cy="' + iy + '" r="3" fill="' + col + '"/></svg>';
  }

  // ---- timeline (tab 4) -----------------------------------------------
  function drawTimeline() {
    el.timeline.hidden = false;
    const pi = periodIndex();
    const pinned = TL.comments.forContext(ctx()).filter(function (c) { return c.anchor.period; });
    const byMonth = {};
    pinned.forEach(function (c) { (byMonth[c.anchor.period] = byMonth[c.anchor.period] || []).push(c); });
    if (!el.timeline.dataset.built) {
      el.timeline.dataset.built = '1';
      el.timeline.innerHTML =
        '<div class="p-timeline__controls">' +
          '<button type="button" class="p-icon-button" id="tl-prev" aria-label="Previous month">◀</button>' +
          '<button type="button" class="p-button p-button--positive" id="tl-play">▶ Play</button>' +
          '<button type="button" class="p-icon-button" id="tl-next" aria-label="Next month">▶</button>' +
          '<span class="p-timeline__period" id="tl-period"></span>' +
          '<label class="p-timeline__baseline">Compare to <select class="p-select p-select--small" id="tl-baseline">' +
            '<option value="none">nothing</option><option value="prev">previous month</option><option value="start">' + TL.monthLabel(TL.MONTHS[0]) + '</option></select></label>' +
        '</div>' +
        '<div class="p-timeline__track">' +
          '<div class="p-timeline__markers" id="tl-markers"></div>' +
          '<input type="range" class="p-timeline__range" id="tl-range" min="0" max="' + LAST + '" step="0.01" aria-label="Month">' +
          '<div class="p-timeline__ticks">' + TL.MONTHS.map(function (m, i) {
            return '<button type="button" class="p-timeline__tick" data-month="' + i + '" style="left:' + (i / LAST * 100) + '%">' + TL.monthLabel(m, true) + '</button>';
          }).join('') + '</div>' +
        '</div>';
      $('tl-range').addEventListener('input', function (e) { stopPlay(); state.month = +e.target.value; render(); });
      $('tl-range').addEventListener('change', function (e) { state.month = Math.round(+e.target.value); buildHighlight(); buildGroupFilter(); render(); });
      $('tl-play').addEventListener('click', function () { state.playing ? stopPlay() : play(); });
      $('tl-prev').addEventListener('click', function () { stopPlay(); setMonth(Math.round(state.month) - 1); });
      $('tl-next').addEventListener('click', function () { stopPlay(); setMonth(Math.round(state.month) + 1); });
      $('tl-baseline').addEventListener('change', function (e) { state.baseline = e.target.value; render(); });
      el.timeline.addEventListener('click', function (e) {
        const t = e.target.closest('[data-month]');
        if (t) { stopPlay(); if (t.dataset.node) state.selected = t.dataset.node; setMonth(+t.dataset.month); }
      });
    }
    $('tl-range').value = state.month;
    $('tl-period').textContent = TL.monthLabel(TL.MONTHS[pi]);
    $('tl-play').textContent = state.playing ? '❚❚ Pause' : '▶ Play';
    $('tl-baseline').value = state.baseline;
    Array.prototype.forEach.call(el.timeline.querySelectorAll('.p-timeline__tick'), function (b) { b.classList.toggle('is-active', +b.dataset.month === pi); });
    $('tl-markers').innerHTML = Object.keys(byMonth).map(function (p) {
      const i = TL.MONTHS.indexOf(p); if (i < 0) return '';
      const cs = byMonth[p];
      const title = cs.map(function (c) { return TL.nodeLabel(c.anchor.node) + ': ' + c.body; }).join('\n');
      return '<button type="button" class="p-timeline__marker" style="left:' + (i / LAST * 100) + '%" data-month="' + i + '" data-node="' + esc(cs[0].anchor.node) + '" title="' + esc(title) + '" aria-label="' + cs.length + ' comment(s) pinned to ' + TL.monthLabel(p) + '">' + cs.length + '</button>';
    }).join('');
  }
  function setMonth(m) { state.month = Math.max(0, Math.min(LAST, m)); buildHighlight(); buildGroupFilter(); render(); }
  let playTimer = null;
  function play() {
    if (state.month >= LAST) state.month = 0;
    state.playing = true;
    let last = performance.now();
    let lastWhole = Math.round(state.month);
    function step(now) {
      if (!state.playing) return;
      state.month = Math.min(LAST, state.month + (now - last) / 900);
      last = now;
      if (Math.round(state.month) !== lastWhole) { lastWhole = Math.round(state.month); buildHighlight(); }
      draw();
      if (state.month >= LAST) { stopPlay(); return; }
      playTimer = requestAnimationFrame(step);
    }
    playTimer = requestAnimationFrame(step);
    render();
  }
  function stopPlay() {
    if (!state.playing) return;
    state.playing = false;
    cancelAnimationFrame(playTimer);
    state.month = Math.round(state.month);
    buildHighlight(); buildGroupFilter();
    render();
  }

  // ---- comments panel (tabs 3, 4) -------------------------------------
  function contextLabel(a) {
    const v = TL.viewById(a.view);
    return (v ? v.label + ' view' : a.view) + ' · ' + (a.groupBy === 'device' ? 'devices' : 'by ' + TL.ATTRIBUTES[a.groupBy].label);
  }
  function when(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function commentHtml(c, showNode) {
    const t = tab();
    const period = c.anchor.period
      ? (t.time ? '<button type="button" class="p-period-chip" data-month="' + TL.MONTHS.indexOf(c.anchor.period) + '" title="Jump to this month">⏱ ' + TL.monthLabel(c.anchor.period) + '</button>'
                : '<span class="p-period-chip is-static" title="Pinned to a month — see Tab 4">⏱ ' + TL.monthLabel(c.anchor.period) + '</span>')
      : '';
    const initials = c.author.split(/[\s·]+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
    return '<li class="p-comment' + (c.resolved ? ' is-resolved' : '') + '">' +
      '<div class="p-comment__head"><span class="p-comment__avatar">' + esc(initials) + '</span>' +
      '<span class="p-comment__author">' + esc(c.author) + '</span><span class="p-comment__time">' + when(c.createdAt) + '</span></div>' +
      (showNode ? '<button type="button" class="p-comment__node" data-select="' + esc(c.anchor.node) + '">' + esc(TL.nodeLabel(c.anchor.node)) + '</button>' : '') +
      '<p class="p-comment__body">' + esc(c.body) + '</p>' +
      '<div class="p-comment__foot">' + period +
        '<button type="button" class="p-link" data-resolve="' + c.id + '">' + (c.resolved ? 'Reopen' : 'Resolve') + '</button>' +
        (c.author === 'You' ? '<button type="button" class="p-link p-link--negative" data-delete="' + c.id + '">Delete</button>' : '') +
      '</div></li>';
  }
  function drawComments() {
    el.comments.hidden = false;
    const c = ctx(), t = tab(), sel = state.selected;
    const draftEl = el.comments.querySelector('textarea');
    const draft = draftEl ? draftEl.value : '';
    const hadFocus = draftEl && document.activeElement === draftEl;
    const pinEl = el.comments.querySelector('#cm-pin');
    const pinChecked = pinEl ? pinEl.checked : true;

    let html = '<div class="comment-panel__ctx"><span class="p-field__label">Context</span>' + esc(contextLabel(c)) + '</div>';
    if (!sel) {
      const all = TL.comments.forContext(c);
      html += '<h2 class="comment-panel__title">Comments in this view</h2>' +
        '<p class="comment-panel__hint">Select a node to read its thread or add a comment. Badges on the chart show open comments.</p>' +
        (all.length ? '<ul class="p-comments">' + all.map(function (x) { return commentHtml(x, true); }).join('') + '</ul>'
                    : '<p class="comment-panel__empty">No comments for this view and group-by yet.</p>');
    } else {
      const p = TL.parseNodeId(sel);
      const list = TL.comments.forNode(c, sel);
      const other = TL.comments.elsewhere(c, sel);
      html += '<div class="comment-panel__node"><span class="p-field__label">' + esc(TL.DIMENSIONS[p.dim].label) + '</span>' +
        '<h2 class="comment-panel__title">' + esc(TL.nodeLabel(sel)) + '</h2>' +
        '<button type="button" class="p-icon-button comment-panel__close" data-clear="1" aria-label="Close thread">✕</button></div>' +
        (list.length ? '<ul class="p-comments">' + list.map(function (x) { return commentHtml(x, false); }).join('') + '</ul>'
                     : '<p class="comment-panel__empty">No comments on this node in this context.</p>') +
        '<form class="p-comment-form" id="cm-form">' +
          '<label class="p-field__label" for="cm-body">Add a comment</label>' +
          '<textarea id="cm-body" rows="3" placeholder="What do you notice here?" required>' + esc(draft) + '</textarea>' +
          (t.time ? '<label class="p-check"><input type="checkbox" id="cm-pin"' + (pinChecked ? ' checked' : '') + '> Pin to ' + TL.monthLabel(TL.MONTHS[periodIndex()]) + '</label>' : '') +
          '<div class="p-comment-form__actions"><button class="p-button p-button--positive" type="submit">Comment</button></div>' +
        '</form>';
      if (other.length) {
        html += '<details class="comment-panel__elsewhere"><summary>' + other.length + ' comment' + (other.length > 1 ? 's' : '') + ' on this node in other contexts</summary><ul>' +
          other.map(function (o) {
            return '<li><button type="button" class="p-link" data-goto="' + esc(JSON.stringify(o.anchor)) + '">' + esc(contextLabel(o.anchor)) + '</button> — ' + esc(o.body.slice(0, 90)) + (o.body.length > 90 ? '…' : '') + '</li>';
          }).join('') + '</ul></details>';
      }
    }
    el.comments.innerHTML = html;
    if (hadFocus) { const ta = el.comments.querySelector('textarea'); if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; } }
  }

  // ---- tooltip --------------------------------------------------------
  // The tooltip follows hover. Clicking a device pins it, which makes it
  // interactive (so the Sustainability accordion can be opened or closed).
  let pinned = null, tipAnchor = null;
  function placeTip() {
    if (!tipAnchor) return;
    const r = el.tooltip.getBoundingClientRect();
    let x = tipAnchor.x + 14, y = tipAnchor.y + 14;
    if (x + r.width > window.innerWidth - 8) x = Math.max(8, tipAnchor.x - r.width - 14);
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - r.height - 8);
    el.tooltip.style.left = x + 'px'; el.tooltip.style.top = y + 'px';
  }
  function showTip(e, html) {
    if (pinned) return; // a pinned tooltip ignores hover
    if (!html) return hideTip();
    el.tooltip.classList.remove('is-pinned');
    el.tooltip.innerHTML = html; el.tooltip.hidden = false;
    tipAnchor = { x: e.clientX, y: e.clientY }; placeTip();
  }
  function pinTip(e, id) {
    pinned = id;
    const html = tipForNode(id);
    if (!html) return hideTip();
    el.tooltip.innerHTML = '<button type="button" class="tooltip__close" data-tip-close aria-label="Close details">✕</button>' + html;
    el.tooltip.classList.add('is-pinned'); el.tooltip.hidden = false;
    tipAnchor = { x: e.clientX, y: e.clientY }; placeTip();
  }
  function hideTip() { pinned = null; el.tooltip.classList.remove('is-pinned'); el.tooltip.hidden = true; }
  function segBreakdown(seg, total) {
    return attr().values.map(function (v) {
      const x = seg[v.id] || 0; if (!x) return '';
      return '<div><span class="dot" style="background:' + (v.color || '#bbb') + '"></span>' + esc(v.label) + ' · ' + S.pct(x, total) + '%</div>';
    }).join('');
  }
  // Sustainability section of a device tooltip: lifecycle, then energy
  function sustainHtml(s) {
    const open = state.sustainOpen != null ? state.sustainOpen : (view().attr === 'lifecycle' || view().attr === 'energy');
    const summary = TL.valueOf('lifecycle', s.cat).label + (s.physical && s.measuredBy ? ' · ' + Math.round(s.kwh) + ' kWh/month' : '') + (s.idle ? ' · idle' : '');
    const rows = [];
    rows.push(['Hardware age', s.physical ? s.ageYears.toFixed(1) + ' years' : 'Virtual (sits with the host or cloud provider)']);
    rows.push(['Supported until', TL.monthLabel(s.supportedUntil) + (s.pro ? ' · Ubuntu Pro' : ' · standard')]);
    rows.push(['Lifecycle', s.status]);
    if (s.physical) {
      const b = s.band;
      rows.push(['Energy', Math.round(s.kwh) + ' kWh/month <span class="tooltip__band">(' + (b[1] === Infinity ? b[0] + '+' : b[0] + '–' + b[1]) + ')</span>']);
      rows.push(['Utilisation', Math.round(s.utilisation) + '%' + (s.idle ? ' · <span class="tooltip__flag">idle but powered on</span>' : '')]);
      rows.push(['Measured by', s.measuredBy ? esc(s.measuredBy) : '<span class="tooltip__band">Not measured (no landscape-client)</span>']);
    } else {
      rows.push(['Energy', '<span class="tooltip__band">Not attributed (virtual)</span>']);
    }
    return '<details class="tooltip__acc" data-acc="sustain"' + (open ? ' open' : '') + '>' +
      '<summary><span class="tooltip__section">Sustainability</span><span class="tooltip__sum">' + esc(summary) + '</span></summary>' +
      '<dl class="tooltip__attrs tooltip__attrs--sustain">' +
      rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + (r[0] === 'Lifecycle' ? esc(r[1]) : r[1]) + '</dd>'; }).join('') + '</dl></details>';
  }
  function tipForLink(key) {
    const l = lastLayout && lastLayout.links.filter(function (x) { return x.key === key; })[0];
    if (!l) return '';
    return '<strong>' + esc(TL.nodeLabel(l.source)) + ' → ' + esc(TL.nodeLabel(l.target)) + '</strong>' +
      '<div>' + fmt(l.value) + ' events/day</div>' + segBreakdown(l.seg, l.value);
  }
  function tipForNode(id) {
    const n = lastLayout && lastLayout.nodes.filter(function (x) { return x.id === id; })[0];
    if (!n) return '';
    const v = TL.valueOf(n.dim, n.val) || { label: n.val };
    let body = '';
    if (n.dim === 'device') {
      const d = TL.deviceAt(n.val, periodIndex());
      const a = d.attrs;
      const band = TL.valueOf('health', a.health);
      body = '<div class="tooltip__health"><span class="dot" style="background:' + band.color + '"></span>Health <strong>' + a.healthScore + '</strong> <span class="tooltip__band">(' + band.label + ')</span></div>';
      if (view().attr === 'health') {
        body += '<dl class="tooltip__parts">' + TL.HEALTH_COMPONENTS.map(function (c) {
          const v = Math.round(a.healthParts[c.id]);
          return '<dt>' + esc(c.label) + ' <span>' + Math.round(c.weight * 100) + '%</span></dt><dd><span class="tooltip__bar"><span style="width:' + v + '%;background:' + TL.valueOf('health', bandOf(v)).color + '"></span></span>' + v + '</dd>';
        }).join('') + '</dl>';
      }
      body += '<dl class="tooltip__attrs">' + ['site', 'region', 'environment', 'type', 'juju', 'jaas', 'maas', 'microcloud', 'sovereignty', 'confidential', 'release'].map(function (k) {
        let val = esc(TL.valueOf(k, a[k]).label);
        if (a[k] === 'unassigned') {
          // manual key with no label: offer to assign it (only clickable once the tooltip is pinned)
          val = '<span class="tooltip__band">Unassigned</span> ' + (pinned === id
            ? '<a href="#" class="tooltip__assign" data-assign="' + k + '">Assign</a>'
            : '<span class="tooltip__band">· click the device to assign</span>');
        }
        return '<dt>' + esc(TL.ATTRIBUTES[k].short) + '</dt><dd' + (k === view().attr ? ' class="is-view"' : '') + '>' + val + '</dd>';
      }).join('') + '</dl>';
      body += sustainHtml(d.sustain);
      const hist = d.changes.filter(function (c) { return c.month <= periodIndex(); });
      if (hist.length) body += '<div class="tooltip__hist">' + hist.map(function (c) { return esc(TL.monthLabel(TL.MONTHS[Math.min(c.month, LAST)], true)) + ' · ' + esc(c.note); }).join('<br>') + '</div>';
    } else {
      body = (v.note ? '<div class="tooltip__note">' + esc(v.note) + '</div>' : '') + segBreakdown(n.seg, n.value);
    }
    if (n.dim === 'policy') {
      const rules = TL.ROUTING.filter(function (r) { return r.policy === n.val; });
      body += '<div class="tooltip__hint">Rule ' + rules.map(function (r) { return r.id; }).join(', ') + '</div>';
    }
    const cnt = tab().comments ? (TL.comments.counts(ctx())[id] || 0) : 0;
    return '<div class="tooltip__dim">' + esc(TL.DIMENSIONS[n.dim].label) + '</div>' +
      '<strong>' + esc(v.label) + '</strong><div>' + fmt(n.value) + ' events/day</div>' + body +
      '<div class="tooltip__hint">' + (pinned === id ? (cnt ? cnt + ' comment' + (cnt > 1 ? 's' : '') + ' in the panel' : 'Add a comment in the panel') :
        (cnt ? cnt + ' comment' + (cnt > 1 ? 's' : '') + ' · ' : '') + (n.dim === 'device' ? 'Click to pin details and comment' : 'Click to ' + (cnt ? 'open thread' : 'comment'))) + '</div>';
  }

  // ---- events ---------------------------------------------------------
  function rebuildControls() { buildViewSwitch(); buildGroupBy(); buildHighlight(); buildGroupFilter(); }
  function clearColumn1Selection() {
    if (state.selected && TL.PIPELINE.indexOf(TL.parseNodeId(state.selected).dim) < 0) state.selected = null;
  }

  el.viewSelect.addEventListener('change', function (e) {
    const prevAttr = view().attr;
    state.view = e.target.value;
    // keep group-by linked to the view unless the user chose something else
    if (state.groupBy === prevAttr) state.groupBy = view().attr;
    state.hover = null; clearColumn1Selection();
    rebuildControls(); render();
  });
  el.hl.addEventListener('click', function (e) {
    const b = e.target.closest('[data-iso]'); if (!b) return;
    const v = b.dataset.iso;
    state.isolate[state.view] = !v || state.isolate[state.view] === v ? null : v;
    buildHighlight(); render();
  });
  el.groupby.addEventListener('change', function (e) {
    state.groupBy = e.target.value; state.hover = null; clearColumn1Selection();
    buildGroupFilter(); render();
  });
  el.filter.addEventListener('click', function (e) {
    const fd = filterDim();
    if (e.target.closest('[data-gall]')) { state.excluded[fd] = {}; buildHighlight(); buildGroupFilter(); render(); return; }
    const b = e.target.closest('[data-gval]'); if (!b) return;
    const ex = state.excluded[fd] = state.excluded[fd] || {};
    const val = b.dataset.gval;
    if (e.altKey) {
      TL.ATTRIBUTES[fd].values.forEach(function (v) { if (v.id !== val) ex[v.id] = true; else delete ex[v.id]; });
    } else if (ex[val]) {
      delete ex[val];
    } else {
      const remaining = TL.ATTRIBUTES[fd].values.filter(function (v) { return !ex[v.id]; }).length;
      if (remaining > 1) ex[val] = true; // never filter everything out
    }
    buildHighlight(); buildGroupFilter(); render();
  });

  // chart interactions (delegated)
  el.svg.addEventListener('mousemove', function (e) {
    const n = e.target.closest('[data-node]'), l = e.target.closest('[data-link]');
    if (n) {
      if (state.hover !== n.dataset.node) { state.hover = n.dataset.node; render(); }
      showTip(e, tipForNode(n.dataset.node));
    } else {
      if (state.hover) { state.hover = null; render(); }
      if (l) showTip(e, tipForLink(l.dataset.link)); else hideTip();
    }
  });
  el.svg.addEventListener('mouseleave', function () { if (!pinned) hideTip(); if (state.hover) { state.hover = null; render(); } });
  function selectNode(id) {
    state.selected = state.selected === id ? null : id;
    state.hover = null;
    render();
    if (state.selected && tab().comments) setTimeout(function () { const ta = $('cm-body'); if (ta) ta.focus({ preventScroll: true }); }, 30);
  }
  // a hover re-render can replace the node between mousedown and mouseup
  let pressed = null;
  el.svg.addEventListener('mousedown', function (e) { const n = e.target.closest('[data-node]'); pressed = n ? n.dataset.node : null; });
  el.svg.addEventListener('click', function (e) {
    const t = e.target.closest('[data-node]');
    const id = t ? t.dataset.node : pressed;
    pressed = null;
    if (id) selectNode(id);
    else if (state.selected) { state.selected = null; render(); }
    // devices pin an interactive tooltip; anything else releases it
    if (id && state.selected === id && TL.parseNodeId(id).dim === 'device') {
      const ev = { clientX: e.clientX, clientY: e.clientY };
      setTimeout(function () { pinTip(ev, id); }, 30);
    } else if (pinned) hideTip();
  });
  el.tooltip.addEventListener('click', function (e) {
    if (e.target.closest('[data-tip-close]')) { hideTip(); return; }
    const a = e.target.closest('[data-assign]');
    if (a && pinned) { e.preventDefault(); openAssign(TL.parseNodeId(pinned).val, a.dataset.assign); }
  });

  // ---- assigning manual keys (modal with autocomplete) -------------------
  const ASSIGN_KEY = 'tl.insights.assignments.v1';
  function loadAssignments() { try { return JSON.parse(localStorage.getItem(ASSIGN_KEY)) || {}; } catch (e) { return {}; } }
  function saveAssignment(device, key, value) {
    const all = loadAssignments();
    (all[device] = all[device] || {})[key] = value;
    try { localStorage.setItem(ASSIGN_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
  }
  const VALUES_KEY = 'tl.insights.values.v1';
  function loadValues() { try { return JSON.parse(localStorage.getItem(VALUES_KEY)) || {}; } catch (e) { return {}; } }
  function saveValue(key, id, label) {
    const all = loadValues();
    (all[key] = all[key] || []).push({ id: id, label: label });
    try { localStorage.setItem(VALUES_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
  }
  function applySavedAssignments() {
    const vals = loadValues();
    Object.keys(vals).forEach(function (k) { vals[k].forEach(function (v) { TL.addValue(k, v.label, v.id); }); });
    const all = loadAssignments();
    Object.keys(all).forEach(function (dev) { Object.keys(all[dev]).forEach(function (k) { TL.assign(dev, k, all[dev][k]); }); });
    $('reset-assign').hidden = !Object.keys(all).length;
  }
  const dlg = $('assign-dialog');
  // Escape inside the dialog closes only the dialog, not the pinned tooltip behind it
  dlg.addEventListener('keydown', function (e) { if (e.key === 'Escape') e.stopPropagation(); });
  function openAssign(device, key) {
    const attr = TL.ATTRIBUTES[key];
    const noun = attr.label.toLowerCase();
    const options = attr.values.filter(function (v) { return v.id !== 'unassigned'; });
    const suggestion = TL.suggest(device, key);
    const sugg = suggestion && TL.valueOf(key, suggestion);
    dlg.innerHTML =
      '<form method="dialog" class="p-modal__form" id="assign-form" novalidate>' +
        '<h2 class="p-modal__title" id="assign-title">Assign ' + esc(noun) + '</h2>' +
        '<p class="p-modal__sub">Device <strong>' + esc(device) + '</strong></p>' +
        '<label class="p-field__label" for="assign-input">' + esc(attr.label) + '</label>' +
        '<div class="p-combo">' +
          '<input id="assign-input" class="p-combo__input" type="text" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="assign-list" placeholder="Pick an existing ' + esc(noun) + ' or type a new one">' +
          '<ul class="p-combo__list" id="assign-list" role="listbox" aria-label="' + esc(attr.label) + ' values"></ul>' +
        '</div>' +
        (sugg ? '<p class="p-modal__hint">Suggested from the hostname: <a href="#" data-suggest="' + sugg.id + '">' + esc(sugg.label) + '</a></p>' : '') +
        '<p class="p-modal__hint">Saved as a tag and shared with Landscape.</p>' +
        '<div class="p-modal__actions"><button type="button" class="p-button" data-cancel>Cancel</button>' +
        '<button type="submit" class="p-button p-button--positive" id="assign-ok" disabled>Assign</button></div>' +
      '</form>';
    const input = $('assign-input'), list = $('assign-list'), ok = $('assign-ok');
    // rows = matching existing values, then (if the text is new) a "Create" row
    let rows = [], active = -1, chosen = null;
    function setChosen(row) {
      chosen = row;
      ok.disabled = !row;
      ok.textContent = row && row.create ? 'Create and assign' : 'Assign';
    }
    function draw() {
      const raw = input.value.trim(), q = raw.toLowerCase();
      // also match the word without trailing digits/punctuation, so 'factory2' still surfaces 'Factory floor'
      const core = q.replace(/[\d\s_-]+$/, '');
      const hit = function (lab) { lab = lab.toLowerCase(); return lab.indexOf(q) >= 0 ? q : core.length >= 3 && lab.indexOf(core) >= 0 ? core : null; };
      const matches = options.filter(function (v) { return !q || hit(v.label); });
      const exact = options.filter(function (v) { return v.label.toLowerCase() === q; })[0];
      rows = matches.map(function (v) { return { value: v }; });
      if (raw && !exact) rows.push({ create: true, label: raw });
      if (active >= rows.length) active = rows.length - 1;
      list.innerHTML = rows.map(function (r, i) {
        let html;
        if (r.create) html = '<span class="p-combo__new">+ Create “' + esc(r.label) + '”</span> as a new ' + esc(noun);
        else {
          const lab = r.value.label, term = q ? hit(lab) : null, at = term ? lab.toLowerCase().indexOf(term) : -1;
          html = at >= 0 ? esc(lab.slice(0, at)) + '<mark>' + esc(lab.slice(at, at + term.length)) + '</mark>' + esc(lab.slice(at + term.length)) : esc(lab);
        }
        const isChosen = chosen && (r.create ? chosen.create : chosen.value === r.value);
        return '<li role="option" id="assign-opt-' + i + '" class="p-combo__opt' + (r.create ? ' p-combo__opt--create' : '') + (i === active ? ' is-active' : '') + (isChosen ? ' is-chosen' : '') + '" aria-selected="' + (i === active) + '" data-i="' + i + '">' + html + '</li>';
      }).join('');
      input.setAttribute('aria-activedescendant', active >= 0 ? 'assign-opt-' + active : '');
      // typed text decides what will be saved: an existing value if it matches exactly, otherwise a new one
      setChosen(exact ? { value: exact } : raw ? { create: true, label: raw } : null);
    }
    function pick(row) {
      if (!row) return;
      input.value = row.create ? row.label : row.value.label;
      active = -1; draw();
    }
    input.addEventListener('input', function () { active = 0; draw(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(rows.length - 1, active + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
      else if (e.key === 'Enter' && active >= 0 && rows[active]) {
        // Enter on a highlighted row picks it; Enter again submits
        const row = rows[active];
        const same = chosen && (row.create ? chosen.create && chosen.label === row.label : chosen.value === row.value);
        if (!same) { e.preventDefault(); pick(row); }
      }
    });
    list.addEventListener('mousedown', function (e) {
      const li = e.target.closest('[data-i]'); if (!li) return;
      e.preventDefault(); pick(rows[+li.dataset.i]); input.focus({ preventScroll: true });
    });
    dlg.querySelector('[data-cancel]').addEventListener('click', function () { dlg.close(); });
    const sl = dlg.querySelector('[data-suggest]');
    if (sl) sl.addEventListener('click', function (e) { e.preventDefault(); pick({ value: TL.valueOf(key, sl.dataset.suggest) }); input.focus({ preventScroll: true }); });
    $('assign-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!chosen) return;
      let id;
      if (chosen.create) {
        id = TL.addValue(key, chosen.label);
        saveValue(key, id, chosen.label);
      } else id = chosen.value.id;
      TL.assign(device, key, id);
      saveAssignment(device, key, id);
      $('reset-assign').hidden = false;
      dlg.close();
      buildHighlight(); buildGroupFilter(); render();
      if (pinned) { const at = tipAnchor; requestAnimationFrame(function () { pinTip({ clientX: at.x, clientY: at.y }, pinned); }); }
    });
    draw();
    dlg.showModal();
    input.focus({ preventScroll: true });
  }
  $('reset-assign').addEventListener('click', function (e) {
    e.preventDefault();
    try { localStorage.removeItem(ASSIGN_KEY); localStorage.removeItem(VALUES_KEY); } catch (err) { /* ignore */ }
    location.reload();
  });
  // remember the accordion choice, and keep the tooltip on screen as it grows
  el.tooltip.addEventListener('toggle', function (e) {
    if (e.target.matches && e.target.matches('details[data-acc="sustain"]')) { state.sustainOpen = e.target.open; placeTip(); }
  }, true);
  el.svg.addEventListener('keydown', function (e) {
    const n = e.target.closest('[data-node]');
    if (n && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectNode(n.dataset.node); }
  });
  document.addEventListener('keydown', function (e) {
    if (dlg.open) return; // the dialog handles its own Escape
    if (e.key === 'Escape' && pinned) { hideTip(); return; }
    if (e.key === 'Escape' && state.selected) { state.selected = null; render(); }
    if (e.key === ' ' && tab().time && e.target === document.body) { e.preventDefault(); state.playing ? stopPlay() : play(); }
  });

  el.comments.addEventListener('click', function (e) {
    const t = e.target;
    const sel = t.closest('[data-select]'); if (sel) { state.selected = sel.dataset.select; render(); return; }
    if (t.closest('[data-clear]')) { state.selected = null; render(); return; }
    const r = t.closest('[data-resolve]'); if (r) { TL.comments.toggleResolved(r.dataset.resolve); return; }
    const d = t.closest('[data-delete]'); if (d) { TL.comments.remove(d.dataset.delete); return; }
    const m = t.closest('[data-month]'); if (m && tab().time) { stopPlay(); setMonth(+m.dataset.month); return; }
    const g = t.closest('[data-goto]');
    if (g) {
      const a = JSON.parse(g.dataset.goto);
      state.view = a.view; state.groupBy = a.groupBy;
      state.excluded = {}; state.query = '';
      state.selected = a.node;
      if (a.period && tab().time) state.month = TL.MONTHS.indexOf(a.period);
      rebuildControls(); render();
    }
  });
  el.comments.addEventListener('submit', function (e) {
    e.preventDefault();
    const ta = $('cm-body'); const body = ta.value.trim(); if (!body || !state.selected) return;
    const pin = $('cm-pin'), c = ctx();
    TL.comments.add({ view: c.view, groupBy: c.groupBy, node: state.selected, period: pin && pin.checked ? TL.MONTHS[periodIndex()] : null }, body);
    ta.value = '';
  });
  el.comments.addEventListener('keydown', function (e) {
    if (e.target.id === 'cm-body' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('cm-form').requestSubmit(); }
  });
  TL.comments.onChange(render);
  $('reset-demo').addEventListener('click', function (e) { e.preventDefault(); TL.comments.reset(); });

  if (window.ResizeObserver) new ResizeObserver(function () { render(); }).observe(el.wrap);
  else window.addEventListener('resize', render);

  // ---- mobile navigation ------------------------------------------------
  const navToggle = $('nav-toggle'), navOverlay = $('nav-overlay');
  function setNav(open) {
    document.body.classList.toggle('nav-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    navOverlay.hidden = !open;
  }
  navToggle.addEventListener('click', function () { setNav(!document.body.classList.contains('nav-open')); });
  navOverlay.addEventListener('click', function () { setNav(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('nav-open')) { setNav(false); navToggle.focus(); } });
  window.addEventListener('resize', function () { if (window.innerWidth > 760) setNav(false); });

  // touch has no hover: show the tooltip for whatever was tapped
  let lastPointer = 'mouse';
  el.svg.addEventListener('pointerdown', function (e) { lastPointer = e.pointerType; });
  el.svg.addEventListener('click', function (e) {
    if (lastPointer !== 'touch') return;
    const n = e.target.closest('[data-node]'), l = e.target.closest('[data-link]');
    if (n && TL.parseNodeId(n.dataset.node).dim === 'device') return; // devices pin instead
    setTimeout(function () {
      if (n) showTip(e, tipForNode(n.dataset.node));
      else if (l) showTip(e, tipForLink(l.dataset.link));
      else hideTip();
    }, 30);
  });
  window.addEventListener('scroll', function () { if (!$('assign-dialog').open) hideTip(); }, { passive: true });
  el.wrap.addEventListener('scroll', hideTip, { passive: true });

  // ---- boot -----------------------------------------------------------
  applySavedAssignments();
  rebuildControls();
  render();
})(window.TL);
