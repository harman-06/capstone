# Aman Sharma — Supplier Workflow (M07, M08 and M09)

## Scope

This contribution extends the existing Nexora Health supplier workflow. It does not replace the hospital request, allocation, authentication or role model. It covers the supplier workspace, enquiry information, supplier response, hospital visibility and the shortage hand-off.

## Implemented in this working copy

- Added a required-by date to supplier enquiries with the additive migration `database/10_supplier_required_by_date.sql`.
- Updated the browser API to submit the required-by date and updated the enquiry list to display it.
- Added a supplier-shortage hand-off from an equipment detail page. If no other hospital unit has available stock, a configured/live session can create a supplier enquiry with quantity, required-by date and operational reason.
- Kept the workflow staged: a shortage enquiry is saved as `requested`; a different authorized coordinator must select a supplier and send it; only then can that supplier respond.
- Preserved the three supplier response choices: `available`, `partial` and `unavailable`, with quantity validation and estimated delivery date.
- Kept the existing 15-second foreground refresh so the hospital and supplier workspaces reload saved status rather than relying on a local-only display.

## Workflow

1. Hospital staff open an equipment item and check internal unit availability.
2. If another unit has stock, the existing internal request path remains available.
3. If no other unit has stock, staff create an external availability enquiry with quantity, required-by date and an operational reason. Do not enter patient-identifying information.
4. The enquiry remains `requested` and is visible to permitted hospital users only.
5. A different authorized coordinator reviews it and sends it to an active supplier linked to the hospital. The requester cannot authorize their own enquiry.
6. The assigned supplier signs in through its supplier account and sees only enquiries assigned to its organization.
7. The supplier selects full, partial or unavailable, enters the quantity it can supply and, where applicable, an estimated delivery date.
8. The hospital sees the saved response on refresh (normally within the next 15-second foreground polling cycle).

## Data and status rules

| Field | Meaning |
|---|---|
| Requested quantity | Whole-number quantity requested by the hospital |
| Required-by date | Date the hospital needs the requested quantity |
| Status | `requested`, `sent` or `responded` |
| Availability | `available`, `partial` or `unavailable` after supplier response |
| Available quantity | Full quantity, a positive partial quantity below requested quantity, or zero when unavailable |
| ETA | Supplier's estimated delivery date; not a receipt confirmation |

A supplier response is a statement of availability, not a purchase order, delivery, receipt or inventory adjustment. Supplier quantities must not be added to hospital stock. Dispatch, receipt and procurement approval are outside this implementation.

## Security considerations

- Database functions, not navigation visibility, enforce hospital role scope and supplier membership.
- Suppliers see only sent enquiries assigned to their active supplier membership.
- Supplier results do not expose the hospital's internal request reason or staff identity.
- A separate authorized coordinator must send a new enquiry; the requester cannot send their own.
- Use synthetic/demo data only. Never put patient details, passwords, access tokens or service-role keys in enquiries or source control.

## Deployment

For an existing Nexora Health database, apply `database/10_supplier_required_by_date.sql` after migrations `07_authenticated_workflows.sql` and `08_supplier_enquiries.sql`, and before the allocation migrations if following the updated runbook. This is an additive migration; do not reset the database or rerun the original schema on an existing project.

## Acceptance checklist

- [ ] Hospital staff can create an enquiry from the shortage path when no other unit has available stock.
- [ ] Required-by date, requested quantity and category remain visible after refresh.
- [ ] The requester cannot send their own enquiry.
- [ ] An authorized coordinator can send it to an active supplier in the same hospital.
- [ ] The assigned supplier can see and respond to it.
- [ ] An unrelated supplier cannot see or respond to it.
- [ ] Full response requires available quantity at least equal to requested quantity.
- [ ] Partial response requires a positive quantity below requested quantity.
- [ ] Unavailable response requires quantity zero and no ETA.
- [ ] Hospital view displays availability, quantity and ETA after refresh.
- [ ] Supplier response does not change hospital inventory quantities.
- [ ] Separate browser sessions are used for hospital and supplier demonstration.

## Verification status

JavaScript syntax checks were run on the edited frontend files. The full automated test suite could not be completed in this environment because `npm ci` did not finish installing the locked development dependency `@electric-sql/pglite` before the execution timeout. The database migration and the full two-account browser acceptance checklist must therefore be run in the team's configured Supabase project before claiming the feature is fully verified or deployed.
