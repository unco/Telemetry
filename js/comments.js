/*
 * Comment store.
 *
 * A comment is anchored to a *context* and a *node*:
 *
 *   {
 *     id:      'cm_…',
 *     anchor:  {
 *       view:    'juju',               // view id
 *       groupBy: 'device' | 'juju' …,  // what column 1 shows
 *       node:    'juju:2.9',           // "<dimension>:<value>" — stable over time
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
  const KEY = 'tl.insights.comments.v3';

  const SEED = [
    { anchor: { view: 'juju', groupBy: 'juju', node: 'juju:2.9', period: null },
      author: 'Product · Juju', body: '2.9 devices are still publishing through the Juju agent. Good list for upgrade outreach — can we export it?' },
    { anchor: { view: 'juju', groupBy: 'juju', node: 'juju:4.1', period: '2026-06' },
      author: 'Field engineering · EMEA', body: '4.1 upgrades pick up from here. Matches the rollout we did with the Frankfurt customers.' },
    { anchor: { view: 'juju', groupBy: 'device', node: 'device:fra-metal-01', period: null },
      author: 'UX research', body: 'Good example device for the interview walkthrough: MAAS + Juju, EU residency.' },
    { anchor: { view: 'jaas', groupBy: 'jaas', node: 'jaas:jaas', period: '2026-04' },
      author: 'Product · JAAS', body: 'Most JAAS growth is existing self-hosted controllers moving over, not net-new Juju users.' },
    { anchor: { view: 'maas', groupBy: 'device', node: 'publisher:maas', period: null },
      author: 'Telemetry team', body: 'The maas snap is one of the largest publishers by volume. Worth checking its sampling rate in snapd.' },
    { anchor: { view: 'microcloud', groupBy: 'type', node: 'type:edge', period: null },
      author: 'Product · MicroCloud', body: 'Edge gateways are where MicroCloud adoption is concentrated.' },
    { anchor: { view: 'sovereignty', groupBy: 'sovereignty', node: 'destination:canonical-global', period: null },
      author: 'Security engineering', body: 'EU-sovereign devices still reach the global destination via rule R2 (attestation evidence, 30% share). Rule order needs fixing so residency wins.' },
    { anchor: { view: 'sovereignty', groupBy: 'device', node: 'policy:eu-res', period: '2026-05' },
      author: 'Legal', body: 'EU residency policy roll-out lands here. Confirm the date with the customer before we present.' },
    { anchor: { view: 'confidential', groupBy: 'confidential', node: 'publisher:attest', period: '2026-08' },
      author: 'Product · Confidential computing', body: 'Attestation volume tracks CC enablement closely. Use it as the adoption KPI.' },
    { anchor: { view: 'stack', groupBy: 'stack', node: 'stack:full', period: null },
      author: 'Strategy', body: 'Full-stack devices publish the richest telemetry. Make this the default lens for the exec review.' }
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
