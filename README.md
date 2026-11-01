# Telemetry · Insights (Sankey prototype)

A dependency-free prototype of the **Insights** page for Ubuntu telemetry. It shows how telemetry flows through the pipeline:

```
[ column 1 ]  →  Publisher (snap)  →  Policy  →  Destination
                                 ┆ snapd      ┆ telemetry endpoint
```

**Architecture:**
1. Every snap on a device hands its telemetry to **snapd**.
2. snapd enforces naming and on-device rules, then merges all snaps into **one stream** to the **telemetry endpoint**.
3. The endpoint splits the stream back out by snap, applies routing policy and forwards each flow to its destination.

snapd and the endpoint are drawn as dashed markers between the columns. Every flow passes through them, so neither needs a column of its own. Each policy rule records where it's applied: `at: 'snapd'` (on the device) or `at: 'endpoint'`.

**Only column 1 changes.**
- With **no group-by**, column 1 has one node per **device**.
- With a **group-by** (e.g. Juju version), the devices collapse into streams per value (4.1 / 3.6 / 2.9 / none). Publisher, policy and destination stay the same.

A **view** colours every device by one attribute and carries that colour through its flows to the destination. For example, the Juju view colours each device by its Juju version. Views never change the columns.

Open `index.html` directly in a browser; there's no build step. All data is **synthetic** and seeded.

| Tab | Capabilities |
|---|---|
| 1 · View | Devices coloured by the view attribute. Click a colour to isolate it. Hover or click a node to trace its full path |
| 2 · View + group by | Column 1 collapses to group-by values. Chips filter streams; Alt-click shows only one. With devices, the chips filter by view value and a search box filters by name |
| 3 · + Comments | Comments on any node, scoped to view and group-by. Comments on the same node in other contexts are linked |
| 4 · + Over time | 12-month scrubber with play, deltas against a baseline, comments pinned to a month, and timeline markers |

## Views

| View | Colours devices by | Values |
|---|---|---|
| Juju | Juju version | 4.1 · 3.6 LTS · 2.9 · none |
| JAAS | Juju controller | JAAS · self-hosted · none |
| MAAS | MAAS version | 3.6 · 3.5 · none |
| MicroCloud | MicroCloud membership | member · none |
| Canonical infra | Derived stack | full (Juju + MAAS/MicroCloud) · partial · none |
| Telemetry residency | Residency rule the device's telemetry follows | EU · UK · none |
| Confidential compute | CC hardware | Intel TDX · AMD SEV-SNP · none |

Group-by can use any of these attributes, plus device type, region and Ubuntu release.

## Data structure (`js/data.js`)

```
ATTRIBUTES    { attr → { label, values: [{ id, label, color? }] } }   // device vocabulary; no colour = neutral
PUBLISHERS / POLICIES / DESTINATIONS                                 // publishers are snaps (snap names)
WAYPOINTS     [{ after: 'publisher'|'policy', label }]                // snapd, telemetry endpoint
ROUTING       [{ id, at: 'snapd'|'endpoint', when: {attr|publisher: value|[values]}, policy, to: [[destination, share]] }]
              // ordered, first match wins — auditable and easy to change
DEVICES       [{ id, attrs, extras, onboarded, scale, growth,
                 changes: [{ month, attrs, note }] }]                 // upgrades, migrations, policy moves
VIEWS         [{ id, attr, label, question }]
GROUP_BYS     ['device', …attributes]
```

- `snapshot(month)` expands devices × publishers × routing into flow facts: `{ device, …attrs, publisher, policy, destination, rule, count }`.
- `sankey.aggregate(facts, [col1, 'publisher', 'policy', 'destination'], { segAttr: view.attr, filter, focus })` gives every node and link a `seg` breakdown by view value. That breakdown is what colours flows end to end.
- Node ids are `"<dimension>:<value>"` (e.g. `juju:3.6`, `device:fra-metal-01`, `policy:eu-res`). They stay the same across time, views and group-bys.
- Columns are top-aligned, so the top stream runs horizontally and lower streams rise into it. Node order is fixed, so playback doesn't reshuffle.

The routing rules deliberately contain a realistic flaw. Rule R2 (attestation evidence, applied at the endpoint) comes before R4 (EU residency), so a little attestation evidence from EU-residency devices is copied to the US data lake. The Telemetry residency view makes this visible, and a seeded comment flags it.

## Comments (`js/comments.js`)

```
{ id, anchor: { view, groupBy, node, period|null }, author, body, createdAt, resolved }
```

Comments are stored in `localStorage`. **Reset demo comments** restores the seed set.

## Files

```
index.html        layout: left nav (Insights active), header, tabs
css/app.css       Canonical/Vanilla-style app styling
js/data.js        attributes, pipeline, routing rules, devices, views
js/sankey.js      aggregate · interpolate · layout · SVG render
js/comments.js    comment store
js/app.js         page controller and tab capability flags
docs/             screenshots
```

## Screenshots

| | |
|---|---|
| ![Tab 1](docs/tab1.png) | ![Tab 2](docs/tab2.png) |
| ![Tab 3](docs/tab3.png) | ![Tab 4](docs/tab4.png) |
