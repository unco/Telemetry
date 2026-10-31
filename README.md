# Telemetry · Insights (Sankey prototype)

A dependency-free prototype of the **Insights** page for Ubuntu fleet telemetry. It's a Sankey illustration presented as four demo tabs, each adding one capability:

| Tab | Capabilities |
|---|---|
| 1 · View | Curated views, view-level highlight, hover/click path tracing |
| 2 · View + group by | Adds a "who" column on the left, with a chip filter (click toggles a group, Alt-click isolates it) |
| 3 · + Comments | Comments on nodes, scoped to the current view and group-by |
| 4 · + Over time | 12-month scrubber with play and step controls, deltas against a baseline, comments pinned to a month, timeline markers |

Open `index.html` directly in a browser. There's no build step and no server needed. All data is **synthetic** and seeded, so it's the same on every load.

## Views

| View | Stages (columns) | Highlights |
|---|---|---|
| Canonical infrastructure | Hosting → Infrastructure → Operations → Workload | Any Canonical layer · Full Canonical stack · Model-driven (Juju/JAAS) |
| Sovereignty | Hosting → Data jurisdiction → Key custody → Infrastructure | Fully sovereign · In-jurisdiction only · Sovereign on Canonical infra |
| Confidential compute | Infrastructure → Confidential compute → Key custody → Workload | Confidential-enabled · Confidential AI · Confidential on Canonical infra |

Canonical products (MAAS, MicroCloud, Canonical OpenStack, Juju, JAAS, Canonical Kubernetes) are marked with an orange ◆ in every view, whatever highlight is active.

Highlighting works on three levels:
1. **View highlight**: the coloured share of every flow and node, plus a KPI.
2. **Path trace**: hover or click a node to recompute the flows restricted to that node, so you see its true end-to-end path, not just the adjacent links.
3. **Product marking**: the ◆ badge on Canonical products.

## Data structure (`js/data.js`)

```
DIMENSIONS  { id → { label, kind, values: [{ id, label, canonical? }] } }   // ordered vocabulary
COHORTS     [{ id, attrs: {dim → valueId}, series: [count per month],
               changes: [{ month, attrs, note }] }]                         // facts + dated migrations
VIEWS       [{ id, label, question, stages: [dim…], color,
               highlights: [{ id, label, kpi, test(fact) }] }]              // curated lenses
GROUP_BYS   ['none', 'region', 'industry', 'orgSize', 'release', 'arch']
```

- `snapshot(monthIndex)` flattens cohorts into facts `{…attrs, count}` for one period.
- `sankey.aggregate(facts, stages, {filter, highlight, focus})` returns nodes and links, each carrying `value`, `h` (highlighted), `f` (focused) and `hf`.
- Node ids are `"<dimension>:<value>"`. They're stable across time, views and group-bys, which is what lets comments and time scrubbing line up.
- Node order within a column follows the fixed dimension order, so nothing jumps around during playback.
- Migrations such as VMware → MicroCloud/OpenStack, Juju → JAAS, hyperscaler → sovereign cloud, confidential compute enablement and LTS upgrades are modelled as dated `changes`. That's why the flows actually move over time.

## Comments (`js/comments.js`)

```
{ id, anchor: { view, groupBy, node, period|null }, author, body, createdAt, resolved }
```

- A thread belongs to a node **within a view and group-by context**. For example, `region:eu` under *Sovereignty · by Region* is a different conversation from the same node under *Confidential compute · by Region*.
- When a node has comments in other contexts, the panel lists them with a link that switches to that context.
- `period` is optional. In Tab 4 new comments are pinned to the current month by default; pinned comments appear as timeline markers and jump the scrubber when clicked.
- Comments are stored in `localStorage`. **Reset demo comments** restores the seed set.

## Files

```
index.html        layout: left nav (Insights active), header, tabs
css/app.css       Canonical/Vanilla-style app styling
js/data.js        dimensions, synthetic cohorts, views, group-bys
js/sankey.js      aggregate · interpolate · layout · SVG render
js/comments.js    comment store
js/app.js         page controller and tab capability flags
```

## Screenshots

| | |
|---|---|
| ![Tab 1](docs/tab1.png) | ![Tab 2](docs/tab2.png) |
| ![Tab 3](docs/tab3.png) | ![Tab 4](docs/tab4.png) |
