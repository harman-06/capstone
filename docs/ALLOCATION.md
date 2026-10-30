# Secure equipment allocation MVP

Implemented on the workflow branch, 30 October 2026. This extends PR #4. It covers reusable equipment only, one asset per queued demand. Consumable quantities, supplier purchasing, automated clinical triage, sensors and dispatch/receipt screens are not implemented here.

## Problem and solution

Two staff members can request the same limited stock at almost the same time. Saving both requests is legitimate; promising the same asset to both is not. Nexora now records demand separately from an asset reservation. A coordinator reviews the demand, and the database selects the next eligible request and reserves an asset atomically.

The policy is explicit and deterministic, not an AI-generated score. Urgency is a staff-reviewed input. Local healthcare leadership must define clinical use; this capstone policy is for synthetic demonstrations, not a clinical allocation standard.

## Policy v1 — exact order

Only queued requests with an active requesting profile, unchanged home department, valid requesting scope, active same-hospital units and a still-authorized independent reviewer are eligible. Ranking is calculated per source department and equipment category:

1. Reviewed priority: 3 urgent, 2 time-sensitive, 1 routine.
2. Overdue verified required-by time before requests that are not overdue.
3. Requests waiting at least 30 minutes before newer requests within the same priority/overdue group.
4. Fewer allocations to the destination unit from this source/category during the last 24 hours.
5. Earliest required-by time, when specified.
6. Earliest server-recorded creation time, then UUID as a stable tie-breaker.

The 30-minute and 24-hour values are prototype configuration choices fixed in this migration. They are not clinical service targets. Waiting never promotes a routine request above verified urgent demand. No finite-wait guarantee is made during sustained higher-priority shortages; overdue/long waits need coordinator review.

Recent allocations count existing reserved, in-transit and completed transfers, including those created before the queue. Rejected/cancelled transfers do not count. Fairness is equal-unit sharing, not weighted by demand or patient numbers. Units can have unequal needs; a future reviewed weighting policy should be tested separately.

One outstanding queued request per destination/source/category prevents queue stuffing. After allocation, a unit may request another asset; the 24-hour share affects the next selection. This intentionally restricts the MVP to one outstanding asset demand for each unit/pool rather than supporting multi-asset order quantities.

## Safe workflow

1. Staff select Request on live equipment. A zero-stock row may enter the queue without claiming stock exists.
2. The authenticated identity determines the requester and destination. Requests start unreviewed at routine priority.
3. An existing source-policy approver reviews priority, optional required-by time and a reason of 8–2000 characters. The requester cannot review their own request, even if they hold an approver role.
4. The source coordinator confirms the minimum number of available assets to retain. New pools start disabled. Zero explicitly permits reserving the last available asset; inventory low-stock warning thresholds are not silently reused as reserve policy.
5. Select Allocate next eligible request. The caller chooses the pool, never a preferred request. If the next request belongs to that caller, a different coordinator must allocate it; the system does not silently skip it.
6. The database locks the pool, reranks committed eligible requests, locks available assets and checks the retained floor. It creates and approves a transfer together, recording the policy and decision details.
7. With insufficient stock, requests remain queued. After stock becomes available, the coordinator reruns allocation. There is no background allocation scheduler in this release.
8. The requester may cancel a queued request. Cancelling a reserved transfer remains the separate trusted transfer workflow; reservations are not silently expired or taken away from users.

Requests committed after the allocator has selected its queue snapshot are considered on a subsequent allocation. A newly urgent request does not preempt a committed reservation. Different pools can progress independently; operations in one pool are serialized. This is a practical consistency-first design for the prototype, not a claim of globally optimal hospital allocation.

## Security and retry guarantees

- New tables have RLS and no direct anonymous/authenticated table privileges. Exposed RPC wrappers are SECURITY INVOKER; privileged implementations are in the unexposed private schema with explicit grants, empty search paths and qualified objects.
- Source approval policy and current role scopes determine coordinator eligibility. No new account roles or supplier memberships are granted by the migration.
- Request creation uses an operation UUID unique to the actor. Same UUID and payload return the same request. Reusing it with different input fails.
- Successful allocation results are stored by actor/operation UUID. A retry returns the original transfer instead of allocating another asset. No-stock/configuration results do not reserve anything and can be checked again.
- The browser retains operation IDs after an uncertain response and clears them after confirmed success or an Auth change. Reloading the page loses in-memory operation IDs; users must reconcile the queue/history before retrying an uncertain operation after reload.
- A unique active-reservation index remains the final protection against double reservation. Pool locking also serializes priority/configuration/cancellation changes for that pool; arbitrary arrival order of coordinator clicks does not select arbitrary recipients.
- Legacy browser request/direct-approval RPCs now reject with an instruction to use the queue. Existing records remain intact, and authorized rejection remains available. Trusted database-owner workflows are administrative escape hatches and must not be used to bypass queue fairness during the demo.
- Queue visibility is requester-owned or source-coordinator scoped. Supplier identities have no allocation-queue membership. The visible queue is capped at 200 records; pagination is a later requirement.

Audit records capture request, review (including previous/new priority and deadline plus reason), pool reserve changes, allocation policy/details, and cancellation. They are readable through trusted administration; a public audit viewer is not added. Event history is not a certified immutable compliance ledger.

## Integration contract

| JavaScript export | Purpose |
| --- | --- |
| `requestEquipment(sourceInventoryId, reason)` | Enqueue demand with retry key; returns queue request UUID, not transfer UUID. |
| `fetchAllocationQueue()` | Retrieve permitted queue/history, rank, eligibility and server-calculated action flags. |
| `reviewAllocation(requestId, priority, neededBy, note)` | Independent coordinator review. Needed-by is ISO timestamp or null. |
| `configureAllocationPool(source, category, minimumRetained)` | Confirm reserve floor and enable this pool. |
| `allocateNext(source, category)` | Returns allocated/configuration_required/no_eligible_requests/waiting_for_stock. Successful allocation includes request and transfer IDs. |
| `cancelAllocation(requestId)` | Cancel own queued demand; repeated cancellation is harmless. |

The Requests page now shows the allocation queue above transfer history. It offers manual refresh, priority review, source reserve configuration, allocation and own-request cancellation. Demo-role previews do not grant coordinator controls. No automatic refresh or supplier screen is added by this change.

## Installation and verification

Apply `supabase/migrations/20261030221131_fair_equipment_allocation.sql` after 07/08 on an existing project. This was generated with `supabase migration new`; it is an additive schema migration and preserves equipment and transfer records. It changes the old browser workflow contract to prevent priority bypass. Publish the matching frontend before users rely on the new actions. Never rerun the original schema or 04 RLS after upgrading.

`npm test` runs original schema tests, old-version workflow regression tests, new allocation database tests and JavaScript tests. The older workflow test intentionally installs only 07/08; allocation tests install the new migration too.

`npm run test:concurrency` uses independent real PostgreSQL sessions against a new empty local database named `nexora_allocation_test`. It refuses nonlocal databases or existing tables and never drops tables. The GitHub Actions workflow supplies disposable PostgreSQL 17 and runs this test after `npm test`. The test covers concurrent repeated enqueue, repeated successful allocation, multiple allocators at a reserve floor, and competition for the last available asset. Local PGlite tests alone do not prove cross-session locking. Record the actual CI outcome before claiming concurrency validation passed.

`tests/hosted-workflow-rollback.sql` now validates the current queue and supplier workflows using transaction-local synthetic identities/records and rolls them back. It tests database permissions, not real Auth issuance or the complete browser experience.

## Release dependencies

The previously observed role-mapping gap remains: actual demo identities require reviewed scopes. A source approver must confirm a reserve floor for each pool and review requests before allocation. Run a real two-browser scenario after provisioning; then review/merge the PR and verify Pages. Do not mark the live website or real-account demonstration complete merely because database/CI checks pass.

## Technical references

- [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html): pool/asset row locks and transaction lifetime.
- [Supabase functions](https://supabase.com/docs/guides/database/functions): explicit function privileges and private privileged code.
- [Project guide](PROJECT_GUIDE.md): team handover and broader proposed capabilities.
