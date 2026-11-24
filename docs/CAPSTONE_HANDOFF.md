# Nexora Health capstone handoff

Release baseline verified on **23 November 2026**. [Open the deployed prototype](https://harman-06.github.io/capstone/).

## What the team delivered

| Contributor | Verified repository evidence |
| --- | --- |
| **Farhan Akhter** | Built authenticated hospital and supplier workflows, fair allocation with source reserves, operational workspaces, and IT account monitoring. Integrated structured requests, dispatch, receipt, stock movement and transfer history. Follow-up work completed supplier deadlines, shortage handoff, live inventory counts and the synthetic My Visit workspace. [Allocation and supplier backend](https://github.com/harman-06/capstone/pull/4) · [Operations workspaces](https://github.com/harman-06/capstone/pull/5) · [Account monitoring](https://github.com/harman-06/capstone/pull/6) · [Transfer lifecycle](https://github.com/harman-06/capstone/pull/8) · [Sprint 3 follow-up](https://github.com/harman-06/capstone/commit/d6564a14ffc3d06e1b6a19d228cf4fc0b52620cf) · [My Visit](https://github.com/harman-06/capstone/pull/11) |
| **Arsalan** | Added Units navigation and built the Readiness screen, inventory breakdown and cross-unit stock display. The release follow-up connected those displays to database counts and configured reserves. [Units navigation](https://github.com/harman-06/capstone/pull/1) · [Readiness](https://github.com/harman-06/capstone/pull/9) · [Live stock correction](https://github.com/harman-06/capstone/pull/10) |
| **Noah Houghton** | Owned the security, privacy and access-control assignment. Authored branch-based demo-account provisioning for scoped staff and two separate supplier identities. The provisioning commit remains on the Demo-Accounts branch. Deployed security controls and their tests are documented separately from that branch. [Noah’s provisioning commit](https://github.com/harman-06/capstone/commit/139251ec29b4db03cabdd9347919b7737c716ec3) |
| **Aman Sharma** | Owned the supplier-workflow assignment and uploaded a supplier branch. The delivered supplier workflow is traceable to the merged backend, operations and Sprint 3 follow-up changes listed above. [Aman’s branch](https://github.com/harman-06/capstone/tree/Aman/supplier-workflow) |
| **Sidakveer Kamboj (Harman)** (`harman-06`) | Built the original web interface and developed the dashboard, routing, mobile navigation, notifications, branding, appointment booking and patient-profile layouts. He also created the frontend design poster. [Mobile navigation](https://github.com/harman-06/capstone/commit/3b7b9bf) · [Appointments and patient profile](https://github.com/harman-06/capstone/commit/be1b98f) · [Brand update](https://github.com/harman-06/capstone/commit/5e6d7033a71b78eca8b990c0ee7a653518b4748b) |

## Walk through the demo

1. **Readiness.** Sign in with the nurse account and open Readiness. Open **Stock details** when you want to show in-use, maintenance, or transit counts. The scaled demo starts with 8 Emergency ventilators available. A source coordinator can set the reserve to 3 to show 5 shareable.
2. **Internal transfer.** Submit one equipment need with a deadline and synthetic operational reason. In separate sessions, have a coordinator review and allocate it, a source-scoped operator dispatch it, and a destination-scoped operator confirm receipt. Open the timeline and compare source and destination counts. Prepare both operator scopes before attempting the walkthrough.
3. **Supplier fallback.** Open an item with no transferable internal stock and choose **Ask a supplier**. Have an independent coordinator send the enquiry. Supplier A can return full, partial or unavailable stock with an ETA where applicable. Supplier B cannot see Supplier A’s enquiry. The hospital page refreshes about every 15 seconds while active.
4. **My Visit glimpse.** The app and schema are deployed. As of this check no hosted fictional visits are provisioned. Use the live screen only after a trusted administrator creates dedicated patient demo accounts and assigns fictional visits. [Patient setup and handling](PATIENT_DATA_HANDLING.md)

Use synthetic records and an approved demo environment. Obtain credentials privately. The deployed equipment screens and stock totals were verified in a live browser. End-to-end writes, concurrent allocation and transfer retries were verified in isolated tests. The My Visit access tests used isolated synthetic accounts.

## Release and privacy

The Sprint 3 operating release is `d6564a1` and the My Visit deployment is `69d60ab`. Supabase Auth and PostgreSQL run the application’s data access and workflows. GitHub Pages serves the interface. The hosted project is in US East. Keep the capstone synthetic. A healthcare custodian would need a separate privacy and operational review before using real patient information.

- [Equipment tag handoff demo](VERIFIED_HANDOFF.md)
- [Sprint 3 verification and limits](SPRINT_3_RELEASE.md)
- [Patient privacy, retention and cleanup](PATIENT_DATA_HANDLING.md)
- [Alberta OIPC privacy impact assessment guidance](https://oipc.ab.ca/privacy-impact-assessments/)
