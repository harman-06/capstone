# Farhan's hospital and supplier database integration

> Allocation upgrade: [Equipment allocation MVP](ALLOCATION.md) supersedes the earlier direct-request/approve browser flow on this branch. Requests now enter an independently reviewed queue; source reserve configuration and Allocate next create the reserved transfer. See that guide for the exact priority/fairness policy, API contract, migration and verification limits.

Read [PROJECT_GUIDE.md](PROJECT_GUIDE.md) for the beginner explanation, before/after comparison, blockers, ordered ownership handover, troubleshooting and proposed improvements beyond this contract.

## What this contribution implements

Sprint 2 and allocation extension: hospital equipment demand enters an actor-bound queue. The existing request screens enqueue when Supabase is configured. A different source-policy approver verifies priority; the coordinator configures a retained-stock floor and uses Allocate next. The database ranks eligible requests and atomically creates/reserves a transfer. Requests and transfers reload from the database. Approval does not claim physical movement.

Sprint 3: supplier organisations, memberships, enquiries and responses have a separate database contract and JavaScript adapter. A nurse can create a hospital-only enquiry. A different authorized charge nurse or operations user sends it to an active supplier assigned to that hospital. Only that supplier's active members can respond. The hospital retrieves the saved response through the same API. Supplier screens and automatic-refresh UI remain the assigned frontend work; this contribution does not mark them complete.

Patient, appointment, medicine and quality-check helpers remain synthetic. Demo equipment is no longer inserted into the live database inventory list. Database failures never create a pretend saved equipment request.

## Install on an existing Lean v3 project

1. Confirm the selected Supabase project and take the normal project backup/checkpoint. Do not reset the project or rerun `00_schema.sql`.
2. Inspect the existing `locations`, `users`, `user_role_assignments`, `equipment_assets`, `approval_policies` and workflow functions. Resolve unexpected schema differences before proceeding.
3. Run `database/07_authenticated_workflows.sql`, followed by `database/08_supplier_enquiries.sql` in the trusted SQL editor. Then apply the two allocation migrations under `supabase/migrations/` in timestamp order. All are transactional and preserve existing records; no new login accounts are seeded. Do not reapply an older migration after a later one: newer files deliberately replace the earlier browser workflow contract.
4. Run the read-only checks in `database/09_workflow_health.sql` and review Supabase's database security advisors. The public API functions should be SECURITY INVOKER. Privileged implementations live in `nexora_private`, with explicit execution grants and actor/organisation checks. Keep that schema out of Data API exposed schemas.
5. Do not rerun `04_rls.sql` after these scripts without reviewing its function-grant reset: it was written for the original read-only frontend.
6. Provision distinct authenticated identities as described below, then run the manual acceptance checks. Local PostgreSQL-compatible tests are not proof that the hosted project is updated.
7. Deploy the frontend only after the SQL and profile checks. If the workflow migration is absent, the frontend reports that workflows are not enabled; it does not fall back to an in-memory equipment request.

There are no passwords, privileged keys or personal login credentials in these instructions. Keep only the existing public project configuration in the browser. Do not change patient or medicine permissions as part of this upgrade.

## Account mapping for the demo

A trusted project administrator creates or selects the test identities in Supabase Auth. For hospital users, map the Auth user ID to `public.users.auth_subject`, use an active department as `home_department_id`, and assign the reviewed department/hospital role in `user_role_assignments`.

- Nurse: clinical requesting role scoped to their destination/home department.
- Approver: a different account with the source unit's active approval-policy role. A UI demo unit-clerk label does not create that permission. Noah should review actual role/policy assignments.
- Supplier: add a row to `nh_supplier_memberships` using the supplier account's Auth user ID and the reviewed supplier organisation. Do **not** provision a supplier as an active hospital `public.users` member merely to get through the equipment login path: original hospital inventory policies allow active hospital members broad equipment reads.
- Isolation test: a second supplier identity belongs to a different supplier organisation.

Supplier organisations are linked to the hospital root location. Memberships are maintained only through trusted administration. This release deliberately adds no public role-administration or supplier-registration endpoint. It creates no shared password and changes no existing account.

## Browser contract

Import these named exports from `js/api.js`. All calls use the current bearer token; none accepts a requester/approver/actor ID. Browser demo role selection never supplies the database actor.

| Export | Input | Result |
| --- | --- | --- |
| `fetchHospitalContext()` | None | Actual user display name and assigned department/unit code |
| `requestEquipment(sourceInventoryId, reason)` | Live `EQ-<department UUID>-<category UUID>` summary ID | Saved queue request UUID; one reusable asset demand, reviewed before allocation |
| `fetchTransfers()` | None | Saved requests visible to requester or applicable approver; includes server-calculated `canDecide` |
| `decideTransfer(transferId, false, note)` | Existing transfer UUID, false | Reject a legacy pending transfer; direct browser approval is retired to prevent queue bypass |
| `fetchSuppliers()` | None | Active suppliers assigned to the caller's hospital |
| `createSupplyEnquiry(categoryId, quantity, reason)` | Existing category UUID, whole quantity 1–1000 | Hospital-only enquiry UUID |
| `sendSupplyEnquiry(enquiryId, supplierId)` | Enquiry and supplier UUIDs | Authorized external handoff; cannot send one's own enquiry |
| `fetchSupplyEnquiries()` | None | Permitted enquiries and response fields; `can_send` / `can_respond` guide UI controls |
| `respondSupplyEnquiry(id, availability, quantity, deliveryDate)` | `available`, `partial` or `unavailable`; ISO date or null | Saved response; identical repeated saves do not duplicate events |

Allocation-specific exports (`fetchAllocationQueue`, `reviewAllocation`, `configureAllocationPool`, `allocateNext`, `cancelAllocation`) are specified in [ALLOCATION.md](ALLOCATION.md).

For external enquiries, the requesting department comes from the authenticated hospital profile. The hospital-only reason is omitted (returned null) to suppliers. Neither requester names nor patient details are included in supplier results. Staff and suppliers cannot read the underlying enquiry, membership or event tables directly.

Availability rules: `available` requires a quantity at least as large as requested; `partial` requires a positive smaller quantity; `unavailable` requires zero quantity and no delivery date. Past delivery dates are rejected. These are supply enquiries, not purchase orders. A supplier response never changes owned equipment counts.

### Handover to Aman and Harman

Aman can build the supplier list/form around `fetchSupplyEnquiries` and `respondSupplyEnquiry`. Supplier login must not require a hospital home department. Harman can show hospital status from `fetchSupplyEnquiries` and schedule an authenticated refresh approximately every five seconds while that view is open. Stop polling on sign-out/navigation, avoid overlapping requests and show failures honestly. No timer, supplier page or instant-update claim is included in this backend contribution.

Arslan can use the actual database IDs and `fetchHospitalContext` when extending equipment selectors. Noah owns the final access matrix, account mapping review and independent security acceptance. Existing clinical UI role previews are still previews.

## Acceptance checks and evidence

Run `npm ci` and `npm test` locally. Tests cover both the original schema and the new migrations, including stored request/response retrieval, denied legacy calls, no direct writes, self-approval even with an otherwise eligible role, reservation replay, supplier isolation, field redaction, response validation, membership revocation and migration reapplication. JavaScript tests cover authenticated POST payloads, pending save handling, session expiry and late refresh/result rejection after logout.

On the hosted project, use separate browser sessions for nurse, approver, supplier and unrelated supplier. Submit, decide, create an external enquiry, authorize sending and respond. Reload and confirm persistence. Verify denied direct calls, hidden pre-send enquiries and isolation of the other supplier. Use only synthetic records and record actual observed results. The test database runs in memory and does not send test data to the hosted project.

### Research decisions

Reviewed 30 October 2026 against the official guidance:

- [Database functions](https://supabase.com/docs/guides/database/functions): restrict execution and check each record within privileged operations; pin the search path. Exposed wrappers are invoker functions, private implementations enforce permissions.
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security): distinguish identity from authorization; retain RLS and direct-table denial for the new tables.
- [Data API routes](https://supabase.com/docs/guides/api/creating-routes): use authenticated RPC calls rather than duplicate business writes in the browser.
- [Changelog](https://supabase.com/changelog): reviewed the announced November 2026 TLS cipher retirement; this implementation uses normal HTTPS browser requests and adds no custom TLS configuration.

No simulated local run is labelled as live Supabase validation. No actual labour hours are inferred from generated code or commit counts.

## Hosted validation — 30 October 2026

Migrations 07 and 08 were applied successfully to the existing Nexora Health project. All nine public workflow wrappers are SECURITY INVOKER, deny anonymous execution and permit authenticated execution. The new tables retain RLS with no direct authenticated table reads or writes.

`tests/hosted-workflow-rollback.sql` passed on hosted PostgreSQL using synthetic profiles, roles and suppliers inside one transaction. It verified request persistence, self-approval denial, reservation, repeated-decision denial, authorized supplier handoff, supplier isolation, internal-reason redaction, direct-table denial and idempotent supplier responses. All synthetic records were rolled back: existing assets remained nine; transfers and supplier enquiries remained zero. This does not substitute for browser acceptance with real demo identities.

Three active profiles are mapped to Auth identities, but none has a role assignment; supplier memberships are empty. Noah must review and provision the scoped demo access before real accounts can use these workflows. No existing account, password or role assignment was changed by this implementation.

Security advisors also reported existing exposed-definer warnings for `rls_auto_enable()` / `nh_is_member()` and disabled leaked-password protection. These predate the new migrations and were not silently changed. Review [anonymous function execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated function execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) separately.
