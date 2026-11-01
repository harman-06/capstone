# Account roles and supplier workflow — 1 November 2026

## What changed and why
The IT administrator now has an account-monitoring workspace. The demo coordinator now covers Cardiology as well as Emergency, allowing review of the demo nurse’s Cardiology enquiries. Previously the unit scope prevented that review. Enquiries remain hidden from suppliers until independently approved and sent to that supplier.

## Access by role
| Role | Allowed workflow |
|---|---|
| Nurse | View inventory; create equipment requests and shortage enquiries; follow status. Cannot review priority, allocate, or send supplier enquiries. |
| Coordinator | Nurse actions plus review and allocation within assigned units, and send other staff members’ enquiries. Cannot approve own enquiries. |
| Supplier | See only assigned, sent enquiries and provide availability, quantity and estimated delivery date. |
| IT administrator | Read hospital account metadata: status, confirmation, roles, scope and last sign-in. No password/token access, account editing, or full sign-in audit log. |

Role checks for mutations and account inspection run in PostgreSQL, not only in navigation. The existing hospital-member inventory read policy also covers active admins; the admin interface hides inventory, but this is not a separate backend prohibition on inventory reads.

## How to demonstrate
1. Sign in as nurse.demo@nexora.example and create a shortage enquiry.
2. Sign in as coordinator.demo@nexora.example, open Supply enquiries, and send that enquiry to Supplier A.
3. Sign in as supplier.a@nexora.example in another browser session. The sent enquiry should appear on refresh or within the next 15-second foreground refresh cycle.
4. Respond with availability and quantity. The hospital sees that response after refreshing.
5. Supplier B must not see Supplier A’s enquiry. A coordinator-created enquiry needs another independently authorized coordinator to send it.
6. Sign in as it.admin@nexora.example to inspect accounts.

Use private passwords established in Supabase; never commit them. Refresh is polling, not a Realtime subscription. Background tabs and open forms pause refreshing; polling resumes afterward. Network errors are visible and retried. Supplier estimates do not reserve assets or add received stock. Dispatch, receipt and account lifecycle administration remain future work.

## Installation and verification
Apply supabase/migrations/20261101183907_admin_account_monitoring.sql after the earlier migrations. A trusted administrator runs database/provision_it_admin.sql after confirming the IT Auth account. database/provision_demo_access.sql is idempotent and now retains the coordinator’s two unit scopes. No existing accounts are deleted.

Run npm test: database/RLS and workflow checks plus 15 tests cover authorization, supplier isolation, provisioning, allocation and account metadata protection. Automated SQL role checks do not prove that private passwords work; complete the browser demonstration above for that verification.
