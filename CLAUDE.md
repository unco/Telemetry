# Context for Claude sessions

Prototype of the **Insights** page (Telemetry product): a Sankey shown as four demo tabs. See README.md for the data model.

## Telemetry architecture (as described by the product owner)
- Every snap on a device sends its telemetry to **snapd**.
- snapd enforces rules and naming, and multiplexes all snaps into a **single stream** to the **telemetry endpoint**.
- The telemetry endpoint demultiplexes, routes and forwards to destinations.

## Terminology
- Do **not** describe snapd as a "gateway" — that term is not to be used. Describe what it does (enforces rules and naming, multiplexes into one stream).
- Publishers are snaps; label them with their snap names.

## Sankey rules agreed with the user
- Columns are fixed: **Device → Publisher → Policy → Destination**. Only column 1 changes.
- A **view** colours devices (and their flows end to end) by one attribute, e.g. Juju version. Views never change columns.
- **Group by** replaces the device column with that attribute's values (e.g. Juju 4.1 / 3.6 / none); publisher, policy and destination stay intact.
- Tabs: 1 view · 2 + group by · 3 + comments · 4 + over time.
- Columns top-aligned (top stream horizontal, others rise into it); flows fairly transparent.

## Deployment
- Work branch: `claude/sankey-telemetry-illustration-vkal2f`.
- GitHub Pages serves the `gh-pages` branch at https://unco.github.io/Telemetry/ — push changes to both branches.
- Data is synthetic and seeded; the site is public.
