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
      { id: 'cloud', label: 'Public cloud' }] },
    type: { label: 'Device type', short: 'Type', values: [
      { id: 'metal', label: 'Bare-metal server' }, { id: 'vm', label: 'Virtual machine' },
      { id: 'k8s', label: 'Kubernetes node' }, { id: 'edge', label: 'Edge device' }] },
    region: { label: 'Region', short: 'Region', values: [
      { id: 'fra', label: 'Frankfurt' }, { id: 'par', label: 'Paris' }, { id: 'ldn', label: 'London' },
      { id: 'nyc', label: 'New York' }, { id: 'sfo', label: 'San Francisco' }, { id: 'sgp', label: 'Singapore' }] },
    release: { label: 'Ubuntu release', short: 'Release', values: [
      { id: '2204', label: 'Ubuntu 22.04 LTS' }, { id: '2404', label: 'Ubuntu 24.04 LTS' }, { id: '2604', label: 'Ubuntu 26.04 LTS' }] }
  };

  // assign palette colours: values marked `color: true` take the next colour
  // from the row matching the number of coloured values in that attribute
  Object.keys(ATTRIBUTES).forEach(function (k) {
    const coloured = ATTRIBUTES[k].values.filter(function (v) { return v.color; });
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
    { id: 'microcloud', label: 'microcloud', canonical: true, note: 'Edge/private cloud cluster' }] };
  const POLICIES = { label: 'Policy', values: [
    { id: 'standard', label: 'Standard (anonymised)' },
    { id: 'redact', label: 'PII redaction' },
    { id: 'eu-res', label: 'EU data residency' },
    { id: 'uk-res', label: 'UK data residency' },
    { id: 'attested', label: 'PCI scope · attested only' },
    { id: 'ot', label: 'OT safety & maintenance' },
    { id: 'local', label: 'On-prem only' },
    { id: 'drop', label: 'Opted out (drop)' }] };
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
    { id: 'discard', label: 'Not sent (dropped on device)', zone: 'device' }] };

  // ---- Policy rules (ordered, first match wins) -----------------------
  // `when` matches device attributes and/or publisher; `to` lists
  // destinations with shares. `at` records where the rule is applied:
  //   'snapd'    – on the device, before the stream leaves it
  //   'endpoint' – at the telemetry endpoint, after demultiplexing
  const ROUTING = [
    { id: 'R1', at: 'snapd', when: { consent: 'optout' }, policy: 'drop', to: [['discard', 1]] },
    { id: 'R2', at: 'endpoint', when: { publisher: 'payment' }, policy: 'attested', to: [['siem', 0.6], ['archive', 0.25], ['lake-us', 0.15]] },
    { id: 'R3', at: 'endpoint', when: { publisher: 'landscape' }, policy: 'local', to: [['landscape', 0.8], ['cmdb', 0.2]] },
    { id: 'R4', at: 'endpoint', when: { sovereignty: 'eu' }, policy: 'eu-res', to: [['lake-eu', 0.75], ['archive', 0.25]] },
    { id: 'R5', at: 'endpoint', when: { sovereignty: 'uk' }, policy: 'uk-res', to: [['lake-uk', 0.75], ['archive', 0.25]] },
    { id: 'R6', at: 'snapd', when: { publisher: ['pos', 'shelfcam'] }, policy: 'redact', to: [['lake-us', 0.6], ['observability', 0.25], ['siem', 0.15]] },
    { id: 'R7', at: 'endpoint', when: { publisher: ['plc', 'predmaint', 'coldchain'] }, policy: 'ot', to: [['observability', 0.45], ['itsm', 0.35], ['lake-us', 0.2]] },
    { id: 'R8', at: 'endpoint', when: {}, policy: 'standard', to: [['observability', 0.5], ['cmdb', 0.25], ['siem', 0.1], ['lake-us', 0.15]] }
  ];
  function route(attrs, publisher) {
    const ctx = Object.assign({ publisher: publisher }, attrs);
    for (let i = 0; i < ROUTING.length; i++) {
      const r = ROUTING[i];
      const ok = Object.keys(r.when).every(function (k) {
        const v = r.when[k]; return Array.isArray(v) ? v.indexOf(ctx[k]) >= 0 : ctx[k] === v;
      });
      if (ok) return r;
    }
  }

  // ---- Devices (synthetic, seeded) ------------------------------------
  const REGION_SOV = { fra: 'eu', par: 'eu', ldn: 'uk' };
  const DEVICES = [];
  const plan = [
    ['fra', 'metal', 3], ['fra', 'edge', 3], ['fra', 'k8s', 1], ['fra', 'vm', 1],
    ['par', 'metal', 1], ['par', 'edge', 3], ['par', 'vm', 1],
    ['ldn', 'metal', 1], ['ldn', 'edge', 3], ['ldn', 'vm', 1],
    ['nyc', 'metal', 3], ['nyc', 'edge', 4], ['nyc', 'k8s', 2], ['nyc', 'vm', 1],
    ['sfo', 'edge', 2], ['sfo', 'k8s', 1], ['sfo', 'vm', 2],
    ['sgp', 'metal', 1], ['sgp', 'edge', 3], ['sgp', 'vm', 1]
  ];
  const BASE_RATE = { pos: 900, shelfcam: 1400, signage: 120, coldchain: 300, plc: 1100, predmaint: 700,
    inventory: 800, order: 1000, erp: 500, payment: 300, landscape: 350, juju: 350, maas: 250, microcloud: 300 };
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

  plan.forEach(function (p) {
    for (let i = 1; i <= p[2]; i++) {
      const region = p[0], type = p[1];
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
      DEVICES.push({
        id: null, // assigned below as <region>-<site>-<nn>
        attrs: a, extras: extras, changes: changes,
        onboarded: chance(0.8) ? 0 : int(1, 10),
        scale: scale, growth: growth
      });
    }
  });

  function deriveStack(a) {
    const layers = (a.maas !== 'none') + (a.microcloud === 'member') + (a.juju !== 'none');
    return a.juju !== 'none' && layers >= 2 ? 'full' : layers >= 1 ? 'partial' : 'none';
  }
  function attrsAt(d, m) {
    const a = Object.assign({}, d.attrs);
    d.changes.forEach(function (c) { if (c.month <= m) Object.assign(a, c.attrs); });
    a.stack = deriveStack(a);
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
  const SITE_CODE = { store: 'store', factory: 'plant', dc: 'depot', datacentre: 'dc', cloud: 'cloud' };
  const REGION_ORDER = ['fra', 'par', 'ldn', 'nyc', 'sfo', 'sgp'];
  const SITE_ORDER = ['store', 'factory', 'dc', 'datacentre', 'cloud'];
  DEVICES.sort(function (x, y) {
    return (REGION_ORDER.indexOf(x.attrs.region) - REGION_ORDER.indexOf(y.attrs.region)) ||
      (SITE_ORDER.indexOf(x.attrs.site) - SITE_ORDER.indexOf(y.attrs.site));
  });
  const counters = {};
  DEVICES.forEach(function (d) {
    const key = d.attrs.region + '-' + SITE_CODE[d.attrs.site];
    counters[key] = (counters[key] || 0) + 1;
    d.id = key + '-' + String(counters[key]).padStart(2, '0');
  });

  const DIMENSIONS = {
    device: { label: 'Device', values: DEVICES.map(function (d) { return { id: d.id, label: d.id }; }) },
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
        const base = BASE_RATE[pub] * vol;
        r.to.forEach(function (t) {
          facts.push(Object.assign({ device: d.id, publisher: pub, policy: r.policy, destination: t[0], rule: r.id, count: base * t[1] }, a));
        });
      });
    });
    cache[m] = facts;
    return facts;
  }
  function deviceAt(id, m) {
    const d = DEVICES.filter(function (x) { return x.id === id; })[0];
    if (!d) return null;
    return { device: d, attrs: attrsAt(d, m), active: d.onboarded <= m,
      changes: d.changes.filter(function (c) { return c.note; }) };
  }

  // ---- Views & group-bys ----------------------------------------------
  // A view = one attribute to colour by + the question it answers.
  const VIEWS = [
    { id: 'juju', attr: 'juju', label: 'Juju', question: 'Which Juju version is each device running, and where does that telemetry go?' },
    { id: 'jaas', attr: 'jaas', label: 'JAAS', question: 'Which devices are managed through JAAS versus self-hosted controllers?' },
    { id: 'maas', attr: 'maas', label: 'MAAS', question: 'Which devices are provisioned by MAAS, and on which version?' },
    { id: 'microcloud', attr: 'microcloud', label: 'MicroCloud', question: 'Which devices belong to a MicroCloud cluster?' },
    { id: 'stack', attr: 'stack', label: 'Canonical infra', question: 'How much of the fleet runs on a full Canonical stack (MAAS / MicroCloud + Juju)?' },
    { id: 'sovereignty', attr: 'sovereignty', label: 'Telemetry residency', question: 'Which residency rule does each device’s telemetry follow, and where does it end up?' },
    { id: 'confidential', attr: 'confidential', label: 'Confidential compute', question: 'Which devices run confidential VMs, and where does their payment telemetry go?' }
  ];
  const GROUP_BYS = ['device', 'site', 'juju', 'jaas', 'maas', 'microcloud', 'stack', 'sovereignty', 'confidential', 'type', 'region', 'release'];

  Object.assign(TL, {
    MONTHS: MONTHS, monthLabel: monthLabel,
    ATTRIBUTES: ATTRIBUTES, DIMENSIONS: DIMENSIONS, ROUTING: ROUTING, PALETTE: PALETTE,
    // shared infrastructure every flow passes through (drawn between columns)
    WAYPOINTS: [
      { after: 'publisher', label: 'snapd', sub: 'one stream per device' },
      { after: 'policy', label: 'Telemetry endpoint', sub: 'demultiplex · route · forward' }
    ],
    DEVICES: DEVICES, VIEWS: VIEWS, GROUP_BYS: GROUP_BYS,
    PIPELINE: ['publisher', 'policy', 'destination'],
    snapshot: snapshot, deviceAt: deviceAt,
    valueOf: valueOf, parseNodeId: parseNodeId, nodeLabel: nodeLabel,
    viewById: function (id) { return VIEWS.filter(function (v) { return v.id === id; })[0]; }
  });
})(window.TL);
