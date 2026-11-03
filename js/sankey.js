/*
 * Aggregation, interpolation, layout and SVG rendering for the Sankey.
 * No dependencies.
 *
 * - Every node and link carries `seg`: its volume split by the active view's
 *   attribute (e.g. { '4.1': 120, '3.6': 80, none: 40 }), so a view colours
 *   flows end to end without changing the columns.
 * - Columns are top-aligned: the top stream runs horizontally and the others
 *   rise into it.
 * - Node order inside a column is fixed, so nothing jumps during playback.
 */
(function (TL) {
  'use strict';

  function addSeg(o, k, v) { o[k] = (o[k] || 0) + v; }

  /**
   * opts.filter(f)  – include fact?
   * opts.segAttr    – attribute to split flows by (the view)
   * opts.focus(f)   – is fact on the focused node's path?
   * opts.col0(f)    – optional value to use for column 1 instead of f[stages[0]]
   */
  function aggregate(facts, stages, opts) {
    opts = opts || {};
    const nodes = {}, links = {}, seg = opts.segAttr;
    let total = 0;
    const totalSeg = {};
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i];
      if (opts.filter && !opts.filter(fact)) continue;
      const c = fact.count, by = fact.bytes || 0, sv = seg ? fact[seg] : '_';
      const fo = opts.focus && opts.focus(fact) ? c : 0;
      total += c; addSeg(totalSeg, sv, c);
      let prev = null;
      for (let s = 0; s < stages.length; s++) {
        // opts.col0 can remap column 1 (e.g. devices outside the top N become 'Others')
        const val = s === 0 && opts.col0 ? opts.col0(fact) : fact[stages[s]];
        const id = stages[s] + ':' + val;
        const n = nodes[id] || (nodes[id] = { id: id, dim: stages[s], val: val, col: s, value: 0, b: 0, f: 0, seg: {}, segF: {} });
        n.value += c; n.b += by; n.f += fo; addSeg(n.seg, sv, c); if (fo) addSeg(n.segF, sv, fo);
        if (prev) {
          const key = prev + '>' + id;
          const l = links[key] || (links[key] = { key: key, source: prev, target: id, col: s - 1, value: 0, b: 0, f: 0, seg: {}, segF: {} });
          l.value += c; l.b += by; l.f += fo; addSeg(l.seg, sv, c); if (fo) addSeg(l.segF, sv, fo);
        }
        prev = id;
      }
    }
    return { nodes: nodes, links: links, total: total, totalSeg: totalSeg };
  }

  /** Linear interpolation between two aggregates (smooth time scrubbing). */
  function interpolate(a, b, t) {
    if (t <= 0) return a;
    if (t >= 1) return b;
    const lerp = function (x, y) { return x + (y - x) * t; };
    const mixSeg = function (x, y) {
      const o = {}; Object.keys(x || {}).concat(Object.keys(y || {})).forEach(function (k) { o[k] = lerp((x || {})[k] || 0, (y || {})[k] || 0); }); return o;
    };
    const mix = function (A, B) {
      const out = {};
      Object.keys(A).concat(Object.keys(B)).forEach(function (k) {
        if (out[k]) return;
        const x = A[k], y = B[k];
        const o = Object.assign({}, x || y);
        o.value = lerp(x ? x.value : 0, y ? y.value : 0);
        o.b = lerp(x ? x.b || 0 : 0, y ? y.b || 0 : 0);
        o.f = lerp(x ? x.f : 0, y ? y.f : 0);
        o.seg = mixSeg(x && x.seg, y && y.seg);
        o.segF = mixSeg(x && x.segF, y && y.segF);
        out[k] = o;
      });
      return out;
    };
    return { nodes: mix(a.nodes, b.nodes), links: mix(a.links, b.links), total: lerp(a.total, b.total), totalSeg: mixSeg(a.totalSeg, b.totalSeg) };
  }

  /** Positions. Columns are top-aligned. */
  function layout(agg, stages, width, height, o) {
    o = Object.assign({ nodeWidth: 12, marginX: 30, marginRight: 190, marginY: 6 }, o || {});
    const innerW = width - o.marginX - o.marginRight, innerH = height - o.marginY * 2;
    const cols = stages.map(function (dim, ci) {
      const c = TL.DIMENSIONS[dim].values
        .map(function (v) { return agg.nodes[dim + ':' + v.id]; })
        .filter(function (n) { return n && n.value > 0.01; });
      // o.order0 can set column 1's order (e.g. ranked top N, Others last)
      if (ci === 0 && o.order0) c.sort(function (a, b) { return (o.order0[a.val] != null ? o.order0[a.val] : 1e9) - (o.order0[b.val] != null ? o.order0[b.val] : 1e9); });
      return c;
    });
    // o.minNode0: minimum bar height in column 1 so names stay readable (flows stay proportional)
    const minH = function (ci) { return ci === 0 && o.minNode0 ? o.minNode0 : 1; };
    const pads = cols.map(function (c) { return c.length > 14 ? 4 : c.length > 8 ? 10 : 16; });
    let ky = Infinity;
    cols.forEach(function (c, i) {
      const sum = c.reduce(function (s, n) { return s + n.value; }, 0);
      if (sum > 0) ky = Math.min(ky, (innerH - pads[i] * (c.length - 1)) / sum);
    });
    if (!isFinite(ky)) ky = 0;
    const step = stages.length > 1 ? (innerW - o.nodeWidth) / (stages.length - 1) : 0;
    const placed = {}, nodes = [];
    cols.forEach(function (c, ci) {
      let y = o.marginY; // top-aligned
      c.forEach(function (n) {
        const ht = Math.max(minH(ci), n.value * ky);
        const p = Object.assign({}, n, { x: o.marginX + ci * step, y: y, ht: ht, w: o.nodeWidth, last: ci === stages.length - 1, outs: [], ins: [] });
        y += (ci === 0 && o.minNode0 ? ht : n.value * ky) + pads[ci];
        placed[n.id] = p; nodes.push(p);
      });
    });
    const links = [];
    Object.keys(agg.links).forEach(function (k) {
      const l = agg.links[k];
      const s = placed[l.source], t = placed[l.target];
      if (!s || !t || l.value <= 0.01) return;
      const p = Object.assign({}, l, { s: s, t: t, w: l.value * ky });
      s.outs.push(p); t.ins.push(p); links.push(p);
    });
    nodes.forEach(function (n) {
      n.outs.sort(function (a, b) { return a.t.y - b.t.y; });
      n.ins.sort(function (a, b) { return a.s.y - b.s.y; });
      let off = 0; n.outs.forEach(function (l) { l.sy = n.y + off; off += l.w; });
      off = 0; n.ins.forEach(function (l) { l.ty = n.y + off; off += l.w; });
    });
    // a column with minimum heights can run past the planned height: grow to fit
    const bottom = nodes.reduce(function (mx, n) { return Math.max(mx, n.y + n.ht); }, 0) + o.marginY;
    return { nodes: nodes, links: links, width: width, height: Math.max(height, Math.ceil(bottom)), ky: ky };
  }

  // ---- Rendering ------------------------------------------------------
  /*
   * Band for a slice [offset, offset + w] of link l (measured from its top).
   * The link's centre line is a cubic Bézier; the slice edges are offset
   * along the curve's normal, so the band keeps a constant thickness even
   * where the curve is steep (a plain vertical offset would pinch it).
   * At both ends the tangent is horizontal, so the band meets nodes square.
   */
  let SAMPLES = 48; // points per curve; lowered for dense charts (see render)
  function band(l, offset, w) {
    const x0 = l.s.x + l.s.w, x1 = l.t.x, dx = x1 - x0;
    const c0 = x0 + dx * 0.5, c1 = x1 - dx * 0.5;
    const ya = l.sy + l.w / 2, yb = l.ty + l.w / 2;
    const a = offset - l.w / 2, b = a + w;
    const top = [], bot = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES, mt = 1 - t;
      const x = mt * mt * mt * x0 + 3 * mt * mt * t * c0 + 3 * mt * t * t * c1 + t * t * t * x1;
      const y = (mt * mt * mt + 3 * mt * mt * t) * ya + (3 * mt * t * t + t * t * t) * yb;
      const tx = 3 * mt * mt * (c0 - x0) + 6 * mt * t * (c1 - c0) + 3 * t * t * (x1 - c1);
      const ty = 6 * mt * t * (yb - ya);
      const len = Math.hypot(tx, ty) || 1;
      const nx = -ty / len, ny = tx / len;
      top.push((x + nx * a).toFixed(1) + ',' + (y + ny * a).toFixed(1));
      bot.push((x + nx * b).toFixed(1) + ',' + (y + ny * b).toFixed(1));
    }
    return 'M' + top.join('L') + 'L' + bot.reverse().join('L') + 'Z';
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) {
    n = Math.round(n);
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e4) return Math.round(n / 1e3) + 'k';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }
  function pct(a, b) { if (!b || !a) return 0; const v = 100 * a / b; return v < 1 ? '<1' : Math.round(v); }

  /**
   * opts: {
   *   palette: [{ id, color|null }]   – view values in stacking order
   *   isolate: valueId|null           – colour only this value
   *   focusId, selectedId, commentCounts, showCommentBadges, deltas
   *   unit: rate shown after node values (default '/day')
   * }
   */
  function render(svg, L, opts) {
    const palette = opts.palette || [];
    const focusing = !!opts.focusId;
    const colorOf = function (id) {
      const p = palette.filter(function (x) { return x.id === id; })[0];
      if (!p || !p.color) return null;
      if (opts.isolate && opts.isolate !== id) return null;
      return p.color;
    };
    // stacked segment paths inside a band (from the top)
    function segPaths(l, segs, total, cls) {
      let off = 0, out = '';
      palette.forEach(function (p) {
        const v = segs[p.id] || 0; if (!v) return;
        const w = v / l.value * l.w;
        const c = colorOf(p.id);
        if (c && w > 0.15) out += '<path class="' + cls + '" style="fill:' + c + '" d="' + band(l, off, w) + '"/>';
        else if (!c && cls === 'sk-link__focus' && w > 0.15) out += '<path class="sk-link__focus-grey" d="' + band(l, off, w) + '"/>';
        off += w;
      });
      return out;
    }
    // dense charts (hundreds of flow segments) use fewer points per curve: the difference
    // isn't visible at that density, but drawing time is
    SAMPLES = L.links.length > 120 ? 16 : 48;
    const parts = [];
    parts.push('<g class="sk-links">');
    L.links.forEach(function (l) {
      parts.push('<g class="sk-link' + (focusing ? ' is-focusing' : '') + (focusing && l.f < 0.01 ? ' is-dim' : '') + '" data-link="' + esc(l.key) + '">');
      parts.push('<path class="sk-link__base" d="' + band(l, 0, l.w) + '"/>');
      if (focusing) { if (l.f > 0.01) parts.push(segPaths(l, l.segF, l.f, 'sk-link__focus')); }
      else parts.push(segPaths(l, l.seg, l.value, 'sk-link__seg'));
      parts.push('</g>');
    });
    parts.push('</g><g class="sk-nodes">');
    L.nodes.forEach(function (n) {
      const v = TL.valueOf(n.dim, n.val) || { label: n.val };
      const isSel = opts.selectedId === n.id, isFocus = opts.focusId === n.id;
      const dim = focusing && n.f < 0.01;
      const cls = 'sk-node' + (isSel ? ' is-selected' : '') + (isFocus ? ' is-focus' : '') + (dim ? ' is-dim' : '');
      parts.push('<g class="' + cls + '" data-node="' + esc(n.id) + '" tabindex="0" role="button" aria-label="' + esc(v.label + ', ' + fmt(n.value) + ' events per day') + '">');
      parts.push('<rect class="sk-node__hit" x="' + (n.x - 4) + '" y="' + (n.y - 1) + '" width="' + (n.w + 8) + '" height="' + (n.ht + 2) + '"/>');
      parts.push('<rect class="sk-node__bar" x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.ht + '"/>');
      // stacked colour on the node bar
      let off = 0;
      const segs = focusing ? n.segF : n.seg;
      palette.forEach(function (p) {
        const val = (n.seg[p.id] || 0); if (!val) return;
        const h = val / n.value * n.ht;
        const c = colorOf(p.id);
        const shown = focusing ? (segs[p.id] || 0) / n.value * n.ht : h;
        if (c && shown > 0.3) parts.push('<rect class="sk-node__seg" style="fill:' + c + '" x="' + n.x + '" y="' + (n.y + off) + '" width="' + n.w + '" height="' + shown + '"/>');
        off += h;
      });
      // label
      const right = true; // labels sit right of every node; last column has a reserved margin
      const lx = right ? n.x + n.w + 6 : n.x - 6;
      const cy = n.y + n.ht / 2;
      const anchor = right ? 'start' : 'end';
      const showMeta = n.ht >= 22;
      const small = n.ht < 12;
      parts.push('<text class="sk-label' + (small ? ' sk-label--small' : '') + '" x="' + lx + '" y="' + (showMeta ? cy - 2 : cy + 4) + '" text-anchor="' + anchor + '">');
      parts.push(esc(v.label) + '</text>');
      if (showMeta) {
        parts.push('<text class="sk-meta" x="' + lx + '" y="' + (cy + 12) + '" text-anchor="' + anchor + '">' + fmt(n.value) + (opts.unit || '/day'));
        if (opts.deltas && opts.deltas[n.id] != null && isFinite(opts.deltas[n.id])) {
          const d = opts.deltas[n.id];
          const cl = d > 0.5 ? 'up' : d < -0.5 ? 'down' : 'flat';
          parts.push('<tspan class="sk-delta sk-delta--' + cl + '"> ' + (d > 0.5 ? '▲' : d < -0.5 ? '▼' : '■') + Math.abs(Math.round(d)) + '%</tspan>');
        }
        parts.push('</text>');
      }
      if (opts.showCommentBadges) {
        const cnt = (opts.commentCounts && opts.commentCounts[n.id]) || 0;
        const bx = right ? n.x - 24 : n.x + n.w + 4;
        parts.push('<g class="sk-badge' + (cnt ? ' has-comments' : '') + '" transform="translate(' + bx + ',' + (cy - 9) + ')">' +
          '<path d="M2,0h16a2,2 0 0 1 2,2v10a2,2 0 0 1 -2,2h-9l-4,4v-4h-3a2,2 0 0 1 -2,-2v-10a2,2 0 0 1 2,-2z"/>' +
          '<text x="10" y="10.5" text-anchor="middle">' + (cnt || '+') + '</text></g>');
      }
      parts.push('</g>');
    });
    parts.push('</g>');
    svg.setAttribute('viewBox', '0 0 ' + L.width + ' ' + L.height);
    svg.setAttribute('width', L.width);
    svg.setAttribute('height', L.height);
    svg.innerHTML = parts.join('');
  }

  TL.sankey = { aggregate: aggregate, interpolate: interpolate, layout: layout, render: render, fmt: fmt, pct: pct, esc: esc };
})(window.TL);
