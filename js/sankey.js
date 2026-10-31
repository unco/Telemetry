/*
 * Aggregation, interpolation, layout and SVG rendering for the Sankey.
 * No dependencies. Node order inside a column is the fixed dimension
 * order (not sorted by size) so flows stay put while scrubbing time.
 */
(function (TL) {
  'use strict';

  /**
   * Aggregate facts into nodes and links across the given stages.
   *  opts.filter(f)    – include fact?
   *  opts.highlight(f) – is fact in the view's highlighted set?
   *  opts.focus(f)     – is fact on the path of the focused node?
   * Every node/link carries: value, h (highlighted), f (focused), hf (both).
   */
  function aggregate(facts, stages, opts) {
    opts = opts || {};
    const nodes = {}, links = {};
    let total = 0, htotal = 0;
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i];
      if (opts.filter && !opts.filter(fact)) continue;
      const c = fact.count;
      const h = opts.highlight && opts.highlight(fact) ? c : 0;
      const fo = opts.focus && opts.focus(fact) ? c : 0;
      const hf = h && fo ? c : 0;
      total += c; htotal += h;
      let prev = null;
      for (let s = 0; s < stages.length; s++) {
        const id = stages[s] + ':' + fact[stages[s]];
        const n = nodes[id] || (nodes[id] = { id: id, dim: stages[s], val: fact[stages[s]], col: s, value: 0, h: 0, f: 0, hf: 0 });
        n.value += c; n.h += h; n.f += fo; n.hf += hf;
        if (prev) {
          const key = prev + '>' + id;
          const l = links[key] || (links[key] = { key: key, source: prev, target: id, col: s - 1, value: 0, h: 0, f: 0, hf: 0 });
          l.value += c; l.h += h; l.f += fo; l.hf += hf;
        }
        prev = id;
      }
    }
    return { nodes: nodes, links: links, total: total, htotal: htotal };
  }

  /** Linear interpolation between two aggregates (for smooth time scrubbing). */
  function interpolate(a, b, t) {
    if (t <= 0) return a;
    if (t >= 1) return b;
    const lerp = function (x, y) { return x + (y - x) * t; };
    const mix = function (A, B) {
      const out = {};
      Object.keys(A).concat(Object.keys(B)).forEach(function (k) {
        if (out[k]) return;
        const x = A[k], y = B[k], base = x || y;
        const o = Object.assign({}, base);
        ['value', 'h', 'f', 'hf'].forEach(function (p) { o[p] = lerp(x ? x[p] : 0, y ? y[p] : 0); });
        out[k] = o;
      });
      return out;
    };
    return { nodes: mix(a.nodes, b.nodes), links: mix(a.links, b.links), total: lerp(a.total, b.total), htotal: lerp(a.htotal, b.htotal) };
  }

  /** Compute positions. Returns { nodes:[], links:[], width, height }. */
  function layout(agg, stages, width, height, o) {
    o = Object.assign({ nodeWidth: 14, pad: 16, marginX: 30, marginY: 8 }, o || {});
    const innerW = width - o.marginX * 2, innerH = height - o.marginY * 2;
    const cols = stages.map(function (dim) {
      return TL.DIMENSIONS[dim].values
        .map(function (v) { return agg.nodes[dim + ':' + v.id]; })
        .filter(function (n) { return n && n.value > 0.01; });
    });
    let ky = Infinity;
    cols.forEach(function (c) {
      const sum = c.reduce(function (s, n) { return s + n.value; }, 0);
      if (sum > 0) ky = Math.min(ky, (innerH - o.pad * (c.length - 1)) / sum);
    });
    if (!isFinite(ky)) ky = 0;
    const step = stages.length > 1 ? (innerW - o.nodeWidth) / (stages.length - 1) : 0;
    const placed = {};
    const nodes = [];
    cols.forEach(function (c, ci) {
      const sum = c.reduce(function (s, n) { return s + n.value; }, 0);
      const colH = sum * ky + o.pad * (c.length - 1);
      let y = o.marginY + (innerH - colH) / 2;
      c.forEach(function (n) {
        const p = Object.assign({}, n, { x: o.marginX + ci * step, y: y, ht: Math.max(1, n.value * ky), w: o.nodeWidth, last: ci === stages.length - 1, outs: [], ins: [] });
        y += n.value * ky + o.pad;
        placed[n.id] = p; nodes.push(p);
      });
    });
    const links = [];
    Object.keys(agg.links).forEach(function (k) {
      const l = agg.links[k];
      const s = placed[l.source], t = placed[l.target];
      if (!s || !t || l.value <= 0.01) return;
      const p = Object.assign({}, l, { s: s, t: t, w: l.value * ky, wh: l.h * ky, wf: l.f * ky, whf: l.hf * ky });
      s.outs.push(p); t.ins.push(p); links.push(p);
    });
    nodes.forEach(function (n) {
      n.outs.sort(function (a, b) { return a.t.y - b.t.y; });
      n.ins.sort(function (a, b) { return a.s.y - b.s.y; });
      let off = 0; n.outs.forEach(function (l) { l.sy = n.y + off; off += l.w; });
      off = 0; n.ins.forEach(function (l) { l.ty = n.y + off; off += l.w; });
    });
    return { nodes: nodes, links: links, width: width, height: height, ky: ky };
  }

  // ---- Rendering ------------------------------------------------------
  function band(l, offset, w) {
    const x0 = l.s.x + l.s.w, x1 = l.t.x, xm = (x0 + x1) / 2;
    const y0 = l.sy + offset, y1 = l.ty + offset;
    return 'M' + x0 + ',' + y0 + 'C' + xm + ',' + y0 + ' ' + xm + ',' + y1 + ' ' + x1 + ',' + y1 +
      'L' + x1 + ',' + (y1 + w) + 'C' + xm + ',' + (y1 + w) + ' ' + xm + ',' + (y0 + w) + ' ' + x0 + ',' + (y0 + w) + 'Z';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(n) {
    n = Math.round(n);
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e4) return Math.round(n / 1e3) + 'k';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }
  function pct(a, b) { return b ? Math.round(100 * a / b) : 0; }

  /**
   * opts: { color, focusId, selectedId, highlightOn, commentCounts, deltas, showCommentBadges }
   */
  function render(svg, L, opts) {
    const color = opts.color;
    const focusing = !!opts.focusId;
    const parts = [];
    parts.push('<g class="sk-links">');
    L.links.forEach(function (l) {
      const label = TL.nodeLabel(l.source) + ' → ' + TL.nodeLabel(l.target);
      parts.push('<g class="sk-link' + (focusing && l.wf < 0.5 ? ' is-dim' : '') + '" data-link="' + esc(l.key) + '" aria-label="' + esc(label) + '">');
      parts.push('<path class="sk-link__base" d="' + band(l, 0, l.w) + '"/>');
      if (focusing) {
        // focused share sits at the top of the band; highlighted part of it is coloured
        if (l.wf > 0.2) parts.push('<path class="sk-link__focus" d="' + band(l, 0, l.wf) + '"/>');
        if (opts.highlightOn && l.whf > 0.2) parts.push('<path class="sk-link__hl" style="fill:' + color + '" d="' + band(l, 0, l.whf) + '"/>');
      } else if (opts.highlightOn && l.wh > 0.2) {
        parts.push('<path class="sk-link__hl" style="fill:' + color + '" d="' + band(l, 0, l.wh) + '"/>');
      }
      parts.push('</g>');
    });
    parts.push('</g><g class="sk-nodes">');
    L.nodes.forEach(function (n) {
      const v = TL.valueOf(n.dim, n.val) || { label: n.val };
      const isSel = opts.selectedId === n.id, isFocus = opts.focusId === n.id;
      const dim = focusing && n.f < 0.5;
      const cls = 'sk-node' + (isSel ? ' is-selected' : '') + (isFocus ? ' is-focus' : '') + (dim ? ' is-dim' : '') + (v.canonical ? ' is-canonical' : '');
      const sharePct = pct(n.h, n.value);
      parts.push('<g class="' + cls + '" data-node="' + esc(n.id) + '" tabindex="0" role="button" aria-label="' + esc(v.label + ', ' + fmt(n.value) + ' machines' + (opts.highlightOn ? ', ' + sharePct + '% highlighted' : '')) + '">');
      parts.push('<rect class="sk-node__hit" x="' + (n.x - 4) + '" y="' + (n.y - 2) + '" width="' + (n.w + 8) + '" height="' + (n.ht + 4) + '"/>');
      parts.push('<rect class="sk-node__bar" x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.ht + '"/>');
      if (opts.highlightOn && n.h > 0) {
        const hh = (focusing ? n.hf : n.h) / n.value * n.ht;
        if (hh > 0.3) parts.push('<rect class="sk-node__hl" style="fill:' + color + '" x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + hh + '"/>');
      }
      // label
      const right = !n.last;
      const lx = right ? n.x + n.w + 8 : n.x - 8;
      const cy = n.y + n.ht / 2;
      const anchor = right ? 'start' : 'end';
      const showMeta = n.ht >= 20;
      const ly = showMeta ? cy - 2 : cy + 4;
      parts.push('<text class="sk-label" x="' + lx + '" y="' + ly + '" text-anchor="' + anchor + '">');
      if (v.canonical) parts.push('<tspan class="sk-label__canon">◆ </tspan>');
      parts.push('<tspan>' + esc(v.label) + '</tspan></text>');
      if (showMeta) {
        let meta = fmt(n.value);
        if (opts.highlightOn) meta += ' · ' + sharePct + '%';
        parts.push('<text class="sk-meta" x="' + lx + '" y="' + (cy + 12) + '" text-anchor="' + anchor + '">' + esc(meta));
        if (opts.deltas && opts.deltas[n.id] != null && isFinite(opts.deltas[n.id])) {
          const d = opts.deltas[n.id];
          const cl = d > 0.5 ? 'up' : d < -0.5 ? 'down' : 'flat';
          parts.push('<tspan class="sk-delta sk-delta--' + cl + '"> ' + (d > 0 ? '▲' : d < 0 ? '▼' : '■') + Math.abs(Math.round(d)) + '%</tspan>');
        }
        parts.push('</text>');
      }
      // comment badge (opposite side to label)
      if (opts.showCommentBadges) {
        const cnt = (opts.commentCounts && opts.commentCounts[n.id]) || 0;
        const bx = right ? n.x - 24 : n.x + n.w + 4;
        const by = cy - 9;
        parts.push('<g class="sk-badge' + (cnt ? ' has-comments' : '') + '" transform="translate(' + bx + ',' + by + ')">' +
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
