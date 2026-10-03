# Nexora Health Lean v3 deployment

## Status
The complete corrected package is prepared for harman-06/capstone. The original public frontend uses JSON, UI demo roles, and placeholder request buttons. This integration adds real Supabase sign-in and live read-only equipment inventory. Transfer workflows run through trusted SQL, not browser RPC. Medicine, patient, appointment and notification displays remain synthetic JSON.

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
3. In SQL Editor create a public.users membership row using this template. Replace the UUID and email. No role assignment is needed for read-only equipment access.

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
- Browser transfer Request buttons and Requests page remain placeholders. Transfer functions are deliberately not exposed to the browser; future authenticated RPC must bind actors to auth.uid(), not accept arbitrary user IDs.
- Trusted database-owner SQL can bypass RLS and modify domain state. Never distribute database-owner credentials.
- Policies currently accept any one matching active role policy; multiple rows are alternatives, not multi-approver requirements.
- Hospital-scoped roles apply to child departments. Location scopes must be explicit; NULL/global scopes are not supported.
- No realtime subscription; refresh is manual. Patient/medicine JSON remains public synthetic demo content.

Existing project URL: https://olbvwbytgfnxizxzssok.supabase.co
