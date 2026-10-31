/*
 * Insights page controller. One renderer, four demo tabs; each tab turns on
 * more capabilities so the progression can be shown step by step.
 */
(function (TL) {
  'use strict';
  const S = TL.sankey, esc = S.esc, fmt = S.fmt;
  const LAST = TL.MONTHS.length - 1;

  const TABS = [
    { id: 1, label: 'View', groupBy: false, comments: false, time: false,
      intro: 'Curated views answer one question each. Pick a view, then a highlight to colour the flows that matter; hover or click any node to trace its path end to end.' },
    { id: 2, label: 'View + group by', groupBy: true, comments: false, time: false,
      intro: 'Group by adds a “who” column on the left. Use the chips to filter groups in or out — the rest of the view and its highlight stay the same.' },
    { id: 3, label: '+ Comments', groupBy: true, comments: true, time: false,
      intro: 'Comments belong to a node within a view and group-by, so the same node can hold different conversations in different lenses. Click a node to read or add comments.' },
    { id: 4, label: '+ Over time', groupBy: true, comments: true, time: true,
      intro: 'Scrub or play through twelve months. Deltas compare against the chosen baseline; comments can be pinned to a month and appear as markers on the timeline.' }
  ];

  const state = {
    tab: 1,
    view: 'canonical-infra',
    highlight: { 'canonical-infra': 'full', sovereignty: 'sovereign', confidential: 'cc' },
    groupBy: 'region',
    excluded: {},            // { dim: { valueId: true } }
    selected: null,          // nodeId (click)
    hover: null,             // nodeId (hover preview)
    month: LAST,             // float during playback
    baseline: 'prev',        // 'prev' | 'start'
    playing: false
  };

  const $ = function (id) { return document.getElementById(id); };
  const el = {
    tabs: $('tabs'), intro: $('tab-intro'), viewSwitch: $('view-switch'), groupby: $('groupby'),
    groupbyField: $('groupby-field'), hl: $('hl-switch'), filter: $('group-filter'), question: $('view-question'),
    kpis: $('kpis'), legend: $('legend'), wrap: $('chart-wrap'), svg: $('sankey'), timeline: $('timeline'),
    comments: $('comments'), tooltip: $('tooltip')
  };

  // ---- derived state --------------------------------------------------
  function tab() { return TABS[state.tab - 1]; }
  function view() { return TL.viewById(state.view); }
  function hl() { const v = view(); const id = state.highlight[v.id]; return v.highlights.filter(function (h) { return h.id === id; })[0] || null; }
  function groupBy() { return tab().groupBy ? state.groupBy : 'none'; }
  function stages() { const g = groupBy(); return g === 'none' ? view().stages.slice() : [g].concat(view().stages); }
  function ctx() { return { view: state.view, groupBy: groupBy() }; }
  function month() { return tab().time ? state.month : LAST; }
  function periodIndex() { return Math.round(month()); }
  function filterFn() {
    const g = groupBy(); const ex = state.excluded[g];
    if (g === 'none' || !ex || !Object.keys(ex).length) return null;
    return function (f) { return !ex[f[g]]; };
  }
  function focusFn() {
    const id = state.hover || state.selected; if (!id) return null;
    const p = TL.parseNodeId(id);
    return function (f) { return f[p.dim] === p.val; };
  }
  function aggAt(m, withFocus) {
    const h = hl();
    return S.aggregate(TL.snapshot(m), stages(), {
      filter: filterFn(), highlight: h ? h.test : null, focus: withFocus ? focusFn() : null
    });
  }
  function currentAgg() {
    const m = month(), m0 = Math.floor(m), m1 = Math.min(LAST, Math.ceil(m));
    const a = aggAt(m0, true);
    return m1 === m0 ? a : S.interpolate(a, aggAt(m1, true), m - m0);
  }

  // ---- static UI builders --------------------------------------------
  function buildTabs() {
    el.tabs.innerHTML = TABS.map(function (t) {
      return '<button class="p-tabs__item" role="tab" id="tab-' + t.id + '" data-tab="' + t.id + '" aria-selected="' + (state.tab === t.id) + '" tabindex="' + (state.tab === t.id ? 0 : -1) + '">' +
        '<span class="p-tabs__num">Tab ' + t.id + '</span>' + esc(t.label) + '</button>';
    }).join('');
  }
  function buildViewSwitch() {
    el.viewSwitch.innerHTML = TL.VIEWS.map(function (v) {
      const on = v.id === state.view;
      return '<button type="button" role="radio" aria-checked="' + on + '" class="p-segmented__item' + (on ? ' is-active' : '') + '" data-view="' + v.id + '">' +
        '<span class="swatch" style="background:' + v.color + '"></span>' + esc(v.label) + '</button>';
    }).join('');
  }
  function buildGroupBy() {
    el.groupby.innerHTML = TL.GROUP_BYS.map(function (g) {
      return '<option value="' + g + '"' + (g === state.groupBy ? ' selected' : '') + '>' + (g === 'none' ? 'No grouping' : esc(TL.DIMENSIONS[g].label)) + '</option>';
    }).join('');
  }
  function buildHighlight() {
    const v = view();
    const cur = state.highlight[v.id];
    el.hl.innerHTML = v.highlights.map(function (h) {
      const on = h.id === cur;
      return '<button type="button" role="radio" aria-checked="' + on + '" class="p-chip' + (on ? ' is-active' : '') + '" data-hl="' + h.id + '" style="--c:' + v.color + '">' + esc(h.label) + '</button>';
    }).join('') + '<button type="button" role="radio" aria-checked="' + (cur === 'off') + '" class="p-chip p-chip--quiet' + (cur === 'off' ? ' is-active' : '') + '" data-hl="off">Off</button>';
  }
  function buildGroupFilter() {
    const g = groupBy();
    if (g === 'none') { el.filter.hidden = true; return; }
    el.filter.hidden = false;
    const ex = state.excluded[g] || {};
    // counts unfiltered so excluded chips still show their size
    const totals = {};
    TL.snapshot(periodIndex()).forEach(function (f) { totals[f[g]] = (totals[f[g]] || 0) + f.count; });
    const nEx = Object.keys(ex).length;
    el.filter.innerHTML = '<span class="p-group-filter__label">' + esc(TL.DIMENSIONS[g].label) + '</span>' +
      TL.DIMENSIONS[g].values.map(function (v) {
        const on = !ex[v.id];
        return '<button type="button" class="p-filter-chip' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" data-gval="' + v.id + '" title="Click to toggle · Alt-click for only this">' +
          '<span class="p-filter-chip__check" aria-hidden="true">' + (on ? '✓' : '') + '</span>' + esc(v.label) +
          '<span class="p-filter-chip__count">' + fmt(totals[v.id] || 0) + '</span></button>';
      }).join('') +
      (nEx ? '<button type="button" class="p-link" data-gall="1">Show all</button>' : '<span class="p-group-filter__hint">Alt-click a chip to isolate it</span>');
  }

  // ---- dynamic render -------------------------------------------------
  let lastLayout = null;
  let rafPending = false;
  function render() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; draw(); });
  }

  function draw() {
    const t = tab(), v = view(), h = hl();
    el.intro.textContent = t.intro;
    el.groupbyField.hidden = !t.groupBy;
    el.question.innerHTML = '<span class="p-question__swatch" style="background:' + v.color + '"></span>' + esc(v.question);

    const agg = currentAgg();
    const stg = stages();
    // layout
    const width = Math.max(640, el.wrap.clientWidth || 900);
    const maxCol = Math.max.apply(null, stg.map(function (d) { return TL.DIMENSIONS[d].values.length; }));
    const height = Math.max(440, maxCol * 70);
    const L = S.layout(agg, stg, width, height);
    lastLayout = L;

    // deltas
    let deltas = null;
    if (t.time) {
      const pi = periodIndex();
      const baseM = state.baseline === 'start' ? 0 : Math.max(0, pi - 1);
      if (baseM !== pi || state.baseline === 'start') {
        const base = aggAt(baseM, false), cur = aggAt(pi, false);
        deltas = {};
        Object.keys(cur.nodes).forEach(function (k) {
          const b = base.nodes[k] ? base.nodes[k].value : 0;
          deltas[k] = b ? (cur.nodes[k].value - b) / b * 100 : null;
        });
      }
    }

    S.render(el.svg, L, {
      color: v.color,
      highlightOn: !!h,
      focusId: state.hover || state.selected,
      selectedId: state.selected,
      showCommentBadges: t.comments,
      commentCounts: t.comments ? TL.comments.counts(ctx()) : null,
      deltas: deltas
    });
    el.svg.setAttribute('aria-label', 'Sankey diagram: ' + stg.map(function (d) { return TL.DIMENSIONS[d].label; }).join(' → '));

    drawLegend(stg, L);
    drawKpis(agg);
    if (t.time) drawTimeline(); else el.timeline.hidden = true;
    if (t.comments) drawComments(); else el.comments.hidden = true;
  }

  function drawLegend(stg, L) {
    const cols = stg.map(function (d, i) {
      const n = L.nodes.filter(function (x) { return x.col === i; })[0];
      const x = n ? n.x : 0;
      return '<span class="chart-legend__col' + (i === stg.length - 1 ? ' is-last' : '') + (i === 0 && groupBy() !== 'none' ? ' is-group' : '') + '" style="left:' + x + 'px">' + esc(TL.DIMENSIONS[d].label) + '</span>';
    });
    el.legend.style.width = L.width + 'px';
    el.legend.innerHTML = cols.join('');
  }

  function drawKpis(agg) {
    const v = view(), h = hl(), t = tab();
    const items = [];
    items.push(kpi('Machines reporting', fmt(agg.total), t.time ? TL.monthLabel(TL.MONTHS[periodIndex()]) : 'Latest month · ' + TL.monthLabel(TL.MONTHS[LAST])));
    if (h) {
      const share = agg.total ? agg.htotal / agg.total * 100 : 0;
      items.push(kpi('<span class="dot" style="background:' + v.color + '"></span>' + esc(h.label), share.toFixed(1) + '%', fmt(agg.htotal) + ' machines ' + esc(h.kpi), t.time ? sparkline() : ''));
    }
    const focusId = state.hover || state.selected;
    if (focusId && agg.nodes[focusId]) {
      const n = agg.nodes[focusId];
      const share = agg.total ? n.value / agg.total * 100 : 0;
      items.push(kpi((state.hover && state.hover !== state.selected ? 'Hovering' : 'Selected') + ' · ' + esc(TL.DIMENSIONS[n.dim].label), esc(TL.nodeLabel(focusId)),
        fmt(n.value) + ' machines · ' + share.toFixed(1) + '% of fleet' + (h ? ' · ' + S.pct(n.h, n.value) + '% highlighted' : ''), '', true));
    } else {
      items.push(kpi('Trace a path', '<span class="p-kpi__muted">Hover or click a node</span>', 'Flows not passing through it fade back', '', true));
    }
    el.kpis.innerHTML = items.join('');
  }
  function kpi(label, value, sub, extra, wide) {
    return '<div class="p-kpi' + (wide ? ' p-kpi--wide' : '') + '"><div class="p-kpi__label">' + label + '</div><div class="p-kpi__value">' + value + '</div><div class="p-kpi__sub">' + sub + '</div>' + (extra || '') + '</div>';
  }
  function sparkline() {
    const h = hl(); if (!h) return '';
    const vals = TL.MONTHS.map(function (_, m) { const a = aggAt(m, false); return a.total ? a.htotal / a.total * 100 : 0; });
    const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    const W = 140, H = 30, rng = (max - min) || 1;
    const pts = vals.map(function (v, i) { return (i / LAST * W).toFixed(1) + ',' + (H - 3 - (v - min) / rng * (H - 6)).toFixed(1); });
    const cx = month() / LAST * W;
    const iy = H - 3 - (vals[periodIndex()] - min) / rng * (H - 6);
    return '<svg class="p-kpi__spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">' +
      '<polyline fill="none" stroke="' + view().color + '" stroke-width="1.5" points="' + pts.join(' ') + '"/>' +
      '<line x1="' + cx + '" x2="' + cx + '" y1="0" y2="' + H + '" stroke="#666" stroke-dasharray="2,2"/>' +
      '<circle cx="' + cx + '" cy="' + iy + '" r="3" fill="' + view().color + '"/></svg>';
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
            '<option value="prev">previous month</option><option value="start">' + TL.monthLabel(TL.MONTHS[0]) + '</option></select></label>' +
        '</div>' +
        '<div class="p-timeline__track">' +
          '<div class="p-timeline__markers" id="tl-markers"></div>' +
          '<input type="range" class="p-timeline__range" id="tl-range" min="0" max="' + LAST + '" step="0.01" aria-label="Month">' +
          '<div class="p-timeline__ticks">' + TL.MONTHS.map(function (m, i) {
            return '<button type="button" class="p-timeline__tick" data-month="' + i + '" style="left:' + (i / LAST * 100) + '%">' + TL.monthLabel(m, true) + '</button>';
          }).join('') + '</div>' +
        '</div>';
      $('tl-range').addEventListener('input', function (e) { stop(); state.month = +e.target.value; render(); });
      $('tl-range').addEventListener('change', function (e) { state.month = Math.round(+e.target.value); render(); });
      $('tl-play').addEventListener('click', function () { state.playing ? stop() : play(); });
      $('tl-prev').addEventListener('click', function () { stop(); state.month = Math.max(0, Math.round(state.month) - 1); render(); });
      $('tl-next').addEventListener('click', function () { stop(); state.month = Math.min(LAST, Math.round(state.month) + 1); render(); });
      $('tl-baseline').addEventListener('change', function (e) { state.baseline = e.target.value; render(); });
      el.timeline.addEventListener('click', function (e) {
        const t = e.target.closest('[data-month]');
        if (t) { stop(); state.month = +t.dataset.month; if (t.dataset.node) state.selected = t.dataset.node; render(); }
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
  let playTimer = null;
  function play() {
    if (state.month >= LAST) state.month = 0;
    state.playing = true;
    let last = performance.now();
    const perMonth = 900;
    function step(now) {
      if (!state.playing) return;
      state.month = Math.min(LAST, state.month + (now - last) / perMonth);
      last = now;
      draw();
      if (state.month >= LAST) { stop(); return; }
      playTimer = requestAnimationFrame(step);
    }
    playTimer = requestAnimationFrame(step);
    render();
  }
  function stop() {
    if (!state.playing) return;
    state.playing = false;
    cancelAnimationFrame(playTimer);
    state.month = Math.round(state.month);
    render();
  }

  // ---- comments panel (tabs 3, 4) -------------------------------------
  function contextLabel(a) {
    const v = TL.viewById(a.view);
    return (v ? v.label : a.view) + (a.groupBy !== 'none' ? ' · by ' + TL.DIMENSIONS[a.groupBy].label : '');
  }
  function timeAgo(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function commentHtml(c, showNode) {
    const t = tab();
    const period = c.anchor.period
      ? (t.time ? '<button type="button" class="p-period-chip" data-month="' + TL.MONTHS.indexOf(c.anchor.period) + '" title="Jump to this month">⏱ ' + TL.monthLabel(c.anchor.period) + '</button>'
                : '<span class="p-period-chip is-static" title="Pinned to a month — see Tab 4">⏱ ' + TL.monthLabel(c.anchor.period) + '</span>')
      : '';
    return '<li class="p-comment' + (c.resolved ? ' is-resolved' : '') + '">' +
      '<div class="p-comment__head"><span class="p-comment__avatar">' + esc(c.author.split(/[\s·]+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase()) + '</span>' +
      '<span class="p-comment__author">' + esc(c.author) + '</span><span class="p-comment__time">' + timeAgo(c.createdAt) + '</span></div>' +
      (showNode ? '<button type="button" class="p-comment__node" data-select="' + esc(c.anchor.node) + '">' + esc(TL.nodeLabel(c.anchor.node)) + '</button>' : '') +
      '<p class="p-comment__body">' + esc(c.body) + '</p>' +
      '<div class="p-comment__foot">' + period +
        '<button type="button" class="p-link" data-resolve="' + c.id + '">' + (c.resolved ? 'Reopen' : 'Resolve') + '</button>' +
        (c.author === 'You' ? '<button type="button" class="p-link p-link--negative" data-delete="' + c.id + '">Delete</button>' : '') +
      '</div></li>';
  }
  function drawComments() {
    el.comments.hidden = false;
    const c = ctx(), t = tab();
    const sel = state.selected;
    // keep draft text while re-rendering
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
      const pi = periodIndex();
      html += '<div class="comment-panel__node"><span class="p-field__label">' + esc(TL.DIMENSIONS[p.dim].label) + '</span>' +
        '<h2 class="comment-panel__title">' + (TL.valueOf(p.dim, p.val).canonical ? '<span class="canon">◆</span> ' : '') + esc(TL.nodeLabel(sel)) + '</h2>' +
        '<button type="button" class="p-icon-button comment-panel__close" data-clear="1" aria-label="Close thread">✕</button></div>' +
        (list.length ? '<ul class="p-comments">' + list.map(function (x) { return commentHtml(x, false); }).join('') + '</ul>'
                     : '<p class="comment-panel__empty">No comments on this node in this context.</p>') +
        '<form class="p-comment-form" id="cm-form">' +
          '<label class="p-field__label" for="cm-body">Add a comment</label>' +
          '<textarea id="cm-body" rows="3" placeholder="What do you notice here?" required>' + esc(draft) + '</textarea>' +
          (t.time ? '<label class="p-check"><input type="checkbox" id="cm-pin"' + (pinChecked ? ' checked' : '') + '> Pin to ' + TL.monthLabel(TL.MONTHS[pi]) + '</label>' : '') +
          '<div class="p-comment-form__actions"><button class="p-button p-button--positive" type="submit">Comment</button></div>' +
        '</form>';
      if (other.length) {
        html += '<details class="comment-panel__elsewhere"><summary>' + other.length + ' comment' + (other.length > 1 ? 's' : '') + ' on this node in other contexts</summary><ul>' +
          other.map(function (o) {
            return '<li><button type="button" class="p-link" data-goto=\'' + esc(JSON.stringify(o.anchor)) + '\'>' + esc(contextLabel(o.anchor)) + '</button> — ' + esc(o.body.slice(0, 90)) + (o.body.length > 90 ? '…' : '') + '</li>';
          }).join('') + '</ul></details>';
      }
    }
    el.comments.innerHTML = html;
    if (hadFocus) { const ta = el.comments.querySelector('textarea'); if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; } }
  }

  // ---- tooltip --------------------------------------------------------
  function showTip(e, html) {
    el.tooltip.innerHTML = html; el.tooltip.hidden = false;
    const r = el.tooltip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 14;
    el.tooltip.style.left = x + 'px'; el.tooltip.style.top = y + 'px';
  }
  function hideTip() { el.tooltip.hidden = true; }
  function tipForLink(key) {
    const l = lastLayout && lastLayout.links.filter(function (x) { return x.key === key; })[0];
    if (!l) return '';
    const h = hl();
    return '<strong>' + esc(TL.nodeLabel(l.source)) + ' → ' + esc(TL.nodeLabel(l.target)) + '</strong>' +
      '<div>' + fmt(l.value) + ' machines</div>' +
      (h ? '<div><span class="dot" style="background:' + view().color + '"></span>' + S.pct(l.h, l.value) + '% ' + esc(h.kpi) + '</div>' : '');
  }
  function tipForNode(id) {
    const n = lastLayout && lastLayout.nodes.filter(function (x) { return x.id === id; })[0];
    if (!n) return '';
    const h = hl(), v = TL.valueOf(n.dim, n.val);
    const cnt = tab().comments ? (TL.comments.counts(ctx())[id] || 0) : 0;
    return '<div class="tooltip__dim">' + esc(TL.DIMENSIONS[n.dim].label) + (v.canonical ? ' · <span class="canon">◆ Canonical</span>' : '') + '</div>' +
      '<strong>' + esc(v.label) + '</strong><div>' + fmt(n.value) + ' machines</div>' +
      (h ? '<div><span class="dot" style="background:' + view().color + '"></span>' + S.pct(n.h, n.value) + '% ' + esc(h.kpi) + '</div>' : '') +
      (tab().comments ? '<div class="tooltip__hint">' + (cnt ? cnt + ' comment' + (cnt > 1 ? 's' : '') + ' · ' : '') + 'Click to ' + (cnt ? 'open thread' : 'comment') + '</div>' : '<div class="tooltip__hint">Click to pin the trace</div>');
  }

  // ---- events ---------------------------------------------------------
  function setTab(id) {
    stop();
    state.tab = id; state.hover = null;
    if (!tab().time) state.month = LAST;
    history.replaceState(null, '', '#tab' + id);
    buildTabs(); buildGroupFilter();
    el.svg.closest('.insights__chart').classList.toggle('has-time', tab().time);
    document.body.dataset.tab = id;
    render();
  }

  el.tabs.addEventListener('click', function (e) {
    const b = e.target.closest('[data-tab]'); if (b) setTab(+b.dataset.tab);
  });
  el.tabs.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = (state.tab - 1 + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length + 1;
    setTab(n); $('tab-' + n).focus();
  });
  el.viewSwitch.addEventListener('click', function (e) {
    const b = e.target.closest('[data-view]'); if (!b) return;
    state.view = b.dataset.view; state.selected = null; state.hover = null;
    buildViewSwitch(); buildHighlight(); render();
  });
  el.hl.addEventListener('click', function (e) {
    const b = e.target.closest('[data-hl]'); if (!b) return;
    state.highlight[state.view] = b.dataset.hl; buildHighlight(); render();
  });
  el.groupby.addEventListener('change', function (e) {
    state.groupBy = e.target.value; state.selected = null; state.hover = null;
    buildGroupFilter(); render();
  });
  el.filter.addEventListener('click', function (e) {
    const g = groupBy();
    if (e.target.closest('[data-gall]')) { state.excluded[g] = {}; buildGroupFilter(); render(); return; }
    const b = e.target.closest('[data-gval]'); if (!b) return;
    const ex = state.excluded[g] = state.excluded[g] || {};
    const val = b.dataset.gval;
    if (e.altKey) {
      TL.DIMENSIONS[g].values.forEach(function (v) { if (v.id !== val) ex[v.id] = true; else delete ex[v.id]; });
    } else if (ex[val]) {
      delete ex[val];
    } else {
      const remaining = TL.DIMENSIONS[g].values.filter(function (v) { return !ex[v.id]; }).length;
      if (remaining > 1) ex[val] = true; // never filter everything out
    }
    if (state.selected && TL.parseNodeId(state.selected).dim === g && ex[TL.parseNodeId(state.selected).val]) state.selected = null;
    buildGroupFilter(); render();
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
  el.svg.addEventListener('mouseleave', function () { hideTip(); if (state.hover) { state.hover = null; render(); } });
  function selectNode(id) {
    state.selected = state.selected === id ? null : id;
    state.hover = null;
    render();
    if (state.selected && tab().comments) setTimeout(function () { const ta = $('cm-body'); if (ta) ta.focus({ preventScroll: true }); }, 30);
  }
  // a hover re-render can replace the node between mousedown and mouseup,
  // so remember what was pressed and fall back to it on click
  let pressed = null;
  el.svg.addEventListener('mousedown', function (e) { const n = e.target.closest('[data-node]'); pressed = n ? n.dataset.node : null; });
  el.svg.addEventListener('click', function (e) {
    const t = e.target.closest('[data-node]');
    const n = t || (pressed && { dataset: { node: pressed } });
    pressed = null;
    if (n) selectNode(n.dataset.node);
    else if (state.selected) { state.selected = null; render(); }
  });
  el.svg.addEventListener('keydown', function (e) {
    const n = e.target.closest('[data-node]');
    if (n && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectNode(n.dataset.node); setTimeout(function () { const f = el.svg.querySelector('[data-node="' + n.dataset.node + '"]'); if (f && !tab().comments) f.focus(); }, 40); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) { state.selected = null; render(); }
    if (e.key === ' ' && tab().time && e.target === document.body) { e.preventDefault(); state.playing ? stop() : play(); }
  });

  el.comments.addEventListener('click', function (e) {
    const t = e.target;
    const sel = t.closest('[data-select]'); if (sel) { state.selected = sel.dataset.select; render(); return; }
    if (t.closest('[data-clear]')) { state.selected = null; render(); return; }
    const r = t.closest('[data-resolve]'); if (r) { TL.comments.toggleResolved(r.dataset.resolve); return; }
    const d = t.closest('[data-delete]'); if (d) { TL.comments.remove(d.dataset.delete); return; }
    const m = t.closest('[data-month]'); if (m && tab().time) { stop(); state.month = +m.dataset.month; render(); return; }
    const g = t.closest('[data-goto]');
    if (g) {
      const a = JSON.parse(g.dataset.goto);
      state.view = a.view;
      state.groupBy = a.groupBy === 'none' ? state.groupBy : a.groupBy;
      if (a.groupBy === 'none') state.groupBy = 'none';
      state.excluded = {};
      state.selected = a.node;
      if (a.period && tab().time) state.month = TL.MONTHS.indexOf(a.period);
      buildViewSwitch(); buildGroupBy(); buildHighlight(); buildGroupFilter(); render();
    }
  });
  el.comments.addEventListener('submit', function (e) {
    e.preventDefault();
    const ta = $('cm-body'); const body = ta.value.trim(); if (!body || !state.selected) return;
    const pin = $('cm-pin');
    const c = ctx();
    TL.comments.add({ view: c.view, groupBy: c.groupBy, node: state.selected, period: pin && pin.checked ? TL.MONTHS[periodIndex()] : null }, body);
    ta.value = '';
    render();
  });
  el.comments.addEventListener('keydown', function (e) {
    if (e.target.id === 'cm-body' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('cm-form').requestSubmit(); }
  });
  TL.comments.onChange(render);
  $('reset-demo').addEventListener('click', function () { TL.comments.reset(); });

  if (window.ResizeObserver) new ResizeObserver(function () { render(); }).observe(el.wrap);
  else window.addEventListener('resize', render);

  // ---- boot -----------------------------------------------------------
  const m = /#tab(\d)/.exec(location.hash);
  buildViewSwitch(); buildGroupBy(); buildHighlight();
  setTab(m ? Math.min(4, Math.max(1, +m[1])) : 1);
})(window.TL);
