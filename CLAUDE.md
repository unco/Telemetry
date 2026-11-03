# Context for Claude sessions

Prototype of the **Insights** page (Telemetry product): a single-page Sankey. See README.md for the data model.

## Telemetry architecture (as described by the product owner)
- Every snap on a device sends its telemetry to **snapd**.
- snapd enforces rules and naming, and multiplexes all snaps into a **single stream** to the **telemetry endpoint**.
- The telemetry endpoint demultiplexes, routes and forwards to destinations.

## Terminology
- Do **not** describe snapd as a "gateway" — that term is not to be used. Describe what it does (enforces rules and naming, multiplexes into one stream).
- Publishers are snaps; label them with their snap names.
- "Sovereignty" here means **telemetry residency** only (which residency rule a device's telemetry follows), not sovereignty of the device or its workloads. Use "Telemetry residency" in the UI.
- Publishers should read as the customer's fleet (store, factory, DC, data-centre and cloud applications such as pos-terminal, opcua-connector, order-service), with Canonical snaps (juju, maas, microcloud, landscape-client) as a minority — avoid a "for us by us" feel. Seeded comments are written by the customer's teams, not Canonical's.
- Destinations are the customer's own systems (observability, data lakes, SIEM, CMDB, ITSM, Landscape, archive), not Canonical services.
- Goal is to show where data goes and why. Zone-crossing flags / "leaving its zone" KPIs are explicitly not an objective.

## Health
- Health = composite 0–100 "magic number" from weighted components, shown in bands of 10 (0–10, 11–20 … 91–100).
- Health uses an adjacent/gradient colour scale (diverging rust → taupe/olive → teal, derived from the design palette), not the contrasting categorical palette.

- Health data includes a deliberate incident (Jun–Sep 2026, opcua-connector r214 crash loop + fleet-wide refresh hold) with a two-SRE comment thread on Health · by Site · Factory floor.

## Sustainability
- Sustainability signals are device attributes joined in the control plane (keep payloads light), shown in the device tooltip, separate from health.
- Layer 1 Lifecycle: hardware age, supported-until (standard vs Ubuntu Pro/ESM), flag replacement "for software reasons alone".
- Layer 2 Energy: monthly kWh band per physical device, measured via Redfish (BMC) on servers or RAPL via landscape-client (Kepler-style); unmeasured/virtual shown as such; idle-but-powered flag.
- In the device tooltip, Sustainability is an expandable accordion (collapsed summary on hover).
- Device tooltip behaviour: clicking a device opens it; it stays open (anchored to the device, refreshed when scrubbing the timeline) until a click outside, a click on another device, or a filter change. No close button; Escape also closes.
- Both layers are also views (Sustainability ▸ Lifecycle, Energy) and group-by options.
- Only these two layers are intended; there is deliberately no third layer.
- No snapd / telemetry endpoint wording in the subtitle or tooltips.

## Sankey rules agreed with the user
- Columns are fixed: **Device → Publisher → Policy → Destination**. Only column 1 changes.
- A **view** colours devices (and their flows end to end) by one attribute, e.g. Juju version. Views never change columns.
- View selector is a dropdown starting on **Neutral** (one flow colour): Neutral · Device health · Reporting status · Telemetry residency · Confidential compute · Sustainability ▸ (Lifecycle, Energy) · Canonical infrastructure ▸ (Full/partial stack, Juju, JAAS, MAAS, MicroCloud).
- No intro/description text and no "synthetic data" note under the page header.
- Group-by dropdown is categorised by attribute provenance: Manual (Site, Region, Environment, Telemetry residency) · Reported (Device health, Lifecycle, Energy, Confidential compute, Ubuntu release, Device type) · Infrastructure (Full/partial stack, Juju, JAAS, MAAS, MicroCloud). Site is a manually assigned label, not reported by devices.
- Manual keys (Site, Environment) can be Unassigned; a pinned device tooltip offers an "Assign" link that opens a modal with an autocomplete over existing values (incl. near matches) that also allows creating a new value, e.g. "factory2" (Site suggested from hostname). New values become real values for the key. Saved in localStorage; "Reset assignments" footer link appears once something is assigned.
- **Group by** replaces the device column with that attribute's values (e.g. Juju 4.1 / 3.6 / none); publisher, policy and destination stay intact.
- Single page, no tabs: view + group by + comments + timeline all available. Opens on Neutral view, devices ungrouped, "Compare to: nothing" (no deltas until chosen). "Reset comments" is a footer link.
- No snapd / telemetry endpoint markers in the chart (removed at the user's request).
- Columns top-aligned (top stream horizontal, others rise into it); flows fairly transparent.

## Reporting status (pipe health)
- Measured at the telemetry endpoint per device and per snap (endpoint knows the device; it can't see why). Cause hinted via Landscape online/offline cross-check (only for devices with landscape-client).
- Statuses: Reporting · Delayed · Partially silent (some snaps) · Silent (online in Landscape) · Offline · Silent (cause unknown). View + Reported group-by + tooltip line with hint + SRE insight.
- Do NOT claim snapd queues/buffers telemetry: that's an unconfirmed design question for the snapd/telemetry engineers.
- Latest month scripted (par-store-02, sgp-dc-01, nyc-cloud-02, fra-store-01, sfo-cloud-02); factory devices partially silent (opcua-connector) in Jun/Jul 2026.

## Pipeline health panel
- Panel at the bottom of the page (user: "a pipeline health at the bottom is fine"): Devices and snaps (reporting normally) → Telemetry endpoint (status, availability, p95 ingest, received) → Destinations (collapsible table, closed by default: delivered/day, success %, p95, Healthy/Degraded badge; row click traces the destination).
- Security SIEM degraded (rate-limited, retrying) in the latest month only. No markers in the chart; no claims about snapd queueing.
- Landscape online/offline can be joined with telemetry (confirmed by the user).

## Data insights
- Strip under the header, collapsed by default with heading "N data insights available"; computed from the whole fleet for the timeline month (7 on mid, 2 on hobby).
- Each insight: Vanilla-style badge for audience (Compliance / SRE / Platform / Sustainability), title, one-line evidence, "Show me" (sets view + group-by, clears filters, selects node so its comments open).
- Compliance insights are framed as rule conflicts (R4/R5 before R6 redaction; R2 before residency), not zone-crossing flags.

## Fleet size ladder
- Fleet chosen only by invisible URL param: `?fleet=hobby` (6 home-lab devices) · default/`mid` (38) · `enterprise` (5,000 = the 38 + generated extras; the 38 keep identical data).
- Unassigned devices are NOT always shown in the top 20 (decided with the user); they're reached via device search or Group by Site → Unassigned → "Show devices in this group".
- On mid (and 16–30), the ladder note leads with "As your fleet grows, group by Site to keep this view readable." (no counts; dismissible for the session), quick group-by buttons (plain buttons, no coverage counts); the Others line is secondary.
- Ladder: ≤15 every device · 16–30 nudge to group · 31+ top 20 (ranked by the view; frozen to the latest month; commented/selected/open devices always shown; rank order in column 1) + "Others" with a note on what it hides · 100+ opens grouped by Site, drill into a group via "Show devices in this group".

## Deployment
- Work branch: `claude/sankey-telemetry-illustration-vkal2f`.
- Bump the `?v=` cache-busting query on the CSS/JS links in index.html with each deploy (phones cache GitHub Pages assets).
- GitHub Pages serves the `gh-pages` branch at https://unco.github.io/Telemetry/ — push changes to both branches.
- Data is synthetic and seeded; the site is public.
