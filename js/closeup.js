/*
 * Incident close-up: hour-by-hour detail for a kept window.
 *
 * Fine-grained telemetry is normally only kept for a short rolling window.
 * A trigger (here: an alert) keeps a window of it for longer, limited to a
 * narrow scope, with its reason and expiry shown. Opening the window from the
 * monthly timeline shows the same Sankey, one hour at a time.
 */
(function (TL) {
  'use strict';
  const C = TL.CLOSEUP;
  const S = TL.sankey, esc = S.esc, fmt = S.fmt;
  const $ = function (id) { return document.getElementById(id); };
  const dlg = $('closeup-dialog');
  if (!C || !dlg) { TL.closeup = null; return; }

  const LASTH = C.hours - 1;
  const t0 = Date.parse(C.start);
  const many = C.devices.length > 30; // big fleets: column 1 shows regions instead of devices
  const col1 = many ? 'region' : 'device';
  const STAGES = [col1, 'publisher', 'policy', 'destination'];
  const palette = C.states.map(function (s) { return { id: s.id, color: s.color }; });
  const stateLabel = {}; C.states.forEach(function (s) { stateLabel[s.id] = s.label; });
  // devices listed in the order they picked up r214 (held plants last)
  const order0 = {};
  C.devices.slice().sort(function (a, b) { return TL.closeupDevice(a, 0).refreshAt - TL.closeupDevice(b, 0).refreshAt; })
    .forEach(function (id, i) { order0[id] = i; });

  const st = { h: 0, playing: false, hover: null };

  function clock(h) {
    const d = new Date(t0 + h * 3600e3);
    return d.getUTCDate() + ' ' + d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }) + ' ' +
      String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }
  function hhmm(h) { return clock(h).split(' ')[2]; }
  function fmtDate(iso) { const d = new Date(iso + 'T00:00:00Z'); return d.getUTCDate() + ' ' + d.toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }); }

  // the window as a one-line summary (also used on the monthly timeline)
  function summary() {
    return 'Detail kept · ' + clock(0) + '–' + clock(C.hours) + ' · triggered by ' + C.reason.charAt(0).toLowerCase() + C.reason.slice(1) + ' · expires ' + fmtDate(C.expires);
  }

  const aggMemo = {};
  function aggHour(h) {
    return aggMemo[h] || (aggMemo[h] = S.aggregate(TL.closeupFacts(h), STAGES, { segAttr: 'cstate' }));
  }
  function aggAt(h) {
    const a = Math.floor(h), b = Math.min(LASTH, a + 1);
    return S.interpolate(aggHour(a), aggHour(b), h - a);
  }
  function hourStats(h) {
    const facts = TL.closeupFacts(h), per = {};
    let events = 0, restarts = 0, schema = 0;
    facts.forEach(function (f) {
      events += f.count; restarts += f.restarts; if (f.policy === 'schema') schema += f.count;
      const p = per[f.device] || (per[f.device] = {});
      p[f.cstate] = Math.max(p[f.cstate] || 0, 1);
    });
    let crash = 0, held = 0;
    C.devices.forEach(function (id) {
      const s = TL.closeupDevice(id, h).state;
      if ((s.crash || 0) >= 0.5) crash++;
      if ((s.held || 0) >= 0.5) held++;
    });
    return { events: events, restarts: restarts, schema: schema, crash: crash, held: held };
  }
  const normal = hourStats(0).events; // the hour before r214 was published

  function build() {
    dlg.innerHTML =
      '<div class="p-closeup">' +
        '<header class="p-closeup__head">' +
          '<div><div class="p-breadcrumb">Insights / Kept detail</div>' +
          '<h2 class="p-closeup__title" id="closeup-title">Close-up · ' + esc(C.scope) + '</h2>' +
          '<p class="p-closeup__sub">' + clock(0) + ' – ' + clock(C.hours) + ' UTC, hour by hour · ' + C.devices.length + ' devices</p></div>' +
          '<button type="button" class="p-button" id="cu-close">Back to monthly view</button>' +
        '</header>' +
        '<div class="p-kept">' +
          '<span class="p-badge p-badge--caution">Detail kept</span>' +
          '<dl class="p-kept__facts">' +
            '<div><dt>Triggered by</dt><dd>' + esc(C.reason) + '</dd></div>' +
            '<div><dt>Scope</dt><dd>' + esc(C.scope) + ' (' + C.devices.length + ' devices, one snap)</dd></div>' +
            '<div><dt>Expires</dt><dd>' + fmtDate(C.expires) + ' · 12 months, for the incident review</dd></div>' +
          '</dl>' +
          '<p class="p-kept__note">' + esc(C.keptBy) + ' Everything outside this window and scope is kept as daily summaries, as usual.</p>' +
        '</div>' +
        '<div class="p-kpis p-kpis--closeup" id="cu-kpis"></div>' +
        '<div class="p-closeup__key" id="cu-legend">' + C.states.map(function (s) {
          return '<span class="p-closeup__keyitem"><span class="p-closeup__swatch" style="background:' + s.color + '"></span>' + esc(s.label) + '</span>';
        }).join('') + '</div>' +
        '<div class="chart-wrap p-closeup__chart" id="cu-wrap"><svg id="cu-sankey" class="sankey" role="img" aria-label="Hourly Sankey for the kept window"></svg></div>' +
        '<div class="p-timeline p-timeline--hours">' +
          '<div class="p-timeline__controls">' +
            '<button type="button" class="p-icon-button" id="cu-prev" aria-label="Previous hour">◀</button>' +
            '<button type="button" class="p-button p-button--positive" id="cu-play">▶ Play</button>' +
            '<button type="button" class="p-icon-button" id="cu-next" aria-label="Next hour">▶</button>' +
            '<span class="p-timeline__period" id="cu-period"></span>' +
          '</div>' +
          '<div class="p-timeline__track">' +
            '<div class="p-timeline__markers">' + C.events.map(function (e, i) {
              return '<button type="button" class="p-timeline__event" data-hour="' + e.h + '" style="left:' + (e.h / LASTH * 100) + '%" title="' + esc(hhmm(e.h) + ' · ' + e.label) + '" aria-label="' + esc(hhmm(e.h) + ': ' + e.label) + '">' + (i + 1) + '</button>';
            }).join('') + '</div>' +
            '<input type="range" class="p-timeline__range" id="cu-range" min="0" max="' + LASTH + '" step="0.01" aria-label="Hour">' +
            '<div class="p-timeline__ticks">' + Array.apply(null, Array(C.hours / 3)).map(function (_, k) {
              const h = k * 3;
              return '<button type="button" class="p-timeline__tick" data-hour="' + h + '" style="left:' + (h / LASTH * 100) + '%">' + hhmm(h) + '</button>';
            }).join('') + '</div>' +
          '</div>' +
          '<ol class="p-closeup__events" id="cu-events">' + C.events.map(function (e, i) {
            return '<li><button type="button" class="p-closeup__event" data-hour="' + e.h + '"><span class="p-closeup__num">' + (i + 1) + '</span><span class="p-closeup__time">' + hhmm(e.h) + '</span>' + esc(e.label) + '</button></li>';
          }).join('') + '</ol>' +
        '</div>' +
        '<div class="tooltip p-closeup__tip" id="cu-tip" role="tooltip" hidden></div>' +
      '</div>';

    $('cu-close').addEventListener('click', close);
    $('cu-range').addEventListener('input', function (e) { stop(); st.h = +e.target.value; draw(); });
    $('cu-range').addEventListener('change', function (e) { st.h = Math.round(+e.target.value); draw(); });
    $('cu-play').addEventListener('click', function () { st.playing ? stop() : play(); });
    $('cu-prev').addEventListener('click', function () { stop(); setHour(Math.ceil(st.h) - 1); });
    $('cu-next').addEventListener('click', function () { stop(); setHour(Math.floor(st.h) + 1); });
    dlg.addEventListener('click', function (e) {
      const b = e.target.closest('[data-hour]');
      if (b) { stop(); setHour(Math.floor(+b.dataset.hour)); }
      else if (e.target === dlg) close(); // click on the backdrop
    });
    const svg = $('cu-sankey'), tip = $('cu-tip');
    svg.addEventListener('mousemove', function (e) {
      const n = e.target.closest('[data-node]');
      if (!n) { tip.hidden = true; return; }
      tip.innerHTML = tipHtml(n.dataset.node);
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
      if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 14;
      tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
    });
    svg.addEventListener('mouseleave', function () { tip.hidden = true; });
    dlg.addEventListener('close', stop);
    if (window.ResizeObserver) new ResizeObserver(function () { if (dlg.open) draw(); }).observe($('cu-wrap'));
  }

  function tipHtml(id) {
    const p = TL.parseNodeId(id), h = Math.min(LASTH, Math.round(st.h));
    const agg = aggHour(h), n = agg.nodes[id];
    let out = '<span class="tooltip__dim">' + esc(TL.DIMENSIONS[p.dim].label) + '</span><strong>' + esc(TL.nodeLabel(id)) + '</strong>';
    if (p.dim === 'device') {
      const d = TL.closeupDevice(p.val, h);
      const s = Object.keys(d.state).sort(function (a, b) { return d.state[b] - d.state[a]; })[0];
      const restarts = TL.closeupFacts(h).filter(function (f) { return f.device === p.val; }).reduce(function (a, f) { return a + f.restarts; }, 0);
      out += '<div>' + esc(stateLabel[s]) + ' at ' + hhmm(h) + '</div>';
      out += '<div class="tooltip__note">' + (d.spared
        ? 'Hadn’t refreshed when the hold went in at ' + hhmm(C.holdAt) + ', so it never ran r214'
        : 'Refreshed to r214 at ' + hhmm(d.refreshAt)) + '</div>';
      if (restarts) out += '<div>' + Math.round(restarts) + ' restarts this hour</div>';
    }
    if (n) out += '<div>' + fmt(n.value) + ' events/h this hour</div>';
    return out;
  }

  function draw() {
    const h = st.h, hi = Math.min(LASTH, Math.round(h));
    const agg = aggAt(h);
    const wrap = $('cu-wrap'), svg = $('cu-sankey');
    const width = Math.max(window.innerWidth <= 760 ? 860 : 680, wrap.clientWidth || 860);
    const n1 = Object.keys(agg.nodes).filter(function (k) { return agg.nodes[k].col === 0; }).length;
    const L = S.layout(agg, STAGES, width, Math.max(360, n1 * 24), many ? null : { order0: order0, minNode0: 14 });
    S.render(svg, L, { palette: palette, unit: '/h' });
    const s = hourStats(hi);
    const kpi = function (label, value, sub) {
      return '<div class="p-kpi"><div class="p-kpi__label">' + label + '</div><div class="p-kpi__value">' + value + '</div><div class="p-kpi__sub">' + sub + '</div></div>';
    };
    const dot = function (id) { return '<span class="dot" style="background:' + C.states.filter(function (x) { return x.id === id; })[0].color + '"></span>'; };
    $('cu-kpis').innerHTML =
      kpi(dot('crash') + 'Crash-looping', s.crash + ' <span class="p-kpi__unit">of ' + C.devices.length + ' devices</span>', s.restarts ? Math.round(s.restarts).toLocaleString('en-GB') + ' restarts this hour' : 'No restarts yet') +
      kpi(dot('held') + 'Refresh held', s.held + ' <span class="p-kpi__unit">device' + (s.held === 1 ? '' : 's') + ' on r212</span>', st.h >= C.holdAt ? 'Fleet-wide hold since ' + hhmm(C.holdAt) : 'Hold goes in at ' + hhmm(C.holdAt)) +
      kpi('opcua-connector events', fmt(s.events) + ' <span class="p-kpi__unit">/h</span>', Math.round(s.events / normal * 100) + '% of the hour before r214') +
      kpi('Dropped by schema', fmt(s.schema) + ' <span class="p-kpi__unit">/h</span>', (s.events ? Math.round(s.schema / s.events * 100) : 0) + '% of what was sent');
    $('cu-range').value = h;
    $('cu-period').textContent = clock(hi) + '–' + hhmm(hi + 1) + ' UTC';
    $('cu-play').textContent = st.playing ? '❚❚ Pause' : '▶ Play';
    Array.prototype.forEach.call(dlg.querySelectorAll('.p-timeline__tick'), function (b) { b.classList.toggle('is-active', +b.dataset.hour === hi); });
    Array.prototype.forEach.call(dlg.querySelectorAll('.p-closeup__event, .p-timeline__event'), function (b) {
      const eh = +b.dataset.hour;
      b.classList.toggle('is-past', eh < hi + 1);
      b.classList.toggle('is-now', eh >= hi && eh < hi + 1);
    });
  }

  function setHour(h) { st.h = Math.max(0, Math.min(LASTH, h)); draw(); }
  let timer = null;
  function play() {
    if (st.h >= LASTH) st.h = 0;
    st.playing = true;
    let last = performance.now();
    function step(now) {
      if (!st.playing) return;
      st.h = Math.min(LASTH, st.h + (now - last) / 600);
      last = now;
      draw();
      if (st.h >= LASTH) { stop(); return; }
      timer = requestAnimationFrame(step);
    }
    timer = requestAnimationFrame(step);
  }
  function stop() {
    if (!st.playing) return;
    st.playing = false; cancelAnimationFrame(timer);
    st.h = Math.round(st.h); draw();
  }

  function open(h) {
    if (!dlg.dataset.built) { dlg.dataset.built = '1'; build(); }
    st.h = h != null ? h : 0;
    if (!dlg.open) dlg.showModal();
    draw();
    $('cu-close').focus();
  }
  function close() { stop(); if (dlg.open) dlg.close(); }

  TL.closeup = { open: open, close: close, summary: summary, month: C.month, isOpen: function () { return dlg.open; } };
})(window.TL);
