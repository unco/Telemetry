/*
 * Telemetry Insights — data model
 * ---------------------------------------------------------------
 * The Sankey always shows the telemetry pipeline:
 *
 *      [ column 1 ]  →  Publisher  →  Policy  →  Destination
 *                       (snap)   ↑ snapd     ↑ telemetry endpoint
 *
 * Every snap hands its telemetry to snapd, which enforces naming and
 * on-device rules and multiplexes all snaps into a single stream to the
 * telemetry endpoint. The endpoint demultiplexes, routes and forwards.
 *
 * Column 1 is the only thing that changes:
 *   - no group-by  → one node per DEVICE
 *   - group-by X   → devices collapse into the values of attribute X
 *                    (e.g. Juju 4.1 / 3.6 / 2.9 / none)
 *
 * A VIEW is a lens: it picks one device attribute (e.g. Juju version) and
 * colours every flow by that attribute's value, all the way through
 * publisher, policy and destination. Views never change the columns.
 *
 * Layers:
 *   ATTRIBUTES   – device attributes (vocabulary, ordered values, colours)
 *   PUBLISHERS / POLICIES / DESTINATIONS – the pipeline vocabularies
 *   ROUTING      – declarative, ordered rules: (device attrs, publisher) →
 *                  policy → destination(s). First match wins. Auditable.
 *   DEVICES      – base attributes, onboarding month, publisher volumes and
 *                  dated attribute changes (upgrades, migrations, policy moves)
 *   snapshot(m)  – flattens devices × publishers × routes into flow facts
 *
 * Node ids are "<dimension>:<value>" and are stable across time, views and
 * group-bys, so comments and time scrubbing line up.
 */
window.TL = window.TL || {};

(function (TL) {
  'use strict';

  // ---- Time -----------------------------------------------------------
  const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
    '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthLabel(p, short) { const [y, m] = p.split('-'); return MN[+m - 1] + (short ? ' ’' + y.slice(2) : ' ' + y); }

  // ---- Seeded RNG -----------------------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(20261031);
  const chance = function (p) { return rnd() < p; };
  const int = function (a, b) { return a + Math.floor(rnd() * (b - a + 1)); };
  function pick(w) {
    const k = Object.keys(w); let t = 0; k.forEach(function (x) { t += w[x]; });
    let r = rnd() * t; for (let i = 0; i < k.length; i++) { r -= w[k[i]]; if (r <= 0) return k[i]; }
    return k[k.length - 1];
  }

  // ---- Device attributes (what views colour by / what group-by collapses on)
  // `color` on a value = how it is painted when its view is active.
  // Values without a colour (e.g. "none") stay neutral grey.
  const GREY = null;
  // Categorical palette (supplied by design). PALETTE[n] is the ordered set
  // to use when a view has n coloured values; neutral values stay grey.
  const PALETTE = {
    1: ['#AC4E2A'],
    2: ['#AC4E2A', '#A676A0'],
    3: ['#AC4E2A', '#6B3264', '#A676A0'],
    4: ['#AC4E2A', '#A676A0', '#6B3264', '#8C8E5F'],
    5: ['#AC4E2A', '#6B3264', '#A676A0', '#79331A', '#8C8E5F'],
    6: ['#AC4E2A', '#A676A0', '#6B3264', '#8C8E5F', '#79331A', '#4C6E87'],
    7: ['#AC4E2A', '#A676A0', '#6B3264', '#8C8E5F', '#4C6E87', '#79331A', '#63998C'],
    8: ['#AC4E2A', '#A676A0', '#717236', '#6B3264', '#8C8E5F', '#4C6E87', '#79331A', '#63998C'],
    12: ['#AC4E2A', '#A676A0', '#6B3264', '#8C8E5F', '#79331A', '#4C6E87', '#63998C', '#717236', '#6587AC', '#BC6D4C', '#564D46', '#997B73']
  };
  function paletteFor(n) {
    if (PALETTE[n]) return PALETTE[n];
    const k = Object.keys(PALETTE).map(Number).filter(function (x) { return x >= n; })[0] || 12;
    return PALETTE[k].slice(0, n);
  }
  const ATTRIBUTES = {
    juju: { label: 'Juju version', short: 'Juju', values: [
      { id: '4.1', label: 'Juju 4.1', color: true },
      { id: '3.6', label: 'Juju 3.6 LTS', color: true },
      { id: '2.9', label: 'Juju 2.9', color: true },
      { id: 'none', label: 'No Juju', color: GREY }] },
    jaas: { label: 'Juju controller', short: 'JAAS', values: [
      { id: 'jaas', label: 'Managed by JAAS', color: true },
      { id: 'self', label: 'Self-hosted controller', color: true },
      { id: 'none', label: 'No Juju', color: GREY }] },
    maas: { label: 'MAAS version', short: 'MAAS', values: [
      { id: '3.6', label: 'MAAS 3.6', color: true },
      { id: '3.5', label: 'MAAS 3.5', color: true },
      { id: 'none', label: 'Not MAAS-provisioned', color: GREY }] },
    microcloud: { label: 'MicroCloud', short: 'MicroCloud', values: [
      { id: 'member', label: 'MicroCloud member', color: true },
      { id: 'none', label: 'Not in a MicroCloud', color: GREY }] },
    stack: { label: 'Canonical infrastructure', short: 'Canonical infra', values: [
      { id: 'full', label: 'Full Canonical stack', color: true },
      { id: 'partial', label: 'Partial Canonical stack', color: true },
      { id: 'none', label: 'No Canonical infra', color: GREY }] },
    sovereignty: { label: 'Telemetry residency', short: 'Residency', values: [
      { id: 'eu', label: 'EU residency', color: true },
      { id: 'uk', label: 'UK residency', color: true },
      { id: 'none', label: 'No residency rule', color: GREY }] },
    confidential: { label: 'Confidential compute', short: 'Confidential', values: [
      { id: 'tdx', label: 'Intel TDX', color: true },
      { id: 'snp', label: 'AMD SEV-SNP', color: true },
      { id: 'none', label: 'Not confidential', color: GREY }] },
    site: { label: 'Site', short: 'Site', values: [
      { id: 'store', label: 'Retail store' }, { id: 'factory', label: 'Factory floor' },
      { id: 'dc', label: 'Distribution centre' }, { id: 'datacentre', label: 'Data centre' },
      { id: 'cloud', label: 'Public cloud' }, { id: 'unassigned', label: 'Unassigned' }] },
    type: { label: 'Device type', short: 'Type', values: [
      { id: 'metal', label: 'Bare-metal server' }, { id: 'vm', label: 'Virtual machine' },
      { id: 'k8s', label: 'Kubernetes node' }, { id: 'edge', label: 'Edge device' }] },
    region: { label: 'Region', short: 'Region', values: [
      { id: 'fra', label: 'Frankfurt' }, { id: 'par', label: 'Paris' }, { id: 'ldn', label: 'London' },
      { id: 'nyc', label: 'New York' }, { id: 'sfo', label: 'San Francisco' }, { id: 'sgp', label: 'Singapore' }] },
    environment: { label: 'Environment', short: 'Environment', values: [
      { id: 'prod', label: 'Production' }, { id: 'staging', label: 'Staging' }, { id: 'lab', label: 'Lab' }, { id: 'unassigned', label: 'Unassigned' }] },
    release: { label: 'Ubuntu release', short: 'Release', values: [
      { id: '2004', label: 'Ubuntu 20.04 (ESM)' }, { id: '2204', label: 'Ubuntu 22.04 LTS' }, { id: '2404', label: 'Ubuntu 24.04 LTS' }, { id: '2604', label: 'Ubuntu 26.04 LTS' }] }
  };

  // Health bands use a diverging gradient built from the palette's own hues:
  // palette rust (#79331A, #AC4E2A, #BC6D4C) for the worst bands, lightening
  // to a neutral taupe/olive in the middle, then palette teal (#63998C)
  // darkening to deep teal for the healthiest. Intermediate steps were
  // interpolated in OKLCH so lightness mirrors either side of the middle and
  // adjacent bands are roughly equal visual steps apart.
  const HEALTH_RAMP = ['#79331A', '#AC4E2A', '#BC6D4C', '#BD876F', '#BE9D87', '#A7A880', '#8B9D75', '#63998C', '#3E786C', '#1C5B52'];
  const HEALTH_BANDS = HEALTH_RAMP.map(function (c, i) {
    const lo = i === 0 ? 0 : i * 10 + 1, hi = (i + 1) * 10;
    return { id: lo + '-' + hi, label: lo + '–' + hi, color: c, lo: lo, hi: hi };
  }).reverse(); // healthiest first
  // Neutral view: every flow in one colour (palette slate), no breakdown.
  ATTRIBUTES.neutral = { label: 'Neutral', short: 'Neutral', values: [{ id: 'all', label: 'All telemetry', color: '#4C6E87' }] };
  ATTRIBUTES.health = { label: 'Health', short: 'Health', ordinal: true, values: HEALTH_BANDS };
  // Sustainability attributes (colours from the same palette family as health)
  // Reporting status: measured at the telemetry endpoint per device (and per snap),
  // with Landscape's online/offline signal used to suggest a cause. Worst last.
  ATTRIBUTES.reporting = { label: 'Reporting status', short: 'Reporting', values: [
    { id: 'reporting', label: 'Reporting', color: '#3E786C' },
    { id: 'delayed', label: 'Delayed', color: '#A7A880' },
    { id: 'partial', label: 'Partially silent', color: '#BC6D4C' },
    { id: 'silent', label: 'Silent (online in Landscape)', color: '#AC4E2A' },
    { id: 'offline', label: 'Offline', color: '#79331A' },
    { id: 'unknown', label: 'Silent (cause unknown)', color: '#997B73' }] };
  ATTRIBUTES.lifecycle = { label: 'Lifecycle', short: 'Lifecycle', values: [
    { id: 'service', label: 'Can stay in service', color: '#3E786C' },
    { id: 'ending', label: 'Standard support ending', color: '#BC6D4C' },
    { id: 'software', label: 'Software-only replacement risk', color: '#79331A' },
    { id: 'refresh', label: 'Hardware due for refresh', color: '#A7A880' },
    { id: 'virtual', label: 'Virtual (no hardware)', color: GREY }] };
  // Energy bands, highest first; sequential ramp (pale taupe → dark rust), darker = more energy
  ATTRIBUTES.energy = { label: 'Energy (kWh/month)', short: 'Energy', ordinal: true, values: [
    { id: 'e5', label: '500+ kWh', color: '#79331A', lo: 500, hi: Infinity },
    { id: 'e4', label: '250–500 kWh', color: '#AC4E2A', lo: 250, hi: 500 },
    { id: 'e3', label: '100–250 kWh', color: '#BC6D4C', lo: 100, hi: 250 },
    { id: 'e2', label: '50–100 kWh', color: '#BD876F', lo: 50, hi: 100 },
    { id: 'e1', label: '25–50 kWh', color: '#BE9D87', lo: 25, hi: 50 },
    { id: 'e0', label: 'Under 25 kWh', color: '#D4C0B2', lo: 0, hi: 25 },
    { id: 'none', label: 'Not measured / virtual', color: GREY }] };
  function healthBand(score) { return score <= 10 ? '0-10' : (Math.floor((score - 1) / 10) * 10 + 1) + '-' + (Math.floor((score - 1) / 10) * 10 + 10); }

  // assign palette colours: values marked `color: true` take the next colour
  // from the row matching the number of coloured values in that attribute
  Object.keys(ATTRIBUTES).forEach(function (k) {
    const coloured = ATTRIBUTES[k].values.filter(function (v) { return v.color === true; });
    const row = paletteFor(coloured.length);
    coloured.forEach(function (v, i) { v.color = row[i]; });
  });

  // ---- Pipeline vocabularies -----------------------------------------
  // Publishers are snaps. Every snap hands its telemetry to snapd on the
  // device; snapd enforces naming and on-device rules, multiplexes all
  // snaps into one stream and sends it to the telemetry endpoint, which
  // demultiplexes, routes and forwards. Labels are the snap names that
  // snapd enforces.
  // A mix of the customer's own applications, partner software and a few
  // Canonical infrastructure snaps, as a large retailer / manufacturer might
  // run across stores, factories, distribution centres, data centres and cloud.
  const PUBLISHERS = { label: 'Publisher (snap)', values: [
    { id: 'pos', label: 'pos-terminal', note: 'Point-of-sale service on store tills' },
    { id: 'shelfcam', label: 'shelf-vision', note: 'Computer-vision shelf monitoring (cameras)' },
    { id: 'signage', label: 'digital-signage', note: 'In-store and factory display player' },
    { id: 'coldchain', label: 'cold-chain-monitor', note: 'Refrigeration and temperature sensors' },
    { id: 'plc', label: 'opcua-connector', note: 'Collects data from factory PLCs over OPC UA' },
    { id: 'predmaint', label: 'predictive-maintenance', note: 'ML inference for equipment and vehicle wear' },
    { id: 'inventory', label: 'inventory-sync', note: 'Stock levels between stores, DCs and ERP' },
    { id: 'order', label: 'order-service', note: 'E-commerce order API' },
    { id: 'erp', label: 'erp-connector', note: 'Integration with the ERP system' },
    { id: 'payment', label: 'payment-vault', note: 'Card payment processing in a confidential VM' },
    { id: 'landscape', label: 'landscape-client', note: 'Fleet management agent' },
    { id: 'juju', label: 'juju', canonical: true, note: 'Application operations' },
    { id: 'maas', label: 'maas', canonical: true, note: 'Bare-metal provisioning' },
    { id: 'microcloud', label: 'microcloud', canonical: true, note: 'Edge/private cloud cluster' },
    // home-lab snaps (hobby fleet)
    { id: 'homeauto', label: 'home-automation', note: 'Home automation hub' },
    { id: 'media', label: 'media-server', note: 'Media library and streaming' },
    { id: 'filesync', label: 'file-sync', note: 'File sync and backup' },
    { id: 'dns', label: 'dns-filter', note: 'Network-wide DNS filtering' }] };
  const POLICIES = { label: 'Policy', values: [
    { id: 'standard', label: 'Standard (anonymised)' },
    { id: 'redact', label: 'PII redaction' },
    { id: 'eu-res', label: 'EU data residency' },
    { id: 'uk-res', label: 'UK data residency' },
    { id: 'attested', label: 'PCI scope · attested only' },
    { id: 'ot', label: 'OT safety & maintenance' },
    { id: 'local', label: 'On-prem only' },
    { id: 'schema', label: 'Schema validation' },
    { id: 'shaping', label: 'Shaping (rate limits)' }] };
  // Destinations are the customer's own systems (illustrative roles for a
  // large enterprise). `zone` = where the system stores data, used to spot
  // telemetry leaving its residency zone.
  const DESTINATIONS = { label: 'Destination', values: [
    { id: 'observability', label: 'Observability platform', zone: 'us' },
    { id: 'lake-us', label: 'Analytics data lake · US', zone: 'us' },
    { id: 'lake-eu', label: 'Analytics data lake · EU', zone: 'eu' },
    { id: 'lake-uk', label: 'Analytics data lake · UK', zone: 'uk' },
    { id: 'siem', label: 'Security SIEM (SOC)', zone: 'us' },
    { id: 'cmdb', label: 'CMDB / asset inventory', zone: 'us' },
    { id: 'itsm', label: 'ITSM · incident tickets', zone: 'us' },
    { id: 'landscape', label: 'Landscape (on-prem)', zone: 'onprem' },
    { id: 'archive', label: 'Compliance archive (7-year)', zone: 'onprem' },
    { id: 'drop-schema', label: 'Dropped by schema', zone: 'none', drop: true, note: 'Events that didn’t match the snap’s registered schema' },
    { id: 'drop-shaping', label: 'Dropped by shaping', zone: 'none', drop: true, note: 'Events over the snap’s rate limit, or sampled out' }] };

  // ---- Policy rules (ordered, first match wins) -----------------------
  // `when` matches device attributes and/or publisher; `to` lists
  // destinations with shares. `at` records where the rule is applied:
  //   'snapd'    – on the device, before the stream leaves it
  //   'endpoint' – at the telemetry endpoint, after demultiplexing
  const ROUTING = [
    { id: 'R2', at: 'endpoint', when: { publisher: 'payment' }, policy: 'attested', to: [['siem', 0.6], ['archive', 0.25], ['lake-us', 0.15]] },
    { id: 'R3', at: 'endpoint', when: { publisher: 'landscape' }, policy: 'local', to: [['landscape', 0.8], ['cmdb', 0.2]] },
    { id: 'R4', at: 'endpoint', when: { sovereignty: 'eu' }, policy: 'eu-res', to: [['lake-eu', 0.75], ['archive', 0.25]] },
    { id: 'R5', at: 'endpoint', when: { sovereignty: 'uk' }, policy: 'uk-res', to: [['lake-uk', 0.75], ['archive', 0.25]] },
    { id: 'R6', at: 'snapd', when: { publisher: ['pos', 'shelfcam'] }, policy: 'redact', to: [['lake-us', 0.6], ['observability', 0.25], ['siem', 0.15]] },
    { id: 'R7', at: 'endpoint', when: { publisher: ['plc', 'predmaint', 'coldchain'] }, policy: 'ot', to: [['observability', 0.45], ['itsm', 0.35], ['lake-us', 0.2]] },
    { id: 'R9', at: 'endpoint', when: { publisher: ['homeauto', 'media', 'filesync', 'dns'] }, policy: 'standard', to: [['observability', 1]] },
    { id: 'R8', at: 'endpoint', when: {}, policy: 'standard', to: [['observability', 0.5], ['cmdb', 0.25], ['siem', 0.1], ['lake-us', 0.15]] }
  ];
  function route(attrs, publisher) {
    for (let i = 0; i < ROUTING.length; i++) {
      const r = ROUTING[i];
      const ok = Object.keys(r.when).every(function (k) {
        const have = k === 'publisher' ? publisher : attrs[k];
        const v = r.when[k]; return Array.isArray(v) ? v.indexOf(have) >= 0 : have === v;
      });
      if (ok) return r;
    }
  }

  // ---- Devices (synthetic, seeded) ------------------------------------
  const REGION_SOV = { fra: 'eu', par: 'eu', ldn: 'uk' };
  const DEVICES = [];
  // Fleet size for demos, chosen only by URL: ?fleet=hobby | mid (default) | enterprise
  const FLEET = (function () {
    let f = null;
    try { f = (typeof TL_FLEET !== 'undefined' && TL_FLEET) || new URLSearchParams(location.search).get('fleet'); } catch (e) { /* no URL (tests) */ }
    return ['hobby', 'mid', 'enterprise'].indexOf(f) >= 0 ? f : 'mid';
  })();
  const ENTERPRISE_SIZE = 5000;
  const plan = [
    ['fra', 'metal', 3], ['fra', 'edge', 3], ['fra', 'k8s', 1], ['fra', 'vm', 1],
    ['par', 'metal', 1], ['par', 'edge', 3], ['par', 'vm', 1],
    ['ldn', 'metal', 1], ['ldn', 'edge', 3], ['ldn', 'vm', 1],
    ['nyc', 'metal', 3], ['nyc', 'edge', 4], ['nyc', 'k8s', 2], ['nyc', 'vm', 1],
    ['sfo', 'edge', 2], ['sfo', 'k8s', 1], ['sfo', 'vm', 2],
    ['sgp', 'metal', 1], ['sgp', 'edge', 3], ['sgp', 'vm', 1]
  ];
  // Drops are counted where they happen, so their volume is known.
  // Schema: events that don't match the snap's registered schema (spikes while
  // opcua-connector r214 crash-loops, Jun/Jul 2026). Shaping: rate limits / sampling.
  const SCHEMA_DROP = { shelfcam: 0.02, payment: 0.001, predmaint: 0.012 };
  const SCHEMA_DROP_INCIDENT = { 7: 0.18, 8: 0.12 }; // opcua-connector, by month
  const SHAPING_DROP = { shelfcam: 0.06, predmaint: 0.05, plc: 0.03, pos: 0.01, order: 0.015, dns: 0.08 };
  // typical event size per snap, in bytes (for data volume)
  const EVENT_BYTES = { pos: 850, shelfcam: 2600, signage: 320, coldchain: 220, plc: 420, predmaint: 1300, inventory: 650,
    order: 950, erp: 1600, payment: 700, landscape: 1200, juju: 520, maas: 430, microcloud: 470,
    homeauto: 300, media: 520, filesync: 410, dns: 160 };
  const BASE_RATE = { pos: 900, shelfcam: 1400, signage: 120, coldchain: 300, plc: 1100, predmaint: 700,
    inventory: 800, order: 1000, erp: 500, payment: 300, landscape: 350, juju: 350, maas: 250, microcloud: 300,
    homeauto: 600, media: 250, filesync: 400, dns: 900 };
  const SITE_BY_TYPE = {
    edge: { store: 60, factory: 40 }, metal: { dc: 40, factory: 35, datacentre: 25 },
    k8s: { datacentre: 50, cloud: 50 }, vm: { cloud: 70, datacentre: 30 }
  };
  // which application snaps a device runs, by site (probability per snap)
  const SITE_SNAPS = {
    store: { pos: 1, shelfcam: 0.5, signage: 0.6, coldchain: 0.5 },
    factory: { plc: 1, predmaint: 0.6, signage: 0.2 },
    dc: { inventory: 1, coldchain: 0.5, predmaint: 0.2 },
    datacentre: { erp: 0.6, inventory: 0.4, order: 0.4 },
    cloud: { order: 1, erp: 0.3, predmaint: 0.3 }
  };
  const TYPE_SCALE = { metal: 1.4, k8s: 1.2, vm: 0.9, edge: 1 };

  function makeDevice(region, type) {
      const a = { region: region, type: type, site: pick(SITE_BY_TYPE[type]) };
      a.release = pick({ '2204': 45, '2404': 55 });
      a.maas = type === 'metal' ? pick({ '3.6': 45, '3.5': 35, none: 20 }) : type === 'edge' ? pick({ '3.6': 12, '3.5': 10, none: 78 }) : 'none';
      a.microcloud = (type === 'edge' || type === 'metal') && chance(0.35) ? 'member' : 'none';
      a.juju = pick(type === 'vm' ? { '3.6': 30, '2.9': 15, none: 55 } : type === 'edge' ? { '4.1': 5, '3.6': 15, '2.9': 5, none: 75 } : { '4.1': 10, '3.6': 50, '2.9': 20, none: 20 });
      a.jaas = a.juju === 'none' ? 'none' : (chance(0.25) ? 'jaas' : 'self');
      a.sovereignty = REGION_SOV[region] && chance(0.55) ? REGION_SOV[region] : 'none';
      a.confidential = (type === 'vm' || type === 'k8s') && chance(0.3) ? pick({ tdx: 60, snp: 40 }) : 'none';
      a.consent = chance(0.08) ? 'optout' : 'optin';
      const extras = { landscape: chance(0.5), apps: [] };
      const siteSnaps = SITE_SNAPS[a.site];
      Object.keys(siteSnaps).forEach(function (k) { if (chance(siteSnaps[k])) extras.apps.push(k); });
      if (!extras.apps.length) extras.apps.push(Object.keys(siteSnaps)[0]);

      const changes = [];
      if (a.juju === '3.6' && chance(0.55)) changes.push({ month: int(2, 11), attrs: { juju: '4.1' }, note: 'Upgraded to Juju 4.1' });
      if (a.juju === '2.9' && chance(0.45)) changes.push({ month: int(1, 9), attrs: { juju: '3.6' }, note: 'Upgraded to Juju 3.6' });
      if (a.jaas === 'self' && chance(0.35)) changes.push({ month: int(2, 11), attrs: { jaas: 'jaas' }, note: 'Moved controller to JAAS' });
      if (a.maas === '3.5' && chance(0.6)) changes.push({ month: int(1, 10), attrs: { maas: '3.6' }, note: 'Upgraded to MAAS 3.6' });
      if (a.microcloud === 'none' && (type === 'edge' || type === 'metal') && chance(0.35)) changes.push({ month: int(3, 11), attrs: { microcloud: 'member' }, note: 'Joined a MicroCloud' });
      if (a.confidential === 'none' && (type === 'vm' || type === 'k8s') && chance(0.4)) changes.push({ month: int(2, 11), attrs: { confidential: pick({ tdx: 60, snp: 40 }) }, note: 'Enabled confidential VM' });
      if (a.sovereignty === 'none' && REGION_SOV[region] && chance(0.6)) changes.push({ month: int(3, 7), attrs: { sovereignty: REGION_SOV[region] }, note: 'Moved to data-residency policy' });
      if (a.release === '2204' && chance(0.4)) changes.push({ month: int(6, 11), attrs: { release: '2604' } });
      changes.sort(function (x, y) { return x.month - y.month; });

      const scale = TYPE_SCALE[type] * (0.6 + rnd() * 0.8);
      const growth = -0.01 + rnd() * 0.04;
      return {
        id: null, // assigned below as <region>-<site>-<nn>
        attrs: a, extras: extras, changes: changes,
        onboarded: chance(0.8) ? 0 : int(1, 10),
        scale: scale, growth: growth
      };
  }

  // A hobbyist's home lab: six hand-made devices running home snaps
  const HOBBY = [
    ['home-pi-01', 'edge', '2404', ['homeauto', 'dns'], false, 'none', 'none'],
    ['home-pi-02', 'edge', '2204', ['homeauto'], true, 'member', 'none'],
    ['media-nuc', 'metal', '2404', ['media', 'filesync'], true, 'member', 'none'],
    ['nas-01', 'metal', '2204', ['filesync'], false, 'none', 'none'],
    ['lab-vm-01', 'vm', '2404', ['homeauto', 'media'], true, 'none', '3.6'],
    ['lab-vm-02', 'vm', '2604', ['dns'], false, 'none', 'none']
  ];
  // Enterprise devices are generated after the 38 mid devices, so those 38 stay identical
  const EXTRAS = [];
  if (FLEET === 'hobby') {
    HOBBY.forEach(function (h) {
      DEVICES.push({
        id: h[0], attrs: { region: 'ldn', type: h[1], site: 'home', release: h[2], maas: 'none', microcloud: h[5],
          juju: h[6], jaas: h[6] === 'none' ? 'none' : 'self', sovereignty: 'none', confidential: 'none', consent: 'optin' },
        extras: { landscape: h[4], apps: h[3] }, changes: h[2] === '2204' ? [{ month: 7, attrs: { release: '2604' } }] : [],
        onboarded: 0, scale: 0.15 + rnd() * 0.2, growth: rnd() * 0.02
      });
    });
  } else {
    plan.forEach(function (p) { for (let i = 1; i <= p[2]; i++) DEVICES.push(makeDevice(p[0], p[1])); });
    if (FLEET === 'enterprise') {
      while (DEVICES.length + EXTRAS.length < ENTERPRISE_SIZE) {
        plan.forEach(function (p) {
          for (let i = 1; i <= p[2] && DEVICES.length + EXTRAS.length < ENTERPRISE_SIZE; i++) EXTRAS.push(makeDevice(p[0], p[1]));
        });
      }
    }
  }

  function deriveStack(a) {
    const layers = (a.maas !== 'none') + (a.microcloud === 'member') + (a.juju !== 'none');
    return a.juju !== 'none' && layers >= 2 ? 'full' : layers >= 1 ? 'partial' : 'none';
  }
  // ---- Health: a composite 0–100 score per device per month ----------
  // Weighted components (each 0–100). Edit weights or inputs here.
  const HEALTH_COMPONENTS = [
    { id: 'patch', label: 'Security patch currency', weight: 0.25 },
    { id: 'snaps', label: 'Snap refresh currency', weight: 0.20 },
    { id: 'release', label: 'Release support', weight: 0.15 },
    { id: 'reporting', label: 'Reporting regularity', weight: 0.15 },
    { id: 'policy', label: 'Policy compliance', weight: 0.15 },
    { id: 'stability', label: 'Stability (crash rate)', weight: 0.10 }
  ];
  function initHealth(d, i) {
    const r = mulberry32(7919 * (i + 1));
    const neglected = r() < 0.2; // devices nobody is looking after
    const ageing = !neglected && r() < 0.3; // patched, but slowly
    const edge = d.attrs.site === 'store' || d.attrs.site === 'factory';
    if (neglected && r() < 0.6) { // still on 20.04, never upgraded
      d.attrs.release = '2004';
      d.changes = d.changes.filter(function (c) { return !c.attrs.release; });
    }
    d.health = {
      patch: neglected ? r() * 20 : ageing ? 35 + r() * 25 : (edge ? 65 : 80) + r() * 20,
      snaps: neglected ? r() * 25 : ageing ? 40 + r() * 25 : 65 + r() * 30,
      reporting: neglected ? 10 + r() * 40 : (edge ? 70 : 85) + r() * 15,
      policy: neglected ? 20 + r() * 30 : null, // stale consent / policy settings
      stability: neglected ? 40 + r() * 40 : 75 + r() * 25,
      improve: neglected ? (r() < 0.4 ? 5 : 0) : ageing ? r() * 1.5 : r() * 0.8, // points per month as patching catches up
      incident: r() < 0.3 ? Math.floor(r() * 12) : -1,          // one bad month
      noise: r
    };
    d.health.noiseByMonth = MONTHS.map(function () { return (d.health.noise() - 0.5) * 8; });
    if (d.attrs.site === 'factory') {
      d.changes.push({ month: 7, attrs: {}, note: 'opcua-connector r214 crash-looping' });
      d.changes.push({ month: 9, attrs: {}, note: 'Rolled back to opcua-connector r212' });
      d.changes.push({ month: 10, attrs: {}, note: 'Refreshed to opcua-connector r216 (fix)' });
      d.changes.sort(function (x, y) { return x.month - y.month; });
    }
  }
  DEVICES.forEach(initHealth);

  // ---- Fleet incident (Jun–Sep 2026) --------------------------------------
  // A bad opcua-connector revision (r214) crash-loops on factory devices.
  // SRE holds snap refreshes fleet-wide to contain it, which drags snap and
  // patch currency down everywhere. Factories are rolled back in August, and
  // a fixed revision (r216) ships in September. Month index: Jun = 7.
  const INCIDENT = {
    factory: { 7: { stability: 10, reporting: -40 }, 8: { stability: 8, reporting: -45, snaps: -30 }, 9: { stability: 70, snaps: -25 } },
    fleet: { 8: { snaps: -40, patch: -18 }, 9: { snaps: -18, patch: -8 }, 10: { snaps: -6 } },
    volume: { 7: 0.45, 8: 0.4, 9: 0.85 } // share of opcua-connector telemetry still arriving
  };
  function healthAt(d, a, m) {
    const h = d.health, clamp = function (x) { return Math.max(0, Math.min(100, x)); };
    const parts = {
      patch: clamp(h.patch + h.improve * m + h.noiseByMonth[m]),
      snaps: clamp(h.snaps + h.improve * m * 0.8 - (a.juju === '2.9' ? 20 : 0)),
      release: a.release === '2604' ? 100 : a.release === '2404' ? 90 : a.release === '2204' ? 65 : 15,
      reporting: a.consent === 'optout' ? 20 : h.incident === m ? 35 : clamp(h.reporting + h.noiseByMonth[m]),
      policy: h.policy != null ? h.policy : (REGION_SOV[a.region] && a.sovereignty === 'none') ? 55 : a.consent === 'optout' ? 60 : 95,
      stability: h.incident === m ? 5 : clamp(h.stability + h.noiseByMonth[m])
    };
    // Juju 2.9 is out of support: older agents miss fixes, lag on refreshes,
    // crash more and drop metrics. Devices recover once upgraded to 3.6.
    if (a.juju === '2.9') {
      parts.patch = clamp(parts.patch - 35);
      parts.snaps = clamp(parts.snaps - 25); // on top of the base -20 above
      parts.stability = clamp(parts.stability - 35);
      parts.reporting = clamp(parts.reporting - 20);
    }
    // plants the refresh hold caught never ran r214, so they skip the crash loop (but share the hold)
    const spared = d.closeup && d.closeup.spared && (m === 7 || m === 8);
    const fi = INCIDENT.fleet[m], fa = d.siteTrue === 'factory' && !spared && INCIDENT.factory[m];
    if (fi) Object.keys(fi).forEach(function (k) { parts[k] = clamp(parts[k] + fi[k]); });
    if (fa) Object.keys(fa).forEach(function (k) {
      parts[k] = k === 'stability' ? Math.min(parts[k], fa[k]) : clamp(parts[k] + fa[k]);
    });
    let score = 0;
    HEALTH_COMPONENTS.forEach(function (c) { score += parts[c.id] * c.weight; });
    return { score: Math.round(clamp(score)), parts: parts };
  }

  function attrsAt(d, m) {
    const a = Object.assign({}, d.attrs);
    d.changes.forEach(function (c) { if (c.month <= m) Object.assign(a, c.attrs); });
    a.stack = deriveStack(a);
    a.neutral = 'all';
    const h = healthAt(d, a, m);
    a.healthScore = h.score; a.healthParts = h.parts; a.health = healthBand(h.score);
    const rep = d.report ? d.report[m] : null;
    a.reporting = rep ? rep.status : 'reporting'; a.reportInfo = rep;
    const su = sustainAt(d, a, m);
    a.lifecycle = su.cat;
    a.energyKwh = su.kwh != null && su.measuredBy ? su.kwh : null;
    a.idle = !!su.idle;
    a.energy = a.energyKwh == null ? 'none' : ATTRIBUTES.energy.values.filter(function (v) { return v.lo != null && a.energyKwh >= v.lo && a.energyKwh < v.hi; })[0].id;
    return a;
  }
  function publishersFor(d, a) {
    const out = d.extras.apps.slice();
    if (a.confidential !== 'none') out.push('payment');
    if (d.extras.landscape) out.push('landscape');
    if (a.juju !== 'none') out.push('juju');
    if (a.maas !== 'none') out.push('maas');
    if (a.microcloud === 'member') out.push('microcloud');
    return out;
  }


  // ---- Dimensions used as Sankey columns ------------------------------
  // Device names say where a device is: <region>-<site>-<nn>, e.g. fra-plant-01.
  // Sorted by region, then site, so related devices sit together in column 1.
  const SITE_CODE = { store: 'store', factory: 'plant', dc: 'depot', datacentre: 'dc', cloud: 'cloud', home: 'home' };
  const REGION_ORDER = ['fra', 'par', 'ldn', 'nyc', 'sfo', 'sgp'];
  const SITE_ORDER = ['store', 'factory', 'dc', 'datacentre', 'cloud'];
  DEVICES.sort(function (x, y) {
    return (REGION_ORDER.indexOf(x.attrs.region) - REGION_ORDER.indexOf(y.attrs.region)) ||
      (SITE_ORDER.indexOf(x.attrs.site) - SITE_ORDER.indexOf(y.attrs.site));
  });
  const counters = {};
  function nameDevice(d) {
    if (d.id) return; // hobby devices are named by hand
    const key = d.attrs.region + '-' + SITE_CODE[d.attrs.site];
    counters[key] = (counters[key] || 0) + 1;
    d.id = key + '-' + String(counters[key]).padStart(2, '0');
  }
  DEVICES.forEach(nameDevice);
  // enterprise extras: health seeded after the 38, named after them, appended at the end
  EXTRAS.forEach(function (d, j) { initHealth(d, DEVICES.length + j); });
  EXTRAS.forEach(nameDevice);
  Array.prototype.push.apply(DEVICES, EXTRAS);

  if (FLEET === 'hobby') ATTRIBUTES.site.values.splice(ATTRIBUTES.site.values.length - 1, 0, { id: 'home', label: 'Home lab' });
  const DIMENSIONS = {
    // '__others' collects devices outside the top N when a fleet is too big to show every device
    device: { label: 'Device', values: DEVICES.map(function (d) { return { id: d.id, label: d.id }; }).concat([{ id: '__others', label: 'Others', others: true }]) },
    publisher: PUBLISHERS, policy: POLICIES, destination: DESTINATIONS
  };
  Object.keys(ATTRIBUTES).forEach(function (k) { DIMENSIONS[k] = ATTRIBUTES[k]; });
  Object.keys(DIMENSIONS).forEach(function (k) {
    const d = DIMENSIONS[k]; d.id = k; d.index = {};
    d.values.forEach(function (v, i) { d.index[v.id] = i; v.order = i; });
  });
  function valueOf(dim, id) { const d = DIMENSIONS[dim]; return d && d.values[d.index[id]]; }
  function parseNodeId(id) { const i = id.indexOf(':'); return { dim: id.slice(0, i), val: id.slice(i + 1) }; }
  function nodeLabel(id) { const p = parseNodeId(id); const v = valueOf(p.dim, p.val); return v ? v.label : id; }

  // ---- Snapshot: flow facts for a month -------------------------------
  // fact = { device, …device attrs, publisher, policy, destination, rule, count }
  const cache = {};
  function snapshot(m) {
    if (cache[m]) return cache[m];
    const facts = [];
    DEVICES.forEach(function (d) {
      if (d.onboarded > m) return;
      const a = attrsAt(d, m);
      const vol = d.scale * Math.pow(1 + d.growth, m);
      publishersFor(d, a).forEach(function (pub) {
        const r = route(a, pub);
        const hit = pub === 'plc' && !(d.closeup && d.closeup.spared); // held plants never ran r214
        const base = BASE_RATE[pub] * vol * (hit && INCIDENT.volume[m] ? INCIDENT.volume[m] : 1);
        const schemaF = (hit && SCHEMA_DROP_INCIDENT[m]) || SCHEMA_DROP[pub] || 0.006;
        const shapingF = SHAPING_DROP[pub] || 0;
        const size = EVENT_BYTES[pub] || 600;
        // a fact inherits the device's attributes (shared, not copied: matters at 5,000 devices)
        const push = function (policy, dest, rule, count) {
          const f = Object.create(a);
          f.device = d.id; f.publisher = pub; f.policy = policy; f.destination = dest; f.rule = rule; f.count = count; f.bytes = count * size;
          facts.push(f);
        };
        push('schema', 'drop-schema', 'Schema', base * schemaF);
        if (shapingF) push('shaping', 'drop-shaping', 'Shaping', base * shapingF);
        const kept = base * (1 - schemaF - shapingF);
        r.to.forEach(function (t) { push(r.policy, t[0], r.id, kept * t[1]); });
      });
    });
    cache[m] = facts;
    return facts;
  }
  // ---- Incident close-up (hour by hour) -----------------------------------
  // Fine-grained telemetry is normally kept for a short rolling window and then
  // summarised. A trigger (alert, change event, manual pin, legal hold) keeps a
  // window of detail beyond that, scoped narrowly, with a visible reason and an
  // expiry. One window is kept in this data: the night r214 reached stable.
  // Hours count from 16 Jun 2026 22:00 UTC. r214 is published at 23:00; plants
  // pick it up one by one (Singapore and London first); the refresh hold at
  // 09:15 catches the plants that hadn't refreshed yet, which stay on r212.
  const CLOSEUP_WINDOWS = { sgp: [1.3, 3.1], ldn: [3.2, 5.6], fra: [5.8, 7.6], par: [7.7, 8.4], nyc: [8.5, 12.5], sfo: [11.5, 14] };
  const CLOSEUP = (function () {
    const scope = DEVICES.filter(function (d) {
      return d.attrs.site === 'factory' && d.onboarded <= 7 && d.extras.apps.indexOf('plc') >= 0;
    });
    if (!scope.length) return null;
    const holdAt = 11.25, alertAt = 5.75; // 09:15 and 03:45
    Object.keys(CLOSEUP_WINDOWS).forEach(function (reg) {
      const ds = scope.filter(function (d) { return d.attrs.region === reg; });
      const w = CLOSEUP_WINDOWS[reg];
      // the original 38 are spaced evenly through their region's window (same in every fleet);
      // generated extras (enterprise) land at seeded random times in the same window
      const core = ds.filter(function (d) { return DEVICES.indexOf(d) < 38; });
      const rx = mulberry32(99991 + reg.charCodeAt(0) * 31 + reg.charCodeAt(2));
      ds.forEach(function (d, k) {
        const at = k < core.length ? w[0] + (k + 0.5) / core.length * (w[1] - w[0]) : w[0] + rx() * (w[1] - w[0]);
        d.closeup = { refreshAt: at, spared: at > holdAt, seed: 57721 * (k + 1) + reg.charCodeAt(0) * 131 };
      });
    });
    return {
      start: '2026-06-16T22:00:00Z', hours: 24, month: 7, holdAt: holdAt, alertAt: alertAt,
      devices: scope.map(function (d) { return d.id; }),
      reason: 'Alert: opcua-connector restarts on factory devices',
      trigger: 'alert',
      scope: 'opcua-connector on factory devices',
      expires: '2027-06-17',
      keptBy: 'Kept automatically when the alert fired. The rolling 72-hour detail buffer still held the hours before it, so the window starts when r214 was published.',
      states: [
        { id: 'r212', label: 'Running r212', color: '#3E786C' },
        { id: 'crash', label: 'Crash-looping on r214', color: '#AC4E2A' },
        { id: 'held', label: 'Refresh held · still on r212', color: '#BE9D87' }
      ],
      events: [
        { h: 1, label: 'opcua-connector r214 promoted to stable' },
        { h: alertAt, label: 'Alert fired: opcua-connector restarting on 5+ factory devices for an hour. Detail kept from 22:00' },
        { h: 10 + 42 / 60, label: 'Ana Ribeiro · SRE: “Factory health is falling fast… Paging plant IT.”' },
        { h: holdAt, label: 'Tom Okafor · SRE: fleet-wide snap refresh hold' }
      ]
    };
  })();
  // A device's opcua-connector state during hour h (fraction of the hour in each state)
  function closeupState(d, h) {
    const c = d.closeup;
    if (c.spared) return h + 1 <= CLOSEUP.holdAt ? { r212: 1 } : h >= CLOSEUP.holdAt ? { held: 1 } : { r212: CLOSEUP.holdAt - h, held: h + 1 - CLOSEUP.holdAt };
    const crash = Math.max(0, Math.min(1, h + 1 - c.refreshAt));
    return crash >= 1 ? { crash: 1 } : crash <= 0 ? { r212: 1 } : { r212: 1 - crash, crash: crash };
  }
  // Hourly facts for the close-up: only the kept scope (opcua-connector on factory devices).
  // A crash-looping connector sends ~15% of its usual events, and ~40% of those fail schema
  // validation (truncated start-up records).
  const closeupCache = {};
  function closeupFacts(h) {
    if (!CLOSEUP) return [];
    if (closeupCache[h]) return closeupCache[h];
    const facts = [];
    CLOSEUP.devices.forEach(function (id) {
      const d = DEVICES.filter(function (x) { return x.id === id; })[0];
      const a = attrsAt(d, CLOSEUP.month);
      const vol = d.scale * Math.pow(1 + d.growth, 6) / 24; // the month before: normal hourly volume
      const r = route(a, 'plc'), st = closeupState(d, h);
      const rnd = mulberry32(d.closeup.seed + h * 7919); // same numbers whatever order hours are drawn in
      const noise = 0.92 + rnd() * 0.16, restarts = 18 + Math.round(rnd() * 22);
      Object.keys(st).forEach(function (s) {
        const share = st[s]; if (!share) return;
        const crash = s === 'crash';
        const base = BASE_RATE.plc * vol * share * noise * (crash ? 0.15 : 1);
        const schemaF = crash ? 0.4 : 0.006, shapingF = crash ? 0 : SHAPING_DROP.plc;
        const push = function (policy, dest, rule, count) {
          const f = Object.create(a);
          f.device = d.id; f.publisher = 'plc'; f.policy = policy; f.destination = dest; f.rule = rule;
          f.count = count; f.bytes = count * EVENT_BYTES.plc; f.cstate = s;
          f.restarts = crash && policy === 'schema' ? share * restarts : 0;
          facts.push(f);
        };
        push('schema', 'drop-schema', 'Schema', base * schemaF);
        if (shapingF) push('shaping', 'drop-shaping', 'Shaping', base * shapingF);
        const kept = base * (1 - schemaF - shapingF);
        r.to.forEach(function (t) { push(r.policy, t[0], r.id, kept * t[1]); });
      });
    });
    closeupCache[h] = facts;
    return facts;
  }
  function closeupDevice(id, h) {
    const d = DEVICES.filter(function (x) { return x.id === id; })[0];
    if (!d || !d.closeup) return null;
    return { refreshAt: d.closeup.refreshAt, spared: d.closeup.spared, state: closeupState(d, h) };
  }

  // Reporting status per month (own RNG, so health, flows and comments are unchanged).
  // Factory devices are partially silent in Jun/Jul 2026: opcua-connector was crash-looping.
  DEVICES.forEach(function (d, i) {
    const r = mulberry32(314159 * (i + 1));
    d.report = MONTHS.map(function (_, m) {
      if ((d.siteTrue || d.attrs.site) === 'factory' && (m === 7 || m === 8) && d.extras.apps.indexOf('plc') >= 0 && !(d.closeup && d.closeup.spared)) {
        return { status: 'partial', snap: 'plc', hours: m === 7 ? 30 + Math.round(r() * 60) : 120 + Math.round(r() * 200), cause: 'crash-looping' };
      }
      const weak = d.health && (d.health.policy != null); // neglected devices report less reliably
      if (r() > (weak ? 0.22 : 0.06)) return { status: 'reporting', lastMin: 1 + Math.round(r() * 9) };
      const kind = r();
      if (kind < 0.4) return { status: 'delayed', lagMin: 20 + Math.round(r() * 70) };
      const hours = 6 + Math.round(r() * 66);
      if (kind < 0.62) {
        const apps = d.extras.apps;
        return { status: 'partial', snap: apps[Math.floor(r() * apps.length)], hours: hours };
      }
      if (!d.extras.landscape) return { status: 'unknown', hours: hours };
      return { status: r() < 0.5 ? 'silent' : 'offline', hours: hours };
    });
  });
  // the current month's issues are scripted so every status has a clear example
  const NOW_ISSUES = {
    'par-store-02': { status: 'silent', hours: 26 },
    'sgp-dc-01': { status: 'offline', hours: 9 },
    'nyc-cloud-02': { status: 'unknown', hours: 41 },
    'fra-store-01': { status: 'partial', snap: 'shelfcam', hours: 18 },
    'sfo-cloud-02': { status: 'delayed', lagMin: 45 }
  };
  DEVICES.forEach(function (d) { if (NOW_ISSUES[d.id]) d.report[MONTHS.length - 1] = NOW_ISSUES[d.id]; });

  // Environment is a manual tag; drawn from its own RNG so other data is unchanged
  DEVICES.forEach(function (d, i) {
    const r = mulberry32(130363 * (i + 1));
    const v = r();
    d.attrs.environment = v < 0.7 ? 'prod' : v < 0.87 ? 'staging' : 'lab';
  });

  // ---- Sustainability (device attributes, not payload) -------------------
  // Joined in the control plane from what the fleet already reports; kept
  // separate from health. Two layers:
  //   1. Lifecycle – hardware age and how long the OS stays supported
  //      (standard vs Ubuntu Pro / ESM), to spot devices that would be
  //      replaced for software reasons alone.
  //   2. Energy – monthly energy per device, from Redfish (BMC platform power)
  //      on servers, or CPU power counters (RAPL) read by landscape-client.
  const SUPPORT = { // published Ubuntu lifecycle: [standard support ends, ESM with Ubuntu Pro ends]
    '2004': ['2025-04', '2030-04'], '2204': ['2027-04', '2032-04'],
    '2404': ['2029-04', '2034-04'], '2604': ['2031-04', '2036-04']
  };
  const ENERGY_BANDS = [[0, 25], [25, 50], [50, 100], [100, 250], [250, 500], [500, Infinity]];
  DEVICES.forEach(function (d, i) {
    const r = mulberry32(104729 * (i + 1));
    const a = d.attrs;
    const physical = a.type === 'metal' || a.type === 'edge' || (a.type === 'k8s' && a.site === 'datacentre');
    const idle = physical && r() < 0.12;
    d.sustain = {
      physical: physical,
      pro: r() < 0.5 && a.release !== '2004', // about half the fleet has Ubuntu Pro; the neglected 20.04 device never had it
      ageYears: physical ? (a.type === 'edge' ? 0.5 + r() * 6.5 : 1 + r() * 6) : null,
      kwh: !physical ? null : a.type === 'edge' ? 18 + r() * 52 : 220 + r() * 300,
      idle: idle,
      utilisation: idle ? 3 + r() * 5 : 20 + r() * 50,
      noise: MONTHS.map(function () { return 0.92 + r() * 0.16; })
    };
  });
  function monthStr(p) { return monthLabel(p); }
  function addMonths(p, n) { const y = +p.slice(0, 4), mo = +p.slice(5) - 1 + n; return (y + Math.floor(mo / 12)) + '-' + String(mo % 12 + 1).padStart(2, '0'); }
  function sustainAt(d, a, m) {
    const s = d.sustain, now = MONTHS[m];
    const sup = SUPPORT[a.release];
    const until = s.pro ? sup[1] : sup[0];
    const out = { physical: s.physical, pro: s.pro, supportedUntil: until, esmUntil: sup[1], standardUntil: sup[0] };
    if (s.physical) {
      out.ageYears = s.ageYears + m / 12;
      out.kwh = s.kwh * s.noise[m] * (s.idle ? 0.55 : 1);
      out.band = ENERGY_BANDS.filter(function (b) { return out.kwh >= b[0] && out.kwh < b[1]; })[0];
      out.utilisation = s.utilisation;
      out.idle = s.idle;
      out.measuredBy = a.type === 'edge'
        ? (d.extras.landscape ? 'CPU power counters (RAPL) via landscape-client' : null)
        : 'Redfish (BMC) · platform power';
    }
    // lifecycle status
    if (until < now) {
      out.softwareOnly = !s.pro && (!s.physical || out.ageYears < 7);
      out.cat = out.softwareOnly ? 'software' : 'refresh';
      out.status = s.pro ? 'Out of support'
        : out.softwareOnly ? 'Out of standard support since ' + monthStr(sup[0]) + '. The hardware is still fine, so replacing it would be for software reasons only; Ubuntu Pro would keep it in service until ' + monthStr(sup[1])
        : 'Out of standard support; Ubuntu Pro would extend it to ' + monthStr(sup[1]);
    } else if (s.physical && out.ageYears >= 7) {
      out.status = 'Hardware due for refresh (7+ years)';
      out.cat = 'refresh';
    } else if (!s.pro && sup[0] <= addMonths(now, 12)) {
      out.status = 'Standard support ends ' + monthStr(sup[0]) + '; Ubuntu Pro would extend it to ' + monthStr(sup[1]);
      out.cat = 'ending';
    } else {
      out.status = 'Can stay in service until ' + monthStr(until);
      out.cat = s.physical ? 'service' : 'virtual';
    }
    return out;
  }

  function deviceAt(id, m) {
    const d = DEVICES.filter(function (x) { return x.id === id; })[0];
    if (!d) return null;
    const attrs = attrsAt(d, m);
    return { device: d, attrs: attrs, active: d.onboarded <= m, sustain: sustainAt(d, attrs, m),
      changes: d.changes.filter(function (c) { return c.note; }) };
  }

  // ---- Views & group-bys ----------------------------------------------
  // A view = one attribute to colour by + the question it answers.
  // `group` nests a view under a heading in the view selector.
  const VIEWS = [
    { id: 'neutral', attr: 'neutral', label: 'Neutral', question: 'Where does each device’s telemetry go, and under which policy?' },
    { id: 'health', attr: 'health', label: 'Device health', question: 'How healthy is each device, and where does telemetry from unhealthy devices go?' },
    { id: 'reporting', attr: 'reporting', label: 'Reporting status', question: 'Which devices aren’t getting telemetry through, and why?' },
    { id: 'sovereignty', attr: 'sovereignty', label: 'Telemetry residency', question: 'Which residency rule does each device’s telemetry follow, and where does it end up?' },
    { id: 'confidential', attr: 'confidential', label: 'Confidential compute', question: 'Which devices run confidential VMs, and where does their payment telemetry go?' },
    { id: 'lifecycle', attr: 'lifecycle', label: 'Lifecycle', group: 'Sustainability', question: 'Which devices can stay in service, and which would be replaced for software reasons alone?' },
    { id: 'energy', attr: 'energy', label: 'Energy', group: 'Sustainability', question: 'How much energy does each device use, and which idle devices are still powered on?' },
    { id: 'stack', attr: 'stack', label: 'Full / partial stack', group: 'Canonical infrastructure', question: 'How much of the fleet runs on a full Canonical stack (MAAS / MicroCloud + Juju)?' },
    { id: 'juju', attr: 'juju', label: 'Juju', group: 'Canonical infrastructure', question: 'Which Juju version is each device running, and where does that telemetry go?' },
    { id: 'jaas', attr: 'jaas', label: 'JAAS', group: 'Canonical infrastructure', question: 'Which devices are managed through JAAS versus self-hosted controllers?' },
    { id: 'maas', attr: 'maas', label: 'MAAS', group: 'Canonical infrastructure', question: 'Which devices are provisioned by MAAS, and on which version?' },
    { id: 'microcloud', attr: 'microcloud', label: 'MicroCloud', group: 'Canonical infrastructure', question: 'Which devices belong to a MicroCloud cluster?' },
  ];
  // Group-by options, categorised by where the attribute comes from:
  //   Manual         – assigned by people (tags, zones, policy settings)
  //   Reported       – reported or measured by the device itself
  //   Infrastructure – Canonical infrastructure the device runs on
  const GROUP_BY_MENU = [
    { id: 'device', label: 'Devices (no grouping)' },
    { group: 'Manual', items: ['site', 'region', 'environment', 'sovereignty'] },
    { group: 'Reported', items: ['health', 'reporting', 'lifecycle', 'energy', 'confidential', 'release', 'type'] },
    { group: 'Infrastructure', items: ['stack', 'juju', 'jaas', 'maas', 'microcloud'] }
  ];
  const GROUP_BY_LABELS = { health: 'Device health', stack: 'Full / partial stack', juju: 'Juju', jaas: 'JAAS', maas: 'MAAS', energy: 'Energy' };
  const GROUP_BYS = [];
  GROUP_BY_MENU.forEach(function (e) { if (e.id) GROUP_BYS.push(e.id); else e.items.forEach(function (k) { GROUP_BYS.push(k); }); });

  // ---- Pipeline health (endpoint and destinations), per month ----------------
  // Synthetic, seeded per month. The Security SIEM is degraded (rate-limited,
  // retrying) in the latest month; everything else is healthy.
  function pipelineHealth(m) {
    const r = mulberry32(161803 + m * 97);
    const endpoint = { availability: 99.95 + r() * 0.04, p95IngestMs: Math.round(280 + r() * 220) };
    const destinations = {};
    DESTINATIONS.values.forEach(function (v) {
      if (v.drop) return;
      destinations[v.id] = { delivered: 99.8 + r() * 0.19, p95Ms: Math.round(400 + r() * 1400), status: 'healthy' };
    });
    if (m === MONTHS.length - 1) destinations.siem = { delivered: 96.4, p95Ms: 38000, status: 'degraded', note: 'Rate-limited by the SIEM; failed deliveries are being retried' };
    return { endpoint: endpoint, destinations: destinations };
  }

  // ---- Manual keys and assignment ----------------------------------------
  // Site and Environment are labels people assign (e.g. Landscape tags), so
  // some devices start without one. The model keeps each device's true site
  // (d.siteTrue) for generating its snaps and health; only the label is missing.
  const MANUAL_KEYS = ['site', 'environment'];
  DEVICES.forEach(function (d) { d.siteTrue = d.attrs.site; });
  (function () {
    const r = mulberry32(271828);
    const pickSome = function (n) {
      const out = [];
      while (out.length < n) { const d = DEVICES[Math.floor(r() * DEVICES.length)]; if (out.indexOf(d) < 0) out.push(d); }
      return out;
    };
    pickSome(Math.max(1, Math.round(DEVICES.length * 0.105))).forEach(function (d) { d.attrs.site = 'unassigned'; });
    pickSome(Math.max(1, Math.round(DEVICES.length * 0.08))).forEach(function (d) { d.attrs.environment = 'unassigned'; });
  })();
  const SITE_FROM_HOST = { store: 'store', plant: 'factory', depot: 'dc', dc: 'datacentre', cloud: 'cloud' };
  function clearCache() { Object.keys(cache).forEach(function (k) { delete cache[k]; }); }
  // Assign a manual key's value to a device (applies to its label in every month)
  function assign(deviceId, key, value) {
    const d = DEVICES.filter(function (x) { return x.id === deviceId; })[0];
    if (!d || MANUAL_KEYS.indexOf(key) < 0 || !valueOf(key, value)) return false;
    d.attrs[key] = value; clearCache();
    return true;
  }
  // Add a new value to a manual key (e.g. a new site 'factory2'); returns its id.
  // An existing value with the same label (ignoring case) is reused instead.
  function addValue(key, label, id) {
    if (MANUAL_KEYS.indexOf(key) < 0) return null;
    label = String(label).trim(); if (!label) return null;
    const attr = ATTRIBUTES[key];
    const existing = attr.values.filter(function (v) { return v.label.toLowerCase() === label.toLowerCase(); })[0];
    if (existing) return existing.id;
    id = id || 'new-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
    const at = attr.values.findIndex(function (v) { return v.id === 'unassigned'; });
    attr.values.splice(at < 0 ? attr.values.length : at, 0, { id: id, label: label, custom: true });
    attr.index = {}; attr.values.forEach(function (v, i) { attr.index[v.id] = i; v.order = i; });
    clearCache();
    return id;
  }
  // A suggested value, if one can be inferred (Site from the hostname)
  function suggest(deviceId, key) {
    if (key !== 'site') return null;
    const code = deviceId.split('-')[1];
    return SITE_FROM_HOST[code] || null;
  }

  Object.assign(TL, {
    FLEET: FLEET, pipelineHealth: pipelineHealth, MANUAL_KEYS: MANUAL_KEYS, assign: assign, suggest: suggest, addValue: addValue,
    MONTHS: MONTHS, monthLabel: monthLabel,
    ATTRIBUTES: ATTRIBUTES, DIMENSIONS: DIMENSIONS, ROUTING: ROUTING, PALETTE: PALETTE, HEALTH_COMPONENTS: HEALTH_COMPONENTS, HEALTH_RAMP: HEALTH_RAMP,
    DEVICES: DEVICES, VIEWS: VIEWS, GROUP_BYS: GROUP_BYS, GROUP_BY_MENU: GROUP_BY_MENU, GROUP_BY_LABELS: GROUP_BY_LABELS,
    PIPELINE: ['publisher', 'policy', 'destination'],
    snapshot: snapshot, deviceAt: deviceAt,
    CLOSEUP: CLOSEUP, closeupFacts: closeupFacts, closeupDevice: closeupDevice,
    valueOf: valueOf, parseNodeId: parseNodeId, nodeLabel: nodeLabel,
    viewById: function (id) { return VIEWS.filter(function (v) { return v.id === id; })[0]; }
  });
})(window.TL);
