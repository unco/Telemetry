/*
 * Telemetry Insights — data model
 * ---------------------------------------------------------------
 * The model has three layers:
 *
 *   1. DIMENSIONS  – the vocabulary. Every attribute a telemetry fact can
 *                    carry, with ordered values and metadata (e.g. whether
 *                    a value is a Canonical product). Order is fixed so the
 *                    Sankey stays stable when scrubbing through time.
 *
 *   2. COHORTS     – the facts. A cohort is a group of machines that share
 *                    the same attributes. Each cohort has a monthly count
 *                    series and a list of dated attribute changes
 *                    (e.g. "migrated from VMware to MicroCloud in Feb 2026").
 *                    snapshot(month) flattens cohorts into facts for a period.
 *
 *   3. VIEWS / GROUP_BYS – the lenses. A view is a named, curated question
 *                    ("how much runs on Canonical infra?"): an ordered list
 *                    of stages (dimensions → Sankey columns) plus one or more
 *                    highlight predicates. A group-by prepends a "who"
 *                    dimension as the first column and can be filtered.
 *
 * Comments are anchored to (view, groupBy, nodeId[, period]) — see comments.js.
 * Node ids are "<dimension>:<value>" so they are stable across time.
 */
window.TL = window.TL || {};

(function (TL) {
  'use strict';

  // ---- Time -----------------------------------------------------------
  const MONTHS = [
    '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
    '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'
  ];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthLabel(period, short) {
    const [y, m] = period.split('-');
    return MONTH_NAMES[+m - 1] + (short ? ' ’' + y.slice(2) : ' ' + y);
  }

  // ---- 1. Dimensions --------------------------------------------------
  // `canonical: true` marks Canonical products/services so any view can
  // badge them, regardless of whether the view's highlight is about them.
  const DIMENSIONS = {
    region: {
      label: 'Region', kind: 'who',
      values: [
        { id: 'na', label: 'North America' },
        { id: 'eu', label: 'European Union' },
        { id: 'uk', label: 'United Kingdom' },
        { id: 'apac', label: 'Asia Pacific' },
        { id: 'latam', label: 'Latin America' },
        { id: 'mea', label: 'Middle East & Africa' }
      ]
    },
    industry: {
      label: 'Industry', kind: 'who',
      values: [
        { id: 'finance', label: 'Financial services' },
        { id: 'telco', label: 'Telecommunications' },
        { id: 'public', label: 'Public sector' },
        { id: 'health', label: 'Healthcare' },
        { id: 'manuf', label: 'Manufacturing' },
        { id: 'tech', label: 'Technology' }
      ]
    },
    orgSize: {
      label: 'Organisation size', kind: 'who',
      values: [
        { id: 'smb', label: 'Small business' },
        { id: 'mid', label: 'Mid-market' },
        { id: 'ent', label: 'Enterprise' }
      ]
    },
    release: {
      label: 'Ubuntu release', kind: 'who',
      values: [
        { id: '2004', label: '20.04 LTS (ESM)' },
        { id: '2204', label: '22.04 LTS' },
        { id: '2404', label: '24.04 LTS' },
        { id: '2604', label: '26.04 LTS' }
      ]
    },
    arch: {
      label: 'Architecture', kind: 'who',
      values: [
        { id: 'amd64', label: 'amd64' },
        { id: 'arm64', label: 'arm64' },
        { id: 's390x', label: 's390x' }
      ]
    },
    hosting: {
      label: 'Hosting', kind: 'where',
      values: [
        { id: 'onprem', label: 'Own data centre' },
        { id: 'sovcloud', label: 'Sovereign cloud provider' },
        { id: 'edge', label: 'Edge sites' },
        { id: 'hyperscaler', label: 'Hyperscaler' }
      ]
    },
    substrate: {
      label: 'Infrastructure', kind: 'stack',
      values: [
        { id: 'maas', label: 'MAAS (bare metal)', canonical: true },
        { id: 'microcloud', label: 'MicroCloud', canonical: true },
        { id: 'openstack', label: 'Canonical OpenStack', canonical: true },
        { id: 'vmware', label: 'VMware' },
        { id: 'publicvm', label: 'Public cloud VM' }
      ]
    },
    orchestration: {
      label: 'Operations', kind: 'stack',
      values: [
        { id: 'juju', label: 'Juju (self-managed)', canonical: true },
        { id: 'jaas', label: 'JAAS', canonical: true },
        { id: 'ck8s', label: 'Canonical Kubernetes', canonical: true },
        { id: 'other', label: 'Other / unmanaged' }
      ]
    },
    workload: {
      label: 'Workload', kind: 'what',
      values: [
        { id: 'ai', label: 'AI / ML' },
        { id: 'data', label: 'Data & databases' },
        { id: 'web', label: 'Web & business apps' },
        { id: 'telco', label: 'Telco / NFV' },
        { id: 'hpc', label: 'HPC' }
      ]
    },
    jurisdiction: {
      label: 'Data jurisdiction', kind: 'trust',
      values: [
        { id: 'in', label: 'In-jurisdiction operator' },
        { id: 'region', label: 'In-region, foreign operator' },
        { id: 'cross', label: 'Cross-border' }
      ]
    },
    keys: {
      label: 'Key custody', kind: 'trust',
      values: [
        { id: 'customer', label: 'Customer-held keys' },
        { id: 'provider', label: 'Provider-held keys' }
      ]
    },
    confidential: {
      label: 'Confidential compute', kind: 'trust',
      values: [
        { id: 'tdx', label: 'Intel TDX' },
        { id: 'snp', label: 'AMD SEV-SNP' },
        { id: 'cca', label: 'Arm CCA' },
        { id: 'none', label: 'Not confidential' }
      ]
    }
  };
  // index lookups
  Object.keys(DIMENSIONS).forEach(function (k) {
    const d = DIMENSIONS[k];
    d.id = k;
    d.index = {};
    d.values.forEach(function (v, i) { d.index[v.id] = i; v.order = i; });
  });
  function valueOf(dim, id) { return DIMENSIONS[dim].values[DIMENSIONS[dim].index[id]]; }
  function nodeId(dim, val) { return dim + ':' + val; }
  function parseNodeId(id) { const p = id.split(':'); return { dim: p[0], val: p[1] }; }
  function nodeLabel(id) { const p = parseNodeId(id); const v = valueOf(p.dim, p.val); return v ? v.label : id; }

  // ---- 3. Views & group-bys ------------------------------------------
  const isCanon = function (dim, v) { const x = valueOf(dim, v); return !!(x && x.canonical); };
  const VIEWS = [
    {
      id: 'canonical-infra',
      label: 'Canonical infrastructure',
      question: 'How much of the fleet runs on Canonical infrastructure and operations tooling — and where is it moving?',
      stages: ['hosting', 'substrate', 'orchestration', 'workload'],
      color: '#E95420',
      highlights: [
        { id: 'any', label: 'Any Canonical layer', kpi: 'on any Canonical layer',
          test: function (f) { return isCanon('substrate', f.substrate) || isCanon('orchestration', f.orchestration); } },
        { id: 'full', label: 'Full Canonical stack', kpi: 'on a full Canonical stack',
          test: function (f) { return isCanon('substrate', f.substrate) && isCanon('orchestration', f.orchestration); } },
        { id: 'model', label: 'Model-driven (Juju / JAAS)', kpi: 'operated with Juju or JAAS',
          test: function (f) { return f.orchestration === 'juju' || f.orchestration === 'jaas'; } }
      ]
    },
    {
      id: 'sovereignty',
      label: 'Sovereignty',
      question: 'Which workloads keep both data and control inside the customer’s jurisdiction?',
      stages: ['hosting', 'jurisdiction', 'keys', 'substrate'],
      color: '#772953',
      highlights: [
        { id: 'sovereign', label: 'Fully sovereign', kpi: 'fully sovereign (in-jurisdiction + customer keys)',
          test: function (f) { return f.jurisdiction === 'in' && f.keys === 'customer'; } },
        { id: 'jurisdiction', label: 'In-jurisdiction only', kpi: 'run by an in-jurisdiction operator',
          test: function (f) { return f.jurisdiction === 'in'; } },
        { id: 'sov-canonical', label: 'Sovereign on Canonical infra', kpi: 'sovereign and on Canonical infrastructure',
          test: function (f) { return f.jurisdiction === 'in' && f.keys === 'customer' && isCanon('substrate', f.substrate); } }
      ]
    },
    {
      id: 'confidential',
      label: 'Confidential compute',
      question: 'Where is confidential computing being adopted, on which hardware, and for what?',
      stages: ['substrate', 'confidential', 'keys', 'workload'],
      color: '#0E8420',
      highlights: [
        { id: 'cc', label: 'Confidential-enabled', kpi: 'running in confidential VMs',
          test: function (f) { return f.confidential !== 'none'; } },
        { id: 'cc-ai', label: 'Confidential AI', kpi: 'confidential AI / ML',
          test: function (f) { return f.confidential !== 'none' && f.workload === 'ai'; } },
        { id: 'cc-canonical', label: 'Confidential on Canonical infra', kpi: 'confidential on Canonical infrastructure',
          test: function (f) { return f.confidential !== 'none' && isCanon('substrate', f.substrate); } }
      ]
    }
  ];
  const GROUP_BYS = ['none', 'region', 'industry', 'orgSize', 'release', 'arch'];

  // ---- 2. Cohorts (synthetic, seeded) ---------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(20261031);
  function pick(weights) {
    const keys = Object.keys(weights);
    let total = 0; keys.forEach(function (k) { total += weights[k]; });
    let r = rnd() * total;
    for (let i = 0; i < keys.length; i++) { r -= weights[keys[i]]; if (r <= 0) return keys[i]; }
    return keys[keys.length - 1];
  }
  function between(a, b) { return a + rnd() * (b - a); }
  function int(a, b) { return Math.floor(between(a, b + 1)); }

  function makeCohort(id) {
    const a = {};
    a.region = pick({ na: 30, eu: 27, uk: 8, apac: 21, latam: 7, mea: 7 });
    a.industry = pick({ finance: 19, telco: 13, public: 15, health: 11, manuf: 13, tech: 29 });
    a.orgSize = pick({ smb: 30, mid: 36, ent: 34 });
    a.release = pick({ '2004': 10, '2204': 46, '2404': 44 });
    a.arch = pick(a.industry === 'finance' && a.orgSize === 'ent'
      ? { amd64: 74, arm64: 12, s390x: 14 } : { amd64: 80, arm64: 19, s390x: 1 });

    const sovBoost = (a.region === 'eu' ? 2.6 : a.region === 'uk' || a.region === 'mea' ? 1.6 : 0.6) *
      (a.industry === 'public' ? 3 : a.industry === 'health' || a.industry === 'finance' ? 1.5 : 1);
    a.hosting = pick({
      onprem: 34 * (a.industry === 'public' || a.industry === 'finance' ? 1.4 : 1),
      sovcloud: 7 * sovBoost,
      edge: 10 * (a.industry === 'telco' ? 3.5 : a.industry === 'manuf' ? 2 : 1),
      hyperscaler: 44 * (a.industry === 'tech' ? 1.6 : 1) * (a.orgSize === 'smb' ? 1.4 : 1)
    });

    a.substrate = ({
      onprem: function () { return pick({ maas: 26, microcloud: 14, openstack: 24, vmware: 36 }); },
      sovcloud: function () { return pick({ openstack: 56, maas: 30, microcloud: 14 }); },
      edge: function () { return pick({ microcloud: 58, maas: 24, vmware: 18 }); },
      hyperscaler: function () { return 'publicvm'; }
    })[a.hosting]();

    a.orchestration = a.substrate === 'publicvm'
      ? pick({ juju: 8, jaas: 5, ck8s: 22, other: 65 })
      : a.substrate === 'vmware'
        ? pick({ juju: 12, jaas: 3, ck8s: 15, other: 70 })
        : pick({ juju: 38, jaas: 14, ck8s: 30, other: 18 });

    a.workload = a.industry === 'telco'
      ? pick({ telco: 58, data: 14, web: 14, ai: 14 })
      : pick({ ai: 20, data: 26, web: 36, telco: 2, hpc: a.industry === 'manuf' || a.industry === 'tech' || a.industry === 'health' ? 10 : 3 });

    // jurisdiction: who operates the infrastructure, relative to the customer
    if (a.hosting === 'hyperscaler') {
      a.jurisdiction = a.region === 'na' ? pick({ in: 82, region: 8, cross: 10 })
        : pick({ in: 4, region: 58, cross: 38 });
    } else if (a.hosting === 'sovcloud') {
      a.jurisdiction = pick({ in: 94, region: 6 });
    } else {
      a.jurisdiction = pick({ in: 90, region: 6, cross: 4 });
    }
    const keyP = ({ onprem: 0.66, sovcloud: 0.62, edge: 0.48, hyperscaler: 0.22 })[a.hosting] +
      (a.industry === 'finance' || a.industry === 'public' ? 0.15 : 0);
    a.keys = rnd() < keyP ? 'customer' : 'provider';
    a.confidential = 'none';

    // size & growth
    const base = a.orgSize === 'smb' ? between(4, 40) : a.orgSize === 'mid' ? between(30, 220) : between(160, 1400);
    let growth = between(-0.01, 0.035);
    if (a.workload === 'ai') growth += 0.04;
    if (a.hosting === 'sovcloud') growth += 0.03;
    if (a.substrate === 'microcloud') growth += 0.02;
    const start = rnd() < 0.72 ? 0 : int(1, MONTHS.length - 1);

    // dated attribute changes (applied when month >= change.month)
    const changes = [];
    // Confidential compute adoption
    let ccP = ({ finance: 0.42, health: 0.38, public: 0.34, tech: 0.2, telco: 0.12, manuf: 0.1 })[a.industry];
    if (a.workload === 'ai') ccP += 0.22;
    if (a.substrate === 'vmware') ccP *= 0.25;
    if (a.arch === 's390x') ccP = 0;
    if (rnd() < ccP) {
      const hw = a.arch === 'arm64' ? 'cca' : (rnd() < 0.56 ? 'tdx' : 'snp');
      const m = rnd() < 0.3 ? 0 : int(1, 15); // 0 = already enabled; >11 = after horizon
      changes.push({ month: m, attrs: { confidential: hw }, note: 'Enabled confidential VMs' });
    }
    // VMware exodus
    if (a.substrate === 'vmware' && rnd() < 0.42) {
      const to = a.hosting === 'edge' ? 'microcloud' : pick({ microcloud: 55, openstack: 45 });
      const ch = { month: int(2, 11), attrs: { substrate: to }, note: 'Migrated off VMware' };
      if (a.orchestration === 'other' && rnd() < 0.5) ch.attrs.orchestration = pick({ juju: 50, ck8s: 50 });
      changes.push(ch);
    }
    // Juju → JAAS consolidation
    if (a.orchestration === 'juju' && rnd() < 0.3) {
      changes.push({ month: int(1, 11), attrs: { orchestration: 'jaas' }, note: 'Moved to JAAS' });
    }
    // Repatriation from hyperscalers to sovereign providers (EU/UK/MEA)
    if (a.hosting === 'hyperscaler' && (a.region === 'eu' || a.region === 'uk' || a.region === 'mea') &&
        (a.industry === 'public' || a.industry === 'health' || a.industry === 'finance') && rnd() < 0.35) {
      changes.push({ month: int(3, 11), attrs: { hosting: 'sovcloud', substrate: 'openstack', jurisdiction: 'in', keys: 'customer' }, note: 'Repatriated to sovereign cloud' });
    }
    // Release upgrades
    if (a.release === '2204' && rnd() < 0.38) changes.push({ month: int(6, 11), attrs: { release: '2604' } });
    if (a.release === '2004' && rnd() < 0.35) changes.push({ month: int(1, 11), attrs: { release: '2404' } });
    changes.sort(function (x, y) { return x.month - y.month; });

    const series = MONTHS.map(function (_, m) {
      if (m < start) return 0;
      return Math.max(1, Math.round(base * Math.pow(1 + growth, m - start) * between(0.97, 1.03)));
    });
    return { id: 'c' + id, attrs: a, series: series, changes: changes };
  }

  const COHORTS = [];
  for (let i = 0; i < 900; i++) COHORTS.push(makeCohort(i));

  function attrsAt(cohort, m) {
    const out = Object.assign({}, cohort.attrs);
    cohort.changes.forEach(function (c) { if (c.month <= m) Object.assign(out, c.attrs); });
    return out;
  }

  // Flatten cohorts into facts for a month index. Cached.
  const snapCache = {};
  function snapshot(m) {
    if (snapCache[m]) return snapCache[m];
    const facts = [];
    COHORTS.forEach(function (c) {
      const n = c.series[m];
      if (!n) return;
      const f = attrsAt(c, m);
      f.count = n;
      f.cohort = c.id;
      facts.push(f);
    });
    snapCache[m] = facts;
    return facts;
  }

  Object.assign(TL, {
    MONTHS: MONTHS, monthLabel: monthLabel,
    DIMENSIONS: DIMENSIONS, VIEWS: VIEWS, GROUP_BYS: GROUP_BYS,
    COHORTS: COHORTS, snapshot: snapshot,
    valueOf: valueOf, nodeId: nodeId, parseNodeId: parseNodeId, nodeLabel: nodeLabel,
    viewById: function (id) { return VIEWS.filter(function (v) { return v.id === id; })[0]; }
  });
})(window.TL);
