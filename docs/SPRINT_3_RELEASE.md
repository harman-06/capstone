# Sprint 3 release and verification

See the [capstone handoff](CAPSTONE_HANDOFF.md) for team credits and the latest demo status.

## Demo checklist

| Area | Verify | Expected result |
| --- | --- | --- |
| M03/M04 inventory and readiness | Compare Readiness with Inventory for a staff account. | Available, total, in-use, reserved, maintenance, in-transit and unavailable counts come from Supabase. Transferable stock is displayed when the source pool has a configured reserve. A missing critical equipment record prevents a Ready label. |
| M05 equipment needs | Request an item and enter a source, deadline and operational reason. | The destination comes from the authenticated staff profile. The queue persists and identical retries return the same request. |
| M06 internal transfers | Use separate requester, source coordinator, and destination receiving accounts. Review the request, allocate above the configured reserve, dispatch, and confirm receipt. | Timeline shows the recorded stages. Arrival moves stock to the destination and releases the reservation atomically. A repeated dispatch or receipt leaves inventory and audit events consistent. |
| M07–M09 supplier workflow | Choose **Ask a supplier** when no internal stock is available. A different coordinator sends the enquiry. Sign in as the assigned supplier and respond with full, partial or unavailable stock and, when applicable, an ETA. | The enquiry carries required-by time and quantity. Assigned suppliers can respond. Hospital users see responses on the active page’s next refresh, about every 15 seconds. Supplier replies never add to owned stock. |

Use synthetic operational reasons and test accounts. Shared demo accounts should remain limited to the demonstration environment. Tasks that change inventory or audit records belong in a disposable environment.

## Defensive security checks

Run `npm test` for isolated authorization and regression coverage and `npm run test:concurrency` against disposable PostgreSQL for independent sessions. The Sprint 3 suite checks anonymous denial, hospital boundary isolation, least-privilege stock access, patient-profile self visibility, supplier organization isolation and field redaction, independent authorization, idempotency, and unavailable direct writes. The transfer suite checks dispatch and receipt permissions, invalid transitions and exact stock movement. The browser policy restricts scripts to local assets and network connections to the site and Supabase.

For production verification, compare GitHub Pages’ published commit with `main`, list Supabase migrations, check advisor changes, and use a synthetic account to open Requests, Readiness, Inventory and Supply enquiries. Check that UI inventory counts match the Data API. Avoid entering real clinical information. The historical project and status documents record earlier milestones.

## My Visit deployment

The protected synthetic visit workspace is deployed. The hosted project has no assigned patient visits yet. Follow the [provisioning and data-handling guide](PATIENT_DATA_HANDLING.md) before showing it live.

## Prototype limits

Patient records, appointments and medicine examples remain synthetic. There is no production patient chart, multi-patient clinical acceptance, or independent security assessment in this release. Supplier updates are active-page polling. The new enquiry workflow preserves the older API during rollout so previously loaded pages can still work. Use dedicated identities for the separate demo roles.

GitHub Pages publishes from the root of `main`. The Sprint 3 rollout requires the additive transfer lifecycle migration followed by the supplier and inventory migration, then the frontend publication. The hosted migration ledger may assign its own timestamps when migrations are applied through the Supabase project API.
