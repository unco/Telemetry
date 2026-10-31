/*
 * Comment store.
 *
 * A comment is anchored to a *context* and a *node*:
 *
 *   {
 *     id:      'cm_…',
 *     anchor:  {
 *       view:    'sovereignty',        // view id
 *       groupBy: 'region' | 'none',    // group-by in effect
 *       node:    'hosting:sovcloud',   // "<dimension>:<value>" — stable over time
 *       period:  '2026-03' | null      // optional: pinned to a month (tab 4)
 *     },
 *     author, body, createdAt (ISO), resolved: false
 *   }
 *
 * The same node can therefore carry different conversations in different
 * view/group-by combinations; `elsewhere()` surfaces those so nothing is lost
 * when the user switches context. Persisted to localStorage.
 */
(function (TL) {
  'use strict';
  const KEY = 'tl.insights.comments.v1';

  const SEED = [
    { anchor: { view: 'canonical-infra', groupBy: 'none', node: 'substrate:vmware', period: '2026-02' },
      author: 'Field engineering · EMEA', body: 'VMware share starts falling here — lines up with the renewal-price change. Worth checking whether MicroCloud or OpenStack is absorbing most of it.' },
    { anchor: { view: 'canonical-infra', groupBy: 'none', node: 'substrate:microcloud', period: '2026-06' },
      author: 'Product · MicroCloud', body: 'Edge + VMware migrations are both landing here. Can we split “new” vs “migrated” machines in a future view?' },
    { anchor: { view: 'canonical-infra', groupBy: 'none', node: 'orchestration:jaas', period: null },
      author: 'Product · Juju', body: 'JAAS growth is mostly existing Juju users consolidating controllers, not net-new. Do not read it as new adoption.' },
    { anchor: { view: 'canonical-infra', groupBy: 'industry', node: 'industry:telco', period: null },
      author: 'UX research', body: 'Telco is the clearest full-stack story (edge → MicroCloud → Juju). Good candidate for the next round of interviews.' },
    { anchor: { view: 'sovereignty', groupBy: 'region', node: 'region:eu', period: '2026-05' },
      author: 'Strategy', body: 'EU repatriation to sovereign providers accelerates from May. Is this driven by public-sector tenders?' },
    { anchor: { view: 'sovereignty', groupBy: 'none', node: 'keys:provider', period: null },
      author: 'Security engineering', body: 'Provider-held keys on sovereign providers is the gap — in-jurisdiction but not customer-controlled. Flag in the sovereignty narrative.' },
    { anchor: { view: 'sovereignty', groupBy: 'none', node: 'jurisdiction:region', period: null },
      author: 'Legal', body: '“In-region, foreign operator” is still exposed to extraterritorial law. Keep it visually distinct from in-jurisdiction.' },
    { anchor: { view: 'confidential', groupBy: 'industry', node: 'industry:finance', period: null },
      author: 'Sales · Financial services', body: 'Finance leads confidential adoption, mostly TDX on public cloud. On-prem CC is the opportunity.' },
    { anchor: { view: 'confidential', groupBy: 'none', node: 'confidential:cca', period: '2026-08' },
      author: 'Telemetry team', body: 'Arm CCA counts are small — confirm the agent reports realm VMs correctly before this goes in a deck.' },
    { anchor: { view: 'confidential', groupBy: 'none', node: 'workload:ai', period: null },
      author: 'Product · AI', body: 'Confidential AI is the fastest-growing slice. Track it as its own KPI.' }
  ];

  function uid() { return 'cm_' + Math.random().toString(36).slice(2, 10); }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return seed();
  }
  function seed() {
    const base = Date.parse('2026-10-20T09:00:00Z');
    return SEED.map(function (c, i) {
      return Object.assign({ id: uid(), createdAt: new Date(base + i * 3600e3 * 7).toISOString(), resolved: false }, c);
    });
  }
  let items = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) { /* ignore */ } }
  const listeners = [];
  function emit() { save(); listeners.forEach(function (fn) { fn(); }); }

  function sameCtx(a, ctx) { return a.view === ctx.view && a.groupBy === ctx.groupBy; }

  TL.comments = {
    onChange: function (fn) { listeners.push(fn); },
    /** Comments for a node in the current view/group-by. */
    forNode: function (ctx, node) {
      return items.filter(function (c) { return sameCtx(c.anchor, ctx) && c.anchor.node === node; })
        .sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
    },
    /** All comments in the current view/group-by. */
    forContext: function (ctx) {
      return items.filter(function (c) { return sameCtx(c.anchor, ctx); })
        .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    },
    /** Same node, other view/group-by contexts. */
    elsewhere: function (ctx, node) {
      return items.filter(function (c) { return c.anchor.node === node && !sameCtx(c.anchor, ctx); });
    },
    /** { nodeId: count } for badges. */
    counts: function (ctx) {
      const out = {};
      items.forEach(function (c) { if (sameCtx(c.anchor, ctx) && !c.resolved) out[c.anchor.node] = (out[c.anchor.node] || 0) + 1; });
      return out;
    },
    add: function (anchor, body, author) {
      items.push({ id: uid(), anchor: anchor, author: author || 'You', body: body, createdAt: new Date().toISOString(), resolved: false });
      emit();
    },
    toggleResolved: function (id) {
      items.forEach(function (c) { if (c.id === id) c.resolved = !c.resolved; });
      emit();
    },
    remove: function (id) { items = items.filter(function (c) { return c.id !== id; }); emit(); },
    reset: function () { items = seed(); emit(); }
  };
})(window.TL);
