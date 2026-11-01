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
  const KEY = 'tl.insights.comments.v9';

  const SEED = [
    // SRE incident thread (Health view, grouped by Site, on Factory floor)
    { anchor: { view: 'health', groupBy: 'site', node: 'site:factory', period: '2026-06' }, createdAt: '2026-06-17T08:42:00Z',
      author: 'Ana Ribeiro · SRE', body: 'Factory health is falling fast: stability is near zero on most plants and opcua-connector telemetry has halved. Started right after opcua-connector r214 hit stable on Monday. Paging plant IT.' },
    { anchor: { view: 'health', groupBy: 'site', node: 'site:factory', period: '2026-06' }, createdAt: '2026-06-17T09:15:00Z',
      author: 'Tom Okafor · SRE', body: 'Confirmed: r214 segfaults on the older PLC firmware, so it’s crash-looping on ldn and sgp plants first. I’ve put a fleet-wide snap refresh hold in place until we know the blast radius.' },
    { anchor: { view: 'health', groupBy: 'site', node: 'site:factory', period: '2026-07' }, createdAt: '2026-07-08T13:30:00Z',
      author: 'Ana Ribeiro · SRE', body: 'The hold is hurting now. Snap refresh and patch currency are sliding on every site, not just factories: fleet average is down to 56 from 73. Factories are at 39. We can’t keep a blanket hold much longer.' },
    { anchor: { view: 'health', groupBy: 'site', node: 'site:factory', period: '2026-07' }, createdAt: '2026-07-08T14:05:00Z',
      author: 'Tom Okafor · SRE', body: 'Agreed. Plan: pin factories back to r212 with a channel override, then lift the hold for everything except opcua-connector. Rolling back fra-plant-01 first as a canary.' },
    { anchor: { view: 'health', groupBy: 'site', node: 'site:factory', period: '2026-08' }, createdAt: '2026-08-04T10:20:00Z',
      author: 'Tom Okafor · SRE', body: 'Rollback to r212 is done on all plants. Stability is back above 70 and the reporting gaps have closed. Hold lifted for every other snap.' },
    { anchor: { view: 'health', groupBy: 'site', node: 'site:factory', period: '2026-08' }, createdAt: '2026-08-05T09:00:00Z',
      author: 'Ana Ribeiro · SRE', body: 'Vendor has a fix in r216 on the candidate channel. Running it on fra-plant-01 for two weeks before we promote.' },
    { anchor: { view: 'health', groupBy: 'site', node: 'site:factory', period: '2026-09' }, createdAt: '2026-09-11T15:40:00Z',
      author: 'Ana Ribeiro · SRE', body: 'r216 has been clean on the canary for two weeks; promoted to all plants. Factory health is back to 69, the same as before the incident.' },
    { anchor: { view: 'health', groupBy: 'site', node: 'site:factory', period: '2026-09' }, createdAt: '2026-09-11T16:02:00Z',
      author: 'Tom Okafor · SRE', body: 'Follow-up from the review: opcua-connector refreshes now go to one canary plant first, with a 7-day soak before the rest. Closing this out.' },
    { anchor: { view: 'health', groupBy: 'health', node: 'health:31-40', period: '2026-07' }, createdAt: '2026-07-08T13:45:00Z',
      author: 'Ana Ribeiro · SRE', body: 'Most of this band in July is the opcua-connector incident on factory devices. The full thread is under Group by: Site → Factory floor.' },
    { anchor: { view: 'health', groupBy: 'health', node: 'health:21-30', period: null },
      author: 'Plant IT · London', body: 'This is ldn-plant-04: still on 20.04 and unpatched since the line was retooled. Booked for rebuild next month.' },
    { anchor: { view: 'juju', groupBy: 'juju', node: 'juju:2.9', period: null },
      author: 'Platform engineering', body: 'These are the last Juju 2.9 deployments. Can we export the device list for the upgrade backlog?' },
    { anchor: { view: 'juju', groupBy: 'juju', node: 'juju:4.1', period: '2026-06' },
      author: 'Infrastructure ops · EMEA', body: '4.1 upgrades pick up from here, after the Frankfurt data-centre maintenance window.' },
    { anchor: { view: 'juju', groupBy: 'device', node: 'device:fra-plant-01', period: null },
      author: 'Plant IT · Frankfurt', body: 'Line 3 controller. Its opcua-connector volume doubled after the new sensors went in; expected.' },
    { anchor: { view: 'jaas', groupBy: 'jaas', node: 'jaas:jaas', period: '2026-04' },
      author: 'Platform engineering', body: 'We started consolidating self-hosted controllers into JAAS in April.' },
    { anchor: { view: 'maas', groupBy: 'site', node: 'publisher:shelfcam', period: null },
      author: 'Data protection officer', body: 'shelf-vision is camera-derived. Confirm snapd’s PII redaction (R6) strips faces before anything leaves the store.' },
    { anchor: { view: 'microcloud', groupBy: 'site', node: 'site:store', period: null },
      author: 'Store systems', body: 'MicroCloud is being rolled out store by store to replace the old back-office servers.' },
    { anchor: { view: 'sovereignty', groupBy: 'sovereignty', node: 'destination:lake-us', period: null },
      author: 'Security operations', body: 'Telemetry from EU-residency devices still reaches the US data lake via rule R2 (15% of payment-vault telemetry is copied there). Rule order needs fixing so residency wins.' },
    { anchor: { view: 'sovereignty', groupBy: 'device', node: 'policy:eu-res', period: '2026-05' },
      author: 'Legal · EU', body: 'EU residency policy went live here. Matches the date in our data-processing records.' },
    { anchor: { view: 'confidential', groupBy: 'confidential', node: 'publisher:payment', period: '2026-08' },
      author: 'Payments team', body: 'payment-vault only runs on confidential VMs, so its volume is a good proxy for how far the PCI migration has got.' },
    { anchor: { view: 'stack', groupBy: 'site', node: 'site:factory', period: null },
      author: 'Manufacturing IT', body: 'Factories are where predictive-maintenance and OPC UA telemetry dominate. These go to ITSM under the OT policy.' }
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
