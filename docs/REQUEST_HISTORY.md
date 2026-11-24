# Request and handoff history

Nexora stores requests and their history in the hosted Supabase PostgreSQL database. GitHub Pages serves the interface. It does not store workflow records.

| Record | Where it is stored | Who can view it in the application |
| --- | --- | --- |
| Equipment need and priority review | `nh_allocation_requests` and `nh_allocation_events` | The requester and an authorized coordinator for that source and equipment category. |
| Reservation, movement and receipt | `transfer_requests`, `asset_reservations` and `transfer_events` | The requester, authorized source approver, and source or destination operators with the applicable unit scope. |
| Supplier enquiry and responses | `nh_supply_enquiries` and `nh_supply_events` | The requester, authorized hospital coordinators for the requesting unit, and the assigned supplier once the enquiry is sent. |
| Internal audit records | `audit_logs` | Trusted database administrators. The IT account-monitoring workspace does not provide an unrestricted workflow audit feed. |

## Where to open history

On **Requests and approvals**, select **History** on an equipment request to see submission, review, and cancellation where applicable. If it was allocated, the same history continues through reservation, dispatch, transit, receipt, and completion. Transfer operators can open **Transfer timeline** on their authorized transfers.

On **Supply enquiries**, select **History** to see when the enquiry was created, sent and responded to. The request history endpoint returns stages and timestamps, including tag verification where recorded. It does not return internal notes, actor IDs or device tags. Supplier visibility still begins after assignment and sending.

A requester or authorized coordinator can open a timeline for a visible request. Accounts outside the permitted scope receive a generic denial. The database continues to block direct browser access to the underlying request, event and audit tables.

The history migration is additive. Apply it before publishing the frontend that uses it. Use synthetic records for testing and rehearsals.
