# Nexora Health — contribution, readiness and practical next steps

Updated: 30 October 2026. Audience: teammates, presenters and developers.

This guide describes the implementation on `farhan/persisted-workflows`, proposed in [PR #4](https://github.com/harman-06/capstone/pull/4). Database migrations 07 and 08 are applied to the existing Nexora Health project. The frontend changes are awaiting release. Proposed additions below are designs, not completed features. This is a capstone prototype using synthetic data, not a certified clinical or procurement system.

## 1. Explain Farhan's part in ordinary language

> My contribution connected equipment requests to a shared database. Previously, a request could appear in a browser demonstration without becoming a lasting shared record. The new workflow saves it, checks the signed-in person's actual permissions, and lets a different authorized person approve or reject it. I also prepared the database and connection methods for a supplier to receive an authorized enquiry and save an availability response. We tested those rules locally and on the hosted database. The remaining steps are assigning the intended demo accounts, connecting the supplier screens, testing through real browser sessions, and releasing the website changes.

This is the contribution implemented for Farhan's assigned scope with AI assistance. It is not evidence of manually written hours or sole authorship of the whole project. The existing interface and schema were extended; teammate contributions are retained.

### Before, change and reason

| Before this contribution | Implemented change | Why it matters | Evidence |
| --- | --- | --- | --- |
| Hospital request actions used local demonstration records. | Configured equipment actions use authenticated database RPCs and retrieve saved transfers. | A refresh or another permitted session can retrieve the same record. | `js/api.js`, `js/pages/other.js`, `js/pages/inventory-item.js` |
| Original transfer functions were restricted to trusted SQL. | New entry points derive identity from the signed-in token and validate role and scope. | The browser cannot choose an arbitrary requester or approver. | `database/07_authenticated_workflows.sql` |
| A button label or demo role could be mistaken for actual authority. | Database permissions determine whether a decision is allowed; returned `canDecide` guides the screen. | Hiding a button alone cannot secure a database action. | Migration 07; role-denial tests |
| Supplier responses had no dedicated saved workflow in this contribution's baseline. | Supplier organisations, memberships, enquiries, responses and events are persisted. | Hospital and supplier perspectives can share one controlled workflow. | `database/08_supplier_enquiries.sql` |
| An immediate modal close could look like a successful save. | Save handling waits, disables repeat submission and keeps errors visible. | Users can distinguish a completed save from a failed operation. | `js/modal.js`, `tests/modal-async.test.mjs` |
| Live equipment could be mixed with extra synthetic equipment. | Extra equipment examples are limited to unconfigured demo mode. | A live stock list should represent recorded database assets. | `js/data.js` |
| A delayed response could arrive after sign-out. | Session changes invalidate pending results and refreshes; protected cached data clears. | An old request must not restore a signed-out session or old user's data. | `js/api.js`, `js/auth-ui.js`, workflow API tests |

### How the team contributions connect

Harman established and extended the website experience. Arslan expanded units, equipment records and navigation. Farhan's current integration connects equipment actions in that experience to persisted, permission-checked database workflows. The planned division of remaining work is below; it is not a claim that those tasks are already complete.

| Person | Next responsibility | Concrete handover |
| --- | --- | --- |
| Farhan | Backend contract, integration support and release evidence | Maintain RPC documentation; investigate failed saves; help run the cross-account acceptance test. |
| Noah | Authorization and demo identity review | Confirm nurse/approver departments, actual scoped role assignments and supplier membership; verify forbidden actions fail. |
| Aman | Supplier experience | Build a supplier entry path, assigned enquiry list and availability response form using the supplied adapter methods. |
| Harman | Hospital experience and freshness | Show saved workflow status, clear error/empty states and a controlled refresh mechanism. |
| Arslan | Inventory accuracy | Reconcile asset location, availability and reservations before and after decisions; verify counts are not changed by supplier promises. |

## 2. What is complete and what is pending

| Layer | Observed position on 30 October | Meaning |
| --- | --- | --- |
| Local implementation | Database, adapter and relevant request actions implemented; local tests passed. | Code and isolated tests are available. |
| Hosted database | Migrations 07 and 08 applied; transaction-based hosted assertions passed. | The deployed database can enforce and store the new workflows. |
| Existing data | Nine equipment assets preserved; test transfers and enquiries rolled back. | Hosted tests did not leave demonstration requests behind. |
| Real hospital identities | Three active profiles linked to Auth identities; zero of those profiles have role assignments. | Being signed in allows identification, but does not grant permission to request or approve. |
| Supplier identities | Zero supplier memberships at verification. | No real supplier demo identity is authorized yet. |
| Supplier screens / refresh | Backend contract available; assigned frontend work remains. | The complete side-by-side demonstration is not ready. |
| Website release | PR #4 was created as a draft; this guide does not claim a merge or Pages deployment. | Hosted database readiness and published website readiness are separate. |

**Why pending:** releasing the frontend before account mapping would expose permission errors to the team. Assigning every user an administrator role would hide the problem and invalidate the role demonstration. The correct solution is to provision the intended scoped demo accounts and verify both allowed and denied actions.

These are readiness dependencies, not a remaining GitHub login problem. Browser publication of the implementation branch succeeded. A successful SQL test is not proof that real sign-in, route access and UI controls work together.

## 3. What happens technically

### Hospital request: what, why, when and how

1. **When:** a signed-in staff user requests equipment from another unit.
2. **What the browser sends:** the live inventory summary ID and optional reason, through `requestEquipment()` in `js/api.js`. It sends a bearer access token, not a chosen actor ID.
3. **How identity is established:** `auth.uid()` supplies the Auth subject. `public.users.auth_subject` maps it to an active hospital profile and its home department.
4. **Why scope is checked:** a valid requesting role must cover that department, and source/destination must be different active units in the same active hospital.
5. **How an asset is selected:** the database finds one available, unreserved asset in the source category and locks it while creating the request. One reusable asset is requested per transfer record.
6. **What is saved:** the existing transfer workflow records the asset, requester, source, destination and state. The Requests page subsequently fetches permitted records from the database.
7. **When a decision occurs:** a different person with a matching source-unit approval policy calls `decideTransfer()`.
8. **What approval means:** the asset is reserved. Its physical location has not changed. Dispatch and receipt are separate business events.

The existing trusted workflow supports later movement stages, but this browser contribution wires request and approve/reject only. It does not add a complete dispatch/receipt interface. Pending requests also do not reserve stock immediately: competing requests may exist until a decision; approval must recheck availability.

### Supplier enquiry: how it differs

An internal transfer asks for an asset the hospital already records. A supplier enquiry asks an external organisation what it can supply. Those quantities must not be combined.

| State | Who changes it | Database action | Who sees it |
| --- | --- | --- | --- |
| `requested` | Authorized staff in their home department | `createSupplyEnquiry()` saves category, quantity and internal reason. | Requester and applicable hospital sourcing roles. |
| `sent` | A different authorized charge nurse or operations user | `sendSupplyEnquiry()` selects an active supplier linked to that hospital. | Permitted hospital users and that supplier's active members. |
| `responded` | Active member of the assigned supplier | `respondSupplyEnquiry()` saves availability, quantity and optional estimated date. | The same permitted parties; unrelated suppliers remain excluded. |

An identical repeated supplier response is a no-op: it does not create another event. A changed response can update the stored answer and create another event. The current event table records action, actor and time, but does not preserve every previous quantity/date value. Full response-version history is a proposed extension below.

Supplier results omit staff identities and return the internal reason as null. Membership is provisioned by trusted administration; there is no public supplier registration endpoint. A supplier account must not be added as a hospital member merely to pass the existing staff entry flow, because that could grant unrelated equipment visibility.

### Security terms without guesswork

| Technical term | Meaning here | Where it is used |
| --- | --- | --- |
| Authentication | Establishes which account signed in. | Supabase Auth and the bearer token. |
| Authorization | Checks what that identified account may do to a particular record. | Role scope, approval policies and supplier membership checks. |
| RPC | A named database operation called over the API. | Public `nh_api_*` functions, called by `js/api.js`. |
| RLS — row level security | Database rules controlling row access when a table is accessible. | Existing inventory policies; enabled on the new tables as additional protection. |
| SQL grants / ACL | Controls whether a role can access a table or execute a function at all. | Direct access to new tables is revoked; anonymous workflow execution is denied. |
| SECURITY INVOKER | Runs a function with the caller's privileges. | The nine exposed workflow wrappers. |
| SECURITY DEFINER | Runs with the function owner's privileges; requires explicit internal permission checks. | Narrow implementations in the unexposed `nexora_private` schema, with empty search paths and qualified objects. |
| Transaction | A group of database changes succeeds together or rolls back together. | Workflow operations and hosted test fixtures. |
| Idempotency | Repeating an operation has the same effect as performing it once. | Identical supplier response saves; not yet a general request-creation guarantee. |
| Audit event | A record that an action occurred. | Existing audit logs and new supplier events; not a complete tamper-proof compliance ledger. |

Supabase is the hosted backend that stores live data. “Live data versus Supabase” is not a choice between alternatives. The choices are persisted data versus browser samples, and manual refresh versus polling/subscriptions. This implementation persists workflow records; it does not yet push updates instantly to every screen.

## 4. Exact route to a usable prototype

Perform these steps in order. Owners describe the planned team division; the project owner can reassign work explicitly.

| Order / owner | What to do | Why / how | Acceptance evidence |
| --- | --- | --- | --- |
| 1 — Noah with project owner | Review the demo access matrix. | Choose distinct nurse, source-unit approver, supplier and unrelated supplier identities. Confirm each hospital home department and role scope. Enter credentials privately in Supabase Auth. | Account aliases, intended scope and approval recorded; no passwords in GitHub. |
| 2 — Noah / trusted administrator | Provision reviewed profiles, role assignments and supplier membership. | Map Auth UUIDs to active profiles; set home departments; assign only required scopes. Link suppliers to their hospital and active members to the correct supplier. Do not use the UI demo picker as authority. | Read-only access checks show intended role coverage. Unassigned accounts remain denied. |
| 3 — Farhan and Arslan | Run the nurse/approver browser scenario. | Request one available asset from another unit; reload; use a distinct matching approver; approve; inspect reservation and original location. | Same transfer ID after reload; reserved asset; unchanged physical location; rejected self-approval. |
| 4 — Aman and Harman | Connect supplier and hospital enquiry views. | Use existing adapter functions; supplier path must not require a hospital profile. Hospital view needs category IDs, quantity, send controls and response status. | Same enquiry ID shown in two sessions; no visibility before sending; unrelated supplier sees nothing. |
| 5 — Noah and team | Test permissions and failures independently. | Try wrong-unit approval, unrelated supplier response, revoked membership, sign-out during a load and a network failure. | Expected denials and visible failure states; no false success or leaked previous-session data. |
| 6 — Farhan / reviewer | Review PR #4 and remaining advisor findings. | Check the diff, migration state and actual acceptance evidence. Review old exposed-definer warnings separately; never fix them by granting broader access. | Review recorded and unresolved findings explicitly accepted or fixed through reviewed changes. |
| 7 — Repository maintainer | Mark ready, merge and verify GitHub Pages. | Review the Pages run after merge; open the deployed site in fresh sessions and repeat one allowed and one denied action. | Successful deployment, actual URL, tested commit and observed outcome recorded. |

No calendar completion date is invented: each step starts when its prerequisite passes. No additional labour hours are claimed. Prioritize this sequence within the team's agreed sprint budget before adding optional scope.

### Read-only access diagnosis

Run this only in the trusted Supabase SQL Editor. It reports counts, not emails or passwords. It makes no changes.

```sql
SELECT
  (SELECT count(*) FROM public.users
    WHERE is_active AND auth_subject IS NOT NULL) AS mapped_active_profiles,
  (SELECT count(*) FROM public.users u
    WHERE u.is_active AND u.auth_subject IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.user_role_assignments r
                  WHERE r.user_id = u.user_id)) AS mapped_profiles_with_assignments,
  (SELECT count(*) FROM public.users
    WHERE is_active AND auth_subject IS NOT NULL
      AND home_department_id IS NULL) AS profiles_missing_home_department,
  (SELECT count(*) FROM public.nh_supplier_memberships
    WHERE is_active) AS active_supplier_memberships;
```

A nonzero assignment count alone does not prove authorization. Verify role type, scope, active department/hospital and matching policy for the action. Role provisioning is an administrative change and must use reviewed identities; this guide deliberately does not supply an all-users grant script.

### Browser acceptance record to capture

For each case record the tested commit, date, account alias, role/scope, transfer or enquiry ID, action, expected result, observed result and a screenshot with credentials omitted. Keep sensitive account mappings privately. Actual browser results remain pending until someone records them; do not fill them with the SQL test's outcomes.

## 5. Practical additions beyond the original handover

All items in this section are **proposed and not implemented**. Implement a small number after the release blockers above. They describe a feasible next increment rather than expanding both sprints into the same task list.

### A. Give out-of-stock requests a useful path — highest product priority

**Problem:** zero available assets means an internal transfer cannot be saved. The current database correctly rejects it, but a user needs a next action.

**Proposed behaviour:** show “No available asset in this unit,” preserve the selected category, and offer “Check other units” or “Request external availability.” The second action opens a hospital-only enquiry form using the existing supplier backend. Require a separate authorized person to send it. Never create a supplier order automatically from an inventory click.

**Technical approach:** use the existing category UUID, validate whole quantity 1–1000, call `createSupplyEnquiry()`, then load the saved record. Expose a controlled category list through the current data contract or a reviewed metadata RPC; do not parse a display name into an ID. Add stable error codes to the workflow contract before making the UI branch on database error text.

**Acceptance:** an out-of-stock click yields a clear explanation and one saved enquiry after confirmation; refresh preserves it; suppliers cannot see it until authorized sending. No hospital stock is increased.

**Suggested owners / timing:** Harman and Farhan after account mapping; Aman consumes the resulting sent enquiry. This is the shortest path from the current inventory problem to the intended cross-organisation demo.

### B. Make uncertain saves safe to recover — highest reliability priority

**Problem:** a database save can succeed even if the browser loses the response. Clicking again may create a second request. Disabling a button covers one interaction, not every retry or another browser tab.

**Technical approach:** add a client-generated operation UUID to request/enquiry creation and enforce a database uniqueness rule scoped to the authenticated actor and operation. Return the original result for the same key and payload; reject key reuse with different payload. Preserve that key while retrying the same form. Implement and test through a new additive migration.

For existing non-idempotent creation calls, do not blindly auto-retry. Reload the permitted request list and reconcile first. After a successful decision followed by a refresh failure, show “Decision saved; refresh failed” and a read-only refresh action. A generic error alone can leave users unsure whether the decision committed.

**Acceptance:** simulate a response lost after commit; retry produces the original ID and one record/event. Two tabs cannot reserve the same asset. These stronger guarantees are future work; the current hosted test is sequential and does not prove every concurrent race.

**Suggested owners / timing:** Farhan, with Noah reviewing authorization, before enabling automated retry.

### C. Show freshness and exceptions on the shared dashboard

**Problem:** saved data can be correct while a screen is stale. A long-unanswered request is operationally different from a healthy empty list.

**Technical approach:** start with authenticated polling about every five seconds while the relevant view is visible, one request at a time. Pause on sign-out/navigation or hidden tabs, back off on errors, and show “Last updated” plus a retry control. This is near-real-time polling, not an instant-update claim. Keep using the permission-checked list RPCs.

Add an authorized “Needs attention” view for unanswered enquiries and pending decisions, with an age label derived from server timestamps. Agree the alert threshold with the team; do not present a made-up clinical service standard. A future deadline field should be distinct from `updated_at`, which changes after edits.

**Security constraint:** raw Postgres Changes subscriptions need separately reviewed publication and row access. Do not grant direct reads to the new enquiry tables just to enable subscriptions: suppliers must still be unable to read the internal reason. If moving beyond polling, use an authorized minimal notification that prompts the existing RPC to refetch, after a separate design/security review.

**Acceptance:** two authorized sessions show the same response on the next successful refresh; a network failure produces a stale label; an unrelated supplier receives no payload. No background polling continues after sign-out.

**Suggested owners / timing:** Harman and Aman, with Farhan supporting the contract, for the Sprint 3 side-by-side demo.

### D. Track equipment movement with QR first, sensors later

**Problem:** clicking approve does not prove that an asset left a room or arrived at another unit. A supplier promise does not prove receipt either.

**Practical first version:** print a QR code containing a non-secret asset reference. An authorized staff member scans it, chooses an allowed movement action and confirms the destination. The server derives the actor and timestamp and checks the current workflow state. Use the existing transfer stages through new actor-bound wrappers; the trusted legacy functions must not be exposed directly.

**Later automation:** RFID/reader signals can create a proposed observation containing device ID, asset reference, timestamp and deduplication key. A trusted ingestion endpoint must validate device credentials and replay limits. Human review resolves unmatched assets, conflicting locations and missing receipts before business state changes. Do not put a privileged ingestion key in GitHub Pages.

**Acceptance:** duplicate scans cause one state transition; wrong-unit scans fail; dispatch alone never marks received; a QR code alone gives no access. Demonstrate with synthetic assets. Hardware integration remains optional after a stable software prototype.

**Suggested owners / timing:** Arslan and Farhan after dispatch/receipt rules are agreed; Noah reviews scopes. Start with a manual scan prototype rather than buying hardware.

### E. Make supplier information more useful without overstating stock

**Problem:** a supplier can revise an answer, and old information may no longer be usable. The current event record does not retain the full previous response payload.

**Technical approach:** add response revisions with previous/new quantities and estimated dates, actor and time; retain the current summary for fast lists. Add an explicit response-valid-until field and a stale marker after expiry. Use the current database date/time as the basis and agree the display timezone. Do not treat expired estimates as a confirmed delivery.

**Acceptance:** two changed answers leave two inspectable revisions; an identical retry adds none; an expired answer is labelled stale; suppliers see only their own history. Never update owned equipment counts from a response. Procurement, dispatch and receipt need their own approved states before stock reconciliation.

**Suggested owners / timing:** Farhan and Aman after the basic supplier response demonstration succeeds.

### F. Measure the workflow with data the system actually records

**Technical approach:** add a permission-checked aggregate report for pending requests, response duration and the proportion of enquiries answered fully/partially/unavailable. Define response duration as `responded event time - sent event time` for the first response; do not use `updated_at` after later revisions. Use server timestamps and documented reporting periods. Supplier reports must be scoped to their organisation; hospital reports must be scoped to the hospital.

**Important boundary:** request counts are not equipment consumption. Reusable equipment movement, consumable usage and supplier availability are different measures. Do not claim demand forecasting or automated replenishment from request counts alone. Collect actual issue/return or consumption events first, then evaluate whether a simple historical threshold is useful.

**Acceptance:** totals reconcile to permitted underlying records; empty samples show “insufficient data”; no personal or cross-supplier details are included.

**Suggested owners / timing:** Farhan and Arslan after enough synthetic event history is available; add reporting after core correctness, not instead of it.

## 6. Troubleshooting by symptom

| Symptom | Likely layer to inspect | Practical next action |
| --- | --- | --- |
| Sign-in fails with HTTP 400. | Auth credentials/account configuration. | Inspect the non-secret Auth error; verify the intended account privately. Do not grant roles to fix a password failure. |
| Sign-in succeeds but request is denied. | Profile, home department, role scope or policy. | Use the read-only counts, then have Noah inspect the exact reviewed mapping. |
| Supplier login succeeds but staff entry rejects it. | Entry flow assumes every user has a hospital profile. | Build the separate supplier path; do not add supplier hospital membership as a shortcut. |
| No available asset remains. | Recorded asset/reservation state. | Refresh inventory; check other units; offer the proposed enquiry path when implemented. |
| Supplier list is empty. | No active supplier assigned to the caller's hospital, or missing permission. | Verify supplier organisation and hospital link through trusted administration. |
| Enquiry list is empty before sending. | Visibility rule. | Expected for a supplier: hospital-only enquiries stay hidden until authorized sending. |
| Workflow RPC is missing / HTTP 404. | Migration or API schema cache. | Verify migration versions and selected project; do not reset tables. |
| Approval succeeded but the screen then reports refresh failure. | Read after write. | Reconcile the saved transfer before another action; implement the separate saved/stale message above. |
| Data disappears on page reload. | In-memory Auth session versus database persistence. | Sign in again and fetch the saved record. A new sign-in does not mean the record was lost. |
| Another user's data appears after logout. | Session/cache isolation regression. | Treat as a failed acceptance case; stop release and inspect session-version guards. |

## 7. Evidence, limits and presentation answers

Local tests cover the original schema plus new database and JavaScript workflows. Hosted PostgreSQL assertions used synthetic transaction-local profiles, roles and suppliers. They verified saved requests/responses, self-approval denial, reservation, repeated-decision denial, supplier isolation, internal-field redaction, direct-table denial and duplicate response-event prevention. Test fixtures were rolled back. They did not create permanent Auth logins or prove the full browser journey.

Use `npm ci` then `npm test` for isolated local tests. `tests/hosted-workflow-rollback.sql` is for a trusted, reviewed hosted validation run; it contains temporary writes and must not be mistaken for a read-only health query. `database/09_workflow_health.sql` contains read-only checks.

**Why use Supabase?** It provides managed PostgreSQL and Auth behind the static website. SQL constraints and functions keep shared business rules close to the data; a custom application server was not necessary for this prototype's current workflow.

**Is it live?** The hosted database changes are live and tested. The website integration is in a draft PR; supplier UI and real-account acceptance remain pending. Automatic updates are still proposed.

**Can everyone use one shared account?** One account cannot demonstrate separation between requester, approver and supplier or attribute individual actions. Use distinct team-controlled demo identities by role and keep credentials private.

**Did approval transfer the equipment?** It reserved an existing asset. Physical dispatch and receipt require separate evidence and workflow stages.

**Is this ready for real patient data?** This contribution does not establish that. Patient, appointment and medicine functionality remains synthetic; operational deployment requires a separate assessment. Do not add actual patient information to demo records or this public repository.

## 8. References and where to continue

- [Backend contract and setup](FARHAN_WORKFLOWS.md): exact adapter exports and permissions.
- [Deployment runbook](DEPLOYMENT_RUNBOOK.md): new versus existing installations.
- [Observed status](STATUS.md): dated evidence and unresolved dependencies.
- [Supabase database functions](https://supabase.com/docs/guides/database/functions): execution privileges and function security.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): identity and row access.
- [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes): publications, subscriptions and access requirements; relevant to a future design, not enabled here.

Official documentation was checked on 30 October 2026. Proposed priorities and designs are project recommendations, not vendor requirements or clinical standards.
