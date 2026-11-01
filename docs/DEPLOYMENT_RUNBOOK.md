# Nexora Health Lean v3 deployment

> Allocation upgrade: [Equipment allocation MVP](ALLOCATION.md) supersedes the earlier direct-request/approve browser flow on this branch. Requests now enter an independently reviewed queue; source reserve configuration and Allocate next create the reserved transfer. See that guide for the exact priority/fairness policy, API contract, migration and verification limits.

## Current status and installation choice

The workflow branch adds authenticated request/decision RPCs and a supplier enquiry backend to the existing equipment integration. Migrations 07/08 and both timestamped allocation migrations are already applied to the hosted Nexora Health project. The frontend changes remain in [draft PR #4](https://github.com/harman-06/capstone/pull/4). Read [STATUS.md](STATUS.md) for dated evidence and [PROJECT_GUIDE.md](PROJECT_GUIDE.md) for the ordered release steps.

For the existing hosted project, do not create a replacement project or rerun the original schema. Verify the installed migration versions, review the demo account roles/memberships, run read-only health checks, then perform real-account browser acceptance. Only merge and verify Pages after the release criteria pass. No current user roles should be inferred from the demo role picker.

The initial-installation instructions below apply only to a new empty project. After files 00–05, run `07_authenticated_workflows.sql` then `08_supplier_enquiries.sql` to reproduce the current backend. `06_provision_member.example.sql` is an example for reviewed provisioning, not a mandatory blind execution step. Then apply the two files under `supabase/migrations/` in timestamp order for the allocation extension. Run `09_workflow_health.sql` after upgrading. Never rerun `04_rls.sql` after 07/08 without reviewing its original function-grant reset.

Medicine, patient, appointment and notification examples remain synthetic. Supplier UI, account provisioning and refresh are separate remaining integration work.

## Create a project only if needed
1. Sign in at https://supabase.com/dashboard.
2. Use the Free organization and New project. Name it Nexora Health.
3. Generate and save the database password privately. Choose a nearby region.
4. Wait for Healthy status. Do not share passwords or secret/service-role keys.

## SQL Editor
For a new empty project only:
1. Open SQL Editor, dismiss its welcome notice, and open a new query.
2. Paste database/00_preflight.sql and Run. Expect no public tables. If tables exist, stop for a migration review; never DROP or reset.
3. Run the complete contents of each file separately, in order:
   - 00_schema.sql: 15 tables and 7 role types. Refuses an existing installation.
   - 01_workflow_functions.sql: hierarchy validation, scoped approval, request/approve/reject/start/complete/cancel functions and audit events.
   - 02_views.sql: four invoker views. Only two will be exposed to members.
   - 03_seed_demo.sql: 10 locations, 6 categories/models, 9 assets, 18 thresholds, 3 synthetic users, 3 policies.
   - 04_rls.sql: enable RLS for every table; allow provisioned active members to read inventory; deny anonymous access and browser workflow writes.
   - 05_validation.sql: seed/security assertions and transfer workflow tests. Test changes are rolled back; sequence counters can advance.
4. Verify three units and 18 inventory rows, including Cardiology pumps qty 4 and Oncology ventilator qty 1 / low. Categories without assets show out, meaning zero recorded availability in this prototype.
5. If a script fails, stop and inspect the error. Do not blindly rerun 00. SQL Editor executes as a privileged database role; this is not evidence that a browser has access.

## Frontend staff account (different from your Supabase dashboard account)
1. Open Authentication > Users. Create a dedicated test account using an email/password you control. Enter the password privately in the dashboard. This is a credential creation step for the user to perform.
2. Copy the Auth user UUID; it is an identifier, not a password.
3. In SQL Editor create a public.users membership row using this template. Replace the UUID and email. No role assignment is needed for the original read-only equipment access. Requesting or deciding transfers requires additional reviewed roles and a home department; follow `FARHAN_WORKFLOWS.md`. This simple membership template alone is insufficient for workflow access.

```sql
INSERT INTO public.users(auth_subject,email,display_name)
VALUES ('REPLACE_WITH_AUTH_USER_UUID'::uuid,'YOUR_TEST_EMAIL','Nexora Test Member');
```

Do not link your account to Nadia/Eli/Sam: those are synthetic workflow actors. Public signups alone do not grant database membership. Membership is provisioned by the owner.

## Connect the frontend
1. Project > Connect or Settings > API Keys: copy only the publishable key (sb_publishable_...). Do not reveal secret keys or connection strings.
2. Set js/config.js to the project URL and publishable key. The publishable key is intentionally public and requires RLS. There is no .env build step on plain GitHub Pages.
3. In harman-06/capstone, create a branch such as nexora-lean-v3. Upload the package contents into the repository root, preserving js/, css/, data/, database/, docs/, tests/, and index.html. Do not upload an extra enclosing capstone/ directory or node_modules/.
4. Open a pull request. Review changed files; merge when ready. The existing GitHub Pages configuration should continue to publish the frontend.
5. Open the deployed frontend. Before login it must report equipment unavailable / sign in; it must not silently use demo equipment.
6. Sign in using the dedicated Auth account. Expect "Live Supabase equipment" and three units. Patient and medicine displays remain demo data.
7. Click Refresh equipment to fetch current counts. Demo role changes must not change database membership. Reloading the page ends the in-memory browser session.
8. Sign out: database equipment and units must clear. Verify again in a private window.

## Local checks
Run npm install then npm test. PGlite is isolated local PostgreSQL, with a simulated auth.uid() and built-in roles. Tests cover SQL execution, seed repeatability, workflow/stock invariants, browser privileges and token headers. These do not replace live Supabase Data API/browser tests. No patient or medicine writes are implemented.

## Scope and remaining work
- On the workflow branch, equipment Request and approve/reject actions call actor-bound RPCs. Legacy trusted transfer functions remain inaccessible directly. Dispatch/receipt browser actions and the supplier screens remain future integration work.
- Trusted database-owner SQL can bypass RLS and modify domain state. Never distribute database-owner credentials.
- Policies currently accept any one matching active role policy; multiple rows are alternatives, not multi-approver requirements.
- Hospital-scoped roles apply to child departments. Location scopes must be explicit; NULL/global scopes are not supported.
- No realtime subscription or polling is implemented by the backend contribution. Equipment refresh is manual, and Requests reloads on page open. Patient/medicine JSON remains public synthetic demo content.

Existing project URL: https://olbvwbytgfnxizxzssok.supabase.co
