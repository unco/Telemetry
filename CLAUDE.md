# Context for Claude sessions

Prototype of the **Insights** page (Telemetry product): a Sankey shown as four demo tabs. See README.md for the data model.

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

## Sankey rules agreed with the user
- Columns are fixed: **Device → Publisher → Policy → Destination**. Only column 1 changes.
- A **view** colours devices (and their flows end to end) by one attribute, e.g. Juju version. Views never change columns.
- View selector is a dropdown starting on **Neutral** (one flow colour): Neutral · Device health · Telemetry residency · Confidential compute · Canonical infrastructure ▸ (Full/partial stack, Juju, JAAS, MAAS, MicroCloud).
- No tab descriptions and no "synthetic data" note under the page header.
- **Group by** replaces the device column with that attribute's values (e.g. Juju 4.1 / 3.6 / none); publisher, policy and destination stay intact.
- Tabs: 1 view · 2 + group by · 3 + comments · 4 + over time.
- Columns top-aligned (top stream horizontal, others rise into it); flows fairly transparent.

## Deployment
- Work branch: `claude/sankey-telemetry-illustration-vkal2f`.
- GitHub Pages serves the `gh-pages` branch at https://unco.github.io/Telemetry/ — push changes to both branches.
- Data is synthetic and seeded; the site is public.
