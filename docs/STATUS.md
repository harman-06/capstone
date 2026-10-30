# Deployment status — 30 October 2026

> Allocation upgrade: [Equipment allocation MVP](ALLOCATION.md) supersedes the earlier direct-request/approve browser flow on this branch. Requests now enter an independently reviewed queue; source reserve configuration and Allocate next create the reserved transfer. See that guide for the exact priority/fairness policy, API contract, migration and verification limits.

This dated snapshot supersedes the older status below for the workflow upgrade. Source: branch `farhan/persisted-workflows`, [draft PR #4](https://github.com/harman-06/capstone/pull/4). See [PROJECT_GUIDE.md](PROJECT_GUIDE.md) for what/why/how explanations and the next-step acceptance sequence.

| Area | Verified result | Remaining work |
| --- | --- | --- |
| Hosted database | Migrations 07 and 08 applied successfully; nine invoker workflow wrappers deny anonymous execution. | Review actual demo identity mappings before browser use. |
| New tables | RLS enabled; direct authenticated reads and writes denied; operations use checked RPCs. | Keep private schema unexposed and review permissions with later changes. |
| Hosted assertions | Requests, decisions, reservation, supplier isolation, redaction and responses passed using rolled-back synthetic records. | Actual nurse/approver/supplier browser acceptance remains pending. |
| Existing data | Nine assets preserved; zero transfers and zero enquiries after rollback validation. | Recheck inventory during the real-account demo. |
| Access | Three active Auth-linked hospital profiles; none had assigned roles. Supplier memberships: zero. | Noah reviews scopes; trusted administrator provisions approved identities. |
| Website | Implementation published in PR #4; uploaded tree matched the tested local tree. | Review, browser acceptance, merge, Pages deployment and deployed-site verification. |
| Supplier UI / freshness | Database and adapter contract available. | Aman connects supplier screens; Harman connects hospital display/refresh. |

No accounts, passwords or existing role assignments were changed during the workflow upgrade. The database is deployed; the complete product demonstration is not yet release-ready. Documentation additions describe proposals and do not implement them.

## Existing advisor findings

The existing `rls_auto_enable()` and `nh_is_member()` exposed-definer warnings, and disabled leaked-password protection, were observed before and after the migrations. They were not silently altered. Review the [anonymous execution warning](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated execution warning](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). New RPC-only tables may have an RLS-without-policy informational finding because direct table access is intentionally revoked; validate both grants and function checks before changing that design.

## Historical installation record — 3 October 2026

The following text records the earlier installation state, not the current workflow capability or release position.

### Original snapshot

Live Supabase project: Nexora Health (olbvwbytgfnxizxzssok).
Existing public schema was empty before installation.

Installed corrected files 00 through 04, then ran 05 validation on live PostgreSQL 17.
Live checks passed: 9 assets, 3 units, 18 inventory rows, all 15 tables with RLS.
Transfer tests passed and rolled back: no permanent test transfers or audit records.
Verified live authenticated role isolation using a transaction-local simulated Auth subject: unprovisioned reads return no rows; a temporary active member sees 3 units, 18 inventory rows, and only their own profile. Membership was rolled back.
Local npm test passed, including SQL execution, repeat seed, anonymous denial, direct write denial, workflow EXECUTE denial, token header correctness and explicit connection failure display.

A dedicated frontend Auth account was created and linked to an active database member. GitHub collaborator access was confirmed; the connected integration cannot write, so the authorized browser fallback is deploying the tested files on branch nexora-lean-v3. Real frontend login and Pages publication are the final deployment checks.

Do not rerun 00 on this project. Scripts in this package are for reproduction on a fresh database. For existing projects use reviewed migrations.

Frontend js/config.js now includes the project URL and browser-safe publishable key only. Secret/service-role keys and database passwords were not read or copied.

Live anonymous Data API access to frontend_units_v returned HTTP 401 (denied). Actual frontend-account login remains pending.
